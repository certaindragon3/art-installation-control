import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMING_TARGET_CENTER,
  DEFAULT_TIMING_TOLERANCE,
  evaluateTimingPress,
} from "./wsTypes";

describe("timing helpers", () => {
  it("evaluates pulse-synced presses at the tolerance boundary as hits", () => {
    expect(
      evaluateTimingPress({
        pulseEnabled: true,
        pulseEvent: {
          intervalMs: 1_000,
          sequence: 4,
          timestamp: 1_000,
        },
        nowMs: 1_580,
        targetCenter: DEFAULT_TIMING_TARGET_CENTER,
        timingTolerance: DEFAULT_TIMING_TOLERANCE,
      })
    ).toMatchObject({
      timing: true,
      timingValue: 0.58,
      targetCenter: 0.5,
      timingTolerance: 0.08,
      delta: 0.08,
      pulseSequence: 4,
      pulseIntervalMs: 1_000,
      pulseActive: true,
    });
  });

  it("marks presses just outside the tolerance window as misses", () => {
    expect(
      evaluateTimingPress({
        pulseEnabled: true,
        pulseEvent: {
          intervalMs: 1_000,
          sequence: 7,
          timestamp: 2_000,
        },
        nowMs: 2_581,
        targetCenter: 0.5,
        timingTolerance: 0.08,
      })
    ).toMatchObject({
      timing: false,
      timingValue: 0.581,
      delta: 0.08099999999999996,
      pulseSequence: 7,
      pulseActive: true,
    });
  });

  it("falls back to the config timing value when pulse is inactive", () => {
    expect(
      evaluateTimingPress({
        pulseEnabled: false,
        pulseEvent: null,
        nowMs: 5_000,
        timingValue: 0.2,
        targetCenter: 0.5,
        timingTolerance: 0.08,
      })
    ).toMatchObject({
      timing: false,
      timingValue: 0.2,
      targetCenter: 0.5,
      timingTolerance: 0.08,
      delta: 0.3,
      pulseSequence: null,
      pulseIntervalMs: null,
      pulseActive: false,
    });
  });

  it("keeps looping across multiple beat intervals instead of sticking at 1", () => {
    expect(
      evaluateTimingPress({
        pulseEnabled: true,
        pulseEvent: {
          intervalMs: 1_000,
          sequence: 12,
          timestamp: 3_000,
        },
        nowMs: 5_350,
        targetCenter: 0.5,
        timingTolerance: 0.08,
      })
    ).toMatchObject({
      timingValue: 0.35,
      pulseSequence: 12,
      pulseIntervalMs: 1_000,
      pulseActive: true,
    });
  });
});
