import { describe, expect, it } from 'vitest';
import {
  CAD_CURVE_DELTA_CAP_DEG,
  CAD_CURVE_DELTA_FLOOR_DEG,
  CAD_CURVE_DEGREE_BASE_LENGTH,
  buildCadCurveMetricsSummaryFromRadiusDeltaDeg,
  cadBuildCurveMetricsFromRadiusDelta,
  isValidCadCurveDeltaDeg,
  solveCadCurveMetricsFromDelta,
  solveCadCurveMetricsFromRadius,
  type CadCurveMetricMode,
} from '../../src/engine/cad/cadGeometry';

const EXTENT_MODES: CadCurveMetricMode[] = [
  'tangent',
  'chord',
  'arc',
  'external',
  'midOrdinate',
];

const extentValue = (
  mode: CadCurveMetricMode,
  summary: NonNullable<ReturnType<typeof buildCadCurveMetricsSummaryFromRadiusDeltaDeg>>,
): number => {
  switch (mode) {
    case 'tangent':
      return summary.tangentLength;
    case 'chord':
      return summary.chordLength;
    case 'arc':
      return summary.arcLength;
    case 'external':
      return summary.externalDistance;
    case 'midOrdinate':
      return summary.middleOrdinate;
    default:
      throw new Error(`not an extent mode: ${mode}`);
  }
};

describe('CAD Curves F1 metric solver', () => {
  it('round-trips every extent mode across a range of deltas', () => {
    const radius = 100;
    for (const deltaDeg of [15, 30, 60, 90, 120, 150]) {
      const summary = buildCadCurveMetricsSummaryFromRadiusDeltaDeg(radius, deltaDeg);
      expect(summary).not.toBeNull();
      for (const mode of EXTENT_MODES) {
        const value = extentValue(mode, summary!);
        const fromDelta = solveCadCurveMetricsFromDelta({ deltaDeg, mode, value });
        expect(fromDelta?.radius).toBeCloseTo(radius, 6);
        expect(fromDelta?.deltaDeg).toBeCloseTo(deltaDeg, 9);
        const fromRadius = solveCadCurveMetricsFromRadius({ radius, mode, value });
        expect(fromRadius?.deltaDeg).toBeCloseTo(deltaDeg, 6);
        expect(fromRadius?.radius).toBeCloseTo(radius, 9);
      }
    }
  });

  it('defines the two degree-of-curve bases on the 100-unit length', () => {
    const degree = 3;
    const arc = solveCadCurveMetricsFromDelta({ deltaDeg: 45, mode: 'degreeArc', value: degree });
    expect(arc?.radius).toBeCloseTo(
      (CAD_CURVE_DEGREE_BASE_LENGTH * 180) / (Math.PI * degree),
      9,
    );
    // The requested delta is retained; the degree only fixes R.
    expect(arc?.deltaDeg).toBeCloseTo(45, 9);

    const chord = solveCadCurveMetricsFromDelta({
      deltaDeg: 45,
      mode: 'degreeChord',
      value: degree,
    });
    expect(chord?.radius).toBeCloseTo(
      CAD_CURVE_DEGREE_BASE_LENGTH / 2 / Math.sin((degree * Math.PI) / 360),
      9,
    );

    // Known R + degree returns the degree as delta.
    expect(
      solveCadCurveMetricsFromRadius({ radius: arc!.radius, mode: 'degreeArc', value: degree })
        ?.deltaDeg,
    ).toBeCloseTo(degree, 9);
    expect(
      solveCadCurveMetricsFromRadius({ radius: chord!.radius, mode: 'degreeChord', value: degree })
        ?.deltaDeg,
    ).toBeCloseTo(degree, 9);
  });

  it('agrees with the forward metric builder', () => {
    for (const deltaDeg of [20, 75, 140]) {
      const forward = cadBuildCurveMetricsFromRadiusDelta(50, deltaDeg);
      const summary = buildCadCurveMetricsSummaryFromRadiusDeltaDeg(50, deltaDeg);
      expect(summary?.radius).toBeCloseTo(forward!.radius, 12);
      expect(summary?.arcLength).toBeCloseTo(forward!.arcLength, 12);
      expect(summary?.chordLength).toBeCloseTo(forward!.chordLength, 12);
      expect(summary?.tangentLength).toBeCloseTo(forward!.tangentLength, 12);
      const halfRad = (deltaDeg * Math.PI) / 360;
      expect(summary?.externalDistance).toBeCloseTo(50 * (1 / Math.cos(halfRad) - 1), 9);
      expect(summary?.middleOrdinate).toBeCloseTo(50 * (1 - Math.cos(halfRad)), 9);
    }
  });

  it('rejects invalid input without coercion', () => {
    expect(solveCadCurveMetricsFromDelta({ deltaDeg: 0, mode: 'radius', value: 10 })).toBeNull();
    expect(
      solveCadCurveMetricsFromDelta({ deltaDeg: CAD_CURVE_DELTA_CAP_DEG, mode: 'radius', value: 10 }),
    ).toBeNull();
    expect(solveCadCurveMetricsFromDelta({ deltaDeg: 90, mode: 'radius', value: -5 })).toBeNull();
    expect(solveCadCurveMetricsFromDelta({ deltaDeg: 90, mode: 'radius', value: 0 })).toBeNull();
    expect(solveCadCurveMetricsFromDelta({ deltaDeg: Number.NaN, mode: 'radius', value: 10 })).toBeNull();

    expect(solveCadCurveMetricsFromRadius({ radius: 0, mode: 'arc', value: 10 })).toBeNull();
    expect(solveCadCurveMetricsFromRadius({ radius: 50, mode: 'chord', value: 100 })).toBeNull();
    expect(solveCadCurveMetricsFromRadius({ radius: 50, mode: 'midOrdinate', value: 50 })).toBeNull();
    expect(solveCadCurveMetricsFromRadius({ radius: 40, mode: 'degreeChord', value: 3 })).toBeNull();
    expect(solveCadCurveMetricsFromRadius({ radius: 50, mode: 'radius', value: 10 })).toBeNull();

    expect(buildCadCurveMetricsSummaryFromRadiusDeltaDeg(0, 90)).toBeNull();
    expect(buildCadCurveMetricsSummaryFromRadiusDeltaDeg(50, 180)).toBeNull();
    expect(buildCadCurveMetricsSummaryFromRadiusDeltaDeg(50, 1e-12)).toBeNull();

    expect(isValidCadCurveDeltaDeg(CAD_CURVE_DELTA_FLOOR_DEG)).toBe(false);
    expect(isValidCadCurveDeltaDeg(90)).toBe(true);
  });

  it('keeps the degree-arc arc length at 100 only when delta equals the degree', () => {
    const degree = 5;
    const metrics = solveCadCurveMetricsFromRadius({
      radius: (CAD_CURVE_DEGREE_BASE_LENGTH * 180) / (Math.PI * degree),
      mode: 'degreeArc',
      value: degree,
    });
    expect(metrics?.deltaDeg).toBeCloseTo(degree, 9);
    expect(metrics?.arcLength).toBeCloseTo(CAD_CURVE_DEGREE_BASE_LENGTH, 9);
  });
});
