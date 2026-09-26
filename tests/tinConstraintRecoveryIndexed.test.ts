import { describe, expect, it } from 'vitest';
import { buildTinBase } from '../src/engine/cad/tin/tinBase';
import { recoverConstrainedEdges } from '../src/engine/cad/tin/tinConstraintRecovery';
import { recoverConstrainedEdgesIndexed } from '../src/engine/cad/tin/tinConstraintRecoveryIndexed';
import type { TinPoint, TinSegment, TinTriangle } from '../src/engine/cad/tin/tinTypes';

/**
 * Parity harness: the indexed prototype must reproduce the linear
 * `recoverConstrainedEdges` exactly — success/failure, Steiner requests
 * (count + positions + originating segment), final topology (canonical
 * digest), and constraint presence.
 */

interface Corpus {
  name: string;
  points: Array<{ x: number; y: number; z: number }>;
  segments: TinSegment[];
  /** Applied to base local-frame points after build (predicate stress). */
  shift?: { u: number; v: number };
}

const keyOf = (a: number, b: number): string => `${Math.min(a, b)}>${Math.max(a, b)}`;

const dedupe = (segments: TinSegment[]): TinSegment[] => {
  const seen = new Set<string>();
  const out: TinSegment[] = [];
  for (const seg of segments) {
    if (seg.a === seg.b) continue;
    const key = keyOf(seg.a, seg.b);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(seg);
  }
  return out;
};

const gridPoints = (n: number, x0 = 0, y0 = 0, step = 1): Corpus['points'] => {
  const points: Corpus['points'] = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) points.push({ x: x0 + i * step, y: y0 + j * step, z: 0 });
  }
  return points;
};

const at = (n: number, i: number, j: number): number => i * n + j;

const lcg = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

const irregularPoints = (count: number, seed: number): Corpus['points'] => {
  const rand = lcg(seed);
  const points: Corpus['points'] = [];
  const seen = new Set<string>();
  let guard = 0;
  while (points.length < count && guard < count * 30) {
    guard += 1;
    const x = Math.round(rand() * 1000) / 100;
    const y = Math.round(rand() * 1000) / 100;
    const key = `${x},${y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push({ x, y, z: Math.round(rand() * 100) / 10 });
  }
  return points;
};

const scanSegments = (count: number, modulus: number, mul: number, add: number): TinSegment[] => {
  const out: TinSegment[] = [];
  for (let k = 0; k < count; k += 1) {
    const a = k % modulus;
    const b = (k * mul + add) % modulus;
    if (a !== b) out.push({ a, b });
  }
  return out;
};

const corpora = (): Corpus[] => {
  const list: Corpus[] = [];

  {
    const n = 10;
    const points = gridPoints(n);
    list.push({
      name: 'regular-grid',
      points,
      segments: dedupe([
        { a: at(n, 0, 0), b: at(n, n - 1, n - 1) },
        { a: at(n, 0, n - 1), b: at(n, n - 1, 0) },
        { a: at(n, 3, 0), b: at(n, 3, n - 1) },
        { a: at(n, 0, 4), b: at(n, 7, 4) },
        { a: at(n, 1, 1), b: at(n, 8, 2) },
      ]),
    });
  }

  {
    const points = irregularPoints(90, 12345);
    list.push({
      name: 'irregular',
      points,
      segments: dedupe(scanSegments(Math.floor(points.length / 5), points.length, 7, 3)),
    });
  }

  {
    const points: Corpus['points'] = [];
    for (let i = 0; i < 9; i += 1) {
      for (let j = 0; j < 9; j += 1) {
        if (i >= 3 && i <= 5 && j >= 3) continue; // concave bite
        points.push({ x: i, y: j, z: 0 });
      }
    }
    list.push({ name: 'concave', points, segments: dedupe(scanSegments(points.length, points.length, 3, 5)) });
  }

  {
    const n = 10;
    const points = gridPoints(n);
    const ring = [at(n, 3, 3), at(n, 6, 3), at(n, 6, 6), at(n, 3, 6)];
    const voidSegments = ring.map((v, i) => ({ a: v, b: ring[(i + 1) % 4] }));
    list.push({
      name: 'void-constraints',
      points,
      segments: dedupe([
        ...voidSegments,
        { a: at(n, 0, 0), b: at(n, 9, 0) },
        { a: at(n, 0, 5), b: at(n, 9, 5) },
      ]),
    });
  }

  {
    const n = 12;
    const points = gridPoints(n);
    list.push({
      name: 'crossing-heavy',
      points,
      segments: dedupe(scanSegments(20, n * n, 17, 11)),
    });
  }

  {
    const n = 8;
    list.push({
      name: 'large-coords',
      points: gridPoints(n),
      segments: dedupe(scanSegments(10, n * n, 13, 5)),
      shift: { u: 2_000_000, v: 7_000_000 },
    });
  }

  {
    const n = 8;
    const points = gridPoints(n);
    list.push({
      name: 'collinear-touch',
      points,
      segments: dedupe([
        { a: at(n, 0, 0), b: at(n, 4, 4) },
        { a: at(n, 0, 0), b: at(n, 4, 0) },
        { a: at(n, 0, 0), b: at(n, 5, 2) },
        { a: at(n, 0, 0), b: at(n, 2, 5) },
      ]),
    });
  }

  {
    list.push({
      name: 'collinear-only',
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 1 },
        { x: 2, y: 0, z: 2 },
        { x: 3, y: 0, z: 3 },
      ],
      segments: [{ a: 0, b: 3 }],
    });
  }

  return list;
};

const baseOf = (corpus: Corpus): { points: TinPoint[]; triangles: TinTriangle[] } => {
  const base = buildTinBase(corpus.points);
  if (!corpus.shift) return { points: base.points, triangles: base.triangles };
  return {
    points: base.points.map((p) => ({ u: p.u + corpus.shift!.u, v: p.v + corpus.shift!.v, z: p.z })),
    triangles: base.triangles,
  };
};

const canonicalTriangle = (tri: TinTriangle): string =>
  [tri.a, tri.b, tri.c].sort((a, b) => a - b).join('>');

const digestOf = (triangles: TinTriangle[]): string =>
  triangles.map(canonicalTriangle).sort().join('|');

const edgeSetOf = (triangles: TinTriangle[]): Set<string> => {
  const edges = new Set<string>();
  for (const tri of triangles) {
    edges.add(keyOf(tri.a, tri.b));
    edges.add(keyOf(tri.b, tri.c));
    edges.add(keyOf(tri.c, tri.a));
  }
  return edges;
};

const compare = (
  label: string,
  points: TinPoint[],
  triangles: TinTriangle[],
  segments: TinSegment[],
): { oldR: ReturnType<typeof recoverConstrainedEdges>; newR: ReturnType<typeof recoverConstrainedEdgesIndexed> } => {
  const oldR = recoverConstrainedEdges(points, triangles, segments.map((s) => ({ ...s })));
  const newR = recoverConstrainedEdgesIndexed(points, triangles, segments.map((s) => ({ ...s })));

  expect(newR.ok, `${label}: ok`).toBe(oldR.ok);
  expect(newR.steiner.length, `${label}: steiner count`).toBe(oldR.steiner.length);
  expect(newR.steinerFor, `${label}: steinerFor`).toEqual(oldR.steinerFor);
  for (let i = 0; i < oldR.steiner.length; i += 1) {
    expect(newR.steiner[i], `${label}: steiner ${i}`).toEqual(oldR.steiner[i]);
  }
  if (oldR.ok) {
    expect(digestOf(newR.triangles), `${label}: topology digest`).toBe(digestOf(oldR.triangles));
    const edges = edgeSetOf(newR.triangles);
    for (const seg of segments) {
      expect(edges.has(keyOf(seg.a, seg.b)), `${label}: constraint ${seg.a}>${seg.b}`).toBe(true);
    }
  }
  return { oldR, newR };
};

describe('tinConstraintRecoveryIndexed parity', () => {
  it.each(corpora())('$name matches linear recovery', (corpus) => {
    const { points, triangles } = baseOf(corpus);
    compare(corpus.name, points, triangles, corpus.segments);
  });

  it('matches the linear Steiner fallback on a non-convex quad', () => {
    const points: TinPoint[] = [
      { u: 0, v: 0, z: 1 },
      { u: 4, v: 0, z: 2 },
      { u: 2, v: 2, z: 3 },
      { u: 2, v: -2, z: 4 },
      { u: 1, v: 0, z: 5 },
    ];
    const triangles: TinTriangle[] = [
      { a: 2, b: 3, c: 0 },
      { a: 3, b: 2, c: 4 },
    ];
    const { oldR, newR } = compare('non-convex-quad', points, triangles, [{ a: 0, b: 1 }]);
    expect(oldR.ok).toBe(false);
    expect(newR.steiner).toEqual([{ u: 2, v: 0, z: 1.5 }]);
    expect(newR.steinerFor).toEqual([{ a: 0, b: 1 }]);
  });
});

/** Convex fan: vertex 0 fan triangles plus non-crossing nested chords. */
const fanCase = (m: number, shift: { u: number; v: number } = { u: 0, v: 0 }): {
  points: TinPoint[];
  triangles: TinTriangle[];
  segments: TinSegment[];
} => {
  const points: TinPoint[] = [];
  for (let i = 0; i < m; i += 1) {
    const theta = (2 * Math.PI * i) / m;
    points.push({ u: Math.cos(theta) + shift.u, v: Math.sin(theta) + shift.v, z: 0 });
  }
  const triangles: TinTriangle[] = [];
  for (let i = 1; i < m - 1; i += 1) {
    const cross =
      (points[i].u - points[0].u) * (points[i + 1].v - points[0].v) -
      (points[i].v - points[0].v) * (points[i + 1].u - points[0].u);
    triangles.push(cross >= 0 ? { a: 0, b: i, c: i + 1 } : { a: 0, b: i + 1, c: i });
  }
  const segments: TinSegment[] = [];
  for (let k = 1; k < Math.floor(m / 2); k += 1) segments.push({ a: k, b: m - k });
  return { points, triangles, segments };
};

describe('tinConstraintRecoveryIndexed recoverable flips', () => {
  const diamond = {
    name: 'convex-diamond',
    points: [
      { u: 0, v: 0, z: 0 },
      { u: 4, v: 0, z: 0 },
      { u: 2, v: 2, z: 0 },
      { u: 2, v: -2, z: 0 },
    ],
    triangles: [
      { a: 0, b: 1, c: 2 },
      { a: 1, b: 0, c: 3 },
    ],
    segments: [{ a: 2, b: 3 }],
  };
  const handBuilt = [
    diamond,
    { name: 'convex-fan-16', ...fanCase(16) },
    { name: 'convex-fan-20-large-coords', ...fanCase(20, { u: 2_000_000, v: 7_000_000 }) },
  ];

  it.each(handBuilt)('$name recovers by flips and matches linear', (corpus) => {
    const { oldR, newR } = compare(corpus.name, corpus.points, corpus.triangles, corpus.segments);
    expect(oldR.ok, `${corpus.name}: linear must succeed`).toBe(true);
    expect(newR.triangles.length).toBe(corpus.triangles.length);
    // The mesh must actually change (constraints recovered by flips).
    expect(digestOf(newR.triangles)).not.toBe(digestOf(corpus.triangles));
  });
});
