import type { Server as HttpServer } from "http";
import type { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import { createApp } from "./_core/app";
import { resetWebSocketState } from "./wsServer";
import {
  AUDIO_URLS,
  CONFIG_TTL_MS,
  DEFAULT_ICON_COLOR,
  WS_EVENTS,
} from "../shared/wsTypes";

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

    await new Promise(resolve => setTimeout(resolve, 25));
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
    sockets.forEach(socket => {
      if (socket.connected) {
        socket.disconnect();
      }
    });

    await resetWebSocketState();

    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close(error => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });

  it("lists registered receivers with config snapshots over HTTP", async () => {
    const receiver = await connectSocket(baseUrl);
    sockets.push(receiver);

    const statePromise = waitForEvent<{
      receiverId: string;
      label: string;
      connected: boolean;
      configVersion: number;
      configExpiresAt: string;
      config: { tracks: Array<{ trackId: string }> };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);

    receiver.emit(WS_EVENTS.REGISTER_RECEIVER, {
      receiverId: "screen-a",
      label: "Main Screen",
    });

    const state = await statePromise;
    expect(state).toMatchObject({
      receiverId: "screen-a",
      label: "Main Screen",
      connected: true,
      configVersion: 1,
      config: {
        tracks: [{ trackId: "track_01" }, { trackId: "track_02" }],
      },
    });
    expect(new Date(state.configExpiresAt).getTime()).toBeGreaterThan(
      Date.now()
    );

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
          configVersion: 1,
          config: {
            visuals: {
              iconColor: "#6366f1",
            },
          },
        },
      ],
    });
  });

  it("accepts legacy HTTP messages and emits unified commands plus updated state", async () => {
    const receiver = await connectSocket(baseUrl);
    sockets.push(receiver);

    const initialStatePromise = waitForEvent(
      receiver,
      WS_EVENTS.RECEIVER_STATE_UPDATE
    );
    receiver.emit(WS_EVENTS.REGISTER_RECEIVER, {
      receiverId: "screen-a",
      label: "Main Screen",
    });
    await initialStatePromise;

    const commandPromise = waitForEvent<{
      command: string;
      payload: { module: string; patch: { text: string } };
    }>(receiver, WS_EVENTS.RECEIVER_COMMAND);
    const updatedStatePromise = waitForEvent<{
      configVersion: number;
      config: { textDisplay: { text: string; visible: boolean } };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);

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

    expect(response.status).toBe(200);
    expect(await commandPromise).toMatchObject({
      command: "set_module_state",
      payload: {
        module: "textDisplay",
        patch: {
          text: "Hello from HTTP",
        },
      },
    });
    expect(await updatedStatePromise).toMatchObject({
      configVersion: 2,
      config: {
        textDisplay: {
          text: "Hello from HTTP",
          visible: true,
        },
      },
    });
    expect(body).toMatchObject({
      ok: true,
      command: {
        command: "set_module_state",
        targetId: "screen-a",
      },
      deliveredReceiverIds: ["screen-a"],
      receivers: [
        {
          receiverId: "screen-a",
          config: {
            textDisplay: {
              text: "Hello from HTTP",
            },
          },
        },
      ],
    });
  });

  it("supports dynamic track add-remove and reset while keeping legacy controls working", async () => {
    const receiver = await connectSocket(baseUrl);
    sockets.push(receiver);

    const initialStatePromise = waitForEvent(
      receiver,
      WS_EVENTS.RECEIVER_STATE_UPDATE
    );
    receiver.emit(WS_EVENTS.REGISTER_RECEIVER, {
      receiverId: "screen-a",
      label: "Main Screen",
    });
    await initialStatePromise;

    const addCommandPromise = waitForEvent<{
      command: string;
      payload: { trackId: string; patch: { label: string; url: string } };
    }>(receiver, WS_EVENTS.RECEIVER_COMMAND);
    const addStatePromise = waitForEvent<{
      configVersion: number;
      config: {
        tracks: Array<{
          trackId: string;
          label: string;
          url: string;
          volumeValue: number;
        }>;
      };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);

    const addResponse = await fetch(`${baseUrl}/api/controller/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: "set_track_state",
        targetId: "screen-a",
        payload: {
          trackId: "ambient_loop",
          patch: {
            label: "Ambient Loop",
            url: "/audio/ambient-loop.mp3",
            volumeValue: 0.42,
          },
        },
      }),
    });

    expect(addResponse.status).toBe(200);
    expect(await addCommandPromise).toMatchObject({
      command: "set_track_state",
      payload: {
        trackId: "ambient_loop",
        patch: {
          label: "Ambient Loop",
          url: "/audio/ambient-loop.mp3",
        },
      },
    });
    expect(await addStatePromise).toMatchObject({
      configVersion: 2,
      config: {
        tracks: expect.arrayContaining([
          expect.objectContaining({
            trackId: "ambient_loop",
            label: "Ambient Loop",
            url: "/audio/ambient-loop.mp3",
            volumeValue: 0.42,
          }),
        ]),
      },
    });

    const removeCommandPromise = waitForEvent<{
      command: string;
      payload: { trackId: string };
    }>(receiver, WS_EVENTS.RECEIVER_COMMAND);
    const removeStatePromise = waitForEvent<{
      configVersion: number;
      config: {
        tracks: Array<{ trackId: string }>;
      };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);

    const removeResponse = await fetch(`${baseUrl}/api/controller/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: "remove_track",
        targetId: "screen-a",
        payload: {
          trackId: "ambient_loop",
        },
      }),
    });

    expect(removeResponse.status).toBe(200);
    expect(await removeCommandPromise).toMatchObject({
      command: "remove_track",
      payload: {
        trackId: "ambient_loop",
      },
    });
    expect(await removeStatePromise).toMatchObject({
      configVersion: 3,
      config: {
        tracks: [{ trackId: "track_01" }, { trackId: "track_02" }],
      },
    });

    const audioStatePromise = waitForEvent<{
      configVersion: number;
      config: {
        tracks: Array<{ trackId: string; playing: boolean; url: string }>;
      };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);

    const audioResponse = await fetch(`${baseUrl}/api/controller/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type: "audio_control",
        targetId: "screen-a",
        payload: { trackId: 1, action: "play" },
      }),
    });

    expect(audioResponse.status).toBe(200);
    expect(await audioStatePromise).toMatchObject({
      configVersion: 4,
      config: {
        tracks: expect.arrayContaining([
          expect.objectContaining({
            trackId: "track_01",
            playing: true,
            url: AUDIO_URLS.track_01,
          }),
        ]),
      },
    });

    const colorStatePromise = waitForEvent<{
      configVersion: number;
      config: { visuals: { iconColor: string } };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);

    const colorResponse = await fetch(`${baseUrl}/api/controller/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type: "color_change",
        targetId: "screen-a",
        payload: { color: "#ffffff" },
      }),
    });

    expect(colorResponse.status).toBe(200);
    expect(await colorStatePromise).toMatchObject({
      configVersion: 5,
      config: {
        visuals: {
          iconColor: "#ffffff",
        },
      },
    });

    const resetCommandPromise = waitForEvent<{
      command: string;
    }>(receiver, WS_EVENTS.RECEIVER_COMMAND);
    const resetStatePromise = waitForEvent<{
      configVersion: number;
      config: {
        visuals: { iconColor: string };
        tracks: Array<{ trackId: string; playing: boolean }>;
      };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);

    const resetResponse = await fetch(`${baseUrl}/api/controller/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: "reset_all_state",
        targetId: "screen-a",
        payload: {},
      }),
    });

    expect(resetResponse.status).toBe(200);
    expect(await resetCommandPromise).toMatchObject({
      command: "reset_all_state",
    });
    expect(await resetStatePromise).toMatchObject({
      configVersion: 6,
      config: {
        visuals: {
          iconColor: DEFAULT_ICON_COLOR,
        },
        tracks: [
          {
            trackId: "track_01",
            playing: false,
          },
          {
            trackId: "track_02",
            playing: false,
          },
        ],
      },
    });
  });

  it("supports phase 2 loop, group, and volume state over HTTP", async () => {
    const receiver = await connectSocket(baseUrl);
    sockets.push(receiver);

    const initialStatePromise = waitForEvent(
      receiver,
      WS_EVENTS.RECEIVER_STATE_UPDATE
    );
    receiver.emit(WS_EVENTS.REGISTER_RECEIVER, {
      receiverId: "screen-a",
      label: "Main Screen",
    });
    await initialStatePromise;

    const createGroupStatePromise = waitForEvent<{
      configVersion: number;
      config: {
        groups: Array<{
          groupId: string;
          label: string;
          color: string;
          visible: boolean;
          enabled: boolean;
          trackIds: string[];
        }>;
      };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);

    const createGroupResponse = await fetch(
      `${baseUrl}/api/controller/command`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          command: "set_group_state",
          targetId: "screen-a",
          payload: {
            groupId: "group_a",
            patch: {
              label: "Percussion",
              color: "#ff6600",
              visible: true,
              enabled: true,
            },
          },
        }),
      }
    );

    expect(createGroupResponse.status).toBe(200);
    expect(await createGroupStatePromise).toMatchObject({
      configVersion: 2,
      config: {
        groups: [
          {
            groupId: "group_a",
            label: "Percussion",
            color: "#ff6600",
            visible: true,
            enabled: true,
            trackIds: [],
          },
        ],
      },
    });

    const phase2TrackStatePromise = waitForEvent<{
      configVersion: number;
      config: {
        groups: Array<{ groupId: string; trackIds: string[] }>;
        tracks: Array<{
          trackId: string;
          groupId: string | null;
          loopEnabled: boolean;
          loopControlVisible: boolean;
          loopControlLocked: boolean;
          volumeValue: number;
          volumeControlVisible: boolean;
          volumeControlEnabled: boolean;
        }>;
      };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);

    const phase2TrackResponse = await fetch(
      `${baseUrl}/api/controller/command`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          command: "set_track_state",
          targetId: "screen-a",
          payload: {
            trackId: "track_01",
            patch: {
              groupId: "group_a",
              loopEnabled: true,
              loopControlVisible: false,
              loopControlLocked: true,
              volumeValue: 0.37,
              volumeControlVisible: true,
              volumeControlEnabled: false,
            },
          },
        }),
      }
    );

    expect(phase2TrackResponse.status).toBe(200);
    expect(await phase2TrackStatePromise).toMatchObject({
      configVersion: 3,
      config: {
        groups: [{ groupId: "group_a", trackIds: ["track_01"] }],
        tracks: expect.arrayContaining([
          expect.objectContaining({
            trackId: "track_01",
            groupId: "group_a",
            loopEnabled: true,
            loopControlVisible: false,
            loopControlLocked: true,
            volumeValue: 0.37,
            volumeControlVisible: true,
            volumeControlEnabled: false,
          }),
        ]),
      },
    });

    const updateGroupStatePromise = waitForEvent<{
      configVersion: number;
      config: {
        groups: Array<{
          groupId: string;
          label: string;
          color: string;
          visible: boolean;
          enabled: boolean;
          trackIds: string[];
        }>;
      };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);

    const updateGroupResponse = await fetch(
      `${baseUrl}/api/controller/command`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          command: "set_group_state",
          targetId: "screen-a",
          payload: {
            groupId: "group_a",
            patch: {
              label: "Percussion Locked",
              color: "#22c55e",
              visible: false,
              enabled: false,
            },
          },
        }),
      }
    );

    expect(updateGroupResponse.status).toBe(200);
    expect(await updateGroupStatePromise).toMatchObject({
      configVersion: 4,
      config: {
        groups: [
          {
            groupId: "group_a",
            label: "Percussion Locked",
            color: "#22c55e",
            visible: false,
            enabled: false,
            trackIds: ["track_01"],
          },
        ],
      },
    });

    const removeGroupStatePromise = waitForEvent<{
      configVersion: number;
      config: {
        groups: Array<unknown>;
        tracks: Array<{ trackId: string; groupId: string | null }>;
      };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);

    const removeGroupResponse = await fetch(
      `${baseUrl}/api/controller/command`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          command: "remove_group",
          targetId: "screen-a",
          payload: {
            groupId: "group_a",
          },
        }),
      }
    );

    expect(removeGroupResponse.status).toBe(200);
    expect(await removeGroupStatePromise).toMatchObject({
      configVersion: 5,
      config: {
        groups: [],
        tracks: expect.arrayContaining([
          expect.objectContaining({
            trackId: "track_01",
            groupId: null,
          }),
        ]),
      },
    });

    const resetStatePromise = waitForEvent<{
      configVersion: number;
      config: {
        groups: Array<unknown>;
        tracks: Array<{
          trackId: string;
          loopEnabled: boolean;
          loopControlVisible: boolean;
          loopControlLocked: boolean;
          volumeValue: number;
          volumeControlVisible: boolean;
          volumeControlEnabled: boolean;
        }>;
      };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);

    const resetResponse = await fetch(`${baseUrl}/api/controller/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: "reset_all_state",
        targetId: "screen-a",
        payload: {},
      }),
    });

    expect(resetResponse.status).toBe(200);
    expect(await resetStatePromise).toMatchObject({
      configVersion: 6,
      config: {
        groups: [],
        tracks: expect.arrayContaining([
          expect.objectContaining({
            trackId: "track_01",
            loopEnabled: false,
            loopControlVisible: true,
            loopControlLocked: false,
            volumeValue: 1,
            volumeControlVisible: false,
            volumeControlEnabled: true,
          }),
        ]),
      },
    });
  });

  it("broadcasts phase 2 updates and keeps legacy audio_playable semantics", async () => {
    const receiverA = await connectSocket(baseUrl);
    const receiverB = await connectSocket(baseUrl);
    sockets.push(receiverA, receiverB);

    const receiverAInitialStatePromise = waitForEvent(
      receiverA,
      WS_EVENTS.RECEIVER_STATE_UPDATE
    );
    receiverA.emit(WS_EVENTS.REGISTER_RECEIVER, {
      receiverId: "screen-a",
      label: "Main Screen",
    });
    await receiverAInitialStatePromise;

    const receiverBInitialStatePromise = waitForEvent(
      receiverB,
      WS_EVENTS.RECEIVER_STATE_UPDATE
    );
    receiverB.emit(WS_EVENTS.REGISTER_RECEIVER, {
      receiverId: "screen-b",
      label: "Side Screen",
    });
    await receiverBInitialStatePromise;

    const receiverAPlayStatePromise = waitForEvent<{
      configVersion: number;
      config: { tracks: Array<{ trackId: string; playing: boolean }> };
    }>(receiverA, WS_EVENTS.RECEIVER_STATE_UPDATE);
    const receiverBPlayStatePromise = waitForEvent<{
      configVersion: number;
      config: { tracks: Array<{ trackId: string; playing: boolean }> };
    }>(receiverB, WS_EVENTS.RECEIVER_STATE_UPDATE);

    const playResponse = await fetch(`${baseUrl}/api/controller/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: "set_track_state",
        targetId: "*",
        payload: {
          trackId: "track_01",
          patch: {
            playing: true,
          },
        },
      }),
    });

    expect(playResponse.status).toBe(200);
    expect(await receiverAPlayStatePromise).toMatchObject({
      configVersion: 2,
      config: {
        tracks: expect.arrayContaining([
          expect.objectContaining({
            trackId: "track_01",
            playing: true,
          }),
        ]),
      },
    });
    expect(await receiverBPlayStatePromise).toMatchObject({
      configVersion: 2,
      config: {
        tracks: expect.arrayContaining([
          expect.objectContaining({
            trackId: "track_01",
            playing: true,
          }),
        ]),
      },
    });

    const receiverAPlayableStatePromise = waitForEvent<{
      configVersion: number;
      config: {
        tracks: Array<{ trackId: string; playable: boolean; playing: boolean }>;
      };
    }>(receiverA, WS_EVENTS.RECEIVER_STATE_UPDATE);
    const receiverBPlayableStatePromise = waitForEvent<{
      configVersion: number;
      config: {
        tracks: Array<{ trackId: string; playable: boolean; playing: boolean }>;
      };
    }>(receiverB, WS_EVENTS.RECEIVER_STATE_UPDATE);

    const playableResponse = await fetch(`${baseUrl}/api/controller/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type: "audio_playable",
        targetId: "*",
        payload: { trackId: 1, playable: false },
      }),
    });
    const playableBody = await playableResponse.json();

    expect(playableResponse.status).toBe(200);
    expect(playableBody).toMatchObject({
      ok: true,
      broadcast: true,
      deliveredReceiverIds: ["screen-a", "screen-b"],
    });
    expect(await receiverAPlayableStatePromise).toMatchObject({
      configVersion: 3,
      config: {
        tracks: expect.arrayContaining([
          expect.objectContaining({
            trackId: "track_01",
            playable: false,
            playing: false,
          }),
        ]),
      },
    });
    expect(await receiverBPlayableStatePromise).toMatchObject({
      configVersion: 3,
      config: {
        tracks: expect.arrayContaining([
          expect.objectContaining({
            trackId: "track_01",
            playable: false,
            playing: false,
          }),
        ]),
      },
    });
  });

  it("accepts receiver-scoped phase 2 track updates over websocket", async () => {
    const receiver = await connectSocket(baseUrl);
    sockets.push(receiver);

    const initialStatePromise = waitForEvent(
      receiver,
      WS_EVENTS.RECEIVER_STATE_UPDATE
    );
    receiver.emit(WS_EVENTS.REGISTER_RECEIVER, {
      receiverId: "screen-a",
      label: "Main Screen",
    });
    await initialStatePromise;

    const commandPromise = waitForEvent<{
      command: string;
      payload: {
        trackId: string;
        patch: { loopEnabled: boolean; volumeValue: number };
      };
    }>(receiver, WS_EVENTS.RECEIVER_COMMAND);
    const statePromise = waitForEvent<{
      configVersion: number;
      config: {
        tracks: Array<{
          trackId: string;
          loopEnabled: boolean;
          volumeValue: number;
        }>;
      };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);

    receiver.emit(WS_EVENTS.CONTROL_MESSAGE, {
      command: "set_track_state",
      targetId: "screen-a",
      payload: {
        trackId: "track_01",
        patch: {
          loopEnabled: true,
          volumeValue: 0.25,
        },
      },
      timestamp: new Date().toISOString(),
    });

    expect(await commandPromise).toMatchObject({
      command: "set_track_state",
      payload: {
        trackId: "track_01",
        patch: {
          loopEnabled: true,
          volumeValue: 0.25,
        },
      },
    });
    expect(await statePromise).toMatchObject({
      configVersion: 2,
      config: {
        tracks: expect.arrayContaining([
          expect.objectContaining({
            trackId: "track_01",
            loopEnabled: true,
            volumeValue: 0.25,
          }),
        ]),
      },
    });
  });

  it("serves global config snapshots and Unity registration metadata", async () => {
    const configResponse = await fetch(`${baseUrl}/api/config`);
    const configBody = await configResponse.json();

    expect(configResponse.status).toBe(200);
    expect(configBody).toEqual({
      ok: true,
      configTtlMs: CONFIG_TTL_MS,
      receivers: [],
    });

    const unityResponse = await fetch(`${baseUrl}/api/unity/register`, {
      method: "POST",
    });
    const unityBody = await unityResponse.json();

    expect(unityResponse.status).toBe(200);
    expect(unityBody).toMatchObject({
      ok: true,
      role: "unity",
      socketServerUrl: baseUrl,
      socketPath: "/socket.io",
      transports: ["websocket", "polling"],
      events: {
        register: WS_EVENTS.REGISTER_UNITY,
        command: WS_EVENTS.CONTROL_MESSAGE,
        interaction: WS_EVENTS.INTERACTION_EVENT,
      },
      config: {
        ok: true,
        configTtlMs: CONFIG_TTL_MS,
        receivers: [],
      },
    });
  });

  it("forwards receiver interaction events to Unity sockets", async () => {
    const receiver = await connectSocket(baseUrl);
    const unity = await connectSocket(baseUrl);
    sockets.push(receiver, unity);

    unity.emit(WS_EVENTS.REGISTER_UNITY);

    const receiverStatePromise = waitForEvent(
      receiver,
      WS_EVENTS.RECEIVER_STATE_UPDATE
    );
    receiver.emit(WS_EVENTS.REGISTER_RECEIVER, {
      receiverId: "screen-a",
      label: "Main Screen",
    });
    await receiverStatePromise;

    const unityEventPromise = waitForEvent<{
      sourceRole: string;
      receiverId: string | null;
      action: string;
      element: string;
      value: string;
    }>(unity, WS_EVENTS.INTERACTION_EVENT);

    receiver.emit(WS_EVENTS.INTERACTION_EVENT, {
      sourceRole: "receiver",
      receiverId: null,
      action: "click",
      element: "receiver:vote_button",
      value: "option_a",
      timestamp: new Date().toISOString(),
    });

    expect(await unityEventPromise).toMatchObject({
      sourceRole: "receiver",
      receiverId: "screen-a",
      action: "click",
      element: "receiver:vote_button",
      value: "option_a",
    });
  });

  it("clears offline receivers and returns useful HTTP errors", async () => {
    const receiver = await connectSocket(baseUrl);
    sockets.push(receiver);

    const statePromise = waitForEvent(
      receiver,
      WS_EVENTS.RECEIVER_STATE_UPDATE
    );
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

    const clearResponse = await fetch(
      `${baseUrl}/api/controller/clear-offline`,
      {
        method: "POST",
      }
    );
    expect(clearResponse.status).toBe(200);
    expect(await clearResponse.json()).toEqual({
      ok: true,
      removedReceiverIds: ["screen-a"],
      receivers: [],
    });

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
        command: "set_module_state",
        targetId: "missing-screen",
        payload: {
          module: "visuals",
          patch: { iconColor: "#ffffff" },
        },
      }),
    });

    expect(missingResponse.status).toBe(404);
    expect(await missingResponse.json()).toEqual({
      ok: false,
      error: "Receiver not found: missing-screen",
    });
  });
});
