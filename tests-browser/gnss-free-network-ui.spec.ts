/**
 * Phase 12I.2 Worker D — real-browser E2E for free-network datum UI (§A-M).
 *
 * Real Chromium against the real Vite-served app. Real UI legs open the
 * Static GNSS workspace (default datum selector, BLOCKED/READY preflight,
 * constrained + free + ordinary-constrained solves); multifile legs drive
 * the production engine via dynamic `/src/...` imports inside
 * `page.evaluate` (no multifile UI panel exists — same pattern as
 * gnss-multifile-workflow.spec.ts). Synthetic networks only; the single
 * 251-station leg blocks pre-solve (no heavy solve in the agent tier).
 */
import { expect, test } from '@playwright/test';

const SETUP = `
  const FRAME = 'ITRF2020@2020.0';
  const EPOCH = '2020.0';
  const ELLIPSOID = 'GRS80';
  const COV = 'COV 0.000025 0 0 0.000025 0 0.000025';
  const COORDS = {
    A: [4000000, 1000000, 4800000],
    B: [4000100, 1000050, 4800020],
    C: [4000200, 999950, 4800100],
    D: [4000150, 1000100, 4799950],
    E: [4000250, 999900, 4800150],
    F: [4000050, 1000200, 4799850],
  };
  const coordOf = (id) => {
    if (COORDS[id]) return COORDS[id];
    let hash = 0;
    for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    return [4000000 + (hash % 900) * 100, 1000000 + (hash % 700) * 100, 4800000 + (hash % 500) * 100];
  };
  const nativeText = (stations, baselines, frame = FRAME) => {
    const lines = [\`FRAME ECEF \${frame} EPOCH \${EPOCH} ELLIPSOID \${ELLIPSOID}\`, 'UNITS M'];
    stations.forEach((s) => {
      const c = coordOf(s.id);
      lines.push(\`GX \${s.id} \${c[0]} \${c[1]} \${c[2]} \${s.fixed ? 'FIXED' : 'FREE'}\`);
    });
    baselines.forEach((b, i) => {
      const from = coordOf(b.from);
      const to = coordOf(b.to);
      const j = (b.noise ?? 0) * 0.001;
      lines.push(\`BL \${b.from} \${b.to} \${to[0] - from[0] + j} \${to[1] - from[1] - j} \${to[2] - from[2] + j} ID \${b.id ?? 'B' + (i + 1)} SESSION \${b.session ?? 'S1'}\`);
      lines.push(COV);
    });
    return lines.join('\\n') + '\\n';
  };
  const entry = (id, name, order, enabled = true) => ({
    id, name, kind: 'dat', path: 'data/' + id + '-' + name, enabled, order,
  });
  const TRI = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
  const TRI_BL = [
    { from: 'A', to: 'B', noise: 1 },
    { from: 'B', to: 'C', noise: 2 },
    { from: 'C', to: 'A', noise: 3 },
  ];
  const FREE_TEXT = nativeText(TRI, TRI_BL);
  const FIXED_TEXT = nativeText([{ id: 'A', fixed: true }, { id: 'B' }, { id: 'C' }], TRI_BL);
  const E = {};
`;

/** Evaluates `body` in the browser with the GNSS fixture setup in scope. */
const runInBrowser = (
  page: import('@playwright/test').Page,
  body: string,
): Promise<unknown> => page.evaluate(`(async () => { ${SETUP} ${body} })()`);

const openWorkspace = async (page: import('@playwright/test').Page) => {
  await page.goto('/');
  const openButton = page.getByRole('button', { name: 'Static GNSS workspace' });
  await expect(openButton).toBeVisible({ timeout: 30_000 });
  await openButton.click();
  const dialog = page.getByRole('dialog', { name: 'Static GNSS baseline workspace' });
  await expect(dialog).toBeVisible();
  return dialog;
};

test.describe('GNSS free-network datum UI (real browser)', () => {
  test('A: free import defaults to Constrained and blocks with missing-datum guidance', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const dialog = await openWorkspace(page);
    await dialog.getByRole('button', { name: 'Load synthetic sample' }).click();
    await expect(dialog).toContainText('Import summary');
    // Datum selector defaults to Constrained once a network is loaded.
    await expect(dialog.getByText('Datum handling')).toBeVisible();
    await expect(dialog.getByLabel('Constrained components only')).toBeChecked();
    await expect(dialog.getByLabel('Allow free components')).not.toBeChecked();

    // Engine leg: free single-file input blocks by default with datum guidance.
    const out = await runInBrowser(page, `
      const net = await import('/src/engine/gnssBaselineNetworkImport.ts');
      const sess = await import('/src/engine/gnssWorkspaceSession.ts');
      const adjust = await import('/src/engine/gnssBaselineAdjust.ts');
      const parsed = net.parseGnssBaselineText(FREE_TEXT, 'free.dat');
      const input = sess.buildGnssSessionInput(parsed.network, {});
      const preflight = sess.runGnssWorkspacePreflight(input);
      const datumGate = preflight.gates.find((g) => g.id === 'datumValid');
      let threw = '';
      try { adjust.runGnssBaselineAdjustment(input); }
      catch (e) { threw = String(e && e.message || e); }
      return {
        pass: preflight.pass,
        datumPass: datumGate.pass,
        datumMessage: datumGate.message,
        threw,
        defaultMode: input.datumMode,
      };
    `) as Record<string, unknown>;
    expect(out.defaultMode).toBe('constrained');
    expect(out.pass).toBe(false);
    expect(out.datumPass).toBe(false);
    expect(String(out.datumMessage)).toMatch(/Allow free components/);
    expect(String(out.threw)).toMatch(/no fully fixed|fixed/i);

    // UI leg: sample with its sole control freed stays BLOCKED in Constrained mode.
    await dialog.getByRole('button', { name: 'SYN_A control: fixed XYZ' }).click();
    await expect(dialog.getByRole('button', { name: 'SYN_A control: free' })).toBeVisible();
    await expect(dialog).toContainText('Allow free components');
    await expect(dialog).toContainText('has no fixed XYZ control');
    await dialog.getByRole('button', { name: 'Adjust (production route)' }).click();
    await expect(dialog).toContainText('has no fixed XYZ control');
    await expect(dialog).not.toContainText('Adjusted ECEF stations');
    expect(pageErrors).toEqual([]);
  });

  test('B: Allow free components unblocks a free network to SUCCESS', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const dialog = await openWorkspace(page);
    await dialog.getByRole('button', { name: 'Load synthetic sample' }).click();
    await expect(dialog).toContainText('Import summary');
    await dialog.getByRole('button', { name: 'SYN_A control: fixed XYZ' }).click();
    await dialog.getByLabel('Allow free components').check();
    await expect(dialog.getByLabel('Allow free components')).toBeChecked();
    await expect(dialog).toContainText('inner-constrained datum');
    await dialog.getByRole('button', { name: 'Adjust (production route)' }).click();
    await expect(dialog).toContainText('Adjusted ECEF stations', { timeout: 60_000 });
    await expect(dialog).toContainText('FREE — INNER CONSTRAINED');
    await expect(dialog).toContainText('Zero-mean ECEF coordinate corrections per free component');
    await expect(dialog).toContainText('Inner-constrained precision');
    expect(pageErrors).toEqual([]);
  });

  test('C: free result datum display, zero-mean wording, anchor never control', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('button', { name: 'Static GNSS workspace' }),
    ).toBeVisible({ timeout: 30_000 });
    const out = await runInBrowser(page, `
      const net = await import('/src/engine/gnssBaselineNetworkImport.ts');
      const sess = await import('/src/engine/gnssWorkspaceSession.ts');
      const adjust = await import('/src/engine/gnssBaselineAdjust.ts');
      const rep = await import('/src/engine/gnssBaselineReport.ts');
      const parsed = net.parseGnssBaselineText(FREE_TEXT, 'free.dat');
      const input = sess.buildGnssSessionInput(parsed.network, { datumMode: 'allow-free' });
      const preflight = sess.runGnssWorkspacePreflight(input, 'allow-free');
      const result = adjust.runGnssBaselineAdjustment(input);
      const built = rep.buildGnssReportFromInput(input);
      const text = rep.renderGnssBaselineTextReport(built.report);
      const anchor = result.datumSummary.components.find((c) => c.kind === 'free').anchor;
      const solvedAnchor = result.stations[anchor];
      return {
        ready: preflight.pass,
        converged: result.converged,
        kind: result.datumSummary.kind,
        modeRequested: result.datumSummary.modeRequested,
        defect: result.datumSummary.totalDatumDefect,
        anchor,
        anchorFixedX: solvedAnchor.fixedX ?? false,
        anchorFixed: solvedAnchor.fixed ?? false,
        hasDatumSection: text.includes('FREE') || text.includes('datum'),
        zeroMean: text.includes('Zero-mean') || text.includes('zero-mean') || text.includes('inner-constrained'),
        reportNamesAnchorAsControl: /FIXED|CONTROL/.test(text),
        route: result.routeProvenance,
      };
    `) as Record<string, unknown>;
    expect(out.ready).toBe(true);
    expect(out.converged).toBe(true);
    expect(out.kind).toBe('free');
    expect(out.modeRequested).toBe('allow-free');
    expect(out.defect).toBe(3);
    expect(out.route).toBe('typescript-dense');
    // Anchor is released working state, never control.
    expect(out.anchorFixedX).toBe(false);
    expect(out.anchorFixed).toBe(false);
    expect(out.reportNamesAnchorAsControl).toBe(false);
    expect(out.hasDatumSection).toBe(true);
    expect(out.zeroMean).toBe(true);
  });

  test('D: controlled job unchanged — ordinary constrained success, no free warnings', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const dialog = await openWorkspace(page);
    await dialog.getByRole('button', { name: 'Load synthetic sample' }).click();
    await expect(dialog).toContainText('Import summary');
    await dialog.getByRole('button', { name: 'Adjust (production route)' }).click();
    await expect(dialog).toContainText('Adjusted ECEF stations', { timeout: 60_000 });
    await expect(dialog).toContainText('Loop QC');
    await expect(dialog).not.toContainText('INNER CONSTRAINED');
    await expect(dialog).not.toContainText('Inner-constrained precision');
    const out = await runInBrowser(page, `
      const net = await import('/src/engine/gnssBaselineNetworkImport.ts');
      const sess = await import('/src/engine/gnssWorkspaceSession.ts');
      const adjust = await import('/src/engine/gnssBaselineAdjust.ts');
      const parsed = net.parseGnssBaselineText(FIXED_TEXT, 'fixed.dat');
      const input = sess.buildGnssSessionInput(parsed.network, {});
      const preflight = sess.runGnssWorkspacePreflight(input);
      const result = adjust.runGnssBaselineAdjustment(input);
      return {
        pass: preflight.pass,
        converged: result.converged,
        hasDatumSummary: result.datumSummary !== undefined,
        route: result.routeProvenance,
      };
    `) as Record<string, unknown>;
    expect(out.pass).toBe(true);
    expect(out.converged).toBe(true);
    expect(out.hasDatumSummary).toBe(false);
    expect(out.route).toBe('typescript-dense');
    expect(pageErrors).toEqual([]);
  });

  test('E: allow-free on a fully controlled job stays constrained and R2B-eligible', async ({ page }) => {
    const dialog = await openWorkspace(page);
    await dialog.getByRole('button', { name: 'Load synthetic sample' }).click();
    await expect(dialog).toContainText('Import summary');
    await dialog.getByLabel('Allow free components').check();
    await expect(dialog).toContainText('ordinary constrained adjustment');
    await expect(dialog).not.toContainText('datum invariant');
    await dialog.getByRole('button', { name: 'Adjust (production route)' }).click();
    await expect(dialog).toContainText('Adjusted ECEF stations', { timeout: 60_000 });
    await expect(dialog).not.toContainText('INNER CONSTRAINED');

    const out = await runInBrowser(page, `
      const proj = await import('/src/engine/gnssMultifileProject.ts');
      const r2b = await import('/src/workers/gnssBaselineNativeR2BRoute.ts');
      const stubs = await import('/tests/helpers/sparseTestStubs.ts');
      const files = [entry('f1', 'p1.dat', 0)];
      const output = proj.runGnssMultifileProjectSolve(files, { f1: FIXED_TEXT }, { datumMode: 'allow-free' });
      const eligibility = r2b.deriveGnssNativeR2BEligibility(output.input, { isWorker: true, minParams: 1 });
      const attempt = await r2b.runGnssBaselineWithNativeR2B(output.input, {
        isWorker: true,
        minParams: 1,
        correctionSolverOverride: stubs.countingCorrectionSolver(),
        blockSolverOverride: stubs.countingBlockSolver(),
      });
      return {
        hasDatumSummary: output.result.datumSummary !== undefined,
        summaryKinds: output.summary.datumComponents.map((c) => c.kind),
        eligible: eligibility.eligible,
        route: attempt.route,
        reasons: attempt.reasons.join(' '),
        provenance: attempt.result.routeProvenance,
      };
    `) as Record<string, unknown>;
    expect(out.hasDatumSummary).toBe(false);
    expect(out.summaryKinds).toEqual(['constrained']);
    expect(out.eligible).toBe(true);
    expect(out.route).toBe('native-sparse-selected-qxx');
    expect(String(out.reasons)).not.toMatch(/free-network/);
    expect(out.provenance).toBe('native-sparse-selected-qxx');
  });

  test('F: sole control freed solves free/TS-dense with identical residuals, SEUW, relative geometry', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('button', { name: 'Static GNSS workspace' }),
    ).toBeVisible({ timeout: 30_000 });
    const out = await runInBrowser(page, `
      const net = await import('/src/engine/gnssBaselineNetworkImport.ts');
      const sess = await import('/src/engine/gnssWorkspaceSession.ts');
      const adjust = await import('/src/engine/gnssBaselineAdjust.ts');
      const fixed = net.parseGnssBaselineText(FIXED_TEXT, 'fixed.dat');
      const free = net.parseGnssBaselineText(FREE_TEXT, 'free.dat');
      const held = adjust.runGnssBaselineAdjustment(sess.buildGnssSessionInput(fixed.network, {}));
      const released = adjust.runGnssBaselineAdjustment(
        sess.buildGnssSessionInput(free.network, { datumMode: 'allow-free' }));
      const maxResidDiff = Math.max(...held.residuals.map((r, i) => {
        const s = released.residuals[i];
        return Math.max(Math.abs(r.vX - s.vX), Math.abs(r.vY - s.vY), Math.abs(r.vZ - s.vZ));
      }));
      const seuwDiff = Math.abs(held.varianceFactor - released.varianceFactor);
      // Relative geometry: every inter-station vector must agree.
      const ids = Object.keys(held.stations).sort();
      let maxGeomDiff = 0;
      for (let a = 0; a < ids.length; a += 1) {
        for (let b = a + 1; b < ids.length; b += 1) {
          const ha = held.stations[ids[a]], hb = held.stations[ids[b]];
          const fa = released.stations[ids[a]], fb = released.stations[ids[b]];
          maxGeomDiff = Math.max(maxGeomDiff,
            Math.abs((hb.x - ha.x) - (fb.x - fa.x)),
            Math.abs((hb.y - ha.y) - (fb.y - fa.y)),
            Math.abs((hb.h - ha.h) - (fb.h - fa.h)));
        }
      }
      return {
        heldConverged: held.converged,
        freeConverged: released.converged,
        freeKind: released.datumSummary.kind,
        freeRoute: released.routeProvenance,
        seuwDiff,
        maxResidDiff,
        maxGeomDiff,
      };
    `) as Record<string, number | string | boolean>;
    expect(out.heldConverged).toBe(true);
    expect(out.freeConverged).toBe(true);
    expect(out.freeKind).toBe('free');
    expect(out.freeRoute).toBe('typescript-dense');
    expect(out.seuwDiff as number).toBeLessThan(1e-12);
    expect(out.maxResidDiff as number).toBeLessThan(1e-9);
    expect(out.maxGeomDiff as number).toBeLessThan(1e-9);
  });

  test('G: mixed multifile project — constrained BLOCKED, allow-free MIXED with correct DOF/rank', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('button', { name: 'Static GNSS workspace' }),
    ).toBeVisible({ timeout: 30_000 });
    const out = await runInBrowser(page, `
      const proj = await import('/src/engine/gnssMultifileProject.ts');
      const flag = await import('/src/engine/gnssMultifileFlag.ts');
      flag.setGnssMultifileEnabled(true);
      const part1 = FREE_TEXT;
      const part2 = nativeText([{ id: 'D', fixed: true }, { id: 'E' }, { id: 'F' }], [
        { from: 'D', to: 'E', noise: 4 },
        { from: 'E', to: 'F', noise: 5 },
        { from: 'F', to: 'D', noise: 6 },
      ]);
      const files = [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1)];
      const texts = { f1: part1, f2: part2 };
      let blocked = '';
      try { proj.runGnssMultifileProjectSolve(files, texts); }
      catch (e) { blocked = String(e && e.message || e); }
      const output = proj.runGnssMultifileProjectSolve(files, texts, { datumMode: 'allow-free' });
      const summary = output.result.datumSummary;
      return {
        blocked,
        kind: summary.kind,
        defect: summary.totalDatumDefect,
        fullParams: summary.fullParameterCount,
        rank: summary.estimableRank,
        dof: output.result.dof,
        numObs: output.result.numObsEquations,
        converged: output.result.converged,
        componentKinds: summary.components.map((c) => c.kind).sort(),
      };
    `) as Record<string, unknown>;
    expect(String(out.blocked)).toMatch(/no fully fixed|fixed/i);
    expect(out.kind).toBe('mixed');
    expect(out.defect).toBe(3);
    expect(out.componentKinds).toEqual(['constrained', 'free']);
    // Rank/DOF accounting: one free component costs defect 3.
    expect(out.rank).toBe((out.fullParams as number) - 3);
    expect(out.dof).toBe((out.numObs as number) - (out.rank as number));
    expect(out.converged).toBe(true);
  });

  test('H: multi-file free network (two no-control sources) solves FREE', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('button', { name: 'Static GNSS workspace' }),
    ).toBeVisible({ timeout: 30_000 });
    const out = await runInBrowser(page, `
      const proj = await import('/src/engine/gnssMultifileProject.ts');
      const flag = await import('/src/engine/gnssMultifileFlag.ts');
      flag.setGnssMultifileEnabled(true);
      const part2 = nativeText([{ id: 'D' }, { id: 'E' }, { id: 'F' }], [
        { from: 'D', to: 'E', noise: 4 },
        { from: 'E', to: 'F', noise: 5 },
        { from: 'F', to: 'D', noise: 6 },
      ]);
      const files = [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1)];
      const output = proj.runGnssMultifileProjectSolve(files, { f1: FREE_TEXT, f2: part2 }, { datumMode: 'allow-free' });
      return {
        kind: output.result.datumSummary.kind,
        defect: output.result.datumSummary.totalDatumDefect,
        converged: output.result.converged,
        stations: output.summary.uniqueStations,
        baselines: output.summary.baselineCount,
      };
    `) as Record<string, unknown>;
    expect(out.kind).toBe('free');
    expect(out.defect).toBe(6);
    expect(out.converged).toBe(true);
    expect(out.stations).toBe(6);
    expect(out.baselines).toBe(6);
  });

  test('I: add/remove control recomputes classification FREE -> CONSTRAINED -> FREE', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('button', { name: 'Static GNSS workspace' }),
    ).toBeVisible({ timeout: 30_000 });
    const out = await runInBrowser(page, `
      const proj = await import('/src/engine/gnssMultifileProject.ts');
      const flag = await import('/src/engine/gnssMultifileFlag.ts');
      flag.setGnssMultifileEnabled(true);
      const files = [entry('f1', 'p1.dat', 0)];
      const texts = { f1: FREE_TEXT };
      const asFree = proj.runGnssMultifileProjectSolve(files, texts, { datumMode: 'allow-free' });
      const held = proj.runGnssMultifileProjectSolve(files, texts, {
        datumMode: 'allow-free', controlOverrides: { A: true } });
      const released = proj.runGnssMultifileProjectSolve(files, texts, { datumMode: 'allow-free' });
      return {
        first: asFree.result.datumSummary.kind,
        secondHasDatum: held.result.datumSummary !== undefined,
        secondKinds: held.summary.datumComponents.map((c) => c.kind),
        third: released.result.datumSummary.kind,
        sameAsFirst: JSON.stringify(released.result.stations) === JSON.stringify(asFree.result.stations),
      };
    `) as Record<string, unknown>;
    expect(out.first).toBe('free');
    expect(out.secondHasDatum).toBe(false);
    expect(out.secondKinds).toEqual(['constrained']);
    expect(out.third).toBe('free');
    expect(out.sameAsFirst).toBe(true);
  });

  test('J: allow-free persists across save/reload with identical preflight and result', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('button', { name: 'Static GNSS workspace' }),
    ).toBeVisible({ timeout: 30_000 });
    const first = await runInBrowser(page, `
      const proj = await import('/src/engine/gnssMultifileProject.ts');
      const sess = await import('/src/engine/gnssWorkspaceSession.ts');
      const flag = await import('/src/engine/gnssMultifileFlag.ts');
      flag.setGnssMultifileEnabled(true);
      const persisted = { ...proj.emptyGnssMultifilePersisted(), datumMode: 'allow-free' };
      const output = proj.runGnssMultifileProjectSolve([entry('f1', 'p1.dat', 0)], { f1: FREE_TEXT }, {
        datumMode: persisted.datumMode });
      const preflight = sess.runGnssWorkspacePreflight(output.input, persisted.datumMode);
      const bag = JSON.stringify(proj.serializeGnssMultifilePersisted(persisted));
      window.localStorage.setItem('webnet:test-gnss-free-persist', bag);
      window.sessionStorage.setItem('webnet:test-gnss-free-persist', bag);
      return {
        stations: JSON.stringify(output.result.stations),
        vf: output.result.varianceFactor,
        kind: output.result.datumSummary.kind,
        preflightPass: preflight.pass,
        bag,
      };
    `) as { stations: string; vf: number; kind: string; preflightPass: boolean; bag: string };
    expect(first.kind).toBe('free');
    expect(first.preflightPass).toBe(true);

    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Static GNSS workspace' }),
    ).toBeVisible({ timeout: 30_000 });
    const second = await page.evaluate((bag: string) => (async () => {
      // @ts-ignore - browser-only Vite-served module path
      const proj = await import('/src/engine/gnssMultifileProject.ts');
      // @ts-ignore - browser-only Vite-served module path
      const sess = await import('/src/engine/gnssWorkspaceSession.ts');
      const stored = window.localStorage.getItem('webnet:test-gnss-free-persist')
        ?? window.sessionStorage.getItem('webnet:test-gnss-free-persist')
        ?? bag;
      const reloaded = proj.deserializeGnssMultifilePersisted(JSON.parse(stored));
      const FRAME = 'ITRF2020@2020.0';
      const COV = 'COV 0.000025 0 0 0.000025 0 0.000025';
      const COORDS: Record<string, number[]> = {
        A: [4000000, 1000000, 4800000],
        B: [4000100, 1000050, 4800020],
        C: [4000200, 999950, 4800100],
      };
      const lines = [`FRAME ECEF ${FRAME} EPOCH 2020.0 ELLIPSOID GRS80`, 'UNITS M'];
      (['A', 'B', 'C'] as const).forEach((id) => {
        const c = COORDS[id] as number[];
        lines.push(`GX ${id} ${c[0]} ${c[1]} ${c[2]} FREE`);
      });
      const edges = [['A', 'B', 1], ['B', 'C', 2], ['C', 'A', 3]] as const;
      edges.forEach(([from, to, noise], i) => {
        const f = COORDS[from] as number[];
        const t = COORDS[to] as number[];
        const j = noise * 0.001;
        lines.push(`BL ${from} ${to} ${t[0] - f[0] + j} ${t[1] - f[1] - j} ${t[2] - f[2] + j} ID B${i + 1} SESSION S1`);
        lines.push(COV);
      });
      const text = `${lines.join('\n')}\n`;
      const output = proj.runGnssMultifileProjectSolve(
        [{ id: 'f1', name: 'p1.dat', kind: 'dat', path: 'data/f1-p1.dat', enabled: true, order: 0 }],
        { f1: text },
        { datumMode: reloaded.datumMode },
      );
      const preflight = sess.runGnssWorkspacePreflight(output.input, reloaded.datumMode);
      return {
        stations: JSON.stringify(output.result.stations),
        vf: output.result.varianceFactor,
        kind: output.result.datumSummary?.kind,
        preflightPass: preflight.pass,
        modeRestored: reloaded.datumMode,
      };
    })(), first.bag) as { stations: string; vf: number; kind: string; preflightPass: boolean; modeRestored: string };
    expect(second.modeRestored).toBe('allow-free');
    expect(second.preflightPass).toBe(first.preflightPass);
    expect(second.kind).toBe(first.kind);
    expect(second.stations).toBe(first.stations);
    expect(second.vf).toBe(first.vf);
  });

  test('K: 251-station free job blocks pre-solve with user-facing 250 text', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('button', { name: 'Static GNSS workspace' }),
    ).toBeVisible({ timeout: 30_000 });
    const out = await runInBrowser(page, `
      const proj = await import('/src/engine/gnssMultifileProject.ts');
      const sess = await import('/src/engine/gnssWorkspaceSession.ts');
      const net = await import('/src/engine/gnssBaselineNetworkImport.ts');
      const flag = await import('/src/engine/gnssMultifileFlag.ts');
      const errText = await import('/src/components/gnss/gnssRunErrorText.ts');
      flag.setGnssMultifileEnabled(true);
      const names = Array.from({ length: 251 }, (_, i) => 'S' + String(i).padStart(4, '0'));
      const text = nativeText(
        names.map((id) => ({ id })),
        names.map((from, i) => ({ from, to: names[(i + 1) % names.length], noise: i % 7 })),
      );
      let solveError = '';
      try {
        proj.runGnssMultifileProjectSolve([entry('f1', 'ring.dat', 0)], { f1: text }, { datumMode: 'allow-free' });
      } catch (e) { solveError = String(e && e.message || e); }
      // Single-file preflight path blocks the same way (still pre-solve).
      const parsed = net.parseGnssBaselineText(text, 'ring.dat');
      const input = sess.buildGnssSessionInput(parsed.network, { datumMode: 'allow-free' });
      const preflight = sess.runGnssWorkspacePreflight(input, 'allow-free');
      const datumGate = preflight.gates.find((g) => g.id === 'datumValid');
      const mapped = errText.mapGnssRunError(solveError);
      return {
        solveError,
        preflightPass: preflight.pass,
        datumPass: datumGate.pass,
        datumMessage: datumGate.message,
        mappedText: mapped ? mapped.text : null,
        stationCount: names.length,
      };
    `) as Record<string, unknown>;
    expect(out.stationCount).toBe(251);
    expect(String(out.solveError)).toMatch(/FREE_NETWORK_SIZE_LIMIT/);
    expect(String(out.solveError)).toMatch(/250/);
    expect(out.preflightPass).toBe(false);
    expect(out.datumPass).toBe(false);
    expect(String(out.datumMessage)).toMatch(/250/);
    expect(out.mappedText).not.toBeNull();
    expect(String(out.mappedText)).toMatch(/250/);
  });

  test('L: extra rank defect (isolated station) fails with actionable guidance', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('button', { name: 'Static GNSS workspace' }),
    ).toBeVisible({ timeout: 30_000 });
    const out = await runInBrowser(page, `
      const proj = await import('/src/engine/gnssMultifileProject.ts');
      const flag = await import('/src/engine/gnssMultifileFlag.ts');
      const errText = await import('/src/components/gnss/gnssRunErrorText.ts');
      flag.setGnssMultifileEnabled(true);
      const text = nativeText([...TRI, { id: 'GHOST' }], TRI_BL);
      let solveError = '';
      try {
        proj.runGnssMultifileProjectSolve([entry('f1', 'p1.dat', 0)], { f1: text }, { datumMode: 'allow-free' });
      } catch (e) { solveError = String(e && e.message || e); }
      const mapped = errText.mapGnssRunError(solveError);
      return { solveError, mappedText: mapped ? mapped.text : null, detail: mapped ? mapped.detail : null };
    `) as Record<string, unknown>;
    expect(String(out.solveError)).toMatch(/GNSS_FREE_EXTRA_RANK_DEFECT/);
    expect(out.mappedText).not.toBeNull();
    expect(String(out.mappedText)).toMatch(/additional rank deficiency/);
    expect(String(out.mappedText)).toMatch(/isolated stations/);
    expect(String(out.detail)).toMatch(/GNSS_FREE_EXTRA_RANK_DEFECT/);
  });

  test('M: computational gauge anchor absent from rendered surfaces except debug logs', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('button', { name: 'Static GNSS workspace' }),
    ).toBeVisible({ timeout: 30_000 });
    const out = await runInBrowser(page, `
      const proj = await import('/src/engine/gnssMultifileProject.ts');
      const flag = await import('/src/engine/gnssMultifileFlag.ts');
      const rep = await import('/src/engine/gnssBaselineReport.ts');
      const loops = await import('/src/engine/gnssBaselineLoops.ts');
      flag.setGnssMultifileEnabled(true);
      const output = proj.runGnssMultifileProjectSolve([entry('f1', 'p1.dat', 0)], { f1: FREE_TEXT }, {
        datumMode: 'allow-free' });
      const anchor = output.result.datumSummary.components.find((c) => c.kind === 'free').anchor;
      const built = rep.buildGnssReportFromInput(output.input);
      const reportText = rep.renderGnssBaselineTextReport(built.report);
      const provenance = proj.buildGnssMultifileProvenanceSection(
        output.provenance, output.input.baselines, output.mergeNotes, output.summary.blockingErrors).join('\\n');
      const exported = proj.buildGnssMultifileJsonExport(output);
      const loopText = (() => {
        try {
          return loops.computeGnssLoopClosures(output.input.baselines).loops.map((l) => l.id).join(' ');
        } catch { return ''; }
      })();
      // Simulated station-table + datum-section text (what the UI renders).
      const stationTable = Object.keys(output.result.stations).sort().map((id) => {
        const s = output.result.stations[id];
        const fixed = !!s.fixedX && !!s.fixedY && !!s.fixedH;
        return id + ' ' + (fixed ? 'FIXED' : 'FREE');
      }).join('\\n');
      const datumSection = output.result.datumSummary.components.map((c, i) =>
        'Component ' + (i + 1) + ' — ' + (c.kind === 'free' ? 'free, inner constrained' : 'constrained')).join('\\n');
      const logs = 'logs' in output.result ? output.result.logs.join('\\n') : '';
      const anchorLines = logs.split('\\n').filter((line) => line.includes(anchor));
      const anchorWordLines = reportText.split('\\n').filter((line) => /anchor/i.test(line));
      return {
        anchor,
        anchorWordLines,
        anchorWordsAllowedOnly: anchorWordLines.every((line) => /computational.gauge/i.test(line)),
        gaugeTokenPresent: reportText.includes('computational-gauge=' + anchor),
        provenanceHasAnchorWord: /anchor/i.test(provenance),
        provenanceHasControl: /FIXED|CONTROL/.test(provenance),
        controlsNameAnchor: output.summary.controlBySource.join('\\n').includes(anchor),
        stationProvenanceNamesAnchor: JSON.stringify(exported['stationProvenance']).includes("'" + anchor + "'"),
        loopsNameAnchor: loopText.includes(anchor),
        datumSectionNamesAnchor: datumSection.includes(anchor),
        anchorRow: stationTable.split('\\n').find((line) => line.startsWith(anchor)),
        anchorLogLines: anchorLines.length,
        anchorLogsDebugOnly: anchorLines.every((line) => /debug only|computational gauge/i.test(line)),
      };
    `) as Record<string, unknown>;
    expect(out.anchor).toBe('A');
    // The words anchor/gauge appear in the report only on allowed Computational-gauge lines,
    // and the anchor id is carried only by the `computational-gauge=` debug token.
    expect((out.anchorWordLines as string[]).length).toBeGreaterThan(0);
    expect(out.anchorWordsAllowedOnly).toBe(true);
    expect(out.gaugeTokenPresent).toBe(true);
    expect(out.provenanceHasAnchorWord).toBe(false);
    expect(out.provenanceHasControl).toBe(false);
    expect(out.controlsNameAnchor).toBe(false);
    expect(out.stationProvenanceNamesAnchor).toBe(false);
    expect(out.loopsNameAnchor).toBe(false);
    expect(out.datumSectionNamesAnchor).toBe(false);
    // Anchor renders as an ordinary FREE station, never Fixed/Control/Datum.
    expect(out.anchorRow).toBe('A FREE');
    // The only surface naming the anchor is the allowed debug log line.
    expect(out.anchorLogLines as number).toBeGreaterThan(0);
    expect(out.anchorLogsDebugOnly).toBe(true);
  });
});
