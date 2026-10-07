import { describe, expect, it } from 'vitest';
import {
  pickCadLineReferenceStartEndpoint,
  resolveCadLineAzimuthEndpoint,
  resolveCadLineBearingEndpoint,
  resolveCadLineDeflectionEndpoint,
  resolveCadLinePerpendicularFoot,
  resolveCadLineTangentFromPoint,
  resolveCadLineTurnedAngleEndpoint,
} from '../src/engine/cad/cadLineConstruction';

const okValue = <T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T => {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}`);
  return result.value;
};

describe('L1 directional endpoints', () => {
  it('resolves bearing endpoints via cadParseBearingDegrees', () => {
    const point = okValue(resolveCadLineBearingEndpoint({ from: { x: 0, y: 0 }, bearing: 'N45E', distance: 10 }));
    expect(point.x).toBeCloseTo(Math.SQRT1_2 * 10, 9);
    expect(point.y).toBeCloseTo(Math.SQRT1_2 * 10, 9);
  });

  it('resolves azimuth endpoints (0 = North, clockwise)', () => {
    const east = okValue(resolveCadLineAzimuthEndpoint({ from: { x: 0, y: 0 }, azimuthDeg: 90, distance: 10 }));
    expect(east.x).toBeCloseTo(10, 9);
    expect(east.y).toBeCloseTo(0, 9);
    const north = okValue(resolveCadLineAzimuthEndpoint({ from: { x: 0, y: 0 }, azimuthDeg: 0, distance: 10 }));
    expect(north.x).toBeCloseTo(0, 9);
    expect(north.y).toBeCloseTo(10, 9);
  });

  it('applies the WebNet turned-angle convention (right = clockwise)', () => {
    const right = okValue(
      resolveCadLineTurnedAngleEndpoint({
        occupy: { x: 0, y: 0 },
        backsight: { x: 0, y: 1 },
        side: 'right',
        angleDeg: 90,
        distance: 10,
      }),
    );
    expect(right.point.x).toBeCloseTo(10, 9);
    expect(right.point.y).toBeCloseTo(0, 9);
    const left = okValue(
      resolveCadLineTurnedAngleEndpoint({
        occupy: { x: 0, y: 0 },
        backsight: { x: 0, y: 1 },
        side: 'left',
        angleDeg: 90,
        distance: 10,
      }),
    );
    expect(left.point.x).toBeCloseTo(-10, 9);
    expect(left.point.y).toBeCloseTo(0, 9);
  });

  it('applies the deflection convention from the forward course', () => {
    const right = okValue(
      resolveCadLineDeflectionEndpoint({
        lineStart: { x: 0, y: 0 },
        lineEnd: { x: 10, y: 0 },
        side: 'right',
        angleDeg: 90,
        distance: 5,
      }),
    );
    expect(right.point.x).toBeCloseTo(10, 9);
    expect(right.point.y).toBeCloseTo(-5, 9);
    const left = okValue(
      resolveCadLineDeflectionEndpoint({
        lineStart: { x: 0, y: 0 },
        lineEnd: { x: 10, y: 0 },
        side: 'left',
        angleDeg: 90,
        distance: 5,
      }),
    );
    expect(left.point.y).toBeCloseTo(5, 9);
  });

  it('bounds deflection angles', () => {
    for (const angleDeg of [0, 180, 181]) {
      expect(
        resolveCadLineDeflectionEndpoint({
          lineStart: { x: 0, y: 0 },
          lineEnd: { x: 10, y: 0 },
          side: 'right',
          angleDeg,
          distance: 5,
        }),
      ).toMatchObject({ ok: false, error: { code: 'ANGLE_OUT_OF_RANGE' } });
    }
  });
});

describe('L1 reference endpoint pick', () => {
  it('picks the nearer endpoint and fails closed on a midpoint tie', () => {
    const near = okValue(
      pickCadLineReferenceStartEndpoint({
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 },
        pickPoint: { x: 1, y: 0 },
      }),
    );
    expect(near.endpoint).toBe('start');
    expect(
      pickCadLineReferenceStartEndpoint({
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 },
        pickPoint: { x: 5, y: 0 },
      }),
    ).toMatchObject({ ok: false, error: { code: 'AMBIGUOUS_ENDPOINT' } });
  });
});

describe('L1 perpendicular and tangent', () => {
  it('drops a perpendicular foot onto the supporting line', () => {
    expect(
      okValue(
        resolveCadLinePerpendicularFoot({
          lineStart: { x: 0, y: 0 },
          lineEnd: { x: 10, y: 0 },
          from: { x: 3, y: 5 },
        }),
      ),
    ).toEqual({ x: 3, y: 0 });
  });

  it('solves both tangents with exact tangency and side intent', () => {
    const inputs = { center: { x: 0, y: 0 }, radius: 5, from: { x: 10, y: 0 } } as const;
    const right = okValue(resolveCadLineTangentFromPoint({ ...inputs, side: 'right' }));
    const left = okValue(resolveCadLineTangentFromPoint({ ...inputs, side: 'left' }));
    expect(left).not.toEqual(right);
    for (const point of [right, left]) {
      expect(Math.hypot(point.x, point.y)).toBeCloseTo(5, 9);
      const toPoint = { x: point.x - 10, y: point.y };
      expect(toPoint.x * point.x + toPoint.y * point.y).toBeCloseTo(0, 6);
    }
  });

  it('rejects a selected tangency point off the finite arc sweep', () => {
    const base = { center: { x: 0, y: 0 }, radius: 5, from: { x: 10, y: 0 } } as const;
    const right = resolveCadLineTangentFromPoint({ ...base, side: 'right', startAngleDeg: 0, endAngleDeg: 120 });
    const left = resolveCadLineTangentFromPoint({ ...base, side: 'left', startAngleDeg: 0, endAngleDeg: 120 });
    expect(right.ok).toBe(true);
    expect(left).toMatchObject({ ok: false, error: { code: 'OFF_SWEEP' } });
  });

  it('fails closed for a point inside the circle', () => {
    expect(
      resolveCadLineTangentFromPoint({ center: { x: 0, y: 0 }, radius: 5, from: { x: 1, y: 0 }, side: 'left' }),
    ).toMatchObject({ ok: false, error: { code: 'NO_SOLUTION' } });
  });
});
