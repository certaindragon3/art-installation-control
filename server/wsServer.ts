import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import {
  ControlMessage,
  ReceiverRegistration,
  ReceiverState,
  WS_EVENTS,
} from "../shared/wsTypes";

/**
 * In-memory store of all receiver states, keyed by receiverId.
 */
const receivers = new Map<string, ReceiverState & { socketId: string }>();

/**
 * Set of controller socket IDs for broadcasting receiver list updates.
 */
const controllers = new Set<string>();

let io: Server;

/**
 * Create default receiver state for a newly registered receiver.
 */
function createDefaultState(
  receiverId: string,
  label: string,
  socketId: string
): ReceiverState & { socketId: string } {
  return {
    receiverId,
    label,
    socketId,
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
  const list = Array.from(receivers.values()).map(
    ({ socketId, ...state }) => state
  );
  Array.from(controllers).forEach((controllerId) => {
    io.to(controllerId).emit(WS_EVENTS.RECEIVER_LIST, { receivers: list });
  });
}

/**
 * Initialize the Socket.IO server and attach event handlers.
 */
export function initWebSocket(httpServer: HttpServer): Server {
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
      const list = Array.from(receivers.values()).map(
        ({ socketId, ...state }) => state
      );
      socket.emit(WS_EVENTS.RECEIVER_LIST, { receivers: list });
    });

    // ─── Receiver Registration ─────────────────────────────────────
    socket.on(
      WS_EVENTS.REGISTER_RECEIVER,
      (data: ReceiverRegistration) => {
        const { receiverId, label } = data;
        const displayLabel = label || `Receiver ${receiverId}`;

        // Check if this receiver ID was previously registered
        const existing = receivers.get(receiverId);
        if (existing) {
          // Reconnection: update socket ID and mark connected
          existing.socketId = socket.id;
          existing.connected = true;
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
        const { socketId: _sid, ...stateWithoutSocket } = state;
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

      if (msg.targetId === "*") {
        // Broadcast to all receivers
        Array.from(receivers.entries()).forEach(([rid, state]) => {
          applyCommand(state, msg);
          io.to(`receiver:${rid}`).emit(WS_EVENTS.RECEIVER_COMMAND, msg);
        });
      } else {
        // Targeted message
        const state = receivers.get(msg.targetId);
        if (state) {
          applyCommand(state, msg);
          io.to(`receiver:${msg.targetId}`).emit(
            WS_EVENTS.RECEIVER_COMMAND,
            msg
          );
        } else {
          console.warn(`[WS] Target receiver not found: ${msg.targetId}`);
        }
      }

      // Update controllers with new state
      broadcastReceiverList();
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
          state.audio.track1.playing = false;
          state.audio.track2.playing = false;
        }
      });

      broadcastReceiverList();
    });
  });

  console.log("[WS] Socket.IO server initialized");
  return io;
}

/**
 * Apply a control message to the server-side receiver state.
 * This keeps the server as the single source of truth.
 */
function applyCommand(
  state: ReceiverState & { socketId: string },
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
