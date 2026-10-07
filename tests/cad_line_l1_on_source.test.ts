import { describe, expect, it } from 'vitest';
import {
  cadLineLeftNormal,
  cadLineSourceDirection,
  cadLineSourceResidualTolerance,
  isCadLineSourceEntity,
  projectCadLinePointOntoSource,
  resolveCadLineOnSourcePoint,
  resolveCadLineRayClick,
  resolveCadLineRayEndpoint,
  resolveCadLineSourceFrame,
} from '../src/engine/cad/cadLineOnSourceResolvers';
import type { CadArcEntity, CadCircleEntity, CadLineEntity } from '../src/engine/cad/cadTypes';

const okValue = <T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T => {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}`);
  return result.value;
};

const line = (fromX: number, fromY: number, toX: number, toY: number): CadLineEntity => ({
  id: 'line:1',
  type: 'line',
  layerId: 'general',
  visible: true,
  locked: false,
  fromStationId: 'A',
  toStationId: 'B',
  fromX,
  fromY,
  toX,
  toY,
  sourceObservationIds: [],
});

const arc = (
  startAngleDeg: number,
  endAngleDeg: number,
  radius = 50,
): CadArcEntity => ({
  id: 'arc:1',
  type: 'arc',
  layerId: 'general',
  visible: true,
  locked: false,
  centerX: 0,
  centerY: 0,
  radius,
  startAngleDeg,
  endAngleDeg,
});

const circle = (radius = 50): CadCircleEntity => ({
  id: 'circle:1',
  type: 'circle',
  layerId: 'general',
  visible: true,
  locked: false,
  centerX: 0,
  centerY: 0,
  radius,
});

describe('L1 on-source: source narrowing and tolerances', () => {
  it('accepts only line/arc/circle as corrected-mode sources', () => {
    expect(isCadLineSourceEntity(line(0, 0, 1, 0))).toBe(true);
    expect(isCadLineSourceEntity(arc(0, 90))).toBe(true);
    expect(isCadLineSourceEntity(circle())).toBe(true);
    expect(isCadLineSourceEntity(null)).toBe(false);
    expect(
      isCadLineSourceEntity({
        id: 'poly:1',
        type: 'polyline',
        layerId: 'general',
        visible: true,
        locked: false,
        vertices: [],
        vertexLabels: [],
        closed: false,
      }),
    ).toBe(false);
  });

  it('scales the residual tolerance with the source but never below the floor', () => {
    expect(cadLineSourceResidualTolerance(100)).toBeCloseTo(5, 9);
    expect(cadLineSourceResidualTolerance(0)).toBeGreaterThan(0);
  });
});

describe('L1 on-source: line finite-segment membership', () => {
  const source = line(0, 0, 100, 0);

  it('projects an interior pick exactly onto the segment', () => {
    expect(projectCadLinePointOntoSource(source, { x: 40, y: 3 })).toEqual({
      ok: true,
      value: { x: 40, y: 0 },
    });
  });

  it('clamps a pick within tolerance of an endpoint to the exact endpoint', () => {
    expect(projectCadLinePointOntoSource(source, { x: 103, y: 0 })).toEqual({
      ok: true,
      value: { x: 100, y: 0 },
    });
  });

  it('rejects a pick beyond the finite segment and a wildly-off pick', () => {
    expect(projectCadLinePointOntoSource(source, { x: 120, y: 0 })).toMatchObject({
      ok: false,
      error: { code: 'NO_SOLUTION' },
    });
    expect(projectCadLinePointOntoSource(source, { x: 50, y: 30 })).toMatchObject({
      ok: false,
      error: { code: 'NO_SOLUTION' },
    });
  });

  it('rejects non-finite picks and degenerate sources without NaN', () => {
    expect(projectCadLinePointOntoSource(source, { x: Number.NaN, y: 0 })).toMatchObject({
      ok: false,
      error: { code: 'NON_FINITE' },
    });
    expect(projectCadLinePointOntoSource(line(5, 5, 5, 5), { x: 5, y: 5 })).toMatchObject({
      ok: false,
      error: { code: 'DEGENERATE' },
    });
  });
});

describe('L1 on-source: arc/circle radial projection and sweep', () => {
  it('radially projects an on-sweep arc pick to the true circle', () => {
    const resolved = okValue(projectCadLinePointOntoSource(arc(0, 180), { x: 0, y: 50 }));
    expect(resolved.x).toBeCloseTo(0, 9);
    expect(resolved.y).toBeCloseTo(50, 9);
  });

  it('rejects an off-sweep arc pick and an off-circle pick', () => {
    expect(projectCadLinePointOntoSource(arc(0, 180), { x: 0, y: -50 })).toMatchObject({
      ok: false,
      error: { code: 'OFF_SWEEP' },
    });
    expect(projectCadLinePointOntoSource(arc(0, 180), { x: 0, y: 60 })).toMatchObject({
      ok: false,
      error: { code: 'NO_SOLUTION' },
    });
  });

  it('projects circles without a sweep restriction and rejects a center pick', () => {
    const resolved = okValue(projectCadLinePointOntoSource(circle(), { x: 0, y: -50 }));
    expect(resolved.y).toBeCloseTo(-50, 9);
    expect(projectCadLinePointOntoSource(circle(), { x: 0, y: 0 })).toMatchObject({
      ok: false,
      error: { code: 'NO_SOLUTION' },
    });
  });

  it('rejects a degenerate radius', () => {
    expect(projectCadLinePointOntoSource(circle(0), { x: 0, y: 0 })).toMatchObject({
      ok: false,
      error: { code: 'DEGENERATE' },
    });
  });
});

describe('L1 on-source: tangent and normal frames (sign law)', () => {
  it('line forward tangent is from→to and the normal is the LEFT normal', () => {
    const frame = okValue(resolveCadLineSourceFrame(line(0, 0, 100, 0), { x: 40, y: 0 }));
    expect(frame.tangent.x).toBeCloseTo(1, 9);
    expect(frame.tangent.y).toBeCloseTo(0, 9);
    // Left of east is north.
    expect(frame.normal.x).toBeCloseTo(0, 9);
    expect(frame.normal.y).toBeCloseTo(1, 9);
    expect(cadLineLeftNormal({ x: 1, y: 0 })).toEqual({ x: 0, y: 1 });
  });

  it('arc forward tangent follows the signed sweep and the normal is outward', () => {
    // CCW sweep 0→180 at angle 90°: forward is −x, outward radial is +y.
    const ccw = okValue(resolveCadLineSourceFrame(arc(0, 180), { x: 0, y: 50 }));
    expect(ccw.tangent.x).toBeCloseTo(-1, 9);
    expect(ccw.tangent.y).toBeCloseTo(0, 9);
    expect(ccw.normal.x).toBeCloseTo(0, 9);
    expect(ccw.normal.y).toBeCloseTo(1, 9);
    expect(ccw.tangent.x * ccw.normal.x + ccw.tangent.y * ccw.normal.y).toBeCloseTo(0, 9);

    // CW sweep 180→0 reverses the travel tangent at the same point.
    const cw = okValue(resolveCadLineSourceFrame(arc(180, 0), { x: 0, y: 50 }));
    expect(cw.tangent.x).toBeCloseTo(1, 9);
    expect(cw.normal.y).toBeCloseTo(1, 9);
  });

  it('circle forward tangent is counter-clockwise and the normal is outward', () => {
    const frame = okValue(resolveCadLineSourceFrame(circle(), { x: 50, y: 0 }));
    expect(frame.normal.x).toBeCloseTo(1, 9);
    expect(frame.normal.y).toBeCloseTo(0, 9);
    expect(frame.tangent.x).toBeCloseTo(0, 9);
    expect(frame.tangent.y).toBeCloseTo(1, 9);
  });

  it('selects the direction by mode and rejects a center-coincident point', () => {
    const frame = okValue(resolveCadLineSourceFrame(line(0, 0, 100, 0), { x: 40, y: 0 }));
    expect(cadLineSourceDirection(frame, 'tangent')).toEqual(frame.tangent);
    expect(cadLineSourceDirection(frame, 'normal')).toEqual(frame.normal);
    expect(resolveCadLineSourceFrame(circle(), { x: 0, y: 0 })).toMatchObject({
      ok: false,
      error: { code: 'DEGENERATE' },
    });
  });

  it('composes projection + frame for both modes', () => {
    const tangent = okValue(resolveCadLineOnSourcePoint(line(0, 0, 100, 0), { x: 40, y: 2 }));
    expect(tangent.point).toEqual({ x: 40, y: 0 });
    expect(tangent.tangent).toEqual({ x: 1, y: 0 });
    const normal = okValue(resolveCadLineOnSourcePoint(circle(), { x: 50, y: 0 }));
    expect(normal.point.x).toBeCloseTo(50, 9);
    expect(normal.normal.x).toBeCloseTo(1, 9);
  });
});

describe('L1 on-source: ray distance and click law', () => {
  const origin = { x: 10, y: 10 };
  const direction = { x: 1, y: 0 };

  it('resolves a signed endpoint and rejects zero/sub-floor/non-finite distance', () => {
    expect(okValue(resolveCadLineRayEndpoint(origin, direction, 25))).toEqual({ x: 35, y: 10 });
    expect(okValue(resolveCadLineRayEndpoint(origin, direction, -25))).toEqual({ x: -15, y: 10 });
    expect(resolveCadLineRayEndpoint(origin, direction, 0)).toMatchObject({
      ok: false,
      error: { code: 'DISTANCE_OUT_OF_RANGE' },
    });
    expect(resolveCadLineRayEndpoint(origin, direction, 1e-12)).toMatchObject({
      ok: false,
      error: { code: 'DISTANCE_OUT_OF_RANGE' },
    });
    expect(resolveCadLineRayEndpoint(origin, direction, Number.NaN)).toMatchObject({
      ok: false,
      error: { code: 'NON_FINITE' },
    });
  });

  it('constrains an endpoint click to the nearest ray (never array order)', () => {
    expect(okValue(resolveCadLineRayClick(origin, direction, { x: 40, y: 18 }))).toMatchObject({
      signedDistance: 30,
      endpoint: { x: 40, y: 10 },
    });
    expect(okValue(resolveCadLineRayClick(origin, direction, { x: -20, y: 12 }))).toMatchObject({
      signedDistance: -30,
      endpoint: { x: -20, y: 10 },
    });
  });

  it('fails closed on a perpendicular-bisector tie', () => {
    expect(resolveCadLineRayClick(origin, direction, { x: 10, y: 40 })).toMatchObject({
      ok: false,
      error: { code: 'AMBIGUOUS_POINT' },
    });
  });
});
