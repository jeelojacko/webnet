/**
 * Phase 18P browser QA — associative annotation through the real /cad app.
 *
 * Playwright (Chromium), NOT vitest. Every test drives ACTUAL production
 * commands (ribbon buttons, canvas picks with OSNAP, Properties edits, MOVE /
 * ERASE / UNDO / REDO chrome actions, WNCAD save/reopen) — no engine
 * injection. Persistence assertions read the saved WNCAD JSON and assert the
 * anchor OBJECT kind (§53), not just screen position:
 *
 *   A. Leader → survey point snap (survey-point anchor; MOVE follows).
 *   B. Aligned dimension → two line-endpoint snaps (length edit re-measures).
 *   C. Radius dimension → arc snap (arc-point anchor; radius edit re-measures).
 *   D. Block-insertion leader (block-insertion anchor; insertion move follows).
 *   E. Free pick stays fixed.
 *   F. Midpoint snap stays fixed (source MOVE does NOT move it).
 *   G. Broken ref: delete source → BROKEN + Properties missing source →
 *      undo restores → redo breaks → save/reopen still broken.
 *
 * OSNAP mechanics drive every associative pick: the pointer is moved away and
 * back (so a mousemove recomputes the active snap) before each snap-critical
 * click, and clicks are taken from LIVE rendered geometry because the view
 * refits whenever entities change. Annotation primitives render on top of
 * their source, so source edits select through the Prospector entity tree
 * (select-all → click the row) rather than the overlaid canvas.
 *
 * Zero page/console errors asserted at the end of every test.
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// App chrome / navigation
// ---------------------------------------------------------------------------

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

async function homeTab(page: Page): Promise<void> {
  await page.locator('[data-cad-ribbon] [role="tab"]', { hasText: 'Home' }).click();
}

async function annotateTab(page: Page): Promise<void> {
  await page.locator('[data-cad-ribbon] [role="tab"]', { hasText: 'Annotate' }).click();
}

async function annotationCommandsReady(page: Page): Promise<boolean> {
  await annotateTab(page);
  const button = page.locator('[data-cad-annotation-command="MTEXT"]');
  if (!(await button.isVisible().catch(() => false))) return false;
  return button.isEnabled();
}

async function startAnnotationCommand(page: Page, key: string): Promise<void> {
  const button = page.locator(`[data-cad-annotation-command="${key}"]`);
  await expect(button).toBeEnabled();
  await button.click();
}

async function finishCommand(page: Page): Promise<void> {
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

async function collapseFloatingPanel(page: Page): Promise<void> {
  const collapse = page.locator('button[title="Collapse panel body"]');
  if (await collapse.isVisible().catch(() => false)) await collapse.click();
}

async function showProperties(page: Page): Promise<void> {
  await collapseFloatingPanel(page);
  if (await page.locator('[data-cad-properties]').isVisible().catch(() => false)) return;
  await page.getByRole('button', { name: 'View', exact: true }).click();
  const item = page.locator('[role="menu"][aria-label="View"] [role="menuitem"]', { hasText: 'Properties:' });
  if (((await item.textContent()) ?? '').includes('Hidden')) await item.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-cad-properties]')).toBeVisible({ timeout: 10000 });
}

// ---------------------------------------------------------------------------
// Canvas geometry — live rendered primitives mapped to client pixels
// ---------------------------------------------------------------------------

async function canvasClick(page: Page, fx: number, fy: number): Promise<void> {
  const box = await page.locator('[data-cad-viewport] svg').first().boundingBox();
  if (!box) throw new Error('viewport svg has no bounding box');
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

/** Move away then onto the target so a mousemove recomputes the active OSNAP. */
async function snapClick(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x - 30, y - 30);
  await page.waitForTimeout(70);
  await page.mouse.move(x, y);
  await page.waitForTimeout(160);
  await page.mouse.click(x, y);
}

/** Client-px line endpoints parsed from the live rendered `<line>`. */
async function renderedLineClient(
  page: Page,
  entityId: string,
): Promise<{ ax: number; ay: number; bx: number; by: number }> {
  await page.locator(`[data-cad-viewport] svg line[data-survey-cad-render-entity-id="${entityId}"]`).first().waitFor({ state: 'attached', timeout: 10000 });
  return page.evaluate((id: string) => {
    const line = document.querySelector(
      `line[data-survey-cad-render-entity-id="${id}"], line[data-survey-cad-entity-id="${id}"]`,
    ) as SVGLineElement | null;
    if (!line) throw new Error(`no rendered line for ${id}`);
    const svg = (line.ownerSVGElement ?? line.closest('svg')) as SVGSVGElement | null;
    if (!svg) throw new Error('no owner svg');
    const vb = svg.viewBox.baseVal;
    const rect = svg.getBoundingClientRect();
    const scale = Math.min(rect.width / vb.width, rect.height / vb.height);
    const ox = rect.left + (rect.width - vb.width * scale) / 2 - vb.x * scale;
    const oy = rect.top + (rect.height - vb.height * scale) / 2 - vb.y * scale;
    const map = (ux: number, uy: number) => ({ x: ox + ux * scale, y: oy + uy * scale });
    const a = map(Number(line.getAttribute('x1')), Number(line.getAttribute('y1')));
    const b = map(Number(line.getAttribute('x2')), Number(line.getAttribute('y2')));
    return { ax: a.x, ay: a.y, bx: b.x, by: b.y };
  }, entityId);
}

/** Client-px arc start parsed from the live rendered arc path `M`. */
async function renderedArcStartClient(page: Page, entityId: string): Promise<{ x: number; y: number }> {
  await page.locator(`[data-cad-viewport] svg path[data-survey-cad-render-entity-id="${entityId}"]`).first().waitFor({ state: 'attached', timeout: 10000 });
  return page.evaluate((id: string) => {
    const path = document.querySelector(
      `path[data-survey-cad-render-entity-id="${id}"], path[data-survey-cad-entity-id="${id}"]`,
    ) as SVGPathElement | null;
    if (!path) throw new Error(`no rendered arc for ${id}`);
    const pt = path.getPointAtLength(0);
    const svg = (path.ownerSVGElement ?? path.closest('svg')) as SVGSVGElement | null;
    if (!svg) throw new Error('no owner svg');
    const vb = svg.viewBox.baseVal;
    const rect = svg.getBoundingClientRect();
    const scale = Math.min(rect.width / vb.width, rect.height / vb.height);
    const ox = rect.left + (rect.width - vb.width * scale) / 2 - vb.x * scale;
    const oy = rect.top + (rect.height - vb.height * scale) / 2 - vb.y * scale;
    return { x: ox + pt.x * scale, y: oy + pt.y * scale };
  }, entityId);
}

function midpoint(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Client point 90px above the rendered line midpoint (clear of the line and the bottom command dock). */
async function renderedLineOffsetClient(page: Page, lineId: string): Promise<{ x: number; y: number }> {
  const line = await renderedLineClient(page, lineId);
  const mid = midpoint({ x: line.ax, y: line.ay }, { x: line.bx, y: line.by });
  return { x: mid.x, y: mid.y - 90 };
}

/**
 * Map a world point to client pixels by two-point affine calibration against a
 * rendered line with known world endpoints (uniform scale + y-flip). Refit-proof:
 * each call re-reads the live line, so the mapping follows the current view.
 */
async function worldToClientViaLine(
  page: Page,
  lineId: string,
  fromWorld: { x: number; y: number },
  toWorld: { x: number; y: number },
  world: { x: number; y: number },
): Promise<{ x: number; y: number }> {
  const line = await renderedLineClient(page, lineId);
  const userLen = Math.hypot(line.bx - line.ax, line.by - line.ay);
  const worldLen = Math.hypot(toWorld.x - fromWorld.x, toWorld.y - fromWorld.y);
  if (!(userLen > 0) || !(worldLen > 0)) throw new Error('degenerate calibration');
  const s = userLen / worldLen;
  const ax = line.ax - s * fromWorld.x;
  const ay = line.ay + s * fromWorld.y;
  return { x: ax + s * world.x, y: ay - s * world.y };
}

// ---------------------------------------------------------------------------
// Drawing / annotation commands
// ---------------------------------------------------------------------------

async function drawLine(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await homeTab(page);
  await page.locator('[data-cad-command="LINE"]').click();
  await canvasClick(page, from[0], from[1]);
  await canvasClick(page, to[0], to[1]);
  await finishCommand(page);
}

async function createLeaderAt(page: Page, target: { x: number; y: number }, text: string): Promise<void> {
  await snapClick(page, target.x, target.y);
  const input = page.locator('[data-cad-command-input]');
  await input.fill(text);
  await input.press('Enter');
  await finishCommand(page);
}

async function moveSelection(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await homeTab(page);
  await page.locator('[data-cad-command="MOVE"]').click();
  await canvasClick(page, from[0], from[1]);
  await canvasClick(page, to[0], to[1]);
  await finishCommand(page);
}

/** Select one entity through the Prospector entity tree (select-all first). */
async function selectViaProspector(page: Page, titlePrefix: string): Promise<void> {
  await homeTab(page);
  await page.locator('[data-cad-command="SHELL_SELECT_ALL"]').click();
  await expect.poll(() => selectionCount(page)).toBeGreaterThan(0);
  await collapseFloatingPanel(page);
  await page.locator('[data-cad-toolspace] [role="tab"]', { hasText: 'Prospector' }).click();
  const row = page.locator(`[data-cad-toolspace] button[title^="${titlePrefix}"]`).first();
  await expect(row).toBeVisible({ timeout: 10000 });
  await row.click();
  await expect.poll(() => selectionCount(page)).toBe(1);
}

/** Toggle an OSNAP preference through the Snaps menu (production UI). */
async function setSnapPreference(page: Page, kind: string, enabled: boolean): Promise<void> {
  const menuButton = page.locator('[data-survey-cad-snap-menu-button]');
  await menuButton.click();
  await page.waitForTimeout(120);
  await page.locator(`[data-survey-cad-snap-toggle="${kind}"]`).evaluate((element, on) => {
    const input = element as HTMLInputElement;
    if (input.checked !== on) input.click();
  }, enabled);
  await menuButton.click();
  await page.waitForTimeout(120);
}

// ---------------------------------------------------------------------------
// WNCAD persistence
// ---------------------------------------------------------------------------

interface SavedDrawing {
  dir: string;
  filePath: string;
  json: any;
}

async function saveAndParse(page: Page, tag: string): Promise<SavedDrawing> {
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await page.getByRole('button', { name: 'Save Drawing' }).first().click();
  const download = await downloadPromise;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `wn-18p-${tag}-`));
  const filePath = path.join(dir, 'drawing.wncad');
  await download.saveAs(filePath);
  const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return { dir, filePath, json };
}

function entitiesOf(saved: SavedDrawing, type: string): any[] {
  const entities: Array<{ type: string }> = saved.json?.project?.entities ?? saved.json?.entities ?? [];
  return entities.filter((entity) => entity?.type === type);
}

async function reopenDrawing(page: Page, filePath: string, expectedCount: number): Promise<void> {
  const fileInput = page.locator('[data-survey-cad-open-drawing-input]');
  await fileInput.evaluate((element: HTMLInputElement) => element.classList.remove('hidden')).catch(() => {});
  await fileInput.setInputFiles(filePath);
  await expect.poll(() => entityCount(page), { timeout: 30000 }).toBe(expectedCount);
}

/** Persisted entity id for the sole entity of a type. */
function soleId(saved: SavedDrawing, type: string): string {
  const list = entitiesOf(saved, type);
  expect(list.length).toBe(1);
  return list[0].id as string;
}

// ---------------------------------------------------------------------------
// Refit-proof single-pass measurements (transform cancels within one evaluate)
// ---------------------------------------------------------------------------

/** Client-px distance between a leader's shaft start and the source marker. */
async function shaftToMarkerDistance(page: Page, leaderId: string, markerId: string): Promise<number> {
  return page.evaluate(([lid, mid]: [string, string]) => {
    const line = document.querySelector(`line[data-survey-cad-render-entity-id="${lid}"]`) as SVGLineElement | null;
    if (!line) throw new Error(`no rendered shaft for ${lid}`);
    const svg = (line.ownerSVGElement ?? line.closest('svg')) as SVGSVGElement;
    const vb = svg.viewBox.baseVal;
    const rect = svg.getBoundingClientRect();
    const scale = Math.min(rect.width / vb.width, rect.height / vb.height);
    const ox = rect.left + (rect.width - vb.width * scale) / 2 - vb.x * scale;
    const oy = rect.top + (rect.height - vb.height * scale) / 2 - vb.y * scale;
    const sx = ox + Number(line.getAttribute('x1')) * scale;
    const sy = oy + Number(line.getAttribute('y1')) * scale;
    const els = [...document.querySelectorAll(`[data-survey-cad-render-entity-id="${mid}"]`)];
    if (els.length === 0) throw new Error(`nothing rendered for ${mid}`);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const el of els) {
      const r = (el as SVGGraphicsElement).getBoundingClientRect();
      x0 = Math.min(x0, r.x);
      y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.width);
      y1 = Math.max(y1, r.y + r.height);
    }
    return Math.hypot(sx - (x0 + x1) / 2, sy - (y0 + y1) / 2);
  }, [leaderId, markerId] as [string, string]);
}

/** Client-px distance between a leader's shaft start and a line's midpoint. */
async function shaftToLineMidDistance(page: Page, leaderId: string, lineId: string): Promise<number> {
  return page.evaluate(([lid, eid]: [string, string]) => {
    const shaft = document.querySelector(`line[data-survey-cad-render-entity-id="${lid}"]`) as SVGLineElement | null;
    const edge = document.querySelector(
      `line[data-survey-cad-render-entity-id="${eid}"], line[data-survey-cad-entity-id="${eid}"]`,
    ) as SVGLineElement | null;
    if (!shaft || !edge) throw new Error('missing shaft or edge');
    const svg = (shaft.ownerSVGElement ?? shaft.closest('svg')) as SVGSVGElement;
    const vb = svg.viewBox.baseVal;
    const rect = svg.getBoundingClientRect();
    const scale = Math.min(rect.width / vb.width, rect.height / vb.height);
    const ox = rect.left + (rect.width - vb.width * scale) / 2 - vb.x * scale;
    const oy = rect.top + (rect.height - vb.height * scale) / 2 - vb.y * scale;
    const sx = ox + Number(shaft.getAttribute('x1')) * scale;
    const sy = oy + Number(shaft.getAttribute('y1')) * scale;
    const ex = ox + ((Number(edge.getAttribute('x1')) + Number(edge.getAttribute('x2'))) / 2) * scale;
    const ey = oy + ((Number(edge.getAttribute('y1')) + Number(edge.getAttribute('y2'))) / 2) * scale;
    return Math.hypot(sx - ex, sy - ey);
  }, [leaderId, lineId] as [string, string]);
}

/** Client-px distance between a leader's shaft start and a block insertion grip. */
async function shaftToGripDistance(page: Page, leaderId: string): Promise<number> {
  return page.evaluate((lid: string) => {
    const line = document.querySelector(`line[data-survey-cad-render-entity-id="${lid}"]`) as SVGLineElement | null;
    if (!line) throw new Error(`no rendered shaft for ${lid}`);
    const svg = (line.ownerSVGElement ?? line.closest('svg')) as SVGSVGElement;
    const vb = svg.viewBox.baseVal;
    const rect = svg.getBoundingClientRect();
    const scale = Math.min(rect.width / vb.width, rect.height / vb.height);
    const ox = rect.left + (rect.width - vb.width * scale) / 2 - vb.x * scale;
    const oy = rect.top + (rect.height - vb.height * scale) / 2 - vb.y * scale;
    const sx = ox + Number(line.getAttribute('x1')) * scale;
    const sy = oy + Number(line.getAttribute('y1')) * scale;
    const grip = document.querySelector('[data-survey-cad-grip-handle="insertion"]');
    if (!grip) return Number.POSITIVE_INFINITY;
    const gripRect = (grip as SVGGraphicsElement).getBoundingClientRect();
    return Math.hypot(sx - (gripRect.x + gripRect.width / 2), sy - (gripRect.y + gripRect.height / 2));
  }, leaderId);
}

function parseNumber(text: string): number {
  const match = text.match(/-?[\d,]*\.?\d+(?:[eE][-+]?\d+)?/);
  if (!match) throw new Error(`no number in ${JSON.stringify(text)}`);
  return Number.parseFloat(match[0].replace(/,/g, ''));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Phase 18P associative annotation (production commands)', () => {
  test('A. leader snaps to survey point, arrow follows MOVE', async ({ page }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    await gotoCad(page, errors);
    if (!(await annotationCommandsReady(page))) {
      test.skip(true, 'Annotation workspace wiring unavailable.');
    }

    await homeTab(page);
    await page.locator('[data-cad-command="POINT"]').click();
    await canvasClick(page, 0.5, 0.45);
    // POINT creates the survey point plus its label entity.
    await expect.poll(() => entityCount(page)).toBe(2);

    const pointy = await saveAndParse(page, 'a-point');
    const points = entitiesOf(pointy, 'survey-point');
    expect(points).toHaveLength(1);
    const pointId = points[0].id as string;
    const pointBefore = { x: points[0].x as number, y: points[0].y as number };
    fs.rmSync(pointy.dir, { recursive: true, force: true });

    await annotateTab(page);
    await startAnnotationCommand(page, 'LEADER');
    // Re-read the live marker center after the tab switch (ribbon height shifts
    // the viewport) and after arming the session.
    const marker = await renderedMarkerCenter(page, pointId);
    await createLeaderAt(page, marker, 'NOTE A');
    await expect.poll(() => entityCount(page)).toBe(3);

    // Persisted anchor OBJECT must be a survey-point ref, not fixed.
    const saved = await saveAndParse(page, 'a');
    const leaders = entitiesOf(saved, 'leader');
    expect(leaders).toHaveLength(1);
    expect(leaders[0].arrowAnchor?.kind).toBe('survey-point');
    expect(leaders[0].arrowAnchor?.entityId).toBe(pointId);
    const leaderId = leaders[0].id as string;
    await expect.poll(() => shaftToMarkerDistance(page, leaderId, pointId)).toBeLessThan(4);

    // MOVE the source point through the production command; the persisted
    // point world moved and the shaft still starts exactly on the marker.
    await showProperties(page);
    await collapseFloatingPanel(page);
    await page.locator('[data-cad-toolspace] [role="tab"]', { hasText: 'Survey' }).click();
    const summary = page.locator('[data-cad-toolspace] summary', { hasText: 'Point table' });
    if (await summary.isVisible().catch(() => false)) await summary.click();
    await page.locator('[data-cad-point-table] tbody tr').first().click();
    await expect.poll(() => selectionCount(page)).toBe(1);
    await moveSelection(page, [0.4, 0.4], [0.65, 0.6]);

    const moved = await saveAndParse(page, 'a-moved');
    const movedPoints = entitiesOf(moved, 'survey-point');
    expect(movedPoints).toHaveLength(1);
    expect(Math.hypot(movedPoints[0].x - pointBefore.x, movedPoints[0].y - pointBefore.y)).toBeGreaterThan(0.01);
    fs.rmSync(moved.dir, { recursive: true, force: true });
    await expect.poll(() => shaftToMarkerDistance(page, leaderId, pointId)).toBeLessThan(4);

    fs.rmSync(saved.dir, { recursive: true, force: true });
    expect(errors).toEqual([]);
  });

  test('B. aligned dimension snaps to two line endpoints, length edit re-measures', async ({ page }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    await gotoCad(page, errors);
    if (!(await annotationCommandsReady(page))) {
      test.skip(true, 'Annotation workspace wiring unavailable.');
    }

    // Diagonal line: the refit keeps it centred (a zero-height bbox pins a
    // horizontal line to the viewport bottom, under the command dock).
    await drawLine(page, [0.25, 0.3], [0.55, 0.45]);
    await expect.poll(() => entityCount(page)).toBe(1);

    const srcB = await saveAndParse(page, 'b-src');
    const lineId = soleId(srcB, 'line');
    fs.rmSync(srcB.dir, { recursive: true, force: true });

    await annotateTab(page);
    await startAnnotationCommand(page, 'DIMALIGNED');
    const endA = await renderedLineClient(page, lineId);
    await snapClick(page, endA.ax, endA.ay);
    const endB = await renderedLineClient(page, lineId);
    await snapClick(page, endB.bx, endB.by);
    const dimPoint = await renderedLineOffsetClient(page, lineId);
    await page.mouse.click(dimPoint.x, dimPoint.y);
    await finishCommand(page);
    await expect.poll(() => entityCount(page)).toBe(2);

    const saved = await saveAndParse(page, 'b');
    const dims = entitiesOf(saved, 'dimension');
    expect(dims).toHaveLength(1);
    expect(dims[0].dimensionKind).toBe('aligned');
    expect(dims[0].anchors).toHaveLength(2);
    expect(dims[0].anchors[0]).toMatchObject({ kind: 'line-endpoint', endpoint: 'start' });
    expect(dims[0].anchors[1]).toMatchObject({ kind: 'line-endpoint', endpoint: 'end' });
    expect(dims[0].anchors[1].entityId).toBe(dims[0].anchors[0].entityId);

    // Edit the source line Length through Properties (select via Prospector).
    await showProperties(page);
    await selectViaProspector(page, 'line —');
    const lengthInput = page.locator('[data-cad-properties] input[aria-label="Length"]');
    const lengthBefore = parseNumber(await lengthInput.inputValue());
    await lengthInput.fill(String(lengthBefore + 10));
    await lengthInput.press('Enter');

    await selectViaProspector(page, 'dimension —');
    const measuredAfter = parseNumber(
      (await page.locator('[data-cad-dimension-measured] dd').textContent()) ?? '',
    );
    await selectViaProspector(page, 'line —');
    const lengthAfter = parseNumber(await page.locator('[data-cad-properties] input[aria-label="Length"]').inputValue());
    expect(lengthAfter - lengthBefore).toBeCloseTo(10, 1);
    expect(measuredAfter).toBeCloseTo(lengthAfter, 1);

    fs.rmSync(saved.dir, { recursive: true, force: true });
    expect(errors).toEqual([]);
  });

  test('C. radius dimension snaps to arc, radius edit re-measures', async ({ page }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    await gotoCad(page, errors);
    if (!(await annotationCommandsReady(page))) {
      test.skip(true, 'Annotation workspace wiring unavailable.');
    }

    await homeTab(page);
    await page.locator('[data-cad-command="ARC_3PT"]').click();
    await canvasClick(page, 0.3, 0.5);
    await canvasClick(page, 0.5, 0.4);
    await canvasClick(page, 0.7, 0.5);
    await finishCommand(page);
    // ARC_3PT also emits its BC/MP/EC/R curve points and labels.
    await expect.poll(() => entityCount(page)).toBeGreaterThan(1);

    const srcC = await saveAndParse(page, 'c-src');
    const arcId = soleId(srcC, 'arc');
    fs.rmSync(srcC.dir, { recursive: true, force: true });

    // The arc endpoints carry survey-point markers; OSNAP 'nearest' overrides
    // the arc endpoint when both distances are ~0, so narrow to endpoint.
    await setSnapPreference(page, 'nearest', false);
    await annotateTab(page);
    await startAnnotationCommand(page, 'DIMRADIUS');
    const arcStart = await renderedArcStartClient(page, arcId);
    await snapClick(page, arcStart.x, arcStart.y);
    await canvasClick(page, 0.5, 0.62);
    await finishCommand(page);
    await setSnapPreference(page, 'nearest', true);
    await expect.poll(() => entityCount(page)).toBeGreaterThan(1);

    const saved = await saveAndParse(page, 'c');
    const dims = entitiesOf(saved, 'dimension');
    expect(dims).toHaveLength(1);
    expect(dims[0].dimensionKind).toBe('radius');
    expect(dims[0].anchors).toHaveLength(1);
    expect(dims[0].anchors[0].kind).toBe('arc-point');
    expect(dims[0].anchors[0].entityId).toBe(arcId);

    // Measured resolves before the edit.
    await showProperties(page);
    await selectViaProspector(page, 'dimension —');
    const measuredBefore = parseNumber(
      (await page.locator('[data-cad-dimension-measured] dd').textContent()) ?? '',
    );
    expect(measuredBefore).toBeGreaterThan(0);

    // Edit Radius on the source arc; Measured tracks +5.
    await selectViaProspector(page, 'arc —');
    const radiusInput = page.locator('[data-cad-properties] input[aria-label="Radius"]');
    const radiusBefore = parseNumber(await radiusInput.inputValue());
    expect(measuredBefore).toBeCloseTo(radiusBefore, 1);
    await radiusInput.fill(String(radiusBefore + 5));
    await radiusInput.press('Enter');

    await selectViaProspector(page, 'dimension —');
    const measuredAfter = parseNumber(
      (await page.locator('[data-cad-dimension-measured] dd').textContent()) ?? '',
    );
    expect(measuredAfter - measuredBefore).toBeCloseTo(5, 1);

    fs.rmSync(saved.dir, { recursive: true, force: true });
    expect(errors).toEqual([]);
  });

  test('D. block-insertion leader follows a block insertion move', async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    await gotoCad(page, errors);
    if (!(await annotationCommandsReady(page))) {
      test.skip(true, 'Annotation workspace wiring unavailable.');
    }

    // Long diagonal linework: the min-corner base point lands off the line,
    // so the insertion pick carries no child segment scope.
    await drawLine(page, [0.2, 0.42], [0.5, 0.28]);
    await expect.poll(() => entityCount(page)).toBe(1);
    const srcD = await saveAndParse(page, 'd-src');
    const srcLine = entitiesOf(srcD, 'line')[0];
    const lineId = srcLine.id as string;
    const lineWorld = {
      from: { x: srcLine.fromX as number, y: srcLine.fromY as number },
      to: { x: srcLine.toX as number, y: srcLine.toY as number },
    };
    fs.rmSync(srcD.dir, { recursive: true, force: true });
    await homeTab(page);
    await page.locator('[data-cad-command="SHELL_SELECT_ALL"]').click();
    await expect.poll(() => selectionCount(page)).toBe(1);
    const input = page.locator('[data-cad-command-input]');
    await input.fill('B');
    await input.press('Enter');
    const manager = page.locator('[data-cad-block-manager]');
    await expect(manager).toBeVisible({ timeout: 10000 });
    await manager.locator('input[aria-label="New block name"]').fill('QA-18P');
    await manager.getByRole('button', { name: 'New from selection' }).click();
    await expect(manager.locator('[data-cad-block-table] tbody tr')).toHaveCount(5);
    await manager.locator('button[aria-label="Close Block Manager"]').click();
    await expect(manager).toBeHidden({ timeout: 10000 });

    await homeTab(page);
    await page.locator('[data-cad-blocks="manager"]').click();
    await expect(manager).toBeVisible({ timeout: 10000 });
    await manager.getByRole('tab', { name: 'Insert' }).click();
    await manager.getByRole('button', { name: 'Pick point' }).click();
    await expect(manager).toBeHidden({ timeout: 10000 });
    await canvasClick(page, 0.55, 0.5);
    await expect.poll(() => entityCount(page)).toBe(2);

    const inserted = await saveAndParse(page, 'd-inserted');
    const refs = entitiesOf(inserted, 'block-reference');
    expect(refs).toHaveLength(1);
    const refId = refs[0].id as string;
    const refBefore = { x: refs[0].x as number, y: refs[0].y as number };
    fs.rmSync(inserted.dir, { recursive: true, force: true });

    // Arm LEADER (arming clears the selection, so no grip overlaps the pick),
    // then map the persisted insertion world point onto the live view and
    // click it so the insertion OSNAP arms.
    await annotateTab(page);
    await startAnnotationCommand(page, 'LEADER');
    const insertionClient = await worldToClientViaLine(
      page,
      lineId,
      lineWorld.from,
      lineWorld.to,
      { x: refBefore.x, y: refBefore.y },
    );
    // A few px off the exact min-corner keeps the insertion endpoint OSNAP
    // unrivalled by the coincident child-line 'nearest' snap.
    await createLeaderAt(page, { x: insertionClient.x, y: insertionClient.y - 10 }, 'NOTE D');
    await expect.poll(() => entityCount(page)).toBe(3);

    const saved = await saveAndParse(page, 'd');
    const leaders = entitiesOf(saved, 'leader');
    expect(leaders).toHaveLength(1);
    expect(leaders[0].arrowAnchor?.kind).toBe('block-insertion');
    expect(leaders[0].arrowAnchor?.entityId).toBe(refId);
    const leaderId = leaders[0].id as string;

    // The block is still selected after the leader commit; prove the shaft
    // starts on the insertion grip, then move the block by editing its
    // Insertion fields (the MOVE command re-inserts block references, so the
    // Properties edit is the deterministic production path here) and re-prove.
    await selectViaProspector(page, 'block-reference —');
    await expect.poll(() => shaftToGripDistance(page, leaderId)).toBeLessThan(6);

    const insertionInput = page.locator('[data-cad-properties] input[aria-label="Insertion E"]');
    const insertionBefore = parseNumber(await insertionInput.inputValue());
    await insertionInput.fill(String(insertionBefore + 8));
    await insertionInput.press('Enter');

    const moved = await saveAndParse(page, 'd-moved');
    const movedRefs = entitiesOf(moved, 'block-reference');
    expect(movedRefs).toHaveLength(1);
    expect(Math.abs((movedRefs[0].x as number) - refBefore.x)).toBeCloseTo(8, 1);
    fs.rmSync(moved.dir, { recursive: true, force: true });
    await expect.poll(() => shaftToGripDistance(page, leaderId)).toBeLessThan(6);

    fs.rmSync(saved.dir, { recursive: true, force: true });
    expect(errors).toEqual([]);
  });

  test('E. free pick leader stays fixed', async ({ page }) => {
    const errors: string[] = [];
    await gotoCad(page, errors);
    if (!(await annotationCommandsReady(page))) {
      test.skip(true, 'Annotation workspace wiring unavailable.');
    }

    await annotateTab(page);
    await startAnnotationCommand(page, 'LEADER');
    await createLeaderAt(page, { x: 900, y: 260 }, 'NOTE E');
    await expect.poll(() => entityCount(page)).toBe(1);

    const saved = await saveAndParse(page, 'e');
    const leaders = entitiesOf(saved, 'leader');
    expect(leaders).toHaveLength(1);
    expect(leaders[0].arrowAnchor?.kind).toBe('fixed');
    expect(leaders[0].arrowAnchor?.x).toEqual(expect.any(Number));
    expect(leaders[0].arrowAnchor?.y).toEqual(expect.any(Number));
    expect(leaders[0].vertices[0]).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });

    fs.rmSync(saved.dir, { recursive: true, force: true });
    expect(errors).toEqual([]);
  });

  test('F. midpoint snap stays fixed, source MOVE does not move it', async ({ page }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    await gotoCad(page, errors);
    if (!(await annotationCommandsReady(page))) {
      test.skip(true, 'Annotation workspace wiring unavailable.');
    }

    await drawLine(page, [0.25, 0.35], [0.55, 0.5]);
    await expect.poll(() => entityCount(page)).toBe(1);

    const srcF = await saveAndParse(page, 'f-src');
    const lineId = soleId(srcF, 'line');
    fs.rmSync(srcF.dir, { recursive: true, force: true });

    await annotateTab(page);
    await startAnnotationCommand(page, 'LEADER');
    const line = await renderedLineClient(page, lineId);
    const mid = midpoint({ x: line.ax, y: line.ay }, { x: line.bx, y: line.by });
    await createLeaderAt(page, mid, 'NOTE F');
    await expect.poll(() => entityCount(page)).toBe(2);

    // Midpoint/nearest snaps never bind: the persisted anchor stays fixed.
    const saved = await saveAndParse(page, 'f');
    const leaders = entitiesOf(saved, 'leader');
    expect(leaders).toHaveLength(1);
    expect(leaders[0].arrowAnchor?.kind).toBe('fixed');
    const leaderId = leaders[0].id as string;
    await expect.poll(() => shaftToLineMidDistance(page, leaderId, lineId)).toBeLessThan(4);

    // MOVE the source line; the fixed leader must NOT follow the midpoint.
    await showProperties(page);
    await selectViaProspector(page, 'line —');
    await moveSelection(page, [0.5, 0.5], [0.6, 0.6]);
    await expect.poll(() => shaftToLineMidDistance(page, leaderId, lineId)).toBeGreaterThan(30);

    fs.rmSync(saved.dir, { recursive: true, force: true });
    expect(errors).toEqual([]);
  });

  test('G. broken ref flow: erase, undo, redo, save/reopen', async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    await gotoCad(page, errors);
    if (!(await annotationCommandsReady(page))) {
      test.skip(true, 'Annotation workspace wiring unavailable.');
    }

    await drawLine(page, [0.3, 0.4], [0.6, 0.5]);
    await expect.poll(() => entityCount(page)).toBe(1);
    const srcG = await saveAndParse(page, 'g-src');
    const lineId = soleId(srcG, 'line');
    fs.rmSync(srcG.dir, { recursive: true, force: true });

    await annotateTab(page);
    await startAnnotationCommand(page, 'LEADER');
    const line = await renderedLineClient(page, lineId);
    await createLeaderAt(page, { x: line.ax, y: line.ay }, 'NOTE G');
    await expect.poll(() => entityCount(page)).toBe(2);

    const saved = await saveAndParse(page, 'g');
    const leaders = entitiesOf(saved, 'leader');
    expect(leaders).toHaveLength(1);
    expect(leaders[0].arrowAnchor?.kind).toBe('line-endpoint');
    const leaderId = leaders[0].id as string;
    fs.rmSync(saved.dir, { recursive: true, force: true });

    // Attached before the delete.
    await showProperties(page);
    await selectViaProspector(page, 'leader —');
    await expect(page.locator('[data-cad-leader-target-status="attached"]')).toBeVisible();

    // Delete the source line through the production Erase action.
    await selectViaProspector(page, 'line —');
    await homeTab(page);
    await page.locator('[data-cad-command="SHELL_ERASE"]').click();
    await expect.poll(() => entityCount(page)).toBe(1);

    // BROKEN is visible in the viewport and Properties names the missing source.
    await expect(page.locator('[data-cad-viewport] svg').getByText('BROKEN')).toBeVisible({ timeout: 10000 });
    await selectViaProspector(page, 'leader —');
    await expect(page.locator('[data-cad-leader-target-status="broken"]')).toBeVisible();

    // Undo restores CURRENT: source back, no BROKEN marker.
    await homeTab(page);
    await page.locator('[data-cad-command="SHELL_UNDO"]').click();
    await expect.poll(() => entityCount(page)).toBe(2);
    await expect(page.locator('[data-cad-viewport] svg').getByText('BROKEN')).toBeHidden({ timeout: 10000 });

    // Redo breaks again.
    await page.locator('[data-cad-command="SHELL_REDO"]').click();
    await expect.poll(() => entityCount(page)).toBe(1);
    await expect(page.locator('[data-cad-viewport] svg').getByText('BROKEN')).toBeVisible({ timeout: 10000 });

    // Save/reopen preserves the broken reference.
    const broken = await saveAndParse(page, 'g-broken');
    const brokenLeaders = entitiesOf(broken, 'leader');
    expect(brokenLeaders).toHaveLength(1);
    expect(brokenLeaders[0].arrowAnchor?.kind).toBe('line-endpoint');
    await reopenDrawing(page, broken.filePath, 1);
    await showProperties(page);
    await selectViaProspector(page, 'leader —');
    await expect(page.locator('[data-cad-leader-target-status="broken"]')).toBeVisible();
    await expect(page.locator('[data-cad-viewport] svg').getByText('BROKEN')).toBeVisible({ timeout: 10000 });
    expect(leaderId.length).toBeGreaterThan(0);

    fs.rmSync(broken.dir, { recursive: true, force: true });
    expect(errors).toEqual([]);
  });
});

/** Union bbox center (client px) of every rendered shape for an entity. */
async function renderedMarkerCenter(page: Page, entityId: string): Promise<{ x: number; y: number }> {
  await page.locator(`[data-cad-viewport] svg [data-survey-cad-render-entity-id="${entityId}"]`).first().waitFor({ state: 'attached', timeout: 10000 });
  return page.evaluate((id: string) => {
    const els = [...document.querySelectorAll(`[data-survey-cad-render-entity-id="${id}"]`)];
    if (els.length === 0) throw new Error(`nothing rendered for ${id}`);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const el of els) {
      const rect = (el as SVGGraphicsElement).getBoundingClientRect();
      x0 = Math.min(x0, rect.x);
      y0 = Math.min(y0, rect.y);
      x1 = Math.max(x1, rect.x + rect.width);
      y1 = Math.max(y1, rect.y + rect.height);
    }
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  }, entityId);
}
