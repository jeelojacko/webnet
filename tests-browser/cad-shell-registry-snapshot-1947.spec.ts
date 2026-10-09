/**
 * STRUCT-194.7 browser QA — the extracted CAD shell starter registry and shell
 * snapshot through the REAL /cad app in headless Chromium.
 *
 * Focuses on flows the reused #183/#184/#185/#186/1941–1946 specs do not cover:
 *   1. draw / curve / circle / COGO / line / traverse starters routing through
 *      the extracted `createCadShellCommandStarters` registry (ribbon buttons
 *      dispatch `startCommand(key)`);
 *   2. clipboard COPY enabling PASTE and a real paste commit doubling entities;
 *   3. an unknown dock command as a safe no-op plus selection/pointer stability.
 *
 * Every flow asserts zero page / console / unhandled errors.
 */
import { expect, test } from '@playwright/test';
import {
  canvasClick,
  clearSelection,
  entityCount,
  gotoCad,
  homeTab,
  openSurveyPlanDrawing,
  selectAll,
  selectionCount,
  writeSurveyPlanFixture,
} from './cad-survey-plan-19a-helpers';

test.describe.configure({ mode: 'serial' });

/** Home-tab ribbon keys whose starters live in the extracted registry. */
const STARTER_KEYS = [
  'LINE',
  'ARC_3PT',
  'CIRCLE',
  'CURVE_BETWEEN_TWO_LINES',
  'COGO_POINT',
  'PLINE',
  'TRAVERSE',
] as const;

test('1947-A draw/curve/circle/COGO/line/traverse starters route through the registry', async ({ page }) => {
  const errors: string[] = [];
  await gotoCad(page, errors);
  const input = page.locator('[data-cad-command-input]');

  for (const key of STARTER_KEYS) {
    await homeTab(page);
    const button = page.locator(`[data-cad-command="${key}"]`).first();
    await expect(button).toBeEnabled();
    await button.click();
    // A live starter opens the command dock (an undefined starter would not).
    await expect(input).toBeVisible();
    await input.press('Escape');
  }

  expect(errors).toEqual([]);
});

test('1947-B clipboard COPY enables PASTE and the paste commit reaches the registry', async ({ page }) => {
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openSurveyPlanDrawing(page, writeSurveyPlanFixture());
  const before = await entityCount(page);
  expect(before).toBeGreaterThan(0);

  // PASTE is unavailable while the clipboard is empty (registry gap).
  await homeTab(page);
  const pasteButton = page.locator('[data-cad-command="PASTE"]').first();
  await expect(pasteButton).toBeDisabled();

  // Select all + Ctrl+C fills the clipboard; PASTE becomes available.
  await selectAll(page, before);
  await page.keyboard.press('Control+c');
  await expect(pasteButton).toBeEnabled();

  // Launch PASTE and pick a point: one undoable transaction adds copied
  // entities (dependent points included) and selects exactly the new set.
  await pasteButton.click();
  const input = page.locator('[data-cad-command-input]');
  await expect(input).toBeVisible();
  await canvasClick(page, 0.55, 0.5);
  await expect.poll(() => entityCount(page)).toBeGreaterThan(before);
  const after = await entityCount(page);
  await expect.poll(() => selectionCount(page)).toBe(after - before);

  await clearSelection(page);
  expect(errors).toEqual([]);
});

test('1947-C unknown dock command is a safe no-op and pointer moves stay error-free', async ({ page }) => {
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openSurveyPlanDrawing(page, writeSurveyPlanFixture());
  const before = await entityCount(page);

  const input = page.locator('[data-cad-command-input]');
  await input.click();
  await input.fill('NOTACOMMAND');
  await input.press('Enter');
  await expect.poll(() => entityCount(page)).toBe(before);
  await input.press('Escape');

  // Selection round-trip through the shell-action control plane.
  await selectAll(page, before);
  expect(await selectionCount(page)).toBe(before);
  await clearSelection(page);

  // Idle pointer moves over the viewport must not error or mutate the drawing.
  const box = await page.locator('[data-cad-viewport]').boundingBox();
  if (box) {
    for (let index = 0; index < 6; index += 1) {
      await page.mouse.move(box.x + box.width * (0.2 + index * 0.08), box.y + box.height * 0.4);
    }
  }
  await expect.poll(() => entityCount(page)).toBe(before);
  expect(errors).toEqual([]);
});
