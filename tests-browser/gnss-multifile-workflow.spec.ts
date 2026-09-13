/**
 * Phase 12H.2 Worker B — real-browser multi-file static-GNSS E2E (§11 A-K).
 *
 * Synthetic native-BL sources built in-test (no vendor files). Engine is
 * driven via dynamic `/src/...` imports inside `page.evaluate`, which
 * executes in a real Chromium against the real Vite-served app modules.
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
  };
  const coordOf = (id) => COORDS[id] ?? [4000500, 1000500, 4800500];
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
      const sol = b.solution ? \` SOLUTION \${b.solution}\` : '';
      lines.push(\`BL \${b.from} \${b.to} \${to[0] - from[0] + j} \${to[1] - from[1] - j} \${to[2] - from[2] + j} ID \${b.id ?? 'B' + (i + 1)} SESSION \${b.session ?? 'S1'}\${sol}\`);
      lines.push(COV);
    });
    return lines.join('\\n') + '\\n';
  };
  const entry = (id, name, order, enabled = true) => ({
    id, name, kind: 'dat', path: 'data/' + id + '-' + name, enabled, order,
  });
  const ALL_STATIONS = [{ id: 'A', fixed: true }, { id: 'B' }, { id: 'C' }, { id: 'D' }];
  const ALL_BASELINES = [
    { from: 'A', to: 'B', noise: 1 },
    { from: 'B', to: 'C', noise: 2 },
    { from: 'C', to: 'D', noise: 3 },
    { from: 'A', to: 'C', noise: 5 },
  ];
  const PART1 = nativeText(ALL_STATIONS, ALL_BASELINES.slice(0, 2));
  const PART2 = nativeText(ALL_STATIONS, ALL_BASELINES.slice(2));
  const E = {};
`;

/** Evaluates `body` in the browser with the GNSS fixture setup in scope. */
const runInBrowser = (
  page: import('@playwright/test').Page,
  body: string,
): Promise<unknown> => page.evaluate(`(async () => { ${SETUP} ${body} })()`);

test.describe('Static GNSS multifile (real browser)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('button', { name: 'Static GNSS workspace' }),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('A: multi-source READY + adjust + combined results', async ({ page }) => {
    const out = await runInBrowser(page, `
      const flag = await import('/src/engine/gnssMultifileFlag.ts');
      const proj = await import('/src/engine/gnssMultifileProject.ts');
      E.flagDefault = flag.isGnssMultifileEnabled();
      const files = [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1)];
      const output = proj.runGnssMultifileProjectSolve(files, { f1: PART1, f2: PART2 });
      return {
        flagDefault: E.flagDefault,
        status: output.summary.status,
        baselines: output.summary.baselineCount,
        stations: output.summary.uniqueStations,
        provenance: output.provenance.map((p) => p.sourceId),
        converged: output.result.converged,
        dof: output.result.dof,
        route: output.result.routeProvenance,
        fixed: output.summary.controlBySource,
      };
    `) as Record<string, unknown>;
    expect(out.flagDefault).toBe(true);
    expect(out.status).toBe('READY');
    expect(out.baselines).toBe(4);
    expect(out.stations).toBe(4);
    expect(out.provenance).toEqual(['f1', 'f1', 'f2', 'f2']);
    expect(out.converged).toBe(true);
    expect(out.route).toBe('typescript-dense');
    expect((out.fixed as string[]).some((l) => l.startsWith('A FIXED'))).toBe(true);
  });

  test('B: disable / recompose / re-enable', async ({ page }) => {
    const out = await runInBrowser(page, `
      const proj = await import('/src/engine/gnssMultifileProject.ts');
      const lean1 = nativeText([{ id: 'A', fixed: true }, { id: 'B' }, { id: 'C' }], ALL_BASELINES.slice(0, 2));
      const lean2 = nativeText([{ id: 'C' }, { id: 'D' }, { id: 'Z' }], [
        { from: 'C', to: 'D' },
        { from: 'D', to: 'Z', noise: 7 },
      ]);
      const texts = { f1: lean1, f2: lean2 };
      const reduced = proj.runGnssMultifileProjectSolve(
        [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1, false)], texts);
      const full = proj.runGnssMultifileProjectSolve(
        [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1, true)], texts);
      return {
        reducedBaselines: reduced.summary.baselineCount,
        reducedProvenance: reduced.provenance.map((p) => p.sourceId),
        fullBaselines: full.summary.baselineCount,
        fullHasF2: full.provenance.some((p) => p.sourceId === 'f2'),
        reducedStatus: reduced.summary.status,
        fullStatus: full.summary.status,
      };
    `) as Record<string, unknown>;
    expect(out.reducedStatus).toBe('READY');
    expect(out.reducedBaselines).toBe(2);
    expect(out.reducedProvenance).toEqual(['f1', 'f1']);
    expect(out.fullStatus).toBe('READY');
    expect(out.fullBaselines).toBe(4);
    expect(out.fullHasF2).toBe(true);
  });

  test('C: reorder display-vs-numerics invariance', async ({ page }) => {
    const out = await runInBrowser(page, `
      const proj = await import('/src/engine/gnssMultifileProject.ts');
      const files = [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1)];
      const texts = { f1: PART1, f2: PART2 };
      const ab = proj.runGnssMultifileProjectSolve(files, texts);
      const ba = proj.runGnssMultifileProjectSolve(
        [entry('f1', 'p1.dat', 1), entry('f2', 'p2.dat', 0)], texts);
      const canon = (stations) =>
        JSON.stringify(Object.keys(stations).sort().map((id) => [id, stations[id]]));
      return {
        sameStations: canon(ab.result.stations) === canon(ba.result.stations),
        sameVF: ab.result.varianceFactor === ba.result.varianceFactor,
        provAB: ab.provenance.map((p) => p.sourceId),
        provBA: ba.provenance.map((p) => p.sourceId),
      };
    `) as Record<string, unknown>;
    expect(out.sameStations).toBe(true);
    expect(out.sameVF).toBe(true);
    expect(out.provAB).toEqual(['f1', 'f1', 'f2', 'f2']);
    expect(out.provBA).toEqual(['f2', 'f2', 'f1', 'f1']);
  });

  test('D: incompatible-frame BLOCKED naming sources + frames', async ({ page }) => {
    const out = await runInBrowser(page, `
      const proj = await import('/src/engine/gnssMultifileProject.ts');
      const other = nativeText(ALL_STATIONS, ALL_BASELINES.slice(2), 'NAD83(2011)');
      const files = [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1)];
      const parsed = proj.parseGnssProjectSources(files, { f1: PART1, f2: other });
      const summary = proj.summarizeGnssProjectComposition(parsed, 2);
      let threw = '';
      try { proj.runGnssMultifileProjectSolve(files, { f1: PART1, f2: other }); }
      catch (e) { threw = String(e && e.message || e); }
      return { status: summary.status, errors: summary.blockingErrors, threw };
    `) as { status: string; errors: string[]; threw: string };
    expect(out.status).toBe('BLOCKED');
    const joined = out.errors.join(' ');
    expect(joined).toMatch(/referenceFrame mismatch/);
    expect(joined).toMatch(/p1\.dat/);
    expect(joined).toMatch(/p2\.dat/);
    expect(joined).toMatch(/NAD83/);
    expect(out.threw).toMatch(/p2\.dat|referenceFrame mismatch/);
  });

  test('E: station-conflict BLOCKED naming files/coords/diff', async ({ page }) => {
    const out = await runInBrowser(page, `
      const proj = await import('/src/engine/gnssMultifileProject.ts');
      const shifted = PART2.split('\\n').map((line) =>
        line.startsWith('GX D ') ? 'GX D 4000150.005 1000100 4799950 FREE' : line).join('\\n');
      const files = [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1)];
      const summary = proj.summarizeGnssProjectComposition(
        proj.parseGnssProjectSources(files, { f1: PART1, f2: shifted }), 2);
      let threw = '';
      try { proj.runGnssMultifileProjectSolve(files, { f1: PART1, f2: shifted }); }
      catch (e) { threw = String(e && e.message || e); }
      return { status: summary.status, errors: summary.blockingErrors, threw };
    `) as { status: string; errors: string[]; threw: string };
    expect(out.status).toBe('BLOCKED');
    const joined = out.errors.join(' ');
    expect(joined).toMatch(/material station conflict 'D'/);
    expect(joined).toMatch(/p1\.dat|f1/);
    expect(joined).toMatch(/p2\.dat|f2/);
    expect(joined).toMatch(/diff=/);
    expect(out.threw).toMatch(/material station conflict 'D'/);
  });

  test('F: STRONG_DUPLICATE BLOCKED naming records + sources', async ({ page }) => {
    const out = await runInBrowser(page, `
      const proj = await import('/src/engine/gnssMultifileProject.ts');
      const dup1 = nativeText([{ id: 'A', fixed: true }, { id: 'B' }],
        [{ from: 'A', to: 'B', id: 'B1', session: 'S9', solution: 'Q9' }]);
      const dup2 = nativeText([{ id: 'A', fixed: true }, { id: 'B' }],
        [{ from: 'A', to: 'B', id: 'B1', session: 'S9', solution: 'Q9' }]);
      const files = [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1)];
      const summary = proj.summarizeGnssProjectComposition(
        proj.parseGnssProjectSources(files, { f1: dup1, f2: dup2 }), 2);
      let threw = '';
      try { proj.runGnssMultifileProjectSolve(files, { f1: dup1, f2: dup2 }); }
      catch (e) { threw = String(e && e.message || e); }
      return { status: summary.status, errors: summary.blockingErrors, threw };
    `) as { status: string; errors: string[]; threw: string };
    expect(out.status).toBe('BLOCKED');
    const joined = out.errors.join(' ');
    expect(joined).toMatch(/STRONG_DUPLICATE/);
    expect(joined).toMatch(/p1\.dat/);
    expect(joined).toMatch(/p2\.dat/);
    expect(out.threw).toMatch(/STRONG_DUPLICATE/);
  });

  test('G: POSSIBLE + REVERSED warn, retain, and solve', async ({ page }) => {
    const out = await runInBrowser(page, `
      const comp = await import('/src/engine/gnssMultifileComposition.ts');
      const proj = await import('/src/engine/gnssMultifileProject.ts');
      // POSSIBLE: same endpoints, near-identical vector, different sessions.
      const g1 = nativeText([{ id: 'A', fixed: true }, { id: 'B' }, { id: 'C' }],
        [{ from: 'A', to: 'B', noise: 1, session: 'S1' }]);
      const g2 = nativeText([{ id: 'A', fixed: true }, { id: 'B' }, { id: 'C' }],
        [{ from: 'A', to: 'B', noise: 1, session: 'S2' }, { from: 'B', to: 'C', noise: 2, session: 'S2' }]);
      const files = [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1)];
      const parsed = proj.parseGnssProjectSources(files, { f1: g1, f2: g2 });
      const gnss = parsed.filter((e) => e.network != null);
      const composed = comp.composeGnssBaselineNetworks(gnss.map((e) => ({
        network: e.network, sourceId: e.fileId, fileName: e.fileName, format: e.format,
      })));
      const classes = composed.duplicateCandidates.map((c) => c.class);
      const output = proj.runGnssMultifileProjectSolve(files, { f1: g1, f2: g2 });
      // REVERSED: endpoint swap + negated vector across sources.
      const r1 = nativeText([{ id: 'A', fixed: true }, { id: 'B' }], [{ from: 'A', to: 'B', session: 'S1' }]);
      const rlines = r1.split('\\n');
      const bline = rlines.find((l) => l.startsWith('BL ')).split(' ');
      const neg = nativeText([{ id: 'A', fixed: true }, { id: 'B' }], [{ from: 'A', to: 'B', session: 'S9' }])
        .split('\\n').map((l) => l.startsWith('BL B A') ? l : (l.startsWith('BL A B')
          ? \`BL B A \${-Number(bline[3])} \${-Number(bline[4])} \${-Number(bline[5])} ID BR1 SESSION S9\` : l)).join('\\n');
      const rparsed = proj.parseGnssProjectSources(files, { f1: r1, f2: neg });
      const rgnss = rparsed.filter((e) => e.network != null);
      const rcomposed = comp.composeGnssBaselineNetworks(rgnss.map((e) => ({
        network: e.network, sourceId: e.fileId, fileName: e.fileName, format: e.format,
      })));
      const rclasses = rcomposed.duplicateCandidates.map((c) => c.class);
      return {
        possibleSeen: classes.includes('POSSIBLE_DUPLICATE'),
        possibleStatus: proj.summarizeGnssProjectComposition(parsed, 2).status,
        retained: output.summary.baselineCount,
        converged: output.result.converged,
        reversedSeen: rclasses.includes('REVERSED_CANDIDATE'),
        reversedBlocked: rcomposed.blockingErrors.length,
      };
    `) as Record<string, unknown>;
    expect(out.possibleSeen).toBe(true);
    expect(out.possibleStatus).toBe('READY');
    expect(out.retained).toBe(3);
    expect(out.converged).toBe(true);
    expect(out.reversedSeen).toBe(true);
    expect(out.reversedBlocked).toBe(0);
  });

  test('H: save / close / reload restores the same result', async ({ page }) => {
    const first = await runInBrowser(page, `
      const proj = await import('/src/engine/gnssMultifileProject.ts');
      const files = [entry('f1', 'p1.dat', 1), entry('f2', 'p2.dat', 0)];
      const persisted = { ...proj.emptyGnssMultifilePersisted(),
        controlOverrides: { D: true },
        setup: { horizontalCenteringSigma: 0.005, antennaHeightSigma: 0.002 },
        displayNames: { f1: 'part one', f2: 'part two' } };
      const output = proj.runGnssMultifileProjectSolve(files, { f1: PART1, f2: PART2 }, {
        controlOverrides: persisted.controlOverrides, setup: persisted.setup });
      return {
        stations: JSON.stringify(output.result.stations),
        vf: output.result.varianceFactor,
        provenance: output.provenance,
        bag: JSON.stringify(proj.serializeGnssMultifilePersisted(persisted)),
      };
    `) as { stations: string; vf: number; provenance: unknown; bag: string };
    expect(first.stations.length).toBeGreaterThan(0);

    // Real reload: close + reopen the app, then restore from the saved bag.
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Static GNSS workspace' }),
    ).toBeVisible({ timeout: 30_000 });
    const second = await page.evaluate((bag: string) => (async () => {
      // @ts-ignore - browser-only Vite-served module path
      const proj = await import('/src/engine/gnssMultifileProject.ts');
      const reloaded = proj.deserializeGnssMultifilePersisted(JSON.parse(bag));
      const files = [
        { id: 'f1', name: 'p1.dat', kind: 'dat', path: 'data/f1-p1.dat', enabled: true, order: 1 },
        { id: 'f2', name: 'p2.dat', kind: 'dat', path: 'data/f2-p2.dat', enabled: true, order: 0 },
      ];
      // Rebuilt identically in-test (synthetic sources; the bag is the persisted state).
      const FRAME = 'ITRF2020@2020.0';
      const EPOCH = '2020.0';
      const ELLIPSOID = 'GRS80';
      const COV = 'COV 0.000025 0 0 0.000025 0 0.000025';
      const COORDS: Record<string, number[]> = {
        A: [4000000, 1000000, 4800000],
        B: [4000100, 1000050, 4800020],
        C: [4000200, 999950, 4800100],
        D: [4000150, 1000100, 4799950],
      };
      const coordOf = (id: string): number[] => COORDS[id] ?? [4000500, 1000500, 4800500];
      const nativeText = (stations: Array<{ id: string; fixed?: boolean }>, baselines: Array<{ from: string; to: string; noise?: number }>): string => {
        const lines = [`FRAME ECEF ${FRAME} EPOCH ${EPOCH} ELLIPSOID ${ELLIPSOID}`, 'UNITS M'];
        stations.forEach((s) => {
          const c = coordOf(s.id);
          lines.push(`GX ${s.id} ${c[0]} ${c[1]} ${c[2]} ${s.fixed ? 'FIXED' : 'FREE'}`);
        });
        baselines.forEach((b, i) => {
          const from = coordOf(b.from);
          const to = coordOf(b.to);
          const j = (b.noise ?? 0) * 0.001;
          lines.push(`BL ${b.from} ${b.to} ${to[0] - from[0] + j} ${to[1] - from[1] - j} ${to[2] - from[2] + j} ID B${i + 1} SESSION S1`);
          lines.push(COV);
        });
        return `${lines.join('\n')}\n`;
      };
      const ALL = [{ id: 'A', fixed: true }, { id: 'B' }, { id: 'C' }, { id: 'D' }];
      const PART1 = nativeText(ALL, [
        { from: 'A', to: 'B', noise: 1 },
        { from: 'B', to: 'C', noise: 2 },
      ]);
      const PART2 = nativeText(ALL, [
        { from: 'C', to: 'D', noise: 3 },
        { from: 'A', to: 'C', noise: 5 },
      ]);
      const output = proj.runGnssMultifileProjectSolve(files, { f1: PART1, f2: PART2 }, {
        controlOverrides: reloaded.controlOverrides, setup: reloaded.setup });
      return {
        stations: JSON.stringify(output.result.stations),
        vf: output.result.varianceFactor,
        provenance: output.provenance,
        displayOk: reloaded.displayNames.f1 === 'part one',
      };
    })(), first.bag) as { stations: string; vf: number; provenance: unknown; displayOk: boolean };
    expect(second.stations).toBe(first.stations);
    expect(second.vf).toBe(first.vf);
    expect(second.provenance).toEqual(first.provenance);
    expect(second.displayOk).toBe(true);
  });

  test('I: R2B cohort provenance native-sparse-selected-qxx', async ({ page }) => {
    const out = await runInBrowser(page, `
      const proj = await import('/src/engine/gnssMultifileProject.ts');
      const r2b = await import('/src/workers/gnssBaselineNativeR2BRoute.ts');
      const stubs = await import('/tests/helpers/sparseTestStubs.ts');
      const adjust = await import('/src/engine/gnssBaselineAdjust.ts');
      const ring1 = nativeText([{ id: 'A', fixed: true }, { id: 'B' }, { id: 'C' }], [{ from: 'A', to: 'B' }]);
      const ring2 = nativeText([{ id: 'A', fixed: true }, { id: 'B' }, { id: 'C' }], [
        { from: 'B', to: 'C', session: 'S2' },
        { from: 'C', to: 'A', session: 'S3' },
      ]);
      const files = [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1)];
      const output = proj.runGnssMultifileProjectSolve(files, { f1: ring1, f2: ring2 });
      const eligibility = r2b.deriveGnssNativeR2BEligibility(output.input, { isWorker: true, minParams: 1 });
      const oracle = adjust.runGnssBaselineAdjustment(output.input);
      const attempt = await r2b.runGnssBaselineWithNativeR2B(output.input, {
        isWorker: true,
        minParams: 1,
        correctionSolverOverride: stubs.countingCorrectionSolver(),
        blockSolverOverride: stubs.countingBlockSolver(),
      });
      return {
        eligible: eligibility.eligible,
        route: attempt.route,
        provenance: attempt.result.routeProvenance,
        sameStations: JSON.stringify(attempt.result.stations) === JSON.stringify(oracle.stations),
        sameWSS: attempt.result.weightedResidualSum === oracle.weightedResidualSum,
      };
    `) as Record<string, unknown>;
    expect(out.eligible).toBe(true);
    expect(out.route).toBe('native-sparse-selected-qxx');
    expect(out.provenance).toBe('native-sparse-selected-qxx');
    expect(out.sameStations).toBe(true);
    expect(out.sameWSS).toBe(true);
  });

  test('J: kill-switch OFF restores typescript-dense parity', async ({ page }) => {
    const out = await runInBrowser(page, `
      const flag = await import('/src/engine/gnssMultifileFlag.ts');
      const proj = await import('/src/engine/gnssMultifileProject.ts');
      const adjust = await import('/src/engine/gnssBaselineAdjust.ts');
      const files = [entry('f1', 'p1.dat', 0), entry('f2', 'p2.dat', 1)];
      const texts = { f1: PART1, f2: PART2 };
      const onResult = proj.runGnssMultifileProjectSolve(files, texts);
      flag.setGnssMultifileEnabled(false);
      let threw = '';
      try { proj.runGnssMultifileProjectSolve(files, texts); }
      catch (e) { threw = String(e && e.message || e); }
      const single = adjust.runGnssBaselineAdjustment(onResult.input);
      const route = single.routeProvenance;
      flag.setGnssMultifileEnabled(true);
      const restored = proj.runGnssMultifileProjectSolve(files, texts);
      return {
        threw,
        route,
        sameStations: JSON.stringify(single.stations) === JSON.stringify(onResult.result.stations),
        sameVF: single.varianceFactor === onResult.result.varianceFactor,
        restoredOk: restored.summary.status,
        flagOn: flag.isGnssMultifileEnabled(),
      };
    `) as Record<string, unknown>;
    expect(out.threw).toMatch(/flag OFF/);
    expect(out.route).toBe('typescript-dense');
    expect(out.sameStations).toBe(true);
    expect(out.sameVF).toBe(true);
    expect(out.restoredOk).toBe('READY');
    expect(out.flagOn).toBe(true);
  });

  test('K: multifile OFF fail-closed + single-file Phase12G still works', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    // Real UI single-file path first (Phase 12G regression).
    const openButton = page.getByRole('button', { name: 'Static GNSS workspace' });
    await openButton.click();
    const dialog = page.getByRole('dialog', { name: 'Static GNSS baseline workspace' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Load synthetic sample' }).click();
    await expect(dialog).toContainText('Import summary');
    await dialog.getByRole('button', { name: 'Adjust (production route)' }).click();
    await expect(dialog).toContainText('Adjusted ECEF stations', { timeout: 60_000 });
    await page.keyboard.press('Escape');

    // Engine-level fail-closed: OFF blocks multifile, single-file TS still solves.
    const out = await runInBrowser(page, `
      const flag = await import('/src/engine/gnssMultifileFlag.ts');
      const proj = await import('/src/engine/gnssMultifileProject.ts');
      const net = await import('/src/engine/gnssBaselineNetworkImport.ts');
      const adjust = await import('/src/engine/gnssBaselineAdjust.ts');
      flag.setGnssMultifileEnabled(false);
      const files = [entry('f1', 'p1.dat', 0)];
      let threw = '';
      try { proj.runGnssMultifileProjectSolve(files, { f1: PART1 }); }
      catch (e) { threw = String(e && e.message || e); }
      const parsed = net.parseGnssBaselineText(PART1, 'p1.dat');
      const single = adjust.runGnssBaselineAdjustment({
        stations: parsed.network.stations,
        baselines: parsed.network.baselines,
        referenceFrame: parsed.network.frame.referenceFrame,
        epoch: parsed.network.frame.epoch,
        ellipsoid: parsed.network.frame.ellipsoid,
      });
      flag.setGnssMultifileEnabled(true);
      return { threw, converged: single.converged, route: single.routeProvenance, flagOn: flag.isGnssMultifileEnabled() };
    `) as Record<string, unknown>;
    expect(out.threw).toMatch(/flag OFF/);
    expect(out.converged).toBe(true);
    expect(out.route).toBe('typescript-dense');
    expect(out.flagOn).toBe(true);
    expect(pageErrors).toEqual([]);
  });
});
