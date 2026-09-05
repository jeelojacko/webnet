/**
 * Phase 7B.5 test-only candidate corpus simulation (bounded slice).
 *
 * - ALWAYS invokes `evaluateSparseProductionEligibility` per candidate and
 *   records eligible/ineligible reasons (via `classifyPhase7b5Candidate`).
 * - Eligible + converged candidates run the REAL sparse candidate inside the
 *   ACTUAL adjustment worker (existing `phase7bAdjustmentWorkerBridge`
 *   runtime seam; no protocol/request changes) and compare to the TS
 *   reference at 1e-6 m with zero-fallback assertions.
 * - Covers committed fixtures: industry 2D triangulation + resection,
 *   generated GPS plain, robust/TS-correlation/GPS-covariance rejections,
 *   3D dimension rejection, non-adjustment runMode, size guard, and a
 *   reference-unconverged case (maxIterations 0) whose sparse run is skipped.
 * - Clean-run restart fallback proof: an injected sparse failure falls back
 *   in-solve with recorded fallback counts, then a clean TS rerun from the
 *   original request reproduces the reference bit-identically.
 *
 * No production routing, UI, persistence, or tolerance changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { createExperimentalSparseRouteDiagnostics } from '../src/engine/experimentalSparseDiagnostics';
import {
  classifyPhase7b5Candidate,
  summarizePhase7b5Corpus,
  type Phase7b5CorpusCandidate,
} from '../src/engine/phase7b5CandidateCorpus';
import {
  isAdjustmentWorkerResponseMessage,
  type AdjustmentWorkerRequestMessage,
  type AdjustmentWorkerResponseMessage,
} from '../src/engine/adjustmentWorkerProtocol';
import { compareSparseShadowResults } from '../src/engine/phase6SparseShadowCompare';
import { generatePhase5BenchmarkInput } from '../src/engine/phase5BenchmarkNetworks';
import { runAdjustmentSession } from '../src/engine/runSession';
import { createRunSessionRequest } from './helpers/runSessionRequest';

const BRIDGE_PATH = path.join(process.cwd(), 'scripts/phase7bAdjustmentWorkerBridge.ts');
const SHADOW_TOLERANCE_M = 1e-6;

const readExample = (file: string): string =>
  fs.readFileSync(path.join(process.cwd(), 'public/examples', file), 'utf-8');

interface WorkerDiagnostics {
  sparseCorrectionCalls: number;
  sparseCorrectionFallbacks: number;
  rowProductsCalls: number;
  rowProductsFallbacks: number;
  selectedCovarianceCalls: number;
  selectedCovarianceFallbacks: number;
  bundleInitialized: boolean;
}

/** One RunRequestMessage through the actual worker; resolves on settle. */
const runActualWorker = (
  request: AdjustmentWorkerRequestMessage,
  timeoutMs = 90000,
): Promise<{ messages: AdjustmentWorkerResponseMessage[]; diagnostics: WorkerDiagnostics }> =>
  new Promise((resolve, reject) => {
    const messages: AdjustmentWorkerResponseMessage[] = [];
    let diagnostics: WorkerDiagnostics | null = null;
    let worker: Worker;
    try {
      worker = new Worker(BRIDGE_PATH, { execArgv: ['--import', 'tsx'] });
    } catch (error) {
      reject(error);
      return;
    }
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error(`worker did not settle within ${timeoutMs} ms`));
    }, timeoutMs);
    worker.on('message', (message: unknown) => {
      const record = message as { type?: unknown };
      if (record?.type === 'test-diagnostics') {
        diagnostics = (record as { diagnostics: WorkerDiagnostics }).diagnostics;
        if (messages.some((m) => m.type === 'success' || m.type === 'failure')) {
          clearTimeout(timer);
          void worker.terminate();
          resolve({ messages, diagnostics: diagnostics as WorkerDiagnostics });
        }
        return;
      }
      if (!isAdjustmentWorkerResponseMessage(message)) {
        clearTimeout(timer);
        void worker.terminate();
        reject(new Error('worker emitted a message outside the protocol guard'));
        return;
      }
      messages.push(message);
      if (message.type === 'success' || message.type === 'failure') {
        if (message.type === 'failure' || diagnostics) {
          clearTimeout(timer);
          void worker.terminate();
          if (message.type === 'failure') reject(new Error(message.error));
          else resolve({ messages, diagnostics: diagnostics as WorkerDiagnostics });
        }
      }
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.postMessage(request);
  });

/** Bounded corpus: committed fixtures plus deterministic directive variants. */
const buildCorpus = (): Phase7b5CorpusCandidate[] => {
  const triangulation = readExample('ts_triangulation_trilateration_2d.dat');
  const resection = readExample('industry_resection_pillars.dat');
  const industry3d = readExample('industry_demo.dat');
  const chain16 = generatePhase5BenchmarkInput({ id: 'chain-2d-16', family: 'chain-2d', unknownCount: 16, seed: 1116 });
  const gpsPlain = generatePhase5BenchmarkInput({ id: 'gps-2d-08', family: 'gps-2d', unknownCount: 8, seed: 2202 });
  const base = {
    maxUnknownCount: 128,
    runMode: 'adjustment' as const,
    wasmAvailable: true,
    workerAvailable: true,
    rankRisk: 'none' as const,
  };
  return [
    {
      id: 'industry-2d-triangulation', family: 'industry', source: 'ts_triangulation_trilateration_2d.dat',
      input: triangulation, maxIterations: 10,
      eligibility: { ...base, dimension: '2d', unknownCount: 8, robustWeighting: false, tsCorrelation: false, gpsCovarianceWeighting: false },
    },
    {
      id: 'industry-2d-resection', family: 'industry', source: 'industry_resection_pillars.dat',
      input: resection, maxIterations: 25,
      eligibility: { ...base, dimension: '2d', unknownCount: 8, robustWeighting: false, tsCorrelation: false, gpsCovarianceWeighting: false },
    },
    {
      id: 'chain-2d-16', family: 'generated-chain', source: 'generatePhase5BenchmarkInput chain-2d-16/1116',
      input: chain16, maxIterations: 10,
      eligibility: { ...base, dimension: '2d', unknownCount: 16, robustWeighting: false, tsCorrelation: false, gpsCovarianceWeighting: false },
    },
    {
      id: 'gps-plain-2d-08', family: 'gps', source: 'generatePhase5BenchmarkInput gps-2d-08/2202',
      input: gpsPlain, maxIterations: 10,
      eligibility: { ...base, dimension: '2d', unknownCount: 8, robustWeighting: false, tsCorrelation: false, gpsCovarianceWeighting: false },
    },
    {
      id: 'industry-3d-dimension', family: 'industry-3d', source: 'industry_demo.dat',
      input: industry3d, maxIterations: 10,
      eligibility: { ...base, dimension: '3d', unknownCount: 8, robustWeighting: false, tsCorrelation: false, gpsCovarianceWeighting: false },
    },
    {
      id: 'robust-rejected', family: 'robust', source: 'ts_triangulation_trilateration_2d.dat + .ROBUST HUBER 1.5',
      input: `${triangulation}\n.ROBUST HUBER 1.5\n`, maxIterations: 10,
      eligibility: { ...base, dimension: '2d', unknownCount: 8, robustWeighting: true, tsCorrelation: false, gpsCovarianceWeighting: false },
    },
    {
      id: 'tscorr-rejected', family: 'correlation', source: 'ts_triangulation_trilateration_2d.dat + .TSCORR ON',
      input: `${triangulation}\n.TSCORR ON\n`, maxIterations: 10,
      eligibility: { ...base, dimension: '2d', unknownCount: 8, robustWeighting: false, tsCorrelation: true, gpsCovarianceWeighting: false },
    },
    {
      id: 'gps-covariance-rejected', family: 'gps-covariance', source: 'generated gps-2d-08 + .GPS WEIGHT COVARIANCE',
      input: `${gpsPlain}\n.GPS WEIGHT COVARIANCE\n`, maxIterations: 10,
      eligibility: { ...base, dimension: '2d', unknownCount: 8, robustWeighting: false, tsCorrelation: false, gpsCovarianceWeighting: true },
    },
    {
      id: 'non-adjustment-mode', family: 'runmode', source: 'ts_triangulation_trilateration_2d.dat @ preanalysis',
      input: triangulation, maxIterations: 10,
      eligibility: { ...base, runMode: 'preanalysis', dimension: '2d', unknownCount: 8, robustWeighting: false, tsCorrelation: false, gpsCovarianceWeighting: false },
    },
    {
      id: 'size-guard-rejected', family: 'size-guard', source: 'generated chain-2d-16 vs max 4',
      input: chain16, maxIterations: 10,
      eligibility: { ...base, maxUnknownCount: 4, dimension: '2d', unknownCount: 16, robustWeighting: false, tsCorrelation: false, gpsCovarianceWeighting: false },
    },
    {
      id: 'reference-unconverged', family: 'unconverged', source: 'ts_triangulation_trilateration_2d.dat @ maxIterations 0',
      input: triangulation, maxIterations: 0,
      eligibility: { ...base, dimension: '2d', unknownCount: 8, robustWeighting: false, tsCorrelation: false, gpsCovarianceWeighting: false },
    },
  ];
};

describe('phase 7B.5 candidate corpus simulation', () => {
  it('always classifies every candidate with deterministic reasons', () => {
    const corpus = buildCorpus();
    const records = corpus.map((candidate) => {
      const reference = new LSAEngine({ input: candidate.input, maxIterations: candidate.maxIterations }).solve();
      return classifyPhase7b5Candidate(candidate, {
        success: reference.success,
        converged: reference.converged,
        iterations: reference.iterations ?? 0,
      });
    });
    // Every candidate carries an explicit verdict, eligible or not.
    expect(records).toHaveLength(11);
    const byId = new Map(records.map((record) => [record.id, record]));
    for (const candidate of corpus) {
      const record = byId.get(candidate.id);
      expect(record, `${candidate.id} classified`).toBeDefined();
      expect(record?.sparseDisposition.length).toBeGreaterThan(0);
    }
    expect(byId.get('industry-2d-triangulation')?.eligible).toBe(true);
    expect(byId.get('industry-2d-resection')?.eligible).toBe(true);
    expect(byId.get('industry-2d-resection')?.referenceConverged).toBe(true);
    expect(byId.get('industry-2d-resection')?.sparseDisposition).toBe('sparse-worker-run');
    expect(byId.get('chain-2d-16')?.eligible).toBe(true);
    expect(byId.get('gps-plain-2d-08')?.eligible).toBe(true);
    expect(byId.get('industry-3d-dimension')?.reasons.join(' ')).toMatch(/dimension/);
    expect(byId.get('robust-rejected')?.reasons.join(' ')).toMatch(/robust/i);
    expect(byId.get('tscorr-rejected')?.reasons.join(' ')).toMatch(/TS correlation/);
    expect(byId.get('gps-covariance-rejected')?.reasons.join(' ')).toMatch(/GPS covariance/);
    expect(byId.get('non-adjustment-mode')?.reasons.join(' ')).toMatch(/runMode/);
    expect(byId.get('size-guard-rejected')?.reasons.join(' ')).toMatch(/size guard/);
    const unconverged = byId.get('reference-unconverged');
    expect(unconverged?.eligible).toBe(true);
    expect(unconverged?.referenceConverged).toBe(false);
    expect(unconverged?.sparseDisposition).toMatch(/reference-unconverged/);
    const summary = summarizePhase7b5Corpus(records);
    expect(summary).toEqual({ total: 11, eligible: 5, ineligible: 6, referenceUnconverged: 1 });
  });

  it('runs every eligible converged candidate through the actual worker; diverged cases are flagged', async () => {
    // Every sparse-ready candidate (eligible + converged): no hand-picked subset.
    // Resection pillars carry weak geometry: the pivot-free sparse candidate
    // diverges where pivoted dense TS converges (consistent with the Phase 6
    // SimplicialLDLT finding). The corpus must run it, compare it, and FLAG
    // the divergence fail-closed rather than silently accept it.
    const expectedPass = new Set(['industry-2d-triangulation', 'chain-2d-16', 'gps-plain-2d-08']);
    const ready = buildCorpus().filter((candidate) => {
      const reference = new LSAEngine({ input: candidate.input, maxIterations: candidate.maxIterations }).solve();
      return classifyPhase7b5Candidate(candidate, {
        success: reference.success,
        converged: reference.converged,
        iterations: reference.iterations ?? 0,
      }).sparseDisposition === 'sparse-worker-run';
    });
    expect(ready.map((candidate) => candidate.id).sort()).toEqual(
      ['chain-2d-16', 'gps-plain-2d-08', 'industry-2d-resection', 'industry-2d-triangulation'],
    );
    for (const candidate of ready) {
      const mustPass = expectedPass.has(candidate.id);
      // Session-profile iterations differ from raw LSAEngine (industry-parity
      // needs more cycles): give each candidate headroom past its observed
      // session count (tri 17, res 23, chain/gps 4) and compare the worker
      // against the IDENTICAL in-process session request.
      const workerMax = candidate.id === 'industry-2d-triangulation' || candidate.id === 'industry-2d-resection' ? 25 : 10;
      const payload = createRunSessionRequest({ input: candidate.input, maxIterations: workerMax });
      const reference = runAdjustmentSession(payload).result;
      expect(reference.success, `${candidate.id} session reference success`).toBe(true);
      expect(reference.converged, `${candidate.id} session reference converged`).toBe(true);
      const record = classifyPhase7b5Candidate(candidate, {
        success: reference.success,
        converged: reference.converged,
        iterations: reference.iterations ?? 0,
      });
      expect(record.sparseDisposition).toBe('sparse-worker-run');
      const { messages, diagnostics } = await runActualWorker({
        type: 'run',
        runId: `phase7b5-corpus-${candidate.id}`,
        payload,
      });
      const success = messages[messages.length - 1];
      expect(success?.type).toBe('success');
      if (success?.type !== 'success') continue;
      console.log(`[phase7b5-corpus] ${candidate.id}: success=${success.payload.result.success} converged=${success.payload.result.converged} iterations=${success.payload.result.iterations}`);
      expect(success.payload.result.success).toBe(true);
      expect(diagnostics.bundleInitialized).toBe(true);
      expect(diagnostics.sparseCorrectionCalls).toBeGreaterThan(0);
      // Core solve must stay sparse; row-product/selected fallbacks are
      // recorded honestly per candidate (triangulation row products fall
      // back to dense by existing behavior) and must not break parity.
      expect(diagnostics.sparseCorrectionFallbacks).toBe(0);
      console.log(`[phase7b5-corpus] ${candidate.id} fallbacks: correction=${diagnostics.sparseCorrectionFallbacks} rowProducts=${diagnostics.rowProductsFallbacks} selected=${diagnostics.selectedCovarianceFallbacks}`);
      const comparison = compareSparseShadowResults(reference, success.payload.result, SHADOW_TOLERANCE_M);
      console.log(`[phase7b5-corpus] ${candidate.id} shadow: pass=${comparison.pass} coord=${comparison.maxCoordDiffM.toExponential(2)} iters=${comparison.referenceIterations}/${comparison.candidateIterations} reasons=${comparison.passReasons.join('; ') || 'none'}`);
      if (mustPass) {
        expect(comparison.pass, `${candidate.id} shadow parity: ${comparison.passReasons.join('; ')}`).toBe(true);
        expect(comparison.maxCoordDiffM).toBeLessThan(SHADOW_TOLERANCE_M);
        const expectedRows = reference.relativePrecision ?? [];
        const actualRows = success.payload.result.relativePrecision ?? [];
        expect(actualRows).toHaveLength(expectedRows.length);
        actualRows.forEach((row, index) => {
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
      } else {
        // Weak-geometry divergence must be detected, never silently accepted.
        expect(comparison.pass, `${candidate.id} divergence must be flagged`).toBe(false);
        expect(comparison.maxCoordDiffM).toBeGreaterThan(SHADOW_TOLERANCE_M);
        expect(reference.success && reference.converged, `${candidate.id} TS reference stays green`).toBe(true);
      }
    }
  }, 600000);

  it('proves clean-run restart: injected sparse failure falls back, clean TS rerun matches', () => {
    const input = readExample('ts_triangulation_trilateration_2d.dat');
    const cleanReference = new LSAEngine({ input }).solve();
    expect(cleanReference.success).toBe(true);
    const diagnostics = createExperimentalSparseRouteDiagnostics();
    const degraded = new LSAEngine({
      input,
      sparseCorrectionSolver: {
        solveFromEquations: (): never => {
          throw new Error('injected phase7b5 sparse failure');
        },
      },
      experimentalSparseDiagnostics: diagnostics,
    }).solve();
    // In-solve dense fallback keeps the run green while recording the cause.
    expect(degraded.success).toBe(true);
    expect(diagnostics.sparseCorrectionCalls).toBeGreaterThan(0);
    expect(diagnostics.sparseCorrectionFallbacks).toBeGreaterThan(0);
    // Clean restart from the ORIGINAL request reproduces the reference exactly.
    const restart = new LSAEngine({ input }).solve();
    expect(restart.success).toBe(true);
    for (const [id, station] of Object.entries(cleanReference.stations)) {
      const other = restart.stations[id];
      expect(other, `station ${id} restarts identically`).toBeDefined();
      expect(other?.x).toBe(station.x);
      expect(other?.y).toBe(station.y);
      expect(other?.h).toBe(station.h);
    }
    const degradedStations = Object.keys(degraded.stations).sort();
    expect(degradedStations).toEqual(Object.keys(cleanReference.stations).sort());
  });
});
