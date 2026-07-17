import type {
  AdjustmentResult,
  PreanalysisAddedSetPairRef,
  PreanalysisRecommendationKind,
  StationId,
  StationMap,
  WeakGeometrySeverity,
} from '../types';

export type PathGraphEdge = {
  from: StationId;
  to: StationId;
  metric: number;
};

export type StationPathDiagnostics = {
  stationId: StationId;
  anchorStationId?: StationId;
  anchorPathStationIds: StationId[];
  anchorPathPairRefs: PreanalysisAddedSetPairRef[];
  pathWorstEdgeMetric?: number;
  pathTotalMetric?: number;
  pathWorstEdgePair?: PreanalysisAddedSetPairRef;
  stationMajor?: number;
  fixedRank: number;
};

export type PathPrioritySummary = {
  stationOrder: StationId[];
  stationDiagnostics: Map<StationId, StationPathDiagnostics>;
  prioritizedPairs: PreanalysisAddedSetPairRef[];
  prioritizedStations: Set<StationId>;
  prioritizedPairKeys: Set<string>;
};

const severityWeight = (severity: WeakGeometrySeverity): number =>
  severity === 'weak' ? 2 : severity === 'watch' ? 1 : 0;

const sortStationIds = (left: StationId, right: StationId): number =>
  left.localeCompare(right, undefined, { numeric: true });

const buildPairKey = (from: StationId, to: StationId): string =>
  [from, to].sort(sortStationIds).join('|');

const compareStationIdArrays = (left: StationId[], right: StationId[]): number => {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const cmp = sortStationIds(left[index]!, right[index]!);
    if (cmp !== 0) return cmp;
  }
  return left.length - right.length;
};

export const stationHasFiniteCoords = (stations: StationMap, stationId: StationId): boolean => {
  const station = stations[stationId];
  return (
    station != null &&
    Number.isFinite(station.x) &&
    Number.isFinite(station.y) &&
    Number.isFinite(station.h)
  );
};

const stationMajorById = (res: AdjustmentResult): Map<StationId, number> =>
  new Map(
    (res.stationCovariances ?? []).map((row) => [
      row.stationId,
      row.ellipse?.semiMajor ?? Math.max(row.sigmaE, row.sigmaN),
    ]),
  );

const resolveRelativeMetric = (
  row:
    | NonNullable<AdjustmentResult['relativeCovariances']>[number]
    | undefined,
  fallback = Number.NaN,
): number =>
  row != null
    ? row.sigmaDist ?? row.ellipse?.semiMajor ?? Math.max(row.sigmaE, row.sigmaN)
    : fallback;

export const buildPathGraph = (base: AdjustmentResult): PathGraphEdge[] => {
  const stationMajorsById = stationMajorById(base);
  const edges = new Map<string, PathGraphEdge>();
  (base.relativeCovariances ?? []).forEach((row) => {
    const metric = resolveRelativeMetric(row);
    if (!Number.isFinite(metric) || metric <= 0) return;
    const key = buildPairKey(row.from, row.to);
    edges.set(key, { from: row.from, to: row.to, metric });
  });
  (base.observations ?? []).forEach((obs) => {
    const from = 'at' in obs ? obs.at : 'from' in obs ? obs.from : undefined;
    const to = 'to' in obs ? obs.to : undefined;
    if (!from || !to) return;
    const key = buildPairKey(from, to);
    if (edges.has(key)) return;
    const fromMajor = stationMajorsById.get(from);
    const toMajor = stationMajorsById.get(to);
    const metricCandidates = [fromMajor, toMajor].filter(
      (value): value is number => Number.isFinite(value),
    );
    const metric =
      metricCandidates.length > 0 ? Math.max(...metricCandidates) : Number.NaN;
    if (!Number.isFinite(metric) || metric <= 0) return;
    edges.set(key, { from, to, metric });
  });
  return [...edges.values()];
};

export const stationFixedRank = (station: StationMap[StationId] | undefined): number => {
  if (!station) return 0;
  if ((station.fixedX ?? false) && (station.fixedY ?? false)) return 2;
  if (
    station.fixedX === true ||
    station.fixedY === true ||
    station.constraintX != null ||
    station.constraintY != null
  ) {
    return 1;
  }
  return 0;
};

const comparePathCandidates = (
  current: StationPathDiagnostics | undefined,
  next: StationPathDiagnostics,
): number => {
  if (!current) return 1;
  const currentWorst = current.pathWorstEdgeMetric ?? Number.POSITIVE_INFINITY;
  const nextWorst = next.pathWorstEdgeMetric ?? Number.POSITIVE_INFINITY;
  if (nextWorst !== currentWorst) return currentWorst - nextWorst;
  const currentTotal = current.pathTotalMetric ?? Number.POSITIVE_INFINITY;
  const nextTotal = next.pathTotalMetric ?? Number.POSITIVE_INFINITY;
  if (nextTotal !== currentTotal) return currentTotal - nextTotal;
  if (next.anchorPathPairRefs.length !== current.anchorPathPairRefs.length) {
    return current.anchorPathPairRefs.length - next.anchorPathPairRefs.length;
  }
  const pathCmp = compareStationIdArrays(
    current.anchorPathStationIds,
    next.anchorPathStationIds,
  );
  if (pathCmp !== 0) return pathCmp;
  return current.anchorStationId != null && next.anchorStationId != null
    ? sortStationIds(current.anchorStationId, next.anchorStationId)
    : 0;
};

const buildStationPathDiagnostics = (base: AdjustmentResult): Map<StationId, StationPathDiagnostics> => {
  const edges = buildPathGraph(base);
  const adjacency = new Map<StationId, PathGraphEdge[]>();
  edges.forEach((edge) => {
    const fromList = adjacency.get(edge.from) ?? [];
    const toList = adjacency.get(edge.to) ?? [];
    fromList.push(edge);
    toList.push(edge);
    adjacency.set(edge.from, fromList);
    adjacency.set(edge.to, toList);
  });
  const stationMajorsById = stationMajorById(base);
  const diagnostics = new Map<StationId, StationPathDiagnostics>();
  const anchors = Object.entries(base.stations)
    .filter(([, station]) => stationFixedRank(station) === 2)
    .map(([stationId]) => stationId)
    .sort(sortStationIds);
  const fallbackAnchors =
    anchors.length > 0
      ? anchors
      : Object.entries(base.stations)
          .filter(([, station]) => stationFixedRank(station) === 1)
          .map(([stationId]) => stationId)
          .sort(sortStationIds);
  type FrontierNode = {
    stationId: StationId;
    anchorStationId: StationId;
    pathWorstEdgeMetric: number;
    pathTotalMetric: number;
    hopCount: number;
    pathStationIds: StationId[];
    pathPairRefs: PreanalysisAddedSetPairRef[];
  };
  const frontier: FrontierNode[] = fallbackAnchors.map((anchorId) => ({
    stationId: anchorId,
    anchorStationId: anchorId,
    pathWorstEdgeMetric: 0,
    pathTotalMetric: 0,
    hopCount: 0,
    pathStationIds: [anchorId],
    pathPairRefs: [],
  }));
  const bestByStation = new Map<StationId, FrontierNode>();
  while (frontier.length > 0) {
    frontier.sort((left, right) => {
      if (left.pathWorstEdgeMetric !== right.pathWorstEdgeMetric) {
        return left.pathWorstEdgeMetric - right.pathWorstEdgeMetric;
      }
      if (left.pathTotalMetric !== right.pathTotalMetric) {
        return left.pathTotalMetric - right.pathTotalMetric;
      }
      if (left.hopCount !== right.hopCount) return left.hopCount - right.hopCount;
      const pathCmp = compareStationIdArrays(left.pathStationIds, right.pathStationIds);
      if (pathCmp !== 0) return pathCmp;
      return sortStationIds(left.anchorStationId, right.anchorStationId);
    });
    const current = frontier.shift()!;
    const known = bestByStation.get(current.stationId);
    if (known) {
      const currentKey: StationPathDiagnostics = {
        stationId: current.stationId,
        anchorStationId: current.anchorStationId,
        anchorPathStationIds: current.pathStationIds,
        anchorPathPairRefs: current.pathPairRefs,
        pathWorstEdgeMetric: current.pathWorstEdgeMetric,
        pathTotalMetric: current.pathTotalMetric,
        stationMajor: stationMajorsById.get(current.stationId),
        fixedRank: stationFixedRank(base.stations[current.stationId]),
      };
      const knownKey: StationPathDiagnostics = {
        stationId: known.stationId,
        anchorStationId: known.anchorStationId,
        anchorPathStationIds: known.pathStationIds,
        anchorPathPairRefs: known.pathPairRefs,
        pathWorstEdgeMetric: known.pathWorstEdgeMetric,
        pathTotalMetric: known.pathTotalMetric,
        stationMajor: stationMajorsById.get(known.stationId),
        fixedRank: stationFixedRank(base.stations[known.stationId]),
      };
      if (comparePathCandidates(knownKey, currentKey) <= 0) continue;
    }
    bestByStation.set(current.stationId, current);
    (adjacency.get(current.stationId) ?? []).forEach((edge) => {
      const nextStationId = edge.from === current.stationId ? edge.to : edge.from;
      if (current.pathStationIds.includes(nextStationId)) return;
      frontier.push({
        stationId: nextStationId,
        anchorStationId: current.anchorStationId,
        pathWorstEdgeMetric: Math.max(current.pathWorstEdgeMetric, edge.metric),
        pathTotalMetric: current.pathTotalMetric + edge.metric,
        hopCount: current.hopCount + 1,
        pathStationIds: [...current.pathStationIds, nextStationId],
        pathPairRefs: [...current.pathPairRefs, { from: current.stationId, to: nextStationId }],
      });
    });
  }
  Object.entries(base.stations).forEach(([stationId, station]) => {
    const best = bestByStation.get(stationId);
    const fixedRank = stationFixedRank(station);
    const pathPairMetrics = (best?.pathPairRefs ?? []).map((pair) =>
      edges.find((edge) => buildPairKey(edge.from, edge.to) === buildPairKey(pair.from, pair.to))?.metric ?? 0,
    );
    const worstPairIndex =
      pathPairMetrics.length > 0
        ? pathPairMetrics.reduce(
            (bestIndex, metric, index, metrics) => (metric > metrics[bestIndex] ? index : bestIndex),
            0,
          )
        : -1;
    diagnostics.set(stationId, {
      stationId,
      anchorStationId: best?.anchorStationId,
      anchorPathStationIds: best?.pathStationIds ?? [stationId],
      anchorPathPairRefs: best?.pathPairRefs ?? [],
      pathWorstEdgeMetric: best?.pathWorstEdgeMetric,
      pathTotalMetric: best?.pathTotalMetric,
      pathWorstEdgePair:
        worstPairIndex >= 0 ? best?.pathPairRefs[worstPairIndex] : undefined,
      stationMajor: stationMajorsById.get(stationId),
      fixedRank,
    });
  });
  return diagnostics;
};

export const buildPathPrioritySummary = (base: AdjustmentResult): PathPrioritySummary => {
  const diagnostics = buildStationPathDiagnostics(base);
  const stationOrder = [...diagnostics.values()]
    .sort((left, right) => {
      const rightMajor = right.stationMajor ?? Number.NEGATIVE_INFINITY;
      const leftMajor = left.stationMajor ?? Number.NEGATIVE_INFINITY;
      if (rightMajor !== leftMajor) return rightMajor - leftMajor;
      const rightWorst = right.pathWorstEdgeMetric ?? Number.NEGATIVE_INFINITY;
      const leftWorst = left.pathWorstEdgeMetric ?? Number.NEGATIVE_INFINITY;
      if (rightWorst !== leftWorst) return rightWorst - leftWorst;
      const rightTotal = right.pathTotalMetric ?? Number.NEGATIVE_INFINITY;
      const leftTotal = left.pathTotalMetric ?? Number.NEGATIVE_INFINITY;
      if (rightTotal !== leftTotal) return rightTotal - leftTotal;
      return left.stationId.localeCompare(right.stationId, undefined, { numeric: true });
    })
    .map((row) => row.stationId);
  const prioritizedPairs: PreanalysisAddedSetPairRef[] = [];
  const prioritizedPairKeys = new Set<string>();
  const prioritizedStations = new Set<StationId>();
  stationOrder.slice(0, 5).forEach((stationId) => {
    const diagnosticsRow = diagnostics.get(stationId);
    if (!diagnosticsRow) return;
    diagnosticsRow.anchorPathStationIds.forEach((id) => prioritizedStations.add(id));
    const pathPairs = diagnosticsRow.anchorPathPairRefs;
    const orderedPairs = diagnosticsRow.pathWorstEdgePair
      ? [
          diagnosticsRow.pathWorstEdgePair,
          ...pathPairs.filter(
            (pair) =>
              buildPairKey(pair.from, pair.to) !==
              buildPairKey(diagnosticsRow.pathWorstEdgePair!.from, diagnosticsRow.pathWorstEdgePair!.to),
          ),
        ]
      : pathPairs;
    orderedPairs.forEach((pair) => {
      const key = buildPairKey(pair.from, pair.to);
      if (prioritizedPairKeys.has(key)) return;
      prioritizedPairKeys.add(key);
      prioritizedPairs.push(pair);
    });
  });
  [...(base.weakGeometryDiagnostics?.relativeCues ?? [])]
    .sort((left, right) => {
      const severityDelta = severityWeight(right.severity) - severityWeight(left.severity);
      if (severityDelta !== 0) return severityDelta;
      return (right.distanceMetric ?? 0) - (left.distanceMetric ?? 0);
    })
    .forEach((cue) => {
      const key = buildPairKey(cue.from, cue.to);
      if (prioritizedPairKeys.has(key)) return;
      prioritizedPairKeys.add(key);
      prioritizedPairs.push({ from: cue.from, to: cue.to });
    });
  return {
    stationOrder,
    stationDiagnostics: diagnostics,
    prioritizedPairs,
    prioritizedStations,
    prioritizedPairKeys,
  };
};
