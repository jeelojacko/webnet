/**
 * Phase 19B Round 3F — sheet-layout performance evidence (mission §§102-103,128).
 *
 * EVIDENCE TIER (manual-only, never in CI): builds large synthetic projects and
 * records wall-clock breakdowns for the sheet pipeline. No assertions on
 * absolute time (machines differ) — assertions only sanity-check that each
 * stage produced output. Numbers are recorded in
 * docs/evidence/phase19b-sheet-layout-performance.md.
 *
 * Breakdown measured: display derivation, visibility filtering, paper mapping,
 * canonical sheet-scene derivation, serialization (SVG/PDF), all-sheet scene
 * generation, token resolution, and sheet metadata lookup at 10/50/100 sheets.
 */
import { describe, expect, it } from 'vitest';
import { createBlankCadProject } from '../../src/engine/cad/cadDrawingFile';
import { createBlankDraftDocument, type DraftDocument } from '../../src/engine/cad/cadDraftTypes';
import {
  addSheetToDraft,
  addViewportToSheet,
  assignTitleBlockToSheet,
  buildSheetTokenContext,
  createPlanSheet,
  createTitleBlockTemplate,
  expandSheetTokens,
} from '../../src/engine/cad/cadSheets';
import { addSheetObject } from '../../src/engine/cad/cadSheetObjects';
import { buildCadDisplayScene } from '../../src/engine/cad/cadRenderer';
import { filterCadDisplaySceneForViewport } from '../../src/engine/cad/cadViewportAppearance';
import { deriveSheetScene, modelToPaperPoint } from '../../src/engine/cad/cadExportScene';
import { serializeExportSceneToSvg } from '../../src/engine/cad/cadSvgSerializer';
import { exportScenesToPdf } from '../../src/engine/cad/cadPdfExport';
import type { CadEntity, CadProject } from '../../src/engine/cad/cadTypes';

const now = (): number => performance.now();
const ms = (start: number): number => Math.round((now() - start) * 10) / 10;

const buildLines = (count: number): CadEntity[] => {
  const entities = new Array<CadEntity>(count);
  for (let index = 0; index < count; index += 1) {
    entities[index] = {
      type: 'line',
      id: `line-${index}`,
      layerId: 'parcels',
      visible: true,
      locked: false,
      fromStationId: `P${index}`,
      toStationId: `Q${index}`,
      fromX: index,
      fromY: 0,
      toX: index,
      toY: 100,
      sourceObservationIds: [],
    };
  }
  return entities;
};

const buildProject = (entityCount: number): CadProject => {
  const project = createBlankCadProject({ name: 'Perf 19B', units: 'm' });
  project.layers = [
    { id: 'parcels', name: 'Parcels', color: '#ffffff', visible: true, locked: false, role: 'parcels' },
  ];
  project.entities = buildLines(entityCount);
  project.bounds = { minX: 0, minY: 0, maxX: entityCount, maxY: 100 };
  return project;
};

const withViewports = (
  draft: DraftDocument,
  sheetId: string,
  viewportCount: number,
): DraftDocument => {
  let next = draft;
  for (let index = 0; index < viewportCount; index += 1) {
    next = addViewportToSheet(next, sheetId, {
      name: `V${index + 1}`,
      modelCenterX: 0,
      modelCenterY: 0,
      scaleDenominator: 500,
      paperXmm: 10 + index * 5,
      paperYmm: 10 + index * 5,
      paperWidthMm: 90,
      paperHeightMm: 60,
      rotationDeg: index * 10,
    });
  }
  return next;
};

const buildDraft = (sheets: number, viewportsPerSheet: number): { draft: DraftDocument; sheetIds: string[] } => {
  let draft = createBlankDraftDocument({ projectId: 'perf' });
  const sheetIds: string[] = [];
  for (let index = 0; index < sheets; index += 1) {
    draft = addSheetToDraft(draft, createPlanSheet({ name: `L${index + 1}` }));
    const sheetId = draft.sheets[draft.sheets.length - 1]?.id as string;
    sheetIds.push(sheetId);
    draft = withViewports(draft, sheetId, viewportsPerSheet);
  }
  return { draft, sheetIds };
};

const measureScenePipeline = (entityCount: number, viewportCount: number): Record<string, number> => {
  const project = buildProject(entityCount);
  const { draft, sheetIds } = buildDraft(1, viewportCount);
  const sheetId = sheetIds[0] as string;
  // Warm derivation so first-call module init is not attributed to a phase.
  deriveSheetScene({ draft, sheetId, project });

  const tDisplay = now();
  const display = buildCadDisplayScene(project);
  const displayMs = ms(tDisplay);

  const tFilter = now();
  const filtered = filterCadDisplaySceneForViewport(project, display);
  const filterMs = ms(tFilter);

  const viewport = draft.sheets[0]!.viewports[0]!;
  const tMap = now();
  let mapped = 0;
  for (let index = 0; index < filtered.primitives.length; index += 1) {
    const point = modelToPaperPoint(index, index % 100, viewport, 0);
    if (point) mapped += 1;
  }
  const mapMs = ms(tMap);

  const tDerive = now();
  const derived = deriveSheetScene({ draft, sheetId, project });
  const deriveMs = ms(tDerive);

  const tSvg = now();
  const svg = serializeExportSceneToSvg(derived.scene);
  const svgMs = ms(tSvg);

  const tPdf = now();
  const pdf = exportScenesToPdf([derived.scene]);
  const pdfMs = ms(tPdf);

  return {
    entities: entityCount,
    viewports: viewportCount,
    primitives: display.primitives.length,
    filteredPrimitives: filtered.primitives.length,
    sceneItems: derived.scene.items.length,
    mapped,
    svgBytes: svg.length,
    pdfBytes: pdf.length,
    displayMs,
    filterMs,
    mapMs,
    deriveMs,
    svgMs,
    pdfMs,
  };
};

describe('19B sheet-layout performance evidence', () => {
  it('records one-viewport scene pipeline at 10k / 50k / 100k primitives', () => {
    const rows = [10_000, 50_000, 100_000].map((count) => measureScenePipeline(count, 1));
    rows.forEach((row) => {
      expect(row.primitives).toBe(row.entities);
      expect(row.sceneItems).toBeGreaterThan(0);
    });
    console.log('[19B perf] one viewport', JSON.stringify(rows, null, 0));
  }, 600_000);

  it('records four-viewport scene pipeline at 10k / 50k / 100k primitives', () => {
    const rows = [10_000, 50_000, 100_000].map((count) => measureScenePipeline(count, 4));
    rows.forEach((row) => {
      expect(row.primitives).toBe(row.entities);
      expect(row.sceneItems).toBeGreaterThan(0);
    });
    console.log('[19B perf] four viewports', JSON.stringify(rows, null, 0));
  }, 900_000);

  it('records sheet metadata scale at 10 / 50 / 100 sheets', () => {
    const project = buildProject(1_000);
    const rows = [10, 50, 100].map((sheetCount) => {
      const { draft, sheetIds } = buildDraft(sheetCount, 1);
      const tSwitch = now();
      // Sheet switch = look up one sheet and derive it (metadata + scene).
      const derived = deriveSheetScene({ draft, sheetId: sheetIds[sheetCount - 1] as string, project });
      const switchMs = ms(tSwitch);
      const tAll = now();
      const all = sheetIds.map((sheetId) => deriveSheetScene({ draft, sheetId, project }).scene);
      const allScenesMs = ms(tAll);
      const tPdf = now();
      const pdf = exportScenesToPdf(all);
      const allPdfMs = ms(tPdf);
      expect(derived.scene.items.length).toBeGreaterThan(0);
      return { sheets: sheetCount, switchMs, allScenesMs, allPdfMs, pdfBytes: pdf.length };
    });
    console.log('[19B perf] sheet scale', JSON.stringify(rows, null, 0));
  }, 600_000);

  it('records paper-only derivation cost (title block + note, no viewport)', () => {
    const project = buildProject(10);
    const { draft, sheetIds } = buildDraft(1, 0);
    const sheetId = sheetIds[0] as string;
    const template = createTitleBlockTemplate('Assigned');
    const assigned = assignTitleBlockToSheet(
      addSheetObject(
        { ...draft, titleBlockDefinitions: [template] },
        sheetId,
        { kind: 'plan-note', layerId: 'labels', paperXmm: 20, paperYmm: 20, text: 'PERF NOTE' },
      ),
      sheetId,
      template.id,
    );
    const iterations = 1_000;
    let itemCount = 0;
    const start = now();
    for (let index = 0; index < iterations; index += 1) {
      itemCount = deriveSheetScene({ draft: assigned, sheetId, project }).scene.items.length;
    }
    const totalMs = ms(start);
    expect(itemCount).toBeGreaterThan(0);
    console.log(
      '[19B perf] paper-only',
      JSON.stringify({ iterations, totalMs, perCallUs: Math.round((totalMs * 1000) / iterations) }),
    );
  }, 120_000);

  it('records token resolution cost', () => {    const project = buildProject(10);
    const { draft, sheetIds } = buildDraft(100, 1);
    const sheet = draft.sheets[0]!;
    const tContext = now();
    const context = buildSheetTokenContext({ sheet, sheetNumber: 1, projectName: project.name });
    const contextMs = ms(tContext);
    const text = 'SHEET {SHEET_NAME} NO {SHEET_NUMBER} SCALE {SCALE} DRAWN {DRAWN_BY} CHECKED {CHECKED_BY} CLIENT {CLIENT} LOCATION {LOCATION} PROJECT {PROJECT_NAME} CRS {CRS}';
    const iterations = 10_000;
    const tExpand = now();
    for (let index = 0; index < iterations; index += 1) expandSheetTokens(text, context);
    const expandMs = ms(tExpand);
    expect(sheetIds.length).toBe(100);
    console.log('[19B perf] tokens', JSON.stringify({ contextMs, expandMs, iterations, perCallUs: (expandMs * 1000) / iterations }));
  }, 120_000);
});
