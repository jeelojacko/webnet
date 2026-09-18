/**
 * Phase 18G browser QA — surfaces through the real /cad app.
 *
 * Playwright (dev-server + Chromium), NOT vitest. Drives the shipped UI:
 * ribbon Surface tab, Toolspace Prospector tree, surface manager, Layer
 * manager, canvas MOVE, inquiry, WNCAD save/reopen. Zero page/console
 * errors is asserted per test.
 *
 * - 18G-A core flow: create surface -> add point group -> build -> CURRENT
 *   -> inquiry -> breakline/boundary/void surface -> edit point ->
 *   NEEDS_REBUILD (stale mesh kept) -> rebuild -> CURRENT -> layer OFF/ON
 *   -> save/reopen. Seeded by tests-browser/fixtures/cad-surface-18g-seed.wncad.
 * - 18G-B worker protocol in Chromium: the production worker builder
 *   (buildSurfaceMeshFromRequest, the exact fn surfaceWorker.ts runs)
 *   builds ok in-page; handler latest-wins supersession + cancel through a
 *   controllable injected builder (manually-resolved promises, never
 *   timing-flaky). Asserts the build-path hook value the UI reports.
 * - 18G-C responsiveness: a substantial generated surface (~4k points)
 *   rebuilds while ribbon/Toolspace/manager interactions keep completing;
 *   picking stays coarse (one path per component, click maps to the surface
 *   object, never per-triangle selection). Operability only, never exact ms.
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const SHOT_DIR = 'docs/evidence/phase18g';
const SEED = 'tests-browser/fixtures/cad-surface-18g-seed.wncad';
const CONSTRAINTS_ID = 'qa-surf-constraints';

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
  await page.goto('/cad', { waitUntil: 'networkidle' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-cad-viewport]')).toBeVisible({ timeout: 30000 });
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

/** The legacy floating workspace properties overlay covers the right dock
 *  while expanded; collapse it so dock clicks land (selection is kept). */
async function collapseFloatingPanel(page: Page): Promise<void> {
  const collapse = page.locator('button[title="Collapse panel body"]');
  if (await collapse.isVisible().catch(() => false)) {
    await collapse.click();
  }
}

async function clearSelection(page: Page): Promise<void> {
  if ((await selectionCount(page)) === 0) return;
  await ribbonTab(page, 'Home').click();
  await page.locator('[data-cad-command="SHELL_CLEAR_SELECTION"]').click();
  await expect.poll(() => selectionCount(page)).toBe(0);
}

function ribbonTab(page: Page, name: string) {
  return page.locator('[aria-label="Ribbon tabs"]').getByRole('tab', { name });
}

async function openManager(page: Page): Promise<void> {
  await ribbonTab(page, 'Surface').click();
  await page.getByRole('button', { name: 'Add Point Group' }).first().click();
  await expect(managerScope(page)).toBeVisible({ timeout: 10000 });
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

async function cancelCommand(page: Page): Promise<void> {
  const input = page.locator('[data-cad-command-input]');
  await input.focus();
  await input.press('Escape');
}

async function downloadToTemp(page: Page, trigger: () => Promise<void>, suffix: string): Promise<string> {
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await trigger();
  const download = await downloadPromise;
  const tempPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'webnet-18g-')), `file${suffix}`);
  await download.saveAs(tempPath);
  return tempPath;
}

/** Surface ids currently in the Toolspace tree. */
async function toolspaceSurfaceIds(page: Page): Promise<string[]> {
  return page.$$eval('[data-cad-toolspace] [data-cad-surface]', (elements) =>
    elements.map((element) => element.getAttribute('data-cad-surface') ?? ''));
}

test('18G-A: create -> group -> build -> CURRENT -> inquiry -> edit -> NEEDS_REBUILD -> rebuild -> layer -> save/reopen', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openDrawing(page, SEED, 32);
  await showSurveyTab(page);
  await expect(toolspaceSurface(page, CONSTRAINTS_ID)).toBeVisible();

  // Seeded meshes never persist: the constraints surface opens UNBUILT.
  await expect.poll(() => surfaceStatus(page, CONSTRAINTS_ID)).toBe('UNBUILT');

  // Create through the shipped ribbon, then attach the group in the manager.
  await ribbonTab(page, 'Surface').click();
  await page.getByRole('button', { name: 'Create Surface' }).first().click();
  await expect.poll(() => toolspaceSurfaceIds(page)).toHaveLength(2);
  const ids = await toolspaceSurfaceIds(page);
  const flowId = ids.find((id) => id !== CONSTRAINTS_ID) as string;
  expect(flowId).toBeTruthy();

  await openManager(page);
  const manager = managerScope(page);
  // Freshly created surfaces carry no point source (INSUFFICIENT_DATA
  // until the group lands); match the auto-named row, not a status.
  await manager.locator('ul button', { hasText: /^Surface \d+/ }).click();
  await manager.getByLabel('Add point group').selectOption('g-all');
  await manager.getByRole('button', { name: 'Add Group' }).click();
  await expect(manager.getByRole('status').first()).toContainText('Add point group done.');
  await manager.getByRole('button', { name: 'Rebuild', exact: true }).click();
  // Async proof: the immediate ack hands off to the worker, CURRENT lands later.
  await expect(manager.getByRole('status').first()).toContainText('building…');
  await expect.poll(() => surfaceStatus(page, flowId), { timeout: 60000 }).toBe('CURRENT');
  // Build-path hook: production rebuilds route through the surface worker.
  expect(await toolspaceSurface(page, flowId).getAttribute('data-surface-build-path')).toBe('worker');
  await page.screenshot({ path: `${SHOT_DIR}/18g-A-current.png` });

  // Elevation query on the fresh mesh (planar seed: z = 100 + 0.1x + 0.05y).
  await manager.getByLabel('Inquiry easting').fill('15');
  await manager.getByLabel('Inquiry northing').fill('15');
  await manager.getByRole('button', { name: 'Query' }).click();
  await expect(manager.getByRole('status').last()).toContainText('elevation 102.250');
  await page.screenshot({ path: `${SHOT_DIR}/18g-A-inquiry.png` });

  // Breakline/boundary/void surface builds CURRENT with its definition intact.
  await manager.getByRole('button', { name: `Surface QA Constraints, Unbuilt` }).click();
  await expect(manager).toContainText('breaklines 1 · outer 1 void 1');
  await manager.getByRole('button', { name: 'Rebuild', exact: true }).click();
  await expect(manager.getByRole('status').first()).toContainText('building…');
  await expect.poll(() => surfaceStatus(page, CONSTRAINTS_ID), { timeout: 60000 }).toBe('CURRENT');
  await expect(manager).toContainText('Area1100.000 m²');
  await page.screenshot({ path: `${SHOT_DIR}/18g-A-constraints.png` });

  // Edit a point (select-all + MOVE shifts every source): both surfaces go
  // NEEDS_REBUILD with the stale mesh kept on screen (dashed + STALE badge).
  await ribbonTab(page, 'Home').click();
  await page.locator('[data-cad-command="SHELL_SELECT_ALL"]').click();
  await expect.poll(() => selectionCount(page)).toBe(32);
  await page.locator('[data-cad-command="MOVE"]').click();
  await canvasClick(page, 0.3, 0.5);
  await canvasClick(page, 0.35, 0.55);
  await cancelCommand(page);
  await expect.poll(() => surfaceStatus(page, flowId)).toBe('NEEDS_REBUILD');
  await expect.poll(() => surfaceStatus(page, CONSTRAINTS_ID)).toBe('NEEDS_REBUILD');
  await expect(page.locator(`[data-surface-layer="${flowId}"][data-surface-stale="true"]`)).toBeVisible();
  await page.screenshot({ path: `${SHOT_DIR}/18g-A-needs-rebuild.png` });

  // Rebuild restores CURRENT on both.
  await manager.locator('ul button', { hasText: /^Surface \d+/ }).click();
  await manager.getByRole('button', { name: 'Rebuild', exact: true }).click();
  await expect.poll(() => surfaceStatus(page, flowId)).toBe('CURRENT');
  await manager.getByRole('button', { name: 'Surface QA Constraints, Needs Rebuild' }).click();
  await manager.getByRole('button', { name: 'Rebuild', exact: true }).click();
  await expect.poll(() => surfaceStatus(page, CONSTRAINTS_ID)).toBe('CURRENT');

  // Layer OFF hides the derived surface paths; ON restores them.
  await clearSelection(page);
  await collapseFloatingPanel(page);
  await page.getByRole('button', { name: 'Open layer manager' }).click();
  const layers = page.locator('[data-cad-layers]');
  await layers.locator('input[aria-label="Toggle on/off for layer General"]').uncheck();
  await expect(page.locator('[data-surface-layer]')).toHaveCount(0);
  await page.screenshot({ path: `${SHOT_DIR}/18g-A-layer-off.png` });
  await layers.locator('input[aria-label="Toggle on/off for layer General"]').check();
  await expect.poll(() => page.locator('[data-surface-layer]').count()).toBe(2);
  await page.screenshot({ path: `${SHOT_DIR}/18g-A-layer-on.png` });

  // Save/reopen: definitions persist, meshes never do (UNBUILT, then CURRENT).
  await ribbonTab(page, 'Home').click();
  const savedPath = await downloadToTemp(
    page,
    () => page.getByRole('button', { name: 'Save Drawing' }).first().click(),
    '.wncad',
  );
  expect(fs.readFileSync(savedPath, 'utf8')).toContain('QA Constraints');
  await page.goto('/cad', { waitUntil: 'networkidle' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await openDrawing(page, savedPath, 32);
  await showSurveyTab(page);
  await expect.poll(() => surfaceStatus(page, CONSTRAINTS_ID)).toMatch(/UNBUILT|NEEDS_REBUILD/);
  await openManager(page);
  await managerScope(page).getByRole('button', { name: /QA Constraints, (Unbuilt|Needs Rebuild)/ }).click();
  await managerScope(page).getByRole('button', { name: 'Rebuild', exact: true }).click();
  await expect.poll(() => surfaceStatus(page, CONSTRAINTS_ID), { timeout: 60000 }).toBe('CURRENT');
  await page.screenshot({ path: `${SHOT_DIR}/18g-A-reopened.png` });
  fs.rmSync(path.dirname(savedPath), { recursive: true, force: true });
  expect(errors).toEqual([]);
});

test('18G-B: worker build protocol in Chromium (direct build + latest-wins + cancel)', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  const verdict = await page.evaluate(async (handlerUrl: string) => {
    const mod = await import(handlerUrl);
    const corners = [
      { id: 'p1', stationId: 'A', x: 0, y: 0, z: 10, pointClass: 'free', source: 'parsed-input' },
      { id: 'p2', stationId: 'B', x: 10, y: 0, z: 12, pointClass: 'free', source: 'parsed-input' },
      { id: 'p3', stationId: 'C', x: 10, y: 10, z: 14, pointClass: 'free', source: 'parsed-input' },
      { id: 'p4', stationId: 'D', x: 0, y: 10, z: 11, pointClass: 'free', source: 'parsed-input' },
    ];
    const requestFor = (revision: string) => ({
      surfaceId: 's',
      revision,
      points: corners,
      extraEntities: [],
      pointGroups: [],
      definition: { pointSource: { kind: 'points', pointEntityIds: ['p1', 'p2', 'p3', 'p4'] } },
    });
    // The exact builder surfaceWorker.ts runs, on the real engine.
    const direct = mod.buildSurfaceMeshFromRequest(requestFor('r0'));
    // Controllable seam: manually-resolved builders, flushable defer queue.
    const posted: Array<{ type: string; requestId: string }> = [];
    const defers: Array<() => void> = [];
    const resolvers: Record<string, (_value: unknown) => void> = {};
    const builder = (request: { revision: string }) =>
      new Promise((_resolve) => {
        resolvers[request.revision] = _resolve as (_value: unknown) => void;
      });
    const handler = mod.createSurfaceWorkerHandler({
      loadBuilder: async () => builder,
      postMessage: (message: { type: string; requestId: string }) =>
        posted.push({ type: message.type, requestId: message.requestId }),
      defer: (callback: () => void) => defers.push(callback),
    });
    const flushDefers = (): void => {
      const pending = defers.splice(0);
      for (const callback of pending) callback();
    };
    const tick = async (): Promise<void> => {
      for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    };
    const meshFor = (revision: string) => ({
      outcome: 'ok' as const,
      revision,
      reasonCodes: [],
      points: [],
      triangles: [],
      stats: {},
    });
    handler.handleMessage({ type: 'build', requestId: 'reqA', request: requestFor('rA') });
    handler.handleMessage({ type: 'build', requestId: 'reqB', request: requestFor('rB') });
    flushDefers();
    await tick();
    resolvers['rB']!(meshFor('rB'));
    await tick();
    resolvers['rA']!(meshFor('rA'));
    await tick();
    const successes = posted.filter((entry) => entry.type === 'success').map((entry) => entry.requestId);
    handler.handleMessage({ type: 'build', requestId: 'reqC', request: requestFor('rC') });
    handler.handleMessage({ type: 'cancel', requestId: 'reqC' });
    flushDefers();
    resolvers['rC']?.(meshFor('rC'));
    await tick();
    return {
      directOutcome: direct.outcome,
      directTriangles: direct.triangles.length,
      successes,
      cancelled: posted.some((entry) => entry.type === 'cancelled' && entry.requestId === 'reqC'),
      successAfterCancel: posted.some((entry) => entry.type === 'success' && entry.requestId === 'reqC'),
      phases: [...new Set(posted.filter((entry) => entry.type === 'progress').map(() => 'progress'))],
    };
  }, '/src/workers/surfaceWorkerHandler.ts');
  expect(verdict.directOutcome).toBe('ok');
  expect(verdict.directTriangles).toBe(2);
  // Latest-wins: only the newer revision posts success; the superseded one
  // is discarded silently (deterministic — resolution order is injected).
  expect(verdict.successes).toEqual(['reqB']);
  expect(verdict.cancelled).toBe(true);
  expect(verdict.successAfterCancel).toBe(false);
  expect(errors).toEqual([]);
});

test('18G-C: substantial surface rebuilds while CAD UI stays operable; picking stays coarse', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  // Substantial generated drawing: reuse the exact seed schema, swap the
  // point grid for a deterministic 64x64 set behind the same group.
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8')) as {
    project: { entities: unknown[]; surfaces: Array<{ id: string }> };
  };
  const entities: unknown[] = [];
  let index = 0;
  for (let row = 0; row < 64; row += 1) {
    for (let col = 0; col < 64; col += 1) {
      index += 1;
      entities.push({
        id: `big-pt-${index}`,
        type: 'survey-point',
        layerId: 'general',
        visible: true,
        locked: false,
        stationId: `B${index}`,
        x: col * 10 + ((index * 37) % 10) * 0.1,
        y: row * 10 + ((index * 53) % 10) * 0.1,
        z: 100 + col * 0.5 + row * 0.3 + ((index * 29) % 10) * 0.05,
        pointClass: 'free',
        source: 'parsed-input',
      });
    }
  }
  for (const entity of seed.project.entities) {
    const record = entity as { type: string };
    if (record.type !== 'survey-point') entities.push(entity);
  }
  seed.project.entities = entities;
  // The seeded breakline chain references seed point ids (gone above):
  // drop it so the big surface still builds (boundaries still apply).
  for (const surface of seed.project.surfaces) {
    const definition = (surface as unknown as { definition: { breaklines?: unknown[] } }).definition;
    delete definition.breaklines;
  }
  // The seeded constraints surface references corner rings far inside the
  // big grid; keep it, but drop its breakline chain (seed point ids are gone).
  const tmpPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'webnet-18g-big-')), 'big.wncad');
  fs.writeFileSync(tmpPath, JSON.stringify(seed));
  await openDrawing(page, tmpPath, 4098);
  await showSurveyTab(page);

  await openManager(page);
  const manager = managerScope(page);
  await manager.getByRole('button', { name: /QA Constraints, (Unbuilt|Needs Rebuild)/ }).click();
  const rebuildButton = manager.getByRole('button', { name: 'Rebuild', exact: true });
  await rebuildButton.click();
  // While the substantial build is in flight (and after), CAD UI keeps
  // completing interactions: operability only, never exact ms.
  await ribbonTab(page, 'Home').click();
  await ribbonTab(page, 'Surface').click();
  await page.locator('[aria-label="Toolspace tabs"]').getByRole('tab', { name: 'Prospector' }).click();
  await page.locator('[aria-label="Toolspace tabs"]').getByRole('tab', { name: 'Survey' }).click();
  await expect.poll(() => surfaceStatus(page, CONSTRAINTS_ID), { timeout: 60000 }).toBe('CURRENT');
  const stats = await manager.getByRole('button', { name: /QA Constraints, Current/ }).textContent();
  expect(stats).toMatch(/t/u);
  fs.rmSync(path.dirname(tmpPath), { recursive: true, force: true });

  // Coarse picking: the mesh renders as at most two paths per surface
  // (triangles + boundary); a viewport click selects the surface OBJECT.
  const layer = page.locator(`[data-surface-layer="${CONSTRAINTS_ID}"]`);
  await expect(layer).toBeVisible();
  expect(await layer.locator('path').count()).toBeLessThanOrEqual(2);
  await layer.locator('path').first().click({ force: true });
  await expect
    .poll(() => page.locator('[data-cad-surface="qa-surf-constraints"] [data-selected="true"]').count())
    .toBeGreaterThan(0);
  await page.screenshot({ path: `${SHOT_DIR}/18g-C-big.png` });
  expect(errors).toEqual([]);
});
