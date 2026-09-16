import { expect, test } from '@playwright/test';

// Phase 14C worker 2 browser evidence: stochastic diagnostics section renders
// for a realistic terrestrial job and a failed-chi-square synthetic case at
// 1366 and 1440 split-pane widths, with no observation-table widening and the
// 14B CoordEff column intact.
test.describe('Stochastic diagnostics browser validation', () => {
  for (const width of [1366, 1440]) {
    test(`renders at ${width}px without widening observation tables`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));

      await page.setViewportSize({ width, height: 900 });
      await page.goto('/stochastic-harness.html');
      await expect(page.getByTestId('stochastic-harness-ready')).toHaveText('ready');

      for (const caseId of ['case-terrestrial', 'case-failed-chi']) {
        const block = page.getByTestId(caseId);
        await expect(block).toContainText('Stochastic model diagnostics');
        // Per-group table present (not the unavailable fallback).
        await expect(block).toContainText('Eqns');
        // 14B CoordEff column intact in the observation table.
        await expect(block).toContainText('CoordEff');
        // No observation-table widening: no horizontal overflow of the pane.
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

      // Failed-chi-square pointer present only on the synthetic case.
      await expect(page.getByTestId('case-failed-chi')).toContainText(
        'Global stochastic model failed. Largest estimated group scale:',
      );
      expect(pageErrors).toEqual([]);
    });
  }
});
