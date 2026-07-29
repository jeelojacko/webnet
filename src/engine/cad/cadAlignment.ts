import {
  cadAngleDegFromCenter,
  cadClosestPointOnArc,
  cadClosestPointOnSegment,
  cadDistance,
  cadNormalizeAngleDeg,
  cadPointOnCircle,
  cadProjectPointOntoInfiniteLine,
  cadSignedSweepDeg,
} from './cadGeometry';
import type { CadAlignmentElement, CadAlignmentEntity, CadDisplayPoint, CadStationEquation } from './cadTypes';
import type {
  CadAlignmentProjection,
  CadAlignmentStationOffsetPoint,
  CadAlignmentStationPoint,
} from './cadAlignmentTypes';
import {
  alignmentElementEndPoint,
  alignmentElementLength,
  getAlignmentElements,
} from './cadAlignmentElements';

export { cadBuildAlignmentDraft } from './cadAlignmentDraft';
export { cadBuildOffsetAlignmentDraft } from './cadAlignmentOffset';
export {
  cadAlignmentDisplayStationToRawStation,
  cadAlignmentEndStation,
  cadAlignmentRawStationToDisplayStation,
  formatCadStation,
} from './cadAlignmentStationing';
export type {
  CadAlignmentDraft,
  CadAlignmentProjection,
  CadAlignmentSourceEntity,
  CadAlignmentStationOffsetPoint,
  CadAlignmentStationPoint,
} from './cadAlignmentTypes';
import { cadAlignmentDisplayStationToRawStation } from './cadAlignmentStationing';
import {
  cadAlignmentEndStation,
  cadAlignmentRawStationToDisplayStation,
  getAlignmentStartStation,
} from './cadAlignmentStationing';

export const cadAlignmentLength = (alignment: Pick<CadAlignmentEntity, 'elements'> | readonly CadAlignmentElement[]): number => {
  const elements = getAlignmentElements(alignment);
  return elements.reduce(
    (total: number, element: CadAlignmentElement) => total + alignmentElementLength(element),
    0,
  );
};

export const cadPointAtAlignmentStation = (
  alignment:
    | Pick<CadAlignmentEntity, 'elements' | 'startStation' | 'stationEquations'>
    | readonly CadAlignmentElement[],
  station: number,
): CadDisplayPoint | null => {
  const elements = getAlignmentElements(alignment);
  const startStation = getAlignmentStartStation(alignment);
  if (elements.length === 0) return null;
  const rawStation = cadAlignmentDisplayStationToRawStation(alignment, station);
  if (rawStation == null) return null;
  const localStation = rawStation - startStation;
  if (!Number.isFinite(localStation) || localStation < -1e-9) return null;

  let traversed = 0;
  for (const element of elements) {
    const elementLength = alignmentElementLength(element);
    const nextTraversed = traversed + elementLength;
    if (localStation <= nextTraversed + 1e-9) {
      const distanceAlong = Math.max(0, Math.min(elementLength, localStation - traversed));
      if (element.kind === 'line') {
        if (elementLength <= 1e-12) return element.start;
        const ratio = distanceAlong / elementLength;
        return {
          x: element.start.x + (element.end.x - element.start.x) * ratio,
          y: element.start.y + (element.end.y - element.start.y) * ratio,
        };
      }
      const sweepDeg = cadSignedSweepDeg(element.startAngleDeg, element.endAngleDeg);
      const direction = sweepDeg >= 0 ? 1 : -1;
      const deltaDeg = (distanceAlong / element.radius) * (180 / Math.PI) * direction;
      return cadPointOnCircle(
        element.center,
        element.radius,
        cadNormalizeAngleDeg(element.startAngleDeg + deltaDeg),
      );
    }
    traversed = nextTraversed;
  }
  if (Math.abs(localStation - traversed) <= 1e-9) {
    return alignmentElementEndPoint(elements[elements.length - 1]!);
  }
  return null;
};

export const cadPointAtAlignmentStationOffset = (
  alignment:
    | Pick<CadAlignmentEntity, 'elements' | 'startStation' | 'stationEquations'>
    | readonly CadAlignmentElement[],
  station: number,
  offset: number,
): CadAlignmentStationOffsetPoint | null => {
  const elements = getAlignmentElements(alignment);
  const startStation = getAlignmentStartStation(alignment);
  if (elements.length === 0 || !Number.isFinite(station) || !Number.isFinite(offset)) return null;

  const rawStation = cadAlignmentDisplayStationToRawStation(alignment, station);
  if (rawStation == null) return null;
  const localStation = rawStation - startStation;
  if (localStation < -1e-9) return null;

  let traversed = 0;
  for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
    const element = elements[elementIndex]!;
    const elementLength = alignmentElementLength(element);
    const nextTraversed = traversed + elementLength;
    if (localStation <= nextTraversed + 1e-9) {
      const distanceAlong = Math.max(0, Math.min(elementLength, localStation - traversed));
      if (element.kind === 'line') {
        if (elementLength <= 1e-12) return null;
        const ratio = distanceAlong / elementLength;
        const pointOnLine = {
          x: element.start.x + (element.end.x - element.start.x) * ratio,
          y: element.start.y + (element.end.y - element.start.y) * ratio,
        };
        const dx = element.end.x - element.start.x;
        const dy = element.end.y - element.start.y;
        const leftNormalX = -dy / elementLength;
        const leftNormalY = dx / elementLength;
        return {
          point: {
            x: pointOnLine.x + leftNormalX * offset,
            y: pointOnLine.y + leftNormalY * offset,
          },
          station,
          offset,
          elementIndex,
          elementKind: 'line',
        };
      }

      const sweepDeg = cadSignedSweepDeg(element.startAngleDeg, element.endAngleDeg);
      const direction = sweepDeg >= 0 ? 1 : -1;
      const deltaDeg = (distanceAlong / element.radius) * (180 / Math.PI) * direction;
      const angleDeg = cadNormalizeAngleDeg(element.startAngleDeg + deltaDeg);
      const radialDistance = sweepDeg >= 0 ? element.radius - offset : element.radius + offset;
      if (!Number.isFinite(radialDistance) || radialDistance < 0) return null;
      return {
        point: cadPointOnCircle(element.center, radialDistance, angleDeg),
        station,
        offset,
        elementIndex,
        elementKind: 'arc',
      };
    }
    traversed = nextTraversed;
  }

  if (Math.abs(localStation - traversed) <= 1e-9) {
    const lastElement = elements[elements.length - 1]!;
    if (lastElement.kind === 'line') {
      const elementLength = alignmentElementLength(lastElement);
      if (elementLength <= 1e-12) return null;
      const dx = lastElement.end.x - lastElement.start.x;
      const dy = lastElement.end.y - lastElement.start.y;
      const leftNormalX = -dy / elementLength;
      const leftNormalY = dx / elementLength;
      return {
        point: {
          x: lastElement.end.x + leftNormalX * offset,
          y: lastElement.end.y + leftNormalY * offset,
        },
        station,
        offset,
        elementIndex: elements.length - 1,
        elementKind: 'line',
      };
    }
    const sweepDeg = cadSignedSweepDeg(lastElement.startAngleDeg, lastElement.endAngleDeg);
    const radialDistance = sweepDeg >= 0 ? lastElement.radius - offset : lastElement.radius + offset;
    if (!Number.isFinite(radialDistance) || radialDistance < 0) return null;
    return {
      point: cadPointOnCircle(lastElement.center, radialDistance, lastElement.endAngleDeg),
      station,
      offset,
      elementIndex: elements.length - 1,
      elementKind: 'arc',
    };
  }

  return null;
};

const projectPointToLineElement = (
  element: Extract<CadAlignmentElement, { kind: 'line' }>,
  point: CadDisplayPoint,
  stationBase: number,
  elementIndex: number,
): CadAlignmentProjection => {
  const projected = cadProjectPointOntoInfiniteLine(point, element.start, element.end);
  const elementLength = alignmentElementLength(element);
  const clampedT = Math.max(0, Math.min(1, projected.t));
  const projectedPoint =
    clampedT === projected.t
      ? projected.point
      : cadClosestPointOnSegment(point, element.start, element.end);
  const dx = element.end.x - element.start.x;
  const dy = element.end.y - element.start.y;
  const projectedDistance = elementLength * clampedT;
  const cross = dx * (point.y - projectedPoint.y) - dy * (point.x - projectedPoint.x);

  return {
    point: projectedPoint,
    station: stationBase + projectedDistance,
    offset: Math.sign(cross) * cadDistance(point, projectedPoint),
    elementIndex,
    elementKind: 'line',
  };
};

const projectPointToArcElement = (
  element: Extract<CadAlignmentElement, { kind: 'arc' }>,
  point: CadDisplayPoint,
  stationBase: number,
  elementIndex: number,
): CadAlignmentProjection => {
  const projectedPoint = cadClosestPointOnArc(
    point,
    element.center,
    element.radius,
    element.startAngleDeg,
    element.endAngleDeg,
  );
  const sweepDeg = cadSignedSweepDeg(element.startAngleDeg, element.endAngleDeg);
  const pointAngleDeg = cadAngleDegFromCenter(element.center, projectedPoint);
  const deltaDeg =
    sweepDeg >= 0
      ? cadNormalizeAngleDeg(pointAngleDeg - element.startAngleDeg)
      : cadNormalizeAngleDeg(element.startAngleDeg - pointAngleDeg);
  const station = stationBase + (deltaDeg * Math.PI * element.radius) / 180;
  const radiusToPoint = cadDistance(element.center, point);
  const offset = sweepDeg >= 0 ? element.radius - radiusToPoint : radiusToPoint - element.radius;

  return {
    point: projectedPoint,
    station,
    offset,
    elementIndex,
    elementKind: 'arc',
  };
};

export const cadProjectPointToAlignment = (
  alignment:
    | Pick<CadAlignmentEntity, 'elements' | 'startStation' | 'stationEquations'>
    | readonly CadAlignmentElement[],
  point: CadDisplayPoint,
): CadAlignmentProjection | null => {
  const elements = getAlignmentElements(alignment);
  const startStation = getAlignmentStartStation(alignment);
  if (elements.length === 0) return null;

  let best: CadAlignmentProjection | null = null;
  let stationBase = startStation;
  for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
    const element = elements[elementIndex]!;
    const projection =
      element.kind === 'line'
        ? projectPointToLineElement(element, point, stationBase, elementIndex)
        : projectPointToArcElement(element, point, stationBase, elementIndex);
    if (best == null || cadDistance(point, projection.point) < cadDistance(point, best.point) - 1e-9) {
      best = projection;
    }
    stationBase += alignmentElementLength(element);
  }
  if (best == null) return null;
  const displayStation = cadAlignmentRawStationToDisplayStation(alignment, best.station);
  return displayStation == null
    ? null
    : {
        ...best,
        station: displayStation,
      };
};

export const cadBuildAlignmentStationPoints = (
  alignment:
    | Pick<CadAlignmentEntity, 'elements' | 'startStation' | 'stationEquations'>
    | readonly CadAlignmentElement[],
  options: {
    startStation?: number;
    endStation?: number;
    interval: number;
    includeStart?: boolean;
    includeEnd?: boolean;
  },
): CadAlignmentStationPoint[] => {
  const elements = getAlignmentElements(alignment);
  const defaultStartStation = getAlignmentStartStation(alignment);
  const defaultEndStation = cadAlignmentEndStation(alignment);
  const startStation = options.startStation ?? defaultStartStation;
  const endStation = options.endStation ?? defaultEndStation ?? defaultStartStation;
  const interval = options.interval;
  const includeStart = options.includeStart ?? true;
  const includeEnd = options.includeEnd ?? true;
  if (
    elements.length === 0 ||
    !Number.isFinite(interval) ||
    interval <= 0 ||
    !Number.isFinite(startStation) ||
    endStation == null ||
    !Number.isFinite(endStation) ||
    endStation < startStation - 1e-9
  ) {
    return [];
  }

  const stations: number[] = [];
  if (includeStart) stations.push(startStation);

  let nextStation = startStation + interval;
  while (nextStation < endStation - 1e-9) {
    stations.push(nextStation);
    nextStation += interval;
  }

  if (includeEnd && (stations.length === 0 || Math.abs(stations[stations.length - 1]! - endStation) > 1e-9)) {
    stations.push(endStation);
  }

  return stations
    .map((station) => {
      const point = cadPointAtAlignmentStation(alignment, station);
      return point ? { station, point } : null;
    })
    .filter((value): value is CadAlignmentStationPoint => value != null);
};
