import { describe, expect, it } from 'vitest';
import {
  CAD_LINE_POINT_RANGE_MAX_POINTS,
  parseCadLineAzimuthDistance,
  parseCadLineBearingDistance,
  parseCadLineExtensionTarget,
  parseCadLineLatLong,
  parseCadLineLeftRightAngleDistance,
  parseCadLineNorthEast,
  parseCadLinePointRange,
  parseCadLineSideShot,
  parseCadLineSignedDistance,
} from '../src/engine/cad/cadLineParsers';

const okValue = <T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T => {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}`);
  return result.value;
};

describe('L1 point range parser', () => {
  it('expands ascending, descending and mixed ranges', () => {
    expect(okValue(parseCadLinePointRange('1-3'))).toEqual(['1', '2', '3']);
    expect(okValue(parseCadLinePointRange('10-8'))).toEqual(['10', '9', '8']);
    expect(okValue(parseCadLinePointRange('1-3,7,10-8'))).toEqual(['1', '2', '3', '7', '10', '9', '8']);
  });

  it('tolerates whitespace and single tokens between ranges', () => {
    expect(okValue(parseCadLinePointRange(' 1 - 3 , 7 , 10-8 '))).toEqual(['1', '2', '3', '7', '10', '9', '8']);
  });

  it('rejects the whole request on any non-integer or empty token (no silent discard)', () => {
    for (const text of ['1-3,foo,7', '1A,2', '1-3.5', '--', '1-,2', '1,,2', ',1,2', '1,2,']) {
      expect(parseCadLinePointRange(text), text).toMatchObject({
        ok: false,
        error: { code: 'POINT_RANGE_INVALID_TOKEN' },
      });
    }
    // A single valid id is still a too-short chain, not an invalid token.
    expect(parseCadLinePointRange('5')).toMatchObject({ ok: false, error: { code: 'POINT_RANGE_TOO_SHORT' } });
  });

  it('rejects adjacent duplicates atomically', () => {
    expect(parseCadLinePointRange('1-3,3')).toMatchObject({ ok: false, error: { code: 'POINT_RANGE_DUPLICATE' } });
  });

  it('rejects an oversized range before allocating (DoS guard, no hang)', () => {
    // A range whose span dwarfs the documented cap fails closed immediately.
    const started = Date.now();
    expect(parseCadLinePointRange('1-99999999')).toMatchObject({
      ok: false,
      error: { code: 'POINT_RANGE_TOO_LARGE' },
    });
    // Total expansion across tokens is capped too, not just a single range.
    expect(parseCadLinePointRange('1-4000,1-4000')).toMatchObject({
      ok: false,
      error: { code: 'POINT_RANGE_TOO_LARGE' },
    });
    // The cap itself is allowed (boundary is inclusive).
    expect(okValue(parseCadLinePointRange(`1-${CAD_LINE_POINT_RANGE_MAX_POINTS}`))).toHaveLength(
      CAD_LINE_POINT_RANGE_MAX_POINTS,
    );
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('rejects endpoints beyond the safe-integer range without looping', () => {
    expect(parseCadLinePointRange('1-9007199254740993')).toMatchObject({
      ok: false,
      error: { code: 'POINT_RANGE_UNSAFE_INTEGER' },
    });
    expect(parseCadLinePointRange('9007199254740993,1')).toMatchObject({
      ok: false,
      error: { code: 'POINT_RANGE_UNSAFE_INTEGER' },
    });
    // Max safe integer endpoints parse safely (span check rejects the expansion).
    expect(parseCadLinePointRange(`1-${Number.MAX_SAFE_INTEGER}`)).toMatchObject({
      ok: false,
      error: { code: 'POINT_RANGE_TOO_LARGE' },
    });
  });
});

describe('L1 coordinate pair parsers', () => {
  it('maps Northing,Easting asymmetrically to east/north', () => {
    expect(okValue(parseCadLineNorthEast('1000,2000'))).toEqual({ east: 2000, north: 1000 });
  });

  it('validates latitude/longitude range', () => {
    expect(okValue(parseCadLineLatLong('45,-75'))).toEqual({ latitudeDeg: 45, longitudeDeg: -75 });
    expect(parseCadLineLatLong('91,0')).toMatchObject({ ok: false, error: { code: 'LATLONG_OUT_OF_RANGE' } });
    expect(parseCadLineLatLong('0,181')).toMatchObject({ ok: false, error: { code: 'LATLONG_OUT_OF_RANGE' } });
  });
});

describe('L1 direction parsers', () => {
  it('parses bearing and azimuth distances', () => {
    expect(okValue(parseCadLineBearingDistance('N45-30-00E,100'))).toEqual({ bearing: 'N45-30-00E', distance: 100 });
    expect(okValue(parseCadLineAzimuthDistance('45.5,100'))).toEqual({ azimuthDeg: 45.5, distance: 100 });
    expect(okValue(parseCadLineAzimuthDistance('45-30-00,100'))).toEqual({ azimuthDeg: 45.5, distance: 100 });
    expect(okValue(parseCadLineAzimuthDistance('410,10')).azimuthDeg).toBeCloseTo(50, 9);
  });

  it('parses turned-angle L/R distances', () => {
    expect(okValue(parseCadLineLeftRightAngleDistance('L 45-30-00, 100'))).toEqual({
      side: 'left',
      angleDeg: 45.5,
      distance: 100,
    });
    expect(okValue(parseCadLineLeftRightAngleDistance('R30,10'))).toEqual({
      side: 'right',
      angleDeg: 30,
      distance: 10,
    });
    expect(parseCadLineLeftRightAngleDistance('X30,10')).toMatchObject({ ok: false });
  });

  it('parses signed deltas and explicit totals', () => {
    expect(okValue(parseCadLineExtensionTarget('+5'))).toEqual({ kind: 'delta', delta: 5 });
    expect(okValue(parseCadLineExtensionTarget('-3.5'))).toEqual({ kind: 'delta', delta: -3.5 });
    expect(okValue(parseCadLineExtensionTarget('T10'))).toEqual({ kind: 'total', total: 10 });
    expect(okValue(parseCadLineExtensionTarget('TOTAL=10'))).toEqual({ kind: 'total', total: 10 });
    expect(parseCadLineExtensionTarget('T0')).toMatchObject({ ok: false, error: { code: 'DISTANCE_OUT_OF_RANGE' } });
  });

  it('parses signed distances with an explicit or implicit sign above the floor', () => {
    expect(okValue(parseCadLineSignedDistance('50'))).toBe(50);
    expect(okValue(parseCadLineSignedDistance('+50'))).toBe(50);
    expect(okValue(parseCadLineSignedDistance('-50'))).toBe(-50);
    expect(okValue(parseCadLineSignedDistance(' .5 '))).toBe(0.5);
    expect(okValue(parseCadLineSignedDistance('1e3'))).toBe(1000);
    expect(parseCadLineSignedDistance('0')).toMatchObject({ ok: false, error: { code: 'DISTANCE_OUT_OF_RANGE' } });
    expect(parseCadLineSignedDistance('1e-12')).toMatchObject({
      ok: false,
      error: { code: 'DISTANCE_OUT_OF_RANGE' },
    });
    expect(parseCadLineSignedDistance('abc')).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });
});

describe('L1 side-shot parser', () => {
  it('requires explicit mode prefixes and parses each mode', () => {
    expect(okValue(parseCadLineSideShot('BN45-00-00E,100'))).toMatchObject({ mode: 'bearing', distance: 100 });
    expect(okValue(parseCadLineSideShot('AZ 90, 50'))).toMatchObject({ mode: 'azimuth', azimuthDeg: 90, distance: 50 });
    expect(okValue(parseCadLineSideShot('TR30,10'))).toMatchObject({ mode: 'turn', side: 'right', angleDeg: 30 });
    expect(okValue(parseCadLineSideShot('DL 30, 10'))).toMatchObject({ mode: 'deflection', side: 'left' });
    expect(parseCadLineSideShot('L30,10')).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });
});
