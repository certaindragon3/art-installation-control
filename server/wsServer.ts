import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { clampVolumeValue } from "../shared/audio";
import {
  clampPulseBpm,
  createPulseScheduler,
  type PulseScheduler,
} from "./pulseScheduler";
import {
  clampNormalizedCoordinate,
  CONFIG_TTL_MS,
  type ControlInputMessage,
  createDefaultReceiverConfig,
  type GroupState,
  legacyControlMessageToUnifiedCommand,
  type ModuleName,
  type ReceiverRegistration,
  type ReceiverState,
  type RemoveGroupPayload,
  type RemoveTrackPayload,
  type SetGroupStatePayload,
  type SetModuleStatePayload,
  type SetTrackStatePayload,
  type SubmitVotePayload,
  type TrackState,
  type UnifiedCommand,
  type UnityInteractionEvent,
  type VoteCloseReason,
  type VoteConfig,
  type VoteSessionExport,
  type VoteSubmission,
  WS_EVENTS,
} from "../shared/wsTypes";

type InternalReceiverState = {
  receiverId: string;
  label: string;
  socketId: string;
  disconnectedAt: number | null;
  connected: boolean;
  configVersion: number;
  config: ReturnType<typeof createDefaultReceiverConfig>;
};

type VoteSession = {
  voteId: string;
  question: string;
  options: VoteConfig["options"];
  allowRevote: boolean;
  visibilityDuration: number;
  targetReceiverIds: Set<string>;
  submissions: Map<string, VoteSubmission>;
  openedAt: string;
  closesAt: string | null;
  closedAt: string | null;
  closeReason: VoteCloseReason | null;
  isActive: boolean;
  timeoutId: ReturnType<typeof setTimeout> | null;
};

const RECEIVER_RETENTION_MS = 10 * 60 * 1000;
const RECEIVER_CLEANUP_INTERVAL_MS = 60 * 1000;

const receivers = new Map<string, InternalReceiverState>();
const controllers = new Set<string>();
const unities = new Set<string>();
const pulseLoops = new Map<string, PulseScheduler>();
const voteSessions = new Map<string, VoteSession>();
const receiverActiveVotes = new Map<string, string>();

let io: Server | null = null;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function createDefaultState(
  receiverId: string,
  label: string,
  socketId: string
): InternalReceiverState {
  return {
    receiverId,
    label,
    socketId,
    disconnectedAt: null,
    connected: true,
    configVersion: 1,
    config: createDefaultReceiverConfig(),
  };
}

function serializeReceiverState(
  state: InternalReceiverState,
  now = Date.now()
): ReceiverState {
  return {
    receiverId: state.receiverId,
    label: state.label,
    connected: state.connected,
    configVersion: state.configVersion,
    configIssuedAt: new Date(now).toISOString(),
    configExpiresAt: new Date(now + CONFIG_TTL_MS).toISOString(),
    config: structuredClone(state.config),
  };
}

function emitReceiverState(socket: Socket, state: InternalReceiverState) {
  socket.emit(WS_EVENTS.RECEIVER_STATE_UPDATE, serializeReceiverState(state));
}

function emitReceiverStateToRoom(
  receiverId: string,
  state: InternalReceiverState
) {
  if (!io) {
    return;
  }

  io.to(`receiver:${receiverId}`).emit(
    WS_EVENTS.RECEIVER_STATE_UPDATE,
    serializeReceiverState(state)
  );
}

function buildVoteConfigForReceiver(
  state: InternalReceiverState,
  vote: VoteConfig
): VoteConfig {
  const previousVote = state.config.vote;
  const canPreserveSelection =
    previousVote?.voteId === vote.voteId &&
    previousVote.selectedOptionId !== null &&
    vote.options.some(option => option.id === previousVote.selectedOptionId);

  return {
    ...structuredClone(vote),
    selectedOptionId: canPreserveSelection
      ? previousVote?.selectedOptionId ?? null
      : null,
    submittedAt: canPreserveSelection ? previousVote?.submittedAt ?? null : null,
  };
}

function applyVoteState(state: InternalReceiverState, vote: VoteConfig | null) {
  state.config.vote = vote ? buildVoteConfigForReceiver(state, vote) : null;
  return true;
}

function resetReceiverVoteSelection(
  state: InternalReceiverState,
  voteId?: string
) {
  if (!state.config.vote) {
    return false;
  }

  if (voteId && state.config.vote.voteId !== voteId) {
    return false;
  }

  const changed =
    state.config.vote.selectedOptionId !== null ||
    state.config.vote.submittedAt !== null;

  state.config.vote.selectedOptionId = null;
  state.config.vote.submittedAt = null;
  return changed;
}

function hideReceiverVote(state: InternalReceiverState, voteId: string) {
  if (!state.config.vote || state.config.vote.voteId !== voteId) {
    return false;
  }

  if (!state.config.vote.visible) {
    return false;
  }

  state.config.vote.visible = false;
  return true;
}

function clearReceiverVote(state: InternalReceiverState, voteId?: string) {
  if (!state.config.vote) {
    return false;
  }

  if (voteId && state.config.vote.voteId !== voteId) {
    return false;
  }

  state.config.vote = null;
  return true;
}

function clearVoteTimeout(session: VoteSession) {
  if (session.timeoutId) {
    clearTimeout(session.timeoutId);
    session.timeoutId = null;
  }
}

function buildVoteExport(session: VoteSession): VoteSessionExport {
  const options = session.options.map(option => ({
    optionId: option.id,
    label: option.label,
    voteCount: Array.from(session.submissions.values()).filter(
      submission => submission.selectedOptionId === option.id
    ).length,
  }));

  const eligibleReceivers = Array.from(session.targetReceiverIds).map(
    receiverId => {
      const receiver = receivers.get(receiverId);
      return {
        receiverId,
        label: receiver?.label ?? `Receiver ${receiverId}`,
        connected: receiver?.connected ?? false,
        hasVoted: session.submissions.has(receiverId),
      };
    }
  );

  return {
    voteId: session.voteId,
    question: session.question,
    options,
    allowRevote: session.allowRevote,
    visibilityDuration: session.visibilityDuration,
    openedAt: session.openedAt,
    closesAt: session.closesAt,
    closedAt: session.closedAt,
    closeReason: session.closeReason,
    isActive: session.isActive,
    submittedCount: session.submissions.size,
    totalEligible: session.targetReceiverIds.size,
    missingReceiverIds: eligibleReceivers
      .filter(receiver => !receiver.hasVoted)
      .map(receiver => receiver.receiverId),
    eligibleReceivers,
  };
}

function emitUnityEvent(event: UnityInteractionEvent) {
  if (!io) {
    return;
  }

  io.to("unity").emit(WS_EVENTS.INTERACTION_EVENT, event);
}

function emitVoteResults(voteId: string) {
  const session = voteSessions.get(voteId);
  if (!session) {
    return;
  }

  emitUnityEvent({
    sourceRole: "controller",
    receiverId: null,
    action: "voteResults",
    element: "vote:results",
    value: buildVoteExport(session),
    timestamp: new Date().toISOString(),
  });
}

function destroyPulseLoop(receiverId: string) {
  const loop = pulseLoops.get(receiverId);
  if (!loop) {
    return;
  }

  loop.stop();
  pulseLoops.delete(receiverId);
}

function closeVoteSession(
  voteId: string,
  reason: VoteCloseReason,
  clearConfig = false
) {
  const session = voteSessions.get(voteId);
  if (!session) {
    return new Set<string>();
  }

  clearVoteTimeout(session);
  session.isActive = false;
  session.closedAt = new Date().toISOString();
  session.closeReason = reason;

  const updatedReceiverIds = new Set<string>();

  session.targetReceiverIds.forEach(receiverId => {
    if (receiverActiveVotes.get(receiverId) === voteId) {
      receiverActiveVotes.delete(receiverId);
    }

    const state = receivers.get(receiverId);
    if (!state) {
      return;
    }

    const changed = clearConfig
      ? clearReceiverVote(state, voteId)
      : hideReceiverVote(state, voteId);
    if (!changed) {
      return;
    }

    incrementConfigVersion(state);
    updatedReceiverIds.add(receiverId);
  });

  return updatedReceiverIds;
}

function detachReceiversFromVoteSession(
  voteId: string,
  receiverIds: string[],
  clearConfig = true
) {
  const session = voteSessions.get(voteId);
  if (!session) {
    return new Set<string>();
  }

  const updatedReceiverIds = new Set<string>();
  const receiverIdSet = new Set(receiverIds);

  receiverIdSet.forEach(receiverId => {
    if (!session.targetReceiverIds.has(receiverId)) {
      return;
    }

    session.targetReceiverIds.delete(receiverId);
    session.submissions.delete(receiverId);

    if (receiverActiveVotes.get(receiverId) === voteId) {
      receiverActiveVotes.delete(receiverId);
    }

    const state = receivers.get(receiverId);
    if (!state) {
      return;
    }

    const changed = clearConfig
      ? clearReceiverVote(state, voteId)
      : hideReceiverVote(state, voteId);
    if (!changed) {
      return;
    }

    incrementConfigVersion(state);
    updatedReceiverIds.add(receiverId);
  });

  if (session.targetReceiverIds.size === 0) {
    clearVoteTimeout(session);
    voteSessions.delete(voteId);
  }

  return updatedReceiverIds;
}

function scheduleVoteAutoClose(voteId: string) {
  const session = voteSessions.get(voteId);
  if (!session) {
    return;
  }

  clearVoteTimeout(session);

  if (!session.isActive || session.visibilityDuration <= 0) {
    session.closesAt = null;
    return;
  }

  const waitMs = session.visibilityDuration * 1000;
  session.closesAt = new Date(Date.now() + waitMs).toISOString();
  session.timeoutId = setTimeout(() => {
    const updatedReceiverIds = closeVoteSession(voteId, "timeout");
    updatedReceiverIds.forEach(receiverId => {
      const state = receivers.get(receiverId);
      if (state) {
        emitReceiverStateToRoom(receiverId, state);
      }
    });
    if (updatedReceiverIds.size > 0) {
      broadcastReceiverList();
    }
    emitVoteResults(voteId);
  }, waitMs);
}

function upsertVoteSession(vote: VoteConfig, receiverIds: string[]) {
  const existing = voteSessions.get(vote.voteId);
  const nowIso = new Date().toISOString();
  const nextReceiverIds = new Set(receiverIds);

  if (!existing || !existing.isActive) {
    voteSessions.set(vote.voteId, {
      voteId: vote.voteId,
      question: vote.question,
      options: structuredClone(vote.options),
      allowRevote: vote.allowRevote,
      visibilityDuration: vote.visibilityDuration,
      targetReceiverIds: nextReceiverIds,
      submissions: new Map(),
      openedAt: nowIso,
      closesAt: null,
      closedAt: null,
      closeReason: null,
      isActive: vote.visible,
      timeoutId: null,
    });
    if (vote.visible) {
      scheduleVoteAutoClose(vote.voteId);
    }
    return;
  }

  existing.question = vote.question;
  existing.options = structuredClone(vote.options);
  existing.allowRevote = vote.allowRevote;
  existing.visibilityDuration = vote.visibilityDuration;
  existing.targetReceiverIds = nextReceiverIds;
  existing.isActive = vote.visible;
  existing.closedAt = null;
  existing.closeReason = null;

  Array.from(existing.submissions.entries()).forEach(([receiverId, submission]) => {
    if (
      !existing.targetReceiverIds.has(receiverId) ||
      !existing.options.some(option => option.id === submission.selectedOptionId)
    ) {
      existing.submissions.delete(receiverId);
    }
  });

  if (vote.visible) {
    scheduleVoteAutoClose(vote.voteId);
    return;
  }

  clearVoteTimeout(existing);
  existing.closesAt = null;
}

function dropReceiverFromVoteSessions(receiverId: string) {
  const activeVoteId = receiverActiveVotes.get(receiverId);
  if (activeVoteId) {
    receiverActiveVotes.delete(receiverId);
  }

  voteSessions.forEach((session, voteId) => {
    session.targetReceiverIds.delete(receiverId);
    session.submissions.delete(receiverId);

    if (session.targetReceiverIds.size === 0) {
      clearVoteTimeout(session);
      voteSessions.delete(voteId);
    }
  });
}

function shouldPulseRun(state: InternalReceiverState) {
  return (
    state.connected && state.config.pulse.enabled && state.config.pulse.active
  );
}

function syncPulseLoop(receiverId: string, state: InternalReceiverState) {
  if (!io || !shouldPulseRun(state)) {
    destroyPulseLoop(receiverId);
    return;
  }

  const existingLoop = pulseLoops.get(receiverId);
  if (existingLoop) {
    existingLoop.updateBpm(state.config.pulse.bpm);
    existingLoop.start();
    return;
  }

  const loop = createPulseScheduler({
    receiverId,
    bpm: state.config.pulse.bpm,
    onPulse: event => {
      io?.to(`receiver:${receiverId}`).emit(WS_EVENTS.PULSE, event);
    },
  });

  pulseLoops.set(receiverId, loop);
  loop.start();
}

function canSendControlCommands(socket: Socket, input: ControlInputMessage) {
  if (controllers.has(socket.id) || unities.has(socket.id)) {
    return true;
  }

  if (
    socket.data.role !== "receiver" ||
    typeof socket.data.receiverId !== "string"
  ) {
    return false;
  }

  const command = normalizeCommand(input);
  return (
    command.command === "set_track_state" &&
    command.targetId === socket.data.receiverId
  );
}

function isUnifiedCommand(input: ControlInputMessage): input is UnifiedCommand {
  return "command" in input;
}

function normalizeCommand(input: ControlInputMessage): UnifiedCommand {
  return isUnifiedCommand(input)
    ? input
    : legacyControlMessageToUnifiedCommand(input);
}

function incrementConfigVersion(state: InternalReceiverState) {
  state.configVersion += 1;
}

function getTrack(
  state: InternalReceiverState,
  trackId: string
): TrackState | undefined {
  return state.config.tracks.find(track => track.trackId === trackId);
}

function createTrackFromPatch(
  trackId: string,
  patch: Partial<TrackState>
): TrackState {
  return {
    trackId,
    label: typeof patch.label === "string" ? patch.label : trackId,
    url: typeof patch.url === "string" ? patch.url : "",
    visible: typeof patch.visible === "boolean" ? patch.visible : true,
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : true,
    playing: typeof patch.playing === "boolean" ? patch.playing : false,
    playable: typeof patch.playable === "boolean" ? patch.playable : true,
    loopEnabled:
      typeof patch.loopEnabled === "boolean" ? patch.loopEnabled : false,
    loopControlVisible:
      typeof patch.loopControlVisible === "boolean"
        ? patch.loopControlVisible
        : true,
    loopControlLocked:
      typeof patch.loopControlLocked === "boolean"
        ? patch.loopControlLocked
        : false,
    volumeValue:
      typeof patch.volumeValue === "number"
        ? clampVolumeValue(patch.volumeValue)
        : 1,
    volumeControlVisible:
      typeof patch.volumeControlVisible === "boolean"
        ? patch.volumeControlVisible
        : false,
    volumeControlEnabled:
      typeof patch.volumeControlEnabled === "boolean"
        ? patch.volumeControlEnabled
        : true,
    tempoFlashEnabled:
      typeof patch.tempoFlashEnabled === "boolean"
        ? patch.tempoFlashEnabled
        : false,
    fillTime: typeof patch.fillTime === "number" ? patch.fillTime : 1,
    groupId:
      typeof patch.groupId === "string" || patch.groupId === null
        ? patch.groupId
        : null,
  };
}

function removeTrackFromAllGroups(
  state: InternalReceiverState,
  trackId: string,
  exceptGroupId?: string | null
) {
  state.config.groups.forEach(group => {
    if (group.groupId === exceptGroupId) {
      return;
    }

    group.trackIds = group.trackIds.filter(candidate => candidate !== trackId);
  });
}

function syncTrackGroupMembership(
  state: InternalReceiverState,
  track: TrackState
) {
  removeTrackFromAllGroups(state, track.trackId, track.groupId);

  if (!track.groupId) {
    return;
  }

  const group = state.config.groups.find(
    candidate => candidate.groupId === track.groupId
  );
  if (!group) {
    track.groupId = null;
    return;
  }

  if (!group.trackIds.includes(track.trackId)) {
    group.trackIds.push(track.trackId);
  }
}

function syncGroupTrackMembership(
  state: InternalReceiverState,
  groupId: string,
  trackIds: string[]
) {
  const nextTrackIds = Array.from(
    new Set(
      trackIds.filter(trackId =>
        state.config.tracks.some(track => track.trackId === trackId)
      )
    )
  );

  const group = state.config.groups.find(
    candidate => candidate.groupId === groupId
  );
  if (!group) {
    return;
  }

  group.trackIds = nextTrackIds;
  const trackIdSet = new Set(nextTrackIds);

  state.config.tracks.forEach(track => {
    if (trackIdSet.has(track.trackId)) {
      track.groupId = groupId;
      removeTrackFromAllGroups(state, track.trackId, groupId);
      return;
    }

    if (track.groupId === groupId) {
      track.groupId = null;
    }
  });
}

function applyTrackPatch(
  state: InternalReceiverState,
  payload: SetTrackStatePayload
) {
  const existing = getTrack(state, payload.trackId);
  if (existing) {
    const { trackId: _ignoredTrackId, ...patch } = payload.patch;
    Object.assign(existing, patch);
    if (existing.playable === false) {
      existing.playing = false;
    }
    existing.volumeValue = clampVolumeValue(existing.volumeValue);
    existing.fillTime = Math.max(0, existing.fillTime);
    if ("groupId" in payload.patch) {
      syncTrackGroupMembership(state, existing);
    }
    return true;
  }

  const nextTrack = createTrackFromPatch(payload.trackId, payload.patch);
  state.config.tracks.push(nextTrack);
  syncTrackGroupMembership(state, nextTrack);
  return true;
}

function removeTrack(
  state: InternalReceiverState,
  payload: RemoveTrackPayload
) {
  const nextTracks = state.config.tracks.filter(
    track => track.trackId !== payload.trackId
  );

  if (nextTracks.length === state.config.tracks.length) {
    return false;
  }

  state.config.tracks = nextTracks;
  state.config.groups.forEach(group => {
    group.trackIds = group.trackIds.filter(
      trackId => trackId !== payload.trackId
    );
  });
  return true;
}

function removeGroup(
  state: InternalReceiverState,
  payload: RemoveGroupPayload
) {
  const existing = state.config.groups.find(
    group => group.groupId === payload.groupId
  );
  if (!existing) {
    return false;
  }

  state.config.groups = state.config.groups.filter(
    group => group.groupId !== payload.groupId
  );
  state.config.tracks.forEach(track => {
    if (track.groupId === payload.groupId) {
      track.groupId = null;
    }
  });
  return true;
}

function applyGroupPatch(
  state: InternalReceiverState,
  payload: SetGroupStatePayload
) {
  const existing = state.config.groups.find(
    group => group.groupId === payload.groupId
  );

  if (existing) {
    const { groupId: _ignoredGroupId, ...patch } = payload.patch;
    Object.assign(existing, patch);
    if (Array.isArray(payload.patch.trackIds)) {
      syncGroupTrackMembership(state, existing.groupId, payload.patch.trackIds);
    }
    return true;
  }

  const nextGroup: GroupState = {
    groupId: payload.groupId,
    label:
      typeof payload.patch.label === "string"
        ? payload.patch.label
        : payload.groupId,
    color:
      typeof payload.patch.color === "string" ? payload.patch.color : "#ffffff",
    visible:
      typeof payload.patch.visible === "boolean" ? payload.patch.visible : true,
    enabled:
      typeof payload.patch.enabled === "boolean" ? payload.patch.enabled : true,
    trackIds: Array.isArray(payload.patch.trackIds)
      ? payload.patch.trackIds.filter(
          (trackId): trackId is string => typeof trackId === "string"
        )
      : [],
  };

  state.config.groups.push(nextGroup);
  if (nextGroup.trackIds.length > 0) {
    syncGroupTrackMembership(state, nextGroup.groupId, nextGroup.trackIds);
  }
  return true;
}

function assignModulePatch<T extends ModuleName>(
  state: InternalReceiverState,
  module: T,
  patch: SetModuleStatePayload["patch"]
) {
  Object.assign(state.config[module], patch);
  return true;
}

function resolveFiniteNumber(
  primary: unknown,
  fallbackPrimary: unknown,
  previousValue: number
) {
  if (typeof primary === "number" && Number.isFinite(primary)) {
    return primary;
  }

  if (typeof fallbackPrimary === "number" && Number.isFinite(fallbackPrimary)) {
    return fallbackPrimary;
  }

  return previousValue;
}

function assignScorePatch(
  state: InternalReceiverState,
  patch: SetModuleStatePayload["patch"]
) {
  if (typeof patch.visible === "boolean") {
    state.config.score.visible = patch.visible;
  } else if (typeof patch.scoreVisible === "boolean") {
    state.config.score.visible = patch.scoreVisible;
  }

  if (typeof patch.enabled === "boolean") {
    state.config.score.enabled = patch.enabled;
  } else if (typeof patch.scoreEnabled === "boolean") {
    state.config.score.enabled = patch.scoreEnabled;
  }

  state.config.score.value = resolveFiniteNumber(
    patch.value,
    patch.scoreValue,
    state.config.score.value
  );

  return true;
}

function assignMapPatch(
  state: InternalReceiverState,
  patch: SetModuleStatePayload["patch"]
) {
  if (typeof patch.visible === "boolean") {
    state.config.map.visible = patch.visible;
  } else if (typeof patch.mapVisible === "boolean") {
    state.config.map.visible = patch.mapVisible;
  }

  if (typeof patch.enabled === "boolean") {
    state.config.map.enabled = patch.enabled;
  } else if (typeof patch.mapEnabled === "boolean") {
    state.config.map.enabled = patch.mapEnabled;
  }

  state.config.map.playerPosX = clampNormalizedCoordinate(
    resolveFiniteNumber(
      patch.playerPosX,
      patch.x,
      state.config.map.playerPosX
    ),
    state.config.map.playerPosX
  );
  state.config.map.playerPosY = clampNormalizedCoordinate(
    resolveFiniteNumber(
      patch.playerPosY,
      patch.y,
      state.config.map.playerPosY
    ),
    state.config.map.playerPosY
  );

  return true;
}

function assignPulsePatch(
  state: InternalReceiverState,
  patch: SetModuleStatePayload["patch"]
) {
  if (typeof patch.visible === "boolean") {
    state.config.pulse.visible = patch.visible;
  }

  if (typeof patch.enabled === "boolean") {
    state.config.pulse.enabled = patch.enabled;
  }

  if (typeof patch.active === "boolean") {
    state.config.pulse.active = patch.active;
  }

  if (typeof patch.bpm === "number") {
    state.config.pulse.bpm = clampPulseBpm(patch.bpm, state.config.pulse.bpm);
  }

  return true;
}

function stopAllTracks(state: InternalReceiverState) {
  state.config.tracks.forEach(track => {
    track.playing = false;
  });
}

function applyCommand(
  state: InternalReceiverState,
  command: UnifiedCommand
): boolean {
  switch (command.command) {
    case "set_track_state":
      return applyTrackPatch(state, command.payload);
    case "remove_track":
      return removeTrack(state, command.payload);
    case "remove_group":
      return removeGroup(state, command.payload);
    case "set_group_state":
      return applyGroupPatch(state, command.payload);
    case "set_module_state":
      if (command.payload.module === "visuals") {
        return assignModulePatch(state, "visuals", command.payload.patch);
      }
      if (command.payload.module === "textDisplay") {
        return assignModulePatch(state, "textDisplay", command.payload.patch);
      }
      if (command.payload.module === "pulse") {
        return assignPulsePatch(state, command.payload.patch);
      }
      if (command.payload.module === "score") {
        return assignScorePatch(state, command.payload.patch);
      }
      if (command.payload.module === "map") {
        return assignMapPatch(state, command.payload.patch);
      }
      if (command.payload.module === "timing") {
        return assignModulePatch(state, "timing", command.payload.patch);
      }
      return false;
    case "set_vote_state":
      return applyVoteState(state, command.payload.vote);
    case "vote_reset_all":
      return resetReceiverVoteSelection(state);
    case "score_reset":
      if (state.config.score.value === 0) {
        return false;
      }

      state.config.score.value = 0;
      return true;
    case "reset_all_state":
      state.config = createDefaultReceiverConfig();
      return true;
  }
}

function broadcastReceiverList() {
  if (!io) {
    return;
  }

  const list = getReceiverList();
  controllers.forEach(controllerId => {
    io!.to(controllerId).emit(WS_EVENTS.RECEIVER_LIST, {
      receivers: list,
    });
  });
}

export function getReceiverList(): ReceiverState[] {
  return Array.from(receivers.values()).map(state =>
    serializeReceiverState(state)
  );
}

export function getConfigSnapshot() {
  return {
    ok: true as const,
    configTtlMs: CONFIG_TTL_MS,
    receivers: getReceiverList(),
  };
}

export function getVoteExports() {
  return Array.from(voteSessions.values())
    .sort(
      (left, right) =>
        new Date(right.openedAt).getTime() - new Date(left.openedAt).getTime()
    )
    .map(buildVoteExport);
}

function removeDisconnectedReceivers(): string[] {
  const removedIds: string[] = [];

  receivers.forEach((state, receiverId) => {
    if (!state.connected) {
      destroyPulseLoop(receiverId);
      dropReceiverFromVoteSessions(receiverId);
      receivers.delete(receiverId);
      removedIds.push(receiverId);
    }
  });

  return removedIds;
}

function removeExpiredReceivers(now = Date.now()): string[] {
  const removedIds: string[] = [];

  receivers.forEach((state, receiverId) => {
    if (
      state.disconnectedAt !== null &&
      now - state.disconnectedAt >= RECEIVER_RETENTION_MS
    ) {
      destroyPulseLoop(receiverId);
      dropReceiverFromVoteSessions(receiverId);
      receivers.delete(receiverId);
      removedIds.push(receiverId);
    }
  });

  return removedIds;
}

function publishReceiverUpdates(receiverIds: Iterable<string>) {
  const updatedReceiverIds = Array.from(new Set(receiverIds));
  updatedReceiverIds.forEach(receiverId => {
    const state = receivers.get(receiverId);
    if (state) {
      emitReceiverStateToRoom(receiverId, state);
    }
  });

  if (updatedReceiverIds.length > 0) {
    broadcastReceiverList();
  }
}

function applyVoteCommandEffects(
  command: UnifiedCommand,
  deliveredReceiverIds: string[]
) {
  const updatedReceiverIds = new Set<string>();
  const votesToEmit = new Set<string>();

  if (command.command === "set_vote_state") {
    const vote = command.payload.vote;

    if (!vote || !vote.visible) {
      const voteId = vote?.voteId;
      const groupedReceiverIds = new Map<string, string[]>();

      deliveredReceiverIds.forEach(receiverId => {
        const activeVoteId =
          voteId ??
          receivers.get(receiverId)?.config.vote?.voteId ??
          receiverActiveVotes.get(receiverId);
        if (!activeVoteId) {
          return;
        }

        const current = groupedReceiverIds.get(activeVoteId) ?? [];
        current.push(receiverId);
        groupedReceiverIds.set(activeVoteId, current);
      });

      groupedReceiverIds.forEach((receiverIds, activeVoteId) => {
        const session = voteSessions.get(activeVoteId);
        if (!session) {
          return;
        }

        if (receiverIds.length === session.targetReceiverIds.size) {
          closeVoteSession(
            activeVoteId,
            "manual_close",
            command.payload.vote === null
          ).forEach(receiverId => updatedReceiverIds.add(receiverId));
          votesToEmit.add(activeVoteId);
          return;
        }

        detachReceiversFromVoteSession(
          activeVoteId,
          receiverIds,
          command.payload.vote === null
        ).forEach(receiverId => updatedReceiverIds.add(receiverId));
      });

      return { updatedReceiverIds, votesToEmit };
    }

    const replacedGroups = new Map<string, string[]>();
    deliveredReceiverIds.forEach(receiverId => {
      const previousVoteId = receiverActiveVotes.get(receiverId);
      if (!previousVoteId || previousVoteId === vote.voteId) {
        return;
      }

      const current = replacedGroups.get(previousVoteId) ?? [];
      current.push(receiverId);
      replacedGroups.set(previousVoteId, current);
    });

    replacedGroups.forEach((receiverIds, previousVoteId) => {
      const session = voteSessions.get(previousVoteId);
      if (!session) {
        return;
      }

      if (receiverIds.length === session.targetReceiverIds.size) {
        closeVoteSession(previousVoteId, "replaced", true).forEach(receiverId =>
          updatedReceiverIds.add(receiverId)
        );
        votesToEmit.add(previousVoteId);
        return;
      }

      detachReceiversFromVoteSession(previousVoteId, receiverIds, true).forEach(
        receiverId => updatedReceiverIds.add(receiverId)
      );
    });

    deliveredReceiverIds.forEach(receiverId => {
      receiverActiveVotes.set(receiverId, vote.voteId);
    });
    upsertVoteSession(vote, deliveredReceiverIds);

    return { updatedReceiverIds, votesToEmit };
  }

  if (command.command === "vote_reset_all") {
    deliveredReceiverIds.forEach(receiverId => {
      voteSessions.forEach(session => {
        session.submissions.delete(receiverId);
      });

      const state = receivers.get(receiverId);
      if (!state) {
        return;
      }

      if (resetReceiverVoteSelection(state)) {
        updatedReceiverIds.add(receiverId);
      }
    });

    voteSessions.forEach(session => {
      if (!session.isActive && session.submissions.size === 0) {
        session.closeReason = "reset";
      }
    });

    return { updatedReceiverIds, votesToEmit };
  }

  if (command.command === "reset_all_state") {
    deliveredReceiverIds.forEach(receiverId => {
      const activeVoteId = receiverActiveVotes.get(receiverId);
      if (!activeVoteId) {
        voteSessions.forEach(session => {
          session.targetReceiverIds.delete(receiverId);
          session.submissions.delete(receiverId);
        });
        return;
      }

      const session = voteSessions.get(activeVoteId);
      if (!session) {
        receiverActiveVotes.delete(receiverId);
        return;
      }

      if (session.targetReceiverIds.size === 1) {
        closeVoteSession(activeVoteId, "reset", true).forEach(id =>
          updatedReceiverIds.add(id)
        );
        votesToEmit.add(activeVoteId);
        return;
      }

      detachReceiversFromVoteSession(activeVoteId, [receiverId], true).forEach(
        id => updatedReceiverIds.add(id)
      );
    });

    return { updatedReceiverIds, votesToEmit };
  }

  return { updatedReceiverIds, votesToEmit };
}

function submitVote(socket: Socket, payload: SubmitVotePayload) {
  if (
    socket.data.role !== "receiver" ||
    typeof socket.data.receiverId !== "string"
  ) {
    console.warn(`[WS] Ignored vote submission from ${socket.id}`);
    return;
  }

  const receiverId = socket.data.receiverId;
  const state = receivers.get(receiverId);
  if (!state || !state.config.vote) {
    return;
  }

  const vote = state.config.vote;
  if (
    !vote.visible ||
    !vote.enabled ||
    vote.voteId !== payload.voteId ||
    !vote.options.some(option => option.id === payload.selectedOptionId)
  ) {
    return;
  }

  if (!vote.allowRevote && vote.selectedOptionId !== null) {
    return;
  }

  const session = voteSessions.get(payload.voteId);
  if (!session || !session.isActive || !session.targetReceiverIds.has(receiverId)) {
    return;
  }

  const submittedAt = new Date().toISOString();
  state.config.vote.selectedOptionId = payload.selectedOptionId;
  state.config.vote.submittedAt = submittedAt;
  session.submissions.set(receiverId, {
    receiverId,
    voteId: payload.voteId,
    selectedOptionId: payload.selectedOptionId,
    submittedAt,
  });

  incrementConfigVersion(state);
  emitReceiverStateToRoom(receiverId, state);
  broadcastReceiverList();
}

function forwardInteractionEvent(socket: Socket, event: UnityInteractionEvent) {
  if (!io) {
    return;
  }

  const sourceRole =
    socket.data.role === "controller" || socket.data.role === "receiver"
      ? socket.data.role
      : null;

  if (!sourceRole) {
    console.warn(
      `[WS] Ignored interaction event from unauthorised ${socket.id}`
    );
    return;
  }

  const receiverId =
    sourceRole === "receiver"
      ? typeof socket.data.receiverId === "string"
        ? socket.data.receiverId
        : null
      : (event.receiverId ?? null);

  emitUnityEvent({
    ...event,
    sourceRole,
    receiverId,
    timestamp:
      typeof event.timestamp === "string" && event.timestamp.trim()
        ? event.timestamp
        : new Date().toISOString(),
  } satisfies UnityInteractionEvent);
}

function registerReceiver(socket: Socket, data: ReceiverRegistration) {
  const receiverId = data.receiverId.trim();
  const label = data.label?.trim();

  if (!receiverId || receiverId === "*") {
    console.warn(`[WS] Rejected invalid receiver ID from ${socket.id}`);
    return;
  }

  socket.data.role = "receiver";
  socket.data.receiverId = receiverId;

  const displayLabel = label || `Receiver ${receiverId}`;
  const existing = receivers.get(receiverId);

  if (existing) {
    existing.socketId = socket.id;
    existing.connected = true;
    existing.disconnectedAt = null;
    existing.label = displayLabel;
  } else {
    receivers.set(
      receiverId,
      createDefaultState(receiverId, displayLabel, socket.id)
    );
  }

  socket.join(`receiver:${receiverId}`);
  syncPulseLoop(receiverId, receivers.get(receiverId)!);
  emitReceiverState(socket, receivers.get(receiverId)!);
  broadcastReceiverList();
}

function handleDisconnect(socket: Socket) {
  controllers.delete(socket.id);
  unities.delete(socket.id);

  receivers.forEach(state => {
    if (state.socketId === socket.id) {
      state.connected = false;
      state.disconnectedAt = Date.now();
      stopAllTracks(state);
      incrementConfigVersion(state);
      syncPulseLoop(state.receiverId, state);
    }
  });

  broadcastReceiverList();
}

export function initWebSocket(httpServer: HttpServer): Server {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
  }

  io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
    pingInterval: 10_000,
    pingTimeout: 5_000,
  });

  io.on(WS_EVENTS.CONNECTION, (socket: Socket) => {
    console.log(`[WS] Client connected: ${socket.id}`);

    socket.on(WS_EVENTS.REGISTER_CONTROLLER, () => {
      socket.data.role = "controller";
      controllers.add(socket.id);
      socket.emit(WS_EVENTS.RECEIVER_LIST, { receivers: getReceiverList() });
    });

    socket.on(WS_EVENTS.REGISTER_UNITY, () => {
      socket.data.role = "unity";
      unities.add(socket.id);
      socket.join("unity");
    });

    socket.on(WS_EVENTS.REGISTER_RECEIVER, (data: ReceiverRegistration) => {
      registerReceiver(socket, data);
    });

    socket.on(WS_EVENTS.REQUEST_RECEIVER_STATE, () => {
      if (socket.data.role !== "receiver") {
        return;
      }

      const receiverId =
        typeof socket.data.receiverId === "string"
          ? socket.data.receiverId
          : null;
      if (!receiverId) {
        return;
      }

      const state = receivers.get(receiverId);
      if (state) {
        emitReceiverState(socket, state);
      }
    });

    socket.on(WS_EVENTS.CONTROL_MESSAGE, (input: ControlInputMessage) => {
      if (!canSendControlCommands(socket, input)) {
        console.warn(`[WS] Ignored control message from ${socket.id}`);
        return;
      }

      dispatchControlMessage(input);
    });

    socket.on(WS_EVENTS.SUBMIT_VOTE, (payload: SubmitVotePayload) => {
      submitVote(socket, payload);
    });

    socket.on(WS_EVENTS.CLEAR_OFFLINE_RECEIVERS, () => {
      if (!controllers.has(socket.id)) {
        console.warn(`[WS] Ignored offline cleanup from ${socket.id}`);
        return;
      }

      clearOfflineReceivers();
    });

    socket.on(WS_EVENTS.INTERACTION_EVENT, (event: UnityInteractionEvent) => {
      forwardInteractionEvent(socket, event);
    });

    socket.on(WS_EVENTS.DISCONNECT, () => {
      console.log(`[WS] Client disconnected: ${socket.id}`);
      handleDisconnect(socket);
    });
  });

  cleanupInterval = setInterval(() => {
    const removedIds = removeExpiredReceivers();
    if (removedIds.length > 0) {
      console.log(`[WS] Expired offline receivers: ${removedIds.join(", ")}`);
      broadcastReceiverList();
    }
  }, RECEIVER_CLEANUP_INTERVAL_MS);

  console.log("[WS] Socket.IO server initialized");
  return io;
}

export interface DispatchControlResult {
  broadcast: boolean;
  deliveredReceiverIds: string[];
  missingTargetId: string | null;
  command: UnifiedCommand;
}

export function dispatchControlMessage(
  input: ControlInputMessage
): DispatchControlResult {
  if (!io) {
    throw new Error("Socket.IO server not initialized");
  }

  const command = normalizeCommand(input);

  if (command.targetId === "*") {
    const deliveredReceiverIds = Array.from(receivers.keys());

    deliveredReceiverIds.forEach(receiverId => {
      const state = receivers.get(receiverId);
      if (!state) {
        return;
      }

      if (applyCommand(state, command)) {
        incrementConfigVersion(state);
      }

      syncPulseLoop(receiverId, state);
      io!.to(`receiver:${receiverId}`).emit(WS_EVENTS.RECEIVER_COMMAND, command);
      emitReceiverStateToRoom(receiverId, state);
    });

    const { updatedReceiverIds, votesToEmit } = applyVoteCommandEffects(
      command,
      deliveredReceiverIds
    );
    publishReceiverUpdates(updatedReceiverIds);
    votesToEmit.forEach(voteId => emitVoteResults(voteId));
    broadcastReceiverList();
    return {
      broadcast: true,
      deliveredReceiverIds,
      missingTargetId: null,
      command,
    };
  }

  const state = receivers.get(command.targetId);
  if (!state) {
    console.warn(`[WS] Target receiver not found: ${command.targetId}`);
    return {
      broadcast: false,
      deliveredReceiverIds: [],
      missingTargetId: command.targetId,
      command,
    };
  }

  if (applyCommand(state, command)) {
    incrementConfigVersion(state);
  }

  syncPulseLoop(command.targetId, state);
  io.to(`receiver:${command.targetId}`).emit(
    WS_EVENTS.RECEIVER_COMMAND,
    command
  );
  emitReceiverStateToRoom(command.targetId, state);
  const { updatedReceiverIds, votesToEmit } = applyVoteCommandEffects(command, [
    command.targetId,
  ]);
  publishReceiverUpdates(updatedReceiverIds);
  votesToEmit.forEach(voteId => emitVoteResults(voteId));
  broadcastReceiverList();

  return {
    broadcast: false,
    deliveredReceiverIds: [command.targetId],
    missingTargetId: null,
    command,
  };
}

export function clearOfflineReceivers() {
  const removedReceiverIds = removeDisconnectedReceivers();

  if (removedReceiverIds.length > 0) {
    broadcastReceiverList();
  }

  return removedReceiverIds;
}

export async function resetWebSocketState() {
  controllers.clear();
  unities.clear();
  pulseLoops.forEach(loop => loop.stop());
  pulseLoops.clear();
  voteSessions.forEach(session => clearVoteTimeout(session));
  voteSessions.clear();
  receiverActiveVotes.clear();
  receivers.clear();

  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }

  if (io) {
    const activeIo = io;
    io = null;
    await new Promise<void>(resolve => {
      activeIo.close(() => resolve());
    });
  }
}
