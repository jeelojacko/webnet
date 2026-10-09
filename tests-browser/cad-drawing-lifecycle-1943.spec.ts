/**
 * STRUCT-194.3 browser QA — the extracted drawing-file + LandXML lifecycle
 * control planes through the REAL /cad app in headless Chromium.
 *
 * Individual flows are already covered by `cad-drawing-18c`,
 * `cad-landxml-18m`, and `cad-shell-actions-1942`. This spec only anchors the
 * newly extracted, previously-uncovered combinations that exercise the shared
 * state hook + the one-render-later schedule/cleanup effects:
 *   A cancel -> re-stage the same file (shared input ref + staged state)
 *   B commit -> imported surfaces schedule and settle CURRENT
 *   C drawing switch wipes staged state, and re-staging still works
 *
 * Zero page / console errors per test.
 */
import { expect, test } from '@playwright/test';
import { entityCount, gotoCad } from './cad-survey-plan-19a-helpers';
import { FIXTURE, reviewScope, stageLandXml, surfaceStatus } from './landxml-18m-helpers';

test.describe.configure({ mode: 'serial' });

const newDrawing = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New Drawing' }).click();
};

test('1943-A: cancelling the LandXML review keeps the shared input usable for a re-stage', async ({ page }) => {
  const errors: string[] = [];
  await gotoCad(page, errors);
  await newDrawing(page);
  await stageLandXml(page, FIXTURE);
  await expect(reviewScope(page)).toHaveCount(1);
  await reviewScope(page).locator('[data-landxml-import-cancel]').click();
  await expect(reviewScope(page)).toHaveCount(0);
  // Same hidden input + shared refs must stage again cleanly.
  await stageLandXml(page, FIXTURE);
  await expect(reviewScope(page)).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('1943-B: a committed import schedules the imported TIN and settles CURRENT', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await newDrawing(page);
  await stageLandXml(page, FIXTURE);
  await reviewScope(page).locator('[data-landxml-import-selected]').click();
  await expect.poll(() => entityCount(page)).toBe(6);
  await expect.poll(() => surfaceStatus(page, 'Existing Ground'), { timeout: 60_000 }).toBe('CURRENT');
  expect(errors).toEqual([]);
});

test('1943-C: a drawing switch wipes staged state and re-staging still works', async ({ page }) => {
  const errors: string[] = [];
  await gotoCad(page, errors);
  await newDrawing(page);
  await stageLandXml(page, FIXTURE);
  await expect(reviewScope(page)).toHaveCount(1);
  // A new drawing id clears the staged preview through the cleanup effect.
  await newDrawing(page);
  await expect(reviewScope(page)).toHaveCount(0);
  await stageLandXml(page, FIXTURE);
  await expect(reviewScope(page)).toHaveCount(1);
  expect(errors).toEqual([]);
});
