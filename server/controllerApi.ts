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
  getVoteExports,
} from "./wsServer";

const UNIFIED_COMMANDS = new Set<UnifiedCommand["command"]>([
  "set_track_state",
  "remove_track",
  "remove_group",
  "set_group_state",
  "set_module_state",
  "set_vote_state",
  "vote_reset_all",
  "score_reset",
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

function normalizeLegacyControlMessage(
  body: JsonRecord
): ControlMessage | null {
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

  const voteId =
    typeof value.voteId === "string"
      ? value.voteId.trim()
      : typeof value.id === "string"
        ? value.id.trim()
        : "";
  if (!voteId) {
    return null;
  }

  const questionCandidate =
    typeof value.question === "string"
      ? value.question
      : typeof value.voteQuestion === "string"
        ? value.voteQuestion
        : typeof value.title === "string"
          ? value.title
          : null;
  if (!questionCandidate) {
    return null;
  }

  const question = questionCandidate.trim();
  const rawOptions = Array.isArray(value.options)
    ? value.options
    : Array.isArray(value.voteOptions)
      ? value.voteOptions
      : null;
  if (!question || !rawOptions) {
    return null;
  }

  const options = rawOptions
    .map((option, index) => {
      if (typeof option === "string") {
        const label = option.trim();
        if (!label) {
          return null;
        }

        return {
          id: `option_${index + 1}`,
          label,
        };
      }

      if (
        isRecord(option) &&
        typeof option.id === "string" &&
        typeof option.label === "string"
      ) {
        const id = option.id.trim();
        const label = option.label.trim();
        if (!id || !label) {
          return null;
        }

        return { id, label };
      }

      return null;
    })
    .filter((option): option is NonNullable<typeof option> => Boolean(option));

  if (options.length === 0) {
    return null;
  }

  const selectedOptionId =
    typeof value.selectedOptionId === "string"
      ? value.selectedOptionId.trim()
      : null;

  return {
    voteId,
    question,
    visible:
      typeof value.visible === "boolean"
        ? value.visible
        : typeof value.voteVisible === "boolean"
          ? value.voteVisible
          : true,
    enabled:
      typeof value.enabled === "boolean"
        ? value.enabled
        : typeof value.voteEnabled === "boolean"
          ? value.voteEnabled
          : true,
    visibilityDuration:
      typeof value.visibilityDuration === "number" &&
      Number.isFinite(value.visibilityDuration)
        ? Math.max(0, value.visibilityDuration)
        : 15,
    allowRevote:
      typeof value.allowRevote === "boolean"
        ? value.allowRevote
        : typeof value.voteAllowRevote === "boolean"
          ? value.voteAllowRevote
          : false,
    options,
    selectedOptionId:
      selectedOptionId && options.some(option => option.id === selectedOptionId)
        ? selectedOptionId
        : null,
    submittedAt:
      typeof value.submittedAt === "string" && value.submittedAt.trim()
        ? value.submittedAt
        : null,
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
    case "remove_group": {
      if (!isRecord(body.payload) || typeof body.payload.groupId !== "string") {
        return null;
      }

      return {
        command: "remove_group",
        targetId: body.targetId.trim(),
        payload: {
          groupId: body.payload.groupId,
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
        body.payload.vote === null
          ? null
          : normalizeVoteConfig(body.payload.vote);
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
    case "vote_reset_all": {
      return {
        command: "vote_reset_all",
        targetId: body.targetId.trim(),
        payload: {},
        timestamp,
      };
    }
    case "score_reset": {
      return {
        command: "score_reset",
        targetId: body.targetId.trim(),
        payload: {},
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

  app.get("/api/controller/votes/export", (_req, res) => {
    res.status(200).json({
      ok: true,
      votes: getVoteExports(),
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
