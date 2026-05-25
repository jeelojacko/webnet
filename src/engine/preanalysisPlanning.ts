import { isPreanalysisWhatIfCandidate } from './preanalysis';
import type {
  AdjustmentResult,
  Observation,
  PlanningMapPolygon,
  PlanningMapState,
  PreanalysisAddedSetPairRef,
  PreanalysisBracePreviewPoint,
  PreanalysisImpactDiagnostics,
  PreanalysisRecommendationKind,
  PreanalysisScenarioPreviewPoint,
  PreanalysisScenarioPreviewSegment,
  PreanalysisThresholdPlan,
  StationId,
  StationMap,
  WeakGeometrySeverity,
} from '../types';

export type PreanalysisSyntheticSetTemplate = {
  id: string;
  scenarioKind: PreanalysisRecommendationKind;
  actionMode: 'applyable-addition' | 'advisory';
  occupyStationId: StationId;
  setupStationIds: StationId[];
  templateLabel: string;
  sourceLines: number[];
  blockText: string;
  affectedStations: StationId[];
  affectedPairs: PreanalysisAddedSetPairRef[];
  corridorPairs?: PreanalysisAddedSetPairRef[];
  addedObservationCount: number;
  existingSetCount: number;
  previewPoints: PreanalysisScenarioPreviewPoint[];
  previewSegments: PreanalysisScenarioPreviewSegment[];
  rationale?: string;
  bracePreviewPoint?: {
    stationId: StationId;
    x: number;
    y: number;
    h: number;
  };
};

type PathGraphEdge = {
  from: StationId;
  to: StationId;
  metric: number;
};

type StationPathDiagnostics = {
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

type PathPrioritySummary = {
  stationOrder: StationId[];
  stationDiagnostics: Map<StationId, StationPathDiagnostics>;
  prioritizedPairs: PreanalysisAddedSetPairRef[];
  prioritizedStations: Set<StationId>;
  prioritizedPairKeys: Set<string>;
};

type BuildPreanalysisPlanningDiagnosticsArgs = {
  base: AdjustmentResult;
  input: string;
  planningMap: PlanningMapState;
  activeTemplateIds: string[];
  targetThresholdMeters?: number;
  maxAddedSets: number;
  solveScenario: (_activeTemplateIds: string[]) => AdjustmentResult;
};

const MAX_RECOMMENDATIONS = 5;
const MAX_BRACE_SCENARIOS = 5;
const MAX_SYNTHETIC_SETUP_SCENARIOS = 5;
const MAX_PROMOTED_SETUP_SCENARIOS = 5;
const MAX_CROSS_TIE_SCENARIOS = 8;
const MAX_BYPASS_ADVISORIES = 4;
const MAX_DECOMMISSION_ADVISORIES = 4;
const MAX_MOVE_SYNTHETIC_ADVISORIES = 3;
const MAX_RECOMMENDATION_SOLVE_CANDIDATES = 16;
const MAX_BRACE_SETUPS = 4;
const BRACE_OFFSET_RATIO = 0.35;
const MIN_BRACE_ANGLE_DEG = 45;
const MAX_BRACE_ANGLE_DEG = 120;
const MIN_BRACE_CLEARANCE_RATIO = 0.15;
const POLYGON_CLEARANCE_M = 1.5;

const medianOf = (values: number[]): number | undefined => {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return undefined;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : 0.5 * (sorted[mid - 1] + sorted[mid]);
};

const stationMajors = (res: AdjustmentResult): number[] =>
  (res.stationCovariances ?? []).map(
    (row) => row.ellipse?.semiMajor ?? Math.max(row.sigmaE, row.sigmaN),
  );

const relativeMetrics = (res: AdjustmentResult): number[] =>
  (res.relativeCovariances ?? []).map(
    (row) => row.sigmaDist ?? row.ellipse?.semiMajor ?? Math.max(row.sigmaE, row.sigmaN),
  );

const weakStationCount = (res: AdjustmentResult): number =>
  (res.weakGeometryDiagnostics?.stationCues ?? []).filter((cue) => cue.severity !== 'ok').length;

const weakPairCount = (res: AdjustmentResult): number =>
  (res.weakGeometryDiagnostics?.relativeCues ?? []).filter((cue) => cue.severity !== 'ok').length;

const severityWeight = (severity: WeakGeometrySeverity): number =>
  severity === 'weak' ? 2 : severity === 'watch' ? 1 : 0;

const recommendationKindTieOrder: PreanalysisRecommendationKind[] = [
  'existing-set',
  'cross-tie',
  'brace-point',
  'promoted-setup',
  'synthetic-setup',
  'move-synthetic',
  'bypass-intermediate',
  'decommission-intermediate',
];

const recommendationKindTieWeight = (kind: PreanalysisRecommendationKind): number =>
  recommendationKindTieOrder.indexOf(kind);

const sortStationIds = (left: StationId, right: StationId): number =>
  left.localeCompare(right, undefined, { numeric: true });

const buildPairKey = (from: StationId, to: StationId): string =>
  [from, to].sort(sortStationIds).join('|');

const templateCorridorPairs = (
  template: PreanalysisSyntheticSetTemplate,
): PreanalysisAddedSetPairRef[] =>
  template.corridorPairs != null && template.corridorPairs.length > 0
    ? template.corridorPairs
    : template.affectedPairs;

const compareStationIdArrays = (left: StationId[], right: StationId[]): number => {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const cmp = sortStationIds(left[index]!, right[index]!);
    if (cmp !== 0) return cmp;
  }
  return left.length - right.length;
};

const stationHasFiniteCoords = (stations: StationMap, stationId: StationId): boolean => {
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

const buildPathGraph = (base: AdjustmentResult): PathGraphEdge[] => {
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

const stationFixedRank = (station: StationMap[StationId] | undefined): number => {
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

const buildPathPrioritySummary = (base: AdjustmentResult): PathPrioritySummary => {
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

const isNetworkConnectedWithOptionalBypass = (
  edges: PathGraphEdge[],
  removedStationId: StationId,
  bypassPair?: PreanalysisAddedSetPairRef,
): boolean => {
  const adjacency = new Map<StationId, Set<StationId>>();
  const addLink = (from: StationId, to: StationId) => {
    if (from === removedStationId || to === removedStationId) return;
    const fromList = adjacency.get(from) ?? new Set<StationId>();
    const toList = adjacency.get(to) ?? new Set<StationId>();
    fromList.add(to);
    toList.add(from);
    adjacency.set(from, fromList);
    adjacency.set(to, toList);
  };
  edges.forEach((edge) => addLink(edge.from, edge.to));
  if (
    bypassPair &&
    bypassPair.from !== removedStationId &&
    bypassPair.to !== removedStationId
  ) {
    addLink(bypassPair.from, bypassPair.to);
  }
  const stationIds = [...adjacency.keys()].sort(sortStationIds);
  if (stationIds.length <= 1) return true;
  const visited = new Set<StationId>();
  const frontier = [stationIds[0]!];
  while (frontier.length > 0) {
    const current = frontier.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    [...(adjacency.get(current) ?? [])]
      .sort(sortStationIds)
      .forEach((nextStationId) => {
        if (!visited.has(nextStationId)) frontier.push(nextStationId);
      });
  }
  return stationIds.every((stationId) => visited.has(stationId));
};

const buildTemplateId = (occupy: StationId, targets: StationId[]): string =>
  `preanalysis-set:${occupy}:${targets.join('|')}`;

const buildTemplateLabel = (occupy: StationId, targets: StationId[]): string =>
  `${occupy} -> ${targets.join(', ')}`;

const buildBraceTemplateId = (left: StationId, right: StationId): string =>
  `preanalysis-brace:${[left, right].sort(sortStationIds).join('|')}`;

const buildPromotedTemplateId = (left: StationId, right: StationId): string =>
  `preanalysis-promoted:${[left, right].sort(sortStationIds).join('|')}`;

const buildSyntheticSetupTemplateId = (left: StationId, right: StationId, rank: number): string =>
  `preanalysis-synthsetup:${[left, right].sort(sortStationIds).join('|')}:${rank}`;

const buildCrossTieTemplateId = (from: StationId, to: StationId): string =>
  `preanalysis-crosstie:${[from, to].sort(sortStationIds).join('|')}`;

const buildOrdinalSyntheticStationId = (prefix: 'B' | 'P', ordinal: number): StationId =>
  `${prefix}-${ordinal}`;

const createSyntheticStationAllocator = (stations: StationMap) => {
  const usedIds = new Set(Object.keys(stations));
  let nextBraceOrdinal = 1;
  let nextSetupOrdinal = 1;
  const allocate = (prefix: 'B' | 'P', nextOrdinalRef: { current: number }): StationId => {
    while (usedIds.has(buildOrdinalSyntheticStationId(prefix, nextOrdinalRef.current))) {
      nextOrdinalRef.current += 1;
    }
    const stationId = buildOrdinalSyntheticStationId(prefix, nextOrdinalRef.current);
    usedIds.add(stationId);
    nextOrdinalRef.current += 1;
    return stationId;
  };
  const braceRef = { current: nextBraceOrdinal };
  const setupRef = { current: nextSetupOrdinal };
  return {
    nextBraceId: (): StationId => allocate('B', braceRef),
    nextSetupId: (): StationId => allocate('P', setupRef),
  };
};

const buildBraceTemplateLabel = (braceStationId: StationId, left: StationId, right: StationId): string =>
  `Brace ${braceStationId} [${left}-${right}]`;

const buildPromotedTemplateLabel = (
  setupStationId: StationId,
  anchorIds: StationId[],
): string => `Promote ${setupStationId} [${anchorIds.join('-')}]`;

const buildSyntheticSetupTemplateLabel = (
  setupStationId: StationId,
  anchorIds: StationId[],
): string => `Synthetic ${setupStationId} [${anchorIds.join('-')}]`;

const buildCrossTieTemplateLabel = (from: StationId, to: StationId): string =>
  `Cross-tie ${from} -> ${to}`;

const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

const interiorAngleAtPointDeg = (
  left: { x: number; y: number },
  apex: { x: number; y: number },
  right: { x: number; y: number },
): number => {
  const ax = left.x - apex.x;
  const ay = left.y - apex.y;
  const bx = right.x - apex.x;
  const by = right.y - apex.y;
  const magA = Math.hypot(ax, ay);
  const magB = Math.hypot(bx, by);
  if (magA <= 0 || magB <= 0) return 180;
  const cosTheta = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (magA * magB)));
  return toDegrees(Math.acos(cosTheta));
};

const minBraceClearance = (
  stations: StationMap,
  point: { x: number; y: number },
  excludedIds: Set<StationId>,
): number => {
  let minDistance = Number.POSITIVE_INFINITY;
  Object.entries(stations).forEach(([stationId, station]) => {
    if (excludedIds.has(stationId)) return;
    if (!Number.isFinite(station.x) || !Number.isFinite(station.y)) return;
    minDistance = Math.min(minDistance, Math.hypot(point.x - station.x, point.y - station.y));
  });
  return minDistance;
};

const toSegmentDistance = (
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): number => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const denom = dx * dx + dy * dy;
  if (denom <= 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / denom));
  return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t));
};

const pointInPolygon = (point: { x: number; y: number }, polygon: PlanningMapPolygon): boolean => {
  let inside = false;
  for (let i = 0, j = polygon.vertices.length - 1; i < polygon.vertices.length; j = i, i += 1) {
    const a = polygon.vertices[i]!;
    const b = polygon.vertices[j]!;
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / Math.max(1e-12, b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
};

const polygonClearance = (point: { x: number; y: number }, polygon: PlanningMapPolygon): number => {
  let minDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.vertices.length; index += 1) {
    const start = polygon.vertices[index]!;
    const end = polygon.vertices[(index + 1) % polygon.vertices.length]!;
    minDistance = Math.min(minDistance, toSegmentDistance(point, start, end));
  }
  return minDistance;
};

const orientation = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number =>
  (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);

const onSegment = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): boolean =>
  b.x <= Math.max(a.x, c.x) + 1e-9 &&
  b.x + 1e-9 >= Math.min(a.x, c.x) &&
  b.y <= Math.max(a.y, c.y) + 1e-9 &&
  b.y + 1e-9 >= Math.min(a.y, c.y);

const segmentsIntersect = (
  p1: { x: number; y: number },
  q1: { x: number; y: number },
  p2: { x: number; y: number },
  q2: { x: number; y: number },
): boolean => {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  if (Math.abs(o1) <= 1e-9 && onSegment(p1, p2, q1)) return true;
  if (Math.abs(o2) <= 1e-9 && onSegment(p1, q2, q1)) return true;
  if (Math.abs(o3) <= 1e-9 && onSegment(p2, p1, q2)) return true;
  if (Math.abs(o4) <= 1e-9 && onSegment(p2, q1, q2)) return true;
  return false;
};

const segmentIntersectsPolygon = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  polygon: PlanningMapPolygon,
): boolean => {
  if (pointInPolygon(start, polygon) || pointInPolygon(end, polygon)) return true;
  for (let index = 0; index < polygon.vertices.length; index += 1) {
    const edgeStart = polygon.vertices[index]!;
    const edgeEnd = polygon.vertices[(index + 1) % polygon.vertices.length]!;
    if (segmentsIntersect(start, end, edgeStart, edgeEnd)) return true;
  }
  return false;
};

const pointBlockedByPolygons = (
  point: { x: number; y: number },
  polygons: PlanningMapPolygon[],
): boolean =>
  polygons.some(
    (polygon) => pointInPolygon(point, polygon) || polygonClearance(point, polygon) < POLYGON_CLEARANCE_M,
  );

const sightLineBlocked = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  polygons: PlanningMapPolygon[],
): boolean => polygons.some((polygon) => segmentIntersectsPolygon(start, end, polygon));

const chooseBracePointCandidate = (
  stations: StationMap,
  leftId: StationId,
  rightId: StationId,
  blockedPolygons: PlanningMapPolygon[] = [],
): { x: number; y: number; h: number } | null => {
  const left = stations[leftId];
  const right = stations[rightId];
  if (
    left == null ||
    right == null ||
    !Number.isFinite(left.x) ||
    !Number.isFinite(left.y) ||
    !Number.isFinite(right.x) ||
    !Number.isFinite(right.y)
  ) {
    return null;
  }
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance <= 0) return null;
  const midX = 0.5 * (left.x + right.x);
  const midY = 0.5 * (left.y + right.y);
  const offset = distance * BRACE_OFFSET_RATIO;
  const perpX = -dy / distance;
  const perpY = dx / distance;
  const centroid = Object.values(stations).reduce(
    (acc, station) => {
      if (!Number.isFinite(station.x) || !Number.isFinite(station.y)) return acc;
      acc.x += station.x;
      acc.y += station.y;
      acc.count += 1;
      return acc;
    },
    { x: 0, y: 0, count: 0 },
  );
  const centroidX = centroid.count > 0 ? centroid.x / centroid.count : midX;
  const centroidY = centroid.count > 0 ? centroid.y / centroid.count : midY;
  const excludedIds = new Set<StationId>([leftId, rightId]);
  const candidates = [1, -1]
    .map((sign) => {
      const point = {
        x: midX + perpX * offset * sign,
        y: midY + perpY * offset * sign,
      };
      return {
        ...point,
        scoreToCentroid: Math.hypot(point.x - centroidX, point.y - centroidY),
        clearance: minBraceClearance(stations, point, excludedIds),
        angleDeg: interiorAngleAtPointDeg(left, point, right),
      };
    })
    .filter(
      (candidate) =>
        candidate.angleDeg >= MIN_BRACE_ANGLE_DEG &&
        candidate.angleDeg <= MAX_BRACE_ANGLE_DEG &&
        candidate.clearance >= distance * MIN_BRACE_CLEARANCE_RATIO &&
        !pointBlockedByPolygons(candidate, blockedPolygons),
    )
    .sort((leftCandidate, rightCandidate) => {
      if (rightCandidate.clearance !== leftCandidate.clearance) {
        return rightCandidate.clearance - leftCandidate.clearance;
      }
      return leftCandidate.scoreToCentroid - rightCandidate.scoreToCentroid;
    });
  const best = candidates[0];
  if (!best) return null;
  return {
    x: best.x,
    y: best.y,
    h:
      Number.isFinite(left.h) && Number.isFinite(right.h)
        ? 0.5 * (left.h + right.h)
        : Number.isFinite(left.h)
          ? left.h
          : Number.isFinite(right.h)
            ? right.h
            : 0,
  };
};

const buildBraceBlockText = (
  braceStationId: StationId,
  point: { x: number; y: number; h: number },
  setupStationIds: StationId[],
): string =>
  [
    `C ${braceStationId} ${point.x.toFixed(4)} ${point.y.toFixed(4)} ${point.h.toFixed(4)}`,
    ...setupStationIds.flatMap((setupId) => [`DB ${setupId}`, `DM ${braceStationId}`, 'DE']),
  ].join('\n');

const buildSetupBlockText = (
  setupStationId: StationId,
  point: { x: number; y: number; h: number },
  targetIds: StationId[],
): string =>
  [
    `C ${setupStationId} ${point.x.toFixed(4)} ${point.y.toFixed(4)} ${point.h.toFixed(4)}`,
    `DB ${setupStationId}`,
    ...targetIds.map((targetId) => `DM ${targetId}`),
    'DE',
  ].join('\n');

const buildCrossTieBlockText = (from: StationId, to: StationId): string =>
  [`DB ${from}`, `DM ${to}`, 'DE'].join('\n');

const buildPreviewPoints = (
  stations: StationMap,
  anchorIds: StationId[],
  syntheticPoints: Array<{
    stationId: StationId;
    x: number;
    y: number;
    h: number;
    role: 'brace' | 'setup';
  }>,
): PreanalysisScenarioPreviewPoint[] => {
  const anchorPoints: PreanalysisScenarioPreviewPoint[] = anchorIds
    .map((stationId) => {
      const station = stations[stationId];
      if (!station) return null;
      return {
        stationId,
        x: station.x,
        y: station.y,
        h: station.h,
        role: 'anchor' as const,
        active: false,
      };
    })
    .filter((point): point is NonNullable<typeof point> => point != null);
  const syntheticPreviewPoints: PreanalysisScenarioPreviewPoint[] = syntheticPoints.map((point) => ({
    ...point,
    active: false,
  }));
  return [...anchorPoints, ...syntheticPreviewPoints];
};

const buildPreviewSegments = (
  anchorIds: StationId[],
  syntheticStationId: StationId,
  kind: 'sight-line' | 'cross-tie' = 'sight-line',
): PreanalysisScenarioPreviewSegment[] =>
  anchorIds.map((anchorId) => ({
    fromStationId: anchorId,
    toStationId: syntheticStationId,
    kind,
    active: false,
  }));

const resolveObstacleGroups = (planningMap: PlanningMapState): {
  hard: PlanningMapPolygon[];
  soft: PlanningMapPolygon[];
  all: PlanningMapPolygon[];
} => {
  const hard = [
    ...planningMap.blockedPolygons,
    ...planningMap.obstaclePolygons.filter((polygon) => polygon.kind !== 'wooded'),
  ];
  const soft = planningMap.obstaclePolygons.filter((polygon) => polygon.kind === 'wooded');
  return {
    hard,
    soft,
    all: [...hard, ...soft],
  };
};

const occupiedStationIdsFromTemplates = (templates: PreanalysisSyntheticSetTemplate[]): StationId[] =>
  [...new Set(templates.map((template) => template.occupyStationId))].sort(sortStationIds);

const filterVisibleAnchorIds = (
  stations: StationMap,
  candidatePoint: { x: number; y: number },
  occupiedStationIds: StationId[],
  hardPolygons: PlanningMapPolygon[],
  softPolygons: PlanningMapPolygon[],
): StationId[] => {
  const collectVisible = (polygons: PlanningMapPolygon[]) =>
    occupiedStationIds.filter((stationId) => {
      const station = stations[stationId];
      if (!station || !Number.isFinite(station.x) || !Number.isFinite(station.y)) return false;
      return !sightLineBlocked(candidatePoint, station, polygons);
    });
  const strictVisible = collectVisible([...hardPolygons, ...softPolygons]);
  return strictVisible.length > 0 ? strictVisible : collectVisible(hardPolygons);
};

const chooseBracePointCandidateWithFallback = (
  stations: StationMap,
  leftId: StationId,
  rightId: StationId,
  hardPolygons: PlanningMapPolygon[],
  softPolygons: PlanningMapPolygon[],
): { x: number; y: number; h: number } | null =>
  chooseBracePointCandidate(stations, leftId, rightId, [...hardPolygons, ...softPolygons]) ??
  chooseBracePointCandidate(stations, leftId, rightId, hardPolygons);

const buildBraceTemplates = (
  base: AdjustmentResult,
  existingTemplates: PreanalysisSyntheticSetTemplate[],
  planningMap: PlanningMapState,
  stationAllocator: ReturnType<typeof createSyntheticStationAllocator>,
  pathSummary: PathPrioritySummary,
): PreanalysisSyntheticSetTemplate[] => {
  const obstacleGroups = resolveObstacleGroups(planningMap);
  const occupiedIds = new Set(existingTemplates.map((template) => template.occupyStationId));
  const sourceLineByOccupyId = new Map(
    existingTemplates
      .filter((template) => template.sourceLines.length > 0)
      .map((template) => [template.occupyStationId, template.sourceLines[0]]),
  );
  const usedTemplateIds = new Set(existingTemplates.map((template) => template.id));
  const braceTemplates: PreanalysisSyntheticSetTemplate[] = [];
  const seenIds = new Set<string>();
  pathSummary.prioritizedPairs.forEach((pair) => {
    if (braceTemplates.length >= MAX_BRACE_SCENARIOS) return;
    const sortedPair = [pair.from, pair.to].sort(sortStationIds);
    const [leftId, rightId] = sortedPair;
    if (!occupiedIds.has(leftId) || !occupiedIds.has(rightId)) return;
    if (!stationHasFiniteCoords(base.stations, leftId) || !stationHasFiniteCoords(base.stations, rightId)) {
      return;
    }
    const id = buildBraceTemplateId(leftId, rightId);
    if (seenIds.has(id) || usedTemplateIds.has(id)) return;
    const point = chooseBracePointCandidateWithFallback(
      base.stations,
      leftId,
      rightId,
      obstacleGroups.hard,
      obstacleGroups.soft,
    );
    if (!point) return;
    const braceStationId = stationAllocator.nextBraceId();
    if (base.stations[braceStationId] != null) return;
    const extraVisibleSetups = filterVisibleAnchorIds(
      base.stations,
      point,
      occupiedStationIdsFromTemplates(existingTemplates),
      obstacleGroups.hard,
      obstacleGroups.soft,
    )
      .filter((stationId) => stationId !== leftId && stationId !== rightId)
      .slice(0, Math.max(0, MAX_BRACE_SETUPS - 2));
    const setupStationIds = [leftId, rightId, ...extraVisibleSetups];
    seenIds.add(id);
    braceTemplates.push({
      id,
      scenarioKind: 'brace-point',
      actionMode: 'applyable-addition',
      occupyStationId: leftId,
      setupStationIds,
      templateLabel: buildBraceTemplateLabel(braceStationId, leftId, rightId),
      sourceLines: setupStationIds.map((stationId) => sourceLineByOccupyId.get(stationId)).filter(
        (line): line is number => line != null,
      ),
      blockText: buildBraceBlockText(braceStationId, point, setupStationIds),
      affectedStations: [...setupStationIds, braceStationId],
      affectedPairs: [
        ...setupStationIds.map((setupId) => ({ from: setupId, to: braceStationId })),
      ],
      corridorPairs: [{ from: leftId, to: rightId }],
      addedObservationCount: setupStationIds.length,
      existingSetCount: 0,
      rationale: `Strengthens anchor-path bottleneck ${leftId}-${rightId} with a bounded brace point.`,
      bracePreviewPoint: {
        stationId: braceStationId,
        x: point.x,
        y: point.y,
        h: point.h,
      },
      previewPoints: buildPreviewPoints(base.stations, setupStationIds, [
        { stationId: braceStationId, x: point.x, y: point.y, h: point.h, role: 'brace' },
      ]),
      previewSegments: buildPreviewSegments(setupStationIds, braceStationId),
    });
  });
  return braceTemplates.sort(
    (left, right) =>
      left.occupyStationId.localeCompare(right.occupyStationId, undefined, { numeric: true }) ||
      left.templateLabel.localeCompare(right.templateLabel, undefined, { numeric: true }),
  );
};

const buildPromotedSetupTemplates = (
  base: AdjustmentResult,
  existingTemplates: PreanalysisSyntheticSetTemplate[],
  planningMap: PlanningMapState,
  stationAllocator: ReturnType<typeof createSyntheticStationAllocator>,
  pathSummary: PathPrioritySummary,
): PreanalysisSyntheticSetTemplate[] => {
  if (!planningMap.scenarioFamilies.promotedSetup) return [];
  const obstacleGroups = resolveObstacleGroups(planningMap);
  const occupiedIds = occupiedStationIdsFromTemplates(existingTemplates);
  const usedTemplateIds = new Set(existingTemplates.map((template) => template.id));
  const templates: PreanalysisSyntheticSetTemplate[] = [];
  pathSummary.prioritizedPairs.forEach((pair) => {
    if (templates.length >= MAX_PROMOTED_SETUP_SCENARIOS) return;
    const point = chooseBracePointCandidateWithFallback(
      base.stations,
      pair.from,
      pair.to,
      obstacleGroups.hard,
      obstacleGroups.soft,
    );
    if (!point) return;
    const visibleAnchors = filterVisibleAnchorIds(
      base.stations,
      point,
      occupiedIds,
      obstacleGroups.hard,
      obstacleGroups.soft,
    ).slice(0, MAX_BRACE_SETUPS);
    if (visibleAnchors.length < 3) return;
    const setupStationId = stationAllocator.nextSetupId();
    if (base.stations[setupStationId] != null) return;
    const id = buildPromotedTemplateId(pair.from, pair.to);
    if (usedTemplateIds.has(id)) return;
    templates.push({
      id,
      scenarioKind: 'promoted-setup',
      actionMode: 'applyable-addition',
      occupyStationId: setupStationId,
      setupStationIds: [setupStationId, ...visibleAnchors],
      templateLabel: buildPromotedTemplateLabel(setupStationId, visibleAnchors),
      sourceLines: [],
      blockText: buildSetupBlockText(setupStationId, point, visibleAnchors),
      affectedStations: [setupStationId, ...visibleAnchors],
      affectedPairs: visibleAnchors.map((anchorId) => ({ from: setupStationId, to: anchorId })),
      corridorPairs: [{ from: pair.from, to: pair.to }],
      addedObservationCount: visibleAnchors.length,
      existingSetCount: 0,
      rationale: `Promotes a new setup to strengthen visibility across bottleneck pair ${pair.from}-${pair.to}.`,
      previewPoints: buildPreviewPoints(base.stations, visibleAnchors, [
        { stationId: setupStationId, x: point.x, y: point.y, h: point.h, role: 'setup' },
      ]),
      previewSegments: buildPreviewSegments(visibleAnchors, setupStationId),
    });
  });
  return templates;
};

const buildSyntheticSetupTemplates = (
  base: AdjustmentResult,
  existingTemplates: PreanalysisSyntheticSetTemplate[],
  planningMap: PlanningMapState,
  stationAllocator: ReturnType<typeof createSyntheticStationAllocator>,
  pathSummary: PathPrioritySummary,
): PreanalysisSyntheticSetTemplate[] => {
  if (!planningMap.scenarioFamilies.syntheticSetup) return [];
  const obstacleGroups = resolveObstacleGroups(planningMap);
  const occupiedIds = occupiedStationIdsFromTemplates(existingTemplates);
  const templates: PreanalysisSyntheticSetTemplate[] = [];
  pathSummary.prioritizedPairs.forEach((pair) => {
    if (templates.length >= MAX_SYNTHETIC_SETUP_SCENARIOS) return;
    const point = chooseBracePointCandidateWithFallback(
      base.stations,
      pair.from,
      pair.to,
      obstacleGroups.hard,
      obstacleGroups.soft,
    );
    if (!point) return;
    const visibleAnchors = filterVisibleAnchorIds(
      base.stations,
      point,
      occupiedIds,
      obstacleGroups.hard,
      obstacleGroups.soft,
    ).slice(0, MAX_BRACE_SETUPS);
    if (visibleAnchors.length < 3) return;
    const setupStationId = stationAllocator.nextSetupId();
    if (base.stations[setupStationId] != null) return;
    templates.push({
      id: buildSyntheticSetupTemplateId(pair.from, pair.to, templates.length + 1),
      scenarioKind: 'synthetic-setup',
      actionMode: 'applyable-addition',
      occupyStationId: setupStationId,
      setupStationIds: [setupStationId, ...visibleAnchors],
      templateLabel: buildSyntheticSetupTemplateLabel(setupStationId, visibleAnchors),
      sourceLines: [],
      blockText: buildSetupBlockText(setupStationId, point, visibleAnchors),
      affectedStations: [setupStationId, ...visibleAnchors],
      affectedPairs: visibleAnchors.map((anchorId) => ({ from: setupStationId, to: anchorId })),
      corridorPairs: [{ from: pair.from, to: pair.to }],
      addedObservationCount: visibleAnchors.length,
      existingSetCount: 0,
      rationale: `Adds a synthetic setup positioned to shorten the weak chain back to control across ${pair.from}-${pair.to}.`,
      previewPoints: buildPreviewPoints(base.stations, visibleAnchors, [
        { stationId: setupStationId, x: point.x, y: point.y, h: point.h, role: 'setup' },
      ]),
      previewSegments: buildPreviewSegments(visibleAnchors, setupStationId),
    });
  });
  return templates;
};

const buildCrossTieTemplates = (
  base: AdjustmentResult,
  existingTemplates: PreanalysisSyntheticSetTemplate[],
  planningMap: PlanningMapState,
  pathSummary: PathPrioritySummary,
): PreanalysisSyntheticSetTemplate[] => {
  if (!planningMap.scenarioFamilies.crossTie) return [];
  const obstacleGroups = resolveObstacleGroups(planningMap);
  const existingPairKeys = new Set(
    existingTemplates.flatMap((template) =>
      template.affectedPairs.map((pair) => [pair.from, pair.to].sort(sortStationIds).join('|')),
    ),
  );
  const rows: PreanalysisSyntheticSetTemplate[] = [];
  pathSummary.prioritizedPairs.forEach((pair) => {
    if (rows.length >= MAX_CROSS_TIE_SCENARIOS) return;
    const key = [pair.from, pair.to].sort(sortStationIds).join('|');
    if (existingPairKeys.has(key)) return;
    const fromStation = base.stations[pair.from];
    const toStation = base.stations[pair.to];
    if (!fromStation || !toStation || sightLineBlocked(fromStation, toStation, obstacleGroups.hard)) return;
    const clearOfAllObstacles = !sightLineBlocked(fromStation, toStation, obstacleGroups.all);
    if (!clearOfAllObstacles && rows.length > 0) return;
    rows.push({
      id: buildCrossTieTemplateId(pair.from, pair.to),
      scenarioKind: 'cross-tie',
      actionMode: 'applyable-addition',
      occupyStationId: pair.from,
      setupStationIds: [pair.from],
      templateLabel: buildCrossTieTemplateLabel(pair.from, pair.to),
      sourceLines: [],
      blockText: buildCrossTieBlockText(pair.from, pair.to),
      affectedStations: [pair.from, pair.to],
      affectedPairs: [{ from: pair.from, to: pair.to }],
      corridorPairs: [{ from: pair.from, to: pair.to }],
      addedObservationCount: 1,
      existingSetCount: 0,
      rationale: `Adds a direct tie to bypass weak accumulation along the ${pair.from}-${pair.to} corridor.`,
      previewPoints: buildPreviewPoints(base.stations, [pair.from, pair.to], []),
      previewSegments: [
        {
          fromStationId: pair.from,
          toStationId: pair.to,
          kind: 'cross-tie',
          active: false,
        },
      ],
    });
  });
  return rows;
};

const buildAdvisoryTemplates = (
  base: AdjustmentResult,
  additiveTemplates: PreanalysisSyntheticSetTemplate[],
  planningMap: PlanningMapState,
  activeTemplateIds: string[],
  pathSummary: PathPrioritySummary,
): PreanalysisSyntheticSetTemplate[] => {
  const obstacleGroups = resolveObstacleGroups(planningMap);
  const existingPairKeys = new Set(
    additiveTemplates.flatMap((template) =>
      template.affectedPairs.map((pair) => buildPairKey(pair.from, pair.to)),
    ),
  );
  const graphEdges = buildPathGraph(base);
  const degreeByStation = new Map<StationId, number>();
  graphEdges.forEach((edge) => {
    degreeByStation.set(edge.from, (degreeByStation.get(edge.from) ?? 0) + 1);
    degreeByStation.set(edge.to, (degreeByStation.get(edge.to) ?? 0) + 1);
  });
  const advisoryTemplates: PreanalysisSyntheticSetTemplate[] = [];
  pathSummary.stationOrder.slice(0, 4).forEach((stationId) => {
    const diagnostics = pathSummary.stationDiagnostics.get(stationId);
    if (!diagnostics || diagnostics.anchorPathStationIds.length < 3) return;
    for (let index = 0; index <= diagnostics.anchorPathStationIds.length - 3; index += 1) {
      if (advisoryTemplates.filter((row) => row.scenarioKind === 'bypass-intermediate').length >= MAX_BYPASS_ADVISORIES) {
        break;
      }
      const left = diagnostics.anchorPathStationIds[index]!;
      const middle = diagnostics.anchorPathStationIds[index + 1]!;
      const right = diagnostics.anchorPathStationIds[index + 2]!;
      const bypassKey = buildPairKey(left, right);
      if (existingPairKeys.has(bypassKey)) continue;
      const leftStation = base.stations[left];
      const rightStation = base.stations[right];
      if (!leftStation || !rightStation || sightLineBlocked(leftStation, rightStation, obstacleGroups.hard)) {
        continue;
      }
      const bypassTemplateId = `preanalysis-bypass:${left}|${middle}|${right}`;
      advisoryTemplates.push({
        id: bypassTemplateId,
        scenarioKind: 'bypass-intermediate',
        actionMode: 'advisory',
        occupyStationId: left,
        setupStationIds: [left],
        templateLabel: `Bypass ${middle} via ${left} -> ${right}`,
        sourceLines: [],
        blockText: buildCrossTieBlockText(left, right),
        affectedStations: [left, middle, right],
        affectedPairs: [{ from: left, to: right }],
        corridorPairs: [{ from: left, to: right }],
        addedObservationCount: 1,
        existingSetCount: 0,
        rationale: `Directly tie ${left} to ${right} to bypass bottleneck accumulation through ${middle}.`,
        previewPoints: buildPreviewPoints(base.stations, [left, middle, right], []),
        previewSegments: [
          {
            fromStationId: left,
            toStationId: right,
            kind: 'cross-tie',
            active: false,
          },
        ],
      });
      const middleStation = base.stations[middle];
      if (
        advisoryTemplates.filter((row) => row.scenarioKind === 'decommission-intermediate').length <
          MAX_DECOMMISSION_ADVISORIES &&
        stationFixedRank(middleStation) === 0 &&
        (degreeByStation.get(middle) ?? 0) === 2 &&
        isNetworkConnectedWithOptionalBypass(graphEdges, middle, { from: left, to: right })
      ) {
        advisoryTemplates.push({
          id: `preanalysis-decommission:${left}|${middle}|${right}`,
          scenarioKind: 'decommission-intermediate',
          actionMode: 'advisory',
          occupyStationId: middle,
          setupStationIds: [middle],
          templateLabel: `Decommission ${middle} after ${left} -> ${right}`,
          sourceLines: [],
          blockText: buildCrossTieBlockText(left, right),
          affectedStations: [left, middle, right],
          affectedPairs: [{ from: left, to: right }],
          corridorPairs: [{ from: left, to: right }],
          addedObservationCount: 1,
          existingSetCount: 0,
          rationale: `If ${left} -> ${right} is added, ${middle} can be removed from the weak chain without disconnecting control.`,
          previewPoints: buildPreviewPoints(base.stations, [left, middle, right], []),
          previewSegments: [
            {
              fromStationId: left,
              toStationId: right,
              kind: 'cross-tie',
              active: false,
            },
          ],
        });
      }
    }
  });
  const additiveTemplateById = new Map(additiveTemplates.map((template) => [template.id, template]));
  const isSyntheticScenario = (template: PreanalysisSyntheticSetTemplate | undefined): boolean =>
    template != null &&
    (template.scenarioKind === 'brace-point' ||
      template.scenarioKind === 'promoted-setup' ||
      template.scenarioKind === 'synthetic-setup');
  const activeSyntheticTemplates = activeTemplateIds
    .map((id) => additiveTemplateById.get(id))
    .filter((template): template is PreanalysisSyntheticSetTemplate => isSyntheticScenario(template));
  const moveRowCandidates: Array<PreanalysisSyntheticSetTemplate | null> = activeSyntheticTemplates
    .map((activeTemplate) => {
      const activePairKeys = new Set(
        templateCorridorPairs(activeTemplate).map((pair) => buildPairKey(pair.from, pair.to)),
      );
      const preferredCandidate = additiveTemplates.find(
        (template) =>
          isSyntheticScenario(template) &&
          template.id !== activeTemplate.id &&
          !activeTemplateIds.includes(template.id) &&
          templateCorridorPairs(template).some((pair) =>
            pathSummary.prioritizedPairKeys.has(buildPairKey(pair.from, pair.to)),
          ) &&
          templateCorridorPairs(template).some(
            (pair) => !activePairKeys.has(buildPairKey(pair.from, pair.to)),
          ),
      );
      if (!preferredCandidate) return null;
      return {
        ...preferredCandidate,
        id: `preanalysis-move:${activeTemplate.id}->${preferredCandidate.id}`,
        scenarioKind: 'move-synthetic' as const,
        actionMode: 'advisory' as const,
        occupyStationId: activeTemplate.occupyStationId,
        setupStationIds: [...activeTemplate.setupStationIds],
        templateLabel: `Move ${activeTemplate.templateLabel} -> ${preferredCandidate.templateLabel}`,
        rationale: `Move active synthetic geometry from ${activeTemplate.templateLabel} to ${preferredCandidate.templateLabel} so it strengthens the current bottleneck corridor first.`,
      } satisfies PreanalysisSyntheticSetTemplate;
    });
  const moveRows = moveRowCandidates
    .filter((template): template is PreanalysisSyntheticSetTemplate => template != null)
    .slice(0, MAX_MOVE_SYNTHETIC_ADVISORIES);
  return [...advisoryTemplates, ...moveRows];
};

export const buildPreanalysisSyntheticSetTemplates = (
  input: string,
  base: AdjustmentResult,
  planningMap: PlanningMapState,
  activeTemplateIds: string[] = [],
): PreanalysisSyntheticSetTemplate[] => {
  const lines = input.split(/\r?\n/);
  const originalLineCount = lines.length;
  const observations = base.observations.filter(
    (obs) =>
      isPreanalysisWhatIfCandidate(obs) &&
      obs.setId != null &&
      obs.sourceLine != null &&
      obs.sourceLine >= 1 &&
      obs.sourceLine <= originalLineCount,
  );
  const setGroups = new Map<string, Observation[]>();
  observations.forEach((obs) => {
    const key = String(obs.setId);
    const group = setGroups.get(key);
    if (group) group.push(obs);
    else setGroups.set(key, [obs]);
  });

  const deduped = new Map<string, PreanalysisSyntheticSetTemplate>();
  [...setGroups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .forEach(([, setObservations]) => {
      const sourceLines = [...new Set(setObservations.map((obs) => obs.sourceLine ?? 0))]
        .filter((line) => line > 0)
        .sort((left, right) => left - right);
      if (sourceLines.length === 0) return;
      let startLine = sourceLines[0];
      let endLine = sourceLines[sourceLines.length - 1];
      while (startLine > 1) {
        const prior = lines[startLine - 2]?.trim().toUpperCase() ?? '';
        if (prior.startsWith('DB ')) {
          startLine -= 1;
          break;
        }
        if (prior === 'DE') break;
        startLine -= 1;
      }
      while (endLine < originalLineCount) {
        const next = lines[endLine]?.trim().toUpperCase() ?? '';
        if (next === 'DE') {
          endLine += 1;
          break;
        }
        endLine += 1;
      }
      const blockLines = lines.slice(startLine - 1, endLine).filter((line) => line.trim().length > 0);
      if (blockLines.length === 0) return;
      const occupyStationId =
        setObservations.find((obs) => 'at' in obs)?.at ??
        setObservations.find((obs) => 'from' in obs)?.from;
      if (!occupyStationId) return;
      const targetIds = [...new Set(
        setObservations.flatMap((obs) => {
          if ('at' in obs && 'to' in obs) return [obs.to];
          if ('from' in obs && 'to' in obs && obs.from === occupyStationId) return [obs.to];
          return [];
        }),
      )];
      if (targetIds.length === 0) return;
      const affectedStations = [occupyStationId, ...targetIds];
      const affectedPairs = targetIds.map((targetId) => ({ from: occupyStationId, to: targetId }));
      const id = buildTemplateId(occupyStationId, targetIds);
      const blockText = blockLines.join('\n');
      const existing = deduped.get(id);
      if (existing) {
        existing.existingSetCount += 1;
        return;
      }
      deduped.set(id, {
        id,
        scenarioKind: 'existing-set',
        actionMode: 'applyable-addition',
        occupyStationId,
        setupStationIds: [occupyStationId],
        templateLabel: buildTemplateLabel(occupyStationId, targetIds),
        sourceLines: Array.from(
          { length: Math.max(0, endLine - startLine + 1) },
          (_, idx) => startLine + idx,
        ),
        blockText,
        affectedStations,
      affectedPairs,
      corridorPairs: affectedPairs.map((pair) => ({ ...pair })),
      addedObservationCount: setObservations.length,
        existingSetCount: 1,
        rationale: `Repeat the ${occupyStationId} setup set to strengthen the current control path through its existing observations.`,
        previewPoints: buildPreviewPoints(base.stations, affectedStations, []),
        previewSegments: targetIds.map((targetId) => ({
          fromStationId: occupyStationId,
          toStationId: targetId,
          kind: 'sight-line' as const,
          active: false,
        })),
      });
    });

  const repeatedSetTemplates = [...deduped.values()].sort(
    (left, right) =>
      left.occupyStationId.localeCompare(right.occupyStationId, undefined, { numeric: true }) ||
      left.templateLabel.localeCompare(right.templateLabel, undefined, { numeric: true }),
  );
  const stationAllocator = createSyntheticStationAllocator(base.stations);
  const pathSummary = buildPathPrioritySummary(base);
  const additiveTemplates = [
    ...repeatedSetTemplates,
    ...(planningMap.scenarioFamilies.bracePoint
      ? buildBraceTemplates(base, repeatedSetTemplates, planningMap, stationAllocator, pathSummary)
      : []),
    ...buildPromotedSetupTemplates(
      base,
      repeatedSetTemplates,
      planningMap,
      stationAllocator,
      pathSummary,
    ),
    ...buildSyntheticSetupTemplates(
      base,
      repeatedSetTemplates,
      planningMap,
      stationAllocator,
      pathSummary,
    ),
    ...buildCrossTieTemplates(base, repeatedSetTemplates, planningMap, pathSummary),
  ];
  return [
    ...additiveTemplates,
    ...buildAdvisoryTemplates(
      base,
      additiveTemplates,
      planningMap,
      activeTemplateIds,
      pathSummary,
    ),
  ];
};

export const buildSyntheticPreanalysisInput = (
  input: string,
  activeTemplateIds: string[],
  templates: PreanalysisSyntheticSetTemplate[],
): string => {
  if (activeTemplateIds.length === 0) return input;
  const templateById = new Map(templates.map((template) => [template.id, template]));
  const appendedBlocks = activeTemplateIds
    .map((id, index) => {
      const template = templateById.get(id);
      if (!template || template.actionMode !== 'applyable-addition') return null;
      return [
        `# WEBNET_PREANALYSIS_ADDED_SET ${template.id} ${index + 1}`,
        template.blockText,
      ].join('\n');
    })
    .filter((block): block is string => block != null);
  if (appendedBlocks.length === 0) return input;
  return `${input.trimEnd()}\n\n${appendedBlocks.join('\n\n')}\n`;
};

type RecommendationEvaluation = {
  row: PreanalysisImpactDiagnostics['rows'][number];
  stationComparisons: Array<{
    stationId: StationId;
    deltaMajor: number;
    deltaPathWorst: number;
    deltaPathTotal: number;
  }>;
};

const deltaMetric = (next?: number, current?: number): number => {
  const nextValue = Number.isFinite(next) ? (next as number) : undefined;
  const currentValue = Number.isFinite(current) ? (current as number) : undefined;
  if (nextValue != null && currentValue != null) return nextValue - currentValue;
  if (nextValue != null && currentValue == null) return nextValue;
  if (nextValue == null && currentValue != null) return Number.POSITIVE_INFINITY;
  return 0;
};

const candidateScore = (base: AdjustmentResult, alt: AdjustmentResult, pathSummary: PathPrioritySummary): number => {
  const baseWorstStation = stationMajors(base);
  const altWorstStation = stationMajors(alt);
  const baseWorstStationMajor =
    baseWorstStation.length > 0 ? Math.max(...baseWorstStation) : undefined;
  const altWorstStationMajor = altWorstStation.length > 0 ? Math.max(...altWorstStation) : undefined;
  const baseMedianStationMajor = medianOf(baseWorstStation);
  const altMedianStationMajor = medianOf(altWorstStation);
  const baseWorstPair = relativeMetrics(base);
  const altWorstPair = relativeMetrics(alt);
  const baseWorstPairSigmaDist = baseWorstPair.length > 0 ? Math.max(...baseWorstPair) : undefined;
  const altWorstPairSigmaDist = altWorstPair.length > 0 ? Math.max(...altWorstPair) : undefined;
  const deltaWorstStationMajor =
    altWorstStationMajor != null && baseWorstStationMajor != null
      ? altWorstStationMajor - baseWorstStationMajor
      : 0;
  const deltaMedianStationMajor =
    altMedianStationMajor != null && baseMedianStationMajor != null
      ? altMedianStationMajor - baseMedianStationMajor
      : 0;
  const deltaWorstPairSigmaDist =
    altWorstPairSigmaDist != null && baseWorstPairSigmaDist != null
      ? altWorstPairSigmaDist - baseWorstPairSigmaDist
      : 0;
  const basePrimary = pathSummary.stationDiagnostics.get(pathSummary.stationOrder[0] ?? '');
  const altPrimarySummary = buildPathPrioritySummary(alt);
  const altPrimary = altPrimarySummary.stationDiagnostics.get(pathSummary.stationOrder[0] ?? '');
  return (
    -deltaWorstStationMajor * 100000 -
    -((altPrimary?.pathWorstEdgeMetric ?? 0) - (basePrimary?.pathWorstEdgeMetric ?? 0)) * 10000 -
    -((altPrimary?.pathTotalMetric ?? 0) - (basePrimary?.pathTotalMetric ?? 0)) * 1000 -
    -deltaMedianStationMajor * 100 -
    -deltaWorstPairSigmaDist * 25 -
    (weakStationCount(base) - weakStationCount(alt)) * 5 -
    (weakPairCount(base) - weakPairCount(alt)) * 4
  );
};

const buildRecommendationEvaluation = (
  template: PreanalysisSyntheticSetTemplate,
  base: AdjustmentResult,
  alt: AdjustmentResult,
  basePathSummary: PathPrioritySummary,
  targetThresholdMeters?: number,
): RecommendationEvaluation => {
  const baseStationValues = stationMajors(base);
  const altStationValues = stationMajors(alt);
  const baseWorstStationMajor =
    baseStationValues.length > 0 ? Math.max(...baseStationValues) : undefined;
  const altWorstStationMajor = altStationValues.length > 0 ? Math.max(...altStationValues) : undefined;
  const baseMedianStationMajor = medianOf(baseStationValues);
  const altMedianStationMajor = medianOf(altStationValues);
  const basePairValues = relativeMetrics(base);
  const altPairValues = relativeMetrics(alt);
  const altPathSummary = buildPathPrioritySummary(alt);
  const baseWorstPairSigmaDist =
    basePairValues.length > 0 ? Math.max(...basePairValues) : undefined;
  const altWorstPairSigmaDist = altPairValues.length > 0 ? Math.max(...altPairValues) : undefined;
  const primaryTargetStationId = basePathSummary.stationOrder[0];
  const primaryDiagnostics =
    primaryTargetStationId != null
      ? basePathSummary.stationDiagnostics.get(primaryTargetStationId)
      : undefined;
  const altPrimaryDiagnostics =
    primaryTargetStationId != null
      ? altPathSummary.stationDiagnostics.get(primaryTargetStationId)
      : undefined;
  const row: PreanalysisImpactDiagnostics['rows'][number] = {
    scenarioId: template.id,
    scenarioKind: template.scenarioKind,
    occupyStationId: template.occupyStationId,
    setupStationIds: [...template.setupStationIds],
    primaryTargetStationId,
    anchorStationId: primaryDiagnostics?.anchorStationId,
    anchorPathStationIds: [...(primaryDiagnostics?.anchorPathStationIds ?? [])],
    anchorPathPairRefs: (primaryDiagnostics?.anchorPathPairRefs ?? []).map((pair) => ({ ...pair })),
    bottleneckPair: primaryDiagnostics?.pathWorstEdgePair
      ? { ...primaryDiagnostics.pathWorstEdgePair }
      : undefined,
    templateLabel: template.templateLabel,
    affectedStations: [...template.affectedStations],
    affectedPairs: template.affectedPairs.map((pair) => ({ ...pair })),
    sourceLines: [...template.sourceLines],
    addedObservationCount: template.addedObservationCount,
    previewPoints: template.previewPoints.map((point) => ({
      ...point,
      active: false,
    })),
    previewSegments: template.previewSegments.map((segment) => ({
      ...segment,
      active: false,
    })),
    deltaWorstStationMajor:
      altWorstStationMajor != null && baseWorstStationMajor != null
        ? altWorstStationMajor - baseWorstStationMajor
        : undefined,
    deltaMedianStationMajor:
      altMedianStationMajor != null && baseMedianStationMajor != null
        ? altMedianStationMajor - baseMedianStationMajor
        : undefined,
    deltaWorstPairSigmaDist:
      altWorstPairSigmaDist != null && baseWorstPairSigmaDist != null
        ? altWorstPairSigmaDist - baseWorstPairSigmaDist
        : undefined,
    deltaPathWorstEdge:
      altPrimaryDiagnostics?.pathWorstEdgeMetric != null &&
      primaryDiagnostics?.pathWorstEdgeMetric != null
        ? altPrimaryDiagnostics.pathWorstEdgeMetric - primaryDiagnostics.pathWorstEdgeMetric
        : undefined,
    deltaPathTotalMetric:
      altPrimaryDiagnostics?.pathTotalMetric != null &&
      primaryDiagnostics?.pathTotalMetric != null
        ? altPrimaryDiagnostics.pathTotalMetric - primaryDiagnostics.pathTotalMetric
        : undefined,
    deltaWeakStationCount: weakStationCount(alt) - weakStationCount(base),
    deltaWeakPairCount: weakPairCount(alt) - weakPairCount(base),
    score: candidateScore(base, alt, basePathSummary),
    actionMode: template.actionMode,
    rationale: template.rationale,
    thresholdReached:
      targetThresholdMeters != null &&
      altWorstStationMajor != null &&
      altWorstStationMajor <= targetThresholdMeters,
    status: 'ok',
  };
  return {
    row,
    stationComparisons: basePathSummary.stationOrder.map((stationId) => {
      const baseStation = basePathSummary.stationDiagnostics.get(stationId);
      const altStation = altPathSummary.stationDiagnostics.get(stationId);
      return {
        stationId,
        deltaMajor: deltaMetric(altStation?.stationMajor, baseStation?.stationMajor),
        deltaPathWorst: deltaMetric(
          altStation?.pathWorstEdgeMetric,
          baseStation?.pathWorstEdgeMetric,
        ),
        deltaPathTotal: deltaMetric(altStation?.pathTotalMetric, baseStation?.pathTotalMetric),
      };
    }),
  };
};

const compareImprovementDelta = (left: number, right: number): number => {
  if (left !== right) return left - right;
  return 0;
};

const sortRecommendationEvaluations = (
  left: RecommendationEvaluation,
  right: RecommendationEvaluation,
): number => {
  if (left.row.status !== right.row.status) return left.row.status === 'ok' ? -1 : 1;
  if (left.row.thresholdReached !== right.row.thresholdReached) return left.row.thresholdReached ? -1 : 1;
  const maxLength = Math.max(left.stationComparisons.length, right.stationComparisons.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftStation = left.stationComparisons[index];
    const rightStation = right.stationComparisons[index];
    if (!leftStation || !rightStation) break;
    const majorDelta = compareImprovementDelta(leftStation.deltaMajor, rightStation.deltaMajor);
    if (majorDelta !== 0) return majorDelta;
    const worstDelta = compareImprovementDelta(leftStation.deltaPathWorst, rightStation.deltaPathWorst);
    if (worstDelta !== 0) return worstDelta;
    const totalDelta = compareImprovementDelta(leftStation.deltaPathTotal, rightStation.deltaPathTotal);
    if (totalDelta !== 0) return totalDelta;
  }
  const rightScore = right.row.score ?? Number.NEGATIVE_INFINITY;
  const leftScore = left.row.score ?? Number.NEGATIVE_INFINITY;
  if (rightScore !== leftScore) return rightScore - leftScore;
  const kindDelta =
    recommendationKindTieWeight(left.row.scenarioKind) -
    recommendationKindTieWeight(right.row.scenarioKind);
  if (kindDelta !== 0) return kindDelta;
  return (
    left.row.occupyStationId.localeCompare(right.row.occupyStationId, undefined, { numeric: true }) ||
    left.row.templateLabel.localeCompare(right.row.templateLabel, undefined, { numeric: true })
  );
};

const resolveCandidateTemplates = (
  templates: PreanalysisSyntheticSetTemplate[],
  base: AdjustmentResult,
  activeTemplateIds: string[],
): PreanalysisSyntheticSetTemplate[] => {
  const activeTemplateIdSet = new Set(activeTemplateIds);
  const pathSummary = buildPathPrioritySummary(base);
  const remainingTemplates = templates.filter((template) => !activeTemplateIdSet.has(template.id));
  const prioritizeRows = remainingTemplates;
  const priorityForTemplate = (template: PreanalysisSyntheticSetTemplate): number => {
    const prioritizedStationHits = template.affectedStations.filter((stationId) =>
      pathSummary.prioritizedStations.has(stationId),
    ).length;
    const prioritizedPairHits = template.affectedPairs.filter((pair) =>
      pathSummary.prioritizedPairKeys.has(buildPairKey(pair.from, pair.to)),
    ).length;
    const prioritizedCorridorHits = templateCorridorPairs(template).filter((pair) =>
      pathSummary.prioritizedPairKeys.has(buildPairKey(pair.from, pair.to)),
    ).length;
    const touchesPrimaryTarget =
      pathSummary.stationOrder[0] != null &&
      template.affectedStations.includes(pathSummary.stationOrder[0])
        ? 1
        : 0;
    const touchesBottleneck =
      pathSummary.stationDiagnostics.get(pathSummary.stationOrder[0] ?? '')?.pathWorstEdgePair != null &&
      templateCorridorPairs(template).some(
        (pair) =>
          buildPairKey(pair.from, pair.to) ===
          buildPairKey(
            pathSummary.stationDiagnostics.get(pathSummary.stationOrder[0] ?? '')!.pathWorstEdgePair!.from,
            pathSummary.stationDiagnostics.get(pathSummary.stationOrder[0] ?? '')!.pathWorstEdgePair!.to,
          ),
      )
        ? 1
        : 0;
    return (
      touchesPrimaryTarget * 500 +
      touchesBottleneck * 400 +
      prioritizedCorridorHits * 140 +
      prioritizedPairHits * 20 +
      prioritizedStationHits * 90 +
      Math.min(template.addedObservationCount, 8) * 4
    );
  };
  const sortedCandidates = [...prioritizeRows].sort((left, right) => {
    const priorityDelta = priorityForTemplate(right) - priorityForTemplate(left);
    if (priorityDelta !== 0) return priorityDelta;
    return (
      left.occupyStationId.localeCompare(right.occupyStationId, undefined, { numeric: true }) ||
      left.templateLabel.localeCompare(right.templateLabel, undefined, { numeric: true })
    );
  });
  const selected: PreanalysisSyntheticSetTemplate[] = [];
  const selectedIds = new Set<string>();
  const pushTemplate = (template: PreanalysisSyntheticSetTemplate): void => {
    if (selected.length >= MAX_RECOMMENDATION_SOLVE_CANDIDATES) return;
    if (selectedIds.has(template.id)) return;
    selected.push(template);
    selectedIds.add(template.id);
  };

  sortedCandidates.forEach(pushTemplate);
  return selected;
};

const buildThresholdPlan = (
  templates: PreanalysisSyntheticSetTemplate[],
  base: AdjustmentResult,
  activeTemplateIds: string[],
  targetThresholdMeters: number | undefined,
  maxAddedSets: number,
  solveScenario: (_activeTemplateIds: string[]) => AdjustmentResult,
): PreanalysisThresholdPlan => {
  const baseWorstStationMajor = (() => {
    const values = stationMajors(base);
    return values.length > 0 ? Math.max(...values) : undefined;
  })();
  if (targetThresholdMeters == null) {
    return {
      targetThresholdMeters,
      thresholdReached: false,
      appliedStepCount: 0,
      finalWorstStationMajor: baseWorstStationMajor,
      remainingFeasibleScenarioCount: Math.max(0, templates.length - activeTemplateIds.length),
      unmetReason: undefined,
      steps: [],
    };
  }
  if (baseWorstStationMajor != null && baseWorstStationMajor <= targetThresholdMeters) {
    return {
      targetThresholdMeters,
      thresholdReached: true,
      appliedStepCount: 0,
      finalWorstStationMajor: baseWorstStationMajor,
      remainingFeasibleScenarioCount: Math.max(0, templates.length - activeTemplateIds.length),
      steps: [],
    };
  }

  const steps: PreanalysisThresholdPlan['steps'] = [];
  let currentResult = base;
  let currentActiveIds = [...activeTemplateIds];
  let unmetReason: string | undefined;
  let reached = false;

  for (let stepIndex = 0; stepIndex < Math.max(0, maxAddedSets); stepIndex += 1) {
    const rows = resolveCandidateTemplates(templates, currentResult, currentActiveIds)
      .filter((template) => template.actionMode === 'applyable-addition')
      .map((template) => {
        try {
          const nextIds = [...currentActiveIds, template.id];
          const alt = solveScenario(nextIds);
          return {
            evaluation: buildRecommendationEvaluation(
              template,
              currentResult,
              alt,
              buildPathPrioritySummary(currentResult),
              targetThresholdMeters,
            ),
            alt,
          };
        } catch {
          return null;
        }
      })
      .filter(
        (entry): entry is { evaluation: RecommendationEvaluation; alt: AdjustmentResult } =>
          entry != null,
      )
      .sort((left, right) => sortRecommendationEvaluations(left.evaluation, right.evaluation));
    const best = rows[0];
    if (!best) {
      unmetReason =
        resolveCandidateTemplates(templates, currentResult, currentActiveIds).some(
          (template) => template.actionMode === 'advisory',
        )
          ? 'Additive scenarios are exhausted; only manual advisory network changes remain.'
          : currentActiveIds.length > 0
            ? 'All usable existing setup-set templates are already active.'
            : 'No usable existing setup-set templates were available for threshold planning.';
      break;
    }
    currentActiveIds = [...currentActiveIds, best.evaluation.row.scenarioId];
    currentResult = best.alt;
    const currentWorstValues = stationMajors(currentResult);
    const projectedWorstStationMajor =
      currentWorstValues.length > 0 ? Math.max(...currentWorstValues) : undefined;
    const thresholdReached =
      projectedWorstStationMajor != null && projectedWorstStationMajor <= targetThresholdMeters;
    steps.push({
      rank: stepIndex + 1,
      scenarioId: best.evaluation.row.scenarioId,
      scenarioKind: best.evaluation.row.scenarioKind,
      occupyStationId: best.evaluation.row.occupyStationId,
      setupStationIds: [...best.evaluation.row.setupStationIds],
      templateLabel: best.evaluation.row.templateLabel,
      addedObservationCount: best.evaluation.row.addedObservationCount,
      projectedWorstStationMajor,
      thresholdReached,
    });
    if (thresholdReached) {
      reached = true;
      break;
    }
  }

  const finalWorstValues = stationMajors(currentResult);
  const finalWorstStationMajor =
    finalWorstValues.length > 0 ? Math.max(...finalWorstValues) : baseWorstStationMajor;
  if (!reached && unmetReason == null) {
    unmetReason =
      steps.length >= Math.max(0, maxAddedSets)
        ? 'Threshold not reached before hitting the max added sets limit.'
        : 'Threshold not reached with available added-set trials.';
  }
  return {
    targetThresholdMeters,
    thresholdReached: reached,
    appliedStepCount: steps.length,
    finalWorstStationMajor,
    remainingFeasibleScenarioCount: Math.max(0, templates.length - currentActiveIds.length),
    unmetReason,
    steps,
  };
};

export const buildPreanalysisPlanningDiagnostics = ({
  base,
  input,
  planningMap,
  activeTemplateIds,
  targetThresholdMeters,
  maxAddedSets,
  solveScenario,
}: BuildPreanalysisPlanningDiagnosticsArgs): PreanalysisImpactDiagnostics => {
  const templates = buildPreanalysisSyntheticSetTemplates(
    input,
    base,
    planningMap,
    activeTemplateIds,
  );
  const activeTemplateIdSet = new Set(activeTemplateIds);
  const candidateTemplates = resolveCandidateTemplates(templates, base, activeTemplateIds);
  const remainingFeasibleScenarioCount = Math.max(0, templates.length - activeTemplateIds.length);
  const basePathSummary = buildPathPrioritySummary(base);
  const recommendationRows = candidateTemplates
    .map((template) => {
      try {
        const alt = solveScenario([...activeTemplateIds, template.id]);
        return buildRecommendationEvaluation(
          template,
          base,
          alt,
          basePathSummary,
          targetThresholdMeters,
        );
      } catch {
        return {
          row: {
            scenarioId: template.id,
            scenarioKind: template.scenarioKind,
            occupyStationId: template.occupyStationId,
            setupStationIds: [...template.setupStationIds],
            primaryTargetStationId: basePathSummary.stationOrder[0],
            anchorStationId:
              basePathSummary.stationDiagnostics.get(basePathSummary.stationOrder[0] ?? '')?.anchorStationId,
            anchorPathStationIds: [
              ...(basePathSummary.stationDiagnostics.get(basePathSummary.stationOrder[0] ?? '')?.anchorPathStationIds ??
                []),
            ],
            anchorPathPairRefs: (
              basePathSummary.stationDiagnostics.get(basePathSummary.stationOrder[0] ?? '')?.anchorPathPairRefs ?? []
            ).map((pair) => ({ ...pair })),
            bottleneckPair:
              basePathSummary.stationDiagnostics.get(basePathSummary.stationOrder[0] ?? '')?.pathWorstEdgePair !=
              null
                ? {
                    ...basePathSummary.stationDiagnostics.get(basePathSummary.stationOrder[0] ?? '')!
                      .pathWorstEdgePair!,
                  }
                : undefined,
            templateLabel: template.templateLabel,
            affectedStations: [...template.affectedStations],
            affectedPairs: template.affectedPairs.map((pair) => ({ ...pair })),
            sourceLines: [...template.sourceLines],
            addedObservationCount: template.addedObservationCount,
            previewPoints: template.previewPoints.map((point) => ({ ...point, active: false })),
            previewSegments: template.previewSegments.map((segment) => ({
              ...segment,
              active: false,
            })),
            score: undefined,
            actionMode: template.actionMode,
            rationale: template.rationale,
            thresholdReached: false,
            status: 'failed' as const,
          },
          stationComparisons: [],
        } satisfies RecommendationEvaluation;
      }
    })
    .sort(sortRecommendationEvaluations)
    .map((evaluation) => evaluation.row)
    .slice(0, MAX_RECOMMENDATIONS);
  const thresholdPlan = buildThresholdPlan(
    templates,
    base,
    activeTemplateIds,
    targetThresholdMeters,
    maxAddedSets,
    solveScenario,
  );
  const baseStationValues = stationMajors(base);
  const baseRelativeValues = relativeMetrics(base);
  const bracePreviewPoints: PreanalysisBracePreviewPoint[] = templates
    .filter(
      (
        template,
      ): template is PreanalysisSyntheticSetTemplate & {
        bracePreviewPoint: NonNullable<PreanalysisSyntheticSetTemplate['bracePreviewPoint']>;
      } => template.scenarioKind === 'brace-point' && template.bracePreviewPoint != null,
    )
    .map((template) => ({
      scenarioId: template.id,
      stationId: template.bracePreviewPoint.stationId,
      x: template.bracePreviewPoint.x,
      y: template.bracePreviewPoint.y,
      h: template.bracePreviewPoint.h,
      active: activeTemplateIdSet.has(template.id),
      templateLabel: template.templateLabel,
    }))
    .sort(
      (left, right) =>
        Number(right.active) - Number(left.active) ||
        left.stationId.localeCompare(right.stationId, undefined, { numeric: true }),
    );
  const scenarioPreviewPoints = templates
    .flatMap((template) =>
      template.previewPoints
        .filter((point) => point.role !== 'anchor')
        .map((point) => ({
          ...point,
          active: activeTemplateIdSet.has(template.id),
        })),
    )
    .sort((left, right) =>
      Number(right.active) - Number(left.active) ||
      left.stationId.localeCompare(right.stationId, undefined, { numeric: true }),
    );
  const scenarioPreviewSegments = templates.flatMap((template) =>
    template.previewSegments.map((segment) => ({
      ...segment,
      active: activeTemplateIdSet.has(template.id),
    })),
  );
  return {
    enabled: true,
    activeSyntheticAdditionCount: activeTemplateIds.length,
    candidateTemplateCount: candidateTemplates.length,
    remainingFeasibleScenarioCount,
    baseWorstStationMajor:
      baseStationValues.length > 0 ? Math.max(...baseStationValues) : undefined,
    baseMedianStationMajor: medianOf(baseStationValues),
    baseWorstPairSigmaDist:
      baseRelativeValues.length > 0 ? Math.max(...baseRelativeValues) : undefined,
    baseWeakStationCount: weakStationCount(base),
    baseWeakPairCount: weakPairCount(base),
    targetThresholdMeters,
    rows: recommendationRows,
    bracePreviewPoints,
    scenarioPreviewPoints,
    scenarioPreviewSegments,
    thresholdPlan,
  };
};
