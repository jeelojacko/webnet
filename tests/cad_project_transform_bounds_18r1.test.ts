// Phase 18R.1 finding B: authoritative project bounds must include imported-TIN
// extents, not just entity geometry. Oracle tests route through the production
// PROJECTTRANSFORM entry (`applyCadProjectTransform` / `runCadCommand`) and
// compare against vertices transformed independently via the 2D kernel.
import { describe, expect, it } from 'vitest';

import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { applyCadProjectTransform } from '../src/engine/cad/cadProjectTransform';
import { buildCadProjectAuthoritativeBounds } from '../src/engine/cad/cadProjectAuthoritativeBounds';
import {
  applyPoint,
  compose,
  rotationAbout,
  translation,
  uniformScaleAbout,
  type CadTransform2D,
} from '../src/engine/cad/cadTransform2D';
import { createCadHistoryState, runCadCommand, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
import type { CadEntity, CadProject, ImportedTinPayload } from '../src/engine/cad/cadTypes';

const LAYER = 'L';
const base = { layerId: LAYER, visible: true, locked: false } as const;

const projectWith = (entities: CadEntity[], surfaces: CadProject['surfaces']): CadProject => {
  const project = createBlankCadProject({ name: 'T18R1', units: 'm' });
  project.layers = [{ id: LAYER, name: 'Test', color: '#ffffff', visible: true, locked: false, role: 'planning' }];
  project.currentLayerId = LAYER;
  project.entities = entities;
  return { ...project, surfaces };
};

const point = (id: string, x: number, y: number): CadEntity => ({
  ...base, id, type: 'survey-point', stationId: id, x, y, z: 0, pointClass: 'free', source: 'parsed-input',
});

const tinSurface = (id: string, vertices: number[]): NonNullable<CadProject['surfaces']>[number] => ({
  id,
  name: id,
  definition: {
    pointSource: { kind: 'points', pointEntityIds: [] },
    sourceKind: 'imported-tin',
    importedTin: {
      vertices: [...vertices],
      faces: [0, 1, 2],
      provenance: { format: 'LandXML', fileName: 'i.xml', surfaceName: id },
    } satisfies ImportedTinPayload,
  },
});

/** Independent oracle: min/max XY of explicitly transformed vertices. */
const expectedBounds = (transform: CadTransform2D, vertices: number[]) => {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i + 1 < vertices.length; i += 3) {
    const moved = applyPoint(transform, { x: vertices[i]!, y: vertices[i + 1]! });
    minX = Math.min(minX, moved.x);
    minY = Math.min(minY, moved.y);
    maxX = Math.max(maxX, moved.x);
    maxY = Math.max(maxY, moved.y);
  }
  return { minX, minY, maxX, maxY };
};

const expectBoundsClose = (
  actual: { minX: number; minY: number; maxX: number; maxY: number } | null,
  expected: { minX: number; minY: number; maxX: number; maxY: number },
) => {
  expect(actual).not.toBeNull();
  expect(actual!.minX).toBeCloseTo(expected.minX, 4);
  expect(actual!.minY).toBeCloseTo(expected.minY, 4);
  expect(actual!.maxX).toBeCloseTo(expected.maxX, 4);
  expect(actual!.maxY).toBeCloseTo(expected.maxY, 4);
};

// Translation + rotation + scale (scale first, then rotate, then translate).
const T = compose(translation(500, -300), compose(rotationAbout(0, 0, 37), uniformScaleAbout(0, 0, 1.5)));

// Two control pairs that encode exactly T for the SIMILARITY solver.
const controlPair = (sourceE: number, sourceN: number) => {
  const target = applyPoint(T, { x: sourceE, y: sourceN });
  return { sourceE, sourceN, targetE: target.x, targetN: target.y };
};
const pairs = [controlPair(2000000, 7000000), controlPair(2000100, 7000200)];

const request = { kind: 'HELMERT_2D', mode: 'SIMILARITY', pairs } as const;

describe('18R.1 authoritative bounds: imported-TIN extents', () => {
  it('TIN-only: zero entities still yields bounds enclosing the TIN; transform matches independent oracle; undo exact', () => {
    const vertices = [2000000, 7000000, 1, 2000100, 7000000, 2, 2000100, 7000200, 3];
    const project = projectWith([], [tinSurface('surf-tin', vertices)]);
    // Baseline authoritative bounds (entity geometry is empty here).
    const baseline = buildCadProjectAuthoritativeBounds(project);
    expect(baseline).toEqual({
      minX: 2000000, minY: 7000000, maxX: 2000100, maxY: 7000200,
    });
    // Seed project bounds so undo can be asserted against a real value.
    project.bounds = baseline;

    const applied = applyCadProjectTransform(project, request);
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error('transform failed');
    expect(applied.project.entities).toHaveLength(0);
    expectBoundsClose(applied.project.bounds, expectedBounds(T, vertices));

    // Undo through the production command returns bounds bit-exactly.
    const history = createCadHistoryState(project, []);
    const committed = runCadCommand(history, { key: 'PROJECTTRANSFORM', request });
    expect(committed.present.project.bounds).not.toBeNull();
    const undone = undoCadHistory(committed);
    expect(undone.present.project.bounds).toEqual(project.bounds);
    expect(undone.present.project.surfaces).toEqual(project.surfaces);
    expect(undone.present.project.bounds).toEqual(baseline);
  });

  it('mixed: far-west point + far-east TIN union both extents', () => {
    const vertices = [2000000, 7000000, 1, 2000100, 7000000, 2, 2000100, 7000200, 3];
    const west = point('P-west', -5000000, 6000000);
    const project = projectWith([west], [tinSurface('surf-tin', vertices)]);

    const applied = applyCadProjectTransform(project, request);
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error('transform failed');

    const expectedPoint = applyPoint(T, { x: -5000000, y: 6000000 });
    const expectedTin = expectedBounds(T, vertices);
    expectBoundsClose(applied.project.bounds, {
      minX: Math.min(expectedPoint.x, expectedTin.minX),
      minY: Math.min(expectedPoint.y, expectedTin.minY),
      maxX: Math.max(expectedPoint.x, expectedTin.maxX),
      maxY: Math.max(expectedPoint.y, expectedTin.maxY),
    });
  });
});
