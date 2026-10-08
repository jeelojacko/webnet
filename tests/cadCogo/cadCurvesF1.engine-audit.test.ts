import { describe, expect, it } from 'vitest';
import {
  cadArcPointByArcDistance,
  cadArcPointByChordDistance,
  cadArcSubdivisionPoints,
  cadOffsetArc,
  cadSolveCurveMetrics,
} from '../../src/engine/cad/cadCogo';
import {
  buildCadCurveChain,
  cadDistance,
  cadEqualChordDistance,
  cadEqualChordStepDeg,
  cadSignedSweepDeg,
  resolveTwoTangentRays,
} from '../../src/engine/cad/cadGeometry';

const quarterArc = {
  centerX: 0,
  centerY: 0,
  radius: 100,
  startAngleDeg: 0,
  endAngleDeg: 90,
};

describe('CAD Curves F1 SUBDIVIDE chord law', () => {
  it('equal-chord points advance by d = 2 asin(C/2R), consecutive chords equal C', () => {
    const chord = 20;
    const points = cadArcSubdivisionPoints({ arc: quarterArc, mode: 'chord', value: chord });
    const stepDeg = cadEqualChordStepDeg(quarterArc.radius, chord)!;
    const expectedCount = Math.floor((90 - 1e-9) / stepDeg);
    expect(points).toHaveLength(expectedCount);

    const start = {
      x: Math.cos((quarterArc.startAngleDeg * Math.PI) / 180) * quarterArc.radius,
      y: Math.sin((quarterArc.startAngleDeg * Math.PI) / 180) * quarterArc.radius,
    };
    let previous = start;
    points.forEach((point, index) => {
      const oracle = cadEqualChordDistance(
        quarterArc.radius,
        { x: quarterArc.centerX, y: quarterArc.centerY },
        quarterArc.startAngleDeg,
        chord,
        index + 1,
      )!;
      expect(cadDistance(previous, point)).toBeCloseTo(oracle, 9);
      expect(cadDistance(previous, point)).toBeCloseTo(chord, 9);
      previous = point;
    });
    // Last point stays strictly before the end of the arc.
    const lastAngle = Math.atan2(points[points.length - 1]!.y, points[points.length - 1]!.x);
    expect((lastAngle * 180) / Math.PI).toBeLessThan(90);
  });

  it('rejects a chord at or beyond the diameter', () => {
    expect(cadArcSubdivisionPoints({ arc: quarterArc, mode: 'chord', value: 200 })).toEqual([]);
    expect(cadArcSubdivisionPoints({ arc: quarterArc, mode: 'chord', value: 250 })).toEqual([]);
  });

  it('refuses an unbounded equal-count family past the cap', () => {
    expect(cadArcSubdivisionPoints({ arc: quarterArc, mode: 'equal', value: 200000 })).toEqual([]);
    expect(cadArcSubdivisionPoints({ arc: quarterArc, mode: 'equal', value: 4 })).toHaveLength(3);
  });

  it('keeps arc-length stepping evenly spaced', () => {
    const interval = 30;
    const points = cadArcSubdivisionPoints({ arc: quarterArc, mode: 'arc', value: interval });
    expect(points).toHaveLength(Math.floor(((Math.PI * 100) / 2 - 1e-9) / interval));
    const expectedChord = 2 * quarterArc.radius * Math.sin(interval / (2 * quarterArc.radius));
    const start = { x: 100, y: 0 };
    let previous = start;
    points.forEach((point) => {
      expect(cadDistance(previous, point)).toBeCloseTo(expectedChord, 6);
      previous = point;
    });
  });
});

describe('CAD Curves F1 OFFSET side law', () => {
  it('CCW arc: left reduces radius, right increases it', () => {
    const ccw = { centerX: 0, centerY: 0, radius: 50, startAngleDeg: 0, endAngleDeg: 90 };
    expect(cadSignedSweepDeg(ccw.startAngleDeg, ccw.endAngleDeg)).toBeGreaterThan(0);
    expect(cadOffsetArc({ arc: ccw, offsetDistance: 10, side: 'left' })?.radius).toBeCloseTo(40, 9);
    expect(cadOffsetArc({ arc: ccw, offsetDistance: 10, side: 'right' })?.radius).toBeCloseTo(60, 9);
  });

  it('CW arc: left increases radius, right reduces it', () => {
    const cw = { centerX: 0, centerY: 0, radius: 50, startAngleDeg: 90, endAngleDeg: 0 };
    expect(cadSignedSweepDeg(cw.startAngleDeg, cw.endAngleDeg)).toBeLessThan(0);
    expect(cadOffsetArc({ arc: cw, offsetDistance: 10, side: 'left' })?.radius).toBeCloseTo(60, 9);
    expect(cadOffsetArc({ arc: cw, offsetDistance: 10, side: 'right' })?.radius).toBeCloseTo(40, 9);
  });

  it('rejects an offset that collapses the radius', () => {
    const ccw = { centerX: 0, centerY: 0, radius: 10, startAngleDeg: 0, endAngleDeg: 90 };
    expect(cadOffsetArc({ arc: ccw, offsetDistance: 10, side: 'left' })).toBeNull();
  });
});

describe('CAD Curves F1 POINT_ON_CURVE bounds', () => {
  it('accepts the endpoints and rejects out-of-range distances', () => {
    const end = cadArcPointByArcDistance(quarterArc, (Math.PI * 100) / 2)!;
    expect(end.x).toBeCloseTo(0, 9);
    expect(end.y).toBeCloseTo(100, 9);
    expect(cadArcPointByArcDistance(quarterArc, -1)).toBeNull();
    expect(cadArcPointByArcDistance(quarterArc, (Math.PI * 100) / 2 + 1)).toBeNull();
    expect(cadArcPointByChordDistance(quarterArc, 0)).not.toBeNull();
    expect(cadArcPointByChordDistance(quarterArc, 0)!.x).toBeCloseTo(100, 6);
    expect(cadArcPointByChordDistance(quarterArc, -5)).toBeNull();
    expect(cadArcPointByChordDistance(quarterArc, 500)).toBeNull();
  });
});

describe('CAD Curves F1 CURVE_SOLVER pairs', () => {
  const radius = 100;
  const deltaDeg = 60;
  const deltaRad = (deltaDeg * Math.PI) / 180;
  const arcLength = radius * deltaRad;
  const chordLength = 2 * radius * Math.sin(deltaRad / 2);
  const tangentLength = radius * Math.tan(deltaRad / 2);
  const pairs: Array<[Parameters<typeof cadSolveCurveMetrics>[0]['pair'], number, number]> = [
    ['radius-delta', radius, deltaDeg],
    ['radius-arc', radius, arcLength],
    ['radius-chord', radius, chordLength],
    ['radius-tangent', radius, tangentLength],
    ['delta-arc', deltaDeg, arcLength],
    ['delta-chord', deltaDeg, chordLength],
    ['delta-tangent', deltaDeg, tangentLength],
    ['arc-chord', arcLength, chordLength],
    ['arc-tangent', arcLength, tangentLength],
    ['chord-tangent', chordLength, tangentLength],
  ];

  it.each(pairs)('round-trips %s', (pair, firstValue, secondValue) => {
    const solution = cadSolveCurveMetrics({ pair, firstValue, secondValue });
    expect(solution).not.toBeNull();
    expect(solution!.radius).toBeCloseTo(radius, 6);
    expect(solution!.deltaDeg).toBeCloseTo(deltaDeg, 6);
  });
});

describe('CAD Curves F1 chain sign law', () => {
  const eastLine = { entityId: 'a', start: { x: -300, y: 0 }, end: { x: 300, y: 0 } };
  const northLine = { entityId: 'b', start: { x: 0, y: -300 }, end: { x: 0, y: 300 } };
  const rays = () =>
    resolveTwoTangentRays(eastLine, northLine, { x: 80, y: 0 }, { x: 0, y: 80 })!;

  it('rejects a floating curve that would turn the opposite way', () => {
    // Non-floating alone exceeds the 90-degree turn, so the floating residual
    // would have to turn backwards.
    const outcome = buildCadCurveChain(rays(), [
      { radius: 10, length: 30 },
      { radius: 100, length: 0, floating: true },
    ]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('CURVES_CANNOT_FIT');
  });
});
