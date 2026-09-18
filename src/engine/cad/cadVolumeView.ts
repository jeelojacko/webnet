import type { CadSurfaceCache } from './cadSurfaceCache';
import type { CadSurfaceVolumeCache } from './surfaceVolumeCache';
import { backfillVolumeSurfaceStyles, computeVolumeSurfaceRevision } from './cadVolumeSurfaces';
import { resolveSurfaceLayerId } from './cadSurfaceTypes';
import { surfaceContentRevision } from './cadSurfaceView';
import type { CadProject, CadVolumeDisplayRegion } from './cadTypes';

/**
 * Phase 18I UI — volume display adapter (UI-owned, pure).
 *
 * One aggregated SVG path for CUT + one for FILL, built from the cached
 * DERIVED display regions (never CAD entities, never re-triangulation).
 * Style visibility/colors/opacity honored; No-Display styles produce no
 * layers (quantity-only requests carry includeDisplay false). Layer
 * OFF/FROZEN hides via the existing viewport filter (layerId resolved
 * through the same helper as surfaces). No volume contours.
 */

export interface CadVolumeDisplayLayer {
  volumeId: string;
  volumeName: string;
  layerId: string;
  stale: boolean;
  statusText: string;
  showCut: boolean;
  showFill: boolean;
  cutD: string;
  fillD: string;
  cutStroke: string;
  fillStroke: string;
  opacity: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

const regionToPathD = (regions: readonly CadVolumeDisplayRegion[]): string => {
  let d = '';
  for (const region of regions) {
    const vertices = region.vertices;
    if (vertices.length < 3) continue;
    const head = vertices[0]!;
    d += `M${head.x} ${head.y}`;
    for (let index = 1; index < vertices.length; index += 1) {
      d += `L${vertices[index]!.x} ${vertices[index]!.y}`;
    }
    d += 'Z';
  }
  return d;
};

const boundsOf = (
  regions: readonly CadVolumeDisplayRegion[],
): CadVolumeDisplayLayer['bounds'] => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const region of regions) {
    for (const vertex of region.vertices) {
      if (vertex.x < minX) minX = vertex.x;
      if (vertex.y < minY) minY = vertex.y;
      if (vertex.x > maxX) maxX = vertex.x;
      if (vertex.y > maxY) maxY = vertex.y;
    }
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
};

/**
 * Every CURRENT volume with displayable regions, in deterministic
 * (drawing) order. Stale/non-current volumes never render (their regions
 * belong to a superseded revision); the manager shows their retained
 * quantities with a STALE label instead.
 */
export const buildVolumeDisplayLayers = (
  project: CadProject,
  tinCache: CadSurfaceCache | null,
  volumeCache: CadSurfaceVolumeCache | null,
): CadVolumeDisplayLayer[] => {
  if (!volumeCache) return [];
  const styles = backfillVolumeSurfaceStyles(project.volumeSurfaceStyles);
  const surfaces = new Map((project.surfaces ?? []).map((entry) => [entry.id, entry]));
  const layers: CadVolumeDisplayLayer[] = [];
  for (const volume of project.volumeSurfaces ?? []) {
    const base = surfaces.get(volume.baseSurfaceId);
    const comparison = surfaces.get(volume.comparisonSurfaceId);
    if (!base || !comparison || base.id === comparison.id) continue;
    const baseRev = surfaceContentRevision(project, base);
    const cmpRev = surfaceContentRevision(project, comparison);
    // CURRENT-only display: both source TINs fresh AND result revision matches.
    if (!tinCache?.get(base.id, baseRev) || !tinCache?.get(comparison.id, cmpRev)) continue;
    const revision = computeVolumeSurfaceRevision({
      baseId: base.id,
      baseRev,
      cmpId: comparison.id,
      cmpRev,
    });
    const result = volumeCache.get(volume.id, revision);
    if (!result || !(result.overlapArea > 0)) continue;
    const style = styles.find((entry) => entry.id === volume.styleId) ?? styles[0];
    if (!style || (!style.showCut && !style.showFill)) continue;
    const regions = result.displayRegions ?? [];
    const cut = regions.filter((region) => region.kind === 'cut');
    const fill = regions.filter((region) => region.kind === 'fill');
    const showCut = style.showCut && cut.length > 0;
    const showFill = style.showFill && fill.length > 0;
    if (!showCut && !showFill) continue;
    layers.push({
      volumeId: volume.id,
      volumeName: volume.name,
      layerId: resolveSurfaceLayerId(project, volume.layerId),
      stale: false,
      statusText: 'Current',
      showCut,
      showFill,
      cutD: showCut ? regionToPathD(cut) : '',
      fillD: showFill ? regionToPathD(fill) : '',
      cutStroke: style.cutColor,
      fillStroke: style.fillColor,
      opacity: style.opacity,
      bounds: boundsOf([...cut, ...fill]),
    });
  }
  return layers;
};
