/**
 * Phase 20B — grade-to-surface performance probe (measurement only).
 *
 * Runs the authoritative worker compute (`computeGradingFromSnapshots`, the
 * same function the surface worker handler and in-process fallback execute)
 * on synthetic deterministic grid TINs at 1k / 10k / 50k / 100k triangles
 * across seven target/source cases:
 *
 *   A flat plane            B sloping plane
 *   C many TIN plane breaks D rolling / multiple-root
 *   E void / no-solution    F cut/fill transition
 *   G curved source, coarse vs fine chord tolerance (single-chord solve)
 *
 * Per case/scale the script reports: total wall ms, standalone index-prep
 * ms (`buildSurfaceGrid`, which the engine builds twice per calculation —
 * once for the query adapter, once for candidate selection), standalone
 * agreement-gate ms (`validateGradingResultAgainstTarget`), the solve-core
 * remainder, candidate/segment/daylight/mesh sizes, and heap delta.
 * A replay probe (case A @10k) separately times candidate selection and the
 * local-frame transform over the real grid/candidates. Determinism (shuffled
 * triangle order), large-coordinate equivalence (E~=2M/N~=7M), and the
 * §41/§91 curve-convergence probe (coarse/medium/fine chord tolerance on a
 * quarter-circle source) run as fail-closed gates; timing verdicts are
 * advisory and never gate.
 *
 * No src/ behavior changes, no tier wiring.
 *
 * Usage: `npx tsx scripts/phase20bGradingPerf.ts [--quick]`
 *   --quick trims scales to 1k / 10k and reduces reps (smoke check).
 */
import { performance } from 'node:perf_hooks';

import {
  buildSurfaceGrid,
  getSurfaceElevationAt,
} from '../src/engine/cad/cadSurfaceInterpolation';
import type {
  CadSurfaceBuildResult,
  CadSurfaceSourcePoint,
} from '../src/engine/cad/cadSurfaces';
import {
  fromLocalFrame,
  gradingSideNormal,
  toLocalFrame,
} from '../src/engine/cad/grading/gradingCourseFrame';
import { linearizeGradingArc } from '../src/engine/cad/grading/gradingCurve';
import type {
  CadGradingResult,
  GradingCriterion,
  GradingSide,
  ResolvedGradingSource,
} from '../src/engine/cad/grading/gradingTypes';
import {
  computeGradingFromSnapshots,
  validateGradingResultAgainstTarget,
  type GradingTargetMeshSnapshot,
} from '../src/workers/surfaceGradingCompute';

const QUICK = process.argv.includes('--quick');
const SCALES = QUICK ? [1000, 10000] : [1000, 10000, 50000, 100000];
const RUNS = QUICK ? 2 : 3;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const timeMedian = (runs: number, fn: () => void): number => {
  const samples: number[] = [];
  for (let run = 0; run < runs + 1; run += 1) {
    const start = performance.now();
    fn();
    const elapsed = performance.now() - start;
    if (run > 0) samples.push(elapsed);
  }
  return median(samples);
};

/** Deterministic PRNG (mulberry32, fixed seed). */
const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// ---------------------------------------------------------------------------
// Synthetic TIN targets
// ---------------------------------------------------------------------------

interface Tin {
  points: number[];
  triangles: number[];
  triCount: number;
  vertCount: number;
}

/**
 * Deterministic grid TIN with ~`targetTris` CCW triangles over the domain.
 *
 * Vertices carry a fixed generic-position jitter (+0.37/+0.41 m): an exact
 * axis-aligned grid lets a straight daylight locus graze TIN vertices, which
 * the fail-closed envelope rejects as BRANCH_DISCONTINUITY (measured: 31x18
 * sloping-plane grid fails at dy=0, ties cleanly at dy=0.37 — one merged
 * segment, identical tie distances). The jitter keeps every case off that
 * measure-zero alignment; the artifact itself is recorded in the evidence doc.
 */
const buildGridTin = (
  targetTris: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  zFn: (_x: number, _y: number) => number,
): Tin => {
  const aspect = (x1 - x0) / (y1 - y0);
  const quads = Math.max(1, Math.round(targetTris / 2));
  const nx = Math.max(2, Math.ceil(Math.sqrt(quads * aspect)) + 1);
  const ny = Math.max(2, Math.ceil(quads / (nx - 1)) + 1);
  const points: number[] = [];
  for (let row = 0; row < ny; row += 1) {
    for (let col = 0; col < nx; col += 1) {
      const x = x0 + ((x1 - x0) * col) / (nx - 1) + 0.37;
      const y = y0 + ((y1 - y0) * row) / (ny - 1) + 0.41;
      points.push(x, y, zFn(x, y));
    }
  }
  const triangles: number[] = [];
  for (let row = 0; row + 1 < ny; row += 1) {
    for (let col = 0; col + 1 < nx; col += 1) {
      const a = row * nx + col;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      triangles.push(a, b, d, a, d, c);
    }
  }
  return {
    points,
    triangles,
    triCount: triangles.length / 3,
    vertCount: points.length / 3,
  };
};

const sawtooth = (x: number, period: number): number =>
  Math.abs((((x / period) % 2) + 2) % 2 - 1);

const straightSource = (
  overrides: Partial<ResolvedGradingSource> = {},
): ResolvedGradingSource => ({
  startX: 0,
  startY: 0,
  endX: 100,
  endY: 0,
  startZ: 10,
  endZ: 10,
  length: 100,
  reoriented: false,
  isArc: false,
  ...overrides,
});

interface CaseDef {
  id: string;
  label: string;
  domain: [number, number, number, number];
  z: (_x: number, _y: number) => number;
  source: ResolvedGradingSource;
  side: GradingSide;
  criterion: GradingCriterion;
  maxSearch: number;
  tolerance: number;
  expectOk: boolean;
}

const FILL: GradingCriterion = { kind: 'fixed', gradeRatio: -0.5 };

const CASES: CaseDef[] = [
  {
    id: 'A', label: 'flat plane', domain: [-20, 120, -30, 50],
    z: () => 0, source: straightSource(), side: 'left',
    criterion: FILL, maxSearch: 30, tolerance: 0.01, expectOk: true,
  },
  {
    id: 'B', label: 'sloping plane', domain: [-20, 120, -30, 50],
    z: (x) => 0.05 * x - 5, source: straightSource(), side: 'left',
    criterion: FILL, maxSearch: 40, tolerance: 0.01, expectOk: true,
  },
  {
    id: 'C', label: 'plane breaks', domain: [-20, 120, -30, 50],
    z: (x) => -5 + 0.05 * x + 2 * sawtooth(x, 10),
    source: straightSource(), side: 'left',
    criterion: FILL, maxSearch: 40, tolerance: 0.01, expectOk: true,
  },
  {
    id: 'D', label: 'rolling/multi-root', domain: [-20, 120, -30, 50],
    z: (x, y) => 3 * Math.sin(y * 0.35) + 0.02 * x - 2,
    source: straightSource(), side: 'left',
    criterion: FILL, maxSearch: 40, tolerance: 0.01, expectOk: true,
  },
  {
    id: 'E', label: 'void/no-solution', domain: [500, 640, 500, 600],
    z: () => 0, source: straightSource(), side: 'left',
    criterion: FILL, maxSearch: 30, tolerance: 0.01, expectOk: false,
  },
  {
    id: 'F', label: 'cut/fill transition', domain: [-20, 120, -30, 50],
    z: (x) => 12 - 0.04 * x, source: straightSource(), side: 'left',
    criterion: { kind: 'cut-fill', cutGradeRatio: 0.5, fillGradeRatio: -0.5 },
    maxSearch: 30, tolerance: 0.01, expectOk: true,
  },
];

const chordLength = Math.hypot(50, 50);
const ARC_SOURCE: ResolvedGradingSource = {
  startX: 50, startY: 0, endX: 0, endY: 50,
  startZ: 10, endZ: 10, length: chordLength,
  reoriented: false, isArc: true,
};

const caseG = (tolerance: number): CaseDef => ({
  id: `G@${tolerance}`, label: `curved chord tol=${tolerance}`,
  domain: [-30, 80, -30, 80], z: () => 0,
  source: ARC_SOURCE, side: 'left',
  criterion: FILL, maxSearch: 30, tolerance, expectOk: true,
});

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

interface Row {
  scale: number;
  caseId: string;
  outcome: string;
  warmCode: string;
  warmDetail: string;
  asExpected: boolean;
  total: number;
  indexPrep: number;
  validate: number;
  candidates: number;
  segments: number;
  multi: number;
  daylight: number;
  meshTri: number;
  planArea: number;
  memKB: number;
}

const snapshotOf = (tin: Tin): GradingTargetMeshSnapshot => ({
  points: tin.points,
  triangles: tin.triangles,
});

/** Standalone agreement-gate query over the raw TIN (same shape as the worker). */
const targetQueryAt = (tin: Tin): ((_x: number, _y: number) => number | null) => {
  const points: CadSurfaceSourcePoint[] = [];
  for (let i = 0; i + 2 < tin.points.length; i += 3) {
    points.push({
      entityId: `perf-target:${i / 3}`,
      x: tin.points[i]!,
      y: tin.points[i + 1]!,
      z: tin.points[i + 2]!,
    });
  }
  const triangles: Array<[number, number, number]> = [];
  for (let i = 0; i + 2 < tin.triangles.length; i += 3) {
    triangles.push([tin.triangles[i]!, tin.triangles[i + 1]!, tin.triangles[i + 2]!]);
  }
  const grid = buildSurfaceGrid(points, triangles);
  const build = { outcome: 'ok', points, triangles, grid } as unknown as CadSurfaceBuildResult;
  return (x, y) => getSurfaceElevationAt(build, x, y);
};

const measureCase = (def: CaseDef, tin: Tin): Row => {
  const target = snapshotOf(tin);
  const request = {
    gradingId: 'g-perf',
    revision: 'grev1:perf',
    source: def.source,
    side: def.side,
    criterion: def.criterion,
    maxSearchDistance: def.maxSearch,
    curveChordTolerance: def.tolerance,
    target,
  };
  // Warmup (JIT + grid shape), then timed medians. Unexpected outcomes are
  // RECORDED (fail-closed evidence with timing), never thrown: dense TINs
  // with interior daylight nodes systematically trip the engine's own
  // agreement gate (see evidence doc § snap-vs-floor), which is a finding,
  // not a harness error.
  const warm = computeGradingFromSnapshots(request);
  const warmCode = warm.ok ? `ok:${warm.result.accuracy}` : warm.code;
  const warmDetail = warm.ok ? '' : (warm.detail ?? '');
  const expectedCode = def.expectOk ? 'ok' : 'fail';
  const asExpected = def.expectOk === warm.ok;
  void expectedCode;
  let last: typeof warm | null = null;
  const totals: number[] = [];
  const mems: number[] = [];
  for (let run = 0; run < RUNS + 1; run += 1) {
    const memBefore = process.memoryUsage().heapUsed;
    const start = performance.now();
    const outcome = computeGradingFromSnapshots(request);
    const elapsed = performance.now() - start;
    const memAfter = process.memoryUsage().heapUsed;
    last = outcome;
    if (run > 0) {
      totals.push(elapsed);
      mems.push((memAfter - memBefore) / 1024);
    }
  }
  const total = median(totals);
  const memKB = median(mems);

  // Standalone index-prep timing (the engine builds this grid twice per call).
  const pts: CadSurfaceSourcePoint[] = [];
  for (let i = 0; i + 2 < tin.points.length; i += 3) {
    pts.push({
      entityId: `perf-idx:${i / 3}`,
      x: tin.points[i]!,
      y: tin.points[i + 1]!,
      z: tin.points[i + 2]!,
    });
  }
  const tris: Array<[number, number, number]> = [];
  for (let i = 0; i + 2 < tin.triangles.length; i += 3) {
    tris.push([tin.triangles[i]!, tin.triangles[i + 1]!, tin.triangles[i + 2]!]);
  }
  const indexPrep = timeMedian(RUNS, () => {
    buildSurfaceGrid(pts, tris);
  });

  // Standalone agreement-gate timing on the successful result.
  let validate = 0;
  let candidates = 0;
  let segments = 0;
  let multi = 0;
  let daylight = 0;
  let meshTri = 0;
  let planArea = 0;
  let outcome = 'FAIL';
  const result: CadGradingResult | null = last != null && last.ok ? last.result : null;
  if (result) {
    outcome = result.accuracy;
    candidates = result.candidateTriangleCount;
    segments = result.intersectionSegmentCount;
    multi = result.multipleSolutionCount;
    daylight = result.daylightPoints.length / 3;
    meshTri = result.gradingMesh.triangles.length / 3;
    // Recompute plan area cheaply for the size column (engine value is authoritative).
    planArea = result.gradingPlanArea;
    const at = targetQueryAt(tin);
    const dx = def.source.endX - def.source.startX;
    const dy = def.source.endY - def.source.startY;
    const len = Math.hypot(dx, dy);
    const tx = dx / len;
    const ty = dy / len;
    const gs = (def.source.endZ - def.source.startZ) / def.source.length;
    const first = { x: def.source.startX, y: def.source.startY, z: def.source.startZ };
    const lastPt = {
      x: def.source.startX + tx * def.source.length,
      y: def.source.startY + ty * def.source.length,
      z: def.source.startZ + gs * def.source.length,
    };
    validate = timeMedian(RUNS, () => {
      const reject = validateGradingResultAgainstTarget(
        result.daylightPoints,
        { elevationAt: at },
        { first, last: lastPt, expectedFirst: first, expectedLast: lastPt },
      );
      if (reject !== null) throw new Error(`agreement gate rejected: ${reject}`);
    });
  } else if (last != null && !last.ok) {
    outcome = last.code;
  }
  return {
    scale: tin.triCount, caseId: def.id, outcome, warmCode, warmDetail, asExpected, total, indexPrep, validate,
    candidates, segments, multi, daylight, meshTri, planArea, memKB,
  };
};

const fmt = (value: number): string => value.toFixed(value < 10 ? 2 : value < 100 ? 1 : 0);

const exponent = (from: number, to: number, fromScale: number, toScale: number): string => {
  if (!(from > 0) || !(to > 0)) return 'n/a';
  return ((Math.log(to / from) / Math.log(toScale / fromScale)) as number).toFixed(2);
};

// ---------------------------------------------------------------------------
// Fail-closed probes
// ---------------------------------------------------------------------------

/** Determinism: shuffled triangle order must give identical geometry + mesh. */
const determinismProbe = (tin: Tin): void => {
  const def = CASES[0]!;
  const base = computeGradingFromSnapshots({
    gradingId: 'g-det', revision: 'grev1:det',
    source: def.source, side: def.side, criterion: def.criterion,
    maxSearchDistance: def.maxSearch, curveChordTolerance: def.tolerance,
    target: snapshotOf(tin),
  });
  if (!base.ok) throw new Error('determinism baseline failed');
  // Shuffle whole-triangle order (grid-bucket insertion order rides along).
  const rand = mulberry32(0x20b);
  const order: number[] = Array.from({ length: tin.triCount }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const reordered: number[] = [];
  for (const tri of order) {
    reordered.push(
      tin.triangles[tri * 3]!, tin.triangles[tri * 3 + 1]!, tin.triangles[tri * 3 + 2]!,
    );
  }
  // Remap vertex indices so geometry is unchanged but storage order differs:
  // reverse the vertex array and rewrite indices (exercises index-order freedom).
  const remapped = reordered.map((vi) => tin.vertCount - 1 - vi);
  const flippedPoints: number[] = [];
  for (let i = tin.vertCount - 1; i >= 0; i -= 1) {
    flippedPoints.push(tin.points[i * 3]!, tin.points[i * 3 + 1]!, tin.points[i * 3 + 2]!);
  }
  const again = computeGradingFromSnapshots({
    gradingId: 'g-det', revision: 'grev1:det',
    source: def.source, side: def.side, criterion: def.criterion,
    maxSearchDistance: def.maxSearch, curveChordTolerance: def.tolerance,
    target: { points: flippedPoints, triangles: remapped },
  });
  if (!again.ok) throw new Error('determinism reshuffled run failed');
  const same =
    JSON.stringify(again.result.daylightPoints) === JSON.stringify(base.result.daylightPoints) &&
    JSON.stringify(again.result.gradingMesh) === JSON.stringify(base.result.gradingMesh);
  console.log(`determinism (case A @${tin.triCount} tris, shuffled+remapped): ${same ? 'IDENTICAL' : 'MISMATCH'}`);
  if (!same) throw new Error('determinism probe failed: shuffled order changed geometry');
};

/** Large coordinates: E+=2M/N+=7M must match the local run through the (u,d) frame. */
const largeCoordinateProbe = (tin: Tin): void => {
  const def = CASES[0]!;
  const OX = 2000000;
  const OY = 7000000;
  const shiftedPoints: number[] = [];
  for (let i = 0; i + 2 < tin.points.length; i += 3) {
    shiftedPoints.push(tin.points[i]! + OX, tin.points[i + 1]! + OY, tin.points[i + 2]!);
  }
  const shiftedSource: ResolvedGradingSource = {
    ...def.source,
    startX: def.source.startX + OX,
    startY: def.source.startY + OY,
    endX: def.source.endX + OX,
    endY: def.source.endY + OY,
  };
  const run = (
    source: ResolvedGradingSource,
    points: number[],
  ): CadGradingResult => {
    const outcome = computeGradingFromSnapshots({
      gradingId: 'g-lc', revision: 'grev1:lc',
      source, side: def.side, criterion: def.criterion,
      maxSearchDistance: def.maxSearch, curveChordTolerance: def.tolerance,
      target: { points, triangles: tin.triangles },
    });
    if (!outcome.ok) throw new Error(`large-coordinate run failed: ${outcome.ok ? 'ok' : outcome.code}`);
    return outcome.result;
  };
  const base = run(def.source, tin.points);
  const shifted = run(shiftedSource, shiftedPoints);
  let maxDiff = 0;
  for (let i = 0; i < shifted.daylightPoints.length; i += 3) {
    maxDiff = Math.max(
      maxDiff,
      Math.abs(shifted.daylightPoints[i]! - OX - base.daylightPoints[i]!),
      Math.abs(shifted.daylightPoints[i + 1]! - OY - base.daylightPoints[i + 1]!),
      Math.abs(shifted.daylightPoints[i + 2]! - base.daylightPoints[i + 2]!),
    );
  }
  const distDiff = Math.max(
    Math.abs(shifted.minProjectionDistance - base.minProjectionDistance),
    Math.abs(shifted.maxProjectionDistance - base.maxProjectionDistance),
    Math.abs(shifted.meanProjectionDistance - base.meanProjectionDistance),
  );
  console.log(`large-coordinate (case A @${tin.triCount} tris, +2M/+7M): max daylight diff ${maxDiff.toExponential(2)} m, tie-distance diff ${distDiff.toExponential(2)} m`);
  if (!(maxDiff <= 1e-6) || !(distDiff <= 1e-9)) {
    throw new Error('large-coordinate probe failed');
  }
};

/** §41/§91 curve convergence: sagitta within tolerance, monotone growth, daylight convergence. */
const convergenceProbe = (): void => {
  const R = 50;
  const tolerances = [0.5, 0.05, 0.005];
  // Flat 10k target covering the arc plus the outward tie (d=20, radius <= 70).
  const tin = buildGridTin(10000, -40, 90, -40, 90, () => 0);
  const target = snapshotOf(tin);
  interface Leg { tolerance: number; subdivisions: number; sagitta: number; length: number; end: [number, number, number] }
  const legs: Leg[] = [];
  for (const tolerance of tolerances) {
    const lin = linearizeGradingArc(0, 0, R, 0, Math.PI / 2, true, 10, 10, tolerance);
    if (!lin) throw new Error(`arc linearization failed at tol=${tolerance}`);
    if (!(lin.maxSagitta <= tolerance)) {
      throw new Error(`sagitta ${lin.maxSagitta} exceeds tolerance ${tolerance}`);
    }
    // Grade every chord through the exact straight solver (side right = outward).
    const daylight: number[] = [];
    for (let i = 0; i + 1 < lin.points.length; i += 1) {
      const a = lin.points[i]!;
      const b = lin.points[i + 1]!;
      const chordLen = Math.hypot(b.x - a.x, b.y - a.y);
      const outcome = computeGradingFromSnapshots({
        gradingId: 'g-conv', revision: `grev1:conv${tolerance}`,
        source: {
          startX: a.x, startY: a.y, endX: b.x, endY: b.y,
          startZ: a.z, endZ: b.z, length: chordLen,
          reoriented: false, isArc: false,
        },
        side: 'right', criterion: FILL,
        maxSearchDistance: 40, curveChordTolerance: tolerance, target,
      });
      if (!outcome.ok) throw new Error(`convergence chord failed at tol=${tolerance}`);
      const pts = outcome.result.daylightPoints;
      for (let k = 0; k + 2 < pts.length; k += 3) {
        if (daylight.length > 0 && k === 0) continue; // drop joint duplicate
        daylight.push(pts[k]!, pts[k + 1]!, pts[k + 2]!);
      }
    }
    let length = 0;
    for (let i = 3; i < daylight.length; i += 3) {
      length += Math.hypot(
        daylight[i]! - daylight[i - 3]!,
        daylight[i + 1]! - daylight[i - 2]!,
        daylight[i + 2]! - daylight[i - 1]!,
      );
    }
    legs.push({
      tolerance,
      subdivisions: lin.subdivisions,
      sagitta: lin.maxSagitta,
      length,
      end: [
        daylight[daylight.length - 3]!,
        daylight[daylight.length - 2]!,
        daylight[daylight.length - 1]!,
      ],
    });
  }
  const [coarse, medium, fine] = legs as [Leg, Leg, Leg];
  if (!(medium.subdivisions > coarse.subdivisions && fine.subdivisions > medium.subdivisions)) {
    throw new Error('subdivision growth is not monotone');
  }
  const err = (leg: Leg): number =>
    Math.abs(leg.length - fine.length) +
    Math.hypot(leg.end[0] - fine.end[0], leg.end[1] - fine.end[1], leg.end[2] - fine.end[2]);
  const errCoarse = err(coarse);
  const errMedium = err(medium);
  console.log('\ncurve convergence (quarter-circle R=50, flat target, per-chord exact solve):');
  console.log('| tolerance | subdivisions | sagitta m | daylight len m | vs-fine err m |');
  console.log('|---:|---:|---:|---:|---:|');
  for (const leg of legs) {
    console.log(`| ${leg.tolerance} | ${leg.subdivisions} | ${leg.sagitta.toFixed(4)} | ${leg.length.toFixed(3)} | ${err(leg).toFixed(4)} |`);
  }
  console.log(`convergence monotone (medium ${errMedium.toFixed(4)} <= coarse ${errCoarse.toFixed(4)}): ${errMedium <= errCoarse + 1e-9 ? 'YES' : 'NO'}`);
  if (!(errMedium <= errCoarse + 1e-9)) throw new Error('daylight did not converge monotonically');
};

/** Replay probe: candidate selection + local transform over the real grid. */
const replayProbe = (tin: Tin): void => {
  const def = CASES[0]!;
  const normal = gradingSideNormal(1, 0, def.side);
  if (!normal) throw new Error('side normal failed');
  const pts: CadSurfaceSourcePoint[] = [];
  for (let i = 0; i + 2 < tin.points.length; i += 3) {
    pts.push({
      entityId: `perf-rp:${i / 3}`,
      x: tin.points[i]!,
      y: tin.points[i + 1]!,
      z: tin.points[i + 2]!,
    });
  }
  const tris: Array<[number, number, number]> = [];
  for (let i = 0; i + 2 < tin.triangles.length; i += 3) {
    tris.push([tin.triangles[i]!, tin.triangles[i + 1]!, tin.triangles[i + 2]!]);
  }
  const grid = buildSurfaceGrid(pts, tris);
  const corners = [
    { u: 0, d: 0 }, { u: def.source.length, d: 0 },
    { u: 0, d: def.maxSearch }, { u: def.source.length, d: def.maxSearch },
  ].map(({ u, d }) => fromLocalFrame(u, d, def.source, normal)!);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of corners) {
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x);
    maxY = Math.max(maxY, c.y);
  }
  let found = new Set<number>();
  const candidateMs = timeMedian(RUNS, () => {
    const next = new Set<number>();
    const { minX: gx, minY: gy, cellSize, cells } = grid;
    const x0 = Math.floor((minX - gx) / cellSize);
    const x1 = Math.floor((maxX - gx) / cellSize);
    const y0 = Math.floor((minY - gy) / cellSize);
    const y1 = Math.floor((maxY - gy) / cellSize);
    for (let ix = x0; ix <= x1; ix += 1) {
      for (let iy = y0; iy <= y1; iy += 1) {
        const list = cells.get(`${ix},${iy}`);
        if (list) for (const index of list) next.add(index);
      }
    }
    found = next;
  });
  const candidateList = [...found];
  const transformMs = timeMedian(RUNS, () => {
    for (const index of candidateList) {
      for (let k = 0; k < 3; k += 1) {
        const vi = tin.triangles[index * 3 + k]!;
        toLocalFrame(tin.points[vi * 3]!, tin.points[vi * 3 + 1]!, def.source, normal);
      }
    }
  });
  console.log(`\nreplay probe (case A @${tin.triCount} tris): candidate select ${fmt(candidateMs)} ms (${candidateList.length} tris) · local transform ${fmt(transformMs)} ms (${candidateList.length * 3} verts)`);
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = (): void => {
  const harnessStart = performance.now();
  const defs: CaseDef[] = [...CASES, caseG(0.5), caseG(0.01)];
  const rows: Row[] = [];
  for (const scale of SCALES) {
    for (const def of defs) {
      const [x0, x1, y0, y1] = def.domain;
      const tin = buildGridTin(scale, x0, x1, y0, y1, def.z);
      rows.push(measureCase(def, tin));
    }
  }

  console.log('\nPhase 20B grading perf (median ms; synthetic grid TINs; one 100 m course, fixed -0.5 unless noted)\n');
  console.log('| tris | case | outcome | asExp | total | idxPrep | valid | cand | segs/multi | daylight | meshTri | planArea | memKB |');
  console.log('|---:|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const row of rows) {
    console.log(
      `| ${row.scale.toLocaleString('en-US')} | ${row.caseId} | ${row.outcome} | ${row.asExpected ? 'yes' : 'NO'} | ${fmt(row.total)} | ${fmt(row.indexPrep)} | ${fmt(row.validate)} | ${row.candidates.toLocaleString('en-US')} | ${row.segments}/${row.multi} | ${row.daylight} | ${row.meshTri} | ${row.planArea.toFixed(0)} | ${row.memKB.toFixed(0)} |`,
    );
  }
  for (const row of rows) {
    if (!row.asExpected) console.log(`  note: case ${row.caseId} @${row.scale} tris: warm=${row.warmCode}${row.warmDetail ? ` detail=${row.warmDetail}` : ''} (fail-closed evidence, see doc)`);
  }

  console.log('\nTotal-time scaling exponents vs previous scale (1.00 = linear):');
  const caseIds = [...new Set(rows.map((row) => row.caseId))];
  for (let s = 1; s < SCALES.length; s += 1) {
    const parts: string[] = [];
    for (const caseId of caseIds) {
      const prev = rows.find((row) => row.scale >= SCALES[s - 1]! && row.scale < SCALES[s]! && row.caseId === caseId);
      const curr = rows.find((row) => row.scale >= SCALES[s]! && (s + 1 >= SCALES.length || row.scale < SCALES[s + 1]!) && row.caseId === caseId);
      if (prev && curr) parts.push(`${caseId} ${exponent(prev.total, curr.total, prev.scale, curr.scale)}`);
    }
    console.log(`  ${SCALES[s - 1]!.toLocaleString('en-US')} -> ${SCALES[s]!.toLocaleString('en-US')}: ${parts.join(' · ')}`);
  }

  // G coarse-vs-fine identity (single-chord solve is tolerance-invariant).
  const gCoarse = rows.find((row) => row.caseId === 'G@0.5');
  const gFine = rows.find((row) => row.caseId === 'G@0.01');
  if (gCoarse && gFine) {
    console.log(`\nG tolerance identity @${gCoarse.scale} tris: coarse total ${fmt(gCoarse.total)} ms vs fine ${fmt(gFine.total)} ms; candidates ${gCoarse.candidates}/${gFine.candidates}, daylight ${gCoarse.daylight}/${gFine.daylight} (subdivision effect: see convergence probe).`);
  }

  // Fail-closed probes on fixed mid-scale TINs (cheap, deterministic).
  const probeTinA = buildGridTin(10000, -20, 120, -30, 50, () => 0);
  determinismProbe(probeTinA);
  largeCoordinateProbe(probeTinA);
  replayProbe(probeTinA);
  convergenceProbe();

  console.log(`\ntotal harness runtime ${((performance.now() - harnessStart) / 1000).toFixed(1)} s`);
  console.log('');
};

main();
