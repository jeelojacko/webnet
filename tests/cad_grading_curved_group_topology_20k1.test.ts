/** Phase 20K.1 Wave B1 — topology validator contracts (6 cases, no gate). */
import { describe, expect, it } from 'vitest';
import { validateGradingMeshTopology } from '../src/engine/cad/grading/gradingTopology';

// Quad strip (open): verts 0..3, two triangles.
const stripPts = [0, 0, 0, 10, 0, 0, 10, 2, 0, 0, 2, 0];
const stripTris = [0, 1, 2, 0, 2, 3];

// Annular shell: outer 0..3, inner 4..7, band of 8 triangles, 2 loops.
const ringPts = [0, 0, 0, 4, 0, 0, 4, 4, 0, 0, 4, 0, 1, 1, 0, 3, 1, 0, 3, 3, 0, 1, 3, 0];
const ringTris = [0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];

describe('validateGradingMeshTopology', () => {
  it('valid open strip ok', () => {
    const r = validateGradingMeshTopology(stripPts, stripTris, { expectedComponents: 1, expectedBoundaryLoops: 1 });
    expect(r).toMatchObject({ ok: true, components: 1, loops: 1 });
  });
  it('valid annular shell ok', () => {
    const r = validateGradingMeshTopology(ringPts, ringTris, { expectedComponents: 1, expectedBoundaryLoops: 2 });
    expect(r).toMatchObject({ ok: true, components: 1, loops: 2 });
  });
  it('vertex pinch fails PINCH', () => {
    // Two quads sharing only vertex 0 (bowtie at a point).
    const pts = [0, 0, 0, 1, 0, 0, 1, 1, 0, -1, 0, 0, -1, -1, 0];
    const tris = [0, 1, 2, 0, 3, 4];
    const r = validateGradingMeshTopology(pts, tris, { expectedComponents: 1 });
    expect(r.ok).toBe(false);
    expect(r.code).toContain('PINCH');
  });
  it('duplicate face fails', () => {
    const r = validateGradingMeshTopology(stripPts, [0, 1, 2, 0, 1, 2], { expectedComponents: 1 });
    expect(r.ok).toBe(false);
    expect(r.code).toContain('NON_MANIFOLD');
  });
  it('two unexplained components fail NON_MANIFOLD', () => {
    const pts = [...stripPts, 20, 20, 0, 30, 20, 0, 30, 22, 0, 20, 22, 0];
    const tris = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
    const r = validateGradingMeshTopology(pts, tris, { expectedComponents: 1 });
    expect(r).toMatchObject({ ok: false, components: 2 });
    expect(r.code).toContain('NON_MANIFOLD');
  });
  it('legitimate tied split ok', () => {
    const pts = [...stripPts, 20, 20, 0, 30, 20, 0, 30, 22, 0, 20, 22, 0];
    const tris = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
    const r = validateGradingMeshTopology(pts, tris, { expectedComponents: 1, tiedSplitStations: [4] });
    expect(r.ok).toBe(true);
  });
});
