import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { WS_EVENTS } from "@shared/wsTypes";
import type {
  ControlMessage,
  ReceiverState,
  ReceiverListUpdate,
} from "@shared/wsTypes";

interface UseSocketOptions {
  role: "controller" | "receiver";
  receiverId?: string;
  receiverLabel?: string;
}

interface UseSocketReturn {
  connected: boolean;
  receivers: ReceiverState[];
  receiverState: ReceiverState | null;
  sendCommand: (msg: ControlMessage) => void;
}

export function useSocket(options: UseSocketOptions): UseSocketReturn {
  const { role, receiverId, receiverLabel } = options;
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [receivers, setReceivers] = useState<ReceiverState[]>([]);
  const [receiverState, setReceiverState] = useState<ReceiverState | null>(null);

  useEffect(() => {
    // Connect to the same origin (works in both dev and production)
    const socket = io({
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socketRef.current = socket;

    socket.on(WS_EVENTS.CONNECT, () => {
      setConnected(true);
      console.log(`[Socket] Connected as ${role}`);

      if (role === "controller") {
        socket.emit(WS_EVENTS.REGISTER_CONTROLLER);
      } else if (role === "receiver" && receiverId) {
        socket.emit(WS_EVENTS.REGISTER_RECEIVER, {
          receiverId,
          label: receiverLabel || `Receiver ${receiverId}`,
        });
      }
    });

    socket.on(WS_EVENTS.DISCONNECT, () => {
      setConnected(false);
      console.log("[Socket] Disconnected");
    });

    // Controller: receive updated receiver list
    if (role === "controller") {
      socket.on(WS_EVENTS.RECEIVER_LIST, (data: ReceiverListUpdate) => {
        setReceivers(data.receivers);
      });
    }

    // Receiver: receive commands and state updates
    if (role === "receiver") {
      socket.on(WS_EVENTS.RECEIVER_COMMAND, (msg: ControlMessage) => {
        // This will be handled by the Receiver page component
        window.dispatchEvent(
          new CustomEvent("receiver_command", { detail: msg })
        );
      });

      socket.on(WS_EVENTS.RECEIVER_STATE_UPDATE, (state: ReceiverState) => {
        setReceiverState(state);
      });
    }

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [role, receiverId, receiverLabel]);

  const sendCommand = useCallback((msg: ControlMessage) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit(WS_EVENTS.CONTROL_MESSAGE, msg);
    }
  }, []);

  return { connected, receivers, receiverState, sendCommand };
}
