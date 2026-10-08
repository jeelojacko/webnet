import { describe, expect, it } from 'vitest';
import {
  buildCadCurveBetweenTangentRays,
  cadAzimuthDeg,
  cadDistance,
  cadNormalizeAngleDeg,
  cadSignedSweepDeg,
  resolveCadCurveMinDistancePt,
  resolveTwoTangentRays,
  solveCadCurveThroughTwoTangentRays,
  type CadCurveLineInput,
  type CadTwoTangentRays,
  type CadWorldPoint,
} from '../../src/engine/cad/cadGeometry';

const eastLine: CadCurveLineInput = {
  entityId: 'line-e',
  segmentId: 'line-e#0',
  start: { x: -300, y: 0 },
  end: { x: 300, y: 0 },
};

const verticalLine: CadCurveLineInput = {
  entityId: 'line-n',
  segmentId: 'line-n#0',
  start: { x: 0, y: -300 },
  end: { x: 0, y: 300 },
};

const obliqueLine = (entityId: string, angleDeg: number): CadCurveLineInput => {
  const radians = (angleDeg * Math.PI) / 180;
  return {
    entityId,
    segmentId: `${entityId}#0`,
    start: { x: 0, y: 0 },
    end: { x: Math.cos(radians) * 300, y: Math.sin(radians) * 300 },
  };
};

const pickAlong = (angleDeg: number, distance: number): CadWorldPoint => {
  const radians = (angleDeg * Math.PI) / 180;
  return { x: Math.cos(radians) * distance, y: Math.sin(radians) * distance };
};

const dot = (a: CadWorldPoint, b: CadWorldPoint): number => a.x * b.x + a.y * b.y;

const rightAngle = (): CadTwoTangentRays =>
  resolveTwoTangentRays(eastLine, verticalLine, { x: 80, y: 0 }, { x: 0, y: 80 })!;

describe('CAD Curves F1 two-tangent resolver', () => {
  it('resolves a 90-degree corner into PI and rays', () => {
    const rays = rightAngle();
    expect(rays.pi.x).toBeCloseTo(0, 9);
    expect(rays.pi.y).toBeCloseTo(0, 9);
    expect(rays.deltaDeg).toBeCloseTo(90, 9);
    expect(rays.rayAngleDeg).toBeCloseTo(90, 9);
    expect(rays.signedTurnDeg).toBeCloseTo(-90, 9);
    expect(rays.turnSide).toBe('right');
    expect(rays.ray1.direction.x).toBeCloseTo(1, 9);
    expect(rays.ray1.direction.y).toBeCloseTo(0, 9);
    expect(rays.ray2.direction.x).toBeCloseTo(0, 9);
    expect(rays.ray2.direction.y).toBeCloseTo(1, 9);
    expect(rays.incomingTangent.x).toBeCloseTo(-1, 9);
    expect(rays.outgoingTangent.y).toBeCloseTo(1, 9);
    expect(rays.ray1.azimuthDeg).toBeCloseTo(90, 6);
    expect(rays.ray2.azimuthDeg).toBeCloseTo(0, 6);
  });

  it('resolves acute and obtuse corners to complementary deltas', () => {
    for (const angleDeg of [45, 120]) {
      const rays = resolveTwoTangentRays(
        eastLine,
        obliqueLine('line-o', angleDeg),
        { x: 100, y: 0 },
        pickAlong(angleDeg, 100),
      );
      expect(rays).not.toBeNull();
      expect(rays!.deltaDeg).toBeCloseTo(180 - angleDeg, 6);
      expect(rays!.turnSide).toBe('right');
    }
  });

  it('follows the pick to select the retained ray', () => {
    const rays = resolveTwoTangentRays(
      eastLine,
      verticalLine,
      { x: -80, y: 0 },
      { x: 0, y: 80 },
    )!;
    expect(rays.ray1.direction.x).toBeCloseTo(-1, 9);
    expect(rays.turnSide).toBe('left');
    expect(rays.signedTurnDeg).toBeCloseTo(90, 9);
  });

  it('is permutation-proof under source swap and endpoint reversal', () => {
    const base = rightAngle();
    const reversedEndpoints = resolveTwoTangentRays(
      { ...eastLine, start: eastLine.end, end: eastLine.start },
      { ...verticalLine, start: verticalLine.end, end: verticalLine.start },
      { x: 80, y: 0 },
      { x: 0, y: 80 },
    )!;
    expect(reversedEndpoints.ray1.direction.x).toBeCloseTo(base.ray1.direction.x, 9);
    expect(reversedEndpoints.ray1.direction.y).toBeCloseTo(base.ray1.direction.y, 9);
    expect(reversedEndpoints.ray2.direction.x).toBeCloseTo(base.ray2.direction.x, 9);
    expect(reversedEndpoints.ray2.direction.y).toBeCloseTo(base.ray2.direction.y, 9);

    const swapped = resolveTwoTangentRays(
      verticalLine,
      eastLine,
      { x: 0, y: 80 },
      { x: 80, y: 0 },
    )!;
    expect(swapped.pi.x).toBeCloseTo(base.pi.x, 9);
    expect(swapped.deltaDeg).toBeCloseTo(base.deltaDeg, 9);
    expect(swapped.ray1.direction.x).toBeCloseTo(verticalLine.start.x === 0 ? 0 : 0, 9);
    expect(swapped.ray1.direction.y).toBeCloseTo(1, 9);
    expect(swapped.ray2.direction.x).toBeCloseTo(1, 9);
    expect(swapped.signedTurnDeg).toBeCloseTo(-base.signedTurnDeg, 9);
  });

  it('rejects same entity, zero length, parallel, and collinear pairs', () => {
    expect(
      resolveTwoTangentRays(eastLine, { ...eastLine, entityId: 'line-e' }, { x: 10, y: 0 }, { x: 20, y: 0 }),
    ).toBeNull();
    expect(
      resolveTwoTangentRays(
        { ...eastLine, entityId: 'z', start: { x: 5, y: 5 }, end: { x: 5, y: 5 } },
        verticalLine,
        { x: 5, y: 5 },
        { x: 0, y: 80 },
      ),
    ).toBeNull();
    expect(
      resolveTwoTangentRays(
        eastLine,
        { entityId: 'line-p', start: { x: 0, y: 10 }, end: { x: 200, y: 10 } },
        { x: 80, y: 0 },
        { x: 80, y: 10 },
      ),
    ).toBeNull();
    expect(
      resolveTwoTangentRays(
        eastLine,
        { entityId: 'line-c', start: { x: 0, y: 0 }, end: { x: 200, y: 0 } },
        { x: 80, y: 0 },
        { x: 120, y: 0 },
      ),
    ).toBeNull();
  });
});

describe('CAD Curves F1 Between / On kernel', () => {
  it('builds the tangent arc with PC and PT on the rays', () => {
    const rays = rightAngle();
    const outcome = buildCadCurveBetweenTangentRays(rays, { mode: 'radius', value: 50 });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const { result } = outcome;
    expect(result.metrics.radius).toBeCloseTo(50, 9);
    expect(result.metrics.deltaDeg).toBeCloseTo(90, 9);
    expect(result.pc.x).toBeCloseTo(50, 6);
    expect(result.pc.y).toBeCloseTo(0, 6);
    expect(result.pt.x).toBeCloseTo(0, 6);
    expect(result.pt.y).toBeCloseTo(50, 6);
    expect(result.arc.center.x).toBeCloseTo(50, 6);
    expect(result.arc.center.y).toBeCloseTo(50, 6);
    expect(cadDistance(result.arc.startPoint, result.pc)).toBeLessThan(1e-9);
    expect(cadDistance(result.arc.endPoint, result.pt)).toBeLessThan(1e-9);
    // Radius is perpendicular to each tangent ray at the tangent points.
    expect(
      dot({ x: result.pc.x - result.arc.center.x, y: result.pc.y - result.arc.center.y }, rays.ray1.direction),
    ).toBeCloseTo(0, 6);
    expect(
      dot({ x: result.pt.x - result.arc.center.x, y: result.pt.y - result.arc.center.y }, rays.ray2.direction),
    ).toBeCloseTo(0, 6);
    expect(cadSignedSweepDeg(result.arc.startAngleDeg, result.arc.endAngleDeg)).toBeCloseTo(-90, 6);
    expect(result.withinPickedExtent).toBe(true);
  });

  it('derives the radius from a tangent extent at the fixed turn angle', () => {
    const rays = rightAngle();
    const outcome = buildCadCurveBetweenTangentRays(rays, { mode: 'tangent', value: 20 });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.metrics.radius).toBeCloseTo(20, 6);
    expect(outcome.result.metrics.deltaDeg).toBeCloseTo(90, 9);
    expect(outcome.result.metrics.tangentLength).toBeCloseTo(20, 9);
  });

  it('returns a typed metric failure for invalid input', () => {
    const rays = rightAngle();
    expect(buildCadCurveBetweenTangentRays(rays, { mode: 'radius', value: 0 })).toEqual({
      ok: false,
      code: 'METRIC_INVALID',
    });
    expect(buildCadCurveBetweenTangentRays(rays, { mode: 'chord', value: -3 })).toEqual({
      ok: false,
      code: 'METRIC_INVALID',
    });
  });

  it('gives identical geometry for Between (trim) and On (no trim)', () => {
    const rays = rightAngle();
    const between = buildCadCurveBetweenTangentRays(rays, { mode: 'radius', value: 40 });
    const on = buildCadCurveBetweenTangentRays(rays, { mode: 'radius', value: 40 });
    expect(between.ok && on.ok).toBe(true);
    if (!between.ok || !on.ok) return;
    expect(on.result.arc).toEqual(between.result.arc);
    expect(on.result.pc).toEqual(between.result.pc);
    expect(on.result.pt).toEqual(between.result.pt);
  });
});

describe('CAD Curves F1 through-point kernel', () => {
  it('solves the symmetric right-angle point on the finite minor sweep', () => {
    const rays = rightAngle();
    const outcome = solveCadCurveThroughTwoTangentRays(rays, { x: 50, y: 50 });
    expect(outcome.ok).toBe(true);
    expect(outcome.candidates).toHaveLength(1);
    if (!outcome.ok) return;
    const { result } = outcome;
    expect(result.metrics.deltaDeg).toBeCloseTo(90, 9);
    expect(cadDistance(result.arc.center, { x: 50, y: 50 })).toBeCloseTo(result.metrics.radius, 6);
    expect(result.pc.x).toBeGreaterThan(0);
    expect(result.pt.y).toBeGreaterThan(0);
  });

  it('solves acute and obtuse corners with the point on the arc', () => {
    for (const angleDeg of [50, 130]) {
      const rays = resolveTwoTangentRays(
        eastLine,
        obliqueLine('line-o', angleDeg),
        { x: 100, y: 0 },
        pickAlong(angleDeg, 100),
      )!;
      const halfRad = ((angleDeg / 2) * Math.PI) / 180;
      const point = { x: Math.cos(halfRad) * 60, y: Math.sin(halfRad) * 60 };
      const outcome = solveCadCurveThroughTwoTangentRays(rays, point);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) continue;
      expect(cadDistance(outcome.result.arc.center, point)).toBeCloseTo(
        outcome.result.metrics.radius,
        6,
      );
      expect(outcome.result.pc.x).toBeGreaterThan(0);
    }
  });

  it('rejects near-line and behind-PI points as no-solution', () => {
    const rays = rightAngle();
    expect(solveCadCurveThroughTwoTangentRays(rays, { x: 60, y: 0 }).ok).toBe(false);
    expect(solveCadCurveThroughTwoTangentRays(rays, { x: 60, y: 0 }).candidates).toHaveLength(0);
    expect(solveCadCurveThroughTwoTangentRays(rays, { x: -50, y: -50 }).ok).toBe(false);
    expect(solveCadCurveThroughTwoTangentRays(rays, { x: -50, y: -50 }).candidates).toHaveLength(0);
  });
});

describe('CAD Curves F1 minimum-distance tangency support', () => {
  it('resolves a target onto the second line and offers both ±distance PTs', () => {
    const rays = rightAngle();
    const resolved = resolveCadCurveMinDistancePt(rays, { x: 20, y: 60 }, 10);
    expect(resolved).not.toBeNull();
    expect(resolved!.candidates).toHaveLength(2);
    expect(resolved!.candidates[0]!.x).toBeCloseTo(0, 6);
    expect(resolved!.candidates[0]!.y).toBeCloseTo(70, 6);
    expect(resolved!.candidates[1]!.y).toBeCloseTo(50, 6);
    expect(resolved!.onSelectedRay).toHaveLength(2);
  });

  it('reports no usable PT when both candidates miss the selected ray', () => {
    const rays = rightAngle();
    const resolved = resolveCadCurveMinDistancePt(rays, { x: 20, y: -60 }, 10);
    expect(resolved).not.toBeNull();
    expect(resolved!.onSelectedRay).toHaveLength(0);
    expect(resolveCadCurveMinDistancePt(rays, { x: 20, y: 60 }, 0)).toBeNull();
  });

  it('keeps the min-distance azimuth consistent with the second ray', () => {
    const rays = rightAngle();
    const resolved = resolveCadCurveMinDistancePt(rays, { x: 40, y: 30 }, 5)!;
    const azimuth = cadAzimuthDeg({ x: 0, y: 0 }, rays.ray2.direction);
    expect(cadNormalizeAngleDeg(azimuth)).toBeCloseTo(0, 9);
    expect(resolved.candidates[0]!.y).toBeCloseTo(35, 6);
  });
});
