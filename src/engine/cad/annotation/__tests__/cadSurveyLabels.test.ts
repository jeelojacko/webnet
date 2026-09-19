import { describe, expect, it } from 'vitest';
import { cadAzimuthDeg, cadDistance } from '../../cadGeometry';
import { formatCadBearing } from '../../cadCogoSummaries';
import { cadBuildCurveMetricsSummaryFromRadiusDelta } from '../../cadCogoCurveMetrics';
import { uprightRotation } from '../../cadSurfaceContourView';
import {
  bearingLabelPlacement,
  deriveBearingDistanceLabel,
  deriveCurveLabel,
} from '../cadSurveyLabels';

const base = {
  content: 'bearing-distance' as const,
  separator: '\n',
  distancePrecision: 3,
};

describe('deriveBearingDistanceLabel', () => {
  it('bearing is string-identical to formatCadBearing for N / E / SW lines', () => {
    const cases: Array<{ from: { x: number; y: number }; to: { x: number; y: number } }> = [
      { from: { x: 0, y: 0 }, to: { x: 0, y: 100 } }, // north, azimuth 0
      { from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }, // east, azimuth 90
      { from: { x: 0, y: 0 }, to: { x: -100, y: -100 } }, // south-west, azimuth 225
    ];
    for (const { from, to } of cases) {
      const label = deriveBearingDistanceLabel({ ...base, from, to });
      expect(label.bearing).toBe(formatCadBearing(cadAzimuthDeg(from, to)));
    }
    expect(deriveBearingDistanceLabel({ ...base, ...cases[0] }).bearing).toBe('N00-00-00.00E');
    expect(deriveBearingDistanceLabel({ ...base, ...cases[1] }).bearing).toBe('N90-00-00.00E');
    expect(deriveBearingDistanceLabel({ ...base, ...cases[2] }).bearing).toBe('S45-00-00.00W');
  });

  it('distance matches cadDistance and composes content lines', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 3, y: 4 };
    const label = deriveBearingDistanceLabel({ ...base, from, to });
    expect(label.distance).toBe(cadDistance(from, to).toFixed(3));
    expect(label.text).toBe(`${label.bearing}\n${label.distance}`);

    const reversed = deriveBearingDistanceLabel({
      ...base,
      from,
      to,
      content: 'distance-bearing',
    });
    expect(reversed.text).toBe(`${label.distance}\n${label.bearing}`);

    expect(deriveBearingDistanceLabel({ ...base, from, to, content: 'bearing' }).text).toBe(
      label.bearing,
    );
    expect(deriveBearingDistanceLabel({ ...base, from, to, content: 'distance' }).text).toBe(
      label.distance,
    );
  });

  it('separator joins the content lines', () => {
    const label = deriveBearingDistanceLabel({
      ...base,
      from: { x: 0, y: 0 },
      to: { x: 3, y: 4 },
      separator: '  ',
    });
    expect(label.text).toBe(`${label.bearing}  ${label.distance}`);
  });

  it('midpoint and along-line readable rotation', () => {
    const east = deriveBearingDistanceLabel({
      ...base,
      from: { x: 0, y: 0 },
      to: { x: 10, y: 0 },
    });
    expect(east.midpoint).toEqual({ x: 5, y: 0 });
    expect(east.rotationDeg).toBe(0);

    const north = deriveBearingDistanceLabel({
      ...base,
      from: { x: 0, y: 0 },
      to: { x: 0, y: 10 },
    });
    expect(north.rotationDeg).toBe(uprightRotation(90));
  });

  it('manual text override passes through while values still compute', () => {
    const derived = deriveBearingDistanceLabel({ ...base, from: { x: 0, y: 0 }, to: { x: 3, y: 4 } });
    const overridden = deriveBearingDistanceLabel({
      ...base,
      from: { x: 0, y: 0 },
      to: { x: 3, y: 4 },
      manualTextOverride: 'STA 1-2',
    });
    expect(overridden.text).toBe('STA 1-2');
    expect(overridden.bearing).toBe(derived.bearing);
    expect(overridden.distance).toBe(derived.distance);
  });

  it('is invariant to a large coordinate translation', () => {
    const small = deriveBearingDistanceLabel({ ...base, from: { x: 0, y: 0 }, to: { x: 3, y: 4 } });
    const large = deriveBearingDistanceLabel({
      ...base,
      from: { x: 1e9, y: 1e9 },
      to: { x: 1e9 + 3, y: 1e9 + 4 },
    });
    expect(large.bearing).toBe(small.bearing);
    expect(large.distance).toBe(small.distance);
    expect(large.text).toBe(small.text);
    expect(large.rotationDeg).toBe(small.rotationDeg);
    expect(large.midpoint).toEqual({ x: 1e9 + 1.5, y: 1e9 + 2 });
  });
});

describe('bearingLabelPlacement', () => {
  it('returns the midpoint at zero offset with readable rotation', () => {
    const placement = bearingLabelPlacement({ x: 0, y: 0 }, { x: 10, y: 0 }, 0);
    expect(placement).toEqual({ x: 5, y: 0, rotationDeg: 0 });
  });

  it('offsets along the left/right normal', () => {
    const left = bearingLabelPlacement({ x: 0, y: 0 }, { x: 10, y: 0 }, 2, 'left');
    expect(left).toEqual({ x: 5, y: 2, rotationDeg: 0 });
    const right = bearingLabelPlacement({ x: 0, y: 0 }, { x: 10, y: 0 }, 2, 'right');
    expect(right).toEqual({ x: 5, y: -2, rotationDeg: 0 });
  });

  it('flips upside-down text back to the readable half-plane', () => {
    // Westbound line: raw angle 180 folds to 0.
    const west = bearingLabelPlacement({ x: 10, y: 0 }, { x: 0, y: 0 }, 0);
    expect(west.rotationDeg).toBe(0);
    // North-west diagonal: raw angle 135 folds to -45.
    const nw = bearingLabelPlacement({ x: 0, y: 0 }, { x: -10, y: 10 }, 0);
    expect(nw.rotationDeg).toBe(-45);
  });

  it('degenerate zero-length line stays at the point with zero rotation', () => {
    expect(bearingLabelPlacement({ x: 4, y: 7 }, { x: 4, y: 7 }, 3)).toEqual({
      x: 4,
      y: 7,
      rotationDeg: 0,
    });
  });
});

describe('deriveCurveLabel', () => {
  it('matches cadBuildCurveMetricsSummaryFromRadiusDelta (R=50, delta=90)', () => {
    const metrics = cadBuildCurveMetricsSummaryFromRadiusDelta(50, 90);
    expect(metrics).not.toBeNull();
    const label = deriveCurveLabel({
      center: { x: 0, y: 0 },
      radius: 50,
      startAngleDeg: 0,
      endAngleDeg: 90,
      fields: ['radius', 'delta', 'length', 'chord'],
      decimalPrecision: 3,
    });
    expect(label).not.toBeNull();
    expect(label!.radius).toBe(metrics!.radius);
    expect(label!.deltaDeg).toBe(metrics!.deltaDeg);
    expect(label!.arcLength).toBeCloseTo(metrics!.arcLength, 12);
    expect(label!.chordLength).toBeCloseTo(metrics!.chordLength, 12);
    // R=50, delta=90: L = 50*pi/2, C = 2*50*sin(45deg).
    expect(label!.arcLength).toBeCloseTo(78.5398163397, 9);
    expect(label!.chordLength).toBeCloseTo(70.7106781187, 9);
    expect(label!.text).toBe("R 50.000\n\u0394 90\u00b000'00\"\nL 78.540\nC 70.711");
  });

  it('emits fields in the requested order', () => {
    const label = deriveCurveLabel({
      center: { x: 0, y: 0 },
      radius: 50,
      startAngleDeg: 0,
      endAngleDeg: 90,
      fields: ['chord', 'radius'],
      decimalPrecision: 2,
    });
    expect(label!.text).toBe('C 70.71\nR 50.00');
  });

  it('returns null when the metrics helper rejects the inputs', () => {
    expect(
      deriveCurveLabel({
        center: { x: 0, y: 0 },
        radius: -1,
        startAngleDeg: 0,
        endAngleDeg: 90,
        fields: ['radius'],
        decimalPrecision: 3,
      }),
    ).toBeNull();
    expect(
      deriveCurveLabel({
        center: { x: 0, y: 0 },
        radius: 50,
        startAngleDeg: 0,
        endAngleDeg: 200,
        fields: ['radius'],
        decimalPrecision: 3,
      }),
    ).toBeNull();
  });

  it('manual text override passes through while metrics still compute', () => {
    const label = deriveCurveLabel({
      center: { x: 0, y: 0 },
      radius: 50,
      startAngleDeg: 0,
      endAngleDeg: 90,
      fields: ['radius'],
      decimalPrecision: 3,
      manualTextOverride: 'CURVE 1',
    });
    expect(label!.text).toBe('CURVE 1');
    expect(label!.radius).toBe(50);
    expect(label!.deltaDeg).toBe(90);
  });
});
