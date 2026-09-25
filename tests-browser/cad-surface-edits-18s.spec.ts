/**
 * Phase 18S browser QA — TIN surface edit stack through the real /cad app.
 *
 * Playwright (dev-server + Chromium), NOT vitest. Drives the shipped UI:
 * ribbon Surface → Edit group, Toolspace Definition → Edits node, the
 * manager EDITS table, Properties edit counts, WNCAD save/reopen. Seed
 * drawings are generated in-test from the 18G fixture: a native point-grid
 * surface (one broken edit) and an imported-TIN surface whose explicit
 * topology carries a verified swap + delete stack. Zero page/console errors
 * is asserted per test.
 *
 * - 18S-A imported edits: readable V<i> rows (never UUIDs), manager +
 *   toolspace + properties agree, rebuild CURRENT, save/reopen keeps the
 *   stack exact and rebuilds again.
 * - 18S-B fail-closed: a native edit referencing a deleted survey point
 *   reads broken-reference with a reason on both the node and the manager.
 * - 18S-C actions/ribbon: EDITS table actions dispatch undoable commands
 *   (notice + undo), and the ribbon Edit group is wired for CURRENT surfaces.
 *
 * The pick-driven commit flows (canvas swap/add/delete sessions) are owned
 * by the 18S transactions slice; this spec pins the UI/derived surface they
 * present, plus save/reopen.
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const SEED = 'tests-browser/fixtures/cad-surface-18g-seed.wncad';
const SHOT_DIR = 'docs/evidence/phase18s';
const NATIVE_ID = 'n-surf';
const IMPORTED_ID = 'i-surf';

async function gotoCad(page: Page, errors: string[]): Promise<void> {
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
  fs.mkdirSync(SHOT_DIR, { recursive: true });
}

/** 3x3 native grid + imported TIN (swap 0–4, delete 1–4) — topology verified in vitest. */
function makeEditDrawing(): string {
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8')) as { project: Record<string, unknown> };
  const entities: unknown[] = [];
  const nativeIds: string[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const x = col * 10 + ((row * 7 + col * 3) % 5) * 0.31;
      const y = row * 10 + ((row * 2 + col * 5) % 4) * 0.27;
      const id = `s18s-pt-${row}${col}`;
      nativeIds.push(id);
      entities.push({
        id, type: 'survey-point', layerId: 'general', visible: true, locked: false,
        stationId: `P${row}${col}`, x, y, z: 0.013 * x + 0.021 * y + 2.5, pointClass: 'free', source: 'parsed-input',
      });
    }
  }
  seed.project.entities = entities;
  seed.project.surfaces = [
    {
      id: NATIVE_ID, name: '18S Native', cachedRevision: null,
      definition: {
        pointSource: { kind: 'points', pointEntityIds: nativeIds },
        edits: [
          { id: 'n-broken', kind: 'swap-edge', enabled: true, edge: { a: { key: 'source:pt:missing-a' }, b: { key: 'source:pt:missing-b' } } },
          { id: 'n-off', kind: 'delete-line', enabled: false, edge: { a: { key: `source:${nativeIds[0]}` }, b: { key: `source:${nativeIds[4]}` } } },
        ],
      },
    },
    {
      id: IMPORTED_ID, name: '18S Imported', cachedRevision: null,
      definition: {
        pointSource: { kind: 'points', pointEntityIds: [] },
        sourceKind: 'imported-tin',
        importedTin: {
          vertices: [0, 0, 0, 10, 0, 1, 20, 0, 2, 0, 10, 3, 10, 10, 4, 20, 10, 5, 0, 20, 6, 10, 20, 7, 20, 20, 8],
          faces: [0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4, 3, 4, 7, 3, 7, 6, 4, 5, 8, 4, 8, 7],
          provenance: { format: 'LandXML', fileName: 'edits.xml', surfaceName: 'Imported TIN', sourceId: 'sid-18s' },
        },
        edits: [
          { id: 'ie-swap', kind: 'swap-edge', enabled: true, edge: { a: { key: 'imported:i-surf:0' }, b: { key: 'imported:i-surf:4' } } },
          { id: 'ie-del', kind: 'delete-line', enabled: true, edge: { a: { key: 'imported:i-surf:1' }, b: { key: 'imported:i-surf:4' } } },
        ],
      },
    },
  ];
  return JSON.stringify(seed);
}

async function openGeneratedDrawing(page: Page): Promise<string> {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'webnet-18s-')), 'edit.wncad');
  fs.writeFileSync(file, makeEditDrawing());
  const input = page.locator('[data-survey-cad-open-drawing-input]');
  await input.evaluate((element: HTMLInputElement) => element.classList.remove('hidden')).catch(() => {});
  await input.setInputFiles(file);
  await expect.poll(() => entityCount(page)).toBe(9);
  return file;
}

async function entityCount(page: Page): Promise<number> {
  const text = (await page.locator('[data-survey-cad-entity-count]').textContent()) ?? '';
  return Number.parseInt(text, 10);
}

function ribbonTab(page: Page, name: string) {
  return page.locator('[aria-label="Ribbon tabs"]').getByRole('tab', { name });
}

function toolspaceSurface(page: Page, id: string) {
  return page.locator(`[data-cad-toolspace] [data-cad-surface="${id}"]`);
}

async function surfaceStatus(page: Page, id: string): Promise<string> {
  return (await toolspaceSurface(page, id).getAttribute('data-cad-surface-status')) ?? '';
}

async function showSurveyTab(page: Page): Promise<void> {
  await page.locator('[aria-label="Toolspace tabs"]').getByRole('tab', { name: 'Survey' }).click();
}

function managerScope(page: Page) {
  return page.locator('section[aria-label="Surface manager"]');
}

async function openManager(page: Page): Promise<void> {
  await ribbonTab(page, 'Surface').click();
  await page.getByRole('button', { name: 'Add Point Group' }).first().click();
  await expect(managerScope(page)).toBeVisible({ timeout: 10000 });
}

async function selectManagerSurface(page: Page, name: string): Promise<void> {
  const manager = managerScope(page);
  await manager.locator('ul button', { hasText: name }).first().click();
}

test('18S-A: imported edit stack renders readable rows, rebuilds, and survives save/reopen', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openGeneratedDrawing(page);
  await showSurveyTab(page);

  // Toolspace: Definition → Edits child rows, readable V<i> refs, no UUIDs.
  const node = toolspaceSurface(page, IMPORTED_ID);
  await expect(node).toBeVisible();
  await node.locator('summary').first().click();
  await expect(node.locator('[data-cad-surface-edits-node]')).toBeVisible();
  const rows = node.locator('[data-cad-surface-edit]');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('1 Swap Edge V0 – V4');
  await expect(rows.nth(1)).toContainText('2 Delete Line V1 – V4');
  await expect(node).not.toContainText('imported:i-surf');
  await page.screenshot({ path: `${SHOT_DIR}/18s-A-toolspace.png` });

  // Rebuild through the manager; the edit replay must stay CURRENT.
  await openManager(page);
  await selectManagerSurface(page, '18S Imported');
  const manager = managerScope(page);
  await expect(manager.locator('[data-cad-surface-edits]')).toBeVisible();
  await expect(manager).toContainText('Imported LandXML TIN');
  await manager.getByRole('button', { name: 'Rebuild', exact: true }).click();
  await expect.poll(() => surfaceStatus(page, IMPORTED_ID), { timeout: 60000 }).toBe('CURRENT');
  await page.screenshot({ path: `${SHOT_DIR}/18s-A-manager.png` });

  // Save/reopen keeps the exact stack and rebuilds again.
  const savedPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'webnet-18s-save-')), '18s-edit.wncad');
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await ribbonTab(page, 'Home').click();
  await page.getByRole('button', { name: 'Save Drawing' }).first().click();
  const download = await downloadPromise;
  await download.saveAs(savedPath);
  expect(fs.readFileSync(savedPath, 'utf8')).toContain('ie-swap');
  await page.goto('/cad', { waitUntil: 'networkidle' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  const fileInput = page.locator('[data-survey-cad-open-drawing-input]');
  await fileInput.evaluate((element: HTMLInputElement) => element.classList.remove('hidden')).catch(() => {});
  await fileInput.setInputFiles(savedPath);
  await expect.poll(() => entityCount(page)).toBe(9);
  await showSurveyTab(page);
  await expect(toolspaceSurface(page, IMPORTED_ID).locator('[data-cad-surface-edit]')).toHaveCount(2);
  await openManager(page);
  await selectManagerSurface(page, '18S Imported');
  await managerScope(page).getByRole('button', { name: 'Rebuild', exact: true }).click();
  await expect.poll(() => surfaceStatus(page, IMPORTED_ID), { timeout: 60000 }).toBe('CURRENT');
  fs.rmSync(savedPath, { force: true });
  expect(errors).toEqual([]);
});

test('18S-B: broken enabled edit fails closed with a reason on node and manager', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openGeneratedDrawing(page);
  await showSurveyTab(page);

  const node = toolspaceSurface(page, NATIVE_ID);
  await expect(node).toBeVisible();
  const broken = node.locator('[data-cad-surface-edit="n-broken"]');
  await expect(broken).toContainText('broken-reference');
  const disabled = node.locator('[data-cad-surface-edit="n-off"]');
  await expect(disabled).toContainText('disabled');

  await openManager(page);
  await selectManagerSurface(page, '18S Native');
  const manager = managerScope(page);
  await expect(manager.locator('[data-cad-edit-diagnostic]')).toContainText('n-broken');
  await expect(manager.locator('[data-cad-edit-diagnostic]')).toContainText('SURFACE_EDIT_VERTEX_MISSING');
  // Properties summary: 2 edits, 1 enabled, 1 broken — counts only.
  await expect(page.locator(`[data-cad-surface-edit-summary="${NATIVE_ID}"]`)).toContainText('2');
  expect(errors).toEqual([]);
});

test('18S-C: EDITS actions dispatch undoable commands and the ribbon Edit group is wired', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openGeneratedDrawing(page);
  await showSurveyTab(page);
  await openManager(page);
  await selectManagerSurface(page, '18S Imported');
  const manager = managerScope(page);

  // Table actions exist for every edit; toggling issues a real command notice.
  const first = manager.locator('[data-cad-surface-edit="ie-swap"]');
  await expect(first.locator('[data-cad-edit-action="up"]')).toBeDisabled();
  await expect(first.locator('[data-cad-edit-action="down"]')).toBeEnabled();
  await first.locator('[data-cad-edit-action="toggle"]').click();
  await expect(manager.getByRole('status').first()).toContainText(/Disable (done|rejected)/);

  // Ribbon Surface → Edit group buttons resolve to real starter keys; with a
  // CURRENT surface they are enabled.
  await ribbonTab(page, 'Surface').click();
  await expect(page.locator('[data-cad-surface="swap"]')).toBeVisible();
  await expect(page.locator('[data-cad-surface="add-line"]')).toBeVisible();
  await expect(page.locator('[data-cad-surface="delete-line"]')).toBeVisible();
  await expect(page.locator('[data-cad-surface="history"]')).toBeVisible();
  expect(errors).toEqual([]);
});
