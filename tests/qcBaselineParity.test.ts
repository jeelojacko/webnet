/**
 * Phase 14F §40 — baseline parity: branch QC values match baseline 6ad54fbc.
 *
 * Numerical contract (no math changed in the fix round — display, counting,
 * and wording only). Captures coordinates, residuals, stdRes, local
 * stat/crit/pass, redundancy, MDB, CoordEff, stochastic, LOO, systematic,
 * chi-square, and SEUW for the corpus reference case (legacy + statistical
 * reliability) and a blunder variant, and asserts the branch reproduces the
 * baseline snapshot in tests/fixtures/qcBaselineParitySnapshot.json exactly.
 * Volatile timing fields (elapsedMs) are stripped before comparison.
 * Any diff here is a numerical change requiring justification — STOP.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runAdjustmentSession } from '../src/engine/runSession';
import { createRunSessionRequest } from './helpers/runSessionRequest';

const normalize = (value: unknown): unknown => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value);
    return Number(value.toPrecision(15));
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (key === 'elapsedMs') continue;
      out[key] = normalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
};

const capture = (name: string, input: string, reliabilityModel?: 'statistical'): unknown => {
  const base = createRunSessionRequest();
  const req = createRunSessionRequest({
    input,
    maxIterations: 30,
    parseSettings: {
      ...base.parseSettings,
      coordMode: '2D',
      runMode: 'adjustment',
      suspectImpactMode: 'on',
      ...(reliabilityModel ? { reliabilityPolicy: { model: reliabilityModel } } : {}),
    } as never,
  });
  const result = runAdjustmentSession(req).result;
  return normalize({
    name,
    stations: result.stations,
    observations: (result.observations as unknown[]).map((o) => {
      const r = o as Record<string, unknown>;
      return {
        id: r.id,
        type: r.type,
        calc: r.calc,
        residual: r.residual,
        stdRes: r.stdRes,
        stdResComponents: r.stdResComponents,
        redundancy: r.redundancy,
        localTest: r.localTest,
        localTestComponents: r.localTestComponents,
        mdb: r.mdb,
        mdbComponents: r.mdbComponents,
        reliability: r.reliability,
      };
    }),
    chiSquare: result.chiSquare,
    seuw: (result as unknown as Record<string, unknown>).seuw,
    localTestSummary: result.localTestSummary,
    reliabilitySummary: result.reliabilitySummary,
    stochasticDiagnostics: result.stochasticDiagnostics,
    suspectImpactDiagnostics: result.suspectImpactDiagnostics,
    systematicDiagnostics: result.systematicDiagnostics,
  });
};

describe('§40 baseline parity (6ad54fbc)', () => {
  it('reproduces baseline QC values for the corpus reference + blunder cases', () => {
    const TAB = String.fromCharCode(9);
    const ref = readFileSync(
      'tests/fixtures/industry_standard_reference_case.dat',
      'utf-8',
    );
    const blunder = ref.replace(
      'D' + TAB + '1000-235' + TAB + '17.43226789',
      'D' + TAB + '1000-235' + TAB + '17.93226789',
    );
    const live = [
      capture('reference-legacy', ref),
      capture('reference-statistical', ref, 'statistical'),
      capture('blunder-legacy', blunder),
    ];
    const snapshot = JSON.parse(
      readFileSync('tests/fixtures/qcBaselineParitySnapshot.json', 'utf-8'),
    ) as unknown[];
    expect(live).toEqual(snapshot);
  });
});
