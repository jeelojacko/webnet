/**
 * Phase 18T point-edit performance pins (§100-102) — agent tier.
 *
 * MEASUREMENT, not a gate: the 10k-vertex grid runs every stack and prints
 * replay/compact/topology + grid/stats + total; the WNCAD semantic-history
 * delta for 1000 edits is printed too. Assertions cover correctness only
 * (outcome + topology counts), never milliseconds — the 50k/100k campaign
 * lives in tests/evidence/phase18t_point_edit_perf.test.ts (frozen tier).
 */
import { describe, expect, it } from 'vitest';
import {
  buildCadSurface,
  buildSurfaceGrid,
  computeCadSurfaceSourceRevision,
  replaySurfaceEdits,
} from '../src/engine/cad/cadSurfaces';
import { computeSurfaceFaceStats } from '../src/engine/cad/surfaceAnalysis';
import { createBlankCadDrawingDocument, serializeCadDrawingFile } from '../src/engine/cad/cadDrawingFile';
import type { CadProject, CadSurface } from '../src/engine/cad/cadTypes';
import { gridFixture } from './cadSurfacePointEdits18tFixtures';
import { expectedDelta, perfStacks, setElevEdits, spacedCells } from './cadSurfacePointEdits18tPerf';

const ms = (value: number): string => `${value.toFixed(1)}ms`;

const projectWithEdits = (project: CadProject, surface: CadSurface, edits: CadSurface['definition']['edits']): { project: CadProject; surface: CadSurface } => {
  const edited: CadSurface = { ...surface, definition: { ...surface.definition, edits } };
  return { project: { ...project, surfaces: [edited] }, surface: edited };
};

describe('18T point-edit performance (§100-102, measured)', () => {
  it('10k-vertex grid: replay+compact+topology, grid/stats, total, WNCAD delta', () => {
    const side = 100; // 10,000 vertices / 19,602 triangles
    const { project, surface } = gridFixture({ side });
    const baselineStart = performance.now();
    const base = buildCadSurface(project, surface);
    const baselineTotal = performance.now() - baselineStart;
    expect(base.outcome).toBe('ok');

    const rows: string[] = [];
    for (const stack of perfStacks(side)) {
      const { project: editedProject, surface: editedSurface } = projectWithEdits(project, surface, stack.edits);
      const totalStart = performance.now();
      const built = buildCadSurface(editedProject, editedSurface);
      const total = performance.now() - totalStart;
      expect(built.outcome).toBe('ok');
      expect(built.triangles).toHaveLength(base.triangles.length + expectedDelta(stack.name));

      // Isolate replay/compact/topology and grid/stats on the same stack.
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
      rows.push(
        `${stack.name.padEnd(10)} edits=${String(stack.edits.length).padStart(4)} ` +
        `replay=${ms(replay).padStart(9)} grid/stats=${ms(gridStats).padStart(8)} total=${ms(total).padStart(9)}`,
      );
    }

    // WNCAD semantic-history delta for 1000 point edits.
    const edits1000 = setElevEdits(spacedCells(side, 1000, 1, 2), 'w');
    const { surface: editedSurface } = projectWithEdits(project, surface, edits1000);
    const doc = (s: CadProject) => serializeCadDrawingFile({ ...createBlankCadDrawingDocument({ name: 'p', units: 'm' }), project: s });
    const plainBytes = doc(project).length;
    const editedBytes = doc({ ...project, surfaces: [editedSurface] }).length;
    // Sanity: the edit stack is part of the persisted semantic record.
    expect(editedBytes).toBeGreaterThan(plainBytes);
    expect(computeCadSurfaceSourceRevision({ ...project, surfaces: [editedSurface] }, editedSurface))
      .not.toBe(computeCadSurfaceSourceRevision(project, surface));

    console.info(
      `\n[18T perf] 10k vertices (${base.points.length} pts / ${base.triangles.length} tris) ` +
      `baseline build=${ms(baselineTotal)}\n${rows.join('\n')}\n` +
      `[18T perf] WNCAD 1000 set-elev edits: ${plainBytes} -> ${editedBytes} bytes ` +
      `(+${editedBytes - plainBytes}, ${(((editedBytes - plainBytes) / plainBytes) * 100).toFixed(2)}%)`,
    );
  }, 60_000);
});
