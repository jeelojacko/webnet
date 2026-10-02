/**
 * Phase 20L — offset-radius topology suite (§4,6 evidence).
 *
 * Independent audit of every claimed-buildable exact offset strip: finite
 * XYZ, valid CCW indices, positive plan area, no duplicate/interior overlap,
 * edge incidence ≤ 2, one edge-connected component, simple open daylight,
 * no coincident-unshared edge, and reported-vs-triangulated area. Also
 * pins that a collapse/inversion claims NO strip, and that the audit detects
 * an injected defect rather than trusting the constructor.
 */
import { describe, expect, it } from 'vitest';

import { validateGradingMeshTopology } from '../src/engine/cad/grading/gradingTopology';
import { auditMesh } from '../scripts/phase20kHybridArcPairAudit';
import {
  buildOffsetBand,
  type OffsetBand,
  type StudyArc,
} from '../scripts/phase20lOffsetRadiusAudit';

const DEG = Math.PI / 180;

const arc = (over: Partial<StudyArc> = {}): StudyArc => ({
  centerX: 0, centerY: 0, radius: 252.5, startAngle: 0.3, sweepRad: 90 * DEG,
  sweepCCW: true, startZ: 100, endZ: 100, ...over,
});

const pass = (result: ReturnType<typeof buildOffsetBand>): OffsetBand => {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return result as OffsetBand;
};

describe('phase20l §4 buildable offset strip topology audit', () => {
  const band = pass(buildOffsetBand(arc(), 'right', 20, 0.5, 0));

  it('passes the independent audit and the production topology validator', () => {
    expect(band.audit.pass).toBe(true);
    expect(band.audit.issues).toEqual([]);
    expect(band.topology.ok).toBe(true);
    expect(band.vertices).toBeGreaterThan(3);
    expect(band.triangles).toBeGreaterThan(1);
  });

  it('has finite XYZ, valid indices, positive plan area and single component', () => {
    expect(band.mesh.points.every((v) => Number.isFinite(v))).toBe(true);
    expect(band.mesh.triangles.every((i) => Number.isInteger(i) && i >= 0 && i < band.vertices)).toBe(true);
    expect(band.audit.checks.positivePlanArea).toBe(true);
    expect(band.audit.checks.indices).toBe(true);
    expect(band.audit.checks.finite).toBe(true);
    expect(band.audit.components).toBe(1);
    expect(band.audit.edgeComponents).toBe(1);
    expect(band.audit.boundaryEdges).toBeGreaterThan(0);
  });

  it('has no duplicate triangle, no interior overlap and edge incidence ≤ 2', () => {
    expect(band.audit.checks.noDuplicateTriangle).toBe(true);
    expect(band.audit.checks.noInteriorOverlap).toBe(true);
    expect(band.audit.checks.edgeIncidence).toBe(true);
    expect(band.diagnostic).toContain('nonSharedCoincidentEdges=0');
    expect(band.diagnostic).toContain('weldedDegenerate=0');
  });

  it('keeps an open simple daylight and a consistent reported-vs-triangulated area', () => {
    expect(band.audit.checks.daylight).toBe(true);
    expect(band.audit.checks.noBridge).toBe(true);
    expect(band.planArea).toBeGreaterThan(0);
    expect(band.analyticPlanArea).toBeGreaterThan(0);
    // Chord-linearized band area under-estimates the exact annular sector by
    // the chord sagitta; bounded at 5% for the coarse study tolerance.
    expect(band.planAreaRelError).toBeLessThan(0.05);
    expect(band.area3d).toBeGreaterThanOrEqual(band.planArea - 1e-9);
  });

  it('is deterministic', () => {
    const again = pass(buildOffsetBand(arc(), 'right', 20, 0.5, 0));
    expect(JSON.stringify(again.mesh)).toBe(JSON.stringify(band.mesh));
    expect(again.planArea).toBe(band.planArea);
  });
});

describe('phase20l §4 collapse / inversion claims no strip', () => {
  it('refuses to build at exact Roff = 0 with OFFSET_RADIUS_COLLAPSE', () => {
    const collapse = buildOffsetBand(arc({ radius: 60 }), 'left', 60, 0.5, 0);
    expect(collapse.ok).toBe(false);
    if (!collapse.ok) {
      expect(collapse.code).toBe('OFFSET_RADIUS_COLLAPSE');
      expect(collapse.detail).toContain('0');
    }
  });

  it('refuses to build an inverted offset with OFFSET_RADIUS_INVERTED', () => {
    const inverted = buildOffsetBand(arc({ radius: 60 }), 'left', 66, 0.5, 0);
    expect(inverted.ok).toBe(false);
    if (!inverted.ok) expect(inverted.code).toBe('OFFSET_RADIUS_INVERTED');
  });

  it('refuses an unlinearizable whole-circle source', () => {
    const invalid = buildOffsetBand(arc({ sweepRad: 2 * Math.PI }), 'right', 20, 0.5, 0);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.code).toBe('OFFSET_RADIUS_NONFINITE');
  });

  it('rejects negative distance with ok:false, never ok:true', () => {
    const bad = buildOffsetBand(arc({ radius: 60 }), 'right', -5, 0.5, 0);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe('OFFSET_RADIUS_NONFINITE');
  });

  it('rejects nonfinite arc fields, grade and tolerance with ok:false', () => {
    expect(buildOffsetBand(arc({ radius: Number.NaN }), 'right', 20, 0.5, 0).ok).toBe(false);
    expect(buildOffsetBand(arc({ radius: -10 }), 'right', 20, 0.5, 0).ok).toBe(false);
    expect(buildOffsetBand(arc({ sweepRad: Number.NaN }), 'right', 20, 0.5, 0).ok).toBe(false);
    expect(buildOffsetBand(arc(), 'right', 20, 0.5, Number.NaN).ok).toBe(false);
    expect(buildOffsetBand(arc(), 'right', 20, Number.NaN, 0).ok).toBe(false);
    expect(buildOffsetBand(arc({ centerX: Number.POSITIVE_INFINITY }), 'right', 20, 0.5, 0).ok).toBe(false);
  });

  it('ok:true implies finite geometry and positive plan area', () => {
    for (const radius of [10, 60, 252.5]) {
      for (const sweepDeg of [1, 45, 179.9]) {
        for (const ratio of [0.1, 0.5, 0.9, 1.1]) {
          const r = buildOffsetBand(
            arc({ radius, sweepRad: sweepDeg * DEG }), 'right', ratio * radius, 0.5, 0,
          );
          if (r.ok) {
            expect(Number.isFinite(r.planArea)).toBe(true);
            expect(r.planArea).toBeGreaterThan(0);
            expect(Number.isFinite(r.area3d)).toBe(true);
            expect(r.mesh.points.every(Number.isFinite)).toBe(true);
          } else {
            expect(r.code).not.toBeUndefined();
          }
        }
      }
    }
  });

  it('refuses a zero-distance (zero-area) band with ok:false, never ok:true', () => {    const zero = buildOffsetBand(arc({ radius: 60 }), 'right', 0, 0.5, 0);
    expect(zero.ok).toBe(false);
    if (!zero.ok) {
      expect(zero.code).toBe('OFFSET_RADIUS_OK');
      expect(zero.detail).toContain('zero-area');
    }
  });

  it('refuses NaN / infinite distance inputs with ok:false, never ok:true', () => {
    for (const d of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const bad = buildOffsetBand(arc(), 'right', d, 0.5, 0);
      expect(bad.ok, `d=${d}`).toBe(false);
      if (!bad.ok) expect(bad.code, `d=${d}`).toBe('OFFSET_RADIUS_NONFINITE');
    }
  });

  it('builds a tiny positive Roff exactly (no collapse band)', () => {
    const tiny = buildOffsetBand(arc({ radius: 60 }), 'left', 60 - 1e-9, 0.5, 0);
    expect(tiny.ok, JSON.stringify(tiny)).toBe(true);
  });

  it('ok:true implies both audits pass — failed topology never returns ok:true', () => {
    for (const radius of [10, 60, 252.5]) {
      for (const sweepDeg of [1, 45, 179.9]) {
        for (const ratio of [0, 0.5, 1, 1.5, Number.NaN]) {
          const r = buildOffsetBand(
            arc({ radius, sweepRad: sweepDeg * DEG }), 'left', ratio * radius, 0.5, 0,
          );
          if (r.ok) {
            expect(r.audit.pass, `R=${radius} sweep=${sweepDeg} ratio=${ratio}`).toBe(true);
            expect(r.topology.ok, `R=${radius} sweep=${sweepDeg} ratio=${ratio}`).toBe(true);
          }
        }
      }
    }
  });
});

describe('phase20l §4 large-coordinate strip stays auditable', () => {
  it('translates the strip to E≈1e6/N≈1e6 and still passes', () => {
    const band = pass(buildOffsetBand(arc({ centerX: 1e6, centerY: 1e6 }), 'right', 20, 0.5, 0));
    expect(band.audit.pass).toBe(true);
    expect(band.topology.ok).toBe(true);
    expect(band.mesh.points.every((v) => Number.isFinite(v))).toBe(true);
    expect(band.planAreaRelError).toBeLessThan(0.05);
    // Plan area is translation-invariant.
    const local = pass(buildOffsetBand(arc(), 'right', 20, 0.5, 0));
    expect(Math.abs(band.planArea - local.planArea)).toBeLessThan(1e-6 * local.planArea);
  });
});

describe('phase20l §4 the audit catches an injected defect', () => {
  const band = pass(buildOffsetBand(arc(), 'right', 20, 0.5, 0));

  it('flags a duplicate triangle', () => {
    const points = [...band.mesh.points];
    const triangles = [...band.mesh.triangles, band.mesh.triangles[0]!, band.mesh.triangles[1]!, band.mesh.triangles[2]!];
    const injected = auditMesh({ points, triangles }, band.daylight, false, band.planArea);
    expect(injected.checks.noDuplicateTriangle).toBe(false);
    expect(injected.pass).toBe(false);
    expect(validateGradingMeshTopology(points, triangles).ok).toBe(false);
  });

  it('flags a non-manifold third face on an interior edge', () => {
    const points = [...band.mesh.points];
    // New apex far off the band; attach it to an interior edge (s1, o1).
    const apex = points.length / 3;
    points.push(band.mesh.points[0]! + 500, band.mesh.points[1]! + 500, band.mesh.points[2]!);
    const o1 = band.daylight.length + 1;
    const triangles = [...band.mesh.triangles, 1, o1, apex];
    const injected = auditMesh({ points, triangles }, band.daylight, false, band.planArea);
    expect(injected.checks.edgeIncidence).toBe(false);
    expect(injected.pass).toBe(false);
  });
});
