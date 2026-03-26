/**
 * WebSocket Message Types for Art Installation Control System
 *
 * All messages between Controller, Server, and Receiver follow these schemas.
 */

// ─── Message Type Enum ───────────────────────────────────────────────
export type MessageType =
  | "audio_control"
  | "audio_playable"
  | "color_change"
  | "text_message";

// ─── Audio Control ───────────────────────────────────────────────────
export interface AudioControlPayload {
  /** Which audio track: 1 or 2 */
  trackId: 1 | 2;
  /** Action to perform */
  action: "play" | "pause";
}

export interface AudioPlayablePayload {
  /** Which audio track: 1 or 2 */
  trackId: 1 | 2;
  /** Whether the track is playable */
  playable: boolean;
}

// ─── Color Change ────────────────────────────────────────────────────
export interface ColorChangePayload {
  /** CSS color value, e.g. "#ff0000", "rgb(255,0,0)" */
  color: string;
}

// ─── Text Message ────────────────────────────────────────────────────
export interface TextMessagePayload {
  /** The text content to display */
  text: string;
}

// ─── Unified Payload Union ───────────────────────────────────────────
export type MessagePayload =
  | AudioControlPayload
  | AudioPlayablePayload
  | ColorChangePayload
  | TextMessagePayload;

// ─── Control Message (Controller → Server → Receiver) ────────────────
export interface ControlMessage {
  /** Message type identifier */
  type: MessageType;
  /** Target receiver ID. Use "*" for broadcast to all receivers. */
  targetId: string;
  /** Message payload varies by type */
  payload: MessagePayload;
  /** ISO 8601 timestamp */
  timestamp: string;
}

// ─── Server Events ───────────────────────────────────────────────────

/** Receiver registration info sent to server */
export interface ReceiverRegistration {
  receiverId: string;
  label?: string;
}

/** Receiver state tracked by the server */
export interface ReceiverState {
  receiverId: string;
  label: string;
  connected: boolean;
  /** Current state of audio tracks */
  audio: {
    track1: { playing: boolean; playable: boolean };
    track2: { playing: boolean; playable: boolean };
  };
  /** Current icon color */
  iconColor: string;
  /** Last text message received */
  lastMessage: string;
}

/** Event: full list of receivers sent to controller */
export interface ReceiverListUpdate {
  receivers: ReceiverState[];
}

// ─── Socket.IO Event Names ───────────────────────────────────────────
export const WS_EVENTS = {
  // Client → Server
  REGISTER_RECEIVER: "register_receiver",
  REGISTER_CONTROLLER: "register_controller",
  CONTROL_MESSAGE: "control_message",
  CLEAR_OFFLINE_RECEIVERS: "clear_offline_receivers",

  // Server → Client
  RECEIVER_LIST: "receiver_list",
  RECEIVER_COMMAND: "receiver_command",
  RECEIVER_STATE_UPDATE: "receiver_state_update",

  // Built-in
  CONNECT: "connect",
  DISCONNECT: "disconnect",
  CONNECTION: "connection",
} as const;

// ─── Audio URLs ──────────────────────────────────────────────────────
export const AUDIO_URLS = {
  track1: "/audio/boing.mp3",
  track2: "/audio/womp-womp.mp3",
} as const;
