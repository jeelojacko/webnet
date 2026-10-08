import { describe, expect, it } from 'vitest';
import { cadDistance, cadSignedSweepDeg } from '../../src/engine/cad/cadGeometry';
import {
  solveCadCurveMetricsFromRadius,
  type CadCurveMetricMode,
} from '../../src/engine/cad/cadCurveMetricsSolver';
import {
  buildCadCurveFromEndPoint,
  buildCadCurveFromEndRadius,
  resolveCadCurveFromEndBase,
  type CadCurveContinuationSource,
} from '../../src/engine/cad/cadCurvesFromEnd';

const eastLine: CadCurveContinuationSource = {
  kind: 'line',
  start: { x: 0, y: 0 },
  end: { x: 100, y: 0 },
};

const quarterArc: CadCurveContinuationSource = {
  kind: 'arc',
  center: { x: 0, y: 0 },
  radius: 100,
  startAngleDeg: 180,
  endAngleDeg: 90,
};

describe('CAD Curves F1 From End base resolution', () => {
  it('takes the nearest line endpoint and points outward', () => {
    const line: CadCurveContinuationSource = {
      kind: 'line',
      start: { x: -100, y: 0 },
      end: { x: 0, y: 0 },
    };
    const atStart = resolveCadCurveFromEndBase(line, { x: -90, y: 0 });
    expect(atStart?.point.x).toBeCloseTo(-100, 9);
    expect(atStart?.outgoingAzimuthDeg).toBeCloseTo(270, 6);
    expect(atStart?.reversed).toBe(false);

    const atEnd = resolveCadCurveFromEndBase(line, { x: -10, y: 0 });
    expect(atEnd?.point.x).toBeCloseTo(0, 9);
    expect(atEnd?.outgoingAzimuthDeg).toBeCloseTo(90, 6);
  });

  it('continues an arc forward at the end and reverses at the start', () => {
    const atEnd = resolveCadCurveFromEndBase(quarterArc, { x: 70, y: 70 });
    expect(atEnd?.point.x).toBeCloseTo(0, 6);
    expect(atEnd?.point.y).toBeCloseTo(100, 6);
    expect(atEnd?.outgoingAzimuthDeg).toBeCloseTo(90, 6);
    expect(atEnd?.reversed).toBe(false);

    const atStart = resolveCadCurveFromEndBase(quarterArc, { x: -70, y: 70 });
    expect(atStart?.point.x).toBeCloseTo(-100, 6);
    expect(atStart?.point.y).toBeCloseTo(0, 6);
    expect(atStart?.outgoingAzimuthDeg).toBeCloseTo(180, 6);
    expect(atStart?.reversed).toBe(true);
  });
});

describe('CAD Curves F1 From End point mode', () => {
  it('builds the circle through start/end tangent to the outgoing direction', () => {
    const result = buildCadCurveFromEndPoint(eastLine, { x: 90, y: 0 }, { x: 150, y: 50 });
    expect(result).not.toBeNull();
    expect(result!.start.x).toBeCloseTo(100, 6);
    expect(result!.start.y).toBeCloseTo(0, 6);
    expect(result!.end.x).toBeCloseTo(150, 6);
    expect(result!.end.y).toBeCloseTo(50, 6);
    expect(result!.arc.radius).toBeCloseTo(50, 6);
    expect(result!.arc.deltaDeg).toBeCloseTo(90, 6);
  });

  it('rejects collinear and coincident point input', () => {
    expect(buildCadCurveFromEndPoint(eastLine, { x: 90, y: 0 }, { x: 200, y: 0 })).toBeNull();
    expect(buildCadCurveFromEndPoint(eastLine, { x: 90, y: 0 }, { x: 100, y: 0 })).toBeNull();
  });
});

describe('CAD Curves F1 From End radius mode', () => {
  const modes: CadCurveMetricMode[] = [
    'tangent',
    'chord',
    'arc',
    'external',
    'midOrdinate',
    'degreeArc',
    'degreeChord',
  ];

  it('delegates every extent mode to the shared metric solver', () => {
    for (const mode of modes) {
      const value = mode === 'degreeArc' || mode === 'degreeChord' ? 5 : 25;
      const expected = solveCadCurveMetricsFromRadius({ radius: 120, mode, value });
      const result = buildCadCurveFromEndRadius(eastLine, { x: 90, y: 0 }, {
        signedRadius: 120,
        mode,
        value,
      });
      expect(expected).not.toBeNull();
      expect(result).not.toBeNull();
      expect(result!.arc.radius).toBeCloseTo(120, 9);
      expect(result!.arc.deltaDeg).toBeCloseTo(expected!.deltaDeg, 9);
    }
  });

  it('applies the sign law: positive = right/CW, negative = left/CCW', () => {
    const positive = buildCadCurveFromEndRadius(eastLine, { x: 90, y: 0 }, {
      signedRadius: 50,
      mode: 'arc',
      value: 30,
    })!;
    const negative = buildCadCurveFromEndRadius(eastLine, { x: 90, y: 0 }, {
      signedRadius: -50,
      mode: 'arc',
      value: 30,
    })!;
    expect(positive.arc.radius).toBeCloseTo(50, 9);
    expect(negative.arc.radius).toBeCloseTo(50, 9);
    expect(cadSignedSweepDeg(positive.arc.startAngleDeg, positive.arc.endAngleDeg)).toBeLessThan(0);
    expect(cadSignedSweepDeg(negative.arc.startAngleDeg, negative.arc.endAngleDeg)).toBeGreaterThan(0);
    expect(cadDistance(positive.start, negative.start)).toBeLessThan(1e-9);
  });

  it('rejects zero and invalid radii', () => {
    expect(
      buildCadCurveFromEndRadius(eastLine, { x: 90, y: 0 }, {
        signedRadius: 0,
        mode: 'arc',
        value: 30,
      }),
    ).toBeNull();
    expect(
      buildCadCurveFromEndRadius(eastLine, { x: 90, y: 0 }, {
        signedRadius: 50,
        mode: 'midOrdinate',
        value: 60,
      }),
    ).toBeNull();
  });
});
