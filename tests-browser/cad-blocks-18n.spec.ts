/**
 * Phase 18N browser QA — blocks + survey symbols through the real /cad app.
 *
 * Playwright (Chromium), NOT vitest. ONE test, one page load (<60s
 * budget): typed aliases, Block Manager, ribbon BLOCKS group, Toolspace
 * Blocks node, Properties rows, insertion grip, snap toggles, redefine,
 * explode, symbol seeding, block-backed point style, F2F intact, WNCAD
 * save/reopen, and DXF export. Zero page/console errors asserted at the end.
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

async function gotoCad(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    const record = window as unknown as Record<string, unknown>;
    delete record.showSaveFilePicker;
    delete record.showOpenFilePicker;
  });
  page.on('dialog', (dialog) => {
    if (dialog.type() === 'confirm') void dialog.accept();
  });
  await page.goto('/cad', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-cad-viewport]')).toBeVisible({ timeout: 30000 });
}

async function collapseFloatingPanel(page: Page): Promise<void> {
  const collapse = page.locator('button[title="Collapse panel body"]');
  if (await collapse.isVisible().catch(() => false)) {
    await collapse.click();
  }
}

async function canvasClick(page: Page, fx: number, fy: number): Promise<void> {
  const box = await page.locator('[data-cad-viewport] svg').first().boundingBox();
  if (!box) throw new Error('viewport svg has no bounding box');
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

async function drawLine(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.locator('[data-cad-command="LINE"]').click();
  await canvasClick(page, from[0], from[1]);
  await canvasClick(page, to[0], to[1]);
  const input = page.locator('[data-cad-command-input]');
  await input.focus();
  await input.press('Escape');
}

async function entityCount(page: Page): Promise<number> {
  const text = (await page.locator('[data-survey-cad-entity-count]').textContent()) ?? '';
  return Number.parseInt(text, 10);
}

async function selectionCount(page: Page): Promise<number> {
  const text = (await page.locator('[data-survey-cad-selection-count]').textContent()) ?? '';
  return Number.parseInt(text, 10);
}

async function selectAll(page: Page, expected: number): Promise<void> {
  await page.locator('[data-cad-ribbon] [role="tab"]', { hasText: 'Home' }).click();
  await page.locator('[data-cad-command="SHELL_SELECT_ALL"]').click();
  await expect.poll(() => selectionCount(page)).toBe(expected);
  await collapseFloatingPanel(page);
}

async function showProperties(page: Page): Promise<void> {
  await collapseFloatingPanel(page);
  if (await page.locator('[data-cad-properties]').isVisible().catch(() => false)) return;
  await page.getByRole('button', { name: 'View', exact: true }).click();
  const item = page.locator('[role="menu"][aria-label="View"] [role="menuitem"]', { hasText: 'Properties:' });
  if (((await item.textContent()) ?? '').includes('Hidden')) {
    await item.click();
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-cad-properties]')).toBeVisible({ timeout: 10000 });
}

async function openBlockManager(page: Page): Promise<void> {
  await page.locator('[data-cad-ribbon] [role="tab"]', { hasText: 'Home' }).click();
  await page.locator('[data-cad-blocks="manager"]').click();
  await expect(page.locator('[data-cad-block-manager]')).toBeVisible({ timeout: 10000 });
}

async function closeBlockManager(page: Page): Promise<void> {
  const manager = page.locator('[data-cad-block-manager]');
  await manager.locator('button[aria-label="Close Block Manager"]').click();
  await expect(manager).toBeHidden({ timeout: 10000 });
}

async function downloadToTemp(page: Page, trigger: () => Promise<void>, suffix: string): Promise<string> {
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await trigger();
  const download = await downloadPromise;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wn-18n-'));
  const tempPath = path.join(dir, `download${suffix}`);
  await download.saveAs(tempPath);
  return tempPath;
}

test('18N: blocks end to end (create/insert/props/grip/snap/redefine/explode/symbols/style/save/export)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  const manager = page.locator('[data-cad-block-manager]');

  // A. BLOCK create: draw linework, select, typed alias B opens the manager.
  await drawLine(page, [0.25, 0.5], [0.6, 0.55]);
  await expect.poll(() => entityCount(page)).toBe(1);
  await selectAll(page, 1);
  const input = page.locator('[data-cad-command-input]');
  await input.fill('B');
  await input.press('Enter');
  await expect(manager).toBeVisible({ timeout: 10000 });
  await manager.locator('input[aria-label="New block name"]').fill('QA-Block');
  await manager.getByRole('button', { name: 'New from selection' }).click();
  await expect(manager.locator('[data-cad-block-table] tbody tr')).toHaveCount(1);
  await expect(manager.locator('[data-cad-block-table] tbody tr').first()).toContainText('QA-Block');
  await closeBlockManager(page);

  // B. Redefine BEFORE any reference exists: second line joins, count 1 -> 2.
  await drawLine(page, [0.3, 0.6], [0.55, 0.65]);
  await expect.poll(() => entityCount(page)).toBe(2);
  await selectAll(page, 2);
  await openBlockManager(page);
  await manager.getByRole('button', { name: 'Redefine' }).click();
  await expect(manager.locator('[data-cad-block-table] tbody tr td:nth-child(3)').first()).toHaveText('2');

  // C. INSERT pick loop places at the visible canvas center.
  await manager.getByRole('tab', { name: 'Insert' }).click();
  await manager.getByRole('button', { name: 'Pick point' }).click();
  await expect(manager).toBeHidden({ timeout: 10000 });
  await canvasClick(page, 0.5, 0.5);
  await expect.poll(() => selectionCount(page)).toBe(1);
  await expect.poll(() => entityCount(page)).toBe(3);

  // D. Overlay hover text + Properties rows + rotation edit + grip drag.
  const hoverTitle = await page.evaluate(() => {
    const titles = [...document.querySelectorAll('[data-cad-viewport] svg title')];
    return titles.map((element) => element.textContent).find((text) => text?.startsWith('Block: ')) ?? null;
  });
  expect(hoverTitle).toMatch(/^Block: QA-Block/);
  await showProperties(page);
  const props = page.locator('[data-cad-properties]');
  await expect(props.locator('h3', { hasText: 'QA-Block' }).first()).toBeVisible();
  const rotation = props.locator('input[aria-label="Rotation"]');
  await expect(rotation).toBeVisible();
  const beforeX = await props.locator('input[aria-label="Insertion E"]').inputValue();
  await rotation.fill('45');
  await rotation.press('Enter');
  await expect(props.locator('input[aria-label="Rotation"]')).toHaveValue('45.0000');
  const grip = page.locator('[data-survey-cad-grip-handle="insertion"]');
  await expect(grip).toBeVisible({ timeout: 10000 });
  const gripBox = await grip.boundingBox();
  if (!gripBox) throw new Error('insertion grip has no bounding box');
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(gripBox.x + gripBox.width / 2 + 60, gripBox.y + gripBox.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => props.locator('input[aria-label="Insertion E"]').inputValue()).not.toBe(beforeX);

  // E. Snap toggles ride the existing preference seam.
  await page.locator('[data-cad-toolspace] [role="tab"]', { hasText: 'Settings' }).click();
  const endpoint = page.locator('[data-cad-toolspace] label', { hasText: 'endpoint' }).locator('input');
  await expect(endpoint).toBeVisible({ timeout: 10000 });
  await endpoint.uncheck();
  await expect(endpoint).not.toBeChecked();
  await endpoint.check();
  await expect(endpoint).toBeChecked();

  // F. EXPLODE via registry on the selected reference (3 -> 4 entities).
  await page.locator('[data-cad-ribbon] [role="tab"]', { hasText: 'Home' }).click();
  await page.locator('[data-cad-command="EXPLODE"]').click();
  await expect.poll(() => entityCount(page)).toBe(4);
  const blockTitles = await page.evaluate(() =>
    [...document.querySelectorAll('[data-cad-viewport] svg title')]
      .map((element) => element.textContent)
      .filter((text) => text?.startsWith('Block: ')).length,
  );
  expect(blockTitles).toBe(0);

  // G. Survey Symbols: lazy seed (26), category + tag filter.
  await page.locator('[data-cad-ribbon] [role="tab"]', { hasText: 'Survey' }).click();
  await page.locator('[data-cad-survey-symbols]').click();
  await expect(manager).toBeVisible({ timeout: 10000 });
  await expect(manager.locator('[data-cad-symbol-table] tbody tr')).toHaveCount(26);
  await manager.locator('select[aria-label="Symbol category"]').selectOption('utilities');
  const utilityCount = await manager.locator('[data-cad-symbol-table] tbody tr').count();
  expect(utilityCount).toBeGreaterThan(0);
  expect(utilityCount).toBeLessThan(26);
  await manager.locator('input[aria-label="Filter symbols"]').fill('manhole');
  await expect(manager.locator('[data-cad-symbol-table] tbody tr')).toHaveCount(1);
  await closeBlockManager(page);

  // H. Block-backed point style: picker preview + Apply through SURVEY_STYLE_TABLE.
  await page.locator('[data-cad-survey="point-styles"]').click();
  const markerSelect = page.locator('select[aria-label="Block marker"]');
  await expect(markerSelect).toBeVisible({ timeout: 10000 });
  const manholeValue = await markerSelect.evaluate((select: HTMLSelectElement) => {
    const option = [...select.options].find((entry) => entry.text.includes('Manhole'));
    return option?.value ?? null;
  });
  expect(manholeValue).not.toBeNull();
  await markerSelect.selectOption(manholeValue as string);
  await expect(page.locator('[data-cad-block-preview]').first()).toBeVisible();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('[data-cad-block-preview]').first()).toBeVisible();

  // I. F2F Toolspace node untouched (no catalog content in this drawing).
  await page.locator('[data-cad-toolspace] [role="tab"]', { hasText: 'Survey' }).click();
  await expect(page.locator('[data-cad-f2f-node]').first()).toBeVisible({ timeout: 10000 });

  // Insert a fresh reference so save/reopen round-trips live refs too.
  await openBlockManager(page);
  await manager.getByRole('tab', { name: 'Insert' }).click();
  await manager.locator('select[aria-label="Insert block"]').selectOption({ label: 'QA-Block' });
  await manager.locator('input[aria-label="Insert X"]').fill('5');
  await manager.locator('input[aria-label="Insert Y"]').fill('5');
  await manager.getByRole('button', { name: 'Insert at XY' }).click();
  await expect.poll(() => entityCount(page)).toBe(5);
  await closeBlockManager(page);

  // J. WNCAD save carries definitions + reference; reopen restores both.
  const savedPath = await downloadToTemp(
    page,
    () => page.getByRole('button', { name: 'Save Drawing' }).first().click(),
    '.wncad',
  );
  const savedText = fs.readFileSync(savedPath, 'utf8');
  expect(savedText).toContain('blockDefinitions');
  expect(savedText).toContain('QA-Block');
  expect(savedText).toContain('block-reference');
  const fileInput = page.locator('[data-survey-cad-open-drawing-input]');
  await fileInput.evaluate((element: HTMLInputElement) => element.classList.remove('hidden')).catch(() => {});
  await fileInput.setInputFiles(savedPath);
  await expect.poll(() => entityCount(page)).toBe(5);
  await page.locator('[data-cad-toolspace] [role="tab"]', { hasText: 'Settings' }).click();
  await expect(page.locator('[data-cad-toolspace-block]').first()).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-cad-toolspace-block]', { hasText: 'QA-Block' })).toBeVisible({ timeout: 10000 });
  fs.rmSync(path.dirname(savedPath), { recursive: true, force: true });

  // K. DXF export carries the block table + INSERT.
  await page.locator('[data-cad-ribbon] [role="tab"]', { hasText: 'Output' }).click();
  await page.locator('[data-cad-command="SHELL_EXPORT_CENTER"]').click();
  const center = page.locator('section[aria-label="Export Center"]');
  await expect(center).toBeVisible({ timeout: 10000 });
  await center.getByRole('tab', { name: /R12/ }).click();
  const dxfPath = await downloadToTemp(
    page,
    () => center.locator('[data-export-center-download]').click(),
    '.dxf',
  );
  const dxf = fs.readFileSync(dxfPath, 'utf8');
  expect(dxf).toContain('BLOCK');
  expect(dxf).toContain('QA-Block');
  expect(dxf).toContain('INSERT');
  fs.rmSync(path.dirname(dxfPath), { recursive: true, force: true });

  expect(errors).toEqual([]);
});
