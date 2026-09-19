// Viewport display mapping for Phase 18C drawing standards (spec §6-8).
//
// Pure + deterministic. The display scene carries drawing-unit values
// (dash pattern × linetypeScale, stored lineweight mm); this module maps them
// to screen space at render time so the scene itself stays zoom-independent
// and export-scene output (which ignores these viewport-only fields) is
// untouched.
import { resolveCadEntityAppearance } from './cadAppearance';
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

const isLayerHidden = (project: CadProject, layerId: string): boolean => {
  const layer = project.layers.find((candidate) => candidate.id === layerId);
  // Unknown/missing layers (preview, planning, F2F-generated) default VISIBLE.
  if (!layer) return false;
  return layer.visible === false || layer.frozen === true;
};

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
 */
export const filterCadDisplaySceneForViewport = (
  project: CadProject,
  scene: CadDisplayScene,
): CadDisplayScene => {
  const entities = new Map(project.entities.map((entity) => [entity.id, entity]));
  return {
    bounds: scene.bounds,
    surfaceLayers: (scene.surfaceLayers ?? []).filter((layer) => !isLayerHidden(project, layer.layerId)),
    volumeLayers: (scene.volumeLayers ?? []).filter((layer) => !isLayerHidden(project, layer.layerId)),
    // Phase 18J: profile views ride the same OFF/frozen contract — layer
    // OFF hides the view with no rebuild, ON restores it from cache.
    profileViewLayers: (scene.profileViewLayers ?? []).filter(
      (layer) => !isLayerHidden(project, layer.layerId),
    ),
    // Phase 18K: sample lines + section views ride the same OFF/frozen
    // contract — layer OFF hides with no rebuild, ON restores from cache.
    sampleLineLayers: (scene.sampleLineLayers ?? []).filter(
      (layer) => !isLayerHidden(project, layer.layerId),
    ),
    sectionViewLayers: (scene.sectionViewLayers ?? []).filter(
      (layer) => !isLayerHidden(project, layer.layerId),
    ),
    primitives: scene.primitives.filter((primitive) => {
      const entity = entities.get(primitive.sourceEntityId);
      if (!entity) return true;
      const { visible } = resolveCadEntityAppearance({
        entity,
        layer: project.layers.find((candidate) => candidate.id === entity.layerId),
        styleLibrary: project.styleLibrary,
      });
      if (!visible) return false;
      if (primitive.layerId !== entity.layerId && isLayerHidden(project, primitive.layerId)) {
        return false;
      }
      return true;
    }),
  };
};

/** Entity ids currently hidden from the viewport (for selection retirement). */
export const viewportHiddenEntityIds = (project: CadProject): Set<CadEntityId> => {
  const hidden = new Set<CadEntityId>();
  for (const entity of project.entities) {
    const { visible } = resolveCadEntityAppearance({
      entity,
      layer: project.layers.find((candidate) => candidate.id === entity.layerId),
      styleLibrary: project.styleLibrary,
    });
    if (!visible) hidden.add(entity.id);
  }
  return hidden;
};
