import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useSocket } from "@/hooks/useSocket";
import { usePostToUnity } from "@/hooks/usePostToUnity";
import {
  Monitor,
  Music,
  Palette,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import type { ReceiverState, TrackState, UnifiedCommand } from "@shared/wsTypes";

const PRESET_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#ec4899",
  "#ffffff",
  "#111827",
];

function createTrackId(label: string) {
  const normalized = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `${normalized || "track"}_${Date.now().toString(36)}`;
}

export default function Controller() {
  const { connected, receivers, sendCommand, clearOfflineReceivers, postInteraction } =
    useSocket({
      role: "controller",
    });
  const {
    postDiscreteInteraction,
    beginContinuousInteraction,
    endContinuousInteraction,
  } = usePostToUnity({
    sourceRole: "controller",
    postInteraction,
  });

  const [selectedReceiverId, setSelectedReceiverId] = useState("");
  const [textInput, setTextInput] = useState("");
  const [customColor, setCustomColor] = useState("#6366f1");
  const [newTrackLabel, setNewTrackLabel] = useState("");
  const [newTrackUrl, setNewTrackUrl] = useState("");

  useEffect(() => {
    if (selectedReceiverId) {
      return;
    }

    const firstConnectedReceiver = receivers.find((receiver) => receiver.connected);
    if (firstConnectedReceiver) {
      setSelectedReceiverId(firstConnectedReceiver.receiverId);
    }
  }, [receivers, selectedReceiverId]);

  useEffect(() => {
    if (
      selectedReceiverId &&
      !receivers.some((receiver) => receiver.receiverId === selectedReceiverId)
    ) {
      setSelectedReceiverId("");
    }
  }, [receivers, selectedReceiverId]);

  const selectedReceiver = useMemo(
    () => receivers.find((receiver) => receiver.receiverId === selectedReceiverId),
    [receivers, selectedReceiverId]
  );

  useEffect(() => {
    if (!selectedReceiver) {
      return;
    }

    setCustomColor(selectedReceiver.config.visuals.iconColor);
  }, [selectedReceiver]);

  const offlineReceivers = receivers.filter((receiver) => !receiver.connected);

  const dispatchCommand = useCallback(
    (command: Omit<UnifiedCommand, "timestamp">) => {
      sendCommand({
        ...command,
        timestamp: new Date().toISOString(),
      } as UnifiedCommand);
    },
    [sendCommand]
  );

  const handleTrackPlayState = useCallback(
    (track: TrackState, playing: boolean) => {
      if (!selectedReceiver) {
        return;
      }

      dispatchCommand({
        command: "set_track_state",
        targetId: selectedReceiver.receiverId,
        payload: {
          trackId: track.trackId,
          patch: { playing },
        },
      });

      postDiscreteInteraction({
        action: playing ? "play" : "pause",
        element: `track:${track.trackId}:transport`,
        value: playing,
        receiverId: selectedReceiver.receiverId,
      });
    },
    [dispatchCommand, postDiscreteInteraction, selectedReceiver]
  );

  const handleTrackPlayable = useCallback(
    (track: TrackState, playable: boolean) => {
      if (!selectedReceiver) {
        return;
      }

      dispatchCommand({
        command: "set_track_state",
        targetId: selectedReceiver.receiverId,
        payload: {
          trackId: track.trackId,
          patch: {
            playable,
            ...(playable ? {} : { playing: false }),
          },
        },
      });

      postDiscreteInteraction({
        action: "togglePlayable",
        element: `track:${track.trackId}:playable`,
        value: playable,
        receiverId: selectedReceiver.receiverId,
      });
    },
    [dispatchCommand, postDiscreteInteraction, selectedReceiver]
  );

  const handleTrackVolumeChange = useCallback(
    (track: TrackState, volumeValue: number) => {
      if (!selectedReceiver) {
        return;
      }

      dispatchCommand({
        command: "set_track_state",
        targetId: selectedReceiver.receiverId,
        payload: {
          trackId: track.trackId,
          patch: {
            volumeValue,
            volumeControlVisible: true,
          },
        },
      });
    },
    [dispatchCommand, selectedReceiver]
  );

  const handleTrackRemove = useCallback(
    (track: TrackState) => {
      if (!selectedReceiver) {
        return;
      }

      dispatchCommand({
        command: "remove_track",
        targetId: selectedReceiver.receiverId,
        payload: {
          trackId: track.trackId,
        },
      });

      postDiscreteInteraction({
        action: "removeTrack",
        element: `track:${track.trackId}:remove`,
        value: track.trackId,
        receiverId: selectedReceiver.receiverId,
      });
    },
    [dispatchCommand, postDiscreteInteraction, selectedReceiver]
  );

  const handleAddTrack = useCallback(() => {
    if (!selectedReceiver) {
      return;
    }

    const label = newTrackLabel.trim();
    const url = newTrackUrl.trim();
    if (!label || !url) {
      return;
    }

    const trackId = createTrackId(label);
    dispatchCommand({
      command: "set_track_state",
      targetId: selectedReceiver.receiverId,
      payload: {
        trackId,
        patch: {
          label,
          url,
          visible: true,
          enabled: true,
          playable: true,
          playing: false,
          loopEnabled: false,
          loopControlVisible: true,
          loopControlLocked: false,
          volumeValue: 1,
          volumeControlVisible: true,
          volumeControlEnabled: true,
          tempoFlashEnabled: false,
          fillTime: 1,
          groupId: null,
        },
      },
    });

    postDiscreteInteraction({
      action: "addTrack",
      element: "tracks:add",
      value: { trackId, label, url },
      receiverId: selectedReceiver.receiverId,
    });

    setNewTrackLabel("");
    setNewTrackUrl("");
  }, [
    dispatchCommand,
    newTrackLabel,
    newTrackUrl,
    postDiscreteInteraction,
    selectedReceiver,
  ]);

  const handleColorChange = useCallback(
    (color: string, receiverId: string) => {
      setCustomColor(color);
      dispatchCommand({
        command: "set_module_state",
        targetId: receiverId,
        payload: {
          module: "visuals",
          patch: {
            iconColor: color,
            visible: true,
          },
        },
      });
    },
    [dispatchCommand]
  );

  const handleTextMessage = useCallback(
    (targetId: string) => {
      const nextText = textInput.trim();
      if (!nextText) {
        return;
      }

      dispatchCommand({
        command: "set_module_state",
        targetId,
        payload: {
          module: "textDisplay",
          patch: {
            text: nextText,
            visible: true,
            enabled: true,
          },
        },
      });

      postDiscreteInteraction({
        action: "sendText",
        element: "textDisplay:text",
        value: nextText,
        receiverId: targetId === "*" ? null : targetId,
      });

      setTextInput("");
    },
    [dispatchCommand, postDiscreteInteraction, textInput]
  );

  const handleResetAllState = useCallback(() => {
    dispatchCommand({
      command: "reset_all_state",
      targetId: "*",
      payload: {},
    });

    postDiscreteInteraction({
      action: "reset",
      element: "system:reset_all_state",
      value: true,
      receiverId: null,
    });
  }, [dispatchCommand, postDiscreteInteraction]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border/60 bg-card/90 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
              <Zap className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">
                Phase 1 Controller
              </h1>
              <p className="text-xs text-muted-foreground">
                Unified commands + state-driven receivers
              </p>
            </div>
          </div>
          <Badge variant={connected ? "default" : "destructive"} className="gap-1.5">
            {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {connected ? "Connected" : "Disconnected"}
          </Badge>
        </div>
      </header>

      <main className="container py-6">
        <div className="grid gap-6 lg:grid-cols-12">
          <section className="space-y-6 lg:col-span-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Monitor className="h-4 w-4" />
                  Receivers
                  <Badge variant="secondary" className="ml-auto">
                    {receivers.filter((receiver) => receiver.connected).length}/
                    {receivers.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
                  Config snapshots expire after 60 seconds. Receivers will
                  re-request state automatically.
                </div>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => {
                    clearOfflineReceivers();
                    postDiscreteInteraction({
                      action: "clearOfflineReceivers",
                      element: "system:clear_offline_receivers",
                      value: offlineReceivers.length,
                      receiverId: null,
                    });
                  }}
                  disabled={offlineReceivers.length === 0}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Clear Offline ({offlineReceivers.length})
                </Button>
                {receivers.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
                    Open `/receiver/:id` in another tab to register a receiver.
                  </div>
                ) : (
                  receivers.map((receiver) => (
                    <ReceiverSummaryCard
                      key={receiver.receiverId}
                      receiver={receiver}
                      selected={receiver.receiverId === selectedReceiverId}
                      onClick={() => {
                        setSelectedReceiverId(receiver.receiverId);
                        postDiscreteInteraction({
                          action: "selectReceiver",
                          element: "controller:receiver_selector",
                          value: receiver.receiverId,
                          receiverId: receiver.receiverId,
                        });
                      }}
                    />
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">System Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button className="w-full justify-start" variant="destructive" onClick={handleResetAllState}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Reset All State
                </Button>
                <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                  `reset_all_state` broadcasts default config to every receiver and
                  clears runtime changes across modules.
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="space-y-6 lg:col-span-8">
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <Label className="min-w-28 text-sm font-medium">Target Receiver</Label>
                  <Select
                    value={selectedReceiverId}
                    onValueChange={(value) => {
                      setSelectedReceiverId(value);
                      postDiscreteInteraction({
                        action: "selectReceiver",
                        element: "controller:receiver_dropdown",
                        value,
                        receiverId: value,
                      });
                    }}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Choose a receiver" />
                    </SelectTrigger>
                    <SelectContent>
                      {receivers.map((receiver) => (
                        <SelectItem key={receiver.receiverId} value={receiver.receiverId}>
                          {receiver.label} ({receiver.receiverId})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {selectedReceiver ? (
              <>
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Music className="h-4 w-4" />
                      Dynamic Tracks
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="rounded-xl border border-dashed border-border/70 p-4">
                      <div className="grid gap-3 md:grid-cols-[1fr_1.4fr_auto]">
                        <Input
                          placeholder="Track label"
                          value={newTrackLabel}
                          onFocus={() =>
                            beginContinuousInteraction({
                              element: "tracks:new_label",
                              startValue: newTrackLabel,
                              receiverId: selectedReceiver.receiverId,
                            })
                          }
                          onBlur={() =>
                            endContinuousInteraction({
                              element: "tracks:new_label",
                              endValue: newTrackLabel,
                              receiverId: selectedReceiver.receiverId,
                            })
                          }
                          onChange={(event) => setNewTrackLabel(event.target.value)}
                        />
                        <Input
                          placeholder="Audio URL"
                          value={newTrackUrl}
                          onFocus={() =>
                            beginContinuousInteraction({
                              element: "tracks:new_url",
                              startValue: newTrackUrl,
                              receiverId: selectedReceiver.receiverId,
                            })
                          }
                          onBlur={() =>
                            endContinuousInteraction({
                              element: "tracks:new_url",
                              endValue: newTrackUrl,
                              receiverId: selectedReceiver.receiverId,
                            })
                          }
                          onChange={(event) => setNewTrackUrl(event.target.value)}
                        />
                        <Button
                          onClick={handleAddTrack}
                          disabled={!newTrackLabel.trim() || !newTrackUrl.trim()}
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          Add Track
                        </Button>
                      </div>
                    </div>
                    {selectedReceiver.config.tracks.map((track) => (
                      <div
                        key={track.trackId}
                        className="rounded-xl border border-border/60 bg-muted/40 p-4"
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{track.label}</span>
                              <Badge variant={track.playing ? "default" : "secondary"}>
                                {track.playing ? "Playing" : "Idle"}
                              </Badge>
                              {!track.playable ? (
                                <Badge variant="destructive">Disabled</Badge>
                              ) : null}
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              `{track.trackId}` · volume {track.volumeValue.toFixed(2)} ·
                              loop {track.loopEnabled ? "on" : "off"}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              size="sm"
                              onClick={() => handleTrackPlayState(track, true)}
                              disabled={!track.playable}
                            >
                              <Volume2 className="mr-2 h-4 w-4" />
                              Play
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleTrackPlayState(track, false)}
                            >
                              <VolumeX className="mr-2 h-4 w-4" />
                              Pause
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleTrackRemove(track)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Remove
                            </Button>
                          </div>
                        </div>
                        <Separator className="my-4" />
                        <div className="grid gap-4 md:grid-cols-[1fr_1.4fr] md:items-center">
                          <div>
                            <p className="text-sm font-medium">Playable</p>
                            <p className="text-xs text-muted-foreground">
                              Backward-compatible replacement for
                              `audio_playable`.
                            </p>
                          </div>
                          <Switch
                            checked={track.playable}
                            onCheckedChange={(checked) =>
                              handleTrackPlayable(track, checked)
                            }
                          />
                          <div>
                            <p className="text-sm font-medium">Volume</p>
                            <p className="text-xs text-muted-foreground">
                              Continuous control posts only start/end interaction
                              events to Unity.
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            <Slider
                              value={[track.volumeValue]}
                              min={0}
                              max={1}
                              step={0.01}
                              onFocus={() =>
                                beginContinuousInteraction({
                                  element: `track:${track.trackId}:volume`,
                                  startValue: track.volumeValue,
                                  receiverId: selectedReceiver.receiverId,
                                })
                              }
                              onValueChange={([value]) =>
                                handleTrackVolumeChange(track, value ?? 0)
                              }
                              onValueCommit={([value]) =>
                                endContinuousInteraction({
                                  element: `track:${track.trackId}:volume`,
                                  endValue: value ?? 0,
                                  receiverId: selectedReceiver.receiverId,
                                })
                              }
                              onBlur={() =>
                                endContinuousInteraction({
                                  element: `track:${track.trackId}:volume`,
                                  endValue: track.volumeValue,
                                  receiverId: selectedReceiver.receiverId,
                                })
                              }
                            />
                            <span className="w-12 text-right text-xs text-muted-foreground">
                              {Math.round(track.volumeValue * 100)}%
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Palette className="h-4 w-4" />
                      Visuals & Text
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">Icon Color</Label>
                        <Input
                          type="color"
                          value={customColor}
                          className="h-10 w-20 p-1"
                          onFocus={() =>
                            beginContinuousInteraction({
                              element: "visuals:iconColor",
                              startValue: customColor,
                              receiverId: selectedReceiver.receiverId,
                            })
                          }
                          onBlur={() =>
                            endContinuousInteraction({
                              element: "visuals:iconColor",
                              endValue: customColor,
                              receiverId: selectedReceiver.receiverId,
                            })
                          }
                          onChange={(event) =>
                            handleColorChange(
                              event.target.value,
                              selectedReceiver.receiverId
                            )
                          }
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {PRESET_COLORS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            className="h-8 w-8 rounded-full border border-white/20 shadow-sm"
                            style={{ backgroundColor: color }}
                            onClick={() => {
                              handleColorChange(color, selectedReceiver.receiverId);
                              postDiscreteInteraction({
                                action: "setColorPreset",
                                element: "visuals:iconColor:preset",
                                value: color,
                                receiverId: selectedReceiver.receiverId,
                              });
                            }}
                            aria-label={`Set color ${color}`}
                          />
                        ))}
                      </div>
                    </div>

                    <Separator />

                    <div className="space-y-3">
                      <Label htmlFor="controller-text-message" className="text-sm font-medium">
                        Text Message
                      </Label>
                      <Textarea
                        id="controller-text-message"
                        placeholder="Push a message to the selected receiver or broadcast to all receivers."
                        value={textInput}
                        onFocus={() =>
                          beginContinuousInteraction({
                            element: "textDisplay:composer",
                            startValue: textInput,
                            receiverId: selectedReceiver.receiverId,
                          })
                        }
                        onBlur={() =>
                          endContinuousInteraction({
                            element: "textDisplay:composer",
                            endValue: textInput,
                            receiverId: selectedReceiver.receiverId,
                          })
                        }
                        onChange={(event) => setTextInput(event.target.value)}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button onClick={() => handleTextMessage(selectedReceiver.receiverId)}>
                          <Send className="mr-2 h-4 w-4" />
                          Send to Selected
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => handleTextMessage("*")}
                        >
                          Broadcast to All
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card>
                <CardContent className="py-14 text-center text-sm text-muted-foreground">
                  Select a receiver to inspect its config snapshot and send unified
                  commands.
                </CardContent>
              </Card>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function ReceiverSummaryCard({
  receiver,
  selected,
  onClick,
}: {
  receiver: ReceiverState;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl border p-4 text-left transition ${
        selected
          ? "border-primary/60 bg-primary/5"
          : "border-border/60 bg-card hover:border-primary/30"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{receiver.label}</span>
            <Badge variant={receiver.connected ? "default" : "secondary"}>
              {receiver.connected ? "Online" : "Offline"}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {receiver.receiverId}
          </p>
        </div>
        <Badge variant="outline">v{receiver.configVersion}</Badge>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>{receiver.config.tracks.length} tracks</span>
        <span>{receiver.config.visuals.iconColor}</span>
      </div>
      <p className="mt-2 truncate text-xs text-muted-foreground">
        {receiver.config.textDisplay.text || "No active text message"}
      </p>
    </button>
  );
}
