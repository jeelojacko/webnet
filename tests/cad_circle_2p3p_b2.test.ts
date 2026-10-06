/** Phase B2 — Circle 2-Point / 3-Point geometry builders + command keys. */
import { describe, expect, it } from 'vitest';

import {
  buildCircleCenterDiameter,
  buildCircleCenterRadius,
  buildCircleThreePoint,
  buildCircleTwoPoint,
  CAD_XY_DEGENERATE_FLOOR,
} from '../src/engine/cad/cadGeometryShapeBuilders';
import { cadBuildArcFromThreePoints } from '../src/engine/cad/cadGeometryArcPrimitives';

describe('circle 2-Point builder', () => {
  it('uses the two points as opposite diameter endpoints: center is the midpoint', () => {
    const built = buildCircleTwoPoint({ x: 10, y: 20 }, { x: 40, y: 20 });
    expect(built).not.toBeNull();
    expect(built!.center).toEqual({ x: 25, y: 20 });
    expect(built!.radius).toBeCloseTo(15, 12);
  });

  it('is asymmetric against Center/Diameter (which fixes the supplied center)', () => {
    const twoPoint = buildCircleTwoPoint({ x: 10, y: 20 }, { x: 40, y: 20 });
    const centerDiameter = buildCircleCenterDiameter({ x: 10, y: 20 }, { x: 40, y: 20 });
    expect(centerDiameter!.center).toEqual({ x: 10, y: 20 });
    expect(twoPoint!.center).not.toEqual(centerDiameter!.center);
    expect(twoPoint!.radius).toBeCloseTo(centerDiameter!.radius, 12);
  });

  it('rejects coincident, non-finite, and sub-floor diameter picks', () => {
    expect(buildCircleTwoPoint({ x: 5, y: 5 }, { x: 5, y: 5 })).toBeNull();
    expect(buildCircleTwoPoint({ x: 0, y: 0 }, { x: CAD_XY_DEGENERATE_FLOOR, y: 0 })).toBeNull();
    expect(buildCircleTwoPoint({ x: NaN, y: 0 }, { x: 1, y: 0 })).toBeNull();
    expect(buildCircleTwoPoint({ x: 0, y: 0 }, { x: 1, y: Infinity })).toBeNull();
  });

  it('accepts a tiny-but-valid diameter above the CAD floor', () => {
    const built = buildCircleTwoPoint({ x: 0, y: 0 }, { x: 4 * CAD_XY_DEGENERATE_FLOOR, y: 0 });
    expect(built).not.toBeNull();
    expect(built!.radius).toBeCloseTo(2 * CAD_XY_DEGENERATE_FLOOR, 30);
  });

  it('keeps individually finite large coordinates finite (no midpoint overflow)', () => {
    const built = buildCircleTwoPoint({ x: 1e308, y: 0 }, { x: 1e308, y: 100 });
    expect(built).not.toBeNull();
    expect(built!.center.x).toBe(1e308);
    expect(built!.radius).toBeCloseTo(50, 9);
  });

  it('is distinct from a center/radius build with the same scalar', () => {
    const twoPoint = buildCircleTwoPoint({ x: 0, y: 0 }, { x: 30, y: 0 });
    const centerRadius = buildCircleCenterRadius({ x: 0, y: 0 }, { x: 30, y: 0 });
    expect(twoPoint!.center).toEqual({ x: 15, y: 0 });
    expect(centerRadius!.center).toEqual({ x: 0, y: 0 });
  });
});

describe('circle 3-Point builder', () => {
  it('solves the circumcircle through three points', () => {
    const built = buildCircleThreePoint(
      { x: 150, y: 200 },
      { x: 100, y: 250 },
      { x: 50, y: 200 },
    );
    expect(built).not.toBeNull();
    expect(built!.center.x).toBeCloseTo(100, 9);
    expect(built!.center.y).toBeCloseTo(200, 9);
    expect(built!.radius).toBeCloseTo(50, 9);
  });

  it('agrees with the shared arc convention for a rotated triangle', () => {
    const a = { x: 12, y: -4 };
    const b = { x: 33, y: 7 };
    const c = { x: -9, y: 15 };
    const built = buildCircleThreePoint(a, b, c);
    const arc = cadBuildArcFromThreePoints(a, b, c);
    expect(arc).not.toBeNull();
    expect(built!.center.x).toBeCloseTo(arc!.center.x, 9);
    expect(built!.center.y).toBeCloseTo(arc!.center.y, 9);
    expect(built!.radius).toBeCloseTo(arc!.radius, 9);
  });

  it('rejects collinear and duplicate triples', () => {
    expect(buildCircleThreePoint({ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 })).toBeNull();
    expect(buildCircleThreePoint({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeNull();
    expect(buildCircleThreePoint({ x: 3, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 3 })).toBeNull();
  });

  it('rejects an ill-conditioned near-collinear triple at scale', () => {
    // Double area 2 with a ~2e6 scale: the raw absolute denominator check
    // would pass, but the scale-relative conditioning guard rejects.
    expect(
      buildCircleThreePoint({ x: 0, y: 0 }, { x: 1e6, y: 1e-6 }, { x: 2e6, y: 0 }),
    ).toBeNull();
  });

  it('accepts a genuinely thin-but-resolvable triangle', () => {
    const built = buildCircleThreePoint(
      { x: 0, y: 0 },
      { x: 1e6, y: 1 },
      { x: 2e6, y: 0 },
    );
    expect(built).not.toBeNull();
    expect(built!.radius).toBeGreaterThan(1e11);
    expect(Number.isFinite(built!.radius)).toBe(true);
  });

  it('rejects non-finite input and sub-floor results', () => {
    expect(buildCircleThreePoint({ x: NaN, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 })).toBeNull();
    expect(buildCircleThreePoint({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1e-13 })).toBeNull();
  });

  it('is order-sensitive to winding but returns the same circle', () => {
    const forward = buildCircleThreePoint({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 });
    const reverse = buildCircleThreePoint({ x: 0, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 0 });
    expect(forward).not.toBeNull();
    expect(reverse).not.toBeNull();
    expect(forward!.center.x).toBeCloseTo(reverse!.center.x, 9);
    expect(forward!.center.y).toBeCloseTo(reverse!.center.y, 9);
    expect(forward!.radius).toBeCloseTo(reverse!.radius, 9);
  });
});
