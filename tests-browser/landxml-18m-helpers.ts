/**
 * Phase 18M browser QA — LandXML production import helpers.
 *
 * Playwright (dev-server + Chromium), NOT vitest. The committed production
 * corpus lives at `tests/fixtures/landxml-18m-production.xml`; the large-TIN
 * perf file is generated at test time (never committed) via the shared
 * `tests/landxmlLargeTinFixtures.ts` generator.
 */
import { expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildLargeTinXml } from '../tests/landxmlLargeTinFixtures';

export const SHOT_DIR = 'docs/evidence/phase18m';
export const FIXTURE = 'tests/fixtures/landxml-18m-production.xml';

/** The workspace review dialog (staged preview; never mutates the drawing). */
export const reviewScope = (page: Page) =>
  page.locator('[data-landxml-import-review]');

/** Hidden `<input type=file accept=".xml">` the menu/command both click. */
export const importInput = (page: Page) =>
  page.locator('[data-landxml-import-input]');

/** Reveal the hidden picker and inject the staged fixture text. */
export async function stageLandXml(page: Page, filePath: string): Promise<void> {
  const input = importInput(page);
  await input.evaluate((element: HTMLInputElement) => element.classList.remove('hidden')).catch(() => {});
  await input.setInputFiles(filePath);
  await expect(reviewScope(page)).toBeVisible({ timeout: 15000 });
}

/** File menu → Import LandXML. */
export async function openLandXmlViaMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: /Import LandXML/ }).click();
}

/** Command dock alias `LANDXMLIMPORT` → same action. */
export async function openLandXmlViaCommand(page: Page): Promise<void> {
  const input = page.locator('[data-cad-command-input]');
  await input.click();
  await input.fill('LANDXMLIMPORT');
  await input.press('Enter');
}

export function largeTinPath(vertexCount = 50_000): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnet-18m-browser-'));
  const filePath = path.join(dir, `landxml-large-${vertexCount}.xml`);
  fs.writeFileSync(
    filePath,
    buildLargeTinXml(vertexCount, { surfaceName: `Large TIN ${vertexCount}` }),
  );
  return filePath;
}

export async function toggleSurface(page: Page, name: string): Promise<void> {
  await reviewScope(page)
    .locator('[data-landxml-surfaces] li')
    .filter({ hasText: name })
    .locator('input[type="checkbox"]')
    .click();
}

export async function toggleAlignment(page: Page, name: string): Promise<void> {
  await reviewScope(page)
    .locator('[data-landxml-alignments] li')
    .filter({ hasText: name })
    .locator('input[type="checkbox"]')
    .click();
}

/** Parsed selected-object count from the review footer's import button. */
export async function selectedCount(page: Page): Promise<number> {
  const label = (await reviewScope(page).locator('[data-landxml-import-selected]').textContent()) ?? '';
  return Number.parseInt(/(\d+)/.exec(label)?.[1] ?? '0', 10);
}

export async function surfaceStatus(page: Page, surfaceName: string): Promise<string | null> {
  await page.locator('[aria-label="Toolspace tabs"]').getByRole('tab', { name: 'Survey' }).click();
  const row = page
    .locator('[data-cad-toolspace] [data-cad-surface]')
    .filter({ hasText: surfaceName })
    .first();
  return row.getAttribute('data-cad-surface-status');
}
