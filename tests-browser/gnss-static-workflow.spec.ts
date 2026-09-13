/**
 * Phase 12G — real-browser static GNSS workflow (§30 A-F core path).
 *
 * Real app + real production worker (TypeScript route for the tiny
 * sample; no WASM needed): open workspace, load synthetic sample, fix
 * datum, adjust, read results, export buttons present.
 */
import { expect, test } from '@playwright/test';

test.describe('Static GNSS workspace', () => {
  test('sample import to adjusted results in the real app', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');
    const openButton = page.getByRole('button', { name: 'Static GNSS workspace' });
    await expect(openButton).toBeVisible({ timeout: 30_000 });
    await openButton.click();

    const dialog = page.getByRole('dialog', { name: 'Static GNSS baseline workspace' });
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Load synthetic sample' }).click();
    await expect(dialog).toContainText('Import summary');
    await expect(dialog).toContainText('SYNTH-WGS84(G2139)');
    await expect(dialog).toContainText('8 in 1 component(s)');

    await expect(dialog.getByRole('button', { name: 'SYN_A control: fixed XYZ' })).toBeVisible();
    await dialog.getByRole('button', { name: 'SYN_B control: free' }).click();
    await expect(dialog.getByRole('button', { name: 'SYN_B control: fixed XYZ' })).toBeVisible();
    await dialog.getByRole('button', { name: 'SYN_B control: fixed XYZ' }).click();
    await expect(dialog.getByRole('button', { name: 'SYN_B control: free' })).toBeVisible();

    await dialog.getByRole('button', { name: 'Adjust (production route)' }).click();
    await expect(dialog).toContainText('Adjusted ECEF stations', { timeout: 60_000 });
    await expect(dialog).toContainText('Loop QC');
    await expect(dialog).toContainText('Removal impact');
    await expect(dialog).toContainText('Export text report');
    expect(pageErrors).toEqual([]);
  });
});
