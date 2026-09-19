import { alignmentElementLength, getAlignmentElements } from '../cadAlignmentElements';
import {
  cadAlignmentDisplayStationToRawStation,
  getAlignmentStartStation,
} from '../cadAlignmentStationing';
import type { CadAlignmentElement, CadAlignmentEntity } from '../cadTypes';
import type { SectionErrorCode } from './sectionTypes';

export type RawStationResult =
  | { ok: true; rawStation: number }
  | { ok: false; code: Extract<SectionErrorCode, 'OUT_OF_RANGE'> };

type StationedAlignment =
  | Pick<CadAlignmentEntity, 'elements' | 'startStation' | 'stationEquations'>
  | readonly CadAlignmentElement[];

/**
 * Display input resolves to RAW via the stationing authority; anything
 * unresolvable (out of range, inside an equation gap) is fail-closed
 * OUT_OF_RANGE — never clamped. RAW station is what persists.
 */
export const resolveSampleRawStation = (
  alignment: StationedAlignment,
  displayStation: number,
): RawStationResult => {
  const raw = cadAlignmentDisplayStationToRawStation(alignment, displayStation);
  return raw == null ? { ok: false, code: 'OUT_OF_RANGE' } : { ok: true, rawStation: raw };
};

/** RAW-range guard for a persisted raw station (no clamp). */
export const validateSampleRawStation = (
  alignment: StationedAlignment,
  rawStation: number,
): RawStationResult => {
  if (!Number.isFinite(rawStation)) return { ok: false, code: 'OUT_OF_RANGE' };
  const elements = getAlignmentElements(alignment);
  const start = getAlignmentStartStation(alignment);
  const total = elements.reduce((sum, element) => sum + alignmentElementLength(element), 0);
  if (rawStation < start - 1e-9 || rawStation > start + total + 1e-9) {
    return { ok: false, code: 'OUT_OF_RANGE' };
  }
  return { ok: true, rawStation };
};

export interface RawStationIntervalOptions {
  interval: number;
  includeStart?: boolean;
  includeEnd?: boolean;
}

/**
 * Interval generation increments PHYSICAL RAW chainage
 * (rawStart + k*interval), following STA INT include-start/include-end
 * semantics. No equation or display math participates.
 */
export const buildSectionRawStations = (
  rawStart: number,
  rawEnd: number,
  options: RawStationIntervalOptions,
): number[] => {
  const { interval } = options;
  const includeStart = options.includeStart ?? true;
  const includeEnd = options.includeEnd ?? true;
  if (
    !Number.isFinite(rawStart) ||
    !Number.isFinite(rawEnd) ||
    !Number.isFinite(interval) ||
    interval <= 0 ||
    rawEnd < rawStart - 1e-9
  ) {
    return [];
  }
  const stations: number[] = [];
  if (includeStart) stations.push(rawStart);
  let next = rawStart + interval;
  while (next < rawEnd - 1e-9) {
    stations.push(next);
    next += interval;
  }
  if (includeEnd && (stations.length === 0 || Math.abs(stations[stations.length - 1]! - rawEnd) > 1e-9)) {
    stations.push(rawEnd);
  }
  return stations;
};
