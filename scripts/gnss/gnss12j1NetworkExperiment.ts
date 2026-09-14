/**
 * Phase 12J.1 Batch F §40 — EVIDENCE ONLY network reconstruction experiment.
 *
 * Network A ("processed"): the 5 cohort legs (P041+0124) reprocessed through
 * the pinned CLI, L1-corrected, adapted via §36, solved with RTKLIB formal
 * covariances. Network B ("TBC subset"): same stations, TBC mark-to-mark
 * vectors + aposteriori covariances from the committed COHORT table (the
 * repo-side TBC subset; no fixtures/GVX dir exists in this tree).
 * Both solve through the EXISTING gnssBaseline engine, as-is.
 *
 * Evidence only: NO parity expectation before stochastic parity (§22 showed
 * no scalar maps RTKLIB formals to TBC aposteriori shape).
 * Run: npx tsx scripts/gnss/gnss12j1NetworkExperiment.ts [--json]
 */
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGnssBaselineAdjustment } from '../../src/engine/gnssBaselineAdjust';
import type { GnssBaselineObservation } from '../../src/engine/gnssBaselineTypes';
import type { StationMap } from '../../src/types';
import {
  MARKER_TO_MARKER_ECEF,
  adaptRawBaselineToObservation,
  type RawGnssBaselineSolution,
} from './gnss12j1CanonicalAdapter';
import { COHORT, markerCorrection, runRnx } from './gnss12j1Cohort';
import { CORPUS_DIR } from './gnss12j1CorpusInventory';
import { S32_BASE_XYZ } from './gnss12j1WasmClient';

const BASE: [number, number, number] = [...S32_BASE_XYZ] as [number, number, number];
const STATION_OF: Record<string, string> = {
  S38: 'HANNA',
  S40: 'HANNA',
  S39: 'FIVE',
  S32: 'SIXTWO',
  S31: 'FIVE',
};
const OPTS = ['-p', '3', '-f', '2', '-m', '15', '-v', '3.0', '-ti', '30', '-e', '-t'];
const ssq = (sd: number): number => (sd < 0 ? -sd * sd : sd * sd);

function skip(msg: string): void {
  console.log(JSON.stringify({ skipped: true, reason: msg }));
}

function main(): void {
  if (!existsSync(CORPUS_DIR)) return skip(`corpus absent: ${CORPUS_DIR}`);
  if (!existsSync('/tmp/rtklib-evidence/app/consapp/rnx2rtkp/gcc/rnx2rtkp')) {
    return skip('pinned rnx2rtkp binary absent');
  }
  const c = (f: string): string => join(CORPUS_DIR, f);
  const dir = mkdtempSync(join(tmpdir(), 'netexp-'));

  // Network A: reprocess + L1 + adapt, RTKLIB formal covariances.
  // Legs: all 5 cohort legs (ids 1-5 in COHORT order). The SOLVED comparison
  // uses the 4 redundant HANNA/FIVE legs; S32/SIXTWO is covered by the 5-net
  // probes (findings F1/F2) and single-baseline (§39).
  const obsA: GnssBaselineObservation[] = COHORT.map((leg, i) => {
    const run = runRnx(dir, leg.id, [
      ...OPTS, '-sys', 'G', '-ts', leg.ts, '-te', leg.te,
      '-r', ...BASE.map(String), c(leg.rover), c('p0411650.06o'), c(leg.navR), c('p0411650.06n'),
    ]);
    const fix = run.epochs.filter((e) => e.q === 1);
    const last = fix[fix.length - 1];
    if (!last) throw new Error(`no FIX for ${leg.id}`);
    const corr = markerCorrection(c(leg.rover), c('p0411650.06o'));
    const raw: RawGnssBaselineSolution = {
      from: 'P041',
      to: STATION_OF[leg.id] ?? leg.id,
      reference: MARKER_TO_MARKER_ECEF,
      delta: [last.x - BASE[0] - corr[0], last.y - BASE[1] - corr[1], last.z - BASE[2] - corr[2]],
      covariance: {
        xx: ssq(last.sx),
        xy: ssq(last.sxy),
        xz: ssq(last.szx),
        yy: ssq(last.sy),
        yz: ssq(last.syz),
        zz: ssq(last.sz),
      },
      sourceFrame: 'WGS84(G1150)-class/broadcast',
      sessionId: leg.id,
      solutionId: `${leg.tbc}-RAW`,
      sourceFile: 'cli-rnx2rtkp-62d4677',
    };
    return adaptRawBaselineToObservation(raw, i + 1);
  });

  // Network B: TBC vectors + covariances from the committed COHORT table.
  const obsB: GnssBaselineObservation[] = COHORT.map((leg, i) => ({
    type: 'gnssBaseline',
    id: i + 1,
    from: 'P041',
    to: STATION_OF[leg.id] ?? leg.id,
    vector: { x: leg.tbcXYZ[0], y: leg.tbcXYZ[1], z: leg.tbcXYZ[2] },
    covariance: {
      xx: leg.tbcCov[0],
      xy: leg.tbcCov[1],
      xz: leg.tbcCov[2],
      yy: leg.tbcCov[3],
      yz: leg.tbcCov[4],
      zz: leg.tbcCov[5],
    },
    frame: 'ecef',
    referenceFrame: 'project-frame (TBC-internal)',
    sessionId: leg.id,
    solutionId: leg.tbc,
    sourceFile: 'committed-COHORT-table',
  }));

  // Same apriori for both nets (P041 fixed; free stations at P041+TBC vector).
  const apriori: Record<string, [number, number, number]> = {
    HANNA: [4348.976, -5305.799, -4876.455],
    FIVE: [5591.998, -5202.406, -4367.016],
  };
  const aprioriPlusSixtwo: Record<string, [number, number, number]> = {
    ...apriori,
    SIXTWO: [5822.646, -5654.885, -4846.085],
  };
  const stations = (withSixtwo: boolean): StationMap => {
    const s: StationMap = {
      P041: { x: BASE[0], y: BASE[1], h: BASE[2], fixed: true, fixedX: true, fixedY: true, fixedH: true },
    };
    for (const [name, v] of Object.entries(withSixtwo ? aprioriPlusSixtwo : apriori)) {
      s[name] = {
        x: BASE[0] + v[0],
        y: BASE[1] + v[1],
        h: BASE[2] + v[2],
        fixed: false,
        fixedX: false,
        fixedY: false,
        fixedH: false,
      };
    }
    return s;
  };

  const solve = (obs: GnssBaselineObservation[], withSixtwo: boolean) => {
    const r = runGnssBaselineAdjustment({ stations: stations(withSixtwo), baselines: obs });
    if (!r.converged) throw new Error('network did not converge');
    return r;
  };

  // Finding F1: native RTKLIB formals fail the existing fail-closed
  // statistics gate in a redundant net (Qvv loses PSD under ~1e6x overweight).
  // Finding F2: the 5-baseline net trips the same gate on the S32 leg even
  // with TBC covariances (lambda_min ~ -9e-20 ~= few ULPs of C entries ~1e-4
  // vs tau ~ 7e-28) — engine-numerics observation for stochastic-parity work.
  // No engine changes allowed here — record both, then solve the 4-nets with
  // TBC weights so the vector effect is isolated apples-to-apples.
  const probe5 = (cov: 'native' | 'tbc'): string | null => {
    const five = COHORT.map((leg, i) => {
      const a = obsA.find((o) => o.sessionId === leg.id);
      const b = obsB.find((o) => o.sessionId === leg.id);
      const src = cov === 'native' ? (a ?? b) : b;
      if (!src) throw new Error(`leg ${leg.id} missing`);
      return { ...src, id: i + 1 };
    });
    try {
      solve(five, true);
      return null;
    } catch (e: unknown) {
      return (e as Error).message;
    }
  };
  const findingF1_nativeFormal5Net = probe5('native');
  const findingF2_tbc5Net = probe5('tbc');
  const four = (obs: GnssBaselineObservation[]): GnssBaselineObservation[] =>
    obs.filter((o) => o.sessionId !== 'S32');
  const obsA_tbcW = four(obsA).map((o) => ({
    ...o,
    covariance: { ...four(obsB).find((b) => b.sessionId === o.sessionId)!.covariance },
  }));
  const rA = solve(obsA_tbcW, false);
  const rB = solve(four(obsB), false);

  const pick = (
    r: ReturnType<typeof solve>,
  ): Record<string, { x: number; y: number; h: number }> => {
    const out: Record<string, { x: number; y: number; h: number }> = {};
    for (const name of ['HANNA', 'FIVE']) {
      const st = r.stations[name];
      if (!st) throw new Error(`station ${name} missing`);
      out[name] = { x: st.x, y: st.y, h: st.h };
    }
    return out;
  };
  const cA = pick(rA);
  const cB = pick(rB);
  const coordDiffMm: Record<string, number> = {};
  for (const name of Object.keys(cA)) {
    const a = cA[name];
    const b = cB[name];
    if (!a || !b) continue;
    coordDiffMm[name] = Math.hypot(a.x - b.x, a.y - b.y, a.h - b.h) * 1000;
  }
  const resNorm = (r: ReturnType<typeof solve>): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const res of r.residuals) {
      out[`${res.from}->${res.to}#${res.baselineId}`] =
        Math.hypot(res.vX, res.vY, res.vZ) * 1000;
    }
    return out;
  };

  console.log(
    JSON.stringify(
      {
        verdict: 'PASS §40 (evidence only, no parity expectation)',
        findingF1_nativeFormal5Net,
        findingF2_tbc5NetFailsClosed: findingF2_tbc5Net,
        weightingNote: 'net A carries PROCESSED vectors under TBC weights (native RTKLIB formals fail closed, see findingF1), isolating the vector effect',
        networkA_processedVectorsTbcWeights: {
          coords: cA,
          residualNormMm: resNorm(rA),
          seuw: Math.sqrt(Math.max(rA.varianceFactor, 0)),
          varianceFactor: rA.varianceFactor,
          dof: rA.dof,
          iterations: rA.iterations,
        },
        networkB_tbcSubset: {
          coords: cB,
          residualNormMm: resNorm(rB),
          seuw: Math.sqrt(Math.max(rB.varianceFactor, 0)),
          varianceFactor: rB.varianceFactor,
          dof: rB.dof,
          iterations: rB.iterations,
        },
        coordDiffAminusB_mm: coordDiffMm,
      },
      null,
      2,
    ),
  );
}

const asMain = process.argv[1]?.endsWith('gnss12j1NetworkExperiment.ts') ?? false;
if (asMain) main();
