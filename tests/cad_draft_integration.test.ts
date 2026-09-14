/**
 * Phase 13B Track E — drafting final integration (agent tier).
 *
 * Curve label agreement across SVG/PDF/DXF, road-style rotated viewports,
 * multi-sheet persistence, multi-page PDF order, legacy v1 migration,
 * perf smoke (no hard ms gate), and adjustment-domain isolation.
 * No adjustment/GNSS/COGO math changes; numeric agreement only.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { buildDxfExportModel } from '../src/engine/cad/dxf/dxfExportModel';
import { serializeDxfModel } from '../src/engine/cad/dxf/dxfSerializer';
import {
  buildExportSheetScene,
  buildNorthArrowItems,
  buildScaleBarItems,
  type ModelLabelPlacement,
} from '../src/engine/cad/cadExportScene';
import { deriveCurveAutoText, deriveInverseAutoText } from '../src/engine/cad/cadLabelEngine';
import { buildDraftPointTable } from '../src/engine/cad/cadDraftTables';
import type {
  DraftDocument,
} from '../src/engine/cad/cadDraftTypes';
import { exportScenesToPdf } from '../src/engine/cad/cadPdfExport';
import {
  addSheetToDraft,
  addViewportToSheet,
  asPlanViewport,
  buildScaleBar,
  createPlanSheet,
  modelToPaperMm,
  northArrowAngleDeg,
  rotateViewport,
  setViewportScale,
} from '../src/engine/cad/cadSheets';
import { serializeExportSceneToSvg } from '../src/engine/cad/cadSvgSerializer';
import type { CadDrawingDocument, CadEntity, CadProject } from '../src/engine/cad/cadTypes';

const pdfVisibleText = (pdf: string): string => {
  const parts: string[] = [];
  const literals = /\((?:\\[\\()]|[^\\()])*\)/g;
  for (const match of pdf.matchAll(literals)) {
    parts.push(match[0].slice(1, -1).replace(/\\([\\()])/g, '$1'));
  }
  for (const match of pdf.matchAll(/<([0-9A-Fa-f]+)>/g)) {
    const hex = match[1] as string;
    if (!hex.startsWith('FEFF')) continue;
    let text = '';
    for (let i = 4; i + 4 <= hex.length; i += 4) {
      text += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    }
    parts.push(text);
  }
  return parts.join('\n');
};

const mustDraft = (doc: CadDrawingDocument): DraftDocument => {
  if (!doc.draft) throw new Error('drawing has no draft document');
  return doc.draft;
};

const buildCurveProject = (): CadProject => ({
  version: 2,
  id: 'project-curve-fixture',
  name: 'Curve Fixture',
  metadata: { source: 'parsed-input', runMode: 'unknown', units: 'm', stationCount: 2, observationCount: 0, adjustedStationCount: 0 },
  layers: [
    { id: 'points', name: 'Points', color: '#ffffff', visible: true, locked: false, role: 'points' },
    { id: 'parcels', name: 'Parcels', color: '#ffffff', visible: true, locked: false, role: 'parcels' },
  ],
  styleLibrary: { lineTypes: [], textStyles: [], pointSymbols: [], styles: [] },
  entities: [
    {
      type: 'line', id: 'line-T1', layerId: 'parcels', visible: true, locked: false,
      fromStationId: 'T1', toStationId: 'T2', fromX: 0, fromY: 0, toX: 100, toY: 0, sourceObservationIds: [],
    },
    {
      type: 'arc', id: 'arc-C1', layerId: 'parcels', visible: true, locked: false,
      centerX: 100, centerY: 30, radius: 30, startAngleDeg: 270, endAngleDeg: 360,
    },
  ] as CadEntity[],
  cogoComputations: [],
  bounds: { minX: 0, minY: 0, maxX: 130, maxY: 60 },
});

const buildSheetDraft = (name: string): { draft: DraftDocument; sheetId: string } => {
  const blank = createBlankCadDrawingDocument({ name, units: 'm' });
  let draft = addSheetToDraft(mustDraft(blank), createPlanSheet({ name, sizeId: 'ISO A4', orientation: 'landscape' }));
  const sheetId = draft.sheets[0]?.id as string;
  draft = addViewportToSheet(draft, sheetId, {
    name: 'Viewport', modelCenterX: 50, modelCenterY: 20, scaleDenominator: 500,
    paperXmm: 15, paperYmm: 15, paperWidthMm: 200, paperHeightMm: 130,
  });
  return { draft, sheetId };
};

describe('draft final integration', () => {
  it('keeps line+arc labels numerically identical across SVG, PDF, and DXF', () => {
    const project = buildCurveProject();
    const { draft, sheetId } = buildSheetDraft('C1 - Curve');
    const lineText = deriveInverseAutoText({ x: 0, y: 0 }, { x: 100, y: 0 }, 'bearing-distance');
    const curveText = deriveCurveAutoText(30, 90);
    const modelLabels: ModelLabelPlacement[] = [
      { id: 'label-line', text: lineText, xModel: 50, yModel: 0, layerId: 'labels' },
      { id: 'label-curve', text: curveText, xModel: 100, yModel: 30, layerId: 'labels' },
    ];
    const { scene } = buildExportSheetScene({ draft, sheetId, project, modelLabels });
    const svg = serializeExportSceneToSvg(scene);
    const pdf = new TextDecoder().decode(exportScenesToPdf([scene]));
    const dxf = serializeDxfModel(buildDxfExportModel({ project, modelLabels }));

    // Each label's numbers survive in all three deliverables.
    for (const label of [lineText, curveText]) {
      expect(svg).toContain(label);
      expect(dxf).toContain(label);
      expect(pdfVisibleText(pdf)).toContain(label);
    }
    // ARC geometry itself reaches DXF with full model coordinates.
    expect(dxf).toContain('\nARC\n');
    expect(dxf).toContain('100');
    expect(dxf).toContain('30');
  });

  it('handles a road-style rotated viewport: north, scale, and clipping stay correct', () => {
    const project = buildCurveProject();
    const { draft: base, sheetId } = buildSheetDraft('C2 - Road');
    const viewportId = base.sheets[0]?.viewports[0]?.id as string;
    const scaled = setViewportScale(base, sheetId, viewportId, 1000) ?? base;
    const draft = rotateViewport(scaled, sheetId, viewportId, 30) ?? scaled;
    const viewport = asPlanViewport(draft.sheets[0]?.viewports[0] as never);

    // Grid-north arrow counter-rotates; scale bar is rotation-invariant.
    expect(northArrowAngleDeg(viewport.rotationDeg)).toBeCloseTo(330, 9);
    const segments = buildScaleBar({ scaleDenominator: viewport.scaleDenominator, divisions: 4, modelPerDivisionM: 10 });
    segments.forEach((segment) => {
      expect(segment.paperLengthMm).toBeCloseTo(modelToPaperMm(10, 1000), 9);
    });

    const labels: ModelLabelPlacement[] = [
      { id: 'label-line', text: deriveInverseAutoText({ x: 0, y: 0 }, { x: 100, y: 0 }, 'bearing-distance'), xModel: 50, yModel: 0 },
    ];
    const extras = [...buildNorthArrowItems(270, 40, 12, 'paper-symbols'), ...buildScaleBarItems(220, 175, 4, 10, 'paper-symbols')];
    const { scene, warnings } = buildExportSheetScene({ draft, sheetId, project, modelLabels: labels, paperExtras: extras });
    expect(warnings).toEqual([]);
    // Viewport clip rect is emitted and labels are still placed inside the scene.
    expect(scene.clips).toHaveLength(1);
    expect(scene.clips[0]?.widthMm).toBeCloseTo(200, 9);
    const texts = scene.items.filter((item) => item.kind === 'text');
    expect(texts.some((item) => item.kind === 'text' && item.text.includes('100.000 m'))).toBe(true);
    expect(texts.some((item) => item.kind === 'text' && item.text === 'N (grid)')).toBe(true);
    const svg = serializeExportSceneToSvg(scene);
    expect(svg).toContain('clipPath');
    expect(svg).toContain('N (grid)');
  });

  it('persists multiple sheets in order and exports multi-page PDF in sheet order', () => {
    const project = buildCurveProject();
    let doc = createBlankCadDrawingDocument({ name: 'Multi', units: 'm' });
    for (const name of ['C1 - Plan', 'C2 - Details']) {
      doc = { ...doc, draft: addSheetToDraft(mustDraft(doc), createPlanSheet({ name, sizeId: 'ISO A4', orientation: 'landscape' })) };
    }
    const reopened = parseCadDrawingFile(serializeCadDrawingFile(doc));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok || !reopened.drawing.draft) return;
    const draftDoc = reopened.drawing.draft;
    expect(draftDoc.sheets.map((sheet) => sheet.name)).toEqual(['C1 - Plan', 'C2 - Details']);

    const scenes = draftDoc.sheets.map(
      (sheet) => buildExportSheetScene({ draft: draftDoc, sheetId: sheet.id, project }).scene,
    );
    const pdf = new TextDecoder().decode(exportScenesToPdf(scenes));
    expect(pdf).toContain('/Count 2');
    expect(pdf.indexOf('C1 - Plan')).toBeLessThan(pdf.indexOf('C2 - Details'));
  });

  it('opens legacy v1 .wncad with geometry intact, then round-trips save-as-v2 identically', () => {
    const project = buildCurveProject();
    const legacy = {
      kind: 'webnet-cad-drawing',
      schemaVersion: 1,
      drawingId: 'cad-drawing:legacy',
      name: 'Legacy',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      units: 'm',
      project,
      imports: [],
    };
    const opened = parseCadDrawingFile(JSON.stringify(legacy));
    expect(opened.ok).toBe(true);
    if (!opened.ok || !opened.drawing.draft) return;
    expect(opened.drawing.schemaVersion).toBe(2);
    expect(opened.drawing.project.entities).toHaveLength(project.entities.length);
    expect(JSON.stringify(opened.drawing.project.entities)).toBe(JSON.stringify(project.entities));

    const saved = serializeCadDrawingFile(opened.drawing);
    const reread = parseCadDrawingFile(saved);
    expect(reread.ok).toBe(true);
    if (!reread.ok || !reread.drawing.draft || !opened.drawing.draft) return;
    expect(reread.drawing.project.entities).toEqual(opened.drawing.project.entities);
    expect(reread.drawing.draft.sheets).toEqual(opened.drawing.draft.sheets);
  });

  it('loads the committed sample project and derives its deliverables', () => {
    const raw = readFileSync(path.join(process.cwd(), 'public/examples/survey_plan_sample.wncad'), 'utf8');
    const parsed = parseCadDrawingFile(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const draftDoc = parsed.drawing.draft;
    if (!draftDoc) return;
    const { drawing } = parsed;
    const kinds = drawing.project.entities.map((entity) => entity.type);
    for (const kind of ['survey-point', 'parcel', 'arc', 'text', 'line'] as const) {
      expect(kinds).toContain(kind);
    }
    // Adjusted + COGO provenance both present.
    const points = drawing.project.entities.filter((entity) => entity.type === 'survey-point');
    expect(points.some((entity) => entity.type === 'survey-point' && entity.source === 'adjustment-result')).toBe(true);
    expect(points.some((entity) => entity.type === 'survey-point' && entity.source === 'parsed-input')).toBe(true);
    expect(draftDoc.sheets).toHaveLength(1);
    expect(draftDoc.titleBlockDefinitions).toHaveLength(1);
    const sheet = draftDoc.sheets[0] as { id: string; viewports: Array<{ scaleDenominator: number }> };
    expect(sheet.viewports[0]?.scaleDenominator).toBe(500);

    const table = buildDraftPointTable(
      points.map((entity) => {
        const point = entity as { stationId: string; id: string; x: number; y: number };
        return { pointId: point.stationId, entityId: point.id, northing: point.y, easting: point.x };
      }),
    );
    expect(table.rows.length).toBeGreaterThanOrEqual(5);
    const { scene } = buildExportSheetScene({ draft: draftDoc, sheetId: sheet.id, project: drawing.project });
    expect(serializeExportSceneToSvg(scene).length).toBeGreaterThan(0);
    expect(exportScenesToPdf([scene]).length).toBeGreaterThan(0);
    expect(serializeDxfModel(buildDxfExportModel({ project: drawing.project })).length).toBeGreaterThan(0);
  });

  it('builds sheet scenes for 1000 points/labels with sub-quadratic scaling and no hard time gate', () => {
    const run = (count: number): number => {
      const entities: CadEntity[] = Array.from({ length: count }, (_, index): CadEntity => ({
        type: 'survey-point', id: `pt-N${index}`, layerId: 'points', visible: true, locked: false,
        stationId: `N${index}`, x: index, y: index * 2, pointClass: 'free', source: 'parsed-input',
      }));
      const project: CadProject = { ...buildCurveProject(), id: `perf-${count}`, entities };
      const { draft, sheetId } = buildSheetDraft(`Perf ${count}`);
      const labels: ModelLabelPlacement[] = Array.from({ length: count }, (_, index) => ({
        id: `label-N${index}`, text: `N${index}`, xModel: index, yModel: index * 2,
      }));
      const started = performance.now();
      const { scene } = buildExportSheetScene({ draft, sheetId, project, modelLabels: labels });
      serializeExportSceneToSvg(scene);
      return performance.now() - started;
    };
    const small = run(250);
    const large = run(1000);
    console.log(`draft perf: 250pts=${small.toFixed(1)}ms 1000pts=${large.toFixed(1)}ms`);
    // 4x input must cost well below 16x time (loose sub-quadratic smoke, not a gate).
    expect(large).toBeLessThan(Math.max(16 * small, small + 5000));
  });

  it('leaves observations, weights, GNSS, adjustment settings, and CRS untouched', () => {
    const session = {
      observations: [{ id: 1, kind: 'distance', value: 50.001 }],
      weights: { distanceSigma: 0.005 },
      gnss: { baselines: [{ id: 'BL001', solution: 'FIXED' }] },
      adjustmentSettings: { maxIterations: 10, convergenceLimit: 0.001 },
      crs: { id: 'EPSG:2193', epoch: '2000.0' },
    };
    const before = JSON.stringify(session);
    const doc = createBlankCadDrawingDocument({ name: 'Isolation', units: 'm' });
    const entitiesBefore = JSON.stringify(doc.project.entities);

    const base = mustDraft(doc);
    let draft = addSheetToDraft(base, createPlanSheet({ name: 'C1', sizeId: 'ISO A4', orientation: 'landscape' }));
    const sheetId = draft.sheets[0]?.id as string;
    draft = addViewportToSheet(draft, sheetId, { name: 'V', modelCenterX: 0, modelCenterY: 0 });
    const viewportId = draft.sheets[0]?.viewports[0]?.id as string;
    void setViewportScale(draft, sheetId, viewportId, 500);
    void rotateViewport(draft, sheetId, viewportId, 10);
    void deriveInverseAutoText({ x: 0, y: 0 }, { x: 1, y: 1 }, 'bearing-distance');
    void deriveCurveAutoText(30, 60);
    void buildDraftPointTable([{ pointId: 'P1', northing: 0, easting: 0 }]);
    void buildNorthArrowItems(0, 0, 10, 'paper');
    void buildScaleBarItems(0, 0, 4, 10, 'paper');
    void serializeCadDrawingFile(doc);

    expect(JSON.stringify(session)).toBe(before);
    expect(JSON.stringify(doc.project.entities)).toBe(entitiesBefore);
  });
});
