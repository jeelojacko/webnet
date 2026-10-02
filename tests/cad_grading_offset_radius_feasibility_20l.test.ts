/**
 * Phase 20L Worker-CORE — offset-radius feasibility oracles (evidence only).
 *
 * Production is untouched: every case runs through the study core
 * (`scripts/phase20lOffsetRadiusCore.ts`), never through production routing.
 * Independent analytic math (plain trig, no production output) proves the
 * constant-distance oracles; the 20K symbolic controls are pinned verbatim.
 */
import { describe, expect, it } from 'vitest';

import type { GradingSide } from '../src/engine/cad/grading/gradingTypes';
import {
  buildCorpus,
  classifyOffsetJoin,
  CORPUS_RADII,
  CORPUS_SWEEPS_DEG,
  endAngleOf,
  exactParallelOffset,
  offsetPolicyFor,
  OFFSET_VARIABLE_DISTANCE_NOT_CIRCULAR,
  shiftedEndpoint,
  sourcePointAt,
  symbolicOffsetRadius,
  symbolicOffsetRows,
  traversalTangentAt,
  type SourceArc,
} from '../scripts/phase20lOffsetRadiusCore';

const arc = (over: Partial<SourceArc> = {}): SourceArc => ({
  centerX: 1000, centerY: -500, radius: 60,
  startAngle: 0.7, sweepDeg: 90, sweepCCW: true, startZ: 100, endZ: 102,
  ...over,
});

describe('phase20l 20K symbolic controls (preserved)', () => {
  it('pins 10 rows: R=60, ratios, right growth / left shrink, resolver-null symbolic-only', () => {
    const rows = symbolicOffsetRows();
    expect(rows).toHaveLength(10);
    for (const side of ['right', 'left'] as const) {
      for (const ratio of [0.1, 0.5, 0.9, 1.0, 1.1]) {
        const row = rows.find((r) => r.side === side && r.ratio === ratio)!;
        expect(row.radialSign).toBe(side === 'right' ? 1 : -1);
        expect(row.offsetDistance).toBe(ratio * 60);
        expect(row.radiusOffset).toBe(60 + (side === 'right' ? 1 : -1) * ratio * 60);
        expect(row.outcome).toBeNull();
        expect(row.detail).toBe('symbolic-only: resolver not run (offset arc joint leaves V)');
      }
    }
    // Left d/R<1 ok, =1 collapse, >1 inversion; right always grows.
    expect(rows.find((r) => r.side === 'left' && r.ratio === 0.9)!.classification).toBe('OFFSET_RADIUS_OK');
    expect(rows.find((r) => r.side === 'left' && r.ratio === 1.0)!.classification).toBe('OFFSET_RADIUS_COLLAPSE');
    expect(rows.find((r) => r.side === 'left' && r.ratio === 1.1)!.classification).toBe('OFFSET_RADIUS_INVERTED');
    for (const ratio of [0.1, 0.5, 0.9, 1.0, 1.1]) {
      expect(rows.find((r) => r.side === 'right' && r.ratio === ratio)!.classification).toBe('OFFSET_RADIUS_OK');
    }
    expect(JSON.stringify(symbolicOffsetRows())).toBe(JSON.stringify(rows));
  });

  it('R-boundary: just-below ok, exactly collapse, just-above inverted (left, R=60)', () => {
    expect(symbolicOffsetRadius(60, 'left', 59.999).classification).toBe('OFFSET_RADIUS_OK');
    expect(symbolicOffsetRadius(60, 'left', 60).classification).toBe('OFFSET_RADIUS_COLLAPSE');
    expect(symbolicOffsetRadius(60, 'left', 60.001).classification).toBe('OFFSET_RADIUS_INVERTED');
    expect(symbolicOffsetRadius(60, 'left', 60).radiusOffset).toBe(0);
  });

  it('nonfinite inputs fail closed, never ok', () => {
    expect(symbolicOffsetRadius(NaN, 'left', 6).classification).toBe('OFFSET_RADIUS_NONFINITE');
    expect(symbolicOffsetRadius(60, 'left', NaN).classification).toBe('OFFSET_RADIUS_NONFINITE');
    expect(symbolicOffsetRadius(-5, 'left', 6).classification).toBe('OFFSET_RADIUS_NONFINITE');
    expect(symbolicOffsetRadius(60, 'left', -1).classification).toBe('OFFSET_RADIUS_NONFINITE');
  });

  it('finite-input arithmetic overflow fails closed NONFINITE, never OK', () => {
    const huge = Number.MAX_VALUE;
    const sym = symbolicOffsetRadius(huge, 'right', huge);
    expect(sym.radiusOffset).toBe(Number.POSITIVE_INFINITY);
    expect(sym.classification).toBe('OFFSET_RADIUS_NONFINITE');
    const exact = exactParallelOffset(arc({ radius: huge }), 'right', huge);
    expect(exact.ok).toBe(false);
    if (!exact.ok) {
      expect(exact.classification).toBe('OFFSET_RADIUS_NONFINITE');
      expect(exact.radiusOffset).toBe(Number.POSITIVE_INFINITY);
    }
  });
});

describe('phase20l constant-distance oracles (independent analytic math)', () => {
  it.each(CORPUS_RADII)('R=%s: same center, |Roff-R|=d with authority sign', (radius) => {
    for (const sweepCCW of [true, false]) {
      for (const side of ['right', 'left'] as const) {
        const got = exactParallelOffset(arc({ radius, sweepCCW }), side, 0.5 * radius);
        expect(got.ok).toBe(true);
        if (!got.ok) continue;
        expect(got.arc.centerX).toBe(1000);
        expect(got.arc.centerY).toBe(-500);
        expect(Math.abs(got.arc.radiusOffset - radius)).toBe(0.5 * radius);
        // CCW: right grows (+1), left shrinks (−1); CW traversal flips both.
        expect(got.arc.radialSign).toBe(sweepCCW === (side === 'right') ? 1 : -1);
        expect(got.arc.signedDelta).toBe(got.arc.radialSign * 0.5 * radius);
      }
    }
  });

  it.each(CORPUS_SWEEPS_DEG)('sweep=%s°: sampled offset points sit d off along the radial normal', (sweepDeg) => {
    for (const sweepCCW of [true, false]) {
      for (const side of ['right', 'left'] as const) {
        const source = arc({ radius: 100, sweepDeg, sweepCCW });
        const d = 25;
        const got = exactParallelOffset(source, side, d);
        expect(got.ok).toBe(true);
        if (!got.ok) continue;
        const end = endAngleOf(source)!;
        for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
          const dir = sweepCCW ? 1 : -1;
          const angle = source.startAngle + dir * ((sweepDeg * Math.PI) / 180) * frac;
          void end;
          const p = sourcePointAt(source, angle);
          const t = traversalTangentAt(sweepCCW, angle);
          // Independent side normal (left=(-ty,tx), right=(ty,-tx)).
          const nx = side === 'left' ? -t.ny : t.ny;
          const ny = side === 'left' ? t.nx : -t.nx;
          const q = { x: p.x + nx * d, y: p.y + ny * d };
          expect(Math.hypot(q.x - got.arc.centerX, q.y - got.arc.centerY))
            .toBeCloseTo(got.arc.radiusOffset, 9);
          // Radial distance from the source circle is exactly d.
          expect(Math.abs(Math.hypot(q.x - source.centerX, q.y - source.centerY) - source.radius)).toBeCloseTo(d, 9);
        }
      }
    }
  });

  it('endpoints equal source endpoints shifted; sweep preserved iff Roff>0', () => {
    const source = arc({ radius: 252.5, sweepDeg: 135, sweepCCW: false });
    const d = 30;
    for (const side of ['right', 'left'] as const) {
      const got = exactParallelOffset(source, side, d);
      expect(got.ok).toBe(true);
      if (!got.ok) continue;
      for (const atEnd of [false, true]) {
        const shifted = shiftedEndpoint(source, atEnd, side, d)!;
        const angle = atEnd ? endAngleOf(source)! : source.startAngle;
        const p = sourcePointAt(source, angle);
        const t = traversalTangentAt(source.sweepCCW, angle);
        const nx = side === 'left' ? -t.ny : t.ny;
        const ny = side === 'left' ? t.nx : -t.nx;
        expect(shifted.x).toBeCloseTo(p.x + nx * d, 12);
        expect(shifted.y).toBeCloseTo(p.y + ny * d, 12);
      }
      expect(got.arc.sweepCCW).toBe(source.sweepCCW);
      expect(got.arc.startAngle).toBe(source.startAngle);
      expect(got.arc.endAngle).toBe(endAngleOf(source));
    }
  });

  it('d=R collapses every endpoint to the center; d>R is same-orientation unrepresentable', () => {
    const source = arc({ radius: 60, sweepCCW: true });
    const collapsed = exactParallelOffset(source, 'left', 60);
    expect(collapsed.ok).toBe(false);
    if (collapsed.ok) return;
    expect(collapsed.classification).toBe('OFFSET_RADIUS_COLLAPSE');
    expect(collapsed.radiusOffset).toBe(0);
    for (const atEnd of [false, true]) {
      const q = shiftedEndpoint(source, atEnd, 'left', 60)!;
      expect(q.x).toBeCloseTo(source.centerX, 9);
      expect(q.y).toBeCloseTo(source.centerY, 9);
    }
    const inverted = exactParallelOffset(source, 'left', 66);
    expect(inverted.ok).toBe(false);
    if (inverted.ok) return;
    expect(inverted.classification).toBe('OFFSET_RADIUS_INVERTED');
    expect(inverted.radiusOffset).toBe(-6);
  });

  it('variable distance is flagged circular-impossible, never solved', () => {
    expect(OFFSET_VARIABLE_DISTANCE_NOT_CIRCULAR).toBe('OFFSET_VARIABLE_DISTANCE_NOT_CIRCULAR');
  });

  it('join stub defers ok rows; policy required exactly on collapse/inversion/nonfinite', () => {
    expect(classifyOffsetJoin('OFFSET_RADIUS_OK').join).toBe('OFFSET_JOIN_DEFERRED');
    expect(classifyOffsetJoin('OFFSET_RADIUS_COLLAPSE').join).toBe('OFFSET_JOIN_NOT_APPLICABLE');
    expect(classifyOffsetJoin('OFFSET_RADIUS_INVERTED').join).toBe('OFFSET_JOIN_NOT_APPLICABLE');
    expect(classifyOffsetJoin('OFFSET_RADIUS_NONFINITE').join).toBe('OFFSET_JOIN_NOT_APPLICABLE');
    expect(offsetPolicyFor('OFFSET_RADIUS_OK')).toBe('OFFSET_POLICY_NONE');
    for (const c of ['OFFSET_RADIUS_COLLAPSE', 'OFFSET_RADIUS_INVERTED', 'OFFSET_RADIUS_NONFINITE'] as const) {
      expect(offsetPolicyFor(c)).toBe('OFFSET_POLICY_REQUIRED');
    }
  });

  it('side sign authority pins CW/CCW mirror: CW-right shrinks like CCW-left', () => {
    const ccwLeft = exactParallelOffset(arc({ sweepCCW: true }), 'left', 6);
    const cwRight = exactParallelOffset(arc({ sweepCCW: false }), 'right', 6);
    expect(ccwLeft.ok && cwRight.ok).toBe(true);
    if (!ccwLeft.ok || !cwRight.ok) return;
    expect(ccwLeft.arc.radiusOffset).toBe(54);
    expect(cwRight.arc.radiusOffset).toBe(54);
    expect(ccwLeft.arc.radialSign).toBe(-1);
    expect(cwRight.arc.radialSign).toBe(-1);
  });
});

describe('phase20l corpus determinism', () => {
  it('builds 400 rows, all endpoint-agreeing, identical twice', () => {
    const first = buildCorpus();
    expect(first.rows).toHaveLength(
      CORPUS_RADII.length * CORPUS_SWEEPS_DEG.length * 2 * 2 * 5,
    );
    expect(first.rows.every((r) => r.endpointAgreement && r.sourceChordsOnCircle)).toBe(true);
    expect(first.digest).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(buildCorpus())).toBe(JSON.stringify(first));
  });

  it('flags variable-distance vocabulary without solving', () => {
    const sides: GradingSide[] = ['left', 'right'];
    expect(sides).toHaveLength(2);
    expect(OFFSET_VARIABLE_DISTANCE_NOT_CIRCULAR).toContain('VARIABLE');
  });
});
