/**
 * Phase 13F B2 — multifile perf splits (agent tier, synthetic only).
 *
 * Follows the tests/gnssBaseline/gnssMultifileProject.test.ts L362 pattern:
 * a shared 4-station network (9 unknowns, TS-dense friendly) with baselines
 * spread over 5/10/25/50 files to ~1k/10k/50k totals. Reports the
 * parse / compose+summary / solve / report-build split per leg. The
 * solve runs on the main thread here (direct TS dispatch); production UI
 * posts the same composed input through the existing gnss-run worker.
 * No engine optimization unless these numbers regress.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import type { ProjectManifestFileEntry } from '../../src/engine/projectWorkspaceTypes';
import { setGnssMultifileEnabled } from '../../src/engine/gnssMultifileFlag';
import {
  parseGnssProjectSources,
  runGnssMultifileProjectSolve,
  summarizeGnssProjectComposition,
} from '../../src/engine/gnssMultifileProject';
import { buildGnssBaselineReport } from '../../src/engine/gnssBaselineReport';
import { computeGnssLoopClosures } from '../../src/engine/gnssBaselineLoops';

const FRAME = 'ITRF2020@2020.0';
const EPOCH = '2020.0';
const ELLIPSOID = 'GRS80';
const COV = 'COV 0.000025 0 0 0.000025 0 0.000025';
const STATIONS = ['A', 'B', 'C', 'D'] as const;
const COORDS: Record<string, [number, number, number]> = {
  A: [4000000, 1000000, 4800000],
  B: [4000100, 1000050, 4800020],
  C: [4000200, 999950, 4800100],
  D: [4000150, 1000100, 4799950],
};
const PAIRS: Array<[string, string]> = [
  ['A', 'B'],
  ['B', 'C'],
  ['C', 'D'],
  ['D', 'A'],
  ['A', 'C'],
  ['B', 'D'],
];

const coordOf = (i: number): [number, number, number] =>
  [4000000 + i * 137, 1000000 + i * 89, 4800000 + i * 53];

const buildFiles = (
  fileCount: number,
  perFile: number,
  shared: boolean,
): { files: ProjectManifestFileEntry[]; texts: Record<string, string> } => {
  const files: ProjectManifestFileEntry[] = [];
  const texts: Record<string, string> = {};
  for (let f = 0; f < fileCount; f += 1) {
    const id = `sperf${f}`;
    files.push({ id, name: `sperf${f}.dat`, kind: 'gnss', path: `data/${id}-sperf${f}.dat`, enabled: true, order: f });
    const lines = [`FRAME ECEF ${FRAME} EPOCH ${EPOCH} ELLIPSOID ${ELLIPSOID}`, 'UNITS M'];
    if (shared) {
      // One connected 4-station network (TS-dense solve friendly, 9 unknowns).
      STATIONS.forEach((station) => {
        const c = COORDS[station] as [number, number, number];
        lines.push(`GX ${station} ${c[0]} ${c[1]} ${c[2]} ${station === 'A' ? 'FIXED' : 'FREE'}`);
      });
      for (let i = 0; i < perFile; i += 1) {
        const [from, to] = PAIRS[(i + f) % PAIRS.length] as [string, string];
        const a = COORDS[from] as [number, number, number];
        const bb = COORDS[to] as [number, number, number];
        const j = ((i * 7 + f) % 11) * 0.001;
        lines.push(`BL ${from} ${to} ${bb[0] - a[0] + j} ${bb[1] - a[1] - j} ${bb[2] - a[2] + j} ID F${f}B${i} SESSION S${i % 5}`);
        lines.push(COV);
      }
    } else {
      // L362 pattern: disjoint stations per file, so endpoint groups stay
      // small and duplicate classification stays indexed (~O(n)). Piling
      // tens of thousands of baselines onto a handful of pairs is a
      // pathological quadratic case, not a project shape — kept out of tier.
      lines.push(`GX A 4000000 1000000 4800000 FIXED`);
      for (let i = 0; i < 20; i += 1) {
        const c = coordOf(i);
        lines.push(`GX F${f}P${i} ${c[0]} ${c[1]} ${c[2]} FREE`);
      }
      for (let i = 0; i < perFile; i += 1) {
        const a = `F${f}P${i % 20}`;
        const b = `F${f}P${(i + 1) % 20}`;
        const ca = coordOf(i % 20);
        const cb = coordOf((i + 1) % 20);
        lines.push(`BL ${a} ${b} ${cb[0] - ca[0]} ${cb[1] - ca[1]} ${cb[2] - ca[2]} ID F${f}B${i} SESSION S${i % 5}`);
        lines.push(COV);
      }
    }
    texts[id] = `${lines.join('\n')}\n`;
  }
  return { files, texts };
};

beforeEach(() => {
  setGnssMultifileEnabled(true);
});

describe('gnss multifile perf splits', () => {
  // Explicit timeout: split timings are LOGGED, never gated (tier rule:
  // never gate on absolute runtime — machines differ). Under full-suite
  // parallel load the four legs take ~7s wall; standalone ~2.5s.
  it('5/10/25/50 files to ~1k/10k/50k baselines: parse/compose/solve/report', { timeout: 120000 }, () => {
    // Parse/compose scale to 50k in-tier (cf. L362 pattern). Full solve +
    // report stay on the ~1k leg only: the TS-dense statistics path builds
    // dense residual covariance, so 10k+ solves OOM in-tier (pre-existing
    // engine characteristic, not a B2 regression) and belong to the manual
    // evidence tier, never the agent tier.
    const legs = [
      { files: 5, perFile: 200, solve: true, shared: true },
      { files: 10, perFile: 1000, solve: false, shared: false },
      { files: 25, perFile: 1000, solve: false, shared: false },
      { files: 50, perFile: 1000, solve: false, shared: false },
    ];
    legs.forEach(({ files: fileCount, perFile, solve, shared }) => {
      const total = fileCount * perFile;
      const { files, texts } = buildFiles(fileCount, perFile, shared);
      const t0 = Date.now();
      const parsed = parseGnssProjectSources(files, texts);
      const t1 = Date.now();
      const summary = summarizeGnssProjectComposition(parsed, fileCount);
      const t2 = Date.now();
      expect(summary.status).toBe('READY');
      expect(summary.baselineCount).toBe(total);
      let solveMs = -1;
      let reportMs = -1;
      if (solve) {
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
        expect(report.baselineCount).toBe(total);
        solveMs = t3 - t2;
        reportMs = t4 - t3;
      }
      console.log(
        `gnss multifile splits: files=${fileCount} baselines=${total} ` +
          `parse=${t1 - t0}ms compose+summary=${t2 - t1}ms` +
          (solve ? ` solve=${solveMs}ms report=${reportMs}ms` : ' solve=SKIP report=SKIP (evidence tier)') +
          ` total=${Date.now() - t0}ms`,
      );
    });
  });
});
