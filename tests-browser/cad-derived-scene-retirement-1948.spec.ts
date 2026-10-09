/**
 * STRUCT-194.8 browser QA — the extracted derived-scene / cursor / hotkey
 * seams through the REAL /cad app in headless Chromium.
 *
 * Genuine gaps not already covered by the reused specs (#1942 dock undo/redo +
 * Enter/Escape, #1943 drawing lifecycle, #1946 compose/picks, #183 pointer,
 * #185 surface revision, #1947 registry/snapshot):
 *   1. the shell status-bar cursor readout is driven by the extracted
 *      `useSurveyCadShellCursorAndInsertKeyEffects` imperative channel and
 *      follows the pointer;
 *   2. a typing target keeps its own Escape after the extracted capture
 *      listeners are installed, and the cursor channel survives the session;
 *   3. the parcel-label toggle (top of `useSurveyCadPreGradingDerivedScene`)
 *      flips state without mutating the drawing.
 *
 * The label-text removal itself is pinned deterministically by
 * `tests/cad_derived_scene_lifecycle_1948.test.tsx` (the 19A seed carries no
 * stored parcel closure metrics, so no `:parcel-label` primitives render here).
 * Every flow asserts zero page / console errors.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  entityCount,
  gotoCad,
  homeTab,
  openSurveyPlanDrawing,
  writeSurveyPlanFixture,
} from './cad-survey-plan-19a-helpers';

test.describe.configure({ mode: 'serial' });

const viewportBox = async (page: Page) => {
  const box = await page.locator('[data-cad-viewport] svg').first().boundingBox();
  if (!box) throw new Error('no viewport box');
  return box;
};

const cursorText = async (page: Page): Promise<string> =>
  (await page.locator('[data-cad-cursor]').textContent()) ?? '';

test('1948-A shell cursor readout follows the imperative pointer channel', async ({ page }) => {
  const errors: string[] = [];
  await gotoCad(page, errors);
  await expect(page.locator('[data-cad-cursor]')).toContainText('—');

  const box = await viewportBox(page);
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 4 });
  await expect.poll(() => cursorText(page), { timeout: 10000 }).not.toContain('—');

  // Idle pointer moves stay error-free and keep the readout live.
  for (let index = 0; index < 6; index += 1) {
    await page.mouse.move(box.x + box.width * (0.35 + index * 0.05), box.y + box.height * 0.45);
  }
  await expect.poll(() => cursorText(page)).not.toContain('—');
  expect(errors).toEqual([]);
});

test('1948-B a dock typing target keeps its own Escape and the cursor channel survives', async ({ page }) => {
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openSurveyPlanDrawing(page, writeSurveyPlanFixture());
  const before = await entityCount(page);

  await homeTab(page);
  await page.locator('[data-cad-command="LINE"]').click();
  const input = page.locator('[data-cad-command-input]');
  await expect(input).toBeVisible();
  await input.fill('10,10');
  await input.press('Escape');
  await expect.poll(() => entityCount(page)).toBe(before);

  const box = await viewportBox(page);
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4, { steps: 3 });
  await expect.poll(() => cursorText(page)).not.toContain('—');
  expect(errors).toEqual([]);
});

test('1948-C parcel-label toggle flips state without mutating the drawing', async ({ page }) => {
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openSurveyPlanDrawing(page, writeSurveyPlanFixture());
  const before = await entityCount(page);

  const toggle = page.locator('[data-survey-cad-parcel-label-toggle]');
  await expect(toggle).toBeVisible();
  const classOn = await toggle.getAttribute('class');
  await toggle.click();
  await expect.poll(async () => (await toggle.getAttribute('class')) ?? '').not.toBe(classOn);
  const classOff = await toggle.getAttribute('class');
  await toggle.click();
  await expect.poll(async () => (await toggle.getAttribute('class')) ?? '').toBe(classOn);
  expect(classOff).not.toBe(classOn);
  expect(await entityCount(page)).toBe(before);
  expect(errors).toEqual([]);
});
