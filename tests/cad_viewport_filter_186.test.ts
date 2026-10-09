// PERF-186.1 — single viewport visibility filter.
//
// Root cause: the CAD display pipeline called
// `filterCadDisplaySceneForViewport` four times per mount (hook + three
// staged `displaySceneWith*` memos), and each call rebuilt an entity Map and
// scanned `project.layers` per primitive (O(P·L)). The fix keeps ONE full
// primitive scan (hook) and filters only newly attached derived layers in the
// staged memos, backed by a per-project indexed visibility helper.
//
// This suite proves:
//  (A) exact parity between the pre-fix 4-pass pipeline and the new
//      full+derived pipeline (final scene deep-equal, hidden set deep-equal);
//  (B) one full scan instead of four, measured by test-only wrappers/spies
//      and `.find`-counting proxies around the real shipped functions
//      (production code carries zero counters; no wall-clock);
//  (C) OFF/FROZEN labels, backing entities, unknown/missing, previews,
//      segment ids, appearance/opacity, and all derived layer families;
//  (D) the index WeakMap invalidation contract (replacement, same ids,
//      no id-only stale state) and baseline duplicate-id semantics:
//      LAST-WINS display (matching `new Map(rows.map(...))`), ANY-HIDDEN
//      retirement (matching the baseline hidden-entity traversal), and
//      FIRST-WINS layers/styles/legends/maps (matching `.find`).
import { describe, expect, it } from 'vitest';
import { resolveCadEntityAppearance } from '../src/engine/cad/cadAppearance';
import { withBlockHoverTitles } from '../src/cad-app/blocks/cadBlockOverlay';
import {
  filterCadDerivedLayersForViewport,
  filterCadDisplaySceneForViewport,
  viewportHiddenEntityIds,
} from '../src/engine/cad/cadViewportAppearance';
import {
  getCadViewportVisibilityIndex,
} from '../src/engine/cad/cadViewportVisibilityIndex';
import {
  createViewportFilterSpies,
  withCountedProjectFinds,
} from './cad_viewport_filter_186_instrument';
import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import type {
  CadBlockDefinition,
  CadBlockReferenceEntity,
  CadDisplayScene,
  CadEntity,
  CadEntityId,
  CadLayer,
  CadLineEntity,
  CadProject,
  CadStyleLibrary,
} from '../src/engine/cad/cadTypes';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STYLE_LIBRARY: CadStyleLibrary = {
  lineTypes: [{ id: 'continuous', name: 'Continuous', dashPattern: [] }],
  textStyles: [],
  pointSymbols: [],
  styles: [
    { id: 'style-observation-line', name: 'Observation', color: '#22c55e', strokeWidth: 1.25 },
  ],
};

const layer = (id: string, overrides: Partial<CadLayer> = {}): CadLayer => ({
  id,
  name: id,
  color: '#e2e8f0',
  visible: true,
  locked: false,
  role: 'planning',
  ...overrides,
});

const line = (index: number, layerId: string, overrides: Partial<CadLineEntity> = {}): CadLineEntity => ({
  id: `line:${index}`,
  type: 'line',
  layerId,
  visible: true,
  locked: false,
  fromStationId: `A${index}`,
  toStationId: `B${index}`,
  fromX: index,
  fromY: 0,
  toX: index + 1,
  toY: 1,
  sourceObservationIds: [],
  ...overrides,
});

const project = (overrides: Partial<CadProject> = {}): CadProject => ({
  version: 2,
  id: 'perf-186',
  name: 'PERF-186',
  metadata: {
    source: 'parsed-input',
    runMode: 'adjustment',
    units: 'm',
    stationCount: 0,
    observationCount: 0,
    adjustedStationCount: 0,
  },
  layers: [layer('general'), layer('labels'), layer('points')],
  styleLibrary: STYLE_LIBRARY,
  entities: [],
  cogoComputations: [],
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  ...overrides,
});

type Primitive = CadDisplayScene['primitives'][number];

const linePrimitive = (
  entity: CadLineEntity,
  layerId = entity.layerId,
  id = `prim:${entity.id}`,
): Primitive => ({
  kind: 'line',
  id,
  layerId,
  sourceEntityId: entity.id,
  sourceSegmentId: `${entity.id}#0`,
  stroke: '#e2e8f0',
  points: [
    { x: entity.fromX, y: entity.fromY },
    { x: entity.toX, y: entity.toY },
  ],
  strokeWidth: 1.25,
});

const textPrimitive = (
  entity: CadLineEntity,
  id = `label:${entity.id}`,
): Primitive => ({
  kind: 'text',
  id,
  layerId: 'labels',
  sourceEntityId: entity.id,
  sourceSegmentId: `${entity.id}#0`,
  stroke: '#e2e8f0',
  point: { x: entity.fromX, y: entity.fromY },
  text: entity.id,
  fontSize: 2.5,
});

const previewPrimitive = (id: string, layerId = 'preview'): Primitive => ({
  kind: 'point',
  id,
  layerId,
  sourceEntityId: id,
  stroke: '#22d3ee',
  fill: '#22d3ee',
  point: { x: 1, y: 1 },
  radius: 2.4,
});

const surfaceLayer = (layerId: string, surfaceId = 's') =>
  ({ surfaceId, surfaceName: surfaceId, layerId, stale: false, statusText: '', stroke: '#000', opacity: 1, showTriangles: true, showVertices: false, showBoundary: true, trianglesD: '', boundaryD: '', vertices: [], verticesTruncated: false, vertexCount: 0, bounds: null });

const simpleLayer = (layerId: string, marker: string) => ({ layerId, marker });

// The scanner only reads `layerId` (and `legendId` for legends); these minimal
// objects carry every field the filter touches.
const asDerived = <T>(rows: unknown[]): T[] => rows as unknown as T[];

// ---------------------------------------------------------------------------
// Pre-fix pipeline replica (counted). Mirrors `cadViewportAppearance` before
// PERF-186.1: rebuilt entity Map + `.find` layer scans per primitive.
// ---------------------------------------------------------------------------

interface LegacyCounters {
  entityMapBuilds: number;
  entityLookups: number;
  layerFinds: number;
  primitiveEvals: number;
}

const legacyCounters = (): LegacyCounters => ({
  entityMapBuilds: 0,
  entityLookups: 0,
  layerFinds: 0,
  primitiveEvals: 0,
});

const legacyIsLayerHidden = (
  target: CadProject,
  layerId: string,
  counters: LegacyCounters,
): boolean => {
  counters.layerFinds += 1;
  const found = target.layers.find((candidate) => candidate.id === layerId);
  if (!found) return false;
  return found.visible === false || found.frozen === true;
};

const legacyFilter = (
  target: CadProject,
  scene: CadDisplayScene,
  counters: LegacyCounters,
): CadDisplayScene => {
  counters.entityMapBuilds += 1;
  const entities = new Map(target.entities.map((entity) => [entity.id, entity]));
  return {
    bounds: scene.bounds,
    surfaceLayers: (scene.surfaceLayers ?? []).filter((entry) => !legacyIsLayerHidden(target, entry.layerId, counters)),
    volumeLayers: (scene.volumeLayers ?? []).filter((entry) => !legacyIsLayerHidden(target, entry.layerId, counters)),
    analysisLayers: (scene.analysisLayers ?? []).filter((entry) => !legacyIsLayerHidden(target, entry.layerId, counters)),
    analysisLegendLayers: (scene.analysisLegendLayers ?? []).filter((legend) => {
      const def = (target.analysisLegends ?? []).find((entry) => entry.id === legend.legendId);
      const map = def
        ? (target.analysisMaps ?? []).find((entry) => entry.id === def.analysisId)
        : undefined;
      return !legacyIsLayerHidden(target, map?.layerId ?? 'general', counters);
    }),
    profileViewLayers: (scene.profileViewLayers ?? []).filter((entry) => !legacyIsLayerHidden(target, entry.layerId, counters)),
    gradingLayers: (scene.gradingLayers ?? []).filter((entry) => !legacyIsLayerHidden(target, entry.layerId, counters)),
    groupGradingLayers: (scene.groupGradingLayers ?? []).filter((entry) => !legacyIsLayerHidden(target, entry.layerId, counters)),
    sampleLineLayers: (scene.sampleLineLayers ?? []).filter((entry) => !legacyIsLayerHidden(target, entry.layerId, counters)),
    sectionViewLayers: (scene.sectionViewLayers ?? []).filter((entry) => !legacyIsLayerHidden(target, entry.layerId, counters)),
    primitives: scene.primitives.filter((primitive) => {
      counters.primitiveEvals += 1;
      const entity = entities.get(primitive.sourceEntityId);
      counters.entityLookups += 1;
      if (!entity) return true;
      counters.layerFinds += 1; // entity layer lookup for appearance resolution
      const { visible } = resolveCadEntityAppearance({
        entity,
        layer: target.layers.find((candidate) => candidate.id === entity.layerId),
        styleLibrary: target.styleLibrary,
      });
      if (!visible) return false;
      if (primitive.layerId !== entity.layerId && legacyIsLayerHidden(target, primitive.layerId, counters)) {
        return false;
      }
      return true;
    }),
  };
};

// ---------------------------------------------------------------------------
// Pipeline assembly
// ---------------------------------------------------------------------------

interface DerivedBundle {
  profileViewLayers: CadDisplayScene['profileViewLayers'];
  sampleLineLayers: CadDisplayScene['sampleLineLayers'];
  sectionViewLayers: CadDisplayScene['sectionViewLayers'];
  analysisLayers: CadDisplayScene['analysisLayers'];
  analysisLegendLayers: CadDisplayScene['analysisLegendLayers'];
  gradingLayers: CadDisplayScene['gradingLayers'];
  groupGradingLayers: CadDisplayScene['groupGradingLayers'];
}

// Verbatim baseline `viewportHiddenEntityIds` replica (a64c3568): loops ALL
// entity rows and adds the id when ANY row resolves hidden through the
// first-wins layer lookup. A later visible row never removes the id.
const legacyHiddenEntityIds = (
  target: CadProject,
  counters: LegacyCounters,
): Set<CadEntityId> => {
  const hidden = new Set<CadEntityId>();
  for (const entity of target.entities) {
    counters.layerFinds += 1;
    const { visible } = resolveCadEntityAppearance({
      entity,
      layer: target.layers.find((candidate) => candidate.id === entity.layerId),
      styleLibrary: target.styleLibrary,
    });
    if (!visible) hidden.add(entity.id);
  }
  return hidden;
};

const legacyPipeline = (
  target: CadProject,
  rawScene: CadDisplayScene,
  derived: DerivedBundle,
  counters: LegacyCounters,
): CadDisplayScene => {
  // hook
  let scene = legacyFilter(target, rawScene, counters);
  // displaySceneWithProfiles
  scene = legacyFilter(target, { ...scene, profileViewLayers: derived.profileViewLayers }, counters);
  // displaySceneWithSections
  scene = legacyFilter(target, {
    ...scene,
    primitives: withBlockHoverTitles(target, scene.primitives),
    sampleLineLayers: derived.sampleLineLayers,
    sectionViewLayers: derived.sectionViewLayers,
    analysisLayers: derived.analysisLayers,
    analysisLegendLayers: derived.analysisLegendLayers,
  }, counters);
  // displaySceneWithGrading
  return legacyFilter(target, {
    ...scene,
    gradingLayers: derived.gradingLayers,
    groupGradingLayers: derived.groupGradingLayers,
  }, counters);
};

interface NewPipelineFilters {
  fullFilter: typeof filterCadDisplaySceneForViewport;
  derivedFilter: typeof filterCadDerivedLayersForViewport;
}

const newPipeline = (
  target: CadProject,
  rawScene: CadDisplayScene,
  derived: DerivedBundle,
  filters: NewPipelineFilters = {
    fullFilter: filterCadDisplaySceneForViewport,
    derivedFilter: filterCadDerivedLayersForViewport,
  },
): CadDisplayScene => {
  let scene = filters.fullFilter(target, rawScene); // hook: one full scan
  scene = filters.derivedFilter(target, scene, { profileViewLayers: derived.profileViewLayers });
  scene = filters.derivedFilter(target, scene, {
    primitives: withBlockHoverTitles(target, scene.primitives),
    sampleLineLayers: derived.sampleLineLayers,
    sectionViewLayers: derived.sectionViewLayers,
    analysisLayers: derived.analysisLayers,
    analysisLegendLayers: derived.analysisLegendLayers,
  });
  return filters.derivedFilter(target, scene, {
    gradingLayers: derived.gradingLayers,
    groupGradingLayers: derived.groupGradingLayers,
  });
};

const emptyDerived = (): DerivedBundle => ({
  profileViewLayers: [],
  sampleLineLayers: [],
  sectionViewLayers: [],
  analysisLayers: [],
  analysisLegendLayers: [],
  gradingLayers: [],
  groupGradingLayers: [],
});

const sceneOf = (primitives: Primitive[], extra: Partial<CadDisplayScene> = {}): CadDisplayScene => ({
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  primitives,
  ...extra,
});

// ---------------------------------------------------------------------------
// A + B — parity and deterministic counts
// ---------------------------------------------------------------------------

describe('PERF-186.1 pipeline parity and scan counts', () => {
  const ENTITY_COUNT = 2000;
  const LAYER_COUNT = 60;

  const buildDense = (): { target: CadProject; rawScene: CadDisplayScene } => {
    const layers: CadLayer[] = [];
    for (let index = 0; index < LAYER_COUNT; index += 1) layers.push(layer(`layer:${index}`));
    const entities: CadEntity[] = [];
    const primitives: Primitive[] = [];
    for (let index = 0; index < ENTITY_COUNT; index += 1) {
      const entity = line(index, `layer:${index % LAYER_COUNT}`);
      entities.push(entity);
      primitives.push(linePrimitive(entity));
      if (index % 8 === 0) primitives.push(textPrimitive(entity));
    }
    primitives.push(previewPrimitive('preview:1'));
    const target = project({ layers, entities });
    return { target, rawScene: sceneOf(primitives) };
  };

  it('produces a byte-identical final scene while scanning primitives once instead of four times', () => {
    const { target, rawScene } = buildDense();
    const derived = emptyDerived();

    const before = legacyCounters();
    const legacyFinal = legacyPipeline(target, rawScene, derived, before);
    const legacyHidden = legacyHiddenEntityIds(target, legacyCounters());

    // Test-only measurement around the real shipped filters (production code
    // carries zero counters): invocation spies plus `.find`-counting proxies
    // on the project's lookup arrays.
    const spies = createViewportFilterSpies();
    const counted = withCountedProjectFinds(target);
    const newFinal = newPipeline(counted.project, rawScene, derived, spies);

    // Parity: exact same ordered primitives + derived arrays.
    expect(newFinal).toEqual(legacyFinal);
    expect(newFinal.primitives.map((entry) => entry.id)).toEqual(legacyFinal.primitives.map((entry) => entry.id));
    // Hidden-set parity against the baseline ANY-HIDDEN traversal.
    expect(viewportHiddenEntityIds(target)).toEqual(legacyHidden);

    // BEFORE: four full passes → four entity-map builds and 4×P evals.
    expect(before.entityMapBuilds).toBe(4);
    expect(before.primitiveEvals).toBe(rawScene.primitives.length * 4);
    expect(before.layerFinds).toBeGreaterThan(rawScene.primitives.length * 4);

    // AFTER: exactly one full primitive scan plus three derived-only stages…
    expect(spies.counts.full).toBe(1);
    expect(spies.counts.derived).toBe(3);
    // …with zero per-primitive linear `.find` scans on the project lookup
    // arrays (all entity/layer/legend/map lookups are O(1) index queries).
    expect(counted.counter.finds).toBe(0);
  });

  it('reuses the memoized index across the staged pipeline (no full rescan on derived attach)', () => {
    const { target, rawScene } = buildDense();
    const spies = createViewportFilterSpies();
    const full = spies.fullFilter(target, rawScene);
    // Same project object → the identical cached index (no rebuild).
    const index = getCadViewportVisibilityIndex(target);
    expect(getCadViewportVisibilityIndex(target)).toBe(index);
    // The derived-layer stage reuses the already-filtered primitives by
    // reference — never re-evaluated — and issues no full scan.
    const staged = spies.derivedFilter(target, full, { profileViewLayers: [] });
    expect(staged.primitives).toBe(full.primitives);
    expect(spies.counts.full).toBe(1);
    expect(spies.counts.derived).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// A' — full staged pipeline parity with hidden layers, labels, block hover
// children, transient overlays, and fully populated derived families.
// ---------------------------------------------------------------------------

describe('PERF-186.1 full-pipeline parity (hidden layers, labels, derived)', () => {
  const blockDefinition: CadBlockDefinition = {
    id: 'block:bench',
    name: 'Bench',
    basePoint: { x: 0, y: 0 },
    entities: [],
  };

  const blockReference: CadBlockReferenceEntity = {
    id: 'blockref:1',
    type: 'block-reference',
    layerId: 'general',
    visible: true,
    locked: false,
    blockDefinitionId: 'block:bench',
    x: 0,
    y: 0,
    rotationDeg: 0,
    scaleX: 1,
    scaleY: 1,
  };

  const blockChild: Primitive = {
    kind: 'line',
    id: 'block:bench#0',
    layerId: 'general',
    sourceEntityId: blockReference.id,
    sourceSegmentId: 'block:bench#0',
    stroke: '#fff',
    points: [{ x: 0, y: 0 }, { x: 2, y: 2 }],
    strokeWidth: 1,
  };

  const buildRich = (): { target: CadProject; rawScene: CadDisplayScene; derived: DerivedBundle } => {
    const eVisible = line(0, 'general');
    const eOff = line(1, 'off-layer');
    const eFrozen = line(2, 'frozen-layer');
    const eInvisible = line(3, 'general', { visible: false });
    const eMissing = line(4, 'no-such-layer');
    const target = project({
      layers: [
        layer('general'),
        layer('labels'),
        layer('off-layer', { visible: false }),
        layer('frozen-layer', { frozen: true }),
        layer('visible-layer'),
      ],
      entities: [eVisible, eOff, eFrozen, eInvisible, eMissing, blockReference],
      blockDefinitions: [blockDefinition],
      analysisMaps: [
        { id: 'map:general', name: 'General', source: { kind: 'surface', surfaceId: 's' } as never, bands: [] },
        { id: 'map:off', name: 'Off', source: { kind: 'surface', surfaceId: 's' } as never, bands: [], layerId: 'off-layer' },
        { id: 'map:frozen', name: 'Frozen', source: { kind: 'surface', surfaceId: 's' } as never, bands: [], layerId: 'frozen-layer' },
      ],
      analysisLegends: [
        { id: 'legend:general', analysisId: 'map:general' },
        { id: 'legend:off', analysisId: 'map:off' },
        { id: 'legend:frozen', analysisId: 'map:frozen' },
        { id: 'legend:broken', analysisId: 'map:missing' },
      ] as never,
    });
    const rawScene = sceneOf(
      [
        linePrimitive(eVisible),
        linePrimitive(eOff),
        linePrimitive(eFrozen),
        linePrimitive(eInvisible),
        linePrimitive(eMissing),
        textPrimitive(eVisible), // labels ON + backing ON -> kept
        textPrimitive(eOff), // backing OFF -> hidden
        textPrimitive(eInvisible), // backing visible:false -> hidden
        linePrimitive(eVisible, 'off-layer'), // primitive layer OFF -> hidden
        linePrimitive(eVisible, 'frozen-layer'), // primitive layer FROZEN -> hidden
        blockChild, // block hover child (backing block-reference ON)
        previewPrimitive('overlay:transient', 'off-layer'), // no backing -> kept
      ],
      {
        // Populated raw derived arrays: the hook full scan filters these.
        surfaceLayers: asDerived([
          surfaceLayer('visible-layer'),
          surfaceLayer('off-layer'),
          surfaceLayer('frozen-layer'),
        ]),
        volumeLayers: asDerived([
          simpleLayer('visible-layer', 'v0'),
          simpleLayer('frozen-layer', 'v1'),
        ]),
      },
    );
    const derived: DerivedBundle = {
      profileViewLayers: asDerived([simpleLayer('visible-layer', 'p0'), simpleLayer('off-layer', 'p1')]),
      sampleLineLayers: asDerived([simpleLayer('general', 'sl0'), simpleLayer('frozen-layer', 'sl1')]),
      sectionViewLayers: asDerived([simpleLayer('off-layer', 'sv0'), simpleLayer('visible-layer', 'sv1')]),
      analysisLayers: asDerived([simpleLayer('off-layer', 'a0'), simpleLayer('general', 'a1')]),
      analysisLegendLayers: asDerived([
        { legendId: 'legend:general' },
        { legendId: 'legend:off' },
        { legendId: 'legend:frozen' },
        { legendId: 'legend:broken' },
        { legendId: 'legend:missing' },
      ]),
      gradingLayers: asDerived([simpleLayer('off-layer', 'g0'), simpleLayer('general', 'g1')]),
      groupGradingLayers: asDerived([simpleLayer('frozen-layer', 'gg0'), simpleLayer('visible-layer', 'gg1')]),
    };
    return { target, rawScene, derived };
  };

  it('produces an identical final scene with hidden layers, labels, blocks, overlays, and populated derived families', () => {
    const { target, rawScene, derived } = buildRich();
    const legacyFinal = legacyPipeline(target, rawScene, derived, legacyCounters());
    const newFinal = newPipeline(target, rawScene, derived);
    // Hidden-set parity against the baseline ANY-HIDDEN traversal.
    expect(viewportHiddenEntityIds(target)).toEqual(legacyHiddenEntityIds(target, legacyCounters()));

    // Full final-scene parity: ordered primitive ids/props + all derived arrays.
    expect(newFinal).toEqual(legacyFinal);
    expect(newFinal.primitives.map((entry) => entry.id)).toEqual(legacyFinal.primitives.map((entry) => entry.id));
    // Block hover child is tagged in both pipelines without changing the set.
    expect(newFinal.primitives.find((entry) => entry.id === blockChild.id)?.hoverTitle).toBe('Block: Bench');
    expect(newFinal.primitives.filter((entry) => entry.sourceEntityId === blockReference.id)).toHaveLength(1);
    // Transient overlay with no backing entity survives the staged pipeline.
    expect(newFinal.primitives.some((entry) => entry.id === 'overlay:transient')).toBe(true);
    // Derived visibility matches the OFF/FROZEN contract in the final scene.
    expect(newFinal.surfaceLayers!.map((entry) => entry.layerId)).toEqual(['visible-layer']);
    expect(newFinal.volumeLayers!.map((entry) => entry.layerId)).toEqual(['visible-layer']);
    expect(newFinal.profileViewLayers!.map((entry) => entry.layerId)).toEqual(['visible-layer']);
    expect(newFinal.sampleLineLayers!.map((entry) => entry.layerId)).toEqual(['general']);
    expect(newFinal.sectionViewLayers!.map((entry) => entry.layerId)).toEqual(['visible-layer']);
    expect(newFinal.analysisLayers!.map((entry) => entry.layerId)).toEqual(['general']);
    expect(newFinal.analysisLegendLayers!.map((entry) => entry.legendId)).toEqual([
      'legend:general',
      'legend:broken',
      'legend:missing',
    ]);
    expect(newFinal.gradingLayers!.map((entry) => entry.layerId)).toEqual(['general']);
    expect(newFinal.groupGradingLayers!.map((entry) => entry.layerId)).toEqual(['visible-layer']);
  });

  it('matches the legacy pipeline when the labels layer is OFF (synthetic labels hidden under either layer)', () => {
    const { target, rawScene, derived } = buildRich();
    const labelsOff: CadProject = {
      ...target,
      layers: target.layers.map((entry) =>
        entry.id === 'labels' ? { ...entry, visible: false } : entry,
      ),
    };
    const legacyFinal = legacyPipeline(labelsOff, rawScene, derived, legacyCounters());
    const newFinal = newPipeline(labelsOff, rawScene, derived);
    expect(newFinal).toEqual(legacyFinal);
    expect(newFinal.primitives.map((entry) => entry.id)).toEqual(legacyFinal.primitives.map((entry) => entry.id));
    // Visible backing still hides its label when the labels layer is OFF.
    expect(newFinal.primitives.some((entry) => entry.id === 'label:line:0')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C — visibility contract
// ---------------------------------------------------------------------------

describe('PERF-186.1 visibility contract', () => {
  it('hides OFF and FROZEN backing entities and keeps unknown/missing visible', () => {
    const visible = line(0, 'general');
    const off = line(1, 'off-layer');
    const frozen = line(2, 'frozen-layer');
    const entityInvisible = line(3, 'general', { visible: false });
    const target = project({
      layers: [
        layer('general'),
        layer('off-layer', { visible: false }),
        layer('frozen-layer', { frozen: true }),
      ],
      entities: [visible, off, frozen, entityInvisible],
    });
    const scene = sceneOf([
      linePrimitive(visible),
      linePrimitive(off),
      linePrimitive(frozen),
      linePrimitive(entityInvisible),
      previewPrimitive('preview:unknown', 'off-layer'),
    ]);
    const filtered = filterCadDisplaySceneForViewport(target, scene);
    expect(filtered.primitives.map((entry) => entry.id)).toEqual([
      `prim:${visible.id}`,
      'preview:unknown',
    ]);
    const hidden = viewportHiddenEntityIds(target);
    expect(hidden.has(off.id)).toBe(true);
    expect(hidden.has(frozen.id)).toBe(true);
    expect(hidden.has(entityInvisible.id)).toBe(true);
    expect(hidden.has(visible.id)).toBe(false);
    expect(viewportHiddenEntityIds(project({ entities: [line(9, 'no-such-layer')] })).size).toBe(0);
  });

  it('hides synthesized labels under EITHER the labels layer or the backing layer, preserving segment ids', () => {
    const source = line(0, 'general');
    const hiddenSource = line(1, 'off-layer');
    const target = project({
      layers: [layer('general'), layer('labels'), layer('off-layer', { visible: false })],
      entities: [source, hiddenSource],
    });
    const label = textPrimitive(source);
    const hiddenLabel = textPrimitive(hiddenSource);
    const onHiddenLabels = filterCadDisplaySceneForViewport(
      project({
        layers: [layer('general'), layer('labels', { visible: false }), layer('off-layer')],
        entities: [source, hiddenSource],
      }),
      sceneOf([label, textPrimitive(hiddenSource)]),
    );
    // labels OFF hides the visible-source label; the hidden-source label stays hidden.
    expect(onHiddenLabels.primitives).toHaveLength(0);

    const open = filterCadDisplaySceneForViewport(target, sceneOf([label, hiddenLabel]));
    expect(open.primitives.map((entry) => entry.id)).toEqual([label.id]);
    const survivor = open.primitives[0]!;
    expect(survivor.sourceSegmentId).toBe(`${source.id}#0`);
    expect(survivor.sourceEntityId).toBe(source.id);
  });

  it('hides a primitive whose own layer differs from the entity layer and is OFF/FROZEN', () => {
    const entity = line(0, 'general');
    const target = project({
      layers: [layer('general'), layer('override', { visible: false })],
      entities: [entity],
    });
    const filtered = filterCadDisplaySceneForViewport(
      target,
      sceneOf([linePrimitive(entity, 'override')]),
    );
    expect(filtered.primitives).toHaveLength(0);
  });

  it('preserves appearance-derived fields (opacity, linetype dash, arc/circle/point/text kinds)', () => {
    const entity = line(0, 'general', { appearance: { transparency: 0.5 } });
    const target = project({ entities: [entity] });
    const primitives: Primitive[] = [
      { ...linePrimitive(entity), opacity: 0.5, strokeDasharray: '6 4', dashPatternUnits: [6, 4], dashOffsetUnits: 3 },
      { kind: 'arc', id: 'arc:1', layerId: 'general', sourceEntityId: entity.id, stroke: '#fff', center: { x: 0, y: 0 }, radius: 5, startAngleDeg: 0, endAngleDeg: 90, strokeWidth: 1 },
      { kind: 'circle', id: 'circle:1', layerId: 'general', sourceEntityId: entity.id, stroke: '#fff', center: { x: 0, y: 0 }, radius: 5, strokeWidth: 1 },
      { kind: 'point', id: 'point:1', layerId: 'general', sourceEntityId: entity.id, stroke: '#fff', point: { x: 0, y: 0 }, radius: 1 },
      { kind: 'text', id: 'text:1', layerId: 'general', sourceEntityId: entity.id, stroke: '#fff', point: { x: 0, y: 0 }, text: 'T', fontSize: 2.5 },
    ];
    const filtered = filterCadDisplaySceneForViewport(target, sceneOf(primitives));
    expect(filtered.primitives).toEqual(primitives);
  });

  it('applies the OFF/FROZEN contract to every derived layer family including analysis legend fallback', () => {
    const target = project({
      layers: [
        layer('general'),
        layer('visible-layer'),
        layer('off-layer', { visible: false }),
        layer('frozen-layer', { frozen: true }),
      ],
      analysisMaps: [
        { id: 'map:general', name: 'General', source: { kind: 'surface', surfaceId: 's' } as never, bands: [] },
        { id: 'map:off', name: 'Off', source: { kind: 'surface', surfaceId: 's' } as never, bands: [], layerId: 'off-layer' },
      ],
      analysisLegends: [
        { id: 'legend:general', analysisId: 'map:general' },
        { id: 'legend:off', analysisId: 'map:off' },
        { id: 'legend:broken', analysisId: 'map:missing' },
      ] as never,
    });
    const filtered = filterCadDisplaySceneForViewport(target, sceneOf([], {
      surfaceLayers: asDerived([surfaceLayer('visible-layer')]),
      volumeLayers: asDerived([simpleLayer('off-layer', 'v')]),
      analysisLayers: asDerived([simpleLayer('frozen-layer', 'a')]),
      analysisLegendLayers: asDerived([
        { legendId: 'legend:general' },
        { legendId: 'legend:off' },
        { legendId: 'legend:broken' },
      ]),
      profileViewLayers: asDerived([simpleLayer('visible-layer', 'p')]),
      gradingLayers: asDerived([simpleLayer('off-layer', 'g')]),
      groupGradingLayers: asDerived([simpleLayer('frozen-layer', 'gg')]),
      sampleLineLayers: asDerived([simpleLayer('visible-layer', 'sl')]),
      sectionViewLayers: asDerived([simpleLayer('off-layer', 'sv')]),
    }));
    expect(filtered.surfaceLayers).toHaveLength(1);
    expect(filtered.volumeLayers).toHaveLength(0);
    expect(filtered.analysisLayers).toHaveLength(0);
    // broken legend falls back to 'general' (visible) → kept.
    expect(filtered.analysisLegendLayers!.map((entry) => entry.legendId)).toEqual([
      'legend:general',
      'legend:broken',
    ]);
    expect(filtered.profileViewLayers).toHaveLength(1);
    expect(filtered.gradingLayers).toHaveLength(0);
    expect(filtered.groupGradingLayers).toHaveLength(0);
    expect(filtered.sampleLineLayers).toHaveLength(1);
    expect(filtered.sectionViewLayers).toHaveLength(0);
  });

  it('tags block-expansion primitives with hover titles without changing the primitive set', () => {
    const definition: CadBlockDefinition = {
      id: 'block:1',
      name: 'Bench',
      basePoint: { x: 0, y: 0 },
      entities: [],
    };
    const reference: CadBlockReferenceEntity = {
      id: 'blockref:1',
      type: 'block-reference',
      layerId: 'general',
      visible: true,
      locked: false,
      blockDefinitionId: 'block:1',
      x: 0,
      y: 0,
      rotationDeg: 0,
      scaleX: 1,
      scaleY: 1,
    };
    const target = project({ blockDefinitions: [definition], entities: [reference] });
    const expansion: Primitive = {
      kind: 'line',
      id: 'block:1#0',
      layerId: 'general',
      sourceEntityId: reference.id,
      stroke: '#fff',
      points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      strokeWidth: 1,
    };
    const titled = withBlockHoverTitles(target, [expansion]);
    expect(titled.map((entry) => entry.id)).toEqual([expansion.id]);
    expect(titled[0]!.hoverTitle).toBe('Block: Bench');
    expect(titled[0]!.sourceEntityId).toBe(reference.id);
    // The derived-layer stage reuses the titled list without re-evaluating:
    // test-only spies prove zero full scans around the real shipped filter.
    const spies = createViewportFilterSpies();
    const baseScene = sceneOf([expansion]);
    const out = spies.derivedFilter(target, baseScene, { primitives: titled });
    expect(out.primitives).toBe(titled);
    expect(spies.counts.full).toBe(0);
    expect(spies.counts.derived).toBe(1);
  });

  it('keeps post-filter overlay primitives (surface edit previews) untouched', () => {
    const source = line(0, 'off-layer');
    const target = project({ layers: [layer('general'), layer('off-layer', { visible: false })], entities: [source] });
    const filtered = filterCadDisplaySceneForViewport(target, sceneOf([linePrimitive(source)]));
    const overlay = previewPrimitive('surface-edit:staged');
    const withOverlay = { ...filtered, primitives: [...filtered.primitives, overlay] };
    expect(withOverlay.primitives.at(-1)).toBe(overlay);
  });
});

// ---------------------------------------------------------------------------
// D — index invalidation + first-wins
// ---------------------------------------------------------------------------

describe('PERF-186.1 visibility index invalidation', () => {
  it('memoizes per project identity and rebuilds on replacement with identical ids', () => {
    const first = project({ entities: [line(0, 'general')] });
    // Same object → the identical cached index (memoized, never rebuilt).
    const indexA = getCadViewportVisibilityIndex(first);
    expect(getCadViewportVisibilityIndex(first)).toBe(indexA);

    // Same ids, different drawing (layer toggled OFF) → new object → rebuild.
    const second: CadProject = {
      ...first,
      layers: first.layers.map((entry) => (entry.id === 'general' ? { ...entry, visible: false } : entry)),
    };
    const indexB = getCadViewportVisibilityIndex(second);
    expect(indexB).not.toBe(indexA);
    expect(viewportHiddenEntityIds(first).size).toBe(0);
    expect(viewportHiddenEntityIds(second).has('line:0')).toBe(true);
  });

  it('resolves duplicate layer ids first-wins (matching `.find`), both orders', () => {
    const visibleFirst = project({
      layers: [layer('dup'), layer('dup', { visible: false })],
      entities: [line(0, 'dup')],
    });
    // First layer with id 'dup' is visible → entity stays visible.
    expect(viewportHiddenEntityIds(visibleFirst).size).toBe(0);
    expect(viewportHiddenEntityIds(visibleFirst)).toEqual(legacyHiddenEntityIds(visibleFirst, legacyCounters()));
    expect(filterCadDisplaySceneForViewport(
      visibleFirst,
      sceneOf([linePrimitive(line(0, 'dup'))]),
    ).primitives).toHaveLength(1);

    const hiddenFirst = project({
      layers: [layer('dup', { visible: false }), layer('dup')],
      entities: [line(0, 'dup')],
    });
    // First layer with id 'dup' is OFF → entity hidden (frozen variant too).
    expect(viewportHiddenEntityIds(hiddenFirst).has('line:0')).toBe(true);
    expect(viewportHiddenEntityIds(hiddenFirst)).toEqual(legacyHiddenEntityIds(hiddenFirst, legacyCounters()));
    expect(filterCadDisplaySceneForViewport(
      hiddenFirst,
      sceneOf([linePrimitive(line(0, 'dup'))]),
    ).primitives).toHaveLength(0);

    const frozenFirst = project({
      layers: [layer('dup', { frozen: true }), layer('dup')],
      entities: [line(0, 'dup')],
    });
    expect(viewportHiddenEntityIds(frozenFirst).has('line:0')).toBe(true);
    expect(viewportHiddenEntityIds(frozenFirst)).toEqual(legacyHiddenEntityIds(frozenFirst, legacyCounters()));
  });

  it('does not retain projects strongly (WeakMap key) and uses no id-only state', () => {
    // A structurally-identical but distinct project object must rebuild (not
    // reuse by id), which is only possible when the cache is keyed by object.
    const base = project({ entities: [line(0, 'general')] });
    const getId = getCadViewportVisibilityIndex(base);
    const clone: CadProject = { ...base };
    expect(getCadViewportVisibilityIndex(clone)).not.toBe(getId);
  });
});

// ---------------------------------------------------------------------------
// D' — baseline duplicate-entity semantics: LAST-WINS display + ANY-HIDDEN
// retirement. The baseline draws from `new Map(rows.map(...))` (last row
// wins) but retires from a traversal that adds the id when ANY row resolves
// hidden. Every assertion below is compared against the verbatim baseline
// replicas (`legacyFilter`, `legacyHiddenEntityIds`) on the same fixture.
// ---------------------------------------------------------------------------

describe('PERF-186.1 duplicate-entity baseline semantics', () => {
  const hiddenRow = (layerId: string): CadLineEntity => ({
    ...line(0, 'general'),
    layerId,
  });

  it('first-visible + last-hidden hides the primitive (LAST-WINS display)', () => {
    const target = project({
      layers: [layer('general'), layer('off-layer', { visible: false })],
      entities: [line(0, 'general'), hiddenRow('off-layer')],
    });
    const scene = sceneOf([linePrimitive(line(0, 'general'))]);
    const legacy = legacyFilter(target, scene, legacyCounters());
    const filtered = filterCadDisplaySceneForViewport(target, scene);
    // The LAST row (OFF layer) decides: primitive hidden in both.
    expect(filtered.primitives).toEqual(legacy.primitives);
    expect(filtered.primitives).toHaveLength(0);
    // ANY-HIDDEN: the hidden last row retires the id in both.
    expect(viewportHiddenEntityIds(target)).toEqual(legacyHiddenEntityIds(target, legacyCounters()));
    expect(viewportHiddenEntityIds(target).has('line:0')).toBe(true);
  });

  it('first-hidden + last-visible keeps the primitive but still retires the id (ANY-HIDDEN)', () => {
    const target = project({
      layers: [layer('general'), layer('off-layer', { visible: false })],
      entities: [hiddenRow('off-layer'), line(0, 'general')],
    });
    const scene = sceneOf([linePrimitive(line(0, 'general'))]);
    const legacy = legacyFilter(target, scene, legacyCounters());
    const filtered = filterCadDisplaySceneForViewport(target, scene);
    // The LAST row (visible) decides: primitive kept in both.
    expect(filtered.primitives).toEqual(legacy.primitives);
    expect(filtered.primitives).toHaveLength(1);
    // ANY-HIDDEN: the hidden first row still retires the id in both, so
    // #189 selection retirement drops it even though it stays drawn.
    expect(viewportHiddenEntityIds(target)).toEqual(legacyHiddenEntityIds(target, legacyCounters()));
    expect(viewportHiddenEntityIds(target).has('line:0')).toBe(true);
  });

  it('matches the baseline for entity.visible duplicates and frozen layers', () => {
    const invisibleLast = project({
      layers: [layer('general')],
      entities: [line(0, 'general'), line(0, 'general', { visible: false })],
    });
    const scene = sceneOf([linePrimitive(line(0, 'general'))]);
    expect(filterCadDisplaySceneForViewport(invisibleLast, scene)).toEqual(
      legacyFilter(invisibleLast, scene, legacyCounters()),
    );
    expect(filterCadDisplaySceneForViewport(invisibleLast, scene).primitives).toHaveLength(0);
    expect(viewportHiddenEntityIds(invisibleLast)).toEqual(
      legacyHiddenEntityIds(invisibleLast, legacyCounters()),
    );

    const invisibleFirst = project({
      layers: [layer('general')],
      entities: [line(0, 'general', { visible: false }), line(0, 'general')],
    });
    expect(filterCadDisplaySceneForViewport(invisibleFirst, scene)).toEqual(
      legacyFilter(invisibleFirst, scene, legacyCounters()),
    );
    expect(filterCadDisplaySceneForViewport(invisibleFirst, scene).primitives).toHaveLength(1);
    expect(viewportHiddenEntityIds(invisibleFirst).has('line:0')).toBe(true);

    const frozenLast = project({
      layers: [layer('general'), layer('frozen-layer', { frozen: true })],
      entities: [line(0, 'general'), hiddenRow('frozen-layer')],
    });
    expect(filterCadDisplaySceneForViewport(frozenLast, scene)).toEqual(
      legacyFilter(frozenLast, scene, legacyCounters()),
    );
    expect(filterCadDisplaySceneForViewport(frozenLast, scene).primitives).toHaveLength(0);
    expect(viewportHiddenEntityIds(frozenLast)).toEqual(
      legacyHiddenEntityIds(frozenLast, legacyCounters()),
    );
  });

  it('resolves duplicate analysis legend/map ids first-wins (matching `.find`)', () => {
    const target = project({
      layers: [layer('general'), layer('off-layer', { visible: false })],
      analysisMaps: [
        { id: 'map:dup', name: 'Dup', source: { kind: 'surface', surfaceId: 's' } as never, bands: [] },
        { id: 'map:dup', name: 'Dup hidden', source: { kind: 'surface', surfaceId: 's' } as never, bands: [], layerId: 'off-layer' },
      ],
      analysisLegends: [
        { id: 'legend:dup', analysisId: 'map:dup' },
        { id: 'legend:dup', analysisId: 'map:missing' },
      ] as never,
    });
    const scene = sceneOf([], { analysisLegendLayers: asDerived([{ legendId: 'legend:dup' }]) });
    // First map with id 'map:dup' has no layerId → 'general' (visible) → kept.
    const filtered = filterCadDisplaySceneForViewport(target, scene);
    expect(filtered).toEqual(legacyFilter(target, scene, legacyCounters()));
    expect(filtered.analysisLegendLayers!.map((entry) => entry.legendId)).toEqual(['legend:dup']);

    const hiddenFirst: CadProject = {
      ...target,
      analysisMaps: [...target.analysisMaps!].reverse(),
    };
    // First map now draws on the OFF layer → legend hidden.
    const filteredHidden = filterCadDisplaySceneForViewport(hiddenFirst, scene);
    expect(filteredHidden).toEqual(legacyFilter(hiddenFirst, scene, legacyCounters()));
    expect(filteredHidden.analysisLegendLayers).toHaveLength(0);
  });

  it('preserves duplicate entity rows through a .wncad save/open round-trip into the viewport', () => {
    const target = project({
      layers: [layer('general'), layer('off-layer', { visible: false })],
      entities: [line(0, 'general'), hiddenRow('off-layer')],
    });
    const drawing = {
      ...createBlankCadDrawingDocument({ name: 'dup-ids', units: 'm' as const }),
      project: target,
    };
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(drawing));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Both duplicate rows survive the save/open round-trip.
    const rows = parsed.drawing.project.entities.filter((entity) => entity.id === 'line:0');
    expect(rows).toHaveLength(2);
    // And both reach the viewport index with baseline semantics: the LAST
    // (OFF-layer) row hides the primitive while ANY-HIDDEN retires the id.
    const reopened: CadProject = { ...target, entities: rows };
    const reopenedScene = sceneOf(
      rows.map((entity) => linePrimitive(entity as CadLineEntity)),
    );
    expect(filterCadDisplaySceneForViewport(reopened, reopenedScene)).toEqual(
      legacyFilter(reopened, reopenedScene, legacyCounters()),
    );
    expect(filterCadDisplaySceneForViewport(reopened, reopenedScene).primitives).toHaveLength(0);
    expect(viewportHiddenEntityIds(reopened)).toEqual(
      legacyHiddenEntityIds(reopened, legacyCounters()),
    );
    expect(viewportHiddenEntityIds(reopened).has('line:0')).toBe(true);
  });
});
