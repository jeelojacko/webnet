/**
 * Phase 18Q browser QA — professional transform tools through the real /cad app.
 *
 * Playwright (Chromium), NOT vitest. Covers: ROTATE / SCALE / MIRROR
 * (copy-default No + erase Yes) / block refs stay references / MOVE ghost
 * (no duplication) / annotation source-only + source+annotation / ALIGN2D
 * No+Yes / HELMERT pairs + preview + residuals + apply / GRIDGROUND CSF /
 * alignment rigid-ok + scale-blocked / lock atomicity / undo-redo each /
 * save-reopen mirrored blocks. Zero page/console errors asserted per test.
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

async function canvasClick(page: Page, fx: number, fy: number): Promise<void> {
  const box = await page.locator('[data-cad-viewport] svg').first().boundingBox();
  if (!box) throw new Error('viewport svg has no bounding box');
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

async function canvasHover(page: Page, fx: number, fy: number): Promise<void> {
  const box = await page.locator('[data-cad-viewport] svg').first().boundingBox();
  if (!box) throw new Error('viewport svg has no bounding box');
  await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
}

async function entityCount(page: Page): Promise<number> {
  const text = (await page.locator('[data-survey-cad-entity-count]').textContent()) ?? '';
  return Number.parseInt(text, 10);
}

async function selectionCount(page: Page): Promise<number> {
  const text = (await page.locator('[data-survey-cad-selection-count]').textContent()) ?? '';
  return Number.parseInt(text, 10);
}

async function homeTab(page: Page): Promise<void> {
  await page.locator('[data-cad-ribbon] [role="tab"]', { hasText: 'Home' }).click();
}

async function selectAll(page: Page, expected: number): Promise<void> {
  await homeTab(page);
  await page.locator('[data-cad-command="SHELL_SELECT_ALL"]').click();
  await expect.poll(() => selectionCount(page)).toBe(expected);
}

async function clearSelection(page: Page): Promise<void> {
  await homeTab(page);
  await page.locator('[data-cad-command="SHELL_CLEAR_SELECTION"]').click();
  await expect.poll(() => selectionCount(page)).toBe(0);
}

/** Start a Modify session command (waits for the button to enable). */
async function startModify(page: Page, key: string): Promise<void> {
  await homeTab(page);
  const button = page.locator(`[data-cad-command="${key}"]`);
  await expect(button).toBeEnabled({ timeout: 10000 });
  await button.click();
}

async function submitInput(page: Page, text: string): Promise<void> {
  const input = page.locator('[data-cad-command-input]');
  await input.fill(text);
  await input.press('Enter');
}

async function cancelCommand(page: Page): Promise<void> {
  await page.locator('[data-cad-command-input]').press('Escape');
}

async function expectCommitted(page: Page, label: string): Promise<void> {
  await expect(page.locator('[data-cad-command-prompt]')).toContainText(`${label} committed.`, { timeout: 10000 });
}

async function drawLine(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await homeTab(page);
  await page.locator('[data-cad-command="LINE"]').click();
  await canvasClick(page, from[0], from[1]);
  await canvasClick(page, to[0], to[1]);
  await cancelCommand(page);
}

async function blockRefCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      [...document.querySelectorAll('[data-cad-viewport] svg title')]
        .map((element) => element.textContent)
        .filter((text) => text?.startsWith('Block: ')).length,
  );
}

async function downloadToTemp(page: Page, trigger: () => Promise<void>, suffix: string): Promise<string> {
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await trigger();
  const download = await downloadPromise;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wn-18q-'));
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

test.describe('Phase 18Q transforms', () => {
  test('rotate/scale/mirror-copy-default/mirror-erase/move-ghost', async ({ page }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    await gotoCad(page, errors);

    await drawLine(page, [0.3, 0.5], [0.6, 0.5]);
    await expect.poll(() => entityCount(page)).toBe(1);

    // A. ROTATE 90 in place: counts stable, selection kept.
    await selectAll(page, 1);
    await startModify(page, 'ROTATE');
    await canvasClick(page, 0.3, 0.5);
    await submitInput(page, '90');
    await expectCommitted(page, 'ROTATE (1)');
    await expect.poll(() => entityCount(page)).toBe(1);
    await expect.poll(() => selectionCount(page)).toBe(1);

    // B. SCALE x2 in place.
    await startModify(page, 'SCALE');
    await canvasClick(page, 0.3, 0.5);
    await submitInput(page, '2');
    await expectCommitted(page, 'SCALE (1)');
    await expect.poll(() => entityCount(page)).toBe(1);
    await expect.poll(() => selectionCount(page)).toBe(1);

    // C. MIRROR default (empty = No): keeps originals, selects the copies.
    await startModify(page, 'MIRROR');
    await canvasClick(page, 0.35, 0.25);
    await canvasClick(page, 0.35, 0.6);
    await submitInput(page, '');
    await expectCommitted(page, 'MIRROR_COPY (1)');
    await expect.poll(() => entityCount(page)).toBe(2);
    await expect.poll(() => selectionCount(page)).toBe(1);

    // C2. MIRROR erase Yes: mirrors in place, count stable.
    await selectAll(page, 2);
    await startModify(page, 'MIRROR');
    await canvasClick(page, 0.35, 0.25);
    await canvasClick(page, 0.35, 0.6);
    await submitInput(page, 'Yes');
    await expectCommitted(page, 'MIRROR (2)');
    await expect.poll(() => entityCount(page)).toBe(2);
    await expect.poll(() => selectionCount(page)).toBe(2);

    // E. MOVE ghost: hover preview never duplicates entities; Esc cancels clean.
    await startModify(page, 'MOVE');
    await canvasClick(page, 0.3, 0.5);
    await canvasHover(page, 0.7, 0.7);
    await page.waitForTimeout(400);
    await expect.poll(() => entityCount(page)).toBe(2);
    await cancelCommand(page);
    await expect.poll(() => entityCount(page)).toBe(2);
    await expect.poll(() => selectionCount(page)).toBe(2);

    expect(errors).toEqual([]);
  });

  test('blocks stay references + annotation source-only and source+annotation', async ({ page }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    await gotoCad(page, errors);
    const input = page.locator('[data-cad-command-input]');

    // D. Block ref survives rotate/scale/mirror as a reference.
    await drawLine(page, [0.25, 0.5], [0.6, 0.55]);
    await selectAll(page, 1);
    await input.fill('B');
    await input.press('Enter');
    const manager = page.locator('[data-cad-block-manager]');
    await expect(manager).toBeVisible({ timeout: 10000 });
    await manager.locator('input[aria-label="New block name"]').fill('QA-T');
    await manager.getByRole('button', { name: 'New from selection' }).click();
    await manager.locator('button[aria-label="Close Block Manager"]').click();
    await homeTab(page);
    await page.locator('[data-cad-blocks="manager"]').click();
    await expect(manager).toBeVisible({ timeout: 10000 });
    await manager.getByRole('tab', { name: 'Insert' }).click();
    await manager.getByRole('button', { name: 'Pick point' }).click();
    await expect(manager).toBeHidden({ timeout: 10000 });
    await canvasClick(page, 0.5, 0.5);
    await expect.poll(() => entityCount(page)).toBe(2);
    // INSERT repeats until Esc: end the pick loop with focus outside any
    // input (Esc inside an input is consumed by the dock and keeps arming).
    // Otherwise later canvas clicks place references instead of selecting.
    await homeTab(page);
    await page.keyboard.press('Escape');
    await expect.poll(() => entityCount(page)).toBe(2);
    expect(await blockRefCount(page)).toBe(1);

    await selectAll(page, 2);
    await startModify(page, 'ROTATE');
    await canvasClick(page, 0.5, 0.5);
    await submitInput(page, '45');
    await expect.poll(() => entityCount(page)).toBe(2);
    expect(await blockRefCount(page)).toBe(1);

    await startModify(page, 'SCALE');
    await canvasClick(page, 0.5, 0.5);
    await submitInput(page, '2');
    await expect.poll(() => entityCount(page)).toBe(2);
    expect(await blockRefCount(page)).toBe(1);

    await startModify(page, 'MIRROR');
    await canvasClick(page, 0.35, 0.25);
    await canvasClick(page, 0.35, 0.6);
    await submitInput(page, 'Yes');
    await expectCommitted(page, 'MIRROR (2)');
    await expect.poll(() => entityCount(page)).toBe(2);
    expect(await blockRefCount(page)).toBe(1);
    // The in-place mirror really reflected: the flag persists to the file.
    const mirrored = await saveDrawingText(page);
    expect(mirrored.text).toMatch(/"mirrored":\s*true/);
    fs.rmSync(mirrored.dir, { recursive: true, force: true });

    // F. Source-only: a fresh line arrives selected by itself (no
    // click-select, which the refit view makes position-unstable).
    await drawLine(page, [0.3, 0.3], [0.5, 0.3]);
    await expect.poll(() => entityCount(page)).toBe(3);
    await expect.poll(() => selectionCount(page)).toBe(1);
    await startModify(page, 'ROTATE');
    await canvasClick(page, 0.5, 0.5);
    await submitInput(page, '30');
    await expect.poll(() => entityCount(page)).toBe(3);

    // Annotation joins: source + annotation together.
    await page.locator('[data-cad-ribbon] [role="tab"]', { hasText: 'Annotate' }).click();
    await page.locator('[data-cad-annotation-command="MTEXT"]').click();
    await canvasClick(page, 0.4, 0.4);
    await input.fill('QA NOTE');
    await input.press('Enter');
    await cancelCommand(page);
    await expect.poll(() => entityCount(page)).toBe(4);
    await selectAll(page, 4);
    await startModify(page, 'ROTATE');
    await canvasClick(page, 0.5, 0.5);
    await submitInput(page, '30');
    await expect.poll(() => entityCount(page)).toBe(4);

    expect(errors).toEqual([]);
  });

  test('align2d rigid-No and scale-Yes', async ({ page }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    await gotoCad(page, errors);

    await drawLine(page, [0.3, 0.4], [0.6, 0.4]);
    await expect.poll(() => entityCount(page)).toBe(1);
    await selectAll(page, 1);

    // G1. Rigid (No): translate + rotate, no scale.
    await startModify(page, 'ALIGN2D');
    await canvasClick(page, 0.3, 0.4);
    await canvasClick(page, 0.6, 0.4);
    await canvasClick(page, 0.3, 0.6);
    await canvasClick(page, 0.6, 0.6);
    await submitInput(page, 'No');
    await expect.poll(() => entityCount(page)).toBe(1);
    await expect.poll(() => selectionCount(page)).toBe(1);

    // G2. Scale-to-fit (Yes).
    await startModify(page, 'ALIGN2D');
    await canvasClick(page, 0.3, 0.6);
    await canvasClick(page, 0.6, 0.6);
    await canvasClick(page, 0.2, 0.3);
    await canvasClick(page, 0.7, 0.3);
    await submitInput(page, 'Yes');
    await expect.poll(() => entityCount(page)).toBe(1);

    expect(errors).toEqual([]);
  });

  test('helmert pairs + preview + residuals + apply, gridground csf', async ({ page }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    await gotoCad(page, errors);

    await drawLine(page, [0.3, 0.4], [0.6, 0.4]);
    await expect.poll(() => entityCount(page)).toBe(1);
    await selectAll(page, 1);

    // H. HELMERT: panel opens, typed pairs build rows, fit summary shows.
    await startModify(page, 'HELMERT2D');
    const panel = page.locator('[data-survey-cad-transform-panel]');
    await expect(panel).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-survey-cad-helmert-panel]')).toBeVisible();
    const pairInput = page.locator('[data-helmert-add-input]');
    await pairInput.fill('0,0,10,10');
    await page.locator('[data-helmert-add]').click();
    await expect(page.locator('[data-helmert-row="1"]')).toBeVisible();
    await pairInput.fill('10,0,20,10');
    await page.locator('[data-helmert-add]').click();
    await expect(page.locator('[data-helmert-row="2"]')).toBeVisible();
    await expect(page.locator('[data-helmert-summary]')).toContainText('RMS residual');
    // Preview surfaces the same fit in the command line.
    await expect(page.locator('[data-helmert-apply]')).toBeEnabled();
    await page.locator('[data-helmert-preview]').click();
    await expect(page.locator('[data-helmert-result]')).toContainText('RMS residual');
    // Apply commits one entry: panel closes, counts stable.
    await page.locator('[data-helmert-apply]').click();
    await expect(panel).toBeHidden({ timeout: 10000 });
    await expect.poll(() => entityCount(page)).toBe(1);

    // I. GRIDGROUND: origin + CSF + explicit formula + apply.
    await selectAll(page, 1);
    await startModify(page, 'GRIDGROUND');
    await expect(page.locator('[data-survey-cad-gridground-panel]')).toBeVisible({ timeout: 10000 });
    await page.locator('[data-gridground-origin-input]').fill('500000,100000');
    await page.locator('[data-gridground-origin-set]').click();
    await page.locator('[data-gridground-factor-input]').fill('0.99995');
    await page.locator('[data-gridground-factor-set]').click();
    await expect(page.locator('[data-gridground-summary]')).toContainText(
      'Grid->Ground: factor = 1/0.99995',
    );
    await expect(page.locator('[data-gridground-apply]')).toBeEnabled();
    await page.locator('[data-gridground-preview]').click();
    await expect(page.locator('[data-gridground-result]')).toContainText('effective');
    await page.locator('[data-gridground-apply]').click();
    await expect(panel).toBeHidden({ timeout: 10000 });
    await expect.poll(() => entityCount(page)).toBe(1);

    expect(errors).toEqual([]);
  });

  test('alignment rigid-ok + scale-blocked, lock atomicity, undo-redo, save-reopen', async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    await gotoCad(page, errors);

    // J. Alignment: open the fixture (alignment + line; the /cad shell has
    // no alignment-creation UI). Rigid HELMERT commits, similarity +
    // gridground block with the scale-dependency reason.
    const openInput = page.locator('[data-survey-cad-open-drawing-input]');
    await openInput.evaluate((element: HTMLInputElement) => element.classList.remove('hidden')).catch(() => {});
    await openInput.setInputFiles(path.resolve('tests-browser/fixtures/cad-transform-18q-align.wncad'));
    const withAlignment = 2;
    await expect.poll(() => entityCount(page)).toBe(withAlignment);
    await selectAll(page, withAlignment);

    await startModify(page, 'HELMERT2D');
    const pairInput = page.locator('[data-helmert-add-input]');
    await pairInput.fill('0,0,10,10');
    await page.locator('[data-helmert-add]').click();
    await pairInput.fill('100,0,112,12');
    await page.locator('[data-helmert-add]').click();
    await expect(page.locator('[data-helmert-row="2"]')).toBeVisible();
    // Similarity apply is blocked atomically: reason visible, count unchanged.
    await page.locator('[data-helmert-apply]').click();
    await expect(page.locator('[data-helmert-result]')).toContainText(
      'CAD_TRANSFORM_ALIGNMENT_SCALE_DEPENDENCY',
      { timeout: 10000 },
    );
    await expect.poll(() => entityCount(page)).toBe(withAlignment);
    // Rigid mode on the same alignment commits.
    await page.locator('[data-helmert-mode="RIGID"]').click();
    await page.locator('[data-helmert-apply]').click();
    await expect(page.locator('[data-survey-cad-transform-panel]')).toBeHidden({ timeout: 10000 });
    await expect.poll(() => entityCount(page)).toBe(withAlignment);

    // GRIDGROUND on the alignment blocks the same way.
    await selectAll(page, withAlignment);
    await startModify(page, 'GRIDGROUND');
    await page.locator('[data-gridground-origin-input]').fill('0,0');
    await page.locator('[data-gridground-origin-set]').click();
    await page.locator('[data-gridground-factor-input]').fill('0.99995');
    await page.locator('[data-gridground-factor-set]').click();
    await page.locator('[data-gridground-apply]').click();
    await expect(page.locator('[data-gridground-result]')).toContainText(
      'CAD_TRANSFORM_ALIGNMENT_SCALE_DEPENDENCY',
      { timeout: 10000 },
    );
    await expect.poll(() => entityCount(page)).toBe(withAlignment);
    await page.locator('[data-gridground-cancel]').click();
    await expect(page.locator('[data-survey-cad-transform-panel]')).toBeHidden({ timeout: 10000 });

    // K. Lock atomicity: locked selection blocks ROTATE with zero changes.
    await clearSelection(page);
    await homeTab(page);
    await page.locator('[data-cad-command="LAYER"]').first().click();
    const layers = page.locator('[data-cad-layers]');
    await expect(layers).toBeVisible({ timeout: 10000 });
    // Drain-loop direct clicks: the rows are controlled checkboxes that
    // re-render (and flip aria-labels) per toggle, defeating indexed loops.
    expect(await layers.locator('[aria-label^="Lock layer"]').count()).toBeGreaterThan(0);
    for (let guard = 0; guard < 30; guard++) {
      const box = layers.locator('[aria-label^="Lock layer"]').first();
      if ((await box.count()) === 0) break;
      await box.evaluate((element) => (element as HTMLInputElement).click());
    }
    await expect.poll(() => layers.locator('[aria-label^="Lock layer"]').count()).toBe(0);
    await page.keyboard.press('Escape');
    await selectAll(page, withAlignment);
    await startModify(page, 'ROTATE');
    await canvasClick(page, 0.4, 0.4);
    await submitInput(page, '45');
    await page.waitForTimeout(400);
    await expect.poll(() => entityCount(page)).toBe(withAlignment);
    // Unlock and commit the same rotation.
    await homeTab(page);
    await page.locator('[data-cad-command="LAYER"]').first().click();
    await expect(layers).toBeVisible({ timeout: 10000 });
    for (let guard = 0; guard < 30; guard++) {
      const box = layers.locator('[aria-label^="Unlock layer"]').first();
      if ((await box.count()) === 0) break;
      await box.evaluate((element) => (element as HTMLInputElement).click());
    }
    await expect.poll(() => layers.locator('[aria-label^="Unlock layer"]').count()).toBe(0);
    await page.keyboard.press('Escape');
    await submitInput(page, '45');
    await expect.poll(() => entityCount(page)).toBe(withAlignment);
    await cancelCommand(page);

    // L. Undo/redo observed through saved project payloads (in-place
    // commits keep counts; file bytes carry save timestamps, so compare
    // the project, not the raw download).
    const savedProject = (text: string): string => {
      const document = JSON.parse(text) as { project: unknown };
      return JSON.stringify(document.project);
    };
    const committed = await saveDrawingText(page);
    await homeTab(page);
    await page.locator('[data-cad-command="SHELL_UNDO"]').click();
    const undone = await saveDrawingText(page);
    expect(savedProject(undone.text)).not.toBe(savedProject(committed.text));
    await page.locator('[data-cad-command="SHELL_REDO"]').click();
    const redone = await saveDrawingText(page);
    expect(savedProject(redone.text)).toBe(savedProject(committed.text));
    fs.rmSync(committed.dir, { recursive: true, force: true });
    fs.rmSync(undone.dir, { recursive: true, force: true });
    fs.rmSync(redone.dir, { recursive: true, force: true });

    // M. Save/reopen: mirrored-flag state survives the round trip.
    await selectAll(page, withAlignment);
    await startModify(page, 'MIRROR');
    await canvasClick(page, 0.35, 0.25);
    await canvasClick(page, 0.35, 0.6);
    await submitInput(page, 'Yes');
    await expect.poll(() => entityCount(page)).toBe(withAlignment);
    const before = await saveDrawingText(page);
    const fileInput = page.locator('[data-survey-cad-open-drawing-input]');
    await fileInput.evaluate((element: HTMLInputElement) => element.classList.remove('hidden')).catch(() => {});
    await fileInput.setInputFiles(path.join(before.dir, 'download.wncad'));
    await expect.poll(() => entityCount(page)).toBe(withAlignment);
    const after = await saveDrawingText(page);
    expect(savedProject(after.text)).toBe(savedProject(before.text));
    fs.rmSync(before.dir, { recursive: true, force: true });
    fs.rmSync(after.dir, { recursive: true, force: true });

    expect(errors).toEqual([]);
  });
});
