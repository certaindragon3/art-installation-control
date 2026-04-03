import { useCallback, useRef } from "react";
import type { UnityInteractionEvent } from "@shared/wsTypes";

interface UsePostToUnityOptions {
  sourceRole: "controller" | "receiver";
  receiverId?: string | null;
  postInteraction: (event: UnityInteractionEvent) => void;
}

interface DiscreteInteractionInput {
  action: string;
  element: string;
  value?: unknown;
  receiverId?: string | null;
}

interface ContinuousInteractionInput {
  element: string;
  startValue: unknown;
  receiverId?: string | null;
}

interface ContinuousInteractionEndInput {
  element: string;
  endValue: unknown;
  receiverId?: string | null;
}

type ActiveInteraction = {
  startedAt: number;
  startValue: unknown;
  receiverId: string | null;
};

export function usePostToUnity(options: UsePostToUnityOptions) {
  const { sourceRole, receiverId, postInteraction } = options;
  const activeInteractionsRef = useRef<Map<string, ActiveInteraction>>(new Map());

  const resolveReceiverId = useCallback(
    (value?: string | null) => value ?? receiverId ?? null,
    [receiverId]
  );

  const postDiscreteInteraction = useCallback(
    (input: DiscreteInteractionInput) => {
      postInteraction({
        sourceRole,
        receiverId: resolveReceiverId(input.receiverId),
        action: input.action,
        element: input.element,
        value: input.value,
        timestamp: new Date().toISOString(),
      });
    },
    [postInteraction, resolveReceiverId, sourceRole]
  );

  const beginContinuousInteraction = useCallback(
    (input: ContinuousInteractionInput) => {
      if (activeInteractionsRef.current.has(input.element)) {
        return;
      }

      const nextReceiverId = resolveReceiverId(input.receiverId);
      activeInteractionsRef.current.set(input.element, {
        startedAt: Date.now(),
        startValue: input.startValue,
        receiverId: nextReceiverId,
      });

      postInteraction({
        sourceRole,
        receiverId: nextReceiverId,
        action: "startInteraction",
        element: input.element,
        startValue: input.startValue,
        timestamp: new Date().toISOString(),
      });
    },
    [postInteraction, resolveReceiverId, sourceRole]
  );

  const endContinuousInteraction = useCallback(
    (input: ContinuousInteractionEndInput) => {
      const active = activeInteractionsRef.current.get(input.element);
      if (!active) {
        return;
      }

      const nextReceiverId = resolveReceiverId(input.receiverId);
      const startedAt = active.startedAt;

      postInteraction({
        sourceRole,
        receiverId: active.receiverId ?? nextReceiverId,
        action: "endInteraction",
        element: input.element,
        startValue: active.startValue,
        endValue: input.endValue,
        interactionDuration: Math.max(0, Date.now() - startedAt),
        timestamp: new Date().toISOString(),
      });

      activeInteractionsRef.current.delete(input.element);
    },
    [postInteraction, resolveReceiverId, sourceRole]
  );

  return {
    postDiscreteInteraction,
    beginContinuousInteraction,
    endContinuousInteraction,
  };
}
