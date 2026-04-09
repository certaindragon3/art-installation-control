import { describe, expect, it } from "vitest";
import {
  clampPulseBpm,
  createPulseScheduler,
  pulseIntervalMsFromBpm,
  type PulseSchedulerRuntime,
} from "./pulseScheduler";
import type { PulseEvent } from "../shared/wsTypes";

type ScheduledTimer = {
  id: number;
  dueAt: number;
  callback: () => void;
  cleared: boolean;
};

function createTestRuntime() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, ScheduledTimer>();

  const runtime: PulseSchedulerRuntime = {
    now: () => now,
    setTimeout: (callback, delayMs) => {
      const timer: ScheduledTimer = {
        id: nextId,
        dueAt: now + Math.max(0, delayMs),
        callback,
        cleared: false,
      };

      timers.set(nextId, timer);
      nextId += 1;
      return timer as ReturnType<typeof setTimeout>;
    },
    clearTimeout: handle => {
      const timer = handle as unknown as ScheduledTimer;
      timer.cleared = true;
      timers.delete(timer.id);
    },
  };

  function advanceTo(targetNow: number) {
    now = targetNow;

    while (true) {
      const dueTimers = Array.from(timers.values())
        .filter(timer => !timer.cleared && timer.dueAt <= now)
        .sort((left, right) => left.dueAt - right.dueAt);

      const nextTimer = dueTimers[0];
      if (!nextTimer) {
        break;
      }

      timers.delete(nextTimer.id);
      nextTimer.cleared = true;
      nextTimer.callback();
    }
  }

  return {
    runtime,
    advanceTo,
  };
}

describe("pulseScheduler", () => {
  it("clamps BPM to a safe range", () => {
    expect(clampPulseBpm(Number.NaN)).toBe(90);
    expect(clampPulseBpm(-10)).toBe(1);
    expect(clampPulseBpm(960)).toBe(600);
    expect(pulseIntervalMsFromBpm(120)).toBe(500);
  });

  it("compensates timer delays instead of accumulating drift", () => {
    const { runtime, advanceTo } = createTestRuntime();
    const pulses: PulseEvent[] = [];
    const scheduler = createPulseScheduler({
      receiverId: "receiver-a",
      bpm: 60,
      runtime,
      onPulse: event => pulses.push(event),
    });

    scheduler.start();

    advanceTo(1210);
    advanceTo(2055);
    advanceTo(3020);

    expect(pulses.map(pulse => pulse.timestamp)).toEqual([1210, 2055, 3020]);
    expect(pulses.map(pulse => pulse.sequence)).toEqual([0, 1, 2]);
  });

  it("restarts on BPM changes and stops cleanly", () => {
    const { runtime, advanceTo } = createTestRuntime();
    const pulses: PulseEvent[] = [];
    const scheduler = createPulseScheduler({
      receiverId: "receiver-a",
      bpm: 60,
      runtime,
      onPulse: event => pulses.push(event),
    });

    scheduler.start();
    advanceTo(1000);

    scheduler.updateBpm(120);
    advanceTo(1499);
    expect(pulses).toHaveLength(1);

    advanceTo(1500);
    expect(pulses.map(pulse => pulse.timestamp)).toEqual([1000, 1500]);
    expect(pulses[1]?.bpm).toBe(120);

    scheduler.stop();
    advanceTo(4000);
    expect(pulses).toHaveLength(2);
  });
});
