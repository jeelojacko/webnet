/**
 * Phase 13B Track E — survey drafting end-to-end (Chromium).
 *
 * Dedicated harness page (same pattern as map-pan-harness.html): seeds an
 * original-data model, then walks the full plan-production flow A-S through
 * the real drafting engine + SheetWorkspace + exporters + .wncad round-trip.
 */
import { expect, test } from '@playwright/test';

test.describe('Survey drafting deliverables', () => {
  test('model to sheet to export to saved .wncad reload in a real browser', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/survey-drafting-harness.html');
    await expect(page.getByTestId('draft-harness-ready')).toHaveText('ready');

    const log = page.getByTestId('draft-flow-log');
    const step = async (id: string): Promise<void> => {
      await page.getByTestId(`draft-step-${id}`).click();
      await expect(log.getByText(new RegExp(`^${id}:`))).toBeVisible();
    };

    // A: model geometry (4 parcel corners + 1 COGO point + 4 lines + 1 arc + 1 parcel).
    await step('A');
    await expect(page.getByTestId('draft-model-count')).toHaveText('entities:11');

    // B: bearing/distance label derived from model geometry.
    await step('B');
    await expect(log.getByText(/^B:/)).toContainText('50.000 m');

    // C: point labels for every model point.
    await step('C');
    await expect(log.getByText(/^C:/)).toContainText('point-labels:5');

    // D: curve label from arc geometry.
    await step('D');
    await expect(log.getByText(/^D:/)).toContainText('R ');

    // E/F: sheet + ISO A4 size + explicit-scale viewport.
    await step('E');
    await expect(page.getByTestId('draft-sheet-info')).toContainText('C1 - Plan');
    await expect(page.getByTestId('draft-sheet-info')).toContainText('297x210');
    await step('F');
    await expect(page.getByTestId('draft-viewport-info')).toContainText('scale:1:500');

    // G: explicit scale kept + 15° rotation.
    await step('G');
    await expect(page.getByTestId('draft-viewport-info')).toContainText('rotation:15');

    // H: grid-north arrow counter-rotates (345.0°) in the real sheet preview.
    await step('H');
    const workspace = page.locator('section[aria-label="Draft workspace"]');
    await workspace.getByRole('tab', { name: 'Sheet' }).click();
    await expect(workspace.getByLabel(/Grid north arrow \(grid north, 345\.0 degrees\)/)).toBeVisible();
    await expect(workspace.getByLabel('Scale bar 1:500')).toBeVisible();

    // I/J/K: scale bar + title block + coordinate table.
    await step('I');
    await expect(log.getByText(/^I:/)).toContainText('scalebar:4x10m');
    await step('J');
    await expect(log.getByText(/^J:/)).toContainText('C1 - Plan @ 1:500');
    await step('K');
    await expect(page.getByTestId('draft-table-info')).toHaveText('table-rows:5');
    await expect(page.getByTestId('draft-point-table')).toContainText('P1');

    // L/M/N: SVG, PDF, DXF exports are non-empty.
    await step('L');
    await step('M');
    await step('N');
    const exportInfo = await page.getByTestId('draft-export-info').textContent();
    const lengths = (exportInfo ?? '').split(':').map(Number).filter((n) => Number.isFinite(n));
    expect(lengths).toHaveLength(3);
    lengths.forEach((length) => expect(length).toBeGreaterThan(0));

    // O/P: save .wncad, reload → v2.
    await step('O');
    await expect(log.getByText(/^O:/)).toBeVisible();
    const coordsBefore = await page.evaluate(
      () => (globalThis as { __SURVEY_DRAFTING_HARNESS__?: { getModelCoords: () => string } }).__SURVEY_DRAFTING_HARNESS__?.getModelCoords(),
    );
    await step('P');
    await expect(log.getByText(/^P:/)).toContainText('reloaded:v2');

    // Q/R: sheet persists with its explicit scale; model coords unchanged.
    await step('Q');
    await expect(log.getByText(/^Q:/)).toContainText('scale:1:500');
    await step('R');
    await expect(log.getByText(/^R:/)).toContainText('model-coords-unchanged:true');
    const coordsAfter = await page.evaluate(
      () => (globalThis as { __SURVEY_DRAFTING_HARNESS__?: { getModelCoords: () => string } }).__SURVEY_DRAFTING_HARNESS__?.getModelCoords(),
    );
    expect(coordsAfter).toBe(coordsBefore);

    // S: flow summary + genuine file-input reload of the saved bytes.
    await step('S');
    await expect(log.getByText(/^S:/)).toContainText('flow-complete');
    const saved = await page.evaluate(
      () => (globalThis as { __SURVEY_DRAFTING_HARNESS__?: { getSavedWncad: () => string | undefined } }).__SURVEY_DRAFTING_HARNESS__?.getSavedWncad(),
    );
    expect(saved).toContain('webnet-cad-drawing');
    await page.getByTestId('draft-open-input').setInputFiles({
      name: 'harness-plan.wncad',
      mimeType: 'application/json',
      buffer: Buffer.from(saved ?? ''),
    });
    await expect(log.getByText('file:reloaded:via-input')).toBeVisible();
    await expect(page.getByTestId('draft-sheet-info')).toContainText('C1 - Plan');

    expect(pageErrors).toEqual([]);
  });
});
