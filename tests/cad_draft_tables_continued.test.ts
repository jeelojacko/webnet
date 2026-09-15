import { describe, expect, it } from 'vitest';
import {
  addSheetToDraft,
  assignTitleBlockToSheet,
  buildSheetTokenContext,
  createDraftSheetHistory,
  createPlanSheet,
  createTitleBlockTemplate,
  deleteTitleBlockTemplateIfUnused,
  duplicateTitleBlockTemplate,
  editTitleBlockTemplateElements,
  redoDraftSheetHistory,
  renameTitleBlockTemplate,
  runDraftSheetCommand,
  undoDraftSheetHistory,
} from '../src/engine/cad/cadSheets';
import {
  addLogicalTableToDraft,
  CONTINUED_REPEAT_CASCADE_MM,
  continuedRangesForTable,
  createLogicalTableFromDraftTable,
  fragmentTitleForView,
  layoutContinuedFragments,
  moveTableFragmentInDraft,
  resolveFragmentView,
  updateLogicalTableRowsInDraft,
  validateContinuedCoverage,
  buildDraftPointTable,
} from '../src/engine/cad/cadDraftTables';
import { buildTitleBlockItems, buildExportSheetScene } from '../src/engine/cad/cadExportScene';
import { createBlankDraftDocument, sanitizeDraftDocument } from '../src/engine/cad/cadDraftTypes';
import type { CadProject } from '../src/engine/cad/cadTypes';

const project: CadProject = {
  version: 2,
  id: 'p-continued',
  name: 'Continued Plan',
  metadata: { source: 'parsed-input', runMode: 'unknown', units: 'm', stationCount: 0, observationCount: 0, adjustedStationCount: 0 },
  layers: [{ id: 'points', name: 'Points', color: '#ffffff', visible: true, locked: false, role: 'points' }],
  styleLibrary: { lineTypes: [], textStyles: [], pointSymbols: [], styles: [] },
  entities: [],
  cogoComputations: [],
  bounds: null,
};

const rows = (n: number): string[][] => Array.from({ length: n }, (_, i) => [`P${i}`, `${i}`, `${i}`]);

describe('continued tables', () => {
  it('AUTO overflow slices into deterministic fragments with repeated headers and Continued markers', () => {
    let draft = createBlankDraftDocument({ projectId: 'p' });
    draft = addSheetToDraft(draft, createPlanSheet({ name: 'S1' }));
    draft = addSheetToDraft(draft, createPlanSheet({ name: 'S2' }));
    const source = buildDraftPointTable(
      Array.from({ length: 7 }, (_, i) => ({ pointId: `P${i}`, northing: i, easting: i })),
      { order: 'pointId' },
    );
    const table = createLogicalTableFromDraftTable({
      name: 'Points', headers: source.headers, rows: source.rows, maxRowsPerFragment: 3,
    });
    // Columns/format/order preserved from the source table.
    expect(table.headers).toEqual(source.headers);
    expect(table.rows).toEqual(source.rows);
    draft = addLogicalTableToDraft(draft, table);
    draft = layoutContinuedFragments(draft, table.id, draft.sheets.map((s) => ({ sheetId: s.id, paperXmm: 10, paperYmm: 20 })));
    const fragments = draft.tableFragments.filter((f) => f.logicalTableId === table.id);
    expect(fragments.map((f) => f.rowRange)).toEqual([
      { start: 0, count: 3 }, { start: 3, count: 3 }, { start: 6, count: 1 },
    ]);
    expect(continuedRangesForTable(table)).toEqual(fragments.map((f) => f.rowRange));
    // Multi-sheet: third fragment lands on the second sheet placement set.
    expect(fragments.map((f) => f.sheetId)).toEqual([draft.sheets[0]?.id, draft.sheets[1]?.id, draft.sheets[0]?.id]);
    const views = fragments.map((f) => resolveFragmentView(table, f));
    expect(views.every((v) => v.headers.length === source.headers.length)).toBe(true); // header repeat
    expect(views.map((v) => v.continued)).toEqual([false, true, true]);
    expect(fragmentTitleForView('Points', 1, true)).toBe('Points (Continued 2)');
    expect(validateContinuedCoverage(table, fragments)).toEqual({ ok: true, missing: [], duplicated: [] });
    // No missing/duplicated rows across the concatenation.
    expect(views.flatMap((v) => v.rows)).toEqual(table.rows);
  });

  it('source change recomputes all AUTO ranges; manual fragment moves never corrupt source', () => {
    let draft = createBlankDraftDocument({ projectId: 'p' });
    draft = addSheetToDraft(draft, createPlanSheet({ name: 'S' }));
    const table = createLogicalTableFromDraftTable({ name: 'T', headers: ['A'], rows: rows(5), maxRowsPerFragment: 2 });
    draft = addLogicalTableToDraft(draft, table);
    draft = layoutContinuedFragments(draft, table.id, [{ sheetId: draft.sheets[0]?.id as string, paperXmm: 10, paperYmm: 10 }]);
    const firstId = draft.tableFragments[0]?.id as string;
    draft = moveTableFragmentInDraft(draft, firstId, { xMm: 42, yMm: 43 });
    expect(draft.tableFragments[0]?.paperXmm).toBe(42);
    expect(draft.tables[0]?.rows).toHaveLength(5); // source untouched
    draft = updateLogicalTableRowsInDraft(draft, table.id, rows(3));
    const fragments = draft.tableFragments.filter((f) => f.logicalTableId === table.id);
    expect(fragments.map((f) => f.rowRange)).toEqual([{ start: 0, count: 2 }, { start: 2, count: 1 }]);
    const next = draft.tables.find((t) => t.id === table.id)!;
    expect(validateContinuedCoverage(next, fragments).ok).toBe(true);
  });

  it('layout is deterministic across repeated runs', () => {
    const table = createLogicalTableFromDraftTable({ name: 'T', headers: ['A'], rows: rows(10), maxRowsPerFragment: 4 });
    const a = continuedRangesForTable(table);
    const b = continuedRangesForTable({ ...table, rows: rows(10) });
    expect(a).toEqual(b);
    expect(a).toEqual([{ start: 0, count: 4 }, { start: 4, count: 4 }, { start: 8, count: 2 }]);
  });

  it('MANUAL mode creates only the first fragment', () => {
    let draft = createBlankDraftDocument({ projectId: 'p' });
    draft = addSheetToDraft(draft, createPlanSheet({ name: 'S' }));
    const table = createLogicalTableFromDraftTable({ name: 'T', headers: ['A'], rows: rows(9), maxRowsPerFragment: 4, continueMode: 'MANUAL' });
    draft = addLogicalTableToDraft(draft, table);
    draft = layoutContinuedFragments(draft, table.id, [{ sheetId: draft.sheets[0]?.id as string, paperXmm: 10, paperYmm: 10 }]);
    expect(draft.tableFragments.filter((f) => f.logicalTableId === table.id)).toHaveLength(1);
  });
});

describe('title-block templates', () => {
  it('manages templates with stable ids and delete-if-unused guard', () => {
    let draft = addSheetToDraft(createBlankDraftDocument({ projectId: 'p' }), createPlanSheet({ name: 'S' }));
    const created = createTitleBlockTemplate('A');
    draft = { ...draft, titleBlockDefinitions: [created] };
    draft = duplicateTitleBlockTemplate(draft, created.id);
    expect(draft.titleBlockDefinitions).toHaveLength(2);
    expect(draft.titleBlockDefinitions[1]?.id).not.toBe(created.id);
    const copyId = draft.titleBlockDefinitions[1]?.id as string;
    draft = renameTitleBlockTemplate(draft, copyId, 'B');
    expect(draft.titleBlockDefinitions[1]?.name).toBe('B');
    const sheetId = draft.sheets[0]?.id as string;
    draft = assignTitleBlockToSheet(draft, sheetId, copyId);
    expect(draft.sheets[0]?.titleBlockId).toBe(copyId);
    expect(deleteTitleBlockTemplateIfUnused(draft, copyId).deleted).toBe(false);
    expect(deleteTitleBlockTemplateIfUnused(draft, created.id).deleted).toBe(true);
  });

  it('renders identically in scene and item numerics (paper-mm)', () => {
    let draft = addSheetToDraft(createBlankDraftDocument({ projectId: 'p' }), createPlanSheet({ name: 'S' }));
    const sheetId = draft.sheets[0]?.id as string;
    let template = createTitleBlockTemplate('T');
    template = {
      ...template,
      elements: [
        { id: 'e-rect', kind: 'rect', xMm: 10, yMm: 180, widthMm: 100, heightMm: 14 },
        { id: 'e-line', kind: 'line', xMm: 10, yMm: 180, x2Mm: 110, y2Mm: 180, lineweightMm: 0.5 },
        { id: 'e-text', kind: 'token-text', xMm: 12, yMm: 188, tokenTemplate: '{PROJECT_NAME} {SHEET_NAME} 1:{SCALE}', alignment: 'left', fontSizeMm: 3.5 },
      ],
    };
    draft = { ...draft, titleBlockDefinitions: [template] };
    draft = assignTitleBlockToSheet(draft, sheetId, template.id);
    const context = buildSheetTokenContext({ sheet: draft.sheets[0]!, sheetNumber: 1, projectName: project.name });
    const direct = buildTitleBlockItems(draft.sheets[0]!, 'title-block', template, context);
    const { scene } = buildExportSheetScene({ draft, sheetId, project });
    const titleItems = scene.items.filter((item) => item.layer === 'title-block');
    // Scene items carry the backfilled layer color; direct builder items do not.
    expect(titleItems).toEqual(direct.items.map((item) => ({ ...item, stroke: '#94a3b8' })));
    const text = titleItems.find((item) => item.kind === 'text');
    expect(text).toMatchObject({ x: 12, y: 188, heightMm: 3.5 });
    expect(direct.unknownTokens).toEqual([]);
    // Element edit helper preserves paper-mm numerics additively.
    draft = editTitleBlockTemplateElements(draft, template.id, [{ id: 'e-rect', kind: 'rect', xMm: 11, yMm: 181, widthMm: 90, heightMm: 12 }]);
    expect(draft.titleBlockDefinitions[0]?.elements?.[0]).toMatchObject({ xMm: 11, widthMm: 90 });
  });
});

describe('history and persistence', () => {
  it('table and template ops participate in undo/redo and survive save/reopen', () => {
    const history = createDraftSheetHistory(createBlankDraftDocument({ projectId: 'p' }));
    const table = createLogicalTableFromDraftTable({ name: 'T', headers: ['A'], rows: rows(4), maxRowsPerFragment: 2 });
    const added = runDraftSheetCommand(history, (draft) => {
      let next = addSheetToDraft(draft, createPlanSheet({ name: 'S' }));
      next = addLogicalTableToDraft(next, table);
      return layoutContinuedFragments(next, table.id, [{ sheetId: next.sheets[0]?.id as string, paperXmm: 10, paperYmm: 10 }]);
    });
    expect(added.draft.tableFragments).toHaveLength(2);
    expect(undoDraftSheetHistory(added).draft.tableFragments).toHaveLength(0);
    expect(redoDraftSheetHistory(undoDraftSheetHistory(added)).draft.tableFragments).toHaveLength(2);
    const revived = sanitizeDraftDocument(JSON.parse(JSON.stringify(added.draft)), 'p', []);
    expect(revived?.tables[0]?.id).toBe(table.id);
    expect(revived?.tableFragments.map((f) => f.id)).toEqual(added.draft.tableFragments.map((f) => f.id));
    const twice = sanitizeDraftDocument(JSON.parse(JSON.stringify(revived)), 'p', []);
    expect(twice?.tables[0]?.rows).toEqual(table.rows);
  });
});

describe('continued fragment repeat cascade', () => {
  it('cascades repeated fragments deterministically instead of stacking them (30 rows, 1 placement)', () => {
    let draft = createBlankDraftDocument({ projectId: 'p' });
    draft = addSheetToDraft(draft, createPlanSheet({ name: 'S1' }));
    const source = buildDraftPointTable(
      Array.from({ length: 30 }, (_, i) => ({ pointId: `P${i}`, northing: i, easting: i })),
      { order: 'pointId' },
    );
    const table = createLogicalTableFromDraftTable({
      name: 'Points', headers: source.headers, rows: source.rows, maxRowsPerFragment: 25,
    });
    draft = addLogicalTableToDraft(draft, table);
    const sheetId = draft.sheets[0]?.id as string;
    draft = layoutContinuedFragments(draft, table.id, [{ sheetId, paperXmm: 10, paperYmm: 20 }]);
    const fragments = draft.tableFragments.filter((f) => f.logicalTableId === table.id);
    expect(fragments).toHaveLength(2);
    // Same sheet, but origins never coincide: the repeat cascades in paper-mm.
    const origins = fragments.map((f) => `${f.sheetId}@${f.paperXmm},${f.paperYmm}`);
    expect(new Set(origins).size).toBe(fragments.length);
    expect(fragments[1]).toMatchObject({
      paperXmm: 10 + CONTINUED_REPEAT_CASCADE_MM,
      paperYmm: 20 + CONTINUED_REPEAT_CASCADE_MM,
    });
    expect(validateContinuedCoverage(table, fragments)).toEqual({ ok: true, missing: [], duplicated: [] });
  });
});
