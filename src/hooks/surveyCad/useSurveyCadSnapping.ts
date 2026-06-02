import { useEffect, useMemo, useState } from 'react';
import { buildCadSpatialIndex } from '../../engine/cad/cadSpatialIndex';
import type {
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
  pointerWorldPoint: { x: number; y: number } | null;
  snapPreferences: CadSnapPreferences;
  updatePointerWorldPoint: (
    _worldPoint: { x: number; y: number } | null,
    _toleranceWorld?: number,
    _options?: { lockConstruction?: boolean },
  ) => void;
  setSnapPreference: (_kind: CadSnapKind, _enabled: boolean) => void;
}

const CONSTRUCTION_LOCK_KINDS = new Set<CadSnapKind>(['extension', 'perpendicular', 'parallel']);
const isConstructionLockKind = (
  kind: CadSnapKind,
): kind is CadSnapLock['kind'] => CONSTRUCTION_LOCK_KINDS.has(kind);

export const useSurveyCadSnapping = (
  project: CadProject,
  constructionContext: CadSnapConstructionContext,
): UseSurveyCadSnappingResult => {
  const spatialIndex = useMemo(() => buildCadSpatialIndex(project), [project]);
  const [activeSnap, setActiveSnap] = useState<CadSnapCandidate | null>(null);
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
    setPointerWorldPoint(null);
    setLockedConstructionSnap(null);
  }, [project, constructionContext.basePoint?.x, constructionContext.basePoint?.y]);

  return {
    activeSnap,
    pointerWorldPoint,
    snapPreferences,
    updatePointerWorldPoint: (worldPoint, dynamicToleranceWorld, options) => {
      setPointerWorldPoint(worldPoint);
      if (!worldPoint) {
        setActiveSnap(null);
        if (!options?.lockConstruction) {
          setLockedConstructionSnap(null);
        }
        return;
      }
      const nextSnap = spatialIndex.queryNearestSnap(
        worldPoint,
        dynamicToleranceWorld ?? toleranceWorld,
        allowedKinds,
        {
          ...constructionContext,
          lockedSnap: options?.lockConstruction ? lockedConstructionSnap : null,
        },
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
              }
            : null);
        setLockedConstructionSnap(nextLock);
        return;
      }
      setLockedConstructionSnap(null);
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
    },
  };
};
