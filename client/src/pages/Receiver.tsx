import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "wouter";
import { useSocket } from "@/hooks/useSocket";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Wifi,
  WifiOff,
  Music,
  Volume2,
  VolumeX,
  Hexagon,
  MessageSquare,
} from "lucide-react";
import type {
  ControlMessage,
  AudioControlPayload,
  AudioPlayablePayload,
  ColorChangePayload,
  TextMessagePayload,
} from "@shared/wsTypes";
import { AUDIO_URLS } from "@shared/wsTypes";

export default function Receiver() {
  const params = useParams<{ id: string }>();
  const receiverId = params.id || "unknown";

  const { connected, receiverState } = useSocket({
    role: "receiver",
    receiverId,
    receiverLabel: `Receiver ${receiverId}`,
  });

  // Audio state
  const [track1Playing, setTrack1Playing] = useState(false);
  const [track2Playing, setTrack2Playing] = useState(false);
  const [track1Playable, setTrack1Playable] = useState(true);
  const [track2Playable, setTrack2Playable] = useState(true);

  // Visual state
  const [iconColor, setIconColor] = useState("#6366f1");
  const [lastMessage, setLastMessage] = useState("");
  const [messageFlash, setMessageFlash] = useState(false);

  // Audio refs
  const audio1Ref = useRef<HTMLAudioElement | null>(null);
  const audio2Ref = useRef<HTMLAudioElement | null>(null);

  // Initialize audio elements
  useEffect(() => {
    audio1Ref.current = new Audio(AUDIO_URLS.track1);
    audio1Ref.current.loop = true;
    audio2Ref.current = new Audio(AUDIO_URLS.track2);
    audio2Ref.current.loop = true;

    return () => {
      audio1Ref.current?.pause();
      audio2Ref.current?.pause();
      audio1Ref.current = null;
      audio2Ref.current = null;
    };
  }, []);

  // Sync state from server on reconnection
  useEffect(() => {
    if (receiverState) {
      setTrack1Playing(receiverState.audio.track1.playing);
      setTrack2Playing(receiverState.audio.track2.playing);
      setTrack1Playable(receiverState.audio.track1.playable);
      setTrack2Playable(receiverState.audio.track2.playable);
      setIconColor(receiverState.iconColor);
      if (receiverState.lastMessage) {
        setLastMessage(receiverState.lastMessage);
      }
    }
  }, [receiverState]);

  // Handle incoming commands
  const handleCommand = useCallback(
    (msg: ControlMessage) => {
      switch (msg.type) {
        case "audio_control": {
          const payload = msg.payload as AudioControlPayload;
          const audioEl =
            payload.trackId === 1 ? audio1Ref.current : audio2Ref.current;
          const setPlaying =
            payload.trackId === 1 ? setTrack1Playing : setTrack2Playing;

          if (payload.action === "play" && audioEl) {
            audioEl.play().catch((e) => {
              console.warn("Audio play failed:", e);
            });
            setPlaying(true);
          } else if (payload.action === "pause" && audioEl) {
            audioEl.pause();
            setPlaying(false);
          }
          break;
        }
        case "audio_playable": {
          const payload = msg.payload as AudioPlayablePayload;
          const setPlayable =
            payload.trackId === 1 ? setTrack1Playable : setTrack2Playable;
          const audioEl =
            payload.trackId === 1 ? audio1Ref.current : audio2Ref.current;
          const setPlaying =
            payload.trackId === 1 ? setTrack1Playing : setTrack2Playing;

          setPlayable(payload.playable);
          if (!payload.playable && audioEl) {
            audioEl.pause();
            setPlaying(false);
          }
          break;
        }
        case "color_change": {
          const payload = msg.payload as ColorChangePayload;
          setIconColor(payload.color);
          break;
        }
        case "text_message": {
          const payload = msg.payload as TextMessagePayload;
          setLastMessage(payload.text);
          setMessageFlash(true);
          setTimeout(() => setMessageFlash(false), 1500);
          break;
        }
      }
    },
    []
  );

  // Listen for custom events dispatched by the socket hook
  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<ControlMessage>;
      handleCommand(customEvent.detail);
    };
    window.addEventListener("receiver_command", handler);
    return () => window.removeEventListener("receiver_command", handler);
  }, [handleCommand]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/80 backdrop-blur-sm">
        <div className="container flex items-center justify-between h-14">
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors duration-500"
              style={{ backgroundColor: iconColor + "20" }}
            >
              <Hexagon
                className="w-5 h-5 transition-colors duration-500"
                style={{ color: iconColor }}
              />
            </div>
            <div>
              <h1 className="text-sm font-semibold">
                Receiver: {receiverId}
              </h1>
              <p className="text-xs text-muted-foreground">
                Art Installation Terminal
              </p>
            </div>
          </div>
          <Badge
            variant={connected ? "default" : "destructive"}
            className="gap-1.5"
          >
            {connected ? (
              <Wifi className="w-3 h-3" />
            ) : (
              <WifiOff className="w-3 h-3" />
            )}
            {connected ? "Online" : "Offline"}
          </Badge>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container py-8">
        <div className="max-w-lg mx-auto space-y-6">
          {/* Icon Display - Central Visual Element */}
          <div className="flex flex-col items-center py-12">
            <div
              className="w-32 h-32 rounded-3xl flex items-center justify-center transition-all duration-700 ease-out shadow-lg"
              style={{
                backgroundColor: iconColor + "15",
                boxShadow: `0 0 60px ${iconColor}30, 0 0 120px ${iconColor}10`,
              }}
            >
              <Hexagon
                className="w-20 h-20 transition-all duration-700 ease-out"
                style={{
                  color: iconColor,
                  filter: `drop-shadow(0 0 20px ${iconColor}60)`,
                }}
              />
            </div>
            <p className="mt-4 text-sm font-mono text-muted-foreground">
              {iconColor}
            </p>
          </div>

          {/* Audio Status */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-4">
                <Music className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Audio Tracks</span>
              </div>
              <div className="space-y-3">
                {([
                  {
                    id: 1,
                    playing: track1Playing,
                    playable: track1Playable,
                    label: "Track 1 - Boing",
                  },
                  {
                    id: 2,
                    playing: track2Playing,
                    playable: track2Playable,
                    label: "Track 2 - Womp Womp",
                  },
                ] as const).map((track) => (
                  <div
                    key={track.id}
                    className={`flex items-center justify-between p-3 rounded-lg transition-colors ${
                      track.playing
                        ? "bg-primary/10 border border-primary/20"
                        : "bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {track.playable ? (
                        <Volume2
                          className={`w-4 h-4 ${
                            track.playing
                              ? "text-primary animate-pulse"
                              : "text-muted-foreground"
                          }`}
                        />
                      ) : (
                        <VolumeX className="w-4 h-4 text-destructive" />
                      )}
                      <span className="text-sm">{track.label}</span>
                    </div>
                    <Badge
                      variant={
                        track.playing
                          ? "default"
                          : track.playable
                          ? "secondary"
                          : "destructive"
                      }
                      className="text-xs"
                    >
                      {track.playing
                        ? "Playing"
                        : track.playable
                        ? "Ready"
                        : "Disabled"}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Text Message Display */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-4">
                <MessageSquare className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Message</span>
              </div>
              <div
                className={`min-h-[80px] p-4 rounded-lg border transition-all duration-300 flex items-center justify-center ${
                  messageFlash
                    ? "bg-primary/10 border-primary/30"
                    : "bg-muted/30 border-border"
                }`}
              >
                {lastMessage ? (
                  <p
                    className={`text-center text-lg transition-all duration-300 ${
                      messageFlash
                        ? "text-primary font-semibold scale-105"
                        : "text-foreground"
                    }`}
                  >
                    {lastMessage}
                  </p>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    Waiting for messages...
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 py-3">
        <div className="container text-center text-xs text-muted-foreground">
          Receiver ID: {receiverId} | WebSocket:{" "}
          {connected ? "Connected" : "Reconnecting..."}
        </div>
      </footer>
    </div>
  );
}
