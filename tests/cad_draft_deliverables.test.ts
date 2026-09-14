import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSmallParcelFixture } from './fixtures/draftSmallParcel';
import { buildExportSheetScene } from '../src/engine/cad/cadExportScene';
import { serializeExportSceneToSvg } from '../src/engine/cad/cadSvgSerializer';
import { exportScenesToPdf } from '../src/engine/cad/cadPdfExport';
import { buildDxfExportModel } from '../src/engine/cad/dxf/dxfExportModel';
import { serializeDxfModel } from '../src/engine/cad/dxf/dxfSerializer';

const stableStringify = (value: unknown): string => JSON.stringify(value);

const buildScene = () => {
  const fixture = buildSmallParcelFixture();
  const { scene, warnings } = buildExportSheetScene({
    draft: fixture.draft,
    sheetId: fixture.sheetId,
    project: fixture.project,
    modelLabels: fixture.modelLabels,
    paperExtras: fixture.paperExtras,
  });
  return { fixture, scene, warnings };
};

// Minimal test-local DXF reader: parses group-code pairs from scratch and
// collects entities. Shares nothing with the writer internals.
const parseDxfEntities = (dxf: string): Array<{ type: string; fields: Map<string, string[]> }> => {
  const lines = dxf.split('\n').map((line) => line.trim());
  const entities: Array<{ type: string; fields: Map<string, string[]> }> = [];
  let current: { type: string; fields: Map<string, string[]> } | undefined;
  let inEntities = false;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i] as string;
    const value = lines[i + 1] as string;
    if (code === '2' && value === 'ENTITIES') inEntities = true;
    else if (code === '0' && value === 'ENDSEC') inEntities = false;
    if (!inEntities) continue;
    if (code === '0') {
      if (current) entities.push(current);
      current = value === 'ENDSEC' ? undefined : { type: value, fields: new Map() };
    } else if (current) {
      const list = current.fields.get(code) ?? [];
      list.push(value);
      current.fields.set(code, list);
    }
  }
  if (current) entities.push(current);
  return entities.filter((entity) => entity.type !== 'ENDSEC');
};

describe('draft deliverable exporters', () => {
  it('produces byte-identical SVG for the small parcel fixture', () => {
    const { scene, warnings } = buildScene();
    expect(warnings).toEqual([]);
    const svg = serializeExportSceneToSvg(scene);
    expect(svg).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    const golden = readFileSync(new URL('./fixtures/draftSmallParcel.svg', import.meta.url), 'utf8');
    expect(svg).toBe(golden);
  });

  it('emits PDF with sheet page size, text, and vector ops', () => {
    const { fixture, scene } = buildScene();
    const bytes = exportScenesToPdf([scene]);
    const pdf = new TextDecoder().decode(bytes);
    const sheet = fixture.draft.sheets[0] as { widthMm: number; heightMm: number };
    const wPt = Math.round((sheet.widthMm * 72) / 25.4 * 100) / 100;
    const hPt = Math.round((sheet.heightMm * 72) / 25.4 * 100) / 100;
    expect(pdf).toContain(`/MediaBox[0 0 ${wPt} ${hPt}]`);
    expect(pdf).toContain('/BaseFont/Helvetica');
    expect(pdf).toContain('(C1 - Parcel)');
    expect(pdf).toContain('(N \\(grid\\))');
    expect(pdf).toContain('<FEFF'); // UTF-16BE hex for the m² area label
    expect(pdf).toContain(' Tj ET');
    expect(pdf).toMatch(/[ml] S/);
    expect(pdf).toContain('/Count 1');
  });

  it('round-trips DXF entities through an independent reader', () => {
    const { fixture } = buildScene();
    const dxf = serializeDxfModel(buildDxfExportModel({ project: fixture.project, modelLabels: fixture.modelLabels }));
    expect(dxf).toContain('$ACADVER');
    const entities = parseDxfEntities(dxf);
    const byType = (type: string): Array<{ type: string; fields: Map<string, string[]> }> =>
      entities.filter((entity) => entity.type === type);
    expect(byType('POINT')).toHaveLength(4);
    expect(byType('LINE')).toHaveLength(4);
    expect(byType('LWPOLYLINE')).toHaveLength(1);
    const close = (actual: string | undefined, expected: number): void => {
      expect(Math.abs(Number(actual) - expected)).toBeLessThan(1e-3);
    };
    const firstPoint = byType('POINT')[0]?.fields as Map<string, string[]>;
    close(firstPoint.get('10')?.[0], 0);
    close(firstPoint.get('20')?.[0], 0);
    const parcel = byType('LWPOLYLINE')[0]?.fields as Map<string, string[]>;
    expect(parcel.get('70')?.[0]).toBe('1');
    expect(parcel.get('10')).toHaveLength(4);
    close(parcel.get('10')?.[1], 50);
    close(parcel.get('20')?.[2], 40);
    const layers = new Set<string>();
    entities.forEach((entity) => {
      const layer = entity.fields.get('8')?.[0];
      if (layer) layers.add(layer);
    });
    expect(layers.has('points')).toBe(true);
    expect(layers.has('parcels')).toBe(true);
    const texts = byType('TEXT').map((entity) => entity.fields.get('1')?.[0]);
    expect(texts).toContain('P1');
    expect(texts.some((text) => text?.includes('m'))).toBe(true);
    // Paper-space objects must never leak into model space.
    expect(texts).not.toContain('N (grid)');
  });

  it('never mutates the document or project during export', () => {
    const fixture = buildSmallParcelFixture();
    const before = stableStringify({ draft: fixture.draft, project: fixture.project });
    const { scene } = buildExportSheetScene({
      draft: fixture.draft,
      sheetId: fixture.sheetId,
      project: fixture.project,
      modelLabels: fixture.modelLabels,
      paperExtras: fixture.paperExtras,
    });
    serializeExportSceneToSvg(scene);
    exportScenesToPdf([scene]);
    serializeDxfModel(buildDxfExportModel({ project: fixture.project, modelLabels: fixture.modelLabels }));
    expect(stableStringify({ draft: fixture.draft, project: fixture.project })).toBe(before);
  });

  it('keeps precision on large grid coordinates via local viewport transforms', () => {
    const fixture = buildSmallParcelFixture();
    const dx = 2400000;
    const dy = 7400000;
    fixture.project.entities.forEach((entity) => {
      if (entity.type === 'survey-point') {
        entity.x += dx;
        entity.y += dy;
      } else if (entity.type === 'line') {
        entity.fromX += dx;
        entity.fromY += dy;
        entity.toX += dx;
        entity.toY += dy;
      } else if (entity.type === 'parcel') {
        entity.vertices = entity.vertices.map((v) => ({ x: v.x + dx, y: v.y + dy }));
      }
    });
    const sheet = fixture.draft.sheets.find((entry) => entry.id === fixture.sheetId) as { viewports: Array<{ modelCenterX: number; modelCenterY: number }> };
    (sheet.viewports[0] as { modelCenterX: number; modelCenterY: number }).modelCenterX += dx;
    (sheet.viewports[0] as { modelCenterX: number; modelCenterY: number }).modelCenterY += dy;
    const labels = fixture.modelLabels.map((label) => ({ ...label, xModel: label.xModel + dx, yModel: label.yModel + dy }));
    const { scene } = buildExportSheetScene({ draft: fixture.draft, sheetId: fixture.sheetId, project: fixture.project, modelLabels: labels });
    const texts = scene.items.filter((item) => item.kind === 'text');
    expect(texts.length).toBeGreaterThan(0);
    texts.forEach((item) => {
      if (item.kind !== 'text') return;
      expect(item.x).toBeGreaterThan(-1000);
      expect(item.x).toBeLessThan(1000);
    });
    // Stored geometry untouched: still on the large grid.
    const point = fixture.project.entities.find((entity) => entity.id === 'pt-P1') as { x: number } | undefined;
    expect(point?.x).toBeCloseTo(2400000, 6);
    // DXF keeps full large-grid coordinates within mm serialization precision.
    const dxf = serializeDxfModel(buildDxfExportModel({ project: fixture.project }));
    const entities = parseDxfEntities(dxf);
    const first = entities.find((entity) => entity.type === 'POINT')?.fields.get('10')?.[0];
    expect(Math.abs(Number(first) - 2400000)).toBeLessThan(1e-3);
  });

  it('warns on broken refs without crashing, and fails only on a missing sheet', () => {
    const fixture = buildSmallParcelFixture();
    const { scene, warnings } = buildExportSheetScene({
      draft: fixture.draft,
      sheetId: fixture.sheetId,
      project: fixture.project,
      modelLabels: [...fixture.modelLabels, { id: 'label-broken', broken: true, xModel: 0, yModel: 0 }],
    });
    expect(warnings.some((warning) => warning.code === 'BROKEN_REFERENCE')).toBe(true);
    const svg = serializeExportSceneToSvg(scene);
    expect(svg).toContain('BROKEN_REFERENCE');
    expect(() =>
      buildExportSheetScene({ draft: fixture.draft, sheetId: 'missing-sheet', project: fixture.project }),
    ).toThrow();
  });
});
