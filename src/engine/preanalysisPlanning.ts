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
  occupyStationId: StationId;
  setupStationIds: StationId[];
  templateLabel: string;
  sourceLines: number[];
  blockText: string;
  affectedStations: StationId[];
  affectedPairs: PreanalysisAddedSetPairRef[];
  addedObservationCount: number;
  existingSetCount: number;
  previewPoints: PreanalysisScenarioPreviewPoint[];
  previewSegments: PreanalysisScenarioPreviewSegment[];
  bracePreviewPoint?: {
    stationId: StationId;
    x: number;
    y: number;
    h: number;
  };
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

const collectWeakSeedStations = (base: AdjustmentResult): Set<StationId> => {
  const stationCues = (base.weakGeometryDiagnostics?.stationCues ?? []).slice(0, 5);
  const pairCues = (base.weakGeometryDiagnostics?.relativeCues ?? []).slice(0, 5);
  const ids = new Set<StationId>();
  stationCues.forEach((cue) => {
    if (severityWeight(cue.severity) > 0) ids.add(cue.stationId);
  });
  pairCues.forEach((cue) => {
    if (severityWeight(cue.severity) > 0) {
      ids.add(cue.from);
      ids.add(cue.to);
    }
  });
  return ids;
};

const sortStationIds = (left: StationId, right: StationId): number =>
  left.localeCompare(right, undefined, { numeric: true });

const stationHasFiniteCoords = (stations: StationMap, stationId: StationId): boolean => {
  const station = stations[stationId];
  return (
    station != null &&
    Number.isFinite(station.x) &&
    Number.isFinite(station.y) &&
    Number.isFinite(station.h)
  );
};

const collectSeedPairs = (base: AdjustmentResult): PreanalysisAddedSetPairRef[] => {
  const weightedRelativeCues = [...(base.weakGeometryDiagnostics?.relativeCues ?? [])]
    .sort((left, right) => {
      const severityDelta = severityWeight(right.severity) - severityWeight(left.severity);
      if (severityDelta !== 0) return severityDelta;
      return (right.distanceMetric ?? 0) - (left.distanceMetric ?? 0);
    })
    .map((cue) => ({ from: cue.from, to: cue.to }));
  if (weightedRelativeCues.length > 0) return weightedRelativeCues;

  return [...(base.relativeCovariances ?? [])]
    .sort((left, right) => {
      const rightMetric =
        right.sigmaDist ?? right.ellipse?.semiMajor ?? Math.max(right.sigmaE, right.sigmaN);
      const leftMetric =
        left.sigmaDist ?? left.ellipse?.semiMajor ?? Math.max(left.sigmaE, left.sigmaN);
      return rightMetric - leftMetric;
    })
    .map((row) => ({ from: row.from, to: row.to }));
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

const buildBraceStationId = (left: StationId, right: StationId): string =>
  `BRACE_${[left, right]
    .sort(sortStationIds)
    .map((part) => part.replace(/[^A-Za-z0-9]+/g, '_'))
    .join('_')}`;

const buildSyntheticSetupStationId = (
  prefix: 'SYNTH' | 'PROMOTE',
  left: StationId,
  right: StationId,
  rank = 1,
): string =>
  `${prefix}_${[left, right]
    .sort(sortStationIds)
    .map((part) => part.replace(/[^A-Za-z0-9]+/g, '_'))
    .join('_')}_${rank}`;

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

const resolveObstaclePolygons = (planningMap: PlanningMapState): PlanningMapPolygon[] => [
  ...planningMap.blockedPolygons,
  ...planningMap.obstaclePolygons,
];

const occupiedStationIdsFromTemplates = (templates: PreanalysisSyntheticSetTemplate[]): StationId[] =>
  [...new Set(templates.map((template) => template.occupyStationId))].sort(sortStationIds);

const filterVisibleAnchorIds = (
  stations: StationMap,
  candidatePoint: { x: number; y: number },
  occupiedStationIds: StationId[],
  blockedPolygons: PlanningMapPolygon[],
): StationId[] =>
  occupiedStationIds.filter((stationId) => {
    const station = stations[stationId];
    if (!station || !Number.isFinite(station.x) || !Number.isFinite(station.y)) return false;
    return !sightLineBlocked(candidatePoint, station, blockedPolygons);
  });

const buildBraceTemplates = (
  base: AdjustmentResult,
  existingTemplates: PreanalysisSyntheticSetTemplate[],
  planningMap: PlanningMapState,
): PreanalysisSyntheticSetTemplate[] => {
  const blockedPolygons = resolveObstaclePolygons(planningMap);
  const occupiedIds = new Set(existingTemplates.map((template) => template.occupyStationId));
  const sourceLineByOccupyId = new Map(
    existingTemplates
      .filter((template) => template.sourceLines.length > 0)
      .map((template) => [template.occupyStationId, template.sourceLines[0]]),
  );
  const usedTemplateIds = new Set(existingTemplates.map((template) => template.id));
  const braceTemplates: PreanalysisSyntheticSetTemplate[] = [];
  const seenIds = new Set<string>();
  collectSeedPairs(base).forEach((pair) => {
    if (braceTemplates.length >= MAX_BRACE_SCENARIOS) return;
    const sortedPair = [pair.from, pair.to].sort(sortStationIds);
    const [leftId, rightId] = sortedPair;
    if (!occupiedIds.has(leftId) || !occupiedIds.has(rightId)) return;
    if (!stationHasFiniteCoords(base.stations, leftId) || !stationHasFiniteCoords(base.stations, rightId)) {
      return;
    }
    const id = buildBraceTemplateId(leftId, rightId);
    if (seenIds.has(id) || usedTemplateIds.has(id)) return;
    const point = chooseBracePointCandidate(base.stations, leftId, rightId, blockedPolygons);
    if (!point) return;
    const braceStationId = buildBraceStationId(leftId, rightId);
    if (base.stations[braceStationId] != null) return;
    const extraVisibleSetups = filterVisibleAnchorIds(
      base.stations,
      point,
      occupiedStationIdsFromTemplates(existingTemplates),
      blockedPolygons,
    )
      .filter((stationId) => stationId !== leftId && stationId !== rightId)
      .slice(0, Math.max(0, MAX_BRACE_SETUPS - 2));
    const setupStationIds = [leftId, rightId, ...extraVisibleSetups];
    seenIds.add(id);
    braceTemplates.push({
      id,
      scenarioKind: 'brace-point',
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
      addedObservationCount: setupStationIds.length,
      existingSetCount: 0,
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
): PreanalysisSyntheticSetTemplate[] => {
  if (!planningMap.scenarioFamilies.promotedSetup) return [];
  const blockedPolygons = resolveObstaclePolygons(planningMap);
  const occupiedIds = occupiedStationIdsFromTemplates(existingTemplates);
  const usedTemplateIds = new Set(existingTemplates.map((template) => template.id));
  const templates: PreanalysisSyntheticSetTemplate[] = [];
  collectSeedPairs(base).forEach((pair) => {
    if (templates.length >= MAX_PROMOTED_SETUP_SCENARIOS) return;
    const point = chooseBracePointCandidate(base.stations, pair.from, pair.to, blockedPolygons);
    if (!point) return;
    const visibleAnchors = filterVisibleAnchorIds(base.stations, point, occupiedIds, blockedPolygons).slice(
      0,
      MAX_BRACE_SETUPS,
    );
    if (visibleAnchors.length < 3) return;
    const setupStationId = buildSyntheticSetupStationId('PROMOTE', pair.from, pair.to);
    if (base.stations[setupStationId] != null) return;
    const id = buildPromotedTemplateId(pair.from, pair.to);
    if (usedTemplateIds.has(id)) return;
    templates.push({
      id,
      scenarioKind: 'promoted-setup',
      occupyStationId: setupStationId,
      setupStationIds: [setupStationId, ...visibleAnchors],
      templateLabel: buildPromotedTemplateLabel(setupStationId, visibleAnchors),
      sourceLines: [],
      blockText: buildSetupBlockText(setupStationId, point, visibleAnchors),
      affectedStations: [setupStationId, ...visibleAnchors],
      affectedPairs: visibleAnchors.map((anchorId) => ({ from: setupStationId, to: anchorId })),
      addedObservationCount: visibleAnchors.length,
      existingSetCount: 0,
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
): PreanalysisSyntheticSetTemplate[] => {
  if (!planningMap.scenarioFamilies.syntheticSetup) return [];
  const blockedPolygons = resolveObstaclePolygons(planningMap);
  const occupiedIds = occupiedStationIdsFromTemplates(existingTemplates);
  const templates: PreanalysisSyntheticSetTemplate[] = [];
  collectSeedPairs(base).forEach((pair, pairIndex) => {
    if (templates.length >= MAX_SYNTHETIC_SETUP_SCENARIOS) return;
    const point = chooseBracePointCandidate(base.stations, pair.from, pair.to, blockedPolygons);
    if (!point) return;
    const visibleAnchors = filterVisibleAnchorIds(base.stations, point, occupiedIds, blockedPolygons).slice(
      0,
      MAX_BRACE_SETUPS,
    );
    if (visibleAnchors.length < 3) return;
    const setupStationId = buildSyntheticSetupStationId('SYNTH', pair.from, pair.to, pairIndex + 1);
    if (base.stations[setupStationId] != null) return;
    templates.push({
      id: buildSyntheticSetupTemplateId(pair.from, pair.to, pairIndex + 1),
      scenarioKind: 'synthetic-setup',
      occupyStationId: setupStationId,
      setupStationIds: [setupStationId, ...visibleAnchors],
      templateLabel: buildSyntheticSetupTemplateLabel(setupStationId, visibleAnchors),
      sourceLines: [],
      blockText: buildSetupBlockText(setupStationId, point, visibleAnchors),
      affectedStations: [setupStationId, ...visibleAnchors],
      affectedPairs: visibleAnchors.map((anchorId) => ({ from: setupStationId, to: anchorId })),
      addedObservationCount: visibleAnchors.length,
      existingSetCount: 0,
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
): PreanalysisSyntheticSetTemplate[] => {
  if (!planningMap.scenarioFamilies.crossTie) return [];
  const blockedPolygons = resolveObstaclePolygons(planningMap);
  const existingPairKeys = new Set(
    existingTemplates.flatMap((template) =>
      template.affectedPairs.map((pair) => [pair.from, pair.to].sort(sortStationIds).join('|')),
    ),
  );
  const rows: PreanalysisSyntheticSetTemplate[] = [];
  collectSeedPairs(base).forEach((pair) => {
    if (rows.length >= MAX_CROSS_TIE_SCENARIOS) return;
    const key = [pair.from, pair.to].sort(sortStationIds).join('|');
    if (existingPairKeys.has(key)) return;
    const fromStation = base.stations[pair.from];
    const toStation = base.stations[pair.to];
    if (!fromStation || !toStation || sightLineBlocked(fromStation, toStation, blockedPolygons)) return;
    rows.push({
      id: buildCrossTieTemplateId(pair.from, pair.to),
      scenarioKind: 'cross-tie',
      occupyStationId: pair.from,
      setupStationIds: [pair.from],
      templateLabel: buildCrossTieTemplateLabel(pair.from, pair.to),
      sourceLines: [],
      blockText: buildCrossTieBlockText(pair.from, pair.to),
      affectedStations: [pair.from, pair.to],
      affectedPairs: [{ from: pair.from, to: pair.to }],
      addedObservationCount: 1,
      existingSetCount: 0,
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

export const buildPreanalysisSyntheticSetTemplates = (
  input: string,
  base: AdjustmentResult,
  planningMap: PlanningMapState,
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
        addedObservationCount: setObservations.length,
        existingSetCount: 1,
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
  const scenarioTemplates = [
    ...repeatedSetTemplates,
    ...(planningMap.scenarioFamilies.bracePoint ? buildBraceTemplates(base, repeatedSetTemplates, planningMap) : []),
    ...buildPromotedSetupTemplates(base, repeatedSetTemplates, planningMap),
    ...buildSyntheticSetupTemplates(base, repeatedSetTemplates, planningMap),
    ...buildCrossTieTemplates(base, repeatedSetTemplates, planningMap),
  ];
  return scenarioTemplates;
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
      if (!template) return null;
      return [
        `# WEBNET_PREANALYSIS_ADDED_SET ${template.id} ${index + 1}`,
        template.blockText,
      ].join('\n');
    })
    .filter((block): block is string => block != null);
  if (appendedBlocks.length === 0) return input;
  return `${input.trimEnd()}\n\n${appendedBlocks.join('\n\n')}\n`;
};

const candidateScore = (base: AdjustmentResult, alt: AdjustmentResult): number => {
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
  return (
    -deltaWorstStationMajor * 40 -
    deltaMedianStationMajor * 20 -
    deltaWorstPairSigmaDist * 25 -
    (weakStationCount(alt) - weakStationCount(base)) * 5 -
    (weakPairCount(alt) - weakPairCount(base)) * 4
  );
};

const buildRecommendationRow = (
  template: PreanalysisSyntheticSetTemplate,
  base: AdjustmentResult,
  alt: AdjustmentResult,
  targetThresholdMeters?: number,
): PreanalysisImpactDiagnostics['rows'][number] => {
  const baseStationValues = stationMajors(base);
  const altStationValues = stationMajors(alt);
  const baseWorstStationMajor =
    baseStationValues.length > 0 ? Math.max(...baseStationValues) : undefined;
  const altWorstStationMajor = altStationValues.length > 0 ? Math.max(...altStationValues) : undefined;
  const baseMedianStationMajor = medianOf(baseStationValues);
  const altMedianStationMajor = medianOf(altStationValues);
  const basePairValues = relativeMetrics(base);
  const altPairValues = relativeMetrics(alt);
  const baseWorstPairSigmaDist =
    basePairValues.length > 0 ? Math.max(...basePairValues) : undefined;
  const altWorstPairSigmaDist = altPairValues.length > 0 ? Math.max(...altPairValues) : undefined;
  return {
    scenarioId: template.id,
    scenarioKind: template.scenarioKind,
    occupyStationId: template.occupyStationId,
    setupStationIds: [...template.setupStationIds],
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
    deltaWeakStationCount: weakStationCount(alt) - weakStationCount(base),
    deltaWeakPairCount: weakPairCount(alt) - weakPairCount(base),
    score: candidateScore(base, alt),
    thresholdReached:
      targetThresholdMeters != null &&
      altWorstStationMajor != null &&
      altWorstStationMajor <= targetThresholdMeters,
    status: 'ok',
  };
};

const sortRecommendationRows = (
  left: PreanalysisImpactDiagnostics['rows'][number],
  right: PreanalysisImpactDiagnostics['rows'][number],
): number => {
  const kindPriority = (kind: PreanalysisRecommendationKind): number =>
    kind === 'existing-set'
      ? 0
      : kind === 'brace-point' || kind === 'promoted-setup'
        ? 1
        : kind === 'synthetic-setup' || kind === 'cross-tie'
          ? 2
          : 3;
  if (left.status !== right.status) return left.status === 'ok' ? -1 : 1;
  if (left.thresholdReached !== right.thresholdReached) return left.thresholdReached ? -1 : 1;
  const rightScore = right.score ?? Number.NEGATIVE_INFINITY;
  const leftScore = left.score ?? Number.NEGATIVE_INFINITY;
  if (rightScore !== leftScore) return rightScore - leftScore;
  const kindDelta = kindPriority(left.scenarioKind) - kindPriority(right.scenarioKind);
  if (kindDelta !== 0) return kindDelta;
  return (
    left.occupyStationId.localeCompare(right.occupyStationId, undefined, { numeric: true }) ||
    left.templateLabel.localeCompare(right.templateLabel, undefined, { numeric: true })
  );
};

const resolveCandidateTemplates = (
  templates: PreanalysisSyntheticSetTemplate[],
  base: AdjustmentResult,
  activeTemplateIds: string[],
): PreanalysisSyntheticSetTemplate[] => {
  const activeTemplateIdSet = new Set(activeTemplateIds);
  const remainingTemplates = templates.filter((template) => !activeTemplateIdSet.has(template.id));
  const weakSeedStations = collectWeakSeedStations(base);
  const seededRemainingTemplates = remainingTemplates.filter((template) =>
    template.affectedStations.some((stationId) => weakSeedStations.has(stationId)),
  );
  const stageOrder: PreanalysisRecommendationKind[][] = [
    ['existing-set'],
    ['brace-point', 'promoted-setup'],
    ['synthetic-setup', 'cross-tie'],
  ];
  const pickStage = (rows: PreanalysisSyntheticSetTemplate[]): PreanalysisSyntheticSetTemplate[] => {
    for (const kinds of stageOrder) {
      const stageRows = rows.filter((template) => kinds.includes(template.scenarioKind));
      if (stageRows.length > 0) return stageRows;
    }
    return rows;
  };
  if (seededRemainingTemplates.length > 0) {
    return pickStage(seededRemainingTemplates);
  }
  return pickStage(remainingTemplates);
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
      .map((template) => {
        try {
          const nextIds = [...currentActiveIds, template.id];
          const alt = solveScenario(nextIds);
          return {
            row: buildRecommendationRow(template, currentResult, alt, targetThresholdMeters),
            alt,
          };
        } catch {
          return null;
        }
      })
      .filter(
        (entry): entry is { row: PreanalysisImpactDiagnostics['rows'][number]; alt: AdjustmentResult } =>
          entry != null,
      )
      .sort((left, right) => sortRecommendationRows(left.row, right.row));
    const best = rows[0];
    if (!best) {
      unmetReason =
        currentActiveIds.length > 0
          ? 'All usable existing setup-set templates are already active.'
          : 'No usable existing setup-set templates were available for threshold planning.';
      break;
    }
    currentActiveIds = [...currentActiveIds, best.row.scenarioId];
    currentResult = best.alt;
    const currentWorstValues = stationMajors(currentResult);
    const projectedWorstStationMajor =
      currentWorstValues.length > 0 ? Math.max(...currentWorstValues) : undefined;
    const thresholdReached =
      projectedWorstStationMajor != null && projectedWorstStationMajor <= targetThresholdMeters;
    steps.push({
      rank: stepIndex + 1,
      scenarioId: best.row.scenarioId,
      scenarioKind: best.row.scenarioKind,
      occupyStationId: best.row.occupyStationId,
      setupStationIds: [...best.row.setupStationIds],
      templateLabel: best.row.templateLabel,
      addedObservationCount: best.row.addedObservationCount,
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
  const templates = buildPreanalysisSyntheticSetTemplates(input, base, planningMap);
  const activeTemplateIdSet = new Set(activeTemplateIds);
  const candidateTemplates = resolveCandidateTemplates(templates, base, activeTemplateIds);
  const remainingFeasibleScenarioCount = Math.max(0, templates.length - activeTemplateIds.length);
  const recommendationRows = candidateTemplates
    .map((template) => {
      try {
        const alt = solveScenario([...activeTemplateIds, template.id]);
        return buildRecommendationRow(template, base, alt, targetThresholdMeters);
      } catch {
        return {
          scenarioId: template.id,
          scenarioKind: template.scenarioKind,
          occupyStationId: template.occupyStationId,
          setupStationIds: [...template.setupStationIds],
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
          thresholdReached: false,
          status: 'failed' as const,
        };
      }
    })
    .sort(sortRecommendationRows)
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
