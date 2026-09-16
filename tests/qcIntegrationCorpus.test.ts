/**
 * Phase 14F §38 — QC integration corpus (RECORD-ONLY).
 *
 * Seven small representative adjustments run through the production session
 * path (runAdjustmentSession). Each case logs/describes its observed QC
 * story: chi-square status, local failures, MDB/CoordEff presence, LOO rows,
 * stochastic + systematic output. No deep story assertions yet — those come
 * in a later batch. Fixture inputs are DERIVED from existing repo fixtures
 * (no duplicated fixture files):
 * - A–D,F,G derive from tests/fixtures/industry_standard_reference_case.dat
 * - E reuses tests/fixtures/gps_network_sideshot_phase3.dat as-is
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { resolveEffectiveProjectParse } from '../src/engine/effectiveProjectParse';
import { runAdjustmentSession } from '../src/engine/runSession';
import { solveEngine } from '../src/engine/solveEngine';
import type { AdjustmentResult } from '../src/types';
import { createRunSessionRequest } from './helpers/runSessionRequest';

const REFERENCE_CASE = 'tests/fixtures/industry_standard_reference_case.dat';
const GPS_SIDESHOT = 'tests/fixtures/gps_network_sideshot_phase3.dat';

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

/** +0.5 m blunder on the first setup-1 distance (single-observation fault). */
const withBlunder = (input: string): string =>
  input.replace('D\t1000-235\t17.43226789', 'D\t1000-235\t17.93226789');

/** +20 mm constant bias on every measured distance (systematic pattern). */
const withDistanceBias = (input: string, biasM = 0.02): string =>
  input.replace(
    /^(D\t\S+\t)([0-9]+\.[0-9]+)/gm,
    (_, prefix: string, value: string) => `${prefix}${(Number(value) + biasM).toFixed(8)}`,
  );

/** Drop every `!` horizontal fix flag -> minimally constrained (free) datum. */
const asFreeNetwork = (input: string): string => input.replace(/!/g, '');

/** Over-optimistic instrument sigmas (4x too tight) -> stochastic mis-scale. */
const tightInstruments = () => {
  const base = createRunSessionRequest().projectInstruments.S9;
  return {
    S9: {
      ...base,
      edm_const: base.edm_const / 4,
      edm_ppm: base.edm_ppm / 4,
      hzPrecision_sec: base.hzPrecision_sec / 4,
      dirPrecision_sec: base.dirPrecision_sec / 4,
      azBearingPrecision_sec: base.azBearingPrecision_sec / 4,
      vaPrecision_sec: base.vaPrecision_sec / 4,
    },
  };
};

type CorpusObs = AdjustmentResult['observations'][number];

const countIf = (obs: CorpusObs[], pred: (_o: CorpusObs) => boolean): number =>
  obs.filter(pred).length;

/** One-line observed QC story; also echoed to the console for the record. */
const storyOf = (name: string, result: AdjustmentResult): string => {
  const chi = result.chiSquare
    ? `${result.chiSquare.pass95 ? 'pass' : 'FAIL'}(T=${result.chiSquare.T.toFixed(2)},dof=${result.chiSquare.dof})`
    : 'n/a';
  const localFails = countIf(result.observations, (o) => o.localTest?.pass === false);
  const mdb = countIf(result.observations, (o) => o.mdb != null);
  const ext = countIf(
    result.observations,
    (o) => o.reliability?.external?.available === true || o.reliability?.externalComponents != null,
  );
  const loo = result.suspectImpactDiagnostics ?? [];
  const looOk = loo.filter((r) => r.status === 'ok').length;
  const stoch =
    result.stochasticDiagnostics?.groups
      .map((g) => `${g.label}:s=${g.sigmaScale?.toFixed(2) ?? '-'}( ${g.status})`)
      .join(' ') || 'n/a';
  const trend = result.systematicDiagnostics?.distanceTrend;
  const syst = trend
    ? `distTrend slope=${trend.slopeMmPerKm?.toFixed(2) ?? '-'}mm/km intercept=${trend.interceptMm?.toFixed(2) ?? '-'}mm(${trend.status})`
    : 'n/a';
  const line =
    `${name} | success=${result.success} converged=${result.converged} ` +
    `seuw=${Number(result.seuw).toFixed(4)} dof=${result.dof} chi=${chi} ` +
    `localFails=${localFails} mdb=${mdb}/${result.observations.length} ` +
    `coordEff=${ext}/${result.observations.length} loo=${looOk}/${loo.length}ok ` +
    `stoch=[${stoch}] syst=${syst}`;
  console.log(line);
  return line;
};

describe('phase 14F §38 QC integration corpus (record-only)', () => {
  it('A: clean terrestrial network', () => {
    const story = storyOf('A clean', runCase(load(REFERENCE_CASE)));
    expect(story.length).toBeGreaterThan(0);
  });

  it('B: one clear blunder', () => {
    const story = storyOf('B blunder', runCase(withBlunder(load(REFERENCE_CASE))));
    expect(story.length).toBeGreaterThan(0);
  });

  it('C: bad stochastic scaling (over-optimistic sigmas)', () => {
    const story = storyOf(
      'C mis-scaled',
      runCase(load(REFERENCE_CASE), {}, { projectInstruments: tightInstruments() }),
    );
    expect(story.length).toBeGreaterThan(0);
  });

  it('D: systematic distance bias', () => {
    const story = storyOf('D dist-bias', runCase(withDistanceBias(load(REFERENCE_CASE))));
    expect(story.length).toBeGreaterThan(0);
  });

  it('E: GPS mixed network', () => {
    const story = storyOf('E gps-mixed', runCase(load(GPS_SIDESHOT)));
    expect(story.length).toBeGreaterThan(0);
  });

  it('F: robust Huber on the blunder case', () => {
    // NOTE: the session wrapper pins robustMode to 'none' (normalizeSolveProfile
    // hard-codes 'industry-parity'), so Huber runs through the session's own
    // solveCore (solveEngine) with byte-identical plumbing — only the robust
    // switch differs. Recorded as observed.
    const blunderInput = withBlunder(load(REFERENCE_CASE));
    const huberRequest = createRunSessionRequest({
      input: blunderInput,
      maxIterations: 30,
      parseSettings: {
        ...createRunSessionRequest().parseSettings,
        coordMode: '2D',
        runMode: 'adjustment',
      },
    });
    const huberEffective = resolveEffectiveProjectParse(huberRequest, {});
    const huber = solveEngine({
      input: blunderInput,
      maxIterations: huberRequest.maxIterations,
      convergenceThreshold: huberRequest.convergenceLimit,
      instrumentLibrary: huberEffective.profileContext.effectiveInstrumentLibrary,
      excludeIds: new Set<number>(),
      overrides: {},
      geoidSourceData: undefined,
      parseOptions: { ...huberEffective.parseOptions, robustMode: 'huber' },
    });
    const story = storyOf('F huber', huber);
    expect(story.length).toBeGreaterThan(0);
  });

  it('G: free-network (no fixed stations)', () => {
    const story = storyOf('G free', runCase(asFreeNetwork(load(REFERENCE_CASE))));
    expect(story.length).toBeGreaterThan(0);
  });
});
