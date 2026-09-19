/**
 * Phase 18J browser QA — shared harness (fixtures + UI helpers).
 *
 * Drawing is generated per test from the 18G seed (planar points
 * z = 100 + 0.1x + 0.05y, outer + void rings, group surface) plus one
 * mixed line+arc alignment (J-CL: line (-10,20)->(34,20), half-arc
 * r=6 through (40,14); crosses the void x20-30 at y20 for a ~10-unit
 * gap; raw station s on the line maps to x = s-10, z = 100 + 0.1s).
 */
import { expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const SHOT_DIR = 'docs/evidence/phase18j';
export const SEED = 'tests-browser/fixtures/cad-surface-18g-seed.wncad';
export const SURFACE_ID = 'qa-surf-constraints';
export const SURFACE_NAME = 'QA Constraints';

export async function gotoCad(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('dialog', (dialog) => void dialog.accept());
  await page.addInitScript(() => {
    const record = window as unknown as Record<string, unknown>;
    delete record.showSaveFilePicker;
    delete record.showOpenFilePicker;
  });
  await page.goto('/cad', { waitUntil: 'networkidle' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-cad-viewport]')).toBeVisible({ timeout: 30000 });
}

/** 18G seed points/rings/surface + mixed line+arc alignment J-CL. */
export function makeProfileDrawing(): string {
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8')) as {
    project: {
      entities: unknown[];
      surfaces: unknown[];
      volumeSurfaces?: unknown;
      volumeSurfaceStyles?: unknown;
    };
  };
  seed.project.entities = [
    ...seed.project.entities,
    {
      id: 'j-align-1',
      type: 'alignment',
      layerId: 'general',
      visible: true,
      locked: false,
      name: 'J-CL',
      elements: [
        { kind: 'line', start: { x: -10, y: 20 }, end: { x: 34, y: 20 } },
        { kind: 'arc', center: { x: 34, y: 14 }, radius: 6, startAngleDeg: 90, endAngleDeg: -90 },
      ],
      startStation: 0,
    },
  ];
  delete seed.project.volumeSurfaces;
  delete seed.project.volumeSurfaceStyles;
  const tmpPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'webnet-18j-')), 'profiles.wncad');
  fs.writeFileSync(tmpPath, JSON.stringify(seed));
  return tmpPath;
}

export async function openDrawing(page: Page, filePath: string, expectedEntities: number): Promise<void> {
  const fileInput = page.locator('[data-survey-cad-open-drawing-input]');
  await fileInput.evaluate((element: HTMLInputElement) => element.classList.remove('hidden')).catch(() => {});
  await fileInput.setInputFiles(filePath);
  await expect.poll(() => entityCount(page)).toBe(expectedEntities);
}

export async function entityCount(page: Page): Promise<number> {
  const text = (await page.locator('[data-survey-cad-entity-count]').textContent()) ?? '';
  return Number.parseInt(text, 10);
}

export async function selectionCount(page: Page): Promise<number> {
  const text = (await page.locator('[data-survey-cad-selection-count]').textContent()) ?? '';
  return Number.parseInt(text, 10);
}

export function ribbonTab(page: Page, name: string) {
  return page.locator('[aria-label="Ribbon tabs"]').getByRole('tab', { name });
}

export async function showSurveyTab(page: Page): Promise<void> {
  await page.locator('[aria-label="Toolspace tabs"]').getByRole('tab', { name: 'Survey' }).click();
}

export function toolspaceProfile(page: Page, id: string) {
  return page.locator(`[data-cad-toolspace] [data-cad-profile="${id}"]`);
}

export async function profileStatus(page: Page, id: string): Promise<string> {
  return (await toolspaceProfile(page, id).getAttribute('data-cad-profile-status')) ?? '';
}

export function profileManagerScope(page: Page) {
  return page.locator('section[aria-label="Profile manager"]');
}

export async function openProfileManager(page: Page): Promise<void> {
  await ribbonTab(page, 'Surface').click();
  await page.getByRole('button', { name: 'Profile Manager', exact: true }).first().click();
  await expect(profileManagerScope(page)).toBeVisible({ timeout: 10000 });
}

export async function profileIds(page: Page): Promise<string[]> {
  return profileManagerScope(page).locator('[data-profile-list] [data-cad-profile]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-cad-profile') ?? ''));
}

export async function rebuildAllSurfaces(page: Page): Promise<void> {
  await ribbonTab(page, 'Surface').click();
  await page.getByRole('button', { name: 'Rebuild All' }).click();
}

/** The floating properties overlay covers the dock while expanded. */
export async function collapseFloatingPanel(page: Page): Promise<void> {
  const collapse = page.locator('button[title="Collapse panel body"]');
  if (await collapse.isVisible().catch(() => false)) {
    await collapse.click();
  }
}

export async function canvasClick(page: Page, fx: number, fy: number): Promise<void> {
  const box = await page.locator('[data-cad-viewport] svg').first().boundingBox();
  if (!box) throw new Error('viewport svg has no bounding box');
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

export async function cancelCommand(page: Page): Promise<void> {
  const input = page.locator('[data-cad-command-input]');
  await input.focus();
  await input.press('Escape');
}

export async function downloadToTemp(page: Page, trigger: () => Promise<void>, suffix: string): Promise<string> {
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await trigger();
  const download = await downloadPromise;
  const tempPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'webnet-18j-dl-')), `file${suffix}`);
  await download.saveAs(tempPath);
  return tempPath;
}

export async function createProfile(page: Page, name: string): Promise<string> {
  const manager = profileManagerScope(page);
  await manager.getByLabel('New profile name').fill(name);
  await manager.getByLabel('New profile alignment').selectOption({ label: 'J-CL' });
  await manager.getByLabel('New profile surface').selectOption({ label: SURFACE_NAME });
  await manager.getByRole('button', { name: 'Create Surface Profile' }).click();
  await expect.poll(() => profileIds(page)).not.toHaveLength(0);
  const ids = await profileIds(page);
  return ids[ids.length - 1] as string;
}

export async function rebuildProfile(page: Page): Promise<void> {
  await profileManagerScope(page).locator('[data-profile-detail]').getByRole('button', { name: 'Rebuild', exact: true }).click();
}

export async function profileStatsText(page: Page): Promise<string> {
  return (await profileManagerScope(page).locator('[data-profile-stats]').textContent()) ?? '';
}

export async function queryProfileStation(page: Page, station: string): Promise<string> {
  const manager = profileManagerScope(page);
  await manager.getByLabel('Profile elevation station').fill(station);
  await manager.getByRole('button', { name: 'Query', exact: true }).click();
  return (await manager.locator('[data-cad-profile-inquiry] [role="status"]').textContent()) ?? '';
}
