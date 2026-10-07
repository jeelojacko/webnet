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

interface FlyoutOpen {
  flyout: ReturnType<Page['locator']>;
  box: { x: number; y: number; width: number; height: number };
}

/**
 * Open a family flyout and resolve only once its fixed box has settled.
 *
 * Product law: focus-on-open never scrolls (preventScroll); the browser's
 * own bring-into-view scroll of the ribbon strip is exempt once, same frame,
 * with an unmoved caret. Any genuine user scroll still closes, so one
 * ordinary click settles. No retry masking: if the menu self-closes, this
 * helper fails loudly. A stable caret rect is awaited BEFORE clicking only to
 * avoid anchoring mid-relayout.
 */
async function openFamilyFlyout(page: Page, familyId: string): Promise<FlyoutOpen> {
  const caret = page.locator(`[data-cad-family-caret="${familyId}"]`);
  const flyout = page.locator(`[data-cad-ribbon-flyout="${familyId}"]`);
  await expect(caret).toBeVisible({ timeout: 10_000 });
  let last = '';
  await expect
    .poll(async () => {
      const rect = await caret.boundingBox();
      const current = rect ? `${Math.round(rect.x)},${Math.round(rect.y)}` : '';
      const settled = current !== '' && current === last;
      last = current;
      return settled;
    }, { timeout: 5000, intervals: [100, 100, 250] })
    .toBe(true);

  await caret.click();
  await expect(flyout).toBeAttached({ timeout: 5000 });
  await expect(flyout).toBeVisible({ timeout: 5000 });
  await expect
    .poll(async () => {
      const rect = await flyout.boundingBox();
      return rect != null && rect.width > 0 && rect.height > 0;
    }, { timeout: 5000 })
    .toBe(true);
  const box = await flyout.boundingBox();
  if (!box) throw new Error(`flyout ${familyId} has no box after single open click`);
  return { flyout, box };
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

const DESKTOP_FAMILIES = ['line', 'arc', 'curves', 'circle'] as const;

for (const resolution of RESOLUTIONS) {
  test.describe(`Phase 21B flyout hardening @ ${resolution.width}x${resolution.height}`, () => {
    test.use({ viewport: { width: resolution.width, height: resolution.height } });

    test('strip is nowrap/vertically clipped and desktop flyouts show their full list', async ({ page }) => {
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

      // Desktop law (post-L1): every family shows its NATURAL full list —
      // inside the viewport, no vertical overflow, no horizontal overflow,
      // and no fixed product cap. Overflow is measured, never assumed.
      for (const familyId of DESKTOP_FAMILIES) {
        const { flyout, box } = await openFamilyFlyout(page, familyId);
        expect(box.width).toBeGreaterThan(0);
        expect(box.height).toBeGreaterThan(0);
        expect(box.x).toBeGreaterThanOrEqual(-0.5);
        expect(box.y).toBeGreaterThanOrEqual(-0.5);
        expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 0.5);
        expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 0.5);
        const metrics = await flyout.evaluate((el) => ({
          scrollH: el.scrollHeight,
          clientH: el.clientHeight,
          scrollW: el.scrollWidth,
          clientW: el.clientWidth,
          overflowY: window.getComputedStyle(el).overflowY,
          docOverflow: document.documentElement.scrollHeight - window.innerHeight,
        }));
        expect(metrics.scrollH).toBeLessThanOrEqual(metrics.clientH + 1);
        expect(metrics.scrollW).toBeLessThanOrEqual(metrics.clientW + 1);
        expect(metrics.overflowY).toBe('auto');
        expect(metrics.docOverflow).toBeLessThanOrEqual(1);
        test.info().annotations.push({
          type: `flyout-fit-${familyId}`,
          description: `@ ${vp.width}x${vp.height} ${familyId}: ` +
            `scrollH/clientH=${metrics.scrollH}/${metrics.clientH} (no vertical overflow)`,
        });
        await page.keyboard.press('Escape');
        await expect(flyout).toHaveCount(0);
      }

      // Selection still works from a desktop flyout.
      await page.locator('[data-cad-family-caret="line"]').click({ force: true });
      const lineFlyout = page.locator('[data-cad-ribbon-flyout="line"]');
      await expect(lineFlyout).toBeVisible({ timeout: 5000 });
      await page.locator('[data-cad-ribbon-flyout="line"] [data-cad-variant="line-create"]').click({ force: true });
      await expect(lineFlyout).toHaveCount(0);
      await expect(page.locator('[data-cad-family="line"] .cad-ribbon-split__primary').first())
        .toHaveAttribute('aria-label', 'Line: Create Line');

      // A far-right family (clipped by the strip) still anchors on-screen:
      // the anchor helper clamps with the shared flyout width constant.
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

      // Outside-click, external scroll, and resize all close with no grace.
      for (const closer of ['scroll', 'resize']) {
        await page.locator('[data-cad-family-caret="arc"]').click({ force: true });
        await expect(arcFlyout).toBeVisible({ timeout: 5000 });
        await page.evaluate((eventName) => window.dispatchEvent(new Event(eventName)), closer);
        await expect(arcFlyout).toHaveCount(0);
      }

      test.info().annotations.push({
        type: 'ribbon-flyout-fit',
        description: `@ ${vp.width}x${vp.height} strip overflowY=hidden, desktop flyouts natural-height; ` +
          `hatch caret x=${hatchCaretLeft.toFixed(0)}`,
      });
      expect(errors).toEqual([]);
    });
  });
}

// ---------------------------------------------------------------------------
// 3. Short-viewport fallback: internal scroll keeps the menu open
// ---------------------------------------------------------------------------

test.describe('Phase 21B short-viewport flyout fallback @ 1366x360', () => {
  test.use({ viewport: { width: 1366, height: 360 } });

  test('Line flyout scrolls internally, stays open, then a lower variant selects', async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    await bootCad(page, errors);
    await gotoHomeTab(page);

    const vp = page.viewportSize();
    if (!vp) throw new Error('no viewport size');

    const { flyout, box } = await openFamilyFlyout(page, 'line');

    const start = await flyout.evaluate((el) => ({
      scrollH: el.scrollHeight,
      clientH: el.clientHeight,
      scrollTop: el.scrollTop,
    }));
    // Short viewport: the 17-row list overflows and must scroll internally.
    expect(start.scrollH).toBeGreaterThan(start.clientH + 1);
    expect(start.scrollTop).toBe(0);

    // The box still stays fully inside the viewport.
    expect(box.y).toBeGreaterThanOrEqual(-0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 0.5);
    test.info().annotations.push({
      type: 'flyout-fallback-line',
      description: `@ ${vp.width}x${vp.height} line: scrollH/clientH=${start.scrollH}/${start.clientH} ` +
        `box=${Math.round(box.width)}x${Math.round(box.height)} bottom=${Math.round(box.y + box.height)} (internal scroll)`,
    });

    // Real wheel scroll: scrollTop moves and the menu REMAINS OPEN, across
    // multiple scrolls (overscroll-behavior: contain stops page chaining).
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(center.x, center.y);
    await page.mouse.wheel(0, 200);
    await expect.poll(() => flyout.evaluate((el) => el.scrollTop), { timeout: 5000 }).toBeGreaterThan(0);
    await expect(flyout).toBeVisible();

    const afterFirst = await flyout.evaluate((el) => el.scrollTop);
    await page.mouse.wheel(0, 200);
    await expect.poll(() => flyout.evaluate((el) => el.scrollTop), { timeout: 5000 }).toBeGreaterThan(afterFirst);
    await expect(flyout).toBeVisible();

    // Scrollbar drag: headless Chromium hides native scrollbars
    // (offsetWidth === clientWidth), so a classic thumb/track drag is not
    // reproducible. The equivalent internal-scroll contract is proven by the
    // captured-scroll component test (tests/cad_ribbon_controls.test.tsx
    // L1-A/L1-C) plus this real wheel scrollTop proof. If a classic scrollbar
    // IS present, perform the drag.
    const scrollbarWidth = await flyout.evaluate((el) => el.offsetWidth - el.clientWidth);
    if (scrollbarWidth > 2) {
      const trackX = box.x + box.width - Math.max(1, scrollbarWidth / 2);
      await page.mouse.move(trackX, box.y + box.height - 4);
      await page.mouse.down();
      await page.mouse.move(trackX, box.y + 4, { steps: 5 });
      await page.mouse.up();
      await expect(flyout).toBeVisible();
    } else {
      test.info().annotations.push({
        type: 'scrollbar-drag',
        description: 'headless Chromium hides native scrollbars (offsetWidth === clientWidth); ' +
          'internal-scroll contract proven by component scroll test + real wheel scrollTop',
      });
    }

    // Still open after all scrolling; a lower variant is brought into view
    // with real wheel scrolls, proven visible + hit-testable with a stable
    // box, then chosen with one ORDINARY click (no force): the sticky face
    // updates and the menu closes normally.
    const lowerVariant = 'line-perpendicular-from-point';
    const lowerRow = page.locator(`[data-cad-ribbon-flyout="line"] [data-cad-variant="${lowerVariant}"]`);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (await lowerRow.isVisible().catch(() => false)) break;
      await page.mouse.wheel(0, 200);
      await page.waitForTimeout(100);
    }
    await lowerRow.scrollIntoViewIfNeeded({ timeout: 5000 });
    await expect(lowerRow).toBeVisible({ timeout: 5000 });
    const rowBoxFirst = await lowerRow.boundingBox();
    expect(rowBoxFirst).not.toBeNull();
    expect(rowBoxFirst!.width).toBeGreaterThan(0);
    expect(rowBoxFirst!.height).toBeGreaterThan(0);
    await page.waitForTimeout(100);
    const rowBoxSecond = await lowerRow.boundingBox();
    expect(rowBoxSecond).not.toBeNull();
    expect(Math.abs(rowBoxSecond!.x - rowBoxFirst!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(rowBoxSecond!.y - rowBoxFirst!.y)).toBeLessThanOrEqual(1);
    await lowerRow.click();
    await expect(flyout).toHaveCount(0);
    await expect(page.locator('[data-cad-family="line"] .cad-ribbon-split__primary').first())
      .toHaveAttribute('aria-label', 'Line: Create Line Perpendicular from Point');

    // Reopen the height-capped menu with that lower variant now current. Focus
    // must land on the current row and the flyout must scroll ITSELF to reveal
    // it: the finding's regression was focus left off-screen while the capped
    // menu sat at scrollTop 0. One ordinary caret click, no force.
    const { flyout: reopened } = await openFamilyFlyout(page, 'line');
    const activeVariant = (): Promise<string | null> =>
      page.evaluate(
        () =>
          (document.activeElement as HTMLElement | null)?.getAttribute('data-cad-variant') ?? null,
      );
    const activeRowInsideFlyout = (): Promise<boolean> =>
      reopened.evaluate((el) => {
        const active = document.activeElement as HTMLElement | null;
        if (active == null) return false;
        const rowRect = active.getBoundingClientRect();
        const flyoutRect = el.getBoundingClientRect();
        // The flyout's client rect is its scroll viewport (border excluded);
        // the focused row must sit fully inside it, not merely inside the box.
        const innerTop = flyoutRect.top + el.clientTop;
        const innerBottom = innerTop + el.clientHeight;
        return rowRect.top >= innerTop - 0.5 && rowRect.bottom <= innerBottom + 0.5;
      });
    const reopenedScrollTop = (): Promise<number> =>
      reopened.evaluate((el) => el.scrollTop);

    expect(await activeVariant()).toBe(lowerVariant);
    expect(await activeRowInsideFlyout()).toBe(true);
    expect(await reopenedScrollTop()).toBeGreaterThan(0);
    await expect(reopened).toBeVisible();

    // Arrow / Home / End: focus moves, the menu stays open, and the focused row
    // is always revealed inside the flyout (no ancestor pan, no self-close).
    await page.keyboard.press('ArrowUp');
    await expect.poll(activeVariant).toBe('line-tangent-from-point');
    expect(await activeRowInsideFlyout()).toBe(true);
    await expect(reopened).toBeVisible();

    await page.keyboard.press('ArrowDown');
    await expect.poll(activeVariant).toBe(lowerVariant);
    expect(await activeRowInsideFlyout()).toBe(true);
    await expect(reopened).toBeVisible();

    await page.keyboard.press('Home');
    await expect.poll(activeVariant).toBe('line-create');
    expect(await activeRowInsideFlyout()).toBe(true);
    // Home returns to the top of the menu (the first row carries the 3px box
    // padding in its offsetTop, so the settled scrollTop is ~0-3, not 0).
    await expect.poll(reopenedScrollTop).toBeLessThan(8);
    await expect(reopened).toBeVisible();

    await page.keyboard.press('End');
    await expect.poll(activeVariant).toBe(lowerVariant);
    expect(await activeRowInsideFlyout()).toBe(true);
    await expect.poll(reopenedScrollTop).toBeGreaterThan(0);
    await expect(reopened).toBeVisible();

    test.info().annotations.push({
      type: 'flyout-keyboard-reveal',
      description: `@ ${vp.width}x${vp.height} reopen focused ${lowerVariant} inside capped menu ` +
        `(scrollTop=${Math.round(await reopenedScrollTop())}); ArrowUp/Down+Home/End stayed open`,
    });

    // Leave via Escape so the external-scroll close law below re-proves cold.
    await page.keyboard.press('Escape');
    await expect(reopened).toHaveCount(0);

    // External scroll still closes on a short viewport, with no open-scroll
    // grace: the dispatch proves the genuine law on the first frame.
    await page.locator('[data-cad-family-caret="line"]').click({ force: true });
    await expect(flyout).toBeVisible({ timeout: 5000 });
    await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
    await expect(flyout).toHaveCount(0);

    expect(errors).toEqual([]);
  });
});
