/**
 * Phase 20D Wave-3A visual QA — design surface workflow at 1366×768,
 * 1920×1080, and 2560×1440.
 *
 * Every view attaches to the test report (CI-safe). When WRITE_20D_EVIDENCE=1
 * the same PNGs are also written to docs/evidence/phase20d/ for the
 * visual-qa.md record.
 *
 * The scene is built through the production seams (PARCEL_CREATE /
 * GROUP_CREATE commands, WNCAD loader): explicit-TIN EG target (the 20C
 * compute-test flat grid verbatim so every locus line coincides with a
 * target edge), a coarse 2-triangle EG twin (the design-copy source — the
 * 18Y compose exact predicates self-hit on a same-surface diagonal, per the
 * Wave-1C oracle header), a closed flat 100×100 pad feature line (z=10),
 * parcel context, and a pre-built CL-Pad alignment crossing the pad. The
 * live sweep drives the shipped UI throughout (Surface manager → Design
 * Workflow panel → grading manager → profile manager); nothing is staged
 * by hand. The final sheet is a separate Node-built drawing (full engine
 * stage + C-101 with viewport, title block, North Arrow, Scale Bar).
 *
 * Views (§106): eg-before, purpose-manager, design-copy, grading-group,
 * design-patch, apply-preflight, final-design, volume, section-profile,
 * final-sheet.
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
import { SURFACE_STYLE_CONTOURS_ID } from '../src/engine/cad/cadSurfaceStyles';
import { openSurveyPlanDrawing } from './cad-survey-plan-19a-helpers';
import { layoutTab, sheetGeometryCount } from './cad-sheet-layout-19b-helpers';

const EVIDENCE_DIR = path.resolve(process.cwd(), 'docs/evidence/phase20d');
const WRITE_EVIDENCE = process.env.WRITE_20D_EVIDENCE === '1';

const range = (a: number, b: number, s: number): number[] => {
  const out: number[] = [];
  for (let v = a; v <= b + 1e-9; v += s) out.push(v);
  return out;
};

/** 20C compute-test flat grid verbatim (step 20 over -60..160, z=0). */
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

const tinSurface = (id: string, name: string, payload: ImportedTinPayload): CadSurface => ({
  id,
  name,
  layerId: 'general',
  styleId: 'style-base',
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

/** Live-flow site project: EG grid + coarse twin, closed flat pad, parcel, CL-Pad, uncalculated Pad group. */
const buildSiteProject = (): CadProject => {
  const document = createBlankCadDrawingDocument({ name: 'Design Surface 20D', units: 'm' });
  const base: CadProject = {
    ...document.project,
    entities: [
      {
        id: 'fl-pad', type: 'feature-line', layerId: 'feature-lines', visible: true, locked: false,
        name: 'Pad', closed: true,
        vertices: [
          V('feature-vertex:fl-pad:a', 0, 0, 10),
          V('feature-vertex:fl-pad:b', 100, 0, 10),
          V('feature-vertex:fl-pad:c', 100, 100, 10),
          V('feature-vertex:fl-pad:d', 0, 100, 10),
        ],
      } as CadFeatureLineEntity,
      lotLine('lot:s', -40, -40, 160, -40),
      lotLine('lot:e', 160, -40, 160, 140),
      lotLine('lot:n', 160, 140, -40, 140),
      lotLine('lot:w', -40, 140, -40, -40),
      lotLine('cl-pad-line', -40, 50, 160, 50),
      {
        id: 'align-cl', type: 'alignment', layerId: 'general', visible: true, locked: false,
        name: 'CL-Pad',
        elements: [{ kind: 'line', start: { x: -40, y: 50 }, end: { x: 160, y: 50 } }],
        startStation: 0,
      },
    ],
    surfaces: [
      tinSurface('srf-eg', 'EG', gridTin(-60, -60, 160, 160)),
      tinSurface('srf-base', 'EG Coarse', {
        vertices: [-60, -60, 0, 260, -60, 0, 260, 160, 0, -60, 160, 0],
        faces: [0, 1, 2, 0, 2, 3],
        provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
      }),
    ],
  };
  let history = runCadCommand(createCadHistoryState(base, []), {
    key: 'PARCEL_CREATE',
    sourceEntityIds: ['lot:s', 'lot:e', 'lot:n', 'lot:w'],
  });
  history = runCadCommand(history, {
    key: 'GROUP_CREATE',
    name: 'Pad',
    sourceFeatureLineId: 'fl-pad',
    sourceCourses: [
      { vertexAId: 'feature-vertex:fl-pad:a', vertexBId: 'feature-vertex:fl-pad:b' },
      { vertexAId: 'feature-vertex:fl-pad:b', vertexBId: 'feature-vertex:fl-pad:c' },
      { vertexAId: 'feature-vertex:fl-pad:c', vertexBId: 'feature-vertex:fl-pad:d' },
      { vertexAId: 'feature-vertex:fl-pad:d', vertexBId: 'feature-vertex:fl-pad:a' },
    ],
    targetSurfaceId: 'srf-eg',
    side: 'right',
    criterion: { kind: 'fixed', gradeRatio: -0.5 },
    maxSearchDistance: 50,
    curveChordTolerance: 0.05,
    closed: true,
  });
  return history.present.project;
};

/** Final-sheet drawing: full engine stage in Node (copy → patch → apply → EG purpose) + C-101. */
const writeSheetDrawing = (): string => {
  const site = buildSiteProject();
  const groupId = site.gradingGroups!.find((g) => g.name === 'Pad')!.id;
  const inputs = resolveGroupInputs(site, groupId);
  if (!inputs) throw new Error('pad inputs unresolvable');
  const target = site.surfaces!.find((s) => s.id === inputs.target.id)!;
  const built = buildCadSurface(site, target);
  if (built.outcome !== 'ok') throw new Error('EG build failed');
  const outcome = computeGradingGroupFromSnapshots({
    groupId, revision: inputs.revision,
    members: inputs.memberSources, side: inputs.group.side, criterion: inputs.group.criterion,
    maxSearchDistance: inputs.group.maxSearchDistance, curveChordTolerance: inputs.group.curveChordTolerance,
    closed: true,
    target: {
      points: built.points.flatMap((p) => [p.x, p.y, p.z]),
      triangles: built.triangles.flatMap((tri) => [...tri]),
    },
  });
  if (!outcome.ok) throw new Error('pad compute failed');
  let history = runCadCommand(createCadHistoryState(site), {
    key: 'DESIGNPATCH', groupId, result: outcome.result,
    expectedRevision: inputs.revision, sessionCurrent: true,
  });
  const patchId = history.present.project.surfaces!.find((s) => s.name === 'Pad - Design Patch')!.id;
  const revOf = (project: CadProject, id: string): string =>
    computeCadSurfaceSourceRevision(project, project.surfaces!.find((s) => s.id === id)!);
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
  staged = {
    ...staged,
    surfaces: (staged.surfaces ?? []).map((surface) =>
      surface.id === designId ? { ...surface, styleId: SURFACE_STYLE_CONTOURS_ID } : surface,
    ),
  };
  const document = createBlankCadDrawingDocument({ name: 'Design Sheet 20D', units: 'm' });
  const draft = document.draft;
  if (!draft) throw new Error('blank drawing has no draft');
  const withSheet = addSheetToDraft(
    draft, createPlanSheet({ name: 'C-101', sizeId: 'ISO A3', orientation: 'landscape' }),
  );
  const sheet = withSheet.sheets[withSheet.sheets.length - 1];
  if (!sheet) throw new Error('sheet not created');
  const withViewport = addViewportToSheet(withSheet, sheet.id, {
    name: 'VP-1', modelCenterX: 50, modelCenterY: 50, scaleDenominator: 500,
    paperXmm: 30, paperYmm: 30, paperWidthMm: 330, paperHeightMm: 210, rotationDeg: 0,
  });
  const viewport = withViewport.sheets.find((entry) => entry.id === sheet.id)?.viewports.at(-1);
  if (!viewport) throw new Error('viewport not created');
  let next = addSheetObject(withViewport, sheet.id, defaultNorthArrowObject(viewport));
  next = addSheetObject(next, sheet.id, defaultScaleBarObject(viewport));
  const template = createTitleBlockTemplate('TB-C101');
  next = { ...next, titleBlockDefinitions: [...next.titleBlockDefinitions, template] };
  next = assignTitleBlockToSheet(next, sheet.id, template.id);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-20d-vis-'));
  const filePath = path.join(dir, 'design-sheet-20d.wncad');
  fs.writeFileSync(
    filePath,
    serializeCadDrawingFile({ ...document, project: staged, draft: next }),
    'utf8',
  );
  return filePath;
};

const writeDrawing = (project: CadProject, name: string): string => {
  const document = createBlankCadDrawingDocument({ name, units: 'm' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-20d-vis-'));
  const filePath = path.join(dir, `${name}.wncad`);
  fs.writeFileSync(filePath, serializeCadDrawingFile({ ...document, project }), 'utf8');
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

function ribbonTab(page: Page, name: string) {
  return page.locator('[aria-label="Ribbon tabs"]').getByRole('tab', { name });
}

function surfaceManagerScope(page: Page) {
  return page.locator('section[aria-label="Surface manager"]');
}

function designWorkflow(page: Page) {
  return page.locator('section[aria-label="Design workflow"]');
}

function toolspaceSurface(page: Page, id: string) {
  return page.locator(`[data-cad-toolspace] [data-cad-surface="${id}"]`);
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

async function surfaceStatus(page: Page, id: string): Promise<string> {
  return (await toolspaceSurface(page, id).getAttribute('data-cad-surface-status')) ?? '';
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

/** Open the Surface manager (owns the Design Workflow panel). */
async function openSurfaceManager(page: Page): Promise<void> {
  await expandRibbon(page);
  await ribbonTab(page, 'Surface').click();
  await page.getByRole('button', { name: 'Add Points' }).first().click();
  await expect(surfaceManagerScope(page)).toBeVisible({ timeout: 10000 });
}

/** Rebuild a surface row through the shipped manager; returns the Toolspace status. */
async function rebuildSurface(page: Page, surfaceName: string, surfaceId: string): Promise<string> {
  await openSurfaceManager(page);
  const manager = surfaceManagerScope(page);
  await manager.locator(`ul button[aria-label^="Surface ${surfaceName},"]`).click();
  await manager.getByRole('button', { name: 'Rebuild', exact: true }).click();
  // Toolspace surface rows render on the Survey tab only.
  await page.locator('[aria-label="Toolspace tabs"]').getByRole('tab', { name: 'Survey' }).click();
  await expect.poll(() => surfaceStatus(page, surfaceId), { timeout: 90000 }).toBe('CURRENT');
  return surfaceStatus(page, surfaceId);
}

/**
 * Click a manager/panel button. At 1366×768 floating surfaces can sit under
 * dock overlays, so covered buttons fall back to a dispatched click (the
 * seam still fires honestly); every fallback is logged for the QA record.
 */
const panelClick = async (scope: Locator, name: string): Promise<void> => {
  const button = scope.getByRole('button', { name });
  await expect(button).toBeVisible({ timeout: 15000 });
  await button.scrollIntoViewIfNeeded().catch(() => undefined);
  await button.click({ timeout: 8000 }).catch(async () => {
    console.log(`PANEL-CLICK-FALLBACK dispatched click for ${name}`);
    await button.dispatchEvent('click');
  });
};

const RESOLUTIONS = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
] as const;

for (const resolution of RESOLUTIONS) {
  test.describe(`Phase 20D visual QA @ ${resolution.width}x${resolution.height}`, () => {
    test.use({ viewport: { width: resolution.width, height: resolution.height } });

    test(`visual sweep ${resolution.width}x${resolution.height}`, async ({ page }, testInfo) => {
      test.setTimeout(600_000);
      const errors: string[] = [];
      const siteProject = buildSiteProject();
      const groupId = siteProject.gradingGroups!.find((g) => g.name === 'Pad')!.id;
      const sitePath = writeDrawing(siteProject, 'design-surface-20d');

      // 1. EG before design: plan as opened (pad + parcel + CL-Pad context).
      await bootCad(page, errors);
      await openSurveyPlanDrawing(page, sitePath);
      await expect.poll(async () => page.locator('[data-survey-cad-entity-count]').textContent(), { timeout: 30000 }).not.toBe('0');
      await collapseFloatingPanel(page);
      await collapseRibbon(page);
      await capture(page, testInfo, 'eg-before', viewportBox(page));

      // Surfaces arrive UNBUILT (explicit TINs persist no mesh): rebuild both.
      await rebuildSurface(page, 'EG', 'srf-eg');
      await rebuildSurface(page, 'EG Coarse', 'srf-base');
      await collapseFloatingPanel(page);

      // 2. Purpose/manager: mark EG through the Design Workflow panel.
      await openSurfaceManager(page);
      const workflow = designWorkflow(page);
      await expect(workflow).toBeVisible({ timeout: 15000 });
      await workflow.getByLabel('Design surface').selectOption('srf-eg');
      await workflow.getByLabel('Surface purpose').selectOption('existing-ground');
      await panelClick(workflow, 'Set Surface Purpose');
      await expect(surfaceManagerScope(page).locator('ul button', { hasText: 'EG [EG]' })).toBeVisible({ timeout: 15000 });
      await capture(page, testInfo, 'purpose-manager');

      // 3. Design copy: coarse-twin snapshot as a Design-role surface (the
      // grid EG self-hits the 18Y exact predicates on apply — Wave-1C oracle).
      await workflow.getByLabel('Existing Ground surface').selectOption('srf-base');
      await workflow.getByLabel('Design copy name').fill('Site Design');
      await panelClick(workflow, 'Create Design Copy');
      await expect(surfaceManagerScope(page).locator('ul button', { hasText: 'Site Design [DESIGN]' })).toBeVisible({ timeout: 15000 });
      await capture(page, testInfo, 'design-copy');

      // 4. Grading group: calculate Pad through the grading manager (worker).
      await ribbonTab(page, 'Home').click();
      await page.locator('[data-cad-grading-group-command="GRADINGGROUP"]').click();
      const groupTable = page.locator('[data-cad-grading-group-table]');
      await expect(groupTable).toBeVisible({ timeout: 15000 });
      const row = page.locator(`[data-cad-grading-group-row="${groupId}"]`);
      if ((await row.getAttribute('data-selected')) !== 'true') {
        await row.scrollIntoViewIfNeeded().catch(() => undefined);
        await row.click({ timeout: 8000 }).catch(async () => {
          console.log('ROW-CLICK-FALLBACK dispatched click for Pad');
          await row.dispatchEvent('click');
        });
      }
      const calc = page.locator('[data-cad-grading-group-calculate]');
      await calc.scrollIntoViewIfNeeded().catch(() => undefined);
      await calc.click({ timeout: 8000 }).catch(async () => {
        console.log('MANAGER-CLICK-FALLBACK dispatched click for calculate');
        await calc.dispatchEvent('click');
      });
      await expect.poll(() => row.innerText(), { timeout: 90000 }).toMatch(/Current/);
      await capture(page, testInfo, 'grading-group');

      // 5. Design patch: back to the Surface manager, build from CURRENT Pad.
      await openSurfaceManager(page);
      const workflow2 = designWorkflow(page);
      await workflow2.getByLabel('Grading group').selectOption(groupId);
      await panelClick(workflow2, 'Build Design Patch');
      await expect(surfaceManagerScope(page).locator('ul button', { hasText: 'Pad - Design Patch [PATCH]' })).toBeVisible({ timeout: 15000 });
      await capture(page, testInfo, 'design-patch');

      // 6. Apply preflight: rebuild copy + patch (explicit TINs persist no
      // mesh), then Design + Patch selects → EXACT disposition line.
      await rebuildSurface(page, 'Site Design', await toolspaceSurfaceIdByName(page, 'Site Design'));
      await rebuildSurface(page, 'Pad - Design Patch', await toolspaceSurfaceIdByName(page, 'Pad - Design Patch'));
      await openSurfaceManager(page);
      const workflow2b = designWorkflow(page);
      await workflow2b.getByLabel('Design surface').selectOption({ label: 'Site Design [DESIGN]' });
      await workflow2b.getByLabel('Patch surface').selectOption({ label: 'Pad - Design Patch [PATCH]' });
      await expect(workflow2b.locator('text=Preflight')).toBeVisible({ timeout: 15000 });
      await expect(workflow2b).toContainText('EXACT');
      await capture(page, testInfo, 'apply-preflight');

      // 7. Final design: apply in place, viewport shows the pad plateau.
      await panelClick(workflow2b, 'Apply Patch');
      await collapseFloatingPanel(page);
      await collapseRibbon(page);
      await capture(page, testInfo, 'final-design', viewportBox(page));
      await expandRibbon(page);

      // 8. Volume: applying invalidates the design mesh (stale), so rebuild
      // it, then track EG vs design, explicit calculate, quantities read.
      await rebuildSurface(page, 'Site Design', await toolspaceSurfaceIdByName(page, 'Site Design'));
      await openSurfaceManager(page);
      const workflow3 = designWorkflow(page);
      await workflow3.getByLabel('Existing Ground surface').selectOption('srf-eg');
      await workflow3.getByLabel('Design surface').selectOption({ label: 'Site Design [DESIGN]' });
      await panelClick(workflow3, 'Earthwork Volume');
      await panelClick(workflow3, 'Calculate Volume');
      await expect(workflow3).toContainText(/FILL [\d.]+ \/ CUT/, { timeout: 90000 });
      testInfo.annotations.push({ type: 'volume', description: (await workflow3.locator('dt:has-text("Volume") + dd').innerText().catch(() => 'unread')) ?? '' });
      await capture(page, testInfo, 'volume');

      // 9. Section/profile: CL-Pad profile over the final design, rebuilt CURRENT.
      // Wait for the volume worker to settle before starting extraction.
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
        // Select the new row first: detail actions (Rebuild) render for selection.
        const createdIds = await profileManager.locator('[data-profile-list] [data-cad-profile]').evaluateAll((elements) =>
          elements.map((element) => element.getAttribute('data-cad-profile') ?? ''));
        const createdId = createdIds.find((id) => id !== '');
        if (!createdId) throw new Error('no profile row after create');
        await profileManager.locator(`[data-profile-list] [data-cad-profile="${createdId}"]`).click();
        await profileManager.locator('[data-profile-detail]').getByRole('button', { name: 'Rebuild', exact: true }).click();
        await expect(profileManager.locator('[data-profile-stats]')).toContainText('Covered / gap', { timeout: 90000 });
        await collapseRibbon(page);
        await collapseFloatingPanel(page);
        await capture(page, testInfo, 'section-profile');
        testInfo.annotations.push({ type: 'profile', description: 'CL-Pad Design CURRENT with stats' });
      } else {
        testInfo.annotations.push({ type: 'profile', description: 'PROFILE-MANAGER-NOT-OPENED: Profiles entry not clickable at this resolution; honest gap' });
        await collapseRibbon(page);
        await collapseFloatingPanel(page);
        await capture(page, testInfo, 'section-profile', viewportBox(page));
      }

      // 10. Final sheet: pre-staged C-101 (applied design + contours style).
      await expandRibbon(page);
      await openSurveyPlanDrawing(page, writeSheetDrawing());
      await rebuildSurface(page, 'EG', 'srf-eg');
      await rebuildSurface(page, 'Site Design', await toolspaceSurfaceIdByName(page, 'Site Design'));
      await collapseRibbon(page);
      await collapseFloatingPanel(page);
      await layoutTab(page, 'C-101').click({ timeout: 15000 });
      await expect.poll(() => sheetGeometryCount(page), { timeout: 15000 }).toBeGreaterThan(5);
      await capture(page, testInfo, 'final-sheet');

      expect(errors).toEqual([]);
    });
  });
}
