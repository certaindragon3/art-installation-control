/**
 * Shared WebSocket and HTTP protocol types.
 *
 * Phase 1 keeps the legacy control message structure for backward-compatible
 * inputs, but the runtime architecture is driven by unified commands and full
 * receiver config snapshots.
 */

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

export type VoteCloseReason =
  | "timeout"
  | "manual_close"
  | "replaced"
  | "reset";

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

export interface MapConfig extends VisibilityConfig {
  playerPosX: number;
  playerPosY: number;
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
}

export type ModuleName =
  | "pulse"
  | "score"
  | "map"
  | "timing"
  | "textDisplay"
  | "visuals";

// ─── Unified Commands ────────────────────────────────────────────────
export interface SetTrackStatePayload {
  trackId: string;
  patch: Partial<TrackState>;
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

export type UnifiedCommand =
  | {
      command: "set_track_state";
      targetId: string;
      payload: SetTrackStatePayload;
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
    };

export type ControlInputMessage = UnifiedCommand | LegacyControlMessage;

// ─── Server State ────────────────────────────────────────────────────
export interface ReceiverRegistration {
  receiverId: string;
  label?: string;
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

export function clampNormalizedCoordinate(value: number, fallback = 0.5) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(1, Math.max(0, value));
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
  return clampNormalizedCoordinate(elapsed / input.pulseEvent.intervalMs, 0);
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
}

export const DEFAULT_TRACK_LIBRARY: TrackDefinition[] = [
  {
    trackId: "track_01",
    label: "Boing",
    url: "/audio/boing.mp3",
  },
  {
    trackId: "track_02",
    label: "Womp Womp",
    url: "/audio/womp-womp.mp3",
  },
];

export const AUDIO_URLS = DEFAULT_TRACK_LIBRARY.reduce<Record<string, string>>(
  (acc, track) => {
    acc[track.trackId] = track.url;
    return acc;
  },
  {}
);

export function createDefaultTracks(): TrackState[] {
  return DEFAULT_TRACK_LIBRARY.map(track => ({
    ...track,
    visible: true,
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
