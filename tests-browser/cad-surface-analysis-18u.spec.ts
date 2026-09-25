/**
 * Phase 18U browser QA — surface analysis bands + legends through the real /cad app.
 *
 * Playwright (dev-server + Chromium), NOT vitest. Drives the shipped UI:
 * ribbon Surface tab, Toolspace tree, surface manager analysis section,
 * range editor, inquiry, legend create, layer manager, Export Center
 * downloads, WNCAD save/reopen. Zero page/console errors per test.
 *
 * Drawing is generated in-test (48 points: base z=0 grid, flat +1
 * comparison grid, tilted comparison grid; three point-list surfaces).
 * Flows (mission §98 A–M):
 * - 18U-A: elevation create/Calculate/CURRENT/fills+colors (A), range edit
 *   NEEDS_RECALC (B), slope-percent CURRENT (C), inquiry (D), 3 viewports.
 * - 18U-B: depth CUT/FILL on a real volume (E), band Σ vs volume report (F),
 *   18T edit lifecycle (G), raise/lower slope invariance (H).
 * - 18U-C: legend place (I), layer OFF/FROZEN (J), save/reopen
 *   definitions-not-results (K).
 * - 18U-D: worker supersession smoke (L; deterministic pin lives in
 *   tests/cad_analysis_service_18u.test.ts), SVG/PDF include map+legend and
 *   DXF explicit boundaries (M).
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const SHOT_DIR = 'docs/evidence/phase18u';
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

/** Generated 18U drawing: base/flat/tilt point grids + three point-list surfaces. */
function makeAnalysisDrawing(): string {
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8')) as {
    project: {
      entities: unknown[];
      surfaces: unknown[];
      volumeSurfaces?: unknown[];
      volumeSurfaceStyles?: unknown[];
    };
    draft: { sheets: unknown[] };
  };
  const entities: unknown[] = [];
  const baseIds: string[] = [];
  const flatIds: string[] = [];
  const tiltIds: string[] = [];
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const x = col * 10;
      const y = row * 10;
      const base = { id: `u-pt-b${row}${col}`, type: 'survey-point', layerId: 'general', visible: true, locked: false, stationId: `UB${row}${col}`, x, y, z: 0, pointClass: 'free', source: 'parsed-input' };
      const flat = { ...base, id: `u-pt-f${row}${col}`, stationId: `UF${row}${col}`, z: 1 };
      const tilt = { ...base, id: `u-pt-t${row}${col}`, stationId: `UT${row}${col}`, z: (x - 15) / 15 };
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
    { id: 'u-surf-base', name: 'U-Base', definition: { pointSource: { kind: 'points', pointEntityIds: baseIds } }, cachedRevision: null },
    { id: 'u-surf-flat', name: 'U-Flat', definition: { pointSource: { kind: 'points', pointEntityIds: flatIds } }, cachedRevision: null },
    { id: 'u-surf-tilt', name: 'U-Tilt', definition: { pointSource: { kind: 'points', pointEntityIds: tiltIds } }, cachedRevision: null },
  ];
  delete seed.project.volumeSurfaces;
  delete seed.project.volumeSurfaceStyles;
  // Flow M needs a sheet: graft one plan sheet centered on the 0..30 grid
  // (the seed carries none; there is no in-app sheet-create on this path).
  seed.draft.sheets = [
    {
      id: 'u-sheet-plan',
      name: 'U-Plan',
      widthMm: 420,
      heightMm: 297,
      orientation: 'landscape',
      margins: { topMm: 10, bottomMm: 10, leftMm: 10, rightMm: 10 },
      viewports: [
        {
          id: 'u-viewport-plan',
          name: 'Plan viewport',
          modelCenterX: 15,
          modelCenterY: 15,
          scaleDenominator: 500,
          paperXmm: 15,
          paperYmm: 15,
          paperWidthMm: 350,
          paperHeightMm: 200,
        },
      ],
      sheetObjects: [],
    },
  ];
  const tmpPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'webnet-18u-')), 'analysis.wncad');
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

async function rebuildAll(page: Page): Promise<void> {
  await ribbonTab(page, 'Surface').click();
  await page.getByRole('button', { name: 'Rebuild All' }).click();
}

function surfaceStatus(page: Page, id: string) {
  return page.locator(`[data-cad-toolspace] [data-cad-surface="${id}"]`).getAttribute('data-cad-surface-status');
}

/** Select a surface in the manager list (drives analysis-create source selection). */
async function selectSurfaceInManager(page: Page, name: string): Promise<void> {
  await managerScope(page).locator(`button[aria-label^="Surface ${name},"]`).first().click();
}

async function analysisIds(page: Page): Promise<string[]> {
  return managerScope(page).locator('[data-cad-analysis-list] [data-cad-analysis]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-cad-analysis') ?? ''));
}

async function analysisStatus(page: Page, id: string): Promise<string> {
  return (await managerScope(page).locator(`[data-cad-analysis="${id}"]`).getAttribute('data-cad-analysis-status')) ?? '';
}

async function selectAnalysis(page: Page, id: string): Promise<void> {
  await managerScope(page).locator(`[data-cad-analysis="${id}"]`).click();
}

async function createAnalysis(page: Page, kind: 'elevation' | 'slope' | 'depth'): Promise<string> {
  const before = await analysisIds(page);
  const selector = kind === 'elevation' ? '[data-cad-analysis-new-elevation]' : kind === 'slope' ? '[data-cad-analysis-new-slope]' : '[data-cad-analysis-new-depth]';
  await managerScope(page).locator(selector).click();
  let ids = before;
  await expect.poll(async () => {
    ids = await analysisIds(page);
    return ids.length;
  }).toBe(before.length + 1);
  const created = ids.filter((id) => !before.includes(id));
  return created[created.length - 1] as string;
}

async function calculateAnalysis(page: Page): Promise<void> {
  await managerScope(page).locator('[data-cad-analysis-calculate]').click();
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
  const tempPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'webnet-18u-dl-')), `file${suffix}`);
  await download.saveAs(tempPath);
  return tempPath;
}

test('18U-A: elevation CURRENT + colors, range edit NEEDS_RECALC, slope, inquiry, 3 viewports', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  const drawingPath = makeAnalysisDrawing();
  await openDrawing(page, drawingPath, 50);
  await showSurveyTab(page);
  await openManager(page);
  await rebuildAll(page);
  for (const id of ['u-surf-base', 'u-surf-flat', 'u-surf-tilt']) {
    await expect.poll(() => surfaceStatus(page, id), { timeout: 60000 }).toBe('CURRENT');
  }

  // Flow A: elevation create -> Calculate -> CURRENT with fills + band colors.
  await selectSurfaceInManager(page, 'U-Base');
  const elevId = await createAnalysis(page, 'elevation');
  await selectAnalysis(page, elevId);
  await calculateAnalysis(page);
  await expect.poll(() => analysisStatus(page, elevId), { timeout: 60000 }).toBe('CURRENT');
  const fills = page.locator(`[data-analysis-layer="${elevId}"] [data-analysis-band]`);
  await expect.poll(() => fills.count()).toBeGreaterThan(0);
  const firstFill = await fills.first().getAttribute('fill');
  expect(firstFill).toMatch(/^#[0-9a-fA-F]{6}$/);
  await page.screenshot({ path: `${SHOT_DIR}/18u-A-elevation-current.png` });

  // Flow B: range edit narrows the first band (gap allowed) -> NEEDS_RECALC -> recalc CURRENT.
  await managerScope(page).locator('[data-cad-analysis-edit-ranges]').click();
  const editor = managerScope(page).locator('[data-cad-analysis-ranges]');
  await expect(editor).toBeVisible();
  await editor.locator('input[aria-label="Equal band count"]').fill('3');
  await editor.locator('[data-cad-analysis-generate]').click();
  await expect.poll(() => editor.locator('[data-cad-analysis-band-table] [data-cad-analysis-band]').count()).toBe(3);
  await managerScope(page).locator('[data-cad-analysis-apply]').click();
  await expect.poll(() => analysisStatus(page, elevId)).toBe('NEEDS_RECALC');
  await calculateAnalysis(page);
  await expect.poll(() => analysisStatus(page, elevId), { timeout: 60000 }).toBe('CURRENT');
  await page.screenshot({ path: `${SHOT_DIR}/18u-A-range-recalc.png` });

  // Flow C: slope-percent create -> Calculate -> CURRENT with fills.
  await selectSurfaceInManager(page, 'U-Base');
  const slopeId = await createAnalysis(page, 'slope');
  await selectAnalysis(page, slopeId);
  await calculateAnalysis(page);
  await expect.poll(() => analysisStatus(page, slopeId), { timeout: 60000 }).toBe('CURRENT');
  await expect.poll(() => page.locator(`[data-analysis-layer="${slopeId}"] [data-analysis-band]`).count()).toBeGreaterThan(0);

  // Flow D: inquiry at the grid center reports a band.
  await selectAnalysis(page, elevId);
  const inquiry = managerScope(page).locator(`[data-cad-analysis-inquiry="${elevId}"]`);
  await inquiry.getByLabel('Analysis inquiry easting').fill('15');
  await inquiry.getByLabel('Analysis inquiry northing').fill('15');
  await inquiry.getByRole('button', { name: 'Query', exact: true }).click();
  await expect(inquiry.locator('[data-cad-analysis-answer]')).toContainText('band');

  // Manual visual QA: same CURRENT scene at three resolutions.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: `${SHOT_DIR}/18u-A-viewport-1280.png` });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({ path: `${SHOT_DIR}/18u-A-viewport-1920.png` });
  await page.setViewportSize({ width: 1440, height: 900 });
  fs.rmSync(path.dirname(drawingPath), { recursive: true, force: true });
  expect(errors).toEqual([]);
});

test('18U-B: depth CUT/FILL + conservation vs 18I, 18T lifecycle, raise/lower invariance', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  const drawingPath = makeAnalysisDrawing();
  await openDrawing(page, drawingPath, 50);
  await showSurveyTab(page);
  await openManager(page);
  await rebuildAll(page);
  for (const id of ['u-surf-base', 'u-surf-flat']) {
    await expect.poll(() => surfaceStatus(page, id), { timeout: 60000 }).toBe('CURRENT');
  }
  const manager = managerScope(page);

  // 18I volume first (depth source): constant fill base vs flat.
  await manager.getByLabel('New volume name').fill('U-Fill');
  await manager.getByLabel('New volume base surface').selectOption({ label: 'U-Base' });
  await manager.getByLabel('New volume comparison surface').selectOption({ label: 'U-Flat' });
  await manager.getByRole('button', { name: 'Create Volume' }).click();
  await expect.poll(() => manager.locator('[data-volume-list] [data-cad-volume]').count()).toBe(1);
  await manager.getByRole('button', { name: /^Calculate|Recalculate$/ }).click();
  const volumeText = async (): Promise<string> =>
    (await manager.locator('[data-volume-quantities="current"]').textContent()) ?? '';
  await expect.poll(() => volumeText(), { timeout: 60000 }).toContain('900.000 m³');

  // Flow E: depth analysis on the volume -> CURRENT with CUT/FILL bands.
  await manager.locator('[data-volume-list] [data-cad-volume]').first().click();
  const depthId = await createAnalysis(page, 'depth');
  await selectAnalysis(page, depthId);
  await calculateAnalysis(page);
  await expect.poll(() => analysisStatus(page, depthId), { timeout: 60000 }).toBe('CURRENT');
  const depthDetail = manager.locator(`[data-cad-analysis-detail="${depthId}"]`);
  await expect(depthDetail).toContainText('Fill');

  // Flow F: depth band Σ reconciles with the 18I volume report.
  const numberAfter = (text: string, label: string): number => {
    const match = text.match(new RegExp(`${label}[\\s\\S]*?(\\d+\\.\\d+)`));
    return match ? Number.parseFloat(match[1]!) : Number.NaN;
  };
  const netCells = manager.locator(`[data-cad-analysis-bands="${depthId}"] [data-cad-analysis-band] td:last-child`);
  const netTexts = await netCells.allTextContents();
  const depthNet = netTexts.reduce((sum, text) => sum + (Number.parseFloat(text) || 0), 0);
  expect(depthNet).toBeCloseTo(numberAfter(await volumeText(), 'Net volume'), 0);
  await page.screenshot({ path: `${SHOT_DIR}/18u-B-depth-current.png` });

  // Flow H: raise/lower — slope band areas are identical after a pure Z shift.
  await selectSurfaceInManager(page, 'U-Base');
  const slopeId = await createAnalysis(page, 'slope');
  await selectAnalysis(page, slopeId);
  await calculateAnalysis(page);
  await expect.poll(() => analysisStatus(page, slopeId), { timeout: 60000 }).toBe('CURRENT');
  const slopeAreas = async (): Promise<string> =>
    (await manager.locator(`[data-cad-analysis-detail="${slopeId}"]`).textContent()) ?? '';
  const areasBefore = await slopeAreas();
  await ribbonTab(page, 'Home').click();
  await page.locator('[data-cad-command="SHELL_SELECT_ALL"]').click();
  await expect.poll(() => selectionCount(page)).toBe(50);
  await page.locator('[data-cad-command="MOVE"]').click();
  await canvasClick(page, 0.3, 0.5);
  await canvasClick(page, 0.35, 0.55);
  await cancelCommand(page);

  // Flow G: 18T lifecycle — source edit retires the analysis, rebuild + recalc restores it.
  await expect.poll(() => analysisStatus(page, slopeId)).not.toBe('CURRENT');
  await showSurveyTab(page);
  await rebuildAll(page);
  await expect.poll(() => surfaceStatus(page, 'u-surf-base'), { timeout: 60000 }).toBe('CURRENT');
  await expect.poll(() => analysisStatus(page, slopeId)).toBe('NEEDS_RECALC');
  await selectAnalysis(page, slopeId);
  await calculateAnalysis(page);
  await expect.poll(() => analysisStatus(page, slopeId), { timeout: 60000 }).toBe('CURRENT');
  expect(await slopeAreas()).toBe(areasBefore);
  await page.screenshot({ path: `${SHOT_DIR}/18u-B-raise-lower.png` });
  fs.rmSync(path.dirname(drawingPath), { recursive: true, force: true });
  expect(errors).toEqual([]);
});

test('18U-C: legend place, layer OFF/FROZEN, save/reopen definitions-not-results', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  const drawingPath = makeAnalysisDrawing();
  await openDrawing(page, drawingPath, 50);
  await showSurveyTab(page);
  await openManager(page);
  await rebuildAll(page);
  await expect.poll(() => surfaceStatus(page, 'u-surf-base'), { timeout: 60000 }).toBe('CURRENT');
  const manager = managerScope(page);

  await selectSurfaceInManager(page, 'U-Base');
  const elevId = await createAnalysis(page, 'elevation');
  await selectAnalysis(page, elevId);
  await calculateAnalysis(page);
  await expect.poll(() => analysisStatus(page, elevId), { timeout: 60000 }).toBe('CURRENT');

  // Flow I: legend place -> viewport title + swatches render.
  await manager.locator('[data-cad-analysis-legend-create] input[aria-label="New analysis legend title"]').fill('U-Legend');
  await manager.locator('[data-cad-analysis-legend-create] button:has-text("Create Legend")').click();
  await expect.poll(() => manager.locator('[data-cad-analysis-legends] [data-cad-analysis-legend]').count()).toBe(1);
  const legendTitle = page.locator('[data-analysis-legend-title]');
  await expect(legendTitle).toContainText('U-Legend');
  await page.screenshot({ path: `${SHOT_DIR}/18u-C-legend.png` });

  // Flow J: layer OFF hides analysis fills; FROZEN hides them too; restore both.
  const collapse = page.locator('button[title="Collapse panel body"]');
  if (await collapse.isVisible().catch(() => false)) {
    await collapse.click();
  }
  await ribbonTab(page, 'Home').click();
  await page.getByRole('button', { name: 'Open layer manager' }).click();
  const layers = page.locator('[data-cad-layers]');
  await layers.locator('input[aria-label="Toggle on/off for layer General"]').uncheck();
  await expect(page.locator('[data-analysis-layer]')).toHaveCount(0);
  await page.screenshot({ path: `${SHOT_DIR}/18u-C-layer-off.png` });
  await layers.locator('input[aria-label="Toggle on/off for layer General"]').check();
  await expect.poll(() => page.locator(`[data-analysis-layer="${elevId}"]`).count()).toBe(1);
  await layers.locator('input[aria-label="Toggle freeze for layer General"]').check();
  await expect(page.locator('[data-analysis-layer]')).toHaveCount(0);
  await layers.locator('input[aria-label="Toggle freeze for layer General"]').uncheck();
  await expect.poll(() => page.locator(`[data-analysis-layer="${elevId}"]`).count()).toBe(1);

  // Flow K: save/reopen keeps definitions + legend, never results.
  await ribbonTab(page, 'Home').click();
  const savedPath = await downloadToTemp(
    page,
    () => page.getByRole('button', { name: 'Save Drawing' }).first().click(),
    '.wncad',
  );
  const saved = fs.readFileSync(savedPath, 'utf8');
  expect(saved).toContain('U-Legend');
  await page.goto('/cad', { waitUntil: 'networkidle' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await openDrawing(page, savedPath, 50);
  await showSurveyTab(page);
  await openManager(page);
  // Definitions persist, results never do: source unbuilt -> SOURCE_NOT_CURRENT (never false CURRENT).
  await expect.poll(() => analysisStatus(page, elevId)).toBe('SOURCE_NOT_CURRENT');
  await rebuildAll(page);
  await expect.poll(() => surfaceStatus(page, 'u-surf-base'), { timeout: 60000 }).toBe('CURRENT');
  // No retained session result after reopen -> UNBUILT (definition only), then Calculate -> CURRENT.
  await expect.poll(() => analysisStatus(page, elevId)).toBe('UNBUILT');
  await selectAnalysis(page, elevId);
  await calculateAnalysis(page);
  await expect.poll(() => analysisStatus(page, elevId), { timeout: 60000 }).toBe('CURRENT');
  await page.screenshot({ path: `${SHOT_DIR}/18u-C-reopened.png` });
  fs.rmSync(path.dirname(drawingPath), { recursive: true, force: true });
  fs.rmSync(path.dirname(savedPath), { recursive: true, force: true });
  expect(errors).toEqual([]);
});

test('18U-D: supersession smoke + SVG/PDF include map+legend, DXF explicit', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  const drawingPath = makeAnalysisDrawing();
  await openDrawing(page, drawingPath, 50);
  await showSurveyTab(page);
  await openManager(page);
  await rebuildAll(page);
  await expect.poll(() => surfaceStatus(page, 'u-surf-base'), { timeout: 60000 }).toBe('CURRENT');
  const manager = managerScope(page);

  await selectSurfaceInManager(page, 'U-Base');
  const elevId = await createAnalysis(page, 'elevation');
  await selectAnalysis(page, elevId);
  await calculateAnalysis(page);
  await expect.poll(() => analysisStatus(page, elevId), { timeout: 60000 }).toBe('CURRENT');
  await manager.locator('[data-cad-analysis-legend-create] input[aria-label="New analysis legend title"]').fill('U-Export');
  await manager.locator('[data-cad-analysis-legend-create] button:has-text("Create Legend")').click();
  await expect.poll(() => manager.locator('[data-cad-analysis-legends] [data-cad-analysis-legend]').count()).toBe(1);

  // Flow L smoke: rapid double Calculate still lands CURRENT with zero page errors.
  // (Deterministic supersession pin: tests/cad_analysis_service_18u.test.ts.)
  await calculateAnalysis(page);
  await calculateAnalysis(page);
  await expect.poll(() => analysisStatus(page, elevId), { timeout: 60000 }).toBe('CURRENT');

  // Flow M: Export Center — SVG/PDF carry fills + legend, DXF is explicit boundaries.
  await ribbonTab(page, 'Output').click();
  await page.locator('[data-cad-command="SHELL_EXPORT_CENTER"]').click();
  const panel = page.locator('section[aria-label="Export Center"]');
  await expect(panel).toBeVisible();
  const svgPath = await downloadToTemp(
    page,
    () => panel.locator('[data-export-center-download]').click(),
    '.svg',
  );
  const svg = fs.readFileSync(svgPath, 'utf8');
  const fills = page.locator(`[data-analysis-layer="${elevId}"] [data-analysis-band]`);
  const bandFill = (await fills.first().getAttribute('fill')) ?? '';
  expect(svg).toContain(bandFill.toLowerCase() === bandFill ? bandFill : bandFill.toLowerCase());
  expect(svg).toContain('U-Export');
  await panel.getByRole('tab', { name: 'PDF (sheet)' }).click();
  const pdfPath = await downloadToTemp(
    page,
    () => panel.locator('[data-export-center-download]').click(),
    '.pdf',
  );
  expect(fs.statSync(pdfPath).size).toBeGreaterThan(1000);
  await panel.getByRole('tab', { name: 'DXF R12 (model space)' }).click();
  await expect(panel.locator('[aria-label="Export warnings"]')).toContainText('approximated');
  const dxfPath = await downloadToTemp(
    page,
    () => panel.locator('[data-export-center-download]').click(),
    '.dxf',
  );
  const dxf = fs.readFileSync(dxfPath, 'utf8');
  expect(dxf).toContain('U-Export');
  expect(dxf).toMatch(/POLYLINE/);
  await panel.getByRole('tab', { name: 'LandXML (CAD geometry)' }).click();
  const landxmlPath = await downloadToTemp(
    page,
    () => panel.locator('[data-export-center-download]').click(),
    '.xml',
  );
  expect(fs.readFileSync(landxmlPath, 'utf8')).not.toContain('U-Export');
  await page.screenshot({ path: `${SHOT_DIR}/18u-D-export.png` });
  fs.rmSync(path.dirname(drawingPath), { recursive: true, force: true });
  for (const file of [svgPath, pdfPath, dxfPath, landxmlPath]) {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
  expect(errors).toEqual([]);
});
