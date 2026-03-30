import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import {
  ControlMessage,
  ReceiverRegistration,
  ReceiverState,
  WS_EVENTS,
} from "../shared/wsTypes";

type InternalReceiverState = ReceiverState & {
  socketId: string;
  disconnectedAt: number | null;
};

const RECEIVER_RETENTION_MS = 10 * 60 * 1000;
const RECEIVER_CLEANUP_INTERVAL_MS = 60 * 1000;

/**
 * In-memory store of all receiver states, keyed by receiverId.
 */
const receivers = new Map<string, InternalReceiverState>();

/**
 * Set of controller socket IDs for broadcasting receiver list updates.
 */
const controllers = new Set<string>();

let io: Server | null = null;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Create default receiver state for a newly registered receiver.
 */
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
    audio: {
      track1: { playing: false, playable: true },
      track2: { playing: false, playable: true },
    },
    iconColor: "#6366f1",
    lastMessage: "",
  };
}

/**
 * Broadcast the current receiver list to all connected controllers.
 */
function broadcastReceiverList() {
  if (!io) {
    return;
  }

  const socketServer = io;
  const list = getReceiverList();
  Array.from(controllers).forEach((controllerId) => {
    socketServer.to(controllerId).emit(WS_EVENTS.RECEIVER_LIST, {
      receivers: list,
    });
  });
}

export function getReceiverList(): ReceiverState[] {
  return Array.from(receivers.values()).map(
    ({ socketId, disconnectedAt, ...state }) => state
  );
}

function removeDisconnectedReceivers(): string[] {
  const removedIds: string[] = [];

  Array.from(receivers.entries()).forEach(([receiverId, state]) => {
    if (!state.connected) {
      receivers.delete(receiverId);
      removedIds.push(receiverId);
    }
  });

  return removedIds;
}

function removeExpiredReceivers(now = Date.now()): string[] {
  const removedIds: string[] = [];

  Array.from(receivers.entries()).forEach(([receiverId, state]) => {
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

/**
 * Initialize the Socket.IO server and attach event handlers.
 */
export function initWebSocket(httpServer: HttpServer): Server {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
  }

  io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    // Optimize for China network environment
    transports: ["websocket", "polling"],
    pingInterval: 10000,
    pingTimeout: 5000,
  });

  io.on(WS_EVENTS.CONNECTION, (socket: Socket) => {
    console.log(`[WS] Client connected: ${socket.id}`);

    // ─── Controller Registration ───────────────────────────────────
    socket.on(WS_EVENTS.REGISTER_CONTROLLER, () => {
      controllers.add(socket.id);
      console.log(`[WS] Controller registered: ${socket.id}`);

      // Send current receiver list immediately
      socket.emit(WS_EVENTS.RECEIVER_LIST, { receivers: getReceiverList() });
    });

    // ─── Receiver Registration ─────────────────────────────────────
    socket.on(
      WS_EVENTS.REGISTER_RECEIVER,
      (data: ReceiverRegistration) => {
        const receiverId = data.receiverId.trim();
        const label = data.label?.trim();

        if (!receiverId || receiverId === "*") {
          console.warn(`[WS] Rejected invalid receiver ID from ${socket.id}`);
          return;
        }

        const displayLabel = label || `Receiver ${receiverId}`;

        // Check if this receiver ID was previously registered
        const existing = receivers.get(receiverId);
        if (existing) {
          // Reconnection: update socket ID and mark connected
          existing.socketId = socket.id;
          existing.connected = true;
          existing.disconnectedAt = null;
          existing.label = displayLabel;
          console.log(`[WS] Receiver reconnected: ${receiverId} (${socket.id})`);
        } else {
          // New receiver
          receivers.set(
            receiverId,
            createDefaultState(receiverId, displayLabel, socket.id)
          );
          console.log(`[WS] Receiver registered: ${receiverId} (${socket.id})`);
        }

        // Join a room named after the receiver ID for targeted messaging
        socket.join(`receiver:${receiverId}`);

        // Send current state back to the receiver
        const state = receivers.get(receiverId)!;
        const {
          socketId: _sid,
          disconnectedAt: _disconnectedAt,
          ...stateWithoutSocket
        } = state;
        socket.emit(WS_EVENTS.RECEIVER_STATE_UPDATE, stateWithoutSocket);

        // Notify all controllers
        broadcastReceiverList();
      }
    );

    // ─── Control Message (from Controller) ─────────────────────────
    socket.on(WS_EVENTS.CONTROL_MESSAGE, (msg: ControlMessage) => {
      console.log(
        `[WS] Control message: type=${msg.type}, target=${msg.targetId}`
      );
      dispatchControlMessage(msg);
    });

    socket.on(WS_EVENTS.CLEAR_OFFLINE_RECEIVERS, () => {
      if (!controllers.has(socket.id)) {
        console.warn(
          `[WS] Ignored offline receiver cleanup from non-controller ${socket.id}`
        );
        return;
      }

      const removedIds = clearOfflineReceivers();
      if (removedIds.length > 0) {
        console.log(`[WS] Cleared offline receivers: ${removedIds.join(", ")}`);
      }
    });

    // ─── Disconnect ────────────────────────────────────────────────
    socket.on(WS_EVENTS.DISCONNECT, () => {
      console.log(`[WS] Client disconnected: ${socket.id}`);

      // Remove from controllers
      controllers.delete(socket.id);

      // Mark receiver as disconnected (but keep state)
      Array.from(receivers.values()).forEach((state) => {
        if (state.socketId === socket.id) {
          state.connected = false;
          state.disconnectedAt = Date.now();
          state.audio.track1.playing = false;
          state.audio.track2.playing = false;
        }
      });

      broadcastReceiverList();
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
}

export function dispatchControlMessage(
  msg: ControlMessage
): DispatchControlResult {
  if (!io) {
    throw new Error("Socket.IO server not initialized");
  }

  if (msg.targetId === "*") {
    const deliveredReceiverIds = Array.from(receivers.entries()).map(
      ([receiverId, state]) => {
        applyCommand(state, msg);
        io!.to(`receiver:${receiverId}`).emit(WS_EVENTS.RECEIVER_COMMAND, msg);
        return receiverId;
      }
    );

    broadcastReceiverList();
    return {
      broadcast: true,
      deliveredReceiverIds,
      missingTargetId: null,
    };
  }

  const state = receivers.get(msg.targetId);
  if (!state) {
    console.warn(`[WS] Target receiver not found: ${msg.targetId}`);
    return {
      broadcast: false,
      deliveredReceiverIds: [],
      missingTargetId: msg.targetId,
    };
  }

  applyCommand(state, msg);
  io.to(`receiver:${msg.targetId}`).emit(WS_EVENTS.RECEIVER_COMMAND, msg);
  broadcastReceiverList();

  return {
    broadcast: false,
    deliveredReceiverIds: [msg.targetId],
    missingTargetId: null,
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

/**
 * Apply a control message to the server-side receiver state.
 * This keeps the server as the single source of truth.
 */
function applyCommand(
  state: InternalReceiverState,
  msg: ControlMessage
): void {
  switch (msg.type) {
    case "audio_control": {
      const payload = msg.payload as { trackId: 1 | 2; action: "play" | "pause" };
      const track = payload.trackId === 1 ? state.audio.track1 : state.audio.track2;
      if (payload.action === "play" && track.playable) {
        track.playing = true;
      } else if (payload.action === "pause") {
        track.playing = false;
      }
      break;
    }
    case "audio_playable": {
      const payload = msg.payload as { trackId: 1 | 2; playable: boolean };
      const track = payload.trackId === 1 ? state.audio.track1 : state.audio.track2;
      track.playable = payload.playable;
      if (!payload.playable) {
        track.playing = false;
      }
      break;
    }
    case "color_change": {
      const payload = msg.payload as { color: string };
      state.iconColor = payload.color;
      break;
    }
    case "text_message": {
      const payload = msg.payload as { text: string };
      state.lastMessage = payload.text;
      break;
    }
  }
}
