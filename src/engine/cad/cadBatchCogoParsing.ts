import {
  cadParseBearingDegrees,
  cadParseDmsDegrees,
  cadPointFromAzimuthDistance,
  type CadNamedPoint,
} from './cadGeometry';
import { cadPointFromBearingDistance, formatCadBearing } from './cadCogo';
import type { CadBatchParsedCurve, CadBatchParsedLine } from './cadBatchCogoTypes';

const isNumeric = (value: string): boolean => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  return Number.isFinite(Number(trimmed));
};

const splitLabelFromBody = (token: string): { label?: string; body: string } => {
  const normalized = token.trim();
  const labelIndex = normalized.indexOf('=');
  if (labelIndex < 0) return { body: normalized };
  return {
    label: normalized.slice(0, labelIndex).trim() || undefined,
    body: normalized.slice(labelIndex + 1).trim(),
  };
};

export const parseAbsolutePoint = (token: string): CadNamedPoint | null => {
  const { label, body } = splitLabelFromBody(token);
  const parts = body.split(',').map((part) => part.trim());
  if (parts.length !== 2 || !isNumeric(parts[0] ?? '') || !isNumeric(parts[1] ?? '')) return null;
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  return {
    x,
    y,
    label: label ?? `${x.toFixed(3)},${y.toFixed(3)}`,
  };
};

const normalizeAutoPointLabel = (sequence: number): string => `P${sequence}`;

export const nextAvailableAutoPointLabel = (
  usedLabels: Set<string>,
  nextSequence: number,
): { label: string; nextSequence: number } => {
  let sequence = nextSequence;
  let label = normalizeAutoPointLabel(sequence);
  while (usedLabels.has(label.toUpperCase())) {
    sequence += 1;
    label = normalizeAutoPointLabel(sequence);
  }
  usedLabels.add(label.toUpperCase());
  return {
    label,
    nextSequence: sequence + 1,
  };
};

export const parseBearingDistance = (
  token: string,
  basePoint: CadNamedPoint,
): CadBatchParsedLine | null => {
  const { label, body } = splitLabelFromBody(token);
  const trimmed = body.trim();
  if (trimmed.length === 0) return null;

  if (trimmed.startsWith('@')) {
    const parts = trimmed.slice(1).split(',').map((part) => part.trim());
    if (parts.length !== 2 || !isNumeric(parts[0] ?? '') || !isNumeric(parts[1] ?? '')) return null;
    const azimuthDeg = Number(parts[0]);
    const distance = Number(parts[1]);
    if (!Number.isFinite(distance) || distance <= 0) return null;
    const point = cadPointFromAzimuthDistance(basePoint, azimuthDeg, distance);
    return {
      point: {
        ...point,
        label: label ?? `${trimmed}`,
      },
      bearing: formatCadBearing(((azimuthDeg % 360) + 360) % 360),
      distance,
    };
  }

  const commaParts = trimmed.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
  if (commaParts.length === 2 && isNumeric(commaParts[1] ?? '')) {
    const distance = Number(commaParts[1]);
    const point = cadPointFromBearingDistance(basePoint, commaParts[0] ?? '', distance);
    if (!point || distance <= 0) return null;
    return {
      point: {
        ...point,
        label: label ?? `${commaParts[0]},${distance}`,
      },
      bearing: commaParts[0]!,
      distance,
    };
  }

  const match = /^(.+?)\s+([-+]?\d*\.?\d+)\s*$/.exec(trimmed);
  if (!match) return null;
  const bearingToken = (match[1] ?? '').trim();
  const distance = Number(match[2]);
  if (cadParseBearingDegrees(bearingToken) == null || !Number.isFinite(distance) || distance <= 0) {
    return null;
  }
  const point = cadPointFromBearingDistance(basePoint, bearingToken, distance);
  if (!point) return null;
  return {
    point: {
      ...point,
      label: label ?? `${bearingToken} ${distance}`,
    },
    bearing: bearingToken,
    distance,
  };
};

export const parseCurveCall = (token: string): CadBatchParsedCurve | null => {
  const { label, body } = splitLabelFromBody(token);
  const normalized = body.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const match = /^CURVE\s+(LEFT|RIGHT|L|R)\s+(?:R(?:ADIUS)?=?\s*)?([-+]?\d*\.?\d+)\s+(?:DELTA|D)\s*=?\s*(.+)$/i.exec(
    normalized,
  );
  if (!match) return null;
  const radius = Number(match[2]);
  const deltaDeg = cadParseDmsDegrees((match[3] ?? '').trim());
  if (!Number.isFinite(radius) || radius <= 0 || deltaDeg == null || deltaDeg <= 0) return null;
  return {
    label,
    side: /^(LEFT|L)$/i.test(match[1] ?? '') ? 'left' : 'right',
    radius,
    deltaDeg,
  };
};
