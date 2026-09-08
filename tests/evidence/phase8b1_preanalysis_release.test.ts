/**
 * Phase 8B.1 release-closure stress (exact production route, real WASM).
 *
 * One REUSED bridge worker (real cpp/build-wasm bundle, production dispatch,
 * no injected runtime, no Phase 8A bridge) runs >= 100 sequential mixed
 * sessions: three accepted preanalysis shapes, three fail-closed fallback
 * shapes, and cross-mode 2D adjustment interleave. Every session is judged
 * against an in-process TypeScript reference (bit-identical stable key;
 * full preanalysis contract on sparse accepts). Bundle init/reuse, memory
 * snapshots, cancellation, terminate/restart, and init-failure retry are
 * proven on the same lineage where possible. Writes
 * reports/phase8b1/preanalysis-release-closure.json and .md (deterministic:
 * counts/routes/reasons/contract maxima only; memory values are marked
 * informational and excluded from determinism claims).
 *
 * Clean-runner gate: the real WASM artifact MUST exist; absence fails the
 * suite with an explicit reason (never a silent skip). The production route
 * stays default-OFF; enablement lives only in this harness (worker env).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { runAdjustmentSession } from '../../src/engine/runSession';
import type { RunSessionOutcome } from '../../src/engine/runSession';
import { comparePreanalysisContract } from '../../src/engine/preanalysisSparseEvidence';
import {
  FIXTURE_INPUT,
  makeAdjustmentRequest,
  makePreanalysisRequest,
  Phase8b1Worker,
  stableKeyOf,
  type Phase8b1Memory,
} from '../helpers/phase8b1WorkerHarness';

const REPORT_DIR = path.join(process.cwd(), 'reports/phase8b1');
const ARTIFACT_JS = path.join(process.cwd(), 'cpp/build-wasm/webnet_core.js');
const ARTIFACT_WASM = path.join(process.cwd(), 'cpp/build-wasm/webnet_core.wasm');

const STRESS_ENV = { PHASE8B_ROUTE: '1', PHASE8B_WASM: '1' };
const CYCLES = 15;

interface SessionKind {
  kind: string;
  label: string;
  expected: 'sparse' | 'fallback' | 'reference';
  request: () => ReturnType<typeof makePreanalysisRequest>;
}

const KINDS: SessionKind[] = [
  { kind: 'anchor', label: 'preanalysis small anchor (accept)', expected: 'sparse', request: () => makePreanalysisRequest(FIXTURE_INPUT.anchor) },
  { kind: 'closure', label: 'preanalysis traverse closure (accept)', expected: 'sparse', request: () => makePreanalysisRequest(FIXTURE_INPUT.closure) },
  { kind: 'smoke', label: 'preanalysis cli smoke (accept)', expected: 'sparse', request: () => makePreanalysisRequest(FIXTURE_INPUT.smoke) },
  { kind: 'camp', label: 'preanalysis camp traverse-only (cap fallback)', expected: 'fallback', request: () => makePreanalysisRequest(FIXTURE_INPUT.campTraverse) },
  { kind: 'cold', label: 'preanalysis coldstream (damping fallback)', expected: 'fallback', request: () => makePreanalysisRequest(FIXTURE_INPUT.coldstream) },
  { kind: 'campfull', label: 'preanalysis camp full (cap fallback)', expected: 'fallback', request: () => makePreanalysisRequest(FIXTURE_INPUT.campFull) },
  { kind: 'adjust', label: '2D adjustment traverse (cross-mode)', expected: 'reference', request: () => makeAdjustmentRequest(FIXTURE_INPUT.traverse) },
  { kind: 'adjustSparse', label: '2D adjustment triangulation (7C native interleave)', expected: 'reference', request: () => makeAdjustmentRequest(FIXTURE_INPUT.triang) },
];

interface KindStats {
  sessions: number;
  sparseAccepts: number;
  fallbacks: number;
  bitIdentical: boolean;
  contractPass: boolean;
  maxCoordDiff: number;
  maxCovarianceDiff: number;
  correctionCalls: number;
  covarianceCalls: number;
}

const statsOf = (): KindStats => ({
  sessions: 0, sparseAccepts: 0, fallbacks: 0, bitIdentical: true,
  contractPass: true, maxCoordDiff: 0, maxCovarianceDiff: 0,
  correctionCalls: 0, covarianceCalls: 0,
});

const shared = {
  worker: null as Phase8b1Worker | null,
  sessionIndex: 0,
  directKeys: new Map<string, string>(),
  directResults: new Map<string, RunSessionOutcome>(),
  firstKeys: new Map<string, string>(),
  stats: new Map<string, KindStats>(),
  memory: [] as Array<{ session: number; memory: Phase8b1Memory }>,
  finalInitCount: 0,
  realWasm: false,
  cancel: { attempts: 0, cancelled: false },
  restart: { cleanAfterTerminate: false },
  retry: { restartIdentical: false },
  defaultOff: { initCalls: 0, deepEqualTypeScript: false },
};

const workerOf = (): Phase8b1Worker => {
  if (!shared.worker) throw new Error('stress worker not launched');
  return shared.worker;
};

const runCycleRange = async (fromCycle: number, toCycle: number): Promise<void> => {
  const worker = workerOf();
  for (let cycle = fromCycle; cycle <= toCycle; cycle += 1) {
    for (const kind of KINDS) {
      shared.sessionIndex += 1;
      const runId = `phase8b1-s${String(shared.sessionIndex).padStart(3, '0')}-${kind.kind}`;
      const stats = shared.stats.get(kind.kind) ?? statsOf();
      shared.stats.set(kind.kind, stats);
      const { outcome, before, after } = await worker.run(kind.request(), runId);
      const correctionDelta = after.correctionCalls - before.correctionCalls;
      const covarianceDelta = after.covarianceCalls - before.covarianceCalls;
      stats.sessions += 1;
      stats.correctionCalls += correctionDelta;
      stats.covarianceCalls += covarianceDelta;
      shared.realWasm = after.realWasm;
      // Sparse accepts reproduce the TypeScript reference through the full
      // preanalysis contract (native values differ textually at ~1e-19, so
      // bit-identity with the direct run is not the acceptance criterion;
      // mutual repeat identity is). Fallbacks must restart bit-identical.
      const key = stableKeyOf(outcome);
      const first = shared.firstKeys.get(kind.kind);
      if (first === undefined) shared.firstKeys.set(kind.kind, key);
      else if (first !== key) stats.bitIdentical = false;
      expect(key, `${runId} repeat drift within kind ${kind.kind}`).toBe(first ?? key);
      if (kind.expected === 'sparse') {
        expect(correctionDelta, `${runId} ran no native corrections`).toBeGreaterThan(0);
        expect(after.covarianceThrows - before.covarianceThrows, `${runId} native throws`).toBe(0);
        expect(after.covarianceDamped - before.covarianceDamped, `${runId} damped`).toBe(0);
        const direct = shared.directResults.get(kind.kind);
        if (!direct) throw new Error(`no direct reference for ${kind.kind}`);
        const comparison = comparePreanalysisContract(direct.result, outcome.result);
        if (!comparison.pass) stats.contractPass = false;
        expect(comparison.pass, `${runId} contract: ${comparison.reasons.join('; ').slice(0, 200)}`).toBe(true);
        stats.maxCoordDiff = Math.max(stats.maxCoordDiff, comparison.maxCoordDiff);
        stats.maxCovarianceDiff = Math.max(stats.maxCovarianceDiff, comparison.maxCovarianceDiff);
        stats.sparseAccepts += 1;
      } else {
        // Fail-closed fallback (and cross-mode adjustment): the clean
        // TypeScript restart must be bit-identical to the direct reference.
        if (key !== shared.directKeys.get(kind.kind)) stats.bitIdentical = false;
        expect(key, `${runId} fallback diverges from TypeScript reference`).toBe(shared.directKeys.get(kind.kind));
        if (kind.kind === 'adjustSparse') {
          // Phase 7C eligible: must execute natively on the shared worker
          // while reproducing the TypeScript reference bit-identically.
          expect(correctionDelta, `${runId} ran no native corrections`).toBeGreaterThan(0);
          expect(after.correctionThrows - before.correctionThrows, `${runId} native throws`).toBe(0);
          stats.sparseAccepts += 1;
        } else {
          stats.fallbacks += 1;
        }
      }
      if (shared.sessionIndex % 15 === 0) {
        const { memory } = await worker.queryMemory(`mem-${runId}`);
        shared.memory.push({ session: shared.sessionIndex, memory });
      }
    }
  }
};

describe('phase 8B.1 release closure (exact production route, real WASM)', () => {
  it('clean-runner gate: real WASM artifact must exist (never skip)', () => {
    const missing = [ARTIFACT_JS, ARTIFACT_WASM].filter((file) => !fs.existsSync(file));
    expect(missing, `real-WASM artifact absent: ${missing.join(', ')}; build with 'npm run wasm:build'`).toEqual([]);
  });

  it('proves default OFF on a fresh exact-dispatch worker', async () => {
    const worker = Phase8b1Worker.launch({});
    try {
      const request = makePreanalysisRequest(FIXTURE_INPUT.anchor);
      const { outcome, after } = await worker.run(request, 'phase8b1-off');
      shared.defaultOff = {
        initCalls: after.bundleInitCount,
        deepEqualTypeScript: stableKeyOf(outcome) === stableKeyOf(runAdjustmentSession(request)),
      };
      expect(after.bundleInitCount).toBe(0);
      expect(after.realWasm).toBe(false);
      expect(after.correctionCalls).toBe(0);
      expect(shared.defaultOff.deepEqualTypeScript).toBe(true);
    } finally {
      await worker.close();
    }
  }, 180000);

  it('captures in-process references and launches the reused worker', async () => {
    for (const kind of KINDS) {
      const direct = runAdjustmentSession(kind.request());
      shared.directKeys.set(kind.kind, stableKeyOf(direct));
      shared.directResults.set(kind.kind, direct);
    }
    shared.worker = Phase8b1Worker.launch(STRESS_ENV);
    const { diagnostics } = await shared.worker.queryMemory('boot');
    // The bridge installs counting delegates around the REAL bundle at
    // startup (realWasm=true) but the production loader init is lazy:
    // zero inits before the first routed session.
    expect(diagnostics.realWasm).toBe(true);
    expect(diagnostics.bundleInitCount).toBe(0);
  }, 180000);

  it('stress cycles 1-5: 40 sequential mixed sessions', async () => {
    await runCycleRange(1, 5);
  }, 800000);

  it('stress cycles 6-10: 40 sequential mixed sessions', async () => {
    await runCycleRange(6, 10);
  }, 800000);

  it('stress cycles 11-15: bundle reuse holds at one init', async () => {
    await runCycleRange(11, 15);
    const worker = workerOf();
    const { diagnostics } = await worker.queryMemory('final');
    shared.finalInitCount = diagnostics.bundleInitCount;
    expect(shared.sessionIndex).toBe(CYCLES * KINDS.length);
    expect(diagnostics.realWasm).toBe(true);
    expect(diagnostics.bundleInitCount).toBe(1);
    expect(diagnostics.correctionThrows).toBe(0);
    // Damped native covariance is EXPECTED on coldstream fallback sessions
    // (nonzero tiny damping is exactly the fail-closed signal); sparse
    // accepts are held to zero damped/throws per-session above. Record the
    // total as fallback-signal evidence instead of asserting zero.
    expect(diagnostics.covarianceDamped).toBeGreaterThan(0);
    for (const kind of KINDS) {
      const stats = shared.stats.get(kind.kind);
      expect(stats?.sessions).toBe(CYCLES);
      expect(stats?.bitIdentical, `${kind.kind} repeat drift`).toBe(true);
      if (kind.expected === 'sparse') {
        expect(stats?.sparseAccepts).toBe(CYCLES);
        expect(stats?.contractPass, `${kind.kind} contract`).toBe(true);
      }
      if (kind.kind === 'adjustSparse') {
        expect(stats?.sparseAccepts, 'adjustSparse native accepts').toBe(CYCLES);
      }
    }
  }, 800000);

  it('cancels mid-run and stays healthy on the reused worker', async () => {
    const worker = workerOf();
    const slow = [KINDS[5]!, KINDS[4]!, KINDS[3]!];
    for (let attempt = 0; attempt < 8 && !shared.cancel.cancelled; attempt += 1) {
      shared.cancel.attempts += 1;
      const kind = slow[attempt % slow.length]!;
      const probed = await worker.cancelAttempt(kind.request(), `phase8b1-cancel-${attempt + 1}`);
      if (probed.cancelled) {
        shared.cancel.cancelled = true;
        break;
      }
    }
    expect(shared.cancel.cancelled, 'no cancel won the race in 8 attempts').toBe(true);
    const anchor = await worker.run(makePreanalysisRequest(FIXTURE_INPUT.anchor), 'phase8b1-postcancel');
    const anchorDirect = shared.directResults.get('anchor');
    if (!anchorDirect) throw new Error('no direct reference for anchor');
    expect(comparePreanalysisContract(anchorDirect.result, anchor.outcome.result).pass).toBe(true);
  }, 600000);

  it('restarts clean after terminate and retries init failure', async () => {
    await workerOf().close();
    shared.worker = null;
    const revived = Phase8b1Worker.launch(STRESS_ENV);
    try {
      const anchor = makePreanalysisRequest(FIXTURE_INPUT.anchor);
      const rerun = await revived.run(anchor, 'phase8b1-afterkill');
      const anchorDirect = shared.directResults.get('anchor');
      if (!anchorDirect) throw new Error('no direct reference for anchor');
      expect(comparePreanalysisContract(anchorDirect.result, rerun.outcome.result).pass).toBe(true);
      expect(rerun.after.correctionCalls - rerun.before.correctionCalls).toBeGreaterThan(0);
      expect(rerun.after.bundleInitCount).toBe(1);
      shared.restart.cleanAfterTerminate = true;
    } finally {
      await revived.close();
    }
    const failing = Phase8b1Worker.launch({ PHASE8B_ROUTE: '1', PHASE8B_WASM_FAIL: '1' });
    try {
      const anchor = makePreanalysisRequest(FIXTURE_INPUT.anchor);
      const fell = await failing.run(anchor, 'phase8b1-initfail');
      expect(fell.after.bundleInitCount).toBe(1);
      expect(fell.after.correctionCalls).toBe(0);
      shared.retry.restartIdentical = stableKeyOf(fell.outcome) === shared.directKeys.get('anchor');
      expect(shared.retry.restartIdentical).toBe(true);
    } finally {
      await failing.close();
    }
    shared.worker = Phase8b1Worker.launch(STRESS_ENV);
  }, 600000);

  it('writes the deterministic stress evidence (verdict lives in the verdict test)', async () => {
    // Evidence gates: everything the stress itself must prove. The release
    // verdict (browser/CI/default checks) is assembled by
    // tests/phase8b1_release_verdict.test.ts so it can run focused.
    const failures: string[] = [];
    const check = (name: string, pass: boolean): void => {
      if (!pass) failures.push(name);
    };
    check('default-OFF clean (zero init, TS-identical)', shared.defaultOff.initCalls === 0 && shared.defaultOff.deepEqualTypeScript);
    check(`120 sequential mixed sessions (got ${shared.sessionIndex})`, shared.sessionIndex === CYCLES * KINDS.length);
    check('single bundle init across all sessions', shared.finalInitCount === 1);
    check('real WASM delegates throughout', shared.realWasm);
    const perKind: Record<string, unknown> = {};
    for (const kind of KINDS) {
      const stats = shared.stats.get(kind.kind);
      check(`${kind.kind}: ${CYCLES} sessions`, (stats?.sessions ?? 0) === CYCLES);
      check(`${kind.kind}: bit-identical repeats`, stats?.bitIdentical === true);
      if (kind.expected === 'sparse') {
        check(`${kind.kind}: all sparse accepts with contract pass`, (stats?.sparseAccepts ?? 0) === CYCLES && stats?.contractPass === true);
      }
      perKind[kind.kind] = {
        label: kind.label,
        expected: kind.expected,
        sessions: stats?.sessions ?? 0,
        sparseAccepts: stats?.sparseAccepts ?? 0,
        fallbacks: stats?.fallbacks ?? 0,
        bitIdenticalRepeats: stats?.bitIdentical ?? false,
        contractPass: kind.expected === 'sparse' ? (stats?.contractPass ?? false) : undefined,
        maxCoordDiff: stats?.maxCoordDiff ?? 0,
        maxCovarianceDiff: stats?.maxCovarianceDiff ?? 0,
        nativeCorrectionCalls: stats?.correctionCalls ?? 0,
        nativeCovarianceCalls: stats?.covarianceCalls ?? 0,
      };
    }
    const memoryInfo = shared.memory.map((entry) => ({
      afterSession: entry.session,
      rssBytes: entry.memory.rss,
      heapUsedBytes: entry.memory.heapUsed,
      heapTotalBytes: entry.memory.heapTotal,
    }));
    check('cancellation proven with healthy worker', shared.cancel.cancelled);
    check('clean restart after terminate', shared.restart.cleanAfterTerminate);
    check('init-failure retry identical', shared.retry.restartIdentical);
    // Volatile-field discipline: cancel attempt counts and memory bytes vary
    // run to run, so they are recorded as informational only and never
    // gate determinism. The gates above cover routes/counts/contracts only.
    const evidence = {
      phase: '8B.1',
      evidence: 'stress',
      defaultRoute: 'typescript (kill switch OFF unless every gate passes)',
      defaultOff: shared.defaultOff,
      wasmArtifact: 'cpp/build-wasm/webnet_core.js (+ .wasm)',
      verificationColumns: 16,
      sessions: { total: shared.sessionIndex, perKind },
      bundle: { initCount: shared.finalInitCount, realWasm: shared.realWasm },
      memorySnapshots: { note: 'informational only; excluded from determinism claims', snapshots: memoryInfo },
      cancellation: {
        cancelled: shared.cancel.cancelled,
        healthyAfterCancel: true,
        attempts: shared.cancel.attempts,
        attemptsNote: 'informational only; the race attempt count varies run to run and is excluded from determinism claims',
      },
      restartAfterTerminate: shared.restart,
      initFailureRetry: shared.retry,
      evidenceFailures: failures,
    };
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPORT_DIR, 'stress-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    // Browser-proof inputs for scripts/phase8b1BrowserProof.mjs (temp/, untracked):
    // the three browser payloads plus their Node TypeScript reference keys.
    fs.mkdirSync(path.join(process.cwd(), 'temp'), { recursive: true });
    const browserInputs = {
      requests: Object.fromEntries(KINDS.filter((kind) => kind.kind === 'anchor' || kind.kind === 'camp' || kind.kind === 'adjust').map((kind) => [kind.kind === 'camp' ? 'camp' : kind.kind, kind.request()])),
      keys: {
        anchor: shared.directKeys.get('anchor'),
        camp: shared.directKeys.get('camp'),
        adjust: shared.directKeys.get('adjust'),
      },
    };
    fs.writeFileSync(path.join(process.cwd(), 'temp/phase8b1-browser-inputs.json'), `${JSON.stringify(browserInputs)}\n`);
    await workerOf().close();
    shared.worker = null;
    // Evidence gates must all pass here; the verdict test assembles the
    // release closure (browser/CI/default checks) from this evidence.
    expect(failures, `stress evidence regression: ${failures.join('; ')}`).toEqual([]);
    expect(shared.sessionIndex).toBe(CYCLES * KINDS.length);
  }, 120000);
});
