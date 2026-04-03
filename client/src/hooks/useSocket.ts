import { useCallback, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import {
  type ReceiverListUpdate,
  type ReceiverState,
  type UnifiedCommand,
  type UnityInteractionEvent,
  WS_EVENTS,
} from "@shared/wsTypes";

interface UseSocketOptions {
  role: "controller" | "receiver" | "unity";
  receiverId?: string;
  receiverLabel?: string;
}

interface UseSocketReturn {
  connected: boolean;
  receivers: ReceiverState[];
  receiverState: ReceiverState | null;
  sendCommand: (command: UnifiedCommand) => void;
  postInteraction: (event: UnityInteractionEvent) => void;
  clearOfflineReceivers: () => void;
  requestReceiverState: () => void;
}

export function useSocket(options: UseSocketOptions): UseSocketReturn {
  const { role, receiverId, receiverLabel } = options;
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [receivers, setReceivers] = useState<ReceiverState[]>([]);
  const [receiverState, setReceiverState] = useState<ReceiverState | null>(null);

  useEffect(() => {
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

      if (role === "controller") {
        socket.emit(WS_EVENTS.REGISTER_CONTROLLER);
        return;
      }

      if (role === "unity") {
        socket.emit(WS_EVENTS.REGISTER_UNITY);
        return;
      }

      if (receiverId) {
        socket.emit(WS_EVENTS.REGISTER_RECEIVER, {
          receiverId,
          label: receiverLabel || `Receiver ${receiverId}`,
        });
      }
    });

    socket.on(WS_EVENTS.DISCONNECT, () => {
      setConnected(false);
    });

    if (role === "controller") {
      socket.on(WS_EVENTS.RECEIVER_LIST, (data: ReceiverListUpdate) => {
        setReceivers(data.receivers);
      });
    }

    if (role === "receiver") {
      socket.on(WS_EVENTS.RECEIVER_STATE_UPDATE, (state: ReceiverState) => {
        setReceiverState(state);
      });
    }

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [receiverId, receiverLabel, role]);

  const sendCommand = useCallback((command: UnifiedCommand) => {
    if (!socketRef.current?.connected) {
      return;
    }

    socketRef.current.emit(WS_EVENTS.CONTROL_MESSAGE, command);
  }, []);

  const postInteraction = useCallback((event: UnityInteractionEvent) => {
    if (!socketRef.current?.connected) {
      return;
    }

    socketRef.current.emit(WS_EVENTS.INTERACTION_EVENT, event);
  }, []);

  const clearOfflineReceivers = useCallback(() => {
    if (!socketRef.current?.connected || role !== "controller") {
      return;
    }

    socketRef.current.emit(WS_EVENTS.CLEAR_OFFLINE_RECEIVERS);
  }, [role]);

  const requestReceiverState = useCallback(() => {
    if (!socketRef.current?.connected || role !== "receiver") {
      return;
    }

    socketRef.current.emit(WS_EVENTS.REQUEST_RECEIVER_STATE);
  }, [role]);

  return {
    connected,
    receivers,
    receiverState,
    sendCommand,
    postInteraction,
    clearOfflineReceivers,
    requestReceiverState,
  };
}
