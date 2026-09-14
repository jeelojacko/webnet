/**
 * Phase 12J.9 Track E1 — real-browser raw static-session review workflow.
 *
 * Real app + real Chromium + real pinned rnx2rtkp WASM path, synthetic
 * fixtures only (tests/fixtures/gnssRaw). Intake/planning letters (A–D,
 * I-planning, L, N-planning, R, P) run against the live UI. Processing
 * letters (E–H, J, K, M, O) are blocked by a product bug documented
 * below — they assert the correct behavior and FAIL rather than faking
 * a pass. Q (ANTEX subset staging) has no UI staging path and is
 * annotated SKIP.
 *
 * PRODUCT BUG (src/hooks/useGnssRawSession.ts, NOT touched per Track E1
 * scope): the hook's unmount cleanup calls pool.cancel(), which sets a
 * permanent cancelled flag, and RawSessionPool.enqueue() silently drops
 * jobs once cancelled. Under React StrictMode (src/main.tsx, active in
 * `npm run dev`) the initial mount runs setup→cleanup→setup on the SAME
 * pool instance, so the live pool is already cancelled before the first
 * run: clicking "Process raw session" settles instantly with zero jobs —
 * no progress, no review, no failed edges, Start-over appears. Signature
 * in this spec: raw-session-progress never appears; raw-session-review
 * and raw-session-failed never appear; no page error.
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

    // Q: ANTEX subset staging has no UI path — label is provenance-only.
    await dialog.getByTestId('raw-session-antex').fill('igs20.atx');
    await expect(dialog.getByTestId('raw-session-antex')).toHaveValue('igs20.atx');
    test.info().annotations.push({
      type: 'Q-ANTEX-subset',
      description: 'SKIP: no ANTEX file staging exists in the session UI; the label input is provenance-only and unplumbed into the export (antexSourceSha256 always null).',
    });

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
    // L1-only third station (SYNU): its edge must fail while siblings succeed.
    await uploadTrio(page, [`${FX}/base.06o`, `${FX}/rover.06o`, `${FX}/auxbad.06o`]);
    await expect(dialog.getByTestId('raw-session-inventory')).toContainText('SYNU');
    await dialog.getByTestId('raw-session-process').click();
    await expect(dialog.getByTestId('raw-session-progress')).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByTestId('raw-session-failed')).toBeVisible({ timeout: 300_000 });
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
});
