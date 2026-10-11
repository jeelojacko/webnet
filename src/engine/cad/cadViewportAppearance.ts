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
  CadLayer,
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

// ---------------------------------------------------------------------------
// PERF-CAD-SCENE.1 — base display-scene reuse guard (pure, no React).
//
// `useSurveyCadWorkspace` builds the BASE scene (before viewport filtering)
// once per committed project. `buildCadDisplayScene` never reads a layer NAME
// (lookups are by id, and layer styling reads color/lineTypeId/lineweightMm/
// transparency only), so a `LAYER_RENAME` — a shallow project spread with a new
// `layers` array and every other slice reference-identical — can reuse the
// previous base scene and only re-run the viewport filter on the CURRENT
// project. The guard is intentionally fail-closed: every top-level project
// slice EXCEPT `layers` must be reference-identical, and `layers` must have
// the same length/order/ids with every field except `name` equal. A field
// added later to `CadProject` therefore defaults to forcing a rebuild. No JSON
// signatures, no traversal of entity/style tables, no timing assumptions.
// ---------------------------------------------------------------------------

/**
 * The build inputs whose identity/version participates in the base scene
 * (mirrors the display-scene memo dependencies). `surfaceCache` and
 * `surfaceRevisionIndex` are pinned by identity; `surfaceContourInputs`
 * churns in identity on every project commit while `surfaceVolumeInputs` is
 * reference-stable unless its caches/version change. Both session slots are
 * pinned by presence + `version` + their session-cache provenance (see
 * `sameContourInputs` / `sameVolumeInputs`).
 */
export interface CadDisplaySceneBuildInputs {
  lineweightDisplay: LineweightDisplayMode;
  surfaceCache?: unknown;
  surfaceRevisionIndex?: unknown;
  surfaceContourInputs?: unknown;
  surfaceVolumeInputs?: unknown;
}

/** Per-workspace (hook-instance-local) cached base scene; never global. */
export interface CadDisplaySceneBaseCacheEntry {
  project: CadProject;
  scene: CadDisplayScene;
  inputs: CadDisplaySceneBuildInputs;
}

/** Session inputs whose identity churns but whose `version` tag is stable. */
interface VersionedSessionInput {
  version?: unknown;
}

/** Contour slot provenance threaded from the contour lifecycle hook. */
interface ContourSessionInput extends VersionedSessionInput {
  contourCache?: unknown;
}

/** Volume slot provenance threaded from the workspace shell. */
interface VolumeSessionInput extends VersionedSessionInput {
  tinCache?: unknown;
  volumeCache?: unknown;
}

/** Numeric `version` tags are the only encoding accepted (fail-closed). */
const versionMatches = (previous: VersionedSessionInput, next: VersionedSessionInput): boolean =>
  typeof previous.version === 'number' && previous.version === next.version;

const ownKeys = (value: object): string[] => Object.keys(value as Record<string, unknown>);

const sameKeys = (first: object, second: object): boolean => {
  const firstKeys = ownKeys(first);
  const secondKeys = ownKeys(second);
  if (firstKeys.length !== secondKeys.length) return false;
  return firstKeys.every((key) => Object.prototype.hasOwnProperty.call(second, key));
};

/**
 * Known own-keys per session-input slot. A key outside its slot's allowlist is
 * unproven provenance and fails closed until explicitly gated here — even when
 * the same unknown key is present on BOTH inputs with identical values, since
 * matching keys alone cannot prove the getter ignores it.
 *
 * `getContours`/`buildingVolumeIds`/`sessionDiagnostics` are carried by the
 * production inputs but never read by the display-scene getters; they are
 * allowlisted so a new (potentially read) field is the only thing that trips.
 */
const CONTOUR_INPUT_KNOWN_KEYS: ReadonlySet<string> = new Set([
  'version',
  'contourCache',
  'getContours',
]);
const VOLUME_INPUT_KNOWN_KEYS: ReadonlySet<string> = new Set([
  'version',
  'tinCache',
  'volumeCache',
  'buildingVolumeIds',
  'sessionDiagnostics',
]);

/** True only when every own key of `value` is in the slot's allowlist. */
const hasOnlyKnownKeys = (value: object, knownKeys: ReadonlySet<string>): boolean =>
  ownKeys(value).every((key) => knownKeys.has(key));

/**
 * The contour scene input is rebuilt by the shell whenever `cadProject`
 * changes, so its object identity churns on a layer-only edit even though its
 * content does not; the volume input is reference-stable unless its
 * caches/version change. Field-aware comparators accept a new identity only
 * when presence matches, the numeric `version` tag is equal, and every
 * session-cache object the getter reads is reference-identical:
 *
 *  - contour: `surfaceCache` is pinned at the top level; the getter's only
 *    other mutable provenance is `contourCache` (identity stable across a
 *    layer rename — it is memoized on the drawing id — and every mutation
 *    bumps `version`);
 *  - volume: the getter reads `tinCache` + `volumeCache`; both are stable
 *    across a layer rename and every volume mutation bumps `version`.
 *
 * `version` alone is NOT sufficient (a cache can be swapped without a bump);
 * each slot is therefore pinned by presence + version + cache identity. Each
 * own-key set must also be a subset of the slot's known-key allowlist, so a
 * newly added input field fails closed — even when present on both sides with
 * equal values — until it is explicitly gated. A presence change
 * (`undefined` <-> object) changes the scene shape and always forces a rebuild.
 *
 * INVARIANT (guarded by tests): the contour/volume getters must never read
 * layer NAMES. `layersDifferOnlyByName` already requires every non-layer
 * project slice to be reference-identical, so any getter that satisfies this
 * invariant returns identical output across the accepted edit.
 */
const sameContourInputs = (previous: unknown, next: unknown): boolean => {
  if (previous === next) return true;
  if (previous == null || next == null) return false;
  if (typeof previous !== 'object' || typeof next !== 'object') return false;
  if (!sameKeys(previous, next)) return false;
  if (!hasOnlyKnownKeys(previous, CONTOUR_INPUT_KNOWN_KEYS)) return false;
  if (!hasOnlyKnownKeys(next, CONTOUR_INPUT_KNOWN_KEYS)) return false;
  const previousInput = previous as ContourSessionInput;
  const nextInput = next as ContourSessionInput;
  return (
    versionMatches(previousInput, nextInput) &&
    previousInput.contourCache === nextInput.contourCache
  );
};

const sameVolumeInputs = (previous: unknown, next: unknown): boolean => {
  if (previous === next) return true;
  if (previous == null || next == null) return false;
  if (typeof previous !== 'object' || typeof next !== 'object') return false;
  if (!sameKeys(previous, next)) return false;
  if (!hasOnlyKnownKeys(previous, VOLUME_INPUT_KNOWN_KEYS)) return false;
  if (!hasOnlyKnownKeys(next, VOLUME_INPUT_KNOWN_KEYS)) return false;
  const previousInput = previous as VolumeSessionInput;
  const nextInput = next as VolumeSessionInput;
  return (
    versionMatches(previousInput, nextInput) &&
    previousInput.tinCache === nextInput.tinCache &&
    previousInput.volumeCache === nextInput.volumeCache
  );
};

const sameInputs = (
  previous: CadDisplaySceneBuildInputs,
  next: CadDisplaySceneBuildInputs,
): boolean =>
  sameKeys(previous, next) &&
  previous.lineweightDisplay === next.lineweightDisplay &&
  previous.surfaceCache === next.surfaceCache &&
  previous.surfaceRevisionIndex === next.surfaceRevisionIndex &&
  sameContourInputs(previous.surfaceContourInputs, next.surfaceContourInputs) &&
  sameVolumeInputs(previous.surfaceVolumeInputs, next.surfaceVolumeInputs);

/** Every top-level project slice except `layers` must be the same reference. */
const sameNonLayerProjectSlices = (previous: CadProject, next: CadProject): boolean => {
  if (previous === next) return true;
  if (!sameKeys(previous, next)) return false;
  const previousRecord = previous as unknown as Record<string, unknown>;
  const nextRecord = next as unknown as Record<string, unknown>;
  return ownKeys(previous).every(
    (key) => key === 'layers' || previousRecord[key] === nextRecord[key],
  );
};

/** One layer pair is equivalent when only `name` may differ. */
const layerEqualsExceptName = (previous: CadLayer, next: CadLayer): boolean => {
  if (previous === next) return true;
  if (previous.id !== next.id) return false;
  if (!sameKeys(previous, next)) return false;
  const previousRecord = previous as unknown as Record<string, unknown>;
  const nextRecord = next as unknown as Record<string, unknown>;
  return ownKeys(previous).every(
    (key) => key === 'name' || previousRecord[key] === nextRecord[key],
  );
};

/** Layer tables match by length, id order, and every field except `name`. */
const layersDifferOnlyByName = (
  previous: readonly CadLayer[],
  next: readonly CadLayer[],
): boolean => {
  if (previous === next) return true;
  if (previous.length !== next.length) return false;
  return previous.every((layer, index) => layerEqualsExceptName(layer, next[index]!));
};

/**
 * True when `project` can reuse `entry.scene` as the base display scene:
 * identical build inputs, identical non-layer slices, and layers that differ
 * only by name. `null`/undefined entry always rebuilds.
 */
export const canReuseCadDisplaySceneBase = (
  entry: CadDisplaySceneBaseCacheEntry | null | undefined,
  project: CadProject,
  inputs: CadDisplaySceneBuildInputs,
): boolean => {
  if (entry == null) return false;
  if (!sameInputs(entry.inputs, inputs)) return false;
  if (!sameNonLayerProjectSlices(entry.project, project)) return false;
  return layersDifferOnlyByName(entry.project.layers, project.layers);
};

