/**
 * Phase 18R.1 imported-TIN preflight performance measurement (developer tooling only).
 *
 * Measures the combined fail-closed preflight validation + vertex transform +
 * project bounds recompute at 1k/10k/50k/100k imported-TIN vertices. No mesh
 * or index is built — only the kernel path. Reports wall-clock medians.
 *
 * Usage: `npx tsx scripts/benchmarks/benchmarkProjectTransformTinPreflight.ts`
 */
import { performance } from 'node:perf_hooks';

import { createBlankCadProject } from '../../src/engine/cad/cadDrawingFile';
import { applyCadProjectCoordinateTransform } from '../../src/engine/cad/cadProjectTransform';
import { uniformScaleAbout } from '../../src/engine/cad/cadTransform2D';
import type { CadProject, ImportedTinPayload } from '../../src/engine/cad/cadTypes';

const TARGETS = [1_000, 10_000, 50_000, 100_000];
const RUNS = 5;

/** Grid TIN: side×side vertices, two CCW triangles per cell (validation-clean). */
const gridPayload = (target: number): { payload: ImportedTinPayload; vertexCount: number } => {
  const side = Math.max(2, Math.ceil(Math.sqrt(target)));
  const vertices: number[] = [];
  const faces: number[] = [];
  for (let r = 0; r < side; r += 1) {
    for (let c = 0; c < side; c += 1) {
      vertices.push(c, r, 0);
    }
  }
  for (let r = 0; r < side - 1; r += 1) {
    for (let c = 0; c < side - 1; c += 1) {
      const a = r * side + c;
      const b = a + 1;
      const d = a + side;
      const e = d + 1;
      faces.push(a, b, e, a, e, d);
    }
  }
  return {
    payload: { vertices, faces, provenance: { format: 'LandXML', fileName: 'perf.xml', surfaceName: 'P' } },
    vertexCount: vertices.length / 3,
  };
};

const projectWithPayload = (payload: ImportedTinPayload): CadProject => {
  const project = createBlankCadProject({ name: 'T18R1-perf', units: 'm' });
  project.entities = [];
  project.surfaces = [{
    id: 'surf-perf',
    name: 'P',
    definition: { pointSource: { kind: 'points', pointEntityIds: [] }, sourceKind: 'imported-tin', importedTin: payload },
  }];
  return project;
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

const main = (): void => {
  const transform = uniformScaleAbout(0, 0, 1.00005);
  console.log('Phase 18R.1 imported-TIN preflight perf (preflight + transform + bounds, no mesh/index)\n');
  console.log('target   vertices      median ms     ms per 1k vertices');
  const rows: Array<{ vertexCount: number; ms: number }> = [];
  for (const target of TARGETS) {
    const { payload, vertexCount } = gridPayload(target);
    const project = projectWithPayload(payload);
    const samples: number[] = [];
    for (let i = 0; i < RUNS; i += 1) {
      const started = performance.now();
      const applied = applyCadProjectCoordinateTransform(project, transform, {
        transformId: `perf-${target}-${i}`,
        createdAtIso: '2026-09-20T12:00:00.000Z',
      });
      const elapsed = performance.now() - started;
      if (!applied.ok) throw new Error(`unexpected block: ${applied.reason}`);
      samples.push(elapsed);
    }
    const ms = median(samples);
    rows.push({ vertexCount, ms });
    console.log(
      `${String(target).padStart(6)}   ${String(vertexCount).padStart(8)}   ${ms.toFixed(2).padStart(10)}   ${((ms / vertexCount) * 1000).toFixed(4).padStart(17)}`,
    );
  }
  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  const growth = (last.ms / last.vertexCount) / (first.ms / first.vertexCount);
  console.log(`\nper-vertex cost growth 1k→100k: ${growth.toFixed(2)}× (linear sanity: <8×)`);
};

main();
