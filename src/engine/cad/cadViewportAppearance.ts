// Viewport display mapping for Phase 18C drawing standards (spec §6-8).
//
// Pure + deterministic. The display scene carries drawing-unit values
// (dash pattern × linetypeScale, stored lineweight mm); this module maps them
// to screen space at render time so the scene itself stays zoom-independent
// and export-scene output (which ignores these viewport-only fields) is
// untouched.
import { getCadViewportVisibilityIndex, type CadViewportVisibilityIndex } from './cadViewportVisibilityIndex';
import type {
  CadDisplayScene,
  CadEntityId,
  CadProject,
} from './cadTypes';

/** Workspace-only display preference (never dirties the drawing). */
export type LineweightDisplayMode = 'thin' | 'scaled';

export const DEFAULT_LINEWEIGHT_DISPLAY: LineweightDisplayMode = 'thin';

/** Screen px per mm at reference scale (96dpi). Zoom never enters this mapping. */
export const LINEWEIGHT_PX_PER_MM = 96 / 25.4;
const MIN_DISPLAY_PX = 0.75;
const MAX_DISPLAY_PX = 6;

/**
 * Stored mm → screen px. `thin` reproduces the legacy normalized look
 * exactly (caller passes the legacy fallback through); `scaled` maps the
 * resolved weight with clamping so dense/heavy weights never go zoom-absurd
 * (the mapping is zoom-independent by construction).
 */
export const displayedStrokeWidthPx = (
  lineweightMm: number,
  mode: LineweightDisplayMode,
  thinFallbackPx: number,
): number =>
  mode === 'thin'
    ? thinFallbackPx
    : Math.min(MAX_DISPLAY_PX, Math.max(MIN_DISPLAY_PX, lineweightMm * LINEWEIGHT_PX_PER_MM));

export interface ScreenDash {
  dasharray: string;
  dashoffset: number;
}

const roundDash = (value: number): number => Math.round(value * 100) / 100;

/**
 * Drawing-unit dash pattern → screen `stroke-dasharray`. Ratios are always
 * preserved; the whole period is normalized into [4, 512]px so patterns stay
 * visible when zoomed out without exploding when zoomed in. Phase-anchored at
 * the path start (offset 0) — pan/zoom never introduce jitter.
 *
 * Polyline phase choice: continuous across segments. Each segment passes its
 * accumulated drawing-unit length as `offsetUnits`, producing the same
 * pattern a single stroked path would show. Standalone lines/arcs restart at
 * their own start (offset 0).
 */
export const toScreenDash = (
  patternUnits: readonly number[],
  pixelsPerUnit: number,
  offsetUnits = 0,
): ScreenDash | null => {
  if (patternUnits.length === 0) return null;
  const scaled = patternUnits.map((entry) => entry * pixelsPerUnit);
  const period = scaled.reduce((sum, entry) => sum + entry, 0);
  if (!(period > 0)) return null;
  const factor = period < 4 ? 4 / period : period > 512 ? 512 / period : 1;
  const normalized = scaled.map((entry) => roundDash(entry * factor));
  const normalizedPeriod = normalized.reduce((sum, entry) => sum + entry, 0);
  const offsetPx = offsetUnits * pixelsPerUnit * factor;
  const dashoffset = normalizedPeriod > 0 ? -roundDash(((offsetPx % normalizedPeriod) + normalizedPeriod) % normalizedPeriod) : 0;
  return { dasharray: normalized.join(' '), dashoffset };
};

/**
 * Resolved transparency → primitive opacity. Returns undefined when opaque
 * so export/render defaults (and their fixtures) are untouched.
 */
export const opacityFromTransparency = (transparency: number): number | undefined =>
  transparency > 0 ? Math.round((1 - transparency) * 1000) / 1000 : undefined;

const filterVisibleLayers = <T extends { layerId: string }>(
  index: CadViewportVisibilityIndex,
  layers: readonly T[] | undefined,
): T[] => (layers ?? []).filter((layer) => !index.isLayerHidden(layer.layerId));

const filterVisibleLegends = (
  index: CadViewportVisibilityIndex,
  legends: CadDisplayScene['analysisLegendLayers'],
): NonNullable<CadDisplayScene['analysisLegendLayers']> =>
  (legends ?? []).filter(
    (legend) => !index.isLayerHidden(index.analysisLegendLayerId(legend.legendId)),
  );

/**
 * View-layer visibility filter for scene CONSUMERS (viewport canvas, sheet
 * viewports) — never inside `buildCadDisplayScene`, which must keep hidden
 * primitives for the export scene. Drops OFF/frozen-layer and
 * entity-invisible primitives. Primitives without a backing entity
 * (transient command previews) are kept.
 *
 * Synthesized labels carry `layerId: 'labels'` while belonging to a source
 * entity: hidden when EITHER the labels layer or the source entity's layer
 * hides. Label stroke itself keeps the source-style color (see cadRenderer).
 *
 * PERF-186.1: entity + layer lookups go through the per-project index
 * (O(1) each) instead of a rebuilt entity Map plus per-primitive layer scan.
 */
export const filterCadDisplaySceneForViewport = (
  project: CadProject,
  scene: CadDisplayScene,
): CadDisplayScene => {
  const index = getCadViewportVisibilityIndex(project);
  return {
    bounds: scene.bounds,
    primitives: scene.primitives.filter((primitive) => {
      const backing = index.entityVisibility(primitive.sourceEntityId);
      // No backing entity (transient preview): always visible.
      if (backing === undefined) return true;
      if (!backing.visible) return false;
      if (primitive.layerId !== backing.layerId && index.isLayerHidden(primitive.layerId)) {
        return false;
      }
      return true;
    }),
    surfaceLayers: filterVisibleLayers(index, scene.surfaceLayers),
    volumeLayers: filterVisibleLayers(index, scene.volumeLayers),
    // Phase 18U: analysis fills + legends ride the same OFF/frozen contract —
    // layer OFF hides with no recalculation, ON restores from cache.
    analysisLayers: filterVisibleLayers(index, scene.analysisLayers),
    analysisLegendLayers: filterVisibleLegends(index, scene.analysisLegendLayers),
    // Phase 18J: profile views ride the same OFF/frozen contract — layer
    // OFF hides the view with no rebuild, ON restores it from cache.
    profileViewLayers: filterVisibleLayers(index, scene.profileViewLayers),
    // Phase 18K: sample lines + section views ride the same OFF/frozen
    // contract — layer OFF hides with no rebuild, ON restores from cache.
    // Phase 20B: grading fills + daylight ride the same OFF/frozen
    // contract — layer OFF hides with no recalculation, ON restores.
    gradingLayers: filterVisibleLayers(index, scene.gradingLayers),
    // Phase 20C: grading-group fills + daylight + seam + ghosts ride the
    // same OFF/frozen contract — layer OFF hides with no recalculation.
    groupGradingLayers: filterVisibleLayers(index, scene.groupGradingLayers),
    sampleLineLayers: filterVisibleLayers(index, scene.sampleLineLayers),
    sectionViewLayers: filterVisibleLayers(index, scene.sectionViewLayers),
  };
};

export interface CadViewportDerivedLayerPatch {
  /** Already viewport-filtered primitives (metadata-only post-process). */
  primitives?: CadDisplayScene['primitives'];
  surfaceLayers?: CadDisplayScene['surfaceLayers'];
  volumeLayers?: CadDisplayScene['volumeLayers'];
  analysisLayers?: CadDisplayScene['analysisLayers'];
  analysisLegendLayers?: CadDisplayScene['analysisLegendLayers'];
  profileViewLayers?: CadDisplayScene['profileViewLayers'];
  gradingLayers?: CadDisplayScene['gradingLayers'];
  groupGradingLayers?: CadDisplayScene['groupGradingLayers'];
  sampleLineLayers?: CadDisplayScene['sampleLineLayers'];
  sectionViewLayers?: CadDisplayScene['sectionViewLayers'];
}

/**
 * PERF-186.1 — derived-layer-only viewport filter for the staged display
 * pipeline. Filters ONLY the newly attached derived layer arrays and reuses
 * every other field (including the already-filtered `base.primitives`) by
 * reference. The base scene must already be viewport-filtered; the caller
 * must only attach derived layers (and metadata-only primitive rewrites such
 * as block hover titles, which add/remove no primitives). No hidden full
 * scan: the primitive list is never re-evaluated here.
 */
export const filterCadDerivedLayersForViewport = (
  project: CadProject,
  base: CadDisplayScene,
  patch: CadViewportDerivedLayerPatch,
): CadDisplayScene => {
  const index = getCadViewportVisibilityIndex(project);
  return {
    bounds: base.bounds,
    primitives: patch.primitives ?? base.primitives,
    surfaceLayers:
      patch.surfaceLayers !== undefined
        ? filterVisibleLayers(index, patch.surfaceLayers)
        : base.surfaceLayers,
    volumeLayers:
      patch.volumeLayers !== undefined
        ? filterVisibleLayers(index, patch.volumeLayers)
        : base.volumeLayers,
    analysisLayers:
      patch.analysisLayers !== undefined
        ? filterVisibleLayers(index, patch.analysisLayers)
        : base.analysisLayers,
    analysisLegendLayers:
      patch.analysisLegendLayers !== undefined
        ? filterVisibleLegends(index, patch.analysisLegendLayers)
        : base.analysisLegendLayers,
    profileViewLayers:
      patch.profileViewLayers !== undefined
        ? filterVisibleLayers(index, patch.profileViewLayers)
        : base.profileViewLayers,
    gradingLayers:
      patch.gradingLayers !== undefined
        ? filterVisibleLayers(index, patch.gradingLayers)
        : base.gradingLayers,
    groupGradingLayers:
      patch.groupGradingLayers !== undefined
        ? filterVisibleLayers(index, patch.groupGradingLayers)
        : base.groupGradingLayers,
    sampleLineLayers:
      patch.sampleLineLayers !== undefined
        ? filterVisibleLayers(index, patch.sampleLineLayers)
        : base.sampleLineLayers,
    sectionViewLayers:
      patch.sectionViewLayers !== undefined
        ? filterVisibleLayers(index, patch.sectionViewLayers)
        : base.sectionViewLayers,
  };
};

/** Entity ids currently hidden from the viewport (for selection retirement). */
export const viewportHiddenEntityIds = (
  project: CadProject,
): ReadonlySet<CadEntityId> => getCadViewportVisibilityIndex(project).hiddenEntityIds;

