/**
 * Phase 18Q transform-preview performance probe (measurement only).
 *
 * Times `buildTransformedPreviewPrimitives` (the single derivation behind
 * ROTATE / SCALE / MIRROR / ALIGN2D / HELMERT2D / GRIDGROUND ghosts) for
 * 100 / 1,000 / 5,000 selected simple line entities, against the same
 * pipeline with a pure translation (the MOVE-ghost equivalent code path).
 * Scene construction is setup (untimed); only preview derivation is timed.
 *
 * No src/ behavior changes. Timing verdicts are advisory (printed, not
 * gated); the process fails only when derivation throws or drops primitives.
 *
 * Usage: `npx tsx scripts/phase18qTransformPerf.ts [--quick]`
 */
import { performance } from 'node:perf_hooks';

import { buildCadDisplayScene } from '../src/engine/cad/cadRenderer';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { rotationAbout, translation } from '../src/engine/cad/cadTransform2D';
import { buildTransformedPreviewPrimitives } from '../src/engine/cad/cadTransformPreview';
import type { CadEntity, CadProject } from '../src/engine/cad/cadTypes';

const QUICK = process.argv.includes('--quick');
const SIZES = QUICK ? [100, 1000] : [100, 1000, 5000];
const RUNS = 5;

const projectWithLines = (count: number): { project: CadProject; ids: string[] } => {
  const project = createBlankCadProject({ name: 'T18Q-PERF', units: 'm' });
  const layer = { id: 'L', name: 'L', color: '#ffffff', visible: true, locked: false, role: 'planning' as const };
  project.layers = [layer];
  project.currentLayerId = 'L';
  const entities: CadEntity[] = [];
  const ids: string[] = [];
  for (let index = 0; index < count; index++) {
    const id = `l${index + 1}`;
    ids.push(id);
    entities.push({
      layerId: 'L', visible: true, locked: false, id, type: 'line',
      fromStationId: 'A', toStationId: 'B',
      fromX: index, fromY: index * 2, toX: index + 10, toY: index * 2,
      sourceObservationIds: [],
    });
  }
  project.entities = entities;
  return { project, ids };
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

for (const size of SIZES) {
  const { project, ids } = projectWithLines(size);
  const scene = buildCadDisplayScene(project);
  if (scene.primitives.length < size) {
    throw new Error(`scene built ${scene.primitives.length} primitives for ${size} lines`);
  }
  // HELMERT-like solved transform (rotate + translate) vs MOVE-style translate.
  const helmertLike = rotationAbout(500, 500, 12.5);
  const moveLike = translation(5, 7);
  const time = (label: string): number => {
    const samples: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      const start = performance.now();
      const out = buildTransformedPreviewPrimitives(
        scene.primitives,
        ids,
        label === 'helmert-like' ? helmertLike : moveLike,
      );
      samples.push(performance.now() - start);
      if (out.length !== size) throw new Error(`${label} dropped primitives at ${size}`);
    }
    return median(samples);
  };
  const helmertMs = time('helmert-like');
  const moveMs = time('move-like');
  console.log(
    `selected=${size} preview-derivation median-of-${RUNS}: ` +
    `transform=${helmertMs.toFixed(2)}ms move-baseline=${moveMs.toFixed(2)}ms ` +
    `(${(helmertMs / size).toFixed(4)}ms/entity)`,
  );
}
console.log('done: preview derivation only; full-scene SVG rerender not included.');
