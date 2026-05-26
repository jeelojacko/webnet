import { useEffect, useMemo, useState } from 'react';
import { buildCadSpatialIndex } from '../../engine/cad/cadSpatialIndex';
import type { CadProject, CadSnapCandidate } from '../../engine/cad/cadTypes';

const FALLBACK_TOLERANCE_RATIO = 0.02;

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
  snapStatusText: string;
  updatePointerWorldPoint: (_worldPoint: { x: number; y: number } | null) => void;
}

export const useSurveyCadSnapping = (project: CadProject): UseSurveyCadSnappingResult => {
  const spatialIndex = useMemo(() => buildCadSpatialIndex(project), [project]);
  const [activeSnap, setActiveSnap] = useState<CadSnapCandidate | null>(null);
  const toleranceWorld = useMemo(() => toleranceFromBounds(project), [project]);

  useEffect(() => {
    setActiveSnap(null);
  }, [project]);

  return {
    activeSnap,
    snapStatusText: activeSnap
      ? `Snap ${activeSnap.kind}: ${activeSnap.label}`
      : 'Snap idle. Move over geometry for point, endpoint, midpoint, or nearest snaps.',
    updatePointerWorldPoint: (worldPoint) => {
      if (!worldPoint) {
        setActiveSnap(null);
        return;
      }
      setActiveSnap(spatialIndex.queryNearestSnap(worldPoint, toleranceWorld));
    },
  };
};
