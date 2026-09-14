/**
 * Phase 12J.4 — real-browser raw static-baseline review workflow.
 *
 * Real app + real dedicated Worker + real pinned rnx2rtkp WASM
 * (served from public/ by `npm run e2e:raw-review`; staged automatically,
 * never committed): synthetic base/rover/NAV load →
 * metadata → process → review (vector + FORMAL_UNCALIBRATED) → JSON
 * export → project unchanged. Swap reverses the vector sign; bad inputs
 * block at preflight without WASM; cancel keeps no stale result.
 */
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const FX = 'tests/fixtures/gnssRaw';

test.describe('Raw static baseline processing', () => {
  test('synthetic pair processes to review, exports JSON, project unchanged', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto('/');
    // Project-unchanged proof: the autosaved workspace snapshot carries the
    // terrestrial input text; record it once the app writes it.
    await page.waitForFunction(
      () => localStorage.getItem('webnet.workspace-recovery.v1') != null,
      null,
      { timeout: 30_000 },
    );
    const projectInput = (): Promise<string> => page.evaluate(() => {
      const raw = localStorage.getItem('webnet.workspace-recovery.v1') ?? '{}';
      try {
        return (JSON.parse(raw) as { snapshot?: { input?: unknown } }).snapshot?.input as string ?? raw;
      } catch {
        return raw;
      }
    });
    const inputBefore = await projectInput();

    await page.getByRole('button', { name: 'Process Raw Baseline' }).click();
    const dialog = page.getByRole('dialog', { name: 'Raw static baseline processing' });
    await expect(dialog).toBeVisible();

    await dialog.getByTestId('raw-base-input').setInputFiles(`${FX}/base.06o`);
    await dialog.getByTestId('raw-rover-input').setInputFiles(`${FX}/rover.06o`);
    await dialog.getByTestId('raw-nav-input').setInputFiles(`${FX}/nav.06n`);
    await expect(dialog.getByTestId('raw-metadata-table')).toContainText('SYNB');
    await expect(dialog.getByTestId('raw-metadata-table')).toContainText('SYNR');
    await expect(dialog.getByTestId('raw-common-span')).toBeVisible();
    // No ingest path: nothing in this dialog adds to the project.
    await expect(dialog.getByRole('button', { name: /add to/i })).toHaveCount(0);

    await dialog.getByTestId('raw-process').click();
    await expect(dialog.getByTestId('raw-progress')).toBeVisible();
    await expect(dialog.getByTestId('raw-review')).toBeVisible({ timeout: 120_000 });
    await expect(dialog.getByTestId('raw-formal-badge')).toContainText('FORMAL_UNCALIBRATED');
    const vectorAB = (await dialog.getByTestId('raw-vector').textContent()) ?? '';
    expect(vectorAB).toContain('dX');

    // Synthetic fixtures converge FLOAT: diagnostic JSON only, NOT EXPORTABLE.
    await expect(dialog.getByTestId('raw-float-policy')).toContainText('NOT EXPORTABLE');
    await expect(dialog.getByTestId('raw-export-json')).toHaveCount(0);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByTestId('raw-export-diagnostic').click(),
    ]);
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const exported = JSON.parse(await readFile(downloadPath!, 'utf8')) as {
      kind: string;
      result: { status: string; covarianceAssessment: { status: string } };
    };
    expect(exported.kind).toBe('webnet-raw-static-baseline/1');
    expect(exported.result.status).toBe('FLOAT');
    expect(exported.result.covarianceAssessment.status).toBe('FORMAL_UNCALIBRATED');

    // Cancel-while-running keeps no stale result.
    await dialog.getByTestId('raw-process').click();
    await dialog.getByTestId('raw-cancel').click();
    await expect(dialog.getByTestId('raw-cancelled')).toBeVisible();
    await expect(dialog.getByTestId('raw-review')).toHaveCount(0);

    // Swap reverses the vector sign at the same length.
    const nums = (text: string): number[] => (text.match(/-?\d+\.\d+/g) ?? []).map(Number);
    await dialog.getByTestId('raw-reset').click();
    await dialog.getByTestId('raw-swap').click();
    await expect(dialog.getByTestId('raw-metadata-table')).toContainText('ROVER base.06o');
    await dialog.getByTestId('raw-process').click();
    await expect(dialog.getByTestId('raw-review')).toBeVisible({ timeout: 120_000 });
    const vectorBA = (await dialog.getByTestId('raw-vector').textContent()) ?? '';
    const [dx1 = 0, dy1 = 0, dz1 = 0, len1 = 0] = nums(vectorAB);
    const [dx2 = 0, dy2 = 0, dz2 = 0, len2 = 0] = nums(vectorBA);
    expect(dx1 * dx2 + dy1 * dy2 + dz1 * dz2).toBeLessThan(0);
    expect(Math.abs(len2 - len1) / len1).toBeLessThan(0.1);
    // Swap back: original roles restored, no leak.
    await dialog.getByTestId('raw-swap').click();
    await expect(dialog.getByTestId('raw-metadata-table')).toContainText('BASE base.06o');

    await page.keyboard.press('Escape');
    expect(await projectInput()).toBe(inputBefore);
    expect(pageErrors).toEqual([]);
  });

  test('preflight blocks bad inputs without processing', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto('/');
    await page.getByRole('button', { name: 'Process Raw Baseline' }).click();
    const dialog = page.getByRole('dialog', { name: 'Raw static baseline processing' });
    await expect(dialog).toBeVisible();

    // Missing NAV: process stays disabled.
    await dialog.getByTestId('raw-base-input').setInputFiles(`${FX}/base.06o`);
    await dialog.getByTestId('raw-rover-input').setInputFiles(`${FX}/rover.06o`);
    await expect(dialog.getByTestId('raw-process')).toBeDisabled();

    // Galileo-only rover: no GPS observations.
    await dialog.getByTestId('raw-nav-input').setInputFiles(`${FX}/nav.06n`);
    await dialog.getByTestId('raw-rover-input').setInputFiles(`${FX}/galileo_only.06o`);
    await expect(dialog.getByTestId('raw-preflight-error')).toContainText('NO_GPS_OBSERVATIONS');

    // No common time.
    await dialog.getByTestId('raw-rover-input').setInputFiles(`${FX}/rover_nooverlap.06o`);
    await expect(dialog.getByTestId('raw-preflight-error')).toContainText('NO_COMMON_TIME');

    // Precise without SP3 fails closed.
    await dialog.getByTestId('raw-rover-input').setInputFiles(`${FX}/rover.06o`);
    await dialog.getByTestId('raw-ephemeris').selectOption('PRECISE');
    await expect(dialog.getByTestId('raw-preflight-error')).toContainText('PRECISE_PRODUCT_MISSING');

    expect(pageErrors).toEqual([]);
  });
});
