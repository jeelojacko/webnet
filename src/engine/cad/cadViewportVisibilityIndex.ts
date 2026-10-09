// PERF-186.1 — indexed viewport visibility.
//
// The viewport display filter resolves, for every display primitive, whether
// its backing entity is visible (entity.visible + layer OFF/FROZEN) and, for
// labeled/synthesized primitives, whether the primitive's own layer hides.
// The baseline rebuilt an entity Map and linear-scanned `project.layers` per
// primitive (O(P·L)); this module builds ONE index per immutable project
// version so every query is O(1).
//
// Immutability contract: `CadProject` values are immutable — every history
// transaction replaces the project object (see cadTransactions). The index is
// memoized in a `WeakMap` keyed by project identity, so a replaced project
// (even with the same ids) rebuilds, and no strong reference outlives the
// project. In-place mutation of a live project/layer/entity is out of
// contract and test-pinned.
//
// Duplicate-id semantics (baseline truth, pinned by
// tests/cad_viewport_filter_186.test.ts against a verbatim baseline replica):
//   - Entities: the baseline display path builds its lookup via
//     `new Map(project.entities.map((entity) => [entity.id, entity]))`, so the
//     LAST row with a given id decides what is drawn. The baseline
//     `viewportHiddenEntityIds` traversal instead loops ALL rows and adds the
//     id when ANY row resolves hidden — a later visible row never removes it.
//     This index matches both: `visibilityById` is overwritten per row
//     (LAST-WINS display) while `hiddenEntityIds` only ever gains ids
//     (ANY-HIDDEN retirement). Every row is resolved (linear in rows) with
//     O(1) layer/style lookups — no per-row layer scans.
//   - Layers, styles, analysis legends, and analysis maps resolve FIRST-WINS,
//     matching the baseline `.find(...)` selection used for each of them.
import { resolveCadEntityAppearance } from './cadAppearance';
import type {
  CadAnalysisLegend,
  CadAnalysisMap,
  CadEntityId,
  CadLayer,
  CadProject,
  CadStyle,
} from './cadTypes';

export interface CadEntityVisibility {
  visible: boolean;
  /** Backing entity's own layer id (for layered-label checks). */
  layerId: string;
}

export interface CadViewportVisibilityIndex {
  /** True when the first layer with this id is OFF or FROZEN. Unknown => false. */
  isLayerHidden: (_layerId: string) => boolean;
  /** Effective backing-entity visibility; undefined when the entity is unknown. */
  entityVisibility: (_entityId: CadEntityId) => CadEntityVisibility | undefined;
  /** Layer an analysis legend draws on: parent map layer, else `'general'`. */
  analysisLegendLayerId: (_legendId: string) => string;
  /** Entity ids hidden by entity.visible === false or layer OFF/FROZEN. */
  hiddenEntityIds: ReadonlySet<CadEntityId>;
}

const firstById = <T extends { id: string }>(rows: readonly T[] | undefined): Map<string, T> => {
  const map = new Map<string, T>();
  for (const row of rows ?? []) {
    if (!map.has(row.id)) map.set(row.id, row); // first-wins (matches `.find`)
  }
  return map;
};

const buildIndex = (project: CadProject): CadViewportVisibilityIndex => {
  const layerById = firstById<CadLayer>(project.layers);
  const styleById = firstById<CadStyle>(project.styleLibrary?.styles);
  const legendById = firstById<CadAnalysisLegend>(project.analysisLegends);
  const analysisById = firstById<CadAnalysisMap>(project.analysisMaps);

  // First-wins hidden-layer set: the hidden state of the FIRST layer with a
  // given id decides (matching `project.layers.find(...)`).
  const layerHiddenById = new Map<string, boolean>();
  for (const layer of project.layers) {
    if (!layerHiddenById.has(layer.id)) {
      layerHiddenById.set(layer.id, layer.visible === false || layer.frozen === true);
    }
  }

  const isLayerHidden = (layerId: string): boolean =>
    layerHiddenById.get(layerId) === true;

  // Baseline duplicate-entity semantics: every row resolves (linear in rows,
  // O(1) lookups each); the LAST row with an id wins the display lookup
  // (matching `new Map(rows.map(...))`), while the hidden set gains the id
  // when ANY row resolves hidden and is never cleared by a later visible row
  // (matching the baseline hidden-entity traversal).
  const visibilityById = new Map<CadEntityId, CadEntityVisibility>();
  const hiddenEntityIds = new Set<CadEntityId>();
  for (const entity of project.entities) {
    const layer = layerById.get(entity.layerId);
    const { visible } = resolveCadEntityAppearance({
      entity,
      layer,
      styleLibrary: project.styleLibrary,
      styleById,
    });
    visibilityById.set(entity.id, { visible, layerId: entity.layerId });
    if (!visible) hiddenEntityIds.add(entity.id);
  }

  const entityVisibility = (entityId: CadEntityId): CadEntityVisibility | undefined =>
    visibilityById.get(entityId);

  const analysisLegendLayerId = (legendId: string): string => {
    const legend = legendById.get(legendId);
    const map = legend ? analysisById.get(legend.analysisId) : undefined;
    return map?.layerId ?? 'general';
  };

  return { isLayerHidden, entityVisibility, analysisLegendLayerId, hiddenEntityIds };
};

const indexCache = new WeakMap<CadProject, CadViewportVisibilityIndex>();

/** Memoized per immutable project version (WeakMap keyed on project identity). */
export const getCadViewportVisibilityIndex = (
  project: CadProject,
): CadViewportVisibilityIndex => {
  const cached = indexCache.get(project);
  if (cached !== undefined) return cached;
  const built = buildIndex(project);
  indexCache.set(project, built);
  return built;
};
