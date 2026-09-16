import { describe, expect, it } from 'vitest';

import { solveEngine } from '../src/engine/solveEngine';
import {
  buildSuspectImpactRows,
  collectSuspectImpactCandidates,
  computeShiftDetail,
  countLocalFailures,
  maxAbsStdRes,
} from '../src/engine/suspectImpactShared';
import type { AdjustmentResult, ParseOptions } from '../src/types';

const MAX_ITERATIONS = 30;

interface ExactnessCase {
  name: string;
  input: string;
  parseOptions: Partial<ParseOptions>;
}

const PP_BASE = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C P 50 40 0',
  'G GPS1 A P 50.0 40.0 0.01 0.01',
  'G GPS1 B P -50.0 40.0 0.01 0.01',
  'G GPS2 A P 50.0 40.0 0.01 0.01',
  'G GPS2 B P -50.0 40.0 0.01 0.01',
  'D A-P 64.0312423743285 0.01',
  'D B-P 64.0312423743285 0.01',
  'D A-P 64.0312423743285 0.01',
  'D B-P 64.0312423743285 0.01',
];

const GPSDIR_BASE = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C P 50 40 0',
  'G GPS1 A P 50.0 40.0 0.01 0.01',
  'G GPS1 B P -50.0 40.0 0.01 0.01',
  'D A-P 64.0312423743285 0.01',
];

const DIRECTION_SET = [
  'DB P',
  'DN A 231-20-24.690285276 0.5',
  'DN B 128-39-35.309714724 0.5',
  'DE',
];

const CASES: ExactnessCase[] = [
  {
    name: 'distance',
    input: [...PP_BASE, 'D A-P 64.0812423743285 0.01', 'D B-P 64.0312423743285 0.01'].join('\n'),
    parseOptions: { coordMode: '2D', units: 'm' },
  },
  {
    name: 'angle',
    input: [
      '.2D',
      'C A 0 0 0 ! !',
      'C B 100 0 0 ! !',
      'C C 0 100 0 ! !',
      'C D 100 100 0',
      'D A-D 141.421 0.005',
      'D B-D 110.000 0.005',
      'D C-D 100.000 0.005',
      'A D-A-B 95-00-00 5',
      'A D-C-B 90-00-00 5',
    ].join('\n'),
    parseOptions: { coordMode: '2D', units: 'm' },
  },
  {
    name: 'direction',
    input: [...GPSDIR_BASE, 'D A-P 74.031 0.01', ...DIRECTION_SET].join('\n'),
    parseOptions: { coordMode: '2D', units: 'm' },
  },
  {
    name: 'zenith',
    input: [
      '.3D',
      'C A 0 0 100 ! ! !',
      'C B 100 0 100 ! ! !',
      'C C 0 100 100 ! ! !',
      'C E 100 100 100 ! ! !',
      'C P 50 40 101',
      'D A-P 64.0390505863415 0.005',
      'D B-P 64.0390505863415 0.005',
      'D C-P 78.1095852792488 0.005',
      'D E-P 78.1095852792488 0.005',
      'V A-P 89.105 5.0',
      'V B-P 89.105 5.0',
      'V C-P 89.183 5.0',
      'V E-P 89.183 5.0',
      'V B-P 89.305 5.0',
    ].join('\n'),
    parseOptions: { coordMode: '3D', units: 'm' },
  },
  {
    name: 'leveling',
    input: [
      '.3D',
      'C A 0 0 100 ! ! !',
      'C B 100 0 100 ! ! !',
      'C C 0 100 102 ! ! !',
      'C P 50 40 101 0.0000001 0.0000001',
      'C Q 60 50 102 0.0000001 0.0000001',
      '.DELTA ON',
      'V A-P 1.0 0.001',
      'V B-P 1.0 0.001',
      'V C-P -1.0 0.001',
      'V A-Q 2.0 0.001',
      'V B-Q 2.0 0.001',
      'V C-Q 0.0 0.001',
      'V P-Q 1.0 0.001',
      'V P-Q 1.5 0.001',
    ].join('\n'),
    parseOptions: { coordMode: '3D', units: 'm' },
  },
  {
    name: 'gps-vector',
    input: [...GPSDIR_BASE, 'G GPS2 A P 50.5 40.0 0.01 0.01'].join('\n'),
    parseOptions: { coordMode: '2D', units: 'm' },
  },
  {
    name: 'correlated-ts',
    // Three-member set: the blundered C reading (+120 s) is a correlated
    // group member and the leave-one-out candidate (see
    // suspectImpactSessionExactness for the contracted-count assertions).
    input: [
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
      'DN C 320-13-39.944067845 0.5',
      'DE',
    ].join('\n'),
    parseOptions: {
      coordMode: '2D',
      units: 'm',
      tsCorrelationEnabled: true,
      tsCorrelationRho: 0.5,
      tsCorrelationScope: 'set',
    },
  },
  {
    name: 'weighted-control',
    input: [
      '.2D',
      'C A 0 0 0 ! !',
      'C B 100 0 0.00001 0.00001',
      'C P 50 40 0',
      'G GPS1 A P 50.0 40.0 0.01 0.01',
      'G GPS1 B P -50.0 40.0 0.01 0.01',
      'G GPS2 A P 50.0 40.0 0.01 0.01',
      'G GPS2 B P -50.0 40.0 0.01 0.01',
      'D A-P 64.0312423743285 0.01',
      'D B-P 64.0312423743285 0.01',
      'D A-P 64.0312423743285 0.01',
      'D B-P 64.0312423743285 0.01',
      'D A-P 64.0812423743285 0.01',
      'D B-P 64.0312423743285 0.01',
    ].join('\n'),
    parseOptions: { coordMode: '2D', units: 'm' },
  },
];

const solveDirect = (
  input: string,
  parseOptions: Partial<ParseOptions>,
  excludeIds: Set<number>,
): AdjustmentResult =>
  solveEngine({ input, maxIterations: MAX_ITERATIONS, excludeIds, parseOptions });

/** Bit-level equality of two solves: coords, residuals, stdRes, local tests, SEUW, chi, DOF. */
const expectSameSolve = (actual: AdjustmentResult, expected: AdjustmentResult): void => {
  expect(actual.success).toBe(expected.success);
  expect(actual.converged).toBe(expected.converged);
  expect(actual.seuw).toBe(expected.seuw);
  expect(actual.dof).toBe(expected.dof);
  expect(actual.chiSquare).toEqual(expected.chiSquare);
  expect(Object.keys(actual.stations).sort()).toEqual(Object.keys(expected.stations).sort());
  for (const [id, station] of Object.entries(expected.stations)) {
    const other = actual.stations[id];
    expect(other).toBeDefined();
    expect(other?.x).toBe(station.x);
    expect(other?.y).toBe(station.y);
    expect(other?.h).toBe(station.h);
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
    expect(obs.localTestComponents ?? null).toEqual(other?.localTestComponents ?? null);
  });
};

describe('suspectImpactExactness (direct-helper determinism evidence)', () => {
  // Determinism evidence only: these tests drive buildSuspectImpactRows with
  // a solveEngine closure and compare against the same helper, so they pin
  // determinism — not production threading. Production-path exactness (via
  // runAdjustmentSession, with exclusions/overrides/merges threaded) lives
  // in suspectImpactSessionExactness.test.ts.
  for (const fixture of CASES) {
    it(`matches a direct manual-exclusion solve for ${fixture.name}`, () => {
      const base = solveDirect(fixture.input, fixture.parseOptions, new Set());
      expect(base.converged).toBe(true);
      if (fixture.name === 'correlated-ts') {
        expect(base.tsCorrelationDiagnostics?.pairCount ?? 0).toBeGreaterThan(0);
      }
      if (fixture.name === 'weighted-control') {
        expect(base.controlConstraints?.count ?? 0).toBeGreaterThan(0);
      }
      const candidates = collectSuspectImpactCandidates(base);
      expect(candidates.length).toBeGreaterThan(0);
      const rows = buildSuspectImpactRows({
        base,
        candidates,
        baseExclusions: new Set(),
        analysisMode: 'auto',
        robustReSolve: false,
        solveAlt: (exclusions) => solveDirect(fixture.input, fixture.parseOptions, exclusions),
      });
      expect(rows.length).toBe(candidates.length);
      for (const row of rows) {
        expect(row.status).toBe('ok');
        expect(row.failureReason).toBe('none');
        const direct = solveDirect(
          fixture.input,
          fixture.parseOptions,
          new Set([row.obsId]),
        );
        // Row aggregates equal the direct exclusion solve.
        expect(row.altSeuw).toBe(direct.seuw);
        expect(row.altDof).toBe(direct.dof);
        expect(row.altObsCount).toBe(direct.observations.length);
        expect(row.altMaxStdRes).toBe(maxAbsStdRes(direct));
        expect(row.altChi?.T).toBe(direct.chiSquare?.T);
        expect(row.altChi?.dof).toBe(direct.chiSquare?.dof);
        expect(row.altChi?.p).toBe(direct.chiSquare?.p);
        expect(row.altChi?.pass).toBe(direct.chiSquare?.pass95);
        expect(row.altLocalFails).toBe(countLocalFailures(direct));
        // Shift detail equals a recomputation from the direct solve.
        expect(row.mostAffectedStation).toEqual(computeShiftDetail(base, direct).most);
        expect(row.topAffectedStations).toEqual(computeShiftDetail(base, direct).top);
        // Full alt solve (coords, residuals, stdRes, local tests) equals direct.
        const alt = solveDirect(
          fixture.input,
          fixture.parseOptions,
          new Set([row.obsId]),
        );
        expectSameSolve(alt, direct);
      }
    });
  }
});
