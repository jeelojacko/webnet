/**
 * Phase 18R browser QA — PROJECTTRANSFORM through the real /cad app.
 *
 * Playwright (Chromium), NOT vitest. Flows A–O: Helmert whole drawing (A),
 * stationing (B), sample lines (C), native surface stale→rebuild honesty +
 * imported TIN (D–E), volume/profile/section refs (F–G), annotation
 * coherence (H), adjustment provenance (I), reimport-block marker (J),
 * Grid/Ground (K), undo (L), redo (M), save/reopen (N), worker late-result
 * honesty (O). Zero page/console errors asserted per test.
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

async function gotoCad(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    const record = window as unknown as Record<string, unknown>;
    delete record.showSaveFilePicker;
    delete record.showOpenFilePicker;
  });
  page.on('dialog', (dialog) => {
    if (dialog.type() === 'confirm') void dialog.accept();
  });
  await page.goto('/cad', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-cad-viewport]')).toBeVisible({ timeout: 30000 });
}

async function entityCount(page: Page): Promise<number> {
  const text = (await page.locator('[data-survey-cad-entity-count]').textContent()) ?? '';
  return Number.parseInt(text, 10);
}

async function homeTab(page: Page): Promise<void> {
  await page.locator('[data-cad-ribbon] [role="tab"]', { hasText: 'Home' }).click();
}

async function startProjectTransform(page: Page): Promise<void> {
  await homeTab(page);
  const button = page.locator('[data-cad-command="PROJECTTRANSFORM"]');
  await expect(button).toBeEnabled({ timeout: 10000 });
  await button.click();
  await expect(page.locator('[data-survey-cad-project-transform-panel]')).toBeVisible({ timeout: 10000 });
}

async function openFixture(page: Page, expected: number): Promise<void> {
  const openInput = page.locator('[data-survey-cad-open-drawing-input]');
  await openInput.evaluate((element: HTMLInputElement) => element.classList.remove('hidden')).catch(() => {});
  await openInput.setInputFiles(path.resolve('tests-browser/fixtures/cad-project-transform-18r.wncad'));
  await expect.poll(() => entityCount(page)).toBe(expected);
}

async function addHelmertPair(page: Page, text: string, row: number): Promise<void> {
  await page.locator('[data-project-transform-add-input]').fill(text);
  await page.getByRole('button', { name: 'Add Pair' }).click();
  await expect(page.locator(`[data-project-transform-row="${row}"]`)).toBeVisible({ timeout: 10000 });
}

async function downloadToTemp(page: Page, trigger: () => Promise<void>, suffix: string): Promise<string> {
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await trigger();
  const download = await downloadPromise;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wn-18r-'));
  const tempPath = path.join(dir, `download${suffix}`);
  await download.saveAs(tempPath);
  return tempPath;
}

async function saveDrawingText(page: Page): Promise<{ text: string; dir: string }> {
  const savedPath = await downloadToTemp(
    page,
    () => page.getByRole('button', { name: 'Save Drawing' }).first().click(),
    '.wncad',
  );
  return { text: fs.readFileSync(savedPath, 'utf8'), dir: path.dirname(savedPath) };
}

const savedProject = (text: string): Record<string, unknown> =>
  (JSON.parse(text) as { project: Record<string, unknown> }).project;

test.describe('Phase 18R project transform', () => {
  test('A–C/H–I: Helmert whole drawing, stationing, sample lines, annotation, provenance', async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    await gotoCad(page, errors);
    await openFixture(page, 7);

    const before = savedProject((await saveDrawingText(page)).text);
    const alignmentBefore = (before['entities'] as Array<Record<string, unknown>>).find((e) => e['id'] === 'al1') as Record<string, unknown>;
    const mtextBefore = (before['entities'] as Array<Record<string, unknown>>).find((e) => e['id'] === 'm1') as Record<string, unknown>;

    // A. Whole-drawing scope banner + affected counts before any pairs.
    await startProjectTransform(page);
    await expect(page.locator('[data-project-transform-scope-banner]')).toContainText('WHOLE DRAWING');
    await expect(page.locator('[data-project-transform-counts]')).toContainText('Entities 7');
    await expect(page.locator('[data-project-transform-station-policy]')).toBeVisible();

    // Rigid Helmert: pure translation (100, 50), scale 1.
    await addHelmertPair(page, '10,20,110,70', 1);
    await addHelmertPair(page, '110,-40,210,10', 2);
    await expect(page.locator('[data-project-transform-fit]')).toContainText('RMS', { timeout: 10000 });
    await expect(page.locator('[data-project-transform-apply]')).toBeEnabled();
    await page.locator('[data-project-transform-preview]').click();
    await expect(page.locator('[data-project-transform-result]')).toContainText('RMS', { timeout: 10000 });
    await page.locator('[data-project-transform-apply]').click();
    await expect(page.locator('[data-survey-cad-project-transform-panel]')).toBeHidden({ timeout: 10000 });
    await expect(page.locator('[data-cad-command-prompt]')).toContainText('PROJECTTRANSFORM', { timeout: 10000 });
    await expect.poll(() => entityCount(page)).toBe(7);

    const after = savedProject((await saveDrawingText(page)).text);
    const entities = after['entities'] as Array<Record<string, unknown>>;
    // B. Rigid: stationing bit-identical.
    const alignmentAfter = entities.find((e) => e['id'] === 'al1') as Record<string, unknown>;
    expect(alignmentAfter['stationEquations']).toEqual(alignmentBefore['stationEquations']);
    expect(alignmentAfter['startStation']).toBe(alignmentBefore['startStation']);
    // C. Rigid: sample raw chainage + widths untouched.
    const groups = after['sampleLineGroups'] as Array<Record<string, unknown>>;
    expect(groups[0]?.['sampleLines']).toEqual(
      (before['sampleLineGroups'] as Array<Record<string, unknown>>)[0]?.['sampleLines'],
    );
    // H. Annotation coherence: mtext insertion moved by (100, 50).
    const mtextAfter = entities.find((e) => e['id'] === 'm1') as Record<string, unknown>;
    expect(mtextAfter['x']).toBeCloseTo((mtextBefore['x'] as number) + 100, 6);
    expect(mtextAfter['y']).toBeCloseTo((mtextBefore['y'] as number) + 50, 6);
    // I. Provenance: exactly one PROJECT_COORDINATE_TRANSFORM computation.
    const computations = after['cogoComputations'] as Array<Record<string, unknown>>;
    expect(computations.filter((c) => c['toolKey'] === 'PROJECT_COORDINATE_TRANSFORM')).toHaveLength(1);

    expect(errors).toEqual([]);
  });

  test('D–G/K–N: Grid/Ground, surface honesty, undo/redo, save/reopen', async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    await gotoCad(page, errors);
    await openFixture(page, 7);

    await startProjectTransform(page);
    await page.locator('[data-survey-cad-project-transform-panel]').getByRole('button', { name: 'Grid/Ground' }).click();
    await page.locator('[data-project-transform-origin-input]').fill('0,0');
    await page.locator('[data-project-transform-origin-set]').click();
    await page.locator('[data-project-transform-factor-input]').fill('0.99995');
    await page.locator('[data-project-transform-factor-set]').click();
    await expect(page.locator('[data-project-transform-gridground]')).toContainText('1/0.99995', { timeout: 10000 });
    await expect(page.locator('[data-project-transform-apply]')).toBeEnabled();
    await page.locator('[data-project-transform-preview]').click();
    await expect(page.locator('[data-project-transform-result]')).toContainText('effective', { timeout: 10000 });
    await page.locator('[data-project-transform-apply]').click();
    await expect(page.locator('[data-survey-cad-project-transform-panel]')).toBeHidden({ timeout: 10000 });
    await expect.poll(() => entityCount(page)).toBe(7);

    const committed = await saveDrawingText(page);
    const committedProject = savedProject(committed.text);
    // K. Grid→Ground scaled the drawing: point moved by 1/CSF.
    const ptA = (committedProject['entities'] as Array<Record<string, unknown>>).find((e) => e['id'] === 'pt:A') as Record<string, unknown>;
    expect(ptA['x']).toBeCloseTo(10 / 0.99995, 4);
    // D–E. Surfaces invalidated (never stale-CURRENT); imported faces + Z preserved.
    const surfaces = committedProject['surfaces'] as Array<Record<string, unknown>>;
    for (const surface of surfaces) expect(surface['cachedRevision']).toBeNull();
    const imported = surfaces.find((s) => s['id'] === 'surf-imported') as Record<string, unknown>;
    const tin = (imported['definition'] as Record<string, unknown>)['importedTin'] as Record<string, unknown>;
    expect(tin['faces']).toEqual([0, 1, 2, 0, 2, 3]);
    expect((tin['vertices'] as number[]).filter((_, i) => i % 3 === 2)).toEqual([1, 2, 3, 4]);
    // F–G. Volume/profile/section refs carried, not rewritten.
    expect((committedProject['volumeSurfaces'] as Array<unknown>)).toHaveLength(1);
    expect((committedProject['surfaceProfiles'] as Array<unknown>)).toHaveLength(1);
    expect((committedProject['profileViews'] as Array<unknown>)).toHaveLength(1);
    expect((committedProject['sectionViews'] as Array<unknown>)).toHaveLength(1);

    // L–M. Undo changes the project; redo restores it byte-identically.
    const projectText = (text: string): string => JSON.stringify(savedProject(text));
    await homeTab(page);
    await page.locator('[data-cad-command="SHELL_UNDO"]').click();
    const undone = await saveDrawingText(page);
    expect(projectText(undone.text)).not.toBe(projectText(committed.text));
    await page.locator('[data-cad-command="SHELL_REDO"]').click();
    const redone = await saveDrawingText(page);
    expect(projectText(redone.text)).toBe(projectText(committed.text));

    // N. Save/reopen round-trips the transformed project exactly.
    const fileInput = page.locator('[data-survey-cad-open-drawing-input]');
    await fileInput.evaluate((element: HTMLInputElement) => element.classList.remove('hidden')).catch(() => {});
    await fileInput.setInputFiles(path.join(redone.dir, 'download.wncad'));
    await expect.poll(() => entityCount(page)).toBe(7);
    const reopened = await saveDrawingText(page);
    expect(projectText(reopened.text)).toBe(projectText(committed.text));
    for (const dir of [committed.dir, undone.dir, redone.dir, reopened.dir]) {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    expect(errors).toEqual([]);
  });

  test('J/O: transform marker persists for the reimport gate; no stale CURRENT after reopen', async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    await gotoCad(page, errors);
    await openFixture(page, 7);

    await startProjectTransform(page);
    await addHelmertPair(page, '0,0,5,5', 1);
    await addHelmertPair(page, '100,0,105,5', 2);
    await page.locator('[data-project-transform-apply]').click();
    await expect(page.locator('[data-survey-cad-project-transform-panel]')).toBeHidden({ timeout: 10000 });
    await expect.poll(() => entityCount(page)).toBe(7);

    // J. The transform audit marker (which the mixed-frame import gate reads)
    // survives save/reopen, so reimport stays blocked in the new session.
    const saved = await saveDrawingText(page);
    const computations = (savedProject(saved.text)['cogoComputations'] as Array<Record<string, unknown>>);
    expect(computations.filter((c) => c['toolKey'] === 'PROJECT_COORDINATE_TRANSFORM')).toHaveLength(1);
    const fileInput = page.locator('[data-survey-cad-open-drawing-input]');
    await fileInput.evaluate((element: HTMLInputElement) => element.classList.remove('hidden')).catch(() => {});
    await fileInput.setInputFiles(path.join(saved.dir, 'download.wncad'));
    await expect.poll(() => entityCount(page)).toBe(7);
    const reopened = await saveDrawingText(page);
    const reopenedComputations = (savedProject(reopened.text)['cogoComputations'] as Array<Record<string, unknown>>);
    expect(reopenedComputations.filter((c) => c['toolKey'] === 'PROJECT_COORDINATE_TRANSFORM')).toHaveLength(1);
    // O. Late old-frame worker results can never resurrect CURRENT: reopened
    // surfaces carry no cached revision (honest UNBUILT until rebuilt).
    const surfaces = (savedProject(reopened.text)['surfaces'] as Array<Record<string, unknown>>);
    for (const surface of surfaces) expect(surface['cachedRevision']).toBeNull();
    for (const dir of [saved.dir, reopened.dir]) fs.rmSync(dir, { recursive: true, force: true });

    expect(errors).toEqual([]);
  });
});
