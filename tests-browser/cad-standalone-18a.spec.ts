import { expect, test } from '@playwright/test';

const BASE = 'http://localhost:4173';

test('18A-A: direct /cad load works standalone', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${BASE}/cad`, { waitUntil: 'networkidle' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Back to Adjustment' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New Drawing' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Drawing' })).toBeVisible();
  // No Adjustment UI on /cad.
  expect(await page.getByRole('button', { name: 'Adjust', exact: true }).count()).toBe(0);
  expect(errors).toEqual([]);
});

test('18A-B: standalone drawing + reload keeps CAD usable', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${BASE}/cad`, { waitUntil: 'networkidle' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 20000 });
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('button', { name: 'New Drawing' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('18A-C: / loads Adjustment without CAD, Open CAD navigates', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: 'Open CAD' }).first()).toBeVisible({ timeout: 20000 });
  // No CAD workspace inline.
  expect(await page.locator('[data-survey-cad-preview]').count()).toBe(0);
  expect(await page.locator('[data-survey-cad-dedicated-page]').count()).toBe(0);
  await page.getByRole('button', { name: 'Open CAD' }).first().click();
  await page.waitForURL('**/cad', { timeout: 10000 });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 20000 });
  expect(errors).toEqual([]);
});

test('18A-D: invalid source token loads CAD with a warning', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${BASE}/cad?source=cad-src%3Amissing%3Afp`, { waitUntil: 'networkidle' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/is not available/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'New Drawing' })).toBeVisible();
  expect(errors).toEqual([]);
});

const seedSnapshot = async (
  page: import('@playwright/test').Page,
  sourceId: string,
): Promise<void> => {
  await page.evaluate((id: string) => {
    const identity = {
      inputFingerprint: 'input-a',
      mathFingerprint: 'math-a',
      exclusionFingerprint: 'excl-a',
      runMode: 'adjustment',
    };
    const snapshot = {
      schemaVersion: 1,
      sourceId: id,
      projectId: 'proj-a',
      projectName: 'Project A',
      runMode: 'adjustment',
      appliedRunIdentity: identity,
      resultFingerprint: 'fp-a',
      generatedAt: '2026-09-17T00:00:00.000Z',
      coordinateContext: { units: 'm', crsId: null, crsLabel: null },
      stations: {
        A: { x: 0, y: 0, h: 0, fixed: true },
        B: { x: 100, y: 0, h: 0, fixed: false },
      },
      stationCount: 2,
    };
    window.localStorage.setItem('webnet.cad-source-snapshots.v1', JSON.stringify({ [id]: snapshot }));
    window.localStorage.setItem(
      'webnet.cad-source-registry.v1',
      JSON.stringify({
        'proj-a': {
          latestSourceId: id,
          projectId: 'proj-a',
          projectName: 'Project A',
          generatedAt: snapshot.generatedAt,
          resultFingerprint: 'fp-a',
          stationCount: 2,
          appliedRunIdentity: identity,
        },
      }),
    );
  }, sourceId);
};

test('18A-E: seeded source shows pending notice, explicit import lands CURRENT', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  const sourceId = 'cad-src:proj-a:fp-a';
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await seedSnapshot(page, sourceId);
  await page.goto(`${BASE}/cad?source=${encodeURIComponent(sourceId)}`, { waitUntil: 'networkidle' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 20000 });
  // Pending notice, nothing auto-imported.
  await expect(page.locator('[data-cad-pending-source]')).toBeVisible();
  expect(await page.locator('[data-survey-cad-entity-count]').textContent()).toContain('0 entities');
  // Explicit import (controller notice; the workspace file-status stays quiet
  // because the import ran through the CAD controller, not the toolbar).
  await page.locator('[data-cad-pending-source]').getByRole('button', { name: 'Import / Refresh' }).click();
  await expect(page.getByText('Imported 2 adjusted stations from Project A.')).toBeVisible({
    timeout: 10000,
  });
  await expect(page.locator('[data-survey-cad-entity-count]')).toContainText('4 entities', {
    timeout: 10000,
  });
  await expect(page.locator('[data-survey-cad-dependency-status]')).toContainText('CURRENT');
  expect(errors).toEqual([]);
});

test('18A-FG: dirty guard blocks Back navigation until confirmed', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  const sourceId = 'cad-src:proj-a:fp-a';
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await seedSnapshot(page, sourceId);
  await page.goto(`${BASE}/cad?source=${encodeURIComponent(sourceId)}`, { waitUntil: 'networkidle' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 20000 });
  await page.locator('[data-cad-pending-source]').getByRole('button', { name: 'Import / Refresh' }).click();
  await expect(page.getByText('Imported 2 adjusted stations from Project A.')).toBeVisible({
    timeout: 10000,
  });
  // Dirty: dismiss the confirm dialog, stay on /cad.
  page.once('dialog', (dialog) => void dialog.dismiss());
  await page.getByRole('button', { name: 'Back to Adjustment' }).click();
  await page.waitForTimeout(500);
  expect(page.url()).toContain('/cad');
  // Confirm: navigation proceeds to /.
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Back to Adjustment' }).click();
  await page.waitForURL(`${BASE}/`, { timeout: 10000 });
  await expect(page.getByRole('button', { name: 'Open CAD' }).first()).toBeVisible({ timeout: 20000 });
  expect(errors).toEqual([]);
});
