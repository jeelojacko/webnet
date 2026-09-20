/**
 * Phase 18R.1 browser QA — project-transform integrity, real /cad app.
 *
 * Playwright (Chromium), NOT vitest. Companion to the engine-tier oracles
 * `tests/cad_project_transform_draft_18r1.test.ts`,
 * `tests/cad_project_transform_bounds_18r1.test.ts`, and
 * `tests/cad_project_transform_tin_preflight_18r1.test.ts`.
 *
 * Covered in-browser here:
 *   A. Draft viewport model-center follows the transform (read back from the
 *      operator-visible saved drawing).
 *   B. Draft label xModel/yModel anchor follows the transform.
 *   C. ONE undo restores project + draft together; one redo reapplies both.
 *   D. Imported-TIN-only extents survive load and are recomputed transformed.
 *   E. Mixed entity/TIN extents union correctly after transform.
 *   F. Malformed imported TIN blocks APPLY with an operator-visible
 *      diagnostic and leaves the project byte-identical.
 *   G. Valid TIN transform stays exact (XY moved, Z/faces/provenance kept).
 *   H. Save/reopen persists transformed draft refs + TIN bounds.
 *
 * The single fixture `cad-project-transform-18r1.wncad` carries the draft
 * (sheet viewport + label) plus one valid imported TIN; the TIN-only and
 * malformed variants are derived in-test as temp files so the committed
 * fixture stays minimal. Zero page/console errors asserted per test.
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const FIXTURE = 'tests-browser/fixtures/cad-project-transform-18r1.wncad';
const DRAWING_NAME = 'Project Transform QA 18R1';
const TIN_ONLY_BOUNDS = { minX: 2000000, minY: 7000000, maxX: 2000100, maxY: 7000200 };
// Rigid translation (+100 E, +50 N) encoded by two control pairs.
const DX = 100;
const DY = 50;

type Json = Record<string, unknown>;

async function gotoCad(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (error) => errors.push(`pageerror: ${String(error)}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
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

async function openDrawing(page: Page, filePath: string, expectedCount: number): Promise<void> {
  const openInput = page.locator('[data-survey-cad-open-drawing-input]');
  await openInput.evaluate((element: HTMLInputElement) => element.classList.remove('hidden')).catch(() => {});
  await openInput.setInputFiles(path.resolve(filePath));
  // The drawing name distinguishes a completed load from the blank default
  // (entity count alone is ambiguous for the TIN-only 0-entity variant).
  await expect(page.getByText(DRAWING_NAME, { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect.poll(() => entityCount(page)).toBe(expectedCount);
}

async function addHelmertPair(page: Page, text: string, row: number): Promise<void> {
  await page.locator('[data-project-transform-add-input]').fill(text);
  await page.getByRole('button', { name: 'Add Pair' }).click();
  await expect(page.locator(`[data-project-transform-row="${row}"]`)).toBeVisible({ timeout: 10000 });
}

/** Open PROJECTTRANSFORM, feed the rigid translation pairs, APPLY. */
async function applyRigidTranslate(page: Page): Promise<void> {
  await homeTab(page);
  const button = page.locator('[data-cad-command="PROJECTTRANSFORM"]');
  await expect(button).toBeEnabled({ timeout: 10000 });
  await button.click();
  await expect(page.locator('[data-survey-cad-project-transform-panel]')).toBeVisible({ timeout: 10000 });
  await addHelmertPair(page, '10,20,110,70', 1);
  await addHelmertPair(page, '110,-40,210,10', 2);
  await expect(page.locator('[data-project-transform-fit]')).toContainText('RMS', { timeout: 10000 });
  await expect(page.locator('[data-project-transform-apply]')).toBeEnabled();
  await page.locator('[data-project-transform-apply]').click();
  await expect(page.locator('[data-survey-cad-project-transform-panel]')).toBeHidden({ timeout: 10000 });
  await expect(page.locator('[data-cad-command-prompt]')).toContainText('PROJECTTRANSFORM', { timeout: 10000 });
}

async function saveDrawing(page: Page): Promise<{ project: Json; draft: Json; file: string; dir: string }> {
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await page.getByRole('button', { name: 'Save Drawing' }).first().click();
  const download = await downloadPromise;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wn-18r1-'));
  const file = path.join(dir, 'saved.wncad');
  await download.saveAs(file);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { project: Json; draft: Json };
  return { project: parsed.project, draft: parsed.draft, file, dir };
}

const entities = (project: Json): Json[] => project['entities'] as Json[];
const entityById = (project: Json, id: string): Json => {
  const found = entities(project).find((entity) => entity['id'] === id);
  if (!found) throw new Error(`missing entity ${id}`);
  return found;
};
const importedTin = (project: Json): Json =>
  ((project['surfaces'] as Json[])[0]!['definition'] as Json)['importedTin'] as Json;
const viewport0 = (draft: Json): Json =>
  ((draft['sheets'] as Json[])[0]!['viewports'] as Json[])[0]!;
const label0 = (draft: Json): Json => (draft['labels'] as Json[])[0]!;
const projectText = (project: Json): string => JSON.stringify(project);
const draftText = (draft: Json): string => JSON.stringify(draft);

/** Derive a temp variant of the committed fixture (kept out of the repo). */
function writeVariant(mutate: (_document: Json) => void): { dir: string; file: string } {
  const document = JSON.parse(fs.readFileSync(path.resolve(FIXTURE), 'utf8')) as Json;
  mutate(document);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-18r1-var-'));
  const file = path.join(dir, 'variant.wncad');
  fs.writeFileSync(file, JSON.stringify(document));
  return { dir, file };
}

const cleanup = (...dirs: string[]): void => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
};

test.describe('Phase 18R.1 project transform integrity', () => {
  test('A/B/C: draft viewport + label follow the transform; one undo/redo is atomic', async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    await gotoCad(page, errors);
    await openDrawing(page, FIXTURE, 3);

    const before = await saveDrawing(page);
    expect(viewport0(before.draft)['modelCenterX']).toBeCloseTo(2000000, 6);
    expect(label0(before.draft)['xModel']).toBeCloseTo(2000100, 6);

    await applyRigidTranslate(page);
    const committed = await saveDrawing(page);

    // A. Viewport model-center follows the project; paper fields untouched.
    const viewport = viewport0(committed.draft);
    expect(viewport['modelCenterX']).toBeCloseTo(2000000 + DX, 6);
    expect(viewport['modelCenterY']).toBeCloseTo(7000000 + DY, 6);
    expect(viewport['scaleDenominator']).toBe(500);
    expect(viewport['rotationDeg']).toBe(0);
    // B. Label model anchor follows the project.
    const label = label0(committed.draft);
    expect(label['xModel']).toBeCloseTo(2000100 + DX, 6);
    expect(label['yModel']).toBeCloseTo(7000200 + DY, 6);
    // Project geometry moved by the same translation.
    expect(entityById(committed.project, 'pt:A')['x']).toBeCloseTo(2000000 + DX, 6);
    expect(entityById(committed.project, 'pt:A')['y']).toBeCloseTo(7000000 + DY, 6);

    // C. ONE undo restores project + draft together.
    await homeTab(page);
    await page.locator('[data-cad-command="SHELL_UNDO"]').click();
    const undone = await saveDrawing(page);
    expect(projectText(undone.project)).toBe(projectText(before.project));
    expect(draftText(undone.draft)).toBe(draftText(before.draft));
    // ONE redo reapplies both.
    await page.locator('[data-cad-command="SHELL_REDO"]').click();
    const redone = await saveDrawing(page);
    expect(projectText(redone.project)).toBe(projectText(committed.project));
    expect(draftText(redone.draft)).toBe(draftText(committed.draft));

    cleanup(before.dir, committed.dir, undone.dir, redone.dir);
    expect(errors).toEqual([]);
  });

  test('D: imported-TIN-only extents survive load and are recomputed transformed', async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    const tinOnly = writeVariant((document) => {
      (document['project'] as Json)['entities'] = [];
      (document['project'] as Json)['bounds'] = { ...TIN_ONLY_BOUNDS };
    });
    try {
      await gotoCad(page, errors);
      await openDrawing(page, tinOnly.file, 0);
      const loaded = await saveDrawing(page);
      // Extents (which drive the viewport fit) are present right after load.
      expect(loaded.project['bounds']).toEqual(TIN_ONLY_BOUNDS);

      await applyRigidTranslate(page);
      const committed = await saveDrawing(page);

      // Bounds are recomputed from the TRANSFORMED TIN, not the old frame.
      expect(committed.project['bounds']).toEqual({
        minX: TIN_ONLY_BOUNDS.minX + DX,
        minY: TIN_ONLY_BOUNDS.minY + DY,
        maxX: TIN_ONLY_BOUNDS.maxX + DX,
        maxY: TIN_ONLY_BOUNDS.maxY + DY,
      });
      expect(entities(committed.project)).toHaveLength(0);
      // G. Valid TIN is exact: XY moved, Z + topology + provenance kept.
      const tin = importedTin(committed.project);
      expect(tin['vertices']).toEqual([
        2000000 + DX, 7000000 + DY, 1,
        2000100 + DX, 7000000 + DY, 2,
        2000100 + DX, 7000200 + DY, 3,
        2000000 + DX, 7000200 + DY, 4,
      ]);
      expect(tin['faces']).toEqual([0, 1, 2, 0, 2, 3]);

      cleanup(loaded.dir, committed.dir);
    } finally {
      cleanup(tinOnly.dir);
    }
    expect(errors).toEqual([]);
  });

  test('E/G: mixed entity/TIN extents union; valid TIN transform stays exact', async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    await gotoCad(page, errors);
    await openDrawing(page, FIXTURE, 3);

    await applyRigidTranslate(page);
    const committed = await saveDrawing(page);

    // E. Bounds union the far-west entity extents and the TIN extents.
    expect(committed.project['bounds']).toEqual({
      minX: 1900000 + DX,
      minY: 6000000 + DY,
      maxX: 2000100 + DX,
      maxY: 7000200 + DY,
    });
    // G. Faces/provenance/Z exact; vertices translated.
    const tin = importedTin(committed.project);
    expect(tin['faces']).toEqual([0, 1, 2, 0, 2, 3]);
    expect((tin['vertices'] as number[]).filter((_, index) => index % 3 === 2)).toEqual([1, 2, 3, 4]);
    expect(tin['provenance']).toEqual({
      format: 'LandXML',
      fileName: 'qa-18r1.xml',
      surfaceName: 'Imported TIN 18R1',
    });
    const vertices = tin['vertices'] as number[];
    expect(vertices[0]).toBeCloseTo(2000000 + DX, 6);
    expect(vertices[1]).toBeCloseTo(7000000 + DY, 6);
    expect(vertices[3]).toBeCloseTo(2000100 + DX, 6);
    expect(vertices[7]).toBeCloseTo(7000200 + DY, 6);

    cleanup(committed.dir);
    expect(errors).toEqual([]);
  });

  test('F: malformed imported TIN blocks APPLY with a diagnostic, project unchanged', async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    const malformed = writeVariant((document) => {
      const surface = ((document['project'] as Json)['surfaces'] as Json[])[0]!;
      const definition = surface['definition'] as Json;
      // Non-triple vertex array — rejected by the 18L preflight.
      (definition['importedTin'] as Json)['vertices'] = [2000000, 7000000, 1, 2000100, 7000000];
    });
    try {
      await gotoCad(page, errors);
      await openDrawing(page, malformed.file, 3);
      const before = await saveDrawing(page);

      await homeTab(page);
      await page.locator('[data-cad-command="PROJECTTRANSFORM"]').click();
      await expect(page.locator('[data-survey-cad-project-transform-panel]')).toBeVisible({ timeout: 10000 });
      await addHelmertPair(page, '10,20,110,70', 1);
      await addHelmertPair(page, '110,-40,210,10', 2);
      await page.locator('[data-project-transform-apply]').click();

      // Operator-visible diagnostic; the panel stays open (session not committed).
      await expect(page.locator('[data-project-transform-result]')).toContainText(
        'CAD_PROJECT_TRANSFORM_IMPORTED_TIN_INVALID',
        { timeout: 10000 },
      );
      await expect(page.locator('[data-survey-cad-project-transform-panel]')).toBeVisible();

      const after = await saveDrawing(page);
      expect(projectText(after.project)).toBe(projectText(before.project));
      expect(draftText(after.draft)).toBe(draftText(before.draft));
      expect(entities(after.project)).toHaveLength(3);

      cleanup(before.dir, after.dir);
    } finally {
      cleanup(malformed.dir);
    }
    expect(errors).toEqual([]);
  });

  test('H: save/reopen persists transformed draft refs + TIN bounds', async ({ page, browser }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    await gotoCad(page, errors);
    await openDrawing(page, FIXTURE, 3);
    await applyRigidTranslate(page);
    const committed = await saveDrawing(page);

    // Fresh context: proves the reopened state came from the FILE, not memory.
    const reopenContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4174' });
    const reopenPage = await reopenContext.newPage();
    const reopenErrors: string[] = [];
    try {
      await gotoCad(reopenPage, reopenErrors);
      await openDrawing(reopenPage, committed.file, 3);
      const reopened = await saveDrawing(reopenPage);
      expect(projectText(reopened.project)).toBe(projectText(committed.project));
      expect(draftText(reopened.draft)).toBe(draftText(committed.draft));
      expect(viewport0(reopened.draft)['modelCenterX']).toBeCloseTo(2000000 + DX, 6);
      expect(label0(reopened.draft)['xModel']).toBeCloseTo(2000100 + DX, 6);
      expect(reopened.project['bounds']).toEqual({
        minX: 1900000 + DX,
        minY: 6000000 + DY,
        maxX: 2000100 + DX,
        maxY: 7000200 + DY,
      });
      cleanup(reopened.dir);
    } finally {
      await reopenContext.close();
      cleanup(committed.dir);
    }
    expect(errors).toEqual([]);
    expect(reopenErrors).toEqual([]);
  });
});
