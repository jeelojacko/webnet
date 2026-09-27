/**
 * Phase 20C Wave-5B — grading-group performance harness helpers (measurement only).
 *
 * Synthetic target TINs, group geometry builders (open staircase / closed
 * notched ring / arc chain), a small PRNG, a V8 CPU-profiler stage
 * attribution helper, and formatting. No engine/worker/UI behavior lives
 * here; the perf script owns the matrix and reporting.
 */
import { performance } from 'node:perf_hooks';
import { Session } from 'node:inspector';

import type { ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';

export const TAU = Math.PI * 2;

/** Deterministic PRNG (mulberry32). */
export const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export interface Tin {
  points: number[];
  triangles: number[];
  triCount: number;
  vertCount: number;
}

export type ZFn = (_x: number, _y: number) => number;

/**
 * Deterministic grid TIN with ~`targetTris` triangles over the domain.
 * Vertices carry the 20B generic-position jitter (+0.37/+0.41 m) so straight
 * daylight loci do not graze TIN vertices (20B evidence § jitter).
 */
export const buildGridTin = (
  targetTris: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  zFn: ZFn,
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
  return { points, triangles, triCount: triangles.length / 3, vertCount: points.length / 3 };
};

export const sawtooth = (x: number, period: number): number =>
  Math.abs((((x / period) % 2) + 2) % 2 - 1);

export const straight = (
  sx: number, sy: number, ex: number, ey: number, sz = 6, ez = 6,
): ResolvedGradingSource => ({
  startX: sx, startY: sy, endX: ex, endY: ey, startZ: sz, endZ: ez,
  length: Math.hypot(ex - sx, ey - sy), reoriented: false, isArc: false,
});

const closeRing = (verts: Array<[number, number]>, z: number): ResolvedGradingSource[] =>
  verts.map((a, i) => {
    const b = verts[(i + 1) % verts.length]!;
    return straight(a[0], a[1], b[0], b[1], z, z);
  });

/**
 * Closed orthogonal "notched rectangle" pad: 4 + 4m courses (m notches on the
 * bottom edge). Notches give both convex (GAP) and concave (OVERLAP) corners.
 */
export const notchedRing = (n: number, z: number, depth: number, width = 400, height = 300): ResolvedGradingSource[] => {
  const teeth = Math.max(0, Math.round((n - 4) / 4));
  const verts: Array<[number, number]> = [[0, 0]];
  if (teeth === 0) {
    verts.push([width, 0], [width, height], [0, height]);
  } else {
    const pitch = width / teeth;
    for (let i = 0; i < teeth; i += 1) {
      const a = i * pitch + pitch * 0.25;
      const b = i * pitch + pitch * 0.65;
      verts.push([a, 0], [a, -depth], [b, -depth], [b, 0]);
    }
    verts.push([width, 0], [width, height], [0, height]);
  }
  const clean: Array<[number, number]> = [];
  for (const v of verts) {
    const p = clean[clean.length - 1];
    if (!p || p[0] !== v[0] || p[1] !== v[1]) clean.push(v);
  }
  const first = clean[0]!;
  const last = clean[clean.length - 1]!;
  if (clean.length > 1 && first[0] === last[0] && first[1] === last[1]) clean.pop();
  return closeRing(clean, z);
};

/** Open axis-aligned staircase (40 m step), alternating GAP/OVERLAP corners. */
export const staircase = (n: number, z: number, step = 40): ResolvedGradingSource[] => {
  const out: ResolvedGradingSource[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < n; i += 1) {
    const horiz = i % 2 === 0;
    const nx = horiz ? x + step : x;
    const ny = horiz ? y : y + step;
    out.push(straight(x, y, nx, ny, z, z));
    x = nx;
    y = ny;
  }
  return out;
};

/** Circular-arc course through a,b bulging to the left (>0) by `bulge` m. */
export const arcMember = (
  a: [number, number], b: [number, number], bulge: number, z0: number, z1: number,
): ResolvedGradingSource => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const chord = Math.hypot(dx, dy);
  const s = Math.abs(bulge);
  const radius = ((chord / 2) ** 2 + s * s) / (2 * s);
  const px = -dy / chord;
  const py = dx / chord;
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const sign = Math.sign(bulge);
  const centerX = mx - px * sign * (radius - s);
  const centerY = my - py * sign * (radius - s);
  const startAngle = Math.atan2(a[1] - centerY, a[0] - centerX);
  const endAngle = Math.atan2(b[1] - centerY, b[0] - centerX);
  const ccwSweep = (((endAngle - startAngle) % TAU) + TAU) % TAU;
  const apexAngle = Math.atan2(my + py * sign * s - centerY, mx + px * sign * s - centerX);
  const apexDelta = (((apexAngle - startAngle) % TAU) + TAU) % TAU;
  const sweepCCW = apexDelta < ccwSweep;
  const sweep = sweepCCW ? ccwSweep : ((((startAngle - endAngle) % TAU) + TAU) % TAU);
  return {
    startX: a[0], startY: a[1], endX: b[0], endY: b[1], startZ: z0, endZ: z1,
    length: radius * sweep, reoriented: false, isArc: true,
    arc: { centerX, centerY, radius, startAngle, endAngle, sweepCCW },
  };
};

/** Open chain of alternating-bulge arc courses (kinked joints, arc member each). */
export const arcChain = (n: number, z: number, bulge = 6, seg = 50): ResolvedGradingSource[] => {
  const out: ResolvedGradingSource[] = [];
  for (let i = 0; i < n; i += 1) {
    const a: [number, number] = [i * seg, 0];
    const b: [number, number] = [(i + 1) * seg, 0];
    out.push(arcMember(a, b, i % 2 === 0 ? bulge : -bulge, z, z));
  }
  return out;
};

export const membersBbox = (
  members: ResolvedGradingSource[],
): { minX: number; minY: number; maxX: number; maxY: number } => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const m of members) {
    minX = Math.min(minX, m.startX, m.endX);
    minY = Math.min(minY, m.startY, m.endY);
    maxX = Math.max(maxX, m.startX, m.endX);
    maxY = Math.max(maxY, m.startY, m.endY);
  }
  return { minX, minY, maxX, maxY };
};

// ---------------------------------------------------------------------------
// Stage attribution (V8 sampling profiler — read-only observation)
// ---------------------------------------------------------------------------

export type StageKey =
  | 'targetIndexBuild'
  | 'gridBuild'
  | 'memberSolve'
  | 'cornerClassifyMiter'
  | 'miterTieSolve'
  | 'cornerLocusGraph'
  | 'memberClipping'
  | 'meshMerge'
  | 'validation'
  | 'arcLinearize'
  | 'engineGlue'
  | 'other';

const baseName = (url: string): string => url.split('/').pop() ?? '';

/** Bucket a profiler frame into a pipeline stage (by module + function). */
export const stageForFrame = (url: string, fn: string): StageKey => {
  const base = baseName(url);
  if (base === 'gradingGroupMerge.ts') {
    if (fn === 'mergeGroupTriangles') return 'meshMerge';
    if (fn === 'validateGroupMesh') return 'validation';
    if (fn === 'clipTriangleToHalfPlane' || fn === 'clipPolylineToHalfPlane') return 'memberClipping';
    return 'engineGlue';
  }
  if (base === 'gradingGroupSectors.ts') {
    if (fn === 'solveMiterTie') return 'miterTieSolve';
    if (fn === 'solveSectorPath' || fn === 'clipPolygonToBounds') return 'cornerLocusGraph';
    return 'engineGlue';
  }
  if (base === 'gradingCornerMath.ts') return 'cornerClassifyMiter';
  if (base === 'solveStraightChord.ts' || base === 'gradingCourseFrame.ts' || base === 'gradingStraightSolve.ts') return 'memberSolve';
  if (base === 'gradingTargetIndex.ts') return 'targetIndexBuild';
  if (base === 'cadSurfaceInterpolation.ts') return 'gridBuild';
  if (base === 'arcSolve.ts' || base === 'gradingCurve.ts') return 'arcLinearize';
  if (base === 'gradingGroupCompute.ts') return 'engineGlue';
  return 'other';
};

export interface ProfileResult {
  stages: Partial<Record<StageKey, number>>;
  totalMs: number;
  samples: number;
}

interface InspectorProfile {
  nodes: Array<{ hitCount?: number; callFrame: { functionName: string; url: string } }>;
}

/** Profile one synchronous run and return self-time per stage (ms). */
export const profileRun = async (
  fn: () => void,
  intervalUs = 50,
): Promise<ProfileResult> => {
  const session = new Session();
  session.connect();
  const post = (method: string, params?: object): Promise<unknown> =>
    new Promise((resolve, reject) => {
      session.post(method, params ?? {}, (error, result) => (error ? reject(error) : resolve(result)));
    });
  await post('Profiler.enable');
  await post('Profiler.setSamplingInterval', { interval: intervalUs });
  await post('Profiler.start');
  const start = performance.now();
  fn();
  const totalMs = performance.now() - start;
  const stopped = (await post('Profiler.stop')) as { profile: InspectorProfile };
  session.disconnect();
  const stages: Partial<Record<StageKey, number>> = {};
  let samples = 0;
  for (const node of stopped.profile.nodes) {
    const hits = node.hitCount ?? 0;
    if (hits === 0) continue;
    samples += hits;
    const key = stageForFrame(node.callFrame.url, node.callFrame.functionName);
    stages[key] = (stages[key] ?? 0) + (hits * intervalUs) / 1000;
  }
  return { stages, totalMs, samples };
};

// ---------------------------------------------------------------------------
// Formatting / stats
// ---------------------------------------------------------------------------

export const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

export const fmt = (value: number): string =>
  value >= 1000 ? value.toFixed(0) : value >= 100 ? value.toFixed(1) : value.toFixed(2);

export const exponent = (from: number, to: number, fromScale: number, toScale: number): string => {
  if (!(from > 0) || !(to > 0) || !(fromScale > 0) || !(toScale > 0)) return 'n/a';
  return (Math.log(to / from) / Math.log(toScale / fromScale)).toFixed(2);
};

export const heapMB = (): number => process.memoryUsage().heapUsed / (1024 * 1024);

/**
 * Proxy an array counting reads of its `length` property, which every
 * full-snapshot scan in `gradingTargetIndex.ts` performs (the index/target
 * builders read `points.length` at least once per grid construction). Used
 * to count how many grid builds a single group run triggers WITHOUT
 * touching production code.
 */
export const countingPoints = (points: number[]): { points: number[]; reads: () => number } => {
  let reads = 0;
  const proxy = new Proxy(points, {
    get(target, prop, receiver) {
      if (prop === 'length') reads += 1;
      return Reflect.get(target, prop, receiver);
    },
  });
  return { points: proxy as number[], reads: () => reads };
};
