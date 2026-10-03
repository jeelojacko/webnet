/**
 * Phase 20L.2 — transform/tolerance robustness + maxSearch boundaries.
 *
 * Engine modules are untouched: this suite only calls the production
 * entry points (`tryExactOffsetGroup`, `computeGradingGroupFromSnapshots`)
 * and compares against the SHARED agreement authorities
 * (`coordinateAgreementTol`, `extentJVWithin`) — no new epsilon anywhere.
 *
 * §16: admitted exact routes (A1 line→arc, B line→arc→line) under origin /
 * E,N ~1e6 / E,N ~1e8 / rotation / similarity scale up-down (geometry+d+ms
 * together) / fixed-d scale-up / left-right mirror (+translated mirror).
 * Rigid motions preserve classification and carry J rigidly; similarity
 * scales J by s. Fixed-d scale-DOWN is out of bounds (R/d collapses → two
 * local joins) and must stay a bounded AMBIGUITY fallback here and
 * translated — that bound is pinned, not worked around.
 *
 * §17: chord-tolerance × inward/outward Roff × radii × shallow/90° sweeps ×
 * translated coords, over admitted exact fixtures only (outward R50/R200,
 * inward R200, similarity-small R25). Tight curves (small-R outward,
 * R50-inward) are genuinely ambiguous in the engine — pinned as
 * tol-independent fallback rows. The mesh is tessellated under
 * `curveChordTolerance` and stays `CURVE_APPROXIMATED`, never exact.
 */
import { describe, expect, it } from 'vitest';

import { extentJVWithin } from '../src/engine/cad/grading/gradingExactOffsetGeometry';
import { tryExactOffsetGroup } from '../src/engine/cad/grading/gradingGroupExactOffset';
import type { ExactOffsetGroupInput } from '../src/engine/cad/grading/gradingGroupExactOffset.types';
import { coordinateAgreementTol } from '../src/engine/cad/grading/gradingGroupSectors';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import type {
  GradingCriterion,
  GradingSide,
  ResolvedGradingSource,
} from '../src/engine/cad/grading/gradingTypes';

const DIST = (d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: 1, distance: d });
const DFLT = 5;
const MS = 100;
const TOL = 0.01;

interface Pt { x: number; y: number }
interface Spec { p0: Pt; p1: Pt; z0?: number; z1?: number; arc?: { cx: number; cy: number; ccw: boolean } }
const N = (x: number, y: number): Pt => ({ x, y });

const toSource = (s: Spec): ResolvedGradingSource => {
  const z0 = s.z0 ?? 0;
  const z1 = s.z1 ?? 0;
  if (!s.arc) {
    return {
      startX: s.p0.x, startY: s.p0.y, endX: s.p1.x, endY: s.p1.y,
      startZ: z0, endZ: z1, length: Math.hypot(s.p1.x - s.p0.x, s.p1.y - s.p0.y),
      reoriented: false, isArc: false,
    };
  }
  const radius = Math.hypot(s.p0.x - s.arc.cx, s.p0.y - s.arc.cy);
  const a0 = Math.atan2(s.p0.y - s.arc.cy, s.p0.x - s.arc.cx);
  let a1 = Math.atan2(s.p1.y - s.arc.cy, s.p1.x - s.arc.cx);
  if (s.arc.ccw) { while (a1 <= a0) a1 += 2 * Math.PI; } else { while (a1 >= a0) a1 -= 2 * Math.PI; }
  return {
    startX: s.p0.x, startY: s.p0.y, endX: s.p1.x, endY: s.p1.y,
    startZ: z0, endZ: z1, length: radius * Math.abs(a1 - a0),
    reoriented: false, isArc: true,
    arc: { centerX: s.arc.cx, centerY: s.arc.cy, radius, startAngle: a0, endAngle: a1, sweepCCW: s.arc.ccw },
  };
};

const line = (p0: Pt, p1: Pt): Spec => ({ p0, p1 });
const arc = (p0: Pt, p1: Pt, cx: number, cy: number, ccw: boolean): Spec =>
  ({ p0, p1, arc: { cx, cy, ccw } });

// Study shape A1: line→arc (R=50 CW quarter, outward left), B: A1 + line.
const A1: Spec[] = [line(N(-40, 0), N(0, 0)), arc(N(0, 0), N(50, 50), 50, 0, false)];
const B: Spec[] = [...A1, line(N(50, 50), N(50, 90))];

type Xf = (_p: Pt) => Pt;
const compose =
  (ox: number, oy: number, theta: number, s: number, mirror: boolean): Xf =>
  (p) => {
    let x = mirror ? -p.x : p.x;
    let y = p.y;
    x *= s; y *= s;
    const c = Math.cos(theta);
    const sn = Math.sin(theta);
    return { x: x * c - y * sn + ox, y: x * sn + y * c + oy };
  };

/** Image of specs; mirror flips arc chirality. */
const xformSpecs = (specs: Spec[], xf: Xf, mirror: boolean): Spec[] =>
  specs.map((s) => {
    const p0 = xf(s.p0);
    const p1 = xf(s.p1);
    const base: Spec = { p0, p1 };
    if (s.z0 !== undefined) { base.z0 = s.z0; base.z1 = s.z1; }
    if (!s.arc) return base;
    const c = xf({ x: s.arc.cx, y: s.arc.cy });
    base.arc = { cx: c.x, cy: c.y, ccw: mirror ? !s.arc.ccw : s.arc.ccw };
    return base;
  });

const buildInput = (
  specs: Spec[], side: GradingSide, d: number, ms: number, tol = TOL,
): ExactOffsetGroupInput => ({
  groupId: 'robust-20l2', revision: 'robust-20l2/1',
  members: specs.map(toSource), side, criterion: DIST(d),
  maxSearchDistance: ms, curveChordTolerance: tol,
});

const agree = (got: number, want: number, scale: number): void => {
  expect(Math.abs(got - want)).toBeLessThanOrEqual(
    coordinateAgreementTol(got, want, Math.max(1, scale, Math.abs(got), Math.abs(want))),
  );
};

describe('phase20l.2 §16 transform robustness (exact routes)', () => {
  const joints: Pt[] = [N(0, 0), N(50, 50)];
  interface Case {
    id: string; xf: Xf; mirror: boolean; side: GradingSide;
    d: number; ms: number; s: number; jmap: 'rigid' | 'scale' | 'support-only';
    /** +1 = daylight rides R+d (mirrored-outward included), -1 = R-d. */
    roffSign: 1 | -1;
  }
  const cases: Case[] = [
    { id: 'origin', xf: compose(0, 0, 0, 1, false), mirror: false, side: 'left', d: 5, ms: 100, s: 1, jmap: 'rigid', roffSign: 1 },
    { id: 'E/N~1e6', xf: compose(1e6, -1e6, 0, 1, false), mirror: false, side: 'left', d: 5, ms: 100, s: 1, jmap: 'rigid', roffSign: 1 },
    { id: 'E/N~1e8', xf: compose(1e8, 1e8, 0, 1, false), mirror: false, side: 'left', d: 5, ms: 100, s: 1, jmap: 'rigid', roffSign: 1 },
    { id: 'rot37', xf: compose(0, 0, (37 * Math.PI) / 180, 1, false), mirror: false, side: 'left', d: 5, ms: 100, s: 1, jmap: 'rigid', roffSign: 1 },
    { id: 'rot37+1e6', xf: compose(1e6, 2e6, (37 * Math.PI) / 180, 1, false), mirror: false, side: 'left', d: 5, ms: 100, s: 1, jmap: 'rigid', roffSign: 1 },
    { id: 'similarity-half', xf: compose(0, 0, 0, 0.5, false), mirror: false, side: 'left', d: 2.5, ms: 50, s: 0.5, jmap: 'scale', roffSign: 1 },
    { id: 'similarity-double', xf: compose(0, 0, 0, 2, false), mirror: false, side: 'left', d: 10, ms: 200, s: 2, jmap: 'scale', roffSign: 1 },
    { id: 'fixed-d-scale-up', xf: compose(0, 0, 0, 1.5, false), mirror: false, side: 'left', d: 5, ms: 100, s: 1, jmap: 'support-only', roffSign: 1 },
    { id: 'mirror-x', xf: compose(0, 0, 0, 1, true), mirror: true, side: 'right', d: 5, ms: 100, s: 1, jmap: 'rigid', roffSign: 1 },
    { id: 'mirror-x+1e6', xf: compose(-1e6, 1e6, 0, 1, true), mirror: true, side: 'right', d: 5, ms: 100, s: 1, jmap: 'rigid', roffSign: 1 },
  ];
  for (const c of cases) {
    for (const shape of [{ id: 'A1', specs: A1 }, { id: 'B', specs: B }] as const) {
      it(`${shape.id} ${c.id}: classification invariant, J/support/stats agree`, () => {
        const specs = xformSpecs(shape.specs, c.xf, c.mirror);
        const out = tryExactOffsetGroup(buildInput(specs, c.side, c.d, c.ms));
        expect(out.kind).toBe('exact');
        if (out.kind !== 'exact') return;
        expect(out.d).toBe(c.d);
        const r = out.result;
        expect(r.accuracy).toBe('CURVE_APPROXIMATED');
        expect(r.minProjectionDistance).toBe(c.d);
        expect(r.maxProjectionDistance).toBe(c.d);
        expect(r.meanProjectionDistance).toBe(c.d);
        // Joins: rigidly carried, or scaled by s under similarity.
        // (fixed-d scale-up changes Roff itself, so only support+stats apply.)
        if (c.jmap !== 'support-only') {
        const baseOut = tryExactOffsetGroup(buildInput(shape.specs, 'left', DFLT, MS));
        expect(baseOut.kind).toBe('exact');
        if (baseOut.kind !== 'exact') return;
        expect(r.corners).toHaveLength(baseOut.result.corners.length);
        r.corners.forEach((corner, j) => {
          const b = baseOut.result.corners[j]!.exactOffsetJoinXyz!;
          const want = c.jmap === 'rigid'
            ? c.xf({ x: b[0], y: b[1] })
            : { x: b[0] * c.s, y: b[1] * c.s };
          const got = corner.exactOffsetJoinXyz!;
          const scale = Math.max(1, Math.abs(want.x), Math.abs(want.y));
          agree(got[0], want.x, scale);
          agree(got[1], want.y, scale);
          expect(got[2]).toBe(c.d);
          const V = c.jmap === 'rigid' ? c.xf(joints[j]!) : { x: joints[j]!.x * c.s, y: joints[j]!.y * c.s };
          expect(extentJVWithin(Math.hypot(got[0] - V.x, got[1] - V.y), c.ms, scale)).toBe(true);
        });
        }
        // Daylight arc samples ride the exact offset circle Roff = R±d.
        const arcSrc = specs.map(toSource).find((m) => m.isArc)!;
        const roff = arcSrc.arc!.radius + c.roffSign * c.d;
        const supScale = Math.max(1, Math.abs(arcSrc.arc!.centerX), Math.abs(arcSrc.arc!.centerY), Math.abs(roff));
        let sum = 0;
        let n = 0;
        for (let k = 0; k + 2 < r.daylightPoints.length; k += 3) {
          const rr = Math.hypot(
            r.daylightPoints[k]! - arcSrc.arc!.centerX, r.daylightPoints[k + 1]! - arcSrc.arc!.centerY,
          );
          if (Math.abs(rr - roff) <= coordinateAgreementTol(rr, roff, supScale)) {
            sum += rr; n += 1;
          }
        }
        expect(n).toBeGreaterThan(0);
        agree(sum / n, roff, supScale);
      });
    }
  }

  it('fixed-d scale-down collapses R/d and stays a bounded AMBIGUITY fallback (origin + translated)', () => {
    for (const xf of [compose(0, 0, 0, 0.5, false), compose(1e6, -1e6, 0, 0.5, false)]) {
      const out = tryExactOffsetGroup(buildInput(xformSpecs(A1, xf, false), 'left', DFLT, MS));
      expect(out.kind).toBe('fallback');
      if (out.kind === 'fallback') expect(out.reason).toBe('FALLBACK_AMBIGUITY_B0');
    }
  });

  it('chirality complement (major-arc CCW over the same endpoints) never aliases the CW join', () => {
    const complement: Spec[] = [line(N(-40, 0), N(0, 0)), arc(N(0, 0), N(50, 50), 50, 0, true)];
    const baseOut = tryExactOffsetGroup(buildInput(A1, 'left', DFLT, MS));
    expect(baseOut.kind).toBe('exact');
    if (baseOut.kind !== 'exact') return;
    const base = baseOut.result.corners[0]!.exactOffsetJoinXyz!;
    const out = tryExactOffsetGroup(buildInput(complement, 'left', DFLT, MS));
    if (out.kind !== 'exact') return; // fallback is fine: different route
    const J = out.result.corners[0]!.exactOffsetJoinXyz!;
    expect(Math.hypot(J[0] - base[0], J[1] - base[1])).toBeGreaterThan(1e-6);
  });
});

describe('phase20l.2 §16 fallback representatives under translation', () => {
  const shift = compose(1e6, -1e6, 0, 1, false);
  const fallbacks: Array<{ id: string; specs: Spec[]; criterion: GradingCriterion; ms: number; tol: number }> = [
    {
      id: 'sloped', ms: MS, tol: TOL,
      criterion: { kind: 'elevation', gradeRatio: 1, targetElevation: 10 },
      specs: [
        { p0: N(-40, 0), p1: N(0, 0), z0: 0, z1: 1 },
        { p0: N(0, 0), p1: N(50, 50), z0: 1, z1: 2, arc: { cx: 50, cy: 0, ccw: false } },
      ],
    },
    {
      id: 'arc-pair', ms: MS, tol: TOL, criterion: DIST(DFLT),
      specs: [...A1, arc(N(50, 50), N(10, 90), 10, 50, true)],
    },
    {
      id: 'roff-inversion', ms: MS, tol: TOL, criterion: DIST(8),
      specs: [line(N(-40, 0), N(0, 0)), arc(N(0, 0), N(-5, 5), -5, 0, true)],
    },
    { id: 'over-search', ms: 4, tol: TOL, criterion: DIST(DFLT), specs: A1 },
    { id: 'tight-small-R', ms: MS, tol: TOL, criterion: DIST(DFLT), specs: xformSpecs(A1, compose(0, 0, 0, 0.5, false), false) },
  ];
  for (const f of fallbacks) {
    it(`${f.id}: same bounded reason at origin and at E/N~1e6`, () => {
      const run = (specs: Spec[]): string => {
        const out = tryExactOffsetGroup({
          groupId: f.id, revision: f.id, members: specs.map(toSource),
          side: 'left', criterion: f.criterion,
          maxSearchDistance: f.ms, curveChordTolerance: f.tol,
        });
        expect(out.kind).toBe('fallback');
        return out.kind === 'fallback' ? `${out.reason}/${out.detail ?? ''}` : 'exact?!';
      };
      expect(run(xformSpecs(f.specs, shift, false))).toBe(run(f.specs));
    });
  }

  it('translated fallbacks keep the identical chord-path ok/fail outcome', () => {
    for (const f of fallbacks) {
      const solve = (specs: Spec[]): string => {
        const out = computeGradingGroupFromSnapshots({
          groupId: f.id, revision: f.id, members: specs.map(toSource),
          side: 'left', criterion: f.criterion,
          maxSearchDistance: f.ms, curveChordTolerance: f.tol, closed: false,
        });
        return out.ok ? 'ok' : `fail:${out.code}`;
      };
      expect(solve(xformSpecs(f.specs, shift, false))).toBe(solve(f.specs));
    }
  });
});

describe('phase20l.2 §16 maxSearch boundaries (A1, d=5)', () => {
  it('d==maxSearch gates the join extent (bounded EXTENT_E1 fallback, not silent clamp)', () => {
    // |J-V| ≈ 6.91 > d, so maxSearch must cover the JOIN extent, not just d.
    const out = tryExactOffsetGroup(buildInput(A1, 'left', DFLT, DFLT));
    expect(out.kind).toBe('fallback');
    if (out.kind === 'fallback') expect(out.reason).toBe('FALLBACK_EXTENT_E1');
    const under = tryExactOffsetGroup(buildInput(A1, 'left', DFLT, DFLT - 1e-9));
    expect(under.kind).toBe('fallback');
    if (under.kind === 'fallback') {
      expect(under.reason).toBe('FALLBACK_INVALID_CRITERION');
    }
  });

  it('|J-V| at the E1 boundary ± one representable step', () => {
    const base = tryExactOffsetGroup(buildInput(A1, 'left', DFLT, MS));
    expect(base.kind).toBe('exact');
    if (base.kind !== 'exact') return;
    const J = base.result.corners[0]!.exactOffsetJoinXyz!;
    const distJV = Math.hypot(J[0], J[1]);
    expect(extentJVWithin(distJV, distJV, Math.max(1, Math.abs(J[0]), Math.abs(J[1])))).toBe(true);
    expect(tryExactOffsetGroup(buildInput(A1, 'left', DFLT, distJV)).kind).toBe('exact');
    const below = tryExactOffsetGroup(buildInput(A1, 'left', DFLT, distJV * (1 - 1e-9)));
    expect(below.kind).toBe('fallback');
  });
});

describe('phase20l.2 §17 chord-tolerance convergence', () => {
  interface TolFixture {
    id: string; specs: Spec[]; side: GradingSide; d: number; ms: number;
    cx: number; cy: number; R: number; roff: number;
  }
  // Outward family (study-shaped): line→V heading +X, CW arc centre (V.x+R,V.y).
  const outward = (
    id: string, R: number, sweep: number, d: number, ms: number, ox = 0, oy = 0,
  ): TolFixture => {
    const cx = ox + R;
    const cy = oy;
    const a1 = Math.PI - sweep;
    const E = { x: cx + R * Math.cos(a1), y: cy + R * Math.sin(a1) };
    return {
      id, specs: [line({ x: ox - 40, y: oy }, { x: ox, y: oy }), arc({ x: ox, y: oy }, E, cx, cy, false)],
      side: 'left', d, ms, cx, cy, R, roff: R + d,
    };
  };
  // Inward family: centre west, CCW quarter (left side rides Roff = R-d).
  const inward = (
    id: string, R: number, sweep: number, d: number, ms: number, ox = 0, oy = 0,
  ): TolFixture => {
    const cx = ox - R;
    const cy = oy;
    const E = { x: cx + R * Math.cos(sweep), y: cy + R * Math.sin(sweep) };
    return {
      id, specs: [line({ x: ox - 40, y: oy }, { x: ox, y: oy }), arc({ x: ox, y: oy }, E, cx, cy, true)],
      side: 'left', d, ms, cx, cy, R, roff: R - d,
    };
  };
  const fixtures: TolFixture[] = [
    outward('out-R50-90', 50, Math.PI / 2, 5, 100),
    outward('out-R200-90', 200, Math.PI / 2, 5, 100),
    outward('out-R50-shallow', 50, Math.PI / 18, 5, 100),
    outward('out-R200-shallow', 200, Math.PI / 18, 5, 100),
    inward('in-R200-90', 200, Math.PI / 2, 5, 100),
    inward('in-R200-shallow', 200, Math.PI / 18, 5, 100),
    // Similarity-small: the study shape at s=0.5 (R=25, d=2.5).
    outward('out-R25-90-sim', 25, Math.PI / 2, 2.5, 50),
    outward('out-R50-90-1e6', 50, Math.PI / 2, 5, 100, 1e6, -1e6),
  ];
  const TOLS = [0.1, 0.01, 0.001];
  for (const f of fixtures) {
    it(`${f.id}: sagitta<=tol, J tol-invariant, area converges, samples grow`, () => {
      const runs = TOLS.map((tol) => {
        const out = tryExactOffsetGroup({
          groupId: f.id, revision: f.id, members: f.specs.map(toSource),
          side: f.side, criterion: DIST(f.d),
          maxSearchDistance: f.ms, curveChordTolerance: tol,
        });
        expect(out.kind).toBe('exact');
        if (out.kind !== 'exact') throw new Error('unreachable');
        return { tol, result: out.result };
      });
      for (const r of runs) {
        expect(r.result.curveGeometryMode).toBe('EXACT_OFFSET_RADIUS');
        expect(r.result.accuracy).toBe('CURVE_APPROXIMATED');
      }
      // J is analytic: bitwise-invariant under tol change.
      const J0 = runs[0]!.result.corners[0]!.exactOffsetJoinXyz!;
      for (const r of runs) {
        expect(r.result.corners[0]!.exactOffsetJoinXyz!).toEqual(J0);
      }
      // Daylight arc samples ride Roff; neighbour sagitta<=tol throughout.
      const tolScale = Math.max(1, Math.abs(f.cx), Math.abs(f.cy), f.roff);
      const counts = runs.map(({ tol, result }) => {
        const arcPts: Pt[] = [];
        for (let k = 0; k + 2 < result.daylightPoints.length; k += 3) {
          const x = result.daylightPoints[k]!;
          const y = result.daylightPoints[k + 1]!;
          const rr = Math.hypot(x - f.cx, y - f.cy);
          if (Math.abs(rr - f.roff) <= coordinateAgreementTol(rr, f.roff, tolScale)) {
            arcPts.push({ x, y });
          }
        }
        expect(arcPts.length).toBeGreaterThanOrEqual(2);
        let worst = 0;
        for (let i = 0; i + 1 < arcPts.length; i += 1) {
          const a = Math.atan2(arcPts[i]!.y - f.cy, arcPts[i]!.x - f.cx);
          const b = Math.atan2(arcPts[i + 1]!.y - f.cy, arcPts[i + 1]!.x - f.cx);
          let dth = Math.abs(b - a);
          if (dth > Math.PI) dth = 2 * Math.PI - dth;
          worst = Math.max(worst, f.roff * (1 - Math.cos(dth / 2)));
        }
        expect(worst).toBeLessThanOrEqual(tol);
        return arcPts.length;
      });
      expect(counts[1]).toBeGreaterThanOrEqual(counts[0]);
      expect(counts[2]).toBeGreaterThanOrEqual(counts[1]);
      const areas = runs.map((r) => r.result.gradingPlanArea);
      expect(Math.abs(areas[2]! - areas[1]!)).toBeLessThanOrEqual(Math.abs(areas[1]! - areas[0]!));
      const rerun = tryExactOffsetGroup({
        groupId: f.id, revision: f.id, members: f.specs.map(toSource),
        side: f.side, criterion: DIST(f.d),
        maxSearchDistance: f.ms, curveChordTolerance: TOLS[1],
      });
      expect(rerun.kind).toBe('exact');
      if (rerun.kind === 'exact') {
        expect(rerun.result.daylightPoints).toEqual(runs[1]!.result.daylightPoints);
      }
    });
  }

  it('tight curves stay tol-independent bounded fallbacks (no tessellation aliasing)', () => {
    const tight: Array<{ id: string; specs: Spec[] }> = [
      { id: 'tight-small-R', specs: xformSpecs(A1, compose(0, 0, 0, 0.5, false), false) },
      {
        id: 'tight-inward-R50',
        specs: [line(N(-40, 0), N(0, 0)), arc(N(0, 0), N(-50, 50), -50, 0, true)],
      },
    ];
    // small-R: study geometry at s=0.2, fixed d (R/d collapses).
    for (const t of tight) {
      const reasons = [0.1, 0.01, 0.001].map((tol) => {
        const out = tryExactOffsetGroup({
          groupId: t.id, revision: t.id, members: t.specs.map(toSource),
          side: 'left', criterion: DIST(DFLT),
          maxSearchDistance: MS, curveChordTolerance: tol,
        });
        expect(out.kind).toBe('fallback');
        return out.kind === 'fallback' ? `${out.reason}/${out.detail ?? ''}` : 'exact?!';
      });
      expect(reasons[1]).toBe(reasons[0]);
      expect(reasons[2]).toBe(reasons[0]);
    }
  });
});
