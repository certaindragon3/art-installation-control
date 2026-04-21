import type { Server as HttpServer } from "http";
import type { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import { createApp } from "./_core/app";
import { resetWebSocketState } from "./wsServer";
import {
  AUDIO_URLS,
  CONFIG_TTL_MS,
  createColorChallengeRound,
  DEFAULT_TRACK_LIBRARY,
  DEFAULT_ICON_COLOR,
  type PulseEvent,
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

function waitForNoEvent(socket: Socket, event: string, timeoutMs = 100) {
  return new Promise<void>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout>;
    const onEvent = (payload: unknown) => {
      cleanup();
      reject(
        new Error(
          `Unexpected ${event} event: ${JSON.stringify(payload, null, 2)}`
        )
      );
    };

    const cleanup = () => {
      clearTimeout(timeout);
      socket.off(event, onEvent);
    };

    timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, timeoutMs);

    socket.once(event, onEvent);
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
        tracks: expect.arrayContaining([
          expect.objectContaining({ trackId: "track_01" }),
          expect.objectContaining({ trackId: "track_02" }),
          expect.objectContaining({ trackId: "Accident1.mp3" }),
        ]),
      },
    });
    expect(state.config.tracks).toHaveLength(DEFAULT_TRACK_LIBRARY.length);
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

  it("assigns unique receiver IDs when duplicate registrations arrive", async () => {
    const receiverA = await connectSocket(baseUrl);
    const receiverB = await connectSocket(baseUrl);
    sockets.push(receiverA, receiverB);

    const receiverAStatePromise = waitForEvent<{
      receiverId: string;
      label: string;
    }>(receiverA, WS_EVENTS.RECEIVER_STATE_UPDATE);
    receiverA.emit(WS_EVENTS.REGISTER_RECEIVER, {
      receiverId: "screen-a",
      label: "Receiver screen-a",
      clientInstanceId: "client-a",
    });
    await expect(receiverAStatePromise).resolves.toMatchObject({
      receiverId: "screen-a",
      label: "Receiver screen-a",
    });

    const receiverBStatePromise = waitForEvent<{
      receiverId: string;
      label: string;
    }>(receiverB, WS_EVENTS.RECEIVER_STATE_UPDATE);
    receiverB.emit(WS_EVENTS.REGISTER_RECEIVER, {
      receiverId: "screen-a",
      label: "Receiver screen-a",
      clientInstanceId: "client-b",
    });
    await expect(receiverBStatePromise).resolves.toMatchObject({
      receiverId: "screen-a2",
      label: "Receiver screen-a2",
    });

    const response = await fetch(`${baseUrl}/api/controller/receivers`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      receivers: expect.arrayContaining([
        expect.objectContaining({ receiverId: "screen-a" }),
        expect.objectContaining({ receiverId: "screen-a2" }),
      ]),
    });

    const commandPromise = waitForEvent(receiverB, WS_EVENTS.RECEIVER_COMMAND);
    const noCommandOnReceiverA = waitForNoEvent(
      receiverA,
      WS_EVENTS.RECEIVER_COMMAND
    );
    const commandResponse = await fetch(`${baseUrl}/api/controller/command`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command: "set_module_state",
        targetId: "screen-a2",
        payload: {
          module: "textDisplay",
          patch: {
            text: "Targeted duplicate",
            visible: true,
          },
        },
      }),
    });

    expect(commandResponse.status).toBe(200);
    await expect(commandPromise).resolves.toMatchObject({
      targetId: "screen-a2",
    });
    await noCommandOnReceiverA;
  });

  it("reclaims an offline receiver ID for the same client instance", async () => {
    const firstSocket = await connectSocket(baseUrl);
    sockets.push(firstSocket);

    const firstStatePromise = waitForEvent<{
      receiverId: string;
      connected: boolean;
    }>(firstSocket, WS_EVENTS.RECEIVER_STATE_UPDATE);
    firstSocket.emit(WS_EVENTS.REGISTER_RECEIVER, {
      receiverId: "screen-a",
      clientInstanceId: "stable-client",
    });
    await expect(firstStatePromise).resolves.toMatchObject({
      receiverId: "screen-a",
      connected: true,
    });

    firstSocket.disconnect();
    await waitFor(async () => {
      const response = await fetch(`${baseUrl}/api/controller/receivers`);
      const body = await response.json();
      return body.receivers.some(
        (receiver: { receiverId: string; connected: boolean }) =>
          receiver.receiverId === "screen-a" && !receiver.connected
      );
    });

    const secondSocket = await connectSocket(baseUrl);
    sockets.push(secondSocket);

    const secondStatePromise = waitForEvent<{
      receiverId: string;
      connected: boolean;
    }>(secondSocket, WS_EVENTS.RECEIVER_STATE_UPDATE);
    secondSocket.emit(WS_EVENTS.REGISTER_RECEIVER, {
      receiverId: "screen-a",
      clientInstanceId: "stable-client",
    });

    await expect(secondStatePromise).resolves.toMatchObject({
      receiverId: "screen-a",
      connected: true,
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
        tracks: expect.arrayContaining([
          expect.objectContaining({ trackId: "track_01" }),
          expect.objectContaining({ trackId: "track_02" }),
        ]),
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
        tracks: Array<{ trackId: string; visible: boolean; playing: boolean }>;
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
        tracks: expect.arrayContaining([
          expect.objectContaining({
            trackId: "track_01",
            visible: false,
            playing: false,
          }),
          expect.objectContaining({
            trackId: "Accident1.mp3",
            visible: false,
            playing: false,
          }),
        ]),
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
          visible: boolean;
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
            visible: false,
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

  it("emits phase 3 pulse events, supports BPM changes, and stops cleanly", async () => {
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

    const pulses: PulseEvent[] = [];
    receiver.on(WS_EVENTS.PULSE, (event: PulseEvent) => {
      pulses.push(event);
    });

    const pulseStatePromise = waitForEvent<{
      configVersion: number;
      config: {
        pulse: {
          active: boolean;
          enabled: boolean;
          visible: boolean;
          bpm: number;
        };
        tracks: Array<{
          trackId: string;
          tempoFlashEnabled: boolean;
          fillTime: number;
        }>;
      };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);

    const pulseResponse = await fetch(`${baseUrl}/api/controller/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: "set_module_state",
        targetId: "screen-a",
        payload: {
          module: "pulse",
          patch: {
            active: true,
            enabled: true,
            visible: true,
            bpm: 600,
          },
        },
      }),
    });

    expect(pulseResponse.status).toBe(200);
    expect(await pulseStatePromise).toMatchObject({
      configVersion: 2,
      config: {
        pulse: {
          active: true,
          enabled: true,
          visible: true,
          bpm: 600,
        },
      },
    });

    await waitFor(async () => pulses.length >= 2, 1500);
    const firstInterval = pulses[1]!.timestamp - pulses[0]!.timestamp;
    expect(firstInterval).toBeGreaterThanOrEqual(70);
    expect(firstInterval).toBeLessThanOrEqual(180);

    const bpmChangeStatePromise = waitForEvent<{
      configVersion: number;
      config: {
        pulse: { active: boolean; enabled: boolean; bpm: number };
        tracks: Array<{
          trackId: string;
          tempoFlashEnabled: boolean;
          fillTime: number;
        }>;
      };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);

    const bpmChangeResponse = await fetch(`${baseUrl}/api/controller/command`, {
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
            tempoFlashEnabled: true,
            fillTime: 1.5,
          },
        },
      }),
    });

    expect(bpmChangeResponse.status).toBe(200);
    expect(await bpmChangeStatePromise).toMatchObject({
      configVersion: 3,
      config: {
        tracks: expect.arrayContaining([
          expect.objectContaining({
            trackId: "track_01",
            tempoFlashEnabled: true,
            fillTime: 1.5,
          }),
        ]),
      },
    });

    const updatePulseStatePromise = waitForEvent<{
      configVersion: number;
      config: {
        pulse: { active: boolean; enabled: boolean; bpm: number };
      };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);

    const updatePulseResponse = await fetch(
      `${baseUrl}/api/controller/command`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          command: "set_module_state",
          targetId: "screen-a",
          payload: {
            module: "pulse",
            patch: {
              active: true,
              enabled: true,
              bpm: 300,
            },
          },
        }),
      }
    );

    expect(updatePulseResponse.status).toBe(200);
    expect(await updatePulseStatePromise).toMatchObject({
      configVersion: 4,
      config: {
        pulse: {
          active: true,
          enabled: true,
          bpm: 300,
        },
      },
    });

    const pulsesBeforeChange = pulses.length;
    await waitFor(async () => pulses.length >= pulsesBeforeChange + 2, 1800);
    const secondInterval =
      pulses[pulses.length - 1]!.timestamp -
      pulses[pulses.length - 2]!.timestamp;
    expect(secondInterval).toBeGreaterThanOrEqual(160);
    expect(secondInterval).toBeLessThanOrEqual(320);

    const stopPulseStatePromise = waitForEvent<{
      configVersion: number;
      config: {
        pulse: { active: boolean; enabled: boolean; bpm: number };
      };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);

    const stopPulseResponse = await fetch(`${baseUrl}/api/controller/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: "set_module_state",
        targetId: "screen-a",
        payload: {
          module: "pulse",
          patch: {
            active: false,
            enabled: true,
          },
        },
      }),
    });

    expect(stopPulseResponse.status).toBe(200);
    expect(await stopPulseStatePromise).toMatchObject({
      configVersion: 5,
      config: {
        pulse: {
          active: false,
          enabled: true,
          bpm: 300,
        },
      },
    });

    const pulseCountAfterStop = pulses.length;
    await new Promise(resolve => setTimeout(resolve, 350));
    expect(pulses).toHaveLength(pulseCountAfterStop);
  });

  it("supports phase 5 score control, map clamping, and score reset over HTTP and socket", async () => {
    const receiver = await connectSocket(baseUrl);
    const controller = await connectSocket(baseUrl);
    sockets.push(receiver, controller);

    const initialStatePromise = waitForEvent(
      receiver,
      WS_EVENTS.RECEIVER_STATE_UPDATE
    );
    receiver.emit(WS_EVENTS.REGISTER_RECEIVER, {
      receiverId: "screen-a",
      label: "Main Screen",
    });
    await initialStatePromise;

    controller.emit(WS_EVENTS.REGISTER_CONTROLLER);
    await new Promise(resolve => setTimeout(resolve, 25));

    const scoreStatePromise = waitForEvent<{
      configVersion: number;
      config: {
        score: {
          visible: boolean;
          enabled: boolean;
          value: number;
        };
      };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);

    const scoreResponse = await fetch(`${baseUrl}/api/controller/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: "set_module_state",
        targetId: "screen-a",
        payload: {
          module: "score",
          patch: {
            scoreVisible: true,
            scoreEnabled: true,
            scoreValue: 12,
          },
        },
      }),
    });

    expect(scoreResponse.status).toBe(200);
    expect(await scoreStatePromise).toMatchObject({
      configVersion: 2,
      config: {
        score: {
          visible: true,
          enabled: true,
          value: 12,
        },
      },
    });

    const mapClampStatePromise = waitForEvent<{
      configVersion: number;
      config: {
        map: {
          visible: boolean;
          enabled: boolean;
          playerPosX: number;
          playerPosY: number;
        };
      };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);

    const mapResponse = await fetch(`${baseUrl}/api/controller/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: "set_module_state",
        targetId: "screen-a",
        payload: {
          module: "map",
          patch: {
            mapVisible: true,
            enabled: true,
            x: 1.4,
            y: -0.25,
          },
        },
      }),
    });

    expect(mapResponse.status).toBe(200);
    expect(await mapClampStatePromise).toMatchObject({
      configVersion: 3,
      config: {
        map: {
          visible: true,
          enabled: true,
          playerPosX: 1,
          playerPosY: 0,
        },
      },
    });

    const mapSocketStatePromise = waitForEvent<{
      configVersion: number;
      config: {
        map: {
          visible: boolean;
          enabled: boolean;
          playerPosX: number;
          playerPosY: number;
        };
      };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);

    controller.emit(WS_EVENTS.CONTROL_MESSAGE, {
      command: "set_module_state",
      targetId: "screen-a",
      payload: {
        module: "map",
        patch: {
          playerPosX: 0.32,
          playerPosY: 0.74,
        },
      },
      timestamp: new Date().toISOString(),
    });

    expect(await mapSocketStatePromise).toMatchObject({
      configVersion: 4,
      config: {
        map: {
          visible: true,
          enabled: true,
          playerPosX: 0.32,
          playerPosY: 0.74,
        },
      },
    });

    const mapMovementStatePromise = waitForEvent<{
      configVersion: number;
      config: {
        map: {
          playerPosX: number;
          playerPosY: number;
          movement: {
            fromX: number;
            fromY: number;
            toX: number;
            toY: number;
            startedAt: string;
            durationMs: number;
            loop: boolean;
          } | null;
        };
      };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);

    const movementStartedAt = "2026-04-14T09:00:00.000Z";
    const mapMovementResponse = await fetch(
      `${baseUrl}/api/controller/command`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          command: "set_module_state",
          targetId: "screen-a",
          payload: {
            module: "map",
            patch: {
              movement: {
                fromX: -1,
                fromY: 0.25,
                toX: 2,
                toY: 0.75,
                startedAt: movementStartedAt,
                loop: false,
              },
            },
          },
        }),
      }
    );

    expect(mapMovementResponse.status).toBe(200);
    expect(await mapMovementStatePromise).toMatchObject({
      configVersion: 5,
      config: {
        map: {
          playerPosX: 1,
          playerPosY: 0.75,
          movement: {
            fromX: 0,
            fromY: 0.25,
            toX: 1,
            toY: 0.75,
            startedAt: movementStartedAt,
            durationMs: 20_000,
            loop: false,
          },
        },
      },
    });

    const mapInstantStatePromise = waitForEvent<{
      configVersion: number;
      config: {
        map: {
          playerPosX: number;
          playerPosY: number;
          movement: null;
        };
      };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);

    controller.emit(WS_EVENTS.CONTROL_MESSAGE, {
      command: "set_module_state",
      targetId: "screen-a",
      payload: {
        module: "map",
        patch: {
          playerPosX: 0.2,
          playerPosY: 0.3,
        },
      },
      timestamp: new Date().toISOString(),
    });

    expect(await mapInstantStatePromise).toMatchObject({
      configVersion: 6,
      config: {
        map: {
          playerPosX: 0.2,
          playerPosY: 0.3,
          movement: null,
        },
      },
    });

    const scoreResetStatePromise = waitForEvent<{
      configVersion: number;
      config: {
        score: {
          visible: boolean;
          enabled: boolean;
          value: number;
        };
      };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);

    const scoreResetResponse = await fetch(
      `${baseUrl}/api/controller/command`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          command: "score_reset",
          targetId: "screen-a",
          payload: {},
        }),
      }
    );

    expect(scoreResetResponse.status).toBe(200);
    expect(await scoreResetStatePromise).toMatchObject({
      configVersion: 7,
      config: {
        score: {
          visible: true,
          enabled: true,
          value: 0,
        },
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

  it("sets the visible track array and stops hidden tracks", async () => {
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

    const playingStatePromise = waitForEvent<{
      configVersion: number;
      config: { tracks: Array<{ trackId: string; playing: boolean }> };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);

    const playResponse = await fetch(`${baseUrl}/api/controller/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: "set_track_state",
        targetId: "screen-a",
        payload: {
          trackId: "track_02",
          patch: {
            playing: true,
          },
        },
      }),
    });

    expect(playResponse.status).toBe(200);
    expect(await playingStatePromise).toMatchObject({
      configVersion: 2,
      config: {
        tracks: expect.arrayContaining([
          expect.objectContaining({
            trackId: "track_02",
            playing: true,
          }),
        ]),
      },
    });

    const commandPromise = waitForEvent<{
      command: string;
      payload: { trackIds: string[] };
    }>(receiver, WS_EVENTS.RECEIVER_COMMAND);
    const visibleStatePromise = waitForEvent<{
      configVersion: number;
      config: {
        tracks: Array<{
          trackId: string;
          visible: boolean;
          playing: boolean;
        }>;
      };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);

    const visibleResponse = await fetch(`${baseUrl}/api/controller/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: "set_visible_tracks",
        targetId: "screen-a",
        payload: {
          trackIds: ["track_01", " track_01 ", "track_02_missing"],
        },
      }),
    });
    const visibleBody = await visibleResponse.json();

    expect(visibleResponse.status).toBe(200);
    expect(visibleBody.command).toMatchObject({
      command: "set_visible_tracks",
      payload: {
        trackIds: ["track_01", "track_02_missing"],
      },
    });
    expect(await commandPromise).toMatchObject({
      command: "set_visible_tracks",
      payload: {
        trackIds: ["track_01", "track_02_missing"],
      },
    });
    expect(await visibleStatePromise).toMatchObject({
      configVersion: 3,
      config: {
        tracks: expect.arrayContaining([
          expect.objectContaining({
            trackId: "track_01",
            visible: true,
          }),
          expect.objectContaining({
            trackId: "track_02",
            visible: false,
            playing: false,
          }),
        ]),
      },
    });
  });

  it("lets a receiver request server-authorized economy playback", async () => {
    const receiver = await connectSocket(baseUrl);
    sockets.push(receiver);

    const initialStatePromise = waitForEvent(
      receiver,
      WS_EVENTS.RECEIVER_STATE_UPDATE
    );
    receiver.emit(WS_EVENTS.REGISTER_RECEIVER, {
      receiverId: "economy-a",
      label: "Economy A",
    });
    await initialStatePromise;

    const visibleTracksPromise = waitForEvent(
      receiver,
      WS_EVENTS.RECEIVER_STATE_UPDATE
    );
    const visibleTracksResponse = await fetch(
      `${baseUrl}/api/controller/command`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          command: "set_visible_tracks",
          targetId: "economy-a",
          payload: {
            trackIds: ["track_01"],
          },
        }),
      }
    );
    expect(visibleTracksResponse.status).toBe(200);
    await visibleTracksPromise;

    const track = DEFAULT_TRACK_LIBRARY.find(
      candidate => candidate.trackId === "track_01"
    );
    expect(track?.durationSeconds).toBeGreaterThan(0);

    const economyPatchedPromise = waitForEvent(
      receiver,
      WS_EVENTS.RECEIVER_STATE_UPDATE
    );
    const economyPatchResponse = await fetch(
      `${baseUrl}/api/controller/command`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          command: "set_module_state",
          targetId: "economy-a",
          payload: {
            module: "economy",
            patch: {
              enabled: true,
              currencySeconds: track!.durationSeconds,
              inflation: 1,
              gameOver: false,
              lastError: null,
            },
          },
        }),
      }
    );
    expect(economyPatchResponse.status).toBe(200);
    await economyPatchedPromise;

    const playStatePromise = waitForEvent<{
      config: {
        economy: {
          currencySeconds: number;
          currentTrackId: string | null;
          gameOver: boolean;
          lastError: string | null;
        };
        tracks: Array<{ trackId: string; playing: boolean }>;
      };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);

    receiver.emit(WS_EVENTS.CONTROL_MESSAGE, {
      command: "request_track_play",
      targetId: "economy-a",
      payload: {
        trackId: "track_01",
      },
      timestamp: new Date().toISOString(),
    });

    const playState = await playStatePromise;
    expect(playState.config.economy).toMatchObject({
      currentTrackId: "track_01",
      gameOver: false,
      lastError: null,
    });
    expect(playState.config.economy.currencySeconds).toBeCloseTo(0, 3);
    expect(playState.config.tracks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ trackId: "track_01", playing: true }),
      ])
    );
  });

  it("puts a receiver into game over when requested track cost exceeds currency", async () => {
    const receiver = await connectSocket(baseUrl);
    sockets.push(receiver);

    const initialStatePromise = waitForEvent(
      receiver,
      WS_EVENTS.RECEIVER_STATE_UPDATE
    );
    receiver.emit(WS_EVENTS.REGISTER_RECEIVER, {
      receiverId: "economy-b",
      label: "Economy B",
    });
    await initialStatePromise;

    const visibleTracksPromise = waitForEvent(
      receiver,
      WS_EVENTS.RECEIVER_STATE_UPDATE
    );
    const visibleTracksResponse = await fetch(
      `${baseUrl}/api/controller/command`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          command: "set_visible_tracks",
          targetId: "economy-b",
          payload: {
            trackIds: ["track_01"],
          },
        }),
      }
    );
    expect(visibleTracksResponse.status).toBe(200);
    await visibleTracksPromise;

    const economyPatchedPromise = waitForEvent(
      receiver,
      WS_EVENTS.RECEIVER_STATE_UPDATE
    );
    const patchResponse = await fetch(`${baseUrl}/api/controller/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: "set_module_state",
        targetId: "economy-b",
        payload: {
          module: "economy",
          patch: {
            enabled: true,
            currencySeconds: 0,
            inflation: 1,
          },
        },
      }),
    });
    expect(patchResponse.status).toBe(200);
    await economyPatchedPromise;

    const gameOverStatePromise = waitForEvent<{
      config: {
        economy: { gameOver: boolean; lastError: string | null };
        tracks: Array<{ trackId: string; playing: boolean }>;
      };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);

    receiver.emit(WS_EVENTS.CONTROL_MESSAGE, {
      command: "request_track_play",
      targetId: "economy-b",
      payload: {
        trackId: "track_01",
      },
      timestamp: new Date().toISOString(),
    });

    const gameOverState = await gameOverStatePromise;
    expect(gameOverState.config.economy).toMatchObject({
      gameOver: true,
      lastError: "insufficient_currency",
    });
    expect(gameOverState.config.tracks.some(track => track.playing)).toBe(
      false
    );
  });

  it("allows request_track_play when economy is disabled", async () => {
    const receiver = await connectSocket(baseUrl);
    sockets.push(receiver);

    const initialStatePromise = waitForEvent(
      receiver,
      WS_EVENTS.RECEIVER_STATE_UPDATE
    );
    receiver.emit(WS_EVENTS.REGISTER_RECEIVER, {
      receiverId: "economy-disabled-a",
      label: "Economy Disabled A",
    });
    await initialStatePromise;

    const visibleTracksPromise = waitForEvent(
      receiver,
      WS_EVENTS.RECEIVER_STATE_UPDATE
    );
    const visibleTracksResponse = await fetch(
      `${baseUrl}/api/controller/command`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          command: "set_visible_tracks",
          targetId: "economy-disabled-a",
          payload: {
            trackIds: ["track_01"],
          },
        }),
      }
    );
    expect(visibleTracksResponse.status).toBe(200);
    await visibleTracksPromise;

    const disabledEconomyPromise = waitForEvent(
      receiver,
      WS_EVENTS.RECEIVER_STATE_UPDATE
    );
    const disabledEconomyResponse = await fetch(
      `${baseUrl}/api/controller/command`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          command: "set_module_state",
          targetId: "economy-disabled-a",
          payload: {
            module: "economy",
            patch: {
              enabled: false,
              currencySeconds: 0,
              gameOver: true,
              lastError: "insufficient_currency",
            },
          },
        }),
      }
    );
    expect(disabledEconomyResponse.status).toBe(200);
    await disabledEconomyPromise;

    const playStatePromise = waitForEvent<{
      config: {
        economy: {
          enabled: boolean;
          currencySeconds: number;
          currentTrackId: string | null;
          gameOver: boolean;
          lastError: string | null;
        };
        tracks: Array<{ trackId: string; playing: boolean }>;
      };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);

    receiver.emit(WS_EVENTS.CONTROL_MESSAGE, {
      command: "request_track_play",
      targetId: "economy-disabled-a",
      payload: {
        trackId: "track_01",
      },
      timestamp: new Date().toISOString(),
    });

    const playState = await playStatePromise;
    expect(playState.config.economy).toMatchObject({
      enabled: false,
      currencySeconds: 0,
      currentTrackId: "track_01",
      gameOver: false,
      lastError: null,
    });
    expect(playState.config.tracks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ trackId: "track_01", playing: true }),
      ])
    );
  });

  it("does not let a receiver bypass economy with set_track_state playing true", async () => {
    const receiver = await connectSocket(baseUrl);
    sockets.push(receiver);

    const initialStatePromise = waitForEvent(
      receiver,
      WS_EVENTS.RECEIVER_STATE_UPDATE
    );
    receiver.emit(WS_EVENTS.REGISTER_RECEIVER, {
      receiverId: "economy-c",
      label: "Economy C",
    });
    await initialStatePromise;

    receiver.emit(WS_EVENTS.CONTROL_MESSAGE, {
      command: "set_track_state",
      targetId: "economy-c",
      payload: {
        trackId: "track_01",
        patch: {
          playing: true,
        },
      },
      timestamp: new Date().toISOString(),
    });

    await waitForNoEvent(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);

    const response = await fetch(`${baseUrl}/api/controller/receivers`);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.receivers[0].config.tracks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ trackId: "track_01", playing: false }),
      ])
    );
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

  it("records timing attempts, forwards them to Unity, and exports JSON", async () => {
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
      label: "Screen A",
    });
    await receiverStatePromise;

    const timingStatePromise = waitForEvent<{
      config: {
        timing: {
          visible: boolean;
          enabled: boolean;
          timingValue: number;
          targetCenter: number;
          timingTolerance: number;
        };
      };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);

    const timingResponse = await fetch(`${baseUrl}/api/controller/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: "set_module_state",
        targetId: "screen-a",
        payload: {
          module: "timing",
          patch: {
            timingVisible: true,
            timingEnabled: true,
            timingValue: 0.12,
            targetCenter: 0.55,
            tosingTolerance: 0.06,
          },
        },
      }),
    });

    expect(timingResponse.status).toBe(200);
    expect(await timingStatePromise).toMatchObject({
      config: {
        timing: {
          visible: true,
          enabled: true,
          timingValue: 0.12,
          targetCenter: 0.55,
          timingTolerance: 0.06,
        },
      },
    });

    const hitEventPromise = waitForEvent<{
      sourceRole: string;
      receiverId: string | null;
      action: string;
      element: string;
      value: { timing: boolean; timingValue: number; pulseActive: boolean };
    }>(unity, WS_EVENTS.INTERACTION_EVENT);

    receiver.emit(WS_EVENTS.INTERACTION_EVENT, {
      sourceRole: "receiver",
      receiverId: null,
      action: "submitTiming",
      element: "receiver:timing_button",
      value: {
        timing: true,
        timingValue: 0.56,
        targetCenter: 0.55,
        timingTolerance: 0.06,
        delta: 0.01,
        pulseSequence: 4,
        pulseIntervalMs: 1_000,
        pulseActive: true,
      },
      timestamp: "2026-04-09T12:00:00.000Z",
    });

    expect(await hitEventPromise).toMatchObject({
      sourceRole: "receiver",
      receiverId: "screen-a",
      action: "submitTiming",
      element: "receiver:timing_button",
      value: {
        timing: true,
        timingValue: 0.56,
        pulseActive: true,
      },
    });

    const missEventPromise = waitForEvent<{
      sourceRole: string;
      receiverId: string | null;
      action: string;
      element: string;
      value: { timing: boolean; pulseActive: boolean };
    }>(unity, WS_EVENTS.INTERACTION_EVENT);

    receiver.emit(WS_EVENTS.INTERACTION_EVENT, {
      sourceRole: "receiver",
      receiverId: null,
      action: "submitTiming",
      element: "receiver:timing_button",
      value: {
        timing: false,
        timingValue: 0.18,
        targetCenter: 0.55,
        timingTolerance: 0.06,
        delta: 0.37,
        pulseSequence: null,
        pulseIntervalMs: null,
        pulseActive: false,
      },
      timestamp: "2026-04-09T12:00:01.000Z",
    });

    expect(await missEventPromise).toMatchObject({
      sourceRole: "receiver",
      receiverId: "screen-a",
      action: "submitTiming",
      element: "receiver:timing_button",
      value: {
        timing: false,
        pulseActive: false,
      },
    });

    const exportResponse = await fetch(
      `${baseUrl}/api/controller/timing/export`
    );
    const exportBody = await exportResponse.json();

    expect(exportResponse.status).toBe(200);
    expect(exportBody).toMatchObject({
      ok: true,
      timing: {
        totalAttempts: 2,
        hits: 1,
        misses: 1,
        attempts: [
          expect.objectContaining({
            userId: "screen-a",
            receiverId: "screen-a",
            label: "Screen A",
            timing: false,
            isoTimestamp: "2026-04-09T12:00:01.000Z",
          }),
          expect.objectContaining({
            userId: "screen-a",
            receiverId: "screen-a",
            label: "Screen A",
            timing: true,
            isoTimestamp: "2026-04-09T12:00:00.000Z",
          }),
        ],
      },
    });
  });

  it("aggregates vote results, marks missing voters, and exports JSON after timeout", async () => {
    const receiverA = await connectSocket(baseUrl);
    const receiverB = await connectSocket(baseUrl);
    const receiverC = await connectSocket(baseUrl);
    const unity = await connectSocket(baseUrl);
    sockets.push(receiverA, receiverB, receiverC, unity);

    unity.emit(WS_EVENTS.REGISTER_UNITY);

    const receiverAStatePromise = waitForEvent(
      receiverA,
      WS_EVENTS.RECEIVER_STATE_UPDATE
    );
    receiverA.emit(WS_EVENTS.REGISTER_RECEIVER, {
      receiverId: "screen-a",
      label: "Screen A",
    });
    await receiverAStatePromise;

    const receiverBStatePromise = waitForEvent(
      receiverB,
      WS_EVENTS.RECEIVER_STATE_UPDATE
    );
    receiverB.emit(WS_EVENTS.REGISTER_RECEIVER, {
      receiverId: "screen-b",
      label: "Screen B",
    });
    await receiverBStatePromise;

    const receiverCStatePromise = waitForEvent(
      receiverC,
      WS_EVENTS.RECEIVER_STATE_UPDATE
    );
    receiverC.emit(WS_EVENTS.REGISTER_RECEIVER, {
      receiverId: "screen-c",
      label: "Screen C",
    });
    await receiverCStatePromise;

    const voteOpenA = waitForEvent<{
      config: { vote: { voteId: string; question: string; visible: boolean } };
    }>(receiverA, WS_EVENTS.RECEIVER_STATE_UPDATE);
    const voteOpenB = waitForEvent<{
      config: { vote: { voteId: string; question: string; visible: boolean } };
    }>(receiverB, WS_EVENTS.RECEIVER_STATE_UPDATE);
    const voteOpenC = waitForEvent<{
      config: { vote: { voteId: string; question: string; visible: boolean } };
    }>(receiverC, WS_EVENTS.RECEIVER_STATE_UPDATE);

    const openVoteResponse = await fetch(`${baseUrl}/api/controller/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: "set_vote_state",
        targetId: "*",
        payload: {
          vote: {
            voteId: "vote_timeout_001",
            voteQuestion: "Which rule should be active next?",
            voteOptions: ["Rule A", "Rule B", "Rule C"],
            voteVisible: true,
            visibilityDuration: 0.15,
            voteAllowRevote: true,
          },
        },
      }),
    });

    expect(openVoteResponse.status).toBe(200);
    expect(await voteOpenA).toMatchObject({
      config: {
        vote: {
          voteId: "vote_timeout_001",
          question: "Which rule should be active next?",
          visible: true,
        },
      },
    });
    expect(await voteOpenB).toMatchObject({
      config: {
        vote: {
          voteId: "vote_timeout_001",
          question: "Which rule should be active next?",
          visible: true,
        },
      },
    });
    expect(await voteOpenC).toMatchObject({
      config: {
        vote: {
          voteId: "vote_timeout_001",
          question: "Which rule should be active next?",
          visible: true,
        },
      },
    });

    const submitAState = waitForEvent<{
      config: { vote: { selectedOptionId: string; submittedAt: string } };
    }>(receiverA, WS_EVENTS.RECEIVER_STATE_UPDATE);
    receiverA.emit(WS_EVENTS.SUBMIT_VOTE, {
      voteId: "vote_timeout_001",
      selectedOptionId: "option_1",
    });
    expect(await submitAState).toMatchObject({
      config: {
        vote: {
          selectedOptionId: "option_1",
        },
      },
    });

    const submitBState = waitForEvent<{
      config: { vote: { selectedOptionId: string; submittedAt: string } };
    }>(receiverB, WS_EVENTS.RECEIVER_STATE_UPDATE);
    receiverB.emit(WS_EVENTS.SUBMIT_VOTE, {
      voteId: "vote_timeout_001",
      selectedOptionId: "option_2",
    });
    expect(await submitBState).toMatchObject({
      config: {
        vote: {
          selectedOptionId: "option_2",
        },
      },
    });

    const revoteAState = waitForEvent<{
      config: { vote: { selectedOptionId: string; submittedAt: string } };
    }>(receiverA, WS_EVENTS.RECEIVER_STATE_UPDATE);
    receiverA.emit(WS_EVENTS.SUBMIT_VOTE, {
      voteId: "vote_timeout_001",
      selectedOptionId: "option_3",
    });
    expect(await revoteAState).toMatchObject({
      config: {
        vote: {
          selectedOptionId: "option_3",
        },
      },
    });

    const timeoutResultPromise = waitForEvent<{
      action: string;
      value: {
        voteId: string;
        submittedCount: number;
        totalEligible: number;
        missingReceiverIds: string[];
        closeReason: string;
        isActive: boolean;
        options: Array<{ optionId: string; voteCount: number }>;
      };
    }>(unity, WS_EVENTS.INTERACTION_EVENT);

    expect(await timeoutResultPromise).toMatchObject({
      action: "voteResults",
      value: {
        voteId: "vote_timeout_001",
        submittedCount: 2,
        totalEligible: 3,
        missingReceiverIds: ["screen-c"],
        closeReason: "timeout",
        isActive: false,
        options: [
          { optionId: "option_1", voteCount: 0 },
          { optionId: "option_2", voteCount: 1 },
          { optionId: "option_3", voteCount: 1 },
        ],
      },
    });

    await waitFor(async () => {
      const response = await fetch(`${baseUrl}/api/controller/receivers`);
      const body = await response.json();
      return body.receivers.every(
        (receiver: { config: { vote: { visible: boolean } | null } }) =>
          receiver.config.vote?.visible === false
      );
    });

    const exportResponse = await fetch(
      `${baseUrl}/api/controller/votes/export`
    );
    const exportBody = await exportResponse.json();

    expect(exportResponse.status).toBe(200);
    expect(exportBody).toMatchObject({
      ok: true,
      votes: [
        {
          voteId: "vote_timeout_001",
          submittedCount: 2,
          totalEligible: 3,
          missingReceiverIds: ["screen-c"],
          closeReason: "timeout",
          isActive: false,
        },
      ],
    });
  });

  it("exports a live scoreboard with economy remaining seconds and score values", async () => {
    const receiverA = await connectSocket(baseUrl);
    const receiverB = await connectSocket(baseUrl);
    sockets.push(receiverA, receiverB);

    const receiverAStatePromise = waitForEvent(
      receiverA,
      WS_EVENTS.RECEIVER_STATE_UPDATE
    );
    receiverA.emit(WS_EVENTS.REGISTER_RECEIVER, {
      receiverId: "screen-a",
      label: "Screen A",
    });
    await receiverAStatePromise;

    const receiverBStatePromise = waitForEvent(
      receiverB,
      WS_EVENTS.RECEIVER_STATE_UPDATE
    );
    receiverB.emit(WS_EVENTS.REGISTER_RECEIVER, {
      receiverId: "screen-b",
      label: "Screen B",
    });
    await receiverBStatePromise;

    const jsonHeaders = { "content-type": "application/json" };

    const economyResponse = await fetch(`${baseUrl}/api/controller/command`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        command: "set_module_state",
        targetId: "screen-a",
        payload: {
          module: "economy",
          patch: {
            enabled: true,
            currencySeconds: 18.5,
            earnRatePerSecond: 0,
            inflationGrowthPerSecond: 0,
          },
        },
      }),
    });
    expect(economyResponse.status).toBe(200);

    const scoreResponse = await fetch(`${baseUrl}/api/controller/command`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        command: "set_module_state",
        targetId: "screen-a",
        payload: {
          module: "score",
          patch: {
            value: 7,
          },
        },
      }),
    });
    expect(scoreResponse.status).toBe(200);

    const colorChallengeResponse = await fetch(
      `${baseUrl}/api/controller/command`,
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          command: "set_module_state",
          targetId: "screen-a",
          payload: {
            module: "colorChallenge",
            patch: {
              enabled: true,
              score: 2.75,
            },
          },
        }),
      }
    );
    expect(colorChallengeResponse.status).toBe(200);

    const exportResponse = await fetch(
      `${baseUrl}/api/controller/scoreboard/export`
    );
    const exportBody = await exportResponse.json();

    expect(exportResponse.status).toBe(200);
    expect(exportBody).toMatchObject({
      ok: true,
      scoreboard: {
        generatedAt: expect.any(String),
        totalReceivers: 2,
      },
    });

    const receiverARow = exportBody.scoreboard.receivers.find(
      (receiver: { receiverId: string }) => receiver.receiverId === "screen-a"
    );
    const receiverBRow = exportBody.scoreboard.receivers.find(
      (receiver: { receiverId: string }) => receiver.receiverId === "screen-b"
    );

    expect(receiverARow).toMatchObject({
      receiverId: "screen-a",
      label: "Screen A",
      connected: true,
      economyRemainingSeconds: 18.5,
      economyEnabled: true,
      economyGameOver: false,
      manualScoreValue: 7,
      scoreSystemScore: 2.75,
      scoreSystemEnabled: true,
      scoreSystemGameOver: false,
    });
    expect(receiverBRow).toMatchObject({
      receiverId: "screen-b",
      label: "Screen B",
      connected: true,
      economyRemainingSeconds: 30,
      economyEnabled: false,
      economyGameOver: false,
      manualScoreValue: 0,
      scoreSystemScore: 1,
      scoreSystemEnabled: false,
      scoreSystemGameOver: false,
    });
  });

  it("blocks revote when disabled and vote_reset_all clears current selections", async () => {
    const receiverA = await connectSocket(baseUrl);
    const receiverB = await connectSocket(baseUrl);
    sockets.push(receiverA, receiverB);

    const receiverAStatePromise = waitForEvent(
      receiverA,
      WS_EVENTS.RECEIVER_STATE_UPDATE
    );
    receiverA.emit(WS_EVENTS.REGISTER_RECEIVER, {
      receiverId: "screen-a",
      label: "Screen A",
    });
    await receiverAStatePromise;

    const receiverBStatePromise = waitForEvent(
      receiverB,
      WS_EVENTS.RECEIVER_STATE_UPDATE
    );
    receiverB.emit(WS_EVENTS.REGISTER_RECEIVER, {
      receiverId: "screen-b",
      label: "Screen B",
    });
    await receiverBStatePromise;

    const voteOpenA = waitForEvent<{
      config: { vote: { voteId: string; allowRevote: boolean } };
    }>(receiverA, WS_EVENTS.RECEIVER_STATE_UPDATE);
    const voteOpenB = waitForEvent<{
      config: { vote: { voteId: string; allowRevote: boolean } };
    }>(receiverB, WS_EVENTS.RECEIVER_STATE_UPDATE);

    const openVoteResponse = await fetch(`${baseUrl}/api/controller/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: "set_vote_state",
        targetId: "*",
        payload: {
          vote: {
            voteId: "vote_reset_001",
            question: "Choose a color",
            options: [
              { id: "red", label: "Red" },
              { id: "blue", label: "Blue" },
            ],
            visible: true,
            visibilityDuration: 30,
            allowRevote: false,
          },
        },
      }),
    });

    expect(openVoteResponse.status).toBe(200);
    expect(await voteOpenA).toMatchObject({
      config: {
        vote: {
          voteId: "vote_reset_001",
          allowRevote: false,
        },
      },
    });
    expect(await voteOpenB).toMatchObject({
      config: {
        vote: {
          voteId: "vote_reset_001",
          allowRevote: false,
        },
      },
    });

    const firstVoteState = waitForEvent<{
      config: { vote: { selectedOptionId: string } };
    }>(receiverA, WS_EVENTS.RECEIVER_STATE_UPDATE);
    receiverA.emit(WS_EVENTS.SUBMIT_VOTE, {
      voteId: "vote_reset_001",
      selectedOptionId: "red",
    });
    expect(await firstVoteState).toMatchObject({
      config: {
        vote: {
          selectedOptionId: "red",
        },
      },
    });

    receiverA.emit(WS_EVENTS.SUBMIT_VOTE, {
      voteId: "vote_reset_001",
      selectedOptionId: "blue",
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    const receiversResponseBeforeReset = await fetch(
      `${baseUrl}/api/controller/receivers`
    );
    const receiversBodyBeforeReset = await receiversResponseBeforeReset.json();

    expect(receiversBodyBeforeReset.receivers).toMatchObject([
      expect.objectContaining({
        receiverId: "screen-a",
        config: expect.objectContaining({
          vote: expect.objectContaining({
            selectedOptionId: "red",
          }),
        }),
      }),
      expect.anything(),
    ]);

    const resetVoteA = waitForEvent<{
      config: { vote: { selectedOptionId: null; submittedAt: null } };
    }>(receiverA, WS_EVENTS.RECEIVER_STATE_UPDATE);

    const resetResponse = await fetch(`${baseUrl}/api/controller/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: "vote_reset_all",
        targetId: "*",
        payload: {},
      }),
    });

    expect(resetResponse.status).toBe(200);
    expect(await resetVoteA).toMatchObject({
      config: {
        vote: {
          selectedOptionId: null,
          submittedAt: null,
        },
      },
    });

    const exportResponse = await fetch(
      `${baseUrl}/api/controller/votes/export`
    );
    const exportBody = await exportResponse.json();

    expect(exportResponse.status).toBe(200);
    expect(exportBody).toMatchObject({
      ok: true,
      votes: [
        {
          voteId: "vote_reset_001",
          submittedCount: 0,
          totalEligible: 2,
          missingReceiverIds: ["screen-a", "screen-b"],
          isActive: true,
        },
      ],
    });
  });

  it("supports phase 11 color challenge rounds, scoring, timeout, reset, and export", async () => {
    const receiver = await connectSocket(baseUrl);
    sockets.push(receiver);

    const initialStatePromise = waitForEvent(
      receiver,
      WS_EVENTS.RECEIVER_STATE_UPDATE
    );
    receiver.emit(WS_EVENTS.REGISTER_RECEIVER, {
      receiverId: "color-a",
      label: "Color A",
    });
    await initialStatePromise;

    const enabledStatePromise = waitForEvent<{
      config: {
        colorChallenge: {
          visible: boolean;
          enabled: boolean;
          score: number;
          iterationId: string;
          assignedColorId: string;
          palette: Array<{ colorId: string; label: string; color: string }>;
          choices: Array<{ colorId: string }>;
          correctChoiceIndex: number;
          iterationStartedAt: string;
          iterationDurationMs: number;
          minIntervalMs: number;
          maxIntervalMs: number;
          refreshAssignedColorEachIteration: boolean;
        };
      };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);
    const enableResponse = await fetch(`${baseUrl}/api/controller/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: "set_module_state",
        targetId: "color-a",
        payload: {
          module: "colorChallenge",
          patch: {
            visible: true,
            enabled: true,
            score: 1,
            startingScore: 1,
            minIntervalMs: 300,
            maxIntervalMs: 300,
            maxReward: 3,
            minWrongPenalty: 0.5,
            maxWrongPenalty: 1.5,
            missPenalty: 2,
          },
        },
      }),
    });

    expect(enableResponse.status).toBe(200);
    const enabledState = await enabledStatePromise;
    const firstRound = enabledState.config.colorChallenge;

    expect(firstRound).toMatchObject({
      visible: true,
      enabled: true,
      score: 1,
      choices: expect.arrayContaining([
        expect.objectContaining({ colorId: firstRound.assignedColorId }),
      ]),
      correctChoiceIndex: expect.any(Number),
      iterationDurationMs: 300,
      barCycleDurationMs: expect.any(Number),
      barStartProgress: expect.any(Number),
    });
    expect(firstRound.choices).toHaveLength(2);
    expect(firstRound.correctChoiceIndex).toBeGreaterThanOrEqual(0);
    expect(firstRound.correctChoiceIndex).toBeLessThan(2);
    expect(firstRound.barCycleDurationMs).toBeGreaterThan(0);
    expect(firstRound.barStartProgress).toBeGreaterThanOrEqual(0);
    expect(firstRound.barStartProgress).toBeLessThanOrEqual(1);
    expect(firstRound.choices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          trackId: expect.any(String),
          trackLabel: expect.any(String),
          trackUrl: expect.any(String),
        }),
      ])
    );

    await new Promise(resolve => setTimeout(resolve, 150));

    const firstNextRound = createColorChallengeRound(
      {
        palette: firstRound.palette,
        refreshAssignedColorEachIteration:
          firstRound.refreshAssignedColorEachIteration,
        assignedColorId: firstRound.assignedColorId,
        minIntervalMs: firstRound.minIntervalMs,
        maxIntervalMs: firstRound.maxIntervalMs,
      },
      new Date().toISOString()
    );

    const correctStatePromise = waitForEvent<{
      config: {
        colorChallenge: {
          score: number;
          iterationId: string;
          lastResult: {
            reason: string;
            greenness: number;
            scoreDelta: number;
            submissionId: string;
            iterationId: string;
          };
          palette: Array<{ colorId: string; label: string; color: string }>;
          assignedColorId: string;
          choices: Array<{ colorId: string }>;
          correctChoiceIndex: number;
          minIntervalMs: number;
          maxIntervalMs: number;
          refreshAssignedColorEachIteration: boolean;
        };
      };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);
    const correctResponse = await fetch(`${baseUrl}/api/controller/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: "submit_color_challenge_choice",
        targetId: "color-a",
        payload: {
          roundId: firstRound.iterationId,
          submissionId: "submit-1",
          choiceIndex: firstRound.correctChoiceIndex,
          colorId: firstRound.choices[firstRound.correctChoiceIndex].colorId,
          pressedAt: new Date().toISOString(),
          nextRound: firstNextRound,
        },
      }),
    });

    expect(correctResponse.status).toBe(200);
    const correctState = await correctStatePromise;
    expect(correctState.config.colorChallenge.lastResult).toMatchObject({
      reason: "correct",
      submissionId: "submit-1",
      iterationId: firstRound.iterationId,
    });
    expect(
      correctState.config.colorChallenge.lastResult.greenness
    ).toBeGreaterThan(0);
    expect(
      correctState.config.colorChallenge.lastResult.scoreDelta
    ).toBeGreaterThan(0);
    expect(correctState.config.colorChallenge.score).toBeGreaterThan(1);
    expect(correctState.config.colorChallenge.iterationId).toBe(
      firstNextRound.iterationId
    );

    await new Promise(resolve => setTimeout(resolve, 150));

    const secondRound = correctState.config.colorChallenge;
    const wrongChoiceIndex = secondRound.correctChoiceIndex === 0 ? 1 : 0;
    const secondNextRound = createColorChallengeRound(
      {
        palette: secondRound.palette,
        refreshAssignedColorEachIteration:
          secondRound.refreshAssignedColorEachIteration,
        assignedColorId: secondRound.assignedColorId,
        minIntervalMs: secondRound.minIntervalMs,
        maxIntervalMs: secondRound.maxIntervalMs,
      },
      new Date().toISOString()
    );
    const wrongStatePromise = waitForEvent<{
      config: {
        colorChallenge: {
          score: number;
          iterationId: string;
          lastResult: {
            reason: string;
            scoreDelta: number;
            submissionId: string;
            iterationId: string;
          };
        };
      };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);
    const wrongResponse = await fetch(`${baseUrl}/api/controller/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: "submit_color_challenge_choice",
        targetId: "color-a",
        payload: {
          roundId: secondRound.iterationId,
          submissionId: "submit-2",
          choiceIndex: wrongChoiceIndex,
          colorId: secondRound.choices[wrongChoiceIndex].colorId,
          pressedAt: new Date().toISOString(),
          nextRound: secondNextRound,
        },
      }),
    });

    expect(wrongResponse.status).toBe(200);
    const wrongState = await wrongStatePromise;
    expect(wrongState.config.colorChallenge.lastResult).toMatchObject({
      reason: "wrong",
      submissionId: "submit-2",
      iterationId: secondRound.iterationId,
    });
    expect(wrongState.config.colorChallenge.lastResult.scoreDelta).toBeLessThan(
      0
    );
    expect(wrongState.config.colorChallenge.iterationId).toBe(
      secondNextRound.iterationId
    );

    const resetStatePromise = waitForEvent<{
      config: {
        colorChallenge: {
          score: number;
          gameOver: boolean;
          choices: Array<{ colorId: string }>;
        };
      };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);
    const resetResponse = await fetch(`${baseUrl}/api/controller/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: "color_challenge_reset",
        targetId: "color-a",
        payload: {},
      }),
    });

    expect(resetResponse.status).toBe(200);
    await expect(resetStatePromise).resolves.toMatchObject({
      config: {
        colorChallenge: {
          score: 1,
          gameOver: false,
          choices: expect.any(Array),
        },
      },
    });

    const timeoutPatchState = waitForEvent(
      receiver,
      WS_EVENTS.RECEIVER_STATE_UPDATE
    );
    const timeoutResponse = await fetch(`${baseUrl}/api/controller/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: "set_module_state",
        targetId: "color-a",
        payload: {
          module: "colorChallenge",
          patch: {
            score: 1,
            startingScore: 1,
            gameOver: false,
            minIntervalMs: 300,
            maxIntervalMs: 300,
            missPenalty: 2,
          },
        },
      }),
    });

    expect(timeoutResponse.status).toBe(200);
    await timeoutPatchState;

    const timeoutStatePromise = waitForEvent<{
      config: {
        colorChallenge: {
          score: number;
          gameOver: boolean;
          lastResult: { reason: string; scoreDelta: number };
        };
      };
    }>(receiver, WS_EVENTS.RECEIVER_STATE_UPDATE);
    const timeoutState = await timeoutStatePromise;
    expect(timeoutState.config.colorChallenge).toMatchObject({
      score: 0,
      gameOver: true,
      lastResult: {
        reason: "miss",
        scoreDelta: -2,
      },
    });

    const exportResponse = await fetch(
      `${baseUrl}/api/controller/color-challenge/export`
    );
    const exportBody = await exportResponse.json();

    expect(exportResponse.status).toBe(200);
    expect(exportBody).toMatchObject({
      ok: true,
      colorChallenge: {
        totalEvents: 3,
        correct: 1,
        wrong: 1,
        misses: 1,
        gameOvers: 1,
        events: expect.arrayContaining([
          expect.objectContaining({
            choices: expect.arrayContaining([
              expect.objectContaining({
                trackId: expect.any(String),
                trackLabel: expect.any(String),
                trackUrl: expect.any(String),
              }),
            ]),
          }),
        ]),
      },
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

  it("returns JSON for malformed bodies and recovers common Unity body artifacts", async () => {
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

    const recoveredCommandPromise = waitForEvent<{
      command: string;
      payload: { module: string; patch: { text: string } };
    }>(receiver, WS_EVENTS.RECEIVER_COMMAND);
    const recoveredResponse = await fetch(`${baseUrl}/api/controller/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body:
        JSON.stringify({
          command: "set_module_state",
          targetId: "screen-a",
          payload: {
            module: "textDisplay",
            patch: {
              text: "Recovered request body",
              visible: true,
            },
          },
        }) + "\u0000",
    });

    expect(recoveredResponse.status).toBe(200);
    await expect(recoveredCommandPromise).resolves.toMatchObject({
      command: "set_module_state",
      payload: {
        module: "textDisplay",
        patch: {
          text: "Recovered request body",
        },
      },
    });

    const malformedResponse = await fetch(`${baseUrl}/api/controller/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: `{
        "command": "set_module_state",
        "targetId": "screen-a",
        "payload": {
          "module": "economy",
          "patch": {
            "enabled": true,
            "lastError":
          }
        }
      }`,
    });

    expect(malformedResponse.status).toBe(400);
    await expect(malformedResponse.json()).resolves.toMatchObject({
      ok: false,
      error: "Malformed JSON request body",
      details: expect.any(String),
    });
  });
});
