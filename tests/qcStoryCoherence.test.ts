/**
 * Phase 14F §39 — QC story tests (cross-feature integration).
 *
 * NEW FILE ONLY: asserts the COHERENT cross-feature story per fixture, not
 * formula re-tests. Fixture derivations mirror tests/qcIntegrationCorpus.test.ts
 * (§38 record-only corpus: A–D,F,G from the industry reference case, E from
 * the GPS sideshot case); the shared session-request harness is imported, no
 * fixture files are duplicated. §40 parity runs every case twice and compares
 * the deterministic QC snapshot.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { resolveEffectiveProjectParse } from '../src/engine/effectiveProjectParse';
import { runAdjustmentSession } from '../src/engine/runSession';
import { solveEngine } from '../src/engine/solveEngine';
import { STATISTICAL_SEMANTICS } from '../src/engine/statisticalSemantics';
import type { AdjustmentResult } from '../src/types';
import { createRunSessionRequest } from './helpers/runSessionRequest';

const REFERENCE_CASE = 'tests/fixtures/industry_standard_reference_case.dat';
const GPS_SIDESHOT = 'tests/fixtures/gps_network_sideshot_phase3.dat';
const TAB = String.fromCharCode(9);

const load = (path: string): string => readFileSync(path, 'utf-8');

const runCase = (
  input: string,
  patch: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
): AdjustmentResult =>
  runAdjustmentSession(
    createRunSessionRequest({
      input,
      maxIterations: 30,
      parseSettings: {
        ...createRunSessionRequest().parseSettings,
        coordMode: '2D',
        runMode: 'adjustment',
        suspectImpactMode: 'on',
        ...patch,
      },
      ...extra,
    }),
  ).result;

/** +0.5 m blunder on the first setup-1 distance (mirrors §38 fixture B). */
const withBlunder = (input: string): string =>
  input.replace(
    'D' + TAB + '1000-235' + TAB + '17.43226789',
    'D' + TAB + '1000-235' + TAB + '17.93226789',
  );

/** +20 mm constant bias on every measured distance (mirrors §38 fixture D). */
const withDistanceBias = (input: string, biasM = 0.02): string =>
  input
    .split('\n')
    .map((line) => {
      if (!line.startsWith('D' + TAB)) return line;
      const cells = line.split(TAB);
      const value = Number(cells[2]);
      if (!Number.isFinite(value)) return line;
      cells[2] = (value + biasM).toFixed(8);
      return cells.join(TAB);
    })
    .join('\n');

/** Drop every `!` horizontal fix flag (mirrors §38 fixture G). */
const asFreeNetwork = (input: string): string => input.replace(/!/g, '');

/** Over-optimistic instrument sigmas, 4x too tight (mirrors §38 fixture C). */
const tightInstruments = () => {
  const base = createRunSessionRequest().projectInstruments.S9;
  const quarter = base.edm_const / 4;
  const quarterPpm = base.edm_ppm / 4;
  const quarterHz = base.hzPrecision_sec / 4;
  return {
    S9: {
      ...base,
      edm_const: quarter,
      edm_ppm: quarterPpm,
      hzPrecision_sec: quarterHz,
      dirPrecision_sec: quarterHz,
      azBearingPrecision_sec: quarterHz,
      vaPrecision_sec: quarterHz,
    },
  };
};

/** Huber re-solve of the blunder case through solveEngine (mirrors §38 fixture F). */
const runHuber = (input: string): AdjustmentResult => {
  const request = createRunSessionRequest({
    input,
    maxIterations: 30,
    parseSettings: {
      ...createRunSessionRequest().parseSettings,
      coordMode: '2D',
      runMode: 'adjustment',
    },
  });
  const effective = resolveEffectiveProjectParse(request, {});
  return solveEngine({
    input,
    maxIterations: request.maxIterations,
    convergenceThreshold: request.convergenceLimit,
    instrumentLibrary: effective.profileContext.effectiveInstrumentLibrary,
    excludeIds: new Set<number>(),
    overrides: {},
    geoidSourceData: undefined,
    parseOptions: { ...effective.parseOptions, robustMode: 'huber' },
  });
};

type CorpusObs = AdjustmentResult['observations'][number];

const localFails = (r: AdjustmentResult): CorpusObs[] =>
  r.observations.filter((o) => o.localTest?.pass === false);

const obsById = (r: AdjustmentResult, id: number): CorpusObs | undefined =>
  r.observations.find((o) => o.id === id);

const groupScale = (r: AdjustmentResult, label: string): number | undefined =>
  r.stochasticDiagnostics?.groups.find((g) => g.label === label)?.sigmaScale;

const externalReason = (o: CorpusObs): string | null =>
  o.reliability?.external && !o.reliability.external.available
    ? o.reliability.external.reason
    : null;

/** Deterministic QC snapshot (§40 parity): volatile timing fields excluded. */
const snapshotOf = (r: AdjustmentResult): string =>
  JSON.stringify({
    stations: r.stations,
    observations: r.observations.map((o) => ({
      id: o.id,
      type: o.type,
      sourceLine: o.sourceLine ?? null,
      residual: o.residual ?? null,
      stdRes: o.stdRes ?? null,
      localTest: o.localTest
        ? {
            statistic: o.localTest.statistic ?? null,
            critical: o.localTest.critical,
            pass: o.localTest.pass,
            family: o.localTest.statisticFamily ?? null,
            available: o.localTest.available ?? null,
          }
        : null,
      redundancy: o.redundancy ?? null,
      mdb: o.mdb ?? null,
      reliability: o.reliability
        ? {
            mdb: o.reliability.mdb,
            method: o.reliability.method,
            external: o.reliability.external ?? null,
            externalComponents: o.reliability.externalComponents ?? null,
          }
        : null,
    })),
    chiSquare: r.chiSquare ?? null,
    seuw: r.seuw,
    dof: r.dof,
    stochastic: r.stochasticDiagnostics ?? null,
    systematic: r.systematicDiagnostics ?? null,
    loo: (r.suspectImpactDiagnostics ?? []).map((row) => {
      const { elapsedMs, ...rest } = row;
      void elapsedMs;
      return rest;
    }),
    localTestSummary: r.localTestSummary ?? null,
    reliabilitySummary: r.reliabilitySummary ?? null,
  });

/** Every LOO / worst-line link must resolve to a real observation + source line. */
const expectLinksResolve = (name: string, r: AdjustmentResult): void => {
  for (const row of r.suspectImpactDiagnostics ?? []) {
    const target = obsById(r, row.obsId);
    expect(target, `${name}: LOO row obsId ${row.obsId} resolves`).toBeDefined();
    expect(target?.sourceLine, `${name}: LOO row obsId ${row.obsId} source line matches`).toBe(
      row.sourceLine,
    );
  }
  const worst = r.residualDiagnostics?.worst;
  if (worst) {
    const target = obsById(r, worst.obsId);
    expect(target, `${name}: residual worst obsId ${worst.obsId} resolves`).toBeDefined();
    expect(target?.sourceLine, `${name}: residual worst source line matches`).toBe(
      worst.sourceLine,
    );
  }
  for (const setup of r.setupDiagnostics ?? []) {
    if (setup.worstObsLine == null) continue;
    const hit = r.observations.some((o) => o.sourceLine === setup.worstObsLine);
    expect(hit, `${name}: setup ${String(setup.station)} worst line resolves`).toBe(true);
  }
  for (const family of r.systematicDiagnostics?.setupFamilies ?? []) {
    expect(
      Object.hasOwn(r.stations, family.station),
      `${name}: systematic family station ${String(family.station)} exists`,
    ).toBe(true);
  }
};

describe('phase 14F §39 QC story coherence', () => {
  it('A (clean): global PASS coexists with minor local flags, no contradiction', () => {
    const r = runCase(load(REFERENCE_CASE));
    expect(r.success).toBe(true);
    expect(r.chiSquare?.pass95).toBe(true);
    const fails = localFails(r);
    expect(fails.length).toBe(3);
    for (const o of fails) {
      expect(o.type).toBe('dist');
      expect(o.mdb).not.toBeNull();
      expect(o.reliability?.external?.available).toBe(true);
    }
    // LOO rows exist for exactly the flagged obs and removal changes nothing:
    // chi stays PASS — complementary evidence, not a contradiction.
    const loo = r.suspectImpactDiagnostics ?? [];
    expect(loo.map((x) => x.obsId).sort((a, b) => a - b)).toEqual(
      fails.map((o) => o.id).sort((a, b) => a - b),
    );
    for (const row of loo) {
      expect(row.status).toBe('ok');
      expect(row.baseLocalFail).toBe(true);
      expect(row.shiftStatus).toBe('available');
      expect(row.baseChiPass).toBe(true);
      expect(row.altChiPass).toBe(true);
      expect(row.chiDelta).toBe('unchanged');
      expect(Number.isFinite(row.maxCoordShift)).toBe(true);
    }
    expect(r.residualDiagnostics?.worst?.localPass).toBe(false);
    expectLinksResolve('A', r);
  });

  it('B (blunder): chi FAIL names exactly one local failure with a fixing LOO row', () => {
    const r = runCase(withBlunder(load(REFERENCE_CASE)));
    expect(r.chiSquare?.pass95).toBe(false);
    const fails = localFails(r);
    expect(fails.length).toBe(1);
    const culprit = fails[0];
    expect(culprit.type).toBe('dist');
    expect(culprit.sourceLine).toBe(14);
    expect(Math.abs(culprit.localTest?.statistic ?? 0)).toBeGreaterThan(10);
    // MDB + CoordEff present for the culprit (first-order, non-approximate).
    expect(culprit.mdb).not.toBeNull();
    expect(culprit.reliability?.external?.available).toBe(true);
    if (culprit.reliability?.external?.available === true) {
      expect(culprit.reliability.external.approximate).toBe(false);
      expect(culprit.reliability.external.mdbUsed).toBe(culprit.mdb);
    }
    // Exactly one LOO row, and removing the culprit repairs the global test.
    const loo = r.suspectImpactDiagnostics ?? [];
    expect(loo.length).toBe(1);
    expect(loo[0].obsId).toBe(culprit.id);
    expect(loo[0].sourceLine).toBe(culprit.sourceLine);
    expect(loo[0].status).toBe('ok');
    expect(loo[0].baseLocalFail).toBe(true);
    expect(loo[0].baseChiPass).toBe(false);
    expect(loo[0].altChiPass).toBe(true);
    expect(loo[0].chiDelta).toBe('improved');
    // Distance family explodes while angles stay near 1: same culprit, both lenses.
    const angles = groupScale(r, 'Angles');
    const distances = groupScale(r, 'Distances');
    expect(angles).toBeDefined();
    expect(distances).toBeDefined();
    expect((distances ?? 0) / (angles ?? 1)).toBeGreaterThan(10);
    expect(r.residualDiagnostics?.worst?.obsId).toBe(culprit.id);
    // Registry wording never claims diagnostics must agree: CoordEff and the
    // LOO shift are defined as different quantities that must not be expected
    // to match.
    expect(STATISTICAL_SEMANTICS.coordEff.tooltip).toContain('must not be expected to match');
    expect(STATISTICAL_SEMANTICS.looShift.tooltip).toContain('unlike CoordEff');
    expectLinksResolve('B', r);
  });

  it('C (mis-scaled): global FAIL with the distance family scale identifying the cause', () => {
    const r = runCase(load(REFERENCE_CASE), {}, { projectInstruments: tightInstruments() });
    expect(r.chiSquare?.pass95).toBe(false);
    const angles = groupScale(r, 'Angles');
    const distances = groupScale(r, 'Distances');
    expect(angles).toBeDefined();
    expect(distances).toBeDefined();
    expect((distances ?? 0) / (angles ?? 1)).toBeGreaterThan(1.5);
    // Single-observation removal cannot repair a global mis-scale: every LOO
    // row keeps chi FAIL on both sides — coherent, not contradictory.
    const loo = r.suspectImpactDiagnostics ?? [];
    expect(loo.length).toBeGreaterThan(0);
    for (const row of loo) {
      expect(row.baseChiPass).toBe(false);
      expect(row.altChiPass).toBe(false);
    }
    const fails = localFails(r);
    expect(fails.length).toBeGreaterThan(0);
    for (const o of fails) expect(o.type).toBe('dist');
    expectLinksResolve('C', r);
  });

  it('D (systematic bias): chi FAIL, zero local fails, distance-family scale + trend agree', () => {
    const r = runCase(withDistanceBias(load(REFERENCE_CASE)));
    expect(r.chiSquare?.pass95).toBe(false);
    expect(localFails(r).length).toBe(0);
    const angles = groupScale(r, 'Angles');
    const distances = groupScale(r, 'Distances');
    expect(angles).toBeDefined();
    expect(distances).toBeDefined();
    expect(angles).toBeGreaterThan(0.9);
    expect(angles).toBeLessThan(1.3);
    expect(distances).toBeGreaterThan(5);
    // Descriptive distance trend presents the same distance-family story as a
    // pattern shape, not a competing verdict.
    const trend = r.systematicDiagnostics?.distanceTrend;
    expect(trend?.status).toBe('descriptive');
    expect(trend?.slopeMmPerKm).toBeDefined();
    expect(Math.abs(trend?.slopeMmPerKm ?? 0)).toBeGreaterThan(5);
    // LOO rows flag nothing locally yet still resolve to real observations.
    const loo = r.suspectImpactDiagnostics ?? [];
    expect(loo.length).toBeGreaterThan(0);
    for (const row of loo) {
      expect(row.baseLocalFail).toBe(false);
      expect(row.shiftStatus).toBe('available');
    }
    // The worst distance setup family carries the highest mean |StdRes|.
    const families = r.systematicDiagnostics?.setupFamilies ?? [];
    const worstFamily = [...families].sort(
      (a, b) => (b.meanAbsStdRes ?? 0) - (a.meanAbsStdRes ?? 0),
    )[0];
    expect(worstFamily?.family).toBe('distance');
    expectLinksResolve('D', r);
  });

  it('E (GPS mixed): under-dispersion FAIL with fail-closed group + pattern states', () => {
    const r = runCase(load(GPS_SIDESHOT));
    expect(r.success).toBe(true);
    // T sits below the lower 95% bound: FAIL by under-dispersion, not outliers.
    expect(r.chiSquare?.pass95).toBe(false);
    expect(r.chiSquare?.T).toBeLessThan(r.chiSquare?.lower ?? Number.NaN);
    expect(localFails(r).length).toBe(0);
    const groups = r.stochasticDiagnostics?.groups ?? [];
    const distGroup = groups.find((g) => g.label === 'Distances');
    const gpsGroup = groups.find((g) => g.label === 'GPS');
    expect(distGroup?.status).toBe('unestimable');
    expect(distGroup?.reason).toBeDefined();
    expect(distGroup?.sigmaScale).toBeUndefined();
    expect(gpsGroup?.status).toBe('estimated');
    expect(r.systematicDiagnostics?.distanceTrend.status).toBe('insufficient-data');
    expect(r.suspectImpactDiagnostics ?? []).toEqual([]);
    // Scalar MDB exists only for the lone distance obs; CoordEff coverage
    // counts scalar availability plus per-component GPS entries (2/3).
    expect(r.observations.filter((o) => o.mdb != null).length).toBe(1);
    const withCoordEff = r.observations.filter(
      (o) => o.reliability?.external?.available === true || o.reliability?.externalComponents != null,
    );
    expect(withCoordEff.length).toBe(2);
    // No adjusted observation is silently missing reliability: every external
    // is either available, component-carried, or unavailable with a reason.
    // The remaining obs is a sideshot (unadjusted by design) with no QC fields.
    const sideshotLines = new Set((r.sideshots ?? []).map((s) => s.sourceLine));
    for (const o of r.observations) {
      const scalar = o.reliability?.external;
      const hasComponents = o.reliability?.externalComponents != null;
      if (sideshotLines.has(o.sourceLine)) {
        expect(o.stdRes, `E: sideshot obs ${o.id} carries no stdRes`).toBeUndefined();
        expect(o.reliability, `E: sideshot obs ${o.id} carries no reliability`).toBeUndefined();
        continue;
      }
      expect(
        scalar?.available === true || hasComponents || (scalar != null && !scalar.available),
        `E: obs ${o.id} external state is explicit`,
      ).toBe(true);
    }
    expectLinksResolve('E', r);
  });

  it('F (robust): stochastic unavailable-with-reason, formal-mode approximation flags set', () => {
    const r = runHuber(withBlunder(load(REFERENCE_CASE)));
    expect(r.success).toBe(true);
    // First-pass stochastic scales are withheld under reweighting, never faked.
    const groups = r.stochasticDiagnostics?.groups ?? [];
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      expect(g.status).toBe('unavailable');
      expect(g.reason).toContain('Huber');
      expect(g.sigmaScale).toBeUndefined();
      expect(g.varianceFactor).toBeUndefined();
    }
    // CoordEff stays available but is labeled a frozen-weights approximation.
    const approximate = r.observations.filter(
      (o) => o.reliability?.external?.available === true && o.reliability.external.approximate,
    );
    expect(approximate.length).toBeGreaterThan(100);
    for (const o of approximate) {
      if (o.reliability?.external?.available === true) {
        expect(o.reliability.external.approximateReason).toBe('robust-frozen-weights');
      }
    }
    // Robust fit downweights exactly the blunder obs hardest.
    expect(r.robustDiagnostics?.enabled).toBe(true);
    expect(r.robustDiagnostics?.mode).toBe('huber');
    const top = r.robustDiagnostics?.topDownweightedRows?.[0];
    expect(top?.obsId).toBe(0);
    expect(top?.sourceLine).toBe(14);
    expect(top?.weight).toBeLessThan(0.5);
    // Systematic output is labeled descriptive-only under robust reweighting.
    expect(r.systematicDiagnostics?.robustNote).toContain('robust');
    expect((r.systematicDiagnostics?.warnings ?? []).join(' ')).toContain('robust reweighting');
    // The local test still flags exactly the blunder obs: robust fitting does
    // not hide it from the formal per-observation test.
    const fails = localFails(r);
    expect(fails.length).toBe(1);
    expect(fails[0].id).toBe(0);
    expectLinksResolve('F', r);
  });

  it('G (free network): CoordEff + LOO shift unavailable-with-reason, no fake shifts', () => {
    const r = runCase(asFreeNetwork(load(REFERENCE_CASE)));
    expect(r.success).toBe(true);
    expect(r.converged).toBe(true);
    expect(r.chiSquare?.pass95).toBe(true);
    // MDBs still compute; every CoordEff is unavailable with the datum reason.
    expect(r.observations.filter((o) => o.mdb != null).length).toBe(r.observations.length);
    const reasons = new Set(r.observations.map(externalReason));
    expect(reasons).toEqual(new Set(['free-network-datum']));
    // LOO rows solve fine but claim no coordinate shift: unavailable status,
    // no affected station, no station list — never a fake 0.0mm value.
    const loo = r.suspectImpactDiagnostics ?? [];
    expect(loo.length).toBeGreaterThan(0);
    for (const row of loo) {
      expect(row.status).toBe('ok');
      expect(row.shiftStatus).toBe('free-network-unavailable');
      expect(row.mostAffectedStation).toBeNull();
      expect(row.topAffectedStations ?? []).toEqual([]);
    }
    // Local flags still coexist with the passing global test.
    expect(localFails(r).length).toBeGreaterThan(0);
    expect(r.systematicDiagnostics?.freeNetworkNote).toContain('free-network');
    expectLinksResolve('G', r);
  });

  it('§40 parity: every QC story is deterministic across runs', () => {
    const cases: [string, () => AdjustmentResult][] = [
      ['A', () => runCase(load(REFERENCE_CASE))],
      ['B', () => runCase(withBlunder(load(REFERENCE_CASE)))],
      ['C', () => runCase(load(REFERENCE_CASE), {}, { projectInstruments: tightInstruments() })],
      ['D', () => runCase(withDistanceBias(load(REFERENCE_CASE)))],
      ['E', () => runCase(load(GPS_SIDESHOT))],
      ['F', () => runHuber(withBlunder(load(REFERENCE_CASE)))],
      ['G', () => runCase(asFreeNetwork(load(REFERENCE_CASE)))],
    ];
    for (const [name, run] of cases) {
      expect(snapshotOf(run()), `${name}: QC snapshot is deterministic`).toBe(snapshotOf(run()));
    }
  });
});
