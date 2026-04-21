/**
 * Shared WebSocket and HTTP protocol types.
 *
 * Phase 1 keeps the legacy control message structure for backward-compatible
 * inputs, but the runtime architecture is driven by unified commands and full
 * receiver config snapshots.
 */

import { GENERATED_TRACK_LIBRARY } from "./trackManifest.generated";

export type JsonRecord = Record<string, unknown>;

// ─── Legacy Message Types ─────────────────────────────────────────────
export type MessageType =
  | "audio_control"
  | "audio_playable"
  | "color_change"
  | "text_message";

export interface AudioControlPayload {
  trackId: 1 | 2;
  action: "play" | "pause";
}

export interface AudioPlayablePayload {
  trackId: 1 | 2;
  playable: boolean;
}

export interface ColorChangePayload {
  color: string;
}

export interface TextMessagePayload {
  text: string;
}

export type MessagePayload =
  | AudioControlPayload
  | AudioPlayablePayload
  | ColorChangePayload
  | TextMessagePayload;

export interface LegacyControlMessage {
  type: MessageType;
  targetId: string;
  payload: MessagePayload;
  timestamp: string;
}

export type ControlMessage = LegacyControlMessage;

// ─── Config Model ────────────────────────────────────────────────────
export interface VisibilityConfig {
  visible: boolean;
  enabled: boolean;
}

export interface TrackState extends VisibilityConfig {
  trackId: string;
  label: string;
  url: string;
  basePrice: number;
  durationSeconds: number;
  categoryId: string;
  categoryColor: string;
  playing: boolean;
  playable: boolean;
  loopEnabled: boolean;
  loopControlVisible: boolean;
  loopControlLocked: boolean;
  volumeValue: number;
  volumeControlVisible: boolean;
  volumeControlEnabled: boolean;
  tempoFlashEnabled: boolean;
  fillTime: number;
  groupId: string | null;
}

export interface GroupState extends VisibilityConfig {
  groupId: string;
  label: string;
  color: string;
  trackIds: string[];
}

export interface PulseConfig extends VisibilityConfig {
  active: boolean;
  bpm: number;
}

export interface VoteOption {
  id: string;
  label: string;
}

export interface VoteConfig extends VisibilityConfig {
  voteId: string;
  question: string;
  options: VoteOption[];
  visibilityDuration: number;
  allowRevote: boolean;
  selectedOptionId: string | null;
  submittedAt: string | null;
}

export interface VoteSubmission {
  receiverId: string;
  voteId: string;
  selectedOptionId: string;
  submittedAt: string;
}

export type VoteCloseReason = "timeout" | "manual_close" | "replaced" | "reset";

export interface VoteOptionResult {
  optionId: string;
  label: string;
  voteCount: number;
}

export interface VoteEligibleReceiver {
  receiverId: string;
  label: string;
  connected: boolean;
  hasVoted: boolean;
}

export interface VoteSessionExport {
  voteId: string;
  question: string;
  options: VoteOptionResult[];
  allowRevote: boolean;
  visibilityDuration: number;
  openedAt: string;
  closesAt: string | null;
  closedAt: string | null;
  closeReason: VoteCloseReason | null;
  isActive: boolean;
  submittedCount: number;
  totalEligible: number;
  missingReceiverIds: string[];
  eligibleReceivers: VoteEligibleReceiver[];
}

export interface ScoreConfig extends VisibilityConfig {
  value: number;
}

export interface MapMovementConfig {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startedAt: string;
  durationMs: number;
  loop: boolean;
}

export interface MapConfig extends VisibilityConfig {
  playerPosX: number;
  playerPosY: number;
  movement: MapMovementConfig | null;
}

export interface TimingConfig extends VisibilityConfig {
  timingValue: number;
  targetCenter: number;
  timingTolerance: number;
  startedAt: string | null;
  durationMs: number | null;
  remainingMs: number | null;
}

export interface TextDisplayConfig extends VisibilityConfig {
  text: string;
}

export interface VisualConfig extends VisibilityConfig {
  iconColor: string;
}

export interface EconomyConfig extends VisibilityConfig {
  currencySeconds: number;
  startingSeconds: number;
  earnRatePerSecond: number;
  refreshIntervalMs: number;
  inflation: number;
  inflationGrowthPerSecond: number;
  inflationGrowsWhilePlaying: boolean;
  currentTrackId: string | null;
  playStartedAt: string | null;
  playEndsAt: string | null;
  gameOver: boolean;
  lastUpdatedAt: string;
  lastError: string | null;
}

export interface ColorChallengeColor {
  colorId: string;
  label: string;
  color: string;
}

export interface ColorChallengeRoundSnapshot {
  iterationId: string;
  assignedColorId: string;
  choices: ColorChallengeColor[];
  correctChoiceIndex: number;
  iterationStartedAt: string;
  iterationDurationMs: number;
}

export interface ColorChallengeResult {
  reason: "correct" | "wrong" | "miss" | "reset";
  choiceIndex: number | null;
  colorId: string | null;
  assignedColorId: string | null;
  correctChoiceIndex: number | null;
  iterationId: string | null;
  t: number;
  greenness: number;
  scoreDelta: number;
  score: number;
  gameOver: boolean;
  resolvedAt: string;
  submissionId: string | null;
}

export interface ColorChallengeConfig extends VisibilityConfig {
  score: number;
  startingScore: number;
  iterationId: string | null;
  assignedColorId: string | null;
  palette: ColorChallengeColor[];
  choices: ColorChallengeColor[];
  correctChoiceIndex: number | null;
  iterationStartedAt: string | null;
  iterationDurationMs: number;
  minIntervalMs: number;
  maxIntervalMs: number;
  maxReward: number;
  minWrongPenalty: number;
  maxWrongPenalty: number;
  missPenalty: number;
  refreshAssignedColorEachIteration: boolean;
  gameOver: boolean;
  lastResult: ColorChallengeResult | null;
}

export interface ReceiverConfig {
  tracks: TrackState[];
  groups: GroupState[];
  pulse: PulseConfig;
  vote: VoteConfig | null;
  score: ScoreConfig;
  map: MapConfig;
  timing: TimingConfig;
  textDisplay: TextDisplayConfig;
  visuals: VisualConfig;
  economy: EconomyConfig;
  colorChallenge: ColorChallengeConfig;
}

export type ModuleName =
  | "pulse"
  | "score"
  | "map"
  | "timing"
  | "textDisplay"
  | "visuals"
  | "economy"
  | "colorChallenge";

// ─── Unified Commands ────────────────────────────────────────────────
export interface SetTrackStatePayload {
  trackId: string;
  patch: Partial<TrackState>;
}

export interface SetVisibleTracksPayload {
  trackIds: string[];
}

export interface RemoveTrackPayload {
  trackId: string;
}

export interface RemoveGroupPayload {
  groupId: string;
}

export interface SetGroupStatePayload {
  groupId: string;
  patch: Partial<GroupState>;
}

export interface SetModuleStatePayload {
  module: ModuleName;
  patch: JsonRecord;
}

export interface SetVoteStatePayload {
  vote: VoteConfig | null;
}

export interface VoteResetAllPayload extends JsonRecord {}

export interface SubmitVotePayload {
  voteId: string;
  selectedOptionId: string;
}

export interface ScoreResetPayload extends JsonRecord {}

export interface ResetAllStatePayload extends JsonRecord {}

export interface RequestTrackPlayPayload {
  trackId: string;
}

export interface RequestTrackStopPayload {
  trackId: string;
}

export interface EconomyResetPayload extends JsonRecord {}

export interface SubmitColorChallengeChoicePayload extends JsonRecord {
  roundId?: string;
  submissionId?: string;
  choiceIndex?: number | null;
  colorId?: string;
  pressedAt?: string;
  clientTimestamp?: number;
  nextRound?: ColorChallengeRoundSnapshot | null;
}

export interface ColorChallengeResetPayload extends JsonRecord {}

export type UnifiedCommand =
  | {
      command: "set_track_state";
      targetId: string;
      payload: SetTrackStatePayload;
      timestamp: string;
    }
  | {
      command: "set_visible_tracks";
      targetId: string;
      payload: SetVisibleTracksPayload;
      timestamp: string;
    }
  | {
      command: "remove_track";
      targetId: string;
      payload: RemoveTrackPayload;
      timestamp: string;
    }
  | {
      command: "remove_group";
      targetId: string;
      payload: RemoveGroupPayload;
      timestamp: string;
    }
  | {
      command: "set_group_state";
      targetId: string;
      payload: SetGroupStatePayload;
      timestamp: string;
    }
  | {
      command: "set_module_state";
      targetId: string;
      payload: SetModuleStatePayload;
      timestamp: string;
    }
  | {
      command: "set_vote_state";
      targetId: string;
      payload: SetVoteStatePayload;
      timestamp: string;
    }
  | {
      command: "vote_reset_all";
      targetId: string;
      payload: VoteResetAllPayload;
      timestamp: string;
    }
  | {
      command: "score_reset";
      targetId: string;
      payload: ScoreResetPayload;
      timestamp: string;
    }
  | {
      command: "reset_all_state";
      targetId: string;
      payload: ResetAllStatePayload;
      timestamp: string;
    }
  | {
      command: "request_track_play";
      targetId: string;
      payload: RequestTrackPlayPayload;
      timestamp: string;
    }
  | {
      command: "request_track_stop";
      targetId: string;
      payload: RequestTrackStopPayload;
      timestamp: string;
    }
  | {
      command: "economy_reset";
      targetId: string;
      payload: EconomyResetPayload;
      timestamp: string;
    }
  | {
      command: "submit_color_challenge_choice";
      targetId: string;
      payload: SubmitColorChallengeChoicePayload;
      timestamp: string;
    }
  | {
      command: "color_challenge_reset";
      targetId: string;
      payload: ColorChallengeResetPayload;
      timestamp: string;
    };

export type ControlInputMessage = UnifiedCommand | LegacyControlMessage;

// ─── Server State ────────────────────────────────────────────────────
export interface ReceiverRegistration {
  receiverId: string;
  label?: string;
  clientInstanceId?: string;
}

export interface ReceiverState {
  receiverId: string;
  label: string;
  connected: boolean;
  configVersion: number;
  configIssuedAt: string;
  configExpiresAt: string;
  config: ReceiverConfig;
}

export interface ReceiverListUpdate {
  receivers: ReceiverState[];
}

export interface ConfigSnapshotResponse {
  ok: true;
  configTtlMs: number;
  receivers: ReceiverState[];
}

export interface PulseEvent {
  receiverId: string;
  bpm: number;
  intervalMs: number;
  sequence: number;
  timestamp: number;
}

export interface TimingInteractionValue {
  timing: boolean;
  timingValue: number;
  targetCenter: number;
  timingTolerance: number;
  delta: number;
  pulseSequence: number | null;
  pulseIntervalMs: number | null;
  pulseActive: boolean;
}

export interface TimingEventExport extends TimingInteractionValue {
  userId: string;
  receiverId: string;
  label: string;
  timestamp: number;
  isoTimestamp: string;
}

export interface TimingExport {
  generatedAt: string;
  totalAttempts: number;
  hits: number;
  misses: number;
  attempts: TimingEventExport[];
}

export interface ColorChallengeEventExport extends ColorChallengeResult {
  userId: string;
  receiverId: string;
  label: string;
  timestamp: number;
  isoTimestamp: string;
  choices: ColorChallengeColor[];
}

export interface ColorChallengeExport {
  generatedAt: string;
  totalEvents: number;
  correct: number;
  wrong: number;
  misses: number;
  gameOvers: number;
  events: ColorChallengeEventExport[];
}

export interface ScoreboardReceiverExport {
  receiverId: string;
  label: string;
  connected: boolean;
  economyRemainingSeconds: number;
  economyEnabled: boolean;
  economyGameOver: boolean;
  manualScoreValue: number;
  scoreSystemScore: number;
  scoreSystemEnabled: boolean;
  scoreSystemGameOver: boolean;
}

export interface ScoreboardExport {
  generatedAt: string;
  totalReceivers: number;
  receivers: ScoreboardReceiverExport[];
}

// ─── Unity Interaction Events ────────────────────────────────────────
export interface UnityInteractionEvent {
  sourceRole: "controller" | "receiver";
  receiverId: string | null;
  action: string;
  element: string;
  value?: unknown;
  startValue?: unknown;
  endValue?: unknown;
  interactionDuration?: number;
  timestamp: string;
}

// ─── Socket.IO Event Names ───────────────────────────────────────────
export const WS_EVENTS = {
  REGISTER_RECEIVER: "register_receiver",
  REGISTER_CONTROLLER: "register_controller",
  REGISTER_UNITY: "register_unity",
  REQUEST_RECEIVER_STATE: "request_receiver_state",
  CONTROL_MESSAGE: "control_message",
  SUBMIT_VOTE: "submit_vote",
  CLEAR_OFFLINE_RECEIVERS: "clear_offline_receivers",
  INTERACTION_EVENT: "interaction_event",
  PULSE: "pulse",

  RECEIVER_LIST: "receiver_list",
  RECEIVER_COMMAND: "receiver_command",
  RECEIVER_STATE_UPDATE: "receiver_state_update",

  CONNECT: "connect",
  DISCONNECT: "disconnect",
  CONNECTION: "connection",
} as const;

// ─── Defaults ────────────────────────────────────────────────────────
export const CONFIG_TTL_MS = 60_000;
export const DEFAULT_ICON_COLOR = "#6366f1";
export const DEFAULT_TIMING_TARGET_CENTER = 0.5;
export const DEFAULT_TIMING_TOLERANCE = 0.08;
export const DEFAULT_TRACK_CATEGORY_COLOR = "#64748b";
export const DEFAULT_COLOR_CHALLENGE_PALETTE: readonly ColorChallengeColor[] = [
  { colorId: "red", label: "Red", color: "#ef4444" },
  { colorId: "green", label: "Green", color: "#22c55e" },
  { colorId: "blue", label: "Blue", color: "#3b82f6" },
  { colorId: "yellow", label: "Yellow", color: "#eab308" },
];

export function createGeneratedId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function clampNormalizedCoordinate(value: number, fallback = 0.5) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(1, Math.max(0, value));
}

export function clamp01(value: number, fallback = 0) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(1, Math.max(0, value));
}

export function calculateColorChallengeGreenness(t: number) {
  const progress = clamp01(t, 0);
  return 1 - Math.abs(2 * progress - 1);
}

function pickRandomItem<T>(items: readonly T[]) {
  return items[Math.floor(Math.random() * items.length)]!;
}

export function hasValidColorChallengeRound(
  challenge: Pick<
    ColorChallengeConfig,
    | "iterationId"
    | "assignedColorId"
    | "choices"
    | "correctChoiceIndex"
    | "iterationStartedAt"
    | "iterationDurationMs"
  >
) {
  const correctChoiceIndex = challenge.correctChoiceIndex;

  return (
    typeof challenge.iterationId === "string" &&
    challenge.iterationId.trim().length > 0 &&
    typeof challenge.assignedColorId === "string" &&
    challenge.assignedColorId.trim().length > 0 &&
    Array.isArray(challenge.choices) &&
    challenge.choices.length === 2 &&
    Number.isInteger(correctChoiceIndex) &&
    correctChoiceIndex !== null &&
    correctChoiceIndex >= 0 &&
    correctChoiceIndex < challenge.choices.length &&
    typeof challenge.iterationStartedAt === "string" &&
    challenge.iterationStartedAt.trim().length > 0 &&
    challenge.iterationDurationMs > 0 &&
    challenge.choices.some(
      choice => choice.colorId === challenge.assignedColorId
    ) &&
    challenge.choices[correctChoiceIndex]?.colorId === challenge.assignedColorId
  );
}

export function createColorChallengeRound(
  challenge: Pick<
    ColorChallengeConfig,
    | "palette"
    | "refreshAssignedColorEachIteration"
    | "assignedColorId"
    | "minIntervalMs"
    | "maxIntervalMs"
  >,
  startedAt = new Date().toISOString()
): ColorChallengeRoundSnapshot {
  const palette =
    challenge.palette.length >= 2
      ? challenge.palette
      : DEFAULT_COLOR_CHALLENGE_PALETTE;
  const assigned =
    !challenge.refreshAssignedColorEachIteration &&
    challenge.assignedColorId !== null
      ? palette.find(color => color.colorId === challenge.assignedColorId)
      : null;
  const assignedColor = assigned ?? pickRandomItem(palette);
  const otherChoices = palette.filter(
    color => color.colorId !== assignedColor.colorId
  );
  const otherColor = pickRandomItem(otherChoices);
  const choices =
    Math.random() < 0.5
      ? [assignedColor, otherColor]
      : [otherColor, assignedColor];
  const correctChoiceIndex = choices.findIndex(
    choice => choice.colorId === assignedColor.colorId
  );
  const minIntervalMs = Math.max(1, Math.round(challenge.minIntervalMs));
  const maxIntervalMs = Math.max(minIntervalMs, Math.round(challenge.maxIntervalMs));
  const iterationDurationMs =
    maxIntervalMs <= minIntervalMs
      ? minIntervalMs
      : Math.round(
          minIntervalMs + Math.random() * (maxIntervalMs - minIntervalMs)
        );

  return {
    iterationId: createGeneratedId("color-round"),
    assignedColorId: assignedColor.colorId,
    choices: choices.map(choice => ({ ...choice })),
    correctChoiceIndex,
    iterationStartedAt: startedAt,
    iterationDurationMs,
  };
}

export function assignColorChallengeRound(
  challenge: Pick<
    ColorChallengeConfig,
    | "iterationId"
    | "assignedColorId"
    | "choices"
    | "correctChoiceIndex"
    | "iterationStartedAt"
    | "iterationDurationMs"
  >,
  round: ColorChallengeRoundSnapshot | null
) {
  if (!round) {
    challenge.iterationId = null;
    challenge.assignedColorId = null;
    challenge.choices = [];
    challenge.correctChoiceIndex = null;
    challenge.iterationStartedAt = null;
    challenge.iterationDurationMs = 0;
    return;
  }

  challenge.iterationId = round.iterationId;
  challenge.assignedColorId = round.assignedColorId;
  challenge.choices = round.choices.map(choice => ({ ...choice }));
  challenge.correctChoiceIndex = round.correctChoiceIndex;
  challenge.iterationStartedAt = round.iterationStartedAt;
  challenge.iterationDurationMs = round.iterationDurationMs;
}

export function evaluateColorChallengeRound(input: {
  challenge: Pick<
    ColorChallengeConfig,
    | "iterationId"
    | "assignedColorId"
    | "choices"
    | "correctChoiceIndex"
    | "iterationStartedAt"
    | "iterationDurationMs"
    | "maxReward"
    | "minWrongPenalty"
    | "maxWrongPenalty"
    | "missPenalty"
  >;
  choiceIndex?: number | null;
  resolvedAtMs: number;
}): Omit<ColorChallengeResult, "score" | "gameOver" | "resolvedAt" | "submissionId"> | null {
  const { challenge, resolvedAtMs } = input;
  if (!hasValidColorChallengeRound(challenge)) {
    return null;
  }

  const startedAt = challenge.iterationStartedAt;
  if (typeof startedAt !== "string") {
    return null;
  }

  const startedAtMs = new Date(startedAt).getTime();
  if (!Number.isFinite(startedAtMs)) {
    return null;
  }

  const choiceIndex =
    input.choiceIndex === null || input.choiceIndex === undefined
      ? null
      : Math.trunc(input.choiceIndex);
  if (
    choiceIndex !== null &&
    (!Number.isInteger(choiceIndex) ||
      choiceIndex < 0 ||
      choiceIndex >= challenge.choices.length)
  ) {
    return null;
  }

  const t = clamp01(
    (resolvedAtMs - startedAtMs) / Math.max(1, challenge.iterationDurationMs),
    0
  );

  if (choiceIndex === null) {
    if (t < 1) {
      return null;
    }

    return {
      reason: "miss",
      choiceIndex: null,
      colorId: null,
      assignedColorId: challenge.assignedColorId,
      correctChoiceIndex: challenge.correctChoiceIndex,
      iterationId: challenge.iterationId,
      t: 1,
      greenness: 0,
      scoreDelta: -challenge.missPenalty,
    };
  }

  if (t >= 1) {
    return {
      reason: "miss",
      choiceIndex: null,
      colorId: null,
      assignedColorId: challenge.assignedColorId,
      correctChoiceIndex: challenge.correctChoiceIndex,
      iterationId: challenge.iterationId,
      t: 1,
      greenness: 0,
      scoreDelta: -challenge.missPenalty,
    };
  }

  const chosenColor = challenge.choices[choiceIndex]!;
  const correct = choiceIndex === challenge.correctChoiceIndex;
  const greenness = calculateColorChallengeGreenness(t);

  return {
    reason: correct ? "correct" : "wrong",
    choiceIndex,
    colorId: chosenColor.colorId,
    assignedColorId: challenge.assignedColorId,
    correctChoiceIndex: challenge.correctChoiceIndex,
    iterationId: challenge.iterationId,
    t,
    greenness,
    scoreDelta: correct
      ? challenge.maxReward * greenness
      : -(
          challenge.minWrongPenalty +
          (challenge.maxWrongPenalty - challenge.minWrongPenalty) * greenness
        ),
  };
}

export function clampTimingTolerance(
  value: number,
  fallback = DEFAULT_TIMING_TOLERANCE
) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(0.5, Math.max(0, value));
}

export function resolveTimingValue(input: {
  timingValue?: number;
  pulseEnabled?: boolean;
  pulseEvent?: Pick<PulseEvent, "intervalMs" | "timestamp"> | null;
  nowMs?: number;
}) {
  const fallbackValue = clampNormalizedCoordinate(input.timingValue ?? 0, 0);
  if (
    !input.pulseEnabled ||
    !input.pulseEvent ||
    !Number.isFinite(input.nowMs) ||
    input.pulseEvent.intervalMs <= 0
  ) {
    return fallbackValue;
  }

  const elapsed = Math.max(0, (input.nowMs ?? 0) - input.pulseEvent.timestamp);
  const loopedElapsed = elapsed % input.pulseEvent.intervalMs;
  return clampNormalizedCoordinate(
    loopedElapsed / input.pulseEvent.intervalMs,
    0
  );
}

export function evaluateTimingPress(input: {
  timingValue?: number;
  targetCenter?: number;
  timingTolerance?: number;
  pulseEnabled?: boolean;
  pulseEvent?: Pick<PulseEvent, "intervalMs" | "sequence" | "timestamp"> | null;
  nowMs?: number;
}): TimingInteractionValue {
  const resolvedTimingValue = resolveTimingValue(input);
  const resolvedTargetCenter = clampNormalizedCoordinate(
    input.targetCenter ?? DEFAULT_TIMING_TARGET_CENTER,
    DEFAULT_TIMING_TARGET_CENTER
  );
  const resolvedTolerance = clampTimingTolerance(
    input.timingTolerance ?? DEFAULT_TIMING_TOLERANCE,
    DEFAULT_TIMING_TOLERANCE
  );
  const delta = Math.abs(resolvedTimingValue - resolvedTargetCenter);

  return {
    timing: delta <= resolvedTolerance,
    timingValue: resolvedTimingValue,
    targetCenter: resolvedTargetCenter,
    timingTolerance: resolvedTolerance,
    delta,
    pulseSequence: input.pulseEvent?.sequence ?? null,
    pulseIntervalMs: input.pulseEvent?.intervalMs ?? null,
    pulseActive: Boolean(input.pulseEnabled && input.pulseEvent),
  };
}

export interface TrackDefinition {
  trackId: string;
  label: string;
  url: string;
  basePrice?: number;
  durationSeconds: number;
  categoryId: string;
  categoryColor: string;
}

export const DEFAULT_TRACK_LIBRARY: readonly TrackDefinition[] =
  GENERATED_TRACK_LIBRARY;

export const AUDIO_URLS = DEFAULT_TRACK_LIBRARY.reduce<Record<string, string>>(
  (acc, track) => {
    acc[track.trackId] = track.url;
    return acc;
  },
  {}
);

export function createDefaultEconomyConfig(
  nowIso = new Date().toISOString()
): EconomyConfig {
  return {
    visible: true,
    enabled: false,
    currencySeconds: 30,
    startingSeconds: 30,
    earnRatePerSecond: 0.25,
    refreshIntervalMs: 30_000,
    inflation: 1,
    inflationGrowthPerSecond: 0.025,
    inflationGrowsWhilePlaying: true,
    currentTrackId: null,
    playStartedAt: null,
    playEndsAt: null,
    gameOver: false,
    lastUpdatedAt: nowIso,
    lastError: null,
  };
}

export function advanceEconomyInflation(
  inflation: number,
  inflationGrowthPerSecond: number,
  elapsedSeconds: number
) {
  const safeInflation = Math.max(0, inflation);
  const safeGrowthRate = Math.max(0, inflationGrowthPerSecond);
  const safeElapsedSeconds = Math.max(0, elapsedSeconds);

  if (
    safeInflation === 0 ||
    safeGrowthRate === 0 ||
    safeElapsedSeconds === 0
  ) {
    return safeInflation;
  }

  return safeInflation * Math.exp(safeGrowthRate * safeElapsedSeconds);
}

export function createDefaultColorChallengeConfig(): ColorChallengeConfig {
  return {
    visible: false,
    enabled: false,
    score: 1,
    startingScore: 1,
    iterationId: null,
    assignedColorId: null,
    palette: DEFAULT_COLOR_CHALLENGE_PALETTE.map(color => ({ ...color })),
    choices: [],
    correctChoiceIndex: null,
    iterationStartedAt: null,
    iterationDurationMs: 2500,
    minIntervalMs: 2000,
    maxIntervalMs: 3000,
    maxReward: 3,
    minWrongPenalty: 0.5,
    maxWrongPenalty: 1.5,
    missPenalty: 1,
    refreshAssignedColorEachIteration: true,
    gameOver: false,
    lastResult: null,
  };
}

export function calculateTrackCost(
  track: Pick<TrackState, "basePrice" | "durationSeconds">,
  economy: Pick<EconomyConfig, "inflation">
) {
  const resolvedBasePrice =
    Number.isFinite(track.basePrice) && track.basePrice > 0
      ? track.basePrice
      : track.durationSeconds;

  if (!Number.isFinite(resolvedBasePrice) || resolvedBasePrice <= 0) {
    return null;
  }

  return resolvedBasePrice * Math.max(0, economy.inflation);
}

export function createDefaultTracks(): TrackState[] {
  return DEFAULT_TRACK_LIBRARY.map(track => ({
    ...track,
    basePrice:
      typeof track.basePrice === "number" && Number.isFinite(track.basePrice)
        ? Math.max(0, track.basePrice)
        : Math.max(0, track.durationSeconds),
    visible: false,
    enabled: true,
    playing: false,
    playable: true,
    loopEnabled: false,
    loopControlVisible: true,
    loopControlLocked: false,
    volumeValue: 1,
    volumeControlVisible: false,
    volumeControlEnabled: true,
    tempoFlashEnabled: false,
    fillTime: 1,
    groupId: null,
  }));
}

export function createDefaultReceiverConfig(): ReceiverConfig {
  return {
    tracks: createDefaultTracks(),
    groups: [],
    pulse: {
      visible: false,
      enabled: false,
      active: false,
      bpm: 90,
    },
    vote: null,
    score: {
      visible: false,
      enabled: false,
      value: 0,
    },
    map: {
      visible: false,
      enabled: false,
      playerPosX: 0.5,
      playerPosY: 0.5,
      movement: null,
    },
    timing: {
      visible: false,
      enabled: false,
      timingValue: 0,
      targetCenter: DEFAULT_TIMING_TARGET_CENTER,
      timingTolerance: DEFAULT_TIMING_TOLERANCE,
      startedAt: null,
      durationMs: null,
      remainingMs: null,
    },
    textDisplay: {
      visible: false,
      enabled: true,
      text: "",
    },
    visuals: {
      visible: true,
      enabled: true,
      iconColor: DEFAULT_ICON_COLOR,
    },
    economy: createDefaultEconomyConfig(),
    colorChallenge: createDefaultColorChallengeConfig(),
  };
}

// ─── Compatibility Helpers ───────────────────────────────────────────
export function isLegacyMessageType(value: unknown): value is MessageType {
  return (
    value === "audio_control" ||
    value === "audio_playable" ||
    value === "color_change" ||
    value === "text_message"
  );
}

export function legacyTrackIdToTrackKey(trackId: 1 | 2): string {
  return trackId === 1 ? "track_01" : "track_02";
}

export function trackKeyToLegacyTrackId(trackId: string): 1 | 2 | null {
  if (trackId === "track_01") {
    return 1;
  }
  if (trackId === "track_02") {
    return 2;
  }
  return null;
}

export function legacyControlMessageToUnifiedCommand(
  message: LegacyControlMessage
): UnifiedCommand {
  switch (message.type) {
    case "audio_control": {
      const payload = message.payload as AudioControlPayload;
      return {
        command: "set_track_state",
        targetId: message.targetId,
        payload: {
          trackId: legacyTrackIdToTrackKey(payload.trackId),
          patch: {
            playing: payload.action === "play",
          },
        },
        timestamp: message.timestamp,
      };
    }
    case "audio_playable": {
      const payload = message.payload as AudioPlayablePayload;
      return {
        command: "set_track_state",
        targetId: message.targetId,
        payload: {
          trackId: legacyTrackIdToTrackKey(payload.trackId),
          patch: {
            playable: payload.playable,
            ...(payload.playable ? {} : { playing: false }),
          },
        },
        timestamp: message.timestamp,
      };
    }
    case "color_change": {
      const payload = message.payload as ColorChangePayload;
      return {
        command: "set_module_state",
        targetId: message.targetId,
        payload: {
          module: "visuals",
          patch: { iconColor: payload.color },
        },
        timestamp: message.timestamp,
      };
    }
    case "text_message": {
      const payload = message.payload as TextMessagePayload;
      return {
        command: "set_module_state",
        targetId: message.targetId,
        payload: {
          module: "textDisplay",
          patch: {
            text: payload.text,
            visible: true,
          },
        },
        timestamp: message.timestamp,
      };
    }
  }
}
