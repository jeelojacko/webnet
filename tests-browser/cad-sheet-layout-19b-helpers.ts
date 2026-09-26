/**
 * Phase 19B browser QA — shared helpers for the sheet/layout production spec.
 *
 * Browser helpers drive the real /cad shell (layout tabs, Page Setup,
 * SheetWorkspace MVIEW creation, viewport props, undo, save/reopen, Export
 * Center). Store-level seeding reuses the 19A deterministic survey plan
 * entities so every sheet test projects real model geometry.
 */
import { expect, type Page } from '@playwright/test';

import {
  gotoCad,
  openSurveyPlanDrawing,
  writeSurveyPlanFixture,
} from './cad-survey-plan-19a-helpers';

/** Open /cad with the deterministic 19A drawing loaded. */
export async function gotoSheetCad(page: Page, errors: string[]): Promise<void> {
  await gotoCad(page, errors);
  await openSurveyPlanDrawing(page, writeSurveyPlanFixture());
}

export function layoutTabs(page: Page) {
  return page.locator('[data-cad-layout-tabs]');
}

export function layoutTab(page: Page, name: string) {
  return layoutTabs(page).locator('[role="tab"]', { hasText: name });
}

/** Create a layout sheet through the "+" tab button; returns the tab count. */
export async function addLayoutSheet(page: Page): Promise<number> {
  await page.locator('button[aria-label="Add layout sheet"]').click();
  const tabs = layoutTabs(page).locator('[role="tab"]');
  await expect.poll(() => tabs.count()).toBeGreaterThan(1);
  return tabs.count();
}

export function sheetWorkspace(page: Page) {
  return page.locator('section[aria-label="Sheet workspace"]');
}

export function sheetSvg(page: Page) {
  return page.locator('section[aria-label="Sheet workspace"] svg[role="img"]');
}

export function paperStatus(page: Page) {
  return page.locator('footer[data-cad-status-bar] span[title="Active space"]');
}

export function viewportProps(page: Page) {
  return page.locator('[aria-label="Viewport properties"]');
}

/** Visible intersection of the sheet svg with the browser viewport. */
export async function visibleSheetBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const svg = sheetSvg(page);
  await svg.scrollIntoViewIfNeeded();
  const raw = await svg.boundingBox();
  if (!raw) throw new Error('sheet svg has no bounding box');
  const viewport = page.viewportSize() ?? { width: 1366, height: 768 };
  const left = Math.max(0, raw.x);
  const top = Math.max(0, raw.y);
  const right = Math.min(viewport.width, raw.x + raw.width);
  const bottom = Math.min(viewport.height, raw.y + raw.height);
  if (right - left < 60 || bottom - top < 60) throw new Error('sheet svg visible area too small to drive');
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Open Page Setup for a layout tab via right-click → sheet menu. */
export async function openPageSetup(page: Page, sheetName: string) {
  await layoutTab(page, sheetName).click({ button: 'right' });
  const menu = page.locator('[data-cad-sheet-menu]');
  await expect(menu).toBeVisible();
  await menu.locator('[role="menuitem"]', { hasText: 'Page Setup' }).click();
  const dialog = page.locator('section[aria-label="Page setup"]');
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * Create a viewport through the production MVIEW flow: +Viewport, drag a
 * paper rect on the sheet svg, fill model center + scale, Commit. The drag
 * stays inside the visible svg region (the sheet can be taller than the
 * window; off-window pointer points never hit-test the svg).
 */
export async function createViewportMview(
  page: Page,
  options: { centerX: string; centerY: string; scale: string },
): Promise<void> {
  await sheetWorkspace(page).locator('button', { hasText: '+Viewport' }).click();
  const box = await visibleSheetBox(page);
  // Drag in the top zone: the sheet svg is taller than the center column
  // and the layout tabs / command dock sit below it (clipped, not usable).
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.08);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.32, { steps: 8 });
  await page.mouse.up();
  const place = page.locator('[aria-label="Place viewport"]');
  await expect(place).toBeVisible({ timeout: 10000 });
  await place.locator('input[aria-label="Model center E"]').fill(options.centerX);
  await place.locator('input[aria-label="Model center N"]').fill(options.centerY);
  await place.locator('select[aria-label="New viewport scale"]').selectOption(options.scale);
  await place.locator('button', { hasText: 'Commit' }).click();
  await expect(viewportProps(page)).toBeVisible({ timeout: 10000 });
}

/** Click inside the created viewport (selects the viewport under the point). */
export async function clickSheetCenter(page: Page, fx = 0.4, fy = 0.2): Promise<void> {
  const box = await visibleSheetBox(page);
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

/** Reopen a drawing through the shell file input (works on layout tabs,
 *  where the model workspace input is unmounted). */
export async function openDrawingOnSheetTab(page: Page, fixturePath: string, sheetName: string): Promise<void> {
  const fileInput = page.locator('[data-cad-shell-open-drawing-input]');
  await fileInput.evaluate((element: HTMLInputElement) => element.classList.remove('hidden')).catch(() => {});
  await fileInput.setInputFiles(fixturePath);
  await expect(layoutTab(page, sheetName)).toBeVisible({ timeout: 15000 });
}

/** Count rendered scene geometry (lines/paths/text) inside the sheet svg. */
export async function sheetGeometryCount(page: Page): Promise<number> {
  return sheetSvg(page).locator('line, polyline, polygon, path, text').count();
}
