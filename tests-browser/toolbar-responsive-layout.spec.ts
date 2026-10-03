import { expect, test, type Locator } from '@playwright/test';

/**
 * WAVES F+G responsive-toolbar layout contract (Playwright, not vitest).
 *
 * Drives the deterministic toolbar harness (`/toolbar-harness.html`) at the
 * widths named by the mission. DOM/geometry assertions only: no screenshots
 * (compositor frames are unavailable in this container, see 21A note).
 *
 * Proves: no page/toolbar horizontal overflow, no bounding-box overlap,
 * wrapped rows always have a positive vertical gap, and the required
 * controls stay visible at every width tier.
 */

const WIDTHS = [1920, 1366, 1280, 1100, 980, 768] as const;
const OVERLAP_TOLERANCE = 0.5;

type Box = { x: number; y: number; width: number; height: number };
type LabelledBox = { label: string; box: Box };

const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width - OVERLAP_TOLERANCE &&
  b.x < a.x + a.width - OVERLAP_TOLERANCE &&
  a.y < b.y + b.height - OVERLAP_TOLERANCE &&
  b.y < a.y + a.height - OVERLAP_TOLERANCE;

const visibleButtonBoxes = async (locator: Locator): Promise<LabelledBox[]> => {
  const boxes: LabelledBox[] = [];
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const button = locator.nth(index);
    if (!(await button.isVisible())) continue;
    const box = await button.boundingBox();
    if (!box) continue;
    const label =
      (await button.getAttribute('aria-label')) ??
      (await button.textContent())?.trim() ??
      `button-${index}`;
    boxes.push({ label, box });
  }
  return boxes;
};

const assertNoOverlap = (boxes: LabelledBox[]): void => {
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      expect(
        overlaps(boxes[i].box, boxes[j].box),
        `"${boxes[i].label}" overlaps "${boxes[j].label}"`,
      ).toBe(false);
    }
  }
};

/** Vertical gaps between consecutive wrapped rows of buttons. Rows are
 * detected by vertical overlap so side-by-side buttons of differing heights
 * (items-center) stay in one row. */
const rowGaps = (boxes: LabelledBox[]): number[] => {
  const sorted = [...boxes].sort((a, b) => a.box.y - b.box.y);
  const rows: Box[][] = [];
  for (const { box } of sorted) {
    const current = rows[rows.length - 1];
    const currentBottom = current
      ? Math.max(...current.map((entry) => entry.y + entry.height))
      : Number.NEGATIVE_INFINITY;
    if (current && box.y < currentBottom - OVERLAP_TOLERANCE) {
      current.push(box);
    } else {
      rows.push([box]);
    }
  }
  const gaps: number[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const previousBottom = Math.max(...rows[i - 1].map((box) => box.y + box.height));
    const nextTop = Math.min(...rows[i].map((box) => box.y));
    gaps.push(nextTop - previousBottom);
  }
  return gaps;
};

const horizontalOverflow = (locator: Locator): Promise<number> =>
  locator.evaluate((element) => element.scrollWidth - element.clientWidth);

test.describe('responsive toolbars', () => {
  for (const width of WIDTHS) {
    test(`no overflow or overlap at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/toolbar-harness.html');
      await expect(page.getByTestId('toolbar-harness')).toBeVisible();

      const pageOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(pageOverflow, 'page horizontal overflow').toBeLessThanOrEqual(1);

      for (const host of ['running-toolbar-host', 'idle-toolbar-host']) {
        const header = page.getByTestId(host).getByTestId('app-toolbar');
        await expect(header).toBeVisible();
        expect(await horizontalOverflow(header), `${host} overflow`).toBeLessThanOrEqual(1);
        const boxes = await visibleButtonBoxes(header.locator('button'));
        assertNoOverlap(boxes);
        for (const gap of rowGaps(boxes)) expect(gap, `${host} row gap`).toBeGreaterThan(0);
      }

      const reportToolbar = page.getByTestId('report-toolbar');
      await expect(reportToolbar).toBeVisible();
      expect(await horizontalOverflow(reportToolbar), 'report toolbar overflow').toBeLessThanOrEqual(1);
      const reportBoxes = await visibleButtonBoxes(reportToolbar.locator('button'));
      assertNoOverlap(reportBoxes);
      for (const gap of rowGaps(reportBoxes)) expect(gap, 'report row gap').toBeGreaterThan(0);
    });
  }

  test('keeps required controls visible and run status readable at every tier', async ({ page }) => {
    await page.goto('/toolbar-harness.html');
    const idle = page.getByTestId('idle-toolbar-host');
    const running = page.getByTestId('running-toolbar-host');
    const reportToolbar = page.getByTestId('report-toolbar');

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await expect(running.getByText('Solving')).toBeVisible();
      await expect(idle.getByRole('button', { name: 'Adjust', exact: true })).toBeVisible();
      await expect(idle.locator('[data-result-integrity-status]')).toBeVisible();
      for (const name of ['Open project options', 'Open WebNet CAD', 'Save project']) {
        await expect(idle.getByRole('button', { name })).toBeVisible();
      }
      await expect(reportToolbar.getByText('Unit scale: 1.0000 (m)')).toBeVisible();
    }
  });

  test('report toolbar wraps with a positive vertical gap at narrow widths', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 900 });
    await page.goto('/toolbar-harness.html');
    const reportToolbar = page.getByTestId('report-toolbar');
    expect(await reportToolbar.evaluate((element) => getComputedStyle(element).flexWrap)).toBe('wrap');
    const gaps = rowGaps(await visibleButtonBoxes(reportToolbar.locator('button')));
    expect(gaps.length).toBeGreaterThanOrEqual(1);
    for (const gap of gaps) expect(gap).toBeGreaterThan(0);
  });
});
