import { DEG_TO_RAD, RAD_TO_DEG, dmsToRad, radToDmsStr } from './angles';
import type { ImportedObservationRecord } from './importers';

export const prettifyToken = (value: string): string =>
  value
    .replace(/-/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

export const formatLinear = (value: number): string => value.toFixed(4);
export const formatLinear3 = (value: number): string => value.toFixed(3);

export const formatAngleDms = (valueDeg: number): string => radToDmsStr(valueDeg * DEG_TO_RAD);
export const formatFromToToken = (fromId: string, toId: string): string => `${fromId}-${toId}`;

export const splitOverrideLines = (value: string | undefined): string[] =>
  value
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0) ?? [];

export const compareImportTokens = (left: string | undefined, right: string | undefined): number =>
  (left ?? '').localeCompare(right ?? '', undefined, { numeric: true, sensitivity: 'base' });

export const deriveObservationSetupId = (observation: ImportedObservationRecord): string => {
  if (observation.kind === 'measurement' || observation.kind === 'angle') return observation.atId;
  return observation.fromId;
};

export const isResectionSetupType = (value: string | undefined): boolean =>
  /resection/i.test((value ?? '').trim());

export const normalizeFaceLabel = (value: string | undefined): string | null => {
  const normalized = (value ?? '').trim().toUpperCase();
  if (normalized === 'FACE1') return 'F1';
  if (normalized === 'FACE2') return 'F2';
  return normalized ? prettifyToken(normalized) : null;
};

export type DirectionFaceBucket = 'face1' | 'face2' | 'unresolved';

export const normalizeDirectionFace = (value: string | undefined): DirectionFaceBucket => {
  const normalized = (value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (normalized === 'FACE1' || normalized === 'F1' || normalized === '1') return 'face1';
  if (normalized === 'FACE2' || normalized === 'F2' || normalized === '2') return 'face2';
  return 'unresolved';
};

export const inferDirectionFaceFromZenithDeg = (
  zenithDeg: number | undefined,
  windowDeg = 45,
): DirectionFaceBucket => {
  if (!Number.isFinite(zenithDeg as number)) return 'unresolved';
  const wrapped = ((((zenithDeg as number) % 360) + 360) % 360) as number;
  const distanceTo = (center: number): number => {
    let delta = Math.abs(wrapped - center) % 360;
    if (delta > 180) delta = 360 - delta;
    return delta;
  };
  const dFace1 = distanceTo(90);
  const dFace2 = distanceTo(270);
  if (dFace1 <= windowDeg && dFace2 > windowDeg) return 'face1';
  if (dFace2 <= windowDeg && dFace1 > windowDeg) return 'face2';
  return 'unresolved';
};

export const normalizeDirectionAngleDeg = (valueDeg: number): number => {
  const wrapped = ((valueDeg % 360) + 360) % 360;
  return wrapped === 360 ? 0 : wrapped;
};

export const parseDirectionAngleTokenDeg = (token: string | undefined): number | undefined => {
  const trimmed = token?.trim();
  if (!trimmed) return undefined;
  const dmsValue = dmsToRad(trimmed) * RAD_TO_DEG;
  if (Number.isFinite(dmsValue)) return normalizeDirectionAngleDeg(dmsValue);
  const numericValue = Number.parseFloat(trimmed);
  if (Number.isFinite(numericValue)) return normalizeDirectionAngleDeg(numericValue);
  return undefined;
};

export const parseDirectionLineTarget = (line: string): string | undefined => {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 3) return undefined;
  const code = tokens[0]?.toUpperCase();
  if (code !== 'DN' && code !== 'DM') return undefined;
  return tokens[1];
};

export const parseDirectionFaceHintToken = (token: string | undefined): DirectionFaceBucket | null => {
  const raw = token?.trim();
  if (!raw) return null;
  let normalized = raw.toUpperCase().replace(/[^A-Z0-9=]/g, '');
  if (!normalized) return null;
  if (normalized.startsWith('FACE=')) normalized = normalized.slice(5);
  if (normalized.startsWith('FACE')) normalized = normalized.slice(4);
  if (normalized === 'F1') normalized = '1';
  if (normalized === 'F2') normalized = '2';
  if (normalized === '1') return 'face1';
  if (normalized === '2') return 'face2';
  return null;
};

export const appendDirectionLineFaceHint = (line: string, face: DirectionFaceBucket): string => {
  if (face === 'unresolved') return line;
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 3) return line;
  const code = tokens[0]?.toUpperCase();
  if (code !== 'DN' && code !== 'DM') return line;
  if (tokens.some((token) => parseDirectionFaceHintToken(token) != null)) return line;
  tokens.push(face === 'face1' ? 'F1' : 'F2');
  return tokens.join(' ');
};

export const normalizeDirectionLineFace2ToFace1 = (line: string): string | null => {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 3) return null;
  const code = tokens[0]?.toUpperCase();
  if (code !== 'DN' && code !== 'DM') return null;
  const angleDeg = parseDirectionAngleTokenDeg(tokens[2]);
  if (!Number.isFinite(angleDeg as number)) return null;
  tokens[2] = formatAngleDms(normalizeDirectionAngleDeg((angleDeg as number) - 180));
  return tokens.join(' ');
};
