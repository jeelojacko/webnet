/**
 * Phase 18T point-edit performance campaign (§100-102) — EVIDENCE tier.
 *
 * MANUAL ONLY (tests/evidence/, npm run test:evidence). Measures the full
 * 10k / 50k / 100k-vertex point-edit envelope: replay+compact+topology via
 * replaySurfaceEdits, grid/stats via buildSurfaceGrid + computeSurfaceFaceStats,
 * and end-to-end total via buildCadSurface, for the 5 stacks (set1000 /
 * move100 / delete100 / add100 / mixed1000). Also records the WNCAD semantic
 * history delta for 1000 point edits.
 *
 * NO millisecond assertions: this is evidence. Correctness (outcome +
 * topology counts) is asserted so a broken run cannot masquerade as slow.
 * Reference: Phase 18S recorded 100k verts / 1000 edge edits ≈ 693 ms replay
 * (docs/evidence/phase18s-performance.md); see docs/evidence/phase18t/.
 */
import { describe, expect, it } from 'vitest';
import {
  buildCadSurface,
  buildSurfaceGrid,
  computeCadSurfaceSourceRevision,
  replaySurfaceEdits,
} from '../../src/engine/cad/cadSurfaces';
import { computeSurfaceFaceStats } from '../../src/engine/cad/surfaceAnalysis';
import { createBlankCadDrawingDocument, serializeCadDrawingFile } from '../../src/engine/cad/cadDrawingFile';
import type { CadProject, CadSurface } from '../../src/engine/cad/cadTypes';
import { gridFixture } from '../cadSurfacePointEdits18tFixtures';
import { expectedDelta, perfStacks, setElevEdits, spacedCells } from '../cadSurfacePointEdits18tPerf';

const ms = (value: number): string => `${value.toFixed(1)}ms`;

describe('18T point-edit performance campaign (10k/50k/100k)', () => {
  it('measures replay/grid-stats/total for every stack across the size sweep', () => {
    const sizes: Array<{ side: number; label: string }> = [
      { side: 100, label: '10k' },
      { side: 224, label: '50k' },
      { side: 317, label: '100k' },
    ];
    const report: string[] = [];
    for (const { side, label } of sizes) {
      const { project, surface } = gridFixture({ side });
      const baselineStart = performance.now();
      const base = buildCadSurface(project, surface);
      const baselineTotal = performance.now() - baselineStart;
      expect(base.outcome).toBe('ok');
      report.push(`\n[18T evidence] ${label}: ${base.points.length} pts / ${base.triangles.length} tris, baseline build=${ms(baselineTotal)}`);
      for (const stack of perfStacks(side)) {
        const edited: CadSurface = { ...surface, definition: { ...surface.definition, edits: stack.edits } };
        const editedProject: CadProject = { ...project, surfaces: [edited] };
        const totalStart = performance.now();
        const built = buildCadSurface(editedProject, edited);
        const total = performance.now() - totalStart;
        expect(built.outcome).toBe('ok');
        expect(built.triangles).toHaveLength(base.triangles.length + expectedDelta(stack.name));

        const replayStart = performance.now();
        const replayed = replaySurfaceEdits(stack.edits, {
          points: base.points,
          triangles: base.triangles,
          adjacency: base.adjacency,
          edgeKinds: base.edgeKinds,
          constrained: new Map(),
        }, surface.id);
        const replay = performance.now() - replayStart;
        if ('failure' in replayed) throw new Error(`fixture replay failed: ${replayed.failure.reason}`);
        const gridStart = performance.now();
        buildSurfaceGrid(replayed.points, replayed.triangles);
        computeSurfaceFaceStats(replayed.points, replayed.triangles);
        const gridStats = performance.now() - gridStart;
        report.push(
          `  ${stack.name.padEnd(10)} edits=${String(stack.edits.length).padStart(4)} ` +
          `replay=${ms(replay).padStart(10)} grid/stats=${ms(gridStats).padStart(9)} total=${ms(total).padStart(10)}`,
        );
      }
      // WNCAD semantic history delta for 1000 set-elevation edits at this size.
      const edits1000 = setElevEdits(spacedCells(side, 1000, 1, 2), 'w');
      const editedSurface: CadSurface = { ...surface, definition: { ...surface.definition, edits: edits1000 } };
      const doc = (s: CadProject) => serializeCadDrawingFile({ ...createBlankCadDrawingDocument({ name: 'p', units: 'm' }), project: s });
      const plainBytes = doc(project).length;
      const editedBytes = doc({ ...project, surfaces: [editedSurface] }).length;
      expect(editedBytes).toBeGreaterThan(plainBytes);
      expect(computeCadSurfaceSourceRevision({ ...project, surfaces: [editedSurface] }, editedSurface))
        .not.toBe(computeCadSurfaceSourceRevision(project, surface));
      report.push(
        `  WNCAD 1000 edits: ${plainBytes} -> ${editedBytes} bytes ` +
        `(+${editedBytes - plainBytes}, ${(((editedBytes - plainBytes) / plainBytes) * 100).toFixed(2)}%)`,
      );
    }
    console.info(report.join('\n'));
  }, 600_000);
});
