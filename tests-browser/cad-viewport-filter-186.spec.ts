/**
 * PERF-186.1 browser QA — single viewport visibility filter.
 *
 * Deterministic counts only (no wall-clock thresholds). Drives the shipped
 * /cad UI through the real production bundle and asserts the OFF/FROZEN
 * viewport contract, selection retirement, multi-select, snapped polyline,
 * pan/zoom/extents, undo/redo, and zero page/console/unhandled errors.
 *
 * Run (production bundle):
 *   npm run build && npx playwright test cad-viewport-filter-186 --config=playwright.prod.config.ts
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const SHOTS = 'docs/evidence/perf-186';
fs.mkdirSync(SHOTS, { recursive: true });
const evidence: Record<string, unknown> = {};
const writeEvidence = (): void => {
  fs.writeFileSync(path.join(SHOTS, 'browser-counts.json'), JSON.stringify(evidence, null, 2));
};

async function boot(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => { if (d.type() === 'confirm') void d.accept(); else void d.dismiss().catch(() => undefined); });
  await page.addInitScript(() => {
    const record = window as unknown as Record<string, unknown>;
    delete record.showSaveFilePicker;
    delete record.showOpenFilePicker;
  });
  await page.goto('/cad', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-cad-viewport]')).toBeVisible({ timeout: 30000 });
}

const managerScope = (page: Page) => page.locator('[data-cad-layers]');
const entityCount = async (page: Page): Promise<number> =>
  Number.parseInt((await page.locator('[data-survey-cad-entity-count]').first().textContent()) ?? '0', 10);
const selectionCount = async (page: Page): Promise<number> =>
  Number.parseInt((await page.locator('[data-survey-cad-selection-count]').first().textContent()) ?? '0', 10);
const renderEntityIds = (page: Page): Promise<string[]> =>
  page.$$eval('[data-survey-cad-render-entity-id]', (elements) => [
    ...new Set(elements.map((element) => element.getAttribute('data-survey-cad-render-entity-id') ?? '')),
  ]);
const renderStroke = (page: Page, entityId: string) =>
  page.locator(`[data-survey-cad-render-entity-id="${entityId}"]`).first();

async function openLayerManager(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open layer manager' }).click();
  await expect(page.locator('[data-cad-layers] section[aria-label="Layer properties manager"]')).toBeVisible();
}

async function collapseFloatingPanel(page: Page): Promise<void> {
  const collapse = page.locator('button[title="Collapse panel body"]');
  if (await collapse.isVisible().catch(() => false)) await collapse.click();
}

async function cancelCommand(page: Page): Promise<void> {
  const input = page.locator('[data-cad-command-input]');
  await input.focus();
  await input.press('Escape');
}

async function start(page: Page, key: string): Promise<void> {
  const input = page.locator('[data-cad-command-input]');
  await input.fill(key);
  await input.press('Enter');
  await expect(page.locator('[data-cad-command-prompt]')).toContainText(new RegExp(key.split('_')[0], 'i'), { timeout: 10000 });
}

async function type(page: Page, text: string): Promise<void> {
  const input = page.locator('[data-cad-command-input]');
  await input.fill(text);
  await input.press('Enter');
}

async function canvasPoint(page: Page, fx: number, fy: number): Promise<{ x: number; y: number }> {
  const box = await page.locator('[data-cad-viewport] svg').first().boundingBox();
  if (!box) throw new Error('viewport svg has no bounding box');
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

async function canvasClick(page: Page, fx: number, fy: number): Promise<void> {
  const point = await canvasPoint(page, fx, fy);
  await page.mouse.click(point.x, point.y);
}

async function drawLine(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.locator('[data-cad-command="LINE"]').click();
  await canvasClick(page, from[0], from[1]);
  await canvasClick(page, to[0], to[1]);
  await cancelCommand(page);
}

/** Rendered `<line>` endpoint in both SVG user units and client pixels. */
interface RenderedLineGeometry {
  ux1: number;
  uy1: number;
  ux2: number;
  uy2: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

async function renderedLineGeometry(page: Page, entityId: string): Promise<RenderedLineGeometry> {
  await page
    .locator(`[data-cad-viewport] svg line[data-survey-cad-render-entity-id="${entityId}"]`)
    .first()
    .waitFor({ state: 'attached', timeout: 10000 });
  return page.evaluate((id: string) => {
    const line = document.querySelector(
      `[data-cad-viewport] svg line[data-survey-cad-render-entity-id="${id}"]`,
    ) as SVGLineElement | null;
    if (!line) throw new Error(`no rendered line for ${id}`);
    const svg = (line.ownerSVGElement ?? line.closest('svg')) as SVGSVGElement | null;
    if (!svg) throw new Error('no owner svg');
    const vb = svg.viewBox.baseVal;
    const rect = svg.getBoundingClientRect();
    const scale = Math.min(rect.width / vb.width, rect.height / vb.height);
    const ox = rect.left + (rect.width - vb.width * scale) / 2 - vb.x * scale;
    const oy = rect.top + (rect.height - vb.height * scale) / 2 - vb.y * scale;
    const ux1 = Number(line.getAttribute('x1'));
    const uy1 = Number(line.getAttribute('y1'));
    const ux2 = Number(line.getAttribute('x2'));
    const uy2 = Number(line.getAttribute('y2'));
    return {
      ux1, uy1, ux2, uy2,
      ax: ox + ux1 * scale,
      ay: oy + uy1 * scale,
      bx: ox + ux2 * scale,
      by: oy + uy2 * scale,
    };
  }, entityId);
}

/** All rendered segment endpoints of one entity in SVG user units. */
test('A: OFF/ON + Freeze/Thaw hide/restore and retire selection', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await boot(page, errors);

  await drawLine(page, [0.2, 0.62], [0.42, 0.66]);
  await drawLine(page, [0.22, 0.5], [0.45, 0.54]);
  await expect.poll(() => entityCount(page)).toBe(2);
  const ids = await renderEntityIds(page);
  expect(ids.length).toBe(2);
  const target = ids[1]!;

  // Select via rendered element, then hide the layer.
  await renderStroke(page, target).click();
  await expect.poll(() => selectionCount(page)).toBe(1);

  await openLayerManager(page);
  const currentLayerName = await page
    .locator('[aria-label="Layers"] select[aria-label="Current layer"] option:checked')
    .textContent();
  const layerName = (currentLayerName ?? 'Layer1').trim();
  await managerScope(page).locator(`input[aria-label="Toggle on/off for layer ${layerName}"]`).uncheck();
  // Hidden entity is dropped and its selection retired (no floating grips).
  await expect.poll(async () => renderStroke(page, target).count()).toBe(0);
  await expect.poll(() => selectionCount(page)).toBe(0);
  evidence.flowA = { entities: ids.length, hiddenRendered: (await renderEntityIds(page)).length };

  // Restore (ON) — geometry returns from the same filtered scene.
  await managerScope(page).locator(`input[aria-label="Toggle on/off for layer ${layerName}"]`).check();
  await expect.poll(async () => renderStroke(page, target).count()).toBeGreaterThan(0);

  // Freeze hides; Thaw restores (same OFF/frozen contract).
  await managerScope(page).locator(`input[aria-label="Toggle freeze for layer ${layerName}"]`).check();
  await expect(renderStroke(page, target)).toHaveCount(0);
  await managerScope(page).locator(`input[aria-label="Toggle freeze for layer ${layerName}"]`).uncheck();
  await expect.poll(async () => renderStroke(page, target).count()).toBeGreaterThan(0);

  await page.keyboard.press('Escape');
  await collapseFloatingPanel(page);
  await page.screenshot({ path: `${SHOTS}/186-A-layers.png` });
  writeEvidence();
  expect(errors).toEqual([]);
});

test('B: multi-select and undo/redo preserve the filtered scene', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await boot(page, errors);

  await drawLine(page, [0.18, 0.6], [0.4, 0.64]);
  await drawLine(page, [0.45, 0.5], [0.68, 0.54]);
  await drawLine(page, [0.3, 0.35], [0.55, 0.3]);
  await expect.poll(() => entityCount(page)).toBe(3);

  // Box select right-to-left (crossing mode) selects the drawn geometry.
  const box = await page.locator('[data-cad-viewport] svg').first().boundingBox();
  if (!box) throw new Error('no viewport box');
  await page.mouse.move(box.x + box.width * 0.78, box.y + box.height * 0.75);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.08, box.y + box.height * 0.22, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => selectionCount(page)).toBeGreaterThanOrEqual(2);
  const selectedByBox = await selectionCount(page);

  // Exact multi-select: select all, then Shift-click one entity to drop it.
  await page.getByRole('tab', { name: 'Home' }).click();
  await page.locator('[data-cad-command="SHELL_CLEAR_SELECTION"]').click();
  await expect.poll(() => selectionCount(page)).toBe(0);
  await page.locator('[data-cad-command="SHELL_SELECT_ALL"]').click();
  await expect.poll(() => selectionCount(page)).toBe(3);
  const ids = await renderEntityIds(page);
  await renderStroke(page, ids[1]!).click({ modifiers: ['Shift'] });
  await expect.poll(() => selectionCount(page)).toBe(2);
  const selectedAfterShift = await selectionCount(page);

  // Undo the last line: rendered scene follows the project transaction.
  await page.locator('[data-cad-command="SHELL_UNDO"]').click();
  await expect.poll(() => entityCount(page)).toBe(2);
  await page.locator('[data-cad-command="SHELL_REDO"]').click();
  await expect.poll(() => entityCount(page)).toBe(3);
  await expect.poll(async () => (await renderEntityIds(page)).length).toBe(3);

  evidence.flowB = { selectedByBox, selectedAfterShift, restoredEntities: (await renderEntityIds(page)).length };
  writeEvidence();
  expect(errors).toEqual([]);
});

test('C: endpoint-snapped polyline, pan/zoom/zoom-extents stay stable with zero errors', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await boot(page, errors);

  // Draw a base line; its end endpoint becomes the OSNAP target.
  await drawLine(page, [0.2, 0.4], [0.5, 0.58]);
  await expect.poll(() => entityCount(page)).toBe(1);
  const baseId = (await renderEntityIds(page))[0]!;
  const base = await renderedLineGeometry(page, baseId);

  // PLINE: the first vertex snaps to the base line's end endpoint. Click just
  // past the endpoint along its outward extension (~10px) so the click lands
  // on the empty canvas background (clear of the 16-unit hit stroke) while
  // staying inside the endpoint snap tolerance. Assert the live badge first.
  await start(page, 'PLINE');
  const segX = base.bx - base.ax;
  const segY = base.by - base.ay;
  const segLen = Math.hypot(segX, segY) || 1;
  const snapX = base.bx + (segX / segLen) * 10;
  const snapY = base.by + (segY / segLen) * 10;
  await page.mouse.move(snapX - 40, snapY - 40);
  await page.waitForTimeout(80);
  await page.mouse.move(snapX, snapY);
  await expect(page.locator('[data-survey-cad-snap-badge]')).toContainText(/endpoint/i, { timeout: 5000 });
  const snapBadge = (await page.locator('[data-survey-cad-snap-badge]').textContent()) ?? '';
  await page.mouse.click(snapX, snapY);
  await expect(page.locator('[data-cad-command-prompt]')).toContainText(/1 vertex captured/i, { timeout: 5000 });
  // Move to the second point and let the snap state settle before clicking so
  // the mousedown cannot reuse a stale endpoint snap from the first vertex.
  const second = await canvasPoint(page, 0.72, 0.35);
  await page.mouse.move(second.x, second.y);
  await page.waitForTimeout(150);
  await page.mouse.click(second.x, second.y);
  // Wait for the second vertex to commit before finishing (no Enter/click race).
  await expect(page.locator('[data-cad-command-prompt]')).toContainText(/2 vertices captured/i, { timeout: 5000 });
  await type(page, '');
  await expect(page.locator('[data-cad-command-prompt]')).toContainText(/committed/i, { timeout: 5000 });
  await cancelCommand(page);

  await expect.poll(() => entityCount(page)).toBe(2);
  const rendered = await renderEntityIds(page);
  expect(rendered.length).toBe(2);
  const polylineId = rendered.find((id) => id !== baseId) ?? '';
  expect(polylineId).not.toBe('');

  // Persisted-coordinate proof: the committed polyline's first vertex is the
  // base line's end endpoint exactly (the raw click was ~10px past it), so the
  // endpoint OSNAP drove the geometry, not the pointer position.
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await page.getByRole('button', { name: 'Save Drawing' }).first().click();
  const download = await downloadPromise;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wn-perf-186-'));
  const filePath = path.join(dir, 'drawing.wncad');
  await download.saveAs(filePath);
  const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const entities: Array<{ id: string; toX?: number; toY?: number; vertices?: Array<{ x: number; y: number }> }> =
    saved?.project?.entities ?? saved?.entities ?? [];
  const baseEntity = entities.find((entity) => entity.id === baseId);
  const polylineEntity = entities.find((entity) => entity.id === polylineId);
  expect(baseEntity).toBeTruthy();
  expect(polylineEntity?.vertices?.[0]).toEqual({ x: baseEntity!.toX, y: baseEntity!.toY });

  const box = await page.locator('[data-cad-viewport] svg').first().boundingBox();
  if (!box) throw new Error('no viewport box');

  // Middle-drag pan: geometry remains rendered.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 + 20, { steps: 6 });
  await page.mouse.up({ button: 'middle' });
  await expect.poll(async () => renderStroke(page, polylineId).count()).toBeGreaterThan(0);

  // Wheel zoom in/out: no crash, entity remains present or culled-restorable.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -240);
  await page.mouse.wheel(0, 240);
  // Double middle-click = zoom extents.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'middle', clickCount: 2 });
  await expect.poll(async () => renderStroke(page, polylineId).count()).toBeGreaterThan(0);

  evidence.flowC = {
    entityCount: await entityCount(page),
    rendered: (await renderEntityIds(page)).length,
    snapBadge,
    snappedVertex: polylineEntity?.vertices?.[0] ?? null,
  };
  writeEvidence();
  expect(errors).toEqual([]);
});
