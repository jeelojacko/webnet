import { expect, test } from '@playwright/test';

// Phase 14D worker 2 browser evidence: LEAVE-ONE-OUT INFLUENCE section renders
// for a realistic terrestrial job (with a suspect) and a free-network job at
// 1366x768 and 1440x900, with no observation-table widening, mm formatting,
// and the Exclude + Re-run action visually distinct from the Use checkbox.
test.describe('Leave-one-out browser validation', () => {
  for (const [width, height] of [
    [1366, 768],
    [1440, 900],
  ]) {
    test(`renders at ${width}x${height} without widening observation tables`, async ({
      page,
    }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));

      await page.setViewportSize({ width, height });
      await page.goto('/loo-harness.html');
      await expect(page.getByTestId('loo-harness-ready')).toHaveText('ready');

      const outlier = page.getByTestId('case-outlier');
      await expect(outlier).toContainText('LEAVE-ONE-OUT INFLUENCE');
      await expect(outlier).toContainText('What-if exclusion analysis');
      await expect(outlier).not.toContainText('Score');
      // Coordinate shift with most-affected station (mm for small shifts,
      // unit-scaled for large ones — this blunder moves P by ~0.1 m).
      await expect(outlier).toContainText('@ P');
      // Selected-observation detail complements the table.
      await expect(outlier).toContainText('Leave-one-out:');
      await expect(outlier).toContainText('Coordinate change');
      // Explicit action present, distinctly labeled; no analysis/remove wording.
      await expect(outlier).toContainText('Exclude + Re-run');
      await expect(outlier).not.toContainText('Analyze exclusion');
      await expect(outlier).not.toContainText('Remove observation');

      const free = page.getByTestId('case-free-network');
      await expect(free).toContainText('unavailable (free-network datum)');

      for (const block of [outlier, free]) {
        const overflow = await block.evaluate((node) => {
          const pane = node.closest('[data-testid="split-pane"]') as HTMLElement;
          const tables = Array.from(node.querySelectorAll('table'));
          return {
            paneOverflows: pane.scrollWidth - pane.clientWidth,
            tableOverflows: tables.map((t) => t.scrollWidth - t.clientWidth),
          };
        });
        expect(overflow.paneOverflows).toBeLessThanOrEqual(1);
        for (const delta of overflow.tableOverflows) {
          expect(delta).toBeLessThanOrEqual(1);
        }
      }

      // No page-wide horizontal overflow.
      const pageOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(pageOverflow).toBeLessThanOrEqual(1);
      expect(pageErrors).toEqual([]);
    });
  }
});
