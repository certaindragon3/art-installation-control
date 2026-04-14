import { useCallback, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import {
  type PulseEvent,
  type ReceiverListUpdate,
  type ReceiverState,
  type SubmitVotePayload,
  type UnifiedCommand,
  type UnityInteractionEvent,
  WS_EVENTS,
} from "@shared/wsTypes";

const RECEIVER_CLIENT_INSTANCE_ID_STORAGE_KEY =
  "art-installation:receiver-client-instance-id";

interface UseSocketOptions {
  role: "controller" | "receiver" | "unity";
  receiverId?: string;
  receiverLabel?: string;
}

interface UseSocketReturn {
  connected: boolean;
  receivers: ReceiverState[];
  receiverState: ReceiverState | null;
  pulseEvent: PulseEvent | null;
  sendCommand: (command: UnifiedCommand) => void;
  submitVote: (payload: SubmitVotePayload) => void;
  postInteraction: (event: UnityInteractionEvent) => void;
  clearOfflineReceivers: () => void;
  requestReceiverState: () => void;
}

function createClientInstanceId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `receiver-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getReceiverClientInstanceId() {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const existing = window.sessionStorage.getItem(
      RECEIVER_CLIENT_INSTANCE_ID_STORAGE_KEY
    );
    if (existing) {
      return existing;
    }

    const next = createClientInstanceId();
    window.sessionStorage.setItem(
      RECEIVER_CLIENT_INSTANCE_ID_STORAGE_KEY,
      next
    );
    return next;
  } catch {
    return createClientInstanceId();
  }
}

export function useSocket(options: UseSocketOptions): UseSocketReturn {
  const { role, receiverId, receiverLabel } = options;
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [receivers, setReceivers] = useState<ReceiverState[]>([]);
  const [receiverState, setReceiverState] = useState<ReceiverState | null>(
    null
  );
  const [pulseEvent, setPulseEvent] = useState<PulseEvent | null>(null);

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
          clientInstanceId: getReceiverClientInstanceId(),
        });
      }
    });

    socket.on(WS_EVENTS.DISCONNECT, () => {
      setConnected(false);
      setPulseEvent(null);
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
      socket.on(WS_EVENTS.PULSE, (event: PulseEvent) => {
        setPulseEvent(event);
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

  const submitVote = useCallback(
    (payload: SubmitVotePayload) => {
      if (!socketRef.current?.connected || role !== "receiver") {
        return;
      }

      socketRef.current.emit(WS_EVENTS.SUBMIT_VOTE, payload);
    },
    [role]
  );

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
    pulseEvent,
    sendCommand,
    submitVote,
    postInteraction,
    clearOfflineReceivers,
    requestReceiverState,
  };
}
