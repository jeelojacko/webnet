import { RAD_TO_DEG } from './angles';
import { getObservationSetId } from './observationMetadata';
import type {
  Observation,
  StationId,
  StationMap,
} from '../types';

export const computeDirectionSetPrefit = ({
  activeObservations,
  directionOrientations,
  directionSetIds,
  getAzimuth,
  logs,
  modeledAzimuth,
  stations,
}: {
  activeObservations: Observation[];
  directionOrientations: Record<string, number>;
  directionSetIds: string[];
  getAzimuth: (_fromId: StationId, _toId: StationId) => { az: number; dist: number };
  logs: string[];
  modeledAzimuth: (_rawAz: number, _atStationId?: StationId, _applyConvergence?: boolean) => number;
  stations: StationMap;
}): void => {
  const groups = new Map<
    string,
    { count: number; sumSin: number; sumCos: number; occupy: StationId }
  >();
  const diffsBySet = new Map<string, number[]>();

  activeObservations.forEach((obs) => {
    if (obs.type !== 'direction') return;
    if (!stations[obs.at] || !stations[obs.to]) return;
    const az = modeledAzimuth(
      getAzimuth(obs.at, obs.to).az,
      obs.at,
      obs.gridObsMode !== 'grid',
    );
    const setId = getObservationSetId(obs) ?? 'unknown';
    const diff = ((obs.obs - az + Math.PI) % (2 * Math.PI)) - Math.PI;
    const entry = groups.get(setId) ?? {
      count: 0,
      sumSin: 0,
      sumCos: 0,
      occupy: obs.at,
    };
    entry.count += 1;
    entry.sumSin += Math.sin(diff);
    entry.sumCos += Math.cos(diff);
    entry.occupy = obs.at ?? entry.occupy;
    groups.set(setId, entry);
    const arr = diffsBySet.get(setId) ?? [];
    arr.push(diff);
    diffsBySet.set(setId, arr);
  });

  if (!groups.size) return;

  logs.push('Direction set prefit (initial coords, arcsec residuals):');
  const sorted = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  sorted.forEach(([setId, entry]) => {
    const orient = Math.atan2(entry.sumSin, entry.sumCos);
    directionOrientations[setId] = orient;
    const diffs = diffsBySet.get(setId) ?? [];
    let sum = 0;
    let sumSq = 0;
    let maxAbs = 0;
    diffs.forEach((d) => {
      const v = ((d - orient + Math.PI) % (2 * Math.PI)) - Math.PI;
      const arcsec = v * RAD_TO_DEG * 3600;
      sum += arcsec;
      sumSq += arcsec * arcsec;
      maxAbs = Math.max(maxAbs, Math.abs(arcsec));
    });
    const mean = diffs.length ? sum / diffs.length : 0;
    const rms = diffs.length ? Math.sqrt(sumSq / diffs.length) : 0;
    const orientDeg = (orient * RAD_TO_DEG + 360) % 360;
    logs.push(
      `  ${setId} @ ${entry.occupy}: n=${diffs.length}, mean=${mean.toFixed(
        2,
      )}", rms=${rms.toFixed(2)}", max=${maxAbs.toFixed(2)}", orient=${orientDeg.toFixed(4)}°`,
    );
  });

  directionSetIds.forEach((id) => {
    if (directionOrientations[id] == null) directionOrientations[id] = 0;
  });
};

export const logNetworkDiagnostics = ({
  activeObservations,
  log,
  unknowns,
}: {
  activeObservations: Observation[];
  log: (_message: string) => void;
  unknowns: StationId[];
}): void => {
  const stationObsCount = new Map<StationId, number>();
  const otherObsCount = new Map<StationId, number>();
  const directionAt = new Set<StationId>();
  const directionTargets = new Map<StationId, Set<StationId>>();
  const directionSetCounts = new Map<string, number>();

  const mark = (id: StationId) => {
    stationObsCount.set(id, (stationObsCount.get(id) ?? 0) + 1);
  };
  const markOther = (id: StationId) => {
    otherObsCount.set(id, (otherObsCount.get(id) ?? 0) + 1);
  };

  activeObservations.forEach((obs) => {
    if (obs.type === 'direction') {
      const setId = getObservationSetId(obs) ?? 'unknown';
      mark(obs.at);
      mark(obs.to);
      directionAt.add(obs.at);
      const set = directionTargets.get(obs.to) ?? new Set<StationId>();
      set.add(obs.at);
      directionTargets.set(obs.to, set);
      directionSetCounts.set(setId, (directionSetCounts.get(setId) ?? 0) + 1);
      return;
    }

    if (obs.type === 'angle') {
      mark(obs.at);
      mark(obs.from);
      mark(obs.to);
      markOther(obs.at);
      markOther(obs.from);
      markOther(obs.to);
      return;
    }
    if (
      obs.type === 'dist' ||
      obs.type === 'bearing' ||
      obs.type === 'lev' ||
      obs.type === 'zenith'
    ) {
      mark(obs.from);
      mark(obs.to);
      markOther(obs.from);
      markOther(obs.to);
      return;
    }
    if (obs.type === 'dir') {
      mark(obs.from);
      mark(obs.to);
      markOther(obs.from);
      markOther(obs.to);
      return;
    }
    if (obs.type === 'gps') {
      mark(obs.from);
      mark(obs.to);
      markOther(obs.from);
      markOther(obs.to);
    }
  });

  unknowns.forEach((id) => {
    if (!stationObsCount.has(id)) {
      log(`Warning: unknown station ${id} has no observations and will cause a singular network.`);
      return;
    }

    const hasOther = (otherObsCount.get(id) ?? 0) > 0;
    if (!directionAt.has(id) && !hasOther) {
      const atCount = directionTargets.get(id)?.size ?? 0;
      if (atCount < 2) {
        log(
          `Warning: station ${id} is only targeted by directions from ${atCount} station(s). ` +
            `At least two occupies or distance/GNSS observations are required to solve it.`,
        );
      }
    }
  });

  directionSetCounts.forEach((count, setId) => {
    if (count < 2) {
      log(
        `Warning: direction set ${setId} has only ${count} observation(s); orientation may be weak.`,
      );
    }
  });
};
