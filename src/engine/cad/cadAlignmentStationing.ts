import { cadDistance, cadSignedSweepDeg } from './cadGeometry';
import type { CadAlignmentElement, CadAlignmentEntity, CadStationEquation } from './cadTypes';

interface CadResolvedStationEquation extends CadStationEquation {
  rawStation: number;
  deltaBefore: number;
  deltaAfter: number;
}

const isAlignmentElementArray = (
  alignment: Pick<CadAlignmentEntity, 'elements'> | Pick<CadAlignmentEntity, 'elements' | 'startStation'> | readonly CadAlignmentElement[],
): alignment is readonly CadAlignmentElement[] => Array.isArray(alignment);

const alignmentElementLength = (element: CadAlignmentElement): number =>
  element.kind === 'line'
    ? cadDistance(element.start, element.end)
    : (Math.abs(cadSignedSweepDeg(element.startAngleDeg, element.endAngleDeg)) * Math.PI * element.radius) / 180;

const getAlignmentElements = (
  alignment: Pick<CadAlignmentEntity, 'elements'> | Pick<CadAlignmentEntity, 'elements' | 'startStation'> | readonly CadAlignmentElement[],
): readonly CadAlignmentElement[] => (isAlignmentElementArray(alignment) ? alignment : alignment.elements);

export const cadAlignmentLength = (alignment: Pick<CadAlignmentEntity, 'elements'> | readonly CadAlignmentElement[]): number => {
  const elements = getAlignmentElements(alignment);
  return elements.reduce(
    (total: number, element: CadAlignmentElement) => total + alignmentElementLength(element),
    0,
  );
};

export const getAlignmentStartStation = (
  alignment: Pick<CadAlignmentEntity, 'elements'> | Pick<CadAlignmentEntity, 'elements' | 'startStation'> | readonly CadAlignmentElement[],
): number => (!isAlignmentElementArray(alignment) && 'startStation' in alignment ? alignment.startStation : 0);

const getAlignmentStationEquations = (
  alignment:
    | Pick<CadAlignmentEntity, 'elements' | 'startStation' | 'stationEquations'>
    | readonly CadAlignmentElement[],
): readonly CadStationEquation[] =>
  !isAlignmentElementArray(alignment) && 'stationEquations' in alignment && Array.isArray(alignment.stationEquations)
    ? alignment.stationEquations
    : [];

const resolveAlignmentStationEquations = (
  alignment:
    | Pick<CadAlignmentEntity, 'elements' | 'startStation' | 'stationEquations'>
    | readonly CadAlignmentElement[],
): CadResolvedStationEquation[] | null => {
  const startStation = getAlignmentStartStation(alignment);
  const endRawStation = startStation + cadAlignmentLength(getAlignmentElements(alignment));
  const equations = [...getAlignmentStationEquations(alignment)];
  if (equations.length === 0) return [];

  const resolved: CadResolvedStationEquation[] = [];
  let deltaBefore = 0;
  let previousRawStation = startStation;
  for (const equation of equations) {
    if (!Number.isFinite(equation.backStation) || !Number.isFinite(equation.aheadStation)) {
      return null;
    }
    const rawStation = equation.rawStation ?? equation.backStation - deltaBefore;
    if (
      !Number.isFinite(rawStation) ||
      rawStation < startStation - 1e-9 ||
      rawStation > endRawStation + 1e-9 ||
      rawStation < previousRawStation - 1e-9
    ) {
      return null;
    }
    const deltaAfter = deltaBefore + (equation.aheadStation - equation.backStation);
    resolved.push({
      ...equation,
      rawStation,
      deltaBefore,
      deltaAfter,
    });
    deltaBefore = deltaAfter;
    previousRawStation = rawStation;
  }
  return resolved;
};

export const cadAlignmentEndStation = (
  alignment:
    | Pick<CadAlignmentEntity, 'elements' | 'startStation' | 'stationEquations'>
    | readonly CadAlignmentElement[],
): number | null => {
  const startStation = getAlignmentStartStation(alignment);
  const totalLength = cadAlignmentLength(getAlignmentElements(alignment));
  const resolvedEquations = resolveAlignmentStationEquations(alignment);
  if (resolvedEquations == null) return null;
  const deltaAfter = resolvedEquations[resolvedEquations.length - 1]?.deltaAfter ?? 0;
  return startStation + totalLength + deltaAfter;
};

export const formatCadStation = (station: number): string => {
  if (!Number.isFinite(station)) return 'NaN';
  const sign = station < 0 ? '-' : '';
  const absoluteStation = Math.abs(station);
  const major = Math.floor(absoluteStation / 100);
  const minor = absoluteStation - major * 100;
  return `${sign}${major}+${minor.toFixed(3).padStart(6, '0')}`;
};

export const cadAlignmentRawStationToDisplayStation = (
  alignment:
    | Pick<CadAlignmentEntity, 'elements' | 'startStation' | 'stationEquations'>
    | readonly CadAlignmentElement[],
  rawStation: number,
): number | null => {
  if (!Number.isFinite(rawStation)) return null;
  const startStation = getAlignmentStartStation(alignment);
  const endRawStation = startStation + cadAlignmentLength(getAlignmentElements(alignment));
  if (rawStation < startStation - 1e-9 || rawStation > endRawStation + 1e-9) return null;
  const resolvedEquations = resolveAlignmentStationEquations(alignment);
  if (resolvedEquations == null) return null;

  let delta = 0;
  for (const equation of resolvedEquations) {
    if (rawStation < equation.rawStation - 1e-9) {
      return rawStation + delta;
    }
    if (Math.abs(rawStation - equation.rawStation) <= 1e-9) {
      return equation.aheadStation;
    }
    delta = equation.deltaAfter;
  }
  return rawStation + delta;
};

export const cadAlignmentDisplayStationToRawStation = (
  alignment:
    | Pick<CadAlignmentEntity, 'elements' | 'startStation' | 'stationEquations'>
    | readonly CadAlignmentElement[],
  station: number,
): number | null => {
  if (!Number.isFinite(station)) return null;
  const startStation = getAlignmentStartStation(alignment);
  const endRawStation = startStation + cadAlignmentLength(getAlignmentElements(alignment));
  const resolvedEquations = resolveAlignmentStationEquations(alignment);
  if (resolvedEquations == null) return null;

  let delta = 0;
  let displayStart = startStation;
  for (const equation of resolvedEquations) {
    if (station >= displayStart - 1e-9 && station <= equation.backStation + 1e-9) {
      return Math.max(startStation, Math.min(endRawStation, station - delta));
    }
    if (station > equation.backStation + 1e-9 && station < equation.aheadStation - 1e-9) {
      return null;
    }
    if (Math.abs(station - equation.aheadStation) <= 1e-9) {
      return equation.rawStation;
    }
    delta = equation.deltaAfter;
    displayStart = equation.aheadStation;
  }

  const endDisplayStation = endRawStation + delta;
  if (station < displayStart - 1e-9 || station > endDisplayStation + 1e-9) return null;
  return Math.max(startStation, Math.min(endRawStation, station - delta));
};
