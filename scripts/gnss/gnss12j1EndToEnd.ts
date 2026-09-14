/**
 * Phase 12J.1 Batch F §39 — EVIDENCE ONLY end-to-end for S32.
 *
 * RINEX bytes -> WASM processStaticBaseline (existing module, prebuilt
 * /tmp/webnet-12j1-wasm/rnx2rtkp.js; run gnss12j1WasmStatic.ts to build) ->
 * L1 marker correction -> §36 canonical adapter -> existing WebNet
 * adjustment + report via buildGnssReportFromInput (called as-is, no engine
 * changes). Proves the adapted observation solves and report/provenance
 * (sessionId/solutionId) survives.
 *
 * Fail-closed SKIP when corpus or prebuilt WASM is absent.
 * Run: npx tsx scripts/gnss/gnss12j1EndToEnd.ts [--json]
 */
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGnssReportFromInput } from '../../src/engine/gnssBaselineReport';
import type { StationMap } from '../../src/types';
import {
  MARKER_TO_MARKER_ECEF,
  adaptRawBaselineToObservation,
  type RawGnssBaselineSolution,
} from './gnss12j1CanonicalAdapter';
import { COHORT, markerCorrection } from './gnss12j1Cohort';
import { CORPUS_DIR } from './gnss12j1CorpusInventory';
import { S32_BASE_XYZ, S32_FILES, runPrebuiltWasm } from './gnss12j1WasmClient';

const WASM_JS = join(tmpdir(), 'webnet-12j1-wasm', 'rnx2rtkp.js');

const ssq = (sd: number): number => (sd < 0 ? -sd * sd : sd * sd);

function skip(msg: string): void {
  console.log(JSON.stringify({ skipped: true, reason: msg }));
}

async function main(): Promise<void> {
  if (!existsSync(CORPUS_DIR)) return skip(`corpus absent: ${CORPUS_DIR}`);
  if (!existsSync(WASM_JS)) {
    return skip(`prebuilt WASM absent: ${WASM_JS} (run gnss12j1WasmStatic.ts first)`);
  }
  const read = (n: string): Uint8Array => new Uint8Array(readFileSync(join(CORPUS_DIR, n)));

  // 1. RINEX bytes -> WASM via the Batch F client (the §31 API module is
  // not imported — it runs its CLI main on import; same prebuilt binary).
  const t0 = Date.now();
  const sol = await runPrebuiltWasm(
    WASM_JS,
    read(S32_FILES.roverObs),
    read(S32_FILES.baseObs),
    [read(S32_FILES.roverNav), read(S32_FILES.baseNav)],
    S32_BASE_XYZ,
  );
  const wasmMs = Date.now() - t0;
  if (sol.status !== 'FIX') throw new Error(`expected FIX, got ${sol.status}`);
  if (sol.ratio !== 28.6 || sol.satellites !== 7 || sol.epochs !== 93) {
    throw new Error(
      `S32 golden mismatch: ratio=${sol.ratio} sats=${sol.satellites} epochs=${sol.epochs}`,
    );
  }

  // 2. L1 marker correction (existing cohort helper, as-is).
  const leg = COHORT.find((l) => l.id === 'S32');
  if (!leg) throw new Error('S32 leg missing from COHORT');
  const corr = markerCorrection(join(CORPUS_DIR, leg.rover), join(CORPUS_DIR, 'p0411650.06o'));
  const marked: [number, number, number] = [
    sol.deltaX - corr[0],
    sol.deltaY - corr[1],
    sol.deltaZ - corr[2],
  ];
  const dv = [
    marked[0] - leg.tbcXYZ[0],
    marked[1] - leg.tbcXYZ[1],
    marked[2] - leg.tbcXYZ[2],
  ];
  const vecDeltaMm = Math.hypot(dv[0], dv[1], dv[2]) * 1000;

  // 3. Canonical adapter (§36): input already mark-to-mark, declared so.
  const raw: RawGnssBaselineSolution = {
    from: 'P041',
    to: 'SIXTWO',
    reference: MARKER_TO_MARKER_ECEF,
    delta: marked,
    covariance: {
      xx: ssq(sol.covariance[0]),
      xy: ssq(sol.covariance[3]),
      xz: ssq(sol.covariance[5]),
      yy: ssq(sol.covariance[1]),
      yz: ssq(sol.covariance[4]),
      zz: ssq(sol.covariance[2]),
    },
    sourceFrame: 'WGS84(G1150)-class/broadcast',
    sessionId: 'S32',
    solutionId: 'B32-RAW',
    sourceFile: 'wasm-processStaticBaseline',
  };
  const observation = adaptRawBaselineToObservation(raw, 32);

  // 4. Existing WebNet adjustment + report, called as-is (no engine changes).
  const [bx, by, bz] = S32_BASE_XYZ;
  const stations: StationMap = {
    P041: { x: bx, y: by, h: bz, fixed: true, fixedX: true, fixedY: true, fixedH: true },
    SIXTWO: {
      x: bx + marked[0],
      y: by + marked[1],
      h: bz + marked[2],
      fixed: false,
      fixedX: false,
      fixedY: false,
      fixedH: false,
    },
  };
  const { result, report } = buildGnssReportFromInput({ stations, baselines: [observation] });
  if (!result.converged) throw new Error('adjustment did not converge');
  const entry = report.baselines.find((b) => b.sessionId === 'S32');
  if (!entry || entry.solutionId !== 'B32-RAW') {
    throw new Error('report/provenance did not survive (sessionId/solutionId missing)');
  }

  console.log(
    JSON.stringify(
      {
        verdict: 'PASS §39',
        wasm: {
          status: sol.status,
          ratio: sol.ratio,
          sats: sol.satellites,
          epochs: sol.epochs,
          processMs: wasmMs,
        },
        l1CorrectionMm: corr.map((v) => v * 1000),
        markedDeltaM: marked,
        tbcDeltaMm: vecDeltaMm,
        adjustment: {
          converged: result.converged,
          dof: result.dof,
          residuals: result.residuals.map((r) => [r.vX, r.vY, r.vZ]),
          sixtwo: result.stations['SIXTWO'],
        },
        reportSurvives: {
          sessionId: entry.sessionId,
          solutionId: entry.solutionId,
          from: entry.from,
          to: entry.to,
        },
      },
      null,
      2,
    ),
  );
}

void main().catch((e: unknown) => {
  console.error(`FAIL: ${(e as Error).message}`);
  process.exit(1);
});
