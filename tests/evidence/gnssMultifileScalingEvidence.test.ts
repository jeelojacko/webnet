/**
 * Phase 13F fixes — multifile 10/25/50-file scaling campaign (MANUAL-ONLY
 * evidence tier, synthetic only).
 *
 * Split out of the agent-tier perf-splits test: parse/compose/summary to
 * ~10k/25k/50k baselines are a scaling campaign, not an everyday
 * regression gate. Timings are LOGGED, never gated (tier rule: never gate
 * on absolute runtime — machines differ). Run explicitly via
 * `npm run test:evidence`.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { setGnssMultifileEnabled } from '../../src/engine/gnssMultifileFlag';
import {
  parseGnssProjectSources,
  summarizeGnssProjectComposition,
} from '../../src/engine/gnssMultifileProject';
import { buildPerfFiles } from '../gnssBaseline/gnssMultifilePerfSupport';

beforeEach(() => {
  setGnssMultifileEnabled(true);
});

describe('gnss multifile scaling (evidence campaign)', () => {
  it('10/25/50 files to ~10k/25k/50k baselines: parse/compose/summary', { timeout: 300000 }, () => {
    // Full solve + report stay on the agent-tier ~1k leg only: the
    // TS-dense statistics path builds dense residual covariance, so 10k+
    // solves OOM in-tier (pre-existing engine characteristic) and belong
    // here in the manual evidence tier, never the agent tier.
    const legs = [
      { files: 10, perFile: 1000 },
      { files: 25, perFile: 1000 },
      { files: 50, perFile: 1000 },
    ];
    legs.forEach(({ files: fileCount, perFile }) => {
      const total = fileCount * perFile;
      const { files, texts } = buildPerfFiles(fileCount, perFile, false);
      const t0 = Date.now();
      const parsed = parseGnssProjectSources(files, texts);
      const t1 = Date.now();
      const summary = summarizeGnssProjectComposition(parsed, fileCount);
      const t2 = Date.now();
      expect(summary.status).toBe('READY');
      expect(summary.baselineCount).toBe(total);
      console.log(
        `gnss multifile scaling: files=${fileCount} baselines=${total} ` +
          `parse=${t1 - t0}ms compose+summary=${t2 - t1}ms total=${Date.now() - t0}ms`,
      );
    });
  });
});
