// Phase 18D: renderer + export wiring for effective survey styles.
import { describe, expect, it } from 'vitest';
import { buildCadDisplayScene } from '../src/engine/cad/cadRenderer';
import { buildExportSheetSceneWithResult } from '../src/engine/cad/cadExportScene';
import { buildDxfExportModelWithResult } from '../src/engine/cad/dxf/dxfExportModel';
import { buildLandXmlProjectExportWithResult } from '../src/engine/landxmlCad';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { createDefaultCadPointStyles } from '../src/engine/cad/cadPointStyles';
import { normalizePointSymbolShape } from '../src/engine/cad/cadPointSymbolShape';
import type {
  CadDisplayPointPrimitive,
  CadDisplayTextPrimitive,
} from '../src/engine/cad/cadDisplayTypes';
import type {
  CadEntity,
  CadProject,
  CadSurveyPointEntity,
  CadTextEntity,
} from '../src/engine/cad/cadTypes';
import { buildSmallParcelFixture } from './fixtures/draftSmallParcel';

const blankProject = (): CadProject => createBlankCadDrawingDocument({ name: 'Blank', units: 'm' }).project;

const point = (overrides: Partial<CadSurveyPointEntity> & { id: string }): CadSurveyPointEntity => ({
  type: 'survey-point',
  layerId: 'points',
  visible: true,
  locked: false,
  stationId: overrides.id,
  x: 10,
  y: 20,
  pointClass: 'free',
  source: 'parsed-input',
  ...overrides,
});

const label = (overrides: Partial<CadTextEntity> & { id: string }): CadTextEntity => ({
  type: 'text',
  layerId: 'labels',
  visible: true,
  locked: false,
  x: 10,
  y: 20,
  text: 'baked',
  ...overrides,
});

const pointPrimitives = (project: CadProject): CadDisplayPointPrimitive[] =>
  buildCadDisplayScene(project).primitives.filter(
    (primitive): primitive is CadDisplayPointPrimitive => primitive.kind === 'point',
  );

const textPrimitives = (project: CadProject): CadDisplayTextPrimitive[] =>
  buildCadDisplayScene(project).primitives.filter(
    (primitive): primitive is CadDisplayTextPrimitive => primitive.kind === 'text',
  );

describe('phase 18D renderer + export effective survey styles', () => {
  it('resolves manual > group > base; No Display emits no primitive', () => {
    const project = blankProject();
    project.entities = [
      // Manual No Display beats a matching group override.
      point({ id: 'pt-manual', description: 'TREE', pointStyleId: 'point-style-monument', pointStyleOverrideId: 'point-style-no-display' }),
      // Group override beats the base style.
      point({ id: 'pt-grouped', description: 'TREE', pointStyleId: 'point-style-survey' }),
      // No overrides anywhere: drawing default (Standard → point-free circle).
      point({ id: 'pt-default' }),
    ];
    project.pointGroups = [
      ...(project.pointGroups ?? []),
      {
        id: 'point-group-trees',
        name: 'Trees',
        query: { descriptionPattern: 'TREE' },
        pointStyleOverrideId: 'point-style-tree',
        priority: -1,
      },
    ];
    const primitives = pointPrimitives(project);
    const bySource = new Map(primitives.map((primitive) => [primitive.sourceEntityId, primitive]));
    // Manual No Display wins over the group: no marker, but the entity persists.
    expect(bySource.has('pt-manual')).toBe(false);
    expect(project.entities.some((entity) => entity.id === 'pt-manual')).toBe(true);
    // Group override (Tree → cross) beats the Survey base style.
    expect(bySource.get('pt-grouped')?.shape).toBe('cross');
    // Drawing default carries no shape (legacy circle, shape key absent).
    expect(bySource.get('pt-default')?.shape).toBeUndefined();
    expect(bySource.get('pt-default')?.radius).toBe(1.8);
  });

  it('passes all six shapes through the point primitive with scaled radii', () => {
    const project = blankProject();
    project.pointStyles = [
      ...createDefaultCadPointStyles(),
      { id: 'point-style-circle', name: 'Circle', markerSymbolId: 'point-f2f-circle', displayMarker: true },
      { id: 'point-style-scaled', name: 'Scaled', markerSymbolId: 'point-free', markerScale: 2, displayMarker: true },
    ];
    const styleForShape: Record<string, string> = {
      circle: 'point-style-circle',
      square: 'point-style-monument',
      triangle: 'point-style-boundary',
      cross: 'point-style-tree',
      x: 'point-style-utility',
      dot: 'point-style-topo',
    };
    project.entities = [
      ...Object.entries(styleForShape).map(([shape, pointStyleId]) =>
        point({ id: `pt-${shape}`, pointStyleId }),
      ),
      point({ id: 'pt-scaled', pointStyleId: 'point-style-scaled' }),
    ];
    const bySource = new Map(pointPrimitives(project).map((primitive) => [primitive.sourceEntityId, primitive]));
    for (const [shape, pointStyleId] of Object.entries(styleForShape)) {
      const primitive = bySource.get(`pt-${shape}`);
      expect(primitive?.shape).toBe(shape);
      void pointStyleId;
    }
    // Radius = symbol radius × markerScale in drawing units (pinned semantics).
    expect(bySource.get('pt-scaled')?.radius).toBe(3.6);
    expect(bySource.get('pt-dot')?.radius).toBe(1.2);
    // Unknown shapes normalize to circle (preview/export never crash).
    expect(normalizePointSymbolShape('hexagon')).toBe('circle');
    expect(normalizePointSymbolShape(undefined)).toBe('circle');
  });

  it('materializes bound labels in the scene; No Label hides; orphans fall back to baked', () => {
    const project = blankProject();
    project.entities = [
      point({ id: 'pt-P1', stationId: 'P1', description: 'TREE', z: 5, x: 10, y: 20 }),
      label({
        id: 'label-derived',
        pointLabel: {
          pointEntityId: 'pt-P1',
          labelStyleId: 'point-label-point-number-description',
          content: { mode: 'derived' },
        },
      }),
      label({
        id: 'label-hidden',
        pointLabel: {
          pointEntityId: 'pt-P1',
          labelStyleId: 'point-label-none',
          content: { mode: 'derived' },
        },
      }),
      // Orphan point + unknown style: deterministic baked fallback, never crash.
      label({
        id: 'label-orphan',
        x: 1,
        y: 2,
        text: 'orphan-baked',
        pointLabel: { pointEntityId: 'pt-gone', labelStyleId: 'point-label-point-number', content: { mode: 'derived' } },
      }),
      label({
        id: 'label-unknown-style',
        x: 3,
        y: 4,
        text: 'style-baked',
        pointLabel: { pointEntityId: 'pt-P1', labelStyleId: 'no-such-style', content: { mode: 'derived' } },
      }),
    ];
    const bySource = new Map(textPrimitives(project).map((primitive) => [primitive.sourceEntityId, primitive]));
    expect(bySource.get('label-derived')?.text).toBe('P1 TREE');
    expect(bySource.get('label-derived')?.point).toEqual({ x: 10, y: 20 });
    expect(bySource.has('label-hidden')).toBe(false);
    expect(bySource.get('label-orphan')?.text).toBe('orphan-baked');
    expect(bySource.get('label-orphan')?.point).toEqual({ x: 1, y: 2 });
    expect(bySource.get('label-unknown-style')?.text).toBe('style-baked');
    expect(bySource.get('label-unknown-style')?.point).toEqual({ x: 3, y: 4 });
  });

  it('exports bound labels materialized in DXF while points stay POINT+TEXT', () => {
    const project = blankProject();
    project.entities = [
      point({ id: 'pt-P1', stationId: 'P1', description: 'TREE', z: 5, x: 10, y: 20 }),
      label({
        id: 'label-derived',
        pointLabel: {
          pointEntityId: 'pt-P1',
          labelStyleId: 'point-label-point-number-elevation',
          content: { mode: 'derived' },
        },
      }),
    ];
    const result = buildDxfExportModelWithResult({ project });
    // Label text is materialized (number + elevation) at the materialized position.
    const labelText = result.output.texts.find((entry) => entry.text.includes('EL 5.000'));
    expect(labelText?.text).toBe('P1 EL 5.000');
    expect(labelText?.at).toEqual({ x: 10, y: 20 });
    // Points keep the documented POINT+TEXT approximation with its warning.
    expect(result.output.points).toHaveLength(1);
    expect(result.warnings.some(
      (warning) => warning.code === 'POINT_SYMBOL_APPROXIMATED' && warning.entityId === 'pt-P1',
    )).toBe(true);
  });

  it('exports honest shapes in SVG/PDF with no shape warnings (writer represents all six)', () => {
    // Legacy drawing (no 18D tables): shapes arrive via the legacy
    // styleId → symbol indirection and must still draw honestly.
    const fixture = buildSmallParcelFixture();
    const project: CadProject = {
      ...fixture.project,
      styleLibrary: {
        lineTypes: [],
        textStyles: [],
        pointSymbols: [
          { id: 'sym-square', name: 'Square', radius: 2, shape: 'square' },
          { id: 'sym-dot', name: 'Dot', radius: 1.2, shape: 'dot' },
        ],
        styles: [
          { id: 'style-square-pt', name: 'Square point', pointSymbolId: 'sym-square' },
          { id: 'style-dot-pt', name: 'Dot point', pointSymbolId: 'sym-dot' },
        ],
      },
    };
    const ptP1 = project.entities.find((entity) => entity.id === 'pt-P1');
    if (ptP1?.type === 'survey-point') ptP1.styleId = 'style-square-pt';
    const ptP2 = project.entities.find((entity) => entity.id === 'pt-P2');
    if (ptP2?.type === 'survey-point') ptP2.styleId = 'style-dot-pt';
    const result = buildExportSheetSceneWithResult({
      draft: fixture.draft,
      sheetId: fixture.sheetId,
      project,
      modelLabels: fixture.modelLabels,
    });
    // Warning matrix, honestly per implementation: the SVG/PDF writer
    // represents every shape natively, so POINT_SYMBOL_APPROXIMATED never
    // fires here — circle/dot are silent, and so are the rest. (DXF still
    // warns per point; see the DXF test above.)
    expect(result.warnings.filter((warning) => warning.code === 'POINT_SYMBOL_APPROXIMATED')).toEqual([]);
    expect(result.approximatedEntityIds).toEqual([]);
    const items = result.output.items;
    // Square rides as an honest closed polyline on the points layer…
    const square = items.filter(
      (item): item is Extract<typeof item, { kind: 'polyline' }> =>
        item.kind === 'polyline' && item.close && item.layer === 'points',
    );
    expect(square).toHaveLength(1);
    expect(square[0]?.points).toHaveLength(4);
    // …circle and dot stay circles.
    const circles = items.filter((item) => item.kind === 'circle' && item.layer === 'points');
    expect(circles).toHaveLength(3);
  });

  it('treats No Display / No Label as intentional (no SKIPPED noise) in export', () => {
    const fixture = buildSmallParcelFixture();
    const base = blankProject();
    const project: CadProject = {
      ...base,
      layers: fixture.project.layers,
      entities: [
        point({ id: 'pt-hidden-marker', layerId: 'points', pointStyleOverrideId: 'point-style-no-display' }),
        point({ id: 'pt-P1', layerId: 'points', stationId: 'P1', x: 0, y: 0 }),
        label({
          id: 'label-hidden',
          layerId: 'labels',
          pointLabel: { pointEntityId: 'pt-P1', labelStyleId: 'point-label-none', content: { mode: 'derived' } },
        }),
      ] as CadEntity[],
    };
    const result = buildExportSheetSceneWithResult({
      draft: fixture.draft,
      sheetId: fixture.sheetId,
      project,
      modelLabels: [],
    });
    expect(result.warnings.filter((warning) => warning.entityId === 'pt-hidden-marker')).toEqual([]);
    expect(result.warnings.filter((warning) => warning.entityId === 'label-hidden')).toEqual([]);
    expect(result.omittedEntityIds).not.toContain('pt-hidden-marker');
    expect(result.omittedEntityIds).not.toContain('label-hidden');
  });

  it('leaves LandXML unchanged: text omitted, points as CgPoint', () => {
    const project = blankProject();
    project.entities = [
      point({ id: 'pt-P1', stationId: 'P1', x: 100, y: 200, z: 5 }),
      label({
        id: 'label-derived',
        pointLabel: { pointEntityId: 'pt-P1', labelStyleId: 'point-label-f2f-full', content: { mode: 'derived' } },
      }),
    ];
    const result = buildLandXmlProjectExportWithResult(project, { units: 'm' });
    expect(result.output).toContain('name="P1"');
    expect(result.warnings.some((warning) => warning.message.includes('NOT_APPLICABLE'))).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
