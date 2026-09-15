/**
 * Phase 13D — field-to-finish browser E2E (Chromium).
 *
 * Walks missions A-W through the F2F harness steps: open the F2F workflow,
 * import the terrestrial CSV fixture, column mapping, code/description
 * distinction, sample catalog, unmapped warning, linework preview, commit,
 * layers/styles/labels/linework, manual label edit, source modification,
 * regen preview/apply with manual survival, SVG/PDF/model-DXF exports,
 * .wncad save/reopen with provenance, adjustment/GNSS freeze.
 */
import { expect, test } from '@playwright/test';

test.describe('Field-to-finish 13D flow', () => {
  test('csv import to regen to saved reload in a real browser', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/survey-drafting-harness.html');
    await expect(page.getByTestId('draft-harness-ready')).toHaveText('ready');

    const log = page.getByTestId('draftf2f-flow-log');
    const step = async (id: string): Promise<void> => {
      await page.getByTestId(`draftf2f-step-${id}`).click();
      await expect(log.getByText(new RegExp(`^${id}:`))).toBeVisible();
    };

    // A: open the F2F workflow (catalog editor + import review + preview).
    await step('A');
    await expect(log.getByText(/^A:/)).toContainText('f2f-open');

    // B: import the terrestrial CSV fixture (13 points, meters).
    await step('B');
    await expect(log.getByText(/^B:/)).toContainText('points:13');
    await expect(page.getByTestId('draftf2f-info')).toContainText('points:13');

    // C: column mapping is visible (header-driven + Trimble preset).
    await step('C');
    await expect(log.getByText(/^C:/)).toContainText('mapping:Point->id');

    // D: codes and descriptions are distinct in preview rows.
    await step('D');
    await expect(log.getByText(/^D:/)).toContainText('distinct:true');

    // E: sample catalog loaded (7 definitions, EP alias, implicit CENTERLINE).
    await step('E');
    await expect(log.getByText(/^E:/)).toContainText('defs:7');
    await expect(log.getByText(/^E:/)).toContainText('EP->EDGE');
    await expect(log.getByText(/^E:/)).toContainText('implicit:true');

    // F: unmapped warning visible (ROCK).
    await step('F');
    await expect(log.getByText(/^F:/)).toContainText('unmapped:1');

    // G: linework preview (EDGE + BUILDING + CENTERLINE chains).
    await step('G');
    await expect(log.getByText(/^G:/)).toContainText('chains:3');

    // H: commit — points, linework, labels, unmapped land in the model.
    await step('H');
    await expect(log.getByText(/^H:/)).toContainText('points:13');
    await expect(log.getByText(/^H:/)).toContainText('linework:3');
    await expect(log.getByText(/^H:/)).toContainText('unmapped:1');
    await expect(page.getByTestId('draftf2f-info')).toContainText('catalog:sample-generic');

    // I/J/K/L: layers, styles/symbols, labels, linework present.
    await step('I');
    await expect(log.getByText(/^I:/)).toContainText('layers:4/4');
    await step('J');
    await expect(log.getByText(/^J:/)).toContainText('styles:');
    await step('K');
    await expect(log.getByText(/^K:/)).toContainText('labels:');
    await step('L');
    await expect(log.getByText(/^L:/)).toContainText('linework:3');

    // M: manual label edit → MANUAL_OVERRIDE.
    await step('M');
    await expect(log.getByText(/^M:/)).toContainText('MANUAL_OVERRIDE');

    // N: modify the source (L2 +0.5 E); O: regen preview shows the delta.
    await step('N');
    await expect(log.getByText(/^N:/)).toContainText('L2');
    await step('O');
    await expect(log.getByText(/^O:/)).toContainText('regen-preview:');

    // P: regen with manual placement surviving.
    await step('P');
    await expect(log.getByText(/^P:/)).toContainText('manual-surviving:1');

    // Q/R/S: SVG, PDF, model DXF — all non-empty.
    await step('Q');
    await step('R');
    await step('S');
    const exportInfo = await page.getByTestId('draftf2f-export-info').textContent();
    const lengths = (exportInfo ?? '').split(':').filter((_, i) => i % 2 === 1).map(Number);
    expect(lengths).toHaveLength(3);
    lengths.forEach((length) => expect(length).toBeGreaterThan(0));

    // T/U: save .wncad, reopen with provenance/catalog retained.
    await step('T');
    await expect(log.getByText(/^T:/)).toContainText('saved:');
    await step('U');
    await expect(log.getByText(/^U:/)).toContainText('reopened:ok');
    await expect(log.getByText(/^U:/)).toContainText('provenance:retained');

    // V: adjustment/GNSS settings unchanged by the F2F flow.
    await step('V');
    await expect(log.getByText(/^V:/)).toContainText('adjustment-unchanged:true');

    // W: flow summary.
    await step('W');
    await expect(log.getByText(/^W:/)).toContainText('flow-complete');

    expect(pageErrors).toEqual([]);
  });
});
