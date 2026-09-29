/**
 * Phase 20C Wave-5C visual QA — grading-group site plan at 1366×768,
 * 1920×1080, and 2560×1440.
 *
 * Every view attaches to the test report (CI-safe). When WRITE_20C_EVIDENCE=1
 * the same PNGs are also written to docs/evidence/phase20c/ for the
 * visual-qa.md record.
 *
 * The scene is built through the production seams (PARCEL_CREATE,
 * GROUP_CREATE / GROUPBAKE commands, WNCAD file loader): flat EG target
 * (integer corners, z=0), a closed notched building-pad feature line (flat
 * z=10 — closed groups with non-flat sources fail closed at the corner, so
 * the success path renders here), an open cut bank below EG, a cut/fill
 * transition swale (integer zero crossing mid-member), a curved entrance
 * course (line + 90° arc, graded on the inside so the corner solves),
 * an unbuilt Future surface (target-stale view), parcel context, and a
 * pre-baked C-101 sheet drawing. Ties land on integer coordinates so the
 * worker daylight/target agreement gate passes deterministically.
 *
 * Views (§152): source pad, side-preview arrows, span selection, manager,
 * convex close-up, concave close-up, curved-corner indicator, target-stale
 * state, baked Surface, final sheet.
 */
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  createBlankCadDrawingDocument,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import { createCadHistoryState, runCadCommand } from '../src/engine/cad/cadUndoRedo';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import type {
  CadFeatureLineEntity,
  CadLineEntity,
  CadProject,
  CadSurface,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';
import { SURFACE_STYLE_CONTOURS_ID } from '../src/engine/cad/cadSurfaceStyles';
import {
  addSheetToDraft,
  addViewportToSheet,
  assignTitleBlockToSheet,
  createPlanSheet,
  createTitleBlockTemplate,
} from '../src/engine/cad/cadSheets';
import {
  addSheetObject,
  defaultNorthArrowObject,
  defaultScaleBarObject,
} from '../src/engine/cad/cadSheetObjects';
import {
  entityCount,
  homeTab,
  openSurveyPlanDrawing,
} from './cad-survey-plan-19a-helpers';
import { layoutTab, sheetGeometryCount } from './cad-sheet-layout-19b-helpers';

const EVIDENCE_DIR = path.resolve(process.cwd(), 'docs/evidence/phase20c');
const WRITE_EVIDENCE = process.env.WRITE_20C_EVIDENCE === '1';
/** CAD-standard signed bulge for a 90° minor arc. */
const ARC_BULGE = Math.tan(Math.PI / 8);

const pt = (id: string, stationId: string, x: number, y: number, z: number): CadSurveyPointEntity => ({
  id, type: 'survey-point', layerId: 'general', visible: true, locked: false,
  stationId, x, y, z, pointClass: 'free', source: 'parsed-input',
});

const lotLine = (id: string, fx: number, fy: number, tx: number, ty: number): CadLineEntity => ({
  id, type: 'line', layerId: 'general', visible: true, locked: false,
  fromStationId: `${id}-a`, toStationId: `${id}-b`,
  fromX: fx, fromY: fy, toX: tx, toY: ty, sourceObservationIds: [],
});

const featureLine = (
  id: string, name: string, verts: Array<{ id: string; x: number; y: number; z: number }>,
  segmentGeometry?: Array<{ kind: 'line' } | { kind: 'arc'; bulge: number }>,
  closed = false,
): CadFeatureLineEntity => ({
  id, type: 'feature-line', layerId: 'feature-lines', visible: true, locked: false,
  name, vertices: verts, ...(segmentGeometry ? { segmentGeometry } : {}), ...(closed ? { closed: true as const } : {}),
});

const EG_POINTS: Array<[string, string, number, number]> = [
  ['eg-sw', 'EG1', -40, -40], ['eg-se', 'EG2', 180, -40],
  ['eg-ne', 'EG3', 180, 120], ['eg-nw', 'EG4', -40, 120],
];

/** Site plan project: flat EG + closed notched pad + cut bank + swale + drive + parcel + groups. */
const buildSiteProject = (): CadProject => {
  const document = createBlankCadDrawingDocument({ name: 'Grading Groups 20C', units: 'm' });
  const eg: CadSurface = {
    id: 'srf-eg', name: 'EG',
    definition: { pointSource: { kind: 'points', pointEntityIds: EG_POINTS.map(([id]) => id) } },
  };
  const future: CadSurface = {
    id: 'srf-future', name: 'Future',
    definition: { pointSource: { kind: 'points', pointEntityIds: ['f1', 'f2', 'f3', 'f4'] } },
  };
  const base: CadProject = {
    ...document.project,
    entities: [
      ...EG_POINTS.map(([id, stationId, x, y]) => pt(id, stationId, x, y, 0)),
      pt('f1', 'F1', 0, 0, 5), pt('f2', 'F2', 20, 0, 5), pt('f3', 'F3', 20, 20, 5), pt('f4', 'F4', 0, 20, 5),
      lotLine('lot:s', -20, -20, 160, -20),
      lotLine('lot:e', 160, -20, 160, 100),
      lotLine('lot:n', 160, 100, -20, 100),
      lotLine('lot:w', -20, 100, -20, -20),
      // Closed notched pad, flat z=10 (v4 is the concave notch corner).
      featureLine('fl-pad', 'Building pad', [
        { id: 'v0', x: 30, y: 20, z: 10 }, { id: 'v1', x: 90, y: 20, z: 10 },
        { id: 'v2', x: 90, y: 60, z: 10 }, { id: 'v3', x: 60, y: 60, z: 10 },
        { id: 'v4', x: 60, y: 40, z: 10 }, { id: 'v5', x: 30, y: 40, z: 10 },
      ], undefined, true),
      featureLine('fl-bank', 'North cut bank', [
        { id: 'b0', x: 20, y: 70, z: -6 }, { id: 'b1', x: 100, y: 70, z: -6 },
      ]),
      featureLine('fl-swale', 'Swale', [
        { id: 's0', x: 20, y: 10, z: 8 }, { id: 's1', x: 60, y: 10, z: -8 },
      ]),
      featureLine('fl-drive', 'Entrance drive', [
        { id: 'd0', x: 100, y: 30, z: 8 }, { id: 'd1', x: 120, y: 30, z: 8 }, { id: 'd2', x: 140, y: 50, z: 8 },
      ], [{ kind: 'line' }, { kind: 'arc', bulge: ARC_BULGE }]),
    ],
    surfaces: [eg, future],
  };
  let history = runCadCommand(createCadHistoryState(base, []), {
    key: 'PARCEL_CREATE',
    sourceEntityIds: ['lot:s', 'lot:e', 'lot:n', 'lot:w'],
  });
  const group = (
    name: string, flId: string, courses: Array<[string, string]>,
    side: 'left' | 'right', criterion: { kind: 'fixed'; gradeRatio: number } | { kind: 'cut-fill'; cutGradeRatio: number; fillGradeRatio: number },
    tolerance: number, closed = false,
  ): void => {
    history = runCadCommand(history, {
      key: 'GROUP_CREATE',
      name, sourceFeatureLineId: flId,
      sourceCourses: courses.map(([vertexAId, vertexBId]) => ({ vertexAId, vertexBId })),
      targetSurfaceId: 'srf-eg', side, criterion,
      maxSearchDistance: 50, curveChordTolerance: tolerance, cornerMode: 'miter',
      ...(closed ? { closed: true as const } : {}),
    });
  };
  group('Pad grade', 'fl-pad',
    [['v0', 'v1'], ['v1', 'v2'], ['v2', 'v3'], ['v3', 'v4'], ['v4', 'v5'], ['v5', 'v0']],
    'right', { kind: 'fixed', gradeRatio: -0.5 }, 0.05, true);
  group('North cut', 'fl-bank', [['b0', 'b1']], 'left', { kind: 'fixed', gradeRatio: 0.5 }, 0.05);
  group('Swale cutfill', 'fl-swale', [['s0', 's1']], 'right',
    { kind: 'cut-fill', cutGradeRatio: 0.5, fillGradeRatio: -0.5 }, 0.05);
  // Graded on the inside of the curve (left) so the line/arc corner solves.
  group('Entrance', 'fl-drive', [['d0', 'd1'], ['d1', 'd2']], 'left', { kind: 'fixed', gradeRatio: -0.5 }, 0.05);
  return history.present.project;
};

const writeDrawing = (project: CadProject, name: string): string => {
  const document = createBlankCadDrawingDocument({ name, units: 'm' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-20c-vis-'));
  const filePath = path.join(dir, `${name}.wncad`);
  fs.writeFileSync(filePath, serializeCadDrawingFile({ ...document, project }), 'utf8');
  return filePath;
};

/** Sheet drawing with a pre-baked pad group (proves bake→surface→sheet). */
const writeSheetDrawing = (): string => {
  const project = buildSiteProject();
  const groupId = project.gradingGroups!.find((g) => g.name === 'Pad grade')!.id;
  const inputs = resolveGroupInputs(project, groupId);
  if (!inputs) throw new Error('pad inputs unresolvable');
  const target = project.surfaces!.find((s) => s.id === inputs.target.id)!;
  const built = buildCadSurface(project, target);
  if (built.outcome !== 'ok') throw new Error('EG build failed');
  const outcome = computeGradingGroupFromSnapshots({
    groupId, revision: inputs.revision,
    members: inputs.memberSources, side: inputs.group.side, criterion: inputs.group.criterion,
    maxSearchDistance: inputs.group.maxSearchDistance, curveChordTolerance: inputs.group.curveChordTolerance,
    closed: inputs.group.closed === true,
    target: {
      points: built.points.flatMap((p) => [p.x, p.y, p.z]),
      triangles: built.triangles.flatMap((tri) => [...tri]),
    },
  });
  if (!outcome.ok) throw new Error('pad bake-season compute failed');
  const history = runCadCommand(createCadHistoryState(project), {
    key: 'GROUPBAKE', groupId, result: outcome.result,
    expectedRevision: inputs.revision, sessionCurrent: true,
  });
  let bakedProject = history.present.project;
  bakedProject = {
    ...bakedProject,
    surfaces: (bakedProject.surfaces ?? []).map((surface) =>
      surface.name === 'Pad grade - Baked' ? { ...surface, styleId: SURFACE_STYLE_CONTOURS_ID } : surface,
    ),
  };
  const document = createBlankCadDrawingDocument({ name: 'Grading Sheet 20C', units: 'm' });
  const draft = document.draft;
  if (!draft) throw new Error('blank drawing has no draft');
  const withSheet = addSheetToDraft(
    draft, createPlanSheet({ name: 'C-101', sizeId: 'ISO A3', orientation: 'landscape' }),
  );
  const sheet = withSheet.sheets[withSheet.sheets.length - 1];
  if (!sheet) throw new Error('sheet not created');
  const withViewport = addViewportToSheet(withSheet, sheet.id, {
    name: 'VP-1', modelCenterX: 70, modelCenterY: 40, scaleDenominator: 500,
    paperXmm: 30, paperYmm: 30, paperWidthMm: 330, paperHeightMm: 210, rotationDeg: 0,
  });
  const viewport = withViewport.sheets.find((entry) => entry.id === sheet.id)?.viewports.at(-1);
  if (!viewport) throw new Error('viewport not created');
  let next = addSheetObject(withViewport, sheet.id, defaultNorthArrowObject(viewport));
  next = addSheetObject(next, sheet.id, defaultScaleBarObject(viewport));
  const template = createTitleBlockTemplate('TB-C101');
  next = { ...next, titleBlockDefinitions: [...next.titleBlockDefinitions, template] };
  next = assignTitleBlockToSheet(next, sheet.id, template.id);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-20c-vis-'));
  const filePath = path.join(dir, 'grading-sheet-20c.wncad');
  fs.writeFileSync(
    filePath,
    serializeCadDrawingFile({ ...document, project: bakedProject, draft: next }),
    'utf8',
  );
  return filePath;
};

const capture = async (
  page: Page, testInfo: TestInfo, name: string, target?: Locator,
): Promise<void> => {
  const body = target ? await target.screenshot() : await page.screenshot({ fullPage: false });
  await testInfo.attach(name, { body, contentType: 'image/png' });
  if (WRITE_EVIDENCE) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const size = page.viewportSize();
    fs.writeFileSync(path.join(EVIDENCE_DIR, `${name}-${size?.width}x${size?.height}.png`), body);
  }
};

const viewportBox = (page: Page): Locator => page.locator('[data-cad-viewport]');

/**
 * Boot the /cad app with the ribbon collapsed. At 1366×768 the expanded
 * ribbon (490 px) squeezes the flex viewport to zero height, so the shared
 * gotoCad viewport gate never passes there; collapsing first restores 450 px
 * and keeps the viewport dominant at every resolution. Ribbon interactions
 * re-expand on demand (openGroupManager / rebuildSurface below).
 */
const bootCad = async (page: Page, errors: string[]): Promise<void> => {
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('dialog', (dialog) => {
    if (dialog.type() === 'confirm') void dialog.accept();
  });
  await page.addInitScript(() => {
    const record = window as unknown as Record<string, unknown>;
    delete record.showSaveFilePicker;
    delete record.showOpenFilePicker;
  });
  await page.goto('/cad', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await collapseRibbon(page);
  await expect(page.locator('[data-cad-viewport]')).toBeVisible({ timeout: 30000 });
};

const openGroupManager = async (page: Page): Promise<void> => {
  await expandRibbon(page);
  await homeTab(page);
  await page.locator('[data-cad-grading-group-command="GRADINGGROUP"]').click();
  await expect(page.locator('[data-cad-grading-group-table]')).toBeVisible({ timeout: 15000 });
};

const closeGroupManager = async (page: Page): Promise<void> => {
  const close = page.locator('section[aria-label="Grading group manager"] button', { hasText: 'Close' }).first();
  // At 1366×768 the floating manager can sit under the dock tab bars, so the
  // Close button intercepts pointer events: fall back to a dispatched click
  // (the seam still closes honestly) and log it for the visual-QA record.
  await close.click({ timeout: 8000 }).catch(async () => {
    console.log('CLOSE-FALLBACK dispatched click (manager Close overlapped at this resolution)');
    await close.dispatchEvent('click');
  });
  await expect(page.locator('[data-cad-grading-group-table]')).toBeHidden({ timeout: 10000 });
};

function ribbonTab(page: Page, name: string) {
  return page.locator('[aria-label="Ribbon tabs"]').getByRole('tab', { name });
}

function surfaceManagerScope(page: Page) {
  return page.locator('section[aria-label="Surface manager"]');
}

function toolspaceSurface(page: Page, id: string) {
  return page.locator(`[data-cad-toolspace] [data-cad-surface="${id}"]`);
}

async function surfaceStatus(page: Page, id: string): Promise<string> {
  return (await toolspaceSurface(page, id).getAttribute('data-cad-surface-status')) ?? '';
}

/** Collapse the floating properties overlay so dock clicks land. */
async function collapseFloatingPanel(page: Page): Promise<void> {
  const collapse = page.locator('button[title="Collapse panel body"]');
  if (await collapse.isVisible().catch(() => false)) await collapse.click();
}

async function collapseRibbon(page: Page): Promise<void> {
  const collapse = page.locator('button[title="Collapse ribbon"]');
  if (await collapse.isVisible().catch(() => false)) await collapse.click();
}

async function expandRibbon(page: Page): Promise<void> {
  const show = page.locator('button[title="Show ribbon"]');
  if (await show.isVisible().catch(() => false)) await show.click();
}

/** Rebuild a seeded surface through the shipped Surface manager. */
async function rebuildSurface(page: Page, surfaceName: string, surfaceId: string): Promise<void> {
  await expandRibbon(page);
  await ribbonTab(page, 'Surface').click();
  await page.getByRole('button', { name: 'Add Point Group' }).first().click();
  const manager = surfaceManagerScope(page);
  await expect(manager).toBeVisible({ timeout: 10000 });
  await manager.locator('ul button', { hasText: surfaceName }).click();
  await manager.getByRole('button', { name: 'Rebuild', exact: true }).click();
  await page.locator('[aria-label="Toolspace tabs"]').getByRole('tab', { name: 'Survey' }).click();
  await expect(toolspaceSurface(page, surfaceId)).toBeVisible({ timeout: 15000 });
  await expect.poll(() => surfaceStatus(page, surfaceId), { timeout: 60000 }).toBe('CURRENT');
  await collapseRibbon(page);
}

const rowText = (page: Page, id: string): (() => Promise<string>) =>
  () => page.locator(`[data-cad-grading-group-row="${id}"]`).innerText();

/**
 * Select a group row, clicking only when it is not already selected: at
 * 1366×768 a redundant row click can sit under a dock overlay forever
 * (intercepted pointer events), while selection itself already landed.
 */
const selectGroupRow = async (page: Page, id: string): Promise<void> => {
  const row = page.locator(`[data-cad-grading-group-row="${id}"]`);
  if ((await row.getAttribute('data-selected')) !== 'true') {
    await row.scrollIntoViewIfNeeded().catch(() => undefined);
    await row.click({ timeout: 8000 }).catch(async () => {
      console.log(`ROW-CLICK-FALLBACK dispatched click for ${id}`);
      await row.dispatchEvent('click');
    });
  }
  await expect(row).toHaveAttribute('data-selected', 'true', { timeout: 15000 });
};

/**
 * Click a manager action button. At 1366×768 the floating manager extends
 * under the dock tab bars, so covered buttons fall back to a dispatched
 * click (the seam still fires honestly); every fallback is logged for the
 * visual-QA record as a small-viewport overlap gap.
 */
const managerClick = async (page: Page, locator: string): Promise<void> => {
  const button = page.locator(locator);
  await expect(button).toBeVisible({ timeout: 15000 });
  await button.scrollIntoViewIfNeeded();
  await button.click({ timeout: 8000 }).catch(async () => {
    console.log(`MANAGER-CLICK-FALLBACK dispatched click for ${locator}`);
    await button.dispatchEvent('click');
  });
};

const calculateAndWait = async (
  page: Page, gradingId: string, want: RegExp,
): Promise<string> => {
  await selectGroupRow(page, gradingId);
  // RowActions render for the selected row only, so the action buttons are
  // unique document-wide; keep the locator unscoped (a scoped
  // `[data-cad-grading-group-actions="id"] …` descendant never resolves
  // under the Playwright CSS engine even though raw querySelector matches).
  await managerClick(page, '[data-cad-grading-group-calculate]');
  await expect.poll(rowText(page, gradingId), { timeout: 60000 }).toMatch(want);
  return rowText(page, gradingId)();
};

// Site drawing entity bounds (EG points dominate): x -40..180, y -40..120.
// Mirrors SurveyCadPreview.geometry project(): 8% margin, padding 36,
// viewBox 900×520, initial zoom 1 / pan 0.
const SITE_BOUNDS = { minX: -40, minY: -40, maxX: 180, maxY: 120 };

const worldToClient = async (
  page: Page, wx: number, wy: number,
): Promise<{ x: number; y: number }> => {
  const rect = await viewportBox(page).locator('svg').first().boundingBox();
  if (!rect) throw new Error('viewport svg has no bounding box');
  const width = SITE_BOUNDS.maxX - SITE_BOUNDS.minX;
  const height = SITE_BOUNDS.maxY - SITE_BOUNDS.minY;
  const nminX = SITE_BOUNDS.minX - width * 0.08;
  const nminY = SITE_BOUNDS.minY - height * 0.08;
  const baseScale = Math.min(828 / (width * 1.16), 448 / (height * 1.16));
  const viewX = 36 + (wx - nminX) * baseScale;
  const viewY = 484 - (wy - nminY) * baseScale;
  const sf = Math.min(rect.width / 900, rect.height / 520);
  const offsetX = (rect.width - 900 * sf) / 2;
  const offsetY = (rect.height - 520 * sf) / 2;
  return { x: rect.x + offsetX + viewX * sf, y: rect.y + offsetY + viewY * sf };
};

/** Cursor-anchored wheel zoom at a world point; viewport-only capture; exact zoom-out restore. */
const zoomShot = async (
  page: Page, testInfo: TestInfo, name: string, wx: number, wy: number, notches = 14,
): Promise<void> => {
  const anchor = await worldToClient(page, wx, wy);
  await page.mouse.move(anchor.x, anchor.y);
  for (let i = 0; i < notches; i += 1) await page.mouse.wheel(0, -120);
  await page.waitForTimeout(500);
  await capture(page, testInfo, name, viewportBox(page));
  const restore = await worldToClient(page, wx, wy);
  await page.mouse.move(restore.x, restore.y);
  for (let i = 0; i < notches; i += 1) await page.mouse.wheel(0, 120);
  await page.waitForTimeout(500);
};

const RESOLUTIONS = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
] as const;

for (const resolution of RESOLUTIONS) {
  test.describe(`Phase 20C visual QA @ ${resolution.width}x${resolution.height}`, () => {
    test.use({ viewport: { width: resolution.width, height: resolution.height } });

    test(`visual sweep ${resolution.width}x${resolution.height}`, async ({ page }, testInfo) => {
      test.setTimeout(300_000);
      const errors: string[] = [];
      const siteProject = buildSiteProject();
      const gid = (name: string): string => {
        const found = siteProject.gradingGroups!.find((g) => g.name === name);
        if (!found) throw new Error(`no group named ${name}`);
        return found.id;
      };
      const G_PAD = gid('Pad grade');
      const G_CUT = gid('North cut');
      const G_SWALE = gid('Swale cutfill');
      const G_ENTRY = gid('Entrance');
      const sitePath = writeDrawing(siteProject, 'grading-groups-20c');

      // 1. Source pad: plan as opened (pad + EG points + parcel context).
      await bootCad(page, errors);
      await openSurveyPlanDrawing(page, sitePath);
      await expect.poll(() => entityCount(page), { timeout: 30000 }).toBeGreaterThan(0);
      await collapseFloatingPanel(page);
      await capture(page, testInfo, 'source-pad');

      // Build the EG target (UNBUILT on open) so groups can calculate.
      // Future stays UNBUILT for the target-stale view.
      await rebuildSurface(page, 'EG', 'srf-eg');
      await collapseFloatingPanel(page);

      // 2. Manager: 4-row definition table before any calculation.
      await openGroupManager(page);
      await capture(page, testInfo, 'manager');

      // 3. Span selection: pad source, first→last course span preview.
      await page.getByLabel('Source feature line').selectOption('fl-pad');
      await page.getByLabel('Closed span mode').selectOption('all');
      await page.getByLabel('First course').selectOption('0');
      await page.getByLabel('Last course').selectOption('5');
      await expect(page.locator('[data-cad-grading-group-span-preview]')).toContainText('6 courses');
      await capture(page, testInfo, 'span-selection');

      // 4. Side-preview arrows: selected uncalculated pad renders ghosts.
      await selectGroupRow(page, G_PAD);
      await expect(page.locator('[data-cad-grading-group-ghost-note]')).toContainText('side-preview arrows');
      await closeGroupManager(page);
      await collapseFloatingPanel(page);
      await collapseRibbon(page);
      await capture(page, testInfo, 'side-preview', viewportBox(page));

      // 5-7. Calculate all four groups (worker, explicit only).
      await openGroupManager(page);
      await calculateAndWait(page, G_PAD, /Current/);
      await closeGroupManager(page);
      await collapseFloatingPanel(page);
      await collapseRibbon(page);
      // 5. Convex SE pad corner (90,20): exact GAP miter close-up.
      await zoomShot(page, testInfo, 'convex-closeup', 90, 20);
      // 6. Concave notch corner (60,40): OVERLAP trim close-up.
      await zoomShot(page, testInfo, 'concave-closeup', 60, 40);
      // 7. Curved entrance indicator: arc region + approximated corner.
      await zoomShot(page, testInfo, 'curved-corner', 130, 40);
      await expandRibbon(page);
      await collapseFloatingPanel(page);

      await openGroupManager(page);
      await calculateAndWait(page, G_CUT, /Current/);
      await calculateAndWait(page, G_SWALE, /Current/);
      const entryStatus = await calculateAndWait(page, G_ENTRY, /Current|Curve Approximated|Failed/);
      testInfo.annotations.push({ type: 'entrance-status', description: entryStatus.split('\n')[0] ?? '' });
      console.log(`ENTRANCE-STATUS ${entryStatus.split('\n')[0] ?? ''}`);

      // 8. Baked Surface: Pad CURRENT mesh frozen to an explicit TIN.
      const surfaceCount = (): Promise<number> =>
        page.locator('[data-cad-toolspace] [data-cad-surface]').count();
      const surfacesBefore = await surfaceCount();
      await selectGroupRow(page, G_PAD);
      await managerClick(page, '[data-cad-grading-group-bake]');
      await expect.poll(surfaceCount, { timeout: 30000 }).toBeGreaterThan(surfacesBefore);
      await capture(page, testInfo, 'baked-surface');

      // 9. Target-stale: Pad retargeted to the UNBUILT Future surface.
      await selectGroupRow(page, G_PAD);
      await page.locator('[data-cad-grading-group-change-target]').selectOption('srf-future');
      await expect.poll(rowText(page, G_PAD), { timeout: 30000 }).toMatch(/Future/);
      // Retargeting to the UNBUILT Future surface answers honestly.
      await expect.poll(rowText(page, G_PAD), { timeout: 30000 }).toMatch(/Source Not Current/);
      await capture(page, testInfo, 'target-stale');

      // 10. Final sheet: separate drawing with the pre-baked pad + C-101.
      await openSurveyPlanDrawing(page, writeSheetDrawing());
      await rebuildSurface(page, 'EG', 'srf-eg');
      await expandRibbon(page);
      await ribbonTab(page, 'Surface').click();
      await page.getByRole('button', { name: 'Add Point Group' }).first().click();
      await expect(surfaceManagerScope(page)).toBeVisible({ timeout: 10000 });
      await surfaceManagerScope(page).locator('ul button', { hasText: 'Pad grade - Baked' }).click();
      await surfaceManagerScope(page).getByRole('button', { name: 'Rebuild', exact: true }).click();
      await expect.poll(async () => {
        const rows = await page.$$eval(
          '[data-cad-toolspace] [data-cad-surface]',
          (elements) => elements.map((element) => [
            element.getAttribute('data-cad-surface'),
            element.getAttribute('data-cad-surface-status'),
          ]),
        );
        const baked = rows.find(([id]) => id !== null && !['srf-eg', 'srf-future'].includes(id!));
        return baked ? (baked[1] ?? '') : '';
      }, { timeout: 60000 }).toBe('CURRENT');
      // Collapse the ribbon so the sheet viewport dominates the capture at
      // every resolution (at 1366 the open ribbon squeezes it to a sliver).
      await collapseRibbon(page);
      await collapseFloatingPanel(page);
      await layoutTab(page, 'C-101').click({ timeout: 10000 });
      await expect.poll(() => sheetGeometryCount(page), { timeout: 15000 }).toBeGreaterThan(5);
      await capture(page, testInfo, 'final-sheet');

      expect(errors).toEqual([]);
    });
  });
}
