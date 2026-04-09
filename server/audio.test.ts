import { describe, expect, it } from "vitest";
import {
  clampVolumeValue,
  MAX_VOLUME_DB,
  MIN_VOLUME_DB,
  volumeValueToGain,
  volumeValueToPercent,
} from "../shared/audio";

describe("shared audio helpers", () => {
  it("clamps receiver volume values into the supported range", () => {
    expect(clampVolumeValue(-1)).toBe(0);
    expect(clampVolumeValue(0.42)).toBe(0.42);
    expect(clampVolumeValue(4)).toBe(1);
  });

  it("maps normalized values logarithmically to gain", () => {
    expect(MIN_VOLUME_DB).toBe(-60);
    expect(MAX_VOLUME_DB).toBe(0);
    expect(volumeValueToGain(0)).toBe(0);
    expect(volumeValueToGain(1)).toBeCloseTo(1, 6);
    expect(volumeValueToGain(0.5)).toBeCloseTo(Math.pow(10, -30 / 20), 6);
  });

  it("formats percentage labels from normalized values", () => {
    expect(volumeValueToPercent(0)).toBe(0);
    expect(volumeValueToPercent(0.376)).toBe(38);
    expect(volumeValueToPercent(1)).toBe(100);
  });
});
