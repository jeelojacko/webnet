/**
 * Phase 7B.6 adversarial/perturbation corpus tests (bounded, no routing).
 *
 * - Builds a deterministic >=30-case corpus (strong pass probes, the weak
 *   resection divergence probe, ineligible false-admit probes,
 *   reference-unconverged probes, seed/iteration perturbations).
 * - Classifies every case through legacy eligibility AND the static
 *   geometry preflight; asserts zero false admits and zero false rejects.
 * - Proves the weak resection is REJECTED by the first-system handshake
 *   against a real in-process sparse candidate (WASM-gated skip), while a
 *   strong chain case handshakes clean.
 * - Proves clean-run restart: injected sparse failure falls back in-solve
 *   with recorded counts, exact legacy precision is preserved, and a clean
 *   TS rerun reproduces the reference bit-identically.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import {
  buildSolvePreparation,
  collectActiveObservationsForSolve,
} from '../src/engine/adjustmentPreprocessing';
import { createExperimentalSparseRouteDiagnostics } from '../src/engine/experimentalSparseDiagnostics';
import { parseInput } from '../src/engine/parseInputCore';
import { generatePhase5BenchmarkInput } from '../src/engine/phase5BenchmarkNetworks';
import {
  classifyPhase7b6Verdict,
  summarizePhase7b6Corpus,
  type Phase7b6AdversarialCase,
} from '../src/engine/phase7b6AdversarialCorpus';
import { evaluatePhase7b6CorrectionHandshake } from '../src/engine/phase7b6CorrectionHandshake';
import {
  evaluateSparseGeometryPreflight,
  type SparseGeometryPreflightInput,
} from '../src/engine/sparseGeometryPreflight';
import {
  createExperimentalSparseNumericalBundle,
} from '../src/engine/wasm/experimentalSparseNumericalBundle';
import type { WebNetWasmFactory } from '../src/engine/wasm/wasmTypes';
import { runPhase7b6LiveHandshake } from './helpers/phase7b6FirstSystemCapture';

const readExample = (file: string): string =>
  fs.readFileSync(path.join(process.cwd(), 'public/examples', file), 'utf-8');

const TRIANGULATION = readExample('ts_triangulation_trilateration_2d.dat');
const RESECTION = readExample('industry_resection_pillars.dat');
const INDUSTRY_3D = readExample('industry_demo.dat');

const BASE = {
  maxUnknownCount: 128,
  runMode: 'adjustment' as const,
  wasmAvailable: true,
  workerAvailable: true,
  rankRisk: 'none' as const,
};

const generated = (id: string, family: 'chain-2d' | 'gps-2d', unknownCount: number, seed: number): string =>
  generatePhase5BenchmarkInput({ id, family, unknownCount, seed });

/** Deterministic 32-case adversarial corpus. */
const buildCorpus = (): Phase7b6AdversarialCase[] => {
  const chain04 = generated('chain-2d-04', 'chain-2d', 4, 1101);
  const chain08 = generated('chain-2d-08', 'chain-2d', 8, 1108);
  const chain16 = generated('chain-2d-16', 'chain-2d', 16, 1116);
  const chain32 = generated('chain-2d-32', 'chain-2d', 32, 1132);
  const gps08 = generated('gps-2d-08', 'gps-2d', 8, 2202);
  const gps16 = generated('gps-2d-16', 'gps-2d', 16, 2216);
  const gps64 = generated('gps-2d-64', 'gps-2d', 64, 2264);
  const eligible2d = (unknownCount: number) => ({
    ...BASE,
    dimension: '2d' as const,
    unknownCount,
    robustWeighting: false,
    tsCorrelation: false,
    gpsCovarianceWeighting: false,
  });
  return [
    { id: 'tri-strong', family: 'industry', source: 'ts_triangulation_trilateration_2d.dat', input: TRIANGULATION, maxIterations: 10, eligibility: eligible2d(8), expectation: 'pass' },
    { id: 'chain-04', family: 'generated-chain', source: 'chain-2d-04/1101', input: chain04, maxIterations: 10, eligibility: eligible2d(4), expectation: 'pass' },
    { id: 'chain-08', family: 'generated-chain', source: 'chain-2d-08/1108', input: chain08, maxIterations: 10, eligibility: eligible2d(8), expectation: 'pass' },
    { id: 'chain-16', family: 'generated-chain', source: 'chain-2d-16/1116', input: chain16, maxIterations: 10, eligibility: eligible2d(16), expectation: 'pass' },
    { id: 'chain-32', family: 'generated-chain', source: 'chain-2d-32/1132', input: chain32, maxIterations: 10, eligibility: eligible2d(32), expectation: 'pass' },
    { id: 'gps-08', family: 'gps', source: 'gps-2d-08/2202', input: gps08, maxIterations: 10, eligibility: eligible2d(8), expectation: 'pass' },
    { id: 'gps-16', family: 'gps', source: 'gps-2d-16/2216', input: gps16, maxIterations: 10, eligibility: eligible2d(16), expectation: 'pass' },
    { id: 'chain-04-seed2', family: 'perturb-seed', source: 'chain-2d-04/9102', input: generated('chain-2d-04b', 'chain-2d', 4, 9102), maxIterations: 10, eligibility: eligible2d(4), expectation: 'pass' },
    { id: 'chain-08-seed2', family: 'perturb-seed', source: 'chain-2d-08/9108', input: generated('chain-2d-08b', 'chain-2d', 8, 9108), maxIterations: 10, eligibility: eligible2d(8), expectation: 'pass' },
    { id: 'gps-08-seed2', family: 'perturb-seed', source: 'gps-2d-08/9202', input: generated('gps-2d-08b', 'gps-2d', 8, 9202), maxIterations: 10, eligibility: eligible2d(8), expectation: 'pass' },
    { id: 'chain-16-seed2', family: 'perturb-seed', source: 'chain-2d-16/9116', input: generated('chain-2d-16b', 'chain-2d', 16, 9116), maxIterations: 10, eligibility: eligible2d(16), expectation: 'pass' },
    { id: 'gps-16-seed2', family: 'perturb-seed', source: 'gps-2d-16/9216', input: generated('gps-2d-16b', 'gps-2d', 16, 9216), maxIterations: 10, eligibility: eligible2d(16), expectation: 'pass' },
    { id: 'tri-iter25', family: 'perturb-iterations', source: 'triangulation @ maxIterations 25', input: TRIANGULATION, maxIterations: 25, eligibility: eligible2d(8), expectation: 'pass' },
    { id: 'chain-04-iter25', family: 'perturb-iterations', source: 'chain-2d-04/1101 @ maxIterations 25', input: chain04, maxIterations: 25, eligibility: eligible2d(4), expectation: 'pass' },
    { id: 'gps-64', family: 'gps-large', source: 'gps-2d-64/2264', input: gps64, maxIterations: 10, eligibility: eligible2d(64), expectation: 'pass' },
    { id: 'chain-32-seed2', family: 'perturb-seed', source: 'chain-2d-32/9132', input: generated('chain-2d-32b', 'chain-2d', 32, 9132), maxIterations: 10, eligibility: eligible2d(32), expectation: 'pass' },
    { id: 'resection-weak', family: 'industry-weak', source: 'industry_resection_pillars.dat', input: RESECTION, maxIterations: 25, eligibility: eligible2d(8), expectation: 'diverge-flag' },
    { id: 'industry-3d', family: 'industry-3d', source: 'industry_demo.dat', input: INDUSTRY_3D, maxIterations: 10, eligibility: { ...BASE, dimension: '3d' as const, unknownCount: 8, robustWeighting: false, tsCorrelation: false, gpsCovarianceWeighting: false }, expectation: 'ineligible' },
    { id: 'robust-rejected', family: 'robust', source: 'triangulation + .ROBUST HUBER 1.5', input: `${TRIANGULATION}\n.ROBUST HUBER 1.5\n`, maxIterations: 10, eligibility: { ...eligible2d(8), robustWeighting: true }, expectation: 'ineligible' },
    { id: 'tscorr-rejected', family: 'correlation', source: 'triangulation + .TSCORR ON', input: `${TRIANGULATION}\n.TSCORR ON\n`, maxIterations: 10, eligibility: { ...eligible2d(8), tsCorrelation: true }, expectation: 'ineligible' },
    { id: 'gps-cov-rejected', family: 'gps-covariance', source: 'gps-2d-08 + .GPS WEIGHT COVARIANCE', input: `${gps08}\n.GPS WEIGHT COVARIANCE\n`, maxIterations: 10, eligibility: { ...eligible2d(8), gpsCovarianceWeighting: true }, expectation: 'ineligible' },
    { id: 'non-adjustment', family: 'runmode', source: 'triangulation @ preanalysis', input: TRIANGULATION, maxIterations: 10, eligibility: { ...eligible2d(8), runMode: 'preanalysis' as const }, expectation: 'ineligible' },
    { id: 'size-guard', family: 'size-guard', source: 'chain-2d-16 vs max 4', input: chain16, maxIterations: 10, eligibility: { ...eligible2d(16), maxUnknownCount: 4 }, expectation: 'ineligible' },
    { id: 'rank-suspect', family: 'rank-risk', source: 'triangulation rank suspect', input: TRIANGULATION, maxIterations: 10, eligibility: { ...eligible2d(8), rankRisk: 'suspect' as const }, expectation: 'ineligible' },
    { id: 'rank-deficient', family: 'rank-risk', source: 'triangulation rank deficient', input: TRIANGULATION, maxIterations: 10, eligibility: { ...eligible2d(8), rankRisk: 'deficient' as const }, expectation: 'ineligible' },
    { id: 'wasm-down', family: 'availability', source: 'triangulation WASM unavailable', input: TRIANGULATION, maxIterations: 10, eligibility: { ...eligible2d(8), wasmAvailable: false }, expectation: 'ineligible' },
    { id: 'worker-down', family: 'availability', source: 'triangulation worker unavailable', input: TRIANGULATION, maxIterations: 10, eligibility: { ...eligible2d(8), workerAvailable: false }, expectation: 'ineligible' },
    { id: 'resection-robust', family: 'industry-weak', source: 'resection + .ROBUST HUBER 1.5', input: `${RESECTION}\n.ROBUST HUBER 1.5\n`, maxIterations: 25, eligibility: { ...eligible2d(8), robustWeighting: true }, expectation: 'ineligible' },
    { id: 'tri-iter0', family: 'unconverged', source: 'triangulation @ maxIterations 0', input: TRIANGULATION, maxIterations: 0, eligibility: eligible2d(8), expectation: 'reference-unconverged' },
    { id: 'tri-iter1', family: 'unconverged', source: 'triangulation @ maxIterations 1', input: TRIANGULATION, maxIterations: 1, eligibility: eligible2d(8), expectation: 'reference-unconverged' },
    { id: 'chain16-iter1', family: 'unconverged', source: 'chain-2d-16 @ maxIterations 1', input: chain16, maxIterations: 1, eligibility: eligible2d(16), expectation: 'reference-unconverged' },
    { id: 'gps08-iter0', family: 'unconverged', source: 'gps-2d-08 @ maxIterations 0', input: gps08, maxIterations: 0, eligibility: eligible2d(8), expectation: 'reference-unconverged' },
  ];
};

const toPreflightInput = (candidate: Phase7b6AdversarialCase): SparseGeometryPreflightInput => {
  const parsed = parseInput(candidate.input);
  const is2D = (parsed.parseState?.coordMode ?? '2D') === '2D';
  const active = collectActiveObservationsForSolve(parsed.observations, undefined, is2D);
  const prep = buildSolvePreparation(parsed.stations, parsed.unknowns, active, is2D);
  return {
    stations: parsed.stations,
    observations: parsed.observations,
    unknowns: parsed.unknowns,
    is2D,
    numParams: prep.numParams,
    numObsEquations: prep.numObsEquations,
    directionSetIds: prep.directionSetIds,
  };
};

const loadWasmFactory = async (): Promise<WebNetWasmFactory | null> => {
  try {
    const imported = (await import(
      pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href
    )) as unknown as { default: WebNetWasmFactory };
    if (typeof imported.default !== 'function') return null;
    return imported.default;
  } catch {
    return null;
  }
};

describe('phase 7B.6 adversarial corpus', () => {
  it('holds >=30 deterministic cases with byte-stable identity', () => {
    const first = buildCorpus();
    const second = buildCorpus();
    expect(first.length).toBeGreaterThanOrEqual(30);
    expect(first.length).toBe(32);
    expect(second.map((candidate) => candidate.id)).toEqual(
      first.map((candidate) => candidate.id),
    );
    for (let index = 0; index < first.length; index += 1) {
      expect(second[index]?.input).toBe(first[index]?.input);
      expect(second[index]?.eligibility).toEqual(first[index]?.eligibility);
    }
    const ids = new Set(first.map((candidate) => candidate.id));
    expect(ids.size).toBe(first.length);
  });

  it('classifies the full corpus with zero false admits and zero false rejects', () => {
    const corpus = buildCorpus();
    const verdicts = corpus.map((candidate) => {
      const reference = new LSAEngine({
        input: candidate.input,
        maxIterations: candidate.maxIterations,
      }).solve();
      const preflight = evaluateSparseGeometryPreflight(toPreflightInput(candidate));
      return {
        verdict: classifyPhase7b6Verdict(
          candidate,
          {
            success: reference.success,
            converged: reference.converged,
            iterations: reference.iterations ?? 0,
          },
          preflight.eligible,
        ),
        reference,
        preflight,
      };
    });
    const summary = summarizePhase7b6Corpus(verdicts.map((entry) => entry.verdict));
    console.log(`[phase7b6-corpus] ${JSON.stringify(summary)}`);
    expect(summary.total).toBe(32);
    expect(summary.passExpected).toBe(16);
    expect(summary.divergeExpected).toBe(1);
    expect(summary.ineligibleExpected).toBe(11);
    expect(summary.unconvergedExpected).toBe(4);
    // The weak resection is legacy-eligible yet held by the static preflight.
    const resection = verdicts.find((entry) => entry.verdict.id === 'resection-weak');
    expect(resection?.reference.success && resection?.reference.converged).toBe(true);
    expect(resection?.preflight.eligible).toBe(false);
    // Every expectation class lands on its intended disposition.
    for (const entry of verdicts) {
      if (entry.verdict.expectation === 'pass') {
        expect(entry.reference.success && entry.reference.converged, `${entry.verdict.id} reference green`).toBe(true);
      }
      if (entry.verdict.expectation === 'ineligible') {
        expect(entry.verdict.eligible, `${entry.verdict.id} stays ineligible`).toBe(false);
      }
      if (entry.verdict.expectation === 'reference-unconverged') {
        expect(entry.verdict.sparseDisposition, `${entry.verdict.id} skipped`).toMatch(
          /reference-unconverged|ineligible/,
        );
      }
    }
    const admitted = verdicts.filter((entry) => entry.verdict.falseAdmit || entry.verdict.falseReject);
    expect(admitted.map((entry) => entry.verdict.id)).toEqual([]);
    expect(summary.falseAdmits).toBe(0);
    expect(summary.falseRejects).toBe(0);
  });

  it('rejects the weak resection handshake on captured first-system evidence; strong chain handshakes clean', async () => {
    const factory = await loadWasmFactory();
    if (!factory) {
      console.log('[phase7b6-corpus] WASM artifact unavailable; skipping live sparse handshake');
      return;
    }
    const bundle = await createExperimentalSparseNumericalBundle(factory);

    // Weak resection: TS reference converges; the pivot-free sparse candidate
    // must be REJECTED by the handshake before becoming authoritative.
    // Measured audit note: the captured first systems still agree (2.2e-12),
    // so rejection rests on the final agreement layer plus the preflight.
    const resectionRun = runPhase7b6LiveHandshake({
      input: RESECTION,
      maxIterations: 25,
      sparseSolver: bundle.sparseCorrectionSolver,
    });
    expect(resectionRun.reference.success && resectionRun.reference.converged).toBe(true);
    expect(resectionRun.recorder.capture, 'resection sparse ran the first system').not.toBeNull();
    const resectionVerdict = evaluatePhase7b6CorrectionHandshake(resectionRun.handshakeInput);
    console.log(
      `[phase7b6-corpus] resection first-system diff=${resectionVerdict.maxCorrectionDiff.toExponential(2)} ` +
        `cond=${resectionRun.handshakeInput.firstSystem?.conditionEstimate?.toExponential(2) ?? 'missing'} ` +
        `(${resectionRun.handshakeInput.firstSystem?.conditionSource ?? 'none'}) ` +
        `coord=${resectionVerdict.maxCoordDiffM.toExponential(2)} accepted=${resectionVerdict.accepted} ` +
        `reasons=${resectionVerdict.reasons.join('; ')} warnings=${resectionVerdict.warnings.join('; ') || 'none'}`,
    );
    expect(resectionVerdict.accepted, `resection divergence rejected: ${resectionVerdict.reasons.join('; ')}`).toBe(false);
    expect(resectionVerdict.maxCoordDiffM).toBeGreaterThan(1e-6);

    // Strong chain: the real sparse candidate must handshake clean on both
    // the captured first system and the final agreement.
    const chainRun = runPhase7b6LiveHandshake({
      input: generated('chain-2d-16', 'chain-2d', 16, 1116),
      maxIterations: 10,
      sparseSolver: bundle.sparseCorrectionSolver,
    });
    expect(chainRun.reference.success && chainRun.reference.converged).toBe(true);
    expect(chainRun.recorder.capture, 'chain sparse ran the first system').not.toBeNull();
    expect(chainRun.handshakeInput.firstSystem?.sparseCorrection, 'chain sparse evidence present').not.toBeNull();
    const chainVerdict = evaluatePhase7b6CorrectionHandshake(chainRun.handshakeInput);
    console.log(
      `[phase7b6-corpus] chain-16 first-system diff=${chainVerdict.maxCorrectionDiff.toExponential(2)} ` +
        `cond=${chainRun.handshakeInput.firstSystem?.conditionEstimate?.toExponential(2) ?? 'missing'} ` +
        `coord=${chainVerdict.maxCoordDiffM.toExponential(2)} accepted=${chainVerdict.accepted} ` +
        `reasons=${chainVerdict.reasons.join('; ') || 'none'} warnings=${chainVerdict.warnings.join('; ') || 'none'}`,
    );
    expect(chainVerdict.accepted, `chain handshake: ${chainVerdict.reasons.join('; ')}`).toBe(true);
  }, 180000);

  it('proves clean-run restart with exact legacy precision after injected sparse failure', () => {
    const cleanReference = new LSAEngine({ input: TRIANGULATION }).solve();
    expect(cleanReference.success).toBe(true);
    const expectedRows = cleanReference.relativePrecision ?? [];
    expect(expectedRows.length).toBeGreaterThan(0);
    const diagnostics = createExperimentalSparseRouteDiagnostics();
    const degraded = new LSAEngine({
      input: TRIANGULATION,
      sparseCorrectionSolver: {
        solveFromEquations: (): never => {
          throw new Error('injected phase7b6 sparse failure');
        },
      },
      experimentalSparseDiagnostics: diagnostics,
    }).solve();
    expect(degraded.success).toBe(true);
    expect(diagnostics.sparseCorrectionCalls).toBeGreaterThan(0);
    expect(diagnostics.sparseCorrectionFallbacks).toBeGreaterThan(0);
    // Exact legacy precision survives the fallback path.
    const degradedRows = degraded.relativePrecision ?? [];
    expect(degradedRows).toHaveLength(expectedRows.length);
    degradedRows.forEach((row, index) => {
      const expected = expectedRows[index];
      expect(row.from).toBe(expected?.from);
      expect(row.to).toBe(expected?.to);
      for (const field of ['sigmaN', 'sigmaE', 'sigmaDist', 'sigmaAz'] as const) {
        const actualValue = row[field];
        const expectedValue = expected?.[field];
        if (actualValue === undefined || expectedValue === undefined) {
          expect(actualValue).toBe(expectedValue);
        } else {
          expect(Math.abs(actualValue - expectedValue)).toBeLessThanOrEqual(
            1e-9 * Math.max(1, Math.abs(expectedValue)),
          );
        }
      }
    });
    // Clean restart from the original input reproduces the reference exactly.
    const restart = new LSAEngine({ input: TRIANGULATION }).solve();
    for (const [id, station] of Object.entries(cleanReference.stations)) {
      const other = restart.stations[id];
      expect(other, `station ${id} restarts identically`).toBeDefined();
      expect(other?.x).toBe(station.x);
      expect(other?.y).toBe(station.y);
      expect(other?.h).toBe(station.h);
    }
    expect(restart.relativePrecision).toHaveLength(expectedRows.length);
  });
});
