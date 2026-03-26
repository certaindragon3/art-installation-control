import { describe, expect, it } from "vitest";
import type {
  ControlMessage,
  ReceiverState,
  AudioControlPayload,
  AudioPlayablePayload,
  ColorChangePayload,
  TextMessagePayload,
  MessageType,
} from "../shared/wsTypes";
import { WS_EVENTS, AUDIO_URLS } from "../shared/wsTypes";

describe("WebSocket Message Types", () => {
  it("should have correct WS_EVENTS constants", () => {
    expect(WS_EVENTS.REGISTER_RECEIVER).toBe("register_receiver");
    expect(WS_EVENTS.REGISTER_CONTROLLER).toBe("register_controller");
    expect(WS_EVENTS.CONTROL_MESSAGE).toBe("control_message");
    expect(WS_EVENTS.CLEAR_OFFLINE_RECEIVERS).toBe("clear_offline_receivers");
    expect(WS_EVENTS.RECEIVER_LIST).toBe("receiver_list");
    expect(WS_EVENTS.RECEIVER_COMMAND).toBe("receiver_command");
    expect(WS_EVENTS.RECEIVER_STATE_UPDATE).toBe("receiver_state_update");
    expect(WS_EVENTS.CONNECT).toBe("connect");
    expect(WS_EVENTS.DISCONNECT).toBe("disconnect");
    expect(WS_EVENTS.CONNECTION).toBe("connection");
  });

  it("should have valid local audio asset URLs", () => {
    expect(AUDIO_URLS.track1).toMatch(/^\/audio\//);
    expect(AUDIO_URLS.track2).toMatch(/^\/audio\//);
    expect(AUDIO_URLS.track1).toContain("boing");
    expect(AUDIO_URLS.track2).toContain("womp-womp");
  });

  it("should validate audio_control message structure", () => {
    const msg: ControlMessage = {
      type: "audio_control",
      targetId: "receiver-1",
      payload: { trackId: 1, action: "play" } as AudioControlPayload,
      timestamp: new Date().toISOString(),
    };

    expect(msg.type).toBe("audio_control");
    expect(msg.targetId).toBe("receiver-1");
    const payload = msg.payload as AudioControlPayload;
    expect(payload.trackId).toBe(1);
    expect(payload.action).toBe("play");
    expect(msg.timestamp).toBeTruthy();
  });

  it("should validate audio_playable message structure", () => {
    const msg: ControlMessage = {
      type: "audio_playable",
      targetId: "receiver-2",
      payload: { trackId: 2, playable: false } as AudioPlayablePayload,
      timestamp: new Date().toISOString(),
    };

    expect(msg.type).toBe("audio_playable");
    const payload = msg.payload as AudioPlayablePayload;
    expect(payload.trackId).toBe(2);
    expect(payload.playable).toBe(false);
  });

  it("should validate color_change message structure", () => {
    const msg: ControlMessage = {
      type: "color_change",
      targetId: "receiver-1",
      payload: { color: "#ff0000" } as ColorChangePayload,
      timestamp: new Date().toISOString(),
    };

    expect(msg.type).toBe("color_change");
    const payload = msg.payload as ColorChangePayload;
    expect(payload.color).toBe("#ff0000");
  });

  it("should validate text_message message structure", () => {
    const msg: ControlMessage = {
      type: "text_message",
      targetId: "*",
      payload: { text: "Hello all receivers!" } as TextMessagePayload,
      timestamp: new Date().toISOString(),
    };

    expect(msg.type).toBe("text_message");
    expect(msg.targetId).toBe("*");
    const payload = msg.payload as TextMessagePayload;
    expect(payload.text).toBe("Hello all receivers!");
  });

  it("should validate broadcast targetId", () => {
    const broadcastMsg: ControlMessage = {
      type: "text_message",
      targetId: "*",
      payload: { text: "broadcast" } as TextMessagePayload,
      timestamp: new Date().toISOString(),
    };
    expect(broadcastMsg.targetId).toBe("*");

    const targetedMsg: ControlMessage = {
      type: "text_message",
      targetId: "specific-receiver",
      payload: { text: "targeted" } as TextMessagePayload,
      timestamp: new Date().toISOString(),
    };
    expect(targetedMsg.targetId).not.toBe("*");
  });
});

describe("ReceiverState structure", () => {
  it("should have correct default state shape", () => {
    const state: ReceiverState = {
      receiverId: "test-1",
      label: "Test Receiver",
      connected: true,
      audio: {
        track1: { playing: false, playable: true },
        track2: { playing: false, playable: true },
      },
      iconColor: "#6366f1",
      lastMessage: "",
    };

    expect(state.receiverId).toBe("test-1");
    expect(state.connected).toBe(true);
    expect(state.audio.track1.playing).toBe(false);
    expect(state.audio.track1.playable).toBe(true);
    expect(state.audio.track2.playing).toBe(false);
    expect(state.audio.track2.playable).toBe(true);
    expect(state.iconColor).toBe("#6366f1");
    expect(state.lastMessage).toBe("");
  });

  it("should support all message types", () => {
    const types: MessageType[] = [
      "audio_control",
      "audio_playable",
      "color_change",
      "text_message",
    ];
    expect(types).toHaveLength(4);
    types.forEach((t) => expect(typeof t).toBe("string"));
  });
});
