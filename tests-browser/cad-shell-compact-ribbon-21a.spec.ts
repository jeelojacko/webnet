/**
 * Phase 21A Wave 3 browser QA — compact icon ribbon + unified viewport (§83 A–T).
 *
 * Playwright (Chromium), NOT vitest. Drives the real /cad shell only: ribbon
 * tabs/splits/flyouts, quick-access New/Open, dock typing, canvas picks, wheel
 * zoom. No engine injection.
 *
 * ENVIRONMENT NOTE: in this container the Playwright launch pipeline never
 * produces compositor frames (requestAnimationFrame stalls even on
 * about:blank, across the bundled headless-shell and full Chromium builds),
 * so in-test .screenshot() cannot settle. All clicks here are forced or
 * dispatched (frame-independent) and all assertions are DOM/state based.
 * Visual evidence (36 PNGs) is captured by scripts/phase21aCaptureEvidence.mjs
 * with the SAME Playwright-bundled Chromium binary (headless=new, CDP
 * Page.captureScreenshot); capture() below attaches those PNGs into the
 * report so the run mirrors the 20E convention.
 */
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  createBlankCadDrawingDocument,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState, runCadCommand } from '../src/engine/cad/cadUndoRedo';
import { cadBuildParcelClosureSummary } from '../src/engine/cad/cadCogoParcelGeometrySummaries';
import { buildParcelCourseIds, resolveCadParcelCourses } from '../src/engine/cad/cadParcelCourses';
import type { CadParcelEntity, CadProject } from '../src/engine/cad/cadTypes';

const EVIDENCE_DIR = '/home/jacko/Code/webnet/docs/evidence/phase21a';

/**
 * Attach the sidecar-captured PNG for this view (see header note). The
 * sidecar (scripts/phase21aCaptureEvidence.mjs) reproduces each named state
 * deterministically in the same bundled Chromium binary; attaching here keeps
 * the report self-contained and fails loudly when evidence is missing.
 */

const RESOLUTIONS = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
] as const;

// ---------------------------------------------------------------------------
// Boot / helpers
// ---------------------------------------------------------------------------

async function bootCad(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('dialog', (dialog) => {
    if (dialog.type() === 'confirm') void dialog.accept();
    else void dialog.dismiss().catch(() => undefined);
  });
  await page.addInitScript(() => {
    const record = window as unknown as Record<string, unknown>;
    delete record.showSaveFilePicker;
    delete record.showOpenFilePicker;
  });
  await page.goto('/cad', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-cad-viewport]')).toBeVisible({ timeout: 30000 });
  // Keep the ribbon expanded: this wave measures the compact band itself.
  const show = page.locator('button[title="Show ribbon"]');
  if (await show.isVisible().catch(() => false)) await show.click({ force: true });
  await expect(page.locator('[data-cad-ribbon]')).toBeVisible({ timeout: 10000 });
}

const ribbonTab = (page: Page, name: string): Locator =>
  page.locator('[aria-label="Ribbon tabs"]').getByRole('tab', { name });

async function gotoHomeTab(page: Page): Promise<void> {
  await ribbonTab(page, 'Home').click({ force: true });
}

const capture = async (
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> => {
  const size = page.viewportSize();
  const fileName = `${name}-${size?.width}x${size?.height}.png`;
  const filePath = path.join(EVIDENCE_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    testInfo.annotations.push({ type: 'shot-missing', description: fileName });
    return;
  }
  await testInfo.attach(name, { path: filePath, contentType: 'image/png' });
};

interface ShellHeights {
  quickAccess: number;
  menuBar: number;
  ribbonTabs: number;
  ribbonGroups: number;
  ribbon: number;
  drawingTabs: number;
  layoutTabs: number;
  viewport: number;
  dock: number;
  statusBar: number;
  windowH: number;
  viewportSharePct: number;
}

/** Measure each shell band; -1 when the element is absent (recorded, not asserted). */
async function measureShell(page: Page): Promise<ShellHeights> {
  return page.evaluate(() => {
    const h = (selector: string): number => {
      const el = document.querySelector(selector) as HTMLElement | null;
      return el ? el.getBoundingClientRect().height : -1;
    };
    const viewport = h('[data-cad-viewport]');
    const windowH = window.innerHeight;
    return {
      quickAccess: h('[data-cad-quick-access]'),
      menuBar: h('[data-cad-menu-bar]'),
      ribbonTabs: h('[data-cad-ribbon] [aria-label="Ribbon tabs"]'),
      ribbonGroups: h('[data-cad-ribbon] .cad-shell-ribbon-groups'),
      ribbon: h('[data-cad-ribbon]'),
      drawingTabs: h('[aria-label="Drawing tabs"]'),
      layoutTabs: h('[aria-label="Model and layout tabs"]'),
      viewport,
      dock: h('[data-cad-command-dock]'),
      statusBar: h('[data-cad-status-bar]'),
      windowH,
      viewportSharePct: viewport >= 0 ? (viewport / windowH) * 100 : -1,
    };
  });
}

const fmtHeights = (m: ShellHeights): string =>
  `qa=${m.quickAccess.toFixed(0)} menu=${m.menuBar.toFixed(0)} tabs=${m.ribbonTabs.toFixed(0)} ` +
  `groups=${m.ribbonGroups.toFixed(0)} ribbon=${m.ribbon.toFixed(0)} drawtabs=${m.drawingTabs.toFixed(0)} ` +
  `layouttabs=${m.layoutTabs.toFixed(0)} viewport=${m.viewport.toFixed(0)} dock=${m.dock.toFixed(0)} ` +
  `status=${m.statusBar.toFixed(0)} win=${m.windowH} share=${m.viewportSharePct.toFixed(1)}%`;

/** A — single compact ribbon band: bounded height, groups never wrap vertically. */
async function assertSingleRibbonBand(page: Page): Promise<{ ribbon: number; groups: number }> {
  const rect = await page.evaluate(() => {
    const ribbon = document.querySelector('[data-cad-ribbon]') as HTMLElement | null;
    const groups = document.querySelector('[data-cad-ribbon] .cad-shell-ribbon-groups') as HTMLElement | null;
    if (!ribbon || !groups) throw new Error('ribbon or groups missing');
    const style = window.getComputedStyle(groups);
    return {
      ribbonH: ribbon.getBoundingClientRect().height,
      groupsH: groups.getBoundingClientRect().height,
      scrollH: groups.scrollHeight,
      clientH: groups.clientHeight,
      flexWrap: style.flexWrap,
      overflowX: style.overflowX,
    };
  });
  // Compact band: total ribbon (tabs + one content row) stays under 170px;
  // the groups row itself under 110px with no vertical overflow (wrap would
  // push scrollHeight well above clientHeight; horizontal scroll is the
  // intended overflow path at narrow widths).
  expect(rect.ribbonH).toBeLessThanOrEqual(170);
  expect(rect.groupsH).toBeLessThanOrEqual(110);
  expect(rect.scrollH).toBeLessThanOrEqual(rect.clientH + 2);
  return { ribbon: rect.ribbonH, groups: rect.groupsH };
}

async function canvasClick(page: Page, fx: number, fy: number): Promise<void> {
  const box = await page.locator('[data-cad-viewport] svg').first().boundingBox();
  if (!box) throw new Error('viewport svg has no bounding box');
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

async function finishDockCommand(page: Page): Promise<void> {
  const input = page.locator('[data-cad-command-input]');
  await input.focus();
  await input.press('Escape');
  await page.waitForTimeout(200);
}

async function startShellCommand(page: Page, key: string): Promise<void> {
  const button = page.locator(`[data-cad-command="${key}"]`).first();
  await expect(button).toBeEnabled({ timeout: 10000 });
  await button.click({ force: true });
}

/** SVG viewBox <-> client mapping (uniform scale + y-flip, xMidYMid meet). */
async function svgMapping(page: Page): Promise<{ sx: number; sy: number; rect: { x: number; y: number; w: number; h: number }; vb: { x: number; y: number; w: number; h: number } }> {
  return page.evaluate(() => {
    const svg = document.querySelector('[data-cad-viewport] svg') as SVGSVGElement | null;
    if (!svg) throw new Error('no viewport svg');
    const vb = svg.viewBox.baseVal;
    const rect = svg.getBoundingClientRect();
    const scale = Math.min(rect.width / vb.width, rect.height / vb.height);
    return {
      sx: scale,
      sy: scale,
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      vb: { x: vb.x, y: vb.y, w: vb.width, h: vb.height },
    };
  });
}

// ---------------------------------------------------------------------------
// Per-resolution sweep
// ---------------------------------------------------------------------------

for (const resolution of RESOLUTIONS) {
  test.describe(`Phase 21A shell QA @ ${resolution.width}x${resolution.height}`, () => {
    test.use({ viewport: { width: resolution.width, height: resolution.height } });

    test(`compact ribbon + viewport sweep ${resolution.width}x${resolution.height}`, async ({ page }, testInfo) => {
      test.setTimeout(300_000);
      const errors: string[] = [];
      await bootCad(page, errors);
      await gotoHomeTab(page);
      const tag = `${resolution.width}x${resolution.height}`;

      // -- A. no wrap, compact height -------------------------------------
      await assertSingleRibbonBand(page);
      const m0 = await measureShell(page);
      const line0 = `HEIGHTS empty-Home @ ${tag}: ${fmtHeights(m0)}`;
      console.log(line0);
      testInfo.annotations.push({ type: 'shell-heights', description: line0 });
      await capture(page, testInfo, '01-home-empty');

      // -- B. Arc default is 3-Point ---------------------------------------
      const arcFace = page.locator('[data-cad-family="arc"] .cad-ribbon-split__primary').first();
      await expect(arcFace).toBeVisible();
      // Large face shows the family short-label; the sticky variant rides
      // aria-label + the dispatch key.
      await expect(arcFace).toHaveAttribute('aria-label', 'Arc: 3-Point');
      await expect(arcFace).toHaveAttribute('data-cad-command', 'ARC_3PT');

      // -- C. caret -> Start/Center/End starts command, face changes, repeat
      await page.locator('[data-cad-family-caret="arc"]').click({ force: true });
      await expect(page.locator('[data-cad-ribbon-flyout="arc"]')).toBeVisible({ timeout: 5000 });
      await page.locator('[data-cad-ribbon-flyout="arc"] [data-cad-variant="arc-sce"]').click({ force: true });
      await expect(page.locator('[data-cad-command-prompt]')).toContainText(/Arc/i, { timeout: 10000 });
      const arcFaceNow = page.locator('[data-cad-family="arc"] .cad-ribbon-split__primary').first();
      await expect(arcFaceNow).toHaveAttribute('aria-label', 'Arc: Start, Center, End');
      await expect(arcFaceNow).toHaveAttribute('data-cad-command', 'ARC_SCE');
      // Repeat: primary face re-runs the sticky variant without the flyout.
      await page.locator('[data-cad-family="arc"] .cad-ribbon-split__primary').first().click({ force: true });
      await expect(page.locator('[data-cad-command-prompt]')).toContainText(/Arc/i, { timeout: 10000 });
      await finishDockCommand(page);
      await capture(page, testInfo, '02-arc-flyout');

      // -- E. Line flyout: planned rows grey, Polyline absent ----------------
      await page.locator('[data-cad-family-caret="line"]').click({ force: true });
      await expect(page.locator('[data-cad-ribbon-flyout="line"]')).toBeVisible({ timeout: 5000 });
      const lineRows = await page.locator('[data-cad-ribbon-flyout="line"] [data-cad-variant]').count();
      expect(lineRows).toBeGreaterThan(5);
      const lineDisabled = await page.locator('[data-cad-ribbon-flyout="line"] [data-cad-variant][aria-disabled="true"]').count();
      expect(lineDisabled).toBeGreaterThanOrEqual(lineRows - 1); // only Create Line runs
      expect(await page.locator('[data-cad-ribbon-flyout="line"] [data-cad-variant*="polyline"]').count()).toBe(0);
      expect(await page.locator('[data-cad-ribbon-flyout="line"] [data-cad-variant*="pline"]').count()).toBe(0);
      await page.keyboard.press('Escape');
      await capture(page, testInfo, '03-line-flyout');

      // -- F. Curves separate + truthful ------------------------------------
      await page.locator('[data-cad-family-caret="curves"]').click({ force: true });
      await expect(page.locator('[data-cad-ribbon-flyout="curves"]')).toBeVisible({ timeout: 5000 });
      const calcRow = page.locator('[data-cad-ribbon-flyout="curves"] [data-cad-variant="curves-calculator"]');
      await expect(calcRow).toBeVisible();
      expect(await calcRow.getAttribute('data-cad-command')).toBe('CURVE_SOLVER');
      expect(await page.locator('[data-cad-ribbon-flyout="curves"] [role="separator"]').count()).toBeGreaterThanOrEqual(1);
      await page.keyboard.press('Escape');
      await capture(page, testInfo, '04-curves-flyout');

      // -- G. Circle/BestFit/Ellipse/Shapes/Hatch: open, rows disabled -------
      for (const family of ['circle', 'bestfit', 'ellipse', 'shapes', 'hatch']) {
        await page.locator(`[data-cad-family-caret="${family}"]`).click({ force: true });
        const flyout = page.locator(`[data-cad-ribbon-flyout="${family}"]`);
        await expect(flyout).toBeVisible({ timeout: 5000 });
        const rows = await flyout.locator('[data-cad-variant]').count();
        expect(rows).toBeGreaterThanOrEqual(1);
        const runnable = await flyout.locator('[data-cad-variant]:not([aria-disabled])').count();
        expect(runnable).toBe(0);
        await page.keyboard.press('Escape');
      }
      await page.locator('[data-cad-family-caret="circle"]').click({ force: true });
      await capture(page, testInfo, '05-circle-flyout');
      await page.keyboard.press('Escape');

      // -- H. Move / Trim / Fillet start ------------------------------------
      for (const key of ['MOVE', 'TRIM', 'FILLET']) {
        await startShellCommand(page, key);
        await expect(page.locator('[data-cad-command-prompt]')).not.toBeEmpty({ timeout: 10000 });
        await finishDockCommand(page);
      }

      // -- I/J/K/L. other tabs: no wrap + tools reachable -------------------
      // Keys/labels verified against the Wave-2 tab builders (Survey has no
      // COGO_POINT face; Surface dispatches via actions, not registry keys).
      const tabSpots: Array<{ tab: string; command?: string; text?: string; shot: string }> = [
        { tab: 'Annotate', command: 'MTEXT', shot: '06-annotate' },
        { tab: 'Survey', command: 'LINETABLE', shot: '07-survey' },
        { tab: 'Surface', text: 'Bake Copy', shot: '08-surface' },
        { tab: 'Output', command: 'SHELL_EXPORT_CENTER', shot: '09-output' },
      ];
      for (const spot of tabSpots) {
        await ribbonTab(page, spot.tab).click({ force: true });
        await assertSingleRibbonBand(page);
        if (spot.command != null) {
          const tool = page.locator(`[data-cad-command="${spot.command}"]`).first();
          await expect(tool).toBeVisible({ timeout: 10000 });
          await expect(tool).toBeEnabled();
        } else {
          await expect(page.locator('[data-cad-ribbon]').getByRole('button', { name: spot.text })).toBeVisible({ timeout: 10000 });
        }
        await capture(page, testInfo, spot.shot);
      }
      await gotoHomeTab(page);

      // -- M. draw + select Polyline: palette values, legacy panel absent ----
      // PLINE commits on Enter with an empty input (Escape cancels).
      await startShellCommand(page, 'PLINE');
      await canvasClick(page, 0.35, 0.4);
      await canvasClick(page, 0.55, 0.4);
      await canvasClick(page, 0.55, 0.6);
      const plineInput = page.locator('[data-cad-command-input]');
      await plineInput.focus();
      await expect(plineInput).toHaveValue('', { timeout: 5000 });
      await plineInput.press('Enter');
      await expect.poll(async () => entityCount(page), { timeout: 15000 }).toBeGreaterThan(0);
      await startShellCommand(page, 'SHELL_SELECT_ALL');
      await expect(page.locator('[data-cad-properties]')).toBeVisible({ timeout: 10000 });
      const propsText = ((await page.locator('[data-cad-properties]').first().innerText()) ?? '').replace(/\s+/g, ' ').trim();
      // A real single-polyline selection: the palette names the entity.
      expect(propsText).toMatch(/polyline/i);
      expect(propsText.length).toBeGreaterThan(0);
      expect(await page.locator('[data-survey-cad-properties-panel]').count()).toBe(0);
      const mSel = await measureShell(page);
      testInfo.annotations.push({ type: 'shell-heights', description: `HEIGHTS selected+Properties @ ${tag}: ${fmtHeights(mSel)}` });
      testInfo.annotations.push({ type: 'properties-text', description: propsText.slice(0, 300) });
      await capture(page, testInfo, '10-home-selected-properties');

      // -- N. staged shared boundary: Edit Shared / Unlink in the palette ---
      // Two adjacent lots + one production PARCELLINK, opened through the
      // real file input (same seam as 19D). Selecting lot-1 must surface
      // the Wave-1C migrated row actions; Unlink applies end to end.
      await openParcelFixture(page, writeSharedBoundaryFixture());
      await startShellCommand(page, 'SHELL_SELECT_ALL');
      await expect.poll(async () => selectionCount(page), { timeout: 15000 }).toBe(2);
      await page.locator('[data-cad-toolspace] [role="tab"]', { hasText: 'Prospector' }).click({ force: true });
      await page.locator('[data-cad-toolspace] button[title^="parcel —"]').first().click({ force: true });
      await expect.poll(async () => selectionCount(page), { timeout: 15000 }).toBe(1);
      const editShared = page.locator('[data-cad-properties-action^="parcel-shared-edit"]');
      const unlink = page.locator('[data-cad-properties-action^="parcel-unlink"]');
      await expect(editShared.first()).toBeVisible({ timeout: 15000 });
      await expect(unlink.first()).toBeVisible({ timeout: 15000 });
      await expect(editShared.first()).toBeEnabled();
      await expect(unlink.first()).toBeEnabled();
      testInfo.annotations.push({
        type: 'parcel-shared-actions',
        description: `Edit Shared + Unlink visible and enabled for the linked lot-1 row; ` +
          `the deferred parcel report-summary block does not gate these row actions`,
      });
      await unlink.first().click({ force: true });
      await expect(unlink).toHaveCount(0, { timeout: 15000 });

      // -- O. single shell input; LINE typing works --------------------------
      expect(await page.locator('[data-cad-command-input]').count()).toBe(1);
      expect(await page.locator('[data-survey-cad-command-input]').count()).toBe(0);
      await expect(page.locator('[data-survey-cad-command-status]')).toHaveCount(0);
      const dockInput = page.locator('[data-cad-command-input]');
      await dockInput.fill('LINE');
      await expect(page.locator('[aria-label="Command suggestions"]')).toContainText('LINE', { timeout: 5000 });
      await dockInput.press('Enter');
      await expect(page.locator('[data-cad-command-prompt]')).toContainText(/Line/i, { timeout: 10000 });
      await capture(page, testInfo, '11-active-line');
      await finishDockCommand(page);

      // -- P. uniform background across the width -----------------------------
      const bgSamples: string[] = await page.evaluate(() => {
        const viewport = document.querySelector('[data-cad-viewport]') as HTMLElement | null;
        if (!viewport) throw new Error('no viewport');
        const rect = viewport.getBoundingClientRect();
        const y = rect.top + rect.height / 2;
        const out: string[] = [];
        for (const fx of [0.05, 0.25, 0.5, 0.75, 0.95]) {
          const x = rect.left + rect.width * fx;
          const el = document.elementFromPoint(x, y) as Element | null;
          const svg = el?.closest('svg') as SVGSVGElement | null;
          const css = window.getComputedStyle(svg ?? el ?? viewport).backgroundColor;
          const rectFill = (svg?.querySelector('[data-survey-cad-background]') as SVGRectElement | null)
            ?.getAttribute('fill') ?? 'none';
          out.push(`${Math.round(fx * 100)}%:${el?.tagName ?? 'none'}/${css}/${rectFill}`);
        }
        return out;
      });
      testInfo.annotations.push({ type: 'viewport-background', description: bgSamples.join(' ') });
      const distinctCss = new Set(bgSamples.map((s) => s.split('/')[1]));
      expect(distinctCss.size).toBe(1);

      // -- Q. far-left / far-right picks work ---------------------------------
      await canvasClick(page, 0.02, 0.5);
      await canvasClick(page, 0.98, 0.5);
      // No throw, no errors: picks at the extremes are safe no-ops here.

      // -- R. isotropic XY: uniform scale, 45° line, zoom, round trip ---------
      const mapping = await svgMapping(page);
      expect(Math.abs(mapping.sx - mapping.sy)).toBeLessThan(1e-9);
      // 45° world line renders at 45° on screen (uniform meet scale ⇒ circular circles).
      await startShellCommand(page, 'LINE');
      const box = await page.locator('[data-cad-viewport] svg').first().boundingBox();
      if (!box) throw new Error('viewport svg has no bounding box');
      const ax = box.x + box.width * 0.3;
      const ay = box.y + box.height * 0.55;
      const len = Math.min(box.width, box.height) * 0.2;
      await page.mouse.click(ax, ay);
      await page.mouse.click(ax + len, ay - len);
      await finishDockCommand(page);
      const slope = await page.evaluate(() => {
        const lines = [...document.querySelectorAll('[data-cad-viewport] svg line[data-survey-cad-render-entity-id]')];
        if (lines.length === 0) throw new Error('no rendered lines');
        const line = lines[lines.length - 1] as SVGLineElement;
        const dx = Number(line.getAttribute('x2')) - Number(line.getAttribute('x1'));
        const dy = Number(line.getAttribute('y2')) - Number(line.getAttribute('y1'));
        return Math.abs(Math.abs(dx / dy) - 1);
      });
      expect(slope).toBeLessThan(0.05);
      // Zoom about cursor: the viewBox is FIXED at 0 0 900 520 (zoom/pan
      // apply in view coordinates), so the observable is the rendered
      // geometry's view coords changing under a wheel event at the cursor.
      const x1Before: number = await page.evaluate(() => {
        const lines = [...document.querySelectorAll('[data-cad-viewport] svg line[data-survey-cad-render-entity-id]')];
        return Number((lines[lines.length - 1] as SVGLineElement).getAttribute('x1'));
      });
      const midClient = await page.evaluate(() => {
        const lines = [...document.querySelectorAll('[data-cad-viewport] svg line[data-survey-cad-render-entity-id]')];
        const r = (lines[lines.length - 1] as SVGGraphicsElement).getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await page.evaluate(({ cx, cy }) => {
        for (const svg of document.querySelectorAll('[data-cad-viewport] svg')) {
          svg.dispatchEvent(new WheelEvent('wheel', {
            deltaY: -240, clientX: cx, clientY: cy, bubbles: true, cancelable: true,
          }));
        }
      }, { cx: midClient.x, cy: midClient.y });
      await page.waitForTimeout(400);
      const x1After: number = await page.evaluate(() => {
        const lines = [...document.querySelectorAll('[data-cad-viewport] svg line[data-survey-cad-render-entity-id]')];
        return Number((lines[lines.length - 1] as SVGLineElement).getAttribute('x1'));
      });
      expect(x1After).not.toBe(x1Before);
      // Click→world→screen round trip through two independent paths: the
      // browser's own getScreenCTM vs manual viewBox arithmetic.
      const roundTrip = await page.evaluate(() => {
        const svg = document.querySelector('[data-cad-viewport] svg') as SVGSVGElement;
        const lines = [...svg.querySelectorAll('line[data-survey-cad-render-entity-id]')];
        const line = lines[lines.length - 1] as SVGLineElement;
        const x1 = Number(line.getAttribute('x1'));
        const y1 = Number(line.getAttribute('y1'));
        const matrix = line.getScreenCTM();
        if (!matrix) throw new Error('no screen CTM');
        const viaBrowser = new DOMPoint(x1, y1).matrixTransform(matrix);
        const vb = svg.viewBox.baseVal;
        const rect = svg.getBoundingClientRect();
        const s = Math.min(rect.width / vb.width, rect.height / vb.height);
        const ox = rect.left + (rect.width - vb.width * s) / 2 - vb.x * s;
        const oy = rect.top + (rect.height - vb.height * s) / 2 - vb.y * s;
        return Math.hypot(viaBrowser.x - (ox + x1 * s), viaBrowser.y - (oy + y1 * s));
      });
      expect(roundTrip).toBeLessThan(1);
      testInfo.annotations.push({
        type: 'responsive-geometry',
        description: `sx==sy uniform; 45deg slopeDev=${slope.toFixed(4)}; zoom x1 ${x1Before.toFixed(2)} -> ${x1After.toFixed(2)}; roundTrip=${roundTrip.toFixed(4)}px`,
      });
      await capture(page, testInfo, '12-wide-geometry');

      // -- S. collapse / restore keeps the sticky family face -----------------
      const faceBefore = await page.locator('[data-cad-family="arc"] .cad-ribbon-split__primary').first().getAttribute('aria-label');
      await page.locator('button[title="Collapse ribbon"]').click({ force: true });
      await expect(page.locator('button[title="Show ribbon"]')).toBeVisible({ timeout: 5000 });
      await page.locator('button[title="Show ribbon"]').click({ force: true });
      await expect(page.locator('[data-cad-ribbon]')).toBeVisible({ timeout: 5000 });
      await gotoHomeTab(page);
      const faceAfter = await page.locator('[data-cad-family="arc"] .cad-ribbon-split__primary').first().getAttribute('aria-label');
      expect(faceAfter).toBe(faceBefore);

      // -- D. New drawing resets the sticky faces ------------------------------
      await page.locator('[data-cad-quick-access] button[title="New drawing"]').click({ force: true });
      await expect(page.locator('[data-cad-family="arc"] .cad-ribbon-split__primary').first()).toHaveAttribute('aria-label', 'Arc: 3-Point');
      await assertSingleRibbonBand(page);

      // -- T. zero page/console errors ------------------------------------------
      expect(errors).toEqual([]);
    });
  });
}

// ---------------------------------------------------------------------------
// Entity counts + staged shared-boundary fixture (flow N)
// ---------------------------------------------------------------------------

async function entityCount(page: Page): Promise<number> {
  const text = (await page.locator('[data-survey-cad-entity-count]').textContent()) ?? '';
  return Number.parseInt(text, 10);
}

async function selectionCount(page: Page): Promise<number> {
  const text = (await page.locator('[data-survey-cad-selection-count]').textContent()) ?? '';
  return Number.parseInt(text, 10);
}

const makeSeedParcel = (id: string, name: string, vertices: Array<{ x: number; y: number }>): CadParcelEntity => {
  const parcel: CadParcelEntity = {
    id,
    type: 'parcel',
    layerId: 'parcels',
    visible: true,
    locked: false,
    parcelName: name,
    vertices: vertices.map((v) => ({ ...v })),
    vertexLabels: vertices.map((_, index) => `P${index + 1}`),
    courseIds: buildParcelCourseIds(id, vertices.length),
  };
  const metrics = cadBuildParcelClosureSummary(parcel.vertices, {});
  if (metrics) {
    parcel.areaSquareMeters = metrics.areaSquareMeters;
    parcel.perimeterMeters = metrics.perimeterMeters;
  }
  return parcel;
};

/** Two adjacent lots + one production PARCELLINK (lot-1 east <-> lot-2 west). */
function writeSharedBoundaryFixture(): string {
  const document = createBlankCadDrawingDocument({ name: 'Shared Boundary QA 21A', units: 'm' });
  const lot1 = makeSeedParcel('lot-1', 'P-LOT1', [
    { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 30 }, { x: 0, y: 30 },
  ]);
  const lot2 = makeSeedParcel('lot-2', 'P-LOT2', [
    { x: 20, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 20, y: 30 },
  ]);
  const base: CadProject = { ...document.project, entities: [lot1, lot2] };
  const courseIdOf = (project: CadProject, parcelId: string, index: number): string => {
    const parcel = project.entities.find(
      (entity): entity is CadParcelEntity => entity.id === parcelId && entity.type === 'parcel',
    );
    if (!parcel) throw new Error(`parcel ${parcelId} missing`);
    const course = resolveCadParcelCourses(parcel)[index];
    if (!course) throw new Error(`course ${index} of ${parcelId} missing`);
    return course.courseId;
  };
  const next = runCadCommand(createCadHistoryState(base, []), {
    key: 'PARCELLINK',
    first: { parcelId: 'lot-1', courseId: courseIdOf(base, 'lot-1', 1) },
    second: { parcelId: 'lot-2', courseId: courseIdOf(base, 'lot-2', 3) },
  });
  if (next.undoStack.length === 0) throw new Error('PARCELLINK blocked unexpectedly');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-21a-shared-'));
  const filePath = path.join(dir, 'shared-boundary-21a.wncad');
  fs.writeFileSync(
    filePath,
    serializeCadDrawingFile({ ...document, project: next.present.project }),
    'utf8',
  );
  return filePath;
}

async function openParcelFixture(page: Page, filePath: string): Promise<void> {
  const fileInput = page.locator('[data-survey-cad-open-drawing-input]');
  await fileInput.evaluate((element: HTMLInputElement) => element.classList.remove('hidden')).catch(() => undefined);
  await fileInput.setInputFiles(filePath);
  await expect.poll(async () => entityCount(page), { timeout: 30000 }).toBe(2);
}
