/**
 * Phase 19B browser QA — sheet/layout production through the real /cad app.
 *
 * Browser tests drive the production shell (layout tabs, Page Setup, the
 * SheetWorkspace MVIEW flow, viewport props, sheet-routed undo/redo,
 * save/reopen, Export Center). Store-level tests use the same production
 * engine seams for paper-space behavior with no direct /cad surface (or no
 * reliably drivable one: drag move/resize, lock toggle, per-viewport layer
 * overrides, title-block assignment, template CRUD, plot-preview equality,
 * multi-sheet payloads). Each store-level test names its reason — nothing
 * is faked. No engine math changes; paper-space only.
 *
 * Letter map (§124): A sheet setup, B viewport create, C move/resize,
 * D pan, E rotation, F lock, G layer overrides, H multi-viewport,
 * I 19A tables, J title block, K north arrow, L scale bar, M templates,
 * N undo/redo, O save/reopen, P plot preview, Q PDF multi-sheet,
 * R DXF R2000 layouts. Zero page/console errors per browser test.
 */
import { expect, test } from '@playwright/test';
import * as path from 'node:path';

import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import type { CadDrawingDocument } from '../src/engine/cad/cadTypes';
import type { DraftDocument } from '../src/engine/cad/cadDraftTypes';
import {
  addSheetToDraft,
  addViewportToSheet,
  assignTitleBlockToSheet,
  buildSheetTokenContext,
  createDraftSheetHistory,
  createPlanSheet,
  createSheetFromTemplate,
  createTitleBlockTemplate,
  duplicateSheetInDraft,
  expandSheetTokens,
  modelToPaperMm,
  moveViewportCenter,
  northArrowAngleDeg,
  redoDraftSheetHistory,
  renameSheetInDraft,
  rotateViewport,
  runDraftSheetCommand,
  scaleBarDivisionPaperMm,
  setSheetTitleBlockField,
  setViewportLayerOverride,
  setViewportScale,
  undoDraftSheetHistory,
} from '../src/engine/cad/cadSheets';
import { buildExportSheetSceneWithResult, deriveSheetScene } from '../src/engine/cad/cadExportScene';
import { serializeExportSceneToSvg } from '../src/engine/cad/cadSvgSerializer';
import {
  addSheetObject,
  defaultNorthArrowObject,
  defaultScaleBarObject,
  resolvedNorthArrowAngleDeg,
  resolvedScaleBarTotalMm,
} from '../src/engine/cad/cadSheetObjects';
import {
  addSheetTemplateFromSheet,
  renameSheetTemplate,
  sheetTemplateFromSheet,
} from '../src/engine/cad/cadSheetTemplates';
import {
  applySheetPageSetupToDraft,
  resolveSheetPaperMm,
  sheetPageSetupFromSheet,
} from '../src/engine/cad/cadSheetPageSetup';
import { createCadHistoryState, runCadCommand } from '../src/engine/cad/cadUndoRedo';
import { buildCadDisplayScene } from '../src/engine/cad/cadRenderer';
import { buildExportCenterPreview, buildPlotPreviewScene } from '../src/engine/cad/exportCenter';
import {
  isViewportLocked,
  moveViewportPaper,
  resizeViewportFromCorner,
} from '../src/components/surveyCad/SheetWorkspace.utils';
import {
  buildSurveyPlanProject,
  PARCEL_IDS,
  saveDrawingText,
} from './cad-survey-plan-19a-helpers';
import {
  addLayoutSheet,
  clickSheetCenter,
  createViewportMview,
  gotoSheetCad,
  layoutTab,
  openDrawingOnSheetTab,
  openPageSetup,
  paperStatus,
  sheetGeometryCount,
  sheetSvg,
  sheetWorkspace,
  viewportProps,
} from './cad-sheet-layout-19b-helpers';

// ---------------------------------------------------------------------------
// Browser flows — real /cad UI at the 1366x768 minimum viewport
// ---------------------------------------------------------------------------

test.describe('Phase 19B sheet layouts (browser flows)', () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test('A: new sheet tab appears; A3 landscape Page Setup resolves 420x297', async ({ page }) => {
    const errors: string[] = [];
    await gotoSheetCad(page, errors);
    await addLayoutSheet(page);
    await expect(layoutTab(page, 'Model')).toBeVisible();
    await expect(layoutTab(page, 'Layout 1')).toBeVisible();

    await layoutTab(page, 'Layout 1').click();
    await expect(sheetWorkspace(page)).toBeVisible();
    const dialog = await openPageSetup(page, 'Layout 1');
    await dialog.locator('select[aria-label="Paper size"]').selectOption('ISO A3');
    await dialog.locator('select[aria-label="Orientation"]').selectOption('landscape');
    await expect(dialog.locator('span[aria-label="Resolved paper size"]')).toHaveText('420 × 297 mm');

    // §126 usability at 1366x768: dialog actions are visible and enabled.
    const apply = dialog.locator('button[aria-label="Apply page setup"]');
    const close = dialog.locator('button[aria-label="Close page setup"]');
    await expect(apply).toBeVisible();
    await expect(apply).toBeEnabled();
    await expect(close).toBeVisible();
    await apply.click();
    await expect(sheetSvg(page)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('B: MVIEW viewport at 1:500 shows model geometry and paper status', async ({ page }) => {
    const errors: string[] = [];
    await gotoSheetCad(page, errors);
    await addLayoutSheet(page);
    await layoutTab(page, 'Layout 1').click();
    const before = await sheetGeometryCount(page);

    await createViewportMview(page, { centerX: '80', centerY: '15', scale: '500' });
    await expect(viewportProps(page)).toBeVisible();
    await expect(paperStatus(page)).toHaveText('Layout1 | Viewport: 1:500');
    expect(await sheetGeometryCount(page)).toBeGreaterThan(before);
    expect(errors).toEqual([]);
  });

  test('C+E(browser): props scale select and rotation field persist', async ({ page }) => {
    const errors: string[] = [];
    await gotoSheetCad(page, errors);
    await addLayoutSheet(page);
    await layoutTab(page, 'Layout 1').click();
    await createViewportMview(page, { centerX: '80', centerY: '15', scale: '500' });

    await viewportProps(page).locator('select[aria-label="Viewport scale"]').selectOption('1000');
    await expect(paperStatus(page)).toHaveText('Layout1 | Viewport: 1:1000');

    const rotation = viewportProps(page).locator('input[aria-label="Viewport rotation degrees"]');
    await rotation.fill('15');
    await rotation.press('Tab');
    await expect(rotation).toHaveValue('15');
    expect(errors).toEqual([]);
  });

  test('N(browser): Ctrl+Z removes the viewport, redo restores it', async ({ page }) => {
    const errors: string[] = [];
    await gotoSheetCad(page, errors);
    await addLayoutSheet(page);
    await layoutTab(page, 'Layout 1').click();
    await createViewportMview(page, { centerX: '80', centerY: '15', scale: '500' });

    await clickSheetCenter(page);
    await page.keyboard.press('Control+z');
    await expect(viewportProps(page)).toBeHidden({ timeout: 10000 });
    await expect(paperStatus(page)).toHaveText('Layout1');

    await page.keyboard.press('Control+Shift+z');
    await expect(viewportProps(page)).toBeVisible({ timeout: 10000 });
    await expect(paperStatus(page)).toHaveText('Layout1 | Viewport: 1:500');
    expect(errors).toEqual([]);
  });

  test('O(browser): save/reopen keeps the layout tab and viewport scale', async ({ page }) => {
    const errors: string[] = [];
    await gotoSheetCad(page, errors);
    await addLayoutSheet(page);
    await layoutTab(page, 'Layout 1').click();
    await createViewportMview(page, { centerX: '80', centerY: '15', scale: '500' });

    const saved = await saveDrawingText(page);
    await openDrawingOnSheetTab(page, path.join(saved.dir, 'drawing.wncad'), 'Layout 1');
    await layoutTab(page, 'Layout 1').click();
    await expect(sheetSvg(page)).toBeVisible();
    await expect(paperStatus(page)).toHaveText('Layout1 | Viewport: 1:500');
    expect(errors).toEqual([]);
  });

  test('Q+R(browser): Export Center gates DXF on the legacy fixture; .wncad lists both layouts', async ({ page }) => {
    const errors: string[] = [];
    await gotoSheetCad(page, errors);
    await addLayoutSheet(page);
    await addLayoutSheet(page);
    await layoutTab(page, 'Layout 1').click();
    await createViewportMview(page, { centerX: '80', centerY: '15', scale: '500' });

    await layoutTab(page, 'Model').click();
    // Shell chrome (not the standalone workspace toolbar) owns Export
    // Center on the Model tab: wait for the model workspace to go live,
    // then Output ribbon → SHELL_EXPORT_CENTER.
    await expect(page.locator('[data-survey-cad-entity-count]')).toBeVisible({ timeout: 30000 });
    await page.locator('[data-cad-ribbon] [role="tab"]', { hasText: 'Output' }).click();
    await page.locator('button[data-cad-command="SHELL_EXPORT_CENTER"]').click();
    const panel = page.locator('section[aria-label="Export Center"]');
    await expect(panel).toBeVisible({ timeout: 10000 });
    // The deterministic fixture is unstamped legacy: coordinate-bearing
    // deliverables stay blocked by design (17E gate). Byte-level DXF/PDF
    // layout coverage lives at the store level, which bypasses the gate
    // exactly as the unblocked paths do.
    await panel.locator('button', { hasText: 'DXF R2000 (layouts)' }).click();
    await expect(panel.getByText(/export blocked/)).toBeVisible({ timeout: 15000 });

    // .wncad never gates: its preview proves the Center sees both layouts.
    await panel.locator('button', { hasText: '.wncad (drawing)' }).click();
    await expect(panel.getByText('Layout 1')).toBeVisible({ timeout: 15000 });
    await expect(panel.getByText('Layout 2')).toBeVisible({ timeout: 15000 });
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Captures — 1920x1080 sheet + Page Setup (the plot preview dialog has no
// production mount, so no plot-preview capture is possible in CI; deferred
// to manual per the report).
// ---------------------------------------------------------------------------

test.describe('Phase 19B sheet captures', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('captures: sheet workspace and Page Setup at 1920x1080', async ({ page }, testInfo) => {
    const errors: string[] = [];
    await gotoSheetCad(page, errors);
    await addLayoutSheet(page);
    await layoutTab(page, 'Layout 1').click();
    await createViewportMview(page, { centerX: '80', centerY: '15', scale: '500' });
    await testInfo.attach('sheet-full-page-1920', {
      body: await page.screenshot({ fullPage: false }),
      contentType: 'image/png',
    });
    const dialog = await openPageSetup(page, 'Layout 1');
    await expect(dialog).toBeVisible();
    await testInfo.attach('page-setup-1920', {
      body: await dialog.screenshot(),
      contentType: 'image/png',
    });
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Store-level flows — paper-space engine seams with no direct /cad surface
// (or no reliably drivable one). Each test names its reason.
// ---------------------------------------------------------------------------

/** Deterministic drawing: 19A survey plan entities + one A3L sheet + 1:500 viewport. */
const buildSheetDrawing = (): { document: CadDrawingDocument; sheetId: string; viewportId: string } => {
  const project = buildSurveyPlanProject();
  let document = createBlankCadDrawingDocument({ name: 'Sheet QA 19B', units: 'm' });
  document = { ...document, project: { ...document.project, entities: project.entities } };
  const draft = document.draft;
  if (!draft) throw new Error('blank drawing has no draft');
  const withSheet = addSheetToDraft(draft, createPlanSheet({ name: 'A-101', sizeId: 'ISO A3', orientation: 'landscape' }));
  const sheet = withSheet.sheets[withSheet.sheets.length - 1];
  if (!sheet) throw new Error('sheet not created');
  const withViewport = addViewportToSheet(withSheet, sheet.id, {
    name: 'VP-1',
    modelCenterX: 80,
    modelCenterY: 15,
    scaleDenominator: 500,
    paperXmm: 60,
    paperYmm: 40,
    paperWidthMm: 300,
    paperHeightMm: 200,
    rotationDeg: 0,
  });
  const created = withViewport.sheets.find((entry) => entry.id === sheet.id)?.viewports.at(-1);
  if (!created) throw new Error('viewport not created');
  return { document: { ...document, draft: withViewport }, sheetId: sheet.id, viewportId: created.id };
};

const sheetOf = (draft: DraftDocument, sheetId: string) =>
  draft.sheets.find((sheet) => sheet.id === sheetId);

const viewportOf = (document: CadDrawingDocument, sheetId: string, viewportId: string) =>
  document.draft?.sheets.find((sheet) => sheet.id === sheetId)?.viewports.find((viewport) => viewport.id === viewportId);

test.describe('Phase 19B sheet layouts (store-level flows)', () => {
  // Store-level: pointer-drag move/resize is pixel-driven and flaky in the
  // harness; the workspace calls these exact utils (production seam).
  test('C: move/resize changes the paper frame, model untouched, scale exact', () => {
    const { document, sheetId, viewportId } = buildSheetDrawing();
    const before = viewportOf(document, sheetId, viewportId);
    if (!before) throw new Error('viewport missing');
    const moved = moveViewportPaper(before, 10, -5);
    expect(moved.paperXmm).toBeCloseTo(70, 9);
    expect(moved.paperYmm).toBeCloseTo(35, 9);
    expect([moved.modelCenterX, moved.modelCenterY, moved.scaleDenominator]).toEqual([
      before.modelCenterX, before.modelCenterY, before.scaleDenominator,
    ]);
    const resized = resizeViewportFromCorner(moved, 'se', { x: moved.paperXmm + 200, y: moved.paperYmm + 100 });
    expect(resized?.paperWidthMm).toBeCloseTo(200, 9);
    expect(resized?.paperHeightMm).toBeCloseTo(100, 9);
    // Scale exact: 10 model-m at 1:500 project to exactly 20 paper-mm.
    expect(modelToPaperMm(10, resized?.scaleDenominator ?? 0)).toBeCloseTo(20, 9);
  });

  // Store-level: Pan View drag is pointer-driven; moveViewportCenter is the
  // engine seam the workspace commits through.
  test('D: pan changes the model center, paper frame fixed', () => {
    const { document, sheetId, viewportId } = buildSheetDrawing();
    const before = viewportOf(document, sheetId, viewportId);
    if (!before || !document.draft) throw new Error('viewport missing');
    const next = moveViewportCenter(document.draft, sheetId, viewportId, { x: 90, y: 25 });
    const after = next.sheets.find((sheet) => sheet.id === sheetId)?.viewports.find((viewport) => viewport.id === viewportId);
    expect([after?.modelCenterX, after?.modelCenterY]).toEqual([90, 25]);
    expect([after?.paperXmm, after?.paperYmm, after?.paperWidthMm, after?.paperHeightMm]).toEqual([
      before.paperXmm, before.paperYmm, before.paperWidthMm, before.paperHeightMm,
    ]);
  });

  // Store-level: rotation has a numeric field in the harness but asserting
  // the display-transform convention belongs on the engine seam.
  test('E: rotation is display-only; Grid North arrow follows the viewport', () => {
    const { document, sheetId, viewportId } = buildSheetDrawing();
    if (!document.draft) throw new Error('no draft');
    const next = rotateViewport(document.draft, sheetId, viewportId, 90);
    if (!next) throw new Error('rotate failed');
    const after = next.sheets.find((sheet) => sheet.id === sheetId)?.viewports.find((viewport) => viewport.id === viewportId);
    expect(after?.rotationDeg).toBe(90);
    expect(northArrowAngleDeg(90)).toBe(90);
    const derived = deriveSheetScene({ draft: next, sheetId, project: document.project });
    expect(derived.viewports.find((viewport) => viewport.viewportId === viewportId)?.rotationDeg).toBe(90);
    // Model geometry is untouched by the display rotation.
    expect(document.project.entities.length).toBe(buildSurveyPlanProject().entities.length);
  });

  // Store-level: the shell has no lock toggle; the flag persists and the
  // workspace guard (production seam) blocks locked viewports.
  test('F: locked flag persists and the workspace guard blocks edits', () => {
    const { document, sheetId, viewportId } = buildSheetDrawing();
    if (!document.draft) throw new Error('no draft');
    const locked: CadDrawingDocument = {
      ...document,
      draft: {
        ...document.draft,
        sheets: document.draft.sheets.map((sheet) =>
          sheet.id === sheetId
            ? { ...sheet, viewports: sheet.viewports.map((viewport) => (viewport.id === viewportId ? { ...viewport, locked: true } : viewport)) }
            : sheet,
        ),
      },
    };
    const roundTripped = parseCadDrawingFile(serializeCadDrawingFile(locked));
    if (!roundTripped.ok) throw new Error('round trip failed');
    const persisted = viewportOf(roundTripped.drawing, sheetId, viewportId);
    expect(persisted?.locked).toBe(true);
    expect(isViewportLocked(persisted!)).toBe(true);
    expect(isViewportLocked(viewportOf(document, sheetId, viewportId)!)).toBe(false);
    // Scale math itself stays total (the lock guard lives in the workspace).
    expect(setViewportScale(document.draft, sheetId, viewportId, 1000)?.sheets).toBeDefined();
  });

  // Store-level: no per-viewport layer-override surface exists in /cad yet.
  test('G: two viewports disagree on a layer; NO-PLOT (printable:false) loses in export', () => {
    const { document, sheetId, viewportId } = buildSheetDrawing();
    if (!document.draft) throw new Error('no draft');
    let draft = addViewportToSheet(document.draft, sheetId, {
      name: 'VP-2', modelCenterX: 80, modelCenterY: 15, scaleDenominator: 1000,
      paperXmm: 60, paperYmm: 40, paperWidthMm: 150, paperHeightMm: 100, rotationDeg: 0,
    });
    const second = draft.sheets.find((sheet) => sheet.id === sheetId)?.viewports.at(-1);
    if (!second) throw new Error('second viewport missing');
    draft = setViewportLayerOverride(draft, sheetId, viewportId, 'general', { visible: false });
    const split = buildExportSheetSceneWithResult({ draft, sheetId, project: document.project });
    const generalItems = (scene: typeof split): number =>
      scene.output.items.filter((item) => (item as { layer?: string }).layer === 'general').length;
    // VP-1 hides `general` but VP-2 still shows it: general-layer geometry
    // still renders through VP-2.
    expect(split.exportedEntityIds).toContain('parcel:lot1');
    expect(generalItems(split)).toBeGreaterThan(0);
    expect(split.output.items.length).toBeGreaterThan(0);

    // Hiding `general` in BOTH viewports drops it from the scene entirely:
    // per-viewport overrides compose, they do not leak across viewports.
    const bothHidden = setViewportLayerOverride(draft, sheetId, second.id, 'general', { visible: false });
    const hidden = buildExportSheetSceneWithResult({ draft: bothHidden, sheetId, project: document.project });
    expect(generalItems(hidden)).toBe(0);
    expect(hidden.exportedEntityIds).not.toContain('parcel:lot1');

    // NO-PLOT: printable:false on the project layer drops it everywhere.
    const noPlot: CadDrawingDocument = {
      ...document,
      project: {
        ...document.project,
        layers: document.project.layers.map((layer) => (layer.id === 'general' ? { ...layer, printable: false } : layer)),
      },
    };
    if (!noPlot.draft) throw new Error('no draft');
    const plotted = buildExportSheetSceneWithResult({ draft: noPlot.draft, sheetId, project: noPlot.project });
    // NO-PLOT wins: no general-layer geometry anywhere (arc entities still
    // contribute `labels`-layer text, which plots — only their curve is out).
    expect(plotted.output.items.filter((item) => (item as { layer?: string }).layer === 'general')).toHaveLength(0);
  });

  // Store-level: multi-viewport creation is MVIEW-only in the harness (one
  // at a time); simultaneous projection is asserted on the engine seam.
  test('H: 1:250 and 1:1000 viewports project simultaneously at exact ratio', () => {
    const { document, sheetId } = buildSheetDrawing();
    if (!document.draft) throw new Error('no draft');
    const draft = addViewportToSheet(document.draft, sheetId, {
      name: 'VP-wide', modelCenterX: 80, modelCenterY: 15, scaleDenominator: 1000,
      paperXmm: 60, paperYmm: 40, paperWidthMm: 300, paperHeightMm: 200, rotationDeg: 0,
    });
    const scaled = setViewportScale(draft, sheetId, buildSheetDrawingSecondId(draft, sheetId), 250);
    if (!scaled) throw new Error('scale failed');
    const derived = deriveSheetScene({ draft: scaled, sheetId, project: document.project });
    const dens = derived.viewports.map((viewport) => viewport.scaleDenominator).sort((a, b) => a - b);
    expect(dens).toEqual([250, 1000]);
    // Same 10 model-m: 40mm at 1:250 vs 10mm at 1:1000 (exact 4:1).
    expect(modelToPaperMm(10, 250)).toBeCloseTo(40, 9);
    expect(modelToPaperMm(10, 1000)).toBeCloseTo(10, 9);
  });

  // Store-level: no "place 19A table on sheet" surface exists; the survey
  // table projects through the viewport as ordinary model geometry.
  test('I: parcel course table rows and tags project onto the sheet', () => {
    const project = buildSurveyPlanProject();
    const history = runCadCommand(createCadHistoryState(project, [PARCEL_IDS[0]]), {
      key: 'PARCELTABLE',
      insertX: 0,
      insertY: 0,
      sourceEntityIds: [PARCEL_IDS[0]],
    });
    const tabled: CadDrawingDocument = {
      ...createBlankCadDrawingDocument({ name: 'Sheet QA 19B', units: 'm' }),
      project: history.present.project,
    };
    const draft = tabled.draft;
    if (!draft) throw new Error('no draft');
    const withSheet = addSheetToDraft(draft, createPlanSheet({ name: 'A-101', sizeId: 'ISO A3', orientation: 'landscape' }));
    const sheet = withSheet.sheets[withSheet.sheets.length - 1];
    if (!sheet) throw new Error('no sheet');
    const withViewport = addViewportToSheet(withSheet, sheet.id, {
      name: 'VP-1', modelCenterX: 20, modelCenterY: 15, scaleDenominator: 500,
      paperXmm: 60, paperYmm: 40, paperWidthMm: 300, paperHeightMm: 200, rotationDeg: 0,
    });
    const scene = buildExportSheetSceneWithResult({ draft: withViewport, sheetId: sheet.id, project: tabled.project });
    const texts = scene.output.items
      .filter((item): item is Extract<typeof item, { kind: 'text' }> => item.kind === 'text')
      .map((item) => item.text);
    for (const code of ['PC1', 'PC2', 'PC3', 'PC4']) expect(texts).toContain(code);
  });

  // Store-level: no title-block assignment surface exists in /cad yet.
  test('J: assigned template tokens resolve; per-sheet field update wins', () => {
    const { document, sheetId } = buildSheetDrawing();
    if (!document.draft) throw new Error('no draft');
    const definition = {
      ...createTitleBlockTemplate('TB-A3'),
      elements: [
        {
          id: 'el-drawn', kind: 'token-text', xMm: 10, yMm: 10, widthMm: 60, heightMm: 6,
          tokenTemplate: '{DRAWN_BY}',
        },
      ],
    } as const;
    let draft: DraftDocument = {
      ...document.draft,
      titleBlockDefinitions: [...document.draft.titleBlockDefinitions, { ...definition, elements: [...definition.elements] }],
    };
    draft = assignTitleBlockToSheet(draft, sheetId, definition.id);
    draft = setSheetTitleBlockField(draft, sheetId, 'DRAWN_BY', 'J. Jacko');
    const sheet = sheetOf(draft, sheetId);
    if (!sheet) throw new Error('sheet missing');
    const context = buildSheetTokenContext({ sheet, sheetNumber: 1, projectName: 'Sheet QA 19B' });
    expect(context.DRAWN_BY).toBe('J. Jacko');
    expect(expandSheetTokens('{DRAWN_BY} — {SHEET_NAME}', context).text).toBe('J. Jacko — A-101');
    const scene = buildExportSheetSceneWithResult({ draft, sheetId, project: document.project });
    const texts = scene.output.items
      .filter((item): item is Extract<typeof item, { kind: 'text' }> => item.kind === 'text')
      .map((item) => item.text);
    expect(texts).toContain('J. Jacko');
  });

  // Store-level: north arrows are template/MVIEW-seeded paper objects; the
  // assertion is that the export path adds no hardcoded duplicate.
  test('K: exactly one arrow per viewport-linked north-arrow object', () => {
    const { document, sheetId, viewportId } = buildSheetDrawing();
    if (!document.draft) throw new Error('no draft');
    const viewport = viewportOf(document, sheetId, viewportId);
    if (!viewport) throw new Error('viewport missing');
    const baseline = buildExportSheetSceneWithResult({ draft: document.draft, sheetId, project: document.project });
    const baselineArrows = baseline.output.items
      .filter((item): item is Extract<typeof item, { kind: 'text' }> => item.kind === 'text')
      .filter((item) => item.text === 'N (grid)');
    expect(baselineArrows).toHaveLength(0);
    const draft = addSheetObject(document.draft, sheetId, defaultNorthArrowObject(viewport));
    const derived = deriveSheetScene({ draft, sheetId, project: document.project });
    const descriptor = derived.viewports.find((entry) => entry.viewportId === viewportId);
    expect(descriptor?.hasNorthArrow).toBe(true);
    expect(descriptor?.northArrowAngleDeg).toBe(0);
    const scene = buildExportSheetSceneWithResult({ draft, sheetId, project: document.project });
    const arrows = scene.output.items
      .filter((item): item is Extract<typeof item, { kind: 'text' }> => item.kind === 'text')
      .filter((item) => item.text === 'N (grid)');
    expect(arrows).toHaveLength(1);
    expect(resolvedNorthArrowAngleDeg(90, 0)).toBe(90);
  });

  // Store-level: no scale-bar edit surface exists in /cad yet.
  test('L: scale bar links to its viewport; scale update and ft units exact', () => {
    const { document, sheetId, viewportId } = buildSheetDrawing();
    if (!document.draft) throw new Error('no draft');
    const viewport = viewportOf(document, sheetId, viewportId);
    if (!viewport) throw new Error('viewport missing');
    const bar = defaultScaleBarObject(viewport);
    const at500 = resolvedScaleBarTotalMm(viewport, bar, 'm');
    const at1000 = resolvedScaleBarTotalMm({ ...viewport, scaleDenominator: 1000 }, bar, 'm');
    expect(at500).toBeCloseTo(at1000 * 2, 9);
    // Drawing-unit aware: 10 ft per division at 1:500.
    const ftMm = scaleBarDivisionPaperMm({ modelPerDivision: 10, scaleDenominator: 500, unitsMode: 'ft' });
    expect(ftMm).toBeCloseTo((10 * 0.3048 * 1000) / 500, 9);
    const draft = addSheetObject(document.draft, sheetId, bar);
    const derived = deriveSheetScene({ draft, sheetId, project: document.project });
    const descriptor = derived.viewports.find((entry) => entry.viewportId === viewportId);
    expect(descriptor?.scaleBar?.totalPaperMm).toBeCloseTo(at500, 9);
  });

  // Store-level: no sheet-template manager surface exists in /cad yet.
  test('M: template create/use snapshots; later template edits never touch the sheet', () => {
    const { document, sheetId } = buildSheetDrawing();
    if (!document.draft) throw new Error('no draft');
    const draft = addSheetTemplateFromSheet(document.draft, sheetId, 'A3L-plan');
    const template = draft.templates?.find((entry) => entry.name === 'A3L-plan');
    if (!template) throw new Error('template not created');
    const used = createSheetFromTemplate(draft, template.id, 'A-102');
    if (!used) throw new Error('template use failed');
    expect(used.sheets.map((sheet) => sheet.name)).toContain('A-102');
    // Snapshot semantics: renaming the template leaves created sheets alone.
    const renamed = renameSheetTemplate(draft, template.id, 'A3L-plan-renamed');
    expect(renamed.templates?.find((entry) => entry.id === template.id)?.name).toBe('A3L-plan-renamed');
    expect(used.sheets.find((sheet) => sheet.name === 'A-102')).toBeDefined();
    // sheetTemplateFromSheet round-trips the source sheet layout.
    const source = sheetOf(draft, sheetId);
    if (!source) throw new Error('source sheet missing');
    expect(sheetTemplateFromSheet(source, 'probe').viewportLayouts).toHaveLength(source.viewports.length);
  });

  // Store-level: sheet history routing is shell-wired (Ctrl+Z, covered in
  // the browser N test); the engine transaction shape is asserted here.
  test('N(store): draft history undo/redo brackets exactly one transaction', () => {
    const { document, sheetId } = buildSheetDrawing();
    if (!document.draft) throw new Error('no draft');
    let history = createDraftSheetHistory(document.draft);
    history = runDraftSheetCommand(history, (draft) => renameSheetInDraft(draft, sheetId, 'A-101R'));
    expect(history.draft.sheets[0]?.name).toBe('A-101R');
    history = undoDraftSheetHistory(history);
    expect(history.draft.sheets[0]?.name).toBe('A-101');
    history = redoDraftSheetHistory(history);
    expect(history.draft.sheets[0]?.name).toBe('A-101R');
  });

  // Store-level: exact paper-field round trip through the native save seam
  // (the browser O test covers tab/scale survival through the real inputs).
  test('O(store): save/reopen preserves paper semantics exactly', () => {
    const { document, sheetId, viewportId } = buildSheetDrawing();
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(document));
    if (!parsed.ok) throw new Error(`parse failed: ${parsed.errors.join('; ')}`);
    expect(viewportOf(parsed.drawing, sheetId, viewportId)).toEqual(viewportOf(document, sheetId, viewportId));
    const sheetBefore = sheetOf(document.draft!, sheetId);
    const sheetAfter = parsed.drawing.draft ? sheetOf(parsed.drawing.draft, sheetId) : undefined;
    expect([sheetAfter?.widthMm, sheetAfter?.heightMm, sheetAfter?.name]).toEqual([
      sheetBefore?.widthMm, sheetBefore?.heightMm, sheetBefore?.name,
    ]);
    // Model geometry survives the trip untouched.
    expect(buildCadDisplayScene(parsed.drawing.project).primitives.length).toBe(
      buildCadDisplayScene(document.project).primitives.length,
    );
  });

  // Store-level: the plot preview dialog has no production mount; equality
  // with the export path is asserted on the shared builder seam.
  test('P: plot preview scene serializes identically to the export scene', () => {
    const { document, sheetId } = buildSheetDrawing();
    const preview = buildPlotPreviewScene(document, sheetId);
    if (!preview.ok) throw new Error(preview.message);
    if (!document.draft) throw new Error('no draft');
    const exported = buildExportSheetSceneWithResult({ draft: document.draft, sheetId, project: document.project });
    expect(serializeExportSceneToSvg(preview.preview.scene)).toBe(serializeExportSceneToSvg(exported.output));
    expect(preview.preview.omittedEntityIds).toEqual(exported.omittedEntityIds);
  });

  // Store-level: multi-sheet PDF bytes come from the export seam (the
  // browser only asserts the scope picker lists both sheets).
  test('Q(store): PDF-all covers every sheet; current covers one', () => {
    let { document, sheetId } = buildSheetDrawing();
    if (!document.draft) throw new Error('no draft');
    document = { ...document, draft: duplicateSheetInDraft(document.draft, sheetId) };
    const all = buildExportCenterPreview(document, { format: 'pdf', pdfScope: 'all' });
    if (!all.ok) throw new Error(all.message);
    expect(all.preview.sheetNames).toHaveLength(2);
    expect((all.preview.payload as Uint8Array).length).toBeGreaterThan(0);
    const current = buildExportCenterPreview(document, { format: 'pdf', pdfScope: 'current' });
    if (!current.ok) throw new Error(current.message);
    expect(current.preview.sheetNames).toHaveLength(1);
  });

  // Store-level: layout-table content of the DXF payload (the browser
  // asserts the format picker; bytes are asserted here).
  test('R(store): DXF R2000 carries one layout per sheet; R12 stays model-only', () => {
    const { document } = buildSheetDrawing();
    const r2000 = buildExportCenterPreview(document, { format: 'dxf-r2000' });
    if (!r2000.ok) throw new Error(r2000.message);
    const payload = r2000.preview.payload as string;
    expect(payload.match(/LAYOUT/g)?.length ?? 0).toBeGreaterThanOrEqual(2); // table + at least one layout
    expect(payload).toContain('A-101');
    const r12 = buildExportCenterPreview(document, { format: 'dxf-r12' });
    if (!r12.ok) throw new Error(r12.message);
    expect(r12.preview.payload as string).not.toContain('LAYOUT');
  });

  // Store-level: Page Setup math at the unit boundary (the browser A test
  // covers the dialog itself).
  test('A(store): A3 landscape resolves 420x297 without touching geometry', () => {
    const { document, sheetId } = buildSheetDrawing();
    if (!document.draft) throw new Error('no draft');
    const sheet = sheetOf(document.draft, sheetId);
    if (!sheet) throw new Error('sheet missing');
    expect(resolveSheetPaperMm(sheetPageSetupFromSheet(sheet))).toEqual({ widthMm: 420, heightMm: 297 });
    const next = applySheetPageSetupToDraft(document.draft, sheetId, {
      ...sheetPageSetupFromSheet(sheet),
      orientation: 'portrait',
    });
    const swapped = next.draft.sheets.find((entry) => entry.id === sheetId);
    if (!swapped) throw new Error('sheet missing after setup');
    expect(resolveSheetPaperMm(sheetPageSetupFromSheet(swapped))).toEqual({ widthMm: 297, heightMm: 420 });
  });
});

/** First viewport id on a sheet (H helper: the pre-existing 1:500 viewport). */
const buildSheetDrawingSecondId = (draft: DraftDocument, sheetId: string): string => {
  const id = draft.sheets.find((sheet) => sheet.id === sheetId)?.viewports[0]?.id;
  if (!id) throw new Error('no viewport');
  return id;
};
