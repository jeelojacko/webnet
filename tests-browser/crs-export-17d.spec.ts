/**
 * Phase 17D manual browser gate (flows A-E) through the real browser bundle:
 * real LSAEngine solves + real exporters + real integrity gates.
 */
import { expect, test } from '@playwright/test';

test.describe('Phase 17D CRS export browser gate', () => {
  test('A-E: projected solve exports lon/lat + LandXML CRS; local/invalid blocked; stale/label rules hold', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/crs-export-harness.html');
    await expect(page.getByTestId('crs-harness-ready')).toHaveText('ready');

    const log = page.getByTestId('crs-flow-log');
    const runStep = async (id: string): Promise<void> => {
      await page.getByTestId(`crs-step-${id}`).click();
      await expect(log.getByText(new RegExp(`^${id}: PASS`))).toBeVisible();
    };

    // A: valid projected CRS — solve, CSV, lon/lat GeoJSON, LandXML CRS.
    await runStep('A');
    await expect(log.getByText(/^A: solve ok/)).toBeVisible();
    await expect(log.getByText(/GeoJSON lon\/lat ok/)).toBeVisible();
    await expect(log.getByText(/LandXML CoordinateSystem/)).toBeVisible();
    const coords = (await page.getByTestId('crs-geojson-coords').textContent()) ?? '';
    const [lon, lat] = coords.split(',').map(Number);
    expect(Number.isFinite(lon) && Number.isFinite(lat)).toBe(true);
    expect(Math.abs(lon as number)).toBeLessThan(180);
    expect(Math.abs(lat as number)).toBeLessThan(90);
    // Unmistakably lon/lat near the NB false origin — never EN metres.
    expect(Math.abs((lon as number) + 66.5)).toBeLessThan(0.05);
    expect(Math.abs((lat as number) - 46.5)).toBeLessThan(0.05);
    await expect(page.getByTestId('crs-landxml-crs')).toHaveText('EPSG:2953');

    // B: local project — CSV ok, GeoJSON blocked with reason.
    await runStep('B');
    await expect(log.getByText(/GeoJSON blocked with FORMAT_REQUIRES_GEOGRAPHIC/)).toBeVisible();

    // C: invalid CRS — blocked, no silent fallback.
    await runStep('C');
    await expect(log.getByText(/no silent fallback/)).toBeVisible();

    // D: actual CRS change marks stale, rerun required.
    await runStep('D');
    await expect(log.getByText(/STALE, rerun required/)).toBeVisible();

    // E: label-only edit stays fresh.
    await runStep('E');
    await expect(log.getByText(/remains FRESH/)).toBeVisible();

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
