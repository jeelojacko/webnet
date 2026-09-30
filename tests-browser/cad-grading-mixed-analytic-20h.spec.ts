/**
 * Phase 20H browser QA — mixed-analytic grading groups driven through the REAL
 * /cad shell on a production build in headless Chromium. No mocks: every flow
 * opens a seeded .wncad and drives the live ribbon / manager / Toolspace /
 * Properties / command dock / worker, pinning zero page/console errors.
 * Screenshots land under docs/evidence/phase20h/ (at most 10 new PNGs).
 *
 * Flows: A same-domain analytic composer at 3 viewports, B mixed closed pad
 * (calculate + inquiry + CSV + extract/bake + undo), C incompatible-Z FAILED,
 * D wrong-sign gate + persistence round-trip, plus a per-viewport shell
 * regression (ribbon <= 130px, single band, no page scroll).
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createBlankCadDrawingDocument,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import type { CadFeatureLineEntity, CadProject } from '../src/engine/cad/cadTypes';
import type { CadGradingGroup } from '../src/engine/cad/grading/gradingGroupTypes';
import { entityCount, gotoCad, homeTab, openSurveyPlanDrawing, selectionCount } from './cad-survey-plan-19a-helpers';

const EVIDENCE = path.resolve(process.cwd(), 'docs/evidence/phase20h');
fs.mkdirSync(EVIDENCE, { recursive: true });

const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
] as const;

let seq = 0;
const nextId = (p: string): string => `${p}-20h-${++seq}`;

const fl = (id: string, pts: Array<[number, number, number]>, closed = false): CadFeatureLineEntity => ({
  id, type: 'feature-line', layerId: 'general', visible: true, locked: false, name: `FL ${id}`,
  vertices: pts.map(([x, y, z], i) => ({ id: `${id}:v${i}`, x, y, z })),
  ...(closed ? { closed: true } : {}),
});

const SQUARE_PTS: Array<[number, number, number]> = [[0, 0, 10], [100, 0, 10], [100, 100, 10], [0, 100, 10]];

const mixedGroupOf = (squareId: string): CadGradingGroup => ({
  id: nextId('grp'),
  name: 'MixedPad',
  sourceFeatureLineId: squareId,
  sourceCourses: [0, 1, 2, 3].map((i) => ({
    vertexAId: `${squareId}:v${i}`, vertexBId: `${squareId}:v${(i + 1) % 4}`,
  })),
  side: 'right',
  criterion: { kind: 'distance', gradeRatio: -0.5, distance: 20 },
  courseCriteria: [
    { sourceCourse: { vertexAId: `${squareId}:v1`, vertexBId: `${squareId}:v2` }, criterion: { kind: 'relative-elevation', gradeRatio: -0.5, relativeElevation: -10 } },
    { sourceCourse: { vertexAId: `${squareId}:v2`, vertexBId: `${squareId}:v3` }, criterion: { kind: 'elevation', gradeRatio: -0.5, targetElevation: 0 } },
  ],
  maxSearchDistance: 50,
  curveChordTolerance: 0.05,
  cornerMode: 'miter',
  closed: true,
});

const writeGroupWorld = (squareId: string, group: CadGradingGroup): string => {
  const project: CadProject = {
    ...createBlankCadDrawingDocument({ name: '20H group QA', units: 'm' }).project,
    entities: [fl(squareId, SQUARE_PTS, true)],
    surfaces: [],
    gradingGroups: [group],
  };
  const file = path.join(os.tmpdir(), `wn-20h-${Date.now()}-${Math.floor(Math.random() * 1e6)}.wncad`);
  fs.writeFileSync(file, serializeCadDrawingFile({ ...createBlankCadDrawingDocument({ name: 'q', units: 'm' }), project }), 'utf8');
  return file;
};

const openGroupManager = async (page: Page): Promise<void> => {
  await homeTab(page);
  await page.locator('[data-cad-grading-group-command="GRADINGGROUP"]').click();
  await expect(page.locator('[data-cad-grading-group-table]')).toBeVisible({ timeout: 15000 });
};

const toolspaceSurvey = async (page: Page): Promise<void> => {
  await page.locator('[aria-label="Toolspace tabs"]').getByRole('tab', { name: 'Survey' }).click();
};

const selectFeatureLine = async (page: Page, name: string): Promise<void> => {
  await toolspaceSurvey(page);
  await page.locator('[data-cad-toolspace]').getByRole('button', { name }).click();
  await expect.poll(() => selectionCount(page)).toBe(1);
};

const undoOnce = async (page: Page): Promise<void> => {
  await homeTab(page);
  await page.locator('[data-cad-command="SHELL_UNDO"]').click();
};

const surfaceNodes = (page: Page) => page.locator('[data-cad-toolspace] [data-cad-surface]');
const groupRow = (page: Page) => page.locator('[data-cad-grading-group-row]').first();

const geometry: Record<string, unknown> = {};
test.afterAll(() => {
  fs.writeFileSync(`${EVIDENCE}/geometry.json`, JSON.stringify(geometry, null, 2));
});

const revealRowStatus = (page: Page): Promise<void> => page.evaluate(() => {
  const table = document.querySelector('[data-cad-grading-group-table]');
  if (table) table.scrollLeft = table.scrollWidth;
});

const shot = async (page: Page, name: string): Promise<void> => {
  geometry[name] = await page.evaluate(() => {
    const box = (sel: string): Record<string, number> | null => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, scrollW: el.scrollWidth, clientW: el.clientWidth };
    };
    return {
      innerW: window.innerWidth, innerH: window.innerHeight,
      docScrollW: document.documentElement.scrollWidth, docScrollH: document.documentElement.scrollHeight,
      ribbon: box('[data-cad-ribbon]'), viewport: box('[data-cad-viewport]'), manager: box('section[aria-label="Grading group manager"]'),
    };
  });
  await page.screenshot({ path: `${EVIDENCE}/${name}.png` });
};

// ===========================================================================
// Flow A — analytic composer offers the whole domain (3 viewports)
// ===========================================================================
for (const viewport of VIEWPORTS) {
  test(`20H Flow A analytic composer @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    await gotoCad(page, errors);
    const squareId = nextId('fl-square');
    const file = writeGroupWorld(squareId, mixedGroupOf(squareId));
    const tag = `${viewport.width}`;
    try {
      await openSurveyPlanDrawing(page, file);
      await openGroupManager(page);
      const row = groupRow(page);
      await expect(row).toHaveAttribute('data-cad-grading-group-row-method', 'Mixed Analytic', { timeout: 15000 });
      await expect(row).toContainText('Not applicable');
      await expect(row).toContainText('Unbuilt');

      // Criteria composer: the analytic domain select, never a locked family.
      await page.locator('[data-cad-grading-group-tab="criteria"]').click();
      const panel = page.locator('[data-cad-grading-group-criteria]');
      await expect(panel).toBeVisible({ timeout: 10000 });
      const select = panel.locator('[data-cad-grading-field="cad-grading-group-criteria-method"]');
      await expect(select).toBeVisible();
      const options = await select.locator('option').allTextContents();
      expect(options).toEqual(['Distance', 'Elevation', 'Relative Elevation']);
      await expect(panel.locator('[data-cad-grading-field="cad-grading-group-criteria-method-locked"]')).toHaveCount(0);
      // Course table labels each effective kind truthfully.
      await expect(panel.locator('[data-cad-grading-group-criteria-row="1"]')).toContainText('Relative Elevation');
      await expect(panel.locator('[data-cad-grading-group-criteria-row="2"]')).toContainText('Elevation');
      await panel.locator('[data-cad-grading-group-criteria-form]').scrollIntoViewIfNeeded();
      await shot(page, `${tag}-mixed-create`);
    } finally {
      fs.rmSync(file, { force: true });
    }
    expect(errors).toEqual([]);
  });
}

// ===========================================================================
// Flow B — mixed closed pad: calculate + products (1366)
// ===========================================================================
test('20H Flow B calculate + inquiry + CSV + extract/bake', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors: string[] = [];
  await gotoCad(page, errors);
  const squareId = nextId('fl-square');
  const file = writeGroupWorld(squareId, mixedGroupOf(squareId));
  try {
    await openSurveyPlanDrawing(page, file);
    await openGroupManager(page);
    const row = groupRow(page);
    await expect(row).toHaveAttribute('data-cad-grading-group-row-method', 'Mixed Analytic');

    await row.click();
    await expect(page.locator('[data-cad-grading-group-calculate]')).toBeEnabled({ timeout: 15000 });
    await page.locator('[data-cad-grading-group-calculate]').click();
    await expect(row).toContainText('Current', { timeout: 60000 });
    await expect(row).toContainText('20.00–20.00 m');
    await expect(row).toContainText('9600.0');
    await revealRowStatus(page);
    await shot(page, '1366-mixed-current');

    // Inquiry carries the mixed termination + Not applicable target + areas.
    await page.locator('[data-cad-grading-group-tab="inquiry"]').click();
    const report = page.locator('[data-cad-grading-group-inquiry-report]');
    await expect(report).toContainText(
      'Termination: Mixed Analytic · Methods: Distance + Elevation + Relative Elevation', { timeout: 15000 },
    );
    await expect(report).toContainText('Target: Not applicable');
    await expect(report).toContainText('Areas: plan 9600.000');
    await expect(report).toContainText('miter 28.284 m');
    await report.scrollIntoViewIfNeeded();
    await shot(page, '1366-mixed-inquiry');

    // CSV agrees.
    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.locator('[data-cad-grading-group-csv]').click();
    const csvText = await (await downloadPromise).createReadStream().then(
      (stream) => new Promise<string>((resolve, reject) => {
        let data = '';
        stream.on('data', (chunk) => { data += chunk; });
        stream.on('end', () => resolve(data));
        stream.on('error', reject);
      }),
    );
    expect(csvText).toContain('Termination,Mixed Analytic');
    expect(csvText).toContain('Methods,Distance + Elevation + Relative Elevation');
    expect(csvText).toContain('Target,Not applicable');

    // Extract adds exactly one entity; one Undo removes it.
    await page.locator('[data-cad-grading-group-tab="definition"]').click();
    await row.click();
    const entitiesBefore = await entityCount(page);
    await expect(page.locator('[data-cad-grading-group-extract]')).toBeEnabled({ timeout: 10000 });
    await page.locator('[data-cad-grading-group-extract]').click();
    await expect.poll(() => entityCount(page)).toBe(entitiesBefore + 1);
    await undoOnce(page);
    await expect.poll(() => entityCount(page)).toBe(entitiesBefore);
    await expect(row).toContainText('Current');

    // Bake adds exactly one surface; one Undo removes it.
    await toolspaceSurvey(page);
    const surfacesBefore = await surfaceNodes(page).count();
    if (!(await page.locator('[data-cad-grading-group-table]').isVisible())) await openGroupManager(page);
    await row.click();
    await expect(page.locator('[data-cad-grading-group-bake]')).toBeEnabled({ timeout: 10000 });
    await page.locator('[data-cad-grading-group-bake]').click();
    await expect.poll(() => surfaceNodes(page).count()).toBe(surfacesBefore + 1);
    await undoOnce(page);
    await expect.poll(() => surfaceNodes(page).count()).toBe(surfacesBefore);
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
});

// ===========================================================================
// Flow C — incompatible-Z override fails closed (1366)
// ===========================================================================
test('20H Flow C incompatible-Z FAILED', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors: string[] = [];
  await gotoCad(page, errors);
  const squareId = nextId('fl-square');
  const file = writeGroupWorld(squareId, mixedGroupOf(squareId));
  try {
    await openSurveyPlanDrawing(page, file);
    await openGroupManager(page);
    const row = groupRow(page);
    await page.locator('[data-cad-grading-group-tab="criteria"]').click();
    const panel = page.locator('[data-cad-grading-group-criteria]');
    await panel.locator('[aria-label="Select Course 1"]').check();
    await panel.locator('[data-cad-grading-field="cad-grading-group-criteria-method"]').selectOption('relative-elevation');
    await panel.locator('[data-cad-grading-field="cad-grading-group-criteria-relative-elevation"]').fill('-12');
    await panel.locator('[data-cad-grading-group-criteria-apply-selected]').click();
    await expect(page.locator('[data-cad-grading-group-notice]')).toContainText('verrid', { timeout: 10000 });

    await page.locator('[data-cad-grading-group-tab="definition"]').click();
    await row.click();
    await expect(page.locator('[data-cad-grading-group-calculate]')).toBeEnabled({ timeout: 15000 });
    await page.locator('[data-cad-grading-group-calculate]').click();
    await expect(row).toContainText('Failed', { timeout: 60000 });
    await expect(row).toContainText(/(CORNER_NO_SOLUTION|GRADING_ANALYTIC_CORNER_Z)/);
    await expect(row).not.toContainText('Current');
    await expect(page.locator('[data-cad-grading-group-extract]')).toBeDisabled();
    await expect(page.locator('[data-cad-grading-group-bake]')).toBeDisabled();
    const diagnostic = (await row.textContent()) ?? '';
    await page.locator('[data-cad-grading-group-calculate]').click();
    await expect(row).toContainText('Failed', { timeout: 60000 });
    expect((await row.textContent()) ?? '').toBe(diagnostic);
    await row.scrollIntoViewIfNeeded();
    await revealRowStatus(page);
    await shot(page, '1366-mixed-failed');
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
});

// ===========================================================================
// Flow D — wrong-sign + persistence round-trip (1366)
// ===========================================================================
test('20H Flow D wrong-sign + persistence', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors: string[] = [];
  await gotoCad(page, errors);
  const slopeId = nextId('fl-slope');
  const squareId = nextId('fl-square');
  const group = mixedGroupOf(squareId);
  const project: CadProject = {
    ...createBlankCadDrawingDocument({ name: '20H D', units: 'm' }).project,
    entities: [fl(slopeId, [[0, 0, 100], [100, 0, 102]]), fl(squareId, SQUARE_PTS, true)],
    gradings: [{
      id: nextId('g'), name: 'SlopeDist', sourceFeatureLineId: slopeId,
      sourceCourse: { vertexAId: `${slopeId}:v0`, vertexBId: `${slopeId}:v1` },
      side: 'right', criterion: { kind: 'distance', gradeRatio: -0.5, distance: 20 },
      maxSearchDistance: 50, curveChordTolerance: 0.05,
    }],
    gradingGroups: [group],
  };
  const file = path.join(os.tmpdir(), `wn-20h-d-${Date.now()}.wncad`);
  fs.writeFileSync(file, serializeCadDrawingFile({ ...createBlankCadDrawingDocument({ name: 'q', units: 'm' }), project }), 'utf8');
  try {
    await openSurveyPlanDrawing(page, file);
    // Wrong-sign standalone draft is rejected BEFORE any mutation.
    await selectFeatureLine(page, `FL ${slopeId}`);
    await homeTab(page);
    await page.locator('[data-cad-grading-command="GRADETORELATIVEELEVATION"]').click();
    await expect(page.locator('[data-cad-grading-table]')).toBeVisible({ timeout: 15000 });
    const form = page.locator('[data-cad-grading-create]');
    await form.locator('[data-cad-grading-field="cad-grading-method"]').selectOption('relative-elevation');
    await form.locator('[aria-label="Grade magnitude"]').fill('50');
    await form.locator('[aria-label="Grade direction"]').selectOption('up');
    await form.locator('[data-cad-grading-field="cad-grading-relative-elevation"]').fill('-10');
    await expect(page.locator('[data-cad-grading-create] [data-cad-grading-diagnosis]'))
      .toHaveText('Criterion: invalid — grade and relative elevation point in opposite directions');
    await page.locator('[data-cad-grading-create-submit]').click();
    await expect(page.locator('[data-cad-grading-notice]')).toContainText('rejected', { timeout: 10000 });

    // Save + reopen: mixed overrides persist, result honestly UNBUILT.
    await openGroupManager(page);
    await groupRow(page).scrollIntoViewIfNeeded();
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await page.getByRole('button', { name: 'Save Drawing' }).first().click();
    const download = await downloadPromise;
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wn-20h-save-'));
    const savedPath = path.join(dir, 'drawing.wncad');
    await download.saveAs(savedPath);
    await openSurveyPlanDrawing(page, savedPath);
    await openGroupManager(page);
    const reopened = groupRow(page);
    await expect(reopened).toHaveAttribute('data-cad-grading-group-row-method', 'Mixed Analytic', { timeout: 15000 });
    await expect(reopened).toContainText('Unbuilt');
    await page.locator('[data-cad-grading-group-tab="criteria"]').click();
    const panel = page.locator('[data-cad-grading-group-criteria]');
    await expect(panel.locator('[data-cad-grading-group-criteria-row="1"]')).toContainText('Override');
    await expect(panel.locator('[data-cad-grading-group-criteria-row="1"]')).toContainText('Relative Elevation');
    await fs.promises.rm(dir, { recursive: true, force: true });
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
});

// ===========================================================================
// Shell regression (per viewport)
// ===========================================================================
for (const viewport of VIEWPORTS) {
  test(`20H shell regression @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    await gotoCad(page, errors);
    const squareId = nextId('fl-square');
    const file = writeGroupWorld(squareId, mixedGroupOf(squareId));
    try {
      await openSurveyPlanDrawing(page, file);
      await selectFeatureLine(page, `FL ${squareId}`);
      await homeTab(page);
      const shell = await page.evaluate(() => {
        const ribbon = document.querySelector('[data-cad-ribbon]') as HTMLElement | null;
        const groups = document.querySelector('.cad-shell-ribbon-groups') as HTMLElement | null;
        const viewportEl = document.querySelector('[data-cad-viewport]') as HTMLElement | null;
        const cs = (el: Element | null, prop: string): string =>
          el == null ? 'missing' : getComputedStyle(el).getPropertyValue(prop);
        return {
          ribbonH: ribbon?.getBoundingClientRect().height ?? -1,
          bands: document.querySelectorAll('[data-cad-ribbon] .cad-shell-ribbon-groups').length,
          groupsWrap: groups ? cs(groups, 'flex-wrap') : 'missing',
          groupsOverflowX: groups ? cs(groups, 'overflow-x') : 'missing',
          docScrollW: document.documentElement.scrollWidth,
          docScrollH: document.documentElement.scrollHeight,
          innerW: window.innerWidth,
          innerH: window.innerHeight,
          propertiesCount: document.querySelectorAll('[data-cad-properties]').length,
          commandInputCount: document.querySelectorAll('[data-cad-command-input]').length,
          viewportH: viewportEl?.getBoundingClientRect().height ?? -1,
          modelPresent: viewportEl?.querySelector('svg') != null || viewportEl?.querySelector('canvas') != null,
        };
      });
      expect(shell.ribbonH).toBeLessThanOrEqual(130);
      expect(shell.bands).toBe(1);
      expect(shell.groupsWrap).toBe('nowrap');
      expect(['auto', 'scroll']).toContain(shell.groupsOverflowX);
      expect(shell.propertiesCount).toBe(1);
      expect(shell.commandInputCount).toBe(1);
      expect(shell.docScrollH).toBeLessThanOrEqual(shell.innerH + 1);
      expect(shell.docScrollW).toBeLessThanOrEqual(shell.innerW + 1);
      expect(shell.viewportH).toBeGreaterThan(300);
      expect(shell.modelPresent).toBe(true);
      await shot(page, `${viewport.width}-mixed-group`);
    } finally {
      fs.rmSync(file, { force: true });
    }
    expect(errors).toEqual([]);
  });
}
