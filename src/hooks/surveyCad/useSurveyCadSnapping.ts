import { useEffect, useMemo, useState } from 'react';
import { buildCadSpatialIndex } from '../../engine/cad/cadSpatialIndex';
import type { CadProject, CadSnapCandidate, CadSnapKind } from '../../engine/cad/cadTypes';

const FALLBACK_TOLERANCE_RATIO = 0.02;
const SNAP_KIND_ORDER: CadSnapKind[] = [
  'point-node',
  'endpoint',
  'midpoint',
  'center',
  'arc-midpoint',
  'quadrant',
  'intersection',
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
  updatePointerWorldPoint: (_worldPoint: { x: number; y: number } | null) => void;
  setSnapPreference: (_kind: CadSnapKind, _enabled: boolean) => void;
}

export const useSurveyCadSnapping = (project: CadProject): UseSurveyCadSnappingResult => {
  const spatialIndex = useMemo(() => buildCadSpatialIndex(project), [project]);
  const [activeSnap, setActiveSnap] = useState<CadSnapCandidate | null>(null);
  const [pointerWorldPoint, setPointerWorldPoint] = useState<{ x: number; y: number } | null>(null);
  const [snapPreferences, setSnapPreferences] = useState<CadSnapPreferences>(DEFAULT_SNAP_PREFERENCES);
  const toleranceWorld = useMemo(() => toleranceFromBounds(project), [project]);
  const allowedKinds = useMemo(
    () => SNAP_KIND_ORDER.filter((kind) => snapPreferences[kind]),
    [snapPreferences],
  );

  useEffect(() => {
    setActiveSnap(null);
    setPointerWorldPoint(null);
  }, [project]);

  return {
    activeSnap,
    pointerWorldPoint,
    snapPreferences,
    updatePointerWorldPoint: (worldPoint) => {
      setPointerWorldPoint(worldPoint);
      if (!worldPoint) {
        setActiveSnap(null);
        return;
      }
      setActiveSnap(spatialIndex.queryNearestSnap(worldPoint, toleranceWorld, allowedKinds));
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
