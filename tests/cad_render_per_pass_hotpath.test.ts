// PERF-CAD-RENDER.1 — per-pass render/lookup hot-path semantics.
//
// Pins the observable contract of two isolated per-pass loops:
//  - `buildCadDisplayScene`: one strict-order pass over visible entities
//    (replacing `entities.filter(visible).flatMap(toPrimitives)`);
//  - `buildCadProjectLookup.byId`: one-pass `Map.set` (replacing
//    `new Map(entries.map((entry) => [entry.id, entry]))`).
//
// BEFORE/AFTER oracle: `legacyFlatten` reconstructs the legacy
// `filter().flatMap()` pipeline using only the public renderer (render each
// entity in a single-entity project, concatenate in entity order) and is
// deep-equal / JSON-equal to the real multi-entity scene. Negative controls
// reverse the entity walk / use first-wins Map semantics to prove the pins
// are non-vacuous.
import { describe, expect, it } from 'vitest';
import { buildCadProjectLookup } from '../src/engine/cad/cadProjectLookup';
import { buildCadDisplayScene } from '../src/engine/cad/cadRenderer';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { filterCadDisplaySceneForViewport } from '../src/engine/cad/cadViewportAppearance';
import type { CadDisplayPrimitive } from '../src/engine/cad/cadDisplayTypes';
import type {
  CadArcEntity,
  CadBlockDefinition,
  CadBlockReferenceEntity,
  CadCircleEntity,
  CadDimensionEntity,
  CadDisplayPoint,
  CadEntity,
  CadLeaderEntity,
  CadLineEntity,
  CadMTextEntity,
  CadParcelEntity,
  CadPolylineEntity,
  CadProject,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';

const PROJECT = createBlankCadDrawingDocument({ name: 'perf-cad-render', units: 'm' }).project;

const projectWith = (entities: CadEntity[], overrides: Partial<CadProject> = {}): CadProject => ({
  ...PROJECT,
  ...overrides,
  entities,
});

const line = (
  id: string,
  from: CadDisplayPoint,
  to: CadDisplayPoint,
): CadLineEntity => ({
  id,
  type: 'line',
  layerId: 'general',
  visible: true,
  locked: false,
  fromStationId: `${id}-A`,
  toStationId: `${id}-B`,
  fromX: from.x,
  fromY: from.y,
  toX: to.x,
  toY: to.y,
  sourceObservationIds: [],
});

const arc = (id: string): CadArcEntity => ({
  id,
  type: 'arc',
  layerId: 'general',
  visible: true,
  locked: false,
  centerX: 0,
  centerY: 0,
  radius: 20,
  startAngleDeg: 0,
  endAngleDeg: 90,
});

const circle = (id: string): CadCircleEntity => ({
  id,
  type: 'circle',
  layerId: 'general',
  visible: true,
  locked: false,
  centerX: 5,
  centerY: 5,
  radius: 3,
});

const polyline = (
  id: string,
  vertices: CadDisplayPoint[],
  metadata?: Pick<CadPolylineEntity, 'segmentGeometry' | 'segmentWidths'>,
): CadPolylineEntity => ({
  id,
  type: 'polyline',
  layerId: 'general',
  visible: true,
  locked: false,
  vertices,
  vertexLabels: vertices.map((_, index) => String.fromCharCode(65 + index)),
  closed: false,
  ...(metadata ?? {}),
});

const parcel = (id: string, vertices: CadDisplayPoint[]): CadParcelEntity => ({
  id,
  type: 'parcel',
  layerId: 'general',
  visible: true,
  locked: false,
  vertices,
  vertexLabels: vertices.map((_, index) => String.fromCharCode(65 + index)),
  parcelName: id,
  areaSquareMeters: 1000,
  perimeterMeters: 130,
});

const surveyPoint = (
  id: string,
  x: number,
  y: number,
  extra: Partial<Pick<CadSurveyPointEntity, 'pointStyleId' | 'pointClass' | 'styleId'>> = {},
): CadSurveyPointEntity => ({
  id,
  type: 'survey-point',
  layerId: 'points',
  visible: true,
  locked: false,
  stationId: id,
  x,
  y,
  pointClass: 'free',
  source: 'parsed-input',
  ...extra,
});

const mtext = (id: string, text: string): CadMTextEntity => ({
  id,
  type: 'mtext',
  layerId: 'labels',
  visible: true,
  locked: false,
  x: 10,
  y: 20,
  text,
  textStyleId: 'label-default',
  rotationDeg: 0,
  attachment: 'middle-center',
});

const leader = (id: string): CadLeaderEntity => ({
  id,
  type: 'leader',
  layerId: 'general',
  visible: true,
  locked: false,
  arrowAnchor: { kind: 'fixed', x: 0, y: 0 },
  vertices: [{ x: 10, y: 10 }],
  text: 'NOTE',
  leaderStyleId: 'leader-test',
});

const dimension = (id: string): CadDimensionEntity => ({
  id,
  type: 'dimension',
  layerId: 'general',
  visible: true,
  locked: false,
  dimensionKind: 'linear',
  anchors: [],
  defPoint1: { kind: 'fixed', x: 0, y: 0 },
  defPoint2: { kind: 'fixed', x: 100, y: 0 },
  orientation: 'horizontal',
  dimLinePoint: { x: 50, y: 10 },
  dimensionStyleId: 'dim-test',
});

const blockRef = (id: string): CadBlockReferenceEntity => ({
  id,
  type: 'block-reference',
  layerId: 'general',
  visible: true,
  locked: false,
  blockDefinitionId: 'blk-test',
  x: 0,
  y: 0,
  rotationDeg: 0,
  scaleX: 1,
  scaleY: 1,
});

const TEST_BLOCK: CadBlockDefinition = {
  id: 'blk-test',
  name: 'Test',
  basePoint: { x: 0, y: 0 },
  entities: [
    { ...line('child-line', { x: 0, y: 0 }, { x: 2, y: 0 }) },
    { ...circle('child-circle') },
  ],
};

const ANNOTATION_OVERRIDES: Partial<CadProject> = {
  blockDefinitions: [...(PROJECT.blockDefinitions ?? []), TEST_BLOCK],
  dimensionStyles: [
    {
      id: 'dim-test',
      name: 'Dim Test',
      textStyleId: 'label-default',
      arrowBlockDefinitionId: 'arrow-missing',
      arrowSize: 2.5,
      arrowSizeMode: 'model',
      textGap: 1,
      extensionOffset: 1,
      extensionOvershoot: 1,
      decimalPrecision: 2,
    },
  ],
  leaderStyles: [
    {
      id: 'leader-test',
      name: 'Leader Test',
      textStyleId: 'label-default',
      arrowBlockDefinitionId: 'arrow-missing',
      arrowSize: 2.5,
      arrowSizeMode: 'model',
      landingLength: 5,
      textGap: 1,
    },
  ],
};

/** Self-contained mixed fixture: no entity references another top-level entity. */
const mixedProject = (): CadProject =>
  projectWith(
    [
      line('L1', { x: 0, y: 0 }, { x: 20, y: 0 }),
      arc('A1'),
      circle('C1'),
      polyline('P1', [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }]),
      parcel('PA1', [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]),
      surveyPoint('SP1', 1, 1),
      mtext('M1', 'FIRST\nSECOND'),
      blockRef('BR1'),
      leader('LD1'),
      dimension('D1'),
    ],
    ANNOTATION_OVERRIDES,
  );

/** Legacy `entities.filter(visible).flatMap(toPrimitives)` reconstructed per entity. */
const legacyFlatten = (project: CadProject): CadDisplayPrimitive[] =>
  project.entities
    .filter((entity) => entity.visible)
    .flatMap((entity) => buildCadDisplayScene({ ...project, entities: [entity] }).primitives);

const ids = (primitives: readonly CadDisplayPrimitive[]): string[] =>
  primitives.map((primitive) => primitive.id);

const owners = (primitives: readonly CadDisplayPrimitive[]): (string | undefined)[] =>
  primitives.map((primitive) => primitive.sourceEntityId);

describe('buildCadDisplayScene per-pass flatten', () => {
  it('legacy filter+flatMap oracle is deep-equal and JSON-equal on a mixed fixture', () => {
    const project = mixedProject();
    const scene = buildCadDisplayScene(project);
    const oracle = legacyFlatten(project);
    expect(scene.primitives).toEqual(oracle);
    expect(JSON.stringify(scene.primitives)).toBe(JSON.stringify(oracle));
    // The fixture must actually exercise multi-primitive entities.
    expect(scene.primitives.length).toBeGreaterThan(project.entities.length);
  });

  it('preserves entity order x per-entity order (flat, strict)', () => {
    const project = mixedProject();
    const scene = buildCadDisplayScene(project);
    const expectedOwners = project.entities.flatMap((entity) =>
      buildCadDisplayScene({ ...project, entities: [entity] }).primitives.map(() => entity.id),
    );
    expect(owners(scene.primitives)).toEqual(expectedOwners);
    // Within each entity, ids keep their per-entity construction order.
    expect(ids(scene.primitives)).toEqual(ids(legacyFlatten(project)));
  });

  it('keeps the legacy truthy visibility check (not strict boolean)', () => {
    const truthy = { ...line('t', { x: 0, y: 0 }, { x: 1, y: 1 }), visible: 1 as unknown as boolean };
    const falsy = { ...line('f', { x: 0, y: 0 }, { x: 1, y: 1 }), visible: 0 as unknown as boolean };
    const scene = buildCadDisplayScene(projectWith([truthy, falsy]));
    expect(scene.primitives.some((primitive) => primitive.sourceEntityId === 't')).toBe(true);
    expect(scene.primitives.some((primitive) => primitive.sourceEntityId === 'f')).toBe(false);
  });

  it('returns empty primitives for empty inputs and detached fresh arrays per call', () => {
    const empty = buildCadDisplayScene(projectWith([]));
    expect(empty.primitives).toEqual([]);
    expect(empty.bounds).toBe(PROJECT.bounds);

    const project = mixedProject();
    const first = buildCadDisplayScene(project);
    const second = buildCadDisplayScene(project);
    expect(first.primitives).not.toBe(second.primitives);
    expect(first.primitives.length).toBeGreaterThan(0);
    first.primitives.length = 0; // mutating one result must not leak into the next
    expect(second.primitives.length).toBeGreaterThan(0);
    expect(buildCadDisplayScene(project).primitives.length).toBe(second.primitives.length);
  });

  it('propagates a per-entity throw all-or-nothing (no partial scene, no cache)', () => {
    const good = line('ok', { x: 0, y: 0 }, { x: 1, y: 0 });
    const boom = { ...line('boom', { x: 0, y: 0 }, { x: 1, y: 0 }) };
    Object.defineProperty(boom, 'visible', {
      get() {
        throw new Error('boom-visible');
      },
    });
    expect(() => buildCadDisplayScene(projectWith([good, boom]))).toThrow('boom-visible');
    // No retained state: the next call renders the fixed entity in full.
    const fixed = buildCadDisplayScene(projectWith([good, line('boom', { x: 0, y: 0 }, { x: 1, y: 0 })]));
    expect(owners(fixed.primitives)).toEqual(['ok', 'boom']);
  });

  it('threads options.lookup with a per-call default (parity)', () => {
    const project = mixedProject();
    const lookup = buildCadProjectLookup(project);
    expect(buildCadDisplayScene(project, { lookup })).toEqual(buildCadDisplayScene(project));
  });

  it('surfaces derived surface/volume layers as empty arrays, never absent', () => {
    const scene = buildCadDisplayScene(projectWith([]));
    expect(Object.prototype.hasOwnProperty.call(scene, 'surfaceLayers')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(scene, 'volumeLayers')).toBe(true);
    expect(scene.surfaceLayers).toEqual([]);
    expect(scene.volumeLayers).toEqual([]);
  });

  it('keeps layer-hidden entities in the export scene; drops visible=false', () => {
    const visible = line('keep', { x: 0, y: 0 }, { x: 1, y: 0 });
    const dropped = { ...line('gone', { x: 0, y: 1 }, { x: 1, y: 1 }), visible: false };
    const project = projectWith([visible, dropped]);
    const scene = buildCadDisplayScene(project);
    expect(owners(scene.primitives)).toEqual(['keep']);

    const layerHidden: CadProject = {
      ...project,
      layers: project.layers.map((layer) =>
        layer.id === 'general' ? { ...layer, visible: false } : layer,
      ),
    };
    // Trap #1: the scene builder never pre-filters layers.
    expect(owners(buildCadDisplayScene(layerHidden).primitives)).toEqual(['keep']);
    // The viewport consumer filter is separate and still hides the layer.
    expect(
      owners(filterCadDisplaySceneForViewport(layerHidden, buildCadDisplayScene(layerHidden)).primitives),
    ).toEqual([]);
    expect(owners(filterCadDisplaySceneForViewport(project, scene).primitives)).toEqual(['keep']);
  });

  it('negative control: a reversed entity walk changes the flat order', () => {
    const project = mixedProject();
    const forward = ids(buildCadDisplayScene(project).primitives);
    const reversedOwners = [...project.entities]
      .reverse()
      .flatMap((entity) =>
        buildCadDisplayScene({ ...project, entities: [entity] }).primitives.map(
          () => entity.id,
        ),
      );
    expect(forward.length).toBeGreaterThan(0);
    expect(owners(buildCadDisplayScene(project).primitives)).not.toEqual(reversedOwners);
  });
});

describe('entity-shape coverage through the per-pass flatten', () => {
  const only = (entity: CadEntity, overrides: Partial<CadProject> = {}): CadDisplayPrimitive[] =>
    buildCadDisplayScene(projectWith([entity], overrides)).primitives;

  it('expands nested block children with stable prefixed ids', () => {
    const primitives = only(blockRef('BR'), ANNOTATION_OVERRIDES);
    expect(primitives.length).toBeGreaterThan(0);
    for (const primitive of primitives) {
      expect(primitive.id.startsWith('primitive:BR:block:')).toBe(true);
      expect(primitive.sourceEntityId).toBe('BR');
      expect(primitive.layerId).toBe('general');
    }
    // Nested marker path: block-backed survey point uses the `:marker` prefix.
    const markerPrimitives = only(
      surveyPoint('SP', 2, 2, { pointStyleId: 'point-style-monument' }),
      {
        ...ANNOTATION_OVERRIDES,
        pointStyles: (PROJECT.pointStyles ?? []).map((style) =>
          style.id === 'point-style-monument'
            ? { ...style, markerBlockDefinitionId: 'blk-test' }
            : style,
        ),
      },
    );
    expect(markerPrimitives.some((primitive) => primitive.id.startsWith('primitive:SP:marker:block:'))).toBe(
      true,
    );
  });

  it('emits native arc for a valid bulge, nothing for invalid metadata, chords for legacy', () => {
    const bulged = only(
      polyline('PB', [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], {
        segmentGeometry: [{ kind: 'arc', bulge: 0.5 }, { kind: 'line' }],
      }),
    );
    expect(bulged.some((primitive) => primitive.kind === 'arc')).toBe(true);

    const invalid = only(
      polyline('PI', [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], {
        segmentGeometry: [{ kind: 'arc', bulge: 0.5 }],
      }),
    );
    expect(invalid).toEqual([]);

    const legacy = only(polyline('PL', [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]));
    expect(legacy.length).toBe(2);
    expect(legacy.every((primitive) => primitive.kind === 'line')).toBe(true);
  });

  it('drops the marker for the No Display point style, keeps the entity selectable elsewhere', () => {
    expect(only(surveyPoint('SPN', 1, 1, { pointStyleId: 'point-style-no-display' }))).toEqual([]);
    const standard = only(surveyPoint('SPS', 1, 1));
    expect(standard).toHaveLength(1);
    expect(standard[0]?.kind).toBe('point');
  });

  it('renders text/labels, line/arc/parcel, and derived annotation primitives', () => {
    expect(only(mtext('M', 'A\nB'))).toHaveLength(2);
    expect(only(line('L', { x: 0, y: 0 }, { x: 1, y: 1 }))[0]?.kind).toBe('line');
    const arcPrimitives = only(arc('A'));
    expect(arcPrimitives.map((primitive) => primitive.kind)).toEqual(['arc', 'text']);
    const parcelPrimitives = only(parcel('PA', [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]));
    expect(parcelPrimitives.some((primitive) => primitive.kind === 'text')).toBe(true);
    const leaderPrimitives = only(leader('LD'), ANNOTATION_OVERRIDES);
    expect(leaderPrimitives.some((primitive) => primitive.id === 'primitive:LD:1')).toBe(true);
    expect(leaderPrimitives.some((primitive) => primitive.kind === 'text')).toBe(true);
    const dimPrimitives = only(dimension('D'), ANNOTATION_OVERRIDES);
    expect(dimPrimitives.some((primitive) => primitive.id.startsWith('primitive:D:ext:'))).toBe(true);
    expect(dimPrimitives.some((primitive) => primitive.kind === 'text')).toBe(true);
  });

  it('resolves styles, transparency, and linetype through the same pass', () => {
    const styled = {
      ...line('LS', { x: 0, y: 0 }, { x: 1, y: 0 }),
      styleId: 'style-observation-line',
      appearance: { transparency: 0.5 },
    };
    const styledPrimitive = only(styled)[0]!;
    expect(styledPrimitive.stroke).toBe('#22c55e');
    expect(styledPrimitive.opacity).toBe(0.5);

    const dashed = projectWith([line('LD2', { x: 0, y: 0 }, { x: 1, y: 0 })], {
      linetypeScale: 2,
      layers: PROJECT.layers.map((layer) =>
        layer.id === 'general' ? { ...layer, lineTypeId: 'dashed' } : layer,
      ),
    });
    const dashedPrimitive = buildCadDisplayScene(dashed).primitives[0]!;
    expect(dashedPrimitive.dashPatternUnits).toEqual([12, 8]);
  });
});

describe('buildCadProjectLookup byId duplicate semantics', () => {
  const withId = (id: string, tag: string): CadLineEntity => ({
    ...line(id, { x: 0, y: 0 }, { x: 1, y: 0 }),
    fromStationId: tag,
  });

  it('keeps duplicate-id last-wins and first-insertion order', () => {
    const first = withId('dup', 'first');
    const second = withId('dup', 'second');
    const other = withId('other', 'other');
    const lookup = buildCadProjectLookup(projectWith([first, other, second]));
    expect(lookup.entityById.get('dup')).toBe(second);
    expect(lookup.entityById.get('other')).toBe(other);
    // Map.set retains the FIRST insertion position while overwriting the value.
    expect([...lookup.entityById.keys()]).toEqual(['dup', 'other']);
    expect([...lookup.entityById.values()].map((entity) => entity.id)).toEqual(['dup', 'other']);
    expect(lookup.entityById.get('dup')).toEqual(second);
  });

  it('negative control: first-wins would return the first duplicate (non-vacuous)', () => {
    const first = withId('dup', 'first');
    const second = withId('dup', 'second');
    const lookup = buildCadProjectLookup(projectWith([first, second]));
    const firstWins = new Map<string, CadLineEntity>();
    for (const entry of [first, second]) if (!firstWins.has(entry.id)) firstWins.set(entry.id, entry);
    expect(lookup.entityById.get('dup')).not.toBe(first);
    expect(firstWins.get('dup')).toBe(first);
    expect(lookup.entityById.get('dup')).toBe(second);
  });

  it('treats undefined entry tables as empty maps and keeps matching pass', () => {
    const lookup = buildCadProjectLookup({
      ...PROJECT,
      pointStyles: undefined,
      labelStyles: undefined,
      blockDefinitions: undefined,
    });
    expect(lookup.pointStyleById.size).toBe(0);
    expect(lookup.pointLabelStyleById.size).toBe(0);
    expect(lookup.blockDefinitionById.size).toBe(0);
    expect(buildCadDisplayScene(projectWith([]), { lookup }).primitives).toEqual([]);
  });
});
