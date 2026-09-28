/**
 * Phase 21B §§9-13 — compact-ribbon hardening browser QA.
 *
 * Playwright (Chromium) against the real /cad shell only. Two concerns:
 *
 * 1. Sticky tool-family faces survive everything except New/Open, driven
 *    through the real shell paths (flyout selection, quick-access Save,
 *    ribbon collapse/restore, typed dock alias, New Drawing, model Open,
 *    sheet-tab Open).
 * 2. The nowrap ribbon strip clips vertically (overflow-y: hidden) and the
 *    fixed tool-family flyout still paints: it always stays inside the
 *    viewport, caps its own height, and scrolls internally. Run per
 *    resolution because the anchor clamps differ by width.
 *
 * ENVIRONMENT NOTE: this container's Playwright pipeline produces no
 * compositor frames, so all interactions are dispatched/forced and every
 * assertion is DOM/geometry based (same convention as the 21A spec).
 */
import { expect, test, type Page } from '@playwright/test';

const RESOLUTIONS = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
] as const;

const SAMPLE_WNCAD = 'public/examples/survey_plan_sample.wncad';
const SAMPLE_ENTITIES = 21;

// ---------------------------------------------------------------------------
// Boot / shell helpers
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
  const show = page.locator('button[title="Show ribbon"]');
  if (await show.isVisible().catch(() => false)) await show.click({ force: true });
  await expect(page.locator('[data-cad-ribbon]')).toBeVisible({ timeout: 10000 });
}

const ribbonTab = (page: Page, name: string) =>
  page.locator('[aria-label="Ribbon tabs"]').getByRole('tab', { name });

async function gotoHomeTab(page: Page): Promise<void> {
  await ribbonTab(page, 'Home').click({ force: true });
}

async function finishDockCommand(page: Page): Promise<void> {
  const input = page.locator('[data-cad-command-input]');
  await input.focus();
  await input.press('Escape');
  await page.waitForTimeout(150);
}

async function entityCount(page: Page): Promise<number> {
  const text = (await page.locator('[data-survey-cad-entity-count]').textContent()) ?? '';
  return Number.parseInt(text, 10);
}

const arcFace = (page: Page) =>
  page.locator('[data-cad-family="arc"] .cad-ribbon-split__primary').first();

async function selectArcVariant(page: Page, variantId: string): Promise<void> {
  await page.locator('[data-cad-family-caret="arc"]').click({ force: true });
  await expect(page.locator('[data-cad-ribbon-flyout="arc"]')).toBeVisible({ timeout: 5000 });
  await page.locator(`[data-cad-ribbon-flyout="arc"] [data-cad-variant="${variantId}"]`).click({ force: true });
  await finishDockCommand(page);
}

/** Model-tab Open: the hidden file input owned by SurveyCadWorkspace. */
async function openModelFixture(page: Page, filePath: string): Promise<void> {
  const input = page.locator('[data-survey-cad-open-drawing-input]');
  await input.evaluate((element: HTMLInputElement) => element.classList.remove('hidden')).catch(() => undefined);
  await input.setInputFiles(filePath);
  await expect.poll(() => entityCount(page), { timeout: 30000 }).toBe(SAMPLE_ENTITIES);
}

/** Sheet-tab Open: the shell-level input used while a layout sheet is active. */
async function openSheetFixture(page: Page, filePath: string): Promise<void> {
  await page.locator('[data-cad-shell-open-drawing-input]').setInputFiles(filePath);
}

// ---------------------------------------------------------------------------
// 1. Sticky-face lifecycle through real shell paths
// ---------------------------------------------------------------------------

test.describe('Phase 21B sticky-face lifecycle @ 1366x768', () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test('flyout pick is sticky; Save/collapse/typed alias keep it; New/Open reset it', async ({ page }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    await bootCad(page, errors);
    await gotoHomeTab(page);

    // Default face is Arc 3-Point.
    await expect(arcFace(page)).toHaveAttribute('aria-label', 'Arc: 3-Point');

    // Flyout pick sticks (real caret + row path).
    await selectArcVariant(page, 'arc-sce');
    await expect(arcFace(page)).toHaveAttribute('aria-label', 'Arc: Start, Center, End');

    // Save must NOT reset the sticky face (real quick-access Save download).
    const download = page.waitForEvent('download', { timeout: 30000 });
    await page.locator('[data-cad-quick-access] button[title="Save the drawing (WNCAD)"]').click({ force: true });
    await download;
    await gotoHomeTab(page);
    await expect(arcFace(page)).toHaveAttribute('aria-label', 'Arc: Start, Center, End');

    // Collapse / restore must NOT reset it.
    await page.locator('button[title="Collapse ribbon"]').click({ force: true });
    await expect(page.locator('button[title="Show ribbon"]')).toBeVisible({ timeout: 5000 });
    await page.locator('button[title="Show ribbon"]').click({ force: true });
    await expect(page.locator('[data-cad-ribbon]')).toBeVisible({ timeout: 5000 });
    await gotoHomeTab(page);
    await expect(arcFace(page)).toHaveAttribute('aria-label', 'Arc: Start, Center, End');

    // A typed dock command starts but does NOT move the sticky face.
    const input = page.locator('[data-cad-command-input]');
    await input.fill('ARC_SCA');
    await input.press('Enter');
    await expect(page.locator('[data-cad-command-prompt]')).toContainText(/Arc/i, { timeout: 10000 });
    await expect(arcFace(page)).toHaveAttribute('aria-label', 'Arc: Start, Center, End');
    await finishDockCommand(page);

    // New Drawing resets to the default.
    await page.locator('[data-cad-quick-access] button[title="New drawing"]').click({ force: true });
    await expect(arcFace(page)).toHaveAttribute('aria-label', 'Arc: 3-Point');

    // Model-tab Open resets too.
    await selectArcVariant(page, 'arc-sce');
    await expect(arcFace(page)).toHaveAttribute('aria-label', 'Arc: Start, Center, End');
    await openModelFixture(page, SAMPLE_WNCAD);
    await expect(arcFace(page)).toHaveAttribute('aria-label', 'Arc: 3-Point');

    // Sheet-tab Open resets as well (reviewer follow-up path).
    await selectArcVariant(page, 'arc-sce');
    await expect(arcFace(page)).toHaveAttribute('aria-label', 'Arc: Start, Center, End');
    await page.getByRole('button', { name: 'Add layout sheet' }).click({ force: true });
    await page
      .locator('[aria-label="Model and layout tabs"]')
      .getByRole('tab', { name: /Layout/ })
      .first()
      .click({ force: true });
    await openSheetFixture(page, SAMPLE_WNCAD);
    await expect(arcFace(page)).toHaveAttribute('aria-label', 'Arc: 3-Point', { timeout: 15000 });

    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Flyout stays in viewport while the strip clips vertically
// ---------------------------------------------------------------------------

for (const resolution of RESOLUTIONS) {
  test.describe(`Phase 21B flyout hardening @ ${resolution.width}x${resolution.height}`, () => {
    test.use({ viewport: { width: resolution.width, height: resolution.height } });

    test('strip is nowrap/vertically clipped and fixed flyouts stay on-screen', async ({ page }) => {
      test.setTimeout(120_000);
      const errors: string[] = [];
      await bootCad(page, errors);
      await gotoHomeTab(page);

      // The strip clips vertically (overflow-y: hidden) and never wraps.
      const strip = await page.evaluate(() => {
        const el = document.querySelector('[data-cad-ribbon] .cad-shell-ribbon-groups') as HTMLElement | null;
        if (!el) throw new Error('ribbon groups missing');
        const style = window.getComputedStyle(el);
        // Horizontal scroll is the access path for narrow widths: setting
        // scrollLeft must actually move when the strip overflows.
        const before = el.scrollLeft;
        el.scrollLeft = el.scrollWidth;
        const canScrollX = el.scrollWidth > el.clientWidth;
        return {
          overflowY: style.overflowY,
          flexWrap: style.flexWrap,
          scrollH: el.scrollHeight,
          clientH: el.clientHeight,
          stripCount: document.querySelectorAll('[data-cad-ribbon] .cad-shell-ribbon-groups').length,
          canScrollX,
          movedX: el.scrollLeft > before,
        };
      });
      expect(strip.stripCount).toBe(1);
      expect(strip.flexWrap).toBe('nowrap');
      expect(strip.overflowY).toBe('hidden');
      expect(strip.scrollH).toBeLessThanOrEqual(strip.clientH + 1);
      // If the strip overflows, the horizontal access path still works.
      if (strip.canScrollX) expect(strip.movedX).toBe(true);

      const vp = page.viewportSize();
      if (!vp) throw new Error('no viewport size');

      // Every open flyout stays inside the viewport with a capped box.
      for (const familyId of ['arc', 'line', 'curves']) {
        await page.locator(`[data-cad-family-caret="${familyId}"]`).click({ force: true });
        const flyout = page.locator(`[data-cad-ribbon-flyout="${familyId}"]`);
        await expect(flyout).toBeVisible({ timeout: 5000 });
        const box = await flyout.boundingBox();
        if (!box) throw new Error(`flyout ${familyId} has no box`);
        expect(box.width).toBeGreaterThan(0);
        expect(box.height).toBeGreaterThan(0);
        expect(box.x).toBeGreaterThanOrEqual(-0.5);
        expect(box.y).toBeGreaterThanOrEqual(-0.5);
        expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 0.5);
        expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 0.5);
        const capped = await flyout.evaluate((el) => ({
          maxHeight: Number.parseFloat(window.getComputedStyle(el).maxHeight),
          overflowY: window.getComputedStyle(el).overflowY,
        }));
        expect(capped.maxHeight).toBeLessThanOrEqual(260.5);
        expect(capped.overflowY).toBe('auto');
        await page.keyboard.press('Escape');
        await expect(flyout).toHaveCount(0);
      }

      // The line flyout has more rows than the 260px cap: it scrolls
      // internally rather than growing the page.
      await page.locator('[data-cad-family-caret="line"]').click({ force: true });
      const lineFlyout = page.locator('[data-cad-ribbon-flyout="line"]');
      await expect(lineFlyout).toBeVisible({ timeout: 5000 });
      const lineMetrics = await lineFlyout.evaluate((el) => ({
        scrollH: el.scrollHeight,
        clientH: el.clientHeight,
        docOverflow: document.documentElement.scrollHeight - window.innerHeight,
      }));
      expect(lineMetrics.scrollH).toBeGreaterThan(lineMetrics.clientH);
      expect(lineMetrics.docOverflow).toBeLessThanOrEqual(1);
      await page.keyboard.press('Escape');

      // A far-right family (clipped by the strip) still anchors on-screen:
      // the caret math clamps with the shared flyout width constant.
      const hatchCaretLeft = await page
        .locator('[data-cad-family-caret="hatch"]')
        .evaluate((el) => el.getBoundingClientRect().left);
      await page.locator('[data-cad-family-caret="hatch"]').dispatchEvent('click');
      const hatchFlyout = page.locator('[data-cad-ribbon-flyout="hatch"]');
      await expect(hatchFlyout).toBeVisible({ timeout: 5000 });
      const hatchBox = await hatchFlyout.boundingBox();
      if (!hatchBox) throw new Error('hatch flyout has no box');
      expect(hatchBox.x).toBeGreaterThanOrEqual(-0.5);
      expect(hatchBox.x + hatchBox.width).toBeLessThanOrEqual(vp.width + 0.5);
      await page.keyboard.press('Escape');

      // Overflow change must not break flyout interaction: Escape restores
      // caret focus, and outside-click / scroll / resize all close it.
      const arcFlyout = page.locator('[data-cad-ribbon-flyout="arc"]');
      await page.locator('[data-cad-family-caret="arc"]').click({ force: true });
      await expect(arcFlyout).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('Escape');
      await expect(arcFlyout).toHaveCount(0);
      expect(
        await page.evaluate(() => document.activeElement?.getAttribute('data-cad-family-caret')),
      ).toBe('arc');

      await page.locator('[data-cad-family-caret="arc"]').click({ force: true });
      await expect(arcFlyout).toBeVisible({ timeout: 5000 });
      await page.locator('[data-cad-viewport]').dispatchEvent('mousedown');
      await expect(arcFlyout).toHaveCount(0);

      for (const closer of ['scroll', 'resize']) {
        await page.locator('[data-cad-family-caret="arc"]').click({ force: true });
        await expect(arcFlyout).toBeVisible({ timeout: 5000 });
        await page.evaluate((eventName) => window.dispatchEvent(new Event(eventName)), closer);
        await expect(arcFlyout).toHaveCount(0);
      }

      test.info().annotations.push({
        type: 'ribbon-flyout-fit',
        description: `@ ${vp.width}x${vp.height} strip overflowY=hidden, flyouts in-viewport; ` +
          `hatch caret x=${hatchCaretLeft.toFixed(0)}`,
      });
      expect(errors).toEqual([]);
    });
  });
}
