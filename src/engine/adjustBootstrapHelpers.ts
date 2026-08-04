import {
  azimuthFromCoords,
  circularMean,
  intersectDistanceCircles,
  makeDirectedPairKey,
  wrapTo2Pi,
  wrapToPi,
} from './adjustMath';
import type {
  BootstrapDirectionSet,
  BootstrapPairMetrics,
} from './adjustTypes';
import type {
  Observation,
  ParseOptions,
  Station,
  StationId,
  StationMap,
} from '../types';
import { buildBootstrapPairMetrics } from './adjustBootstrapPairMetrics';

export { buildBootstrapPairMetrics } from './adjustBootstrapPairMetrics';

export const stationHasBootstrapableApprox = (
  stations: StationMap,
  stationId: StationId,
): boolean => {
  const station = stations[stationId];
  if (!station) return false;
  if (!Number.isFinite(station.x) || !Number.isFinite(station.y)) return false;
  if (station.coordInputClass && station.coordInputClass !== 'unknown') return true;
  return station.bootstrapApprox === true;
};

export const applyBootstrapApproxStation = ({
  coordSystemMode,
  seed,
  stationFactorSnapshot,
  stationGeodetic,
  stationId,
  stations,
}: {
  coordSystemMode: ParseOptions['coordSystemMode'];
  seed: { x: number; y: number; h?: number };
  stationFactorSnapshot: (_stationId: StationId) => unknown;
  stationGeodetic: (_stationId: StationId) => unknown;
  stationId: StationId;
  stations: StationMap;
}): boolean => {
  const station = stations[stationId];
  if (!station) return false;
  const isInputControl = !!station.coordInputClass && station.coordInputClass !== 'unknown';
  if (isInputControl) return false;
  const preserveX =
    (station.fixedX ?? false) ||
    Number.isFinite(station.constraintX ?? Number.NaN) ||
    station.constraintModeX === 'fixed' ||
    station.constraintModeX === 'weighted';
  const preserveY =
    (station.fixedY ?? false) ||
    Number.isFinite(station.constraintY ?? Number.NaN) ||
    station.constraintModeY === 'fixed' ||
    station.constraintModeY === 'weighted';
  const preserveH =
    (station.fixedH ?? false) ||
    Number.isFinite(station.constraintH ?? Number.NaN) ||
    station.constraintModeH === 'fixed' ||
    station.constraintModeH === 'weighted';
  const nextX = preserveX ? station.x : Number.isFinite(seed.x) ? seed.x : station.x;
  const nextY = preserveY ? station.y : Number.isFinite(seed.y) ? seed.y : station.y;
  const nextH = preserveH
    ? station.h
    : Number.isFinite(seed.h ?? Number.NaN)
      ? (seed.h as number)
      : station.h;
  const changed =
    !station.bootstrapApprox ||
    Math.hypot((station.x ?? 0) - nextX, (station.y ?? 0) - nextY) > 1e-6 ||
    Math.abs((station.h ?? 0) - nextH) > 1e-6;
  if (!changed) return false;
  station.x = nextX;
  station.y = nextY;
  station.h = nextH;
  station.bootstrapApprox = true;
  if (coordSystemMode === 'grid') {
    stationGeodetic(stationId);
    stationFactorSnapshot(stationId);
  }
  return true;
};

export const estimateBootstrapSetOrientation = ({
  pairMetrics,
  set,
  stations,
}: {
  pairMetrics: Map<string, BootstrapPairMetrics>;
  set: BootstrapDirectionSet;
  stations: StationMap;
}): number | null => {
  const occupy = stations[set.occupy];
  if (!occupy || !stationHasBootstrapableApprox(stations, set.occupy)) return null;
  const orientations = set.directions
    .filter((direction) => {
      const target = stations[direction.to];
      const pair = pairMetrics.get(makeDirectedPairKey(set.occupy, direction.to));
      return (
        target &&
        stationHasBootstrapableApprox(stations, direction.to) &&
        Number.isFinite(pair?.horizDistance ?? Number.NaN) &&
        (pair?.horizDistance ?? 0) > 1e-6
      );
    })
    .map((direction) => {
      const target = stations[direction.to] as Station;
      const azimuth = azimuthFromCoords(occupy.x, occupy.y, target.x, target.y);
      return wrapTo2Pi(azimuth - direction.obs);
    });
  return circularMean(orientations);
};

export const tryBootstrapDirectionSetOccupy = ({
  pairMetrics,
  set,
  stations,
}: {
  pairMetrics: Map<string, BootstrapPairMetrics>;
  set: BootstrapDirectionSet;
  stations: StationMap;
}): { x: number; y: number; h?: number; orientation: number } | null => {
  const knownTargets = set.directions
    .map((direction) => {
      const target = stations[direction.to];
      const metrics = pairMetrics.get(makeDirectedPairKey(set.occupy, direction.to));
      if (!target || !metrics || !stationHasBootstrapableApprox(stations, direction.to)) return null;
      if (!Number.isFinite(metrics.horizDistance) || metrics.horizDistance <= 1e-6) return null;
      return { direction, target, metrics };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry != null);
  if (knownTargets.length < 2) return null;

  let best:
    | { x: number; y: number; h?: number; orientation: number; mismatch: number }
    | undefined;

  for (let i = 0; i < knownTargets.length - 1; i += 1) {
    for (let j = i + 1; j < knownTargets.length; j += 1) {
      const first = knownTargets[i];
      const second = knownTargets[j];
      const intersections = intersectDistanceCircles(
        first.target.x,
        first.target.y,
        first.metrics.horizDistance,
        second.target.x,
        second.target.y,
        second.metrics.horizDistance,
      );
      intersections.forEach((candidate) => {
        const orientationValues = knownTargets.map((entry) => {
          const azimuth = azimuthFromCoords(candidate.x, candidate.y, entry.target.x, entry.target.y);
          return wrapTo2Pi(azimuth - entry.direction.obs);
        });
        const orientation = circularMean(orientationValues);
        if (orientation == null) return;
        const mismatch = knownTargets.reduce((total, entry) => {
          const azimuth = azimuthFromCoords(candidate.x, candidate.y, entry.target.x, entry.target.y);
          const predicted = wrapTo2Pi(orientation + entry.direction.obs);
          return total + Math.abs(wrapToPi(azimuth - predicted));
        }, 0);
        const heightCandidates = knownTargets
          .map((entry) =>
            Number.isFinite(entry.metrics.zenith ?? Number.NaN)
              ? entry.target.h -
                ((entry.metrics.hi ?? 0) -
                  (entry.metrics.ht ?? 0) +
                  entry.metrics.slopeDistance * Math.cos(entry.metrics.zenith as number))
              : undefined,
          )
          .filter((value): value is number => Number.isFinite(value));
        const height =
          heightCandidates.length > 0
            ? heightCandidates.reduce((sum, value) => sum + value, 0) / heightCandidates.length
            : undefined;
        if (!best || mismatch < best.mismatch) {
          best = { x: candidate.x, y: candidate.y, h: height, orientation, mismatch };
        }
      });
    }
  }

  if (!best) return null;
  return { x: best.x, y: best.y, h: best.h, orientation: best.orientation };
};

export const bootstrapApproximateTraverseCoords = ({
  activeObservations,
  applyBootstrapApproxStationFn,
  log,
  stations,
}: {
  activeObservations: Observation[];
  applyBootstrapApproxStationFn: (
    _stationId: StationId,
    _seed: { x: number; y: number; h?: number },
  ) => boolean;
  log: (_message: string) => void;
  stations: StationMap;
}): void => {
  const directionSets = new Map<string, BootstrapDirectionSet>();
  activeObservations.forEach((observation) => {
    if (observation.type !== 'direction' || !observation.setId) return;
    const entry = directionSets.get(observation.setId) ?? {
      setId: observation.setId,
      occupy: observation.at,
      directions: [],
    };
    entry.directions.push({ to: observation.to, obs: observation.obs });
    directionSets.set(observation.setId, entry);
  });
  if (directionSets.size === 0) return;

  const pairMetrics = buildBootstrapPairMetrics(activeObservations);
  if (pairMetrics.size === 0) return;
  const bearings = activeObservations.filter(
    (observation): observation is Observation & { type: 'bearing' } => observation.type === 'bearing',
  );

  let seededCount = 0;
  let passCount = 0;
  for (let pass = 0; pass < 8; pass += 1) {
    let progress = false;
    passCount = pass + 1;

    bearings.forEach((bearing) => {
      const metrics = pairMetrics.get(makeDirectedPairKey(bearing.from, bearing.to));
      if (!metrics || !Number.isFinite(metrics.horizDistance) || metrics.horizDistance <= 1e-6) {
        return;
      }
      const fromKnown = stationHasBootstrapableApprox(stations, bearing.from);
      const toKnown = stationHasBootstrapableApprox(stations, bearing.to);
      if (fromKnown === toKnown) return;

      if (!fromKnown) {
        const target = stations[bearing.to];
        if (!target) return;
        const seedX = target.x - metrics.horizDistance * Math.sin(bearing.obs);
        const seedY = target.y - metrics.horizDistance * Math.cos(bearing.obs);
        const deltaH =
          Number.isFinite(metrics.zenith ?? Number.NaN)
            ? (metrics.hi ?? 0) + metrics.slopeDistance * Math.cos(metrics.zenith as number) - (metrics.ht ?? 0)
            : undefined;
        const seedH =
          Number.isFinite(deltaH ?? Number.NaN) && Number.isFinite(target.h ?? Number.NaN)
            ? target.h - (deltaH as number)
            : target.h;
        if (applyBootstrapApproxStationFn(bearing.from, { x: seedX, y: seedY, h: seedH })) {
          seededCount += 1;
          progress = true;
        }
        return;
      }

      const fromStation = stations[bearing.from];
      if (!fromStation) return;
      const seedX = fromStation.x + metrics.horizDistance * Math.sin(bearing.obs);
      const seedY = fromStation.y + metrics.horizDistance * Math.cos(bearing.obs);
      const deltaH =
        Number.isFinite(metrics.zenith ?? Number.NaN)
          ? (metrics.hi ?? 0) + metrics.slopeDistance * Math.cos(metrics.zenith as number) - (metrics.ht ?? 0)
          : undefined;
      const seedH =
        Number.isFinite(deltaH ?? Number.NaN) && Number.isFinite(fromStation.h ?? Number.NaN)
          ? fromStation.h + (deltaH as number)
          : fromStation.h;
      if (applyBootstrapApproxStationFn(bearing.to, { x: seedX, y: seedY, h: seedH })) {
        seededCount += 1;
        progress = true;
      }
    });

    directionSets.forEach((set) => {
      if (stationHasBootstrapableApprox(stations, set.occupy)) return;
      const occupySeed = tryBootstrapDirectionSetOccupy({ pairMetrics, set, stations });
      if (!occupySeed) return;
      if (applyBootstrapApproxStationFn(set.occupy, occupySeed)) {
        seededCount += 1;
        progress = true;
      }
    });

    directionSets.forEach((set) => {
      if (!stationHasBootstrapableApprox(stations, set.occupy)) return;
      const occupy = stations[set.occupy];
      if (!occupy) return;
      const orientation = estimateBootstrapSetOrientation({ pairMetrics, set, stations });
      if (orientation == null) return;
      set.directions.forEach((direction) => {
        if (stationHasBootstrapableApprox(stations, direction.to)) return;
        const metrics = pairMetrics.get(makeDirectedPairKey(set.occupy, direction.to));
        if (!metrics || !Number.isFinite(metrics.horizDistance) || metrics.horizDistance <= 1e-6) {
          return;
        }
        const azimuth = wrapTo2Pi(orientation + direction.obs);
        const seedX = occupy.x + metrics.horizDistance * Math.sin(azimuth);
        const seedY = occupy.y + metrics.horizDistance * Math.cos(azimuth);
        const seedH =
          Number.isFinite(metrics.zenith ?? Number.NaN)
            ? occupy.h +
              (metrics.hi ?? 0) -
              (metrics.ht ?? 0) +
              metrics.slopeDistance * Math.cos(metrics.zenith as number)
            : occupy.h;
        if (applyBootstrapApproxStationFn(direction.to, { x: seedX, y: seedY, h: seedH })) {
          seededCount += 1;
          progress = true;
        }
      });
    });

    if (!progress) break;
  }

  if (seededCount > 0) {
    log(
      `Approximate traverse bootstrap: seeded ${seededCount} station(s) over ${passCount} pass(es).`,
    );
  }
};
