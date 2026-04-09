import { describe, expect, it } from "vitest";
import {
  AUDIO_URLS,
  CONFIG_TTL_MS,
  createDefaultReceiverConfig,
  legacyTrackIdToTrackKey,
  legacyControlMessageToUnifiedCommand,
  type LegacyControlMessage,
  trackKeyToLegacyTrackId,
  WS_EVENTS,
} from "../shared/wsTypes";

describe("Phase 1 shared protocol", () => {
  it("exposes the upgraded websocket events", () => {
    expect(WS_EVENTS.REGISTER_RECEIVER).toBe("register_receiver");
    expect(WS_EVENTS.REGISTER_CONTROLLER).toBe("register_controller");
    expect(WS_EVENTS.REGISTER_UNITY).toBe("register_unity");
    expect(WS_EVENTS.REQUEST_RECEIVER_STATE).toBe("request_receiver_state");
    expect(WS_EVENTS.CONTROL_MESSAGE).toBe("control_message");
    expect(WS_EVENTS.SUBMIT_VOTE).toBe("submit_vote");
    expect(WS_EVENTS.INTERACTION_EVENT).toBe("interaction_event");
    expect(WS_EVENTS.PULSE).toBe("pulse");
    expect(WS_EVENTS.RECEIVER_STATE_UPDATE).toBe("receiver_state_update");
  });

  it("creates a state-driven default receiver config", () => {
    const config = createDefaultReceiverConfig();

    expect(CONFIG_TTL_MS).toBe(60_000);
    expect(config.tracks).toHaveLength(2);
    expect(config.tracks[0]).toMatchObject({
      trackId: "track_01",
      label: "Boing",
      playing: false,
      playable: true,
      loopEnabled: false,
      loopControlVisible: true,
      loopControlLocked: false,
      volumeValue: 1,
      volumeControlVisible: false,
      volumeControlEnabled: true,
      tempoFlashEnabled: false,
      fillTime: 1,
    });
    expect(config.groups).toEqual([]);
    expect(config.pulse).toMatchObject({
      visible: false,
      enabled: false,
      active: false,
      bpm: 90,
    });
    expect(config.vote).toBeNull();
    expect(config.score).toMatchObject({
      visible: false,
      enabled: false,
      value: 0,
    });
    expect(config.map).toMatchObject({
      visible: false,
      enabled: false,
      playerPosX: 0.5,
      playerPosY: 0.5,
    });
    expect(config.timing).toMatchObject({
      visible: false,
      enabled: false,
      timingValue: 0,
      targetCenter: 0.5,
      timingTolerance: 0.08,
    });
    expect(config.visuals).toMatchObject({
      visible: true,
      enabled: true,
      iconColor: "#6366f1",
    });
    expect(config.textDisplay).toMatchObject({
      visible: false,
      enabled: true,
      text: "",
    });
  });

  it("keeps the shipped audio assets addressable through dynamic track ids", () => {
    expect(AUDIO_URLS.track_01).toBe("/audio/boing.mp3");
    expect(AUDIO_URLS.track_02).toBe("/audio/womp-womp.mp3");
  });

  it("maps legacy HTTP/socket messages into unified commands", () => {
    const legacyTextMessage: LegacyControlMessage = {
      type: "text_message",
      targetId: "receiver-a",
      payload: { text: "Hello from legacy mode" },
      timestamp: "2026-04-03T10:00:00.000Z",
    };

    expect(legacyControlMessageToUnifiedCommand(legacyTextMessage)).toEqual({
      command: "set_module_state",
      targetId: "receiver-a",
      payload: {
        module: "textDisplay",
        patch: {
          text: "Hello from legacy mode",
          visible: true,
        },
      },
      timestamp: "2026-04-03T10:00:00.000Z",
    });

    const legacyAudioMessage: LegacyControlMessage = {
      type: "audio_control",
      targetId: "receiver-a",
      payload: { trackId: 1, action: "play" },
      timestamp: "2026-04-03T10:00:01.000Z",
    };

    expect(legacyControlMessageToUnifiedCommand(legacyAudioMessage)).toEqual({
      command: "set_track_state",
      targetId: "receiver-a",
      payload: {
        trackId: "track_01",
        patch: {
          playing: true,
        },
      },
      timestamp: "2026-04-03T10:00:01.000Z",
    });

    const legacyPlayableMessage: LegacyControlMessage = {
      type: "audio_playable",
      targetId: "receiver-a",
      payload: { trackId: 2, playable: false },
      timestamp: "2026-04-03T10:00:02.000Z",
    };

    expect(legacyControlMessageToUnifiedCommand(legacyPlayableMessage)).toEqual(
      {
        command: "set_track_state",
        targetId: "receiver-a",
        payload: {
          trackId: "track_02",
          patch: {
            playable: false,
            playing: false,
          },
        },
        timestamp: "2026-04-03T10:00:02.000Z",
      }
    );
  });

  it("keeps legacy track id helpers in sync", () => {
    expect(legacyTrackIdToTrackKey(1)).toBe("track_01");
    expect(legacyTrackIdToTrackKey(2)).toBe("track_02");
    expect(trackKeyToLegacyTrackId("track_01")).toBe(1);
    expect(trackKeyToLegacyTrackId("track_02")).toBe(2);
    expect(trackKeyToLegacyTrackId("ambient_loop")).toBeNull();
  });
});
