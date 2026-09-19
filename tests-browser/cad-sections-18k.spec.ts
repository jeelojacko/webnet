/**
 * Phase 18K browser QA — sample lines, cross sections, section views.
 *
 * Playwright (dev-server + Chromium), NOT vitest. Fixtures/helpers live in
 * cad-sections-18k-helpers.ts. Zero page/console errors per test.
 *
 * Geometry (see helpers): K-CL line (-10,20)->(34,20), raw s -> x = s-10;
 * Existing z = 100 + 0.1x + 0.05y inside x5-45/y5-35 with a void
 * x20-30/y15-25; Proposed is exactly +2 over the full rect.
 *
 * - 18K-A: group/create/sources, individual add, interval raw spacing,
 *   rebuild CURRENT (+A-then-B supersession), batch section views
 *   (non-overlap), EG/Proposed traces + grid/centerline/title, cut/fill
 *   shading + Fill 60 area, Covered + void-gap inquiries.
 * - 18K-B: equation XY-unchanged + label change + no re-extract,
 *   alignment edit stale->rebuild, surface edit
 *   SOURCE_NOT_CURRENT->NEEDS_REBUILD->CURRENT, layer OFF hides,
 *   save/reopen persistence (UNBUILT, never false CURRENT).
 */
import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ribbonTab } from './cad-profile-18j-helpers';
import {
  EXISTING_ID,
  SHOT_DIR,
  addSampleLineAtStation,
  addSampleLinesByInterval,
  addSourceSurface,
  cancelCommand,
  canvasClick,
  collapseFloatingPanel,
  createSectionGroup,
  createSectionViews,
  downloadToTemp,
  gotoCad,
  makeSectionDrawing,
  openDrawing,
  openSectionManager,
  querySectionOffset,
  rebuildAllSurfaces,
  rebuildSections,
  sampleLineStatus,
  sectionGroupIds,
  sectionLineIds,
  sectionManagerScope,
  selectSectionGroup,
  selectionCount,
  selectSampleLineRow,
  setCutFillPair,
  showSurveyTab,
} from './cad-sections-18k-helpers';

async function setupBuiltGroup(page: import('@playwright/test').Page): Promise<{ groupId: string }> {
  await rebuildAllSurfaces(page);
  await expect.poll(
    () => page.locator(`[data-cad-toolspace] [data-cad-surface="${EXISTING_ID}"]`).getAttribute('data-cad-surface-status'),
    { timeout: 60000 },
  ).toBe('CURRENT');
  await openSectionManager(page);
  const groupId = await createSectionGroup(page, 'K-Corridor');
  await selectSectionGroup(page, groupId);
  await addSourceSurface(page, 'QA Constraints');
  await addSourceSurface(page, 'Proposed');
  await setCutFillPair(page, 'QA Constraints', 'Proposed');
  return { groupId };
}

test('18K-A: group/sources/add/interval/rebuild CURRENT/supersede/views/shading/inquiry', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  const drawingPath = makeSectionDrawing();
  await openDrawing(page, drawingPath, 63);
  await showSurveyTab(page);
  await expect(page.locator(`[data-cad-toolspace] [data-cad-surface="${EXISTING_ID}"]`)).toBeVisible();

  // Ribbon Sections group is present in the SURFACE tab.
  await ribbonTab(page, 'Surface').click();
  for (const label of ['Sample Lines', 'Add Sample Line', 'By Interval', 'Rebuild Sections', 'Create Section Views']) {
    await expect(page.getByRole('button', { name: label }).first()).toBeVisible();
  }

  await setupBuiltGroup(page);

  // Individual add at display station 35 (raw 35, x=25, void-crossing).
  await addSampleLineAtStation(page, '35');
  await expect.poll(() => sectionLineIds(page)).toHaveLength(1);
  // Interval raw spacing: 20/40/60 (x=10 full, x=30 void-edge, x=50 outside).
  await addSampleLinesByInterval(page, '20', '60', '20');
  await expect.poll(() => sectionLineIds(page)).toHaveLength(4);
  const lineIds = await sectionLineIds(page);
  await expect(sectionManagerScope(page).locator('[data-sample-line-table]')).toContainText('0+35');

  // Rebuild CURRENT; A-then-B supersession: group batch immediately
  // followed by a line rebuild — either interleaving lands CURRENT.
  await rebuildSections(page);
  const manager = sectionManagerScope(page);
  await manager.locator(`[data-sample-line-table] [data-cad-sample-line="${lineIds[1]}"]`).click();
  await manager.getByRole('button', { name: 'Rebuild Line', exact: true }).click();
  await expect.poll(() => sampleLineStatus(page, lineIds[1]!), { timeout: 60000 }).toContain('Current');
  await rebuildSections(page);
  await expect.poll(() => sampleLineStatus(page, lineIds[1]!), { timeout: 60000 }).toContain('Current');
  // Outside-TIN line derives NO_COVERAGE honestly (never forced CURRENT).
  await expect.poll(() => sampleLineStatus(page, lineIds[3]!), { timeout: 60000 }).toContain('No Coverage');
  await page.screenshot({ path: `${SHOT_DIR}/18k-A-sections-current.png` });

  // Batch Create Section Views: one view per line, single vertical stack.
  await createSectionViews(page);
  await expect(manager.locator('[data-section-notice]')).toContainText('Created 4 section views');
  const viewLayers = page.locator('[data-section-view-layer]');
  await expect.poll(() => viewLayers.count()).toBe(4);
  // Frames must not overlap by default.
  const boxes = await viewLayers.evaluateAll((elements) =>
    elements.map((element) => {
      const box = (element as SVGGraphicsElement).getBBox();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }));
  expect(boxes).toHaveLength(4);
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const overlaps =
        a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      expect(overlaps).toBe(false);
    }
  }

  // EG/Proposed traces + grid + OFFSET-0 centerline + title on one view.
  await page.locator('[data-cad-toolspace] [data-cad-section-view]').first().click();
  const firstView = viewLayers.first();
  await expect(firstView.locator('[data-section-view-path]')).toHaveCount(2);
  await expect(firstView.locator('text')).toContainText('CL');
  await expect(firstView.locator('text')).toContainText('Proposed');
  await expect(manager.locator('[data-cad-section-views-section]')).toContainText('K-CL');
  // Deterministic cut/fill: +2 plane over 30 units of common coverage.
  await expect(manager.locator('[data-cad-section-views-section]')).toContainText('Fill 60.000');
  await page.screenshot({ path: `${SHOT_DIR}/18k-A-section-view.png` });

  // Inquiry: covered offset interpolates; void gap answers honestly.
  await selectSampleLineRow(page, lineIds[1]!);
  const covered = await querySectionOffset(page, 'QA Constraints', '0');
  expect(covered).toContain('station 0+20');
  expect(covered).toContain('elevation 102.000');
  await selectSampleLineRow(page, lineIds[0]!);
  expect(await querySectionOffset(page, 'QA Constraints', '0')).toContain('gap or outside');
  await page.screenshot({ path: `${SHOT_DIR}/18k-A-inquiry.png` });
  fs.rmSync(path.dirname(drawingPath), { recursive: true, force: true });
  expect(errors).toEqual([]);
});

test('18K-B: equation label/XY + edit chains + layer OFF + save/reopen', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  const drawingPath = makeSectionDrawing();
  await openDrawing(page, drawingPath, 63);
  await showSurveyTab(page);
  const { groupId } = await setupBuiltGroup(page);
  await addSampleLineAtStation(page, '35');
  await addSampleLinesByInterval(page, '20', '20', '20');
  await expect.poll(() => sectionLineIds(page)).toHaveLength(2);
  const lineIds = await sectionLineIds(page);
  await rebuildSections(page);
  await expect.poll(() => sampleLineStatus(page, lineIds[0]!), { timeout: 60000 }).toContain('Current');
  await createSectionViews(page);
  await expect.poll(() => page.locator('[data-section-view-layer]').count()).toBe(2);

  // Plan geometry before the equation (screen-space d + label text).
  const planLine = page.locator(`[data-sample-line="${lineIds[0]}"]`);
  const dBefore = await planLine.getAttribute('d');
  const labelBefore = await planLine.locator('..').locator('text').first().textContent();

  // Station equation via save/inject/reopen (mirror 18J-B): back 16 /
  // ahead 18 at raw 16. XY unchanged, label moves, NO re-extract.
  await ribbonTab(page, 'Home').click();
  const equationPath = await downloadToTemp(
    page,
    () => page.getByRole('button', { name: 'Save Drawing' }).first().click(),
    '.wncad',
  );
  const equationDoc = JSON.parse(fs.readFileSync(equationPath, 'utf8')) as {
    project: { entities: Array<{ id: string; type: string; stationEquations?: unknown }> };
  };
  const equationAlignment = equationDoc.project.entities.find((entry) => entry.id === 'k-align-1');
  if (!equationAlignment || equationAlignment.type !== 'alignment') throw new Error('equation drawing lost K-CL');
  equationAlignment.stationEquations = [{ backStation: 16, aheadStation: 18, rawStation: 16 }];
  fs.writeFileSync(equationPath, JSON.stringify(equationDoc));
  await openDrawing(page, equationPath, 63);
  await showSurveyTab(page);
  const planLineAfter = page.locator(`[data-sample-line="${lineIds[0]}"]`);
  await expect.poll(() => planLineAfter.getAttribute('d')).toBe(dBefore);
  await expect.poll(() => planLineAfter.locator('..').locator('text').first().textContent()).not.toBe(labelBefore);
  expect(await planLineAfter.locator('..').locator('text').first().textContent()).toContain('0+37');
  // Still CURRENT: equations relabel, they never invalidate extraction.
  await expect.poll(() => sampleLineStatus(page, lineIds[0]!)).toContain('Current');
  await expect.poll(() => page.locator('[data-section-view-layer]').count()).toBe(2);
  await page.screenshot({ path: `${SHOT_DIR}/18k-B-equation.png` });
  fs.rmSync(path.dirname(equationPath), { recursive: true, force: true });

  // Alignment edit (select-all + MOVE): sections drop out of CURRENT.
  await ribbonTab(page, 'Home').click();
  await page.locator('[data-cad-command="SHELL_SELECT_ALL"]').click();
  await expect.poll(() => selectionCount(page)).toBe(63);
  await page.locator('[data-cad-command="MOVE"]').click();
  await canvasClick(page, 0.3, 0.5);
  await canvasClick(page, 0.35, 0.55);
  await cancelCommand(page);
  await expect.poll(() => sampleLineStatus(page, lineIds[0]!)).not.toContain('Current');
  // Rebuild chain: surfaces CURRENT, sections CURRENT again.
  await rebuildAllSurfaces(page);
  await expect.poll(
    () => page.locator(`[data-cad-toolspace] [data-cad-surface="${EXISTING_ID}"]`).getAttribute('data-cad-surface-status'),
    { timeout: 60000 },
  ).toBe('CURRENT');
  await openSectionManager(page);
  await selectSectionGroup(page, groupId);
  await rebuildSections(page);
  await expect.poll(() => sampleLineStatus(page, lineIds[0]!), { timeout: 60000 }).toContain('Current');

  // Surface-only edit path: MOVE once more, surface NEEDS_REBUILD first.
  await ribbonTab(page, 'Home').click();
  await page.locator('[data-cad-command="SHELL_SELECT_ALL"]').click();
  await page.locator('[data-cad-command="MOVE"]').click();
  await canvasClick(page, 0.3, 0.5);
  await canvasClick(page, 0.32, 0.52);
  await cancelCommand(page);
  await expect.poll(
    () => page.locator(`[data-cad-toolspace] [data-cad-surface="${EXISTING_ID}"]`).getAttribute('data-cad-surface-status'),
  ).toBe('NEEDS_REBUILD');
  await expect.poll(() => sampleLineStatus(page, lineIds[0]!)).toContain('Source Not Current');
  await rebuildAllSurfaces(page);
  await expect.poll(
    () => page.locator(`[data-cad-toolspace] [data-cad-surface="${EXISTING_ID}"]`).getAttribute('data-cad-surface-status'),
    { timeout: 60000 },
  ).toBe('CURRENT');
  await expect.poll(() => sampleLineStatus(page, lineIds[0]!)).not.toContain('Source Not Current');
  await rebuildSections(page);
  await expect.poll(() => sampleLineStatus(page, lineIds[0]!), { timeout: 60000 }).toContain('Current');

  // Layer OFF hides plan + views with no rebuild; ON restores from cache.
  await collapseFloatingPanel(page);
  await ribbonTab(page, 'Home').click();
  await page.getByRole('button', { name: 'Open layer manager' }).click();
  const layers = page.locator('[data-cad-layers]');
  await layers.locator('input[aria-label="Toggle on/off for layer General"]').uncheck();
  await expect(page.locator('[data-section-view-layer]')).toHaveCount(0);
  await expect(page.locator('[data-sample-line]').first()).toHaveCount(0);
  await expect.poll(() => sampleLineStatus(page, lineIds[0]!)).toContain('Current');
  await page.screenshot({ path: `${SHOT_DIR}/18k-B-layer-off.png` });
  await layers.locator('input[aria-label="Toggle on/off for layer General"]').check();
  await expect.poll(() => page.locator('[data-section-view-layer]').count()).toBe(2);

  // Save/reopen: definitions persist, sections reload UNBUILT (never
  // false CURRENT), rebuild restores the views.
  const reopenPath = await downloadToTemp(
    page,
    () => page.getByRole('button', { name: 'Save Drawing' }).first().click(),
    '.wncad',
  );
  await openDrawing(page, reopenPath, 63);
  await showSurveyTab(page);
  await expect.poll(() => sectionGroupIds(page)).toHaveLength(0);
  await openSectionManager(page);
  await expect.poll(() => sectionGroupIds(page)).toHaveLength(1);
  await expect.poll(() => sampleLineStatus(page, lineIds[0]!)).toBe('Unbuilt / Unbuilt');
  await expect(page.locator('[data-section-view-layer]')).toHaveCount(0);
  await rebuildAllSurfaces(page);
  await expect.poll(
    () => page.locator(`[data-cad-toolspace] [data-cad-surface="${EXISTING_ID}"]`).getAttribute('data-cad-surface-status'),
    { timeout: 60000 },
  ).toBe('CURRENT');
  await rebuildSections(page);
  await expect.poll(() => sampleLineStatus(page, lineIds[0]!), { timeout: 60000 }).toContain('Current');
  await expect.poll(() => page.locator('[data-section-view-layer]').count()).toBe(2);
  fs.rmSync(path.dirname(reopenPath), { recursive: true, force: true });
  fs.rmSync(path.dirname(drawingPath), { recursive: true, force: true });
  expect(errors).toEqual([]);
});
