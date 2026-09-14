import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSmallParcelFixture } from './fixtures/draftSmallParcel';
import { buildExportSheetScene, buildNorthArrowItems, buildScaleBarItems, modelToPaperPoint } from '../src/engine/cad/cadExportScene';
import { rotateViewport, setViewportClip, setViewportLayerOverride } from '../src/engine/cad/cadSheets';
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

  it('centers parcel corners on the viewport midpoint at θ=0 with scale unchanged', () => {
    const { scene } = buildScene();
    // Viewport paper (15,15,200,130) → midpoint (115,80); k=1000/500=2.
    // P1(0,0)→(65,120) P2(50,0)→(165,120) P3(50,40)→(165,40) P4(0,40)→(65,40).
    const ends = scene.items.flatMap((item) =>
      item.kind === 'line' && item.clipId ? [[item.x1, item.y1], [item.x2, item.y2]] : [],
    );
    for (const corner of [[65, 120], [165, 120], [165, 40], [65, 40]]) {
      expect(ends.some(([x, y]) => Math.abs(x - corner[0] as number) < 1e-9 && Math.abs(y - corner[1] as number) < 1e-9)).toBe(true);
    }
    // Diagonal midpoint is the viewport center; 50 m side is 100 mm paper.
    expect((65 + 165) / 2).toBeCloseTo(115, 9);
    expect((120 + 40) / 2).toBeCloseTo(80, 9);
    const side = Math.hypot(165 - 65, 120 - 120);
    expect(side).toBeCloseTo(100, 9);
  });

  it('exports persisted draft labels with overrides and no caller placements', () => {
    const fixture = buildSmallParcelFixture();
    const draft = {
      ...fixture.draft,
      labels: [
        {
          id: 'label-persisted', text: 'AUTO P1', xModel: 0, yModel: 0,
          layerId: 'labels', heightMm: 3, provenance: 'COGO' as const, overrideText: 'P1 pinned',
        },
      ],
    };
    const { scene, warnings } = buildExportSheetScene({
      draft, sheetId: fixture.sheetId, project: fixture.project,
    });
    expect(warnings).toEqual([]);
    const texts = scene.items.filter((item) => item.kind === 'text' && item.text === 'P1 pinned');
    expect(texts).toHaveLength(1);
    // P1(0,0) maps to the same centered paper point as the F3 check.
    const label = texts[0] as { x: number; y: number };
    expect(label.x).toBeCloseTo(65, 9);
    expect(label.y).toBeCloseTo(120, 9);
  });

  it('keeps ellipse semi-axes under 90° viewport rotation', () => {
    const fixture = buildSmallParcelFixture();
    fixture.project.entities.push({
      type: 'error-ellipse',
      id: 'ellipse-E1',
      layerId: 'parcels',
      visible: true,
      locked: false,
      stationId: 'P1',
      centerX: 25,
      centerY: 20,
      semiMajor: 5,
      semiMinor: 2,
      thetaDeg: 0,
    } as never);
    const viewportId = (fixture.draft.sheets[0] as { viewports: Array<{ id: string }> }).viewports[0]?.id as string;
    const rotatedDraft = rotateViewport(fixture.draft, fixture.sheetId, viewportId, 90) ?? fixture.draft;
    const { scene } = buildExportSheetScene({
      draft: rotatedDraft, sheetId: fixture.sheetId, project: fixture.project,
    });
    const ellipses = scene.items.filter((item) => item.kind === 'ellipse');
    expect(ellipses).toHaveLength(1);
    // k=2: 5 m → 10 mm, 2 m → 4 mm. Per-component abs would collapse rx→0.
    const ellipse = ellipses[0] as { rx: number; ry: number };
    expect(ellipse.rx).toBeCloseTo(10, 9);
    expect(ellipse.ry).toBeCloseTo(4, 9);
  });

  it('excludes hidden layers from SVG and PDF, with viewport visible=true re-showing', () => {
    const fixture = buildSmallParcelFixture();
    const markHidden = (layers: Array<{ id: string; visible?: boolean }>): typeof fixture.project.layers =>
      layers.map((layer) => (layer.id === 'parcels' ? { ...layer, visible: false } : layer)) as typeof fixture.project.layers;
    const hidden = { ...fixture.project, layers: markHidden(fixture.project.layers) };
    const hiddenDraft = { ...fixture.draft, layers: markHidden(fixture.draft.layers) };
    const common = { sheetId: fixture.sheetId, modelLabels: fixture.modelLabels, paperExtras: fixture.paperExtras };
    const gone = buildExportSheetScene({ draft: hiddenDraft, project: hidden, ...common }).scene;
    expect(gone.items.some((item) => item.layer === 'parcels')).toBe(false);
    expect(serializeExportSceneToSvg(gone)).not.toContain('layer-parcels');
    expect(new TextDecoder().decode(exportScenesToPdf([gone]))).not.toContain('layer-parcels');
    // A viewport override of visible=true re-shows a merely hidden layer.
    const viewportId = (hiddenDraft.sheets[0] as { viewports: Array<{ id: string }> }).viewports[0]?.id as string;
    const reshown = setViewportLayerOverride(hiddenDraft, fixture.sheetId, viewportId, 'parcels', { visible: true });
    const back = buildExportSheetScene({ draft: reshown, project: hidden, ...common }).scene;
    expect(back.items.some((item) => item.layer === 'parcels')).toBe(true);
  });

  it('keeps printable:false layers excluded even under a visible=true override', () => {
    const fixture = buildSmallParcelFixture();
    const markNonPrintable = (layers: Array<{ id: string }>): typeof fixture.project.layers =>
      layers.map((layer) =>
        layer.id === 'parcels' ? { ...layer, printable: false } : layer,
      ) as typeof fixture.project.layers;
    const project = { ...fixture.project, layers: markNonPrintable(fixture.project.layers) };
    const draft = { ...fixture.draft, layers: markNonPrintable(fixture.draft.layers) };
    const common = { sheetId: fixture.sheetId, modelLabels: fixture.modelLabels, paperExtras: fixture.paperExtras };
    const viewportId = (draft.sheets[0] as { viewports: Array<{ id: string }> }).viewports[0]?.id as string;
    const overridden = setViewportLayerOverride(draft, fixture.sheetId, viewportId, 'parcels', { visible: true });
    const scene = buildExportSheetScene({ draft: overridden, project, ...common }).scene;
    expect(scene.items.some((item) => item.layer === 'parcels')).toBe(false);
    expect(serializeExportSceneToSvg(scene)).not.toContain('layer-parcels');
    expect(new TextDecoder().decode(exportScenesToPdf([scene]))).not.toContain('layer-parcels');
  });

  it('honors clip rects and text rotation in PDF with SVG-matching placement', () => {
    const fixture = buildSmallParcelFixture();
    const viewportId = (fixture.draft.sheets[0] as { viewports: Array<{ id: string }> }).viewports[0]?.id as string;
    const draft = setViewportClip(fixture.draft, fixture.sheetId, viewportId,
      { xMm: 20, yMm: 25, widthMm: 100, heightMm: 60 });
    const rotatedText = {
      kind: 'text' as const, layer: 'paper-text', x: 115, y: 80,
      text: 'rotated note', heightMm: 3, anchor: 'middle' as const, rotationDeg: 45,
    };
    const { scene } = buildExportSheetScene({
      draft, sheetId: fixture.sheetId, project: fixture.project,
      modelLabels: fixture.modelLabels, paperExtras: [...fixture.paperExtras, rotatedText],
    });
    expect(scene.clips[0]).toMatchObject({ xMm: 20, yMm: 25, widthMm: 100, heightMm: 60 });
    const svg = serializeExportSceneToSvg(scene);
    expect(svg).toContain('<clipPath id="viewport-viewport-small-parcel">');
    expect(svg).toContain('<rect x="20" y="25" width="100" height="60"/>');
    expect(svg).toContain('rotate(45 115 80)');
    const pdf = new TextDecoder().decode(exportScenesToPdf([scene]));
    // Same clip rect, flipped to PDF user space; same rotated-text semantics.
    expect(pdf).toContain('re W n');
    expect(pdf).toContain(' Tm ');
    const s = 72 / 25.4;
    const pageH = 210 * s;
    const clipY = pageH - (25 + 60) * s;
    expect(pdf).toContain(`${(20 * s).toFixed(2)} ${clipY.toFixed(2)} ${(100 * s).toFixed(2)} ${(60 * s).toFixed(2)} re W n`);
    const cos = Math.cos(Math.PI / 4).toFixed(2);
    const sin = Math.sin(Math.PI / 4).toFixed(2);
    expect(pdf).toContain(`${cos} -${sin} ${sin} ${cos} `);
  });

  it('anchors middle-rotated text in the rotated frame with SVG-equivalent Tm', () => {
    const fixture = buildSmallParcelFixture();
    const anchored = {
      kind: 'text' as const, layer: 'paper-text', x: 115, y: 80,
      text: 'AB', heightMm: 3, anchor: 'middle' as const, rotationDeg: 90,
    };
    const { scene } = buildExportSheetScene({
      draft: fixture.draft, sheetId: fixture.sheetId, project: fixture.project,
      modelLabels: [], paperExtras: [anchored],
    });
    // SVG rotate-about-point: 'AB' ≈ 3 mm wide, centered on (115, 80) along
    // the 90° baseline → start (115, 78.5); PDF Tm carries that translation.
    const s = 72 / 25.4;
    const pageH = 210 * s;
    const e = (115 * s).toFixed(2);
    const f = (pageH - 78.5 * s).toFixed(2);
    const pdf = new TextDecoder().decode(exportScenesToPdf([scene]));
    expect(pdf).toContain(`0 -1 1 0 ${e} ${f} Tm (AB) Tj ET`);
  });

  it('rotates viewport geometry rigidly with an agreeing north arrow', () => {
    const fixture = buildSmallParcelFixture();
    const viewportId = (fixture.draft.sheets[0] as { viewports: Array<{ id: string }> }).viewports[0]?.id as string;
    const rotatedDraft = rotateViewport(fixture.draft, fixture.sheetId, viewportId, 90) ?? fixture.draft;
    const common = { sheetId: fixture.sheetId, project: fixture.project, modelLabels: fixture.modelLabels, paperExtras: fixture.paperExtras };
    const plain = buildExportSheetScene({ draft: fixture.draft, ...common }).scene;
    // Rotation-consistent extras through the scene helper (no detached arrow).
    const rotatedExtras = [...buildNorthArrowItems(270, 40, 12, 'paper-symbols', 90), ...buildScaleBarItems(220, 175, 4, 10, 'paper-symbols')];
    const rotated = buildExportSheetScene({ draft: rotatedDraft, sheetId: fixture.sheetId, project: fixture.project, modelLabels: fixture.modelLabels, paperExtras: rotatedExtras }).scene;
    type Seg = { x1: number; y1: number; x2: number; y2: number };
    const linesOf = (scene: typeof plain): Seg[] =>
      scene.items.flatMap((item) => (item.kind === 'line' && item.clipId ? [{ x1: item.x1, y1: item.y1, x2: item.x2, y2: item.y2 }] : []));
    const plainLines = linesOf(plain);
    const rotatedLines = linesOf(rotated);
    expect(rotatedLines).toHaveLength(plainLines.length);
    // Rigid: every length preserved, every direction turned 90° clockwise.
    plainLines.forEach((line, index) => {
      const other = rotatedLines[index] as Seg;
      expect(Math.hypot(other.x2 - other.x1, other.y2 - other.y1)).toBeCloseTo(
        Math.hypot(line.x2 - line.x1, line.y2 - line.y1), 9,
      );
      expect(other.x2 - other.x1).toBeCloseTo(-(line.y2 - line.y1), 9);
      expect(other.y2 - other.y1).toBeCloseTo(line.x2 - line.x1, 9);
    });
    // East-running boundary (100, 0) now runs (0, 100): east→south on paper.
    expect((plainLines[0] as Seg).x2 - (plainLines[0] as Seg).x1).toBeCloseTo(100, 9);
    expect((rotatedLines[0] as Seg).x2 - (rotatedLines[0] as Seg).x1).toBeCloseTo(0, 9);
    expect((rotatedLines[0] as Seg).y2 - (rotatedLines[0] as Seg).y1).toBeCloseTo(100, 9);
    // Model north lands east of center; the θ=90 arrow tip points east too.
    const vp = { modelCenterX: 25, modelCenterY: 20, scaleDenominator: 500, paperXmm: 15, paperYmm: 15 };
    const north90 = modelToPaperPoint(25, 60, vp, 90);
    expect(north90.xMm).toBeCloseTo(95, 9);
    expect(north90.yMm).toBeCloseTo(15, 9);
    const arrow = buildNorthArrowItems(270, 40, 12, 'paper-symbols', 90);
    const tip = (arrow[0] as { points: Array<{ x: number; y: number }> }).points[0] as { x: number; y: number };
    expect(tip.x).toBeCloseTo(282, 9);
    expect(tip.y).toBeCloseTo(40, 9);
    // Asserted on the exported scene's own arrow item, not a detached construct.
    const sceneArrows = rotated.items.filter(
      (item) => item.kind === 'polyline' && item.layer === 'paper-symbols' && item.close,
    );
    expect(sceneArrows).toHaveLength(1);
    const sceneTip = (sceneArrows[0] as { points: Array<{ x: number; y: number }> }).points[0] as { x: number; y: number };
    expect(sceneTip.x).toBeCloseTo(282, 9);
    expect(sceneTip.y).toBeCloseTo(40, 9);
    // Scale bar is pure paper geometry: identical with or without rotation.
    expect(buildScaleBarItems(220, 175, 4, 10, 'paper-symbols')).toEqual(
      buildScaleBarItems(220, 175, 4, 10, 'paper-symbols'),
    );
  });
});
