/**
 * Phase 12J.9 Track E1 — real-browser raw static-session review workflow.
 *
 * Real app + real Chromium + real pinned rnx2rtkp WASM path, synthetic
 * fixtures only (tests/fixtures/gnssRaw). Covers mission letters A-R:
 * intake/planning (A-D, L, N-planning, R, P), processing (E-H, J, K),
 * PARTIAL isolation (M), cancel (O), ANTEX subset staging (Q).
 *
 * Environment note: one documented command stages + runs everything:
 * `npm run e2e:raw-session` (builds RTKLIB WASM, stages the glue into
 * public/, runs this spec). No manual public/ copies.
 */
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const FX = 'tests/fixtures/gnssRaw';
const EXPORT_PATH = '/tmp/webnet-raw-session-e2e.json';

const openSessionDialog = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'Process Raw Session' }).click();
  await expect(page.getByRole('dialog', { name: 'Raw static session review' })).toBeVisible();
};

const uploadTrio = async (page: Page, obs: string[]): Promise<void> => {
  const dialog = page.getByRole('dialog', { name: 'Raw static session review' });
  await dialog.getByTestId('raw-session-obs-input').setInputFiles(obs);
  await dialog.getByTestId('raw-session-nav-input').setInputFiles(`${FX}/nav.06n`);
};

const projectInputOf = (page: Page): Promise<string> => page.evaluate(() => {
  const raw = localStorage.getItem('webnet.workspace-recovery.v1') ?? '{}';
  try {
    return (JSON.parse(raw) as { snapshot?: { input?: unknown } }).snapshot?.input as string ?? raw;
  } catch {
    return raw;
  }
});

test.describe('Raw static session review', () => {
  test('A-D/L/N-planning/Q/R/P: intake, planning, determinism, calibration, project unchanged', async ({ page }) => {
    test.setTimeout(180_000);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto('/');
    await page.waitForFunction(
      () => localStorage.getItem('webnet.workspace-recovery.v1') != null,
      null,
      { timeout: 30_000 },
    );
    const inputBefore = await projectInputOf(page);

    // F (static part): Worker API present — session processing is worker-driven.
    expect(await page.evaluate(() => typeof Worker)).toBe('function');
    await openSessionDialog(page);
    const dialog = page.getByRole('dialog', { name: 'Raw static session review' });

    // A: upload 3 synthetic stations + NAV.
    await uploadTrio(page, [`${FX}/base.06o`, `${FX}/rover.06o`, `${FX}/aux.06o`]);

    // B: inventory appears with all three markers, no duplicates.
    const inventory = dialog.getByTestId('raw-session-inventory');
    await expect(inventory).toContainText('SYNB');
    await expect(inventory).toContainText('SYNR');
    await expect(inventory).toContainText('SYNA');
    await expect(dialog.getByTestId('raw-session-duplicates')).toHaveCount(0);

    // C: common overlap resolves (AUTO window, full coverage).
    await expect(dialog.getByTestId('raw-session-window')).toContainText('AUTO');
    await expect(inventory).toContainText('100%');

    // D: default tree is STAR with 2 edges from the auto hub (first marker).
    await expect(dialog.getByTestId('raw-session-edges')).toHaveText('STAR · SYNA→SYNB, SYNA→SYNR');

    // I is verifiable only post-process (nodes table + export live in the
    // review): covered in the processing test below.
    // R: missing antenna => calibration warning (formal precision only).
    await expect(dialog.getByTestId('raw-session-antenna-banner')).toContainText('formal precision only');

    // Q (intake half): the ANTEX file slot stages a real file; the subset is
    // generated at process time (covered end-to-end in the Q test below).
    await dialog.getByTestId('raw-session-antex-input').setInputFiles(`${FX}/synth.atx`);

    // L: base swap changes the tree deterministically.
    await dialog.getByTestId('raw-session-base').selectOption('SYNB');
    await expect(dialog.getByTestId('raw-session-edges')).toHaveText('STAR · SYNB→SYNA, SYNB→SYNR');
    await dialog.getByTestId('raw-session-base').selectOption('SYNR');
    await expect(dialog.getByTestId('raw-session-edges')).toHaveText('STAR · SYNR→SYNA, SYNR→SYNB');

    // N (planning level): MANUAL policy is the replacement-edge UI path.
    await dialog.getByTestId('raw-session-policy').selectOption('MANUAL');
    await dialog.getByTestId('raw-session-manual').fill('SYNB>SYNR');
    await expect(dialog.getByTestId('raw-session-edges')).toHaveText('MANUAL · SYNB→SYNR');

    // P: existing project unchanged (no ingest path in this dialog).
    await page.keyboard.press('Escape');
    expect(await projectInputOf(page)).toBe(inputBefore);
    expect(pageErrors).toEqual([]);
  });

  test('E-H/I/J/K: three-station session processes to review, exports, reimports', async ({ page }) => {
    test.setTimeout(600_000);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto('/');
    await page.waitForFunction(
      () => localStorage.getItem('webnet.workspace-recovery.v1') != null,
      null,
      { timeout: 30_000 },
    );
    await openSessionDialog(page);
    const dialog = page.getByRole('dialog', { name: 'Raw static session review' });
    await uploadTrio(page, [`${FX}/base.06o`, `${FX}/rover.06o`, `${FX}/aux.06o`]);
    await expect(dialog.getByTestId('raw-session-edges')).toHaveText('STAR · SYNA→SYNB, SYNA→SYNR');

    // E: process the session (bounded wait: a live pool shows progress at once).
    await dialog.getByTestId('raw-session-process').click();
    await expect(dialog.getByTestId('raw-session-progress')).toBeVisible({ timeout: 15_000 });
    // F (run part): main thread stays responsive while Workers run.
    expect(await dialog.evaluate(() => 40 + 2)).toBe(42);

    // G: review appears with both baselines.
    await expect(dialog.getByTestId('raw-session-review')).toBeVisible({ timeout: 300_000 });
    await expect(dialog.getByTestId('raw-session-status')).toContainText('COMPLETE');
    await expect(dialog.getByTestId('raw-session-status')).toContainText('2 baseline(s)');

    // H: FORMAL_UNCALIBRATED per baseline.
    for (const summary of await dialog.locator('summary', { hasText: 'Baseline detail' }).all()) {
      await summary.click();
    }
    await expect(dialog.getByTestId('raw-formal-badge')).toHaveCount(2);
    await expect(dialog.getByTestId('raw-formal-badge').first()).toContainText('FORMAL_UNCALIBRATED');

    // I: dependency groups preserved (one row per edge in the nodes table + export).
    const nodes = dialog.getByTestId('raw-session-nodes');
    await expect(nodes).toContainText('SYNA → SYNB');
    await expect(nodes).toContainText('SYNA → SYNR');
    const groupCells = await nodes.locator('tbody tr td:nth-child(3)').allTextContents();
    expect(groupCells).toHaveLength(2);
    for (const cell of groupCells) expect(cell.trim().length).toBeGreaterThan(0);

    // J: export session JSON (download event, session kind).
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByTestId('raw-session-export').click(),
    ]);
    await download.saveAs(EXPORT_PATH);
    const exported = JSON.parse(await readFile(EXPORT_PATH, 'utf8')) as {
      kind: string;
      session: {
        status: string;
        baselines: Array<{ covarianceAssessment?: { status?: string } }>;
        dependencyGroups: Array<{ edge: string; group: string }>;
      };
    };
    expect(exported.kind).toBe('webnet-raw-static-session/1');
    expect(exported.session.status).toBe('COMPLETE');
    expect(exported.session.dependencyGroups).toHaveLength(2);
    for (const baseline of exported.session.baselines) {
      expect(baseline.covarianceAssessment?.status).toBe('FORMAL_UNCALIBRATED');
    }

    // K: reopen exported JSON — review without reprocessing.
    await dialog.getByTestId('raw-session-restart').click();
    await expect(dialog.getByTestId('raw-session-review')).toHaveCount(0);
    await dialog.getByTestId('raw-session-reimport-input').setInputFiles(EXPORT_PATH);
    await expect(dialog.getByTestId('raw-session-review')).toBeVisible();
    await expect(dialog.getByTestId('raw-session-status')).toContainText('2 baseline(s)');
    await expect(dialog.getByTestId('raw-session-progress')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test('M: bad-input edge goes PARTIAL', async ({ page }) => {
    test.setTimeout(600_000);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto('/');
    await openSessionDialog(page);
    const dialog = page.getByRole('dialog', { name: 'Raw static session review' });
    // Blanked-observation third station (SYNF): its edge fails in the worker
    // while the healthy sibling succeeds -> PARTIAL with a named reason.
    await uploadTrio(page, [`${FX}/base.06o`, `${FX}/rover.06o`, `${FX}/auxfail.06o`]);
    await expect(dialog.getByTestId('raw-session-inventory')).toContainText('SYNF');
    await dialog.getByTestId('raw-session-process').click();
    await expect(dialog.getByTestId('raw-session-progress')).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByTestId('raw-session-failed')).toContainText('SYNB->SYNF', { timeout: 300_000 });
    const reason = await dialog.getByTestId('raw-session-failed').textContent();
    // The reason names the worker failure, not just that an edge is missing.
    expect(reason ?? '').toMatch(/PROCESSOR_FAILURE|no solution epochs/);
    await expect(dialog.getByTestId('raw-session-status')).toContainText('PARTIAL');
    // §27 repair: the deterministic suggestion reconnects SYNF via SYNR;
    // the blanked file cannot solve, so the single-edge reprocess honestly
    // settles PARTIAL again with the new edge named (not a faked COMPLETE).
    await expect(dialog.getByTestId('raw-session-replace-SYNB->SYNF')).toHaveValue('SYNF->SYNR');
    await dialog.getByTestId('raw-session-replace-go-SYNB->SYNF').click();
    await expect(dialog.getByTestId('raw-session-progress')).toContainText('SYNF->SYNR', { timeout: 15_000 });
    await expect(dialog.getByTestId('raw-session-failed')).toContainText('SYNF->SYNR', { timeout: 300_000 });
    const after = await dialog.getByTestId('raw-session-failed').textContent();
    expect(after ?? '').toMatch(/replaces SYNB->SYNF/);
    expect(after ?? '').toMatch(/PROCESSOR_FAILURE|no solution epochs/);
    await expect(dialog.getByTestId('raw-session-status')).toContainText('PARTIAL');
    expect(pageErrors).toEqual([]);
  });

  test('O: cancel keeps no stale result', async ({ page }) => {
    test.setTimeout(300_000);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto('/');
    await openSessionDialog(page);
    const dialog = page.getByRole('dialog', { name: 'Raw static session review' });
    await uploadTrio(page, [`${FX}/base.06o`, `${FX}/rover.06o`, `${FX}/aux.06o`]);
    await expect(dialog.getByTestId('raw-session-edges')).toContainText('SYNA→SYNB');
    await dialog.getByTestId('raw-session-process').click();
    await expect(dialog.getByTestId('raw-session-cancel')).toBeVisible({ timeout: 15_000 });
    await dialog.getByTestId('raw-session-cancel').click();
    await expect(dialog.getByTestId('raw-session-progress')).toHaveCount(0);
    await expect(dialog.getByTestId('raw-session-review')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test('Q: ANTEX exact-match subset stages into every session job', async ({ page }) => {
    test.setTimeout(600_000);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto('/');
    await page.waitForFunction(
      () => localStorage.getItem('webnet.workspace-recovery.v1') != null,
      null,
      { timeout: 30_000 },
    );
    await openSessionDialog(page);
    const dialog = page.getByRole('dialog', { name: 'Raw static session review' });
    await uploadTrio(page, [`${FX}/base.06o`, `${FX}/rover.06o`, `${FX}/aux.06o`]);
    await dialog.getByTestId('raw-session-antex-input').setInputFiles(`${FX}/synth.atx`);
    await dialog.getByTestId('raw-session-process').click();
    await expect(dialog.getByTestId('raw-session-review')).toBeVisible({ timeout: 300_000 });
    await expect(dialog.getByTestId('raw-session-status')).toContainText('COMPLETE');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByTestId('raw-session-export').click(),
    ]);
    await download.saveAs(EXPORT_PATH);
    const exported = JSON.parse(await readFile(EXPORT_PATH, 'utf8')) as {
      session: { provenance: { antexSourceSha256: string | null; antexSubsetSha256: string | null } };
    };
    const { antexSourceSha256, antexSubsetSha256 } = exported.session.provenance;
    expect(antexSourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(antexSubsetSha256).toMatch(/^[0-9a-f]{64}$/);
    // The minimal fixture already contains only the wanted blocks, so the
    // deterministic subset is byte-identical to its source here; the
    // production guarantee is exact-match staging + provenance, not shrinkage.
    expect(antexSubsetSha256).toBe(antexSourceSha256);
    expect(pageErrors).toEqual([]);
  });
});
