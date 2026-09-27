/**
 * Phase 19D manual visual QA (§116) — realistic subdivision plan captured at
 * 1366x768, 1920x1080 and 2560x1440.
 *
 * This is a standalone Playwright capture harness (deliberately NOT under
 * tests-browser/, which the parallel functional-QA worker owns). It reuses
 * the read-only 19A/19B browser helpers and builds every drawing through the
 * production document seams (`scripts/phase19dVisualFixtures.ts`).
 *
 * Views per resolution: model plan, Network Manager, linked boundary
 * selected, overlap/easement validation, schedule, shared-edit workflow,
 * sheet plan, PDF result. PNGs land in docs/evidence/phase19d/.
 *
 * Usage: `npx tsx scripts/phase19dVisualQa.ts [--quick]`
 *   --quick  only the 1366x768 sweep (fast iteration).
 */
import { chromium, type Browser, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  buildFindingsProject,
  buildPlanProject,
  writePlanDrawing,
  writeSheetDrawing,
} from './phase19dVisualFixtures';
import { gotoCad } from '../tests-browser/cad-survey-plan-19a-helpers';
import { layoutTab } from '../tests-browser/cad-sheet-layout-19b-helpers';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'docs/evidence/phase19d');
const BASE_URL = 'http://127.0.0.1:4174';
const QUICK = process.argv.includes('--quick');

const RESOLUTIONS = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
] as const;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const ping = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${BASE_URL}/cad`);
    return response.ok;
  } catch {
    return false;
  }
};

const startServer = async (): Promise<ChildProcess | null> => {
  if (await ping()) return null;
  const child = spawn(path.join(REPO_ROOT, 'node_modules/.bin/vite'), ['--host', '127.0.0.1', '--port', '4174'], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await ping()) return child;
    await sleep(1000);
  }
  child.kill();
  throw new Error('vite dev server did not become ready');
};

const openDrawing = async (page: Page, filePath: string): Promise<void> => {
  const input = page.locator('[data-survey-cad-open-drawing-input]');
  await input.evaluate((element: HTMLInputElement) => element.classList.remove('hidden')).catch(() => {});
  await input.setInputFiles(filePath);
  await page.waitForFunction(() => {
    const element = document.querySelector('[data-survey-cad-entity-count]');
    return element != null && Number.parseInt(element.textContent ?? '0', 10) > 0;
  }, undefined, { timeout: 30000 });
};

const surveyTab = async (page: Page): Promise<void> => {
  await page.locator('[data-cad-toolspace] [role="tab"]', { hasText: 'Survey' }).click();
};

const expandParcelNodes = async (page: Page): Promise<void> => {
  await page.locator('[data-cad-parcel-node]').evaluateAll((nodes) => {
    for (const node of nodes) (node as HTMLDetailsElement).open = true;
  });
};

const capturePage = async (page: Page, name: string, size: { width: number; height: number }): Promise<void> => {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}-${size.width}x${size.height}.png`) });
};

const captureToolspace = async (page: Page, name: string, size: { width: number; height: number }): Promise<void> => {
  const toolspace = page.locator('[data-cad-toolspace]');
  await toolspace.screenshot({ path: path.join(OUT_DIR, `${name}-${size.width}x${size.height}.png`) });
};

/** Log rendered text for the QA doc (the harness has no vision; DOM is the record). */
const logProbe = async (page: Page, label: string, selectors: readonly string[]): Promise<void> => {
  const parts: string[] = [];
  for (const selector of selectors) {
    const texts = await page.locator(selector).allTextContents().catch(() => []);
    if (texts.length === 0) continue;
    const compact = texts.map((text) => text.replace(/\s+/g, ' ').trim()).filter(Boolean);
    parts.push(`${selector} => ${JSON.stringify(compact)}`);
  }
  console.log(`[19D-PROBE] ${label} :: ${parts.join(' | ')}`);
};

/** Rasterize the exported PDF's first page at each capture resolution. */
const rasterizePdf = async (pdfPath: string): Promise<void> => {
  for (const resolution of RESOLUTIONS) {
    const rasterBase = path.join(OUT_DIR, `_pdf-raster-${resolution.width}`);
    const outPath = path.join(OUT_DIR, `pdf-result-${resolution.width}x${resolution.height}.png`);
    await new Promise<void>((resolve, reject) => {
      const child = spawn('pdftoppm', [
        '-png',
        '-singlefile',
        '-f', '1',
        '-l', '1',
        '-scale-to-x', String(resolution.width),
        '-scale-to-y', '-1',
        pdfPath,
        rasterBase,
      ], { stdio: 'ignore' });
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`pdftoppm exited ${code}`))));
      child.on('error', reject);
    });
    // Letterbox to the exact capture size (white paper margin) for consistency
    // with the browser screenshots at the same resolution.
    await new Promise<void>((resolve, reject) => {
      const child = spawn('magick', [
        `${rasterBase}.png`,
        '-resize', `${resolution.width}x${resolution.height}`,
        '-background', 'white',
        '-gravity', 'center',
        '-extent', `${resolution.width}x${resolution.height}`,
        outPath,
      ], { stdio: 'ignore' });
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`magick exited ${code}`))));
      child.on('error', reject);
    });
    fs.rmSync(`${rasterBase}.png`, { force: true });
  }
};

const runSweep = async (
  browser: Browser,
  resolution: (typeof RESOLUTIONS)[number],
  planPath: string,
  findingsPath: string,
  sheetPath: string,
  errors: string[],
  pdfHolder: { path: string | null },
): Promise<void> => {
  const context = await browser.newContext({
    viewport: { width: resolution.width, height: resolution.height },
    baseURL: BASE_URL,
  });
  const page = await context.newPage();
  await gotoCad(page, errors);

  // 1. Model plan as opened.
  await openDrawing(page, planPath);
  await capturePage(page, 'model-plan', resolution);

  // 2. Network Manager (Toolspace Survey / Parcel Network).
  await surveyTab(page);
  await expandParcelNodes(page);
  await page.locator('[data-cad-parcel-node]').first().scrollIntoViewIfNeeded();
  await captureToolspace(page, 'network-manager', resolution);
  await logProbe(page, 'network-plan', [
    '[data-cad-parcel-node] > summary',
    '[data-cad-parcel-link]',
    '[data-cad-parcel-neighbor]',
  ]);

  // 3. Linked boundary selected: select Lot 1 (has a shared boundary) and show
  //    the viewport highlight + Properties shared-boundary rows.
  await page.locator('[data-cad-parcel-node="parcel:lot1"] [data-cad-parcel-action="SELECT"]').click();
  await page.waitForTimeout(400);
  await capturePage(page, 'linked-boundary-selected', resolution);
  await logProbe(page, 'linked-properties', ['[data-cad-properties="single"]']);

  // 4. Overlap / easement validation on the deliberately-corrupted plan.
  await openDrawing(page, findingsPath);
  await surveyTab(page);
  await expandParcelNodes(page);
  await page.locator('[data-cad-parcel-node]').first().scrollIntoViewIfNeeded();
  await captureToolspace(page, 'overlap-easement-validation', resolution);
  await logProbe(page, 'validation-findings', [
    '[data-cad-parcel-link]',
    '[data-cad-parcel-neighbor]',
  ]);

  // 5. Parcel Schedule (Toolspace Schedules node).
  const scheduleTotals = page.locator('[data-cad-parcel-schedule="totals"]');
  await scheduleTotals.scrollIntoViewIfNeeded();
  await captureToolspace(page, 'schedule', resolution);
  await logProbe(page, 'schedule', [
    '[data-cad-parcel-schedule="totals"]',
    '[data-cad-parcel-schedule-row]',
  ]);

  // 6. Shared-edit workflow: shared-boundary row + Properties Shared With
  //    (Edit Shared is context-gated by the workspace; captured as shown).
  await openDrawing(page, planPath);
  await surveyTab(page);
  await page.locator('[data-cad-parcel-node="parcel:lot1"]').evaluate((node) => {
    (node as HTMLDetailsElement).open = true;
  });
  await page.locator('[data-cad-parcel-node="parcel:lot1"] [data-cad-parcel-link]').first().scrollIntoViewIfNeeded();
  await captureToolspace(page, 'shared-edit-workflow', resolution);
  await logProbe(page, 'shared-edit', [
    '[data-cad-parcel-link]',
    '[data-cad-parcel-link-shared-edit]',
  ]);

  // 7. Sheet plan (C-101, ISO A2 landscape, 1:750 viewport).
  await openDrawing(page, sheetPath);
  await layoutTab(page, 'C-101').click({ timeout: 10000 });
  await page.waitForTimeout(1200);
  await capturePage(page, 'sheet-plan', resolution);
  await logProbe(page, 'sheet', ['footer[data-cad-status-bar]']);

  // 8. PDF result: the Export Center is a model-space chrome command, so
  //    return to the Model tab first (the drawing still owns the sheet), then
  //    export through the real Export Center and rasterize page 1.
  await layoutTab(page, 'Model').click({ timeout: 5000 }).catch(() => {});
  await page.locator('[data-cad-ribbon] [role="tab"]', { hasText: 'Output' }).click();
  await page.locator('[data-cad-command="SHELL_EXPORT_CENTER"]').click();
  const center = page.locator('section[aria-label="Export Center"]');
  await center.waitFor({ state: 'visible', timeout: 10000 });
  await center.getByRole('tab', { name: /PDF/ }).click();
  if (pdfHolder.path == null) {
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await center.locator('[data-export-center-download]').click();
    const download = await downloadPromise;
    pdfHolder.path = path.join(OUT_DIR, 'sheet-plan-c101.pdf');
    await download.saveAs(pdfHolder.path);
  }

  await context.close();
};

const main = async (): Promise<void> => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const plan = buildPlanProject();
  const findings = buildFindingsProject();
  const planPath = writePlanDrawing(plan.project, 'Subdivision Plan 19D');
  const findingsPath = writePlanDrawing(findings.project, 'Findings Plan 19D');
  const sheetPath = writeSheetDrawing(plan.project, 'Subdivision Sheet 19D');

  const server = await startServer();
  const browser = await chromium.launch();
  const errors: string[] = [];
  const pdfHolder: { path: string | null } = { path: null };
  const resolutions = QUICK ? RESOLUTIONS.slice(0, 1) : RESOLUTIONS;
  try {
    for (const resolution of resolutions) {
      await runSweep(browser, resolution, planPath, findingsPath, sheetPath, errors, pdfHolder);
      console.log(`[19D-VISUAL] captured ${resolution.width}x${resolution.height}`);
    }
  } finally {
    await browser.close();
    server?.kill();
  }

  if (pdfHolder.path != null) await rasterizePdf(pdfHolder.path);

  const written = fs.readdirSync(OUT_DIR).filter((file) => file.endsWith('.png')).sort();
  console.log(`[19D-VISUAL] ${written.length} PNGs in ${OUT_DIR}`);
  for (const file of written) console.log(`  ${file}`);
  if (errors.length > 0) {
    console.log(`[19D-VISUAL] page/console errors (${errors.length}):`);
    for (const error of errors) console.log(`  ${error}`);
  } else {
    console.log('[19D-VISUAL] zero page/console errors');
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
