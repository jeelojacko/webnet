import { RAD_TO_DEG, dmsToRad } from '../engine/angles';

export const parseTransformAngleInput = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const dmsPattern = /^[+-]?\d{1,3}-\d{1,2}-\d{1,2}(?:\.\d+)?$/;
  if (dmsPattern.test(trimmed)) {
    const body = trimmed.replace(/^[+-]/, '');
    const parts = body.split('-');
    if (parts.length !== 3) return null;
    const degrees = Number.parseInt(parts[0], 10);
    const minutes = Number.parseInt(parts[1], 10);
    const seconds = Number.parseFloat(parts[2]);
    if (
      !Number.isFinite(degrees) ||
      !Number.isFinite(minutes) ||
      !Number.isFinite(seconds) ||
      minutes < 0 ||
      minutes >= 60 ||
      seconds < 0 ||
      seconds >= 60
    ) {
      return null;
    }
    const rad = dmsToRad(trimmed);
    if (!Number.isFinite(rad)) return null;
    return rad * RAD_TO_DEG;
  }
  const decimalPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
  if (!decimalPattern.test(trimmed)) return null;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};
