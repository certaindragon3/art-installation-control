import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { usePostToUnity } from "@/hooks/usePostToUnity";
import { useSocket } from "@/hooks/useSocket";
import { cn } from "@/lib/utils";
import type {
  GroupState,
  ReceiverState,
  TrackState,
  UnifiedCommand,
} from "@shared/wsTypes";
import {
  AudioLines,
  Monitor,
  Music,
  Palette,
  Plus,
  RotateCcw,
  Send,
  SlidersHorizontal,
  Trash2,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";

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

const UNGROUPED_GROUP_VALUE = "__ungrouped__";

function createMachineId(prefix: "track" | "group", label: string) {
  const normalized = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `${prefix}_${normalized || prefix}_${Date.now().toString(36)}`;
}

function groupSelectValue(groupId: string | null) {
  return groupId ?? UNGROUPED_GROUP_VALUE;
}

export default function Controller() {
  const {
    connected,
    receivers,
    sendCommand,
    clearOfflineReceivers,
    postInteraction,
  } = useSocket({
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
  const [newGroupLabel, setNewGroupLabel] = useState("");
  const [newGroupColor, setNewGroupColor] = useState("#f97316");

  useEffect(() => {
    if (selectedReceiverId) {
      return;
    }

    const firstConnectedReceiver = receivers.find(
      receiver => receiver.connected
    );
    if (firstConnectedReceiver) {
      setSelectedReceiverId(firstConnectedReceiver.receiverId);
    }
  }, [receivers, selectedReceiverId]);

  useEffect(() => {
    if (
      selectedReceiverId &&
      !receivers.some(receiver => receiver.receiverId === selectedReceiverId)
    ) {
      setSelectedReceiverId("");
    }
  }, [receivers, selectedReceiverId]);

  const selectedReceiver = useMemo(
    () =>
      receivers.find(receiver => receiver.receiverId === selectedReceiverId),
    [receivers, selectedReceiverId]
  );

  useEffect(() => {
    if (!selectedReceiver) {
      return;
    }

    setCustomColor(selectedReceiver.config.visuals.iconColor);
  }, [selectedReceiver]);

  const selectedGroups = useMemo(
    () => selectedReceiver?.config.groups ?? [],
    [selectedReceiver]
  );
  const selectedPulse = useMemo(
    () => selectedReceiver?.config.pulse ?? null,
    [selectedReceiver]
  );
  const offlineReceivers = useMemo(
    () => receivers.filter(receiver => !receiver.connected),
    [receivers]
  );

  const dispatchCommand = useCallback(
    (command: Omit<UnifiedCommand, "timestamp">) => {
      sendCommand({
        ...command,
        timestamp: new Date().toISOString(),
      } as UnifiedCommand);
    },
    [sendCommand]
  );

  const patchTrack = useCallback(
    (trackId: string, patch: Partial<TrackState>) => {
      if (!selectedReceiver) {
        return;
      }

      dispatchCommand({
        command: "set_track_state",
        targetId: selectedReceiver.receiverId,
        payload: {
          trackId,
          patch,
        },
      });
    },
    [dispatchCommand, selectedReceiver]
  );

  const patchGroup = useCallback(
    (groupId: string, patch: Partial<GroupState>) => {
      if (!selectedReceiver) {
        return;
      }

      dispatchCommand({
        command: "set_group_state",
        targetId: selectedReceiver.receiverId,
        payload: {
          groupId,
          patch,
        },
      });
    },
    [dispatchCommand, selectedReceiver]
  );

  const patchPulse = useCallback(
    (patch: {
      active?: boolean;
      bpm?: number;
      enabled?: boolean;
      visible?: boolean;
    }) => {
      if (!selectedReceiver) {
        return;
      }

      dispatchCommand({
        command: "set_module_state",
        targetId: selectedReceiver.receiverId,
        payload: {
          module: "pulse",
          patch,
        },
      });
    },
    [dispatchCommand, selectedReceiver]
  );

  const handleTrackPlayState = useCallback(
    (track: TrackState, playing: boolean) => {
      if (!selectedReceiver) {
        return;
      }

      patchTrack(track.trackId, { playing });
      postDiscreteInteraction({
        action: playing ? "play" : "pause",
        element: `track:${track.trackId}:transport`,
        value: playing,
        receiverId: selectedReceiver.receiverId,
      });
    },
    [patchTrack, postDiscreteInteraction, selectedReceiver]
  );

  const handleTrackPlayable = useCallback(
    (track: TrackState, playable: boolean) => {
      if (!selectedReceiver) {
        return;
      }

      patchTrack(track.trackId, {
        playable,
        ...(playable ? {} : { playing: false }),
      });
      postDiscreteInteraction({
        action: "togglePlayable",
        element: `track:${track.trackId}:playable`,
        value: playable,
        receiverId: selectedReceiver.receiverId,
      });
    },
    [patchTrack, postDiscreteInteraction, selectedReceiver]
  );

  const handleTrackLoopState = useCallback(
    (track: TrackState) => {
      if (!selectedReceiver) {
        return;
      }

      const nextValue = !track.loopEnabled;
      patchTrack(track.trackId, { loopEnabled: nextValue });
      postDiscreteInteraction({
        action: "toggleLoop",
        element: `track:${track.trackId}:loop`,
        value: nextValue,
        receiverId: selectedReceiver.receiverId,
      });
    },
    [patchTrack, postDiscreteInteraction, selectedReceiver]
  );

  const handleTrackVolumeChange = useCallback(
    (track: TrackState, volumeValue: number) => {
      patchTrack(track.trackId, { volumeValue });
    },
    [patchTrack]
  );

  const handleTrackGroupChange = useCallback(
    (track: TrackState, value: string) => {
      if (!selectedReceiver) {
        return;
      }

      const groupId = value === UNGROUPED_GROUP_VALUE ? null : value;
      patchTrack(track.trackId, { groupId });
      postDiscreteInteraction({
        action: "assignGroup",
        element: `track:${track.trackId}:group`,
        value: groupId,
        receiverId: selectedReceiver.receiverId,
      });
    },
    [patchTrack, postDiscreteInteraction, selectedReceiver]
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

    const trackId = createMachineId("track", label);
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
          volumeControlVisible: false,
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

  const handleGroupCreate = useCallback(() => {
    if (!selectedReceiver) {
      return;
    }

    const label = newGroupLabel.trim();
    if (!label) {
      return;
    }

    const groupId = createMachineId("group", label);
    dispatchCommand({
      command: "set_group_state",
      targetId: selectedReceiver.receiverId,
      payload: {
        groupId,
        patch: {
          label,
          color: newGroupColor,
          visible: true,
          enabled: true,
          trackIds: [],
        },
      },
    });

    postDiscreteInteraction({
      action: "createGroup",
      element: "groups:add",
      value: { groupId, label, color: newGroupColor },
      receiverId: selectedReceiver.receiverId,
    });

    setNewGroupLabel("");
  }, [
    dispatchCommand,
    newGroupColor,
    newGroupLabel,
    postDiscreteInteraction,
    selectedReceiver,
  ]);

  const handleGroupRemove = useCallback(
    (groupId: string) => {
      if (!selectedReceiver) {
        return;
      }

      dispatchCommand({
        command: "remove_group",
        targetId: selectedReceiver.receiverId,
        payload: {
          groupId,
        },
      });
      postDiscreteInteraction({
        action: "removeGroup",
        element: `group:${groupId}:remove`,
        value: groupId,
        receiverId: selectedReceiver.receiverId,
      });
    },
    [dispatchCommand, postDiscreteInteraction, selectedReceiver]
  );

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
            <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10">
              <Zap className="text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">
                Phase 3 Controller
              </h1>
              <p className="text-xs text-muted-foreground">
                Pulse orchestration, track markers, and audio-state control
              </p>
            </div>
          </div>
          <Badge
            variant={connected ? "default" : "destructive"}
            className="gap-1.5"
          >
            {connected ? <Wifi /> : <WifiOff />}
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
                  <Monitor />
                  Receivers
                  <Badge variant="secondary" className="ml-auto">
                    {receivers.filter(receiver => receiver.connected).length}/
                    {receivers.length}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  Config snapshots expire after 60 seconds and receiver state
                  stays authoritative in memory.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
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
                  <Trash2 data-icon="inline-start" />
                  Clear Offline ({offlineReceivers.length})
                </Button>
                {receivers.length === 0 ? (
                  <Empty className="border-border/70 bg-muted/20">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <Monitor />
                      </EmptyMedia>
                      <EmptyTitle>No Receivers Yet</EmptyTitle>
                      <EmptyDescription>
                        Open `/receiver/:id` in another tab to register a
                        receiver before sending phase 3 commands.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  receivers.map(receiver => (
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
                <CardDescription>
                  Reset clears loop, groups, volume state, text, and all other
                  runtime modules, including pulse tempo and marker state.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  className="w-full justify-start"
                  variant="destructive"
                  onClick={handleResetAllState}
                >
                  <RotateCcw data-icon="inline-start" />
                  Reset All State
                </Button>
              </CardContent>
            </Card>
          </section>

          <section className="space-y-6 lg:col-span-8">
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <Label className="min-w-28 text-sm font-medium">
                    Target Receiver
                  </Label>
                  <Select
                    value={selectedReceiverId}
                    onValueChange={value => {
                      setSelectedReceiverId(value);
                      postDiscreteInteraction({
                        action: "selectReceiver",
                        element: "controller:receiver_dropdown",
                        value,
                        receiverId: value,
                      });
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose a receiver" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {receivers.map(receiver => (
                          <SelectItem
                            key={receiver.receiverId}
                            value={receiver.receiverId}
                          >
                            {receiver.label} ({receiver.receiverId})
                          </SelectItem>
                        ))}
                      </SelectGroup>
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
                      <Zap />
                      Pulse & Tempo
                    </CardTitle>
                    <CardDescription>
                      Server-side pulse stays authoritative so receivers can
                      sync to one clock instead of drifting locally.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                        <div>
                          <p className="text-sm font-medium">Pulse Active</p>
                          <p className="text-xs text-muted-foreground">
                            Starts or stops the server-generated beat stream.
                          </p>
                        </div>
                        <Switch
                          checked={selectedPulse?.active ?? false}
                          onCheckedChange={checked => {
                            patchPulse({
                              active: checked,
                              enabled: true,
                            });
                            postDiscreteInteraction({
                              action: checked ? "startPulse" : "stopPulse",
                              element: "pulse:active",
                              value: checked,
                              receiverId: selectedReceiver.receiverId,
                            });
                          }}
                        />
                      </div>

                      <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                        <div>
                          <p className="text-sm font-medium">
                            Pulse UI Visible
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Keeps the receiver-side heartbeat status card
                            visible.
                          </p>
                        </div>
                        <Switch
                          checked={selectedPulse?.visible ?? false}
                          onCheckedChange={checked => {
                            patchPulse({
                              visible: checked,
                              enabled: true,
                            });
                            postDiscreteInteraction({
                              action: "togglePulseVisible",
                              element: "pulse:visible",
                              value: checked,
                              receiverId: selectedReceiver.receiverId,
                            });
                          }}
                        />
                      </div>

                      <div className="rounded-lg border border-border/60 px-3 py-3 md:col-span-2">
                        <div className="mb-3 flex items-center gap-2">
                          <Zap className="text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">BPM</p>
                            <p className="text-xs text-muted-foreground">
                              Changing BPM reschedules the pulse loop on the
                              server immediately.
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <Slider
                            value={[selectedPulse?.bpm ?? 90]}
                            min={30}
                            max={240}
                            step={1}
                            onPointerDownCapture={() =>
                              beginContinuousInteraction({
                                element: "pulse:bpm",
                                startValue: selectedPulse?.bpm ?? 90,
                                receiverId: selectedReceiver.receiverId,
                              })
                            }
                            onValueChange={([value]) =>
                              patchPulse({
                                bpm: value ?? 90,
                                enabled: true,
                              })
                            }
                            onValueCommit={([value]) => {
                              postDiscreteInteraction({
                                action: "setPulseBpm",
                                element: "pulse:bpm",
                                value: value ?? 90,
                                receiverId: selectedReceiver.receiverId,
                              });
                              endContinuousInteraction({
                                element: "pulse:bpm",
                                endValue: value ?? 90,
                                receiverId: selectedReceiver.receiverId,
                              });
                            }}
                          />
                          <Input
                            type="number"
                            min={30}
                            max={240}
                            value={selectedPulse?.bpm ?? 90}
                            className="w-24"
                            onChange={event =>
                              patchPulse({
                                bpm: Number(event.target.value),
                                enabled: true,
                              })
                            }
                          />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <AudioLines />
                      Group Management
                    </CardTitle>
                    <CardDescription>
                      Create, rename, recolor, hide, disable, and remove dynamic
                      sample groups.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FieldGroup className="rounded-xl border border-dashed border-border/70 p-4">
                      <Field orientation="responsive">
                        <FieldLabel htmlFor="new-group-label">
                          Group Label
                        </FieldLabel>
                        <FieldContent>
                          <Input
                            id="new-group-label"
                            placeholder="Ambient Cluster"
                            value={newGroupLabel}
                            onFocus={() =>
                              beginContinuousInteraction({
                                element: "groups:new_label",
                                startValue: newGroupLabel,
                                receiverId: selectedReceiver.receiverId,
                              })
                            }
                            onBlur={() =>
                              endContinuousInteraction({
                                element: "groups:new_label",
                                endValue: newGroupLabel,
                                receiverId: selectedReceiver.receiverId,
                              })
                            }
                            onChange={event =>
                              setNewGroupLabel(event.target.value)
                            }
                          />
                          <FieldDescription>
                            Dropdown names stay editable from controller or
                            Unity.
                          </FieldDescription>
                        </FieldContent>
                      </Field>
                      <Field orientation="responsive">
                        <FieldLabel htmlFor="new-group-color">
                          Group Color
                        </FieldLabel>
                        <FieldContent>
                          <Input
                            id="new-group-color"
                            type="color"
                            value={newGroupColor}
                            className="h-10 w-24 p-1"
                            onFocus={() =>
                              beginContinuousInteraction({
                                element: "groups:new_color",
                                startValue: newGroupColor,
                                receiverId: selectedReceiver.receiverId,
                              })
                            }
                            onBlur={() =>
                              endContinuousInteraction({
                                element: "groups:new_color",
                                endValue: newGroupColor,
                                receiverId: selectedReceiver.receiverId,
                              })
                            }
                            onChange={event =>
                              setNewGroupColor(event.target.value)
                            }
                          />
                        </FieldContent>
                      </Field>
                      <Button
                        onClick={handleGroupCreate}
                        disabled={!newGroupLabel.trim()}
                        className="self-start"
                      >
                        <Plus data-icon="inline-start" />
                        Add Group
                      </Button>
                    </FieldGroup>

                    {selectedGroups.length === 0 ? (
                      <Empty className="border-border/70 bg-muted/20">
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <AudioLines />
                          </EmptyMedia>
                          <EmptyTitle>No Groups Configured</EmptyTitle>
                          <EmptyDescription>
                            Groups remain dynamic. Create one here, then assign
                            tracks below.
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    ) : (
                      selectedGroups.map(group => (
                        <GroupControlCard
                          key={group.groupId}
                          group={group}
                          onPatch={patchGroup}
                          onRemove={handleGroupRemove}
                          postDiscreteInteraction={postDiscreteInteraction}
                          beginContinuousInteraction={
                            beginContinuousInteraction
                          }
                          endContinuousInteraction={endContinuousInteraction}
                          receiverId={selectedReceiver.receiverId}
                        />
                      ))
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Music />
                      Tracks, Markers, and Volume
                    </CardTitle>
                    <CardDescription>
                      Assign groups, tune tempo markers, and set fill timing
                      before the receiver animates each track.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FieldGroup className="rounded-xl border border-dashed border-border/70 p-4">
                      <Field orientation="responsive">
                        <FieldLabel htmlFor="new-track-label">
                          Track Label
                        </FieldLabel>
                        <FieldContent>
                          <Input
                            id="new-track-label"
                            placeholder="Wind Chime"
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
                            onChange={event =>
                              setNewTrackLabel(event.target.value)
                            }
                          />
                        </FieldContent>
                      </Field>
                      <Field orientation="responsive">
                        <FieldLabel htmlFor="new-track-url">
                          Audio URL
                        </FieldLabel>
                        <FieldContent>
                          <Input
                            id="new-track-url"
                            placeholder="/audio/wind-chime.mp3"
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
                            onChange={event =>
                              setNewTrackUrl(event.target.value)
                            }
                          />
                        </FieldContent>
                      </Field>
                      <Button
                        onClick={handleAddTrack}
                        disabled={!newTrackLabel.trim() || !newTrackUrl.trim()}
                        className="self-start"
                      >
                        <Plus data-icon="inline-start" />
                        Add Track
                      </Button>
                    </FieldGroup>

                    {selectedReceiver.config.tracks.map(track => (
                      <TrackControlCard
                        key={track.trackId}
                        track={track}
                        groups={selectedGroups}
                        receiverId={selectedReceiver.receiverId}
                        onPlayChange={handleTrackPlayState}
                        onPlayableChange={handleTrackPlayable}
                        onLoopToggle={handleTrackLoopState}
                        onTrackPatch={patchTrack}
                        onGroupChange={handleTrackGroupChange}
                        onVolumeChange={handleTrackVolumeChange}
                        onRemove={handleTrackRemove}
                        postDiscreteInteraction={postDiscreteInteraction}
                        beginContinuousInteraction={beginContinuousInteraction}
                        endContinuousInteraction={endContinuousInteraction}
                      />
                    ))}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Palette />
                      Visuals & Text
                    </CardTitle>
                    <CardDescription>
                      These remain shared modules but are validated alongside
                      phase 2 audio state.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <Label className="text-sm font-medium">
                          Icon Color
                        </Label>
                        <Input
                          type="color"
                          value={customColor}
                          className="h-10 w-24 p-1"
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
                          onChange={event =>
                            handleColorChange(
                              event.target.value,
                              selectedReceiver.receiverId
                            )
                          }
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {PRESET_COLORS.map(color => (
                          <button
                            key={color}
                            type="button"
                            className="size-8 rounded-full border border-white/20 shadow-sm"
                            style={{ backgroundColor: color }}
                            onClick={() => {
                              handleColorChange(
                                color,
                                selectedReceiver.receiverId
                              );
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
                      <Label
                        htmlFor="controller-text-message"
                        className="text-sm font-medium"
                      >
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
                        onChange={event => setTextInput(event.target.value)}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          onClick={() =>
                            handleTextMessage(selectedReceiver.receiverId)
                          }
                        >
                          <Send data-icon="inline-start" />
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
                <CardContent className="py-10">
                  <Empty className="border-border/70 bg-muted/20">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <Monitor />
                      </EmptyMedia>
                      <EmptyTitle>Select a Receiver</EmptyTitle>
                      <EmptyDescription>
                        Pick a receiver to inspect its live config snapshot and
                        drive phase 3 commands.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </CardContent>
              </Card>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function GroupControlCard({
  group,
  onPatch,
  onRemove,
  postDiscreteInteraction,
  beginContinuousInteraction,
  endContinuousInteraction,
  receiverId,
}: {
  group: GroupState;
  onPatch: (groupId: string, patch: Partial<GroupState>) => void;
  onRemove: (groupId: string) => void;
  postDiscreteInteraction: ReturnType<
    typeof usePostToUnity
  >["postDiscreteInteraction"];
  beginContinuousInteraction: ReturnType<
    typeof usePostToUnity
  >["beginContinuousInteraction"];
  endContinuousInteraction: ReturnType<
    typeof usePostToUnity
  >["endContinuousInteraction"];
  receiverId: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/35 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span
              className="size-2.5 rounded-full"
              style={{ backgroundColor: group.color }}
            />
            <span className="font-medium">{group.label}</span>
            <Badge variant={group.visible ? "secondary" : "outline"}>
              {group.visible ? "Visible" : "Hidden"}
            </Badge>
            <Badge variant={group.enabled ? "secondary" : "outline"}>
              {group.enabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {group.groupId} · {group.trackIds.length} assigned track
            {group.trackIds.length === 1 ? "" : "s"}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onRemove(group.groupId)}
        >
          <Trash2 data-icon="inline-start" />
          Remove
        </Button>
      </div>

      <Separator className="my-4" />

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`group-label-${group.groupId}`}>Label</Label>
          <Input
            id={`group-label-${group.groupId}`}
            value={group.label}
            onFocus={() =>
              beginContinuousInteraction({
                element: `group:${group.groupId}:label`,
                startValue: group.label,
                receiverId,
              })
            }
            onBlur={() =>
              endContinuousInteraction({
                element: `group:${group.groupId}:label`,
                endValue: group.label,
                receiverId,
              })
            }
            onChange={event =>
              onPatch(group.groupId, { label: event.target.value })
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`group-color-${group.groupId}`}>Color</Label>
          <Input
            id={`group-color-${group.groupId}`}
            type="color"
            value={group.color}
            className="h-10 w-24 p-1"
            onFocus={() =>
              beginContinuousInteraction({
                element: `group:${group.groupId}:color`,
                startValue: group.color,
                receiverId,
              })
            }
            onBlur={() =>
              endContinuousInteraction({
                element: `group:${group.groupId}:color`,
                endValue: group.color,
                receiverId,
              })
            }
            onChange={event =>
              onPatch(group.groupId, { color: event.target.value })
            }
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
          <div>
            <p className="text-sm font-medium">Visible</p>
            <p className="text-xs text-muted-foreground">
              Hidden groups disappear from the receiver dropdown.
            </p>
          </div>
          <Switch
            checked={group.visible}
            onCheckedChange={checked => {
              onPatch(group.groupId, { visible: checked });
              postDiscreteInteraction({
                action: "toggleGroupVisible",
                element: `group:${group.groupId}:visible`,
                value: checked,
                receiverId,
              });
            }}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
          <div>
            <p className="text-sm font-medium">Enabled</p>
            <p className="text-xs text-muted-foreground">
              Disabled groups stay visible but gray out on the receiver.
            </p>
          </div>
          <Switch
            checked={group.enabled}
            onCheckedChange={checked => {
              onPatch(group.groupId, { enabled: checked });
              postDiscreteInteraction({
                action: "toggleGroupEnabled",
                element: `group:${group.groupId}:enabled`,
                value: checked,
                receiverId,
              });
            }}
          />
        </div>
      </div>
    </div>
  );
}

function TrackControlCard({
  track,
  groups,
  receiverId,
  onPlayChange,
  onPlayableChange,
  onLoopToggle,
  onTrackPatch,
  onGroupChange,
  onVolumeChange,
  onRemove,
  postDiscreteInteraction,
  beginContinuousInteraction,
  endContinuousInteraction,
}: {
  track: TrackState;
  groups: GroupState[];
  receiverId: string;
  onPlayChange: (track: TrackState, playing: boolean) => void;
  onPlayableChange: (track: TrackState, playable: boolean) => void;
  onLoopToggle: (track: TrackState) => void;
  onTrackPatch: (trackId: string, patch: Partial<TrackState>) => void;
  onGroupChange: (track: TrackState, value: string) => void;
  onVolumeChange: (track: TrackState, volumeValue: number) => void;
  onRemove: (track: TrackState) => void;
  postDiscreteInteraction: ReturnType<
    typeof usePostToUnity
  >["postDiscreteInteraction"];
  beginContinuousInteraction: ReturnType<
    typeof usePostToUnity
  >["beginContinuousInteraction"];
  endContinuousInteraction: ReturnType<
    typeof usePostToUnity
  >["endContinuousInteraction"];
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/40 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{track.label}</span>
            <Badge variant={track.playing ? "default" : "secondary"}>
              {track.playing ? "Playing" : "Idle"}
            </Badge>
            {!track.playable ? (
              <Badge variant="destructive">Muted</Badge>
            ) : null}
            {track.groupId ? (
              <Badge variant="outline">{track.groupId}</Badge>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {track.trackId} · loop {track.loopEnabled ? "on" : "off"} · marker{" "}
            {track.tempoFlashEnabled ? "armed" : "idle"} · volume UI{" "}
            {track.volumeControlVisible ? "visible" : "hidden"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => onPlayChange(track, true)}
            disabled={!track.playable}
          >
            <Volume2 data-icon="inline-start" />
            Play
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onPlayChange(track, false)}
          >
            <VolumeX data-icon="inline-start" />
            Pause
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onRemove(track)}>
            <Trash2 data-icon="inline-start" />
            Remove
          </Button>
        </div>
      </div>

      <Separator className="my-4" />

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
          <div>
            <p className="text-sm font-medium">Playable</p>
            <p className="text-xs text-muted-foreground">
              Legacy-compatible mute gate for this track.
            </p>
          </div>
          <Switch
            checked={track.playable}
            onCheckedChange={checked => onPlayableChange(track, checked)}
          />
        </div>

        <div className="rounded-lg border border-border/60 px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Loop Button</p>
              <p className="text-xs text-muted-foreground">
                Receiver users see this only when the control is visible.
              </p>
            </div>
            <Button
              size="sm"
              variant={track.loopEnabled ? "default" : "outline"}
              onClick={() => onLoopToggle(track)}
            >
              <AudioLines data-icon="inline-start" />
              {track.loopEnabled ? "Loop On" : "Loop Off"}
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
          <div>
            <p className="text-sm font-medium">Loop Control Visible</p>
            <p className="text-xs text-muted-foreground">
              Hidden suppresses the receiver-side loop button.
            </p>
          </div>
          <Switch
            checked={track.loopControlVisible}
            onCheckedChange={checked => {
              onTrackPatch(track.trackId, { loopControlVisible: checked });
              postDiscreteInteraction({
                action: "toggleLoopVisible",
                element: `track:${track.trackId}:loop_visible`,
                value: checked,
                receiverId,
              });
            }}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
          <div>
            <p className="text-sm font-medium">Loop Control Locked</p>
            <p className="text-xs text-muted-foreground">
              Locked keeps the button visible but non-interactive.
            </p>
          </div>
          <Switch
            checked={track.loopControlLocked}
            onCheckedChange={checked => {
              onTrackPatch(track.trackId, { loopControlLocked: checked });
              postDiscreteInteraction({
                action: "toggleLoopLocked",
                element: `track:${track.trackId}:loop_locked`,
                value: checked,
                receiverId,
              });
            }}
          />
        </div>

        <div className="space-y-2">
          <Label>Assigned Group</Label>
          <Select
            value={groupSelectValue(track.groupId)}
            onValueChange={value => onGroupChange(track, value)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Assign a group" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={UNGROUPED_GROUP_VALUE}>Ungrouped</SelectItem>
                {groups.map(group => (
                  <SelectItem key={group.groupId} value={group.groupId}>
                    {group.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
          <div>
            <p className="text-sm font-medium">Tempo Flash Enabled</p>
            <p className="text-xs text-muted-foreground">
              Receiver markers flash in time with the pulse stream.
            </p>
          </div>
          <Switch
            checked={track.tempoFlashEnabled}
            onCheckedChange={checked => {
              onTrackPatch(track.trackId, { tempoFlashEnabled: checked });
              postDiscreteInteraction({
                action: "toggleTempoFlash",
                element: `track:${track.trackId}:tempo_flash`,
                value: checked,
                receiverId,
              });
            }}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
          <div>
            <p className="text-sm font-medium">Volume Popup Visible</p>
            <p className="text-xs text-muted-foreground">
              Remote override for showing or hiding the popup control.
            </p>
          </div>
          <Switch
            checked={track.volumeControlVisible}
            onCheckedChange={checked => {
              onTrackPatch(track.trackId, { volumeControlVisible: checked });
              postDiscreteInteraction({
                action: "toggleVolumeVisible",
                element: `track:${track.trackId}:volume_visible`,
                value: checked,
                receiverId,
              });
            }}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
          <div>
            <p className="text-sm font-medium">Volume Popup Enabled</p>
            <p className="text-xs text-muted-foreground">
              Disabled keeps volume externally controlled.
            </p>
          </div>
          <Switch
            checked={track.volumeControlEnabled}
            onCheckedChange={checked => {
              onTrackPatch(track.trackId, { volumeControlEnabled: checked });
              postDiscreteInteraction({
                action: "toggleVolumeEnabled",
                element: `track:${track.trackId}:volume_enabled`,
                value: checked,
                receiverId,
              });
            }}
          />
        </div>

        <div className="rounded-lg border border-border/60 px-3 py-3 md:col-span-2">
          <div className="mb-3 flex items-center gap-2">
            <Zap className="text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Fill Time</p>
              <p className="text-xs text-muted-foreground">
                Progress loops from empty to full, then triggers a flash.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Slider
              value={[track.fillTime]}
              min={0.1}
              max={8}
              step={0.1}
              onPointerDownCapture={() =>
                beginContinuousInteraction({
                  element: `track:${track.trackId}:fill_time`,
                  startValue: track.fillTime,
                  receiverId,
                })
              }
              onValueChange={([value]) =>
                onTrackPatch(track.trackId, { fillTime: value ?? 0.1 })
              }
              onValueCommit={([value]) => {
                postDiscreteInteraction({
                  action: "setFillTime",
                  element: `track:${track.trackId}:fill_time`,
                  value: value ?? 0.1,
                  receiverId,
                });
                endContinuousInteraction({
                  element: `track:${track.trackId}:fill_time`,
                  endValue: value ?? 0.1,
                  receiverId,
                });
              }}
            />
            <Input
              type="number"
              min={0.1}
              max={8}
              step={0.1}
              className="w-24"
              value={track.fillTime}
              onChange={event =>
                onTrackPatch(track.trackId, {
                  fillTime: Number(event.target.value),
                })
              }
            />
            <span className="w-16 text-right text-xs text-muted-foreground">
              {track.fillTime.toFixed(1)}s
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-border/60 px-3 py-3 md:col-span-2">
          <div className="mb-3 flex items-center gap-2">
            <SlidersHorizontal className="text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Default Volume</p>
              <p className="text-xs text-muted-foreground">
                Continuous Unity events are emitted only on drag start and
                commit.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Slider
              value={[track.volumeValue]}
              min={0}
              max={1}
              step={0.01}
              onPointerDownCapture={() =>
                beginContinuousInteraction({
                  element: `track:${track.trackId}:volume`,
                  startValue: track.volumeValue,
                  receiverId,
                })
              }
              onValueChange={([value]) => onVolumeChange(track, value ?? 0)}
              onValueCommit={([value]) =>
                endContinuousInteraction({
                  element: `track:${track.trackId}:volume`,
                  endValue: value ?? 0,
                  receiverId,
                })
              }
            />
            <span className="w-12 text-right text-xs text-muted-foreground">
              {Math.round(track.volumeValue * 100)}%
            </span>
          </div>
        </div>
      </div>
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
      className={cn(
        "w-full rounded-xl border p-4 text-left transition",
        selected
          ? "border-primary/60 bg-primary/5"
          : "border-border/60 bg-card hover:border-primary/30"
      )}
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
        <span>{receiver.config.groups.length} groups</span>
      </div>
      <p className="mt-2 truncate text-xs text-muted-foreground">
        {receiver.config.textDisplay.text || "No active text message"}
      </p>
    </button>
  );
}
