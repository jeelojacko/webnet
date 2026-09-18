/**
 * Phase 18I browser QA — TIN-to-TIN volumes through the real /cad app.
 *
 * Playwright (dev-server + Chromium), NOT vitest. Drives the shipped UI:
 * ribbon Surface tab (VOLUME group), Toolspace Survey tree, surface
 * manager volume section, Layer manager, canvas MOVE, difference inquiry,
 * Volume Summary CSV download, WNCAD save/reopen. Zero page/console
 * errors is asserted per test.
 *
 * Drawing is generated in-test (48 points: base z=0 grid, flat +1
 * comparison grid, tilted comparison grid; three point-list surfaces):
 * - 18I-A core: volume create -> rebuild sources -> Calculate -> CURRENT
 *   analytic fill (900 overlap, 900 fill, 0 cut, net 900) -> mixed
 *   cut/fill volume (cut>0, fill>0, net≈0) -> inquiry CUT/FILL verdicts
 *   -> MOVE edit -> SOURCE_NOT_CURRENT/STALE -> rebuild + recalc CURRENT.
 * - 18I-B display/persistence: layer OFF hides volume paths -> ON
 *   restores -> save/reopen (UNBUILT sources, no false CURRENT) ->
 *   rebuild + recalc CURRENT.
 * - 18I-C styles/lifecycle/report: No-Display quantity-only (CURRENT,
 *   no paths) -> style CRUD without recalc -> delete removes the
 *   relationship only -> CSV download content/units -> registry keys.
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const SHOT_DIR = 'docs/evidence/phase18i';
const SEED = 'tests-browser/fixtures/cad-surface-18g-seed.wncad';

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
}

/** Generated 18I drawing: base/flat/tilt point grids + three point-list surfaces. */
function makeVolumeDrawing(): string {
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8')) as {
    project: {
      entities: unknown[];
      surfaces: unknown[];
      volumeSurfaces?: unknown[];
      volumeSurfaceStyles?: unknown[];
    };
  };
  const entities: unknown[] = [];
  const baseIds: string[] = [];
  const flatIds: string[] = [];
  const tiltIds: string[] = [];
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const x = col * 10;
      const y = row * 10;
      const base = { id: `i-pt-b${row}${col}`, type: 'survey-point', layerId: 'general', visible: true, locked: false, stationId: `IB${row}${col}`, x, y, z: 0, pointClass: 'free', source: 'parsed-input' };
      const flat = { ...base, id: `i-pt-f${row}${col}`, stationId: `IF${row}${col}`, z: 1 };
      const tilt = { ...base, id: `i-pt-t${row}${col}`, stationId: `IT${row}${col}`, z: (x - 15) / 15 };
      entities.push(base, flat, tilt);
      baseIds.push(base.id);
      flatIds.push(flat.id);
      tiltIds.push(tilt.id);
    }
  }
  for (const entity of seed.project.entities) {
    const record = entity as { type: string };
    if (record.type !== 'survey-point') entities.push(entity);
  }
  seed.project.entities = entities;
  seed.project.surfaces = [
    { id: 'i-surf-base', name: 'I-Base', definition: { pointSource: { kind: 'points', pointEntityIds: baseIds } }, cachedRevision: null },
    { id: 'i-surf-flat', name: 'I-Flat', definition: { pointSource: { kind: 'points', pointEntityIds: flatIds } }, cachedRevision: null },
    { id: 'i-surf-tilt', name: 'I-Tilt', definition: { pointSource: { kind: 'points', pointEntityIds: tiltIds } }, cachedRevision: null },
  ];
  delete seed.project.volumeSurfaces;
  delete seed.project.volumeSurfaceStyles;
  const tmpPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'webnet-18i-')), 'volumes.wncad');
  fs.writeFileSync(tmpPath, JSON.stringify(seed));
  return tmpPath;
}

async function openDrawing(page: Page, filePath: string, expectedEntities: number): Promise<void> {
  const fileInput = page.locator('[data-survey-cad-open-drawing-input]');
  await fileInput.evaluate((element: HTMLInputElement) => element.classList.remove('hidden')).catch(() => {});
  await fileInput.setInputFiles(filePath);
  await expect.poll(() => entityCount(page)).toBe(expectedEntities);
}

async function entityCount(page: Page): Promise<number> {
  const text = (await page.locator('[data-survey-cad-entity-count]').textContent()) ?? '';
  return Number.parseInt(text, 10);
}

async function selectionCount(page: Page): Promise<number> {
  const text = (await page.locator('[data-survey-cad-selection-count]').textContent()) ?? '';
  return Number.parseInt(text, 10);
}

function ribbonTab(page: Page, name: string) {
  return page.locator('[aria-label="Ribbon tabs"]').getByRole('tab', { name });
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

function volumeNode(page: Page, id: string) {
  return page.locator(`[data-cad-toolspace] [data-cad-volume="${id}"]`);
}

async function volumeStatus(page: Page, id: string): Promise<string> {
  return (await volumeNode(page, id).getAttribute('data-cad-volume-status')) ?? '';
}

async function volumeIds(page: Page): Promise<string[]> {
  return managerScope(page).locator('[data-volume-list] [data-cad-volume]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-cad-volume') ?? ''));
}

async function createVolume(page: Page, name: string, base: string, comparison: string): Promise<string> {
  const manager = managerScope(page);
  await manager.getByLabel('New volume name').fill(name);
  await manager.getByLabel('New volume base surface').selectOption({ label: base });
  await manager.getByLabel('New volume comparison surface').selectOption({ label: comparison });
  await manager.getByRole('button', { name: 'Create Volume' }).click();
  await expect.poll(() => volumeIds(page)).not.toHaveLength(0);
  const ids = await volumeIds(page);
  return ids[ids.length - 1] as string;
}

async function rebuildAll(page: Page): Promise<void> {
  await ribbonTab(page, 'Surface').click();
  await page.getByRole('button', { name: 'Rebuild All' }).click();
}

async function calculateVolume(page: Page): Promise<void> {
  await managerScope(page).getByRole('button', { name: /^Calculate|Recalculate$/ }).click();
}

async function canvasClick(page: Page, fx: number, fy: number): Promise<void> {
  const box = await page.locator('[data-cad-viewport] svg').first().boundingBox();
  if (!box) throw new Error('viewport svg has no bounding box');
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

async function cancelCommand(page: Page): Promise<void> {
  const input = page.locator('[data-cad-command-input]');
  await input.focus();
  await input.press('Escape');
}

async function downloadToTemp(page: Page, trigger: () => Promise<void>, suffix: string): Promise<string> {
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await trigger();
  const download = await downloadPromise;
  const tempPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'webnet-18i-dl-')), `file${suffix}`);
  await download.saveAs(tempPath);
  return tempPath;
}

test('18I-A: create -> rebuild -> Calculate CURRENT (analytic fill) -> mixed cut/fill -> inquiry -> edit STALE -> recalc', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  const drawingPath = makeVolumeDrawing();
  await openDrawing(page, drawingPath, 50);
  await showSurveyTab(page);

  // Ribbon VOLUME group is present in the SURFACE tab.
  await ribbonTab(page, 'Surface').click();
  for (const label of ['Create Volume', 'Calculate', 'Difference Inquiry', 'Volume Report']) {
    await expect(page.getByRole('button', { name: label }).first()).toBeVisible();
  }
  await openManager(page);
  const manager = managerScope(page);
  await expect(manager.locator('[data-volume-sign-convention]')).toContainText('Δ = Comparison − Base');

  // Rebuild all three source surfaces -> CURRENT.
  await rebuildAll(page);
  for (const id of ['i-surf-base', 'i-surf-flat', 'i-surf-tilt']) {
    await expect.poll(() => page.locator(`[data-cad-toolspace] [data-cad-surface="${id}"]`).getAttribute('data-cad-surface-status'), { timeout: 60000 }).toBe('CURRENT');
  }

  // Constant-fill analytic: base z=0 vs flat z=+1 over 30x30.
  const fillId = await createVolume(page, 'I-Fill', 'I-Base', 'I-Flat');
  await calculateVolume(page);
  await expect.poll(() => volumeStatus(page, fillId), { timeout: 60000 }).toBe('CURRENT');
  const quantities = manager.locator('[data-volume-quantities="current"]');
  await expect(quantities).toContainText('Overlap area');
  await expect(quantities).toContainText('900.000 m²');
  await expect(quantities).toContainText('Fill volume');
  await expect(quantities).toContainText('900.000 m³');
  await expect(quantities).toContainText('Cut volume');
  await expect(quantities).toContainText('0.000 m³');
  await expect(quantities).toContainText('Net volume');
  await expect(page.locator(`[data-volume-layer="${fillId}"]`)).toBeVisible();
  await expect(page.locator(`[data-volume-layer="${fillId}"] [data-volume-kind="fill"]`)).toHaveCount(1);
  await page.screenshot({ path: `${SHOT_DIR}/18i-A-fill-current.png` });

  // Mixed cut/fill: tilted comparison crosses the base plane.
  const mixedId = await createVolume(page, 'I-Mixed', 'I-Base', 'I-Tilt');
  await manager.locator('[data-volume-list] [data-cad-volume]').last().click();
  await calculateVolume(page);
  await expect.poll(() => volumeStatus(page, mixedId), { timeout: 60000 }).toBe('CURRENT');
  const mixedText = (await manager.locator(`[data-volume-detail="${mixedId}"]`).textContent()) ?? '';
  const cutOf = (label: string): number => {
    const match = mixedText.match(new RegExp(`${label}[\\s\\S]*?(\\d+\\.\\d+)`));
    return match ? Number.parseFloat(match[1]!) : Number.NaN;
  };
  expect(cutOf('Cut volume')).toBeGreaterThan(100);
  expect(cutOf('Fill volume')).toBeGreaterThan(100);
  expect(Math.abs(cutOf('Net volume'))).toBeLessThan(1);

  // Difference inquiry: E/N -> base/comparison/Δ + FILL verdict, live source label.
  await manager.locator('[data-volume-list] [data-cad-volume]').first().click();
  const inquiry = manager.locator('[data-volume-detail]');
  await inquiry.getByLabel('Difference easting').fill('15');
  await inquiry.getByLabel('Difference northing').fill('15');
  await inquiry.getByRole('button', { name: 'Query', exact: true }).click();
  await expect(inquiry.getByRole('status')).toContainText('FILL 1.000');
  await expect(inquiry.getByRole('status')).toContainText('live source inquiry');
  await page.screenshot({ path: `${SHOT_DIR}/18i-A-inquiry.png` });

  // Source edit (select-all + MOVE): sources NEEDS_REBUILD, volumes SOURCE_NOT_CURRENT + STALE.
  await ribbonTab(page, 'Home').click();
  await page.locator('[data-cad-command="SHELL_SELECT_ALL"]').click();
  await expect.poll(() => selectionCount(page)).toBe(50);
  await page.locator('[data-cad-command="MOVE"]').click();
  await canvasClick(page, 0.3, 0.5);
  await canvasClick(page, 0.35, 0.55);
  await cancelCommand(page);
  await expect.poll(() => volumeStatus(page, fillId)).toBe('SOURCE_NOT_CURRENT');
  await expect.poll(() => volumeStatus(page, mixedId)).toBe('SOURCE_NOT_CURRENT');
  await expect(manager.locator('[data-volume-list]')).toContainText('(stale)');
  await page.screenshot({ path: `${SHOT_DIR}/18i-A-stale.png` });

  // Rebuild sources + Recalculate restores CURRENT with the same analytic values.
  await rebuildAll(page);
  await expect.poll(() => volumeStatus(page, fillId), { timeout: 60000 }).toBe('NEEDS_RECALC');
  await manager.locator('[data-volume-list] [data-cad-volume]').first().click();
  await calculateVolume(page);
  await expect.poll(() => volumeStatus(page, fillId), { timeout: 60000 }).toBe('CURRENT');
  await expect(manager.locator('[data-volume-quantities="current"]')).toContainText('900.000 m³');
  await page.screenshot({ path: `${SHOT_DIR}/18i-A-recalc.png` });
  fs.rmSync(path.dirname(drawingPath), { recursive: true, force: true });
  expect(errors).toEqual([]);
});

test('18I-B: layer OFF hides volume paths -> ON restores -> save/reopen -> rebuild + recalc', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  const drawingPath = makeVolumeDrawing();
  await openDrawing(page, drawingPath, 50);
  await showSurveyTab(page);
  await openManager(page);
  await rebuildAll(page);
  for (const id of ['i-surf-base', 'i-surf-flat']) {
    await expect.poll(() => page.locator(`[data-cad-toolspace] [data-cad-surface="${id}"]`).getAttribute('data-cad-surface-status'), { timeout: 60000 }).toBe('CURRENT');
  }
  const fillId = await createVolume(page, 'I-Fill', 'I-Base', 'I-Flat');
  await calculateVolume(page);
  await expect.poll(() => volumeStatus(page, fillId), { timeout: 60000 }).toBe('CURRENT');
  await expect(page.locator(`[data-volume-layer="${fillId}"]`)).toBeVisible();

  const collapse = page.locator('button[title="Collapse panel body"]');
  if (await collapse.isVisible().catch(() => false)) {
    await collapse.click();
  }
  await ribbonTab(page, 'Home').click();
  await page.getByRole('button', { name: 'Open layer manager' }).click();
  const layers = page.locator('[data-cad-layers]');
  await layers.locator('input[aria-label="Toggle on/off for layer General"]').uncheck();
  await expect(page.locator('[data-volume-layer]')).toHaveCount(0);
  await page.screenshot({ path: `${SHOT_DIR}/18i-B-layer-off.png` });
  await layers.locator('input[aria-label="Toggle on/off for layer General"]').check();
  await expect.poll(() => page.locator(`[data-volume-layer="${fillId}"]`).count()).toBe(1);

  // Save/reopen: definitions persist, derived results never do (no false CURRENT).
  await ribbonTab(page, 'Home').click();
  const savedPath = await downloadToTemp(
    page,
    () => page.getByRole('button', { name: 'Save Drawing' }).first().click(),
    '.wncad',
  );
  expect(fs.readFileSync(savedPath, 'utf8')).toContain('I-Fill');
  await page.goto('/cad', { waitUntil: 'networkidle' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await openDrawing(page, savedPath, 50);
  await showSurveyTab(page);
  await expect.poll(() => volumeStatus(page, fillId)).toMatch(/SOURCE_NOT_CURRENT|UNBUILT/);
  await openManager(page);
  await rebuildAll(page);
  await expect.poll(() => page.locator('[data-cad-toolspace] [data-cad-surface="i-surf-flat"]').getAttribute('data-cad-surface-status'), { timeout: 60000 }).toBe('CURRENT');
  // Results never persist: after reopen there is no retained stale result,
  // so the volume reads UNBUILT (never false CURRENT), then recalculates.
  await expect.poll(() => volumeStatus(page, fillId)).toBe('UNBUILT');
  await managerScope(page).locator('[data-volume-list] [data-cad-volume]').first().click();
  await calculateVolume(page);
  await expect.poll(() => volumeStatus(page, fillId), { timeout: 60000 }).toBe('CURRENT');
  await page.screenshot({ path: `${SHOT_DIR}/18i-B-reopened.png` });
  fs.rmSync(path.dirname(drawingPath), { recursive: true, force: true });
  fs.rmSync(path.dirname(savedPath), { recursive: true, force: true });
  expect(errors).toEqual([]);
});

test('18I-C: No-Display quantity-only -> style CRUD without recalc -> delete relationship-only -> CSV report -> registry', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  const drawingPath = makeVolumeDrawing();
  await openDrawing(page, drawingPath, 50);
  await showSurveyTab(page);
  await openManager(page);
  const manager = managerScope(page);
  await rebuildAll(page);
  for (const id of ['i-surf-base', 'i-surf-flat']) {
    await expect.poll(() => page.locator(`[data-cad-toolspace] [data-cad-surface="${id}"]`).getAttribute('data-cad-surface-status'), { timeout: 60000 }).toBe('CURRENT');
  }
  const fillId = await createVolume(page, 'I-Fill', 'I-Base', 'I-Flat');
  await calculateVolume(page);
  await expect.poll(() => volumeStatus(page, fillId), { timeout: 60000 }).toBe('CURRENT');

  // No-Display style: quantity-only (CURRENT + quantities, zero volume paths).
  const detail = manager.locator('[data-volume-detail]');
  await detail.getByLabel('Volume style', { exact: true }).selectOption({ label: 'No Display' });
  await expect(manager.locator('[data-volume-notice]')).toContainText('Style done.');
  await expect.poll(() => page.locator('[data-volume-layer]').count()).toBe(0);
  await expect.poll(() => volumeStatus(page, fillId)).toBe('CURRENT');
  await expect(manager.locator('[data-volume-quantities="current"]')).toContainText('900.000 m³');
  await detail.getByLabel('Volume style', { exact: true }).selectOption({ label: 'Cut/Fill' });
  await expect.poll(() => page.locator(`[data-volume-layer="${fillId}"]`).count()).toBe(1);

  // Style CRUD: new style + recolor never recalculates (stays CURRENT).
  const styleSettings = manager.locator('section[aria-label="Volume style settings"]');
  await manager.getByLabel('New volume style name').fill('I-Custom');
  await manager.getByRole('button', { name: 'New Style' }).click();
  await expect(manager.locator('[data-volume-notice]')).toContainText('Style create done.');
  await detail.getByLabel('Volume style', { exact: true }).selectOption({ label: 'I-Custom' });
  await styleSettings.locator('li', { hasText: 'I-Custom' }).getByRole('button', { name: 'Edit', exact: true }).click();
  await manager.getByLabel('Cut color').fill('#00ff00');
  await manager.getByRole('button', { name: 'Apply volume style' }).click();
  await expect(manager.locator('[data-volume-notice]')).toContainText('display only');
  await expect.poll(() => volumeStatus(page, fillId)).toBe('CURRENT');
  await page.screenshot({ path: `${SHOT_DIR}/18i-C-style.png` });

  // Delete removes the relationship only: sources stay CURRENT.
  await manager.locator(`[data-volume-detail="${fillId}"]`).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(() => volumeIds(page)).toHaveLength(0);
  await expect.poll(() => page.locator('[data-cad-toolspace] [data-cad-surface="i-surf-base"]').getAttribute('data-cad-surface-status')).toBe('CURRENT');

  // Recreate + CSV report: explicit units, revisions, sign convention.
  const reportId = await createVolume(page, 'I-Report', 'I-Base', 'I-Flat');
  await calculateVolume(page);
  await expect.poll(() => volumeStatus(page, reportId), { timeout: 60000 }).toBe('CURRENT');
  const csvPath = await downloadToTemp(
    page,
    () => manager.locator(`[data-volume-report="${reportId}"]`).click(),
    '.csv',
  );
  const csv = fs.readFileSync(csvPath, 'utf8');
  expect(csv).toContain('meta,volume-surface,I-Report,');
  expect(csv).toContain('meta,base,I-Base,');
  expect(csv).toContain('meta,comparison,I-Flat,');
  expect(csv).toContain('Fill volume,900.000,m³');
  expect(csv).toContain('Overlap area,900.000,m²');
  expect(csv).toContain('Net volume (Fill − Cut),900.000,m³');
  expect(csv).toContain('Δ = Comparison − Base');
  fs.rmSync(path.dirname(csvPath), { recursive: true, force: true });

  // Registry: SURFVOLUME/SURFVOLCALC/SURFDIFF/SURFVOLREPORT resolve + dispatch.
  const registry = await page.evaluate(async (registryUrl: string) => {
    const mod = await import(registryUrl) as {
      CAD_SHELL_COMMANDS: Array<{ key: string }>;
      resolveShellCommandText: (_text: string) => { key: string } | null;
    };
    return {
      keys: mod.CAD_SHELL_COMMANDS.map((entry) => entry.key),
      resolved: mod.resolveShellCommandText('surfdiff')?.key ?? null,
    };
  }, '/src/cad-app/shell/cadCommandRegistry.ts');
  for (const key of ['SURFVOLUME', 'SURFVOLCALC', 'SURFDIFF', 'SURFVOLREPORT']) {
    expect(registry.keys).toContain(key);
  }
  expect(registry.resolved).toBe('SURFDIFF');
  fs.rmSync(path.dirname(drawingPath), { recursive: true, force: true });
  expect(errors).toEqual([]);
});
