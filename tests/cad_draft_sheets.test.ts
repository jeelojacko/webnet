import { describe, expect, it } from 'vitest';
import { createCadHistoryState, runCadCommand, undoCadHistory, redoCadHistory } from '../src/engine/cad/cadUndoRedo';
import {
  STANDARD_SHEET_SIZES_MM,
  addPlanNote,
  addSheetToDraft,
  addViewportToSheet,
  asPlanViewport,
  buildScaleBar,
  createDraftSheetHistory,
  createPlanSheet,
  createTitleBlockInstance,
  deleteSheetFromDraft,
  duplicateSheetInDraft,
  editPlanNoteText,
  expandSheetTokens,
  modelToPaperMm,
  moveViewportCenter,
  northArrowAngleDeg,
  NORTH_REFERENCE,
  paperMmToModel,
  redoDraftSheetHistory,
  renameSheetInDraft,
  reorderSheetsInDraft,
  rotateViewport,
  runDraftSheetCommand,
  setTitleBlockField,
  setViewportClip,
  setViewportLayerOverride,
  setViewportScale,
  suggestViewportScale,
  undoDraftSheetHistory,
} from '../src/engine/cad/cadSheets';
import { createBlankDraftDocument, sanitizeDraftDocument } from '../src/engine/cad/cadDraftTypes';
import type { CadProject } from '../src/engine/cad/cadTypes';

const buildProject = (): CadProject => ({
  version: 2,
  id: 'project-sheets',
  name: 'Sheets',
  metadata: { source: 'parsed-input', runMode: 'unknown', units: 'm', stationCount: 0, observationCount: 0, adjustedStationCount: 0 },
  layers: [{ id: 'points', name: 'Points', color: '#ffffff', visible: true, locked: false, role: 'points' }],
  styleLibrary: { lineTypes: [], textStyles: [], pointSymbols: [], styles: [] },
  entities: [],
  cogoComputations: [],
  bounds: null,
});

describe('draft sheets', () => {
  it('performs sheet CRUD with explicit array order', () => {
    let draft = createBlankDraftDocument({ projectId: 'p1' });
    draft = addSheetToDraft(draft, createPlanSheet({ name: 'A', sizeId: 'ISO A4' }));
    draft = addSheetToDraft(draft, createPlanSheet({ name: 'B', sizeId: 'Letter' }));
    expect(draft.sheets.map((sheet) => sheet.name)).toEqual(['A', 'B']);
    expect(draft.sheets[0]?.widthMm).toBe(STANDARD_SHEET_SIZES_MM['ISO A4'].heightMm); // landscape

    const idA = draft.sheets[0]?.id as string;
    draft = renameSheetInDraft(draft, idA, 'A1');
    expect(draft.sheets[0]?.name).toBe('A1');

    draft = duplicateSheetInDraft(draft, idA);
    expect(draft.sheets).toHaveLength(3);
    expect(draft.sheets[2]?.name).toBe('A1 copy');
    expect(draft.sheets[2]?.id).not.toBe(idA);

    const order = [draft.sheets[2]?.id as string, draft.sheets[1]?.id as string, 'unknown-id', idA];
    draft = reorderSheetsInDraft(draft, order);
    expect(draft.sheets.map((sheet) => sheet.name)).toEqual(['A1 copy', 'B', 'A1']);

    draft = deleteSheetFromDraft(draft, idA);
    expect(draft.sheets.map((sheet) => sheet.name)).toEqual(['A1 copy', 'B']);
  });

  it('keeps survey coordinates untouched by viewport scale and rotation', () => {
    let draft = addSheetToDraft(createBlankDraftDocument({ projectId: 'p1' }), createPlanSheet({ name: 'S' }));
    const sheetId = draft.sheets[0]?.id as string;
    const modelPoint = { x: 123.456, y: -78.9 };
    draft = addViewportToSheet(draft, sheetId, { modelCenterX: modelPoint.x, modelCenterY: modelPoint.y });
    const viewportId = draft.sheets[0]?.viewports[0]?.id as string;

    draft = setViewportScale(draft, sheetId, viewportId, 250) ?? draft;
    draft = rotateViewport(draft, sheetId, viewportId, 90) ?? draft;
    draft = moveViewportCenter(draft, sheetId, viewportId, { x: 10, y: 20 });

    const viewport = asPlanViewport(draft.sheets[0]?.viewports[0] as never);
    expect(viewport.scaleDenominator).toBe(250);
    expect(viewport.rotationDeg).toBe(90);
    // The survey point itself is never rewritten by view transforms.
    expect(modelPoint).toEqual({ x: 123.456, y: -78.9 });
    expect(setViewportScale(draft, sheetId, viewportId, 0)).toBeUndefined();
    expect(setViewportScale(draft, sheetId, viewportId, Number.NaN)).toBeUndefined();
    expect(rotateViewport(draft, sheetId, viewportId, Number.NaN)).toBeUndefined();
  });

  it('computes grid-north arrow angles as the viewport rotation (clockwise content)', () => {
    expect(NORTH_REFERENCE).toBe('grid');
    expect(northArrowAngleDeg(0)).toBe(0);
    expect(northArrowAngleDeg(90)).toBe(90);
    expect(northArrowAngleDeg(-90)).toBe(270);
    expect(northArrowAngleDeg(360)).toBe(0);
    expect(northArrowAngleDeg(45)).toBe(45);
  });

  it('expands bounded tokens and keeps unknown tokens literal with warnings', () => {
    const { text, unknownTokens } = expandSheetTokens('Plan {SHEET_NAME} {SHEET_NUMBER} 1:{SCALE} {CRS} {NOPE} {NOPE}', {
      SHEET_NAME: 'Ground Floor',
      SHEET_NUMBER: '2',
      SCALE: '500',
      CRS: 'MGA94-55',
    });
    expect(text).toBe('Plan Ground Floor 2 1:500 MGA94-55 {NOPE} {NOPE}');
    expect(unknownTokens).toEqual(['NOPE']);
    const missing = expandSheetTokens('{PROJECT_NAME} {DATE}', {});
    expect(missing.text).toBe('{PROJECT_NAME} {DATE}');
    expect(missing.unknownTokens).toEqual([]);
  });

  it('persists multi-sheet order through a draft round-trip', () => {
    let draft = createBlankDraftDocument({ projectId: 'p1' });
    for (const name of ['One', 'Two', 'Three']) {
      draft = addSheetToDraft(draft, createPlanSheet({ name }));
    }
    draft = reorderSheetsInDraft(draft, [draft.sheets[2]?.id as string, draft.sheets[0]?.id as string, draft.sheets[1]?.id as string]);
    const revived = sanitizeDraftDocument(JSON.parse(JSON.stringify(draft)), 'p1', []);
    expect(revived?.sheets.map((sheet) => sheet.name)).toEqual(['Three', 'One', 'Two']);
  });

  it('round-trips viewport rotation, custom clip, layer overrides, and labels with stable ids', () => {
    let draft = addSheetToDraft(createBlankDraftDocument({ projectId: 'p1' }), createPlanSheet({ name: 'S' }));
    const sheetId = draft.sheets[0]?.id as string;
    draft = addViewportToSheet(draft, sheetId, { modelCenterX: 10, modelCenterY: 20 });
    const viewportId = draft.sheets[0]?.viewports[0]?.id as string;
    draft = rotateViewport(draft, sheetId, viewportId, 30) ?? draft;
    draft = setViewportClip(draft, sheetId, viewportId, { xMm: 20, yMm: 25, widthMm: 100, heightMm: 60 });
    draft = setViewportLayerOverride(draft, sheetId, viewportId, 'parcels', { visible: false });
    draft = {
      ...draft,
      labels: [
        {
          id: 'label-authored', text: 'P1 N 2.000, E 1.000', xModel: 1, yModel: 2,
          layerId: 'labels', heightMm: 3, provenance: 'COGO', overrideText: 'P1 custom',
        },
      ],
    };
    const revived = sanitizeDraftDocument(JSON.parse(JSON.stringify(draft)), 'p1', []);
    const viewport = asPlanViewport(revived?.sheets[0]?.viewports[0] as never);
    expect(viewport.rotationDeg).toBe(30);
    expect([viewport.clipXmm, viewport.clipYmm, viewport.clipWidthMm, viewport.clipHeightMm]).toEqual([20, 25, 100, 60]);
    expect(viewport.layerOverrides).toEqual({ parcels: { visible: false } });
    expect(revived?.labels).toEqual(draft.labels);
    // Sanitize twice: every present id survives unchanged; generation only
    // fills genuinely missing ids.
    const collectIds = (doc: typeof draft): string[] => [
      ...doc.sheets.map((sheet) => sheet.id),
      ...doc.sheets.flatMap((sheet) => sheet.viewports.map((entry) => entry.id)),
      ...doc.labels.map((label) => label.id),
    ];
    const twice = sanitizeDraftDocument(JSON.parse(JSON.stringify(revived)), 'p1', []);
    expect(collectIds(twice as typeof draft)).toEqual(collectIds(revived as typeof draft));
    // Old documents without the fields default safely.
    const legacy = sanitizeDraftDocument({ sheets: [{ viewports: [{}] }] }, 'p1', []);
    const legacyViewport = asPlanViewport(legacy?.sheets[0]?.viewports[0] as never);
    expect(legacyViewport.rotationDeg).toBe(0);
    expect(legacyViewport.clipWidthMm).toBeUndefined();
    expect(legacyViewport.layerOverrides).toBeUndefined();
    expect(legacy?.labels).toEqual([]);
  });

  it('suggests fit-to-page scales but records the actual denominator', () => {
    expect(suggestViewportScale({ modelWidthM: 100, modelHeightM: 50, paperWidthMm: 200, paperHeightMm: 200 })).toBe(500);
    expect(suggestViewportScale({ modelWidthM: 0, modelHeightM: 50, paperWidthMm: 200, paperHeightMm: 200 })).toBeUndefined();
    expect(modelToPaperMm(10, 500)).toBe(20);
    expect(paperMmToModel(20, 500)).toBe(10);
    const bar = buildScaleBar({ scaleDenominator: 500, divisions: 4, modelPerDivisionM: 10 });
    expect(bar).toHaveLength(4);
    expect(bar[0]?.paperLengthMm).toBe(20);
  });

  it('manages title-block instances and multiline plan notes', () => {
    let draft = addSheetToDraft(createBlankDraftDocument({ projectId: 'p1' }), createPlanSheet({ name: 'S' }));
    const sheetId = draft.sheets[0]?.id as string;
    const instance = setTitleBlockField(createTitleBlockInstance({ sheetId, definitionId: 'tb1' }), 'PROJECT_NAME', 'Plan');
    expect(instance.values.PROJECT_NAME).toBe('Plan');

    draft = addPlanNote(draft, sheetId, { layerId: 'labels', paperXmm: 5, paperYmm: 5, text: 'line one\nline two' });
    const noteId = draft.sheets[0]?.sheetObjects[0]?.id as string;
    draft = editPlanNoteText(draft, sheetId, noteId, 'updated');
    expect(draft.sheets[0]?.sheetObjects[0]?.text).toBe('updated');
  });

  it('undoes draft-only commands without touching adjustment results', () => {
    const project = buildProject();
    const history = createDraftSheetHistory(createBlankDraftDocument({ projectId: project.id }));
    const added = runDraftSheetCommand(history, (draft) => addSheetToDraft(draft, createPlanSheet({ name: 'S' })));
    expect(added.draft.sheets).toHaveLength(1);
    const undone = undoDraftSheetHistory(added);
    expect(undone.draft.sheets).toHaveLength(0);
    expect(redoDraftSheetHistory(undone).draft.sheets).toHaveLength(1);
    // Draft snapshots never reference model entities.
    expect(JSON.stringify(added.draft)).not.toContain('survey-point');
  });
});

describe('sheet and layer transactions', () => {
  it('commits draft-only sheet commands without mutating the project', () => {
    const project = buildProject();
    const initial = createCadHistoryState(project);
    const after = runCadCommand(initial, { key: 'SHEET_ADD', sheetId: 's1', sheetName: 'S1' });
    expect(after.undoStack).toHaveLength(1);
    expect(after.present.project.entities).toEqual([]);
    expect(after.present.project.layers).toEqual(project.layers);
    expect(redoCadHistory(undoCadHistory(after)).commandState.prompt).toContain('Redo SHEET_ADD');

    const rotated = runCadCommand(initial, { key: 'VIEWPORT_ROTATE', sheetId: 's1', viewportId: 'v1', rotationDeg: 30 });
    expect(rotated.present.project).toEqual(project);
    const scaled = runCadCommand(initial, { key: 'VIEWPORT_SCALE', sheetId: 's1', viewportId: 'v1', scaleDenominator: 200 });
    expect(scaled.undoStack).toHaveLength(1);
    const titled = runCadCommand(initial, { key: 'TITLE_BLOCK_EDIT', sheetId: 's1', definitionId: 'tb', values: { SCALE: '200' } });
    expect(titled.present.project).toEqual(project);
  });

  it('runs layer commands through undo and redo with a populated-delete guard', () => {
    const project = buildProject();
    const initial = createCadHistoryState(project);
    const created = runCadCommand(initial, { key: 'LAYER_CREATE', name: 'Labels', role: 'labels' });
    expect(created.present.project.layers).toHaveLength(2);
    const layerId = created.present.project.layers[1]?.id as string;

    const hidden = runCadCommand(created, { key: 'LAYER_VISIBILITY', layerId, visible: false });
    expect(hidden.present.project.layers[1]?.visible).toBe(false);
    expect(undoCadHistory(hidden).present.project.layers[1]?.visible).toBe(true);

    // Empty layer deletes; populated layer is refused until objects move off.
    const deleted = runCadCommand(created, { key: 'LAYER_DELETE', layerId });
    expect(deleted.present.project.layers).toHaveLength(1);
    const populated: CadProject = {
      ...project,
      entities: [
        {
          id: 'pt:A', type: 'survey-point', layerId: 'points', visible: true, locked: false,
          stationId: 'A', x: 1, y: 2, pointClass: 'free', source: 'parsed-input',
        },
      ],
    };
    const blocked = runCadCommand(createCadHistoryState(populated), { key: 'LAYER_DELETE', layerId: 'points' });
    expect(blocked.undoStack).toHaveLength(0);
    const withExtra = runCadCommand(createCadHistoryState(populated), { key: 'LAYER_CREATE', name: 'Extra' });
    const extraId = withExtra.present.project.layers[1]?.id as string;
    const moved = runCadCommand(withExtra, { key: 'LAYER_MOVE_OBJECTS', fromLayerId: 'points', toLayerId: extraId });
    expect(moved.present.project.entities[0]?.layerId).toBe(extraId);
    const freed = runCadCommand(moved, { key: 'LAYER_DELETE', layerId: 'points' });
    expect(freed.present.project.layers.some((layer) => layer.id === 'points')).toBe(false);
    expect(undoCadHistory(freed).present.project.layers).toHaveLength(2);
  });
});
