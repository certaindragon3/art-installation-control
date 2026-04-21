import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { clampVolumeValue } from "../shared/audio";
import {
  clampPulseBpm,
  createPulseScheduler,
  type PulseScheduler,
} from "./pulseScheduler";
import {
  advanceEconomyInflation,
  assignColorChallengeRound,
  calculateTrackCost,
  clamp01,
  clampTimingTolerance,
  clampNormalizedCoordinate,
  CONFIG_TTL_MS,
  createColorChallengeRound,
  createDefaultColorChallengeConfig,
  evaluateColorChallengeRound,
  type ControlInputMessage,
  type ColorChallengeColor,
  type ColorChallengeEventExport,
  type ColorChallengeExport,
  type ColorChallengeResult,
  type ColorChallengeRoundSnapshot,
  createDefaultEconomyConfig,
  createDefaultReceiverConfig,
  type GroupState,
  hasValidColorChallengeRound,
  type MapMovementConfig,
  legacyControlMessageToUnifiedCommand,
  type ModuleName,
  type ReceiverRegistration,
  type ReceiverState,
  type RemoveGroupPayload,
  type RemoveTrackPayload,
  type RequestTrackPlayPayload,
  type RequestTrackStopPayload,
  type SetGroupStatePayload,
  type SetModuleStatePayload,
  type SetTrackStatePayload,
  type SetVisibleTracksPayload,
  type SubmitColorChallengeChoicePayload,
  type SubmitVotePayload,
  type TimingEventExport,
  type TimingExport,
  type TimingInteractionValue,
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
  clientInstanceId: string;
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
const DEFAULT_MAP_MOVEMENT_DURATION_MS = 20_000;
const MIN_MAP_MOVEMENT_DURATION_MS = 100;
const MAX_MAP_MOVEMENT_DURATION_MS = 10 * 60 * 1000;
const MIN_COLOR_CHALLENGE_INTERVAL_MS = 250;
const MAX_COLOR_CHALLENGE_INTERVAL_MS = 10 * 60 * 1000;
const MANUAL_TRACK_CATEGORY_ID = "manual";
const MANUAL_TRACK_CATEGORY_COLOR = "#64748b";

const receivers = new Map<string, InternalReceiverState>();
const controllers = new Set<string>();
const unities = new Set<string>();
const pulseLoops = new Map<string, PulseScheduler>();
const economyPlayTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const colorChallengeTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const voteSessions = new Map<string, VoteSession>();
const receiverActiveVotes = new Map<string, string>();
const timingEvents: TimingEventExport[] = [];
const colorChallengeEvents: ColorChallengeEventExport[] = [];

let io: Server | null = null;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function createDefaultState(
  receiverId: string,
  label: string,
  socketId: string,
  clientInstanceId: string
): InternalReceiverState {
  return {
    receiverId,
    label,
    socketId,
    clientInstanceId,
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
  advanceEconomy(state, now);
  scheduleEconomyPlayTimeout(state.receiverId, state);

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

function receiverRoom(receiverId: string) {
  return `receiver:${receiverId}`;
}

function parseIsoMs(value: string | null, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNonNegativeNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : fallback;
}

function clearEconomyPlayTimeout(receiverId: string) {
  const timeout = economyPlayTimeouts.get(receiverId);
  if (!timeout) {
    return;
  }

  clearTimeout(timeout);
  economyPlayTimeouts.delete(receiverId);
}

function scheduleEconomyPlayTimeout(
  receiverId: string,
  state: InternalReceiverState
) {
  clearEconomyPlayTimeout(receiverId);

  const endsAtMs = parseIsoMs(state.config.economy.playEndsAt, NaN);
  if (
    !state.connected ||
    !state.config.economy.currentTrackId ||
    !Number.isFinite(endsAtMs)
  ) {
    return;
  }

  const waitMs = Math.max(0, endsAtMs - Date.now());
  const timeout = setTimeout(() => {
    const currentState = receivers.get(receiverId);
    if (!currentState) {
      clearEconomyPlayTimeout(receiverId);
      return;
    }

    if (advanceEconomy(currentState)) {
      incrementConfigVersion(currentState);
      emitReceiverStateToRoom(receiverId, currentState);
      broadcastReceiverList();
    }

    scheduleEconomyPlayTimeout(receiverId, currentState);
  }, waitMs);
  economyPlayTimeouts.set(receiverId, timeout);
}

function clearColorChallengeTimeout(receiverId: string) {
  const timeout = colorChallengeTimeouts.get(receiverId);
  if (!timeout) {
    return;
  }

  clearTimeout(timeout);
  colorChallengeTimeouts.delete(receiverId);
}

function isColorChallengeRunning(state: InternalReceiverState) {
  const challenge = state.config.colorChallenge;
  return (
    state.connected &&
    challenge.visible &&
    challenge.enabled &&
    !challenge.gameOver &&
    Boolean(challenge.iterationStartedAt) &&
    challenge.iterationDurationMs > 0
  );
}

function scheduleColorChallengeTimeout(
  receiverId: string,
  state: InternalReceiverState
) {
  clearColorChallengeTimeout(receiverId);

  if (!isColorChallengeRunning(state)) {
    return;
  }

  const challenge = state.config.colorChallenge;
  const startedAtMs = parseIsoMs(challenge.iterationStartedAt, NaN);
  if (!Number.isFinite(startedAtMs)) {
    return;
  }

  const waitMs = Math.max(
    0,
    startedAtMs + challenge.iterationDurationMs - Date.now()
  );
  const timeout = setTimeout(() => {
    const currentState = receivers.get(receiverId);
    if (!currentState) {
      clearColorChallengeTimeout(receiverId);
      return;
    }

    if (resolveColorChallengeMiss(currentState)) {
      incrementConfigVersion(currentState);
      emitReceiverStateToRoom(receiverId, currentState);
      broadcastReceiverList();
    }

    scheduleColorChallengeTimeout(receiverId, currentState);
  }, waitMs);
  colorChallengeTimeouts.set(receiverId, timeout);
}

function normalizeColorChallengeColor(
  value: unknown,
  fallbackIndex: number
): ColorChallengeColor | null {
  if (typeof value === "string") {
    const label = value.trim();
    if (!label) {
      return null;
    }

    const colorId = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return {
      colorId: colorId || `color_${fallbackIndex + 1}`,
      label,
      color: "#ffffff",
    };
  }

  if (!isRecord(value)) {
    return null;
  }

  const rawId =
    typeof value.colorId === "string"
      ? value.colorId
      : typeof value.id === "string"
        ? value.id
        : "";
  const rawLabel =
    typeof value.label === "string"
      ? value.label
      : typeof value.name === "string"
        ? value.name
        : rawId;
  const colorId = rawId.trim() || `color_${fallbackIndex + 1}`;
  const label = rawLabel.trim() || colorId;
  const color =
    typeof value.color === "string" && value.color.trim()
      ? value.color.trim()
      : "#ffffff";

  return { colorId, label, color };
}

function normalizeColorChallengePalette(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  const seen = new Set<string>();
  const palette: ColorChallengeColor[] = [];

  value.forEach((item, index) => {
    const color = normalizeColorChallengeColor(item, index);
    if (!color || seen.has(color.colorId)) {
      return;
    }

    seen.add(color.colorId);
    palette.push(color);
  });

  return palette.length >= 2 ? palette : null;
}

function clampColorChallengeInterval(value: unknown, fallback: number) {
  if (!hasFiniteNumber(value)) {
    return fallback;
  }

  return Math.min(
    MAX_COLOR_CHALLENGE_INTERVAL_MS,
    Math.max(MIN_COLOR_CHALLENGE_INTERVAL_MS, Math.round(value))
  );
}

function normalizeColorChallengeIntervals(
  minIntervalMs: number,
  maxIntervalMs: number
) {
  const minMs = clampColorChallengeInterval(
    minIntervalMs,
    createDefaultColorChallengeConfig().minIntervalMs
  );
  const maxMs = clampColorChallengeInterval(maxIntervalMs, minMs);

  return maxMs < minMs
    ? { minIntervalMs: maxMs, maxIntervalMs: minMs }
    : { minIntervalMs: minMs, maxIntervalMs: maxMs };
}

function startColorChallengeRound(
  state: InternalReceiverState,
  now = Date.now()
) {
  const challenge = state.config.colorChallenge;
  if (challenge.palette.length < 2) {
    challenge.palette = createDefaultColorChallengeConfig().palette;
  }

  assignColorChallengeRound(
    challenge,
    createColorChallengeRound(challenge, new Date(now).toISOString())
  );
}

function normalizeColorChallengeRoundProposal(
  state: InternalReceiverState,
  proposal: SubmitColorChallengeChoicePayload["nextRound"],
  resolvedAt: string
): ColorChallengeRoundSnapshot | null {
  const challenge = state.config.colorChallenge;
  if (!proposal || typeof proposal !== "object") {
    return null;
  }

  const iterationId =
    typeof proposal.iterationId === "string" ? proposal.iterationId.trim() : "";
  if (!iterationId) {
    return null;
  }

  const assignedColorId =
    typeof proposal.assignedColorId === "string"
      ? proposal.assignedColorId.trim()
      : "";
  const assignedColor = challenge.palette.find(
    color => color.colorId === assignedColorId
  );
  if (!assignedColor) {
    return null;
  }

  if (
    !challenge.refreshAssignedColorEachIteration &&
    challenge.assignedColorId !== null &&
    assignedColorId !== challenge.assignedColorId
  ) {
    return null;
  }

  if (!Array.isArray(proposal.choices) || proposal.choices.length !== 2) {
    return null;
  }

  const normalizedChoices = proposal.choices
    .map(choice => {
      const colorId =
        typeof choice?.colorId === "string" ? choice.colorId.trim() : "";
      return challenge.palette.find(color => color.colorId === colorId) ?? null;
    })
    .filter((choice): choice is ColorChallengeColor => choice !== null);

  if (
    normalizedChoices.length !== 2 ||
    normalizedChoices[0]!.colorId === normalizedChoices[1]!.colorId ||
    !normalizedChoices.some(choice => choice.colorId === assignedColorId)
  ) {
    return null;
  }

  const correctChoiceIndex = Math.trunc(proposal.correctChoiceIndex);
  if (
    !Number.isInteger(correctChoiceIndex) ||
    correctChoiceIndex < 0 ||
    correctChoiceIndex >= normalizedChoices.length ||
    normalizedChoices[correctChoiceIndex]!.colorId !== assignedColorId
  ) {
    return null;
  }

  const rawDuration = Number(proposal.iterationDurationMs);
  const iterationDurationMs = clampColorChallengeInterval(
    rawDuration,
    challenge.iterationDurationMs
  );
  if (
    !Number.isFinite(rawDuration) ||
    Math.round(rawDuration) !== rawDuration ||
    iterationDurationMs !== rawDuration
  ) {
    return null;
  }

  const startedAt =
    typeof proposal.iterationStartedAt === "string" &&
    proposal.iterationStartedAt.trim()
      ? proposal.iterationStartedAt
      : resolvedAt;
  const parsedStartedAt = parseIsoMs(startedAt, NaN);

  return {
    iterationId,
    assignedColorId,
    choices: normalizedChoices.map(choice => ({ ...choice })),
    correctChoiceIndex,
    iterationStartedAt: Number.isFinite(parsedStartedAt)
      ? new Date(parsedStartedAt).toISOString()
      : resolvedAt,
    iterationDurationMs,
  };
}

function resetColorChallenge(state: InternalReceiverState) {
  const current = state.config.colorChallenge;
  state.config.colorChallenge = {
    ...createDefaultColorChallengeConfig(),
    visible: current.visible,
    enabled: current.enabled,
    startingScore: current.startingScore,
    score: current.startingScore,
    palette: current.palette.map(color => ({ ...color })),
    minIntervalMs: current.minIntervalMs,
    maxIntervalMs: current.maxIntervalMs,
    maxReward: current.maxReward,
    minWrongPenalty: current.minWrongPenalty,
    maxWrongPenalty: current.maxWrongPenalty,
    missPenalty: current.missPenalty,
    refreshAssignedColorEachIteration:
      current.refreshAssignedColorEachIteration,
  };

  const challenge = state.config.colorChallenge;
  challenge.lastResult = {
    reason: "reset",
    choiceIndex: null,
    colorId: null,
    assignedColorId: challenge.assignedColorId,
    correctChoiceIndex: null,
    iterationId: challenge.iterationId,
    t: 0,
    greenness: 0,
    scoreDelta: 0,
    score: challenge.score,
    gameOver: false,
    resolvedAt: new Date().toISOString(),
    submissionId: null,
  };

  if (challenge.visible && challenge.enabled) {
    startColorChallengeRound(state);
  }

  return true;
}

function recordColorChallengeResult(
  state: InternalReceiverState,
  result: ColorChallengeResult,
  choices = state.config.colorChallenge.choices
) {
  const isoTimestamp = result.resolvedAt;
  const timestamp = parseIsoMs(isoTimestamp, Date.now());
  const event: ColorChallengeEventExport = {
    ...result,
    userId: state.receiverId,
    receiverId: state.receiverId,
    label: state.label,
    timestamp,
    isoTimestamp,
    choices: choices.map(choice => ({ ...choice })),
  };
  colorChallengeEvents.push(event);

  emitUnityEvent({
    sourceRole: "receiver",
    receiverId: state.receiverId,
    action: "colorChallengeResult",
    element: "receiver:color_challenge",
    value: event,
    timestamp: isoTimestamp,
  });
}

function applyColorChallengeScoreDelta(
  state: InternalReceiverState,
  result: Omit<ColorChallengeResult, "score" | "gameOver">,
  nextRound: ColorChallengeRoundSnapshot | null = null
) {
  const challenge = state.config.colorChallenge;
  challenge.score = Math.max(0, challenge.score + result.scoreDelta);
  if (challenge.score <= 0) {
    challenge.gameOver = true;
    challenge.score = 0;
  }

  const nextResult: ColorChallengeResult = {
    ...result,
    score: challenge.score,
    gameOver: challenge.gameOver,
  };
  challenge.lastResult = nextResult;
  recordColorChallengeResult(state, nextResult);

  if (!challenge.gameOver) {
    if (nextRound) {
      assignColorChallengeRound(challenge, nextRound);
      return;
    }

    startColorChallengeRound(state, parseIsoMs(result.resolvedAt, Date.now()));
  }
}

function resolveColorChallengeMiss(
  state: InternalReceiverState,
  now = Date.now()
) {
  const challenge = state.config.colorChallenge;
  if (
    !isColorChallengeRunning(state) ||
    !hasValidColorChallengeRound(challenge)
  ) {
    return false;
  }

  const evaluation = evaluateColorChallengeRound({
    challenge,
    choiceIndex: null,
    resolvedAtMs: now,
  });
  if (!evaluation) {
    return false;
  }

  applyColorChallengeScoreDelta(state, {
    ...evaluation,
    resolvedAt: new Date(now).toISOString(),
    submissionId: null,
  });

  return true;
}

function submitColorChallengeChoice(
  state: InternalReceiverState,
  payload: SubmitColorChallengeChoicePayload
) {
  const challenge = state.config.colorChallenge;
  if (
    !isColorChallengeRunning(state) ||
    !hasValidColorChallengeRound(challenge)
  ) {
    return false;
  }

  const choiceIndex =
    payload.choiceIndex === null || payload.choiceIndex === undefined
      ? null
      : Math.trunc(payload.choiceIndex);
  if (
    choiceIndex !== null &&
    (!Number.isInteger(choiceIndex) ||
      choiceIndex < 0 ||
      choiceIndex >= challenge.choices.length)
  ) {
    return false;
  }

  const roundId =
    typeof payload.roundId === "string" ? payload.roundId.trim() : "";
  if (roundId && roundId !== challenge.iterationId) {
    return false;
  }

  const now = Date.now();
  const pressedAtMs =
    typeof payload.pressedAt === "string" && payload.pressedAt.trim()
      ? parseIsoMs(payload.pressedAt, now)
      : hasFiniteNumber(payload.clientTimestamp)
        ? payload.clientTimestamp
        : now;
  const resolvedPressedAtMs = Math.min(now, pressedAtMs);
  if (choiceIndex !== null) {
    const chosenColor = challenge.choices[choiceIndex]!;
    if (
      typeof payload.colorId === "string" &&
      payload.colorId.trim() &&
      payload.colorId.trim() !== chosenColor.colorId
    ) {
      return false;
    }
  }

  const evaluation = evaluateColorChallengeRound({
    challenge,
    choiceIndex,
    resolvedAtMs: resolvedPressedAtMs,
  });
  if (!evaluation) {
    return false;
  }

  const resolvedAt = new Date(resolvedPressedAtMs).toISOString();
  const submissionId =
    typeof payload.submissionId === "string" && payload.submissionId.trim()
      ? payload.submissionId.trim()
      : null;
  const nextRound =
    roundId && payload.nextRound
      ? normalizeColorChallengeRoundProposal(state, payload.nextRound, resolvedAt)
      : null;

  applyColorChallengeScoreDelta(state, {
    ...evaluation,
    resolvedAt,
    submissionId,
  }, nextRound);

  return true;
}

function advanceEconomy(state: InternalReceiverState, now = Date.now()) {
  const economy = state.config.economy;
  const previousSnapshot = JSON.stringify({
    currencySeconds: economy.currencySeconds,
    inflation: economy.inflation,
    currentTrackId: economy.currentTrackId,
    playStartedAt: economy.playStartedAt,
    playEndsAt: economy.playEndsAt,
    gameOver: economy.gameOver,
    lastUpdatedAt: economy.lastUpdatedAt,
    playingTracks: state.config.tracks
      .filter(track => track.playing)
      .map(track => track.trackId),
  });

  const lastUpdatedAtMs = parseIsoMs(economy.lastUpdatedAt, now);
  const elapsedSeconds = Math.max(0, (now - lastUpdatedAtMs) / 1000);

  if (economy.gameOver || !economy.enabled) {
    return false;
  }

  const currentTrack = economy.currentTrackId
    ? getTrack(state, economy.currentTrackId)
    : undefined;
  if (economy.currentTrackId && (!currentTrack || !currentTrack.playing)) {
    economy.currentTrackId = null;
    economy.playStartedAt = null;
    economy.playEndsAt = null;
  }

  const playEndsAtMs = parseIsoMs(economy.playEndsAt, NaN);
  const playing =
    Boolean(economy.currentTrackId) &&
    Number.isFinite(playEndsAtMs) &&
    now < playEndsAtMs;
  const playShouldEnd =
    Boolean(economy.currentTrackId) &&
    Number.isFinite(playEndsAtMs) &&
    playEndsAtMs <= now;

  if (elapsedSeconds < 0.05 && !playShouldEnd) {
    return (
      previousSnapshot !==
      JSON.stringify({
        currencySeconds: economy.currencySeconds,
        inflation: economy.inflation,
        currentTrackId: economy.currentTrackId,
        playStartedAt: economy.playStartedAt,
        playEndsAt: economy.playEndsAt,
        gameOver: economy.gameOver,
        lastUpdatedAt: economy.lastUpdatedAt,
        playingTracks: state.config.tracks
          .filter(track => track.playing)
          .map(track => track.trackId),
      })
    );
  }

  if (elapsedSeconds > 0) {
    if (playing) {
      if (economy.inflationGrowsWhilePlaying) {
        economy.inflation = advanceEconomyInflation(
          economy.inflation,
          economy.inflationGrowthPerSecond,
          elapsedSeconds
        );
      }
    } else if (
      economy.currentTrackId &&
      Number.isFinite(playEndsAtMs) &&
      playEndsAtMs <= now
    ) {
      const playingElapsedSeconds = Math.max(
        0,
        (playEndsAtMs - lastUpdatedAtMs) / 1000
      );
      const idleElapsedSeconds = Math.max(0, (now - playEndsAtMs) / 1000);
      if (economy.inflationGrowsWhilePlaying) {
        economy.inflation = advanceEconomyInflation(
          economy.inflation,
          economy.inflationGrowthPerSecond,
          playingElapsedSeconds + idleElapsedSeconds
        );
      } else {
        economy.inflation = advanceEconomyInflation(
          economy.inflation,
          economy.inflationGrowthPerSecond,
          idleElapsedSeconds
        );
      }
      economy.currencySeconds += economy.earnRatePerSecond * idleElapsedSeconds;
      const endingTrack = getTrack(state, economy.currentTrackId);
      if (endingTrack) {
        endingTrack.playing = false;
      }
      economy.currentTrackId = null;
      economy.playStartedAt = null;
      economy.playEndsAt = null;
    } else {
      economy.currencySeconds += economy.earnRatePerSecond * elapsedSeconds;
      economy.inflation = advanceEconomyInflation(
        economy.inflation,
        economy.inflationGrowthPerSecond,
        elapsedSeconds
      );
    }
  }

  economy.currencySeconds = Math.max(0, economy.currencySeconds);
  economy.inflation = Math.max(0, economy.inflation);
  economy.lastUpdatedAt = new Date(now).toISOString();

  return (
    previousSnapshot !==
    JSON.stringify({
      currencySeconds: economy.currencySeconds,
      inflation: economy.inflation,
      currentTrackId: economy.currentTrackId,
      playStartedAt: economy.playStartedAt,
      playEndsAt: economy.playEndsAt,
      gameOver: economy.gameOver,
      lastUpdatedAt: economy.lastUpdatedAt,
      playingTracks: state.config.tracks
        .filter(track => track.playing)
        .map(track => track.trackId),
    })
  );
}

function resetEconomy(state: InternalReceiverState) {
  const current = state.config.economy;
  const nowIso = new Date().toISOString();
  state.config.economy = {
    ...createDefaultEconomyConfig(nowIso),
    visible: current.visible,
    enabled: current.enabled,
    startingSeconds: current.startingSeconds,
    currencySeconds: current.startingSeconds,
    earnRatePerSecond: current.earnRatePerSecond,
    refreshIntervalMs: current.refreshIntervalMs,
    inflationGrowthPerSecond: current.inflationGrowthPerSecond,
    inflationGrowsWhilePlaying: current.inflationGrowsWhilePlaying,
  };
  stopAllTracks(state);
  return true;
}

function triggerEconomyGameOver(
  state: InternalReceiverState,
  reason: string,
  now = Date.now()
) {
  const economy = state.config.economy;
  economy.currencySeconds = 0;
  economy.currentTrackId = null;
  economy.playStartedAt = null;
  economy.playEndsAt = null;
  economy.gameOver = true;
  economy.lastError = reason;
  economy.lastUpdatedAt = new Date(now).toISOString();
  stopAllTracks(state);
}

function isVoteLockActive(state: InternalReceiverState) {
  return Boolean(state.config.vote?.visible && state.config.vote.enabled);
}

function rejectEconomyRequest(
  state: InternalReceiverState,
  reason: string,
  now = Date.now()
) {
  state.config.economy.lastError = reason;
  state.config.economy.lastUpdatedAt = new Date(now).toISOString();
  return true;
}

function requestTrackPlay(
  state: InternalReceiverState,
  payload: RequestTrackPlayPayload
) {
  const now = Date.now();
  advanceEconomy(state, now);
  const economy = state.config.economy;
  const track = getTrack(state, payload.trackId);

  if (!economy.enabled) {
    return rejectEconomyRequest(state, "economy_disabled", now);
  }

  if (economy.gameOver) {
    return rejectEconomyRequest(state, "game_over", now);
  }

  if (isVoteLockActive(state)) {
    return rejectEconomyRequest(state, "vote_lock", now);
  }

  if (!track || !track.visible) {
    return rejectEconomyRequest(state, "track_hidden", now);
  }

  if (!track.url || track.durationSeconds <= 0) {
    return rejectEconomyRequest(state, "missing_duration", now);
  }

  if (!track.enabled || !track.playable) {
    return rejectEconomyRequest(state, "track_disabled", now);
  }

  if (
    economy.currentTrackId ||
    state.config.tracks.some(item => item.playing)
  ) {
    return rejectEconomyRequest(state, "already_playing", now);
  }

  const cost = calculateTrackCost(track, economy);
  if (cost === null) {
    return rejectEconomyRequest(state, "missing_duration", now);
  }

  if (economy.currencySeconds - cost < 0) {
    triggerEconomyGameOver(state, "insufficient_currency", now);
    return true;
  }

  economy.currencySeconds -= cost;
  economy.currentTrackId = track.trackId;
  economy.playStartedAt = new Date(now).toISOString();
  economy.playEndsAt = new Date(
    now + track.durationSeconds * 1000
  ).toISOString();
  economy.gameOver = false;
  economy.lastError = null;
  economy.lastUpdatedAt = new Date(now).toISOString();

  state.config.tracks.forEach(item => {
    item.playing = item.trackId === track.trackId;
  });

  return true;
}

function requestTrackStop(
  state: InternalReceiverState,
  payload: RequestTrackStopPayload
) {
  const now = Date.now();
  advanceEconomy(state, now);
  const track = getTrack(state, payload.trackId);
  const economy = state.config.economy;
  const changed =
    Boolean(track?.playing) ||
    economy.currentTrackId === payload.trackId ||
    economy.lastError !== null;

  if (track) {
    track.playing = false;
  }

  if (economy.currentTrackId === payload.trackId) {
    economy.currentTrackId = null;
    economy.playStartedAt = null;
    economy.playEndsAt = null;
  }

  economy.lastError = null;
  economy.lastUpdatedAt = new Date(now).toISOString();
  return changed;
}

function emitReceiverStateToRoom(
  receiverId: string,
  state: InternalReceiverState
) {
  if (!io) {
    return;
  }

  io.to(receiverRoom(receiverId)).emit(
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
      ? (previousVote?.selectedOptionId ?? null)
      : null,
    submittedAt: canPreserveSelection
      ? (previousVote?.submittedAt ?? null)
      : null,
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

function isTimingInteractionValue(
  value: unknown
): value is TimingInteractionValue {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.timing === "boolean" &&
    typeof candidate.timingValue === "number" &&
    Number.isFinite(candidate.timingValue) &&
    typeof candidate.targetCenter === "number" &&
    Number.isFinite(candidate.targetCenter) &&
    typeof candidate.timingTolerance === "number" &&
    Number.isFinite(candidate.timingTolerance) &&
    typeof candidate.delta === "number" &&
    Number.isFinite(candidate.delta) &&
    (candidate.pulseSequence === null ||
      (typeof candidate.pulseSequence === "number" &&
        Number.isFinite(candidate.pulseSequence))) &&
    (candidate.pulseIntervalMs === null ||
      (typeof candidate.pulseIntervalMs === "number" &&
        Number.isFinite(candidate.pulseIntervalMs))) &&
    typeof candidate.pulseActive === "boolean"
  );
}

function recordTimingInteraction(
  receiverId: string,
  event: UnityInteractionEvent
) {
  if (
    event.action !== "submitTiming" ||
    event.element !== "receiver:timing_button" ||
    !isTimingInteractionValue(event.value)
  ) {
    return;
  }

  const state = receivers.get(receiverId);
  if (!state) {
    return;
  }

  const isoTimestamp =
    typeof event.timestamp === "string" && event.timestamp.trim()
      ? event.timestamp
      : new Date().toISOString();
  const parsedTimestamp = new Date(isoTimestamp).getTime();

  timingEvents.push({
    userId: receiverId,
    receiverId,
    label: state.label,
    timestamp: Number.isFinite(parsedTimestamp) ? parsedTimestamp : Date.now(),
    isoTimestamp,
    ...event.value,
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

  Array.from(existing.submissions.entries()).forEach(
    ([receiverId, submission]) => {
      if (
        !existing.targetReceiverIds.has(receiverId) ||
        !existing.options.some(
          option => option.id === submission.selectedOptionId
        )
      ) {
        existing.submissions.delete(receiverId);
      }
    }
  );

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
      io?.to(receiverRoom(receiverId)).emit(WS_EVENTS.PULSE, event);
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
  if (
    command.targetId !== socket.data.receiverId ||
    (command.command !== "set_track_state" &&
      command.command !== "request_track_play" &&
      command.command !== "request_track_stop" &&
      command.command !== "submit_color_challenge_choice")
  ) {
    return false;
  }

  if (command.command === "set_track_state") {
    return command.payload.patch.playing !== true;
  }

  return (
    command.command === "request_track_play" ||
    command.command === "request_track_stop" ||
    command.command === "submit_color_challenge_choice"
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
  const durationSeconds = clampNonNegativeNumber(patch.durationSeconds, 0);
  const basePrice = clampNonNegativeNumber(patch.basePrice, durationSeconds);

  return {
    trackId,
    label: typeof patch.label === "string" ? patch.label : trackId,
    url: typeof patch.url === "string" ? patch.url : "",
    basePrice,
    durationSeconds,
    categoryId:
      typeof patch.categoryId === "string" && patch.categoryId.trim()
        ? patch.categoryId.trim()
        : MANUAL_TRACK_CATEGORY_ID,
    categoryColor:
      typeof patch.categoryColor === "string" && patch.categoryColor.trim()
        ? patch.categoryColor.trim()
        : MANUAL_TRACK_CATEGORY_COLOR,
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
    existing.durationSeconds = clampNonNegativeNumber(
      existing.durationSeconds,
      0
    );
    existing.basePrice = clampNonNegativeNumber(
      existing.basePrice,
      existing.durationSeconds
    );
    if (!existing.categoryId.trim()) {
      existing.categoryId = MANUAL_TRACK_CATEGORY_ID;
    }
    if (!existing.categoryColor.trim()) {
      existing.categoryColor = MANUAL_TRACK_CATEGORY_COLOR;
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

function applyVisibleTracks(
  state: InternalReceiverState,
  payload: SetVisibleTracksPayload
) {
  const visibleTrackIds = new Set(payload.trackIds);
  let changed = false;

  state.config.tracks.forEach(track => {
    const nextVisible = visibleTrackIds.has(track.trackId);

    if (track.visible !== nextVisible) {
      track.visible = nextVisible;
      changed = true;
    }

    if (!nextVisible && track.playing) {
      track.playing = false;
      if (state.config.economy.currentTrackId === track.trackId) {
        state.config.economy.currentTrackId = null;
        state.config.economy.playStartedAt = null;
        state.config.economy.playEndsAt = null;
      }
      changed = true;
    }
  });

  return changed;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clampMapMovementDuration(value: unknown) {
  if (!hasFiniteNumber(value)) {
    return DEFAULT_MAP_MOVEMENT_DURATION_MS;
  }

  return Math.min(
    MAX_MAP_MOVEMENT_DURATION_MS,
    Math.max(MIN_MAP_MOVEMENT_DURATION_MS, Math.round(value))
  );
}

function normalizeMapMovement(
  state: InternalReceiverState,
  value: unknown
): MapMovementConfig | null | undefined {
  if (value === null) {
    return null;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const fromX = clampNormalizedCoordinate(
    resolveFiniteNumber(value.fromX, value.startX, state.config.map.playerPosX),
    state.config.map.playerPosX
  );
  const fromY = clampNormalizedCoordinate(
    resolveFiniteNumber(value.fromY, value.startY, state.config.map.playerPosY),
    state.config.map.playerPosY
  );
  const toX = clampNormalizedCoordinate(
    resolveFiniteNumber(value.toX, value.targetX, state.config.map.playerPosX),
    state.config.map.playerPosX
  );
  const toY = clampNormalizedCoordinate(
    resolveFiniteNumber(value.toY, value.targetY, state.config.map.playerPosY),
    state.config.map.playerPosY
  );
  const startedAt =
    typeof value.startedAt === "string" && value.startedAt.trim()
      ? value.startedAt
      : new Date().toISOString();

  return {
    fromX,
    fromY,
    toX,
    toY,
    startedAt,
    durationMs: clampMapMovementDuration(value.durationMs),
    loop: typeof value.loop === "boolean" ? value.loop : true,
  };
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

  const hasInstantX =
    hasFiniteNumber(patch.playerPosX) || hasFiniteNumber(patch.x);
  const hasInstantY =
    hasFiniteNumber(patch.playerPosY) || hasFiniteNumber(patch.y);

  if (hasInstantX || hasInstantY) {
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
    state.config.map.movement = null;
  }

  if ("movement" in patch) {
    const movement = normalizeMapMovement(state, patch.movement);
    if (movement !== undefined) {
      state.config.map.movement = movement;
      if (movement) {
        state.config.map.playerPosX = movement.toX;
        state.config.map.playerPosY = movement.toY;
      }
    }
  }

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

function assignTimingPatch(
  state: InternalReceiverState,
  patch: SetModuleStatePayload["patch"]
) {
  if (typeof patch.visible === "boolean") {
    state.config.timing.visible = patch.visible;
  } else if (typeof patch.timingVisible === "boolean") {
    state.config.timing.visible = patch.timingVisible;
  }

  if (typeof patch.enabled === "boolean") {
    state.config.timing.enabled = patch.enabled;
  } else if (typeof patch.timingEnabled === "boolean") {
    state.config.timing.enabled = patch.timingEnabled;
  }

  state.config.timing.timingValue = clampNormalizedCoordinate(
    resolveFiniteNumber(
      patch.timingValue,
      undefined,
      state.config.timing.timingValue
    ),
    state.config.timing.timingValue
  );

  state.config.timing.targetCenter = clampNormalizedCoordinate(
    resolveFiniteNumber(
      patch.targetCenter,
      patch.center,
      state.config.timing.targetCenter
    ),
    state.config.timing.targetCenter
  );

  state.config.timing.timingTolerance = clampTimingTolerance(
    resolveFiniteNumber(
      patch.timingTolerance,
      patch.tosingTolerance,
      state.config.timing.timingTolerance
    ),
    state.config.timing.timingTolerance
  );

  if (typeof patch.startedAt === "string" && patch.startedAt.trim()) {
    state.config.timing.startedAt = patch.startedAt;
  } else if (patch.startedAt === null) {
    state.config.timing.startedAt = null;
  }

  if (
    typeof patch.durationMs === "number" &&
    Number.isFinite(patch.durationMs)
  ) {
    state.config.timing.durationMs = Math.max(0, patch.durationMs);
  } else if (patch.durationMs === null) {
    state.config.timing.durationMs = null;
  }

  if (
    typeof patch.remainingMs === "number" &&
    Number.isFinite(patch.remainingMs)
  ) {
    state.config.timing.remainingMs = Math.max(0, patch.remainingMs);
  } else if (patch.remainingMs === null) {
    state.config.timing.remainingMs = null;
  }

  return true;
}

function assignEconomyPatch(
  state: InternalReceiverState,
  patch: SetModuleStatePayload["patch"]
) {
  advanceEconomy(state);
  const economy = state.config.economy;

  if (typeof patch.visible === "boolean") {
    economy.visible = patch.visible;
  }

  if (typeof patch.enabled === "boolean") {
    economy.enabled = patch.enabled;
    if (!patch.enabled) {
      stopAllTracks(state);
    }
  }

  economy.startingSeconds = clampNonNegativeNumber(
    patch.startingSeconds,
    economy.startingSeconds
  );
  economy.currencySeconds = clampNonNegativeNumber(
    patch.currencySeconds,
    economy.currencySeconds
  );
  economy.earnRatePerSecond = clampNonNegativeNumber(
    patch.earnRatePerSecond,
    economy.earnRatePerSecond
  );
  economy.refreshIntervalMs = Math.max(
    1000,
    clampNonNegativeNumber(patch.refreshIntervalMs, economy.refreshIntervalMs)
  );
  economy.inflation = clampNonNegativeNumber(
    patch.inflation,
    economy.inflation
  );
  economy.inflationGrowthPerSecond = clampNonNegativeNumber(
    patch.inflationGrowthPerSecond,
    economy.inflationGrowthPerSecond
  );

  if (typeof patch.inflationGrowsWhilePlaying === "boolean") {
    economy.inflationGrowsWhilePlaying = patch.inflationGrowsWhilePlaying;
  }

  if (typeof patch.gameOver === "boolean") {
    economy.gameOver = patch.gameOver;
    if (patch.gameOver) {
      stopAllTracks(state);
    }
  }

  if (typeof patch.lastError === "string") {
    economy.lastError = patch.lastError;
  } else if (patch.lastError === null) {
    economy.lastError = null;
  }

  economy.lastUpdatedAt = new Date().toISOString();
  return true;
}

function assignColorChallengePatch(
  state: InternalReceiverState,
  patch: SetModuleStatePayload["patch"]
) {
  const challenge = state.config.colorChallenge;
  const wasRunning =
    challenge.visible && challenge.enabled && !challenge.gameOver;
  let shouldStartNewRound = false;

  if (typeof patch.visible === "boolean") {
    challenge.visible = patch.visible;
  }

  if (typeof patch.enabled === "boolean") {
    challenge.enabled = patch.enabled;
  }

  challenge.startingScore = clampNonNegativeNumber(
    patch.startingScore,
    challenge.startingScore
  );
  challenge.score = clampNonNegativeNumber(patch.score, challenge.score);
  challenge.maxReward = clampNonNegativeNumber(
    patch.maxReward,
    challenge.maxReward
  );
  challenge.minWrongPenalty = clampNonNegativeNumber(
    patch.minWrongPenalty,
    challenge.minWrongPenalty
  );
  challenge.maxWrongPenalty = clampNonNegativeNumber(
    patch.maxWrongPenalty,
    challenge.maxWrongPenalty
  );
  challenge.missPenalty = clampNonNegativeNumber(
    patch.missPenalty,
    challenge.missPenalty
  );

  if (challenge.maxWrongPenalty < challenge.minWrongPenalty) {
    challenge.maxWrongPenalty = challenge.minWrongPenalty;
  }

  const intervals = normalizeColorChallengeIntervals(
    clampColorChallengeInterval(patch.minIntervalMs, challenge.minIntervalMs),
    clampColorChallengeInterval(patch.maxIntervalMs, challenge.maxIntervalMs)
  );
  if (
    intervals.minIntervalMs !== challenge.minIntervalMs ||
    intervals.maxIntervalMs !== challenge.maxIntervalMs
  ) {
    shouldStartNewRound = true;
  }
  challenge.minIntervalMs = intervals.minIntervalMs;
  challenge.maxIntervalMs = intervals.maxIntervalMs;

  if (typeof patch.refreshAssignedColorEachIteration === "boolean") {
    challenge.refreshAssignedColorEachIteration =
      patch.refreshAssignedColorEachIteration;
  }

  if (typeof patch.assignedColorId === "string") {
    const assignedColorId = patch.assignedColorId.trim();
    if (
      assignedColorId &&
      challenge.palette.some(color => color.colorId === assignedColorId)
    ) {
      challenge.assignedColorId = assignedColorId;
      shouldStartNewRound = true;
    }
  } else if (patch.assignedColorId === null) {
    challenge.assignedColorId = null;
    shouldStartNewRound = true;
  }

  if ("palette" in patch) {
    const palette = normalizeColorChallengePalette(patch.palette);
    if (palette) {
      challenge.palette = palette;
      if (
        challenge.assignedColorId &&
        !palette.some(color => color.colorId === challenge.assignedColorId)
      ) {
        challenge.assignedColorId = null;
      }
      shouldStartNewRound = true;
    }
  }

  if (typeof patch.gameOver === "boolean") {
    challenge.gameOver = patch.gameOver;
    if (!patch.gameOver && challenge.score <= 0) {
      challenge.score = challenge.startingScore;
    }
    shouldStartNewRound = !patch.gameOver;
  }

  if (challenge.score <= 0 && patch.gameOver !== false) {
    challenge.score = 0;
    challenge.gameOver = true;
  }

  const isRunning =
    challenge.visible && challenge.enabled && !challenge.gameOver;
  if (
    isRunning &&
    (!wasRunning ||
      shouldStartNewRound ||
      !hasValidColorChallengeRound(challenge))
  ) {
    startColorChallengeRound(state);
  }

  return true;
}

function stopAllTracks(state: InternalReceiverState) {
  state.config.tracks.forEach(track => {
    track.playing = false;
  });
  state.config.economy.currentTrackId = null;
  state.config.economy.playStartedAt = null;
  state.config.economy.playEndsAt = null;
}

function applyCommand(
  state: InternalReceiverState,
  command: UnifiedCommand
): boolean {
  switch (command.command) {
    case "set_track_state":
      return applyTrackPatch(state, command.payload);
    case "set_visible_tracks":
      return applyVisibleTracks(state, command.payload);
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
        return assignTimingPatch(state, command.payload.patch);
      }
      if (command.payload.module === "economy") {
        return assignEconomyPatch(state, command.payload.patch);
      }
      if (command.payload.module === "colorChallenge") {
        return assignColorChallengePatch(state, command.payload.patch);
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
    case "request_track_play":
      return requestTrackPlay(state, command.payload);
    case "request_track_stop":
      return requestTrackStop(state, command.payload);
    case "economy_reset":
      return resetEconomy(state);
    case "submit_color_challenge_choice":
      return submitColorChallengeChoice(state, command.payload);
    case "color_challenge_reset":
      return resetColorChallenge(state);
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

export function getTimingExport(): TimingExport {
  const attempts = [...timingEvents].sort(
    (left, right) => right.timestamp - left.timestamp
  );
  const hits = attempts.filter(attempt => attempt.timing).length;

  return {
    generatedAt: new Date().toISOString(),
    totalAttempts: attempts.length,
    hits,
    misses: attempts.length - hits,
    attempts,
  };
}

export function getColorChallengeExport(): ColorChallengeExport {
  const events = [...colorChallengeEvents].sort(
    (left, right) => right.timestamp - left.timestamp
  );

  return {
    generatedAt: new Date().toISOString(),
    totalEvents: events.length,
    correct: events.filter(event => event.reason === "correct").length,
    wrong: events.filter(event => event.reason === "wrong").length,
    misses: events.filter(event => event.reason === "miss").length,
    gameOvers: events.filter(event => event.gameOver).length,
    events,
  };
}

function removeDisconnectedReceivers(): string[] {
  const removedIds: string[] = [];

  receivers.forEach((state, receiverId) => {
    if (!state.connected) {
      destroyPulseLoop(receiverId);
      clearEconomyPlayTimeout(receiverId);
      clearColorChallengeTimeout(receiverId);
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
      clearEconomyPlayTimeout(receiverId);
      clearColorChallengeTimeout(receiverId);
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
  if (
    !session ||
    !session.isActive ||
    !session.targetReceiverIds.has(receiverId)
  ) {
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

  if (sourceRole === "receiver" && receiverId) {
    recordTimingInteraction(receiverId, event);
  }

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

function normalizeClientInstanceId(socket: Socket, data: ReceiverRegistration) {
  const clientInstanceId = data.clientInstanceId?.trim();
  return clientInstanceId || `socket:${socket.id}`;
}

function canClaimReceiver(
  state: InternalReceiverState,
  socket: Socket,
  clientInstanceId: string
) {
  return (
    state.socketId === socket.id ||
    (!state.connected && state.clientInstanceId === clientInstanceId)
  );
}

function assignUniqueReceiverId(
  requestedReceiverId: string,
  socket: Socket,
  clientInstanceId: string
) {
  const requestedState = receivers.get(requestedReceiverId);
  if (
    !requestedState ||
    canClaimReceiver(requestedState, socket, clientInstanceId)
  ) {
    return requestedReceiverId;
  }

  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidateReceiverId = `${requestedReceiverId}${suffix}`;
    const candidateState = receivers.get(candidateReceiverId);

    if (
      !candidateState ||
      canClaimReceiver(candidateState, socket, clientInstanceId)
    ) {
      return candidateReceiverId;
    }
  }

  return `${requestedReceiverId}-${Date.now()}`;
}

function leaveReceiverRoomsExcept(socket: Socket, receiverIdToKeep: string) {
  const keepRoom = receiverRoom(receiverIdToKeep);
  socket.rooms.forEach(room => {
    if (room.startsWith("receiver:") && room !== keepRoom) {
      socket.leave(room);
    }
  });
}

function detachSocketFromPreviousReceiver(
  socket: Socket,
  nextReceiverId: string
) {
  const previousReceiverId =
    typeof socket.data.receiverId === "string" ? socket.data.receiverId : null;

  if (!previousReceiverId || previousReceiverId === nextReceiverId) {
    return;
  }

  const previousState = receivers.get(previousReceiverId);
  if (previousState?.socketId === socket.id) {
    previousState.connected = false;
    previousState.disconnectedAt = Date.now();
    stopAllTracks(previousState);
    clearEconomyPlayTimeout(previousReceiverId);
    clearColorChallengeTimeout(previousReceiverId);
    incrementConfigVersion(previousState);
    syncPulseLoop(previousReceiverId, previousState);
  }
}

function resolveReceiverLabel(
  requestedReceiverId: string,
  assignedReceiverId: string,
  rawLabel?: string
) {
  const label = rawLabel?.trim();
  if (!label || label === `Receiver ${requestedReceiverId}`) {
    return `Receiver ${assignedReceiverId}`;
  }

  return label;
}

function registerReceiver(socket: Socket, data: ReceiverRegistration) {
  const requestedReceiverId = data.receiverId.trim();
  const clientInstanceId = normalizeClientInstanceId(socket, data);

  if (!requestedReceiverId || requestedReceiverId === "*") {
    console.warn(`[WS] Rejected invalid receiver ID from ${socket.id}`);
    return;
  }

  const receiverId = assignUniqueReceiverId(
    requestedReceiverId,
    socket,
    clientInstanceId
  );
  const displayLabel = resolveReceiverLabel(
    requestedReceiverId,
    receiverId,
    data.label
  );

  detachSocketFromPreviousReceiver(socket, receiverId);
  leaveReceiverRoomsExcept(socket, receiverId);

  socket.data.role = "receiver";
  socket.data.receiverId = receiverId;
  socket.data.clientInstanceId = clientInstanceId;

  const existing = receivers.get(receiverId);

  if (existing) {
    existing.socketId = socket.id;
    existing.clientInstanceId = clientInstanceId;
    existing.connected = true;
    existing.disconnectedAt = null;
    existing.label = displayLabel;
  } else {
    receivers.set(
      receiverId,
      createDefaultState(receiverId, displayLabel, socket.id, clientInstanceId)
    );
  }

  socket.join(receiverRoom(receiverId));
  syncPulseLoop(receiverId, receivers.get(receiverId)!);
  scheduleEconomyPlayTimeout(receiverId, receivers.get(receiverId)!);
  scheduleColorChallengeTimeout(receiverId, receivers.get(receiverId)!);
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
      clearEconomyPlayTimeout(state.receiverId);
      clearColorChallengeTimeout(state.receiverId);
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
      scheduleEconomyPlayTimeout(receiverId, state);
      scheduleColorChallengeTimeout(receiverId, state);
      io!
        .to(receiverRoom(receiverId))
        .emit(WS_EVENTS.RECEIVER_COMMAND, command);
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
  scheduleEconomyPlayTimeout(command.targetId, state);
  scheduleColorChallengeTimeout(command.targetId, state);
  io.to(receiverRoom(command.targetId)).emit(
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
  economyPlayTimeouts.forEach(timeout => clearTimeout(timeout));
  economyPlayTimeouts.clear();
  colorChallengeTimeouts.forEach(timeout => clearTimeout(timeout));
  colorChallengeTimeouts.clear();
  voteSessions.forEach(session => clearVoteTimeout(session));
  voteSessions.clear();
  receiverActiveVotes.clear();
  timingEvents.length = 0;
  colorChallengeEvents.length = 0;
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
