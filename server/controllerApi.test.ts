import type { AddressInfo } from "net";
import type { Server as HttpServer } from "http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import { createApp } from "./_core/app";
import { resetWebSocketState } from "./wsServer";
import { WS_EVENTS } from "../shared/wsTypes";

async function listen(server: HttpServer) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, () => resolve());
  });

  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function waitForEvent<T>(socket: Socket, event: string) {
  return new Promise<T>((resolve, reject) => {
    const onEvent = (payload: T) => {
      cleanup();
      resolve(payload);
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      socket.off(event, onEvent);
      socket.off("connect_error", onError);
    };

    socket.once(event, onEvent);
    socket.once("connect_error", onError);
  });
}

async function connectSocket(baseUrl: string) {
  const socket = createClient(baseUrl, {
    forceNew: true,
    reconnection: false,
    transports: ["websocket"],
  });

  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", reject);
  });

  return socket;
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 2000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error("Timed out waiting for condition");
}

describe("controller HTTP API", () => {
  let server: HttpServer;
  let baseUrl: string;
  let sockets: Socket[];

  beforeEach(async () => {
    sockets = [];
    const created = await createApp({ nodeEnv: "test", serveFrontend: false });
    server = created.server;
    baseUrl = await listen(server);
  });

  afterEach(async () => {
    sockets.forEach((socket) => {
      if (socket.connected) {
        socket.disconnect();
      }
    });

    await resetWebSocketState();

    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });

  it("lists registered receivers over HTTP", async () => {
    const receiver = await connectSocket(baseUrl);
    sockets.push(receiver);

    const statePromise = waitForEvent(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);
    receiver.emit(WS_EVENTS.REGISTER_RECEIVER, {
      receiverId: "screen-a",
      label: "Main Screen",
    });

    const state = await statePromise;
    expect(state).toMatchObject({
      receiverId: "screen-a",
      label: "Main Screen",
      connected: true,
    });

    const response = await fetch(`${baseUrl}/api/controller/receivers`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      receivers: [
        {
          receiverId: "screen-a",
          label: "Main Screen",
          connected: true,
          iconColor: "#6366f1",
        },
      ],
    });
  });

  it("sends HTTP commands through the existing receiver command flow", async () => {
    const receiver = await connectSocket(baseUrl);
    sockets.push(receiver);

    const statePromise = waitForEvent(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);
    receiver.emit(WS_EVENTS.REGISTER_RECEIVER, {
      receiverId: "screen-a",
      label: "Main Screen",
    });
    await statePromise;

    const commandPromise = waitForEvent(receiver, WS_EVENTS.RECEIVER_COMMAND);
    const response = await fetch(`${baseUrl}/api/controller/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type: "text_message",
        targetId: "screen-a",
        payload: { text: "Hello from HTTP" },
      }),
    });
    const body = await response.json();
    const command = await commandPromise;

    expect(response.status).toBe(200);
    expect(command).toMatchObject({
      type: "text_message",
      targetId: "screen-a",
      payload: { text: "Hello from HTTP" },
    });
    expect(body).toMatchObject({
      ok: true,
      broadcast: false,
      deliveredReceiverIds: ["screen-a"],
      receivers: [
        {
          receiverId: "screen-a",
          lastMessage: "Hello from HTTP",
        },
      ],
    });
  });

  it("clears offline receivers over HTTP", async () => {
    const receiver = await connectSocket(baseUrl);
    sockets.push(receiver);

    const statePromise = waitForEvent(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);
    receiver.emit(WS_EVENTS.REGISTER_RECEIVER, {
      receiverId: "screen-a",
      label: "Main Screen",
    });
    await statePromise;

    receiver.disconnect();

    await waitFor(async () => {
      const response = await fetch(`${baseUrl}/api/controller/receivers`);
      const body = await response.json();
      return body.receivers[0]?.connected === false;
    });

    const response = await fetch(`${baseUrl}/api/controller/clear-offline`, {
      method: "POST",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      removedReceiverIds: ["screen-a"],
      receivers: [],
    });
  });

  it("returns useful HTTP errors for invalid or missing targets", async () => {
    const invalidResponse = await fetch(`${baseUrl}/api/controller/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type: "text_message",
        targetId: "",
        payload: { text: "" },
      }),
    });

    expect(invalidResponse.status).toBe(400);
    expect(await invalidResponse.json()).toEqual({
      ok: false,
      error: "Invalid control message payload",
    });

    const missingResponse = await fetch(`${baseUrl}/api/controller/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type: "color_change",
        targetId: "missing-screen",
        payload: { color: "#ffffff" },
      }),
    });

    expect(missingResponse.status).toBe(404);
    expect(await missingResponse.json()).toEqual({
      ok: false,
      error: "Receiver not found: missing-screen",
    });
  });
});
