import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import { ClassroomMap } from "@/components/ClassroomMap";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { usePostToUnity } from "@/hooks/usePostToUnity";
import { useSocket } from "@/hooks/useSocket";
import { cn } from "@/lib/utils";
import type {
  MapConfig,
  MapMovementConfig,
  ColorChallengeConfig,
  EconomyConfig,
  ReceiverState,
  ScoreConfig,
  TimingConfig,
  TrackState,
  UnifiedCommand,
} from "@shared/wsTypes";
import { clampNormalizedCoordinate } from "@shared/wsTypes";
import {
  AudioLines,
  Coins,
  Download,
  Map as MapIcon,
  Monitor,
  Music,
  Minus,
  Palette,
  Plus,
  RotateCcw,
  Send,
  SlidersHorizontal,
  Target,
  Trophy,
  Trash2,
  Vote,
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

const MAP_SCALE_MAX = 100;
const MAP_SCALE_STEP = 0.1;
const DEFAULT_MAP_MOVEMENT_DURATION_SECONDS = 20;

type MapMovementDraft = {
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  durationSeconds: number;
  loop: boolean;
};

type NumericInputProps = Omit<
  ComponentPropsWithoutRef<typeof Input>,
  "type" | "value" | "onChange"
> & {
  value: number;
  onValueChange: (value: number) => void;
  formatValue?: (value: number) => string;
};

function NumericInput({
  value,
  onValueChange,
  formatValue = nextValue => String(nextValue),
  onFocus,
  onBlur,
  ...props
}: NumericInputProps) {
  const [draftValue, setDraftValue] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (focused) {
      return;
    }

    setDraftValue(null);
  }, [focused, value]);

  return (
    <Input
      {...props}
      type="number"
      value={draftValue ?? formatValue(value)}
      onFocus={event => {
        setFocused(true);
        setDraftValue(current => current ?? formatValue(value));
        onFocus?.(event);
      }}
      onBlur={event => {
        setFocused(false);
        setDraftValue(current => {
          if (current === null) {
            return null;
          }

          const parsed = Number(current);
          if (!Number.isFinite(parsed) || parsed === value) {
            return null;
          }

          return current;
        });
        onBlur?.(event);
      }}
      onChange={event => {
        const nextValue = event.target.value;
        setDraftValue(nextValue);

        if (
          nextValue === "" ||
          nextValue === "-" ||
          nextValue === "." ||
          nextValue === "-."
        ) {
          return;
        }

        const parsed = Number(nextValue);
        if (Number.isFinite(parsed)) {
          onValueChange(parsed);
        }
      }}
    />
  );
}

function mapXNormalizedToScale(value: number) {
  return clampNormalizedCoordinate(value, 0.5) * MAP_SCALE_MAX;
}

function mapXScaleToNormalized(value: number) {
  return clampNormalizedCoordinate(value / MAP_SCALE_MAX, 0.5);
}

function mapYNormalizedToScale(value: number) {
  return (1 - clampNormalizedCoordinate(value, 0.5)) * MAP_SCALE_MAX;
}

function mapYScaleToNormalized(value: number) {
  return 1 - clampNormalizedCoordinate(value / MAP_SCALE_MAX, 0.5);
}

function clampMapScale(value: number) {
  if (!Number.isFinite(value)) {
    return MAP_SCALE_MAX / 2;
  }

  return Math.min(MAP_SCALE_MAX, Math.max(0, value));
}

function createMapMovementDraft(map: MapConfig | null): MapMovementDraft {
  const movement = map?.movement;
  if (movement) {
    return {
      startX: mapXNormalizedToScale(movement.fromX),
      startY: mapYNormalizedToScale(movement.fromY),
      targetX: mapXNormalizedToScale(movement.toX),
      targetY: mapYNormalizedToScale(movement.toY),
      durationSeconds: movement.durationMs / 1000,
      loop: movement.loop,
    };
  }

  const currentX = mapXNormalizedToScale(map?.playerPosX ?? 0.5);
  const currentY = mapYNormalizedToScale(map?.playerPosY ?? 0.5);

  return {
    startX: currentX,
    startY: currentY,
    targetX: currentX,
    targetY: currentY,
    durationSeconds: DEFAULT_MAP_MOVEMENT_DURATION_SECONDS,
    loop: true,
  };
}

function createMachineId(prefix: "track" | "vote", label: string) {
  const normalized = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `${prefix}_${normalized || prefix}_${Date.now().toString(36)}`;
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
  const [voteQuestionInput, setVoteQuestionInput] = useState(
    "Which rule should be active next?"
  );
  const [voteOptionsInput, setVoteOptionsInput] = useState(
    "Rule A\nRule B\nRule C"
  );
  const [mapMovementDraft, setMapMovementDraft] = useState<MapMovementDraft>(
    () => createMapMovementDraft(null)
  );
  const [voteVisibilityDuration, setVoteVisibilityDuration] = useState(15);
  const [voteAllowRevote, setVoteAllowRevote] = useState(false);
  const [exportingVotes, setExportingVotes] = useState(false);
  const [exportingTiming, setExportingTiming] = useState(false);
  const [exportingColorChallenge, setExportingColorChallenge] = useState(false);
  const [colorChallengePaletteInput, setColorChallengePaletteInput] = useState(
    "red,Red,#ef4444\ngreen,Green,#22c55e\nblue,Blue,#3b82f6\nyellow,Yellow,#eab308"
  );

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

  const selectedPulse = useMemo(
    () => selectedReceiver?.config.pulse ?? null,
    [selectedReceiver]
  );
  const selectedScore = useMemo(
    () => selectedReceiver?.config.score ?? null,
    [selectedReceiver]
  );
  const selectedMap = useMemo(
    () => selectedReceiver?.config.map ?? null,
    [selectedReceiver]
  );

  useEffect(() => {
    setMapMovementDraft(createMapMovementDraft(selectedMap));
  }, [selectedReceiverId]);

  const selectedTiming = useMemo(
    () => selectedReceiver?.config.timing ?? null,
    [selectedReceiver]
  );
  const selectedEconomy = useMemo(
    () => selectedReceiver?.config.economy ?? null,
    [selectedReceiver]
  );
  const selectedColorChallenge = useMemo(
    () => selectedReceiver?.config.colorChallenge ?? null,
    [selectedReceiver]
  );
  const selectedVote = useMemo(
    () => selectedReceiver?.config.vote ?? null,
    [selectedReceiver]
  );

  useEffect(() => {
    if (!selectedColorChallenge) {
      return;
    }

    setColorChallengePaletteInput(
      selectedColorChallenge.palette
        .map(color => `${color.colorId},${color.label},${color.color}`)
        .join("\n")
    );
  }, [selectedReceiverId]);
  const offlineReceivers = useMemo(
    () => receivers.filter(receiver => !receiver.connected),
    [receivers]
  );
  const selectedVoteReceivers = useMemo(() => {
    if (!selectedVote) {
      return [];
    }

    return receivers.filter(
      receiver => receiver.config.vote?.voteId === selectedVote.voteId
    );
  }, [receivers, selectedVote]);
  const selectedVoteSummary = useMemo(() => {
    if (!selectedVote) {
      return null;
    }

    const optionTallies = selectedVote.options.map(option => ({
      ...option,
      voteCount: selectedVoteReceivers.filter(
        receiver => receiver.config.vote?.selectedOptionId === option.id
      ).length,
    }));
    const missingReceivers = selectedVoteReceivers.filter(
      receiver => receiver.config.vote?.selectedOptionId === null
    );

    return {
      optionTallies,
      missingReceivers,
      submittedCount: selectedVoteReceivers.length - missingReceivers.length,
      totalEligible: selectedVoteReceivers.length,
    };
  }, [selectedVote, selectedVoteReceivers]);

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

  const patchScore = useCallback(
    (patch: Partial<ScoreConfig>) => {
      if (!selectedReceiver) {
        return;
      }

      dispatchCommand({
        command: "set_module_state",
        targetId: selectedReceiver.receiverId,
        payload: {
          module: "score",
          patch,
        },
      });
    },
    [dispatchCommand, selectedReceiver]
  );

  const patchMap = useCallback(
    (patch: Record<string, unknown>) => {
      if (!selectedReceiver) {
        return;
      }

      dispatchCommand({
        command: "set_module_state",
        targetId: selectedReceiver.receiverId,
        payload: {
          module: "map",
          patch,
        },
      });
    },
    [dispatchCommand, selectedReceiver]
  );

  const updateMapMovementDraft = useCallback(
    (patch: Partial<MapMovementDraft>) => {
      setMapMovementDraft(current => ({
        ...current,
        ...patch,
      }));
    },
    []
  );

  const sendMapMovement = useCallback(() => {
    if (!selectedReceiver) {
      return;
    }

    const durationSeconds = Math.min(
      600,
      Math.max(0.1, mapMovementDraft.durationSeconds)
    );
    const movement: Omit<MapMovementConfig, "startedAt"> = {
      fromX: mapXScaleToNormalized(mapMovementDraft.startX),
      fromY: mapYScaleToNormalized(mapMovementDraft.startY),
      toX: mapXScaleToNormalized(mapMovementDraft.targetX),
      toY: mapYScaleToNormalized(mapMovementDraft.targetY),
      durationMs: Math.round(durationSeconds * 1000),
      loop: mapMovementDraft.loop,
    };

    patchMap({
      visible: true,
      enabled: true,
      movement,
    });
    postDiscreteInteraction({
      action: "sendMapMovement",
      element: "map:movement",
      value: {
        ...movement,
        durationSeconds,
      },
      receiverId: selectedReceiver.receiverId,
    });
  }, [mapMovementDraft, patchMap, postDiscreteInteraction, selectedReceiver]);

  const stopMapMovement = useCallback(() => {
    if (!selectedReceiver) {
      return;
    }

    patchMap({
      movement: null,
    });
    postDiscreteInteraction({
      action: "stopMapMovement",
      element: "map:movement",
      value: null,
      receiverId: selectedReceiver.receiverId,
    });
  }, [patchMap, postDiscreteInteraction, selectedReceiver]);

  const patchTiming = useCallback(
    (patch: Partial<TimingConfig>) => {
      if (!selectedReceiver) {
        return;
      }

      dispatchCommand({
        command: "set_module_state",
        targetId: selectedReceiver.receiverId,
        payload: {
          module: "timing",
          patch,
        },
      });
    },
    [dispatchCommand, selectedReceiver]
  );

  const patchEconomy = useCallback(
    (patch: Partial<EconomyConfig>) => {
      if (!selectedReceiver) {
        return;
      }

      dispatchCommand({
        command: "set_module_state",
        targetId: selectedReceiver.receiverId,
        payload: {
          module: "economy",
          patch,
        },
      });
    },
    [dispatchCommand, selectedReceiver]
  );

  const patchColorChallenge = useCallback(
    (patch: Partial<ColorChallengeConfig>) => {
      if (!selectedReceiver) {
        return;
      }

      dispatchCommand({
        command: "set_module_state",
        targetId: selectedReceiver.receiverId,
        payload: {
          module: "colorChallenge",
          patch,
        },
      });
    },
    [dispatchCommand, selectedReceiver]
  );

  const resetColorChallenge = useCallback(() => {
    if (!selectedReceiver) {
      return;
    }

    dispatchCommand({
      command: "color_challenge_reset",
      targetId: selectedReceiver.receiverId,
      payload: {},
    });
    postDiscreteInteraction({
      action: "resetColorChallenge",
      element: "colorChallenge:reset",
      value: true,
      receiverId: selectedReceiver.receiverId,
    });
  }, [dispatchCommand, postDiscreteInteraction, selectedReceiver]);

  const resetEconomy = useCallback(() => {
    if (!selectedReceiver) {
      return;
    }

    dispatchCommand({
      command: "economy_reset",
      targetId: selectedReceiver.receiverId,
      payload: {},
    });
    postDiscreteInteraction({
      action: "resetEconomy",
      element: "economy:reset",
      value: true,
      receiverId: selectedReceiver.receiverId,
    });
  }, [dispatchCommand, postDiscreteInteraction, selectedReceiver]);

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

  const applyVisibleTrackIds = useCallback(
    (targetId: string, trackIds: string[]) => {
      dispatchCommand({
        command: "set_visible_tracks",
        targetId,
        payload: {
          trackIds,
        },
      });
    },
    [dispatchCommand]
  );

  const handleVisibleTrackChange = useCallback(
    (trackId: string, visible: boolean) => {
      if (!selectedReceiver) {
        return;
      }

      const nextTrackIds = selectedReceiver.config.tracks
        .filter(track => (track.trackId === trackId ? visible : track.visible))
        .map(track => track.trackId);

      applyVisibleTrackIds(selectedReceiver.receiverId, nextTrackIds);
      postDiscreteInteraction({
        action: "setVisibleTracks",
        element: "tracks:visible",
        value: nextTrackIds,
        receiverId: selectedReceiver.receiverId,
      });
    },
    [applyVisibleTrackIds, postDiscreteInteraction, selectedReceiver]
  );

  const handleShowAllTracks = useCallback(() => {
    if (!selectedReceiver) {
      return;
    }

    const trackIds = selectedReceiver.config.tracks.map(track => track.trackId);
    applyVisibleTrackIds(selectedReceiver.receiverId, trackIds);
    postDiscreteInteraction({
      action: "showAllTracks",
      element: "tracks:visible",
      value: trackIds,
      receiverId: selectedReceiver.receiverId,
    });
  }, [applyVisibleTrackIds, postDiscreteInteraction, selectedReceiver]);

  const handleHideAllTracks = useCallback(() => {
    if (!selectedReceiver) {
      return;
    }

    applyVisibleTrackIds(selectedReceiver.receiverId, []);
    postDiscreteInteraction({
      action: "hideAllTracks",
      element: "tracks:visible",
      value: [],
      receiverId: selectedReceiver.receiverId,
    });
  }, [applyVisibleTrackIds, postDiscreteInteraction, selectedReceiver]);

  const handleBroadcastVisibleTracks = useCallback(() => {
    if (!selectedReceiver) {
      return;
    }

    const trackIds = selectedReceiver.config.tracks
      .filter(track => track.visible)
      .map(track => track.trackId);

    applyVisibleTrackIds("*", trackIds);
    postDiscreteInteraction({
      action: "broadcastVisibleTracks",
      element: "tracks:visible",
      value: trackIds,
      receiverId: null,
    });
  }, [applyVisibleTrackIds, postDiscreteInteraction, selectedReceiver]);

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

  const handleScoreReset = useCallback(() => {
    if (!selectedReceiver) {
      return;
    }

    dispatchCommand({
      command: "score_reset",
      targetId: selectedReceiver.receiverId,
      payload: {},
    });

    postDiscreteInteraction({
      action: "resetScore",
      element: "score:reset",
      value: 0,
      receiverId: selectedReceiver.receiverId,
    });
  }, [dispatchCommand, postDiscreteInteraction, selectedReceiver]);

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

  const handleLaunchVote = useCallback(
    (targetId: string) => {
      const question = voteQuestionInput.trim();
      const optionLabels = voteOptionsInput
        .split("\n")
        .map(option => option.trim())
        .filter(Boolean);

      if (!question || optionLabels.length === 0) {
        return;
      }

      const voteId = createMachineId("vote", question);
      dispatchCommand({
        command: "set_vote_state",
        targetId,
        payload: {
          vote: {
            voteId,
            question,
            options: optionLabels.map((label, index) => ({
              id: `option_${index + 1}`,
              label,
            })),
            visible: true,
            enabled: true,
            visibilityDuration: Math.max(0, voteVisibilityDuration),
            allowRevote: voteAllowRevote,
            selectedOptionId: null,
            submittedAt: null,
          },
        },
      });

      postDiscreteInteraction({
        action: "showVote",
        element: "vote:launch",
        value: {
          voteId,
          targetId,
          question,
          optionCount: optionLabels.length,
          allowRevote: voteAllowRevote,
          visibilityDuration: Math.max(0, voteVisibilityDuration),
        },
        receiverId: targetId === "*" ? null : targetId,
      });
    },
    [
      dispatchCommand,
      postDiscreteInteraction,
      voteAllowRevote,
      voteOptionsInput,
      voteQuestionInput,
      voteVisibilityDuration,
    ]
  );

  const handleVoteResetAll = useCallback(() => {
    dispatchCommand({
      command: "vote_reset_all",
      targetId: "*",
      payload: {},
    });

    postDiscreteInteraction({
      action: "resetVotes",
      element: "vote:reset_all",
      value: true,
      receiverId: null,
    });
  }, [dispatchCommand, postDiscreteInteraction]);

  const handleVoteExport = useCallback(async () => {
    setExportingVotes(true);

    try {
      const response = await fetch("/api/controller/votes/export");
      if (!response.ok) {
        throw new Error(`Failed to export votes: ${response.status}`);
      }

      const body = await response.json();
      const blob = new Blob([JSON.stringify(body, null, 2)], {
        type: "application/json",
      });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `phase4-votes-${new Date().toISOString()}.json`;
      anchor.click();
      window.URL.revokeObjectURL(url);

      postDiscreteInteraction({
        action: "exportVotes",
        element: "vote:export_json",
        value: Array.isArray(body.votes) ? body.votes.length : 0,
        receiverId: null,
      });
    } finally {
      setExportingVotes(false);
    }
  }, [postDiscreteInteraction]);

  const handleTimingExport = useCallback(async () => {
    setExportingTiming(true);

    try {
      const response = await fetch("/api/controller/timing/export");
      if (!response.ok) {
        throw new Error(`Failed to export timing: ${response.status}`);
      }

      const body = await response.json();
      const blob = new Blob([JSON.stringify(body, null, 2)], {
        type: "application/json",
      });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `phase6-timing-${new Date().toISOString()}.json`;
      anchor.click();
      window.URL.revokeObjectURL(url);

      postDiscreteInteraction({
        action: "exportTiming",
        element: "timing:export_json",
        value: body.timing?.totalAttempts ?? 0,
        receiverId: null,
      });
    } finally {
      setExportingTiming(false);
    }
  }, [postDiscreteInteraction]);

  const handleColorChallengePaletteApply = useCallback(() => {
    if (!selectedReceiver) {
      return;
    }

    const palette = colorChallengePaletteInput
      .split("\n")
      .map((line, index) => {
        const [rawId, rawLabel, rawColor] = line
          .split(",")
          .map(part => part.trim());
        const colorId = rawId || `color_${index + 1}`;
        const label = rawLabel || colorId;
        const color = rawColor || "#ffffff";
        return { colorId, label, color };
      })
      .filter(color => color.colorId && color.label);

    if (palette.length < 2) {
      return;
    }

    patchColorChallenge({
      palette,
    });
    postDiscreteInteraction({
      action: "setColorChallengePalette",
      element: "colorChallenge:palette",
      value: palette,
      receiverId: selectedReceiver.receiverId,
    });
  }, [
    colorChallengePaletteInput,
    patchColorChallenge,
    postDiscreteInteraction,
    selectedReceiver,
  ]);

  const handleColorChallengeExport = useCallback(async () => {
    setExportingColorChallenge(true);

    try {
      const response = await fetch("/api/controller/color-challenge/export");
      if (!response.ok) {
        throw new Error(`Failed to export color challenge: ${response.status}`);
      }

      const body = await response.json();
      const blob = new Blob([JSON.stringify(body, null, 2)], {
        type: "application/json",
      });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `phase11-color-challenge-${new Date().toISOString()}.json`;
      anchor.click();
      window.URL.revokeObjectURL(url);

      postDiscreteInteraction({
        action: "exportColorChallenge",
        element: "colorChallenge:export_json",
        value: body.colorChallenge?.totalEvents ?? 0,
        receiverId: null,
      });
    } finally {
      setExportingColorChallenge(false);
    }
  }, [postDiscreteInteraction]);

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
                Phase 11 Controller
              </h1>
              <p className="text-xs text-muted-foreground">
                Color challenge, receiver-led economy, voting, map, and live
                receiver control
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
                        receiver before sending phase 5 commands.
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
                      <Trophy />
                      Per-Player Score
                    </CardTitle>
                    <CardDescription>
                      Show or hide the score UI, disable interaction, set any
                      numeric value, and reset it back to zero.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                        <div>
                          <p className="text-sm font-medium">Score Visible</p>
                          <p className="text-xs text-muted-foreground">
                            Reveals the receiver-side score card.
                          </p>
                        </div>
                        <Switch
                          checked={selectedScore?.visible ?? false}
                          onCheckedChange={checked => {
                            patchScore({
                              visible: checked,
                            });
                            postDiscreteInteraction({
                              action: "toggleScoreVisible",
                              element: "score:visible",
                              value: checked,
                              receiverId: selectedReceiver.receiverId,
                            });
                          }}
                        />
                      </div>

                      <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                        <div>
                          <p className="text-sm font-medium">Score Enabled</p>
                          <p className="text-xs text-muted-foreground">
                            Disabled keeps the value visible but clearly locked.
                          </p>
                        </div>
                        <Switch
                          checked={selectedScore?.enabled ?? false}
                          onCheckedChange={checked => {
                            patchScore({
                              enabled: checked,
                            });
                            postDiscreteInteraction({
                              action: "toggleScoreEnabled",
                              element: "score:enabled",
                              value: checked,
                              receiverId: selectedReceiver.receiverId,
                            });
                          }}
                        />
                      </div>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
                      <div className="rounded-2xl border border-border/60 bg-muted/25 p-5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={
                              selectedScore?.visible ? "default" : "outline"
                            }
                          >
                            {selectedScore?.visible ? "Visible" : "Hidden"}
                          </Badge>
                          <Badge
                            variant={
                              selectedScore?.enabled ? "secondary" : "outline"
                            }
                          >
                            {selectedScore?.enabled ? "Enabled" : "Disabled"}
                          </Badge>
                        </div>
                        <p className="mt-8 text-sm text-muted-foreground">
                          Current score
                        </p>
                        <p className="mt-2 text-6xl font-semibold tracking-tight">
                          {selectedScore?.value ?? 0}
                        </p>
                        <p className="mt-3 text-xs text-muted-foreground">
                          HTTP and socket updates stay unified through the same
                          in-memory receiver state.
                        </p>
                      </div>

                      <FieldGroup className="rounded-xl border border-dashed border-border/70 p-4">
                        <Field orientation="responsive">
                          <FieldLabel htmlFor="score-value">
                            Score Value
                          </FieldLabel>
                          <FieldContent>
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                  const nextValue =
                                    (selectedScore?.value ?? 0) - 1;
                                  patchScore({ value: nextValue });
                                  postDiscreteInteraction({
                                    action: "decrementScore",
                                    element: "score:step_down",
                                    value: nextValue,
                                    receiverId: selectedReceiver.receiverId,
                                  });
                                }}
                              >
                                <Minus data-icon="inline-start" />
                                Decrement
                              </Button>
                              <NumericInput
                                id="score-value"
                                step="any"
                                value={selectedScore?.value ?? 0}
                                className="max-w-48"
                                onFocus={() =>
                                  beginContinuousInteraction({
                                    element: "score:value",
                                    startValue: selectedScore?.value ?? 0,
                                    receiverId: selectedReceiver.receiverId,
                                  })
                                }
                                onBlur={() =>
                                  endContinuousInteraction({
                                    element: "score:value",
                                    endValue: selectedScore?.value ?? 0,
                                    receiverId: selectedReceiver.receiverId,
                                  })
                                }
                                onValueChange={value =>
                                  patchScore({
                                    value,
                                  })
                                }
                              />
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                  const nextValue =
                                    (selectedScore?.value ?? 0) + 1;
                                  patchScore({ value: nextValue });
                                  postDiscreteInteraction({
                                    action: "incrementScore",
                                    element: "score:step_up",
                                    value: nextValue,
                                    receiverId: selectedReceiver.receiverId,
                                  });
                                }}
                              >
                                <Plus data-icon="inline-start" />
                                Increment
                              </Button>
                              <Button
                                type="button"
                                variant="secondary"
                                onClick={handleScoreReset}
                              >
                                <RotateCcw data-icon="inline-start" />
                                Reset
                              </Button>
                            </div>
                            <FieldDescription>
                              Direct set accepts any finite number. Reset uses a
                              dedicated `score_reset` command.
                            </FieldDescription>
                          </FieldContent>
                        </Field>
                      </FieldGroup>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Palette />
                      Color Challenge
                    </CardTitle>
                    <CardDescription>
                      Server-generated two-choice rounds based on the professor
                      ColorHitGame scoring model.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="grid gap-3 sm:grid-cols-4">
                      <div className="rounded-lg border border-border/60 bg-muted/25 p-3">
                        <p className="text-xs text-muted-foreground">Score</p>
                        <p className="mt-1 text-2xl font-semibold">
                          {(selectedColorChallenge?.score ?? 0).toFixed(1)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border/60 bg-muted/25 p-3">
                        <p className="text-xs text-muted-foreground">
                          Assigned
                        </p>
                        <p className="mt-1 truncate text-sm font-medium">
                          {selectedColorChallenge?.assignedColorId ?? "Waiting"}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border/60 bg-muted/25 p-3">
                        <p className="text-xs text-muted-foreground">Round</p>
                        <p className="mt-1 text-sm font-medium">
                          {selectedColorChallenge?.choices.length === 2
                            ? "Ready"
                            : "Not started"}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border/60 bg-muted/25 p-3">
                        <p className="text-xs text-muted-foreground">State</p>
                        <p className="mt-1 text-sm font-medium">
                          {selectedColorChallenge?.gameOver
                            ? "Game Over"
                            : selectedColorChallenge?.enabled
                              ? "Enabled"
                              : "Disabled"}
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                        <div>
                          <p className="text-sm font-medium">
                            Challenge Visible
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Shows the color game on the receiver.
                          </p>
                        </div>
                        <Switch
                          checked={selectedColorChallenge?.visible ?? false}
                          onCheckedChange={checked => {
                            patchColorChallenge({
                              visible: checked,
                            });
                            postDiscreteInteraction({
                              action: "toggleColorChallengeVisible",
                              element: "colorChallenge:visible",
                              value: checked,
                              receiverId: selectedReceiver.receiverId,
                            });
                          }}
                        />
                      </div>

                      <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                        <div>
                          <p className="text-sm font-medium">
                            Challenge Enabled
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Enabled starts server-authoritative rounds.
                          </p>
                        </div>
                        <Switch
                          checked={selectedColorChallenge?.enabled ?? false}
                          onCheckedChange={checked => {
                            patchColorChallenge({
                              enabled: checked,
                            });
                            postDiscreteInteraction({
                              action: "toggleColorChallengeEnabled",
                              element: "colorChallenge:enabled",
                              value: checked,
                              receiverId: selectedReceiver.receiverId,
                            });
                          }}
                        />
                      </div>
                    </div>

                    <FieldGroup className="rounded-xl border border-dashed border-border/70 p-4">
                      <div className="grid gap-4 md:grid-cols-3">
                        <Field>
                          <FieldLabel htmlFor="color-starting-score">
                            Starting Score
                          </FieldLabel>
                          <NumericInput
                            id="color-starting-score"
                            min={0}
                            step={0.1}
                            value={selectedColorChallenge?.startingScore ?? 1}
                            onValueChange={value =>
                              patchColorChallenge({
                                startingScore: value,
                              })
                            }
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="color-min-interval">
                            Min Seconds
                          </FieldLabel>
                          <NumericInput
                            id="color-min-interval"
                            min={0.25}
                            step={0.1}
                            value={
                              (selectedColorChallenge?.minIntervalMs ?? 2000) /
                              1000
                            }
                            onValueChange={value =>
                              patchColorChallenge({
                                minIntervalMs: value * 1000,
                              })
                            }
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="color-max-interval">
                            Max Seconds
                          </FieldLabel>
                          <NumericInput
                            id="color-max-interval"
                            min={0.25}
                            step={0.1}
                            value={
                              (selectedColorChallenge?.maxIntervalMs ?? 3000) /
                              1000
                            }
                            onValueChange={value =>
                              patchColorChallenge({
                                maxIntervalMs: value * 1000,
                              })
                            }
                          />
                        </Field>
                      </div>

                      <div className="grid gap-4 md:grid-cols-4">
                        <Field>
                          <FieldLabel htmlFor="color-max-reward">
                            Max Reward
                          </FieldLabel>
                          <NumericInput
                            id="color-max-reward"
                            min={0}
                            step={0.1}
                            value={selectedColorChallenge?.maxReward ?? 3}
                            onValueChange={value =>
                              patchColorChallenge({
                                maxReward: value,
                              })
                            }
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="color-min-wrong">
                            Min Wrong Penalty
                          </FieldLabel>
                          <NumericInput
                            id="color-min-wrong"
                            min={0}
                            step={0.1}
                            value={
                              selectedColorChallenge?.minWrongPenalty ?? 0.5
                            }
                            onValueChange={value =>
                              patchColorChallenge({
                                minWrongPenalty: value,
                              })
                            }
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="color-max-wrong">
                            Max Wrong Penalty
                          </FieldLabel>
                          <NumericInput
                            id="color-max-wrong"
                            min={0}
                            step={0.1}
                            value={
                              selectedColorChallenge?.maxWrongPenalty ?? 1.5
                            }
                            onValueChange={value =>
                              patchColorChallenge({
                                maxWrongPenalty: value,
                              })
                            }
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="color-miss-penalty">
                            Miss Penalty
                          </FieldLabel>
                          <NumericInput
                            id="color-miss-penalty"
                            min={0}
                            step={0.1}
                            value={selectedColorChallenge?.missPenalty ?? 1}
                            onValueChange={value =>
                              patchColorChallenge({
                                missPenalty: value,
                              })
                            }
                          />
                        </Field>
                      </div>

                      <Field orientation="responsive">
                        <FieldContent>
                          <FieldLabel>
                            Refresh Assigned Color Each Round
                          </FieldLabel>
                          <FieldDescription>
                            Matches the Unity reference default.
                          </FieldDescription>
                        </FieldContent>
                        <Switch
                          checked={
                            selectedColorChallenge?.refreshAssignedColorEachIteration ??
                            true
                          }
                          onCheckedChange={checked =>
                            patchColorChallenge({
                              refreshAssignedColorEachIteration: checked,
                            })
                          }
                        />
                      </Field>
                    </FieldGroup>

                    <FieldGroup className="rounded-xl border border-dashed border-border/70 p-4">
                      <Field>
                        <FieldLabel htmlFor="color-palette">Palette</FieldLabel>
                        <Textarea
                          id="color-palette"
                          value={colorChallengePaletteInput}
                          onChange={event =>
                            setColorChallengePaletteInput(event.target.value)
                          }
                          className="min-h-28"
                        />
                        <FieldDescription>
                          One color per line: `colorId,label,#hex`. Keep at
                          least two unique color ids.
                        </FieldDescription>
                      </Field>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          onClick={handleColorChallengePaletteApply}
                        >
                          <Send data-icon="inline-start" />
                          Apply Palette
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={resetColorChallenge}
                        >
                          <RotateCcw data-icon="inline-start" />
                          Reset / Revive
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleColorChallengeExport}
                          disabled={exportingColorChallenge}
                        >
                          <Download data-icon="inline-start" />
                          {exportingColorChallenge
                            ? "Exporting..."
                            : "Export JSON"}
                        </Button>
                      </div>
                    </FieldGroup>

                    {selectedColorChallenge?.lastResult ? (
                      <div className="rounded-xl border border-border/60 bg-muted/25 p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">
                            {selectedColorChallenge.lastResult.reason}
                          </Badge>
                          <Badge variant="outline">
                            Delta{" "}
                            {selectedColorChallenge.lastResult.scoreDelta.toFixed(
                              2
                            )}
                          </Badge>
                          <Badge variant="outline">
                            Greenness{" "}
                            {selectedColorChallenge.lastResult.greenness.toFixed(
                              2
                            )}
                          </Badge>
                        </div>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Coins />
                      Sound Economy
                    </CardTitle>
                    <CardDescription>
                      Receiver-led playback uses seconds as currency. Economy
                      stays off until you enable it for the selected receiver.
                      Reset revives a game-over receiver without changing the
                      visible track list.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="grid gap-3 sm:grid-cols-4">
                      <div className="rounded-lg border border-border/60 bg-muted/25 p-3">
                        <p className="text-xs text-muted-foreground">Pool</p>
                        <p className="mt-1 text-2xl font-semibold">
                          {(selectedEconomy?.currencySeconds ?? 0).toFixed(1)}s
                        </p>
                      </div>
                      <div className="rounded-lg border border-border/60 bg-muted/25 p-3">
                        <p className="text-xs text-muted-foreground">
                          Inflation
                        </p>
                        <p className="mt-1 text-2xl font-semibold">
                          x{(selectedEconomy?.inflation ?? 1).toFixed(2)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border/60 bg-muted/25 p-3">
                        <p className="text-xs text-muted-foreground">Current</p>
                        <p className="mt-1 truncate text-sm font-medium">
                          {selectedEconomy?.currentTrackId ?? "Idle"}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border/60 bg-muted/25 p-3">
                        <p className="text-xs text-muted-foreground">State</p>
                        <p className="mt-1 text-sm font-medium">
                          {selectedEconomy?.gameOver
                            ? "Game Over"
                            : selectedEconomy?.enabled
                              ? "Enabled"
                              : "Disabled"}
                        </p>
                      </div>
                    </div>

                    <FieldGroup>
                      <Field orientation="responsive">
                        <FieldContent>
                          <FieldLabel>Economy Enabled</FieldLabel>
                          <FieldDescription>
                            Receiver play buttons request server-side cost
                            checks when enabled.
                          </FieldDescription>
                        </FieldContent>
                        <Switch
                          checked={selectedEconomy?.enabled ?? false}
                          onCheckedChange={checked =>
                            patchEconomy({ enabled: checked })
                          }
                        />
                      </Field>

                      <Field orientation="responsive">
                        <FieldLabel>Starting Seconds</FieldLabel>
                        <FieldContent>
                          <NumericInput
                            min={0}
                            value={selectedEconomy?.startingSeconds ?? 30}
                            onValueChange={value =>
                              patchEconomy({ startingSeconds: value })
                            }
                          />
                        </FieldContent>
                      </Field>

                      <Field orientation="responsive">
                        <FieldLabel>Earn Rate / Second</FieldLabel>
                        <FieldContent>
                          <NumericInput
                            min={0}
                            step={0.05}
                            value={selectedEconomy?.earnRatePerSecond ?? 0.25}
                            onValueChange={value =>
                              patchEconomy({ earnRatePerSecond: value })
                            }
                          />
                        </FieldContent>
                      </Field>

                      <Field orientation="responsive">
                        <FieldLabel>Inflation Growth / Second</FieldLabel>
                        <FieldContent>
                          <NumericInput
                            min={0}
                            step={0.005}
                            value={
                              selectedEconomy?.inflationGrowthPerSecond ?? 0.025
                            }
                            onValueChange={value =>
                              patchEconomy({
                                inflationGrowthPerSecond: value,
                              })
                            }
                          />
                        </FieldContent>
                      </Field>

                      <Field orientation="responsive">
                        <FieldContent>
                          <FieldLabel>Inflation Grows While Playing</FieldLabel>
                          <FieldDescription>
                            Keep compounding inflation active during playback.
                          </FieldDescription>
                        </FieldContent>
                        <Switch
                          checked={
                            selectedEconomy?.inflationGrowsWhilePlaying ?? true
                          }
                          onCheckedChange={checked =>
                            patchEconomy({
                              inflationGrowsWhilePlaying: checked,
                            })
                          }
                        />
                      </Field>
                    </FieldGroup>

                    {selectedEconomy?.lastError ? (
                      <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        Last rejection:{" "}
                        {selectedEconomy.lastError.replace(/_/g, " ")}
                      </p>
                    ) : null}

                    <Button
                      type="button"
                      variant="secondary"
                      onClick={resetEconomy}
                    >
                      <RotateCcw data-icon="inline-start" />
                      Reset / Revive Economy
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <MapIcon />
                      Classroom Map
                    </CardTitle>
                    <CardDescription>
                      Drive normalized 2D position from controller or Unity and
                      preview the resolved classroom location in real time.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                    <div className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                          <div>
                            <p className="text-sm font-medium">Map Visible</p>
                            <p className="text-xs text-muted-foreground">
                              Shows the classroom map section on the receiver.
                            </p>
                          </div>
                          <Switch
                            checked={selectedMap?.visible ?? false}
                            onCheckedChange={checked => {
                              patchMap({
                                visible: checked,
                              });
                              postDiscreteInteraction({
                                action: "toggleMapVisible",
                                element: "map:visible",
                                value: checked,
                                receiverId: selectedReceiver.receiverId,
                              });
                            }}
                          />
                        </div>

                        <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                          <div>
                            <p className="text-sm font-medium">Map Enabled</p>
                            <p className="text-xs text-muted-foreground">
                              Disabled leaves the player marker visible but
                              indicates a locked state.
                            </p>
                          </div>
                          <Switch
                            checked={selectedMap?.enabled ?? false}
                            onCheckedChange={checked => {
                              patchMap({
                                enabled: checked,
                              });
                              postDiscreteInteraction({
                                action: "toggleMapEnabled",
                                element: "map:enabled",
                                value: checked,
                                receiverId: selectedReceiver.receiverId,
                              });
                            }}
                          />
                        </div>
                      </div>

                      <FieldGroup className="rounded-xl border border-dashed border-border/70 p-4">
                        <Field orientation="responsive">
                          <FieldLabel htmlFor="map-x-position">
                            X Position (0-100)
                          </FieldLabel>
                          <FieldContent>
                            <div className="flex items-center gap-4">
                              <Slider
                                value={[
                                  mapXNormalizedToScale(
                                    selectedMap?.playerPosX ?? 0.5
                                  ),
                                ]}
                                min={0}
                                max={MAP_SCALE_MAX}
                                step={MAP_SCALE_STEP}
                                onPointerDownCapture={() =>
                                  beginContinuousInteraction({
                                    element: "map:x",
                                    startValue: selectedMap?.playerPosX ?? 0.5,
                                    receiverId: selectedReceiver.receiverId,
                                  })
                                }
                                onValueChange={([value]) =>
                                  patchMap({
                                    playerPosX: mapXScaleToNormalized(
                                      value ?? MAP_SCALE_MAX / 2
                                    ),
                                  })
                                }
                                onValueCommit={([value]) => {
                                  const nextValue = mapXScaleToNormalized(
                                    value ?? MAP_SCALE_MAX / 2
                                  );
                                  postDiscreteInteraction({
                                    action: "setMapX",
                                    element: "map:x",
                                    value: nextValue,
                                    receiverId: selectedReceiver.receiverId,
                                  });
                                  endContinuousInteraction({
                                    element: "map:x",
                                    endValue: nextValue,
                                    receiverId: selectedReceiver.receiverId,
                                  });
                                }}
                              />
                              <NumericInput
                                id="map-x-position"
                                min={0}
                                max={MAP_SCALE_MAX}
                                step={MAP_SCALE_STEP}
                                className="w-24"
                                value={mapXNormalizedToScale(
                                  selectedMap?.playerPosX ?? 0.5
                                )}
                                onFocus={() =>
                                  beginContinuousInteraction({
                                    element: "map:x_input",
                                    startValue: selectedMap?.playerPosX ?? 0.5,
                                    receiverId: selectedReceiver.receiverId,
                                  })
                                }
                                onBlur={() =>
                                  endContinuousInteraction({
                                    element: "map:x_input",
                                    endValue: selectedMap?.playerPosX ?? 0.5,
                                    receiverId: selectedReceiver.receiverId,
                                  })
                                }
                                onValueChange={value =>
                                  patchMap({
                                    playerPosX: mapXScaleToNormalized(value),
                                  })
                                }
                              />
                            </div>
                            <FieldDescription>
                              0 is left wall and 100 is right wall. The server
                              still clamps using normalized coordinates.
                            </FieldDescription>
                          </FieldContent>
                        </Field>

                        <Field orientation="responsive">
                          <FieldLabel htmlFor="map-y-position">
                            Y Position (0-100)
                          </FieldLabel>
                          <FieldContent>
                            <div className="flex items-center gap-4">
                              <Slider
                                value={[
                                  mapYNormalizedToScale(
                                    selectedMap?.playerPosY ?? 0.5
                                  ),
                                ]}
                                min={0}
                                max={MAP_SCALE_MAX}
                                step={MAP_SCALE_STEP}
                                onPointerDownCapture={() =>
                                  beginContinuousInteraction({
                                    element: "map:y",
                                    startValue: selectedMap?.playerPosY ?? 0.5,
                                    receiverId: selectedReceiver.receiverId,
                                  })
                                }
                                onValueChange={([value]) =>
                                  patchMap({
                                    playerPosY: mapYScaleToNormalized(
                                      value ?? MAP_SCALE_MAX / 2
                                    ),
                                  })
                                }
                                onValueCommit={([value]) => {
                                  const nextValue = mapYScaleToNormalized(
                                    value ?? MAP_SCALE_MAX / 2
                                  );
                                  postDiscreteInteraction({
                                    action: "setMapY",
                                    element: "map:y",
                                    value: nextValue,
                                    receiverId: selectedReceiver.receiverId,
                                  });
                                  endContinuousInteraction({
                                    element: "map:y",
                                    endValue: nextValue,
                                    receiverId: selectedReceiver.receiverId,
                                  });
                                }}
                              />
                              <NumericInput
                                id="map-y-position"
                                min={0}
                                max={MAP_SCALE_MAX}
                                step={MAP_SCALE_STEP}
                                className="w-24"
                                value={mapYNormalizedToScale(
                                  selectedMap?.playerPosY ?? 0.5
                                )}
                                onFocus={() =>
                                  beginContinuousInteraction({
                                    element: "map:y_input",
                                    startValue: selectedMap?.playerPosY ?? 0.5,
                                    receiverId: selectedReceiver.receiverId,
                                  })
                                }
                                onBlur={() =>
                                  endContinuousInteraction({
                                    element: "map:y_input",
                                    endValue: selectedMap?.playerPosY ?? 0.5,
                                    receiverId: selectedReceiver.receiverId,
                                  })
                                }
                                onValueChange={value =>
                                  patchMap({
                                    playerPosY: mapYScaleToNormalized(value),
                                  })
                                }
                              />
                            </div>
                            <FieldDescription>
                              0 is back row and 100 is front row.
                            </FieldDescription>
                          </FieldContent>
                        </Field>

                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              patchMap({
                                playerPosX: 0,
                                playerPosY: 0,
                              });
                              postDiscreteInteraction({
                                action: "setMapPreset",
                                element: "map:preset",
                                value: "front_left",
                                receiverId: selectedReceiver.receiverId,
                              });
                            }}
                          >
                            Front Left
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              patchMap({
                                playerPosX: 0.5,
                                playerPosY: 0.5,
                              });
                              postDiscreteInteraction({
                                action: "setMapPreset",
                                element: "map:preset",
                                value: "center",
                                receiverId: selectedReceiver.receiverId,
                              });
                            }}
                          >
                            Center
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              patchMap({
                                playerPosX: 1,
                                playerPosY: 1,
                              });
                              postDiscreteInteraction({
                                action: "setMapPreset",
                                element: "map:preset",
                                value: "back_right",
                                receiverId: selectedReceiver.receiverId,
                              });
                            }}
                          >
                            Back Right
                          </Button>
                        </div>
                      </FieldGroup>

                      <FieldGroup className="rounded-xl border border-dashed border-border/70 p-4">
                        <Field>
                          <FieldContent>
                            <FieldLabel>Movement</FieldLabel>
                            <FieldDescription>
                              Send one start and target command. Receiver pages
                              animate locally, so Unity does not need to stream
                              positions every frame.
                            </FieldDescription>
                          </FieldContent>
                        </Field>

                        <div className="grid gap-4 md:grid-cols-2">
                          <Field>
                            <FieldLabel htmlFor="map-movement-start-x">
                              Start X (0-100)
                            </FieldLabel>
                            <NumericInput
                              id="map-movement-start-x"
                              min={0}
                              max={MAP_SCALE_MAX}
                              step={MAP_SCALE_STEP}
                              value={mapMovementDraft.startX}
                              onValueChange={value =>
                                updateMapMovementDraft({
                                  startX: clampMapScale(value),
                                })
                              }
                            />
                          </Field>

                          <Field>
                            <FieldLabel htmlFor="map-movement-start-y">
                              Start Y (0-100)
                            </FieldLabel>
                            <NumericInput
                              id="map-movement-start-y"
                              min={0}
                              max={MAP_SCALE_MAX}
                              step={MAP_SCALE_STEP}
                              value={mapMovementDraft.startY}
                              onValueChange={value =>
                                updateMapMovementDraft({
                                  startY: clampMapScale(value),
                                })
                              }
                            />
                          </Field>

                          <Field>
                            <FieldLabel htmlFor="map-movement-target-x">
                              Target X (0-100)
                            </FieldLabel>
                            <NumericInput
                              id="map-movement-target-x"
                              min={0}
                              max={MAP_SCALE_MAX}
                              step={MAP_SCALE_STEP}
                              value={mapMovementDraft.targetX}
                              onValueChange={value =>
                                updateMapMovementDraft({
                                  targetX: clampMapScale(value),
                                })
                              }
                            />
                          </Field>

                          <Field>
                            <FieldLabel htmlFor="map-movement-target-y">
                              Target Y (0-100)
                            </FieldLabel>
                            <NumericInput
                              id="map-movement-target-y"
                              min={0}
                              max={MAP_SCALE_MAX}
                              step={MAP_SCALE_STEP}
                              value={mapMovementDraft.targetY}
                              onValueChange={value =>
                                updateMapMovementDraft({
                                  targetY: clampMapScale(value),
                                })
                              }
                            />
                          </Field>
                        </div>

                        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
                          <Field>
                            <FieldLabel htmlFor="map-movement-duration">
                              Duration Seconds
                            </FieldLabel>
                            <NumericInput
                              id="map-movement-duration"
                              min={0.1}
                              max={600}
                              step={0.1}
                              value={mapMovementDraft.durationSeconds}
                              formatValue={value => value.toFixed(1)}
                              onValueChange={value =>
                                updateMapMovementDraft({
                                  durationSeconds: Math.min(
                                    600,
                                    Math.max(0.1, value)
                                  ),
                                })
                              }
                            />
                            <FieldDescription>
                              Defaults to 20 seconds for a single
                              start-to-target pass.
                            </FieldDescription>
                          </Field>

                          <Field className="justify-end">
                            <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 px-3 py-2">
                              <FieldLabel htmlFor="map-movement-loop">
                                Loop
                              </FieldLabel>
                              <Switch
                                id="map-movement-loop"
                                checked={mapMovementDraft.loop}
                                onCheckedChange={checked =>
                                  updateMapMovementDraft({ loop: checked })
                                }
                              />
                            </div>
                          </Field>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() =>
                              updateMapMovementDraft({
                                startX: mapXNormalizedToScale(
                                  selectedMap?.playerPosX ?? 0.5
                                ),
                                startY: mapYNormalizedToScale(
                                  selectedMap?.playerPosY ?? 0.5
                                ),
                              })
                            }
                          >
                            Use Current As Start
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() =>
                              updateMapMovementDraft({
                                targetX: mapXNormalizedToScale(
                                  selectedMap?.playerPosX ?? 0.5
                                ),
                                targetY: mapYNormalizedToScale(
                                  selectedMap?.playerPosY ?? 0.5
                                ),
                              })
                            }
                          >
                            Use Current As Target
                          </Button>
                          <Button type="button" onClick={sendMapMovement}>
                            Send Movement
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={stopMapMovement}
                            disabled={!selectedMap?.movement}
                          >
                            Stop Movement
                          </Button>
                        </div>
                      </FieldGroup>
                    </div>

                    <div className="space-y-4">
                      <ClassroomMap
                        x={selectedMap?.playerPosX ?? 0.5}
                        y={selectedMap?.playerPosY ?? 0.5}
                        disabled={!selectedMap?.enabled}
                        markerLabel={selectedReceiver.label}
                      />
                      <p className="text-xs text-muted-foreground">
                        Preview keeps the same internal normalized data while
                        this panel uses a 0-100 control scale. Current: X{" "}
                        {mapXNormalizedToScale(
                          selectedMap?.playerPosX ?? 0.5
                        ).toFixed(1)}{" "}
                        · Y{" "}
                        {mapYNormalizedToScale(
                          selectedMap?.playerPosY ?? 0.5
                        ).toFixed(1)}
                      </p>
                      {selectedMap?.movement ? (
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="secondary">
                            {selectedMap.movement.loop
                              ? "Looping movement"
                              : "One-way movement"}
                          </Badge>
                          <Badge variant="outline">
                            {(selectedMap.movement.durationMs / 1000).toFixed(
                              1
                            )}
                            s
                          </Badge>
                        </div>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Target />
                      Timing Challenge
                    </CardTitle>
                    <CardDescription>
                      Drive a pulse-synced hit window on the receiver, then
                      export attempt logs as JSON when Unity is unavailable.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                    <div className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                          <div>
                            <p className="text-sm font-medium">
                              Timing Visible
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Shows the challenge bar and action button on the
                              receiver.
                            </p>
                          </div>
                          <Switch
                            checked={selectedTiming?.visible ?? false}
                            onCheckedChange={checked => {
                              patchTiming({
                                visible: checked,
                              });
                              postDiscreteInteraction({
                                action: "toggleTimingVisible",
                                element: "timing:visible",
                                value: checked,
                                receiverId: selectedReceiver.receiverId,
                              });
                            }}
                          />
                        </div>

                        <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                          <div>
                            <p className="text-sm font-medium">
                              Timing Enabled
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Disabled keeps the bar visible but locks the press
                              button.
                            </p>
                          </div>
                          <Switch
                            checked={selectedTiming?.enabled ?? false}
                            onCheckedChange={checked => {
                              patchTiming({
                                enabled: checked,
                              });
                              postDiscreteInteraction({
                                action: "toggleTimingEnabled",
                                element: "timing:enabled",
                                value: checked,
                                receiverId: selectedReceiver.receiverId,
                              });
                            }}
                          />
                        </div>
                      </div>

                      <FieldGroup className="rounded-xl border border-dashed border-border/70 p-4">
                        <Field orientation="responsive">
                          <FieldLabel htmlFor="timing-target-center">
                            Target Center
                          </FieldLabel>
                          <FieldContent>
                            <div className="flex items-center gap-4">
                              <Slider
                                value={[selectedTiming?.targetCenter ?? 0.5]}
                                min={0}
                                max={1}
                                step={0.01}
                                onPointerDownCapture={() =>
                                  beginContinuousInteraction({
                                    element: "timing:target_center",
                                    startValue:
                                      selectedTiming?.targetCenter ?? 0.5,
                                    receiverId: selectedReceiver.receiverId,
                                  })
                                }
                                onValueChange={([value]) =>
                                  patchTiming({
                                    targetCenter: value ?? 0.5,
                                  })
                                }
                                onValueCommit={([value]) => {
                                  const nextValue = value ?? 0.5;
                                  postDiscreteInteraction({
                                    action: "setTimingTargetCenter",
                                    element: "timing:target_center",
                                    value: nextValue,
                                    receiverId: selectedReceiver.receiverId,
                                  });
                                  endContinuousInteraction({
                                    element: "timing:target_center",
                                    endValue: nextValue,
                                    receiverId: selectedReceiver.receiverId,
                                  });
                                }}
                              />
                              <NumericInput
                                id="timing-target-center"
                                min={0}
                                max={1}
                                step={0.01}
                                className="w-24"
                                value={selectedTiming?.targetCenter ?? 0.5}
                                onFocus={() =>
                                  beginContinuousInteraction({
                                    element: "timing:target_center_input",
                                    startValue:
                                      selectedTiming?.targetCenter ?? 0.5,
                                    receiverId: selectedReceiver.receiverId,
                                  })
                                }
                                onBlur={() =>
                                  endContinuousInteraction({
                                    element: "timing:target_center_input",
                                    endValue:
                                      selectedTiming?.targetCenter ?? 0.5,
                                    receiverId: selectedReceiver.receiverId,
                                  })
                                }
                                onValueChange={value =>
                                  patchTiming({
                                    targetCenter: value,
                                  })
                                }
                              />
                            </div>
                            <FieldDescription>
                              `0.5` is the default sweet spot. Shift it to bias
                              the hit window earlier or later in the pulse.
                            </FieldDescription>
                          </FieldContent>
                        </Field>

                        <Field orientation="responsive">
                          <FieldLabel htmlFor="timing-tolerance">
                            Timing Tolerance
                          </FieldLabel>
                          <FieldContent>
                            <div className="flex items-center gap-4">
                              <Slider
                                value={[
                                  selectedTiming?.timingTolerance ?? 0.08,
                                ]}
                                min={0}
                                max={0.25}
                                step={0.005}
                                onPointerDownCapture={() =>
                                  beginContinuousInteraction({
                                    element: "timing:tolerance",
                                    startValue:
                                      selectedTiming?.timingTolerance ?? 0.08,
                                    receiverId: selectedReceiver.receiverId,
                                  })
                                }
                                onValueChange={([value]) =>
                                  patchTiming({
                                    timingTolerance: value ?? 0.08,
                                  })
                                }
                                onValueCommit={([value]) => {
                                  const nextValue = value ?? 0.08;
                                  postDiscreteInteraction({
                                    action: "setTimingTolerance",
                                    element: "timing:tolerance",
                                    value: nextValue,
                                    receiverId: selectedReceiver.receiverId,
                                  });
                                  endContinuousInteraction({
                                    element: "timing:tolerance",
                                    endValue: nextValue,
                                    receiverId: selectedReceiver.receiverId,
                                  });
                                }}
                              />
                              <NumericInput
                                id="timing-tolerance"
                                min={0}
                                max={0.5}
                                step={0.01}
                                className="w-24"
                                value={selectedTiming?.timingTolerance ?? 0.08}
                                onFocus={() =>
                                  beginContinuousInteraction({
                                    element: "timing:tolerance_input",
                                    startValue:
                                      selectedTiming?.timingTolerance ?? 0.08,
                                    receiverId: selectedReceiver.receiverId,
                                  })
                                }
                                onBlur={() =>
                                  endContinuousInteraction({
                                    element: "timing:tolerance_input",
                                    endValue:
                                      selectedTiming?.timingTolerance ?? 0.08,
                                    receiverId: selectedReceiver.receiverId,
                                  })
                                }
                                onValueChange={value =>
                                  patchTiming({
                                    timingTolerance: value,
                                  })
                                }
                              />
                            </div>
                            <FieldDescription>
                              Smaller values demand tighter timing. Receiver
                              presses outside the band count as misses.
                            </FieldDescription>
                          </FieldContent>
                        </Field>
                      </FieldGroup>
                    </div>

                    <div className="space-y-4">
                      <div className="rounded-2xl border border-border/60 bg-muted/25 p-5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={
                              selectedTiming?.visible ? "default" : "outline"
                            }
                          >
                            {selectedTiming?.visible ? "Visible" : "Hidden"}
                          </Badge>
                          <Badge
                            variant={
                              selectedTiming?.enabled ? "secondary" : "outline"
                            }
                          >
                            {selectedTiming?.enabled ? "Enabled" : "Locked"}
                          </Badge>
                          <Badge variant="outline">
                            Target{" "}
                            {(selectedTiming?.targetCenter ?? 0.5).toFixed(2)}
                          </Badge>
                          <Badge variant="outline">
                            ±
                            {(selectedTiming?.timingTolerance ?? 0.08).toFixed(
                              2
                            )}
                          </Badge>
                        </div>

                        <div className="mt-5 rounded-xl border border-border/60 bg-background/80 p-4">
                          <div className="relative h-6 overflow-hidden rounded-full bg-muted">
                            <div className="absolute inset-0 bg-[linear-gradient(90deg,#ef4444_0%,#f59e0b_22%,#22c55e_50%,#f59e0b_78%,#ef4444_100%)]" />
                            <div
                              className="absolute inset-y-0 rounded-full bg-white/20"
                              style={{
                                left: `${
                                  Math.max(
                                    0,
                                    (selectedTiming?.targetCenter ?? 0.5) -
                                      (selectedTiming?.timingTolerance ?? 0.08)
                                  ) * 100
                                }%`,
                                width: `${
                                  Math.max(
                                    0,
                                    Math.min(
                                      1,
                                      (selectedTiming?.targetCenter ?? 0.5) +
                                        (selectedTiming?.timingTolerance ??
                                          0.08)
                                    ) -
                                      Math.max(
                                        0,
                                        (selectedTiming?.targetCenter ?? 0.5) -
                                          (selectedTiming?.timingTolerance ??
                                            0.08)
                                      )
                                  ) * 100
                                }%`,
                              }}
                            />
                            <div
                              className="absolute inset-y-[-4px] w-1 rounded-full bg-background shadow-[0_0_0_1px_rgba(255,255,255,0.6),0_0_16px_rgba(255,255,255,0.35)]"
                              style={{
                                left: `calc(${(selectedTiming?.targetCenter ?? 0.5) * 100}% - 2px)`,
                              }}
                            />
                          </div>
                          <p className="mt-3 text-xs text-muted-foreground">
                            Receiver progress fills left to right on every pulse
                            interval, and the white band marks the valid hit
                            window.
                          </p>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              patchTiming({
                                targetCenter: 0.5,
                              });
                              postDiscreteInteraction({
                                action: "centerTimingTarget",
                                element: "timing:preset",
                                value: "center",
                                receiverId: selectedReceiver.receiverId,
                              });
                            }}
                          >
                            Center Target
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={handleTimingExport}
                            disabled={exportingTiming}
                          >
                            <Download data-icon="inline-start" />
                            {exportingTiming ? "Exporting..." : "Export JSON"}
                          </Button>
                        </div>
                      </div>

                      <p className="text-xs text-muted-foreground">
                        Timing mode rides on the receiver pulse stream. Keep
                        pulse active for a live moving bar; without pulse, taps
                        still export as misses using the fallback `timingValue`.
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Vote />
                      Voting Orchestration
                    </CardTitle>
                    <CardDescription>
                      Launch one question at a time, lock the receiver surface,
                      and export aggregated JSON as a Unity fallback.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FieldGroup className="rounded-xl border border-dashed border-border/70 p-4">
                      <Field orientation="responsive">
                        <FieldLabel htmlFor="vote-question">
                          Vote Question
                        </FieldLabel>
                        <FieldContent>
                          <Input
                            id="vote-question"
                            value={voteQuestionInput}
                            onChange={event =>
                              setVoteQuestionInput(event.target.value)
                            }
                            placeholder="Which rule should be active next?"
                          />
                        </FieldContent>
                      </Field>
                      <Field orientation="responsive">
                        <FieldLabel htmlFor="vote-options">Options</FieldLabel>
                        <FieldContent>
                          <Textarea
                            id="vote-options"
                            value={voteOptionsInput}
                            onChange={event =>
                              setVoteOptionsInput(event.target.value)
                            }
                            placeholder={"Rule A\nRule B\nRule C"}
                            className="min-h-28"
                          />
                          <FieldDescription>
                            One option per line. Order stays stable and becomes
                            the submitted option id.
                          </FieldDescription>
                        </FieldContent>
                      </Field>
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field orientation="responsive">
                          <FieldLabel htmlFor="vote-duration">
                            Visibility (s)
                          </FieldLabel>
                          <FieldContent>
                            <NumericInput
                              id="vote-duration"
                              min={0}
                              value={voteVisibilityDuration}
                              onValueChange={setVoteVisibilityDuration}
                            />
                          </FieldContent>
                        </Field>
                        <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                          <div>
                            <p className="text-sm font-medium">Allow Revote</p>
                            <p className="text-xs text-muted-foreground">
                              Let receivers revise their choice before timeout.
                            </p>
                          </div>
                          <Switch
                            checked={voteAllowRevote}
                            onCheckedChange={setVoteAllowRevote}
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          onClick={() =>
                            handleLaunchVote(selectedReceiver.receiverId)
                          }
                          disabled={
                            !voteQuestionInput.trim() ||
                            voteOptionsInput
                              .split("\n")
                              .map(option => option.trim())
                              .filter(Boolean).length === 0
                          }
                        >
                          <Send data-icon="inline-start" />
                          Launch for Selected
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => handleLaunchVote("*")}
                          disabled={
                            !voteQuestionInput.trim() ||
                            voteOptionsInput
                              .split("\n")
                              .map(option => option.trim())
                              .filter(Boolean).length === 0
                          }
                        >
                          Broadcast Vote
                        </Button>
                        <Button
                          variant="outline"
                          onClick={handleVoteResetAll}
                          disabled={!selectedVote}
                        >
                          <RotateCcw data-icon="inline-start" />
                          Reset Votes
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={handleVoteExport}
                          disabled={exportingVotes}
                        >
                          <Download data-icon="inline-start" />
                          {exportingVotes ? "Exporting..." : "Export JSON"}
                        </Button>
                      </div>
                    </FieldGroup>

                    {selectedVote && selectedVoteSummary ? (
                      <div className="rounded-xl border border-border/60 bg-muted/25 p-4">
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge
                                variant={
                                  selectedVote.visible ? "default" : "secondary"
                                }
                              >
                                {selectedVote.visible ? "Vote Live" : "Closed"}
                              </Badge>
                              <Badge variant="outline">
                                {selectedVoteSummary.submittedCount}/
                                {selectedVoteSummary.totalEligible} submitted
                              </Badge>
                              <Badge variant="outline">
                                {selectedVote.allowRevote
                                  ? "Revote On"
                                  : "Revote Off"}
                              </Badge>
                            </div>
                            <p className="text-sm font-medium">
                              {selectedVote.question}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Vote ID: {selectedVote.voteId} · auto close after{" "}
                              {selectedVote.visibilityDuration}s
                            </p>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Missing voters:{" "}
                            {selectedVoteSummary.missingReceivers.length}
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 lg:grid-cols-2">
                          {selectedVoteSummary.optionTallies.map(option => (
                            <div
                              key={option.id}
                              className="rounded-lg border border-border/60 bg-background px-3 py-3"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <span className="font-medium">
                                  {option.label}
                                </span>
                                <Badge variant="secondary">
                                  {option.voteCount}
                                </Badge>
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="mt-4 rounded-lg border border-border/60 bg-background px-3 py-3">
                          <p className="text-xs font-medium text-muted-foreground">
                            Missing Receivers
                          </p>
                          <p className="mt-1 text-sm">
                            {selectedVoteSummary.missingReceivers.length > 0
                              ? selectedVoteSummary.missingReceivers
                                  .map(receiver => receiver.label)
                                  .join(", ")
                              : "All targeted receivers have voted."}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <Empty className="border-border/70 bg-muted/20">
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <Vote />
                          </EmptyMedia>
                          <EmptyTitle>No Active Vote</EmptyTitle>
                          <EmptyDescription>
                            Launch a question to freeze receiver interaction and
                            start collecting responses.
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    )}
                  </CardContent>
                </Card>

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
                          <NumericInput
                            min={30}
                            max={240}
                            value={selectedPulse?.bpm ?? 90}
                            className="w-24"
                            onValueChange={value =>
                              patchPulse({
                                bpm: value,
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
                      Visible Tracks
                    </CardTitle>
                    <CardDescription>
                      Choose the track names students can see. Hidden tracks
                      stop automatically.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleShowAllTracks}
                      >
                        Show All
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleHideAllTracks}
                      >
                        Hide All
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={handleBroadcastVisibleTracks}
                      >
                        Broadcast This List
                      </Button>
                    </div>

                    {selectedReceiver.config.tracks.length === 0 ? (
                      <Empty className="border-border/70 bg-muted/20">
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <AudioLines />
                          </EmptyMedia>
                          <EmptyTitle>No Tracks Configured</EmptyTitle>
                          <EmptyDescription>
                            Add audio tracks before choosing the student-facing
                            list.
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    ) : (
                      <ScrollArea className="h-96 max-h-[70vh] pr-3">
                        <FieldGroup className="gap-3">
                          {selectedReceiver.config.tracks.map(track => (
                            <Field
                              key={track.trackId}
                              orientation="horizontal"
                              className="rounded-xl border border-border/60 bg-muted/30 p-3"
                            >
                              <Checkbox
                                id={`visible-track-${track.trackId}`}
                                checked={track.visible}
                                onCheckedChange={checked =>
                                  handleVisibleTrackChange(
                                    track.trackId,
                                    checked === true
                                  )
                                }
                              />
                              <FieldContent>
                                <FieldLabel
                                  htmlFor={`visible-track-${track.trackId}`}
                                >
                                  {track.label}
                                </FieldLabel>
                                <FieldDescription>
                                  {track.trackId} · base{" "}
                                  {track.basePrice.toFixed(1)}s ·{" "}
                                  {track.durationSeconds.toFixed(1)}s ·{" "}
                                  {track.categoryId} ·{" "}
                                  {track.url || "No audio URL"}
                                </FieldDescription>
                              </FieldContent>
                              <Badge
                                variant={
                                  track.visible ? "secondary" : "outline"
                                }
                              >
                                {track.visible ? "Shown" : "Hidden"}
                              </Badge>
                            </Field>
                          ))}
                        </FieldGroup>
                      </ScrollArea>
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
                      Tune tempo markers and playback behavior for each track.
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
                        receiverId={selectedReceiver.receiverId}
                        onPlayChange={handleTrackPlayState}
                        onPlayableChange={handleTrackPlayable}
                        onLoopToggle={handleTrackLoopState}
                        onTrackPatch={patchTrack}
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
                        drive phase 5 commands.
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

function TrackControlCard({
  track,
  receiverId,
  onPlayChange,
  onPlayableChange,
  onLoopToggle,
  onTrackPatch,
  onVolumeChange,
  onRemove,
  postDiscreteInteraction,
  beginContinuousInteraction,
  endContinuousInteraction,
}: {
  track: TrackState;
  receiverId: string;
  onPlayChange: (track: TrackState, playing: boolean) => void;
  onPlayableChange: (track: TrackState, playable: boolean) => void;
  onLoopToggle: (track: TrackState) => void;
  onTrackPatch: (trackId: string, patch: Partial<TrackState>) => void;
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
            <NumericInput
              min={0.1}
              max={8}
              step={0.1}
              className="w-24"
              value={track.fillTime}
              onValueChange={value =>
                onTrackPatch(track.trackId, {
                  fillTime: value,
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
        <span>
          {receiver.config.tracks.filter(track => track.visible).length} shown
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Score {receiver.config.score.value}</span>
        <span>
          Color {receiver.config.colorChallenge.score.toFixed(1)}
          {receiver.config.colorChallenge.gameOver ? " over" : ""}
        </span>
        <span>
          Map{" "}
          {clampNormalizedCoordinate(receiver.config.map.playerPosX).toFixed(2)}
          ,{" "}
          {clampNormalizedCoordinate(receiver.config.map.playerPosY).toFixed(2)}
        </span>
      </div>
      <p className="mt-2 truncate text-xs text-muted-foreground">
        {receiver.config.textDisplay.text || "No active text message"}
      </p>
    </button>
  );
}
