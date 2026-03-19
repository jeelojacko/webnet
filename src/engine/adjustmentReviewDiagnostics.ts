import type { AdjustmentResult, Observation, Station, StationId, StationMap } from '../types';

const stationSeparation = (a: Station, b: Station, dimension: '2D' | '3D'): number => {
  const dE = b.x - a.x;
  const dN = b.y - a.y;
  if (dimension === '2D') {
    return Math.hypot(dE, dN);
  }
  const dH = b.h - a.h;
  return Math.sqrt(dE * dE + dN * dN + dH * dH);
};

export const buildAutoSideshotDiagnostics = ({
  observations,
  stations,
  redundancyScalar,
  threshold,
}: {
  observations: Observation[];
  stations: StationMap;
  redundancyScalar: (_obs: Observation) => number | undefined;
  threshold: number;
}): NonNullable<AdjustmentResult['autoSideshotDiagnostics']> => {
  type MPair = { angle?: Observation; dist?: Observation };
  const byLine = new Map<number, MPair>();

  observations.forEach((obs) => {
    const sourceLine = obs.sourceLine;
    if (sourceLine == null) return;
    if (obs.type === 'angle' && String((obs as any).setId ?? '') === '') {
      const row = byLine.get(sourceLine) ?? {};
      row.angle = obs;
      byLine.set(sourceLine, row);
    } else if (
      obs.type === 'dist' &&
      obs.subtype === 'ts' &&
      String((obs as any).setId ?? '') === ''
    ) {
      const row = byLine.get(sourceLine) ?? {};
      row.dist = obs;
      byLine.set(sourceLine, row);
    }
  });

  const candidates: NonNullable<AdjustmentResult['autoSideshotDiagnostics']>['candidates'] = [];
  let evaluatedCount = 0;
  let excludedControlCount = 0;

  [...byLine.entries()]
    .sort((a, b) => a[0] - b[0])
    .forEach(([sourceLine, pair]) => {
      const angle = pair.angle;
      const dist = pair.dist;
      if (!angle || !dist || angle.type !== 'angle' || dist.type !== 'dist') return;
      if (angle.at !== dist.from || angle.to !== dist.to) return;
      evaluatedCount += 1;

      const targetStation = stations[dist.to];
      if (targetStation?.fixed) {
        excludedControlCount += 1;
        return;
      }

      const angleRedundancy = redundancyScalar(angle) ?? 0;
      const distRedundancy = redundancyScalar(dist) ?? 0;
      const minRedundancy = Math.min(angleRedundancy, distRedundancy);
      if (minRedundancy >= threshold) return;

      candidates.push({
        sourceLine,
        occupy: angle.at,
        backsight: angle.from,
        target: angle.to,
        angleObsId: angle.id,
        distObsId: dist.id,
        angleRedundancy,
        distRedundancy,
        minRedundancy,
        maxAbsStdRes: Math.max(Math.abs(angle.stdRes ?? 0), Math.abs(dist.stdRes ?? 0)),
      });
    });

  candidates.sort((a, b) => {
    if (a.minRedundancy !== b.minRedundancy) return a.minRedundancy - b.minRedundancy;
    if (b.maxAbsStdRes !== a.maxAbsStdRes) return b.maxAbsStdRes - a.maxAbsStdRes;
    const la = a.sourceLine ?? Number.MAX_SAFE_INTEGER;
    const lb = b.sourceLine ?? Number.MAX_SAFE_INTEGER;
    return la - lb;
  });

  return {
    enabled: true,
    threshold,
    evaluatedCount,
    excludedControlCount,
    candidateCount: candidates.length,
    candidates,
  };
};

export const buildClusterDiagnostics = ({
  stations,
  unknowns,
  enabled,
  linkageMode,
  dimension,
  tolerance,
  passMode,
}: {
  stations: StationMap;
  unknowns: StationId[];
  enabled: boolean;
  linkageMode: NonNullable<AdjustmentResult['clusterDiagnostics']>['linkageMode'];
  dimension: '2D' | '3D';
  tolerance: number;
  passMode: NonNullable<AdjustmentResult['clusterDiagnostics']>['passMode'];
}): NonNullable<AdjustmentResult['clusterDiagnostics']> => {
  if (!enabled) {
    return {
      enabled: false,
      passMode,
      linkageMode,
      dimension,
      tolerance,
      pairCount: 0,
      candidateCount: 0,
      candidates: [],
    };
  }

  const stationIds = Object.keys(stations)
    .filter((id) => {
      const station = stations[id];
      if (!station) return false;
      if (!Number.isFinite(station.x) || !Number.isFinite(station.y)) return false;
      if (dimension === '3D' && !Number.isFinite(station.h)) return false;
      return true;
    })
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (stationIds.length < 2) {
    return {
      enabled: true,
      passMode,
      linkageMode,
      dimension,
      tolerance,
      pairCount: 0,
      candidateCount: 0,
      candidates: [],
    };
  }

  const pairDist = new Map<string, number>();
  const pairKey = (a: StationId, b: StationId): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const getDist = (a: StationId, b: StationId): number => {
    const key = pairKey(a, b);
    const cached = pairDist.get(key);
    if (cached != null) return cached;
    const sa = stations[a];
    const sb = stations[b];
    if (!sa || !sb) return Number.POSITIVE_INFINITY;
    const dist = stationSeparation(sa, sb, dimension);
    pairDist.set(key, dist);
    return dist;
  };

  type Edge = { from: StationId; to: StationId; separation: number };
  const withinTolEdges: Edge[] = [];
  for (let i = 0; i < stationIds.length; i += 1) {
    for (let j = i + 1; j < stationIds.length; j += 1) {
      const from = stationIds[i];
      const to = stationIds[j];
      const separation = getDist(from, to);
      if (separation <= tolerance) {
        withinTolEdges.push({ from, to, separation });
      }
    }
  }

  let rawClusters: StationId[][] = [];
  if (linkageMode === 'single') {
    const parent = new Map<StationId, StationId>();
    const find = (id: StationId): StationId => {
      const p = parent.get(id) ?? id;
      if (p === id) return p;
      const root = find(p);
      parent.set(id, root);
      return root;
    };
    const union = (a: StationId, b: StationId): void => {
      const ra = find(a);
      const rb = find(b);
      if (ra === rb) return;
      const keep = ra.localeCompare(rb, undefined, { numeric: true }) <= 0 ? ra : rb;
      const drop = keep === ra ? rb : ra;
      parent.set(drop, keep);
    };
    stationIds.forEach((id) => parent.set(id, id));
    withinTolEdges.forEach((edge) => union(edge.from, edge.to));
    const groups = new Map<StationId, StationId[]>();
    stationIds.forEach((id) => {
      const root = find(id);
      const list = groups.get(root) ?? [];
      list.push(id);
      groups.set(root, list);
    });
    rawClusters = Array.from(groups.values()).filter((group) => group.length > 1);
  } else {
    const clusters: StationId[][] = [];
    stationIds.forEach((id) => {
      let placed = false;
      for (const group of clusters) {
        const fits = group.every((member) => getDist(id, member) <= tolerance);
        if (fits) {
          group.push(id);
          placed = true;
          break;
        }
      }
      if (!placed) clusters.push([id]);
    });
    rawClusters = clusters.filter((group) => group.length > 1);
  }

  const unknownSet = new Set(unknowns);
  const candidates = rawClusters
    .map((group) => group.slice().sort((a, b) => a.localeCompare(b, undefined, { numeric: true })))
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
    .map((stationIdsInCluster, idx) => {
      let sumE = 0;
      let sumN = 0;
      let sumH = 0;
      let hasFixed = false;
      let hasUnknown = false;
      stationIdsInCluster.forEach((id) => {
        const station = stations[id];
        if (!station) return;
        sumE += station.x;
        sumN += station.y;
        sumH += station.h;
        hasFixed = hasFixed || station.fixed;
        hasUnknown = hasUnknown || unknownSet.has(id);
      });
      const pairRows: Edge[] = [];
      let maxSeparation = 0;
      let sumSeparation = 0;
      let pairCount = 0;
      for (let i = 0; i < stationIdsInCluster.length; i += 1) {
        for (let j = i + 1; j < stationIdsInCluster.length; j += 1) {
          const from = stationIdsInCluster[i];
          const to = stationIdsInCluster[j];
          const separation = getDist(from, to);
          pairRows.push({ from, to, separation });
          maxSeparation = Math.max(maxSeparation, separation);
          sumSeparation += separation;
          pairCount += 1;
        }
      }
      pairRows.sort(
        (a, b) =>
          a.from.localeCompare(b.from, undefined, { numeric: true }) ||
          a.to.localeCompare(b.to, undefined, { numeric: true }),
      );
      return {
        key: `CL-${idx + 1}-${stationIdsInCluster[0]}`,
        representativeId: stationIdsInCluster[0],
        stationIds: stationIdsInCluster,
        memberCount: stationIdsInCluster.length,
        hasFixed,
        hasUnknown,
        centroidE: sumE / stationIdsInCluster.length,
        centroidN: sumN / stationIdsInCluster.length,
        centroidH: dimension === '3D' ? sumH / stationIdsInCluster.length : undefined,
        maxSeparation,
        meanSeparation: pairCount > 0 ? sumSeparation / pairCount : 0,
        pairs: pairRows,
      };
    });

  return {
    enabled: true,
    passMode,
    linkageMode,
    dimension,
    tolerance,
    pairCount: withinTolEdges.length,
    candidateCount: candidates.length,
    candidates,
  };
};
