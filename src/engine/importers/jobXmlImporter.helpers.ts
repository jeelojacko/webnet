import { RAD_TO_DEG } from '../angles';
import type { ImportedControlStationRecord } from '../importers';
import {
  collapseWhitespace,
  decodeXmlEntities,
  extractXmlNumber,
  extractXmlText,
  matchXmlBlocks,
  sanitizeStationId,
} from './shared';
import type { JobXmlBacksightContext, JobXmlRoundEvent } from './jobXmlImporter.types';

export const registerJobXmlPointReference = (
  lookup: Map<string, string>,
  rawRef: string | undefined,
  stationId: string,
): void => {
  if (!rawRef) return;
  const normalized = collapseWhitespace(decodeXmlEntities(rawRef));
  if (!normalized) return;
  if (!lookup.has(normalized)) lookup.set(normalized, stationId);
  const sanitized = sanitizeStationId(normalized);
  if (sanitized && !lookup.has(sanitized)) lookup.set(sanitized, stationId);
};

export const resolveJobXmlPointReference = (
  rawRef: string | undefined,
  lookup: Map<string, string>,
  knownStations: Map<string, ImportedControlStationRecord>,
  allowSanitizedFallback: boolean,
): string | undefined => {
  if (!rawRef) return undefined;
  const normalized = collapseWhitespace(decodeXmlEntities(rawRef));
  if (!normalized) return undefined;
  const direct = lookup.get(normalized) ?? lookup.get(sanitizeStationId(normalized));
  if (direct) return direct;
  const sanitized = sanitizeStationId(normalized);
  if (knownStations.has(sanitized) || allowSanitizedFallback) return sanitized;
  return undefined;
};

export const resolveJobXmlPointFromBlock = (
  block: string,
  refTagNames: string[],
  nameTagNames: string[],
  lookup: Map<string, string>,
  knownStations: Map<string, ImportedControlStationRecord>,
): string | undefined => {
  for (const tagName of refTagNames) {
    const resolved = resolveJobXmlPointReference(
      extractXmlText(block, [tagName]),
      lookup,
      knownStations,
      false,
    );
    if (resolved) return resolved;
  }
  for (const tagName of nameTagNames) {
    const resolved = resolveJobXmlPointReference(
      extractXmlText(block, [tagName]),
      lookup,
      knownStations,
      true,
    );
    if (resolved) return resolved;
  }
  return undefined;
};

export const normalizeJobXmlAngleDeg = (value: number): number => {
  const wrapped = ((value % 360) + 360) % 360;
  return wrapped === 360 ? 0 : wrapped;
};

export const collectJobXmlRoundEvents = (input: string): JobXmlRoundEvent[] =>
  [
    ...matchXmlBlocks(input, 'StartRoundRecord').map(({ block, index }) => ({
      index,
      kind: 'start' as const,
      round: extractXmlNumber(block, ['Round']),
    })),
    ...matchXmlBlocks(input, 'EndRoundRecord').map(({ index }) => ({
      index,
      kind: 'end' as const,
    })),
    ...matchXmlBlocks(input, 'StationRecord').map(({ index }) => ({
      index,
      kind: 'reset' as const,
    })),
  ].sort((left, right) => left.index - right.index);

export const correctJobXmlSlopeDistance = (
  rawDistanceM: number | undefined,
  ppm: number | undefined,
  prismConstantM: number | undefined,
): number | undefined => {
  if (rawDistanceM == null) return undefined;
  return rawDistanceM * (1 + (ppm ?? 0) / 1_000_000) + (prismConstantM ?? 0);
};

export const computeLocalAzimuthDeg = (
  fromStation: ImportedControlStationRecord | undefined,
  toStation: ImportedControlStationRecord | undefined,
): number | undefined => {
  if (
    !fromStation ||
    !toStation ||
    fromStation.coordinateMode !== 'local' ||
    toStation.coordinateMode !== 'local' ||
    fromStation.eastM == null ||
    fromStation.northM == null ||
    toStation.eastM == null ||
    toStation.northM == null
  ) {
    return undefined;
  }
  const deltaEast = toStation.eastM - fromStation.eastM;
  const deltaNorth = toStation.northM - fromStation.northM;
  if (Math.abs(deltaEast) < 1e-12 && Math.abs(deltaNorth) < 1e-12) return undefined;
  return normalizeJobXmlAngleDeg(Math.atan2(deltaEast, deltaNorth) * RAD_TO_DEG);
};

export const pickJobXmlBacksightCircleDeg = (
  backsightContext: JobXmlBacksightContext | undefined,
  faceText: string | undefined,
): number | undefined => {
  if (!backsightContext) return undefined;
  const face = collapseWhitespace(faceText ?? '').toUpperCase();
  if (face === 'FACE1') {
    return backsightContext.face1HorizontalCircleDeg ?? backsightContext.horizontalCircleDeg;
  }
  if (face === 'FACE2') {
    return backsightContext.face2HorizontalCircleDeg ?? backsightContext.horizontalCircleDeg;
  }
  return backsightContext.horizontalCircleDeg;
};
