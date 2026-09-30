/**
 * Phase 20K Worker-ROBUST — hybrid arc-pair robustness study (§19-25).
 *
 * Evidence-only: drives `scripts/phase20kHybridArcPairRobust.ts`, which
 * imports Worker-CORE's arc seam and delegates every corner to the
 * production `solveHybridCorner` (arc×arc guard cleared for the study only).
 * Production is untouched: the first `describe` pins Policy A (frozen) and
 * Policy C (not implemented). Labels are `ARC_PAIR_*` evidence strings.
 */
import { describe, expect, it } from 'vitest';

import {
  LARGE_OFFSETS,
  OFFSET_RATIOS,
  POLICY_NOTES,
  largeCoordinateStudy,
  mismatchLadder,
  offsetRadiusSafety,
  radiusSweepMatrix,
  rootPathologies,
} from '../scripts/phase20kHybridArcPairRobust';

const NEAREST_TIE = { x: 63.08644059797901, y: -47.77910330337543, z: 90 };

describe('phase20k robust §19 integration policies', () => {
  it('keeps Policy A (study-only) implemented and Policy C (general arc-pair) unimplemented', () => {
    expect(POLICY_NOTES.map((p) => p.policy)).toEqual(['A', 'B', 'C']);
    expect(POLICY_NOTES.find((p) => p.policy === 'A')!.implemented).toBe(true);
    expect(POLICY_NOTES.find((p) => p.policy === 'C')!.implemented).toBe(false);
    // Policy C must not have silently grown into production: its evidence is
    // the robustness study itself (offset gate + conditioning + root policy).
    expect(POLICY_NOTES.find((p) => p.policy === 'C')!.evidence).toMatch(/Roffset/);
  });
});

describe('phase20k robust §20 offset-radius safety', () => {
  const rows = offsetRadiusSafety();

  it('covers every ratio on both sides with the task classification', () => {
    expect(rows).toHaveLength(OFFSET_RATIOS.length * 2);
    for (const ratio of OFFSET_RATIOS) {
      const right = rows.find((r) => r.side === 'right' && r.ratio === ratio)!;
      const left = rows.find((r) => r.side === 'left' && r.ratio === ratio)!;
      expect(right.radialSign).toBe(1);
      expect(left.radialSign).toBe(-1);
      // +dir (right) can never collapse or invert for d/R > 0.
      expect(right.classification).toBe('ARC_PAIR_OFFSET_OK');
      expect(right.selfIntersects).toBe(false);
    }
    // -dir (left) collapses exactly at d = R and inverts beyond.
    expect(rows.find((r) => r.side === 'left' && r.ratio === 1.0)!.classification)
      .toBe('ARC_PAIR_OFFSET_COLLAPSE');
    expect(rows.find((r) => r.side === 'left' && r.ratio === 1.1)!.classification)
      .toBe('ARC_PAIR_OFFSET_INVERTED');
    for (const row of rows) {
      expect(row.selfIntersects).toBe(row.radiusOffset <= 0);
      expect(row.orientationPreserved).toBe(row.radiusOffset > 0);
    }
  });

  it('resolves the sane offsets and fails closed once the strip breaks', () => {
    const leftHalf = rows.find((r) => r.side === 'left' && r.ratio === 0.5)!;
    expect(leftHalf.outcome).toBe('ARC_PAIR_EXACT_COMMON_TIE');
    expect(leftHalf.tie!.z).toBe(90);
    expect(leftHalf.meshValid).toBe(true);
    // A valid radiusOffset is necessary, not sufficient: the right 1.1 offset
    // moves the seam past the strip and fails closed rather than bridging.
    const rightEleven = rows.find((r) => r.side === 'right' && r.ratio === 1.1)!;
    expect(rightEleven.outcome).toBe('ARC_PAIR_INVALID');
    expect(rightEleven.tie).toBeNull();
    for (const row of rows.filter((r) => r.classification === 'ARC_PAIR_OFFSET_OK')) {
      expect(row.outcome).not.toBeNull();
      if (row.outcome !== 'ARC_PAIR_EXACT_COMMON_TIE') expect(row.tie).toBeNull();
    }
    // Non-positive offsets never reach the resolver.
    for (const row of rows.filter((r) => r.classification !== 'ARC_PAIR_OFFSET_OK')) {
      expect(row.outcome).toBeNull();
    }
  });

  it('is deterministic', () => {
    expect(JSON.stringify(offsetRadiusSafety())).toBe(JSON.stringify(rows));
  });
});

describe('phase20k robust §21 radius × sweep matrix', () => {
  const rows = radiusSweepMatrix();

  it('covers radii, sweeps, ccw, sides, turns, equal/unequal', () => {
    expect(rows.length).toBe(1024);
    expect(new Set(rows.map((r) => r.radiusIn))).toEqual(new Set([10, 60, 100, 500]));
    expect(new Set(rows.map((r) => r.sweepInDeg))).toEqual(new Set([5, 45, 90, 135]));
    expect(new Set(rows.map((r) => r.side))).toEqual(new Set(['right', 'left']));
    expect(new Set(rows.map((r) => r.intendedTurn))).toEqual(new Set(['GAP', 'OVERLAP']));
    expect(new Set(rows.map((r) => `${r.ccwIn}/${r.ccwOut}`))).toEqual(new Set(['true/true', 'true/false']));
    expect(rows.some((r) => r.radiusIn === r.radiusOut)).toBe(true);
    expect(rows.some((r) => r.radiusIn !== r.radiusOut)).toBe(true);
  });

  it('records finite det, 1/|det| conditioning, and fail-closed gate detail', () => {
    for (const row of rows) {
      if (row.det !== null) expect(Number.isFinite(row.det)).toBe(true);
      if (row.condition !== null) {
        expect(Number.isFinite(row.condition)).toBe(true);
        expect(row.condition).toBeCloseTo(1 / Math.abs(row.det!), 12);
      }
      expect(Number.isFinite(row.closedIn)).toBe(true);
      expect(Number.isFinite(row.closedOut)).toBe(true);
      expect(row.closedIn).toBeGreaterThanOrEqual(1);
      expect(row.closedOut).toBeGreaterThanOrEqual(1);
    }
  });

  it('separates a useful conditioned region from the contrived near-degenerate band', () => {
    const useful = rows.filter((r) => r.region === 'useful');
    const contrived = rows.filter((r) => r.region === 'contrived');
    expect(useful.length).toBeGreaterThan(0);
    expect(contrived.length).toBeGreaterThan(0);
    expect(useful.length + contrived.length).toBe(rows.length);
    // Every "useful" row is finite and every "contrived" row is either
    // near-parallel (|det| <= 1e-3) or fails closed.
    for (const row of useful) {
      expect(['ARC_PAIR_EXACT_COMMON_TIE', 'ARC_PAIR_FINITE_TRANSITION']).toContain(row.outcome);
    }
    for (const row of contrived) {
      const nearParallel = row.det !== null && Math.abs(row.det) <= 1e-3;
      const failClosed = row.outcome !== 'ARC_PAIR_EXACT_COMMON_TIE'
        && row.outcome !== 'ARC_PAIR_FINITE_TRANSITION';
      expect(nearParallel || failClosed).toBe(true);
    }
  });

  it('pins one exact GAP cell and one exact OVERLAP cell', () => {
    const gap = rows.find((r) => r.side === 'right' && r.intendedTurn === 'GAP'
      && r.radiusIn === 60 && r.radiusOut === 60 && r.sweepInDeg === 90 && r.ccwIn && r.ccwOut);
    expect(gap?.outcome).toBe('ARC_PAIR_EXACT_COMMON_TIE');
    expect(gap?.det).toBeGreaterThan(0);
    const overlap = rows.find((r) => r.side === 'right' && r.intendedTurn === 'OVERLAP'
      && r.radiusIn === 60 && r.radiusOut === 60 && r.sweepInDeg === 90 && r.ccwIn && r.ccwOut);
    expect(overlap?.outcome).toBe('ARC_PAIR_EXACT_COMMON_TIE');
  });

  it('is deterministic', () => {
    expect(JSON.stringify(radiusSweepMatrix())).toBe(JSON.stringify(rows));
  });
});

describe('phase20k robust §23 target/root pathologies', () => {
  const rows = rootPathologies();

  it('solves the planar / alternate / edge / vertex / disconnected cases to the nearest root', () => {
    for (const id of ['flat', 'alt-triangulation', 'edge-hit', 'vertex-hit', 'disconnected', 'later-root']) {
      const row = rows.find((r) => r.id === id)!;
      expect(row.outcome, id).toBe('ARC_PAIR_COMMON_TIE');
      expect(row.tie, id).toEqual(NEAREST_TIE);
    }
  });

  it('fails closed on a coverage gap at V and on malformed / discontinuous targets', () => {
    const gap = rows.find((r) => r.id === 'gap-at-v')!;
    expect(gap.outcome).toBe('ARC_PAIR_SURFACE_NO_ROOT');
    expect(gap.detail).toBe('gap-at-V');
    expect(gap.tie).toBeNull();
    const two = rows.find((r) => r.id === 'two-roots')!;
    expect(two.outcome).toBe('ARC_PAIR_SURFACE_NO_ROOT');
    expect(two.tie).toBeNull();
    const malformed = rows.find((r) => r.id === 'malformed')!;
    expect(malformed.outcome).toBe('ARC_PAIR_SURFACE_NO_ROOT');
    expect(malformed.tie).toBeNull();
  });

  it('uses the same nearest root for the alternate triangulation (no order dependence)', () => {
    const flat = rows.find((r) => r.id === 'flat')!;
    const alt = rows.find((r) => r.id === 'alt-triangulation')!;
    expect(alt.tie).toEqual(flat.tie);
    expect(alt.buildable).toBe(true);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(rootPathologies())).toBe(JSON.stringify(rows));
  });
});

describe('phase20k robust §24 mismatch ladders', () => {
  const rows = mismatchLadder();
  const CONTROLS = new Set(['exact', 'exact-dist']);
  const FAIL_CLOSED = new Set([
    'ARC_PAIR_FINITE_TRANSITION', 'ARC_PAIR_INVALID', 'ARC_PAIR_NO_TIE', 'ARC_PAIR_CHORD_DEGENERATE',
  ]);

  it('keeps both exact controls exact', () => {
    for (const id of CONTROLS) {
      const row = rows.find((r) => r.id === id)!;
      expect(row.outcome, id).toBe('ARC_PAIR_EXACT_COMMON_TIE');
      expect(row.exact, id).toBe(true);
    }
  });

  it('never resolves a mismatch and never leaks bridge/wall/average geometry', () => {
    for (const row of rows.filter((r) => !CONTROLS.has(r.id))) {
      expect(row.exact, row.id).toBe(false);
      expect(row.geometryLeaked, row.id).toBe(false);
      expect(row.tie, row.id).toBeNull();
      expect(FAIL_CLOSED.has(row.outcome), `${row.id}:${row.outcome}`).toBe(true);
    }
  });

  it('covers target / distance / relative / grade / joint / triangle dimensions', () => {
    const dims = new Set(rows.map((r) => r.dimension));
    for (const d of ['target elevation', 'relative Δ', 'distance', 'joint Z', 'target Z', 'analytic grade', 'analytic distance', 'triangle vertex Z']) {
      expect(dims.has(d), d).toBe(true);
    }
  });

  it('is deterministic', () => {
    expect(JSON.stringify(mismatchLadder())).toBe(JSON.stringify(rows));
  });
});

describe('phase20k robust §25 large coordinates', () => {
  const rows = largeCoordinateStudy();

  it('keeps the exact tie exact at every offset and translates it rigidly', () => {
    expect(rows.map((r) => [r.dx, r.dy])).toEqual(LARGE_OFFSETS.map(([dx, dy]) => [dx, dy]));
    for (const row of rows) {
      expect(row.exactOutcome, `${row.dx}/${row.dy}`).toBe('ARC_PAIR_EXACT_COMMON_TIE');
      expect(row.finite).toBe(true);
      expect(Math.abs(row.residualX!).valueOf()).toBeLessThan(1e-6);
      expect(Math.abs(row.residualY!).valueOf()).toBeLessThan(1e-6);
      expect(row.residualZ).toBe(0);
      expect(row.det).not.toBeNull();
      expect(Number.isFinite(row.det!)).toBe(true);
    }
  });

  it('fails the 0.1 mm mismatch closed at every offset (no NaN/Inf growth)', () => {
    for (const row of rows) {
      expect(row.mismatchOutcome, `${row.dx}/${row.dy}`).not.toBe('ARC_PAIR_EXACT_COMMON_TIE');
      expect(row.mismatchFinite).toBe(true);
      expect(row.mismatchDetail === null || !row.mismatchDetail.includes('NaN')).toBe(true);
    }
  });

  it('is deterministic', () => {
    expect(JSON.stringify(largeCoordinateStudy())).toBe(JSON.stringify(rows));
  });
});
