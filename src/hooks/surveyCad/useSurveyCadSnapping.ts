import { useEffect, useMemo, useState } from 'react';
import { buildCadSpatialIndex } from '../../engine/cad/cadSpatialIndex';
import type {
  CadBounds,
  CadGripHandle,
  CadProject,
  CadSnapCandidate,
  CadSnapConstructionContext,
  CadSnapLock,
  CadSnapKind,
} from '../../engine/cad/cadTypes';

const FALLBACK_TOLERANCE_RATIO = 0.01;
const SNAP_KIND_ORDER: CadSnapKind[] = [
  'point-node',
  'endpoint',
  'midpoint',
  'center',
  'arc-midpoint',
  'quadrant',
  'intersection',
  'apparent-intersection',
  'extension',
  'perpendicular',
  'parallel',
  'direction',
  'tangent',
  'nearest',
];

export type CadSnapPreferences = Record<CadSnapKind, boolean>;

const DEFAULT_SNAP_PREFERENCES: CadSnapPreferences = {
  'point-node': true,
  endpoint: true,
  midpoint: true,
  center: true,
  'arc-midpoint': true,
  quadrant: true,
  intersection: true,
  'apparent-intersection': true,
  extension: true,
  perpendicular: true,
  parallel: true,
  direction: true,
  tangent: true,
  nearest: true,
};

const toleranceFromBounds = (project: CadProject): number => {
  if (!project.bounds) return 1;
  return Math.max(
    Math.max(project.bounds.maxX - project.bounds.minX, project.bounds.maxY - project.bounds.minY) *
      FALLBACK_TOLERANCE_RATIO,
    0.5,
  );
};

interface UseSurveyCadSnappingResult {
  activeSnap: CadSnapCandidate | null;
  nearbySnaps: readonly CadSnapCandidate[];
  pointerWorldPoint: { x: number; y: number } | null;
  snapPreferences: CadSnapPreferences;
  updatePointerWorldPoint: (
    _worldPoint: { x: number; y: number } | null,
    _toleranceWorld?: number,
    _options?: {
      lockConstruction?: boolean;
      visibleBounds?: CadBounds | null;
      restrictedGripHandles?: readonly CadGripHandle[];
    },
  ) => void;
  cycleActiveSnap: () => void;
  setSnapPreference: (_kind: CadSnapKind, _enabled: boolean) => void;
}

const CONSTRUCTION_LOCK_KINDS = new Set<CadSnapKind>(['extension', 'perpendicular', 'parallel', 'tangent']);
const isConstructionLockKind = (
  kind: CadSnapKind,
): kind is CadSnapLock['kind'] => CONSTRUCTION_LOCK_KINDS.has(kind);

export const useSurveyCadSnapping = (
  project: CadProject,
  constructionContext: CadSnapConstructionContext,
): UseSurveyCadSnappingResult => {
  const spatialIndex = useMemo(() => buildCadSpatialIndex(project), [project]);
  const [activeSnap, setActiveSnap] = useState<CadSnapCandidate | null>(null);
  const [nearbySnaps, setNearbySnaps] = useState<CadSnapCandidate[]>([]);
  const [pointerWorldPoint, setPointerWorldPoint] = useState<{ x: number; y: number } | null>(null);
  const [snapPreferences, setSnapPreferences] = useState<CadSnapPreferences>(DEFAULT_SNAP_PREFERENCES);
  const [lockedConstructionSnap, setLockedConstructionSnap] = useState<CadSnapLock | null>(null);
  const toleranceWorld = useMemo(() => toleranceFromBounds(project), [project]);
  const allowedKinds = useMemo(
    () => SNAP_KIND_ORDER.filter((kind) => snapPreferences[kind]),
    [snapPreferences],
  );
  useEffect(() => {
    setActiveSnap(null);
    setNearbySnaps([]);
    setPointerWorldPoint(null);
    setLockedConstructionSnap(null);
  }, [project, constructionContext.basePoint?.x, constructionContext.basePoint?.y]);

  return {
    activeSnap,
    nearbySnaps,
    pointerWorldPoint,
    snapPreferences,
    updatePointerWorldPoint: (worldPoint, dynamicToleranceWorld, options) => {
      setPointerWorldPoint(worldPoint);
      if (!worldPoint) {
        setActiveSnap(null);
        setNearbySnaps([]);
        if (!options?.lockConstruction) {
          setLockedConstructionSnap(null);
        }
        return;
      }
      const transientConstructionLock =
        !options?.lockConstruction && activeSnap && isConstructionLockKind(activeSnap.kind)
          ? {
              kind: activeSnap.kind,
              sourceEntityId: activeSnap.sourceEntityId.split('|')[0] ?? activeSnap.sourceEntityId,
              sourceSegmentId: activeSnap.sourceSegmentId,
              guidePoint: activeSnap.lockGuidePoint ?? { x: activeSnap.x, y: activeSnap.y },
            }
          : null;
      const restrictedGripCandidates: CadSnapCandidate[] = (options?.restrictedGripHandles ?? []).map((handle) => ({
        id: `grip-snap:${handle.id}`,
        kind:
          handle.kind === 'line-start' ||
          handle.kind === 'line-end' ||
          handle.kind === 'arc-start' ||
          handle.kind === 'arc-end'
            ? 'endpoint'
            : 'point-node',
        sourceEntityId: handle.entityId,
        x: handle.x,
        y: handle.y,
        distance: 0,
        label:
          handle.kind === 'arc-radius'
            ? `${handle.entityId} radius`
            : handle.kind === 'vertex'
              ? `${handle.entityId} v${(handle.vertexIndex ?? 0) + 1}`
              : `${handle.entityId} ${handle.kind}`,
      }));
      if (restrictedGripCandidates.length > 0) {
        const gripTolerance = dynamicToleranceWorld ?? toleranceWorld;
        const nextNearbySnaps = restrictedGripCandidates
          .filter((candidate) => allowedKinds.includes(candidate.kind))
          .map((candidate) => ({
            ...candidate,
            distance: Math.hypot(candidate.x - worldPoint.x, candidate.y - worldPoint.y),
          }))
          .filter((candidate) => candidate.distance <= gripTolerance)
          .sort((left, right) => {
            if (SNAP_KIND_ORDER.indexOf(left.kind) !== SNAP_KIND_ORDER.indexOf(right.kind)) {
              return SNAP_KIND_ORDER.indexOf(left.kind) - SNAP_KIND_ORDER.indexOf(right.kind);
            }
            if (Math.abs(left.distance - right.distance) > 1e-9) return left.distance - right.distance;
            return left.id.localeCompare(right.id, undefined, { numeric: true });
          });
        setNearbySnaps(nextNearbySnaps);
        setActiveSnap(nextNearbySnaps[0] ?? null);
        if (!options?.lockConstruction) {
          setLockedConstructionSnap(null);
        }
        return;
      }
      const nextNearbySnaps = spatialIndex.querySnapCandidates(
        worldPoint,
        dynamicToleranceWorld ?? toleranceWorld,
        allowedKinds,
        {
          ...constructionContext,
          lockedSnap: options?.lockConstruction ? lockedConstructionSnap : transientConstructionLock,
        },
        options?.visibleBounds ?? null,
      );
      setNearbySnaps(nextNearbySnaps);
      const nextSnap = spatialIndex.queryNearestSnap(
        worldPoint,
        dynamicToleranceWorld ?? toleranceWorld,
        allowedKinds,
        {
          ...constructionContext,
          lockedSnap: options?.lockConstruction ? lockedConstructionSnap : transientConstructionLock,
        },
        options?.visibleBounds ?? null,
      );
      setActiveSnap(nextSnap);
      if (options?.lockConstruction) {
        const nextLock =
          lockedConstructionSnap ??
          (nextSnap && isConstructionLockKind(nextSnap.kind)
            ? {
                kind: nextSnap.kind,
                sourceEntityId: nextSnap.sourceEntityId.split('|')[0] ?? nextSnap.sourceEntityId,
                sourceSegmentId: nextSnap.sourceSegmentId,
                guidePoint: nextSnap.lockGuidePoint ?? { x: nextSnap.x, y: nextSnap.y },
              }
            : null);
        setLockedConstructionSnap(nextLock);
        return;
      }
      setLockedConstructionSnap(null);
    },
    cycleActiveSnap: () => {
      setActiveSnap((current) => {
        if (nearbySnaps.length <= 1) return current;
        const currentIndex = current ? nearbySnaps.findIndex((candidate) => candidate.id === current.id) : -1;
        return nearbySnaps[(currentIndex + 1 + nearbySnaps.length) % nearbySnaps.length] ?? current;
      });
    },
    setSnapPreference: (kind, enabled) => {
      setSnapPreferences((current) => {
        const next = { ...current, [kind]: enabled };
        if (!Object.values(next).some(Boolean)) {
          return current;
        }
        return next;
      });
      setActiveSnap((current) => (current?.kind === kind && !enabled ? null : current));
      setNearbySnaps((current) => current.filter((candidate) => candidate.kind !== kind || enabled));
    },
  };
};
