import type { Express, Request, Response } from "express";
import type { ControlMessage, MessagePayload, MessageType } from "../shared/wsTypes";
import {
  clearOfflineReceivers,
  dispatchControlMessage,
  getReceiverList,
} from "./wsServer";

const MESSAGE_TYPES = new Set<MessageType>([
  "audio_control",
  "audio_playable",
  "color_change",
  "text_message",
]);

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function badRequest(res: Response, error: string) {
  return res.status(400).json({ ok: false, error });
}

function normalizePayload(
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

function normalizeControlMessage(body: unknown): ControlMessage | null {
  if (!isRecord(body)) {
    return null;
  }

  if (typeof body.type !== "string" || !MESSAGE_TYPES.has(body.type as MessageType)) {
    return null;
  }

  if (typeof body.targetId !== "string" || !body.targetId.trim()) {
    return null;
  }

  const type = body.type as MessageType;
  const payload = normalizePayload(type, body.payload);
  if (!payload) {
    return null;
  }

  let timestamp = new Date().toISOString();
  if (typeof body.timestamp === "string" && body.timestamp.trim()) {
    timestamp = body.timestamp;
  }

  return {
    type,
    targetId: body.targetId.trim(),
    payload,
    timestamp,
  };
}

export function registerControllerApi(app: Express) {
  app.get("/api/controller/receivers", (_req, res) => {
    res.status(200).json({ ok: true, receivers: getReceiverList() });
  });

  app.post("/api/controller/command", (req: Request, res: Response) => {
    const message = normalizeControlMessage(req.body);
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
      command: message,
      ...result,
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
}
