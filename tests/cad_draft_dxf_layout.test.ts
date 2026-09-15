import { describe, expect, it } from 'vitest';
import { buildSmallParcelFixture } from './fixtures/draftSmallParcel';
import { buildDxfExportModel } from '../src/engine/cad/dxf/dxfExportModel';
import {
  buildDxfLayoutText,
  buildDxfModelSpaceText,
  sanitizeLayoutName,
} from '../src/engine/cad/dxf/dxfLayoutExport';
import { serializeDxfModel } from '../src/engine/cad/dxf/dxfSerializer';
import { createPlanSheet, addSheetToDraft, addViewportToSheet, moveViewportCenter, rotateViewport } from '../src/engine/cad/cadSheets';
import type { CadProject } from '../src/engine/cad/cadTypes';

const runtimeModuleUrl = new URL('../node_modules/@mlightcad/data-model/dist/data-model.cjs', import.meta.url);
const loadRuntime = async () => import(runtimeModuleUrl.href);

type Runtime = Awaited<ReturnType<typeof loadRuntime>>;

const readDatabase = async (runtime: Runtime, dxf: string) => {
  const db = new runtime.AcDbDatabase();
  runtime.acdbHostApplicationServices().workingDatabase = db;
  await db.read(new TextEncoder().encode(dxf).buffer, { readOnly: true }, runtime.AcDbFileType.DXF);
  return db;
};

const blockRecordByName = (db: { tables: { blockTable: { newIterator: () => { toArray: () => Array<{ name: string }> } } } }, name: string) =>
  db.tables.blockTable.newIterator().toArray().find((record) => record.name === name);

const entitiesOf = <T extends { type: string }>(record: { newIterator: () => { toArray: () => T[] } }): T[] =>
  record.newIterator().toArray();

// Minimal test-local pair reader for codes the runtime does not model
// (VIEWPORT twist 51, raw width/height order). Shares nothing with the writer.
const readGroupAfter = (dxf: string, entityType: string, code: string, occurrence = 0): string | undefined => {
  const lines = dxf.split('\n');
  let seen = -1;
  for (let i = 0; i + 3 < lines.length; i += 2) {
    if (lines[i]?.trim() === '0' && lines[i + 1]?.trim() === entityType) {
      seen += 1;
      if (seen !== occurrence) continue;
      for (let j = i + 2; j + 1 < lines.length; j += 2) {
        if (lines[j]?.trim() === '0') break;
        if (lines[j]?.trim() === code) return lines[j + 1]?.trim();
      }
    }
  }
  return undefined;
};

const withArcAndText = (project: CadProject): CadProject => ({
  ...project,
  entities: [
    ...project.entities,
    {
      type: 'arc', id: 'arc-A1', layerId: 'parcels', visible: true, locked: false,
      centerX: 25, centerY: 20, radius: 10, startAngleDeg: 0, endAngleDeg: 90,
    },
    {
      type: 'text', id: 'text-T1', layerId: 'labels', visible: true, locked: false,
      x: 25, y: 20, text: 'Lot A\nArea note',
    },
  ] as CadProject['entities'],
});

describe('dual dxf contract', () => {
  it('keeps the R12 model-space path byte-identical', () => {
    const fixture = buildSmallParcelFixture();
    const args = { project: fixture.project, modelLabels: fixture.modelLabels };
    expect(buildDxfModelSpaceText(args)).toBe(serializeDxfModel(buildDxfExportModel(args)));
    expect(buildDxfModelSpaceText(args)).toContain('AC1009');
  });

  it('emits the R2000 layout structure with named layouts and default viewport 1 plus floating viewport 2', async () => {
    const fixture = buildSmallParcelFixture();
    const project = withArcAndText(fixture.project);
    const { dxf, warnings, layouts } = buildDxfLayoutText({
      project, draft: fixture.draft, modelLabels: fixture.modelLabels, paperExtras: fixture.paperExtras,
    });
    expect(warnings).toEqual([]);
    expect(layouts).toEqual(['C1 - Parcel']);
    expect(dxf).toContain('$ACADVER\n1\nAC1015');
    expect(dxf).toContain('$HANDSEED');
    for (const section of ['CLASSES', 'TABLES', 'BLOCKS', 'ENTITIES', 'OBJECTS']) {
      expect(dxf).toContain(`2\n${section}`);
    }
    expect(dxf).toContain('ACAD_LAYOUT');
    expect(dxf).toContain('*Model_Space');
    expect(dxf).toContain('*Paper_Space');
    expect(dxf).toContain('TB_C1 - Parcel');

    const runtime = await loadRuntime();
    const db = await readDatabase(runtime, dxf);
    const modelEntities = entitiesOf(db.tables.blockTable.modelSpace) as Array<{
      type: string; layer: string; position?: { x: number; y: number };
      textString?: string; center?: { x: number; y: number }; radius?: number;
      startPoint?: { x: number; y: number }; closed?: boolean; numberOfVertices?: number;
      getPoint2dAt?: (_i: number) => { x: number; y: number };
    }>;
    const byType = (type: string) => modelEntities.filter((entity) => entity.type === type);
    expect(byType('Point')).toHaveLength(4);
    expect(byType('Line')).toHaveLength(4);
    expect(byType('Polyline')).toHaveLength(1);
    expect(byType('Arc')).toHaveLength(1);
    // 4 station labels + 5 model labels + arc/text extras (newline sanitized).
    const texts = byType('Text');
    expect(texts.map((entity) => entity.textString)).toContain('P1');
    expect(texts.map((entity) => entity.textString)).toContain('Lot A Area note');
    expect(texts.some((entity) => entity.textString?.includes('\n'))).toBe(false);
    const arc = byType('Arc')[0] as unknown as { center: { x: number; y: number }; radius: number };
    expect(arc.center.x).toBeCloseTo(25, 9);
    expect(arc.radius).toBeCloseTo(10, 9);
    const parcel = byType('Polyline')[0] as unknown as { closed: boolean; numberOfVertices: number };
    expect(parcel.closed).toBe(true);
    expect(parcel.numberOfVertices).toBe(4);
    const layers = new Set(modelEntities.map((entity) => entity.layer));
    expect(layers.has('points')).toBe(true);
    expect(layers.has('parcels')).toBe(true);

    const layoutRecords = db.objects.layout.newIterator().toArray() as Array<{
      layoutName: string; tabOrder: number;
      limits: { min: { x: number; y: number }; max: { x: number; y: number } };
    }>;
    expect(layoutRecords.map((entry) => entry.layoutName).sort()).toEqual(['C1 - Parcel', 'Model']);
    const sheet = layoutRecords.find((entry) => entry.layoutName === 'C1 - Parcel') as unknown as {
      limits: { max: { x: number; y: number } };
    };
    expect(sheet.limits.max.x).toBeCloseTo(297, 9);
    expect(sheet.limits.max.y).toBeCloseTo(210, 9);

    const paper = blockRecordByName(db, '*Paper_Space') as unknown as {
      newIterator: () => { toArray: () => Array<{ type: string; number?: number; blockName?: string; textString?: string }> };
    };
    expect(paper).toBeDefined();
    const paperEntities = entitiesOf(paper);
    const viewports = paperEntities.filter((entity) => entity.type === 'Viewport') as unknown as Array<{
      number: number; centerPoint: { x: number; y: number };
      viewCenter: { x: number; y: number }; viewHeight: number;
      width?: number; height?: number;
    }>;
    expect(viewports.map((entry) => entry.number).sort()).toEqual([1, 2]);
    // Default viewport 1 is sheet-sized (297 x 210) and centered.
    const def = viewports.find((entry) => entry.number === 1) as unknown as {
      centerPoint: { x: number; y: number }; viewHeight: number;
    };
    expect(def.centerPoint.x).toBeCloseTo(297 / 2, 9);
    expect(def.centerPoint.y).toBeCloseTo(210 / 2, 9);
    expect(def.viewHeight).toBeCloseTo(210, 9);
    const model = viewports.find((entry) => entry.number === 2) as unknown as {
      centerPoint: { x: number; y: number };
      viewCenter: { x: number; y: number }; viewHeight: number;
    };
    // Viewport center in paper mm, bottom-left origin: (15+100, 210-(15+65)).
    expect(model.centerPoint.x).toBeCloseTo(115, 9);
    expect(model.centerPoint.y).toBeCloseTo(130, 9);
    // Exact model center (no rebasing) and 130 mm @1:500 → 65 m view height.
    expect(model.viewCenter.x).toBeCloseTo(25, 9);
    expect(model.viewCenter.y).toBeCloseTo(20, 9);
    expect(model.viewHeight).toBeCloseTo(65, 9);
    // Twist is not modeled by the runtime reader; assert the raw pairs:
    // occurrence 0 is the default viewport, occurrence 1 the model view.
    expect(readGroupAfter(dxf, 'VIEWPORT', '51', 0)).toBe('0');
    expect(readGroupAfter(dxf, 'VIEWPORT', '51', 1)).toBe('0');
    expect(readGroupAfter(dxf, 'VIEWPORT', '69', 0)).toBe('1');
    expect(readGroupAfter(dxf, 'VIEWPORT', '69', 1)).toBe('2');
    // Title block travels as BLOCK+INSERT, not flattened geometry.
    const inserts = paperEntities.filter((entity) => entity.type === 'BlockReference');
    expect(inserts.map((entity) => entity.blockName)).toContain('TB_C1 - Parcel');
    const titleBlock = blockRecordByName(db, 'TB_C1 - Parcel') as unknown as {
      newIterator: () => { toArray: () => Array<{ type: string; textString?: string }> };
    };
    expect(titleBlock).toBeDefined();
    const titleEntities = entitiesOf(titleBlock);
    expect(titleEntities.some((entity) => entity.type === 'Polyline')).toBe(true);
    expect(titleEntities.map((entity) => entity.textString)).toContain('C1 - Parcel');
    // North arrow + scale bar paper extras land in paper space, not model.
    const paperTexts = paperEntities.filter((entity) => entity.type === 'Text');
    expect(paperTexts.map((entity) => entity.textString)).toContain('N (grid)');
    expect(byType('Text').map((entity) => entity.textString)).not.toContain('N (grid)');
  });

  it('preserves large grid coordinates exactly in model space and viewports', async () => {
    const fixture = buildSmallParcelFixture();
    const dx = 2400000;
    const dy = 7400000;
    const shift = (x: number, y: number): { x: number; y: number } => ({ x: x + dx, y: y + dy });
    const project: CadProject = {
      ...fixture.project,
      entities: fixture.project.entities.map((entity) => {
        if (entity.type === 'survey-point') return { ...entity, ...shift(entity.x, entity.y) };
        if (entity.type === 'line') {
          const from = shift(entity.fromX, entity.fromY);
          const to = shift(entity.toX, entity.toY);
          return { ...entity, fromX: from.x, fromY: from.y, toX: to.x, toY: to.y };
        }
        if (entity.type === 'parcel' || entity.type === 'polyline' || entity.type === 'polygon') {
          return { ...entity, vertices: entity.vertices.map((v) => shift(v.x, v.y)) };
        }
        return entity;
      }) as CadProject['entities'],
    };
    const viewportId = (fixture.draft.sheets[0] as { viewports: Array<{ id: string }> }).viewports[0]?.id as string;
    const draft = moveViewportCenter(fixture.draft, fixture.sheetId, viewportId, { x: 25 + dx, y: 20 + dy });
    const labels = fixture.modelLabels.map((label) => ({ ...label, ...shift(label.xModel, label.yModel) }));
    const { dxf, warnings } = buildDxfLayoutText({ project, draft, modelLabels: labels });
    expect(warnings).toEqual([]);

    const runtime = await loadRuntime();
    const db = await readDatabase(runtime, dxf);
    const points = entitiesOf(db.tables.blockTable.modelSpace).filter((entity) => entity.type === 'Point') as unknown as Array<{
      position: { x: number; y: number };
    }>;
    expect(points).toHaveLength(4);
    const xs = points.map((entity) => entity.position.x).sort((a, b) => a - b);
    expect(xs[0]).toBe(2400000);
    expect(xs[3]).toBe(2400050);
    const paper = blockRecordByName(db, '*Paper_Space') as unknown as {
      newIterator: () => { toArray: () => Array<{ type: string; viewCenter?: { x: number; y: number } }> };
    };
    const viewport = entitiesOf(paper).find((entity) => entity.type === 'Viewport' && (entity as unknown as { number?: number }).number === 2) as unknown as {
      viewCenter: { x: number; y: number };
    };
    expect(viewport.viewCenter.x).toBe(2400025);
    expect(viewport.viewCenter.y).toBe(7400020);
  });

  it('maps one layout per sheet with rotation twist and explicit warnings', async () => {
    const fixture = buildSmallParcelFixture();
    const second = createPlanSheet({ name: 'C1 - Parcel/details*', sizeId: 'ISO A4', orientation: 'portrait' });
    let draft = addSheetToDraft(fixture.draft, second);
    const secondId = draft.sheets[1]?.id as string;
    draft = addViewportToSheet(draft, secondId, {
      name: 'Detail', modelCenterX: 25, modelCenterY: 20, scaleDenominator: 100,
      paperXmm: 20, paperYmm: 20, paperWidthMm: 100, paperHeightMm: 100, rotationDeg: 90,
    });
    // Unknown token + non-text sheet object exercise the warning list.
    const target = draft.sheets[1] as { sheetObjects: Array<unknown> };
    target.sheetObjects.push({
      id: 'obj-token', kind: 'text', layerId: 'paper-text',
      paperXmm: 20, paperYmm: 180, text: 'Sheet {SHEET_NAME} {BOGUS}',
    });
    target.sheetObjects.push({ id: 'obj-geo', kind: 'north-arrow', layerId: 'paper-symbols', paperXmm: 10, paperYmm: 10 });
    const { dxf, warnings, layouts } = buildDxfLayoutText({
      project: fixture.project, draft, modelLabels: fixture.modelLabels,
    });
    expect(layouts).toEqual(['C1 - Parcel', 'C1 - Parcel_details_']);
    expect(warnings.some((warning) => warning.code === 'UNKNOWN_TOKEN' && warning.message.includes('BOGUS'))).toBe(true);
    expect(warnings.some((warning) => warning.code === 'UNSUPPORTED_SHEET_OBJECT')).toBe(true);
    // Raw order per layout: default viewport 1, then the floating model view.
    expect(readGroupAfter(dxf, 'VIEWPORT', '69', 0)).toBe('1');
    expect(readGroupAfter(dxf, 'VIEWPORT', '69', 1)).toBe('2');
    expect(readGroupAfter(dxf, 'VIEWPORT', '69', 2)).toBe('1');
    expect(readGroupAfter(dxf, 'VIEWPORT', '69', 3)).toBe('2');
    expect(readGroupAfter(dxf, 'VIEWPORT', '51', 0)).toBe('0');
    expect(readGroupAfter(dxf, 'VIEWPORT', '51', 1)).toBe('0');
    expect(readGroupAfter(dxf, 'VIEWPORT', '51', 2)).toBe('0');
    expect(readGroupAfter(dxf, 'VIEWPORT', '51', 3)).toBe('90');

    const runtime = await loadRuntime();
    const db = await readDatabase(runtime, dxf);
    const names = (db.objects.layout.newIterator().toArray() as Array<{ layoutName: string }>).map((entry) => entry.layoutName).sort();
    expect(names).toEqual(['C1 - Parcel', 'C1 - Parcel_details_', 'Model']);
    const secondPaper = blockRecordByName(db, '*Paper_Space0') as unknown as {
      newIterator: () => { toArray: () => Array<{ type: string; number?: number; viewHeight?: number }> };
    };
    const viewports = entitiesOf(secondPaper).filter((entity) => entity.type === 'Viewport');
    expect(viewports.map((entity) => entity.number).sort()).toEqual([1, 2]);
    const floating = viewports.find((entity) => entity.number === 2);
    // 100 mm @1:100 → 10 m view height.
    expect(floating?.viewHeight).toBeCloseTo(10, 9);
    // Each layout keeps its own sheet-sized default viewport 1.
    const firstPaper = blockRecordByName(db, '*Paper_Space') as unknown as {
      newIterator: () => { toArray: () => Array<{ type: string; number?: number }> };
    };
    expect(entitiesOf(firstPaper).filter((entity) => entity.type === 'Viewport').map((entity) => entity.number).sort()).toEqual([1, 2]);
    const secondLayout = (db.objects.layout.newIterator().toArray() as Array<{
      layoutName: string; limits: { max: { x: number; y: number } };
    }>).find((entry) => entry.layoutName === 'C1 - Parcel_details_');
    // Portrait A4: 210 x 297 mm.
    expect(secondLayout?.limits.max.x).toBeCloseTo(210, 9);
    expect(secondLayout?.limits.max.y).toBeCloseTo(297, 9);
  });

  it('sanitizes duplicate and reserved layout names', () => {
    const taken = new Set<string>(['model']);
    expect(sanitizeLayoutName('C1/Parcel: east*', taken)).toBe('C1_Parcel_ east_');
    expect(sanitizeLayoutName('Model', taken)).toBe('Model_1');
    expect(sanitizeLayoutName('C1/Parcel: east*', taken)).toBe('C1_Parcel_ east__2');
  });

  it('rotates viewport geometry consistently with the twist export', () => {
    const fixture = buildSmallParcelFixture();
    const viewportId = (fixture.draft.sheets[0] as { viewports: Array<{ id: string }> }).viewports[0]?.id as string;
    const draft = rotateViewport(fixture.draft, fixture.sheetId, viewportId, 90) ?? fixture.draft;
    const { dxf } = buildDxfLayoutText({ project: fixture.project, draft });
    // Occurrence 0 is the sheet-sized default (twist 0); the model view follows.
    expect(readGroupAfter(dxf, 'VIEWPORT', '51', 0)).toBe('0');
    expect(readGroupAfter(dxf, 'VIEWPORT', '51', 1)).toBe('90');
  });
});
