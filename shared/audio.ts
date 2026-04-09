export const MIN_VOLUME_DB = -60;
export const MAX_VOLUME_DB = 0;

export function clampVolumeValue(value: number) {
  if (Number.isNaN(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

export function volumeValueToGain(value: number) {
  const clamped = clampVolumeValue(value);
  if (clamped <= 0) {
    return 0;
  }

  const decibels = MIN_VOLUME_DB + (MAX_VOLUME_DB - MIN_VOLUME_DB) * clamped;
  return Math.pow(10, decibels / 20);
}

export function volumeValueToPercent(value: number) {
  return Math.round(clampVolumeValue(value) * 100);
}
