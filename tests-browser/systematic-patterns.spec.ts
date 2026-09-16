import { expect, test } from '@playwright/test';

// Phase 14E browser evidence: systematic pattern diagnostics section renders
// for a combined terrestrial job and a trend fixture at 1366 and 1440
// split-pane widths, with no observation-table widening, descriptive-vs-test
// labeling obvious, and working source-line links.
test.describe('Systematic pattern diagnostics browser validation', () => {
  for (const width of [1366, 1440]) {
    test(`renders at ${width}px without widening observation tables`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));

      await page.setViewportSize({ width, height: 900 });
      await page.goto('/systematic-harness.html');
      await expect(page.getByTestId('systematic-harness-ready')).toHaveText('ready');

      for (const caseId of ['case-terrestrial', 'case-trend']) {
        const block = page.getByTestId(caseId);
        await expect(block).toContainText('Systematic pattern diagnostics');
        // Descriptive-vs-test contract visible on every subsection.
        await expect(block).toContainText('DESCRIPTIVE');
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

      // Terrestrial case: narrow-span trend gate reason + face facts.
      await expect(page.getByTestId('case-terrestrial')).toContainText(
        'intercept pattern and slope pattern not separable',
      );
      await expect(page.getByTestId('case-terrestrial')).toContainText('Face-count balance');
      // Trend case: descriptive slope + leveling drift.
      await expect(page.getByTestId('case-trend')).toContainText('mm/km');
      await expect(page.getByTestId('case-trend')).toContainText('input sequence');

      // Source-line links work: click the first one, page stays error-free.
      const firstLink = page.getByTestId('case-terrestrial').locator('a[data-testid^="srcline-"]').first();
      await expect(firstLink).toBeVisible();
      await firstLink.click();
      expect(pageErrors).toEqual([]);
    });
  }
});
