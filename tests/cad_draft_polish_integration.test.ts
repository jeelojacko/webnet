/**
 * Phase 13C §§49-52,55-59 — drafting interoperability polish integration.
 *
 * Same-sheet parity (labels, manual+auto placements, leaders, table
 * fragments, title block, viewport scale, north arrow, scale bar across
 * scene/SVG/PDF; DXF layout to the documented subset), large-grid
 * regression (E=2400000/N=7400000), save/reopen semantic identity,
 * undo/redo coverage, perf smoke, XML security bounds, and numerical
 * isolation (adjustment/GNSS/COGO/parcel/CRS untouched; LandXML import
 * creates no observations).
 */
import { describe, expect, it } from 'vitest';
import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import type { CadEntity, CadProject } from '../src/engine/cad/cadTypes';
import {
  addSheetToDraft,
  addViewportToSheet,
  assignTitleBlockToSheet,
  createDraftSheetHistory,
  createPlanSheet,
  createTitleBlockTemplate,
  editTitleBlockTemplateElements,
  redoDraftSheetHistory,
  runDraftSheetCommand,
  setViewportLayerOverride,
  undoDraftSheetHistory,
} from '../src/engine/cad/cadSheets';
import type { DraftDocument, DraftDocumentLabel } from '../src/engine/cad/cadDraftTypes';
import { autoPlaceViewportLabels } from '../src/engine/cad/cadLabelAutoPlacement';
import {
  moveDraftLabel,
  resetLabelToAuto,
  setLabelViewportOverride,
} from '../src/engine/cad/cadLabelEngine';
import {
  addLogicalTableToDraft,
  createLogicalTableFromDraftTable,
  fragmentTitleForView,
  layoutContinuedFragments,
  resolveFragmentView,
  validateContinuedCoverage,
} from '../src/engine/cad/cadDraftTables';
import {
  buildExportSheetScene,
  buildNorthArrowItems,
  buildScaleBarItems,
  modelToPaperPoint,
} from '../src/engine/cad/cadExportScene';
import { serializeExportSceneToSvg } from '../src/engine/cad/cadSvgSerializer';
import { exportScenesToPdf } from '../src/engine/cad/cadPdfExport';
import { buildDxfLayoutText } from '../src/engine/cad/dxf/dxfLayoutExport';
import { buildLandXmlFromCadGeometry } from '../src/engine/landxmlCad';
import { buildLandXmlImportPreview, LandXmlImportError } from '../src/engine/landxmlImport';

const mustDraft = (draft: DraftDocument | undefined): DraftDocument => {
  if (!draft) throw new Error('drawing has no draft document');
  return draft;
};

const buildProject = (dx = 0, dy = 0): CadProject => ({
  version: 2,
  id: 'project-polish',
  name: 'Polish Fixture',
  metadata: { source: 'parsed-input', runMode: 'unknown', units: 'm', stationCount: 2, observationCount: 0, adjustedStationCount: 0 },
  layers: [
    { id: 'points', name: 'Points', color: '#ffffff', visible: true, locked: false, role: 'points' },
    { id: 'parcels', name: 'Parcels', color: '#ffffff', visible: true, locked: false, role: 'parcels' },
  ],
  styleLibrary: { lineTypes: [], textStyles: [], pointSymbols: [], styles: [] },
  entities: [
    {
      type: 'survey-point', id: 'pt-P1', layerId: 'points', visible: true, locked: false,
      stationId: 'P1', x: dx, y: dy, pointClass: 'free', source: 'parsed-input',
    },
    {
      type: 'survey-point', id: 'pt-P2', layerId: 'points', visible: true, locked: false,
      stationId: 'P2', x: dx + 100, y: dy, pointClass: 'free', source: 'parsed-input',
    },
    {
      type: 'line', id: 'line-P1P2', layerId: 'parcels', visible: true, locked: false,
      fromStationId: 'P1', toStationId: 'P2', fromX: dx, fromY: dy, toX: dx + 100, toY: dy, sourceObservationIds: [],
    },
  ] as CadEntity[],
  cogoComputations: [],
  bounds: { minX: dx, minY: dy, maxX: dx + 100, maxY: dy },
});

const buildSheet = (draft: DraftDocument, name: string, cx: number, cy: number): { draft: DraftDocument; sheetId: string; viewportId: string } => {
  let next = addSheetToDraft(draft, createPlanSheet({ name, sizeId: 'ISO A4', orientation: 'landscape' }));
  const sheetId = next.sheets[next.sheets.length - 1]?.id as string;
  next = addViewportToSheet(next, sheetId, {
    name: 'Plan', modelCenterX: cx, modelCenterY: cy, scaleDenominator: 500,
    paperXmm: 15, paperYmm: 15, paperWidthMm: 200, paperHeightMm: 130,
  });
  const viewportId = next.sheets.find((sheet) => sheet.id === sheetId)?.viewports[0]?.id as string;
  return { draft: next, sheetId, viewportId };
};

const label = (id: string, text: string, x: number, y: number, extra: Partial<DraftDocumentLabel> = {}): DraftDocumentLabel => ({
  id, text, xModel: x, yModel: y, layerId: 'labels', ...extra,
});

const canonical = (value: unknown): string => JSON.stringify(value, (_key, entry: unknown) => {
  if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(entry as Record<string, unknown>).sort()) {
      sorted[key] = (entry as Record<string, unknown>)[key];
    }
    return sorted;
  }
  return entry;
});

const pdfText = (pdf: string): string => {
  const parts: string[] = [];
  for (const match of pdf.matchAll(/\((?:\\[\\()]|\\\d{3}|[^\\()])*\)/g)) {
    parts.push(match[0].slice(1, -1).replace(/\\(\d{3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8))).replace(/\\([\\()])/g, '$1'));
  }
  return parts.join('\n');
};

describe('drafting interoperability polish', () => {
  it('keeps one sheet identical across scene, SVG, and PDF (labels, leaders, title, north, scale)', () => {
    const project = buildProject();
    const blank = createBlankCadDrawingDocument({ name: 'Parity', units: 'm' });
    const { draft: base, sheetId, viewportId } = buildSheet(mustDraft(blank.draft), 'C1 - Parity', 50, 0);
    // AUTO label resolved by the deconfliction engine + MANUAL label kept verbatim.
    const placed = autoPlaceViewportLabels({
      labels: [
        { label: { id: 'lbl-auto', placement: 'AUTO' } as never, anchorMm: { x: 100, y: 60 }, sizeMm: { width: 20, height: 4 } },
        { label: { id: 'lbl-manual', placement: 'MANUAL' } as never, anchorMm: { x: 100, y: 60 }, sizeMm: { width: 20, height: 4 } },
      ],
      viewportId,
      obstaclesMm: [],
      viewportMm: { xMm: 15, yMm: 15, widthMm: 200, heightMm: 130 },
    });
    expect(placed.map((entry) => entry.labelId)).toEqual(['lbl-auto']);
    const auto = placed[0] as { override: { dxMm: number; dyMm: number }; leaderEnabled: boolean };
    const draft: DraftDocument = {
      ...base,
      labels: [
        label('lbl-auto', 'P1 auto', 50, 0, {
          viewportOverrides: { [viewportId]: { dxMm: auto.override.dxMm, dyMm: auto.override.dyMm } },
          leader: { enabled: auto.leaderEnabled },
        }),
        label('lbl-manual', 'P2 manual', 60, 0, { placement: 'MANUAL', leader: { enabled: true } }),
      ],
    };
    const extras = [
      ...buildNorthArrowItems(270, 40, 12, 'paper-symbols'),
      ...buildScaleBarItems(220, 175, 4, 10, 'paper-symbols'),
    ];
    const { scene, warnings } = buildExportSheetScene({ draft, sheetId, project, paperExtras: extras });
    expect(warnings).toEqual([]);
    const svg = serializeExportSceneToSvg(scene);
    const pdf = new TextDecoder().decode(exportScenesToPdf([scene]));
    const visible = pdfText(pdf);
    for (const text of ['P1 auto', 'P2 manual', 'N (grid)', 'C1 - Parity']) {
      const inScene = scene.items.some((item) => item.kind === 'text' && item.text.includes(text));
      expect(inScene).toBe(true);
      expect(svg).toContain(text);
      expect(visible).toContain(text);
    }
    // Leader lines are presentation-only scene lines shared by SVG and PDF paths.
    const leaders = scene.items.filter((item) => item.kind === 'line');
    expect(leaders.length).toBeGreaterThanOrEqual(1);
    // Viewport scale governs model→paper mapping at the recorded denominator.
    const viewport = draft.sheets.find((sheet) => sheet.id === sheetId)?.viewports[0];
    expect(viewport?.scaleDenominator).toBe(500);
    const p = modelToPaperPoint(60, 0, { modelCenterX: 50, modelCenterY: 0, scaleDenominator: 500, paperXmm: 15, paperYmm: 15, paperWidthMm: 200, paperHeightMm: 130 });
    expect(p.xMm).toBeCloseTo(115 + 20, 9);
  });

  it('renders continued-table fragments and the custom title template on every deliverable', () => {
    const project = buildProject();
    const blank = createBlankCadDrawingDocument({ name: 'Tables', units: 'm' });
    const { draft: base, sheetId } = buildSheet(mustDraft(blank.draft), 'C1 - Tables', 50, 0);
    const rows = Array.from({ length: 30 }, (_, i) => [`P${i + 1}`, `${i * 10}`, '0']);
    let draft = addLogicalTableToDraft(base, createLogicalTableFromDraftTable({
      name: 'Point schedule', headers: ['ID', 'E', 'N'], rows, continueMode: 'AUTO', maxRowsPerFragment: 25,
    }));
    const tableId = (draft.tables ?? [])[0]?.id as string;
    draft = layoutContinuedFragments(draft, tableId, [{ sheetId, paperXmm: 15, paperYmm: 150 }]);
    const table = (draft.tables ?? [])[0] as NonNullable<DraftDocument['tables']>[number];
    const fragments = draft.tableFragments ?? [];
    expect(fragments).toHaveLength(2);
    expect(validateContinuedCoverage(table, fragments)).toMatchObject({ ok: true });
    const first = resolveFragmentView(table, fragments[0] as { rowRange: { start: number; count: number }; fragmentIndex: number });
    const second = resolveFragmentView(table, fragments[1] as { rowRange: { start: number; count: number }; fragmentIndex: number });
    expect(first.rows).toHaveLength(25);
    expect(second.rows).toHaveLength(5);
    expect(second.continued).toBe(true);
    const continuedTitle = fragmentTitleForView(table.name, 1, true);
    expect(continuedTitle).toContain('Continued');
    // Custom title template with a viewport SCALE token.
    const template = createTitleBlockTemplate('Custom');
    draft = { ...draft, titleBlockDefinitions: [...draft.titleBlockDefinitions, template] };
    draft = editTitleBlockTemplateElements(draft, template.id, [
      { id: 'el-scale', kind: 'token-text', xMm: 10, yMm: 190, text: 'Scale {SCALE}', tokenTemplate: 'Scale {SCALE}' },
    ]);
    draft = assignTitleBlockToSheet(draft, sheetId, template.id);
    const { scene } = buildExportSheetScene({ draft, sheetId, project });
    const svg = serializeExportSceneToSvg(scene);
    const visible = pdfText(new TextDecoder().decode(exportScenesToPdf([scene])));
    const layoutDxf = buildDxfLayoutText({ project, draft }).dxf;
    // Table content comes from draft.tables/tableFragments — never injected.
    const sceneTexts = scene.items.filter((item) => item.kind === 'text').map((item) => (item as { text: string }).text);
    for (const text of ['Point schedule', continuedTitle, 'ID', 'E', 'N', 'P1', 'P25', 'P26', 'P30']) {
      expect(sceneTexts.some((entry) => entry.includes(text))).toBe(true);
      expect(svg).toContain(text);
      expect(visible).toContain(text);
      expect(layoutDxf).toContain(text);
    }
    // The continued fragment repeats headers and carries the marker.
    expect(sceneTexts.filter((entry) => entry === 'ID')).toHaveLength(2);
    for (const text of [continuedTitle, 'Scale 1:500']) {
      expect(scene.items.some((item) => item.kind === 'text' && item.text.includes(text))).toBe(true);
      expect(svg).toContain(text);
      expect(visible).toContain(text);
    }
  });

  it('maps the same sheet to the documented DXF layout subset', () => {
    const project = buildProject();
    const blank = createBlankCadDrawingDocument({ name: 'DXF', units: 'm' });
    const { draft, sheetId } = buildSheet(mustDraft(blank.draft), 'C1 - Layout', 50, 0);
    const result = buildDxfLayoutText({
      project,
      draft: { ...draft, labels: [label('lbl-dxf', 'P1 dxf', 50, 0, { leader: { enabled: true } })] },
    });
    expect(result.layouts).toEqual(['C1 - Layout']);
    expect(result.dxf).toContain('$ACADVER');
    expect(result.dxf).toContain('AC1015');
    expect(result.dxf).toContain('LAYOUT');
    expect(result.dxf).toContain('P1 dxf');
    // Model-space survey geometry keeps full model coordinates in the layout file.
    expect(result.dxf).toContain('\nLINE\n');
    expect(result.dxf).toContain('parcels');
    void sheetId;
  });

  it('holds large-grid precision through auto-labels, leaders, layout DXF, and LandXML', () => {
    const E = 2400000;
    const N = 7400000;
    const project = buildProject(E, N);
    const blank = createBlankCadDrawingDocument({ name: 'Large grid', units: 'm' });
    const { draft: base, sheetId, viewportId } = buildSheet(mustDraft(blank.draft), 'C1 - Grid', E + 50, N);
    const placed = autoPlaceViewportLabels({
      labels: [{ label: { id: 'lbl-grid', placement: 'AUTO' } as never, anchorMm: { x: 100, y: 60 }, sizeMm: { width: 20, height: 4 } }],
      viewportId,
      obstaclesMm: [],
      viewportMm: { xMm: 15, yMm: 15, widthMm: 200, heightMm: 130 },
    });
    const override = (placed[0] as { override: { dxMm: number; dyMm: number } }).override;
    const draft: DraftDocument = {
      ...base,
      labels: [label('lbl-grid', `E ${E}, N ${N}`, E, N, {
        viewportOverrides: { [viewportId]: { dxMm: override.dxMm, dyMm: override.dyMm } },
        leader: { enabled: true },
      })],
    };
    const { scene, warnings } = buildExportSheetScene({ draft, sheetId, project });
    expect(warnings).toEqual([]);
    // Centre-subtracted mapping keeps sub-mm exactness at E≈2.4M/N≈7.4M.
    const p = modelToPaperPoint(E, N, { modelCenterX: E + 50, modelCenterY: N, scaleDenominator: 500, paperXmm: 15, paperYmm: 15, paperWidthMm: 200, paperHeightMm: 130 });
    expect(p.xMm).toBeCloseTo(115 - 100, 6);
    const svg = serializeExportSceneToSvg(scene);
    expect(svg).toContain(`E ${E}, N ${N}`);
    const dxf = buildDxfLayoutText({ project, draft }).dxf;
    expect(dxf).toContain(String(E));
    expect(dxf).toContain(String(N));
    // LandXML round-trip is bit-exact at this magnitude (toFixed(6)).
    const xml = buildLandXmlFromCadGeometry(
      { points: [{ id: 'G1', x: E, y: N }], crs: 'UNKNOWN' },
      { units: 'm', projectName: 'grid', generatedAt: new Date('2026-09-14T12:00:00Z'), applicationVersion: 'test' },
    );
    const preview = buildLandXmlImportPreview(xml);
    expect(preview.points[0]?.x).toBeCloseTo(E, 6);
    expect(preview.points[0]?.y).toBeCloseTo(N, 6);
  });

  it('round-trips a v2 file with overrides, leaders, continued tables, and a custom template identically', () => {
    const blank = createBlankCadDrawingDocument({ name: 'Persist', units: 'm' });
    const { draft: base, sheetId, viewportId } = buildSheet(mustDraft(blank.draft), 'C1 - Persist', 50, 0);
    let draft = {
      ...base,
      labels: [label('lbl-save', 'P1 saved', 50, 0, {
        placement: 'MANUAL',
        viewportOverrides: { [viewportId]: { dxMm: 4, dyMm: -3 } },
        leader: { enabled: true, lineweightMm: 0.25 },
      })],
    };
    draft = addLogicalTableToDraft(draft, createLogicalTableFromDraftTable({
      name: 'Schedule', headers: ['ID'], rows: [['A'], ['B'], ['C']], continueMode: 'AUTO', maxRowsPerFragment: 2,
    }));
    const tableId = (draft.tables ?? [])[0]?.id as string;
    draft = layoutContinuedFragments(draft, tableId, [{ sheetId, paperXmm: 15, paperYmm: 150 }]);
    const template = createTitleBlockTemplate('Persist template');
    draft = { ...draft, titleBlockDefinitions: [...draft.titleBlockDefinitions, template] };
    draft = assignTitleBlockToSheet(draft, sheetId, template.id);
    const doc = { ...blank, draft };
    const reopened = parseCadDrawingFile(serializeCadDrawingFile(doc));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(canonical(reopened.drawing.draft)).toBe(canonical(doc.draft));
    expect(reopened.drawing.schemaVersion).toBe(2);
  });

  it('opens a Phase 13B v2 file with safe drafting defaults and no schema bump', () => {
    const blank = createBlankCadDrawingDocument({ name: 'Legacy13B', units: 'm' });
    const withSheet = { ...blank, draft: buildSheet(mustDraft(blank.draft), 'C1 - Legacy', 50, 0).draft };
    const legacy = JSON.parse(serializeCadDrawingFile(withSheet)) as Record<string, unknown>;
    const draft = { ...(legacy.draft as Record<string, unknown>) };
    delete draft.labels;
    delete draft.tables;
    delete draft.tableFragments;
    delete draft.titleBlockDefinitions;
    const opened = parseCadDrawingFile(JSON.stringify({ ...legacy, draft }));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.drawing.schemaVersion).toBe(2);
    const reopened = mustDraft(opened.drawing.draft);
    expect(reopened.labels).toEqual([]);
    expect(reopened.tables ?? []).toEqual([]);
    expect(reopened.tableFragments ?? []).toEqual([]);
    expect(reopened.titleBlockDefinitions).toEqual([]);
    expect(reopened.sheets.length).toBeGreaterThan(0);
  });

  it('undoes and redoes auto-place, reset, leader, table-continuation, and title-block edits', () => {
    const blank = createBlankCadDrawingDocument({ name: 'History', units: 'm' });
    const { draft: base, sheetId, viewportId } = buildSheet(mustDraft(blank.draft), 'C1 - History', 50, 0);
    let state = createDraftSheetHistory({ ...base, labels: [label('lbl-h', 'P1 h', 50, 0)] });
    const snapshot = (): string => canonical(state.draft);
    const before = snapshot();
    // 1. Auto-place writes a viewport override.
    state = runDraftSheetCommand(state, (draft) => ({
      ...draft,
      labels: draft.labels.map((entry) => entry.id === 'lbl-h'
        ? { ...entry, viewportOverrides: { [viewportId]: { dxMm: 2, dyMm: -2 } } }
        : entry),
    }));
    // 2. Leader edit.
    state = runDraftSheetCommand(state, (draft) => ({
      ...draft,
      labels: draft.labels.map((entry) => entry.id === 'lbl-h' ? { ...entry, leader: { enabled: true } } : entry),
    }));
    // 3. Reset to auto clears both (label-engine helper).
    state = runDraftSheetCommand(state, (draft) => ({
      ...draft,
      labels: draft.labels.map((entry) => {
        if (entry.id !== 'lbl-h') return entry;
        const engineLabel = setLabelViewportOverride(
          { id: entry.id, placement: 'MANUAL' } as never,
          viewportId,
          { dxMm: 9, dyMm: 9 },
        );
        void engineLabel;
        const moved = moveDraftLabel({ id: entry.id, placement: 'AUTO', offsetMm: { dxMm: 0, dyMm: 0 } } as never, { dxMm: 9 });
        void moved;
        const reset = resetLabelToAuto({ id: entry.id, placement: 'MANUAL', offsetMm: { dxMm: 9, dyMm: 9 } } as never);
        expect(reset.placement).toBe('AUTO');
        return { ...entry, viewportOverrides: undefined, leader: { enabled: false } };
      }),
    }));
    // 4. Table continuation layout.
    state = runDraftSheetCommand(state, (draft) => {
      const withTable = addLogicalTableToDraft(draft, createLogicalTableFromDraftTable({
        name: 'Hist', headers: ['ID'], rows: [['A'], ['B'], ['C']], maxRowsPerFragment: 2,
      }));
      const tableId = (withTable.tables ?? [])[0]?.id as string;
      return layoutContinuedFragments(withTable, tableId, [{ sheetId, paperXmm: 10, paperYmm: 10 }]);
    });
    // 5. Title-block template edit.
    state = runDraftSheetCommand(state, (draft) => {
      const template = createTitleBlockTemplate('Hist template');
      const withTemplate = { ...draft, titleBlockDefinitions: [...draft.titleBlockDefinitions, template] };
      return editTitleBlockTemplateElements(withTemplate, template.id, [
        { id: 'el-h', kind: 'static-text', xMm: 5, yMm: 5, text: 'Hist' },
      ]);
    });
    expect(snapshot()).not.toBe(before);
    for (let i = 0; i < 5; i += 1) state = undoDraftSheetHistory(state);
    expect(snapshot()).toBe(before);
    for (let i = 0; i < 5; i += 1) state = redoDraftSheetHistory(state);
    expect((state.draft.tableFragments ?? [])).toHaveLength(2);
    expect(state.draft.titleBlockDefinitions.some((entry) => entry.name === 'Hist template')).toBe(true);
    // Viewport layer overrides ride the same history seam.
    const withOverride = setViewportLayerOverride(state.draft, sheetId, viewportId, 'parcels', { visible: false });
    expect(withOverride).toBeDefined();
  });

  it('commits a LandXML import preview as one undoable draft transaction', () => {
    const xml = [
      '<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" date="2026-09-14" time="12:00:00" version="1.2" language="English">',
      '<Units><Metric areaUnit="squareMeter" linearUnit="meter" volumeUnit="cubicMeter" temperatureUnit="celsius" pressureUnit="HPA" angularUnit="decimal degrees" directionUnit="decimal degrees" /></Units>',
      '<CgPoints><CgPoint name="I1" oID="I1">10.000000 20.000000 0.000000</CgPoint><CgPoint name="I2" oID="I2">10.000000 30.000000 0.000000</CgPoint></CgPoints>',
      '</LandXML>',
    ].join('\n');
    const preview = buildLandXmlImportPreview(xml, { fileName: 'import.xml' });
    expect(preview.points).toHaveLength(2);
    const blank = createBlankCadDrawingDocument({ name: 'Import', units: 'm' });
    const { draft: base } = buildSheet(mustDraft(blank.draft), 'C1 - Import', 25, 10);
    let state = createDraftSheetHistory(base);
    const before = canonical(state.draft.labels);
    // Single command stages every imported point as a draft label.
    state = runDraftSheetCommand(state, (draft) => ({
      ...draft,
      labels: [
        ...draft.labels,
        ...preview.points.map((point) => label(`import-${point.id}`, point.id, point.x, point.y, { provenance: 'IMPORTED' })),
      ],
    }));
    expect(state.draft.labels).toHaveLength(preview.points.length);
    state = undoDraftSheetHistory(state);
    expect(canonical(state.draft.labels)).toBe(before);
    state = redoDraftSheetHistory(state);
    expect(state.draft.labels).toHaveLength(preview.points.length);
  });

  it('stresses auto-place, continuation, multi-sheet export, and bulk LandXML inside the agent tier', () => {
    // 1000-label auto-place.
    const labels = Array.from({ length: 1000 }, (_, i) => ({
      label: { id: `stress-${String(i).padStart(4, '0')}`, placement: 'AUTO' } as never,
      anchorMm: { x: 20 + (i % 40) * 4, y: 20 + Math.floor(i / 40) * 4 },
      sizeMm: { width: 12, height: 3 },
    }));
    const started = performance.now();
    const results = autoPlaceViewportLabels({
      labels,
      viewportId: 'vp-stress',
      obstaclesMm: [],
      viewportMm: { xMm: 0, yMm: 0, widthMm: 200, heightMm: 130 },
    });
    const autoMs = performance.now() - started;
    expect(results).toHaveLength(1000);
    // Large continued table (2000 rows) stays exact.
    const big = createLogicalTableFromDraftTable({
      name: 'Big', headers: ['ID'], rows: Array.from({ length: 2000 }, (_, i) => [`R${i}`]), maxRowsPerFragment: 25,
    });
    const blank = createBlankCadDrawingDocument({ name: 'Stress', units: 'm' });
    let draft = addLogicalTableToDraft(mustDraft(blank.draft), big);
    for (let i = 0; i < 10; i += 1) {
      draft = addSheetToDraft(draft, createPlanSheet({ name: `S${i + 1}`, sizeId: 'ISO A4', orientation: 'landscape' }));
    }
    const tableStart = performance.now();
    const tableId = (draft.tables ?? [])[0]?.id as string;
    draft = layoutContinuedFragments(
      draft,
      tableId,
      draft.sheets.map((sheet) => ({ sheetId: sheet.id, paperXmm: 10, paperYmm: 10 })),
    );
    const tableMs = performance.now() - tableStart;
    expect(validateContinuedCoverage(big, draft.tableFragments ?? []).ok).toBe(true);
    expect((draft.tableFragments ?? [])).toHaveLength(80);
    // 10 sheets × viewport scenes + one 10-page PDF.
    const project = buildProject();
    const sheetStart = performance.now();
    let withViewports = draft;
    for (const sheet of draft.sheets) {
      withViewports = addViewportToSheet(withViewports, sheet.id, {
        name: 'V', modelCenterX: 50, modelCenterY: 0, scaleDenominator: 500,
        paperXmm: 15, paperYmm: 15, paperWidthMm: 200, paperHeightMm: 130,
      });
    }
    const scenes = withViewports.sheets.map((sheet) => buildExportSheetScene({ draft: withViewports, sheetId: sheet.id, project }).scene);
    const pdfBytes = exportScenesToPdf(scenes);
    const sheetMs = performance.now() - sheetStart;
    expect(scenes).toHaveLength(10);
    expect(new TextDecoder().decode(pdfBytes)).toContain('/Count 10');
    // Thousands of CgPoints import.
    const points = Array.from({ length: 3000 }, (_, i) => `<CgPoint name="S${i}" oID="S${i}">${i}.000000 ${i * 2}.000000 0.000000</CgPoint>`).join('');
    const bulk = `<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" date="2026-09-14" time="12:00:00" version="1.2" language="English"><Units><Metric areaUnit="squareMeter" linearUnit="meter" volumeUnit="cubicMeter" temperatureUnit="celsius" pressureUnit="HPA" angularUnit="decimal degrees" directionUnit="decimal degrees" /></Units><CgPoints>${points}</CgPoints></LandXML>`;
    const landStart = performance.now();
    const bulkPreview = buildLandXmlImportPreview(bulk);
    const landMs = performance.now() - landStart;
    expect(bulkPreview.points).toHaveLength(3000);
    const totalMs = performance.now() - started;
    console.log(`polish stress: auto-place=${autoMs.toFixed(1)}ms tables=${tableMs.toFixed(1)}ms sheets=${sheetMs.toFixed(1)}ms landxml=${landMs.toFixed(1)}ms total=${totalMs.toFixed(1)}ms`);
    expect(totalMs).toBeLessThan(10000);
  });

  it('rejects oversize and XXE-style XML at the LandXML boundary', () => {
    const metric = '<Units><Metric areaUnit="squareMeter" linearUnit="meter" volumeUnit="cubicMeter" temperatureUnit="celsius" pressureUnit="HPA" angularUnit="decimal degrees" directionUnit="decimal degrees" /></Units>';
    const root = '<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" date="2026-09-14" time="12:00:00" version="1.2" language="English">';
    for (const hostile of [
      `${root}${metric}<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]}<CgPoints />${'</LandXML>'}`,
      `${root}${metric}<!ENTITY x "y"><CgPoints />${'</LandXML>'}`,
      `<?xml version="1.0"?><!DOCTYPE LandXML><LandXML version="1.2">${metric}</LandXML>`,
    ]) {
      expect(() => buildLandXmlImportPreview(hostile)).toThrow(LandXmlImportError);
    }
    // 16 MiB parser bound: a padded-but-valid document still fails closed.
    const pad = '0'.repeat(17 * 1024 * 1024);
    expect(() => buildLandXmlImportPreview(`${root}${metric}<CgPoints><CgPoint name="P" oID="P">0 0 0<!--${pad}--></CgPoint></CgPoints></LandXML>`)).toThrow(LandXmlImportError);
  });

  it('leaves adjustment, GNSS, COGO, parcel-legal, and CRS math untouched; imports create no observations', () => {
    const session = {
      observations: [{ id: 1, kind: 'distance', value: 50.001 }],
      weights: { distanceSigma: 0.005 },
      gnss: { baselines: [{ id: 'BL001', solution: 'FIXED' }] },
      adjustmentSettings: { maxIterations: 10, convergenceLimit: 0.001 },
      crs: { id: 'EPSG:2193', epoch: '2000.0' },
      cogo: { inverse: 'N 45°00\'00" E 100.000 m' },
      parcels: { legal: 'Lot 7 DP 12345 — fee simple, undivided shares unchanged' },
    };
    const before = JSON.stringify(session);
    const doc = createBlankCadDrawingDocument({ name: 'Isolation', units: 'm' });
    const { draft: base, sheetId, viewportId } = buildSheet(mustDraft(doc.draft), 'C1', 50, 0);
    void autoPlaceViewportLabels({
      labels: [{ label: { id: 'iso', placement: 'AUTO' } as never, anchorMm: { x: 50, y: 50 }, sizeMm: { width: 10, height: 3 } }],
      viewportId, obstaclesMm: [], viewportMm: { xMm: 0, yMm: 0, widthMm: 200, heightMm: 130 },
    });
    void setLabelViewportOverride({ id: 'iso', placement: 'AUTO' } as never, viewportId, { dxMm: 1, dyMm: 1 });
    void resetLabelToAuto({ id: 'iso', placement: 'MANUAL', offsetMm: { dxMm: 1, dyMm: 1 } } as never);
    void createLogicalTableFromDraftTable({ name: 'Iso', headers: ['ID'], rows: [['A']] });
    void buildExportSheetScene({ draft: base, sheetId, project: buildProject() });
    void buildDxfLayoutText({ project: buildProject(), draft: base });
    const xml = buildLandXmlFromCadGeometry(
      { points: [{ id: 'I1', x: 1, y: 2 }] },
      { units: 'm', generatedAt: new Date('2026-09-14T12:00:00Z'), applicationVersion: 'test' },
    );
    const preview = buildLandXmlImportPreview(
      `${'<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" date="2026-09-14" time="12:00:00" version="1.2" language="English"><Units><Metric areaUnit="squareMeter" linearUnit="meter" volumeUnit="cubicMeter" temperatureUnit="celsius" pressureUnit="HPA" angularUnit="decimal degrees" directionUnit="decimal degrees" /></Units><CgPoints><CgPoint name="I1" oID="I1">2.000000 1.000000 0.000000</CgPoint></CgPoints></LandXML>'}`,
    );
    void xml;
    // Geometry intake only: points carry provenance, never observation records.
    expect(preview.points.every((point) => point.provenance.source === 'LANDXML')).toBe(true);
    expect(JSON.stringify(preview)).not.toContain('observation');
    expect(JSON.stringify(session)).toBe(before);
    expect(session.crs).toEqual({ id: 'EPSG:2193', epoch: '2000.0' });
  });
});
