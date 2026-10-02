/**
 * Phase 20L — offset-radius safety robustness suite (§1,2,3,5,6 evidence).
 *
 * Drives `scripts/phase20lOffsetRadiusAudit.ts` (STUDY ONLY). No production
 * route, no `src/` change. Production fail-closed bounds are pinned in the
 * first describe: the study never relaxes them.
 */
import { describe, expect, it } from 'vitest';

import { gradingSideNormal } from '../src/engine/cad/grading/gradingCourseFrame';
import { linearizeGradingArc } from '../src/engine/cad/grading/gradingCurve';
import {
  MATRIX_CHORD_TOLERANCE,
  OFFSET_COORDS,
  OFFSET_RATIOS,
  OFFSET_RADII,
  OFFSET_SWEEPS_DEG,
  OFFSET_Z_MODES,
  buildPhase20lCorpus,
  chordOffsetResidual,
  classifyOffsetRadius,
  collapseApproach,
  offsetRadiusMatrix,
  offsetRadiusOf,
  productionConvergence,
  radialSignOf,
  toleranceAudit,
  variableDistanceStudy,
  type StudyArc,
} from '../scripts/phase20lOffsetRadiusAudit';

const DEG = Math.PI / 180;
const arcAt = (centerX: number, centerY: number): StudyArc => ({
  centerX, centerY, radius: 60, startAngle: 0.3, sweepRad: 90 * DEG,
  sweepCCW: true, startZ: 10, endZ: 10,
});

describe('phase20l §8 production fail-closed bounds are untouched', () => {
  it('linearizeGradingArc still fails closed on invalid radius / tolerance / whole circle', () => {
    expect(linearizeGradingArc(0, 0, 0, 0, 1, true, 0, 0, 0.1)).toBeNull();
    expect(linearizeGradingArc(0, 0, 60, 0, 1, true, 0, 0, 0)).toBeNull();
    expect(linearizeGradingArc(0, 0, 60, 0, 1, true, 0, 0, 0)).toBeNull();
    // Whole-circle sweep resolves to zero ⇒ fail closed.
    expect(linearizeGradingArc(0, 0, 60, 0, 2 * Math.PI, true, 0, 0, 0.1)).toBeNull();
    expect(linearizeGradingArc(0, 0, 60, 0, Math.PI, true, 0, 0, 0.1)).not.toBeNull();
  });

  it('gradingSideNormal still fails closed on degenerate tangents', () => {
    expect(gradingSideNormal(0, 0, 'left')).toBeNull();
    expect(gradingSideNormal(Number.NaN, 1, 'right')).toBeNull();
    expect(gradingSideNormal(1, 0, 'left')).toEqual({ nx: 0, ny: 1 });
  });
});

describe('phase20l §1 parameter matrix', () => {
  const cells = offsetRadiusMatrix(MATRIX_CHORD_TOLERANCE);

  it('covers radii, sweeps, sides, ratios, coordinates, Z modes and CW/CCW', () => {
    const expected = OFFSET_RADII.length * OFFSET_SWEEPS_DEG.length * 2 * 2 *
      OFFSET_RATIOS.length * OFFSET_COORDS.length * OFFSET_Z_MODES.length;
    expect(cells).toHaveLength(expected);
    expect(new Set(cells.map((c) => c.radius))).toEqual(new Set(OFFSET_RADII));
    expect(new Set(cells.map((c) => c.sweepDeg))).toEqual(new Set(OFFSET_SWEEPS_DEG));
    expect(new Set(cells.map((c) => c.side))).toEqual(new Set(['left', 'right']));
    expect(new Set(cells.map((c) => c.ratio))).toEqual(new Set(OFFSET_RATIOS));
    expect(new Set(cells.map((c) => c.coordinate))).toEqual(new Set(['origin', 'e6', 'e8']));
    expect(new Set(cells.map((c) => c.zMode))).toEqual(new Set(['flat', 'graded']));
    expect(cells.some((c) => c.sweepCCW)).toBe(true);
    expect(cells.some((c) => !c.sweepCCW)).toBe(true);
  });

  it('is deterministic finite: every cell has finite endpoints or a precise classification', () => {
    for (const cell of cells) {
      expect(cell.finite).toBe(true);
      expect(Number.isFinite(cell.offsetRadius)).toBe(true);
      expect(cell.start).not.toBeNull();
      expect(cell.end).not.toBeNull();
      for (const p of [cell.start!, cell.end!]) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
        expect(Number.isFinite(p.z)).toBe(true);
      }
      expect(cell.classification).toBe(classifyOffsetRadius(cell.offsetRadius));
      expect(cell.offsetRadius).toBe(cell.radius + cell.radialSign * cell.distance);
    }
  });

  it('uses exact geometry for the radial sign and collapse/inversion boundary', () => {
    for (const cell of cells) {
      expect(cell.radialSign).toBe(radialSignOf(cell.sweepCCW, cell.side));
    }
    // Inward (CCW + left) collapses exactly at d/R = 1 and inverts beyond.
    const collapse = cells.find((c) => c.radius === 60 && c.sweepCCW && c.side === 'left'
      && c.ratio === 1 && c.coordinate === 'origin' && c.zMode === 'flat')!;
    expect(collapse.offsetRadius).toBe(0);
    expect(collapse.classification).toBe('OFFSET_RADIUS_COLLAPSE');
    const inverted = cells.find((c) => c.radius === 60 && c.sweepCCW && c.side === 'left'
      && c.ratio === 1.1 && c.coordinate === 'origin' && c.zMode === 'flat')!;
    expect(inverted.offsetRadius).toBeCloseTo(-6, 12);
    expect(inverted.classification).toBe('OFFSET_RADIUS_INVERTED');
    // Outward can never collapse or invert.
    for (const c of cells.filter((x) => x.side === 'right' && x.sweepCCW)) {
      expect(c.classification).toBe('OFFSET_RADIUS_OK');
    }
  });

  it('has zero discretization residual at d = 0 and finite non-negative residual elsewhere', () => {
    for (const cell of cells) {
      if (cell.ratio === 0) {
        // Same point built by two evaluation orders: floating recomputation
        // noise at the coordinate scale, not a survey tolerance.
        expect(cell.residual!).toBeLessThanOrEqual(1e-9 * Math.max(1, cell.radius));
      } else {
        expect(cell.residual).not.toBeNull();
        expect(Number.isFinite(cell.residual!)).toBe(true);
        expect(cell.residual!).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('is translation equivalent: every frame recomputed natively, residuals agree, endpoints shift exactly', () => {
    const key = (c: (typeof cells)[number]): string =>
      `${c.radius}|${c.sweepDeg}|${c.sweepCCW}|${c.side}|${c.ratio}|${c.zMode}`;
    const byKey = new Map<string, typeof cells>();
    for (const c of cells) {
      const k = key(c);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)!.push(c);
    }
    for (const group of byKey.values()) {
      expect(group).toHaveLength(OFFSET_COORDS.length);
      const origin = group.find((c) => c.coordinate === 'origin')!;
      for (const c of group) {
        // Native recompute per frame (translated centre through the real
        // linearizer): agreement bound, not bitwise identity. Measured worst
        // e8 drift 1.3e-5 on a 2825 m residual (4.5e-9 relative; small-residual
        // worst 8e-7 absolute) — pure coordinate-rounding noise, so 1e-4
        // absolute carries margin across the whole 0–2825 residual span.
        expect(Math.abs(c.residual! - origin.residual!)).toBeLessThan(1e-4);
        const coord = OFFSET_COORDS.find((x) => x.name === c.coordinate)!;
        expect(c.start!.x).toBe(origin.start!.x + coord.dx);
        expect(c.start!.y).toBe(origin.start!.y + coord.dy);
      }
    }
  });

  it('is rotation invariant: rigidly rotating the frame leaves the residual unchanged', () => {
    const base: StudyArc = {
      centerX: 0, centerY: 0, radius: 252.5, startAngle: 0.3, sweepRad: 90 * DEG,
      sweepCCW: true, startZ: 100, endZ: 100,
    };
    const rotated: StudyArc = { ...base, startAngle: 0.3 + 1.1 };
    const a = chordOffsetResidual(base, 'right', 20, 0, 0.1);
    const b = chordOffsetResidual(rotated, 'right', 20, 0, 0.1);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(Math.abs(a! - b!)).toBeLessThanOrEqual(1e-9 * Math.max(1, a!));
  });

  it('is deterministic', () => {
    expect(JSON.stringify(offsetRadiusMatrix(MATRIX_CHORD_TOLERANCE))).toBe(JSON.stringify(cells));
  });
});

describe('phase20l §2 variable-distance classification', () => {
  const rows = variableDistanceStudy();

  it('keeps constant-offset families circular on flat and graded sources', () => {
    for (const id of ['flat.flat.distance', 'graded.flat.distance',
      'flat.flat.relative-elevation', 'graded.ridge.relative-elevation']) {
      const row = rows.find((r) => r.id === id)!;
      expect(row.classification, id).toBe('OFFSET_SAMPLED_CONSTANT_DISTANCE');
      expect(row.dRange, id).toBe(0);
    }
  });

  it('classifies a station-varying distance as NOT_CIRCULAR, never forcing it into Roff', () => {
    for (const id of ['graded.flat.elevation', 'graded.ridge.fixed', 'flat.sloped.fixed']) {
      const row = rows.find((r) => r.id === id)!;
      expect(row.classification, id).toBe('OFFSET_VARIABLE_DISTANCE_NOT_CIRCULAR');
      expect(row.dRange, id).toBeGreaterThan(0);
    }
  });

  it('detects a CUT/FILL side change across the source when the target straddles the profile', () => {
    const graded = rows.filter((r) => r.criterion === 'cut-fill' && r.sourceZ === 'graded');
    expect(graded.length).toBeGreaterThan(0);
    expect(graded.every((r) => r.sideChange)).toBe(true);
    const flat = rows.find((r) => r.id === 'flat.flat.cut-fill')!;
    expect(flat.sideChange).toBe(false);
  });

  it('constant means exactly zero range over the samples (no tolerance band certifies circularity)', () => {
    for (const r of rows) {
      expect(r.classification === 'OFFSET_SAMPLED_CONSTANT_DISTANCE', r.id).toBe(r.dRange === 0);
    }
  });

  it('is deterministic with a fixed sample count', () => {
    expect(JSON.stringify(variableDistanceStudy())).toBe(JSON.stringify(rows));
    expect(rows.every((r) => r.stations.length === 10)).toBe(true);
  });
});

describe('phase20l §3 production comparison (observe only)', () => {
  it('converges the chord-normal offset toward the exact parallel curve as tolerance tightens', () => {
    const rows = productionConvergence();
    expect(rows[0]!.tolerance).toBe(25);
    expect(rows[rows.length - 1]!.tolerance).toBe(0.001);
    for (let i = 0; i + 1 < rows.length; i += 1) {
      expect(rows[i + 1]!.tolerance).toBeLessThan(rows[i]!.tolerance);
      expect(rows[i + 1]!.subdivisions).toBeGreaterThanOrEqual(rows[i]!.subdivisions);
      expect(rows[i + 1]!.residual).toBeLessThan(rows[i]!.residual);
    }
    // ~linear in tolerance over the measured band.
    expect(rows[rows.length - 1]!.residual).toBeLessThan(rows[0]!.residual / 50);
    // Chord-normal rotation error scales with the SQUARE ROOT of tolerance
    // (offset error ≈ d × half-step angle, half-step ∝ √tol): residual/√tol
    // ≈ d·√(2/R) ≈ 1.78 here — pinning this rejects any future linear claim.
    for (const r of rows) {
      const ratio = r.residual! / Math.sqrt(r.tolerance);
      expect(ratio, `tol=${r.tolerance}`).toBeGreaterThan(1.5);
      expect(ratio, `tol=${r.tolerance}`).toBeLessThan(1.85);
    }
  });

  it('approaches the collapse boundary with growing curvature and a finite residual', () => {
    const rows = collapseApproach();
    expect(rows.map((r) => r.ratio)).toEqual([0.5, 0.9, 0.99, 0.999, 0.9999, 0.999999]);
    for (let i = 0; i + 1 < rows.length; i += 1) {
      expect(rows[i + 1]!.offsetRadius).toBeLessThan(rows[i]!.offsetRadius);
      if (rows[i]!.curvature !== null && rows[i + 1]!.curvature !== null) {
        expect(rows[i + 1]!.curvature!).toBeGreaterThan(rows[i]!.curvature!);
      }
      expect(Number.isFinite(rows[i]!.residual!)).toBe(true);
    }
    expect(rows.every((r) => r.classification === 'OFFSET_RADIUS_OK')).toBe(true);
  });
});

describe('phase20l §5 tolerance audit', () => {
  const rows = toleranceAudit();

  it('distinguishes exact zero, conditioning, orientation and policy', () => {
    const exact = rows.find((r) => r.id === 'exact-collapse-1')!;
    expect(exact.exactZero).toBe(true);
    expect(exact.conditioning).toBe(false);
    expect(exact.classification).toBe('OFFSET_RADIUS_COLLAPSE');
    expect(exact.policyGate).toBe('OFFSET_RADIUS_COLLAPSE_GATE');
    expect(exact.offsetSubdivisions).toBeNull();

    const conditioning = rows.find((r) => r.id === 'near-collapse-0.999')!;
    expect(conditioning.exactZero).toBe(false);
    expect(conditioning.conditioning).toBe(true);
    expect(conditioning.offsetSubdivisions).toBe(1);
    expect(conditioning.policyGate).toBe('OFFSET_RADIUS_CONDITIONING_REVIEW');

    const inverted = rows.find((r) => r.id === 'inverted-1.1')!;
    expect(inverted.classification).toBe('OFFSET_RADIUS_INVERTED');
    expect(inverted.curvature).toBeCloseTo(1 / -6, 12);
    expect(inverted.policyGate).toBe('OFFSET_RADIUS_ORIENTATION_GATE');
  });

  it('reuses the shared coordinate agreement bound (no new tolerance)', () => {
    const tangent = rows.find((r) => r.id === 'near-tangent-179.9')!;
    const large = rows.find((r) => r.id === 'large-coord-e8')!;
    expect(tangent.agreement).toBe(true);
    expect(large.agreement).toBe(true);
    expect(tangent.exactZero).toBe(false);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(toleranceAudit())).toBe(JSON.stringify(rows));
  });
});

describe('phase20l §6 corpus', () => {
  const payload = buildPhase20lCorpus();

  it('is bounded, classified and byte-identical across builds', () => {
    expect(payload.generated).toBe('phase20l-offset-radius');
    expect(payload.rows.length).toBeGreaterThan(30);
    expect(payload.rows.length).toBeLessThan(80);
    expect(buildPhase20lCorpus().rows.length).toBe(payload.rows.length);
    expect(JSON.stringify(buildPhase20lCorpus())).toBe(JSON.stringify(payload));
    for (const row of payload.rows) {
      expect(row.digest, row.id).toMatch(/^[0-9a-f]{16}$/);
      expect(typeof row.id).toBe('string');
      expect(Number.isFinite(row.radius)).toBe(true);
      expect(Number.isFinite(row.sweepDeg)).toBe(true);
      expect(typeof row.sweepCCW).toBe('boolean');
    }
    const kinds = new Set(payload.rows.map((r) => r.classification));
    expect(kinds.has('OFFSET_RADIUS_OK')).toBe(true);
    expect(kinds.has('OFFSET_RADIUS_COLLAPSE')).toBe(true);
    expect(kinds.has('OFFSET_RADIUS_INVERTED')).toBe(true);
    expect(kinds.has('OFFSET_VARIABLE_DISTANCE_NOT_CIRCULAR')).toBe(true);
  });

  it('records a PASS topology only for a built strip and a classification otherwise', () => {
    const buildable = payload.rows.filter((r) => r.topology === 'PASS');
    expect(buildable.length).toBeGreaterThan(0);
    for (const row of buildable) {
      expect(row.counts).not.toBeNull();
      expect(row.areas).not.toBeNull();
      expect(row.classification).toBe('OFFSET_RADIUS_OK');
    }
    const collapse = payload.rows.find((r) => r.classification === 'OFFSET_RADIUS_COLLAPSE')!;
    expect(collapse.topology).toBe('OFFSET_RADIUS_COLLAPSE');
    expect(collapse.counts).toBeNull();
  });

  it('records token-bounded digits (no warning after corpus write)', () => {
    const written = JSON.stringify(payload);
    expect(written.length).toBeLessThan(120_000);
  });

  it('represents the unsolved adjacent join as deferred/not-applicable with null extent', () => {
    for (const row of payload.rows) {
      if (row.category.startsWith('variable-')) continue; // non-circular, never a join
      expect(row.extent, row.id).toBeNull();
      expect(row.joinClass, row.id).toMatch(/^OFFSET_JOIN_(DEFERRED|NOT_APPLICABLE)$/);
      expect(row.joinClass, row.id).toBe(
        row.classification === 'OFFSET_RADIUS_OK' ? 'OFFSET_JOIN_DEFERRED' : 'OFFSET_JOIN_NOT_APPLICABLE',
      );
    }
  });
});

describe('phase20l offset-radius helpers', () => {
  it('offsetRadiusOf is exact sign arithmetic', () => {
    const arc = arcAt(0, 0);
    expect(offsetRadiusOf(arc, 'left', 60)).toBe(0);
    expect(offsetRadiusOf(arc, 'right', 60)).toBe(120);
    expect(offsetRadiusOf({ ...arc, sweepCCW: false }, 'left', 60)).toBe(120);
  });

  it('classifies Roff by EXACT sign: tiny positive ok, zero collapse, tiny negative inverted, nonfinite separate', () => {
    // No tolerance band touches the physical sign — agreement tolerances
    // govern agreement only.
    expect(classifyOffsetRadius(1e-12)).toBe('OFFSET_RADIUS_OK');
    expect(classifyOffsetRadius(0)).toBe('OFFSET_RADIUS_COLLAPSE');
    expect(classifyOffsetRadius(-1e-12)).toBe('OFFSET_RADIUS_INVERTED');
    expect(classifyOffsetRadius(Number.NaN)).toBe('OFFSET_RADIUS_NONFINITE');
    expect(classifyOffsetRadius(Number.POSITIVE_INFINITY)).toBe('OFFSET_RADIUS_NONFINITE');
    expect(classifyOffsetRadius(Number.NEGATIVE_INFINITY)).toBe('OFFSET_RADIUS_NONFINITE');
    // Matrix boundary pins: just-below / exactly / just-above R (inward, R=60).
    expect(offsetRadiusOf(arcAt(0, 0), 'left', 60 - 1e-9)).toBeGreaterThan(0);
    expect(offsetRadiusOf(arcAt(0, 0), 'left', 60)).toBe(0);
    expect(offsetRadiusOf(arcAt(0, 0), 'left', 60 + 1e-9)).toBeLessThan(0);
  });
});
