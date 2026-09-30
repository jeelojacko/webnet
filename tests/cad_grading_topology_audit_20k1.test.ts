/**
 * Phase 20K.1 Wave A1 — audit-correction self-tests (agent tier, fast).
 *
 * Covers the 9 segment relations of the corrected `segmentsCross` plus the
 * index-vs-geometric topology distinction (synthetic pinch/overlap, valid
 * annular shell, valid open strip, legitimate tied split vs geometric-only
 * seam). No production routing touched.
 */
import { describe, expect, it } from 'vitest';

import type { MergePoint } from '../src/engine/cad/grading/gradingGroupMerge';
import {
  auditMesh,
  closedRingSimple,
  geometricDiagnostic,
  orient,
  segmentsCross,
} from '../scripts/phase20kHybridArcPairAudit';

const p = (x: number, y: number, z = 0): MergePoint => ({ x, y, z });

describe('phase20k.1 corrected segment intersection', () => {
  it('1. transverse crossing counts', () => {
    expect(segmentsCross(p(0, 0), p(10, 10), p(0, 10), p(10, 0))).toBe(true);
  });

  it('2. separated nonparallel segments do not cross', () => {
    expect(segmentsCross(p(0, 0), p(10, 0), p(11, 1), p(20, 9))).toBe(false);
  });

  it('3. separated parallel segments do not cross', () => {
    expect(segmentsCross(p(0, 0), p(10, 0), p(0, 5), p(10, 5))).toBe(false);
  });

  it('4. shared endpoint: adjacent skipped, non-adjacent counts', () => {
    // Non-adjacent shared endpoint is a pinch → true at the pair level.
    expect(segmentsCross(p(0, 0), p(10, 0), p(10, 0), p(5, 10))).toBe(true);
    // Adjacent daylight segments sharing their expected endpoint → no flag.
    expect(closedRingSimple([p(0, 0), p(10, 0), p(10, 10)])).toBe(true);
  });

  it('5. collinear disjoint segments do not cross', () => {
    expect(segmentsCross(p(0, 0), p(10, 0), p(11, 0), p(20, 0))).toBe(false);
  });

  it('6. collinear touching (non-adjacent) counts', () => {
    expect(segmentsCross(p(0, 0), p(10, 0), p(10, 0), p(20, 0))).toBe(true);
  });

  it('7. collinear overlap counts as self-intersection', () => {
    expect(segmentsCross(p(0, 0), p(10, 0), p(5, 0), p(15, 0))).toBe(true);
  });

  it('8. near-collinear shallow crossing still counts', () => {
    expect(segmentsCross(p(0, 0), p(10, 0), p(5, -1), p(5 + 1e-12, 1))).toBe(true);
    expect(orient(p(0, 0), p(10, 0), p(5, -1))).toBe(-1);
    expect(orient(p(0, 0), p(10, 0), p(5 + 1e-12, 1))).toBe(1);
  });

  it('9. large-coordinate translated transverse crossing matches case 1', () => {
    const dx = 2e6;
    const dy = 7e6;
    expect(segmentsCross(p(dx, dy), p(10 + dx, 10 + dy), p(dx, 10 + dy), p(10 + dx, dy))).toBe(true);
  });
});

describe('phase20k.1 index-vs-geometric topology', () => {
  it('rejects a synthetic vertex pinch (edge-disconnected, vertex-connected)', () => {
    const mesh = {
      points: [0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 20, 0, -10, 10, 0],
      triangles: [0, 1, 2, 2, 3, 4],
    };
    const audit = auditMesh(mesh, [], false);
    expect(audit.components).toBe(1);
    expect(audit.edgeComponents).toBe(2);
    expect(audit.checks.edgeConnected).toBe(false);
    expect(audit.pass).toBe(false);
  });

  it('rejects a synthetic interior overlap', () => {
    const mesh = {
      points: [0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 0.001, 10, 0, 0.001, 0, 10, 0.001],
      triangles: [0, 1, 2, 3, 4, 5],
    };
    const audit = auditMesh(mesh, [], false);
    expect(audit.checks.noInteriorOverlap).toBe(false);
    expect(audit.pass).toBe(false);
  });

  it('passes a valid annular shell', () => {
    const mesh = {
      points: [0, 0, 0, 12, 0, 0, 12, 12, 0, 0, 12, 0, 4, 4, 0, 8, 4, 0, 8, 8, 0, 4, 8, 0],
      triangles: [
        0, 1, 5, 0, 5, 4,
        1, 2, 6, 1, 6, 5,
        2, 3, 7, 2, 7, 6,
        3, 0, 4, 3, 4, 7,
      ],
    };
    const outer = [p(0, 0), p(12, 0), p(12, 12), p(0, 12)];
    const audit = auditMesh(mesh, outer, true, 128);
    expect(audit.edgeComponents).toBe(1);
    expect(audit.boundaryEdges).toBe(8);
    expect(audit.pass).toBe(true);
  });

  it('passes a valid open strip', () => {
    const mesh = {
      points: [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0],
      triangles: [0, 1, 2, 0, 2, 3],
    };
    const audit = auditMesh(mesh, [p(0, 0), p(10, 0), p(10, 10), p(0, 10)], false, 100);
    expect(audit.pass).toBe(true);
  });

  it('distinguishes a legitimate tied split from a geometric-only seam', () => {
    // Indexed seam: shared vertices, one edge-component, nothing to weld.
    const tied = {
      points: [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0],
      triangles: [0, 1, 2, 0, 2, 3],
    };
    expect(auditMesh(tied, [p(0, 0), p(10, 0), p(10, 10), p(0, 10)], false, 100).pass).toBe(true);
    const tiedDiag = geometricDiagnostic(tied);
    expect(tiedDiag.indexEdgeComponents).toBe(1);
    expect(tiedDiag.coincidentSets).toEqual([]);
    expect(tiedDiag.coincidentNonSharedEdges).toBe(0);
    expect(tiedDiag.weldedEdgeComponents).toBe(1);
    // Geometric-only seam: same plan geometry, duplicated seam vertices —
    // index says two components, the diagnostic-only weld heals to one.
    const split = {
      points: [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 0, 0, 10, 10, 0, 0, 10, 0],
      triangles: [0, 1, 2, 3, 4, 5],
    };
    const splitAudit = auditMesh(split, [p(0, 0), p(10, 0), p(10, 10), p(0, 10)], false, 100);
    expect(splitAudit.edgeComponents).toBe(2);
    expect(splitAudit.pass).toBe(false);
    const splitDiag = geometricDiagnostic(split);
    expect(splitDiag.indexEdgeComponents).toBe(2);
    expect(splitDiag.coincidentSets.length).toBeGreaterThan(0);
    expect(splitDiag.coincidentNonSharedEdges).toBeGreaterThan(0);
    expect(splitDiag.weldedEdgeComponents).toBe(1);
  });
});
