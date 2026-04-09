import type { PulseEvent } from "../shared/wsTypes";

type TimerHandle = ReturnType<typeof setTimeout>;

export interface PulseSchedulerRuntime {
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
}

export interface PulseScheduler {
  start: () => void;
  stop: () => void;
  updateBpm: (nextBpm: number) => void;
  isRunning: () => boolean;
}

export interface CreatePulseSchedulerOptions {
  receiverId: string;
  bpm: number;
  onPulse: (event: PulseEvent) => void;
  runtime?: PulseSchedulerRuntime;
}

const DEFAULT_PULSE_BPM = 90;
const MIN_PULSE_BPM = 1;
const MAX_PULSE_BPM = 600;

function createDefaultRuntime(): PulseSchedulerRuntime {
  return {
    now: () => Date.now(),
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimeout: handle => clearTimeout(handle),
  };
}

export function clampPulseBpm(
  value: number,
  fallback = DEFAULT_PULSE_BPM
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(MAX_PULSE_BPM, Math.max(MIN_PULSE_BPM, value));
}

export function pulseIntervalMsFromBpm(bpm: number): number {
  return 60_000 / clampPulseBpm(bpm);
}

export function createPulseScheduler(
  options: CreatePulseSchedulerOptions
): PulseScheduler {
  const runtime = options.runtime ?? createDefaultRuntime();
  let bpm = clampPulseBpm(options.bpm);
  let timer: TimerHandle | null = null;
  let expectedTickAt = 0;
  let sequence = 0;

  function clearScheduledTick() {
    if (!timer) {
      return;
    }

    runtime.clearTimeout(timer);
    timer = null;
  }

  function scheduleNextTick(delayMs: number) {
    clearScheduledTick();
    timer = runtime.setTimeout(tick, Math.max(0, delayMs));
  }

  function tick() {
    const intervalMs = pulseIntervalMsFromBpm(bpm);
    const now = runtime.now();

    options.onPulse({
      receiverId: options.receiverId,
      bpm,
      intervalMs,
      sequence,
      timestamp: now,
    });
    sequence += 1;

    expectedTickAt += intervalMs;
    scheduleNextTick(expectedTickAt - runtime.now());
  }

  function startFrom(now: number) {
    const intervalMs = pulseIntervalMsFromBpm(bpm);
    expectedTickAt = now + intervalMs;
    scheduleNextTick(intervalMs);
  }

  return {
    start() {
      if (timer) {
        return;
      }

      sequence = 0;
      startFrom(runtime.now());
    },
    stop() {
      clearScheduledTick();
      sequence = 0;
      expectedTickAt = 0;
    },
    updateBpm(nextBpm) {
      bpm = clampPulseBpm(nextBpm, bpm);

      if (!timer) {
        return;
      }

      startFrom(runtime.now());
    },
    isRunning() {
      return timer !== null;
    },
  };
}
