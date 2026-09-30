/**
 * Phase 20K Worker-ROBUST — 20J.1 shallow-grade pin (§32).
 *
 * A hand-designed production hybrid (straight surface + straight analytic)
 * with a nearly-flat surface grade (`|g| = 1e-6`) and a 10 m target drop.
 * The surface root sits ~1e7 m along the seam, so a large
 * `maxSearchDistance` is required. A sub-0.1 mm analytic mismatch (above the
 * 20J.1 agreement floor) must fail closed `CORNER_NO_SOLUTION` /
 * `GRADING_SURFACE_ANALYTIC_*` — never a wall, bridge, average, or snap.
 * No `src/` contract is altered.
 */
import { describe, expect, it } from 'vitest';

import { DIST, REL, shallowGradePin } from '../scripts/phase20kHybridArcPairRobust';

const FAIL_CLOSED = 'GRADING_SURFACE_ANALYTIC_TRANSITION_REQUIRED';

describe('phase20k §32 shallow-grade pin', () => {
  it('solves the exact tie at a ~1e7 m plan offset (surface root reached)', () => {
    const rel = shallowGradePin();
    expect(rel.ok).toBe(true);
    expect(rel.code).toBeNull();
    expect(rel.tie).toEqual({ x: 40, y: -10000000, z: 90 });
    const dist = shallowGradePin({ analytic: DIST(-0.25, 40) });
    expect(dist.ok).toBe(true);
    expect(dist.tie).toEqual(rel.tie);
  });

  it('fails a sub-0.1 mm RelativeElevation mismatch closed at local coordinates', () => {
    const bad = shallowGradePin({ analytic: REL(-0.25, -10 - 1e-6) });
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe('CORNER_NO_SOLUTION');
    expect(bad.detail).toBe(FAIL_CLOSED);
    expect(bad.tie).toBeNull();
  });

  it('fails the same mismatch closed near E≈2M/N≈7M and pins the translated exact tie', () => {
    const exact = shallowGradePin({ vx: 2000000, vy: 7000000 });
    expect(exact.ok).toBe(true);
    expect(exact.tie).toEqual({ x: 2000040, y: -3000000, z: 90 });
    const relBad = shallowGradePin({
      vx: 2000000, vy: 7000000, analytic: REL(-0.25, -10 - 1e-6),
    });
    expect(relBad.ok).toBe(false);
    expect(relBad.code).toBe('CORNER_NO_SOLUTION');
    expect(relBad.detail).toBe(FAIL_CLOSED);
    const distBad = shallowGradePin({
      vx: 2000000, vy: 7000000, analytic: DIST(-0.25, 40 + 1e-6),
    });
    expect(distBad.ok).toBe(false);
    expect(distBad.code).toBe('CORNER_NO_SOLUTION');
    expect(distBad.detail).toBe(FAIL_CLOSED);
  });

  it('pins the projected analytic Delta < 0.1 mm but above the agreement floor', () => {
    const delta = 1e-6; // 0.001 mm — well above the projected ~5e-8 m floor
    expect(delta).toBeGreaterThan(5e-8);
    expect(delta).toBeLessThan(1e-4);
    for (const analytic of [REL(-0.25, -10 - delta), DIST(-0.25, 40 + delta)]) {
      const out = shallowGradePin({ vx: 2000000, vy: 7000000, analytic });
      expect(out.ok).toBe(false);
      expect(out.code).toBe('CORNER_NO_SOLUTION');
      expect(out.detail).toBe(FAIL_CLOSED);
      expect(out.tie).toBeNull();
    }
  });

  it('is deterministic', () => {
    expect(JSON.stringify(shallowGradePin())).toBe(JSON.stringify(shallowGradePin()));
    const a = shallowGradePin({ vx: 2000000, vy: 7000000, analytic: DIST(-0.25, 40 + 1e-6) });
    const b = shallowGradePin({ vx: 2000000, vy: 7000000, analytic: DIST(-0.25, 40 + 1e-6) });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
