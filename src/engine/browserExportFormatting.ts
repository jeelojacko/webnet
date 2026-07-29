import { RAD_TO_DEG } from './angles';

export const FT_PER_M = 3.280839895;

export const csvEscape = (value: string): string => {
  if (value.length === 0) return '';
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
};

export const csvRow = (values: Array<string | number | boolean | null | undefined>): string =>
  values
    .map((value) => {
      if (value == null) return '';
      if (typeof value === 'boolean') return value ? 'true' : 'false';
      return csvEscape(String(value));
    })
    .join(',');

export const formatNumber = (value: number | null | undefined, digits: number): string => {
  if (value == null || !Number.isFinite(value)) return '';
  const normalized = Math.abs(value) < 5e-13 ? 0 : value;
  return normalized.toFixed(digits);
};

export const formatLinear = (value: number | null | undefined, unitScale: number): string =>
  formatNumber(value == null ? null : value * unitScale, 4);

export const formatDegrees = (value: number | null | undefined): string =>
  formatNumber(value == null ? null : value * RAD_TO_DEG, 8);

export const formatArcSeconds = (value: number | null | undefined): string =>
  formatNumber(value == null ? null : value * RAD_TO_DEG * 3600, 3);
