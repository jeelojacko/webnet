/**
 * Phase 13E §50 — linked F2F + Export Center browser E2E (Chromium).
 *
 * Walks missions A-W through the 13E harness steps (adjustment-backed coded
 * data → F2F generation → sheet → exports → rerun auto-sync → save/reopen →
 * failure leg → settings freeze). Export-format steps F-J click the REAL
 * ExportCenterPanel tabs (same component as production SurveyCadWorkspace),
 * not dev helpers; dev step buttons only drive setup/state transitions.
 */
import { expect, test } from '@playwright/test';

test.describe('Linked F2F + Export Center 13E flow', () => {
  test('adjustment to auto-sync to saved reload in a real browser', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/survey-drafting-harness.html');
    await expect(page.getByTestId('draft-harness-ready')).toHaveText('ready');

    const log = page.getByTestId('draft13e-flow-log');
    const center = page.getByTestId('draft13e-export-center');
    const step = async (id: string): Promise<void> => {
      await page.getByTestId(`draft13e-step-${id}`).click();
      await expect(log.getByText(new RegExp(`^${id}:`))).toBeVisible();
    };
    const preview = center.locator('[aria-label="Export preview"]');
    const filename = center.locator('[data-export-center-filename]');
    const centerTab = async (name: RegExp): Promise<void> => {
      await center.getByRole('tab', { name }).click();
      await expect(preview).toBeVisible();
    };

    // A: open the project.
    await step('A');
    await expect(log.getByText(/^A:/)).toContainText('E13-Linked-F2F-Plan');

    // B: adjustment-backed coded data (3 adjusted stations).
    await step('B');
    await expect(log.getByText(/^B:/)).toContainText('stations:3');

    // C: generate F2F (linked, CURRENT).
    await step('C');
    await expect(log.getByText(/^C:/)).toContainText('CURRENT');

    // D: create sheet + viewport.
    await step('D');
    await expect(log.getByText(/^D:/)).toContainText('sheet:1');

    // E: open the Export UI (real ExportCenterPanel).
    await step('E');
    await expect(center.getByText('Export Center')).toBeVisible();
    await expect(filename).toBeVisible();

    // F: SVG export through the real panel.
    await step('F');
    await centerTab(/SVG/);
    await expect(filename).toContainText('.svg');
    await expect(log.getByText(/^F:/)).toContainText('svg:');
    expect(Number((await page.getByTestId('draft13e-export-info').textContent())?.split(':')[1] ?? 0)).toBeGreaterThan(0);

    // G: PDF all-sheets export through the real panel.
    await step('G');
    await centerTab(/PDF/);
    await center.getByLabel('PDF scope').selectOption('all');
    await expect(preview).toContainText('All sheets');
    await expect(log.getByText(/^G:/)).toContainText('pdf-all-sheets:');

    // H: R12 model DXF through the real panel.
    await step('H');
    await centerTab(/R12/);
    await expect(filename).toContainText('-model.dxf');
    await expect(log.getByText(/^H:/)).toContainText('dxf-r12:');

    // I: R2000 layout DXF through the real panel.
    await step('I');
    await centerTab(/R2000/);
    await expect(filename).toContainText('-layouts.dxf');
    await expect(log.getByText(/^I:/)).toContainText('dxf-r2000:');

    // J: LandXML through the real panel.
    await step('J');
    await centerTab(/LandXML/);
    await expect(filename).toContainText('.xml');
    await expect(log.getByText(/^J:/)).toContainText('landxml:');

    // K: warnings visible (list, empty-state, or pending notice).
    await step('K');
    await expect(log.getByText(/^K:/)).toContainText('visible:true');
    await expect(preview).toContainText(/No warnings|surface in progress|\[/);

    // L: colors/styles preserved.
    await step('L');
    await expect(log.getByText(/^L:/)).toContainText(/styles:[1-9]/);

    // M: generated linework present (A–B EDGE chain).
    await step('M');
    await expect(log.getByText(/^M:/)).toContainText(/linework:[1-9]/);

    // N: point symbols represented/warned.
    await step('N');
    await expect(log.getByText(/^N:/)).toContainText(/symbols:[0-9]+/);

    // O: rerun adjustment with a coordinate change (C moves).
    await step('O');
    await expect(log.getByText(/^O:/)).toContainText('moved-C:');

    // P: F2F auto-sync occurs (same seam as useAdjustmentOutcomeApplication).
    await step('P');
    await expect(log.getByText(/^P:/)).toContainText('changed:true');
    await expect(log.getByText(/^P:/)).toContainText(/updated:.*C/);

    // Q: manual label placement unchanged.
    await step('Q');
    await expect(log.getByText(/^Q:/)).toContainText('manual:1');
    await expect(log.getByText(/^Q:/)).toContainText('label:C:');

    // R: re-export shows the new coordinates (SVG payload changed).
    await step('R');
    await expect(log.getByText(/^R:/)).toContainText('changed:true');
    await expect(log.getByText(/^R:/)).toContainText('new-coords:true');
    await centerTab(/SVG/);
    await expect(preview).toBeVisible();

    // S: covered by R.
    await step('S');
    await expect(log.getByText(/^S:/)).toContainText('covered-by-R');

    // T: save/reopen.
    await step('T');
    await expect(log.getByText(/^T:/)).toContainText('reopened:ok');

    // U: linked state persists (status + catalog + stations).
    await step('U');
    await expect(log.getByText(/^U:/)).toContainText('stations:3');
    await expect(log.getByText(/^U:/)).toContainText('catalog:');

    // V: failed adjustment does not mutate F2F.
    await step('V');
    await expect(log.getByText(/^V:/)).toContainText('unchanged:true');

    // W: adjustment/GNSS settings unchanged.
    await step('W');
    await expect(log.getByText(/^W:/)).toContainText('settings-unchanged:true');

    expect(pageErrors).toEqual([]);
  });
});
