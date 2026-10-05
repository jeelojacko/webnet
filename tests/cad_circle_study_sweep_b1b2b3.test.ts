/** Pins B1/B2/B3 sweep behaviors through CURRENT kernels (study-side, no src/). */
import { describe, expect, it } from 'vitest';
import {
  runSweepCase, endpointsOnlyBounds, centerRadiusBounds, STUDY_CASES,
} from '../scripts/cadCircleStudySweep';

const byTag = (t: string) => runSweepCase(STUDY_CASES.find((c) => c.tag === t)!);

describe('B1/B2/B3 sweep verdicts', () => {
  it('B1 (0/360) normalizes to sweep 360; start==end point', () => {
    const b1 = byTag('B1');
    expect(b1.signedSweepDeg).toBe(360);
    expect(b1.startPoint).toEqual(b1.endPoint);
  });
  it('B2 (theta/theta+360) also sweeps 360; B3 (theta/theta) sweeps 0', () => {
    expect(byTag('B2').signedSweepDeg).toBe(360);
    expect(byTag('B3').signedSweepDeg).toBe(0);
  });
  it('B1 on-sweep admits every quadrant (full coverage); B3 admits everything via zero-magnitude rule', () => {
    const b1 = byTag('B1');
    expect(Object.values(b1.onSweepQuadrants).every(Boolean)).toBe(true);
    const b3 = byTag('B3');
    expect(Object.values(b3.onSweepQuadrants).every(Boolean)).toBe(true);
  });
  it('bounds paths AGREE for all three — B3 via the zero-sweep admits-everything rule (degenerate arc claims full box)', () => {
    expect(byTag('B1').boundsAgree).toBe(true);
    expect(byTag('B2').boundsAgree).toBe(true);
    // SURPRISE: B3 also agrees, because cadIsAngleOnArcSweep sweep-0 returns true for ANY angle,
    // so the endpoints-only path samples all quadrants and reports a full-circle box for a point.
    expect(byTag('B3').boundsAgree).toBe(true);
    expect(byTag('B3').boundsEndpointsOnly).toEqual(byTag('B3').boundsCenterRadius);
  });
  it('endpoints-only B1 box equals center-radius box (all quadrants sampled)', () => {
    expect(endpointsOnlyBounds(100, 200, 50, 0, 360)).toEqual(centerRadiusBounds(100, 200, 50));
  });
  it('circle-circle: secant 2, tangent 1, disjoint 0, concentric 0', () => {
    const b1 = byTag('B1');
    expect(b1.circleCircleSecant).toBe(2);
    expect(b1.circleCircleTangent).toBe(1);
    expect(b1.circleCircleDisjoint).toBe(0);
    expect(b1.circleCircleConcentric).toBe(0);
  });
  it('tangents: 2 outside, 1 on-circle, 0 inside; segment/line hit full circle twice', () => {
    const b1 = byTag('B1');
    expect([b1.tangentCountOutside, b1.tangentCountOnCircle, b1.tangentCountInside]).toEqual([2, 1, 0]);
    expect(b1.segmentIntersections).toBe(2);
    expect(b1.lineIntersections).toBe(2);
  });
  it('transforms: translate/rotate/mirror/uniform apply; non-uniform refuses affine', () => {
    const b1 = byTag('B1');
    const t = b1.transforms as Record<string, Record<string, unknown>>;
    expect(t.translate.applied).toBe(true);
    expect(t.rotate90.applied).toBe(true);
    expect(t.mirror.applied).toBe(true);
    expect(t.uniformScale2.applied).toBe(true);
    expect((t.uniformScale2 as { radius: number }).radius).toBe(100);
    expect(t.nonUniform.applied).toBe(false);
    expect(t.nonUniform.reason).toBe('CAD_TRANSFORM_ARC_AFFINE_UNSUPPORTED');
  });
  it('properties: B1 arc length is circumference, chord 0; B3 both 0', () => {
    const b1 = byTag('B1');
    expect((b1.properties as { arcLength: number }).arcLength).toBeCloseTo(2 * Math.PI * 50, 5);
    expect((b1.properties as { chordLength: number }).chordLength).toBe(0);
    const b3 = byTag('B3');
    expect((b3.properties as { arcLength: number }).arcLength).toBe(0);
  });
  it('DXF ARC path recorded: verbatim start/end, no CIRCLE entity', () => {
    for (const tag of ['B1', 'B2', 'B3']) {
      const r = byTag(tag);
      expect((r.dxf as { codePath: string }).codePath).toContain('dxfExportModel.ts:442-460');
      expect((r.dxf as { note: string }).note).toContain('model.circles absent');
    }
    expect((byTag('B2').dxf as { endDeg: number }).endDeg).toBe(390);
  });
});
