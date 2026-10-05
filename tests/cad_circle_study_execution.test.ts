/** Execution pins for review findings B1/B2/M3/M5 (study-side, calls real production paths). */
import { describe, expect, it } from 'vitest';
import { cadSignedSweepDeg } from '../src/engine/cad/cadGeometry';
import {
  runArcPathStudy,
  runBlockExpansionB1,
  runBlockNonUniformScale,
  runDxfArcB1,
  runSnapGripB1,
} from '../scripts/cadCircleStudyExecution';

describe('B1 block expansion sweep', () => {
  it('identity expansion normalizes 0/360 to 0/0: signed sweep lost (measured)', () => {
    const r = runBlockExpansionB1() as {
      identity: { startAngleDeg: number; endAngleDeg: number }; sweepLost: boolean;
    };
    expect(r.identity.startAngleDeg).toBe(0);
    expect(r.identity.endAngleDeg).toBe(0);
    expect(r.sweepLost).toBe(true);
  });
  it('rotation preserves the collapse: 30-degree insert yields 30/30', () => {
    const r = runBlockExpansionB1() as {
      rotated30: { startAngleDeg: number; endAngleDeg: number };
    };
    expect(r.rotated30.startAngleDeg).toBe(30);
    expect(r.rotated30.endAngleDeg).toBe(30);
    expect(cadSignedSweepDeg(r.rotated30.startAngleDeg, r.rotated30.endAngleDeg)).toBe(0);
  });
});

describe('B2 non-uniform block scaling', () => {
  it('block route mean-scales (r=75) and never refuses; entity route refuses affine', () => {
    const r = runBlockNonUniformScale() as {
      blockRoute: { applied: boolean; refused: boolean; radius: number };
      entityRoute: { ok: boolean; reason: string };
      refusalCoversBlockRoute: boolean;
    };
    expect(r.blockRoute.applied).toBe(true);
    expect(r.blockRoute.refused).toBe(false);
    expect(r.blockRoute.radius).toBe(75);
    expect(r.entityRoute.ok).toBe(false);
    expect(r.entityRoute.reason).toBe('CAD_TRANSFORM_ARC_AFFINE_UNSUPPORTED');
    expect(r.refusalCoversBlockRoute).toBe(false);
  });
});

describe('M3 snap/grip leakage (executed queries)', () => {
  it('entity level: 2 endpoints emitted, 1 observable after dedupe; arc-midpoint leaks', () => {
    const r = runSnapGripB1() as {
      entityEndpointEmitted: number; entityEndpointObservable: number;
      entityEmitted: Record<string, number>;
    };
    expect(r.entityEndpointEmitted).toBe(2);
    expect(r.entityEndpointObservable).toBe(1);
    expect(r.entityEmitted['arc-midpoint']).toBe(1);
    expect(r.entityEmitted.center).toBe(1);
  });
  it('block level: arc-child endpoints emitted coincident; dedupe merges them', () => {
    const r = runSnapGripB1() as { blockEndpointEmitted: number; blockEndpointObservable: number };
    expect(r.blockEndpointEmitted).toBeGreaterThanOrEqual(2);
    expect(r.blockEndpointObservable).toBeLessThan(r.blockEndpointEmitted);
  });
  it('grips leak: two coincident arc-start/arc-end grips emitted (no grip dedupe)', () => {
    const r = runSnapGripB1() as { gripsLeaked: number; grips: Array<{ kind: string; x: number; y: number }> };
    expect(r.gripsLeaked).toBe(2);
    expect(r.grips.length).toBe(3);
  });
});

describe('M5 executed render + interchange', () => {
  it('arcPath: B1/B2 take the two-arc branch; B3 is a degenerate single arc', () => {
    const r = runArcPathStudy() as {
      b1: { twoArcBranch: boolean; arcSegments: number };
      b2: { twoArcBranch: boolean; arcSegments: number };
      b3: { degenerateSingleArc: boolean; arcSegments: number };
    };
    expect(r.b1.twoArcBranch).toBe(true);
    expect(r.b1.arcSegments).toBe(2);
    expect(r.b2.twoArcBranch).toBe(true);
    expect(r.b3.degenerateSingleArc).toBe(true);
  });
  it('DXF: real serializer emits ARC 0/360 verbatim, no CIRCLE; host trip labelled UNEXECUTED', () => {
    const r = runDxfArcB1() as {
      serializedGroups: Record<string, string>; hasCircleEntity: boolean;
      hostImportRoundTrip: string;
      modelArcs: Array<{ startDeg: number; endDeg: number }>;
    };
    expect(r.modelArcs).toEqual([{ startDeg: 0, endDeg: 360, radius: 50 }]);
    expect(r.serializedGroups['50']).toBe('0');
    expect(r.serializedGroups['51']).toBe('360');
    expect(r.hasCircleEntity).toBe(false);
    expect(r.hostImportRoundTrip).toContain('UNEXECUTED');
  });
});
