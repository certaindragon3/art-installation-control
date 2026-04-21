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
  getColorChallengeExport,
  getConfigSnapshot,
  getReceiverList,
  getScoreboardExport,
  getTimingExport,
  getVoteExports,
} from "./wsServer";

const UNIFIED_COMMANDS = new Set<UnifiedCommand["command"]>([
  "set_track_state",
  "set_visible_tracks",
  "remove_track",
  "remove_group",
  "set_group_state",
  "set_module_state",
  "set_vote_state",
  "vote_reset_all",
  "score_reset",
  "reset_all_state",
  "request_track_play",
  "request_track_stop",
  "economy_reset",
  "submit_color_challenge_choice",
  "color_challenge_reset",
]);

const MODULE_NAMES = new Set<ModuleName>([
  "pulse",
  "score",
  "map",
  "timing",
  "textDisplay",
  "visuals",
  "economy",
  "colorChallenge",
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
    case "set_visible_tracks": {
      if (!isRecord(body.payload) || !Array.isArray(body.payload.trackIds)) {
        return null;
      }

      const trackIds = Array.from(
        new Set(
          body.payload.trackIds
            .map(trackId => (typeof trackId === "string" ? trackId.trim() : ""))
            .filter(trackId => trackId.length > 0)
        )
      );

      return {
        command: "set_visible_tracks",
        targetId: body.targetId.trim(),
        payload: {
          trackIds,
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
    case "request_track_play": {
      if (!isRecord(body.payload) || typeof body.payload.trackId !== "string") {
        return null;
      }

      return {
        command: "request_track_play",
        targetId: body.targetId.trim(),
        payload: {
          trackId: body.payload.trackId,
        },
        timestamp,
      };
    }
    case "request_track_stop": {
      if (!isRecord(body.payload) || typeof body.payload.trackId !== "string") {
        return null;
      }

      return {
        command: "request_track_stop",
        targetId: body.targetId.trim(),
        payload: {
          trackId: body.payload.trackId,
        },
        timestamp,
      };
    }
    case "economy_reset": {
      return {
        command: "economy_reset",
        targetId: body.targetId.trim(),
        payload: {},
        timestamp,
      };
    }
    case "submit_color_challenge_choice": {
      if (!isRecord(body.payload)) {
        return null;
      }

      const choiceIndex =
        body.payload.choiceIndex === null
          ? null
          : typeof body.payload.choiceIndex === "number" &&
              Number.isFinite(body.payload.choiceIndex)
            ? body.payload.choiceIndex
            : undefined;
      if (choiceIndex === undefined) {
        return null;
      }

      return {
        command: "submit_color_challenge_choice",
        targetId: body.targetId.trim(),
        payload: {
          roundId:
            typeof body.payload.roundId === "string"
              ? body.payload.roundId
              : undefined,
          submissionId:
            typeof body.payload.submissionId === "string"
              ? body.payload.submissionId
              : undefined,
          choiceIndex,
          colorId:
            typeof body.payload.colorId === "string"
              ? body.payload.colorId
              : undefined,
          pressedAt:
            typeof body.payload.pressedAt === "string"
              ? body.payload.pressedAt
              : undefined,
          clientTimestamp:
            typeof body.payload.clientTimestamp === "number" &&
            Number.isFinite(body.payload.clientTimestamp)
              ? body.payload.clientTimestamp
              : undefined,
          nextRound: isRecord(body.payload.nextRound)
            ? {
                iterationId:
                  typeof body.payload.nextRound.iterationId === "string"
                    ? body.payload.nextRound.iterationId
                    : "",
                assignedColorId:
                  typeof body.payload.nextRound.assignedColorId === "string"
                    ? body.payload.nextRound.assignedColorId
                    : "",
                choices: Array.isArray(body.payload.nextRound.choices)
                  ? body.payload.nextRound.choices.flatMap(choice =>
                      isRecord(choice) &&
                      typeof choice.colorId === "string" &&
                      typeof choice.label === "string" &&
                      typeof choice.color === "string"
                        ? [
                            {
                              colorId: choice.colorId,
                              label: choice.label,
                              color: choice.color,
                            },
                          ]
                        : []
                    )
                  : [],
                correctChoiceIndex:
                  typeof body.payload.nextRound.correctChoiceIndex === "number" &&
                  Number.isFinite(body.payload.nextRound.correctChoiceIndex)
                    ? body.payload.nextRound.correctChoiceIndex
                    : -1,
                iterationStartedAt:
                  typeof body.payload.nextRound.iterationStartedAt === "string"
                    ? body.payload.nextRound.iterationStartedAt
                    : "",
                iterationDurationMs:
                  typeof body.payload.nextRound.iterationDurationMs ===
                    "number" &&
                  Number.isFinite(body.payload.nextRound.iterationDurationMs)
                    ? body.payload.nextRound.iterationDurationMs
                    : 0,
              }
            : undefined,
        },
        timestamp,
      };
    }
    case "color_challenge_reset": {
      return {
        command: "color_challenge_reset",
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

  app.get("/api/controller/timing/export", (_req, res) => {
    res.status(200).json({
      ok: true,
      timing: getTimingExport(),
    });
  });

  app.get("/api/controller/color-challenge/export", (_req, res) => {
    res.status(200).json({
      ok: true,
      colorChallenge: getColorChallengeExport(),
    });
  });

  app.get("/api/controller/scoreboard/export", (_req, res) => {
    res.status(200).json({
      ok: true,
      scoreboard: getScoreboardExport(),
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
