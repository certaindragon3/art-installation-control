import type { Express, Request, Response } from "express";
import type {
  ControlInputMessage,
  ControlMessage,
  JsonRecord,
  MessagePayload,
  MessageType,
  ModuleName,
  UnifiedCommand,
  VoteConfig,
} from "../shared/wsTypes";
import { isLegacyMessageType, WS_EVENTS } from "../shared/wsTypes";
import {
  clearOfflineReceivers,
  dispatchControlMessage,
  getConfigSnapshot,
  getReceiverList,
} from "./wsServer";

const UNIFIED_COMMANDS = new Set<UnifiedCommand["command"]>([
  "set_track_state",
  "remove_track",
  "set_group_state",
  "set_module_state",
  "set_vote_state",
  "reset_all_state",
]);

const MODULE_NAMES = new Set<ModuleName>([
  "pulse",
  "score",
  "map",
  "timing",
  "textDisplay",
  "visuals",
]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function badRequest(res: Response, error: string) {
  return res.status(400).json({ ok: false, error });
}

function normalizeLegacyPayload(
  type: MessageType,
  payload: unknown
): MessagePayload | null {
  if (!isRecord(payload)) {
    return null;
  }

  switch (type) {
    case "audio_control": {
      if (
        (payload.trackId === 1 || payload.trackId === 2) &&
        (payload.action === "play" || payload.action === "pause")
      ) {
        return { trackId: payload.trackId, action: payload.action };
      }
      return null;
    }
    case "audio_playable": {
      if (
        (payload.trackId === 1 || payload.trackId === 2) &&
        typeof payload.playable === "boolean"
      ) {
        return { trackId: payload.trackId, playable: payload.playable };
      }
      return null;
    }
    case "color_change": {
      if (typeof payload.color === "string" && payload.color.trim()) {
        return { color: payload.color.trim() };
      }
      return null;
    }
    case "text_message": {
      if (typeof payload.text === "string" && payload.text.trim()) {
        return { text: payload.text.trim() };
      }
      return null;
    }
  }
}

function normalizeLegacyControlMessage(body: JsonRecord): ControlMessage | null {
  if (!isLegacyMessageType(body.type)) {
    return null;
  }

  if (typeof body.targetId !== "string" || !body.targetId.trim()) {
    return null;
  }

  const payload = normalizeLegacyPayload(body.type, body.payload);
  if (!payload) {
    return null;
  }

  return {
    type: body.type,
    targetId: body.targetId.trim(),
    payload,
    timestamp:
      typeof body.timestamp === "string" && body.timestamp.trim()
        ? body.timestamp
        : new Date().toISOString(),
  };
}

function normalizeVoteConfig(value: unknown): VoteConfig | null {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.title !== "string") {
    return null;
  }

  if (!Array.isArray(value.options)) {
    return null;
  }

  return {
    title: value.title,
    visible: typeof value.visible === "boolean" ? value.visible : true,
    enabled: typeof value.enabled === "boolean" ? value.enabled : true,
    options: value.options
      .filter(isRecord)
      .filter(
        (option): option is { id: string; label: string } =>
          typeof option.id === "string" && typeof option.label === "string"
      )
      .map((option) => ({
        id: option.id,
        label: option.label,
      })),
    selectedOptionId:
      typeof value.selectedOptionId === "string" ? value.selectedOptionId : null,
  };
}

function normalizeUnifiedCommand(body: JsonRecord): UnifiedCommand | null {
  if (
    typeof body.command !== "string" ||
    !UNIFIED_COMMANDS.has(body.command as UnifiedCommand["command"])
  ) {
    return null;
  }

  if (typeof body.targetId !== "string" || !body.targetId.trim()) {
    return null;
  }

  const timestamp =
    typeof body.timestamp === "string" && body.timestamp.trim()
      ? body.timestamp
      : new Date().toISOString();

  switch (body.command) {
    case "set_track_state": {
      if (!isRecord(body.payload) || typeof body.payload.trackId !== "string") {
        return null;
      }

      return {
        command: "set_track_state",
        targetId: body.targetId.trim(),
        payload: {
          trackId: body.payload.trackId,
          patch: isRecord(body.payload.patch) ? body.payload.patch : {},
        },
        timestamp,
      };
    }
    case "remove_track": {
      if (!isRecord(body.payload) || typeof body.payload.trackId !== "string") {
        return null;
      }

      return {
        command: "remove_track",
        targetId: body.targetId.trim(),
        payload: {
          trackId: body.payload.trackId,
        },
        timestamp,
      };
    }
    case "set_group_state": {
      if (!isRecord(body.payload) || typeof body.payload.groupId !== "string") {
        return null;
      }

      return {
        command: "set_group_state",
        targetId: body.targetId.trim(),
        payload: {
          groupId: body.payload.groupId,
          patch: isRecord(body.payload.patch) ? body.payload.patch : {},
        },
        timestamp,
      };
    }
    case "set_module_state": {
      if (
        !isRecord(body.payload) ||
        typeof body.payload.module !== "string" ||
        !MODULE_NAMES.has(body.payload.module as ModuleName) ||
        !isRecord(body.payload.patch)
      ) {
        return null;
      }

      return {
        command: "set_module_state",
        targetId: body.targetId.trim(),
        payload: {
          module: body.payload.module as ModuleName,
          patch: body.payload.patch,
        },
        timestamp,
      };
    }
    case "set_vote_state": {
      if (!isRecord(body.payload)) {
        return null;
      }

      const vote =
        body.payload.vote === null ? null : normalizeVoteConfig(body.payload.vote);
      if (body.payload.vote !== null && !vote) {
        return null;
      }

      return {
        command: "set_vote_state",
        targetId: body.targetId.trim(),
        payload: { vote },
        timestamp,
      };
    }
    case "reset_all_state": {
      return {
        command: "reset_all_state",
        targetId: body.targetId.trim(),
        payload: {},
        timestamp,
      };
    }
  }

  return null;
}

function normalizeControlInput(body: unknown): ControlInputMessage | null {
  if (!isRecord(body)) {
    return null;
  }

  if ("command" in body) {
    return normalizeUnifiedCommand(body);
  }

  if ("type" in body) {
    return normalizeLegacyControlMessage(body);
  }

  return null;
}

function getSocketOrigin(req: Request) {
  return `${req.protocol}://${req.get("host")}`;
}

export function registerControllerApi(app: Express) {
  app.get("/api/controller/receivers", (_req, res) => {
    res.status(200).json({ ok: true, receivers: getReceiverList() });
  });

  app.post("/api/controller/command", (req: Request, res: Response) => {
    const message = normalizeControlInput(req.body);
    if (!message) {
      return badRequest(res, "Invalid control message payload");
    }

    const result = dispatchControlMessage(message);
    if (result.missingTargetId) {
      return res.status(404).json({
        ok: false,
        error: `Receiver not found: ${result.missingTargetId}`,
      });
    }

    return res.status(200).json({
      ok: true,
      command: result.command,
      broadcast: result.broadcast,
      deliveredReceiverIds: result.deliveredReceiverIds,
      receivers: getReceiverList(),
    });
  });

  app.post("/api/controller/clear-offline", (_req, res) => {
    const removedReceiverIds = clearOfflineReceivers();
    res.status(200).json({
      ok: true,
      removedReceiverIds,
      receivers: getReceiverList(),
    });
  });

  app.get("/api/config", (_req, res) => {
    res.status(200).json(getConfigSnapshot());
  });

  app.post("/api/unity/register", (req: Request, res: Response) => {
    res.status(200).json({
      ok: true,
      role: "unity",
      socketServerUrl: getSocketOrigin(req),
      socketPath: "/socket.io",
      transports: ["websocket", "polling"],
      events: {
        register: WS_EVENTS.REGISTER_UNITY,
        command: WS_EVENTS.CONTROL_MESSAGE,
        interaction: WS_EVENTS.INTERACTION_EVENT,
      },
      config: getConfigSnapshot(),
    });
  });
}
