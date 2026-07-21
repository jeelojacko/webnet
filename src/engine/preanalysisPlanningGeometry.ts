import type {
  PlanningMapPolygon,
  PlanningMapState,
  PreanalysisScenarioPreviewPoint,
  PreanalysisScenarioPreviewSegment,
  StationId,
  StationMap,
} from '../types';
import {
  BRACE_OFFSET_RATIO,
  MAX_BRACE_ANGLE_DEG,
  MIN_BRACE_ANGLE_DEG,
  MIN_BRACE_CLEARANCE_RATIO,
  POLYGON_CLEARANCE_M,
  sortStationIds,
} from './preanalysisPlanningShared';
import type { PreanalysisSyntheticSetTemplate } from './preanalysisPlanningShared';

export const buildTemplateId = (occupy: StationId, targets: StationId[]): string =>
  `preanalysis-set:${occupy}:${targets.join('|')}`;

export const buildTemplateLabel = (occupy: StationId, targets: StationId[]): string =>
  `${occupy} -> ${targets.join(', ')}`;

export const buildBraceTemplateId = (left: StationId, right: StationId): string =>
  `preanalysis-brace:${[left, right].sort(sortStationIds).join('|')}`;

export const buildPromotedTemplateId = (left: StationId, right: StationId): string =>
  `preanalysis-promoted:${[left, right].sort(sortStationIds).join('|')}`;

export const buildSyntheticSetupTemplateId = (left: StationId, right: StationId, rank: number): string =>
  `preanalysis-synthsetup:${[left, right].sort(sortStationIds).join('|')}:${rank}`;

export const buildCrossTieTemplateId = (from: StationId, to: StationId): string =>
  `preanalysis-crosstie:${[from, to].sort(sortStationIds).join('|')}`;

const buildOrdinalSyntheticStationId = (prefix: 'B' | 'P', ordinal: number): StationId =>
  `${prefix}-${ordinal}`;

export const createSyntheticStationAllocator = (stations: StationMap) => {
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

export const buildBraceTemplateLabel = (braceStationId: StationId, left: StationId, right: StationId): string =>
  `Brace ${braceStationId} [${left}-${right}]`;

export const buildPromotedTemplateLabel = (
  setupStationId: StationId,
  anchorIds: StationId[],
): string => `Promote ${setupStationId} [${anchorIds.join('-')}]`;

export const buildSyntheticSetupTemplateLabel = (
  setupStationId: StationId,
  anchorIds: StationId[],
): string => `Synthetic ${setupStationId} [${anchorIds.join('-')}]`;

export const buildCrossTieTemplateLabel = (from: StationId, to: StationId): string =>
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

export const sightLineBlocked = (
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

export const buildBraceBlockText = (
  braceStationId: StationId,
  point: { x: number; y: number; h: number },
  setupStationIds: StationId[],
): string =>
  [
    `C ${braceStationId} ${point.x.toFixed(4)} ${point.y.toFixed(4)} ${point.h.toFixed(4)}`,
    ...setupStationIds.flatMap((setupId) => [`DB ${setupId}`, `DM ${braceStationId}`, 'DE']),
  ].join('\n');

export const buildSetupBlockText = (
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

export const buildCrossTieBlockText = (from: StationId, to: StationId): string =>
  [`DB ${from}`, `DM ${to}`, 'DE'].join('\n');

export const buildPreviewPoints = (
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

export const buildPreviewSegments = (
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

export const resolveObstacleGroups = (planningMap: PlanningMapState): {
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

export const occupiedStationIdsFromTemplates = (templates: PreanalysisSyntheticSetTemplate[]): StationId[] =>
  [...new Set(templates.map((template) => template.occupyStationId))].sort(sortStationIds);

export const filterVisibleAnchorIds = (
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

export const chooseBracePointCandidateWithFallback = (
  stations: StationMap,
  leftId: StationId,
  rightId: StationId,
  hardPolygons: PlanningMapPolygon[],
  softPolygons: PlanningMapPolygon[],
): { x: number; y: number; h: number } | null =>
  chooseBracePointCandidate(stations, leftId, rightId, [...hardPolygons, ...softPolygons]) ??
  chooseBracePointCandidate(stations, leftId, rightId, hardPolygons);
