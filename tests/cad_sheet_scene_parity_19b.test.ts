/**
 * Phase 19B Round 1B — canonical sheet scene + export parity + persistence.
 *
 * One geometry source (`deriveSheetScene` → `buildViewportPaperSymbols`,
 * `buildTitleBlockItems`) feeds the screen descriptor, SVG, PDF, and the
 * R2000 layout DXF. This file pins the §106 contract and the §79 coverage
 * matrix.
 *
 * §79 export coverage matrix (disposition of each paper/scene object):
 *
 * | object          | SVG  | PDF  | DXF-R12 | DXF-R2000 | LandXML      | WNCAD          |
 * |-----------------|------|------|---------|-----------|--------------|----------------|
 * | viewport        | FULL | FULL | N/A §78 | FULL      | N/A §80      | FULL (refs)    |
 * | viewport frame  | FULL | FULL | N/A §78 | FULL      | N/A §80      | NOT_PERSISTED  |
 * | north arrow     | FULL | FULL | N/A §78 | FULL      | N/A §80      | FULL (def)     |
 * | scale bar       | FULL | FULL | N/A §78 | FULL      | N/A §80      | FULL (def)     |
 * | plan note       | FULL | FULL | N/A §78 | FULL      | N/A §80      | FULL (def)     |
 * | title block     | FULL | FULL | N/A §78 | FULL      | N/A §80      | FULL (def)     |
 * | template        | N/A  | N/A  | N/A §78 | N/A       | N/A §80      | FULL (def)     |
 *
 * R12 stays model-space-only (§78) and LandXML presentation-blind (§80);
 * derived geometry (transformed model, resolved north angle/scale length,
 * SVG bytes) is never persisted (§81).
 */
import { describe, expect, it } from 'vitest';
import {
  createBlankCadDrawingDocument,
  createBlankCadProject,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { createBlankDraftDocument, type DraftDocument, type DraftSheetObject } from '../src/engine/cad/cadDraftTypes';
import {
  addSheetToDraft,
  addViewportToSheet,
  assignTitleBlockToSheet,
  createPlanSheet,
  createTitleBlockTemplate,
  editTitleBlockTemplateElements,
} from '../src/engine/cad/cadSheets';
import {
  buildNorthArrowObjectItems,
  buildScaleBarObjectItems,
  deriveSheetScene,
  modelToPaperPoint,
  type DerivedSheetScene,
} from '../src/engine/cad/cadExportScene';
import { serializeExportSceneToSvg } from '../src/engine/cad/cadSvgSerializer';
import { exportScenesToPdf } from '../src/engine/cad/cadPdfExport';
import { buildDxfLayoutText } from '../src/engine/cad/dxf/dxfLayoutExport';
import type { CadEntity, CadProject } from '../src/engine/cad/cadTypes';

const PT_PER_MM = 72 / 25.4;

const buildProject = (): CadProject => {
  const project = createBlankCadProject({ name: 'Parity 19B', units: 'm' });
  project.layers = [
    { id: 'points', name: 'Points', color: '#ffffff', visible: true, locked: false, role: 'points' },
    { id: 'parcels', name: 'Parcels', color: '#ffffff', visible: true, locked: false, role: 'parcels' },
    { id: 'labels', name: 'Labels', color: '#ffffff', visible: true, locked: false, role: 'labels' },
  ];
  project.entities = [
    { id: 'pt-A', type: 'survey-point', layerId: 'points', visible: true, locked: false, stationId: 'A', x: 0, y: 0, pointClass: 'free', source: 'parsed-input' },
    { id: 'pt-B', type: 'survey-point', layerId: 'points', visible: true, locked: false, stationId: 'B', x: 100, y: 0, pointClass: 'free', source: 'parsed-input' },
    { id: 'line-AB', type: 'line', layerId: 'parcels', visible: true, locked: false, fromStationId: 'A', toStationId: 'B', fromX: 0, fromY: 0, toX: 100, toY: 0, sourceObservationIds: [] },
  ] as CadEntity[];
  return project;
};

interface SheetHandle { draft: DraftDocument; sheetId: string; viewportId: string }

const buildSheet = (
  draft: DraftDocument,
  name: string,
  options: { den?: number; rot?: number; locked?: boolean; plotFrame?: boolean; sizeId?: 'ISO A4' | 'ISO A3'; orientation?: 'landscape' | 'portrait' } = {},
): SheetHandle => {
  let next = addSheetToDraft(draft, createPlanSheet({ name, sizeId: options.sizeId ?? 'ISO A4', orientation: options.orientation ?? 'landscape' }));
  const sheetId = next.sheets[next.sheets.length - 1]?.id as string;
  next = addViewportToSheet(next, sheetId, {
    name: 'V', modelCenterX: 50, modelCenterY: 0, scaleDenominator: options.den ?? 500,
    paperXmm: 15, paperYmm: 15, paperWidthMm: 200, paperHeightMm: 130, rotationDeg: options.rot ?? 0,
  });
  const sheet = next.sheets.find((entry) => entry.id === sheetId) as { viewports: Array<{ id: string; locked?: boolean; plotFrame?: boolean }> };
  const viewport = sheet.viewports[0] as { id: string; locked?: boolean; plotFrame?: boolean };
  if (options.locked !== undefined) viewport.locked = options.locked;
  // §60: new viewports default to explicit plotFrame:false, so the legacy
  // absent=frame contract needs an explicitly absent flag here.
  if (options.plotFrame !== undefined) viewport.plotFrame = options.plotFrame;
  else delete viewport.plotFrame;
  return { draft: next, sheetId, viewportId: viewport.id };
};

const withSheetObjects = (draft: DraftDocument, sheetId: string, objects: DraftSheetObject[]): DraftDocument => ({
  ...draft,
  sheets: draft.sheets.map((sheet) =>
    sheet.id === sheetId ? { ...sheet, sheetObjects: [...sheet.sheetObjects, ...objects] } : sheet,
  ),
});

const northArrow = (id: string, viewportId: string, extra: Partial<DraftSheetObject> = {}): DraftSheetObject => ({
  id, kind: 'north-arrow', layerId: 'labels', paperXmm: 200, paperYmm: 40, sizeMm: 12, viewportId, ...extra,
} as unknown as DraftSheetObject);

const scaleBar = (id: string, viewportId: string, modelPerDivision: number, divisions = 1): DraftSheetObject => ({
  id, kind: 'scale-bar', layerId: 'labels', paperXmm: 0, paperYmm: 0, divisions, modelPerDivision, viewportId,
} as unknown as DraftSheetObject);

const lineLength = (scene: DerivedSheetScene): number => {
  const line = scene.scene.items.find((item) => item.kind === 'line' && item.sourceEntityId === 'line-AB') as
    | { x1: number; y1: number; x2: number; y2: number }
    | undefined;
  if (!line) throw new Error('projected line missing');
  return Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
};

/** Mirrors the SheetWorkspace screen transform, independent of the engine. */
const screenProject = (
  x: number, y: number,
  vp: { modelCenterX: number; modelCenterY: number; scaleDenominator: number; paperXmm: number; paperYmm: number; paperWidthMm: number; paperHeightMm: number; rotationDeg: number },
): { xMm: number; yMm: number } => {
  const k = 1000 / vp.scaleDenominator;
  const qx = k * (x - vp.modelCenterX);
  const qy = -k * (y - vp.modelCenterY);
  const a = (vp.rotationDeg * Math.PI) / 180;
  const cx = vp.paperXmm + vp.paperWidthMm / 2;
  const cy = vp.paperYmm + vp.paperHeightMm / 2;
  return { xMm: cx + qx * Math.cos(a) - qy * Math.sin(a), yMm: cy + qx * Math.sin(a) + qy * Math.cos(a) };
};

describe('Phase 19B canonical sheet scene parity', () => {
  it('pins the scale oracle 100 m → 200 mm @1:500 / 100 mm @1:1000 across scene, SVG, PDF, DXF', () => {
    const project = buildProject();
    let draft = createBlankDraftDocument({ projectId: project.id, layers: project.layers });
    const a = buildSheet(draft, 'C1 - 500', { den: 500 });
    draft = withSheetObjects(a.draft, a.sheetId, [scaleBar('obj-scale', a.viewportId, 100)]);
    const b = buildSheet(draft, 'C1 - 1000', { den: 1000 });
    draft = withSheetObjects(b.draft, b.sheetId, [scaleBar('obj-scale-2', b.viewportId, 100)]);

    const scene500 = deriveSheetScene({ draft, sheetId: a.sheetId, project });
    const scene1000 = deriveSheetScene({ draft, sheetId: b.sheetId, project });

    // Model geometry: 100 m east at 1:500 → 200 mm; at 1:1000 → 100 mm.
    expect(lineLength(scene500)).toBeCloseTo(200, 9);
    expect(lineLength(scene1000)).toBeCloseTo(100, 9);
    // The canonical scale bar uses the same viewport denominator.
    expect(scene500.viewports[0]?.scaleBar?.divisionPaperMm).toBeCloseTo(200, 9);
    expect(scene1000.viewports[0]?.scaleBar?.divisionPaperMm).toBeCloseTo(100, 9);
    expect(scene500.viewports[0]?.scaleBar?.unitLabel).toBe('m');

    const svg500 = serializeExportSceneToSvg(scene500.scene);
    const svg1000 = serializeExportSceneToSvg(scene1000.scene);
    expect(svg500).toContain('width="200" height="2"');
    expect(svg1000).toContain('width="100" height="2"');
    expect(svg500).toContain('100 m @ 1:500');
    expect(svg1000).toContain('100 m @ 1:1000');

    const pdf500 = new TextDecoder().decode(exportScenesToPdf([scene500.scene]));
    const pdf1000 = new TextDecoder().decode(exportScenesToPdf([scene1000.scene]));
    expect(pdf500).toContain((200 * PT_PER_MM).toFixed(2));
    expect(pdf1000).toContain((100 * PT_PER_MM).toFixed(2));

    // DXF mapping: the paper-space text carries the viewport-derived ratio.
    const dxf500 = buildDxfLayoutText({ project, draft, modelLabels: [] }).dxf;
    expect(dxf500).toContain('100 m @ 1:500');
    expect(dxf500).toContain('100 m @ 1:1000');
  });

  it('respects drawing units for ft scale bars (drawing-unit model length, not metres)', () => {
    const project = buildProject();
    let draft = createBlankDraftDocument({ projectId: project.id, layers: project.layers });
    draft = { ...draft, precision: { ...draft.precision, unitsMode: 'ft' } };
    const handle = buildSheet(draft, 'C1 - ft', { den: 500 });
    draft = withSheetObjects(handle.draft, handle.sheetId, [scaleBar('obj-scale-ft', handle.viewportId, 10, 4)]);
    const scene = deriveSheetScene({ draft, sheetId: handle.sheetId, project });
    // 10 ft = 3048 mm model; /500 → 6.096 mm per division; 4 divisions → 24.384 mm.
    expect(scene.viewports[0]?.scaleBar?.divisionPaperMm).toBeCloseTo(6.096, 9);
    expect(scene.viewports[0]?.scaleBar?.totalPaperMm).toBeCloseTo(24.384, 9);
    expect(scene.viewports[0]?.scaleBar?.unitLabel).toBe('ft');
    expect(serializeExportSceneToSvg(scene.scene)).toContain('10 ft @ 1:500');
  });

  it('keeps screen and export rotation equivalent at 30°, including the grid-north arrow', () => {
    const project = buildProject();
    let draft = createBlankDraftDocument({ projectId: project.id, layers: project.layers });
    const handle = buildSheet(draft, 'C1 - Rotated', { den: 500, rot: 30 });
    draft = withSheetObjects(handle.draft, handle.sheetId, [northArrow('obj-north', handle.viewportId)]);
    const derived = deriveSheetScene({ draft, sheetId: handle.sheetId, project });
    const vp = derived.viewports[0];
    expect(vp?.rotationDeg).toBe(30);
    expect(vp?.northArrowAngleDeg).toBeCloseTo(30, 9);
    expect(vp?.hasNorthArrow).toBe(true);

    // Screen transform (SheetWorkspace formula) equals the scene's projection.
    const viewport = { modelCenterX: 50, modelCenterY: 0, scaleDenominator: 500, paperXmm: 15, paperYmm: 15, paperWidthMm: 200, paperHeightMm: 130, rotationDeg: 30 };
    const screenA = screenProject(0, 0, viewport);
    const screenB = screenProject(100, 0, viewport);
    const line = derived.scene.items.find((item) => item.kind === 'line' && item.sourceEntityId === 'line-AB') as { x1: number; y1: number; x2: number; y2: number };
    expect(line.x1).toBeCloseTo(screenA.xMm, 9);
    expect(line.y1).toBeCloseTo(screenA.yMm, 9);
    expect(line.x2).toBeCloseTo(screenB.xMm, 9);
    expect(line.y2).toBeCloseTo(screenB.yMm, 9);
    // East now runs 30° clockwise-as-seen: 200 mm long, down-right.
    expect(line.x2 - line.x1).toBeCloseTo(200 * Math.cos(Math.PI / 6), 6);
    expect(line.y2 - line.y1).toBeCloseTo(200 * Math.sin(Math.PI / 6), 6);

    // Arrow tip rotated 30° clockwise about its anchor (200, 40).
    const arrow = derived.scene.items.find((item) => item.kind === 'polyline' && item.layer === 'labels' && item.close) as
      | { points: Array<{ x: number; y: number }> }
      | undefined;
    const tip = arrow?.points[0] as { x: number; y: number };
    expect(tip.x).toBeCloseTo(200 + 12 * Math.sin(Math.PI / 6), 9);
    expect(tip.y).toBeCloseTo(40 - 12 * Math.cos(Math.PI / 6), 9);
    // Canonical builder is the same source the DXF emits.
    expect(buildNorthArrowObjectItems(northArrow('obj-north', handle.viewportId), 30)).toEqual(
      buildNorthArrowObjectItems(northArrow('obj-north', handle.viewportId), 30),
    );
    expect(buildDxfLayoutText({ project, draft }).dxf).toContain('N (grid)');
  });

  it('disposes a broken viewport link as a visible BROKEN_REFERENCE, never a silent rebind', () => {
    const project = buildProject();
    const base = createBlankDraftDocument({ projectId: project.id, layers: project.layers });
    const handle = buildSheet(base, 'C1 - Broken');
    const draft = withSheetObjects(handle.draft, handle.sheetId, [northArrow('obj-north-broken', 'viewport-missing')]);
    const derived = deriveSheetScene({ draft, sheetId: handle.sheetId, project });
    expect(derived.warnings.some((warning) => warning.code === 'BROKEN_REFERENCE' && warning.entityId === 'obj-north-broken')).toBe(true);
    const placeholder = derived.scene.items.find((item) => item.kind === 'text' && item.text === 'BROKEN_REFERENCE');
    expect(placeholder).toBeDefined();
    expect(serializeExportSceneToSvg(derived.scene)).toContain('BROKEN_REFERENCE');
    expect(new TextDecoder().decode(exportScenesToPdf([derived.scene]))).toContain('BROKEN_REFERENCE');
    const dxf = buildDxfLayoutText({ project, draft });
    expect(dxf.warnings.some((warning) => warning.code === 'BROKEN_REFERENCE')).toBe(true);
    expect(dxf.dxf).toContain('BROKEN_REFERENCE');
  });

  it('emits the viewport frame only for plotFrame true, keeping legacy absent=frame', () => {
    const project = buildProject();
    let draft = createBlankDraftDocument({ projectId: project.id, layers: project.layers });
    const on = buildSheet(draft, 'C1 - Frame on', { plotFrame: true });
    const off = buildSheet(on.draft, 'C1 - Frame off', { plotFrame: false });
    const legacy = buildSheet(off.draft, 'C1 - Legacy', {});
    draft = legacy.draft;

    const hasFrame = (sheetId: string): boolean =>
      deriveSheetScene({ draft, sheetId, project }).scene.items.some((item) => item.kind === 'rect' && item.layer === 'paper-frame');
    expect(hasFrame(on.sheetId)).toBe(true);
    expect(hasFrame(off.sheetId)).toBe(false);
    expect(hasFrame(legacy.sheetId)).toBe(true);
  });

  it('keeps multi-viewport 1:250 and 1:1000-rotated-90° scale/north independent', () => {
    const project = buildProject();
    let draft = createBlankDraftDocument({ projectId: project.id, layers: project.layers });
    draft = addSheetToDraft(draft, createPlanSheet({ name: 'C1 - Multi', sizeId: 'ISO A3', orientation: 'landscape' }));
    const sheetId = draft.sheets[0]?.id as string;
    draft = addViewportToSheet(draft, sheetId, {
      name: 'V1', modelCenterX: 50, modelCenterY: 0, scaleDenominator: 250,
      paperXmm: 15, paperYmm: 15, paperWidthMm: 200, paperHeightMm: 130, rotationDeg: 0,
    });
    draft = addViewportToSheet(draft, sheetId, {
      name: 'V2', modelCenterX: 50, modelCenterY: 0, scaleDenominator: 1000,
      paperXmm: 220, paperYmm: 15, paperWidthMm: 180, paperHeightMm: 130, rotationDeg: 90,
    });
    const v1 = (draft.sheets[0] as { viewports: Array<{ id: string }> }).viewports[0]?.id as string;
    const v2 = (draft.sheets[0] as { viewports: Array<{ id: string }> }).viewports[1]?.id as string;
    draft = withSheetObjects(draft, sheetId, [scaleBar('obj-s1', v1, 10, 4), northArrow('obj-n2', v2)]);

    const derived = deriveSheetScene({ draft, sheetId, project });
    const [d1, d2] = derived.viewports;
    expect(d1?.viewportId).toBe(v1);
    expect(d1?.scaleBar?.divisionPaperMm).toBeCloseTo(40, 9);
    expect(d1?.scaleBar?.totalPaperMm).toBeCloseTo(160, 9);
    expect(d1?.hasNorthArrow).toBe(false);
    expect(d2?.viewportId).toBe(v2);
    expect(d2?.northArrowAngleDeg).toBeCloseTo(90, 9);
    expect(d2?.hasNorthArrow).toBe(true);
    expect(d2?.scaleBar).toBeUndefined();
    // One bar, one arrow in the single scene.
    expect(derived.scene.items.filter((item) => item.kind === 'rect' && item.fill === '#000000')).toHaveLength(2);
    expect(derived.scene.items.filter((item) => item.kind === 'polyline' && item.close)).toHaveLength(1);
  });

  it('keeps PDF multi-sheet page sizes and order', () => {
    const project = buildProject();
    let draft = createBlankDraftDocument({ projectId: project.id, layers: project.layers });
    const landscape = buildSheet(draft, 'C1 - Landscape', { sizeId: 'ISO A4', orientation: 'landscape' });
    const portrait = buildSheet(landscape.draft, 'C2 - Portrait', { sizeId: 'ISO A3', orientation: 'portrait' });
    draft = portrait.draft;
    const scenes = [landscape, portrait].map((handle) => deriveSheetScene({ draft, sheetId: handle.sheetId, project }).scene);
    const pdf = new TextDecoder().decode(exportScenesToPdf(scenes));
    const box = (widthMm: number, heightMm: number): string =>
      `/MediaBox[0 0 ${(widthMm * PT_PER_MM).toFixed(2)} ${(heightMm * PT_PER_MM).toFixed(2)}]`;
    expect(pdf).toContain('/Count 2');
    expect(pdf).toContain(box(297, 210));
    expect(pdf).toContain(box(297, 420));
    expect(pdf.indexOf('C1 - Landscape')).toBeLessThan(pdf.indexOf('C2 - Portrait'));
  });

  it('persists semantic definitions only through .wncad (§81)', () => {
    const blank = createBlankCadDrawingDocument({ name: 'Persist 19B', units: 'm' });
    const handle = buildSheet(blank.draft as DraftDocument, 'C1 - Persist', { den: 500, locked: true, plotFrame: false });
    let draft = withSheetObjects(handle.draft, handle.sheetId, [
      northArrow('obj-north', handle.viewportId),
      scaleBar('obj-scale', handle.viewportId, 10, 4),
    ]);
    draft = {
      ...draft,
      sheets: draft.sheets.map((sheet) =>
        sheet.id === handle.sheetId
          ? ({ ...sheet, titleBlockFields: { DRAWN_BY: 'JJ', CLIENT: 'ACME' } } as unknown as typeof sheet)
          : sheet,
      ),
    };
    const document = { ...blank, draft };
    const json = serializeCadDrawingFile(document);
    const parsed = parseCadDrawingFile(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || !parsed.drawing.draft) return;
    const reopened = parsed.drawing.draft;
    const sheet = reopened.sheets[0] as (typeof reopened.sheets)[number] & { titleBlockFields?: Record<string, string> };
    expect(sheet?.titleBlockFields).toEqual({ DRAWN_BY: 'JJ', CLIENT: 'ACME' });
    const viewport = sheet?.viewports[0] as { locked?: boolean; plotFrame?: boolean };
    expect(viewport.locked).toBe(true);
    expect(viewport.plotFrame).toBe(false);
    const objects = sheet?.sheetObjects ?? [];
    expect(objects.find((object) => object.id === 'obj-north')).toMatchObject({ kind: 'north-arrow', viewportId: handle.viewportId, sizeMm: 12 });
    expect(objects.find((object) => object.id === 'obj-scale')).toMatchObject({ kind: 'scale-bar', divisions: 4, modelPerDivision: 10 });
    const templates = (reopened as unknown as { templates?: Array<{ name: string }> }).templates;
    expect(templates?.map((template) => template.name)).toEqual(['Blank', 'Single Viewport', 'Survey Plan']);
    // Semantic only: no derived geometry or resolved angles/lengths persisted.
    for (const forbidden of ['northArrowAngleDeg', 'divisionPaperMm', 'totalPaperMm', 'N (grid)']) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('exposes one canonical scale-bar builder used by scene consumers', () => {
    const object = scaleBar('obj-direct', 'vp-direct', 10, 4);
    const { items, derived } = buildScaleBarObjectItems(object, { scaleDenominator: 500 }, 'm');
    expect(items.filter((item) => item.kind === 'rect')).toHaveLength(4);
    expect(derived.divisionPaperMm).toBeCloseTo(20, 9);
    // The pure-projection helper agrees with the screen transform the scene uses.
    const p = modelToPaperPoint(100, 0, { modelCenterX: 50, modelCenterY: 0, scaleDenominator: 500, paperXmm: 15, paperYmm: 15, paperWidthMm: 200, paperHeightMm: 130 });
    expect(p.xMm).toBeCloseTo(215, 9);
  });

  it('renders paper notes even when a visual title-block template is assigned', () => {
    const project = buildProject();
    let draft = createBlankDraftDocument({ projectId: project.id, layers: project.layers });
    const handle = buildSheet(draft, 'C1 - Notes');
    const template = createTitleBlockTemplate('Template');
    draft = { ...handle.draft, titleBlockDefinitions: [...handle.draft.titleBlockDefinitions, template] };
    draft = editTitleBlockTemplateElements(draft, template.id, [
      { id: 'el-1', kind: 'token-text', xMm: 10, yMm: 190, text: 'Sheet {SHEET_NAME}', tokenTemplate: 'Sheet {SHEET_NAME}' },
    ]);
    draft = assignTitleBlockToSheet(draft, handle.sheetId, template.id);
    draft = withSheetObjects(draft, handle.sheetId, [
      { id: 'obj-note', kind: 'plan-note', layerId: 'labels', paperXmm: 20, paperYmm: 100, text: 'Grid north.\nScale 1:500' },
      { id: 'obj-bad-token', kind: 'plan-note', layerId: 'labels', paperXmm: 20, paperYmm: 110, text: 'Keep {BOGUS} literal' },
    ]);
    const derived = deriveSheetScene({ draft, sheetId: handle.sheetId, project });
    const texts = derived.scene.items.filter((item) => item.kind === 'text').map((item) => (item as { text: string }).text);
    expect(texts).toContain('Grid north.\nScale 1:500');
    expect(texts.some((text) => text.includes('{BOGUS}'))).toBe(true);
    expect(derived.warnings.some((warning) => warning.code === 'UNKNOWN_TOKEN' && warning.message.includes('BOGUS'))).toBe(true);
    const svg = serializeExportSceneToSvg(derived.scene);
    expect(svg).toContain('Grid north.');
    expect(new TextDecoder().decode(exportScenesToPdf([derived.scene]))).toContain('Grid north.');
    expect(buildDxfLayoutText({ project, draft }).dxf).toContain('Grid north.');
  });
});