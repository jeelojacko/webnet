/**
 * Phase 20F.1 browser QA — grading-UI closeout (Worker A family locks +
 * Worker B analytic<->Surface edit) driven through the REAL /cad shell in
 * production Chromium. No mocks: every flow opens a seeded .wncad, clicks
 * the live ribbon/manager/criteria/inquiry UI, and pins zero page/console
 * errors. Screenshots land under docs/evidence/phase20f1/.
 *
 * Flows: A distance create->calc->CURRENT->properties/inquiry->edit->recalc,
 * B elevation ditto, C analytic->Surface edit w/ target selector, D
 * Surface->analytic after override reset, E distance overrides+inquiry+CSV,
 * F elevation overrides, G surface family lock, H rejected cross-family
 * edit (truthful notice, editor stays open, definition unchanged).
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createBlankCadDrawingDocument,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import type { CadFeatureLineEntity, CadProject, CadSurface } from '../src/engine/cad/cadTypes';
import type { CadGradingGroup } from '../src/engine/cad/grading/gradingGroupTypes';
import { gotoCad, homeTab, openSurveyPlanDrawing } from './cad-survey-plan-19a-helpers';

const EVIDENCE = '/home/jacko/Code/webnet/docs/evidence/phase20f1';
fs.mkdirSync(EVIDENCE, { recursive: true });

let seq = 0;
const nextId = (p: string): string => `${p}-20f1-${++seq}`;

const fl = (id: string, pts: Array<[number, number, number]>, closed = false): CadFeatureLineEntity => ({
  id, type: 'feature-line', layerId: 'general', visible: true, locked: false, name: `FL ${id}`,
  vertices: pts.map(([x, y, z], i) => ({ id: `${id}:v${i}`, x, y, z })),
  ...(closed ? { closed: true } : {}),
});

const tin = (id: string, name: string): CadSurface => ({
  id, name, layerId: 'general', styleId: 'style-base',
  definition: {
    sourceKind: 'explicit-tin',
    pointSource: { kind: 'points', pointEntityIds: [] },
    importedTin: {
      vertices: [-60, -60, 0, 160, -60, 0, 160, 160, 0, -60, 160, 0],
      faces: [0, 1, 2, 0, 2, 3],
      provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
    },
  },
  cachedRevision: null,
});

const CHAIN_PTS: Array<[number, number, number]> = [[0, 0, 10], [100, 0, 10], [100, 100, 10]];
const SQUARE_PTS: Array<[number, number, number]> = [[0, 0, 10], [100, 0, 10], [100, 100, 10], [0, 100, 10]];

interface Ids { chainId: string; squareId: string; targetId: string; }
interface GroupSeed {
  name: string; fl: 'chain' | 'square'; courses: Array<[number, number]>;
  criterion: CadGradingGroup['criterion']; closed?: boolean;
  overrides?: NonNullable<CadGradingGroup['courseCriteria']>;
}

const writeWorld = (ids: Ids, groups: GroupSeed[]): string => {
  const pick = (which: 'chain' | 'square'): string => (which === 'chain' ? ids.chainId : ids.squareId);
  const gradingGroups: CadGradingGroup[] = groups.map((g) => {
    const flId = pick(g.fl);
    return {
      id: nextId('grp'),
      name: g.name,
      sourceFeatureLineId: flId,
      sourceCourses: g.courses.map(([a, b]) => ({ vertexAId: `${flId}:v${a}`, vertexBId: `${flId}:v${b}` })),
      ...(g.criterion.kind === 'fixed' || g.criterion.kind === 'cut-fill'
        ? { targetSurfaceId: ids.targetId } : {}),
      side: 'right',
      criterion: g.criterion,
      maxSearchDistance: 50,
      curveChordTolerance: 0.05,
      cornerMode: 'miter',
      ...(g.closed ? { closed: true as const } : {}),
      ...(g.overrides ? { courseCriteria: g.overrides } : {}),
    };
  });
  const project: CadProject = {
    ...createBlankCadDrawingDocument({ name: '20F.1 QA', units: 'm' }).project,
    entities: [fl(ids.chainId, CHAIN_PTS), fl(ids.squareId, SQUARE_PTS, true)],
    surfaces: [tin(ids.targetId, 'EG')],
    gradingGroups,
  };
  const file = path.join(os.tmpdir(), `wn-20f1-${Date.now()}-${Math.floor(Math.random() * 1e6)}.wncad`);
  fs.writeFileSync(file, serializeCadDrawingFile({ ...createBlankCadDrawingDocument({ name: 'q', units: 'm' }), project }), 'utf8');
  return file;
};

const freshIds = (): Ids => ({ chainId: nextId('fl-chain'), squareId: nextId('fl-square'), targetId: nextId('tgt') });

const DIST: CadGradingGroup['criterion'] = { kind: 'distance', gradeRatio: -0.02, distance: 20 };
const ELEV: CadGradingGroup['criterion'] = { kind: 'elevation', gradeRatio: -0.02, targetElevation: 9.8 };
const SURF: CadGradingGroup['criterion'] = { kind: 'fixed', gradeRatio: -0.5 };

const openManager = async (page: Page): Promise<void> => {
  await homeTab(page);
  await page.locator('[data-cad-grading-group-command="GRADINGGROUP"]').click();
  await expect(page.locator('[data-cad-grading-group-table]')).toBeVisible({ timeout: 15000 });
};

const selectRowByName = async (page: Page, name: string): Promise<void> => {
  await page.locator('[data-cad-grading-group-row]', { hasText: name }).first().click();
};

const openTab = async (page: Page, tab: 'definition' | 'criteria' | 'inquiry'): Promise<void> => {
  if (!(await page.locator('[data-cad-grading-group-table]').isVisible())) await openManager(page);
  await page.locator(`[data-cad-grading-group-tab="${tab}"]`).click();
};

const calculateAndWaitCurrent = async (page: Page, name: string): Promise<void> => {
  await selectRowByName(page, name);
  await expect(page.locator('[data-cad-grading-group-calculate]')).toBeEnabled({ timeout: 15000 });
  await page.locator('[data-cad-grading-group-calculate]').click();
  await expect(page.locator('[data-cad-grading-group-row]', { hasText: name }))
    .toContainText('Current', { timeout: 60000 });
};

const criteriaPanel = (page: Page) => page.locator('[data-cad-grading-group-criteria]');

// ------------------------------------------- viewports / shell / a11y ----
const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
] as const;

/** One of each family, distance group carrying symmetric overrides. */
const seedShowcase = (): { file: string; ids: Ids } => {
  const ids = freshIds();
  const file = writeWorld(ids, [
    {
      name: 'ShowDist', fl: 'chain', courses: [[0, 1], [1, 2]], criterion: { ...DIST },
      overrides: [0, 1].map((i) => ({
        sourceCourse: { vertexAId: `${ids.chainId}:v${i}`, vertexBId: `${ids.chainId}:v${i + 1}` },
        criterion: { kind: 'distance', gradeRatio: -0.02, distance: 25 } as const,
      })),
    },
    { name: 'ShowElev', fl: 'chain', courses: [[0, 1], [1, 2]], criterion: { ...ELEV } },
    {
      name: 'ShowSurf', fl: 'square', courses: [[0, 1], [1, 2], [2, 3], [3, 0]],
      criterion: { ...SURF }, closed: true,
    },
  ]);
  return { file, ids };
};

for (const viewport of VIEWPORTS) {
  test(`20F.1 shell + grading UI @ ${viewport.width}x${viewport.height}`, async ({ page }: { page: Page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    await gotoCad(page, errors);
    const { file, ids } = seedShowcase();
    try {
      await openSurveyPlanDrawing(page, file);
      await rebuildSurface(page, ids.targetId);
      await openManager(page);
      await calculateAndWaitCurrent(page, 'ShowDist');
      await calculateAndWaitCurrent(page, 'ShowElev');
      await calculateAndWaitCurrent(page, 'ShowSurf');
      const tag = `${viewport.width}`;

      // Shell overview with the manager open on Definition.
      await openTab(page, 'definition');
      await selectRowByName(page, 'ShowDist');
      await page.screenshot({ path: `${EVIDENCE}/${tag}-shell-overview.png` });

      // Phase 21 shell regression: single ribbon band, no page scrollbars.
      const shell = await page.evaluate(() => {
        const ribbon = document.querySelector('[data-cad-ribbon]') as HTMLElement | null;
        const strip = document.querySelector('[data-cad-ribbon] .cad-shell-ribbon-strip, [data-cad-ribbon] > div') as HTMLElement | null;
        const cs = (el: Element | null, prop: string): string =>
          el == null ? 'missing' : getComputedStyle(el).getPropertyValue(prop);
        return {
          ribbonH: ribbon?.getBoundingClientRect().height ?? -1,
          ribbonOverflowY: cs(ribbon, 'overflow-y'),
          stripWrap: cs(strip, 'flex-wrap'),
          stripOverflowY: cs(strip, 'overflow-y'),
          docScrollW: document.documentElement.scrollWidth,
          docScrollH: document.documentElement.scrollHeight,
          innerW: window.innerWidth,
          innerH: window.innerHeight,
          propertiesCount: document.querySelectorAll('[data-cad-properties]').length,
          commandInputCount: document.querySelectorAll('[data-cad-command-input]').length,
          viewportVisible: document.querySelector('[data-cad-viewport]') != null,
        };
      });
      console.log(`SHELL ${tag}: ` + JSON.stringify(shell));
      expect(shell.ribbonH).toBeLessThanOrEqual(130);
      expect(shell.propertiesCount).toBe(1);
      expect(shell.commandInputCount).toBe(1);
      expect(shell.viewportVisible).toBe(true);
      expect(shell.docScrollH).toBeLessThanOrEqual(shell.innerH + 1);
      expect(shell.docScrollW).toBeLessThanOrEqual(shell.innerW + 1);

      // Flyout opens unclipped inside the viewport. The shell auto-dismisses
      // flyouts on the next state change, so record its geometry with a
      // MutationObserver armed BEFORE the click (a post-open query always races).
      await page.evaluate(() => {
        const w = window as unknown as Record<string, unknown>;
        w.__flyoutBox = null;
        (w.__flyoutOb as MutationObserver | undefined)?.disconnect();
        const take = (): void => {
          if (w.__flyoutBox != null) return;
          const el = document.querySelector('[data-cad-ribbon-flyout="arc"]');
          if (el == null) return;
          const box = el.getBoundingClientRect();
          if (box.width === 0 && box.height === 0) return;
          w.__flyoutBox = { x: box.x, y: box.y, width: box.width, height: box.height };
        };
        const ob = new MutationObserver(take);
        ob.observe(document.body, { childList: true, subtree: true });
        w.__flyoutOb = ob;
        take();
      });
      await page.locator('[data-cad-family-caret="arc"]').click({ force: true, timeout: 10000 });
      await page.screenshot({ path: `${EVIDENCE}/${tag}-ribbon-flyout.png` });
      await expect.poll(async () => page.evaluate(() =>
        (window as unknown as Record<string, unknown>).__flyoutBox != null,
      ), { timeout: 10000 }).toBe(true);
      const flyoutBox = await page.evaluate(() => ({
        box: (window as unknown as Record<string, { x: number; y: number; width: number; height: number } | null>).__flyoutBox!,
        innerW: window.innerWidth,
        innerH: window.innerHeight,
      }));
      await page.evaluate(() =>
        ((window as unknown as Record<string, MutationObserver | undefined>).__flyoutOb?.disconnect()));
      console.log(`FLYOUT ${tag}: ` + JSON.stringify(flyoutBox));
      expect(flyoutBox.box.x).toBeGreaterThanOrEqual(-0.5);
      expect(flyoutBox.box.y).toBeGreaterThanOrEqual(-0.5);
      expect(flyoutBox.box.x + flyoutBox.box.width).toBeLessThanOrEqual(flyoutBox.innerW + 0.5);
      expect(flyoutBox.box.y + flyoutBox.box.height).toBeLessThanOrEqual(flyoutBox.innerH + 0.5);
      await page.keyboard.press('Escape');
      await homeTab(page);
      if (!(await page.locator('[data-cad-grading-group-table]').isVisible())) await openManager(page);

      // Manager + editor at this resolution.
      await openTab(page, 'definition');
      await selectRowByName(page, 'ShowDist');
      await page.screenshot({ path: `${EVIDENCE}/${tag}-manager-definition.png` });
      await page.locator('[data-cad-grading-group-edit-criteria]').click();
      await expect(page.locator('[data-cad-grading-group-edit-panel]')).toBeVisible({ timeout: 10000 });
      await page.screenshot({ path: `${EVIDENCE}/${tag}-manager-editor.png` });
      await page.locator('[data-cad-grading-group-edit-cancel]').click();

      // Course Criteria for each family.
      for (const name of ['ShowDist', 'ShowElev', 'ShowSurf']) {
        await selectRowByName(page, name);
        await openTab(page, 'criteria');
        await expect(criteriaPanel(page)).toBeVisible({ timeout: 10000 });
      }
      await selectRowByName(page, 'ShowDist');
      await openTab(page, 'criteria');
      await criteriaPanel(page).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${EVIDENCE}/${tag}-criteria-distance.png` });
      await selectRowByName(page, 'ShowSurf');
      await openTab(page, 'criteria');
      await criteriaPanel(page).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${EVIDENCE}/${tag}-criteria-surface.png` });

      // Group Inquiry with CURRENT results.
      await selectRowByName(page, 'ShowDist');
      await openTab(page, 'inquiry');
      await expect(page.locator('[data-cad-grading-group-inquiry-report]')).toContainText('target 25', { timeout: 15000 });
      await page.locator('[data-cad-grading-group-inquiry-report]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${EVIDENCE}/${tag}-inquiry.png` });

      // Properties block for the selected group (canvas selection cleared).
      await homeTab(page);
      await page.locator('[data-cad-command="SHELL_CLEAR_SELECTION"]').click();
      await expect(page.locator('[data-cad-grading-group-properties-method]')).toContainText('Distance', { timeout: 10000 });
      await page.screenshot({ path: `${EVIDENCE}/${tag}-properties.png` });
    } finally {
      fs.rmSync(file, { force: true });
    }
    expect(errors).toEqual([]);
  });
}

test('20F.1 a11y keyboard walk through manager, editor, and criteria', async ({ page }: { page: Page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors: string[] = [];
  await gotoCad(page, errors);
  const { file } = seedShowcase();
  try {
    await openSurveyPlanDrawing(page, file);
    await openManager(page);
    await selectRowByName(page, 'ShowDist');

    // Every control in the manager exposes an accessible name.
    const unnamed = await page.locator('section[aria-label="Grading group manager"]').evaluate((root) => {
      const bad: string[] = [];
      for (const el of root.querySelectorAll('input, select, button')) {
        const label = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim();
        if (label.length === 0) bad.push(el.tagName + '.' + el.className);
      }
      return bad;
    });
    expect(unnamed).toEqual([]);

    // Rejection notices travel via role=status.
    await expect(page.locator('[data-cad-grading-group-notice]')).toHaveCount(0);
    const editBtn = page.locator('[data-cad-grading-group-edit-criteria]');
    await editBtn.focus();
    await expect(editBtn).toBeFocused();
    await page.keyboard.press('Enter');
    const editPanel = page.locator('[data-cad-grading-group-edit-panel]');
    await expect(editPanel).toBeVisible({ timeout: 10000 });

    // Keyboard walk: method -> grade -> distance -> Apply -> Cancel.
    const method = editPanel.locator('[data-cad-grading-field="cad-grading-group-edit-method"]');
    await method.focus();
    const order: string[] = [];
    for (let i = 0; i < 10; i++) {
      const label = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el == null ? 'none' : (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim().slice(0, 40);
      });
      order.push(label);
      if (label.includes('Cancel')) break;
      await page.keyboard.press('Tab');
    }
    console.log('TAB ORDER: ' + JSON.stringify(order));
    expect(order.some((label) => label.includes('Cancel'))).toBe(true);
    expect(order.some((label) => label.includes('Apply'))).toBe(true);
    await page.screenshot({ path: `${EVIDENCE}/1366-a11y-focus.png` });
    await page.locator('[data-cad-grading-group-edit-cancel]').click();

    // Criteria tab: checkboxes + Apply/Reset reachable and named; notice slot is role=status.
    await openTab(page, 'criteria');
    const panel = criteriaPanel(page);
    await expect(panel).toBeVisible({ timeout: 10000 });
    await panel.locator('[aria-label="Select Course 1"]').focus();
    await expect(panel.locator('[aria-label="Select Course 1"]')).toBeFocused();
    await page.keyboard.press('Space');
    await panel.locator('[data-cad-grading-group-criteria-apply-selected]').focus();
    await page.keyboard.press('Enter');
    const notice = page.locator('[data-cad-grading-group-notice]');
    await expect(notice).toBeVisible({ timeout: 10000 });
    await expect(notice).toHaveAttribute('role', 'status');
    await page.screenshot({ path: `${EVIDENCE}/1366-a11y-criteria.png` });

    // Honest disabled state: the surface group cannot Calculate while EG was never rebuilt.
    await openTab(page, 'definition');
    await selectRowByName(page, 'ShowSurf');
    await expect(page.locator('[data-cad-grading-group-calculate]')).toBeDisabled({ timeout: 10000 });
    await page.screenshot({ path: `${EVIDENCE}/1366-a11y-disabled-calculate.png` });
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
});

const ribbonTab = (page: Page, name: string) =>
  page.locator('[aria-label="Ribbon tabs"]').getByRole('tab', { name });

/** Rebuild the seeded EG surface through the shipped Surface manager (20B pattern). */
const rebuildSurface = async (page: Page, surfaceId: string): Promise<void> => {
  await ribbonTab(page, 'Surface').click();
  await page.getByRole('button', { name: 'Add Point Group' }).first().click();
  const manager = page.locator('section[aria-label="Surface manager"]');
  await expect(manager).toBeVisible({ timeout: 10000 });
  await manager.locator('ul button', { hasText: 'EG' }).click();
  await manager.getByRole('button', { name: 'Rebuild', exact: true }).click();
  await page.locator('[aria-label="Toolspace tabs"]').getByRole('tab', { name: 'Survey' }).click();
  const surface = page.locator(`[data-cad-toolspace] [data-cad-surface="${surfaceId}"]`);
  await expect(surface).toBeVisible({ timeout: 15000 });
  await expect
    .poll(() => surface.getAttribute('data-cad-surface-status'), { timeout: 60000 })
    .toBe('CURRENT');
};

// ---------------------------------------------------------------- A + B ----
test('A+B distance+elevation create->Calculate->CURRENT->Properties->Inquiry->edit->recalc', async ({ page }: { page: Page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors: string[] = [];
  await gotoCad(page, errors);
  const ids = freshIds();
  const file = writeWorld(ids, []);
  try {
    await openSurveyPlanDrawing(page, file);
    await openManager(page);
    await page.screenshot({ path: `${EVIDENCE}/1366-manager-blank.png` });

    // ---- A: distance group on the 2-course chain (defaults: -2%, 20 m).
    await page.locator('[data-cad-grading-group-create] [aria-label="New group name"]').fill('DistA');
    await page.locator('[data-cad-grading-group-create] [aria-label="Source feature line"]').selectOption(ids.chainId);
    await page.locator('[data-cad-grading-group-create] [aria-label="Last course"]').selectOption('1');
    await page.locator('[data-cad-grading-field="cad-grading-group-method"]').selectOption('distance');
    await page.screenshot({ path: `${EVIDENCE}/1366-create-distance.png` });
    await page.locator('[data-cad-grading-group-create-submit]').click();
    await expect(page.locator('[data-cad-grading-group-notice]')).toContainText('Created', { timeout: 10000 });
    await calculateAndWaitCurrent(page, 'DistA');
    await page.screenshot({ path: `${EVIDENCE}/1366-distance-current.png` });

    // Group Properties surface only when the canvas selection is empty.
    await homeTab(page);
    await page.locator('[data-cad-command="SHELL_CLEAR_SELECTION"]').click();
    await expect(page.locator('[data-cad-properties="none"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-cad-grading-group-properties-method]')).toContainText('Distance', { timeout: 10000 });
    await page.screenshot({ path: `${EVIDENCE}/1366-properties-distance.png` });

    await openTab(page, 'inquiry');
    await expect(page.locator('[data-cad-grading-group-inquiry-report]')).toContainText('Distance', { timeout: 10000 });
    await expect(page.locator('[data-cad-grading-group-inquiry-report]')).toContainText('20', { timeout: 10000 });
    await page.locator('[data-cad-grading-group-inquiry-report]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${EVIDENCE}/1366-inquiry-distance.png` });

    // Edit Distance 20 -> 30, recalc, tie metrics move with it.
    await openTab(page, 'definition');
    await selectRowByName(page, 'DistA');
    await page.locator('[data-cad-grading-group-edit-criteria]').click();
    const editPanel = page.locator('[data-cad-grading-group-edit-panel]');
    await expect(editPanel).toBeVisible({ timeout: 10000 });
    await editPanel.locator('[data-cad-grading-field="cad-grading-group-edit-distance"]').fill('15');
    await editPanel.locator('[data-cad-grading-group-edit-apply]').click();
    await expect(page.locator('[data-cad-grading-group-notice]')).toContainText('Criteria updated', { timeout: 10000 });
    await calculateAndWaitCurrent(page, 'DistA');
    await expect(page.locator('[data-cad-grading-group-row]', { hasText: 'DistA' }))
      .toContainText('15.00–15.00 m', { timeout: 15000 });

    // ---- B: elevation group (target 9.8 m -> 10 m ties at -2%).
    await page.locator('[data-cad-grading-group-create] [aria-label="New group name"]').fill('ElevB');
    await page.locator('[data-cad-grading-group-create] [aria-label="Source feature line"]').selectOption(ids.chainId);
    await page.locator('[data-cad-grading-group-create] [aria-label="Last course"]').selectOption('1');
    await page.locator('[data-cad-grading-field="cad-grading-group-method"]').selectOption('elevation');
    await page.locator('[data-cad-grading-field="cad-grading-group-elevation"]').fill('9.8');
    await page.screenshot({ path: `${EVIDENCE}/1366-create-elevation.png` });
    await page.locator('[data-cad-grading-group-create-submit]').click();
    await expect(page.locator('[data-cad-grading-group-notice]')).toContainText('Created', { timeout: 10000 });
    await calculateAndWaitCurrent(page, 'ElevB');
    await selectRowByName(page, 'ElevB');
    await homeTab(page);
    await page.locator('[data-cad-command="SHELL_CLEAR_SELECTION"]').click();
    await expect(page.locator('[data-cad-grading-group-properties-method]')).toContainText('Elevation', { timeout: 10000 });
    await openTab(page, 'inquiry');
    await expect(page.locator('[data-cad-grading-group-inquiry-report]')).toContainText('9.8', { timeout: 10000 });
    await page.locator('[data-cad-grading-group-inquiry-report]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${EVIDENCE}/1366-inquiry-elevation.png` });
    await openTab(page, 'definition');
    await expect(page.locator('[data-cad-grading-group-row]', { hasText: 'ElevB' }))
      .toContainText('10.00–10.00 m', { timeout: 15000 });
    await page.screenshot({ path: `${EVIDENCE}/1366-elevation-current.png` });
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ E + CSV ------
test('E distance group course overrides incl. Inquiry + CSV Target Value', async ({ page }: { page: Page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors: string[] = [];
  await gotoCad(page, errors);
  const ids = freshIds();
  const file = writeWorld(ids, [{ name: 'DistE', fl: 'chain', courses: [[0, 1], [1, 2]], criterion: { ...DIST } }]);
  try {
    await openSurveyPlanDrawing(page, file);
    await openManager(page);
    await calculateAndWaitCurrent(page, 'DistE');
    await openTab(page, 'criteria');
    const panel = criteriaPanel(page);
    await expect(panel).toBeVisible({ timeout: 10000 });
    // Family lock: no method selector, locked Distance label only.
    await expect(panel.locator('[data-cad-grading-field="cad-grading-group-criteria-method-locked"]'))
      .toContainText('Distance');
    await expect(panel.locator('[data-cad-grading-field="cad-grading-group-criteria-method"]')).toHaveCount(0);
    // Override BOTH courses with distance 25 (symmetric 90° corner still miters).
    await panel.locator('[aria-label="Select Course 1"]').check();
    await panel.locator('[aria-label="Select Course 2"]').check();
    await panel.locator('[data-cad-grading-field="cad-grading-group-criteria-distance"]').fill('25');
    await panel.locator('[data-cad-grading-group-criteria-apply-selected]').click();
    await expect(page.locator('[data-cad-grading-group-notice]')).toContainText('courses overridden', { timeout: 10000 });
    await expect(panel.locator('[data-cad-grading-group-criteria-row="0"]')).toContainText('Distance');
    await expect(panel.locator('[data-cad-grading-group-criteria-row="0"]')).toContainText('Override');
    await expect(panel.locator('[data-cad-grading-group-criteria-row="1"]')).toContainText('Override');
    await criteriaPanel(page).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${EVIDENCE}/1366-criteria-distance.png` });
    // Inquiry + CSV carry the analytic target.
    await openTab(page, 'inquiry');
    await calculateAndWaitCurrent(page, 'DistE');
    await openTab(page, 'inquiry');
    await expect(page.locator('[data-cad-grading-group-inquiry-report]')).toContainText('target 25', { timeout: 15000 });
    await page.locator('[data-cad-grading-group-inquiry-report]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${EVIDENCE}/1366-inquiry-distance-override.png` });
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
    expect(csvText).toContain('Target Value');
    expect(csvText).toContain('25');
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ F ------------
test('F elevation group course overrides stay in-family', async ({ page }: { page: Page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors: string[] = [];
  await gotoCad(page, errors);
  const ids = freshIds();
  const file = writeWorld(ids, [{ name: 'ElevF', fl: 'chain', courses: [[0, 1], [1, 2]], criterion: { ...ELEV } }]);
  try {
    await openSurveyPlanDrawing(page, file);
    await openManager(page);
    await calculateAndWaitCurrent(page, 'ElevF');
    await openTab(page, 'criteria');
    const panel = criteriaPanel(page);
    await expect(panel).toBeVisible({ timeout: 10000 });
    await expect(panel.locator('[data-cad-grading-field="cad-grading-group-criteria-method-locked"]'))
      .toContainText('Elevation');
    await expect(panel.locator('[data-cad-grading-field="cad-grading-group-criteria-method"]')).toHaveCount(0);
    await panel.locator('[aria-label="Select Course 1"]').check();
    await panel.locator('[aria-label="Select Course 2"]').check();
    await panel.locator('[data-cad-grading-field="cad-grading-group-criteria-elevation"]').fill('9.5');
    await panel.locator('[data-cad-grading-group-criteria-apply-selected]').click();
    await expect(page.locator('[data-cad-grading-group-notice]')).toContainText('overridden', { timeout: 10000 });
    await expect(panel.locator('[data-cad-grading-group-criteria-row="1"]')).toContainText('Elevation');
    await expect(panel.locator('[data-cad-grading-group-criteria-row="1"]')).toContainText('Override');
    await criteriaPanel(page).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${EVIDENCE}/1366-criteria-elevation.png` });
    await openTab(page, 'inquiry');
    await calculateAndWaitCurrent(page, 'ElevF');
    await openTab(page, 'inquiry');
    await expect(page.locator('[data-cad-grading-group-inquiry-report]')).toContainText('target 9.5', { timeout: 15000 });
    await page.locator('[data-cad-grading-group-inquiry-report]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${EVIDENCE}/1366-inquiry-elevation-override.png` });
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ G ------------
test('G surface group criteria offer Fixed + Cut/Fill only, legacy rows unchanged', async ({ page }: { page: Page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors: string[] = [];
  await gotoCad(page, errors);
  const ids = freshIds();
  const file = writeWorld(ids, [{
    name: 'SurfG', fl: 'square', courses: [[0, 1], [1, 2], [2, 3], [3, 0]],
    criterion: { ...SURF }, closed: true,
  }]);
  try {
    await openSurveyPlanDrawing(page, file);
    await rebuildSurface(page, ids.targetId);
    await openManager(page);
    await calculateAndWaitCurrent(page, 'SurfG');
    await openTab(page, 'criteria');
    const panel = criteriaPanel(page);
    await expect(panel).toBeVisible({ timeout: 10000 });
    await expect(panel.locator('[data-cad-grading-field="cad-grading-group-criteria-method-locked"]'))
      .toContainText('Surface');
    // No cross-family options: no method selector, no distance/elevation fields.
    await expect(panel.locator('[data-cad-grading-field="cad-grading-group-criteria-method"]')).toHaveCount(0);
    await expect(panel.locator('[data-cad-grading-field="cad-grading-group-criteria-distance"]')).toHaveCount(0);
    await expect(panel.locator('[data-cad-grading-field="cad-grading-group-criteria-elevation"]')).toHaveCount(0);
    const kindOptions = await panel.locator('[aria-label="Criterion kind"]').locator('option').allTextContents();
    expect(kindOptions).toEqual(['Fixed grade', 'Cut / Fill']);
    // Legacy rows: 4-way truthful tags, all riding Default.
    await expect(panel.locator('[data-cad-grading-group-criteria-row="0"]')).toContainText('Surface Fixed');
    for (const i of [0, 1, 2, 3]) {
      await expect(panel.locator(`[data-cad-grading-group-criteria-row="${i}"]`)).toContainText('Default');
    }
    await criteriaPanel(page).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${EVIDENCE}/1366-criteria-surface.png` });
    // Cut/Fill override on course 1 keeps Fixed/Cut-Fill columns honest.
    await panel.locator('[aria-label="Select Course 1"]').check();
    await panel.locator('[aria-label="Criterion kind"]').selectOption('cut-fill');
    // Cut/Fill takes nH:1V colon form; the bare defaults stay invalid until typed.
    await panel.locator('[aria-label="Cut ratio"]').fill('2:1');
    await panel.locator('[aria-label="Fill ratio"]').fill('3:1');
    await expect(panel.locator('[data-cad-grading-criterion-summary]')).toContainText('Cut', { timeout: 10000 });
    await panel.locator('[data-cad-grading-group-criteria-apply-selected]').click();
    await expect(page.locator('[data-cad-grading-group-notice]')).toContainText('course overridden', { timeout: 10000 });
    await expect(panel.locator('[data-cad-grading-group-criteria-row="0"]')).toContainText('Surface Cut/Fill');
    await criteriaPanel(page).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${EVIDENCE}/1366-criteria-surface-cutfill.png` });
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ H then C -----
test('H rejected cross-family edit stays open + C analytic->Surface with real target', async ({ page }: { page: Page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors: string[] = [];
  await gotoCad(page, errors);
  const ids = freshIds();
  const file = writeWorld(ids, [{
    name: 'DistHC', fl: 'chain', courses: [[0, 1], [1, 2]], criterion: { ...DIST },
    overrides: [{
      sourceCourse: { vertexAId: `${ids.chainId}:v0`, vertexBId: `${ids.chainId}:v1` },
      criterion: { kind: 'distance', gradeRatio: -0.02, distance: 25 },
    }],
  }]);
  try {
    await openSurveyPlanDrawing(page, file);
    await rebuildSurface(page, ids.targetId);
    await openManager(page);
    await selectRowByName(page, 'DistHC');
    await page.locator('[data-cad-grading-group-edit-criteria]').click();
    const editPanel = page.locator('[data-cad-grading-group-edit-panel]');
    await expect(editPanel).toBeVisible({ timeout: 10000 });
    // H: cross-family switch with a live distance override must be rejected.
    await editPanel.locator('[data-cad-grading-field="cad-grading-group-edit-method"]').selectOption('surface');
    // Target selector appears only once Surface is chosen.
    const targetSelect = editPanel.locator('[aria-label="Target surface"]');
    await expect(targetSelect).toBeVisible({ timeout: 10000 });
    await editPanel.locator('[data-cad-grading-group-edit-apply]').click();
    await expect(page.locator('[data-cad-grading-group-notice]'))
      .toContainText('one termination family per group', { timeout: 10000 });
    // Editor stays open and the persisted definition is unchanged.
    await expect(editPanel).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-cad-grading-group-row]', { hasText: 'DistHC' }))
      .toHaveAttribute('data-cad-grading-group-row-method', 'distance');
    await page.screenshot({ path: `${EVIDENCE}/1366-edit-rejected-notice.png` });
    await page.screenshot({ path: `${EVIDENCE}/1366-edit-analytic-to-surface.png` });

    // C: reset the override, then the same switch commits with a real target.
    await openTab(page, 'criteria');
    await criteriaPanel(page).locator('[data-cad-grading-group-criteria-reset="0"]').click();
    await expect(page.locator('[data-cad-grading-group-notice]')).toContainText('Override cleared', { timeout: 10000 });
    await openTab(page, 'definition');
    await selectRowByName(page, 'DistHC');
    // Edit panel reopened fresh (method back to distance); switch again.
    const edit2 = page.locator('[data-cad-grading-group-edit-panel]');
    if (await edit2.count() === 0 || !(await edit2.isVisible())) {
      await page.locator('[data-cad-grading-group-edit-criteria]').click();
    }
    await expect(edit2).toBeVisible({ timeout: 10000 });
    await edit2.locator('[data-cad-grading-field="cad-grading-group-edit-method"]').selectOption('surface');
    const target2 = edit2.locator('[aria-label="Target surface"]');
    await expect(target2).toBeVisible({ timeout: 10000 });
    const targetOptions = await target2.locator('option').allTextContents();
    expect(targetOptions).toContain('EG');
    await target2.selectOption({ label: 'EG' });
    await edit2.locator('[data-cad-grading-field="cad-grading-group-edit-magnitude"]').fill('50');
    await edit2.locator('[data-cad-grading-group-edit-apply]').click();
    await expect(page.locator('[data-cad-grading-group-notice]')).toContainText('Criteria updated', { timeout: 10000 });
    await expect(edit2).toBeHidden({ timeout: 10000 });
    await expect(page.locator('[data-cad-grading-group-row]', { hasText: 'DistHC' }))
      .toHaveAttribute('data-cad-grading-group-row-method', 'surface');
    await calculateAndWaitCurrent(page, 'DistHC');
    await page.screenshot({ path: `${EVIDENCE}/1366-surface-after-analytic-switch.png` });
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------ D ------------
test('D surface->analytic edit commits once overrides are cleared', async ({ page }: { page: Page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors: string[] = [];
  await gotoCad(page, errors);
  const ids = freshIds();
  const file = writeWorld(ids, [{
    name: 'SurfD', fl: 'chain', courses: [[0, 1], [1, 2]], criterion: { ...SURF },
    overrides: [{
      sourceCourse: { vertexAId: `${ids.chainId}:v0`, vertexBId: `${ids.chainId}:v1` },
      criterion: { kind: 'fixed', gradeRatio: -0.75 },
    }],
  }]);
  try {
    await openSurveyPlanDrawing(page, file);
    await rebuildSurface(page, ids.targetId);
    await openManager(page);
    await selectRowByName(page, 'SurfD');
    await openTab(page, 'criteria');
    await criteriaPanel(page).locator('[data-cad-grading-group-criteria-reset="0"]').click();
    await expect(page.locator('[data-cad-grading-group-notice]')).toContainText('Override cleared', { timeout: 10000 });
    await openTab(page, 'definition');
    await selectRowByName(page, 'SurfD');
    await page.locator('[data-cad-grading-group-edit-criteria]').click();
    const editPanel = page.locator('[data-cad-grading-group-edit-panel]');
    await expect(editPanel).toBeVisible({ timeout: 10000 });
    await editPanel.locator('[data-cad-grading-field="cad-grading-group-edit-method"]').selectOption('distance');
    await editPanel.locator('[data-cad-grading-group-edit-apply]').click();
    await expect(page.locator('[data-cad-grading-group-notice]')).toContainText('Criteria updated', { timeout: 10000 });
    await expect(page.locator('[data-cad-grading-group-row]', { hasText: 'SurfD' }))
      .toHaveAttribute('data-cad-grading-group-row-method', 'distance');
    // Dependency cleared: no override records survive the family switch.
    await openTab(page, 'criteria');
    await expect(criteriaPanel(page).locator('[data-cad-grading-group-criteria-default]'))
      .toContainText('Overrides: 0', { timeout: 10000 });
    await calculateAndWaitCurrent(page, 'SurfD');
    await page.screenshot({ path: `${EVIDENCE}/1366-distance-after-surface-switch.png` });
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
});
