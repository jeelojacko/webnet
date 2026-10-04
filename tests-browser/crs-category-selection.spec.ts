/**
 * CRS catalog category browser QA: every Catalog Group must remain selected
 * after choosing it (no snap-back to Canada Provincial), with a coherent CRS.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

const errors: string[] = [];

const optionsModal = (page: Page): Locator =>
  page.locator('div.fixed.z-50', { hasText: 'Project Options' });

async function bootApp(page: Page): Promise<void> {
  page.on('pageerror', (error) => errors.push(`page: ${error.message.slice(0, 300)}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text().slice(0, 300)}`);
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('app-toolbar')).toBeVisible({ timeout: 30_000 });
}

async function openAdjustmentTab(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Project Options' }).click();
  const modal = optionsModal(page);
  await expect(modal).toBeVisible({ timeout: 15_000 });
  await modal.getByRole('button', { name: 'Adjustment', exact: true }).click();
  return modal;
}

const groupSelect = (modal: Locator): Locator =>
  modal.locator('select[title^="Filter the CRS picker list"]');
const crsSelect = (modal: Locator): Locator =>
  modal.locator('select[title^="Selected projected CRS"]');
const modeSelect = (modal: Locator): Locator =>
  modal.locator('select[title^="Coordinate-system reduction mode"]');

test.describe('CRS category selection stays where the user puts it', () => {
  test('every category remains selected with a coherent CRS; apply/reopen coherent; zero errors', async ({
    page,
  }) => {
    await bootApp(page);
    const modal = await openAdjustmentTab(page);
    const groups = modal.locator('select[title^="Filter the CRS picker list"]');
    await expect(groupSelect(modal)).toBeVisible({ timeout: 15_000 });
    const startGroup = await groupSelect(modal).inputValue();
    expect(typeof startGroup).toBe('string');

    const categories = ['all', 'global', 'canada-utm', 'canada-mtm', 'canada-provincial', 'us-spcs'];
    for (const category of categories) {
      await groupSelect(modal).selectOption(category);
      // Next frame + short settle: the old bug snapped back on the next render.
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
      await page.waitForTimeout(150);
      await expect(groupSelect(modal)).toHaveValue(category, { timeout: 5_000 });
      const optionCount = await crsSelect(modal).locator('option').count();
      if (category === 'global') {
        expect(optionCount).toBe(0);
      } else {
        expect(optionCount).toBeGreaterThan(0);
      }
      expect(groups).toHaveCount(1);
    }

    // Grid mode: pick a real CRS from several groups.
    const modeTitle = (await modeSelect(modal).getAttribute('title')) ?? '';
    expect(modeTitle.length).toBeGreaterThan(0);
    await modeSelect(modal).selectOption('grid');
    const picks: Array<{ group: string; want: RegExp }> = [
      { group: 'canada-utm', want: /UTM_.*N/ },
      { group: 'canada-mtm', want: /MTM_/ },
      { group: 'canada-provincial', want: /CA_NAD83_CSRS_/ },
      { group: 'us-spcs', want: /SPCS_/ },
    ];
    for (const pick of picks) {
      await groupSelect(modal).selectOption(pick.group);
      await expect(groupSelect(modal)).toHaveValue(pick.group);
      const value = await crsSelect(modal)
        .locator('option')
        .nth(1)
        .getAttribute('value');
      expect(value ?? '').toMatch(pick.want);
      await crsSelect(modal).selectOption({ index: 1 });
      expect(await crsSelect(modal).inputValue()).toBe(value);
      await expect(groupSelect(modal)).toHaveValue(pick.group);
    }

    // Apply/close/reopen: chosen CRS/category relationship stays coherent.
    const chosenCrs = await crsSelect(modal).inputValue();
    const chosenGroup = await groupSelect(modal).inputValue();
    await modal.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(optionsModal(page)).toHaveCount(0, { timeout: 10_000 });
    const reopened = await openAdjustmentTab(page);
    expect(await groupSelect(reopened).inputValue()).toBe(chosenGroup);
    expect(await crsSelect(reopened).inputValue()).toBe(chosenCrs);
    await page.keyboard.press('Escape');
    await expect(optionsModal(page)).toHaveCount(0, { timeout: 10_000 });

    expect(errors).toEqual([]);
  });
});
