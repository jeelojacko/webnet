/** Robustness + snap-semantics + adapter/mode pins (study-side, no src/). */
import { describe, expect, it } from 'vitest';
import { cadDistance, cadPointOnCircle } from '../src/engine/cad/cadGeometry';
import { cadClosestPointOnArc } from '../src/engine/cad/cadGeometryArcPrimitives';
import { cadIntersectCircleCircle } from '../src/engine/cad/cadGeometryCurveIntersections';
import { runAdapterControl, closestTo, circle } from '../scripts/cadCircleStudyAdapter';
import { fromCenterRadius, fromCenterDiameter, from2Point, from3Point, analyzeTtrTtt, recommendB1Slice } from '../scripts/cadCircleStudyModes';
import { runSnapGripB1 } from '../scripts/cadCircleStudyExecution';

describe('robustness', () => {
  it('origin-centered circle is exact at quadrants', () => {
    expect(cadPointOnCircle({ x: 0, y: 0 }, 10, 0)).toEqual({ x: 10, y: 0 });
    expect(cadPointOnCircle({ x: 0, y: 0 }, 10, 90).x).toBeCloseTo(0, 9);
  });
  it('large offsets 1e6/1e8/1e12 keep radius within float tolerance', () => {
    for (const o of [1e6, 1e8, 1e12]) {
      const p = cadPointOnCircle({ x: o, y: -o }, 50, 37);
      expect(cadDistance({ x: o, y: -o }, p)).toBeCloseTo(50, o === 1e12 ? -2 : 3);
    }
  });
  it('tiny radius at floor and large finite radius stay finite', () => {
    expect(cadDistance({ x: 0, y: 0 }, cadPointOnCircle({ x: 0, y: 0 }, 1e-6, 123))).toBeCloseTo(1e-6, 12);
    const p = cadPointOnCircle({ x: 0, y: 0 }, 1e9, 200);
    expect(Number.isFinite(p.x + p.y)).toBe(true);
  });
  it('non-finite inputs stay non-finite (never silently a valid point)', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const p = cadPointOnCircle({ x: bad, y: 0 }, 50, 0);
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(false);
    }
    expect(Number.isNaN(cadPointOnCircle({ x: NaN, y: 0 }, 50, 0).x)).toBe(true);
  });
  it('closest-point from center falls back to nearest endpoint (documented kernel behavior)', () => {
    const q = cadClosestPointOnArc({ x: 100, y: 200 }, { x: 100, y: 200 }, 50, 0, 360);
    expect(cadDistance({ x: 100, y: 200 }, q)).toBeCloseTo(50, 9);
  });
  it('secant/tangent/disjoint/concentric circle-circle pinned', () => {
    const A = { x: 0, y: 0 };
    expect(cadIntersectCircleCircle(A, 50, { x: 60, y: 0 }, 50).length).toBe(2);
    expect(cadIntersectCircleCircle(A, 50, { x: 100, y: 0 }, 50).length).toBe(1);
    expect(cadIntersectCircleCircle(A, 50, { x: 500, y: 0 }, 50).length).toBe(0);
    expect(cadIntersectCircleCircle(A, 50, { x: 0, y: 0 }, 40).length).toBe(0);
  });
});

describe('snap semantics mapping', () => {
  it('executed B1 query: center/quadrant/nearest exist; endpoint + arc-midpoint leak', () => {
    const r = runSnapGripB1() as {
      entityEmitted: Record<string, number>; entityEndpointObservable: number; gripsLeaked: number;
    };
    // Measured via buildArcEntitySnapCandidates + dedupeCandidates (not a literal list).
    expect(r.entityEmitted.center).toBe(1);
    expect(r.entityEmitted.quadrant).toBe(4);
    expect(r.entityEmitted.nearest).toBe(1);
    expect(r.entityEmitted.endpoint).toBe(2);
    expect(r.entityEmitted['arc-midpoint']).toBe(1);
    // Honest observable count: dedupe merges the coincident pair into one.
    expect(r.entityEndpointObservable).toBe(1);
    expect(r.gripsLeaked).toBe(2);
    // quadrant reuse: a full circle exposes 0/90/180/270 rim points (exists per forensics)
    for (const q of [0, 90, 180, 270]) {
      expect(cadDistance({ x: 100, y: 200 }, cadPointOnCircle({ x: 100, y: 200 }, 50, q))).toBeCloseTo(50, 9);
    }
  });
});

describe('adapter control + modes', () => {
  it('adapter is sweep-independent and matches kernel rim/closest', () => {
    const a = runAdapterControl() as Record<string, number>;
    expect(a.circleSecant).toBe(2);
    expect(a.circleConcentric).toBe(0);
    expect(a.tangentOutside).toBe(2);
    const s = circle(100, 200, 50);
    expect(closestTo(s, { x: 190, y: 200 })).toEqual({ x: 150, y: 200 });
  });
  it('modes: CR/CD/2P exact, degeneracies named; 3P collinear null', () => {
    expect(fromCenterRadius(100, 200, 50).degenerate).toBeNull();
    expect(fromCenterRadius(100, 200, 0).degenerate).toBe('ZERO_OR_NEGATIVE_RADIUS');
    expect(fromCenterRadius(100, 200, -5).degenerate).toBe('ZERO_OR_NEGATIVE_RADIUS');
    expect(fromCenterDiameter({ x: 10, y: 20 }, { x: 10, y: 20 }).degenerate).toBe('ZERO_DIAMETER');
    expect(fromCenterDiameter({ x: 10, y: 20 }, { x: NaN, y: 20 }).degenerate).toBe('NON_FINITE_INPUT');
    expect(fromCenterRadius(100, 200, 50).center).toEqual({ x: 100, y: 200 });
    expect(from2Point({ x: 50, y: 200 }, { x: 150, y: 200 }).radius).toBe(50);
    expect(from3Point({ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }).degenerate).toBe('COLLINEAR_OR_COINCIDENT');
    const good = from3Point({ x: 150, y: 200 }, { x: 100, y: 250 }, { x: 50, y: 200 });
    expect(good.center?.x).toBeCloseTo(100, 6);
  });
  it('Center/Diameter preserves the center; 2-Point solves it (asymmetric regression)', () => {
    const cd = fromCenterDiameter({ x: 10, y: 20 }, { x: 40, y: 20 });
    expect(cd.mode).toBe('center-diameter');
    expect(cd.center).toEqual({ x: 10, y: 20 });
    expect(cd.radius).toBe(15);
    const two = from2Point({ x: 10, y: 20 }, { x: 40, y: 20 });
    expect(two.mode).toBe('2-point');
    expect(two.center).toEqual({ x: 25, y: 20 });
    expect(two.radius).toBe(15);
    expect(cd.center).not.toEqual(two.center);
  });
  it('TTR/TTT deferred with multi-solution verdicts; B1 slice is CR+CD', () => {
    expect(analyzeTtrTtt().every((t) => t.verdict.startsWith('DEFER'))).toBe(true);
    expect(recommendB1Slice().slice).toContain('Center/Radius');
  });
});
