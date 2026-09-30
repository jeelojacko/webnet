/**
 * Phase 20J Wave A — ray/triangle interval parallel-edge regressions.
 *
 * Exercises the production `solveMiterTie` ray path (which owns the
 * plan-only `rayTriangleInterval`): axis vs 10deg-rotated equivalence,
 * alternate diagonals, parallel-outside rejection, edge/vertex/shared-edge
 * hits, root counts, target gap, large coordinates, reversed rays, and the
 * frozen due-south quirk tie (0,-20,90).
 */
import { describe, expect, it } from 'vitest';

import type {
  GradingTargetMeshSnapshot,
  TargetQuery,
} from '../src/engine/cad/grading/gradingComputeTypes';
import { solveMiterTie } from '../src/engine/cad/grading/gradingGroupSectors';
import type { CornerGradingPlane } from '../src/engine/cad/grading/gradingCornerMath';
import { buildTargetQuery } from '../src/engine/cad/grading/gradingTargetIndex';

const plane = (
  ax: number,
  ay: number,
  zAtV: number,
  gx: number,
  gy: number,
): CornerGradingPlane => ({ ax, ay, zAtV, gx, gy });

/** Flat axis square centered at origin, half-size h, diagonal select. */
const flatSquare = (h: number, z: number, diag = 0): GradingTargetMeshSnapshot => ({
  points: [-h, -h, z, h, -h, z, h, h, z, -h, h, z],
  triangles: diag === 0 ? [0, 1, 2, 0, 2, 3] : [0, 1, 3, 1, 2, 3],
});

const rotateSnapshot = (snap: GradingTargetMeshSnapshot, deg: number): GradingTargetMeshSnapshot => {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const points = [...snap.points];
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i]!;
    const y = points[i + 1]!;
    points[i] = x * c - y * s;
    points[i + 1] = x * s + y * c;
  }
  return { points, triangles: [...snap.triangles] };
};

const offsetSnapshot = (snap: GradingTargetMeshSnapshot, dx: number, dy: number): GradingTargetMeshSnapshot => {
  const points = [...snap.points];
  for (let i = 0; i < points.length; i += 3) {
    points[i]! += dx;
    points[i + 1]! += dy;
  }
  return { points, triangles: [...snap.triangles] };
};

const allCandidates = (snap: GradingTargetMeshSnapshot): number[] =>
  Array.from({ length: snap.triangles.length / 3 }, (_, i) => i);

const queryOf = (snap: GradingTargetMeshSnapshot): TargetQuery => {
  const q = buildTargetQuery(snap);
  if (!q) throw new Error('bad target snapshot');
  return q;
};

const tie = (
  snap: GradingTargetMeshSnapshot,
  p: CornerGradingPlane,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  tMax: number,
) => solveMiterTie(snap, allCandidates(snap), queryOf(snap), p, ox, oy, dx, dy, tMax);

const SOUTH = plane(0, 0, 100, 0, 0.5);
const WEST_GRAD = plane(0, 0, 100, -0.5, 0);

describe('20J Wave A: axis square vertical + horizontal rays', () => {
  it('due-south ray ties at (0,-20,90)', () => {
    const out = tie(flatSquare(50, 90), SOUTH, 0, 0, 0, -1, 100);
    if (!out.ok) throw new Error(`expected tie, got ${out.code}`);
    expect(out.x).toBeCloseTo(0, 9);
    expect(out.y).toBeCloseTo(-20, 9);
    expect(out.z).toBeCloseTo(90, 9);
    expect(out.rootCount).toBe(1);
  });
  it('due-east ray ties at (20,0,90)', () => {
    const out = tie(flatSquare(50, 90), WEST_GRAD, 0, 0, 1, 0, 100);
    if (!out.ok) throw new Error(`expected tie, got ${out.code}`);
    expect(out.x).toBeCloseTo(20, 9);
    expect(out.y).toBeCloseTo(0, 9);
    expect(out.z).toBeCloseTo(90, 9);
  });
});

describe('20J Wave A: rotated + alternate diagonal equivalence', () => {
  const targets = [
    ['axis', flatSquare(50, 90, 0)],
    ['rotated10', rotateSnapshot(flatSquare(50, 90, 0), 10)],
    ['alt-diag', flatSquare(50, 90, 1)],
  ] as const;
  for (const [name, snap] of targets) {
    it(`${name}: south tie matches axis tie`, () => {
      const out = tie(snap, SOUTH, 0, 0, 0, -1, 100);
      const ref = tie(flatSquare(50, 90, 0), SOUTH, 0, 0, 0, -1, 100);
      if (!out.ok || !ref.ok) throw new Error('expected ties');
      expect(out.x).toBeCloseTo(ref.x, 9);
      expect(out.y).toBeCloseTo(ref.y, 9);
      expect(out.z).toBeCloseTo(ref.z, 9);
    });
  }
  it('rotated east tie matches axis east tie', () => {
    const ref = tie(flatSquare(50, 90, 0), WEST_GRAD, 0, 0, 1, 0, 100);
    const out = tie(rotateSnapshot(flatSquare(50, 90, 0), 10), WEST_GRAD, 0, 0, 1, 0, 100);
    if (!out.ok || !ref.ok) throw new Error('expected ties');
    expect(out.x).toBeCloseTo(ref.x, 6);
    expect(out.y).toBeCloseTo(ref.y, 6);
  });
});

describe('20J Wave A: interval edge cases', () => {
  const box: GradingTargetMeshSnapshot = {
    points: [0, 0, 90, 10, 0, 90, 10, 10, 90, 0, 10, 90],
    triangles: [0, 1, 2, 0, 2, 3],
  };
  it('parallel outside returns no solution', () => {
    const out = tie(box, plane(-5, 20, 95, -0.5, 0), -5, 20, 1, 0, 100);
    expect(out.ok).toBe(false);
  });
  it('edge-grazing ray along x=0 still ties', () => {
    const out = tie(box, plane(0, -50, 95, 0, -0.1), 0, -50, 0, 1, 200);
    if (!out.ok) throw new Error(`edge graze failed: ${out.code}`);
    expect(out.x).toBeCloseTo(0, 9);
    expect(out.z).toBeCloseTo(90, 9);
  });
  it('vertex-crossing ray ties inside', () => {
    const d = Math.SQRT1_2;
    const g = -0.5 * d;
    const out = tie(box, plane(-10, -10, 100, g, g), -10, -10, d, d, 100);
    if (!out.ok) throw new Error(`vertex ray failed: ${out.code}`);
    expect(out.x).toBeCloseTo(4.14213562, 6);
    expect(out.y).toBeCloseTo(4.14213562, 6);
  });
  it('shared-diagonal crossing ties on the seam', () => {
    const out = tie(box, plane(-5, 5, 95, -0.5, 0), -5, 5, 1, 0, 100);
    if (!out.ok) throw new Error(`seam crossing failed: ${out.code}`);
    expect(out.x).toBeCloseTo(5, 9);
    expect(out.y).toBeCloseTo(5, 9);
  });
  it('reversed ray finds no forward root', () => {
    const out = tie(flatSquare(50, 90), SOUTH, 0, 0, 0, 1, 100);
    expect(out.ok).toBe(false);
  });
});

describe('20J Wave A: root counts, gap, large coords', () => {
  it('parallel-above plane yields zero roots (NO_SOLUTION)', () => {
    const out = tie(flatSquare(50, 90), plane(0, 0, 100, 0, 0), 0, 0, 0, -1, 40);
    expect(out).toEqual({ ok: false, code: 'CORNER_NO_SOLUTION' });
  });
  it('stepped target yields multiple roots', () => {
    const snap: GradingTargetMeshSnapshot = {
      points: [0, -5, 95, 10, -5, 95, 10, 5, 95, 0, 5, 95, 10, -5, 85, 20, -5, 85, 20, 5, 85, 10, 5, 85],
      triangles: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
    };
    const out = tie(snap, plane(0, 0, 100, -1, 0), 0, 0, 1, 0, 30);
    if (!out.ok) throw new Error(`stepped target failed: ${out.code}`);
    expect(out.rootCount).toBe(2);
    expect(out.x).toBeCloseTo(5, 9);
  });
  it('ray running off the target reports TARGET_GAP', () => {
    const snap: GradingTargetMeshSnapshot = {
      points: [0, 0, 90, 10, 0, 90, 10, 10, 90, 0, 10, 90],
      triangles: [0, 1, 2, 0, 2, 3],
    };
    const out = tie(snap, plane(5, 5, 100, -0.5, 0), 5, 5, 1, 0, 1000);
    expect(out).toEqual({ ok: false, code: 'CORNER_TARGET_GAP' });
  });
  it('large coordinates preserve the tie', () => {
    const big = offsetSnapshot(flatSquare(50, 90), 1e6, 1e6);
    const p = plane(1e6, 1e6, 100, 0, 0.5);
    const out = tie(big, p, 1e6, 1e6, 0, -1, 100);
    if (!out.ok) throw new Error(`large-coord tie failed: ${out.code}`);
    expect(out.x).toBeCloseTo(1e6, 3);
    expect(out.y).toBeCloseTo(1e6 - 20, 3);
    expect(out.z).toBeCloseTo(90, 6);
  });
});

describe('20J Wave A: frozen due-south quirk', () => {
  it('surface z=100+0.5y south from (0,0) ties (0,-20,90)', () => {
    const out = tie(flatSquare(50, 90), plane(0, 0, 100, 0, 0.5), 0, 0, 0, -1, 100);
    if (!out.ok) throw new Error(`quirk regressed: ${out.code}`);
    expect(out.x).toBeCloseTo(0, 9);
    expect(out.y).toBeCloseTo(-20, 9);
    expect(out.z).toBeCloseTo(90, 9);
  });
});
