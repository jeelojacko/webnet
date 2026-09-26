import { describe, expect, it } from 'vitest';
import {
  addSheetToDraft,
  addViewportToSheet,
  buildScaleBar,
  buildSheetTokenContext,
  clearSheetTitleBlockField,
  createDraftSheetHistory,
  createPlanSheet,
  createSheetFromTemplate,
  deleteSheetCommand,
  duplicateSheetCommand,
  duplicateSheetInDraft,
  modelToPaperMm,
  redoDraftSheetHistory,
  renameSheetCommand,
  reorderSheetsCommand,
  runDraftSheetCommand,
  scaleBarDivisionPaperMm,
  scaleBarTotalPaperMm,
  setSheetTitleBlockField,
  undoDraftSheetHistory,
} from '../src/engine/cad/cadSheets';
import {
  cloneDraftDocument,
  createBlankDraftDocument,
  sanitizeDraftDocument,
} from '../src/engine/cad/cadDraftTypes';

const roundTrip = (draft: ReturnType<typeof createBlankDraftDocument>) =>
  sanitizeDraftDocument(JSON.parse(JSON.stringify(draft)), 'p1', []);

describe('19b sheet layout engine', () => {
  it('defaults viewports to unlocked with a non-plotting frame, round-tripping both flags', () => {
    let draft = addSheetToDraft(createBlankDraftDocument({ projectId: 'p1' }), createPlanSheet({ name: 'S' }));
    const sheetId = draft.sheets[0]?.id as string;
    draft = addViewportToSheet(draft, sheetId, { modelCenterX: 0, modelCenterY: 0 });
    const viewportId = draft.sheets[0]?.viewports[0]?.id as string;

    // Defaults: absent means unlocked / frame does not plot.
    let revived = roundTrip(draft);
    expect(revived?.sheets[0]?.viewports[0]?.locked).toBeUndefined();
    expect(revived?.sheets[0]?.viewports[0]?.plotFrame).toBeUndefined();

    // Legacy documents without the flags sanitize safely.
    const legacy = sanitizeDraftDocument({ sheets: [{ viewports: [{}] }] }, 'p1', []);
    expect(legacy?.sheets[0]?.viewports[0]?.locked).toBeUndefined();
    expect(legacy?.sheets[0]?.viewports[0]?.plotFrame).toBeUndefined();

    // Explicit flags survive clone + sanitize round-trips.
    draft = {
      ...draft,
      sheets: draft.sheets.map((sheet) => ({
        ...sheet,
        viewports: sheet.viewports.map((entry) =>
          entry.id === viewportId ? { ...entry, locked: true, plotFrame: true } : entry,
        ),
      })),
    };
    revived = roundTrip(cloneDraftDocument(draft));
    expect(revived?.sheets[0]?.viewports[0]?.locked).toBe(true);
    expect(revived?.sheets[0]?.viewports[0]?.plotFrame).toBe(true);
  });

  it('creates sheets from templates with snapshot isolation and fresh stable ids', () => {
    const blank = createBlankDraftDocument({ projectId: 'p1' });
    expect(blank.templates).toHaveLength(3);
    expect(blank.templates?.map((entry) => entry.name)).toEqual(['Blank', 'Single Viewport', 'Survey Plan']);

    const templateId = blank.templates?.[1]?.id as string;
    const created = createSheetFromTemplate(blank, templateId, 'Plan');
    expect(created).toBeDefined();
    const sheet = created?.sheets[0];
    expect(sheet?.name).toBe('Plan');
    expect(sheet?.viewports).toHaveLength(1);
    expect(sheet?.viewports[0]?.scaleDenominator).toBe(500);
    // North-arrow + scale-bar placements materialize as first-class objects.
    expect(sheet?.sheetObjects.map((object) => object.kind).sort()).toEqual(['north-arrow', 'scale-bar']);
    const bar = sheet?.sheetObjects.find((object) => object.kind === 'scale-bar');
    expect(bar?.divisions).toBe(4);
    expect(bar?.viewportId).toBe(sheet?.viewports[0]?.id);

    // Snapshot semantics: mutating the sheet never touches the template.
    const mutated: typeof blank = {
      ...created!,
      sheets: created!.sheets.map((entry) => ({
        ...entry,
        viewports: entry.viewports.map((viewport) => ({ ...viewport, scaleDenominator: 1000 })),
      })),
    };
    expect(mutated.sheets[0]?.viewports[0]?.scaleDenominator).toBe(1000);
    expect(blank.templates?.[1]?.viewportLayouts[0]?.scaleDenominator).toBe(500);
    expect(mutated.templates?.[1]?.id).toBe(templateId);

    // Fresh stable ids: nothing shared with template recipe ids.
    expect(sheet?.id).not.toBe(templateId);
    expect(sheet?.sheetObjects.every((object) => object.id.length > 0)).toBe(true);

    // Unknown template id fails closed.
    expect(createSheetFromTemplate(blank, 'missing-template', 'X')).toBeUndefined();

    // Existing drafts without templates are never backfilled on sanitize.
    const noTemplates = sanitizeDraftDocument({ sheets: [] }, 'p1', []);
    expect(noTemplates?.templates).toBeUndefined();
  });

  it('duplicates sheets with new ids for sheet, viewports, and objects', () => {
    let draft = addSheetToDraft(createBlankDraftDocument({ projectId: 'p1' }), createPlanSheet({ name: 'S' }));
    const sheetId = draft.sheets[0]?.id as string;
    draft = addViewportToSheet(draft, sheetId, { modelCenterX: 7, modelCenterY: 8 });
    draft = setSheetTitleBlockField(draft, sheetId, 'DRAWN_BY', 'Ada');
    draft = duplicateSheetInDraft(draft, sheetId);

    expect(draft.sheets).toHaveLength(2);
    const [original, copy] = draft.sheets;
    expect(copy?.id).not.toBe(original?.id);
    expect(copy?.viewports[0]?.id).not.toBe(original?.viewports[0]?.id);
    // Model references stay references: same survey centre values.
    expect(copy?.viewports[0]?.modelCenterX).toBe(7);
    expect(copy?.viewports[0]?.modelCenterY).toBe(8);
    // Instance values are copied by value, not aliased.
    expect(copy?.titleBlockFields).toEqual({ DRAWN_BY: 'Ada' });
    const relabelled = setSheetTitleBlockField(draft, copy?.id as string, 'DRAWN_BY', 'Bob');
    expect(relabelled.sheets[0]?.titleBlockFields?.DRAWN_BY).toBe('Ada');
    expect(clearSheetTitleBlockField(relabelled, copy?.id as string, 'DRAWN_BY').sheets[1]?.titleBlockFields).toBeUndefined();
  });

  it('prefers per-sheet title-block fields over globals, then empty string', () => {
    let draft = addSheetToDraft(createBlankDraftDocument({ projectId: 'p1' }), createPlanSheet({ name: 'S' }));
    const sheetId = draft.sheets[0]?.id as string;
    const sheet = () => draft.sheets[0] as { name: string; viewports: { scaleDenominator: number }[] };

    // Global only.
    expect(
      buildSheetTokenContext({ sheet: sheet(), sheetNumber: 1, drawnBy: 'Global' }).DRAWN_BY,
    ).toBe('Global');
    // Sheet instance wins.
    draft = setSheetTitleBlockField(draft, sheetId, 'DRAWN_BY', 'Sheet');
    expect(
      buildSheetTokenContext({
        sheet: draft.sheets[0] as { name: string; viewports: { scaleDenominator: number }[]; titleBlockFields?: Record<string, string> },
        sheetNumber: 1,
        drawnBy: 'Global',
      }).DRAWN_BY,
    ).toBe('Sheet');
    // Neither: empty string.
    expect(buildSheetTokenContext({ sheet: sheet(), sheetNumber: 1 }).CLIENT).toBe('');
    // Instance values survive a persistence round-trip.
    expect(roundTrip(draft)?.sheets[0]?.titleBlockFields).toEqual({ DRAWN_BY: 'Sheet' });
  });

  it('keeps the SCALE token in list form for multi-viewport sheets', () => {
    let draft = addSheetToDraft(createBlankDraftDocument({ projectId: 'p1' }), createPlanSheet({ name: 'S' }));
    const sheetId = draft.sheets[0]?.id as string;
    draft = addViewportToSheet(draft, sheetId, { modelCenterX: 0, modelCenterY: 0, scaleDenominator: 500 });
    draft = addViewportToSheet(draft, sheetId, { modelCenterX: 1, modelCenterY: 1, scaleDenominator: 1000 });
    const context = buildSheetTokenContext({
      sheet: draft.sheets[0] as { name: string; viewports: { scaleDenominator: number }[] },
      sheetNumber: 1,
    });
    // List policy: every denominator in sheet order, no VARIES invention.
    expect(context.SCALE).toBe('1:500, 1:1000');
    expect(context.SCALE).not.toContain('VARIES');
  });

  it('derives scale-bar paper lengths from the viewport denominator without hardcoded sizes', () => {
    // 4 divisions x 10 drawing-units: @1:500 each division is 20 mm (80 mm total),
    // @1:1000 each division is 10 mm (40 mm total).
    expect(scaleBarDivisionPaperMm({ modelPerDivision: 10, scaleDenominator: 500 })).toBe(20);
    expect(scaleBarTotalPaperMm({ divisions: 4, modelPerDivision: 10, scaleDenominator: 500 })).toBe(80);
    expect(scaleBarDivisionPaperMm({ modelPerDivision: 10, scaleDenominator: 1000 })).toBe(10);
    expect(scaleBarTotalPaperMm({ divisions: 4, modelPerDivision: 10, scaleDenominator: 1000 })).toBe(40);
    // Agrees with the legacy builder and the base model->paper conversion.
    const legacy = buildScaleBar({ scaleDenominator: 500, divisions: 4, modelPerDivisionM: 10 });
    expect(legacy.reduce((sum, segment) => sum + segment.paperLengthMm, 0)).toBe(80);
    expect(modelToPaperMm(10, 500)).toBe(20);
    // Feet drawings convert through 304.8 mm per drawing unit.
    expect(scaleBarDivisionPaperMm({ modelPerDivision: 10, scaleDenominator: 500, unitsMode: 'ft' })).toBeCloseTo(
      (10 * 304.8) / 500,
      10,
    );
  });

  it('preserves north-arrow, scale-bar, and unknown sheet-object kinds verbatim', () => {
    let draft = addSheetToDraft(createBlankDraftDocument({ projectId: 'p1' }), createPlanSheet({ name: 'S' }));
    const sheetId = draft.sheets[0]?.id as string;
    draft = {
      ...draft,
      sheets: draft.sheets.map((entry) =>
        entry.id === sheetId
          ? {
              ...entry,
              sheetObjects: [
                {
                  id: 'arrow-1', kind: 'north-arrow', layerId: 'labels',
                  paperXmm: 5, paperYmm: 6, viewportId: 'v1', sizeMm: 12, rotationOffsetDeg: 15,
                },
                {
                  id: 'mystery-1', kind: 'future-widget', layerId: 'labels',
                  paperXmm: 1, paperYmm: 2, text: 'kept',
                },
              ],
            }
          : entry,
      ),
    };
    const revived = roundTrip(cloneDraftDocument(draft));
    expect(revived?.sheets[0]?.sheetObjects).toEqual(draft.sheets[0]?.sheetObjects);
  });

  it('runs each sheet CRUD operation as one draft-history transaction', () => {
    let state = createDraftSheetHistory(createBlankDraftDocument({ projectId: 'p1' }));
    state = runDraftSheetCommand(state, (draft) => addSheetToDraft(draft, createPlanSheet({ name: 'A' })));
    state = runDraftSheetCommand(state, (draft) => addSheetToDraft(draft, createPlanSheet({ name: 'B' })));
    const [idA, idB] = state.draft.sheets.map((sheet) => sheet.id);

    const renamed = renameSheetCommand(state, idA as string, 'A1');
    expect(renamed.draft.sheets[0]?.name).toBe('A1');
    expect(renamed.past).toHaveLength(state.past.length + 1);
    expect(undoDraftSheetHistory(renamed).draft.sheets[0]?.name).toBe('A');

    const duplicated = duplicateSheetCommand(state, idA as string);
    expect(duplicated.draft.sheets).toHaveLength(3);
    expect(duplicated.past).toHaveLength(state.past.length + 1);
    expect(undoDraftSheetHistory(duplicated).draft.sheets).toHaveLength(2);

    const reordered = reorderSheetsCommand(state, [idB as string, idA as string]);
    expect(reordered.draft.sheets.map((sheet) => sheet.name)).toEqual(['B', 'A']);
    expect(reordered.past).toHaveLength(state.past.length + 1);
    expect(undoDraftSheetHistory(reordered).draft.sheets.map((sheet) => sheet.name)).toEqual(['A', 'B']);

    const deleted = deleteSheetCommand(state, idA as string);
    expect(deleted.draft.sheets.map((sheet) => sheet.name)).toEqual(['B']);
    expect(deleted.past).toHaveLength(state.past.length + 1);
    expect(redoDraftSheetHistory(undoDraftSheetHistory(deleted)).draft.sheets.map((s) => s.name)).toEqual(['B']);
  });
});
