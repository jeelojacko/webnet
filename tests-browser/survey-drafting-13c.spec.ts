/**
 * Phase 13C §53 — survey drafting browser E2E extension (Chromium).
 *
 * Walks missions A-S through the 13C harness steps: 13B sample → dense
 * auto-place → manual move + leader → second viewport → continued table →
 * second sheet → title-block edit/duplicate → SVG/PDF/R12/layout exports →
 * LandXML preview/confirm → save/reopen → persistence + adjustment freeze.
 */
import { expect, test } from '@playwright/test';

test.describe('Survey drafting 13C extended flow', () => {
  test('dense labels to LandXML to saved reload in a real browser', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/survey-drafting-harness.html');
    await expect(page.getByTestId('draft-harness-ready')).toHaveText('ready');

    const log = page.getByTestId('draft13c-flow-log');
    const step = async (id: string): Promise<void> => {
      await page.getByTestId(`draft13c-step-${id}`).click();
      await expect(log.getByText(new RegExp(`^${id}:`))).toBeVisible();
    };

    // A: open the 13B sample (seeded model + plan sheet + viewport).
    await step('A');
    await expect(log.getByText(/^A:/)).toContainText('entities:');
    await expect(page.getByTestId('draft13c-info')).toContainText('sheets:1');

    // B: auto-place dense cluster labels (all placed, deterministic).
    await step('B');
    await expect(log.getByText(/^B:/)).toContainText('auto-place:12-labels');
    await expect(page.getByTestId('draft13c-info')).toContainText('labels:12');

    // C: manually move one label → MANUAL + leader persists.
    await step('C');
    await expect(log.getByText(/^C:/)).toContainText('placement:MANUAL');
    await expect(log.getByText(/^C:/)).toContainText('leader:true');

    // D: same geometry, second viewport → auto-placed, manual kept.
    await step('D');
    await expect(log.getByText(/^D:/)).toContainText('manual-kept:true');

    // E: overflowing coordinate table → continued fragments.
    await step('E');
    await expect(log.getByText(/^E:/)).toContainText('continued:true');
    await expect(page.getByTestId('draft13c-info')).toContainText('tables:1');

    // F: continue to a second sheet.
    await step('F');
    await expect(log.getByText(/^F:/)).toContainText('sheets:2');

    // G/H: edit + duplicate the title-block template.
    await step('G');
    await expect(log.getByText(/^G:/)).toContainText('elements:2');
    await step('H');
    await expect(log.getByText(/^H:/)).toContainText('templates:2');

    // I/J/K/L: SVG, PDF, R12 model DXF, layout DXF — all non-empty.
    await step('I');
    await step('J');
    await step('K');
    await step('L');
    await expect(log.getByText(/^L:/)).toContainText('layouts:2');
    const exportInfo = await page.getByTestId('draft13c-export-info').textContent();
    const lengths = (exportInfo ?? '').split(':').filter((_, i) => i % 2 === 1).map(Number);
    expect(lengths).toHaveLength(4);
    lengths.forEach((length) => expect(length).toBeGreaterThan(0));

    // M: LandXML fixture preview → points + spiral warning.
    await step('M');
    await expect(log.getByText(/^M:/)).toContainText('points:3');
    await expect(log.getByText(/^M:/)).toContainText('spirals:1');

    // N: confirm import → geometry lands in the model.
    await step('N');
    await expect(log.getByText(/^N:/)).toContainText('entities:');

    // O/P: save .wncad, reopen.
    await step('O');
    await expect(log.getByText(/^O:/)).toContainText('saved:');
    await step('P');
    await expect(log.getByText(/^P:/)).toContainText('reloaded:ok');

    // Q: placements, templates, and imported geometry persist.
    await step('Q');
    await expect(log.getByText(/^Q:/)).toContainText('templates:2');
    await expect(log.getByText(/^Q:/)).toContainText('manual:1');

    // R: adjustment/GNSS state unchanged by the drafting flow.
    await step('R');
    await expect(log.getByText(/^R:/)).toContainText('adjustment-unchanged:true');

    // S: flow summary.
    await step('S');
    await expect(log.getByText(/^S:/)).toContainText('flow-complete');

    expect(pageErrors).toEqual([]);
  });
});
