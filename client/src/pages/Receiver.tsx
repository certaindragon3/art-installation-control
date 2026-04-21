import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams } from "wouter";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { usePostToUnity } from "@/hooks/usePostToUnity";
import { useSocket } from "@/hooks/useSocket";
import { cn } from "@/lib/utils";
import { volumeValueToGain, volumeValueToPercent } from "@shared/audio";
import {
  assignColorChallengeRound,
  clampNormalizedCoordinate,
  calculateTrackCost,
  calculateColorChallengeGreenness,
  createColorChallengeRound,
  createDefaultReceiverConfig,
  createGeneratedId,
  evaluateColorChallengeRound,
  evaluateTimingPress,
  type ColorChallengeConfig,
  type EconomyConfig,
  hasValidColorChallengeRound,
  type MapConfig,
  type PulseEvent,
  type TimingInteractionValue,
  type TrackState,
  type VoteOption,
} from "@shared/wsTypes";
import {
  AudioLines,
  CheckCircle2,
  Coins,
  Hexagon,
  Lock,
  Map as MapIcon,
  MessageSquare,
  Music,
  Palette,
  Play,
  Repeat,
  SlidersHorizontal,
  Target,
  Trophy,
  VolumeX,
  Wifi,
  WifiOff,
  Zap,
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

type ReceiverTimingResult = TimingInteractionValue & {
  isoTimestamp: string;
};

function resolveColorChallengeProgress(
  challenge: ColorChallengeConfig,
  nowMs: number
) {
  if (!challenge.iterationStartedAt || challenge.iterationDurationMs <= 0) {
    return {
      t: 0,
      greenness: 0,
      remainingMs: challenge.iterationDurationMs,
    };
  }

  const startedAtMs = new Date(challenge.iterationStartedAt).getTime();
  const elapsedMs = Number.isFinite(startedAtMs)
    ? Math.max(0, nowMs - startedAtMs)
    : 0;
  const t = Math.min(1, elapsedMs / Math.max(1, challenge.iterationDurationMs));

  return {
    t,
    greenness: calculateColorChallengeGreenness(t),
    remainingMs: Math.max(0, challenge.iterationDurationMs - elapsedMs),
  };
}

function resolveEconomyDisplay(economy: EconomyConfig, nowMs: number) {
  const lastUpdatedAt = new Date(economy.lastUpdatedAt).getTime();
  const elapsedSeconds = Number.isFinite(lastUpdatedAt)
    ? Math.max(0, (nowMs - lastUpdatedAt) / 1000)
    : 0;
  const playing =
    Boolean(economy.currentTrackId) &&
    economy.playEndsAt !== null &&
    nowMs < new Date(economy.playEndsAt).getTime();

  if (economy.gameOver || !economy.enabled) {
    return economy;
  }

  return {
    ...economy,
    currencySeconds: playing
      ? economy.currencySeconds
      : economy.currencySeconds + economy.earnRatePerSecond * elapsedSeconds,
    inflation:
      economy.inflation +
      (economy.inflationGrowsWhilePlaying || !playing
        ? economy.inflationGrowthPerSecond * elapsedSeconds
        : 0),
  };
}

function resolveTrackPlayProgress(
  track: TrackState,
  economy: EconomyConfig,
  nowMs: number
) {
  if (
    !track.playing ||
    economy.currentTrackId !== track.trackId ||
    !economy.playStartedAt ||
    !economy.playEndsAt
  ) {
    return 0;
  }

  const startedAt = new Date(economy.playStartedAt).getTime();
  const endsAt = new Date(economy.playEndsAt).getTime();
  const durationMs = Math.max(1, endsAt - startedAt);
  return Math.min(100, Math.max(0, ((nowMs - startedAt) / durationMs) * 100));
}

function resolveMapDisplayPosition(map: MapConfig, nowMs: number) {
  const movement = map.movement;
  if (!movement) {
    return {
      x: clampNormalizedCoordinate(map.playerPosX),
      y: clampNormalizedCoordinate(map.playerPosY),
      progress: null,
    };
  }

  const startedAtMs = new Date(movement.startedAt).getTime();
  const elapsedMs = Number.isFinite(startedAtMs)
    ? Math.max(0, nowMs - startedAtMs)
    : 0;
  const durationMs = Math.max(1, movement.durationMs);
  const progress = movement.loop
    ? (elapsedMs % durationMs) / durationMs
    : Math.min(1, elapsedMs / durationMs);
  const fromX = clampNormalizedCoordinate(movement.fromX);
  const fromY = clampNormalizedCoordinate(movement.fromY);
  const toX = clampNormalizedCoordinate(movement.toX);
  const toY = clampNormalizedCoordinate(movement.toY);

  return {
    x: fromX + (toX - fromX) * progress,
    y: fromY + (toY - fromY) * progress,
    progress,
  };
}

export default function Receiver() {
  const params = useParams<{ id: string }>();
  const requestedReceiverId = params.id || "unknown";
  const {
    connected,
    receiverState,
    pulseEvent,
    requestReceiverState,
    sendCommand,
    submitVote,
    postInteraction,
  } = useSocket({
    role: "receiver",
    receiverId: requestedReceiverId,
    receiverLabel: `Receiver ${requestedReceiverId}`,
  });
  const receiverId = receiverState?.receiverId ?? requestedReceiverId;
  const receiverIdWasAssigned = receiverId !== requestedReceiverId;
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
  const [optimisticVoteSelection, setOptimisticVoteSelection] = useState<{
    voteId: string;
    selectedOptionId: string;
  } | null>(null);
  const [optimisticColorChallenge, setOptimisticColorChallenge] =
    useState<ColorChallengeConfig | null>(null);
  const [activeVolumeTrackId, setActiveVolumeTrackId] = useState<string | null>(
    null
  );
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [lastTimingResult, setLastTimingResult] =
    useState<ReceiverTimingResult | null>(null);
  const latestColorChallengeSubmissionIdRef = useRef<string | null>(null);
  const colorChallengeResyncTimerRef = useRef<number | null>(null);
  const resolvedColorChallengeRoundIdRef = useRef<string | null>(null);

  const config = useMemo(
    () => receiverState?.config ?? createDefaultReceiverConfig(),
    [receiverState]
  );
  const economy = useMemo(
    () => resolveEconomyDisplay(config.economy, nowMs),
    [config.economy, nowMs]
  );
  const colorChallenge = optimisticColorChallenge ?? config.colorChallenge;
  const colorChallengeProgress = useMemo(
    () => resolveColorChallengeProgress(colorChallenge, nowMs),
    [colorChallenge, nowMs]
  );
  const iconColor = config.visuals.iconColor;
  const pulseEnabled = config.pulse.enabled && config.pulse.active;
  const scoreVisible = config.score.visible;
  const mapVisible = config.map.visible;
  const mapMovementActive = Boolean(config.map.movement);
  const mapDisplayPosition = useMemo(
    () => resolveMapDisplayPosition(config.map, nowMs),
    [config.map, nowMs]
  );
  const clampedMapX = clampNormalizedCoordinate(mapDisplayPosition.x);
  const clampedMapY = clampNormalizedCoordinate(mapDisplayPosition.y);
  const activeVote = useMemo(() => {
    if (!config.vote?.visible || !config.vote.enabled) {
      return null;
    }

    const selectedOptionId =
      optimisticVoteSelection?.voteId === config.vote.voteId
        ? optimisticVoteSelection.selectedOptionId
        : config.vote.selectedOptionId;

    return {
      ...config.vote,
      selectedOptionId,
    };
  }, [config.vote, optimisticVoteSelection]);
  const voteInteractionLocked = Boolean(activeVote);
  const timingVisible = config.timing.visible;
  const timingStatus = useMemo(
    () =>
      evaluateTimingPress({
        timingValue: config.timing.timingValue,
        targetCenter: config.timing.targetCenter,
        timingTolerance: config.timing.timingTolerance,
        pulseEnabled,
        pulseEvent,
        nowMs,
      }),
    [
      config.timing.targetCenter,
      config.timing.timingTolerance,
      config.timing.timingValue,
      nowMs,
      pulseEnabled,
      pulseEvent,
    ]
  );
  const timingWindowStart = Math.max(
    0,
    timingStatus.targetCenter - timingStatus.timingTolerance
  );
  const timingWindowEnd = Math.min(
    1,
    timingStatus.targetCenter + timingStatus.timingTolerance
  );
  const timingWindowWidth = Math.max(0, timingWindowEnd - timingWindowStart);

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
    const latestSubmissionId = latestColorChallengeSubmissionIdRef.current;
    if (!optimisticColorChallenge || !latestSubmissionId) {
      return;
    }

    const serverChallenge = config.colorChallenge;
    const acknowledged =
      serverChallenge.lastResult?.submissionId === latestSubmissionId ||
      (serverChallenge.iterationId !== null &&
        serverChallenge.iterationId === optimisticColorChallenge.iterationId &&
        Math.abs(serverChallenge.score - optimisticColorChallenge.score) < 0.001);
    if (!acknowledged) {
      return;
    }

    latestColorChallengeSubmissionIdRef.current = null;
    if (colorChallengeResyncTimerRef.current !== null) {
      window.clearTimeout(colorChallengeResyncTimerRef.current);
      colorChallengeResyncTimerRef.current = null;
    }
    setOptimisticColorChallenge(null);
  }, [config.colorChallenge, optimisticColorChallenge]);

  useEffect(() => {
    if (connected) {
      return;
    }

    latestColorChallengeSubmissionIdRef.current = null;
    resolvedColorChallengeRoundIdRef.current = null;
    if (colorChallengeResyncTimerRef.current !== null) {
      window.clearTimeout(colorChallengeResyncTimerRef.current);
      colorChallengeResyncTimerRef.current = null;
    }
    setOptimisticColorChallenge(null);
  }, [connected, receiverId]);

  useEffect(() => {
    if (!config.textDisplay.text) {
      return;
    }

    setMessageFlash(true);
    const timer = window.setTimeout(() => setMessageFlash(false), 1500);
    return () => window.clearTimeout(timer);
  }, [config.textDisplay.text]);

  useEffect(() => {
    if (
      !pulseEnabled &&
      !mapMovementActive &&
      !config.economy.visible &&
      !config.colorChallenge.visible
    ) {
      return;
    }

    let frameId = 0;

    const tick = () => {
      setNowMs(Date.now());
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [
    config.colorChallenge.visible,
    config.economy.visible,
    mapMovementActive,
    pulseEnabled,
  ]);

  useEffect(() => {
    return () => {
      if (colorChallengeResyncTimerRef.current !== null) {
        window.clearTimeout(colorChallengeResyncTimerRef.current);
      }
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

  const pulsePhase = useMemo(() => {
    if (!pulseEnabled || !pulseEvent) {
      return 0;
    }

    const elapsed = Math.max(0, nowMs - pulseEvent.timestamp);
    return Math.min(100, (elapsed / pulseEvent.intervalMs) * 100);
  }, [nowMs, pulseEnabled, pulseEvent]);

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

  useEffect(() => {
    if (!config.vote?.visible || !config.vote.enabled) {
      setOptimisticVoteSelection(null);
      return;
    }

    const vote = config.vote;

    setOptimisticVoteSelection(current => {
      if (!current || current.voteId !== vote.voteId) {
        return vote.selectedOptionId
          ? {
              voteId: vote.voteId,
              selectedOptionId: vote.selectedOptionId,
            }
          : null;
      }

      if (
        vote.selectedOptionId &&
        vote.selectedOptionId !== current.selectedOptionId
      ) {
        return {
          voteId: vote.voteId,
          selectedOptionId: vote.selectedOptionId,
        };
      }

      return current;
    });
  }, [config.vote]);

  const handlePlayToggle = useCallback(
    (track: TrackState) => {
      const nextPlaying = !track.playing;
      sendCommand({
        command: nextPlaying ? "request_track_play" : "request_track_stop",
        targetId: receiverId,
        payload: {
          trackId: track.trackId,
        },
        timestamp: new Date().toISOString(),
      });
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
    [activeVolumeTrackId, postDiscreteInteraction, receiverId, sendCommand]
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

  const handleVoteSelection = useCallback(
    (optionId: string) => {
      if (!activeVote) {
        return;
      }

      if (!activeVote.allowRevote && activeVote.selectedOptionId !== null) {
        return;
      }

      setOptimisticVoteSelection({
        voteId: activeVote.voteId,
        selectedOptionId: optionId,
      });
      submitVote({
        voteId: activeVote.voteId,
        selectedOptionId: optionId,
      });
      postDiscreteInteraction({
        action:
          activeVote.selectedOptionId === null ? "submitVote" : "revoteVote",
        element: "receiver:vote_button",
        value: {
          voteId: activeVote.voteId,
          selectedOptionId: optionId,
        },
      });
    },
    [activeVote, postDiscreteInteraction, submitVote]
  );

  const handleTimingPress = useCallback(() => {
    const evaluation = evaluateTimingPress({
      timingValue: config.timing.timingValue,
      targetCenter: config.timing.targetCenter,
      timingTolerance: config.timing.timingTolerance,
      pulseEnabled,
      pulseEvent,
      nowMs: Date.now(),
    });

    const isoTimestamp = new Date().toISOString();
    setLastTimingResult({
      ...evaluation,
      isoTimestamp,
    });
    postDiscreteInteraction({
      action: "submitTiming",
      element: "receiver:timing_button",
      value: evaluation,
    });
  }, [
    config.timing.targetCenter,
    config.timing.timingTolerance,
    config.timing.timingValue,
    nowMs,
    postDiscreteInteraction,
    pulseEnabled,
    pulseEvent,
  ]);

  const resolveColorChallengeLocally = useCallback(
    (choiceIndex: number | null) => {
      if (!connected) {
        return false;
      }

      const activeChallenge = optimisticColorChallenge ?? config.colorChallenge;
      if (
        !activeChallenge.visible ||
        !activeChallenge.enabled ||
        activeChallenge.gameOver ||
        !hasValidColorChallengeRound(activeChallenge) ||
        resolvedColorChallengeRoundIdRef.current === activeChallenge.iterationId
      ) {
        return false;
      }

      const resolvedAtMs = Date.now();
      const evaluation = evaluateColorChallengeRound({
        challenge: activeChallenge,
        choiceIndex,
        resolvedAtMs,
      });
      if (!evaluation) {
        return false;
      }

      const resolvedAt = new Date(resolvedAtMs).toISOString();
      const submissionId = createGeneratedId("color-submit");
      const nextScore = Math.max(0, activeChallenge.score + evaluation.scoreDelta);
      const gameOver = nextScore <= 0;
      const nextChallenge: ColorChallengeConfig = {
        ...activeChallenge,
        score: nextScore,
        gameOver,
        lastResult: {
          ...evaluation,
          score: nextScore,
          gameOver,
          resolvedAt,
          submissionId,
        },
      };
      const nextRound = gameOver
        ? null
        : createColorChallengeRound(activeChallenge, resolvedAt);

      if (nextRound) {
        assignColorChallengeRound(nextChallenge, nextRound);
      }

      resolvedColorChallengeRoundIdRef.current = activeChallenge.iterationId;
      latestColorChallengeSubmissionIdRef.current = submissionId;
      if (colorChallengeResyncTimerRef.current !== null) {
        window.clearTimeout(colorChallengeResyncTimerRef.current);
      }
      colorChallengeResyncTimerRef.current = window.setTimeout(() => {
        if (latestColorChallengeSubmissionIdRef.current !== submissionId) {
          return;
        }

        latestColorChallengeSubmissionIdRef.current = null;
        resolvedColorChallengeRoundIdRef.current = null;
        colorChallengeResyncTimerRef.current = null;
        setOptimisticColorChallenge(null);
        requestReceiverState();
      }, 5000);

      setOptimisticColorChallenge(nextChallenge);
      sendCommand({
        command: "submit_color_challenge_choice",
        targetId: receiverId,
        payload: {
          roundId: activeChallenge.iterationId ?? undefined,
          submissionId,
          choiceIndex,
          colorId: evaluation.colorId ?? undefined,
          pressedAt: resolvedAt,
          nextRound,
        },
        timestamp: resolvedAt,
      });
      postDiscreteInteraction({
        action:
          evaluation.reason === "miss"
            ? "submitColorChallengeMiss"
            : "submitColorChallengeChoice",
        element: "receiver:color_challenge_choice",
        value: {
          choiceIndex: evaluation.choiceIndex,
          colorId: evaluation.colorId,
          reason: evaluation.reason,
          t: evaluation.t,
          greenness: evaluation.greenness,
          scoreDelta: evaluation.scoreDelta,
          submissionId,
          nextIterationId: nextRound?.iterationId ?? null,
        },
      });

      return true;
    },
    [
      config.colorChallenge,
      connected,
      optimisticColorChallenge,
      postDiscreteInteraction,
      receiverId,
      requestReceiverState,
      sendCommand,
    ]
  );

  const handleColorChallengeChoice = useCallback(
    (choiceIndex: number) => {
      const choice = colorChallenge.choices[choiceIndex];
      if (
        !choice ||
        !colorChallenge.visible ||
        !colorChallenge.enabled ||
        colorChallenge.gameOver
      ) {
        return;
      }

      resolveColorChallengeLocally(choiceIndex);
    },
    [colorChallenge, resolveColorChallengeLocally]
  );

  useEffect(() => {
    if (
      !connected ||
      !colorChallenge.visible ||
      !colorChallenge.enabled ||
      colorChallenge.gameOver ||
      !hasValidColorChallengeRound(colorChallenge) ||
      colorChallengeProgress.t < 1 ||
      resolvedColorChallengeRoundIdRef.current === colorChallenge.iterationId
    ) {
      return;
    }

    resolveColorChallengeLocally(null);
  }, [
    colorChallenge,
    colorChallengeProgress.t,
    connected,
    resolveColorChallengeLocally,
  ]);

  return (
    <div className="dark min-h-screen bg-zinc-950 text-zinc-50">
      <header className="border-b border-white/10 bg-zinc-950/90 backdrop-blur">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="flex size-9 items-center justify-center rounded-lg transition-colors duration-500"
              style={{ backgroundColor: `${iconColor}20` }}
            >
              <Hexagon style={{ color: iconColor }} />
            </div>
            <div>
              <h1 className="text-sm font-semibold">Receiver {receiverId}</h1>
              <p className="text-xs text-zinc-400">
                {receiverIdWasAssigned
                  ? `Requested ${requestedReceiverId}, assigned ${receiverId}`
                  : "Choose sounds when you have enough seconds."}
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
          <section className="flex flex-col items-center py-4">
            <div
              className="flex h-28 w-28 items-center justify-center rounded-lg shadow-lg transition-all duration-700"
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
            <div className="mt-4 grid w-full max-w-sm grid-cols-3 gap-2">
              <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-center">
                <p className="text-[10px] uppercase text-zinc-400">Pool</p>
                <p className="text-lg font-semibold">
                  {economy.currencySeconds.toFixed(1)}s
                </p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-center">
                <p className="text-[10px] uppercase text-zinc-400">Cost x</p>
                <p className="text-lg font-semibold">
                  {economy.inflation.toFixed(2)}
                </p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-center">
                <p className="text-[10px] uppercase text-zinc-400">State</p>
                <p className="truncate text-lg font-semibold">
                  {economy.gameOver
                    ? "Game Over"
                    : economy.currentTrackId
                      ? "Playing"
                      : "Ready"}
                </p>
              </div>
            </div>
            {economy.lastError ? (
              <p className="mt-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-100">
                {economy.lastError.replace(/_/g, " ")}
              </p>
            ) : null}
          </section>

          {activeVote ? (
            <Card className="border-primary/35 bg-primary/5 shadow-[0_24px_80px_hsl(var(--primary)/0.12)]">
              <CardHeader className="pb-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="gap-1.5">
                    <Lock className="size-3.5" />
                    Vote In Progress
                  </Badge>
                  <Badge variant="outline">
                    {activeVote.options.length} option
                    {activeVote.options.length === 1 ? "" : "s"}
                  </Badge>
                  <Badge
                    variant={
                      activeVote.selectedOptionId ? "secondary" : "outline"
                    }
                  >
                    {activeVote.selectedOptionId ? "Vote Submitted" : "Waiting"}
                  </Badge>
                </div>
                <CardTitle className="text-xl leading-tight">
                  {activeVote.question}
                </CardTitle>
                <CardDescription>
                  Other receiver interactions stay paused until this vote
                  closes.
                  {activeVote.allowRevote
                    ? " Your current choice stays visible, and you can tap another option to revise it before the timer ends."
                    : " Your first choice is final for this round."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  {activeVote.options.map(option => {
                    const selected = activeVote.selectedOptionId === option.id;
                    const locked =
                      !activeVote.allowRevote &&
                      activeVote.selectedOptionId !== null;

                    return (
                      <Button
                        key={option.id}
                        type="button"
                        variant={selected ? "default" : "outline"}
                        className={cn(
                          "h-auto min-h-20 justify-start rounded-2xl px-4 py-4 text-left text-base whitespace-normal",
                          selected &&
                            "shadow-[0_0_0_1px_hsl(var(--primary)/0.15)]"
                        )}
                        disabled={locked}
                        onClick={() => handleVoteSelection(option.id)}
                      >
                        <span className="flex w-full items-start justify-between gap-3">
                          <span>{option.label}</span>
                          {selected ? (
                            <CheckCircle2 className="mt-0.5 size-5 shrink-0" />
                          ) : null}
                        </span>
                      </Button>
                    );
                  })}
                </div>

                <div className="rounded-2xl border border-border/60 bg-background/80 px-4 py-3 text-sm text-muted-foreground">
                  {activeVote.selectedOptionId ? (
                    <p>
                      Current selection:{" "}
                      {
                        activeVote.options.find(
                          option => option.id === activeVote.selectedOptionId
                        )?.label
                      }
                    </p>
                  ) : (
                    <p>Select one option to submit your vote.</p>
                  )}
                  {activeVote.allowRevote && activeVote.selectedOptionId ? (
                    <p className="mt-2 text-xs">
                      Tap another option at any time before the vote closes to
                      change your answer.
                    </p>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <div
            className={cn(
              "space-y-6 transition-opacity",
              voteInteractionLocked && "pointer-events-none opacity-25"
            )}
            aria-hidden={voteInteractionLocked}
          >
            {colorChallenge.visible ? (
              <Card className="border-primary/20 bg-card/95 shadow-[0_20px_70px_hsl(var(--primary)/0.08)]">
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        colorChallenge.enabled && !colorChallenge.gameOver
                          ? "default"
                          : "outline"
                      }
                    >
                      {colorChallenge.gameOver
                        ? "Game Over"
                        : colorChallenge.enabled
                          ? "Active"
                          : "Locked"}
                    </Badge>
                    <Badge variant="secondary">
                      Score {colorChallenge.score.toFixed(1)}
                    </Badge>
                    <Badge variant="outline">
                      {colorChallenge.iterationDurationMs / 1000}s round
                    </Badge>
                  </div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Palette />
                    Color Challenge
                  </CardTitle>
                  <CardDescription>
                    Match your assigned color. The center of the bar gives the
                    largest reward, and wrong choices near the center hurt more.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="rounded-lg border border-border/60 bg-muted/25 px-4 py-3">
                      <p className="text-xs uppercase text-muted-foreground">
                        Your Color
                      </p>
                      {(() => {
                        const assigned = colorChallenge.palette.find(
                          color =>
                            color.colorId === colorChallenge.assignedColorId
                        );
                        return (
                          <div className="mt-2 flex min-w-0 items-center gap-3">
                            <span
                              className="size-8 shrink-0 rounded-lg border border-white/20"
                              style={{
                                backgroundColor:
                                  assigned?.color ?? "transparent",
                              }}
                            />
                            <p className="truncate text-2xl font-semibold">
                              {assigned?.label ?? "Waiting"}
                            </p>
                          </div>
                        );
                      })()}
                    </div>
                    <div className="rounded-lg border border-border/60 bg-muted/25 px-4 py-3 text-center">
                      <p className="text-xs uppercase text-muted-foreground">
                        Score
                      </p>
                      <p className="mt-2 text-3xl font-semibold">
                        {colorChallenge.score.toFixed(1)}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
                    <div className="relative h-8 overflow-hidden rounded-full bg-muted">
                      <div className="absolute inset-0 bg-[linear-gradient(90deg,#ef4444_0%,#f59e0b_22%,#22c55e_50%,#f59e0b_78%,#ef4444_100%)]" />
                      <div
                        className="absolute inset-y-0 right-0 bg-background/85"
                        style={{
                          width: `${Math.max(
                            0,
                            (1 - colorChallengeProgress.t) * 100
                          )}%`,
                        }}
                      />
                      <div className="absolute inset-y-[-6px] left-1/2 w-1 -translate-x-1/2 rounded-full bg-white shadow-[0_0_0_1px_rgba(255,255,255,0.7),0_0_16px_rgba(255,255,255,0.45)]" />
                      <div
                        className="absolute inset-y-[-2px] w-4 -translate-x-1/2 rounded-full border border-background/70 bg-background shadow-[0_0_18px_rgba(255,255,255,0.35)]"
                        style={{
                          left: `${colorChallengeProgress.t * 100}%`,
                        }}
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap justify-between gap-3 text-xs text-muted-foreground">
                      <span>
                        Greenness {colorChallengeProgress.greenness.toFixed(2)}
                      </span>
                      <span>
                        Remaining{" "}
                        {(colorChallengeProgress.remainingMs / 1000).toFixed(1)}
                        s
                      </span>
                    </div>
                  </div>

                  {colorChallenge.gameOver ? (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                      GAME OVER
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {colorChallenge.choices.map((choice, index) => (
                        <Button
                          key={`${choice.colorId}-${index}`}
                          type="button"
                          size="lg"
                          className="h-auto min-h-20 justify-start rounded-lg px-4 py-4 text-left text-base whitespace-normal"
                          style={{
                            backgroundColor: choice.color,
                            color: "#0a0a0a",
                          }}
                          disabled={
                            !connected ||
                            !colorChallenge.enabled ||
                            colorChallenge.choices.length !== 2
                          }
                          onClick={() => handleColorChallengeChoice(index)}
                        >
                          {choice.label}
                        </Button>
                      ))}
                    </div>
                  )}

                  {colorChallenge.lastResult ? (
                    <div className="rounded-lg border border-border/60 bg-background/80 px-4 py-3 text-sm">
                      <p className="font-medium">
                        Last result: {colorChallenge.lastResult.reason}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Delta {colorChallenge.lastResult.scoreDelta.toFixed(2)}{" "}
                        · score {colorChallenge.lastResult.score.toFixed(1)}
                      </p>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            {timingVisible ? (
              <Card className="border-primary/20 bg-card/95 shadow-[0_20px_70px_hsl(var(--primary)/0.08)]">
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={config.timing.enabled ? "default" : "outline"}
                    >
                      {config.timing.enabled ? "Active" : "Locked"}
                    </Badge>
                    <Badge
                      variant={
                        timingStatus.pulseActive ? "secondary" : "outline"
                      }
                    >
                      {timingStatus.pulseActive ? "Pulse Synced" : "Pulse Idle"}
                    </Badge>
                    <Badge variant="outline">
                      Target {timingStatus.targetCenter.toFixed(2)}
                    </Badge>
                    <Badge variant="outline">
                      ±{timingStatus.timingTolerance.toFixed(2)}
                    </Badge>
                  </div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Target />
                    Timing Challenge
                  </CardTitle>
                  <CardDescription>
                    Tap when the moving marker crosses the bright center line.
                    Hits and misses are forwarded to Unity in real time and
                    recorded for JSON export.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="rounded-[1.5rem] border border-border/60 bg-muted/20 p-5">
                    <div className="relative h-8 overflow-hidden rounded-full bg-muted">
                      <div className="absolute inset-0 bg-[linear-gradient(90deg,#ef4444_0%,#f59e0b_22%,#22c55e_50%,#f59e0b_78%,#ef4444_100%)]" />
                      <div
                        className="absolute inset-y-0 right-0 bg-background/85 transition-[width] duration-75"
                        style={{
                          width: `${Math.max(
                            0,
                            (1 - timingStatus.timingValue) * 100
                          )}%`,
                        }}
                      />
                      <div
                        className="absolute inset-y-0 rounded-full bg-white/20"
                        style={{
                          left: `${timingWindowStart * 100}%`,
                          width: `${timingWindowWidth * 100}%`,
                        }}
                      />
                      <div
                        className="absolute inset-y-[-6px] w-1 rounded-full bg-white shadow-[0_0_0_1px_rgba(255,255,255,0.7),0_0_16px_rgba(255,255,255,0.45)]"
                        style={{
                          left: `calc(${timingStatus.targetCenter * 100}% - 2px)`,
                        }}
                      />
                      <div
                        className={cn(
                          "absolute inset-y-[-2px] w-4 -translate-x-1/2 rounded-full border border-background/70 bg-background shadow-[0_0_18px_rgba(255,255,255,0.35)] transition-[left] duration-75",
                          lastTimingResult?.timing &&
                            "border-emerald-200 bg-emerald-100",
                          lastTimingResult &&
                            !lastTimingResult.timing &&
                            "border-rose-200 bg-rose-100"
                        )}
                        style={{
                          left: `${timingStatus.timingValue * 100}%`,
                        }}
                      />
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span>
                        Progress {timingStatus.timingValue.toFixed(3)}
                      </span>
                      <span>Delta {timingStatus.delta.toFixed(3)}</span>
                      <span>
                        {timingStatus.pulseActive
                          ? `Pulse #${timingStatus.pulseSequence ?? "--"}`
                          : "Pulse inactive"}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <Button
                      type="button"
                      size="lg"
                      className={cn(
                        "min-w-48 rounded-2xl",
                        lastTimingResult?.timing &&
                          "bg-emerald-600 hover:bg-emerald-600/90",
                        lastTimingResult &&
                          !lastTimingResult.timing &&
                          "bg-rose-600 hover:bg-rose-600/90"
                      )}
                      disabled={!config.timing.enabled}
                      onClick={handleTimingPress}
                    >
                      {config.timing.enabled
                        ? "Press On Beat"
                        : "Timing Locked"}
                    </Button>

                    <div className="rounded-2xl border border-border/60 bg-background/80 px-4 py-3 text-sm">
                      {lastTimingResult ? (
                        <>
                          <p className="font-medium">
                            {lastTimingResult.timing ? "Hit" : "Miss"} at{" "}
                            {new Date(
                              lastTimingResult.isoTimestamp
                            ).toLocaleTimeString()}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            value {lastTimingResult.timingValue.toFixed(3)} ·
                            delta {lastTimingResult.delta.toFixed(3)}
                          </p>
                        </>
                      ) : (
                        <p className="text-muted-foreground">
                          No attempts yet. Wait for the marker to cross the
                          center line, then tap once.
                        </p>
                      )}
                    </div>
                  </div>

                  {!timingStatus.pulseActive ? (
                    <p className="text-xs text-muted-foreground">
                      Pulse is currently inactive. Presses still log and export,
                      but they resolve against the fallback `timingValue` rather
                      than a live moving bar.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            {scoreVisible ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Trophy />
                    Score
                  </CardTitle>
                  <CardDescription>
                    Per-player scoring remains state-driven so controller and
                    Unity see the same value.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded-[1.75rem] border border-border/60 bg-muted/25 p-6 text-center">
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <Badge
                        variant={config.score.enabled ? "secondary" : "outline"}
                      >
                        {config.score.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                      <Badge variant="outline">Receiver {receiverId}</Badge>
                    </div>
                    <p className="mt-6 text-xs uppercase tracking-[0.22em] text-muted-foreground">
                      Current Score
                    </p>
                    <p className="mt-3 text-7xl font-semibold tracking-tight">
                      {config.score.value}
                    </p>
                    <p className="mt-4 text-sm text-muted-foreground">
                      {config.score.enabled
                        ? "Ready for live updates."
                        : "Score display locked by the controller."}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {mapVisible ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <MapIcon />
                    Classroom Map
                  </CardTitle>
                  <CardDescription>
                    Normalized coordinates place the receiver inside the shared
                    classroom space.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ClassroomMap
                    x={mapDisplayPosition.x}
                    y={mapDisplayPosition.y}
                    animated={mapMovementActive}
                    disabled={!config.map.enabled}
                    markerLabel={`Receiver ${receiverId}`}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={config.map.enabled ? "secondary" : "outline"}
                    >
                      {config.map.enabled
                        ? "Tracking Enabled"
                        : "Tracking Disabled"}
                    </Badge>
                    {config.map.movement ? (
                      <Badge variant="secondary">
                        {config.map.movement.loop ? "Looping" : "One-way"}{" "}
                        {(config.map.movement.durationMs / 1000).toFixed(1)}s
                      </Badge>
                    ) : null}
                    <Badge variant="outline">
                      Left→Right {(clampedMapX * 100).toFixed(1)} · Back→Front{" "}
                      {((1 - clampedMapY) * 100).toFixed(1)}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {config.pulse.visible || pulseEnabled ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Zap />
                    Pulse Sync
                  </CardTitle>
                  <CardDescription>
                    Server-side beat messages keep every receiver aligned to one
                    clock.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={pulseEnabled ? "default" : "secondary"}>
                      {pulseEnabled ? "Pulse Live" : "Pulse Idle"}
                    </Badge>
                    <Badge variant="outline">{config.pulse.bpm} BPM</Badge>
                    {pulseEvent ? (
                      <Badge variant="outline">
                        Beat #{pulseEvent.sequence + 1}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-muted/30 p-4">
                    <div className="mb-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span>Beat Phase</span>
                      <span>
                        {pulseEnabled && pulseEvent
                          ? `${Math.round(pulsePhase)}%`
                          : "Waiting"}
                      </span>
                    </div>
                    <Progress value={pulsePhase} className="h-3" />
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {visibleTracks.length > 0 ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <AudioLines />
                    Tracks
                  </CardTitle>
                  <CardDescription>
                    Only tracks selected by the controller are available here.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 lg:grid-cols-2">
                  {visibleTracks.map(track => (
                    <ReceiverTrackCard
                      key={track.trackId}
                      track={track}
                      economy={economy}
                      disabled={
                        economy.gameOver ||
                        !economy.enabled ||
                        voteInteractionLocked
                      }
                      activeVolumeTrackId={activeVolumeTrackId}
                      onPlayToggle={handlePlayToggle}
                      onLoopToggle={handleLoopToggle}
                      onVolumeChange={handleVolumeChange}
                      onVolumeDismiss={handleVolumeDismiss}
                      onVolumeOpen={trackId => setActiveVolumeTrackId(trackId)}
                      nowMs={nowMs}
                      pulseEvent={pulseEvent}
                      beginContinuousInteraction={beginContinuousInteraction}
                      endContinuousInteraction={endContinuousInteraction}
                    />
                  ))}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Music />
                    Tracks
                  </CardTitle>
                  <CardDescription>
                    No tracks are currently available.
                  </CardDescription>
                </CardHeader>
              </Card>
            )}

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
        </div>
      </main>
    </div>
  );
}

function ReceiverTrackCard({
  track,
  economy,
  disabled,
  activeVolumeTrackId,
  onPlayToggle,
  onLoopToggle,
  onVolumeChange,
  onVolumeDismiss,
  onVolumeOpen,
  nowMs,
  pulseEvent,
  beginContinuousInteraction,
  endContinuousInteraction,
}: {
  track: TrackState;
  economy: EconomyConfig;
  disabled: boolean;
  activeVolumeTrackId: string | null;
  onPlayToggle: (track: TrackState) => void;
  onLoopToggle: (track: TrackState) => void;
  onVolumeChange: (track: TrackState, value: number) => void;
  onVolumeDismiss: (track: TrackState) => void;
  onVolumeOpen: (trackId: string | null) => void;
  nowMs: number;
  pulseEvent: PulseEvent | null;
  beginContinuousInteraction: ReturnType<
    typeof usePostToUnity
  >["beginContinuousInteraction"];
  endContinuousInteraction: ReturnType<
    typeof usePostToUnity
  >["endContinuousInteraction"];
}) {
  const fillDurationMs = Math.max(0, track.fillTime) * 1000;
  const volumeOpen =
    activeVolumeTrackId === track.trackId &&
    track.playing &&
    track.volumeControlVisible &&
    track.volumeControlEnabled;
  const [fillCycleStartedAt, setFillCycleStartedAt] = useState<number | null>(
    pulseEvent?.timestamp ?? null
  );
  const [lastFillFlashAt, setLastFillFlashAt] = useState<number | null>(null);
  const lastPulseSequenceRef = useRef<number | null>(null);
  const lastCompletedCycleRef = useRef<number>(-1);

  useEffect(() => {
    lastPulseSequenceRef.current = null;
    lastCompletedCycleRef.current = -1;
    setLastFillFlashAt(null);
    setFillCycleStartedAt(pulseEvent?.timestamp ?? null);
  }, [track.fillTime, track.trackId]);

  useEffect(() => {
    if (!pulseEvent || lastPulseSequenceRef.current === pulseEvent.sequence) {
      return;
    }

    lastPulseSequenceRef.current = pulseEvent.sequence;
    setFillCycleStartedAt(current => {
      if (current === null || fillDurationMs === 0) {
        return pulseEvent.timestamp;
      }

      const elapsed = pulseEvent.timestamp - current;
      if (
        elapsed >= fillDurationMs ||
        fillDurationMs <= pulseEvent.intervalMs
      ) {
        return pulseEvent.timestamp;
      }

      return current;
    });
  }, [fillDurationMs, pulseEvent]);

  useEffect(() => {
    if (fillDurationMs <= 0 || fillCycleStartedAt === null) {
      lastCompletedCycleRef.current = -1;
      return;
    }

    const completedCycles = Math.floor(
      Math.max(0, nowMs - fillCycleStartedAt) / fillDurationMs
    );
    if (
      completedCycles <= 0 ||
      completedCycles === lastCompletedCycleRef.current
    ) {
      return;
    }

    lastCompletedCycleRef.current = completedCycles;
    setLastFillFlashAt(fillCycleStartedAt + completedCycles * fillDurationMs);
  }, [fillCycleStartedAt, fillDurationMs, nowMs]);

  const fillProgress = useMemo(() => {
    if (fillDurationMs === 0) {
      return 100;
    }

    if (fillCycleStartedAt === null) {
      return 0;
    }

    const elapsed = Math.max(0, nowMs - fillCycleStartedAt);
    return Math.min(100, ((elapsed % fillDurationMs) / fillDurationMs) * 100);
  }, [fillCycleStartedAt, fillDurationMs, nowMs]);

  const pulseFlashActive = Boolean(
    track.tempoFlashEnabled &&
      pulseEvent &&
      nowMs - pulseEvent.timestamp < Math.min(220, pulseEvent.intervalMs * 0.45)
  );
  const fillFlashActive = Boolean(
    track.tempoFlashEnabled &&
      lastFillFlashAt !== null &&
      nowMs - lastFillFlashAt < 220
  );
  const markerActive = pulseFlashActive || fillFlashActive;
  const trackCost = calculateTrackCost(track, economy);
  const playProgress = resolveTrackPlayProgress(track, economy, nowMs);
  const displayedProgress = track.playing ? playProgress : fillProgress;
  const canPlay =
    !disabled &&
    track.visible &&
    track.enabled &&
    track.playable &&
    trackCost !== null &&
    (!economy.currentTrackId || economy.currentTrackId === track.trackId);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-white/10 bg-white/[0.06] transition-all duration-300",
        markerActive &&
          "border-white/25 bg-white/[0.09] shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
      )}
      style={{ borderLeft: `4px solid ${track.categoryColor}` }}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 p-3">
        <Button
          size="icon"
          variant={track.playing ? "secondary" : "default"}
          className="size-11 rounded-lg"
          style={
            track.playing
              ? undefined
              : {
                  backgroundColor: track.categoryColor,
                  color: "#0a0a0a",
                }
          }
          disabled={!canPlay && !track.playing}
          onClick={() => onPlayToggle(track)}
        >
          {track.playing ? <VolumeX /> : <Play />}
          <span className="sr-only">{track.playing ? "Stop" : "Play"}</span>
        </Button>

        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-semibold text-zinc-50">
              {track.label}
            </p>
            <Badge
              variant={track.playing ? "default" : "secondary"}
              className="shrink-0 rounded-md"
            >
              {track.playing ? "Playing" : "Ready"}
            </Badge>
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400">
            <span className="inline-flex items-center gap-1">
              <Coins className="size-3" />
              Cost {trackCost === null ? "--" : trackCost.toFixed(1)}s
            </span>
            <span className="truncate">{track.categoryId}</span>
            {!track.playable || !track.enabled ? (
              <span className="text-red-300">Disabled</span>
            ) : null}
          </div>
          <Progress value={displayedProgress} className="mt-2 h-2" />
        </div>

        <div className="flex flex-col items-end gap-2">
          {track.loopControlVisible ? (
            <Button
              size="sm"
              variant={track.loopEnabled ? "default" : "outline"}
              className="h-8 rounded-lg px-2"
              disabled={disabled || track.loopControlLocked}
              onClick={() => onLoopToggle(track)}
            >
              <Repeat className="size-4" />
              <span className="sr-only">
                {track.loopEnabled ? "Loop On" : "Loop Off"}
              </span>
            </Button>
          ) : (
            <Badge variant="outline">Loop Hidden</Badge>
          )}

          {track.volumeControlVisible && track.volumeControlEnabled ? (
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
                  className="h-8 rounded-lg px-2"
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
                className="w-[min(24rem,calc(100vw-2rem))] rounded-lg p-5"
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
                  <div className="rounded-lg border border-border/60 bg-muted/35 p-4">
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
          ) : track.volumeControlVisible ? (
            <Badge variant="outline">Volume External</Badge>
          ) : null}
        </div>
      </div>
    </div>
  );
}
