/**
 * STRUCT-194.2 browser QA — the extracted CAD shell-action control plane
 * through the REAL /cad app in headless Chromium. The action object is now
 * composed from cohesive factories; every flow here drives the shipped
 * ribbon / manager / command-dock UI that dispatches those actions, and
 * asserts zero page, console, and unhandled-rejection errors.
 *
 * Reuses the Phase 19A seed helpers (real createBlankCadDrawingDocument +
 * serialize path) so open/switch/remount exercise production sanitize seams.
 */
import { expect, test } from '@playwright/test';
import {
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

test('1942-A selection / erase / undo / redo dispatch through the ribbon', async ({ page }) => {
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openSurveyPlanDrawing(page, writeSurveyPlanFixture());
  const before = await entityCount(page);
  expect(before).toBeGreaterThan(0);

  await selectAll(page, before);
  await homeTab(page);
  await page.locator('[data-cad-command="SHELL_ERASE"]').click();
  await expect.poll(() => entityCount(page)).toBe(0);

  await homeTab(page);
  await page.locator('[data-cad-command="SHELL_UNDO"]').click();
  await expect.poll(() => entityCount(page)).toBe(before);
  await page.locator('[data-cad-command="SHELL_REDO"]').click();
  await expect.poll(() => entityCount(page)).toBe(0);
  await page.locator('[data-cad-command="SHELL_UNDO"]').click();
  await expect.poll(() => entityCount(page)).toBe(before);

  await clearSelection(page);
  expect(errors).toEqual([]);
});

test('1942-B ribbon launch + command dock Enter/Escape stay clean', async ({ page }) => {
  const errors: string[] = [];
  await gotoCad(page, errors);

  await homeTab(page);
  await page.locator('[data-cad-command="LINE"]').click();
  const input = page.locator('[data-cad-command-input]');
  await expect(input).toBeVisible();
  await input.focus();
  await input.press('Escape');

  await homeTab(page);
  await page.locator('[data-cad-command="LINE"]').click();
  await expect(input).toBeVisible();
  await input.fill('');
  await input.press('Enter');
  await input.press('Escape');

  expect(errors).toEqual([]);
});

test('1942-C managers and Export Center open/close through shell actions', async ({ page }) => {
  const errors: string[] = [];
  await gotoCad(page, errors);

  await page.getByRole('button', { name: 'Open layer manager' }).click();
  await expect(
    page.locator('[data-cad-layers] section[aria-label="Layer properties manager"]'),
  ).toBeVisible();
  await page.keyboard.press('Escape');

  await homeTab(page);
  await page.getByRole('tab', { name: 'Output' }).click();
  await page.locator('[data-cad-command="SHELL_EXPORT_CENTER"]').click();
  const center = page.locator('section[aria-label="Export Center"]');
  await expect(center).toBeVisible({ timeout: 10000 });
  await center.locator('[data-export-center-close]').click();
  await expect(center).not.toBeVisible();

  expect(errors).toEqual([]);
});

test('1942-D drawing switch / remount keeps the action channel live', async ({ page }) => {
  const errors: string[] = [];
  await gotoCad(page, errors);
  const fixture = writeSurveyPlanFixture();

  await openSurveyPlanDrawing(page, fixture);
  const first = await entityCount(page);
  expect(first).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New Drawing' }).click();
  await expect.poll(() => entityCount(page)).toBe(0);

  await openSurveyPlanDrawing(page, fixture);
  await expect.poll(() => entityCount(page)).toBe(first);
  await selectAll(page, first);
  expect(await selectionCount(page)).toBe(first);

  expect(errors).toEqual([]);
});
