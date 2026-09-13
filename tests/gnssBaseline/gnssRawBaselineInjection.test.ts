/**
 * Phase 12J.0 §23 (acceptance K) — downstream injection proof.
 *
 * EVIDENCE ONLY: synthetic literals only, no vendor bytes, no intake path,
 * no production-code changes. Passes on CI.
 *
 * The P041→sixtwo vector + covariance below are hand-copied display values
 * from the local TBC session report 292d3b4c.7.html
 * (P041 --- sixtwo (B32), session S32; file sha256
 * 5844f9ccc33d769c8784075fab320945c25ad2c3f99fda63b9f2c8082ee8c66b).
 * The remaining triangle legs are synthetic filler closing the loop.
 */
import { describe, expect, it } from 'vitest';
import { runGnssBaselineAdjustment } from '../../src/engine/gnssBaselineAdjust';
import type { GnssBaselineObservation } from '../../src/engine/gnssBaselineTypes';
import type { StationMap } from '../../src/types';

// TBC B32 mark-to-mark ECEF vector (m), display-rounded to 1 mm.
const TBC_DX = 5822.646;
const TBC_DY = -5654.885;
const TBC_DZ = -4846.085;

// TBC B32 aposteriori covariance (m^2), lower triangle as reported.
const TBC_COV = {
  xx: 0.0000247718,
  xy: 0.0000655581,
  xz: -0.0000531839,
  yy: 0.0003463746,
  yz: -0.0002570615,
  zz: 0.0002267204,
};

// P041 CORS apriori XYZ (m), the established open-RINEX reference point.
const P041 = { x: -1283634.1259, y: -4726427.8882, h: 4074798.0251 };

const fixed = (p: { x: number; y: number; h: number }) => ({
  ...p,
  fixed: true,
  fixedX: true,
  fixedY: true,
  fixedH: true,
});

const free = (p: { x: number; y: number; h: number }) => ({
  ...p,
  fixed: false,
  fixedX: false,
  fixedY: false,
  fixedH: false,
});

describe('12J.0 TBC vector downstream injection proof (synthetic)', () => {
  it('TBC covariance is finite with positive determinant (full SPD acceptance proven via the weighting path below)', () => {
    const values = [TBC_COV.xx, TBC_COV.xy, TBC_COV.xz, TBC_COV.yy, TBC_COV.yz, TBC_COV.zz];
    expect(values.every(Number.isFinite)).toBe(true);
    const { xx, xy, xz, yy, yz, zz } = TBC_COV;
    const det =
      xx * (yy * zz - yz * yz) - xy * (xy * zz - yz * xz) + xz * (xy * yz - yy * xz);
    expect(det).toBeGreaterThan(0);
  });

  it('constrained adjustment accepts the TBC vector + covariance, converges, keeps provenance', () => {
    const sixtwo = { x: P041.x + TBC_DX, y: P041.y + TBC_DY, h: P041.h + TBC_DZ };
    const hanna = { x: sixtwo.x - 1473.0, y: sixtwo.y + 349.0, h: sixtwo.h - 30.0 };
    const stations: StationMap = { P041: fixed(P041), sixtwo: free(sixtwo), hanna: free(hanna) };
    const diag = { xx: 25e-6, xy: 0, xz: 0, yy: 25e-6, yz: 0, zz: 25e-6 };
    const baselines: GnssBaselineObservation[] = [
      {
        type: 'gnssBaseline',
        id: 1,
        from: 'P041',
        to: 'sixtwo',
        vector: { x: TBC_DX, y: TBC_DY, z: TBC_DZ },
        covariance: { ...TBC_COV },
        frame: 'ecef',
        sessionId: 'S32',
        solutionId: 'B32',
        sourceFile: '292d3b4c.7.html',
      },
      {
        type: 'gnssBaseline',
        id: 2,
        from: 'sixtwo',
        to: 'hanna',
        vector: { x: hanna.x - sixtwo.x, y: hanna.y - sixtwo.y, z: hanna.h - sixtwo.h },
        covariance: { ...diag },
        frame: 'ecef',
        sessionId: 'SYNTH',
        solutionId: 'SYN2',
        sourceFile: 'synthetic',
      },
      {
        type: 'gnssBaseline',
        id: 3,
        from: 'P041',
        to: 'hanna',
        vector: { x: hanna.x - P041.x, y: hanna.y - P041.y, z: hanna.h - P041.h },
        covariance: { ...diag },
        frame: 'ecef',
        sessionId: 'SYNTH',
        solutionId: 'SYN3',
        sourceFile: 'synthetic',
      },
    ];
    // Production constrained entry — no throw means the TBC covariance
    // passed the finite/SPD weighting path.
    const result = runGnssBaselineAdjustment({ stations, baselines });
    expect(result.converged).toBe(true);
    expect(result.dof).toBe(3);
    // Provenance round-trips: residuals key back to the injected baselines.
    const byId = new Map(result.residuals.map((r) => [r.baselineId, r]));
    expect(byId.get(1)?.from).toBe('P041');
    expect(byId.get(1)?.to).toBe('sixtwo');
    const r1 = byId.get(1);
    expect(Number.isFinite(r1?.vX)).toBe(true);
    expect(Number.isFinite(r1?.vY)).toBe(true);
    expect(Number.isFinite(r1?.vZ)).toBe(true);
    expect(result.residuals).toHaveLength(3);
    expect(result.statistics).toHaveLength(3);
  });
});
