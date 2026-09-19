/**
 * Phase 18K browser QA — shared harness (fixtures + UI helpers).
 *
 * Drawing is generated per test from the 18G seed (grid points
 * z = 100 + 0.1x + 0.05y, outer rect x5-45/y5-35, void x20-30/y15-25)
 * plus the 18J mixed line+arc alignment (K-CL: line (-10,20)->(34,20);
 * raw station s on the line maps to x = s-10, z = 101 + 0.1x) plus a
 * Proposed surface (exact +2 offset of Existing over the same extent)
 * for deterministic cut/fill (fill = 2 x overlap width).
 *
 * Shared canvas/shell harnesses are imported from the 18J helpers.
 */
import { expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export {
  cancelCommand,
  canvasClick,
  collapseFloatingPanel,
  downloadToTemp,
  gotoCad,
  openDrawing,
  rebuildAllSurfaces,
  selectionCount,
  showSurveyTab,
} from './cad-profile-18j-helpers';
import { ribbonTab } from './cad-profile-18j-helpers';

export const SHOT_DIR = 'docs/evidence/phase18k';
export const SEED = 'tests-browser/fixtures/cad-surface-18g-seed.wncad';
export const EXISTING_ID = 'qa-surf-constraints';
export const PROPOSED_ID = 'qa-surf-proposed';
export const ALIGN_ID = 'k-align-1';
export const ALIGN_NAME = 'K-CL';

interface SeedPoint {
  id: string;
  stationId: string;
  x: number;
  y: number;
  z: number;
}

/** 18G seed + K-CL alignment + explicit Existing source + +2 Proposed. */
export function makeSectionDrawing(): string {
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8')) as {
    project: {
      entities: Array<Record<string, unknown>>;
      surfaces: Array<Record<string, unknown>>;
      volumeSurfaces?: unknown;
      volumeSurfaceStyles?: unknown;
    };
  };
  const points = seed.project.entities.filter(
    (entry) => entry['type'] === 'survey-point',
  ) as unknown as SeedPoint[];
  const clones = points.map((entry, index) => ({
    ...entry,
    id: `qa-pt-Q${String(index).padStart(2, '0')}`,
    stationId: `Q${String(index).padStart(2, '0')}`,
    z: Number((entry.z + 2).toFixed(3)),
  }));
  const existing = seed.project.surfaces.find((entry) => entry['id'] === EXISTING_ID);
  if (!existing) throw new Error('seed lost the Existing surface');
  // Pin Existing to the original points so the +2 clones only feed Proposed.
  (existing['definition'] as Record<string, unknown>)['pointSource'] = {
    kind: 'points',
    pointEntityIds: points.map((entry) => entry.id),
  };
  const proposed = JSON.parse(JSON.stringify(existing)) as Record<string, unknown>;
  proposed['id'] = PROPOSED_ID;
  proposed['name'] = 'Proposed';
  (proposed['definition'] as Record<string, unknown>)['pointSource'] = {
    kind: 'points',
    pointEntityIds: clones.map((entry) => entry.id),
  };
  // Proposed skips the void and the mid-row breakline (it references the
  // original points): full rect coverage on the pure +2 plane, so the
  // overlay math stays exact and deterministic.
  (proposed['definition'] as Record<string, unknown>)['boundaries'] = [
    { type: 'outer', sourceEntityId: 'qa-ring-outer' },
  ];
  delete (proposed['definition'] as Record<string, unknown>)['breaklines'];
  seed.project.surfaces = [existing, proposed];
  seed.project.entities = [
    ...seed.project.entities,
    ...clones,
    {
      id: ALIGN_ID,
      type: 'alignment',
      layerId: 'general',
      visible: true,
      locked: false,
      name: ALIGN_NAME,
      elements: [{ kind: 'line', start: { x: -10, y: 20 }, end: { x: 34, y: 20 } }],
      startStation: 0,
    },
  ];
  delete seed.project.volumeSurfaces;
  delete seed.project.volumeSurfaceStyles;
  const tmpPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'webnet-18k-')), 'sections.wncad');
  fs.writeFileSync(tmpPath, JSON.stringify(seed));
  return tmpPath;
}

export function sectionManagerScope(page: Page) {
  return page.locator('section[aria-label="Sample line manager"]');
}

export async function openSectionManager(page: Page): Promise<void> {
  await ribbonTab(page, 'Surface').click();
  await page.getByRole('button', { name: 'Sample Lines', exact: true }).first().click();
  await expect(sectionManagerScope(page)).toBeVisible({ timeout: 10000 });
}

export async function sectionGroupIds(page: Page): Promise<string[]> {
  return sectionManagerScope(page).locator('[data-sample-group-list] [data-cad-sample-group]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-cad-sample-group') ?? ''));
}

export async function createSectionGroup(page: Page, name: string): Promise<string> {
  const manager = sectionManagerScope(page);
  await manager.getByLabel('New sample-line group name').fill(name);
  await manager.getByLabel('New group alignment').selectOption({ label: ALIGN_NAME });
  await manager.getByRole('button', { name: 'Create Group' }).click();
  await expect.poll(() => sectionGroupIds(page)).not.toHaveLength(0);
  const ids = await sectionGroupIds(page);
  return ids[ids.length - 1] as string;
}

export async function sectionLineIds(page: Page): Promise<string[]> {
  return sectionManagerScope(page).locator('[data-sample-line-table] [data-cad-sample-line]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-cad-sample-line') ?? ''));
}

export async function selectSectionGroup(page: Page, id: string): Promise<void> {
  await sectionManagerScope(page).locator(`[data-sample-group-list] [data-cad-sample-group="${id}"]`).click();
}

export async function addSourceSurface(page: Page, label: string): Promise<void> {
  const manager = sectionManagerScope(page);
  await manager.getByLabel('Add source surface').selectOption({ label });
  await manager.getByRole('button', { name: 'Add Source' }).click();
}

export async function setCutFillPair(page: Page, base: string, comparison: string): Promise<void> {
  const manager = sectionManagerScope(page);
  await manager.getByLabel('Cut/fill base surface').selectOption({ label: base });
  await manager.getByLabel('Cut/fill comparison surface').selectOption({ label: comparison });
  await manager.getByRole('button', { name: 'Set Pair' }).click();
}

export async function addSampleLineAtStation(page: Page, station: string): Promise<void> {
  const manager = sectionManagerScope(page);
  await manager.getByLabel('Sample line station').fill(station);
  await manager.getByRole('button', { name: 'Add Sample Line' }).click();
}

export async function addSampleLinesByInterval(page: Page, start: string, end: string, step: string): Promise<void> {
  const manager = sectionManagerScope(page);
  await manager.getByLabel('Interval raw start').fill(start);
  await manager.getByLabel('Interval raw end').fill(end);
  await manager.getByLabel('Interval spacing').fill(step);
  await manager.getByRole('button', { name: 'By Interval' }).click();
}

export async function rebuildSections(page: Page): Promise<void> {
  await sectionManagerScope(page).getByRole('button', { name: 'Rebuild Sections', exact: true }).click();
}

export async function createSectionViews(page: Page): Promise<void> {
  await sectionManagerScope(page).getByRole('button', { name: 'Create Section Views', exact: true }).click();
}

export function toolspaceSampleLine(page: Page, id: string) {
  return page.locator(`[data-cad-toolspace] [data-cad-sample-line="${id}"]`);
}

export async function sampleLineStatus(page: Page, id: string): Promise<string> {
  return (await toolspaceSampleLine(page, id).getAttribute('data-cad-sample-line-status')) ?? '';
}

export async function selectSampleLineRow(page: Page, id: string): Promise<void> {
  await sectionManagerScope(page).locator(`[data-sample-line-table] [data-cad-sample-line="${id}"]`).click();
}

export async function querySectionOffset(page: Page, surface: string, offset: string): Promise<string> {
  const manager = sectionManagerScope(page);
  await manager.getByLabel('Section inquiry surface').selectOption({ label: surface });
  await manager.getByLabel('Section inquiry offset').fill(offset);
  await manager.getByRole('button', { name: 'Query', exact: true }).click();
  return (await manager.locator('[data-cad-section-inquiry] [role="status"]').textContent()) ?? '';
}

export async function sectionNotice(page: Page): Promise<string> {
  return (await sectionManagerScope(page).locator('[data-section-notice]').textContent()) ?? '';
}
