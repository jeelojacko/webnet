/**
 * PERF-185.1 browser QA — surface revision reuse + contour auto-derive.
 *
 * Deterministic, no wall-clock thresholds. Dev-server Chromium, real worker
 * path. The contour derive requests are counted by wrapping
 * `SurfaceWorkerClient.prototype.deriveContours` in-page (the same module
 * instance the app uses). Asserts:
 *  - a CURRENT TIN with a contour style derives exactly once;
 *  - idle / live viewport interactions (zoom/pan/selection) never
 *    re-request;
 *  - an interval change re-derives once for the new geometry revision;
 *  - a source edit goes NEEDS_REBUILD and block/never promotes stale
 *    contours; the rebuild re-derives once;
 *  - undo/redo of the style edit returns to the prior set and re-derives
 *    correctly;
 *  - a drawing switch resets the session (no cross-drawing request);
 *  - zero page/console errors throughout.
 */
import { expect, test, type Page } from '@playwright/test';

const SHOT_DIR = 'docs/evidence/perf-185';
const SEED = 'tests-browser/fixtures/cad-surface-18g-seed.wncad';
const CONSTRAINTS_ID = 'qa-surf-constraints';

async function gotoCad(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    const record = window as unknown as Record<string, unknown>;
    delete record.showSaveFilePicker;
    delete record.showOpenFilePicker;
  });
  await page.goto('/cad', { waitUntil: 'networkidle' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-cad-viewport]')).toBeVisible({ timeout: 30000 });
}

async function entityCount(page: Page): Promise<number> {
  return Number.parseInt((await page.locator('[data-survey-cad-entity-count]').textContent()) ?? '0', 10);
}

async function selectionCount(page: Page): Promise<number> {
  return Number.parseInt((await page.locator('[data-survey-cad-selection-count]').textContent()) ?? '0', 10);
}

async function openDrawing(page: Page, filePath: string, expectedEntities: number): Promise<void> {
  const fileInput = page.locator('[data-survey-cad-open-drawing-input]');
  await fileInput.evaluate((element: HTMLInputElement) => element.classList.remove('hidden')).catch(() => {});
  await fileInput.setInputFiles(filePath);
  await expect.poll(() => entityCount(page)).toBe(expectedEntities);
}

async function showSurveyTab(page: Page): Promise<void> {
  await page.locator('[aria-label="Toolspace tabs"]').getByRole('tab', { name: 'Survey' }).click();
}

function managerScope(page: Page) {
  return page.locator('section[aria-label="Surface manager"]');
}

function ribbonTab(page: Page, name: string) {
  return page.locator('[aria-label="Ribbon tabs"]').getByRole('tab', { name });
}

function toolspaceSurface(page: Page, id: string) {
  return page.locator(`[data-cad-toolspace] [data-cad-surface="${id}"]`);
}

async function surfaceStatus(page: Page, id: string): Promise<string> {
  return (await toolspaceSurface(page, id).getAttribute('data-cad-surface-status')) ?? '';
}

function surfaceLayer(page: Page, id: string) {
  return page.locator(`[data-surface-layer="${id}"]`);
}

function contourPaths(page: Page, id: string) {
  return surfaceLayer(page, id).locator(':scope > g path');
}

async function contourD(page: Page, id: string): Promise<string[]> {
  return contourPaths(page, id).evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('d') ?? ''));
}

async function deriveCount(page: Page): Promise<number> {
  return page.evaluate(() => Number((window as unknown as Record<string, unknown>).__perf185Derives ?? 0));
}

async function installDeriveCounter(page: Page): Promise<void> {
  await page.evaluate(async (clientUrl: string) => {
    const record = window as unknown as Record<string, unknown>;
    record.__perf185Derives = 0;
    const mod = (await import(/* @vite-ignore */ clientUrl)) as {
      SurfaceWorkerClient: { prototype: Record<string, (..._args: unknown[]) => unknown> };
    };
    if ((record.__perf185CounterInstalled as boolean | undefined) === true) return;
    const proto = mod.SurfaceWorkerClient.prototype;
    const original = proto.deriveContours;
    proto.deriveContours = function patched(this: unknown, ...args: unknown[]): unknown {
      (window as unknown as Record<string, number>).__perf185Derives =
        ((window as unknown as Record<string, number>).__perf185Derives ?? 0) + 1;
      return original.apply(this, args);
    };
    record.__perf185CounterInstalled = true;
  }, '/src/workers/surfaceWorkerClient.ts');
}

async function openManager(page: Page): Promise<void> {
  await ribbonTab(page, 'Surface').click();
  await page.getByRole('button', { name: 'Add Point Group' }).first().click();
  await expect(managerScope(page)).toBeVisible({ timeout: 10000 });
}

async function buildConstraintsCurrent(page: Page): Promise<void> {
  await openDrawing(page, SEED, 32);
  await showSurveyTab(page);
  await expect(toolspaceSurface(page, CONSTRAINTS_ID)).toBeVisible();
  await expect.poll(() => surfaceStatus(page, CONSTRAINTS_ID)).toBe('UNBUILT');
  await openManager(page);
  const manager = managerScope(page);
  await manager.getByRole('button', { name: /QA Constraints, (Unbuilt|Needs Rebuild)/ }).click();
  await manager.getByRole('button', { name: 'Rebuild', exact: true }).click();
  await expect.poll(() => surfaceStatus(page, CONSTRAINTS_ID), { timeout: 60000 }).toBe('CURRENT');
}

async function selectContoursStyle(page: Page): Promise<void> {
  const manager = managerScope(page);
  await manager.getByLabel('Surface style', { exact: true }).selectOption({ label: 'Triangles' });
  await manager.getByLabel('Show contours').check();
  await manager.getByRole('button', { name: 'Apply geometry' }).click();
  await expect
    .poll(() => surfaceLayer(page, CONSTRAINTS_ID).getAttribute('data-surface-contours'), { timeout: 60000 })
    .toBe('true');
  await expect.poll(() => contourPaths(page, CONSTRAINTS_ID).count(), { timeout: 60000 }).toBe(2);
}

async function viewportBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator('[data-cad-viewport] svg').first().boundingBox();
  if (!box) throw new Error('viewport svg has no bounding box');
  return box;
}

test('PERF-185: one derive per eligible set, live-correct through edit/rebuild/undo/switch', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await buildConstraintsCurrent(page);
  // Counter must be installed before the first contour derivation.
  await installDeriveCounter(page);
  await selectContoursStyle(page);

  // (1) Initial derivation: exactly one request for the (revision, geometry).
  await expect.poll(() => deriveCount(page), { timeout: 60000 }).toBe(1);
  const before = await contourD(page, CONSTRAINTS_ID);
  expect(before.length).toBe(2);

  // (2) Ten unrelated viewport interactions (zoom in/out + pan): no derive.
  const box = await viewportBox(page);
  for (let index = 0; index < 5; index += 1) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -120);
    await page.mouse.wheel(0, 120);
  }
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  expect(await deriveCount(page)).toBe(1);
  expect(await contourD(page, CONSTRAINTS_ID)).toEqual(before);

  // (3) Selection changes (unrelated renders): still no derive.
  await ribbonTab(page, 'Home').click();
  await page.locator('[data-cad-command="SHELL_SELECT_ALL"]').click();
  await expect.poll(() => selectionCount(page)).toBe(32);
  await page.locator('[data-cad-command="SHELL_CLEAR_SELECTION"]').click();
  await page.waitForTimeout(150);
  expect(await deriveCount(page)).toBe(1);

  // (4) Interval change: new geometry revision => exactly one new derive.
  const manager = managerScope(page);
  await manager.getByLabel('Minor contour interval').fill('2');
  await manager.getByRole('button', { name: 'Apply geometry' }).click();
  await expect.poll(() => deriveCount(page), { timeout: 60000 }).toBe(2);
  const afterInterval = await contourD(page, CONSTRAINTS_ID);
  expect(afterInterval.join('|')).not.toBe(before.join('|'));
  expect(await surfaceStatus(page, CONSTRAINTS_ID)).toBe('CURRENT');

  // (5) Undo the interval edit: back to the prior geometry revision. The
  // retained interval-1 set is still cached, so NO new worker call happens
  // (the memo/cache keys reject a stale promotion) and the original paths
  // return.
  await ribbonTab(page, 'Home').click();
  await page.locator('[data-cad-command="SHELL_UNDO"]').click({ timeout: 15000 });
  await expect.poll(() => contourD(page, CONSTRAINTS_ID).then((ds) => ds.join('|')), { timeout: 60000 })
    .toBe(before.join('|'));
  expect(await deriveCount(page)).toBe(2);

  // (6) Redo returns to interval 2 — likewise a retained-cache hit, zero new
  // worker calls.
  await page.locator('[data-cad-command="SHELL_REDO"]').click({ timeout: 15000 });
  await expect.poll(() => contourD(page, CONSTRAINTS_ID).then((ds) => ds.join('|')), { timeout: 60000 })
    .toBe(afterInterval.join('|'));
  expect(await deriveCount(page)).toBe(2);

  // (7) Source edit via the manager (add a second point group): the TIN goes
  // stale; no new derive may promote stale contours.
  await manager.getByLabel('Add point group').selectOption('g-high');
  await manager.getByRole('button', { name: 'Add Group' }).click();
  await expect.poll(() => surfaceStatus(page, CONSTRAINTS_ID)).toBe('NEEDS_REBUILD');
  await page.waitForTimeout(200);
  expect(await deriveCount(page)).toBe(2);
  const stalePaths = await contourPaths(page, CONSTRAINTS_ID).count();
  const staleFlag = await surfaceLayer(page, CONSTRAINTS_ID).getAttribute('data-surface-stale');
  // A source revision with no rebuilt TIN must never show a CURRENT contour.
  expect(staleFlag === 'true' || stalePaths === 0).toBe(true);

  // (8) Rebuild: re-derives once and returns to CURRENT.
  await managerScope(page).getByRole('button', { name: /QA Constraints, Needs Rebuild/ }).click();
  await managerScope(page).getByRole('button', { name: 'Rebuild', exact: true }).click();
  await expect.poll(() => deriveCount(page), { timeout: 60000 }).toBe(3);
  await expect.poll(() => surfaceStatus(page, CONSTRAINTS_ID), { timeout: 60000 }).toBe('CURRENT');

  // (9) Drawing switch: a new drawing has no surfaces and must not reuse the
  // old session; reopening the seed starts fresh (contours unbuilt).
  const derivesBeforeSwitch = await deriveCount(page);
  await page.getByLabel('Add drawing tab').click();
  await expect.poll(() => entityCount(page)).toBe(0);
  await showSurveyTab(page);
  expect(await deriveCount(page)).toBe(derivesBeforeSwitch);
  await openDrawing(page, SEED, 32);
  await expect.poll(() => surfaceStatus(page, CONSTRAINTS_ID)).toMatch(/UNBUILT|NEEDS_REBUILD/);
  await page.waitForTimeout(200);
  expect(await deriveCount(page)).toBe(derivesBeforeSwitch);

  await page.screenshot({ path: `${SHOT_DIR}/browser-contours.png` });
  expect(errors).toEqual([]);
});
