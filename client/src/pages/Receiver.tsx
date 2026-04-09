import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { usePostToUnity } from "@/hooks/usePostToUnity";
import { useSocket } from "@/hooks/useSocket";
import { cn } from "@/lib/utils";
import { volumeValueToGain, volumeValueToPercent } from "@shared/audio";
import { createDefaultReceiverConfig, type TrackState } from "@shared/wsTypes";
import {
  AudioLines,
  Hexagon,
  MessageSquare,
  Music,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from "lucide-react";

function syncTrackAudio(audio: HTMLAudioElement, track: TrackState) {
  if (!track.url) {
    audio.pause();
    return;
  }

  if (audio.src !== new URL(track.url, window.location.origin).toString()) {
    audio.src = track.url;
  }

  audio.loop = track.loopEnabled;
  audio.volume = volumeValueToGain(track.volumeValue);

  if (!track.playable || !track.enabled || !track.visible) {
    audio.pause();
    return;
  }

  if (track.playing) {
    audio.play().catch(error => {
      console.warn(`Failed to play ${track.trackId}:`, error);
    });
    return;
  }

  audio.pause();
}

export default function Receiver() {
  const params = useParams<{ id: string }>();
  const receiverId = params.id || "unknown";
  const {
    connected,
    receiverState,
    requestReceiverState,
    sendCommand,
    postInteraction,
  } = useSocket({
    role: "receiver",
    receiverId,
    receiverLabel: `Receiver ${receiverId}`,
  });
  const {
    postDiscreteInteraction,
    beginContinuousInteraction,
    endContinuousInteraction,
  } = usePostToUnity({
    sourceRole: "receiver",
    receiverId,
    postInteraction,
  });

  const audioMapRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const [messageFlash, setMessageFlash] = useState(false);
  const [selectedTrackByGroup, setSelectedTrackByGroup] = useState<
    Record<string, string>
  >({});
  const [activeVolumeTrackId, setActiveVolumeTrackId] = useState<string | null>(
    null
  );

  const config = useMemo(
    () => receiverState?.config ?? createDefaultReceiverConfig(),
    [receiverState]
  );
  const iconColor = config.visuals.iconColor;

  const dispatchTrackPatch = useCallback(
    (trackId: string, patch: Partial<TrackState>) => {
      sendCommand({
        command: "set_track_state",
        targetId: receiverId,
        payload: {
          trackId,
          patch,
        },
        timestamp: new Date().toISOString(),
      });
    },
    [receiverId, sendCommand]
  );

  useEffect(() => {
    const audioMap = audioMapRef.current;

    config.tracks.forEach(track => {
      const existing = audioMap.get(track.trackId);
      if (existing) {
        return;
      }

      const audio = new Audio(track.url);
      audio.preload = "auto";
      audioMap.set(track.trackId, audio);
    });

    Array.from(audioMap.entries()).forEach(([trackId, audio]) => {
      if (config.tracks.some(track => track.trackId === trackId)) {
        return;
      }

      audio.pause();
      audioMap.delete(trackId);
    });
  }, [config.tracks]);

  useEffect(() => {
    config.tracks.forEach(track => {
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
      audioMapRef.current.forEach(audio => {
        audio.pause();
      });
      audioMapRef.current.clear();
    };
  }, []);

  const visibleTracks = useMemo(
    () => config.tracks.filter(track => track.visible),
    [config.tracks]
  );
  const visibleGroups = useMemo(
    () => config.groups.filter(group => group.visible),
    [config.groups]
  );

  const groupTrackMap = useMemo(() => {
    const trackMap = new Map<string, TrackState>();
    visibleTracks.forEach(track => {
      trackMap.set(track.trackId, track);
    });

    return visibleGroups.reduce<Record<string, TrackState[]>>((acc, group) => {
      acc[group.groupId] = group.trackIds
        .map(trackId => trackMap.get(trackId))
        .filter((track): track is TrackState => Boolean(track));
      return acc;
    }, {});
  }, [visibleGroups, visibleTracks]);

  const hiddenOrMissingGroupIds = useMemo(() => {
    const ids = new Set<string>();
    config.groups.forEach(group => {
      if (!group.visible) {
        ids.add(group.groupId);
      }
    });
    return ids;
  }, [config.groups]);

  const ungroupedTracks = useMemo(
    () =>
      visibleTracks.filter(
        track =>
          !track.groupId ||
          (!groupTrackMap[track.groupId] &&
            !hiddenOrMissingGroupIds.has(track.groupId))
      ),
    [groupTrackMap, hiddenOrMissingGroupIds, visibleTracks]
  );

  useEffect(() => {
    setSelectedTrackByGroup(current => {
      const next = { ...current };

      visibleGroups.forEach(group => {
        const tracks = groupTrackMap[group.groupId] ?? [];
        if (tracks.length === 0) {
          delete next[group.groupId];
          return;
        }

        const currentTrackId = current[group.groupId];
        if (
          currentTrackId &&
          tracks.some(track => track.trackId === currentTrackId)
        ) {
          return;
        }

        next[group.groupId] =
          tracks.find(track => track.playing)?.trackId ?? tracks[0].trackId;
      });

      Object.keys(next).forEach(groupId => {
        if (!visibleGroups.some(group => group.groupId === groupId)) {
          delete next[groupId];
        }
      });

      return next;
    });
  }, [groupTrackMap, visibleGroups]);

  useEffect(() => {
    if (!activeVolumeTrackId) {
      return;
    }

    const activeTrack = config.tracks.find(
      track => track.trackId === activeVolumeTrackId
    );
    if (
      !activeTrack ||
      !activeTrack.playing ||
      !activeTrack.volumeControlVisible ||
      !activeTrack.volumeControlEnabled
    ) {
      setActiveVolumeTrackId(null);
    }
  }, [activeVolumeTrackId, config.tracks]);

  const handlePlayToggle = useCallback(
    (track: TrackState) => {
      const nextPlaying = !track.playing;
      dispatchTrackPatch(track.trackId, { playing: nextPlaying });
      postDiscreteInteraction({
        action: nextPlaying ? "play" : "pause",
        element: `track:${track.trackId}:transport`,
        value: nextPlaying,
      });

      if (
        nextPlaying &&
        track.volumeControlVisible &&
        track.volumeControlEnabled
      ) {
        setActiveVolumeTrackId(track.trackId);
        return;
      }

      if (!nextPlaying && activeVolumeTrackId === track.trackId) {
        setActiveVolumeTrackId(null);
      }
    },
    [activeVolumeTrackId, dispatchTrackPatch, postDiscreteInteraction]
  );

  const handleLoopToggle = useCallback(
    (track: TrackState) => {
      if (!track.loopControlVisible || track.loopControlLocked) {
        return;
      }

      const nextLoop = !track.loopEnabled;
      dispatchTrackPatch(track.trackId, { loopEnabled: nextLoop });
      postDiscreteInteraction({
        action: "toggleLoop",
        element: `track:${track.trackId}:loop`,
        value: nextLoop,
      });
    },
    [dispatchTrackPatch, postDiscreteInteraction]
  );

  const handleVolumeDismiss = useCallback(
    (track: TrackState) => {
      dispatchTrackPatch(track.trackId, { playing: false });
      postDiscreteInteraction({
        action: "dismissVolume",
        element: `track:${track.trackId}:volume_outside`,
        value: "outside",
      });
      setActiveVolumeTrackId(current =>
        current === track.trackId ? null : current
      );
    },
    [dispatchTrackPatch, postDiscreteInteraction]
  );

  const handleVolumeChange = useCallback(
    (track: TrackState, value: number) => {
      dispatchTrackPatch(track.trackId, { volumeValue: value });
    },
    [dispatchTrackPatch]
  );

  const handleGroupSelection = useCallback(
    (groupId: string, trackId: string) => {
      setSelectedTrackByGroup(current => ({
        ...current,
        [groupId]: trackId,
      }));
      postDiscreteInteraction({
        action: "selectGroupTrack",
        element: `group:${groupId}:dropdown`,
        value: trackId,
      });
    },
    [postDiscreteInteraction]
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card/85 backdrop-blur">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="flex size-9 items-center justify-center rounded-xl transition-colors duration-500"
              style={{ backgroundColor: `${iconColor}20` }}
            >
              <Hexagon style={{ color: iconColor }} />
            </div>
            <div>
              <h1 className="text-sm font-semibold">Receiver {receiverId}</h1>
              <p className="text-xs text-muted-foreground">
                Phase 2 audio interaction surface
              </p>
            </div>
          </div>
          <Badge
            variant={connected ? "default" : "destructive"}
            className="gap-1.5"
          >
            {connected ? <Wifi /> : <WifiOff />}
            {connected ? "Online" : "Offline"}
          </Badge>
        </div>
      </header>

      <main className="container py-8">
        <div className="mx-auto max-w-4xl space-y-6">
          <section className="flex flex-col items-center py-6">
            <div
              className="flex h-32 w-32 items-center justify-center rounded-[2rem] shadow-lg transition-all duration-700"
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

          {visibleGroups.length > 0 ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Music />
                  Sample Groups
                </CardTitle>
                <CardDescription>
                  Group dropdowns stay dynamic and gray out when access is
                  disabled.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {visibleGroups.map(group => {
                  const tracks = groupTrackMap[group.groupId] ?? [];
                  const selectedTrackId = selectedTrackByGroup[group.groupId];
                  const selectedTrack =
                    tracks.find(track => track.trackId === selectedTrackId) ??
                    tracks[0];

                  if (!selectedTrack) {
                    return null;
                  }

                  return (
                    <div
                      key={group.groupId}
                      className={cn(
                        "rounded-2xl border p-4 transition-colors",
                        group.enabled ? "bg-muted/30" : "bg-muted/15 opacity-70"
                      )}
                      style={{ borderColor: `${group.color}55` }}
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span
                              className="size-2.5 rounded-full"
                              style={{ backgroundColor: group.color }}
                            />
                            <span className="font-medium">{group.label}</span>
                            <Badge
                              variant={group.enabled ? "secondary" : "outline"}
                            >
                              {group.enabled ? "Enabled" : "Locked"}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {tracks.length} track option
                            {tracks.length === 1 ? "" : "s"}
                          </p>
                        </div>

                        <div className="w-full md:max-w-xs">
                          <Label className="sr-only">Choose track</Label>
                          <Select
                            value={selectedTrack.trackId}
                            onValueChange={value =>
                              handleGroupSelection(group.groupId, value)
                            }
                            disabled={!group.enabled}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Choose a track" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {tracks.map(track => (
                                  <SelectItem
                                    key={track.trackId}
                                    value={track.trackId}
                                  >
                                    {track.label}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <Separator className="my-4" />

                      <ReceiverTrackCard
                        track={selectedTrack}
                        disabled={!group.enabled}
                        activeVolumeTrackId={activeVolumeTrackId}
                        onPlayToggle={handlePlayToggle}
                        onLoopToggle={handleLoopToggle}
                        onVolumeChange={handleVolumeChange}
                        onVolumeDismiss={handleVolumeDismiss}
                        onVolumeOpen={trackId =>
                          setActiveVolumeTrackId(trackId)
                        }
                        beginContinuousInteraction={beginContinuousInteraction}
                        endContinuousInteraction={endContinuousInteraction}
                      />
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}

          {ungroupedTracks.length > 0 ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <AudioLines />
                  Direct Tracks
                </CardTitle>
                <CardDescription>
                  Tracks without a visible group remain directly playable.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 lg:grid-cols-2">
                {ungroupedTracks.map(track => (
                  <ReceiverTrackCard
                    key={track.trackId}
                    track={track}
                    disabled={false}
                    activeVolumeTrackId={activeVolumeTrackId}
                    onPlayToggle={handlePlayToggle}
                    onLoopToggle={handleLoopToggle}
                    onVolumeChange={handleVolumeChange}
                    onVolumeDismiss={handleVolumeDismiss}
                    onVolumeOpen={trackId => setActiveVolumeTrackId(trackId)}
                    beginContinuousInteraction={beginContinuousInteraction}
                    endContinuousInteraction={endContinuousInteraction}
                  />
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageSquare />
                Text Display
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className={cn(
                  "rounded-xl border px-4 py-6 text-center transition-all",
                  messageFlash
                    ? "border-primary/40 bg-primary/10"
                    : "bg-muted/40"
                )}
              >
                <p className="text-sm leading-6">
                  {config.textDisplay.text || "No active message"}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

function ReceiverTrackCard({
  track,
  disabled,
  activeVolumeTrackId,
  onPlayToggle,
  onLoopToggle,
  onVolumeChange,
  onVolumeDismiss,
  onVolumeOpen,
  beginContinuousInteraction,
  endContinuousInteraction,
}: {
  track: TrackState;
  disabled: boolean;
  activeVolumeTrackId: string | null;
  onPlayToggle: (track: TrackState) => void;
  onLoopToggle: (track: TrackState) => void;
  onVolumeChange: (track: TrackState, value: number) => void;
  onVolumeDismiss: (track: TrackState) => void;
  onVolumeOpen: (trackId: string | null) => void;
  beginContinuousInteraction: ReturnType<
    typeof usePostToUnity
  >["beginContinuousInteraction"];
  endContinuousInteraction: ReturnType<
    typeof usePostToUnity
  >["endContinuousInteraction"];
}) {
  const volumeOpen =
    activeVolumeTrackId === track.trackId &&
    track.playing &&
    track.volumeControlVisible &&
    track.volumeControlEnabled;

  return (
    <div className="rounded-xl border border-border/60 bg-card/80 p-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{track.label}</span>
              <Badge variant={track.playing ? "default" : "secondary"}>
                {track.playing ? "Playing" : "Idle"}
              </Badge>
              {!track.playable ? (
                <Badge variant="destructive">Unavailable</Badge>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {track.trackId} · volume {volumeValueToPercent(track.volumeValue)}
              % · loop {track.loopEnabled ? "on" : "off"}
            </p>
          </div>

          <Button
            size="sm"
            variant={track.playing ? "secondary" : "default"}
            disabled={disabled || !track.playable}
            onClick={() => onPlayToggle(track)}
          >
            {track.playing ? (
              <VolumeX data-icon="inline-start" />
            ) : (
              <Volume2 data-icon="inline-start" />
            )}
            {track.playing ? "Stop" : "Play"}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {track.loopControlVisible ? (
            <Button
              size="sm"
              variant={track.loopEnabled ? "default" : "outline"}
              disabled={disabled || track.loopControlLocked}
              onClick={() => onLoopToggle(track)}
            >
              <AudioLines data-icon="inline-start" />
              {track.loopControlLocked
                ? "Loop Locked"
                : track.loopEnabled
                  ? "Loop On"
                  : "Loop Off"}
            </Button>
          ) : (
            <Badge variant="outline">Loop Hidden</Badge>
          )}

          {track.volumeControlEnabled ? (
            <Popover
              open={volumeOpen}
              onOpenChange={open => {
                if (open && track.playing && track.volumeControlVisible) {
                  onVolumeOpen(track.trackId);
                  return;
                }

                if (!open && activeVolumeTrackId === track.trackId) {
                  onVolumeOpen(null);
                }
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant={volumeOpen ? "secondary" : "outline"}
                  disabled={
                    disabled || !track.playing || !track.volumeControlVisible
                  }
                >
                  <SlidersHorizontal data-icon="inline-start" />
                  Volume
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-[min(24rem,calc(100vw-2rem))] rounded-2xl p-5"
                onInteractOutside={event => {
                  event.preventDefault();
                  onVolumeDismiss(track);
                }}
              >
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-medium">{track.label}</p>
                    <p className="text-xs text-muted-foreground">
                      Logarithmic gain mapping for performative control.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-muted/35 p-4">
                    <Slider
                      value={[track.volumeValue]}
                      min={0}
                      max={1}
                      step={0.01}
                      className="py-4"
                      onPointerDownCapture={() =>
                        beginContinuousInteraction({
                          element: `track:${track.trackId}:volume`,
                          startValue: track.volumeValue,
                        })
                      }
                      onValueChange={([value]) =>
                        onVolumeChange(track, value ?? 0)
                      }
                      onValueCommit={([value]) =>
                        endContinuousInteraction({
                          element: `track:${track.trackId}:volume`,
                          endValue: value ?? 0,
                        })
                      }
                    />
                    <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                      <span>Soft</span>
                      <span>{volumeValueToPercent(track.volumeValue)}%</span>
                      <span>Full</span>
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          ) : (
            <Badge variant="outline">Volume External</Badge>
          )}
        </div>
      </div>
    </div>
  );
}
