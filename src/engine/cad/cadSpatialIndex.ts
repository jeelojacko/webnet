import type { CadProject, CadSnapCandidate, CadSnapKind } from './cadTypes';

const SNAP_PRIORITY: Record<CadSnapKind, number> = {
  'point-node': 0,
  endpoint: 1,
  midpoint: 2,
  nearest: 3,
};

interface SearchWorldPoint {
  x: number;
  y: number;
}

const distance = (from: SearchWorldPoint, to: SearchWorldPoint): number =>
  Math.hypot(from.x - to.x, from.y - to.y);

const midpoint = (start: SearchWorldPoint, end: SearchWorldPoint): SearchWorldPoint => ({
  x: (start.x + end.x) / 2,
  y: (start.y + end.y) / 2,
});

const closestPointOnSegment = (
  point: SearchWorldPoint,
  start: SearchWorldPoint,
  end: SearchWorldPoint,
): SearchWorldPoint => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-12) return start;
  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  const clamped = Math.max(0, Math.min(1, t));
  return {
    x: start.x + dx * clamped,
    y: start.y + dy * clamped,
  };
};

const buildCandidate = (
  kind: CadSnapKind,
  sourceEntityId: string,
  point: SearchWorldPoint,
  query: SearchWorldPoint,
  label: string,
): CadSnapCandidate => ({
  id: `${kind}:${sourceEntityId}:${label}`,
  kind,
  sourceEntityId,
  x: point.x,
  y: point.y,
  distance: distance(query, point),
  label,
});

export interface CadSpatialIndex {
  queryNearestSnap: (
    _worldPoint: SearchWorldPoint,
    _toleranceWorld: number,
    _allowedKinds?: readonly CadSnapKind[],
  ) => CadSnapCandidate | null;
}

export const buildCadSpatialIndex = (project: CadProject): CadSpatialIndex => ({
  queryNearestSnap: (worldPoint, toleranceWorld, allowedKinds = ['point-node', 'endpoint', 'midpoint', 'nearest']) => {
    const allowed = new Set(allowedKinds);
    const candidates: CadSnapCandidate[] = [];

    project.entities.forEach((entity) => {
      if (!entity.visible) return;
      switch (entity.type) {
        case 'survey-point':
          if (allowed.has('point-node')) {
            candidates.push(
              buildCandidate('point-node', entity.id, { x: entity.x, y: entity.y }, worldPoint, entity.stationId),
            );
          }
          break;
        case 'line': {
          const start = { x: entity.fromX, y: entity.fromY };
          const end = { x: entity.toX, y: entity.toY };
          if (allowed.has('endpoint')) {
            candidates.push(
              buildCandidate('endpoint', entity.id, start, worldPoint, `${entity.fromStationId}`),
              buildCandidate('endpoint', entity.id, end, worldPoint, `${entity.toStationId}`),
            );
          }
          if (allowed.has('midpoint')) {
            candidates.push(
              buildCandidate(
                'midpoint',
                entity.id,
                midpoint(start, end),
                worldPoint,
                `${entity.fromStationId}-${entity.toStationId}`,
              ),
            );
          }
          if (allowed.has('nearest')) {
            candidates.push(
              buildCandidate(
                'nearest',
                entity.id,
                closestPointOnSegment(worldPoint, start, end),
                worldPoint,
                `${entity.fromStationId}-${entity.toStationId}`,
              ),
            );
          }
          break;
        }
        default:
          break;
      }
    });

    const viable = candidates
      .filter((candidate) => candidate.distance <= toleranceWorld)
      .sort((left, right) => {
        if (SNAP_PRIORITY[left.kind] !== SNAP_PRIORITY[right.kind]) {
          return SNAP_PRIORITY[left.kind] - SNAP_PRIORITY[right.kind];
        }
        if (Math.abs(left.distance - right.distance) > 1e-9) return left.distance - right.distance;
        return left.id.localeCompare(right.id, undefined, { numeric: true });
      });
    return viable[0] ?? null;
  },
});
