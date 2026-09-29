/**
 * Phase 20E Wave-5 visual QA — per-course grading criteria + planar/design
 * pads at 1366×768, 1920×1080, and 2560×1440.
 *
 * Every view attaches to the test report (CI-safe). When WRITE_20E_EVIDENCE=1
 * the same PNGs are also written to docs/evidence/phase20e/ for the
 * visual-qa.md record.
 *
 * Scene (production seams only: PARCEL_CREATE / GROUP_CREATE commands, WNCAD
 * loader): explicit-TIN EG target (flat step grid, every locus line on a
 * target edge), a coarse 2-triangle EG twin (the design-copy source — the 18Y
 * compose exact predicates self-hit on a same-surface diagonal, per the
 * Wave-1C oracle), a closed flat 120×80 building-pad feature line (z=10, a
 * real level pad), a single-course sloped access ramp feature line (z 12→6,
 * no corner — a closed sloped source fails CORNER_NO_SOLUTION, recorded as an
 * engine limitation), parcel context, and a CL-Pad alignment crossing the pad.
 *
 * The per-course override is applied through the LIVE Wave-2A criteria editor
 * (tick Course 2 → fixed −1.0 → Apply to Selected = one
 * GROUP_SET_COURSE_CRITERIA transaction), then the group is calculated and the
 * unequal-slope corner is zoomed. This is the only closed-pad configuration
 * that solves headless (verified by probe: flat closed pad + one override on
 * the east 80 m course → GAP miter, area 8400.000 m²). Two overrides and any
 * non-flat closed source fail closed (MEMBER/CORNER_NO_SOLUTION), so the
 * Planar/Undefined interior-badge branches are covered by the unit test
 * (tests/cad_grading_group_course_ui_20e.test.tsx) and the engine-seam letters
 * in tests-browser/cad-grading-advanced-20e.spec.ts — NOT by a live capture.
 *
 * The final sheet is a separate Node-staged drawing (full engine apply +
 * C-101 with viewport, title block, North Arrow, Scale Bar).
 *
 * §103 view map: 1 EG surface, 2 sloped-pad feature line, 3 group with
 * per-course overrides (03/04/05), 4 unequal-slope corner, 5 planar patch
 * (07: live Flat badge; Planar/Undefined not live-capturable), 6 design
 * surface, 7 contours, 8 volume, 9 section, 10 sheet, 11 → the 1366-width
 * manager-guard DOM assertion (no PNG).
 */
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  createBlankCadDrawingDocument,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { buildCadSurface, computeCadSurfaceSourceRevision } from '../src/engine/cad/cadSurfaces';
import { createCadHistoryState, runCadCommand } from '../src/engine/cad/cadUndoRedo';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import type {
  CadFeatureLineEntity,
  CadLineEntity,
  CadProject,
  CadSurface,
  ImportedTinPayload,
} from '../src/engine/cad/cadTypes';
import { SURFACE_STYLE_CONTOURS_ID, SURFACE_STYLE_TRIANGLES_ID } from '../src/engine/cad/cadSurfaceStyles';
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
import { entityCount, homeTab, openSurveyPlanDrawing } from './cad-survey-plan-19a-helpers';
import { layoutTab, sheetGeometryCount } from './cad-sheet-layout-19b-helpers';

const EVIDENCE_DIR = path.resolve(process.cwd(), 'docs/evidence/phase20e');
const WRITE_EVIDENCE = process.env.WRITE_20E_EVIDENCE === '1';

const range = (a: number, b: number, s: number): number[] => {
  const out: number[] = [];
  for (let v = a; v <= b + 1e-9; v += s) out.push(v);
  return out;
};

/** Flat step grid: every locus line coincides with a target edge (deterministic ties). */
const gridTin = (minX: number, minY: number, maxX: number, maxY: number, step = 20): ImportedTinPayload => {
  const xs = range(minX, maxX, step);
  const ys = range(minY, maxY, step);
  const vertices: number[] = [];
  for (const y of ys) for (const x of xs) vertices.push(x, y, 0);
  const idx = (ix: number, iy: number): number => iy * xs.length + ix;
  const faces: number[] = [];
  for (let ix = 0; ix + 1 < xs.length; ix += 1) {
    for (let iy = 0; iy + 1 < ys.length; iy += 1) {
      const a = idx(ix, iy);
      const b = idx(ix + 1, iy);
      const c = idx(ix + 1, iy + 1);
      const d = idx(ix, iy + 1);
      faces.push(a, b, c, a, c, d);
    }
  }
  return {
    vertices,
    faces,
    provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
  };
};

const tinSurface = (id: string, name: string, payload: ImportedTinPayload, styleId = SURFACE_STYLE_TRIANGLES_ID): CadSurface => ({
  id,
  name,
  layerId: 'general',
  styleId,
  definition: {
    sourceKind: 'explicit-tin',
    pointSource: { kind: 'points', pointEntityIds: [] },
    importedTin: payload,
  },
  cachedRevision: null,
});

const lotLine = (id: string, fx: number, fy: number, tx: number, ty: number): CadLineEntity => ({
  id, type: 'line', layerId: 'general', visible: true, locked: false,
  fromStationId: `${id}-a`, toStationId: `${id}-b`,
  fromX: fx, fromY: fy, toX: tx, toY: ty, sourceObservationIds: [],
});

const V = (id: string, x: number, y: number, z: number) => ({ id, x, y, z });

const PAD_VERTEX_IDS = ['v0', 'v1', 'v2', 'v3'] as const;
const PAD_COURSES = PAD_VERTEX_IDS.map((id, i) => ({
  vertexAId: id,
  vertexBId: PAD_VERTEX_IDS[(i + 1) % PAD_VERTEX_IDS.length]!,
}));
/** The east 80 m course (Course 2) carries the live override. */
const OVERRIDE_COURSES = [PAD_COURSES[1]!];

const padFeatureLine = (): CadFeatureLineEntity => ({
  id: 'fl-pad', type: 'feature-line', layerId: 'feature-lines', visible: true, locked: false,
  name: 'Pad', closed: true,
  vertices: [V('v0', 0, 0, 10), V('v1', 120, 0, 10), V('v2', 120, 80, 10), V('v3', 0, 80, 10)],
});

/** Single-course sloped access ramp (z 12→6): a genuine sloped feature line. */
const rampFeatureLine = (): CadFeatureLineEntity => ({
  id: 'fl-ramp', type: 'feature-line', layerId: 'feature-lines', visible: true, locked: false,
  name: 'Ramp',
  vertices: [V('r0', -20, 120, 12), V('r1', 120, 120, 6)],
});

/** Live site project: EG grid + coarse twin, level pad (no override yet), sloped ramp, parcel, CL-Pad. */
const buildSiteProject = (): CadProject => {
  const document = createBlankCadDrawingDocument({ name: 'Grading 20E Visual', units: 'm' });
  const base: CadProject = {
    ...document.project,
    entities: [
      padFeatureLine(),
      rampFeatureLine(),
      lotLine('lot:s', -40, -40, 160, -40),
      lotLine('lot:e', 160, -40, 160, 140),
      lotLine('lot:n', 160, 140, -40, 140),
      lotLine('lot:w', -40, 140, -40, -40),
      lotLine('cl-pad-line', -40, 40, 180, 40),
      {
        id: 'align-cl', type: 'alignment', layerId: 'general', visible: true, locked: false,
        name: 'CL-Pad',
        elements: [{ kind: 'line', start: { x: -40, y: 40 }, end: { x: 180, y: 40 } }],
        startStation: 0,
      },
    ],
    surfaces: [
      tinSurface('srf-eg', 'EG', gridTin(-60, -60, 180, 140)),
      tinSurface('srf-base', 'EG Coarse', {
        vertices: [-60, -60, 0, 220, -60, 0, 220, 160, 0, -60, 160, 0],
        faces: [0, 1, 2, 0, 2, 3],
        provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
      }, SURFACE_STYLE_CONTOURS_ID),
    ],
  };
  let history = runCadCommand(createCadHistoryState(base, []), {
    key: 'PARCEL_CREATE',
    sourceEntityIds: ['lot:s', 'lot:e', 'lot:n', 'lot:w'],
  });
  history = runCadCommand(history, {
    key: 'GROUP_CREATE',
    name: 'Pad', sourceFeatureLineId: 'fl-pad',
    sourceCourses: PAD_COURSES.map((course) => ({ ...course })),
    targetSurfaceId: 'srf-eg', side: 'right',
    criterion: { kind: 'fixed', gradeRatio: -0.5 },
    maxSearchDistance: 50, curveChordTolerance: 0.05, closed: true,
  });
  history = runCadCommand(history, {
    key: 'GROUP_CREATE',
    name: 'Ramp', sourceFeatureLineId: 'fl-ramp',
    sourceCourses: [{ vertexAId: 'r0', vertexBId: 'r1' }],
    targetSurfaceId: 'srf-eg', side: 'right',
    criterion: { kind: 'fixed', gradeRatio: -0.5 },
    maxSearchDistance: 50, curveChordTolerance: 0.05,
  });
  return history.present.project;
};

const writeDrawing = (project: CadProject, name: string): string => {
  const document = createBlankCadDrawingDocument({ name, units: 'm' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-20e-vis-'));
  const filePath = path.join(dir, `${name}.wncad`);
  fs.writeFileSync(filePath, serializeCadDrawingFile({ ...document, project }), 'utf8');
  return filePath;
};

/** Final sheet: Node-staged override pad → patch → design apply → contours → C-101. */
const writeSheetDrawing = (): string => {
  const site = buildSiteProject();
  const groupId = site.gradingGroups!.find((g) => g.name === 'Pad')!.id;
  // Carry the same live override (Course 2, fixed −1.0) so the staged sheet
  // matches the captured live scene byte-for-byte.
  const authored: CadProject = {
    ...site,
    gradingGroups: site.gradingGroups!.map((group) =>
      group.id === groupId
        ? { ...group, courseCriteria: OVERRIDE_COURSES.map((course) => ({ sourceCourse: { ...course }, criterion: { kind: 'fixed' as const, gradeRatio: -1.0 } })) }
        : group,
    ),
  };
  const inputs = resolveGroupInputs(authored, groupId);
  if (!inputs) throw new Error('pad inputs unresolvable');
  const target = authored.surfaces!.find((s) => s.id === inputs.target.id)!;
  const built = buildCadSurface(authored, target);
  if (built.outcome !== 'ok') throw new Error('EG build failed');
  const outcome = computeGradingGroupFromSnapshots({
    groupId, revision: inputs.revision,
    members: inputs.memberSources, side: inputs.group.side, criterion: inputs.group.criterion,
    ...(inputs.memberCriteria !== undefined ? { memberCriteria: inputs.memberCriteria } : {}),
    maxSearchDistance: inputs.group.maxSearchDistance,
    curveChordTolerance: inputs.group.curveChordTolerance,
    closed: true,
    target: {
      points: built.points.flatMap((p) => [p.x, p.y, p.z]),
      triangles: built.triangles.flatMap((tri) => [...tri]),
    },
  });
  if (!outcome.ok) throw new Error(`pad compute failed: ${outcome.code} ${outcome.detail ?? ''}`);
  const revOf = (project: CadProject, id: string): string =>
    computeCadSurfaceSourceRevision(project, project.surfaces!.find((s) => s.id === id)!);
  let history = runCadCommand(createCadHistoryState(authored), {
    key: 'DESIGNPATCH', groupId, result: outcome.result,
    expectedRevision: inputs.revision, sessionCurrent: true,
  });
  const patchId = history.present.project.surfaces!.find((s) => s.name === 'Pad - Design Patch')!.id;
  history = runCadCommand(history, {
    key: 'DESIGNSURFACE', sourceSurfaceId: 'srf-base', name: 'Site Design',
    expectedRevision: revOf(history.present.project, 'srf-base'), sessionCurrent: true,
  });
  const designId = history.present.project.surfaces!.find((s) => s.name === 'Site Design')!.id;
  history = runCadCommand(history, {
    key: 'DESIGNAPPLY',
    targetSurfaceId: designId, targetExpectedRevision: revOf(history.present.project, designId),
    patchSurfaceId: patchId, patchExpectedRevision: revOf(history.present.project, patchId),
    sessionCurrent: true,
  });
  history = runCadCommand(history, { key: 'SURFPURPOSE', surfaceId: 'srf-eg', purpose: 'existing-ground' });
  let staged = history.present.project;
  // Enable contours on the design surface style live-staged (same seam the
  // Surface manager uses) so the sheet carries real contour geometry.
  staged = {
    ...staged,
    surfaces: (staged.surfaces ?? []).map((surface) =>
      surface.id === designId
        ? { ...surface, styleId: SURFACE_STYLE_CONTOURS_ID }
        : surface,
    ),
  };
  const document = createBlankCadDrawingDocument({ name: 'Grading Sheet 20E', units: 'm' });
  const draft = document.draft;
  if (!draft) throw new Error('blank drawing has no draft');
  const withSheet = addSheetToDraft(
    draft, createPlanSheet({ name: 'C-101', sizeId: 'ISO A3', orientation: 'landscape' }),
  );
  const sheet = withSheet.sheets[withSheet.sheets.length - 1];
  if (!sheet) throw new Error('sheet not created');
  const withViewport = addViewportToSheet(withSheet, sheet.id, {
    name: 'VP-1', modelCenterX: 60, modelCenterY: 50, scaleDenominator: 500,
    paperXmm: 30, paperYmm: 30, paperWidthMm: 330, paperHeightMm: 210, rotationDeg: 0,
  });
  const viewport = withViewport.sheets.find((entry) => entry.id === sheet.id)?.viewports.at(-1);
  if (!viewport) throw new Error('viewport not created');
  let next = addSheetObject(withViewport, sheet.id, defaultNorthArrowObject(viewport));
  next = addSheetObject(next, sheet.id, defaultScaleBarObject(viewport));
  const template = createTitleBlockTemplate('TB-C101');
  next = { ...next, titleBlockDefinitions: [...next.titleBlockDefinitions, template] };
  next = assignTitleBlockToSheet(next, sheet.id, template.id);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-20e-vis-'));
  const filePath = path.join(dir, 'grading-sheet-20e.wncad');
  fs.writeFileSync(
    filePath,
    serializeCadDrawingFile({ ...document, project: staged, draft: next }),
    'utf8',
  );
  return filePath;
};

// ---------------------------------------------------------------------------
// Capture + shell helpers
// ---------------------------------------------------------------------------

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
const managerScope = (page: Page): Locator => page.locator('section[aria-label="Grading group manager"]');
const designWorkflow = (page: Page): Locator => page.locator('section[aria-label="Design workflow"]');
const surfaceManagerScope = (page: Page): Locator => page.locator('section[aria-label="Surface manager"]');

function ribbonTab(page: Page, name: string) {
  return page.locator('[aria-label="Ribbon tabs"]').getByRole('tab', { name });
}

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

async function openSurfaceManager(page: Page): Promise<void> {
  await expandRibbon(page);
  await ribbonTab(page, 'Surface').click();
  await page.getByRole('button', { name: 'Add Points' }).first().click();
  await expect(surfaceManagerScope(page)).toBeVisible({ timeout: 10000 });
}

async function toolspaceSurfaceIdByName(page: Page, name: string): Promise<string> {
  const ids = await page.$$eval(
    '[data-cad-toolspace] [data-cad-surface]',
    (elements, wanted) => elements
      .filter((element) => (element.textContent ?? '').includes(wanted))
      .map((element) => element.getAttribute('data-cad-surface') ?? ''),
    name,
  );
  const found = ids.find((id) => id !== '');
  if (!found) throw new Error(`no toolspace surface named ${name}`);
  return found;
}

/** Rebuild a seeded surface through the shipped Surface manager. */
async function rebuildSurface(page: Page, surfaceName: string, surfaceId: string): Promise<string> {
  await openSurfaceManager(page);
  const manager = surfaceManagerScope(page);
  await manager.locator(`ul button[aria-label^="Surface ${surfaceName},"]`).click();
  await manager.getByRole('button', { name: 'Rebuild', exact: true }).click();
  await page.locator('[aria-label="Toolspace tabs"]').getByRole('tab', { name: 'Survey' }).click();
  await expect.poll(
    async () => (await page.locator(`[data-cad-toolspace] [data-cad-surface="${surfaceId}"]`).getAttribute('data-cad-surface-status')) ?? '',
    { timeout: 90000 },
  ).toBe('CURRENT');
  return 'CURRENT';
}

const panelClick = async (scope: Locator, name: string): Promise<void> => {
  const button = scope.getByRole('button', { name });
  await expect(button).toBeVisible({ timeout: 15000 });
  await button.scrollIntoViewIfNeeded().catch(() => undefined);
  await button.click({ timeout: 8000 }).catch(async () => {
    console.log(`PANEL-CLICK-FALLBACK dispatched click for ${name}`);
    await button.dispatchEvent('click');
  });
};

const managerClick = async (page: Page, locator: string): Promise<void> => {
  const button = page.locator(locator);
  await expect(button).toBeVisible({ timeout: 15000 });
  await button.scrollIntoViewIfNeeded().catch(() => undefined);
  await button.click({ timeout: 8000 }).catch(async () => {
    console.log(`MANAGER-CLICK-FALLBACK dispatched click for ${locator}`);
    await button.dispatchEvent('click');
  });
};

async function openGradingManager(page: Page): Promise<void> {
  await expandRibbon(page);
  await homeTab(page);
  await page.locator('[data-cad-grading-group-command="GRADINGGROUP"]').click();
  await expect(managerScope(page)).toBeVisible({ timeout: 15000 });
}

const clickWithFallback = async (locator: Locator, label: string): Promise<void> => {
  await locator.scrollIntoViewIfNeeded().catch(() => undefined);
  await locator.click({ timeout: 6000 }).catch(async () => {
    console.log(`CLICK-FALLBACK dispatched click for ${label}`);
    await locator.dispatchEvent('click');
  });
};

/** Record what the live SVG viewport actually contains (grounds the capture). */
const recordViewport = async (
  page: Page, testInfo: TestInfo, label: string,
): Promise<void> => {
  const facts = await page.evaluate(() => {
    const count = (selector: string): number => document.querySelectorAll(selector).length;
    const viewport = document.querySelector('[data-cad-viewport]') as HTMLElement | null;
    return {
      surfaces: count('[data-surface-layer]'),
      contourLayers: count('[data-surface-contours="true"]'),
      contourLabels: count('[data-surface-layer] text'),
      groupLayers: count('[data-grading-group-layer]'),
      groupFills: count('[data-grading-group-kind="fill"]'),
      viewportH: viewport?.clientHeight ?? 0,
      windowH: window.innerHeight,
    };
  });
  const line = `VIEWPORT ${label} surfaces=${facts.surfaces} contourLayers=${facts.contourLayers} contourLabels=${facts.contourLabels} groupLayers=${facts.groupLayers} groupFills=${facts.groupFills} viewportH=${facts.viewportH}/${facts.windowH}`;
  console.log(line);
  testInfo.annotations.push({ type: 'viewport-facts', description: line });
};

/** 1366-width usability guard: floating manager + criteria table stay inside the viewport. */
const assertManagerWidthGuard = async (
  page: Page, testInfo: TestInfo, when: string,
): Promise<void> => {
  const size = page.viewportSize();
  if (!size) throw new Error('no viewport size');
  const box = await managerScope(page).boundingBox();
  if (!box) throw new Error('manager has no bounding box');
  const right = box.x + box.width;
  const docScroll = await page.evaluate(() => document.documentElement.scrollWidth);
  const criteriaScroll = await page.evaluate(() => {
    const table = document.querySelector('[data-cad-grading-group-criteria] table');
    return table ? (table as HTMLElement).scrollWidth : 0;
  });
  const line = `MANAGER-GUARD ${when} @ ${size.width} manager x=${box.x.toFixed(0)} w=${box.width.toFixed(0)} right=${right.toFixed(0)} docScroll=${docScroll} criteriaScroll=${criteriaScroll}`;
  console.log(line);
  testInfo.annotations.push({ type: 'manager-guard', description: line });
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(right).toBeLessThanOrEqual(size.width + 1);
  expect(docScroll).toBeLessThanOrEqual(size.width + 1);
};

/** Zoom the viewport anchored on a page point, capture, then restore exactly. */
const zoomShotAt = async (
  page: Page, testInfo: TestInfo, name: string, x: number, y: number, notches: number,
): Promise<void> => {
  await page.mouse.move(x, y);
  for (let i = 0; i < notches; i += 1) await page.mouse.wheel(0, -120);
  await page.waitForTimeout(500);
  await capture(page, testInfo, name, viewportBox(page));
  await page.mouse.move(x, y);
  for (let i = 0; i < notches; i += 1) await page.mouse.wheel(0, 120);
  await page.waitForTimeout(500);
};

/** Zoom on a world point derived from the rendered pad bounding box (robust anchor). */
const zoomPadCorner = async (
  page: Page, testInfo: TestInfo, name: string, corner: 'center' | 'se', notches: number,
): Promise<void> => {
  const box = await page.locator('[data-survey-cad-render-entity-id="fl-pad"]').first().boundingBox();
  if (!box) throw new Error('pad render path has no bounding box');
  const x = corner === 'center' ? box.x + box.width / 2 : box.x + box.width - 4;
  const y = corner === 'center' ? box.y + box.height / 2 : box.y + box.height - 4;
  await zoomShotAt(page, testInfo, name, x, y, notches);
};

const RESOLUTIONS = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
] as const;

for (const resolution of RESOLUTIONS) {
  test.describe(`Phase 20E visual QA @ ${resolution.width}x${resolution.height}`, () => {
    test.use({ viewport: { width: resolution.width, height: resolution.height } });

    test(`visual sweep ${resolution.width}x${resolution.height}`, async ({ page }, testInfo) => {
      test.setTimeout(300_000);
      const errors: string[] = [];
      const siteProject = buildSiteProject();
      const groupId = siteProject.gradingGroups!.find((g) => g.name === 'Pad')!.id;
      const rampId = siteProject.gradingGroups!.find((g) => g.name === 'Ramp')!.id;
      const sitePath = writeDrawing(siteProject, 'grading-20e-visual');

      // §103.1 EG surface: open + rebuild the EG target, capture the TIN.
      await bootCad(page, errors);
      await openSurveyPlanDrawing(page, sitePath);
      await expect.poll(() => entityCount(page), { timeout: 30000 }).toBeGreaterThan(0);
      await collapseFloatingPanel(page);
      await rebuildSurface(page, 'EG', 'srf-eg');
      // Rebuild the coarse twin too: the Design Copy requires a CURRENT source.
      await rebuildSurface(page, 'EG Coarse', 'srf-base');
      await collapseFloatingPanel(page);
      await collapseRibbon(page);
      await capture(page, testInfo, '01-eg-surface', viewportBox(page));
      await recordViewport(page, testInfo, '01-eg-surface');

      // §103.2 Sloped-pad feature line: zoom the level pad + sloped ramp in plan.
      await zoomPadCorner(page, testInfo, '02-pad-feature-line', 'center', 7);

      // §103.3 Group with per-course overrides — the Wave-2A criteria editor.
      await openGradingManager(page);
      await assertManagerWidthGuard(page, testInfo, 'criteria-default');
      const rampRow = page.locator(`[data-cad-grading-group-row="${rampId}"]`);
      await expect(rampRow).toContainText('Ramp');
      // Select the Pad row, then open the Course Criteria tab.
      const padRow = page.locator(`[data-cad-grading-group-row="${groupId}"]`);
      if ((await padRow.getAttribute('data-selected')) !== 'true') {
        await padRow.scrollIntoViewIfNeeded().catch(() => undefined);
        await padRow.click({ timeout: 8000 }).catch(async () => {
          console.log('ROW-CLICK-FALLBACK dispatched click for Pad');
          await padRow.dispatchEvent('click');
        });
      }
      await managerClick(page, '[data-cad-grading-group-tab="criteria"]');
      const criteria = page.locator('[data-cad-grading-group-criteria]').first();
      await expect(criteria).toBeVisible({ timeout: 15000 });
      await expect(page.locator('[data-cad-grading-group-criteria-row]')).toHaveCount(4);
      await expect(criteria).toContainText('Overrides: 0');
      await expect(criteria).toContainText('Fixed -50.000% (0.500H:1V)');
      // No raw ids reach the table (human Course N / V-short labels only).
      await expect(criteria).not.toContainText('fl-pad');
      await expect(criteria).not.toContainText('vertexAId');
      await capture(page, testInfo, '03-criteria-default');

      // Apply the override through the live editor: tick Course 2, fixed −1.0,
      // one GROUP_SET_COURSE_CRITERIA transaction.
      await clickWithFallback(page.getByLabel('Select Course 2'), 'Select Course 2');
      await page.getByLabel('Override fixed percent').fill('-100');
      await managerClick(page, '[data-cad-grading-group-criteria-apply-selected]');
      await expect(page.locator('[data-cad-grading-group-criteria-row="1"]')).toContainText('Override');
      await expect(page.locator('[data-cad-grading-group-criteria-reset="1"]')).toBeVisible();
      await expect(criteria).toContainText('Overrides: 1');
      await expect(criteria).toContainText('Fixed -100.000% (1.000H:1V)');
      await expect(page.locator('[data-cad-grading-group-criteria-row="0"]')).toContainText('Default');
      const rows = await page.locator('[data-cad-grading-group-criteria-row]').allInnerTexts();
      const overrideRows = await page.locator('[data-cad-grading-group-criteria-reset]').count();
      const defaultRows = rows.length - overrideRows;
      testInfo.annotations.push({ type: 'criteria-rows', description: `rows=${rows.length} override=${overrideRows} default=${defaultRows}` });
      console.log(`CRITERIA-ROWS rows=${rows.length} override=${overrideRows} default=${defaultRows}`);
      const criteriaText = (await criteria.innerText()).replace(/\s+/g, ' ').trim();
      console.log(`CRITERIA-TEXT ${criteriaText}`);
      testInfo.annotations.push({ type: 'criteria-text', description: criteriaText });
      await capture(page, testInfo, '04-criteria-override');

      // §103.3 Calculate the overridden pad (explicit, worker).
      await padRow.scrollIntoViewIfNeeded().catch(() => undefined);
      await managerClick(page, '[data-cad-grading-group-calculate]');
      await expect.poll(() => padRow.innerText(), { timeout: 90000 }).toMatch(/Current/);
      await expect(padRow).toContainText('8400.0');
      const groupText = (await padRow.innerText()).replace(/\s+/g, ' ').trim();
      console.log(`GROUP-ROW ${groupText}`);
      testInfo.annotations.push({ type: 'group-row', description: groupText });
      await capture(page, testInfo, '05-group-current');

      // §103.4 Unequal-slope corner: zoom the SE pad corner where the default
      // −50% course meets the overridden −100% course.
      await managerClick(page, 'section[aria-label="Grading group manager"] button:has-text("Close")');
      await expect(managerScope(page)).toBeHidden({ timeout: 10000 });
      await collapseFloatingPanel(page);
      await collapseRibbon(page);
      await zoomPadCorner(page, testInfo, '06-unequal-corner', 'se', 11);
      await recordViewport(page, testInfo, '06-unequal-corner');

      // §103.5 Design patch + interior badge (Flat, z = 10.000 m).
      await expandRibbon(page);
      await openSurfaceManager(page);
      const workflow = designWorkflow(page);
      await expect(workflow).toBeVisible({ timeout: 15000 });
      await workflow.getByLabel('Design surface').selectOption('srf-eg');
      await workflow.getByLabel('Surface purpose').selectOption('existing-ground');
      await panelClick(workflow, 'Set Surface Purpose');
      await workflow.getByLabel('Existing Ground surface').selectOption('srf-base');
      await workflow.getByLabel('Design copy name').fill('Site Design');
      await panelClick(workflow, 'Create Design Copy');
      await expect(surfaceManagerScope(page).locator('ul button', { hasText: 'Site Design [DESIGN]' })).toBeVisible({ timeout: 15000 });
      await workflow.getByLabel('Grading group').selectOption(groupId);
      await panelClick(workflow, 'Build Design Patch');
      await expect(surfaceManagerScope(page).locator('ul button', { hasText: 'Pad - Design Patch [PATCH]' })).toBeVisible({ timeout: 15000 });
      const interior = workflow.locator('dt', { hasText: 'Interior' }).locator('xpath=following-sibling::dd[1]');
      await expect(interior).toHaveText(/^Flat \(z = 10\.000 m\)$/, { timeout: 15000 });
      const interiorText = (await interior.innerText()).trim();
      console.log(`INTERIOR-BADGE ${interiorText}`);
      testInfo.annotations.push({ type: 'interior-badge', description: interiorText });
      await capture(page, testInfo, '07-design-patch');
      await recordViewport(page, testInfo, '07-design-patch');

      // §103.6 Design surface: rebuild copy + patch, preflight EXACT, apply.
      await rebuildSurface(page, 'Site Design', await toolspaceSurfaceIdByName(page, 'Site Design'));
      await rebuildSurface(page, 'Pad - Design Patch', await toolspaceSurfaceIdByName(page, 'Pad - Design Patch'));
      await openSurfaceManager(page);
      const workflow2 = designWorkflow(page);
      await workflow2.getByLabel('Design surface').selectOption({ label: 'Site Design [DESIGN]' });
      await workflow2.getByLabel('Patch surface').selectOption({ label: 'Pad - Design Patch [PATCH]' });
      await expect(workflow2).toContainText('EXACT', { timeout: 15000 });
      await panelClick(workflow2, 'Apply Patch');
      await collapseFloatingPanel(page);
      await collapseRibbon(page);
      await capture(page, testInfo, '08-design-surface', viewportBox(page));
      await recordViewport(page, testInfo, '08-design-surface');

      // §103.7 Contours: enable the contour display style on the design surface.
      await rebuildSurface(page, 'Site Design', await toolspaceSurfaceIdByName(page, 'Site Design'));
      await openSurfaceManager(page);
      const designRow = surfaceManagerScope(page).locator('ul button', { hasText: 'Site Design' }).first();
      await clickWithFallback(designRow, 'Site Design row');
      await expect(surfaceManagerScope(page).getByLabel('Show contours')).toBeVisible({ timeout: 15000 });
      const showContoursBox = surfaceManagerScope(page).getByLabel('Show contours');
      if (!(await showContoursBox.isChecked())) {
        await clickWithFallback(showContoursBox, 'Show contours');
      }
      const showContoursChecked = await showContoursBox.isChecked();
      console.log(`SHOW-CONTOURS-CHECKED ${showContoursChecked}`);
      testInfo.annotations.push({ type: 'show-contours-checked', description: String(showContoursChecked) });
      await surfaceManagerScope(page).getByLabel('Minor contour interval').fill('1');
      await panelClick(surfaceManagerScope(page), 'Apply geometry');
      await clickWithFallback(designRow, 'Site Design row');
      let contoursRendered = false;
      try {
        await page.locator('[data-surface-contours="true"]').first().waitFor({ state: 'attached', timeout: 20000 });
        contoursRendered = true;
      } catch {
        contoursRendered = false;
      }
      console.log(`CONTOURS-RENDERED ${contoursRendered}`);
      testInfo.annotations.push({ type: 'contours-rendered', description: String(contoursRendered) });
      await collapseFloatingPanel(page);
      await collapseRibbon(page);
      await capture(page, testInfo, '09-contours', viewportBox(page));
      await recordViewport(page, testInfo, '09-contours');

      // §103.8 Volume: track EG vs design and calculate explicitly.
      await openSurfaceManager(page);
      const workflow3 = designWorkflow(page);
      await workflow3.getByLabel('Existing Ground surface').selectOption('srf-eg');
      await workflow3.getByLabel('Design surface').selectOption({ label: 'Site Design [DESIGN]' });
      await panelClick(workflow3, 'Earthwork Volume');
      await panelClick(workflow3, 'Calculate Volume');
      await expect(workflow3).toContainText(/FILL [\d.]+ \/ CUT/, { timeout: 90000 });
      const volumeText = (await workflow3.locator('dt:has-text("Volume") + dd').innerText().catch(() => 'unread')).trim();
      console.log(`VOLUME ${volumeText}`);
      testInfo.annotations.push({ type: 'volume', description: volumeText });
      await capture(page, testInfo, '10-volume');

      // §103.9 Section: CL-Pad profile over the final design.
      await expect.poll(async () => page.locator('[data-cad-toolspace] [data-cad-volume]').count(), { timeout: 60000 }).toBeGreaterThan(0);
      await ribbonTab(page, 'Surface').click();
      await page.getByRole('button', { name: 'Profile Manager', exact: true }).first().click();
      const profileManager = page.locator('section[aria-label="Profile manager"]');
      const profileOpened = await profileManager.isVisible({ timeout: 10000 }).catch(() => false);
      if (profileOpened) {
        await profileManager.getByLabel('New profile name').fill('CL-Pad Design');
        await profileManager.getByLabel('New profile alignment').selectOption({ label: 'CL-Pad' });
        await profileManager.getByLabel('New profile surface').selectOption({ label: 'Site Design' });
        await profileManager.getByRole('button', { name: 'Create Surface Profile' }).click();
        const ids = await profileManager.locator('[data-profile-list] [data-cad-profile]').evaluateAll((elements) =>
          elements.map((element) => element.getAttribute('data-cad-profile') ?? ''));
        const createdId = ids.find((id) => id !== '');
        if (!createdId) throw new Error('no profile row after create');
        await profileManager.locator(`[data-profile-list] [data-cad-profile="${createdId}"]`).click();
        await profileManager.locator('[data-profile-detail]').getByRole('button', { name: 'Rebuild', exact: true }).click();
        await expect(profileManager.locator('[data-profile-stats]')).toContainText('Covered / gap', { timeout: 90000 });
        await collapseFloatingPanel(page);
        await collapseRibbon(page);
        await capture(page, testInfo, '11-section');
        testInfo.annotations.push({ type: 'profile', description: 'CL-Pad Design CURRENT with stats' });
      } else {
        console.log('PROFILE-MANAGER-NOT-OPENED at this resolution');
        testInfo.annotations.push({ type: 'profile', description: 'PROFILE-MANAGER-NOT-OPENED: honest gap' });
        await collapseRibbon(page);
        await collapseFloatingPanel(page);
        await capture(page, testInfo, '11-section', viewportBox(page));
      }

      // §103.10 Sheet: pre-staged C-101 (applied design + contours style).
      await expandRibbon(page);
      await openSurveyPlanDrawing(page, writeSheetDrawing());
      await rebuildSurface(page, 'EG', 'srf-eg');
      await rebuildSurface(page, 'Site Design', await toolspaceSurfaceIdByName(page, 'Site Design'));
      await collapseRibbon(page);
      await collapseFloatingPanel(page);
      await clickWithFallback(layoutTab(page, 'C-101'), 'C-101 layout tab');
      await expect.poll(() => sheetGeometryCount(page), { timeout: 15000 }).toBeGreaterThan(5);
      await capture(page, testInfo, '12-sheet');

      expect(errors).toEqual([]);
    });
  });
}
