import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useSocket } from "@/hooks/useSocket";
import {
  createDefaultReceiverConfig,
  type TrackState,
} from "@shared/wsTypes";
import {
  Hexagon,
  MessageSquare,
  Music,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from "lucide-react";

function toPerceptualGain(value: number) {
  if (value <= 0) {
    return 0;
  }

  return Math.min(1, Math.pow(value, 1.8));
}

function syncTrackAudio(audio: HTMLAudioElement, track: TrackState) {
  if (!track.url) {
    audio.pause();
    return;
  }

  if (audio.src !== new URL(track.url, window.location.origin).toString()) {
    audio.src = track.url;
  }

  audio.loop = track.loopEnabled;
  audio.volume = toPerceptualGain(track.volumeValue);

  if (!track.playable || !track.enabled || !track.visible) {
    audio.pause();
    return;
  }

  if (track.playing) {
    audio.play().catch((error) => {
      console.warn(`Failed to play ${track.trackId}:`, error);
    });
    return;
  }

  audio.pause();
}

export default function Receiver() {
  const params = useParams<{ id: string }>();
  const receiverId = params.id || "unknown";
  const { connected, receiverState, requestReceiverState } = useSocket({
    role: "receiver",
    receiverId,
    receiverLabel: `Receiver ${receiverId}`,
  });

  const audioMapRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const [messageFlash, setMessageFlash] = useState(false);
  const config = useMemo(
    () => receiverState?.config ?? createDefaultReceiverConfig(),
    [receiverState]
  );
  const iconColor = config.visuals.iconColor;

  useEffect(() => {
    const audioMap = audioMapRef.current;

    config.tracks.forEach((track) => {
      const existing = audioMap.get(track.trackId);
      if (existing) {
        return;
      }

      const audio = new Audio(track.url);
      audio.preload = "auto";
      audioMap.set(track.trackId, audio);
    });

    Array.from(audioMap.entries()).forEach(([trackId, audio]) => {
      if (config.tracks.some((track) => track.trackId === trackId)) {
        return;
      }

      audio.pause();
      audioMap.delete(trackId);
    });
  }, [config.tracks]);

  useEffect(() => {
    config.tracks.forEach((track) => {
      const audio = audioMapRef.current.get(track.trackId);
      if (!audio) {
        return;
      }

      syncTrackAudio(audio, track);
    });
  }, [config.tracks]);

  useEffect(() => {
    if (!receiverState?.configExpiresAt) {
      return;
    }

    const expiresAt = new Date(receiverState.configExpiresAt).getTime();
    const waitMs = Math.max(0, expiresAt - Date.now() + 250);
    const timer = window.setTimeout(() => {
      requestReceiverState();
    }, waitMs);

    return () => window.clearTimeout(timer);
  }, [receiverState?.configExpiresAt, requestReceiverState]);

  useEffect(() => {
    if (!config.textDisplay.text) {
      return;
    }

    setMessageFlash(true);
    const timer = window.setTimeout(() => setMessageFlash(false), 1500);
    return () => window.clearTimeout(timer);
  }, [config.textDisplay.text]);

  useEffect(() => {
    return () => {
      audioMapRef.current.forEach((audio) => {
        audio.pause();
      });
      audioMapRef.current.clear();
    };
  }, []);

  const activeTracks = useMemo(
    () => config.tracks.filter((track) => track.visible),
    [config.tracks]
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card/85 backdrop-blur">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-xl transition-colors duration-500"
              style={{ backgroundColor: `${iconColor}20` }}
            >
              <Hexagon className="h-5 w-5" style={{ color: iconColor }} />
            </div>
            <div>
              <h1 className="text-sm font-semibold">Receiver {receiverId}</h1>
              <p className="text-xs text-muted-foreground">
                State-driven config consumer
              </p>
            </div>
          </div>
          <Badge variant={connected ? "default" : "destructive"} className="gap-1.5">
            {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {connected ? "Online" : "Offline"}
          </Badge>
        </div>
      </header>

      <main className="container py-8">
        <div className="mx-auto max-w-2xl space-y-6">
          <section className="flex flex-col items-center py-10">
            <div
              className="flex h-36 w-36 items-center justify-center rounded-[2rem] shadow-lg transition-all duration-700"
              style={{
                backgroundColor: `${iconColor}15`,
                boxShadow: `0 0 50px ${iconColor}30, 0 0 120px ${iconColor}12`,
              }}
            >
              <Hexagon
                className="h-20 w-20 transition-all duration-700"
                style={{
                  color: iconColor,
                  filter: `drop-shadow(0 0 18px ${iconColor}60)`,
                }}
              />
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              config v{receiverState?.configVersion ?? 0} · expires{" "}
              {receiverState?.configExpiresAt
                ? new Date(receiverState.configExpiresAt).toLocaleTimeString()
                : "--:--:--"}
            </p>
          </section>

          <Card>
            <CardContent className="pt-6">
              <div className="mb-4 flex items-center gap-2">
                <Music className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Dynamic Tracks</span>
              </div>
              <div className="space-y-3">
                {activeTracks.map((track) => (
                  <div
                    key={track.trackId}
                    className={`rounded-xl border p-4 transition-colors ${
                      track.playing
                        ? "border-primary/30 bg-primary/8"
                        : "border-border/60 bg-muted/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        {track.playable ? (
                          <Volume2
                            className={`h-4 w-4 ${
                              track.playing
                                ? "animate-pulse text-primary"
                                : "text-muted-foreground"
                            }`}
                          />
                        ) : (
                          <VolumeX className="h-4 w-4 text-destructive" />
                        )}
                        <div>
                          <p className="text-sm font-medium">{track.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {track.trackId} · fill {track.fillTime}s · loop{" "}
                            {track.loopEnabled ? "on" : "off"}
                          </p>
                        </div>
                      </div>
                      <Badge
                        variant={
                          track.playing
                            ? "default"
                            : track.playable
                              ? "secondary"
                              : "destructive"
                        }
                      >
                        {track.playing
                          ? "Playing"
                          : track.playable
                            ? "Ready"
                            : "Muted"}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="mb-4 flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Text Display</span>
              </div>
              <div
                className={`rounded-xl border px-4 py-6 text-center transition-all ${
                  messageFlash ? "border-primary/40 bg-primary/10" : "bg-muted/40"
                }`}
              >
                <p className="text-sm leading-6">
                  {config.textDisplay.text || "No active message"}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
              <ReceiverMetaTile
                label="Pulse"
                value={config.pulse.active ? `${config.pulse.bpm} BPM` : "Off"}
              />
              <ReceiverMetaTile
                label="Score"
                value={config.score.visible ? String(config.score.value) : "Hidden"}
              />
              <ReceiverMetaTile
                label="Map"
                value={
                  config.map.visible
                    ? `${config.map.playerPosX.toFixed(2)}, ${config.map.playerPosY.toFixed(2)}`
                    : "Hidden"
                }
              />
              <ReceiverMetaTile
                label="Vote"
                value={config.vote ? `${config.vote.options.length} options` : "Inactive"}
              />
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

function ReceiverMetaTile({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/35 p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-sm font-medium">{value}</p>
    </div>
  );
}
