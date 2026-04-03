import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import {
  CONFIG_TTL_MS,
  type ControlInputMessage,
  createDefaultReceiverConfig,
  type GroupState,
  legacyControlMessageToUnifiedCommand,
  type ModuleName,
  type ReceiverRegistration,
  type ReceiverState,
  type RemoveTrackPayload,
  type SetGroupStatePayload,
  type SetModuleStatePayload,
  type SetTrackStatePayload,
  type SetVoteStatePayload,
  type TrackState,
  type UnifiedCommand,
  type UnityInteractionEvent,
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

const RECEIVER_RETENTION_MS = 10 * 60 * 1000;
const RECEIVER_CLEANUP_INTERVAL_MS = 60 * 1000;

const receivers = new Map<string, InternalReceiverState>();
const controllers = new Set<string>();
const unities = new Set<string>();

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

function emitReceiverStateToRoom(receiverId: string, state: InternalReceiverState) {
  if (!io) {
    return;
  }

  io.to(`receiver:${receiverId}`).emit(
    WS_EVENTS.RECEIVER_STATE_UPDATE,
    serializeReceiverState(state)
  );
}

function canSendControlCommands(socketId: string) {
  return controllers.has(socketId) || unities.has(socketId);
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
  return state.config.tracks.find((track) => track.trackId === trackId);
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
      typeof patch.volumeValue === "number" ? patch.volumeValue : 1,
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

function applyTrackPatch(
  state: InternalReceiverState,
  payload: SetTrackStatePayload
) {
  const existing = getTrack(state, payload.trackId);
  if (existing) {
    Object.assign(existing, payload.patch);
    if (existing.playable === false) {
      existing.playing = false;
    }
    return true;
  }

  state.config.tracks.push(createTrackFromPatch(payload.trackId, payload.patch));
  return true;
}

function removeTrack(
  state: InternalReceiverState,
  payload: RemoveTrackPayload
) {
  const nextTracks = state.config.tracks.filter(
    (track) => track.trackId !== payload.trackId
  );

  if (nextTracks.length === state.config.tracks.length) {
    return false;
  }

  state.config.tracks = nextTracks;
  state.config.groups.forEach((group) => {
    group.trackIds = group.trackIds.filter((trackId) => trackId !== payload.trackId);
  });
  return true;
}

function applyGroupPatch(
  state: InternalReceiverState,
  payload: SetGroupStatePayload
) {
  const existing = state.config.groups.find(
    (group) => group.groupId === payload.groupId
  );

  if (existing) {
    Object.assign(existing, payload.patch);
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

function stopAllTracks(state: InternalReceiverState) {
  state.config.tracks.forEach((track) => {
    track.playing = false;
  });
}

function applyCommand(state: InternalReceiverState, command: UnifiedCommand): boolean {
  switch (command.command) {
    case "set_track_state":
      return applyTrackPatch(state, command.payload);
    case "remove_track":
      return removeTrack(state, command.payload);
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
        return assignModulePatch(state, "pulse", command.payload.patch);
      }
      if (command.payload.module === "score") {
        return assignModulePatch(state, "score", command.payload.patch);
      }
      if (command.payload.module === "map") {
        return assignModulePatch(state, "map", command.payload.patch);
      }
      if (command.payload.module === "timing") {
        return assignModulePatch(state, "timing", command.payload.patch);
      }
      return false;
    case "set_vote_state":
      state.config.vote = command.payload.vote
        ? structuredClone(command.payload.vote)
        : null;
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
  controllers.forEach((controllerId) => {
    io!.to(controllerId).emit(WS_EVENTS.RECEIVER_LIST, {
      receivers: list,
    });
  });
}

export function getReceiverList(): ReceiverState[] {
  return Array.from(receivers.values()).map((state) => serializeReceiverState(state));
}

export function getConfigSnapshot() {
  return {
    ok: true as const,
    configTtlMs: CONFIG_TTL_MS,
    receivers: getReceiverList(),
  };
}

function removeDisconnectedReceivers(): string[] {
  const removedIds: string[] = [];

  receivers.forEach((state, receiverId) => {
    if (!state.connected) {
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
      receivers.delete(receiverId);
      removedIds.push(receiverId);
    }
  });

  return removedIds;
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
    console.warn(`[WS] Ignored interaction event from unauthorised ${socket.id}`);
    return;
  }

  const receiverId =
    sourceRole === "receiver"
      ? typeof socket.data.receiverId === "string"
        ? socket.data.receiverId
        : null
      : event.receiverId ?? null;

  io.to("unity").emit(WS_EVENTS.INTERACTION_EVENT, {
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
    receivers.set(receiverId, createDefaultState(receiverId, displayLabel, socket.id));
  }

  socket.join(`receiver:${receiverId}`);
  emitReceiverState(socket, receivers.get(receiverId)!);
  broadcastReceiverList();
}

function handleDisconnect(socket: Socket) {
  controllers.delete(socket.id);
  unities.delete(socket.id);

  receivers.forEach((state) => {
    if (state.socketId === socket.id) {
      state.connected = false;
      state.disconnectedAt = Date.now();
      stopAllTracks(state);
      incrementConfigVersion(state);
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
        typeof socket.data.receiverId === "string" ? socket.data.receiverId : null;
      if (!receiverId) {
        return;
      }

      const state = receivers.get(receiverId);
      if (state) {
        emitReceiverState(socket, state);
      }
    });

    socket.on(WS_EVENTS.CONTROL_MESSAGE, (input: ControlInputMessage) => {
      if (!canSendControlCommands(socket.id)) {
        console.warn(`[WS] Ignored control message from ${socket.id}`);
        return;
      }

      dispatchControlMessage(input);
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
    const deliveredReceiverIds = Array.from(receivers.entries()).map(
      ([receiverId, state]) => {
        if (applyCommand(state, command)) {
          incrementConfigVersion(state);
        }

        io!.to(`receiver:${receiverId}`).emit(WS_EVENTS.RECEIVER_COMMAND, command);
        emitReceiverStateToRoom(receiverId, state);
        return receiverId;
      }
    );

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

  io.to(`receiver:${command.targetId}`).emit(WS_EVENTS.RECEIVER_COMMAND, command);
  emitReceiverStateToRoom(command.targetId, state);
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
  receivers.clear();

  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }

  if (io) {
    const activeIo = io;
    io = null;
    await new Promise<void>((resolve) => {
      activeIo.close(() => resolve());
    });
  }
}
