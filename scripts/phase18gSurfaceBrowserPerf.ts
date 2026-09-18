/**
 * Phase 18G browser production-path timings (manual-run measurement only).
 *
 * Drives the REAL production path in headless Chromium against a dev
 * server: opens generated drawings (1k / 10k / 50k points), clicks Rebuild
 * in the surface manager, and times ack → CURRENT (request-construction +
 * worker-build + transfer + cache-ingest + status publish). In-page splits
 * (request / direct worker-build / structuredClone transfer / ingest proxy /
 * display-prep / transferable-Buffer comparison / heap) come from dynamic
 * imports of the shipped modules. First-frame is completion → 2x rAF.
 *
 * No src/ behavior changes. Prints a markdown-ready table for
 * docs/evidence/phase18g-browser-performance.md; never gates.
 *
 * Usage: `npm run dev -- --host 127.0.0.1 --port 4174` in one terminal,
 * then `npx tsx scripts/phase18gSurfaceBrowserPerf.ts [--quick]`
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { chromium } from '@playwright/test';

const QUICK = process.argv.includes('--quick');
const ONLY = Number(process.argv.find((arg) => arg.startsWith('--scale='))?.split('=')[1] ?? 0);
const SCALES = ONLY > 0 ? [ONLY] : QUICK ? [1000] : [1000, 10000, 50000];
const BASE_URL = 'http://127.0.0.1:4174';
const CONSTRAINTS_ID = 'qa-surf-constraints';

const makeDrawing = (points: number): string => {
  const seed = JSON.parse(
    readFileSync('tests-browser/fixtures/cad-surface-18g-seed.wncad', 'utf8'),
  ) as { project: { entities: unknown[]; surfaces: Array<{ definition: { breaklines?: unknown[] } }> } };
  const entities: unknown[] = [];
  const cols = Math.ceil(Math.sqrt(points));
  let index = 0;
  for (let row = 0; row * cols < points; row += 1) {
    for (let col = 0; col < cols && index < points; col += 1) {
      index += 1;
      entities.push({
        id: `perf-pt-${index}`,
        type: 'survey-point',
        layerId: 'general',
        visible: true,
        locked: false,
        stationId: `Q${index}`,
        x: col * 10 + ((index * 37) % 10) * 0.1,
        y: row * 10 + ((index * 53) % 10) * 0.1,
        z: 100 + col * 0.5 + row * 0.3 + ((index * 29) % 10) * 0.05,
        pointClass: 'free',
        source: 'parsed-input',
      });
    }
  }
  for (const entity of seed.project.entities) {
    if ((entity as { type: string }).type !== 'survey-point') entities.push(entity);
  }
  seed.project.entities = entities;
  for (const surface of seed.project.surfaces) delete surface.definition.breaklines;
  const dir = mkdtempSync(join(tmpdir(), 'webnet-18g-perf-'));
  const file = join(dir, `perf-${points}.wncad`);
  writeFileSync(file, JSON.stringify(seed));
  return file;
};

const startAll = performance.now();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
await page.goto(`${BASE_URL}/cad`, { waitUntil: 'networkidle' });
await page.getByText('WebNet CAD', { exact: true }).first().waitFor({ timeout: 30000 });

console.log('scale\tackToCurrentMs\tfirstFrameMs\tinPageRequestMs\tinPageWorkerMs\tinPageXferMs\tinPageIngestMs\tdisplayPrepMs\ttris');
for (const scale of SCALES) {
  const file = makeDrawing(scale);
  const input = page.locator('[data-survey-cad-open-drawing-input]');
  await input.evaluate((el: HTMLInputElement) => el.classList.remove('hidden')).catch(() => {});
  await input.setInputFiles(file);
  const stage = (label: string): void => console.log(`[${scale}] ${((performance.now() - startAll) / 1000).toFixed(1)}s ${label}`);
  stage('file set');
  await page.waitForFunction(
    (expected) => (document.querySelector('[data-survey-cad-entity-count]')?.textContent ?? '').includes(String(expected)),
    scale + 2,
    { timeout: 120000 },
  );
  await page.locator('[aria-label="Ribbon tabs"]').getByRole('tab', { name: 'Surface' }).click();
  await page.getByRole('button', { name: 'Add Point Group' }).first().click();
  const manager = page.locator('section[aria-label="Surface manager"]');
  await manager.waitFor({ timeout: 15000 });
  await page.locator('[aria-label="Toolspace tabs"]').getByRole('tab', { name: 'Survey' }).click();
  await manager.getByRole('button', { name: /QA Constraints/ }).click();
  stage('manager ready');
  const start = performance.now();
  await manager.getByRole('button', { name: 'Rebuild', exact: true }).click();
  stage('rebuild clicked');
  let ackToCurrent = -1;
  try {
    await page.waitForFunction(
      (id) => document.querySelector(`[data-cad-toolspace] [data-cad-surface="${id}"]`)?.getAttribute('data-cad-surface-status') === 'CURRENT',
      CONSTRAINTS_ID,
      { timeout: 180000 },
    );
    ackToCurrent = performance.now() - start;
  } catch {
    const diag = await page.evaluate((id) => {
      const perfMem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      return {
        status: document.querySelector('[data-cad-toolspace] [data-cad-surface="' + id + '"]')?.getAttribute('data-cad-surface-status'),
        layers: document.querySelectorAll('[data-surface-layer]').length,
        heapMB: perfMem ? Math.round(perfMem.usedJSHeapSize / 1048576) : -1,
        title: document.title,
      };
    }, CONSTRAINTS_ID).catch(() => ({ status: 'PAGE-DEAD' }));
    console.log(`[${scale}] TIMEOUT diag: ${JSON.stringify(diag)} pageErrors=${errors.length}`);
    await browser.close();
    process.exit(2);
  }
  const firstFrame = await page.evaluate(async () => {
    const t0 = performance.now();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return performance.now() - t0;
  });
  // In-page splits run from scripts/phase18gBrowserBenchPage.js (plain JS
  // evaluated as a string; tsx-compiled closures do not survive evaluate
  // serialization). %%POINTS%% is substituted per scale below.
  const pageSource = readFileSync('scripts/phase18gBrowserBenchPage.js', 'utf8')
    .replace('/*%%POINTS%%*/ 1000', String(scale));
  const splitsJson: string = await page.evaluate(pageSource);
  const splits = JSON.parse(splitsJson);
  console.log(
    `${scale}\t${ackToCurrent.toFixed(0)}\t${firstFrame.toFixed(1)}\t${splits.requestMs.toFixed(1)}\t${splits.workerMs.toFixed(1)}`
    + `\t${splits.xferMs.toFixed(1)}\t${splits.ingestMs.toFixed(1)}\t${splits.displayPrepMs.toFixed(1)}\t${splits.tris}`
    + ` (xfer ${(splits.xferBytes / 1024).toFixed(0)} KiB, plainCopy ${splits.plainCopyMs.toFixed(1)}ms vs transferable ${splits.transferableMs.toFixed(1)}ms, heap ${splits.heapMB.toFixed(0)} MiB)`,
  );
  rmSync(file, { force: true });
}
console.log(`pageErrors: ${errors.length}${errors.length > 0 ? ` (${errors.slice(0, 3).join(' | ').slice(0, 300)})` : ''}`);
await browser.close();
