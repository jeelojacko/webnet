/**
 * New-project + default-example browser coverage
 * (branch fix/new-project-and-default-example).
 *
 * Real app + real Chromium against the Vite dev server (baseURL/webServer
 * come from playwright.config.ts). No fixtures, no engine imports: every
 * flow drives the production UI and asserts 0 page/console errors.
 */
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const EVIDENCE = path.resolve(process.cwd(), 'docs/evidence/new-project-default-example');
fs.mkdirSync(EVIDENCE, { recursive: true });

const MARKER = '.PTOL /CON APOG BROD';
const PROJECT_NAME = 'E2E Blank Project';
const KEPT_LINE = 'C E2EKEPT 100 200 10';
const EXAMPLE_TITLES = ['Pre-analysis', 'Combined', 'Combined (split files)'];

/** Collect page + console errors; assert empty at the end of each flow. */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text().slice(0, 300)}`);
  });
  return errors;
}

/** The lazy Project Options modal: the only fixed panel with solver tabs. */
const optionsModal = (page: Page): Locator =>
  page.locator('div.fixed.z-50', { hasText: 'Project Options' });

async function bootApp(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('app-toolbar')).toBeVisible({ timeout: 30_000 });
}

/** Fresh-context equivalent: wipe storage on the app origin, then reboot. */
async function bootPristine(page: Page): Promise<void> {
  await bootApp(page);
  await page.evaluate(async () => {
    try {
      const databases = (await indexedDB.databases?.()) ?? [];
      await Promise.all(
        databases.map(
          (info) =>
            new Promise<void>((resolve) => {
              if (!info.name) {
                resolve();
                return;
              }
              const request = indexedDB.deleteDatabase(info.name);
              request.onsuccess = () => resolve();
              request.onerror = () => resolve();
              request.onblocked = () => resolve();
            }),
        ),
      );
    } catch {
      // Pristine enough: storage APIs unavailable in this context.
    }
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('app-toolbar')).toBeVisible({ timeout: 30_000 });
}

const editorValue = (page: Page): Promise<string> =>
  page.locator('textarea').first().inputValue();

async function waitForEditorContaining(page: Page, needle: string): Promise<void> {
  await page.waitForFunction(
    (text) => document.querySelector('textarea')?.value.includes(text) ?? false,
    needle,
    { timeout: 30_000 },
  );
}

async function waitForEditorEmpty(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (document.querySelector('textarea') as HTMLTextAreaElement | null)?.value === '',
    null,
    { timeout: 15_000 },
  );
}

async function openProjectFilesTab(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Project Options' }).click();
  const modal = optionsModal(page);
  await expect(modal).toBeVisible({ timeout: 15_000 });
  await modal.getByRole('button', { name: 'Project Files', exact: true }).click();
  return modal;
}

async function closeOptionsModal(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(optionsModal(page)).toHaveCount(0, { timeout: 10_000 });
}

/** Row Open button for an example/recent project, keyed by its exact title. */
function rowOpenButton(modal: Locator, title: string): Locator {
  return modal
    .locator(`div:has(> div > div:text-is("${title}"))`)
    .getByRole('button', { name: 'Open' });
}

async function acceptDialogsWith(page: Page, projectName: string): Promise<void> {
  page.on('dialog', (dialog) => void dialog.accept(projectName));
}

async function createBlankProject(page: Page, modal: Locator, name: string): Promise<void> {
  const create = modal.getByRole('button', { name: 'Create New Project' });
  await expect(create).toHaveAttribute('title', 'Create a new blank local project');
  await expect(create).toHaveAttribute('aria-label', 'Create new project');
  await create.click();
  await waitForEditorEmpty(page);
  await expect(page.locator('body')).toContainText(name);
}

test('A: pristine boot seeds the combined example and lists all three built-ins', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await bootPristine(page);

  // Combined content, Adjustment mode, not preanalysis.
  await waitForEditorContaining(page, MARKER);
  expect(await editorValue(page)).toContain(MARKER);
  const modal = await openProjectFilesTab(page);
  await modal.getByRole('button', { name: 'Adjustment', exact: true }).click();
  const runMode = modal.locator('label', { hasText: 'Run Mode' }).locator('select');
  await expect(runMode).toHaveValue('adjustment');
  // Project/example chooser lists all three built-ins.
  await modal.getByRole('button', { name: 'Project Files', exact: true }).click();
  for (const title of EXAMPLE_TITLES) {
    await expect(modal.getByText(title, { exact: true })).toBeVisible();
  }

  await closeOptionsModal(page);
  await page.screenshot({ path: `${EVIDENCE}/a-fresh-startup-combined.png` });
  const reopened = await openProjectFilesTab(page);
  await reopened.screenshot({ path: `${EVIDENCE}/a-project-files-examples.png` });
  await closeOptionsModal(page);
  expect(errors).toEqual([]);
});

test('B: Create new project makes a genuinely blank project', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackErrors(page);
  await acceptDialogsWith(page, PROJECT_NAME);
  await bootApp(page);
  // Prior combined content is present before the create (what gets discarded).
  await waitForEditorContaining(page, MARKER);

  const modal = await openProjectFilesTab(page);
  await createBlankProject(page, modal, PROJECT_NAME);

  // Adjustment: run mode Adjustment, local (no CRS).
  await modal.getByRole('button', { name: 'Adjustment', exact: true }).click();
  await expect(modal.locator('label', { hasText: 'Run Mode' }).locator('select')).toHaveValue(
    'adjustment',
  );
  await expect(
    modal.locator('label', { hasText: 'Coord System Mode' }).locator('select'),
  ).toHaveValue('local');
  // No instruments.
  await modal.getByRole('button', { name: 'Instrument', exact: true }).click();
  await expect(modal).toContainText('No instrument selected');
  // GPS section: everything off, no model selected.
  await modal.getByRole('button', { name: 'GPS', exact: true }).click();
  await expect(modal.getByText('Enabled', { exact: true })).toHaveCount(0);
  await expect(modal).toContainText('Geoid/Grid Model');
  // No stale result/report from the prior combined content.
  await expect(page.locator('body')).not.toContainText('Converged');
  await expect(page.locator('body')).toContainText('No result');

  await closeOptionsModal(page);
  await page.screenshot({ path: `${EVIDENCE}/b-blank-new-project.png` });
  expect(errors).toEqual([]);
});

test('C: new project content is independent from the built-in examples', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = trackErrors(page);
  await acceptDialogsWith(page, PROJECT_NAME);
  await bootApp(page);
  await waitForEditorContaining(page, MARKER);

  let modal = await openProjectFilesTab(page);
  await createBlankProject(page, modal, PROJECT_NAME);
  await closeOptionsModal(page);
  await page.locator('textarea').first().fill(`${KEPT_LINE}\n`);
  await expect.poll(() => editorValue(page), { timeout: 10_000 }).toContain(KEPT_LINE);

  // Save, then open the Combined example: it shows canonical content.
  modal = await openProjectFilesTab(page);
  await modal.getByRole('button', { name: 'Save Local Project' }).click();
  await expect(modal).toContainText(PROJECT_NAME);
  await rowOpenButton(modal, 'Combined').click();
  await waitForEditorContaining(page, MARKER);
  expect(await editorValue(page)).toContain(MARKER);
  expect(await editorValue(page)).not.toContain(KEPT_LINE);

  // Switch back: the new project kept its own content; the example is intact.
  await modal.getByRole('button', { name: 'Project Files', exact: true }).click();
  await rowOpenButton(modal, PROJECT_NAME).click();
  await expect.poll(() => editorValue(page), { timeout: 15_000 }).toContain(KEPT_LINE);
  await closeOptionsModal(page);
  await page.screenshot({ path: `${EVIDENCE}/c-back-on-new-project-kept-content.png` });
  expect(errors).toEqual([]);
});

test('D: reload restores the untitled default; pristine context boots combined again', async ({
  page,
  browser,
}: {
  page: Page;
  browser: Browser;
}) => {
  test.setTimeout(180_000);
  const errors = trackErrors(page);
  await acceptDialogsWith(page, PROJECT_NAME);
  await bootApp(page);
  await waitForEditorContaining(page, MARKER);

  // Named new project with its own saved content.
  let modal = await openProjectFilesTab(page);
  await createBlankProject(page, modal, PROJECT_NAME);
  await closeOptionsModal(page);
  await page.locator('textarea').first().fill(`${KEPT_LINE}\n`);
  modal = await openProjectFilesTab(page);
  await modal.getByRole('button', { name: 'Save Local Project' }).click();
  await expect(modal).toContainText(PROJECT_NAME);
  await closeOptionsModal(page);

  // Reload: the untitled combined default is restored (named content is not
  // resurrected into the editor), while the saved project stays in recents.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('app-toolbar')).toBeVisible({ timeout: 30_000 });
  await waitForEditorContaining(page, MARKER);
  expect(await editorValue(page)).toContain(MARKER);
  expect(await editorValue(page)).not.toContain(KEPT_LINE);
  modal = await openProjectFilesTab(page);
  await expect(modal).toContainText(PROJECT_NAME);
  await closeOptionsModal(page);
  await page.screenshot({ path: `${EVIDENCE}/d-after-reload-combined-default.png` });

  // Pristine context boots the combined default again.
  const freshContext = await browser.newContext();
  try {
    const fresh = await freshContext.newPage();
    const freshErrors = trackErrors(fresh);
    await bootPristine(fresh);
    await waitForEditorContaining(fresh, MARKER);
    expect(await editorValue(fresh)).toContain(MARKER);
    await fresh.screenshot({ path: `${EVIDENCE}/d-pristine-combined-default.png` });
    expect(freshErrors).toEqual([]);
  } finally {
    await freshContext.close();
  }
  expect(errors).toEqual([]);
});
