/**
 * Phase 13F B2 — multifile perf smoke leg (agent tier, synthetic only).
 *
 * Fast gate only: the shared 4-station network (9 unknowns, TS-dense
 * friendly) over 5 files to ~1k baselines with full solve + report.
 * The 10/25/50-file scaling campaign lives in the manual-only evidence
 * tier (tests/evidence/gnssMultifileScalingEvidence.test.ts). The solve
 * runs on the main thread here (direct TS dispatch); production UI posts
 * the same composed input through the existing gnss-run worker.
 * No engine optimization unless these numbers regress.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { setGnssMultifileEnabled } from '../../src/engine/gnssMultifileFlag';
import {
  parseGnssProjectSources,
  runGnssMultifileProjectSolve,
  summarizeGnssProjectComposition,
} from '../../src/engine/gnssMultifileProject';
import { buildGnssBaselineReport } from '../../src/engine/gnssBaselineReport';
import { computeGnssLoopClosures } from '../../src/engine/gnssBaselineLoops';
import { buildPerfFiles } from './gnssMultifilePerfSupport';

beforeEach(() => {
  setGnssMultifileEnabled(true);
});

describe('gnss multifile perf splits', () => {
  // Explicit timeout: split timings are LOGGED, never gated (tier rule:
  // never gate on absolute runtime — machines differ).
  it('5 files to ~1k baselines: parse/compose/solve/report', { timeout: 120000 }, () => {
    const { files, texts } = buildPerfFiles(5, 200, true);
    const t0 = Date.now();
    const parsed = parseGnssProjectSources(files, texts);
    const t1 = Date.now();
    const summary = summarizeGnssProjectComposition(parsed, 5);
    const t2 = Date.now();
    expect(summary.status).toBe('READY');
    expect(summary.baselineCount).toBe(1000);
    const output = runGnssMultifileProjectSolve(files, texts);
    const t3 = Date.now();
    expect(output.result.converged).toBe(true);
    if (!output.result.statistics) throw new Error('statistics missing');
    const loops = computeGnssLoopClosures(output.input.baselines);
    const report = buildGnssBaselineReport(
      output.result,
      output.result.statistics,
      loops.loops,
      output.input,
      output.input.baselines,
      output.result.setupModel,
    );
    const t4 = Date.now();
    expect(report.baselineCount).toBe(1000);
    console.log(
      `gnss multifile splits: files=5 baselines=1000 ` +
        `parse=${t1 - t0}ms compose+summary=${t2 - t1}ms solve=${t3 - t2}ms report=${t4 - t3}ms ` +
        `total=${Date.now() - t0}ms`,
    );
  });
});
