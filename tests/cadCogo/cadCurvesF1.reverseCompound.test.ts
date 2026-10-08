import { describe, expect, it } from 'vitest';
import {
  cadArcEndPoint,
  cadArcEndTangentAzimuthDeg,
  cadBuildContinuedArc,
  cadDistance,
  cadNormalizeAngleDeg,
  cadSignedSweepDeg,
  type CadArcDefinition,
} from '../../src/engine/cad/cadGeometry';
import {
  solveCadCurveMetricsFromRadius,
  type CadCurveMetricMode,
} from '../../src/engine/cad/cadCurveMetricsSolver';
import {
  buildCadCurveReverseOrCompound,
  orientCadCurveReverseCompoundSource,
  type CadCurveReverseCompoundSource,
} from '../../src/engine/cad/cadCurvesReverseCompound';
import {
  cadBuildCompoundCurve,
  cadBuildReverseCurve,
} from '../../src/engine/cad/cadCogo';

const cwSource: CadCurveReverseCompoundSource = {
  centerX: 100,
  centerY: 0,
  radius: 100,
  startAngleDeg: 180,
  endAngleDeg: 90,
};

const ccwSource: CadCurveReverseCompoundSource = {
  centerX: 100,
  centerY: 0,
  radius: 100,
  startAngleDeg: 90,
  endAngleDeg: 180,
};

const arcTangentAzimuth = (arc: CadArcDefinition, atEnd: boolean): number => {
  const point = atEnd ? arc.endPoint : arc.startPoint;
  const radial = { x: point.x - arc.center.x, y: point.y - arc.center.y };
  const sweep = cadSignedSweepDeg(arc.startAngleDeg, arc.endAngleDeg);
  const tangent = sweep >= 0 ? { x: -radial.y, y: radial.x } : { x: radial.y, y: -radial.x };
  return cadNormalizeAngleDeg((Math.atan2(tangent.x, tangent.y) * 180) / Math.PI);
};

describe('CAD Curves F1 reverse / compound', () => {
  it('keeps the source turn sign for compound and flips it for reverse (CW source)', () => {
    const compound = buildCadCurveReverseOrCompound(cwSource, {
      mode: 'compound',
      end: 'end',
      radius: 50,
      extent: { mode: 'arc', value: 40 },
    })!;
    const reverse = buildCadCurveReverseOrCompound(cwSource, {
      mode: 'reverse',
      end: 'end',
      radius: 50,
      extent: { mode: 'arc', value: 40 },
    })!;
    expect(cadSignedSweepDeg(compound.arc.startAngleDeg, compound.arc.endAngleDeg)).toBeLessThan(0);
    expect(cadSignedSweepDeg(reverse.arc.startAngleDeg, reverse.arc.endAngleDeg)).toBeGreaterThan(0);
  });

  it('keeps the source turn sign for compound and flips it for reverse (CCW source)', () => {
    const compound = buildCadCurveReverseOrCompound(ccwSource, {
      mode: 'compound',
      end: 'end',
      radius: 50,
      extent: { mode: 'arc', value: 40 },
    })!;
    const reverse = buildCadCurveReverseOrCompound(ccwSource, {
      mode: 'reverse',
      end: 'end',
      radius: 50,
      extent: { mode: 'arc', value: 40 },
    })!;
    expect(cadSignedSweepDeg(compound.arc.startAngleDeg, compound.arc.endAngleDeg)).toBeGreaterThan(0);
    expect(cadSignedSweepDeg(reverse.arc.startAngleDeg, reverse.arc.endAngleDeg)).toBeLessThan(0);
  });

  it('joins at the exact source endpoint with a G1 tangent', () => {
    const compound = buildCadCurveReverseOrCompound(cwSource, {
      mode: 'compound',
      end: 'end',
      radius: 50,
      extent: { mode: 'tangent', value: 20 },
    })!;
    expect(cadDistance(compound.start, cadArcEndPoint(cwSource))).toBeLessThan(1e-9);
    const sourceTangent = cadArcEndTangentAzimuthDeg(cwSource);
    const resultTangent = arcTangentAzimuth(compound.arc, false);
    const diff = Math.abs(cadNormalizeAngleDeg(resultTangent) - cadNormalizeAngleDeg(sourceTangent));
    expect(Math.min(diff, 360 - diff)).toBeLessThan(1e-6);
  });

  it('agrees with the separate reverse/compound builders', () => {
    const metrics = solveCadCurveMetricsFromRadius({
      radius: 50,
      mode: 'arc',
      value: 40,
    })!;
    const compound = buildCadCurveReverseOrCompound(cwSource, {
      mode: 'compound',
      end: 'end',
      radius: 50,
      extent: { mode: 'arc', value: 40 },
    })!;
    const reverse = buildCadCurveReverseOrCompound(cwSource, {
      mode: 'reverse',
      end: 'end',
      radius: 50,
      extent: { mode: 'arc', value: 40 },
    })!;
    expect(compound.arc).toEqual(
      cadBuildCompoundCurve({ sourceArc: cwSource, radius: 50, deltaDeg: metrics.deltaDeg }),
    );
    expect(reverse.arc).toEqual(
      cadBuildReverseCurve({ sourceArc: cwSource, radius: 50, deltaDeg: metrics.deltaDeg }),
    );
  });

  it('orients the source backwards for end: start', () => {
    const oriented = orientCadCurveReverseCompoundSource(cwSource, 'start');
    expect(oriented.startAngleDeg).toBe(cwSource.endAngleDeg);
    expect(oriented.endAngleDeg).toBe(cwSource.startAngleDeg);
    const result = buildCadCurveReverseOrCompound(cwSource, {
      mode: 'compound',
      end: 'start',
      radius: 50,
      extent: { mode: 'arc', value: 40 },
    })!;
    // Original start point of cwSource is (0, 0).
    expect(cadDistance(result.start, { x: 0, y: 0 })).toBeLessThan(1e-9);
  });

  it('supports every extent mode', () => {
    const modes: CadCurveMetricMode[] = [
      'tangent',
      'chord',
      'arc',
      'external',
      'midOrdinate',
      'degreeArc',
      'degreeChord',
    ];
    for (const mode of modes) {
      const value = mode === 'degreeArc' || mode === 'degreeChord' ? 5 : 25;
      const expected = solveCadCurveMetricsFromRadius({ radius: 120, mode, value });
      const result = buildCadCurveReverseOrCompound(cwSource, {
        mode: 'compound',
        end: 'end',
        radius: 120,
        extent: { mode, value },
      });
      expect(expected).not.toBeNull();
      expect(result).not.toBeNull();
      expect(result!.arc.radius).toBeCloseTo(120, 9);
      expect(result!.arc.deltaDeg).toBeCloseTo(expected!.deltaDeg, 9);
    }
  });

  it('delegates point-end continuation to the shared continued-arc law', () => {
    const point = { x: 220, y: 80 };
    const viaKernel = buildCadCurveReverseOrCompound(cwSource, {
      mode: 'compound',
      end: 'end',
      radius: 50,
      extent: { mode: 'arc', value: 40 },
      pointEnd: point,
    })!;
    expect(viaKernel.arc).toEqual(cadBuildContinuedArc(cwSource, point, false));
    const reversed = buildCadCurveReverseOrCompound(cwSource, {
      mode: 'reverse',
      end: 'end',
      radius: 50,
      extent: { mode: 'arc', value: 40 },
      pointEnd: point,
    })!;
    expect(reversed.arc).toEqual(cadBuildContinuedArc(cwSource, point, true));
  });
});
