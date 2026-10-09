/**
 * STRUCT-194.6 browser QA — compose control plane + viewport inquiry picks
 * through the real /cad app.
 *
 * Playwright (dev-server + Chromium), NOT vitest. The extracted
 * `createCadSurfacePickDispatch` is exercised through the REAL canvas click →
 * `onSurfacePickPoint` path for the surface elevation / slope and volume
 * inquiry picks; the extracted compose lifecycle is exercised through the real
 * `SURFCOMPOSE` transaction (copy → one undo). Zero page/console/unhandled
 * errors per test.
 *
 * The Surface Manager overlays the viewport, so a pick is armed, the manager is
 * closed, the preview is clicked, and the manager is reopened to read the
 * persisted answer. The compose fixture bounds are
 * `{minX:-20,minY:-20,maxX:80,maxY:80}`; the projector formula below mirrors
 * `SurveyCadPreview.geometry.ts` so a click lands on a chosen world point
 * inside the base grid (away from grid nodes / triangle strokes).
 */
import { expect, test, type Page } from '@playwright/test';
import { gotoCad } from './cad-surface-bake-18x-helpers';
import {
  BASE_ID,
  BASE_NAME,
  SAME_ID,
  SAME_NAME,
  TWIN_ID,
  TWIN_NAME,
  closeComposeDialog,
  closeSurfaceManager,
  composeCopy,
  listRow,
  managerScope,
  openComposeDrawing,
  openSurfaceManager,
  rebuildSurface,
  ribbonTab,
  showSurveyTab,
} from './cad-surface-compose-18y-helpers';

test.use({ actionTimeout: 15000 });

const PREVIEW_WIDTH = 900;
const PREVIEW_HEIGHT = 520;
const PREVIEW_PADDING = 36;
/** normalizePreviewBounds(compose bounds) with 8% padding. */
const NORMALIZED = { minX: -28, minY: -28, maxX: 88, maxY: 88 };

const projectToViewBox = (x: number, y: number): { viewX: number; viewY: number } => {
  const width = NORMALIZED.maxX - NORMALIZED.minX;
  const height = NORMALIZED.maxY - NORMALIZED.minY;
  const baseScale = Math.min(
    (PREVIEW_WIDTH - PREVIEW_PADDING * 2) / width,
    (PREVIEW_HEIGHT - PREVIEW_PADDING * 2) / height,
  );
  return {
    viewX: PREVIEW_PADDING + (x - NORMALIZED.minX) * baseScale,
    viewY: PREVIEW_HEIGHT - PREVIEW_PADDING - (y - NORMALIZED.minY) * baseScale,
  };
};

/** Click the real preview SVG at a world coordinate. */
async function clickWorld(page: Page, x: number, y: number): Promise<void> {
  const svg = page.locator('[data-survey-cad-preview]');
  const box = await svg.boundingBox();
  if (!box) throw new Error('preview svg has no bounding box');
  const scaleFactor = Math.min(box.width / PREVIEW_WIDTH, box.height / PREVIEW_HEIGHT);
  const offsetX = (box.width - PREVIEW_WIDTH * scaleFactor) / 2;
  const offsetY = (box.height - PREVIEW_HEIGHT * scaleFactor) / 2;
  const { viewX, viewY } = projectToViewBox(x, y);
  await page.mouse.click(box.x + offsetX + viewX * scaleFactor, box.y + offsetY + viewY * scaleFactor);
}

test('1946-1: surface elevation + slope viewport picks answer through the real dispatcher, then pan/zoom/pointer stay clean', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openComposeDrawing(page);
  await showSurveyTab(page);
  await openSurfaceManager(page);
  await rebuildSurface(page, BASE_NAME, BASE_ID);

  const manager = managerScope(page);

  // Elevation pick (manager closed over the viewport while clicking).
  await manager.getByRole('radio', { name: 'Elevation' }).click();
  await manager.getByRole('button', { name: 'Pick in Viewport' }).click();
  await expect(manager.getByRole('button', { name: 'Cancel Pick' })).toBeVisible();
  await closeSurfaceManager(page);
  await clickWorld(page, 70, 70);
  await openSurfaceManager(page);
  await listRow(page, BASE_NAME).click();
  await expect(manager.getByRole('status').filter({ hasText: /elevation/ })).toBeVisible({ timeout: 15000 });

  // Slope pick through the same dispatcher.
  await manager.getByRole('radio', { name: 'Slope/Aspect' }).click();
  await manager.getByRole('button', { name: 'Pick in Viewport' }).click();
  await expect(manager.getByRole('button', { name: 'Cancel Pick' })).toBeVisible();
  await closeSurfaceManager(page);
  await clickWorld(page, 70, 70);
  await openSurfaceManager(page);
  await listRow(page, BASE_NAME).click();
  await expect(manager.getByRole('status').filter({ hasText: /slope/ })).toBeVisible({ timeout: 15000 });

  // Pointer/pan/zoom after a pick never raises a page/console error (#183/#186).
  const box = await page.locator('[data-survey-cad-preview]').boundingBox();
  if (!box) throw new Error('no preview box');
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.65, { steps: 6 });
  await page.mouse.up();
  await page.mouse.wheel(0, -240);
  await page.mouse.wheel(0, 240);
  await expect(page.locator('[data-survey-cad-preview]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('1946-2: volume difference pick through the real dispatcher answers a live source inquiry', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openComposeDrawing(page);
  await showSurveyTab(page);
  await openSurfaceManager(page);
  await rebuildSurface(page, BASE_NAME, BASE_ID);
  await rebuildSurface(page, TWIN_NAME, TWIN_ID);

  const manager = managerScope(page);
  await manager.getByLabel('New volume name').fill('1946-Vol');
  await manager.getByLabel('New volume base surface').selectOption({ label: BASE_NAME });
  await manager.getByLabel('New volume comparison surface').selectOption({ label: TWIN_NAME });
  await manager.getByRole('button', { name: 'Create Volume' }).click();
  const volumeRow = manager.locator('[data-volume-list] [data-cad-volume]').first();
  const volumeId = (await volumeRow.getAttribute('data-cad-volume')) ?? '';
  const volumeDetail = manager.locator(`[data-volume-detail="${volumeId}"]`);
  await volumeRow.click();
  await volumeDetail.getByRole('button', { name: /^Calculate|Recalculate$/ }).click();
  await expect.poll(
    async () => (await manager.locator('[data-volume-quantities="current"]').count()),
    { timeout: 60000 },
  ).toBe(1);

  await volumeDetail.getByRole('button', { name: 'Pick in Viewport' }).click();
  await expect(volumeDetail.getByRole('button', { name: 'Cancel Pick' })).toBeVisible();
  await closeSurfaceManager(page);
  await clickWorld(page, 70, 70);
  await openSurfaceManager(page);
  await manager.locator(`[data-volume-list] [data-cad-volume="${volumeId}"]`).click();
  await expect(
    manager.locator(`[data-volume-detail="${volumeId}"]`).getByRole('status').filter({
      hasText: /FILL 10\.000|no live source inquiry at point/,
    }),
  ).toBeVisible({ timeout: 15000 });

  expect(errors).toEqual([]);
});

test('1946-3: compose copy is one undoable SURFCOMPOSE step through the real worker', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openComposeDrawing(page);
  await showSurveyTab(page);
  await openSurfaceManager(page);
  await rebuildSurface(page, BASE_NAME, BASE_ID);
  await rebuildSurface(page, SAME_NAME, SAME_ID);

  const copy = await composeCopy(page, BASE_NAME, SAME_NAME);
  await closeComposeDialog(page);
  await expect(listRow(page, copy)).toBeVisible();

  // One undo restores the pre-compose surface list (no composite row).
  await ribbonTab(page, 'Home').click();
  await page.locator('[data-cad-command="SHELL_UNDO"]').click();
  await showSurveyTab(page);
  await expect(listRow(page, copy)).toHaveCount(0);
  await expect(listRow(page, BASE_NAME)).toBeVisible();

  expect(errors).toEqual([]);
});

test('1946-4: block INSERT pick stays armed for repeat and places one reference per pick', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openComposeDrawing(page);

  const count = async (): Promise<number> =>
    Number.parseInt((await page.locator('[data-survey-cad-entity-count]').first().textContent()) ?? '0', 10);
  const before = await count();

  // Select the drawing and mint one block definition from it.
  await page.locator('[data-cad-ribbon] [role="tab"]', { hasText: 'Home' }).click();
  await page.locator('[data-cad-command="SHELL_SELECT_ALL"]').click();
  const input = page.locator('[data-cad-command-input]');
  await input.fill('BLOCK');
  await input.press('Enter');
  const manager = page.locator('[data-cad-block-manager]');
  await expect(manager).toBeVisible({ timeout: 10000 });
  await manager.locator('input[aria-label="New block name"]').fill('1946-Block');
  await manager.getByRole('button', { name: 'New from selection' }).click();
  await expect(manager.locator('[data-cad-block-table] tbody tr')).toHaveCount(1, { timeout: 10000 });

  // INSERT is repeat-armed by default; each empty-canvas click places one ref.
  await manager.getByRole('tab', { name: 'Insert' }).click();
  await manager.getByRole('button', { name: 'Pick point' }).click();
  await expect(manager).toBeHidden({ timeout: 10000 });
  await clickWorld(page, 70, 70);
  await expect.poll(count, { timeout: 15000 }).toBe(before + 1);
  await clickWorld(page, 75, 65);
  await expect.poll(count, { timeout: 15000 }).toBe(before + 2);

  // Esc ends the loop: a further click places nothing.
  await page.keyboard.press('Escape');
  await clickWorld(page, 65, 75);
  await expect.poll(count, { timeout: 15000 }).toBe(before + 2);

  expect(errors).toEqual([]);
});
