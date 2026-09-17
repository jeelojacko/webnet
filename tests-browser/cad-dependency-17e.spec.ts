/**
 * Phase 17E browser gate (flows A-I) through the real browser bundle:
 * real LSAEngine solves + real CAD dependency/import/export engines.
 */
import { expect, test } from '@playwright/test';

test.describe('Phase 17E CAD dependency browser gate', () => {
  test('A-I: import CURRENT, edit STALE, rerun FRESH/CAD STALE, refresh, F2F sync, ownership, parcel, gates, round-trip', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/cad-dependency-harness.html');
    await expect(page.getByTestId('cad-harness-ready')).toHaveText('ready');

    const log = page.getByTestId('cad-flow-log');
    const chip = page.locator('[data-survey-cad-dependency-status]');
    const runStep = async (id: string): Promise<void> => {
      await page.getByTestId(`cad-step-${id}`).click();
      await expect(log.getByText(new RegExp(`^${id}: PASS`))).toBeVisible();
    };

    // A: solve → import → chip CURRENT.
    await runStep('A');
    await expect(log.getByText(/^A: solve ok stations=/)).toBeVisible();
    await expect(chip).toContainText('CURRENT');
    await expect(page.getByTestId('cad-result-state')).toHaveText('FRESH_SUCCESS');

    // B: edit observation → result STALE + CAD chip warns.
    await runStep('B');
    await expect(page.getByTestId('cad-result-state')).toHaveText('STALE_SUCCESS');
    await expect(chip).toContainText('STALE');

    // C: rerun → result FRESH, non-F2F CAD still STALE until refresh.
    await runStep('C');
    await expect(page.getByTestId('cad-result-state')).toHaveText('FRESH_SUCCESS');
    await expect(chip).toContainText('STALE');

    // D: refresh adjusted points → CURRENT.
    await runStep('D');
    await expect(chip).toContainText('CURRENT');

    // E: linked F2F drawing → rerun → associative sync CURRENT.
    await runStep('E');
    await expect(log.getByText(/associative CAD CURRENT/)).toBeVisible();
    await expect(page.getByTestId('cad-f2f-info')).toContainText('CAD:CURRENT');

    // F: Import Adjusted Points on linked-F2F drawing preserves F2F linework.
    await runStep('F');
    await expect(log.getByText(/F2F entities preserved/)).toBeVisible();
    await expect(page.getByTestId('cad-import-info')).toContainText('skippedF2f:');

    // G: parcel follows moved source point, metrics coherent.
    await runStep('G');
    await expect(page.getByTestId('cad-parcel-info')).toContainText('CURRENT');

    // H: stale drawing → DXF/LandXML blocked with reason; WNCAD works.
    await runStep('H');
    await expect(page.getByTestId('cad-export-dxf')).toContainText('blocked');
    await expect(page.getByTestId('cad-export-landxml')).toContainText('blocked');
    await expect(page.getByTestId('cad-export-wncad')).toHaveText('allowed');

    // I: save stale WNCAD → reopen → staleness preserved.
    await runStep('I');
    await expect(log.getByText(/staleness preserved STALE/)).toBeVisible();

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
