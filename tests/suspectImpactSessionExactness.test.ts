import { describe, expect, it } from 'vitest';

import { runAdjustmentSession } from '../src/engine/runSession';
import { solveEngine } from '../src/engine/solveEngine';
import {
  computeShiftDetail,
  countLocalFailures,
  maxAbsStdRes,
} from '../src/engine/suspectImpactShared';
import type { AdjustmentResult } from '../src/types';
import { createRunSessionRequest } from './helpers/runSessionRequest';

const sessionRequest = (
  input: string,
  patch: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) =>
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
  });

/** Manual-exclusion oracle through the same production session runner. */
const manualSessionExclusion = (
  input: string,
  baseExcluded: number[],
  candidateId: number,
  patch: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
): AdjustmentResult =>
  runAdjustmentSession(
    sessionRequest(input, { ...patch, suspectImpactMode: 'off' }, {
      ...extra,
      excludedIds: [...baseExcluded, candidateId],
    }),
  ).result;

/** Full-solve equality: coords, residuals, stdRes, local tests, SEUW, chi, DOF. */
const expectSameSolve = (actual: AdjustmentResult, expected: AdjustmentResult): void => {
  expect(actual.success).toBe(expected.success);
  expect(actual.converged).toBe(expected.converged);
  expect(actual.seuw).toBe(expected.seuw);
  expect(actual.dof).toBe(expected.dof);
  expect(actual.chiSquare).toEqual(expected.chiSquare);
  expect(Object.keys(actual.stations).sort()).toEqual(Object.keys(expected.stations).sort());
  for (const [id, station] of Object.entries(expected.stations)) {
    expect(actual.stations[id]?.x).toBe(station.x);
    expect(actual.stations[id]?.y).toBe(station.y);
    expect(actual.stations[id]?.h).toBe(station.h);
  }
  expect(actual.observations.map((obs) => obs.id)).toEqual(
    expected.observations.map((obs) => obs.id),
  );
  actual.observations.forEach((obs, index) => {
    const other = expected.observations[index];
    expect(obs.type).toBe(other?.type);
    expect(obs.stdRes).toBe(other?.stdRes);
    expect(obs.residual).toEqual(other?.residual);
    expect(obs.localTest?.pass ?? null).toBe(other?.localTest?.pass ?? null);
  });
};

/** Every exposed row absolute must equal the manual-exclusion solve. */
const expectRowMatchesManual = (
  row: NonNullable<AdjustmentResult['suspectImpactDiagnostics']>[number],
  manual: AdjustmentResult,
  base: AdjustmentResult,
): void => {
  expect(row.status).toBe('ok');
  expect(row.failureReason).toBe('none');
  expect(row.altSeuw).toBe(manual.seuw);
  expect(row.altDof).toBe(manual.dof);
  expect(row.altObsCount).toBe(manual.observations.length);
  expect(row.altMaxStdRes).toBe(maxAbsStdRes(manual));
  expect(row.altChi?.T).toBe(manual.chiSquare?.T);
  expect(row.altChi?.dof).toBe(manual.chiSquare?.dof);
  expect(row.altChi?.p).toBe(manual.chiSquare?.p);
  expect(row.altChi?.pass).toBe(manual.chiSquare?.pass95);
  expect(row.altLocalFails).toBe(countLocalFailures(manual));
  expect(row.mostAffectedStation).toEqual(computeShiftDetail(base, manual).most);
  expect(row.topAffectedStations).toEqual(computeShiftDetail(base, manual).top);
};

// Pre-existing exclusion (id 5) + observation override (id 4) + approved
// cluster merge (P2 -> P) ride every solve below, so any threading drop in
// the leave-one-out alternates surfaces as a row/manual mismatch.
const THREADING_INPUT = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C P 50 40 0',
  'C P2 50.0005 40.0005 0',
  'G GPS1 A P 50.0 40.0 0.01 0.01',
  'G GPS1 B P -50.0 40.0 0.01 0.01',
  'D A-P 64.0312423743285 0.01',
  'D B-P 64.0312423743285 0.01',
  'D A-P2 64.0316 0.01',
  'D B-P2 64.0316 0.01',
  'D A-P 64.0812423743285 0.01',
  'D B-P 64.0312423743285 0.01',
].join('\n');

const THREADING_EXTRA = {
  excludedIds: [5],
  overrides: { 4: { stdDev: 0.05 } },
  approvedClusterMerges: [{ aliasId: 'P2', canonicalId: 'P' }],
};

describe('suspectImpactSessionExactness', () => {
  it('matches manual-exclusion production solves with exclusions, override, and merge threaded', () => {
    const outcome = runAdjustmentSession(
      sessionRequest(THREADING_INPUT, { clusterDetectionEnabled: true }, THREADING_EXTRA),
    );
    const base = outcome.result;
    expect(base.converged).toBe(true);
    expect(outcome.effectiveExcludedIds).toEqual([5]);
    expect(base.clusterDiagnostics?.appliedMerges).toEqual([
      { aliasId: 'P2', canonicalId: 'P' },
    ]);
    const rows = base.suspectImpactDiagnostics ?? [];
    expect(rows.length).toBeGreaterThan(0);
    // The override is live: dropping it changes the base solve.
    const noOverride = runAdjustmentSession(
      sessionRequest(THREADING_INPUT, { clusterDetectionEnabled: true }, {
        ...THREADING_EXTRA,
        overrides: {},
      }),
    ).result;
    expect(noOverride.seuw).not.toBe(base.seuw);
    for (const row of rows) {
      expect(typeof row.obsId).toBe('number');
      expect(typeof row.type).toBe('string');
      const manual = manualSessionExclusion(
        THREADING_INPUT,
        [5],
        row.obsId,
        { clusterDetectionEnabled: true },
        THREADING_EXTRA,
      );
      expect(manual.clusterDiagnostics?.appliedMerges).toEqual([
        { aliasId: 'P2', canonicalId: 'P' },
      ]);
      expectRowMatchesManual(row, manual, base);
    }
  });

  it('removes the whole GPS vector: DOF delta equals the full 2D removal', () => {
    const input = [
      '.2D',
      'C A 0 0 0 ! !',
      'C B 100 0 0 ! !',
      'C P 50 40 0',
      'G GPS1 A P 50.0 40.0 0.01 0.01',
      'G GPS1 B P -50.0 40.0 0.01 0.01',
      'D A-P 64.0312423743285 0.01',
      'G GPS2 A P 50.5 40.0 0.01 0.01',
    ].join('\n');
    const base = runAdjustmentSession(sessionRequest(input)).result;
    expect(base.converged).toBe(true);
    const rows = base.suspectImpactDiagnostics ?? [];
    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0]!;
    expect(row.obsId).toBe(3);
    expect(row.type).toBe('gps');
    const manual = manualSessionExclusion(input, [], row.obsId);
    // Excluded observations stay listed but carry no statistics: the vector
    // contributes zero equations, so DOF drops by the full 2D removal (2).
    const excludedEntry = manual.observations.find((obs) => obs.id === row.obsId);
    expect(excludedEntry?.type).toBe('gps');
    expect(excludedEntry?.stdRes).not.toSatisfy(Number.isFinite);
    expect(base.dof - manual.dof).toBe(2);
    expectRowMatchesManual(row, manual, base);
  });

  it('contracts the correlated TS group when the candidate is a TS member (direct path)', () => {
    // NOTE: runAdjustmentSession normalizes every profile to industry-parity,
    // which force-disables tsCorrelation, so correlated-TS evidence goes
    // through solveEngine directly with the correlated fixture.
    const input = [
      '.2D',
      'C A 0 0 0 ! !',
      'C B 100 0 0 ! !',
      'C C 0 100 0 ! !',
      'C P 50 40 0',
      'G GPS1 A P 50.0 40.0 0.01 0.01',
      'G GPS1 B P -50.0 40.0 0.01 0.01',
      'D A-P 64.0312423743285 0.01',
      'DB P',
      'DN A 231-20-24.690285276 0.5',
      'DN B 128-39-35.309714724 0.5',
      // True C azimuth 320-11-39.94 EDM-style; +120 s blunder.
      'DN C 320-13-39.944067845 0.5',
      'DE',
    ].join('\n');
    const parseOptions = {
      coordMode: '2D' as const,
      units: 'm' as const,
      tsCorrelationEnabled: true,
      tsCorrelationRho: 0.5,
      tsCorrelationScope: 'set' as const,
    };
    const solve = (excludeIds: Set<number>): AdjustmentResult =>
      solveEngine({ input, maxIterations: 30, excludeIds, parseOptions });
    const base = solve(new Set());
    expect(base.converged).toBe(true);
    expect(base.tsCorrelationDiagnostics?.pairCount).toBe(3);
    const candidate = base.observations.find((obs) => obs.stdRes != null && Math.abs(obs.stdRes) >= 2 && obs.type === 'direction');
    expect(candidate?.id).toBe(5);
    const manual = solve(new Set([candidate!.id]));
    // Contracted group: 3 readings / 3 pairs -> 2 readings / 1 pair.
    expect(manual.tsCorrelationDiagnostics?.pairCount).toBe(1);
    expect(manual.tsCorrelationDiagnostics?.groups[0]?.rows).toBe(2);
    expect(manual.tsCorrelationDiagnostics?.groups[0]?.pairCount).toBe(1);
    expectSameSolve(manual, solve(new Set([candidate!.id])));
  });

  it('drops the set and orientation after excluding a one-target direction (production path)', () => {
    const input = [
      '.2D',
      'C A 0 0 0 ! !',
      'C B 100 0 0 ! !',
      'C P 50 40 0',
      'G GPS1 A P 50.0 40.0 0.01 0.01',
      'G GPS1 B P -50.0 40.0 0.01 0.01',
      'D A-P 64.0312423743285 0.01',
      'D B-P 64.0312423743285 0.01',
      'DB P',
      'DN A 231-20-24.690285276 5',
      'DE',
    ].join('\n');
    const base = runAdjustmentSession(sessionRequest(input)).result;
    expect(base.converged).toBe(true);
    const dirId = base.observations.find((obs) => obs.type === 'direction')?.id;
    expect(typeof dirId).toBe('number');
    // A lone reading has zero redundancy (orientation absorbs it), so its
    // standardized residual is exactly 0: it can never trip the suspect
    // gate, and the set can only leave via explicit exclusion.
    expect(base.observations.find((obs) => obs.id === dirId)?.stdRes).toBe(0);
    expect(base.directionSetDiagnostics?.map((entry) => entry.setId)).toEqual(['P#1']);
    const manual = manualSessionExclusion(input, [], dirId!);
    expect(manual.converged).toBe(true);
    expect(manual.directionSetDiagnostics ?? []).toEqual([]);
    const direct = solveEngine({
      input,
      maxIterations: 30,
      excludeIds: new Set([dirId!]),
      parseOptions: { coordMode: '2D', units: 'm' },
    });
    expectSameSolve(manual, direct);
  });
});
