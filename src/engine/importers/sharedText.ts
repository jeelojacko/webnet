import { RAD_TO_DEG, dmsToRad } from '../angles';

export const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

export const extractLineValue = (input: string, label: string): string | undefined => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = input.match(new RegExp(`^\\s*${escaped}\\s*:\\s*(.+)$`, 'im'));
  return match?.[1] ? collapseWhitespace(match[1]) : undefined;
};

export const extractFirstLine = (
  input: string,
  predicate: (_line: string) => boolean,
): string | undefined =>
  input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && predicate(line));

export const extractNumbers = (line: string): number[] =>
  [...line.matchAll(/[+-]?\d+(?:\.\d+)?/g)].map((match) => Number.parseFloat(match[0]));

export const parseLatitudeLine = (
  line: string | undefined,
): { value: number; sigmaM?: number } | null => {
  if (!line) return null;
  const numbers = extractNumbers(line);
  if (numbers.length < 3) return null;
  const sign = /\bS\s*LAT\b/i.test(line) ? -1 : 1;
  return {
    value: dmsToDecimal(numbers[0], numbers[1] ?? 0, numbers[2] ?? 0, sign),
    sigmaM: numbers[3],
  };
};

export const parseLongitudeLine = (
  line: string | undefined,
): { value: number; sigmaM?: number } | null => {
  if (!line) return null;
  const numbers = extractNumbers(line);
  if (numbers.length < 3) return null;
  const sign = /\bW\s*LON\b/i.test(line) ? -1 : 1;
  return {
    value: dmsToDecimal(numbers[0], numbers[1] ?? 0, numbers[2] ?? 0, sign),
    sigmaM: numbers[3],
  };
};

export const parseHeightLine = (
  line: string | undefined,
): { value: number; sigmaM?: number } | null => {
  if (!line) return null;
  const numbers = extractNumbers(line);
  if (numbers.length < 1) return null;
  return {
    value: numbers[0],
    sigmaM: numbers[1],
  };
};

export const parseCorrelationLine = (line: string | undefined): number | undefined => {
  if (!line) return undefined;
  const numbers = [...line.matchAll(/[+-]?\d+(?:\.\d+)?/g)].map((match) =>
    Number.parseFloat(match[0]),
  );
  const value = numbers.find((entry) => Number.isFinite(entry) && Math.abs(entry) <= 1);
  if (!Number.isFinite(value as number)) return undefined;
  return Math.max(-0.999, Math.min(0.999, value as number));
};

export const sanitizeStationId = (value: string): string => {
  const sanitized = value
    .toUpperCase()
    .replace(/\.[A-Z0-9]+$/i, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return sanitized || 'IMPORT_STATION';
};

export const deriveStationId = (
  sourceFile: string | undefined,
  reportFileName: string | undefined,
): string => {
  const preferred = sourceFile
    ? fileStem(sourceFile)
    : reportFileName
      ? fileStem(reportFileName)
      : '';
  return sanitizeStationId(preferred);
};

export const formatNumber = (value: number, decimals: number): string => value.toFixed(decimals);

export const decodeXmlEntities = (value: string): string =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

export type LineNumberResolver = (_index: number) => number;

export const buildLineNumberResolver = (input: string): LineNumberResolver => {
  const newlineIndices: number[] = [];
  for (let idx = input.indexOf('\n'); idx !== -1; idx = input.indexOf('\n', idx + 1)) {
    newlineIndices.push(idx);
  }
  return (index: number): number => {
    const clamped = Math.max(0, Math.min(index, input.length));
    let lo = 0;
    let hi = newlineIndices.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (newlineIndices[mid] < clamped) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };
};

export const takeLeadingLines = (input: string, maxLines: number): string[] => {
  if (maxLines <= 0) return [];
  const lines: string[] = [];
  let start = 0;
  while (start <= input.length && lines.length < maxLines) {
    let end = input.indexOf('\n', start);
    if (end === -1) end = input.length;
    let line = input.slice(start, end);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    lines.push(line);
    if (end === input.length) break;
    start = end + 1;
  }
  return lines;
};

export const plural = (count: number, label: string): string =>
  `${count} ${label}${count === 1 ? '' : 's'}`;

export const sourceLeaf = (sourceName?: string): string =>
  sourceName?.replace(/\\/g, '/').split('/').pop() ?? 'imported file';

export const parseDmsAngleDegrees = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const normalized = trimmed
    .replace(/[°º]/g, '-')
    .replace(/'/g, '-')
    .replace(/"/g, '')
    .replace(/\s+/g, '');
  const parsed = dmsToRad(normalized) * RAD_TO_DEG;
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const parseQuadrantBearingDegrees = (value: string): number | undefined => {
  const trimmed = value.trim().toUpperCase().replace(/\s+/g, '');
  const quadrantMatch = trimmed.match(/^([NS])(.+)([EW])$/);
  if (!quadrantMatch) return parseDmsAngleDegrees(trimmed);
  const angleDeg = parseDmsAngleDegrees(quadrantMatch[2]);
  if (angleDeg == null) return undefined;
  if (quadrantMatch[1] === 'N' && quadrantMatch[3] === 'E') return angleDeg;
  if (quadrantMatch[1] === 'S' && quadrantMatch[3] === 'E') return 180 - angleDeg;
  if (quadrantMatch[1] === 'S' && quadrantMatch[3] === 'W') return 180 + angleDeg;
  if (quadrantMatch[1] === 'N' && quadrantMatch[3] === 'W') return 360 - angleDeg;
  return undefined;
};

export const normalizeImportedFace = (
  value: string | undefined,
): 'FACE1' | 'FACE2' | undefined => {
  if (!value) return undefined;
  const normalized = collapseWhitespace(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (normalized === 'FACE1' || normalized === 'F1' || normalized === '1') return 'FACE1';
  if (normalized === 'FACE2' || normalized === 'F2' || normalized === '2') return 'FACE2';
  return undefined;
};

const dmsToDecimal = (deg: number, min: number, sec: number, sign: number): number =>
  sign * (Math.abs(deg) + Math.abs(min) / 60 + Math.abs(sec) / 3600);

const fileStem = (value: string): string => {
  const normalized = value.replace(/\\/g, '/');
  const leaf = normalized.split('/').pop() ?? normalized;
  return leaf.replace(/\.[^.]+$/, '');
};
