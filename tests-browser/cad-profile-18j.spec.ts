/**
 * Phase 18J browser QA — core profile flows through the real /cad app.
 *
 * Playwright (dev-server + Chromium), NOT vitest. Fixtures/helpers live in
 * cad-profile-18j-helpers.ts. Zero page/console errors per test.
 *
 * - 18J-A core: surface Rebuild All -> CURRENT -> create profile ->
 *   UNBUILT -> Rebuild -> CURRENT -> Create Profile View -> visible
 *   grid/labels -> Apply view settings (display-only, stays CURRENT) ->
 *   station inquiry at 20 -> elevation 102.000.
 * - 18J-B lifecycle: station equation (STA EQ session) -> UNBUILT ->
 *   rebuild CURRENT, covered length unchanged + BK marker -> MOVE edit ->
 *   surface NEEDS_REBUILD + profile SOURCE_NOT_CURRENT (stale) -> rebuild
 *   chain CURRENT with identical stats -> void-gap inquiry at 35 has no
 *   elevation -> layer OFF hides the view with no rebuild -> ON restores.
 */
import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  SHOT_DIR,
  SURFACE_ID,
  cancelCommand,
  canvasClick,
  collapseFloatingPanel,
  createProfile,
  downloadToTemp,
  gotoCad,
  makeProfileDrawing,
  openDrawing,
  openProfileManager,
  profileManagerScope,
  profileStatsText,
  profileStatus,
  queryProfileStation,
  rebuildAllSurfaces,
  rebuildProfile,
  ribbonTab,
  selectionCount,
  showSurveyTab,
} from './cad-profile-18j-helpers';

test('18J-A: surface CURRENT -> create profile -> rebuild CURRENT -> view grid/labels -> Apply display-only -> inquiry', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  const drawingPath = makeProfileDrawing();
  await openDrawing(page, drawingPath, 33);
  await showSurveyTab(page);
  await expect(page.locator(`[data-cad-toolspace] [data-cad-surface="${SURFACE_ID}"]`)).toBeVisible();

  // Ribbon Profile group is present in the SURFACE tab.
  await ribbonTab(page, 'Surface').click();
  for (const label of ['Create Surface Profile', 'Profile Manager', 'Create Profile View', 'Profile Elevation']) {
    await expect(page.getByRole('button', { name: label }).first()).toBeVisible();
  }

  // Source surface builds CURRENT first (profile rebuild is gated on it).
  await rebuildAllSurfaces(page);
  await expect.poll(
    () => page.locator(`[data-cad-toolspace] [data-cad-surface="${SURFACE_ID}"]`).getAttribute('data-cad-surface-status'),
    { timeout: 60000 },
  ).toBe('CURRENT');

  await openProfileManager(page);
  const profileId = await createProfile(page, 'J-CL-EG');
  await expect.poll(() => profileStatus(page, profileId)).toBe('UNBUILT');
  await profileManagerScope(page).locator(`[data-profile-list] [data-cad-profile="${profileId}"]`).click();
  await rebuildProfile(page);
  await expect.poll(() => profileStatus(page, profileId), { timeout: 60000 }).toBe('CURRENT');
  await expect(profileManagerScope(page).locator('[data-profile-stats]')).toContainText('Covered / gap');
  await page.screenshot({ path: `${SHOT_DIR}/18j-A-profile-current.png` });

  // Create Profile View -> visible grid + profile path + station labels.
  await profileManagerScope(page).locator('[data-profile-detail]').getByRole('button', { name: 'Create Profile View' }).click();
  const viewLayer = page.locator('[data-profile-view-layer]');
  await expect.poll(() => viewLayer.count()).toBe(1);
  await expect(viewLayer).toBeVisible();
  await expect(page.locator('[data-profile-view-path]').first()).toBeVisible();
  expect(await viewLayer.locator('text').count()).toBeGreaterThan(0);

  // View settings Apply is display-only: notice confirms, profile stays CURRENT.
  const manager = profileManagerScope(page);
  await manager.locator('[data-cad-profile-views-section] [data-cad-profile-view]').first().click();
  const settings = manager.locator('[data-cad-profile-view-settings]');
  await expect(settings).toBeVisible();
  await settings.getByLabel('Profile view vertical exaggeration').fill('2');
  await settings.getByRole('button', { name: 'Apply view settings' }).click();
  await expect(manager.locator('[data-profile-notice]')).toContainText('display only');
  await expect.poll(() => profileStatus(page, profileId)).toBe('CURRENT');

  // Station inquiry on the line portion: raw 20 -> x=10, z = 100+1+1.
  const answer = await queryProfileStation(page, '20');
  expect(answer).toContain('station 0+20.000');
  expect(answer).toContain('elevation 102.000');
  await page.screenshot({ path: `${SHOT_DIR}/18j-A-inquiry.png` });
  fs.rmSync(path.dirname(drawingPath), { recursive: true, force: true });
  expect(errors).toEqual([]);
});

test('18J-B: station equation -> edit STALE -> rebuild chain -> void gap -> layer OFF hides view', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  const drawingPath = makeProfileDrawing();
  await openDrawing(page, drawingPath, 33);
  await showSurveyTab(page);
  await rebuildAllSurfaces(page);
  await expect.poll(
    () => page.locator(`[data-cad-toolspace] [data-cad-surface="${SURFACE_ID}"]`).getAttribute('data-cad-surface-status'),
    { timeout: 60000 },
  ).toBe('CURRENT');
  await openProfileManager(page);
  const profileId = await createProfile(page, 'J-CL-EG');
  await profileManagerScope(page).locator(`[data-profile-list] [data-cad-profile="${profileId}"]`).click();
  await rebuildProfile(page);
  await expect.poll(() => profileStatus(page, profileId), { timeout: 60000 }).toBe('CURRENT');
  const statsBefore = await profileStatsText(page);
  await profileManagerScope(page).locator('[data-profile-detail]').getByRole('button', { name: 'Create Profile View' }).click();
  await expect.poll(() => page.locator('[data-profile-view-layer]').count()).toBe(1);

  // Station equation: save the drawing, inject the equation the
  // ALIGNMENT_STATION_EQUATION command would store (back 16 / ahead 18
  // at raw 16), reopen. Same ids throughout. Revision covers equations,
  // so the profile honestly drops out of CURRENT; after the rebuild
  // chain the geometry is unchanged and BK/AH markers render.
  await ribbonTab(page, 'Home').click();
  const equationPath = await downloadToTemp(
    page,
    () => page.getByRole('button', { name: 'Save Drawing' }).first().click(),
    '.wncad',
  );
  const equationDoc = JSON.parse(fs.readFileSync(equationPath, 'utf8')) as {
    project: { entities: Array<{ id: string; type: string; stationEquations?: unknown }> };
  };
  const equationAlignment = equationDoc.project.entities.find((entry) => entry.id === 'j-align-1');
  if (!equationAlignment || equationAlignment.type !== 'alignment') throw new Error('equation drawing lost J-CL');
  equationAlignment.stationEquations = [{ backStation: 16, aheadStation: 18, rawStation: 16 }];
  fs.writeFileSync(equationPath, JSON.stringify(equationDoc));
  await openDrawing(page, equationPath, 33);
  await showSurveyTab(page);
  await expect.poll(() => profileStatus(page, profileId)).toMatch(/SOURCE_NOT_CURRENT|UNBUILT/);
  await rebuildAllSurfaces(page);
  await expect.poll(
    () => page.locator(`[data-cad-toolspace] [data-cad-surface="${SURFACE_ID}"]`).getAttribute('data-cad-surface-status'),
    { timeout: 60000 },
  ).toBe('CURRENT');
  await openProfileManager(page);
  await profileManagerScope(page).locator(`[data-profile-list] [data-cad-profile="${profileId}"]`).click();
  await rebuildProfile(page);
  await expect.poll(() => profileStatus(page, profileId), { timeout: 60000 }).toBe('CURRENT');
  expect(await profileStatsText(page)).toBe(statsBefore);
  await expect.poll(() => page.locator('[data-profile-view-layer]').count()).toBe(1);
  await expect(page.locator('[data-profile-view-layer]').first()).toContainText('BK 0+16');
  // Same display station now resolves behind the equation: raw 18 -> x=8.
  expect(await queryProfileStation(page, '20')).toContain('elevation 101.800');
  await page.screenshot({ path: `${SHOT_DIR}/18j-B-equation.png` });
  fs.rmSync(path.dirname(equationPath), { recursive: true, force: true });

  // Source edit (select-all + MOVE): surface NEEDS_REBUILD, profile
  // SOURCE_NOT_CURRENT with retained stale samples.
  await ribbonTab(page, 'Home').click();
  await page.locator('[data-cad-command="SHELL_SELECT_ALL"]').click();
  await expect.poll(() => selectionCount(page)).toBe(33);
  await page.locator('[data-cad-command="MOVE"]').click();
  await canvasClick(page, 0.3, 0.5);
  await canvasClick(page, 0.35, 0.55);
  await cancelCommand(page);
  await expect.poll(
    () => page.locator(`[data-cad-toolspace] [data-cad-surface="${SURFACE_ID}"]`).getAttribute('data-cad-surface-status'),
  ).toBe('NEEDS_REBUILD');
  await expect.poll(() => profileStatus(page, profileId)).toBe('SOURCE_NOT_CURRENT');
  await expect(profileManagerScope(page).locator('[data-profile-list]')).toContainText('(stale)');
  await page.screenshot({ path: `${SHOT_DIR}/18j-B-stale.png` });

  // Rebuild chain: surfaces CURRENT, profile UNBUILT (new source revision),
  // profile Rebuild CURRENT with identical stats (pure translation).
  await rebuildAllSurfaces(page);
  await expect.poll(
    () => page.locator(`[data-cad-toolspace] [data-cad-surface="${SURFACE_ID}"]`).getAttribute('data-cad-surface-status'),
    { timeout: 60000 },
  ).toBe('CURRENT');
  await expect.poll(() => profileStatus(page, profileId)).toBe('UNBUILT');
  await rebuildProfile(page);
  await expect.poll(() => profileStatus(page, profileId), { timeout: 60000 }).toBe('CURRENT');
  expect(await profileStatsText(page)).toBe(statsBefore);

  // Void gap answers honestly: station 35 sits inside the void (x=25).
  expect(await queryProfileStation(page, '35')).toContain('No surface profile elevation at station');

  // Layer OFF hides the view with no rebuild; ON restores it from cache.
  await collapseFloatingPanel(page);
  await ribbonTab(page, 'Home').click();
  await page.getByRole('button', { name: 'Open layer manager' }).click();
  const layers = page.locator('[data-cad-layers]');
  await layers.locator('input[aria-label="Toggle on/off for layer General"]').uncheck();
  await expect(page.locator('[data-profile-view-layer]')).toHaveCount(0);
  await expect.poll(() => profileStatus(page, profileId)).toBe('CURRENT');
  await page.screenshot({ path: `${SHOT_DIR}/18j-B-layer-off.png` });
  await layers.locator('input[aria-label="Toggle on/off for layer General"]').check();
  await expect.poll(() => page.locator('[data-profile-view-layer]').count()).toBe(1);
  fs.rmSync(path.dirname(drawingPath), { recursive: true, force: true });
  expect(errors).toEqual([]);
});

