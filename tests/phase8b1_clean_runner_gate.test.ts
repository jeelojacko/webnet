/**
 * Phase 8B.1 clean-runner CI gate (focused, CI-sized).
 *
 * The exact-production-route real-WASM gate that CI runs after `wasm:build`:
 * the real artifact MUST exist (absence fails loudly, never skips), the
 * production route stays default-OFF with zero WASM init, the small anchor
 * is sparsely accepted with full contract agreement, the camp fixture falls
 * back bit-identical, and an eligible 2D adjustment is natively accepted
 * bit-identical. The 10-minute 120-session stress and the browser proof stay
 * local-only (see reports/phase8b1/release-closure-audit.md).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { runAdjustmentSession } from '../src/engine/runSession';
import { comparePreanalysisContract } from '../src/engine/preanalysisSparseEvidence';
import {
  FIXTURE_INPUT,
  makeAdjustmentRequest,
  makePreanalysisRequest,
  Phase8b1Worker,
  stableKeyOf,
} from './helpers/phase8b1WorkerHarness';

const ARTIFACTS = [
  path.join(process.cwd(), 'cpp/build-wasm/webnet_core.js'),
  path.join(process.cwd(), 'cpp/build-wasm/webnet_core.wasm'),
];

describe('phase 8B.1 clean-runner gate (exact production route, real WASM)', () => {
  it('requires the real WASM artifact (never skips)', () => {
    const missing = ARTIFACTS.filter((file) => !fs.existsSync(file));
    expect(missing, `real-WASM artifact absent: ${missing.join(', ')}; CI must run 'npm run wasm:build' first`).toEqual([]);
  });

  it('stays default-OFF with zero WASM init', async () => {
    const worker = Phase8b1Worker.launch({});
    try {
      const request = makePreanalysisRequest(FIXTURE_INPUT.anchor);
      const { outcome, after } = await worker.run(request, 'gate-off');
      expect(after.bundleInitCount).toBe(0);
      expect(after.realWasm).toBe(false);
      expect(after.correctionCalls).toBe(0);
      expect(stableKeyOf(outcome)).toBe(stableKeyOf(runAdjustmentSession(request)));
    } finally {
      await worker.close();
    }
  }, 180000);

  it('accepts the anchor sparsely with full contract agreement', async () => {
    const worker = Phase8b1Worker.launch({ PHASE8B_ROUTE: '1', PHASE8B_WASM: '1' });
    try {
      const request = makePreanalysisRequest(FIXTURE_INPUT.anchor);
      const { outcome, before, after } = await worker.run(request, 'gate-anchor');
      expect(after.realWasm).toBe(true);
      expect(after.correctionCalls - before.correctionCalls).toBeGreaterThan(0);
      expect(after.correctionThrows - before.correctionThrows).toBe(0);
      const direct = runAdjustmentSession(request);
      expect(comparePreanalysisContract(direct.result, outcome.result).pass).toBe(true);
    } finally {
      await worker.close();
    }
  }, 180000);

  it('falls back bit-identical on the camp fixture', async () => {
    const worker = Phase8b1Worker.launch({ PHASE8B_ROUTE: '1', PHASE8B_WASM: '1' });
    try {
      const request = makePreanalysisRequest(FIXTURE_INPUT.campTraverse);
      const { outcome } = await worker.run(request, 'gate-camp');
      expect(stableKeyOf(outcome)).toBe(stableKeyOf(runAdjustmentSession(request)));
    } finally {
      await worker.close();
    }
  }, 180000);

  it('accepts an eligible 2D adjustment natively and bit-identically', async () => {
    const worker = Phase8b1Worker.launch({ PHASE8B_ROUTE: '1', PHASE8B_WASM: '1' });
    try {
      const request = makeAdjustmentRequest(FIXTURE_INPUT.triang);
      const { outcome, before, after } = await worker.run(request, 'gate-adjust');
      expect(after.correctionCalls - before.correctionCalls).toBeGreaterThan(0);
      expect(after.correctionThrows - before.correctionThrows).toBe(0);
      expect(stableKeyOf(outcome)).toBe(stableKeyOf(runAdjustmentSession(request)));
    } finally {
      await worker.close();
    }
  }, 180000);
});
