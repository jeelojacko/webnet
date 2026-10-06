/** Circle v1 consumers: bounds/render/spatial/intersections/grips/props/transforms/blocks/refusals/regressions. */
import { describe, expect, it } from 'vitest';

import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import {
  buildCadDisplayScene,
} from '../src/engine/cad/cadRenderer';
import { entityIntersectsBounds } from '../src/engine/cad/cadSpatialBounds';
import {
  buildExactIntersectionCandidates,
} from '../src/engine/cad/cadSpatialIntersectionCandidates';
import { circleRefFromEntity } from '../src/engine/cad/cadSpatialEntityRefs';
import {
  classifyTransform,
  reflectionAboutLine,
  rotationAbout,
  translation,
  uniformScaleAbout,
} from '../src/engine/cad/cadTransform2D';
import { transformCadEntityGeometry } from '../src/engine/cad/cadTransformGeometry';
import { transformBlockChildToWorld } from '../src/engine/cad/cadBlocks';
import { buildCadPropertiesPanelState } from '../src/engine/cad/cadProperties';
import { buildMlightcadSpikeScene } from '../src/engine/cad/cadMlightcadAdapter';
import { isTrimmableEntity } from '../src/engine/cad/cadTransactionsTrimCommon';
import type { CadCircleEntity, CadProject } from '../src/engine/cad/cadTypes';
import {
  createCadHistoryState,
  runCadCommand,
} from '../src/engine/cad/cadUndoRedo';
import type { CadCommand } from '../src/engine/cad/cadTransactions.types';

const blankProject = (): CadProject => createBlankCadProject({ name: 'circle consumer', units: 'm' });

const commitCircle = (project: CadProject): { project: CadProject; entity: CadCircleEntity } => {
  const history = runCadCommand(createCadHistoryState(project), {
    key: 'CIRCLE',
    center: { x: 10, y: 20, label: 'C' },
    radius: 15,
  } as CadCommand);
  const entity = history.present.project.entities.find(
    (candidate): candidate is CadCircleEntity => candidate.type === 'circle',
  )!;
  expect(entity).toBeDefined();
  return { project: history.present.project, entity };
};

describe('circle bounds and rendering', () => {
  it('bounds are exactly center +/- radius', () => {
    const { project, entity } = commitCircle(blankProject());
    expect(
      entityIntersectsBounds(project, entity, { minX: 0, minY: 0, maxX: 100, maxY: 100 }),
    ).toBe(true);
    expect(
      entityIntersectsBounds(project, entity, { minX: 200, minY: 200, maxX: 300, maxY: 300 }),
    ).toBe(false);
    // Rim touch counts: circle reaches x=25 and x=-5/y=35 exactly.
    expect(
      entityIntersectsBounds(project, entity, { minX: 25, minY: 20, maxX: 26, maxY: 21 }),
    ).toBe(true);
  });
  it('renders one native full-ring circle primitive, never an arc', () => {
    const { project, entity } = commitCircle(blankProject());
    const scene = buildCadDisplayScene(project);
    const primitives = scene.primitives.filter((primitive) => primitive.sourceEntityId === entity.id);
    expect(primitives).toHaveLength(1);
    expect(primitives[0]!.kind).toBe('circle');
    if (primitives[0]!.kind === 'circle') {
      expect(primitives[0]!.center).toEqual({ x: 10, y: 20 });
      expect(primitives[0]!.radius).toBe(15);
    }
  });
});

describe('circle intersections (truthful dispatch)', () => {
  it('line secant/tangent/disjoint via segment-circle', () => {
    const { project, entity } = commitCircle(blankProject());
    const ref = circleRefFromEntity(project, entity);
    const worldPoint = { x: 0, y: 0 };
    const secant = buildExactIntersectionCandidates({
      segments: [{
        segmentId: 's1', sourceEntityId: 'line', label: 'line',
        start: { x: -100, y: 20 }, end: { x: 100, y: 20 },
        startLabel: 'a', endLabel: 'b',
      }],
      arcs: [],
      circles: [ref],
      worldPoint,
    });
    expect(secant.length).toBe(2);
    const tangent = buildExactIntersectionCandidates({
      segments: [{
        segmentId: 's1', sourceEntityId: 'line', label: 'line',
        start: { x: -100, y: 35 }, end: { x: 100, y: 35 },
        startLabel: 'a', endLabel: 'b',
      }],
      arcs: [],
      circles: [ref],
      worldPoint,
    });
    expect(tangent.length).toBe(1);
    const disjoint = buildExactIntersectionCandidates({
      segments: [{
        segmentId: 's1', sourceEntityId: 'line', label: 'line',
        start: { x: -100, y: 100 }, end: { x: 100, y: 100 },
        startLabel: 'a', endLabel: 'b',
      }],
      arcs: [],
      circles: [ref],
      worldPoint,
    });
    expect(disjoint.length).toBe(0);
  });
  it('circle-circle secant and concentric disjoint', () => {
    const { project, entity } = commitCircle(blankProject());
    const ref = circleRefFromEntity(project, entity);
    const other = { ...ref, sourceEntityId: 'other', center: { x: 30, y: 20 }, label: 'other' };
    const worldPoint = { x: 0, y: 0 };
    expect(
      buildExactIntersectionCandidates({ segments: [], arcs: [], circles: [ref, other], worldPoint }).length,
    ).toBe(2);
    const concentric = { ...ref, sourceEntityId: 'other', center: { x: 10, y: 20 }, radius: 5, label: 'other' };
    expect(
      buildExactIntersectionCandidates({ segments: [], arcs: [], circles: [ref, concentric], worldPoint }).length,
    ).toBe(0);
  });
});

describe('circle transforms and blocks', () => {
  it('translate/rotate/mirror/uniform-scale preserve the circle', () => {
    const { entity } = commitCircle(blankProject());
    const moved = transformCadEntityGeometry(entity, translation(5, -5), classifyTransform(translation(5, -5))!);
    expect(moved.ok && moved.entity.type === 'circle' && moved.entity.centerX).toBe(15);
    const rotated = transformCadEntityGeometry(entity, rotationAbout(0, 0, 90), classifyTransform(rotationAbout(0, 0, 90))!);
    expect(rotated.ok && rotated.entity.type === 'circle' && rotated.entity.centerX).toBeCloseTo(-20, 9);
    const scaled = transformCadEntityGeometry(entity, uniformScaleAbout(0, 0, 2), classifyTransform(uniformScaleAbout(0, 0, 2))!);
    expect(scaled.ok && scaled.entity.type === 'circle' && scaled.entity.radius).toBe(30);
    const mirrored = transformCadEntityGeometry(
      entity,
      reflectionAboutLine({ x: 0, y: 0 }, { x: 1, y: 0 })!,
      classifyTransform(reflectionAboutLine({ x: 0, y: 0 }, { x: 1, y: 0 })!)!,
    );
    expect(mirrored.ok && mirrored.entity.type === 'circle' && mirrored.entity.radius).toBe(15);
  });
  it('general affine fails closed with an explicit circle code', () => {
    const { entity } = commitCircle(blankProject());
    const affine = { a: 2, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    const classification = classifyTransform(affine)!;
    expect(classification.kind).toBe('GENERAL_AFFINE');
    const result = transformCadEntityGeometry(entity, affine, classification);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('CAD_TRANSFORM_CIRCLE_AFFINE_UNSUPPORTED');
  });
});

describe('circle refusals stay explicit', () => {
  it('trim does not accept circles', () => {
    const { entity } = commitCircle(blankProject());
    expect(isTrimmableEntity(entity)).toBe(false);
  });
});

describe('circle review-fix regressions', () => {
  it('block reference containing a circle renders a circle primitive (no silent child drop)', async () => {
    const { buildCadDisplayScene } = await import('../src/engine/cad/cadRenderer');
    const project = blankProject();
    const withBlocks = {
      ...project,
      blockDefinitions: [{
        id: 'blk-c',
        name: 'C',
        basePoint: { x: 0, y: 0 },
        entities: [{
          id: 'c1', type: 'circle', layerId: 'general', visible: true, locked: false,
          centerX: 5, centerY: 5, radius: 2,
        }],
        bodyAlignment: 'left' as const,
        titleGap: 0,
      }],
      entities: [{
        id: 'ref-1', type: 'block-reference', layerId: 'general', visible: true, locked: false,
        blockDefinitionId: 'blk-c', x: 0, y: 0, rotationDeg: 0, scaleX: 1, scaleY: 1,
      }],
    } as unknown as CadProject;
    const scene = buildCadDisplayScene(withBlocks);
    expect(scene.primitives.some((primitive) => primitive.kind === 'circle')).toBe(true);
  });
  it('sheet export emits a circle item for top-level circles', async () => {
    const { buildCadQaProject, buildCadQaDraft } = await import('./fixtures/cadQaDrawing');
    const { buildExportSheetScene } = await import('../src/engine/cad/cadExportScene');
    const project = buildCadQaProject();
    project.entities.push({
      id: 'qa-circle', type: 'circle', layerId: 'general', visible: true, locked: false,
      centerX: 10, centerY: 10, radius: 5,
    } as never);
    const { draft, sheetId } = buildCadQaDraft(project);
    const { scene } = buildExportSheetScene({ draft, sheetId, project });
    const flatten = (items: unknown[]): Array<Record<string, unknown>> =>
      items.flatMap((item) => Array.isArray((item as { items?: unknown }).items)
        ? flatten((item as { items?: unknown[] }).items as unknown[])
        : [item as Record<string, unknown>]);
    expect(flatten(scene.items as unknown[]).some((item) => item.kind === 'circle')).toBe(true);
  });
});

describe('circle grips, properties, blocks, interchange', () => {
  it('grip edit moves the center and resizes the radius, preserving identity', () => {
    const history = createCadHistoryState(blankProject());
    const committed = runCadCommand(history, {
      key: 'CIRCLE',
      center: { x: 10, y: 20, label: 'C' },
      radius: 15,
    } as CadCommand);
    const entity = committed.present.project.entities.find(
      (candidate): candidate is CadCircleEntity => candidate.type === 'circle',
    )!;
    const moved = runCadCommand(committed, {
      key: 'GRIP_EDIT',
      entityId: entity.id,
      gripKind: 'circle-center',
      x: 0,
      y: 0,
    } as CadCommand);
    const movedEntity = moved.present.project.entities.find(
      (candidate): candidate is CadCircleEntity => candidate.type === 'circle',
    )!;
    expect(movedEntity.centerX).toBe(0);
    expect(movedEntity.radius).toBe(15);
    const resized = runCadCommand(committed, {
      key: 'GRIP_EDIT',
      entityId: entity.id,
      gripKind: 'circle-radius',
      x: 40,
      y: 20,
    } as CadCommand);
    const resizedEntity = resized.present.project.entities.find(
      (candidate): candidate is CadCircleEntity => candidate.type === 'circle',
    )!;
    expect(resizedEntity.radius).toBe(30);
  });
  it('properties expose center/radius/diameter/circumference/area, never arc sweep fields', () => {
    const { project, entity } = commitCircle(blankProject());
    const state = buildCadPropertiesPanelState(project, [entity]);
    if (state == null || state.mode !== 'single') throw new Error('Circle properties missing');
    const labels = state.entity.properties.map((row) => row.label);
    for (const expected of ['Center E', 'Center N', 'Radius', 'Diameter', 'Circumference', 'Area']) {
      expect(labels).toContain(expected);
    }
    expect(labels.join(' ')).not.toMatch(/sweep|Start angle|arc-mid/i);
  });
  it('block child circle under non-uniform scale fails closed, never mean-scales', () => {
    const definition = { id: 'd', name: 'D', basePoint: { x: 0, y: 0 }, entities: [], bodyAlignment: 'left' as const, titleGap: 0 };
    const child = {
      id: 'c', type: 'circle', layerId: 'general', visible: true, locked: false,
      centerX: 0, centerY: 0, radius: 50,
    };
    expect(() =>
      transformBlockChildToWorld(child as never, definition as never, {
        x: 0, y: 0, rotationDeg: 0, scaleX: 2, scaleY: 1,
      }),
    ).toThrow(/CAD_BLOCK_CIRCLE_NON_UNIFORM_SCALE/);
    const uniform = transformBlockChildToWorld(child as never, definition as never, {
      x: 10, y: 20, rotationDeg: 0, scaleX: 2, scaleY: 2,
    });
    expect(uniform).toMatchObject({ centerX: 10, centerY: 20, radius: 100 });
  });
  it('MlightCAD maps circles to AcDbCircle', () => {
    const { project, entity } = commitCircle(blankProject());
    const scene = buildMlightcadSpikeScene(project);
    const mapped = scene.entities.find((entry) => entry.objectId === entity.id)!;
    expect(mapped.type).toBe('AcDbCircle');
  });
});
