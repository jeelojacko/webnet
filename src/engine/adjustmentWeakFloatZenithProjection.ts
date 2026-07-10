import { azimuthFromCoords, circularMean, wrapTo2Pi } from './adjustMath';
import type {
  DirectionObservation,
  DistanceObservation,
  Observation,
  ParseOptions,
  StationId,
  StationMap,
} from '../types';

export type WeakFloatZenithProjectionContext = {
  is2D: boolean;
  activeObservations: Observation[];
  stations: StationMap;
  coordSystemMode: ParseOptions['coordSystemMode'];
  stationGeodetic: (_stationId: StationId) => { latDeg: number; lonDeg: number } | null;
  stationFactorSnapshot: (_stationId: StationId) => unknown;
};

export const projectWeakFloatZenithLeafStationsForDisplay = ({
  is2D,
  activeObservations,
  stations,
  coordSystemMode,
  stationGeodetic,
  stationFactorSnapshot,
}: WeakFloatZenithProjectionContext): StationId[] => {
  if (is2D || !activeObservations.length) return [];

  const hasRealVertical = new Set<StationId>();
  activeObservations.forEach((observation) => {
    if (observation.type === 'zenith' || observation.type === 'lev') {
      hasRealVertical.add(observation.from);
      hasRealVertical.add(observation.to);
      return;
    }
    if (observation.type === 'gps' && Number.isFinite(observation.obs.dU ?? Number.NaN)) {
      hasRealVertical.add(observation.from);
      hasRealVertical.add(observation.to);
    }
  });

  const directionRowsByTarget = new Map<StationId, DirectionObservation[]>();
  const directionRowsBySet = new Map<string, DirectionObservation[]>();
  activeObservations.forEach((observation) => {
    if (observation.type !== 'direction') return;
    const list = directionRowsByTarget.get(observation.to) ?? [];
    list.push(observation);
    directionRowsByTarget.set(observation.to, list);
    if (observation.setId) {
      const setRows = directionRowsBySet.get(observation.setId) ?? [];
      setRows.push(observation);
      directionRowsBySet.set(observation.setId, setRows);
    }
  });

  const floatSlopeRowsByTarget = new Map<StationId, DistanceObservation[]>();
  activeObservations.forEach((observation) => {
    if (
      observation.type !== 'dist' ||
      observation.mode !== 'slope' ||
      !Number.isFinite(observation.bootstrapZenithObs ?? Number.NaN)
    ) {
      return;
    }
    const list = floatSlopeRowsByTarget.get(observation.to) ?? [];
    list.push(observation);
    floatSlopeRowsByTarget.set(observation.to, list);
  });

  const projected: StationId[] = [];
  floatSlopeRowsByTarget.forEach((distanceRows, stationId) => {
    const station = stations[stationId];
    if (!station) return;
    if ((station.coordInputClass ?? 'unknown') !== 'unknown') return;
    if (hasRealVertical.has(stationId)) return;

    const occupies = new Set(distanceRows.map((row) => row.from));
    if (occupies.size !== 1) return;
    const occupyId = distanceRows[0]?.from;
    if (!occupyId) return;
    const occupy = stations[occupyId];
    if (!occupy) return;

    const directionRows = (directionRowsByTarget.get(stationId) ?? []).filter(
      (row) => row.at === occupyId,
    );
    if (!directionRows.length) return;

    const azimuths = directionRows
      .map((row) => {
        if (!row.setId) return undefined;
        const setRows = (directionRowsBySet.get(row.setId) ?? []).filter(
          (candidate) => candidate.to !== stationId && candidate.at === occupyId,
        );
        const orientation = circularMean(
          setRows
            .map((candidate) => {
              const target = stations[candidate.to];
              if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) {
                return undefined;
              }
              return wrapTo2Pi(
                azimuthFromCoords(occupy.x, occupy.y, target.x, target.y) - candidate.obs,
              );
            })
            .filter((value): value is number => Number.isFinite(value)),
        );
        return orientation == null ? undefined : wrapTo2Pi(orientation + row.obs);
      })
      .filter((value): value is number => Number.isFinite(value));
    if (!azimuths.length) return;

    const horizDistance =
      distanceRows.reduce(
        (sum, row) => sum + row.obs * Math.sin(row.bootstrapZenithObs as number),
        0,
      ) / distanceRows.length;
    const deltaH =
      distanceRows.reduce(
        (sum, row) =>
          sum +
          ((row.hi ?? 0) - (row.ht ?? 0) + row.obs * Math.cos(row.bootstrapZenithObs as number)),
        0,
      ) / distanceRows.length;
    if (!Number.isFinite(horizDistance) || !Number.isFinite(deltaH)) return;

    const azimuth = circularMean(azimuths);
    if (azimuth == null) return;
    const projectedX = occupy.x + horizDistance * Math.sin(azimuth);
    const projectedY = occupy.y + horizDistance * Math.cos(azimuth);
    const projectedH = occupy.h + deltaH;
    if (
      !Number.isFinite(projectedX) ||
      !Number.isFinite(projectedY) ||
      !Number.isFinite(projectedH)
    ) {
      return;
    }

    station.x = projectedX;
    station.y = projectedY;
    station.h = projectedH;
    if (coordSystemMode === 'grid') {
      stationGeodetic(stationId);
      stationFactorSnapshot(stationId);
    }
    projected.push(stationId);
  });

  return projected;
};
