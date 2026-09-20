/**
 * Phase 18P browser QA capture (manual run, evidence only — never a gate).
 *
 * Builds two real `.wncad` fixtures (a dense professional-annotation plan and
 * a ~1000-annotation responsiveness drawing), opens each through the shipped
 * `/cad` Open-drawing path in headless Chromium, and:
 *   1. captures full-page screenshots at 1366×768, 1920×1080, 2560×1440;
 *   2. measures large-drawing load + cursor-move responsiveness with OSNAP on;
 *   3. prints the annotation print-scale numbers (paper vs model vs legacy)
 *      from the same engine metrics the renderer uses.
 *
 * Screenshots land in `docs/evidence/phase18p/`. Prints a markdown-ready log
 * for `docs/evidence/phase18p-browser-qa.md`. No `src/` behavior changes.
 *
 * Usage: `npm run dev -- --host 127.0.0.1 --port 4174` in one terminal, then
 *        `npx tsx scripts/phase18pBrowserQa.ts`
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { buildCadBounds } from '../src/engine/cad/cadProjectState';
import { resolveCadAnnotationTextMetrics } from '../src/engine/cad/annotation/cadAnnotationTextMetrics';
import { paperHeightMmToModelMeters } from '../src/engine/cad/annotation/cadAnnotationSettings';
import type { CadAnnotationAnchor } from '../src/engine/cad/annotation/cadAnnotationAnchors';
import type { CadEntity } from '../src/engine/cad/cadTypes';

const BASE_URL = 'http://127.0.0.1:4174';
const SHOT_DIR = 'docs/evidence/phase18p';
const NO_SWEEP = process.argv.includes('--no-sweep');
const TEXT_STYLE = 'std-model-2_5';

const fixed = (x: number, y: number): CadAnnotationAnchor => ({ kind: 'fixed', x, y });

const base = (id: string, layerId: string) => ({ id, layerId, visible: true, locked: false });

function planEntities(): CadEntity[] {
  const line1: CadEntity = {
    ...base('line-1', 'observation-lines'), type: 'line',
    fromStationId: 'C1', toStationId: 'P2', fromX: 0, fromY: 0, toX: 40, toY: 0, sourceObservationIds: [],
  };
  const line2: CadEntity = {
    ...base('line-2', 'observation-lines'), type: 'line',
    fromStationId: 'P2', toStationId: 'P3', fromX: 40, fromY: 0, toX: 40, toY: 30, sourceObservationIds: [],
  };
  const arc: CadEntity = {
    ...base('arc-1', 'observation-lines'), type: 'arc',
    centerX: 60, centerY: 20, radius: 8, startAngleDeg: 0, endAngleDeg: 120,
  };
  const points: CadEntity[] = [
    { ...base('pt-C1', 'control-points'), type: 'survey-point', stationId: 'C1', x: 0, y: 0, z: 0, pointClass: 'control', source: 'parsed-input' },
    { ...base('pt-P2', 'points'), type: 'survey-point', stationId: 'P2', x: 40, y: 0, z: 0, pointClass: 'free', source: 'parsed-input' },
    // Field-to-finish coded points (featureCode).
    { ...base('pt-F1', 'points'), type: 'survey-point', stationId: 'F1', x: 40, y: 30, z: 0, pointClass: 'free', source: 'parsed-input', featureCode: 'TREE ' },
    { ...base('pt-F2', 'points'), type: 'survey-point', stationId: 'F2', x: 60, y: 20, z: 0, pointClass: 'free', source: 'parsed-input', featureCode: 'F2F' },
  ];
  const monument: CadEntity = {
    ...base('bref-1', 'general'), type: 'block-reference',
    blockDefinitionId: 'qa-monument', x: 20, y: 20, rotationDeg: 0, scaleX: 1, scaleY: 1,
  };
  const mtext: CadEntity = {
    ...base('mtext-1', 'labels'), type: 'mtext',
    x: 2, y: 46, text: 'PHASE 18P QA PLAN\n1:500', textStyleId: TEXT_STYLE, rotationDeg: 0, attachment: 'bottom-left',
  };
  const leader: CadEntity = {
    ...base('leader-1', 'labels'), type: 'leader',
    arrowAnchor: { kind: 'survey-point', entityId: 'pt-P2', fallbackX: 40, fallbackY: 0 },
    vertices: [{ x: 40, y: 0 }, { x: 46, y: 7 }], text: 'BOUNDARY PIN', leaderStyleId: 'std-leader',
  };
  const dimensions: CadEntity[] = [
    {
      ...base('dim-lin', 'labels'), type: 'dimension', dimensionKind: 'linear',
      anchors: [fixed(0, 0), fixed(40, 0)], defPoint1: fixed(0, 0), defPoint2: fixed(40, 0),
      orientation: 'horizontal', dimLinePoint: { x: 20, y: -8 }, textPoint: { x: 20, y: -11 }, dimensionStyleId: 'std-500',
    },
    {
      ...base('dim-align', 'labels'), type: 'dimension', dimensionKind: 'aligned',
      anchors: [fixed(40, 0), fixed(40, 30)], defPoint1: fixed(40, 0), defPoint2: fixed(40, 30),
      orientation: 'aligned', dimLinePoint: { x: 30, y: 15 }, dimensionStyleId: 'std-500',
    },
    {
      ...base('dim-ang', 'labels'), type: 'dimension', dimensionKind: 'angular',
      anchors: [fixed(40, 0), fixed(0, 0), fixed(40, 30)], dimLinePoint: { x: 48, y: 8 }, dimensionStyleId: 'std-500',
    },
    {
      ...base('dim-rad', 'labels'), type: 'dimension', dimensionKind: 'radius',
      anchors: [fixed(60, 20), fixed(68, 20)], dimLinePoint: { x: 60, y: 29 }, dimensionStyleId: 'std-500',
    },
    {
      ...base('dim-dia', 'labels'), type: 'dimension', dimensionKind: 'diameter',
      anchors: [fixed(60, 20), fixed(68, 20)], dimLinePoint: { x: 60, y: 11 }, dimensionStyleId: 'std-500',
    },
  ];
  const labels: CadEntity[] = [
    { ...base('bl-1', 'labels'), type: 'bearing-label', sourceEntityId: 'line-1', labelStyleId: 'bearing-default', offset: { x: 0, y: 2 } },
    { ...base('cl-1', 'labels'), type: 'curve-label', sourceEntityId: 'arc-1', labelStyleId: 'curve-default', offset: { x: 0, y: 0 } },
  ];
  return [line1, line2, arc, ...points, monument, mtext, leader, ...dimensions, ...labels];
}

function planDrawingFile(): { file: string; entityCount: number } {
  const doc = createBlankCadDrawingDocument({ name: 'Phase 18P QA Plan', units: 'm' });
  const project = doc.project;
  project.entities = planEntities();
  project.blockDefinitions = [...(project.blockDefinitions ?? []), {
    id: 'qa-monument', name: 'QA Monument', basePoint: { x: 0, y: 0 },
    entities: [{
      ...base('qa-monument-body', 'general'), type: 'polygon',
      vertices: [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }], vertexLabels: ['', '', '', ''],
    }],
  }];
  project.bounds = buildCadBounds(project.entities);
  const dir = mkdtempSync(join(tmpdir(), 'webnet-18p-plan-'));
  const file = join(dir, 'phase18p-qa-plan.wncad');
  writeFileSync(file, JSON.stringify(doc));
  return { file, entityCount: project.entities.length };
}

/** ~1000 annotations on a 25 m grid, mirroring the perf probe's mix. */
function largeDrawingFile(size: number): { file: string; entityCount: number } {
  const doc = createBlankCadDrawingDocument({ name: 'Phase 18P Responsiveness', units: 'm' });
  const project = doc.project;
  const cols = Math.ceil(Math.sqrt(size));
  const at = (index: number) => ({ x: (index % cols) * 25, y: Math.floor(index / cols) * 25 });
  const entities: CadEntity[] = [];
  const geometryCount = Math.ceil(size / 4);
  for (let i = 0; i < geometryCount; i += 1) {
    const p = at(i);
    entities.push({
      ...base(`src-line-${i}`, 'observation-lines'), type: 'line',
      fromStationId: `P${i}`, toStationId: `Q${i}`, fromX: p.x, fromY: p.y, toX: p.x + 20, toY: p.y + 10, sourceObservationIds: [],
    });
  }
  const mtextCount = Math.round(size * 0.4);
  const leaderCount = Math.round(size * 0.2);
  const dimensionCount = Math.round(size * 0.25);
  for (let i = 0; i < mtextCount; i += 1) {
    const p = at(i);
    entities.push({ ...base(`mtext-${i}`, 'labels'), type: 'mtext', x: p.x, y: p.y, text: `LABEL ${i}`, textStyleId: TEXT_STYLE, rotationDeg: 0, attachment: 'middle-center' });
  }
  for (let i = 0; i < leaderCount; i += 1) {
    const p = at(i);
    entities.push({ ...base(`leader-${i}`, 'labels'), type: 'leader', arrowAnchor: fixed(p.x, p.y), vertices: [{ x: p.x, y: p.y }, { x: p.x + 8, y: p.y + 6 }], text: 'NOTE', leaderStyleId: 'std-leader' });
  }
  for (let i = 0; i < dimensionCount; i += 1) {
    const p = at(i);
    entities.push({
      ...base(`dim-${i}`, 'labels'), type: 'dimension', dimensionKind: 'linear',
      anchors: [fixed(p.x, p.y), fixed(p.x + 20, p.y)], defPoint1: fixed(p.x, p.y), defPoint2: fixed(p.x + 20, p.y),
      orientation: 'horizontal', dimLinePoint: { x: p.x, y: p.y - 8 }, dimensionStyleId: 'std-500',
    });
  }
  const bearingCount = size - mtextCount - leaderCount - dimensionCount;
  for (let i = 0; i < bearingCount; i += 1) {
    entities.push({ ...base(`bearing-${i}`, 'labels'), type: 'bearing-label', sourceEntityId: `src-line-${i % geometryCount}`, labelStyleId: 'bearing-default', offset: { x: 0, y: 2 } });
  }
  project.entities = entities;
  project.bounds = buildCadBounds(entities);
  const dir = mkdtempSync(join(tmpdir(), 'webnet-18p-large-'));
  const file = join(dir, `phase18p-large-${size}.wncad`);
  writeFileSync(file, JSON.stringify(doc));
  return { file, entityCount: entities.length };
}

async function openDrawing(page: Page, file: string, expected: number): Promise<void> {
  const input = page.locator('[data-survey-cad-open-drawing-input]');
  await input.evaluate((element: HTMLInputElement) => element.classList.remove('hidden')).catch(() => {});
  await input.setInputFiles(file);
  await page.waitForFunction(
    (count) => (document.querySelector('[data-survey-cad-entity-count]')?.textContent ?? '').includes(String(count)),
    expected,
    { timeout: 60000 },
  );
}

async function gotoBlank(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    const record = window as unknown as Record<string, unknown>;
    delete record.showSaveFilePicker;
    delete record.showOpenFilePicker;
  });
  await page.goto(`${BASE_URL}/cad`, { waitUntil: 'domcontentloaded' });
  await page.getByText('WebNet CAD', { exact: true }).first().waitFor({ timeout: 30000 });
  await page.locator('[data-cad-viewport]').waitFor({ timeout: 30000 });
}

/** Sweep real pointer moves across the viewport and count browser long tasks. */
async function cursorSweep(page: Page, moves: number): Promise<{ wallMs: number; longTasks: number; longTaskMs: number }> {
  await page.evaluate(() => {
    const record = window as unknown as { __18pLongTasks?: number; __18pLongTaskMs?: number };
    record.__18pLongTasks = 0;
    record.__18pLongTaskMs = 0;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        record.__18pLongTasks = (record.__18pLongTasks ?? 0) + 1;
        record.__18pLongTaskMs = (record.__18pLongTaskMs ?? 0) + entry.duration;
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
    (window as unknown as { __18pObserver?: PerformanceObserver }).__18pObserver = observer;
  });
  const box = await page.locator('[data-cad-viewport] svg').first().boundingBox();
  if (!box) throw new Error('viewport has no bounding box');
  const start = Date.now();
  for (let i = 0; i < moves; i += 1) {
    const fx = 0.12 + 0.76 * ((i % 40) / 39);
    const fy = 0.15 + 0.7 * (Math.floor(i / 40) / Math.max(1, Math.ceil(moves / 40) - 1));
    await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
  }
  const wallMs = Date.now() - start;
  const longTasks = await page.evaluate(() => {
    const record = window as unknown as { __18pLongTasks?: number; __18pLongTaskMs?: number; __18pObserver?: PerformanceObserver };
    record.__18pObserver?.disconnect();
    return { count: record.__18pLongTasks ?? 0, totalMs: record.__18pLongTaskMs ?? 0 };
  });
  return { wallMs, longTasks: longTasks.count, longTaskMs: longTasks.totalMs };
}

/** Paper-height vs model-height vs legacy text at 1:250 / 1:500 / 1:1000. */
function printScaleTable(): string[] {
  const style = { fontFamily: 'Arial', fontSize: 2.5, widthFactor: 1, lineSpacingFactor: 1 };
  const rows = [250, 500, 1000].map((denominator) => {
    const paper = resolveCadAnnotationTextMetrics({
      ...style, heightMode: 'paper', paperHeightMm: 2.5, annotationScaleDenominator: denominator, unitsMode: 'm',
    });
    const model = resolveCadAnnotationTextMetrics({
      ...style, heightMode: 'model', modelHeight: 2.5, annotationScaleDenominator: denominator, unitsMode: 'm',
    });
    const legacy = resolveCadAnnotationTextMetrics({ ...style, fontSize: 11, heightMode: 'legacy-screen', annotationScaleDenominator: denominator, unitsMode: 'm' });
    const paperMm = (h: number) => ((h * 1000) / denominator).toFixed(2);
    return `| 1:${denominator} | ${paper.modelHeight.toFixed(3)} m | ${paperMm(paper.modelHeight)} mm | ${model.modelHeight.toFixed(3)} m | ${paperMm(model.modelHeight)} mm | ${legacy.modelHeight.toFixed(3)} m | ${paperMm(legacy.modelHeight)} mm |`;
  });
  const paperArrow = (denominator: number) => paperHeightMmToModelMeters(2.5, denominator, 'm').toFixed(3);
  return [
    '| scale | paper text model | paper text paper | model text model | model text paper | legacy text model | legacy text paper |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    `Paper-mode arrow at 2.5 mm: 1:250 → ${paperArrow(250)} m, 1:500 → ${paperArrow(500)} m, 1:1000 → ${paperArrow(1000)} m (paper 2.5 mm constant); model-mode arrow stays 2.5 m at every scale.`,
  ];
}

/** Rendered entity ids + visible text in the viewport (proof the plan drew). */
async function renderedSummary(page: Page): Promise<{ ids: string[]; texts: string[]; broken: boolean; brokenOwner: string | null }> {
  return page.evaluate(() => {
    const ids = new Set<string>();
    for (const element of document.querySelectorAll('[data-survey-cad-render-entity-id]')) {
      const id = element.getAttribute('data-survey-cad-render-entity-id');
      if (id) ids.add(id);
    }
    const svg = document.querySelector('[data-cad-viewport] svg');
    const texts = [...(svg?.querySelectorAll('text') ?? [])]
      .map((node) => (node.textContent ?? '').trim())
      .filter((text) => text.length > 0);
    const brokenNode = [...(svg?.querySelectorAll('text') ?? [])].find((node) => (node.textContent ?? '').includes('BROKEN'));
    const brokenOwner = brokenNode?.closest('[data-survey-cad-render-entity-id]')?.getAttribute('data-survey-cad-render-entity-id') ?? null;
    return { ids: [...ids].sort(), texts, broken: texts.some((text) => text.includes('BROKEN')), brokenOwner };
  });
}

async function main(): Promise<void> {
  mkdirSync(SHOT_DIR, { recursive: true });
  const plan = planDrawingFile();
  console.log(`plan fixture: ${plan.entityCount} entities`);
  console.log(['', '### Print-scale text/arrow behavior (engine metrics)', ...printScaleTable(), ''].join('\n'));

  const errors: string[] = [];
  const browser = await chromium.launch();
  try {
    for (const viewport of [
      { width: 1366, height: 768, tag: '1366x768' },
      { width: 1920, height: 1080, tag: '1920x1080' },
      { width: 2560, height: 1440, tag: '2560x1440' },
    ]) {
      const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
      await gotoBlank(page, errors);
      await openDrawing(page, plan.file, plan.entityCount);
      await page.waitForTimeout(800);
      const path = `${SHOT_DIR}/plan-${viewport.tag}.png`;
      await page.screenshot({ path });
      if (viewport.tag === '1920x1080') {
        const summary = await renderedSummary(page);
        console.log(`plan rendered entity ids (${summary.ids.length}/${plan.entityCount}): ${summary.ids.join(', ')}`);
        console.log(`plan viewport texts: ${summary.texts.join(' | ')}`);
        console.log(`plan BROKEN markers present: ${summary.broken} (owner ${summary.brokenOwner ?? 'n/a'})`);
      }
      console.log(`screenshot ${path} (${viewport.width}x${viewport.height})`);
      await page.close();
    }

    // Control: same sweep on an empty drawing isolates Playwright/CDP overhead.
    if (!NO_SWEEP) {
      const blank = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      await gotoBlank(blank, errors);
      const blankSweep = await cursorSweep(blank, 120);
      console.log(`blank cursor sweep: ${blankSweep.wallMs} ms for 120 moves (~${(blankSweep.wallMs / 120).toFixed(1)} ms/move), long tasks ${blankSweep.longTasks} (${blankSweep.longTaskMs.toFixed(0)} ms)`);
      await blank.close();
    }

    const large = largeDrawingFile(1000);
    if (!NO_SWEEP) {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      await gotoBlank(page, errors);
      const loadStart = Date.now();
      await openDrawing(page, large.file, large.entityCount);
      const loadMs = Date.now() - loadStart;
      await page.waitForTimeout(800);
      const domStats = await page.evaluate(() => {
        const svg = document.querySelector('[data-cad-viewport] svg');
        return {
          svgNodes: svg?.querySelectorAll('*').length ?? 0,
          renderedEntities: new Set([...document.querySelectorAll('[data-survey-cad-render-entity-id]')].map((n) => n.getAttribute('data-survey-cad-render-entity-id'))).size,
        };
      });
      const sweep = await cursorSweep(page, 240);
      await page.screenshot({ path: `${SHOT_DIR}/large-1000-annotations.png` });
      console.log(`large fixture: ${large.entityCount} entities, open→rendered ${loadMs} ms, svg nodes ${domStats.svgNodes}, rendered entities ${domStats.renderedEntities}`);
      console.log(`cursor sweep (OSNAP default on): ${sweep.wallMs} ms for 240 moves (~${(sweep.wallMs / 240).toFixed(1)} ms/move incl. Playwright transport), long tasks ${sweep.longTasks} (${sweep.longTaskMs.toFixed(0)} ms blocked)`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`page/console errors: ${errors.length === 0 ? 'none' : errors.join(' | ')}`);
  if (errors.length > 0) process.exitCode = 1;
}

void main();
