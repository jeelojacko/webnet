/** Circle B1 review-fix pins: anchor resolution, DXF/device non-uniform gates, persistence validation, transform floor, epsilon authority. */
import { describe, expect, it } from 'vitest';

import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState, runCadCommand } from '../src/engine/cad/cadUndoRedo';
import {
  isAnchorBroken,
  resolveCadAnnotationAnchor,
} from '../src/engine/cad/annotation/cadAnnotationAnchors';
import { resolveDimensionDerivation } from '../src/engine/cad/cadRenderer';
import { deriveAnnotationPrimitives } from '../src/engine/cad/dxf/dxfAnnotationExport';
import {
  seedDimensionStyles,
  seedProfessionalTextStyles,
} from '../src/engine/cad/annotation/cadAnnotationSeeds';
import { cloneCadEntity } from '../src/engine/cad/cadPersistence';
import { CAD_XY_DEGENERATE_FLOOR } from '../src/engine/cad/cadGeometryShapeBuilders';
import { transformCadEntityGeometry } from '../src/engine/cad/cadTransformGeometry';
import { classifyTransform, uniformScaleAbout } from '../src/engine/cad/cadTransform2D';
import { transformBlockChildToWorld } from '../src/engine/cad/cadBlocks';
import { buildDxfExportModelWithResult } from '../src/engine/cad/dxf/dxfExportModel';
import type { CadBlockChild, CadCircleEntity, CadDimensionEntity, CadEntity, CadProject } from '../src/engine/cad/cadTypes';

const base = { layerId: 'general', visible: true, locked: false } as const;

const circle = (over?: Partial<CadCircleEntity>): CadCircleEntity => ({
  ...base,
  id: 'circ-1',
  type: 'circle',
  centerX: 10,
  centerY: 20,
  radius: 15,
  ...over,
});

const radiusDim = (anchors: CadDimensionEntity['anchors']): CadDimensionEntity => ({
  ...base,
  id: 'dim-r',
  type: 'dimension',
  dimensionKind: 'radius',
  anchors,
  dimLinePoint: { x: 30, y: 30 },
  dimensionStyleId: 'std-500',
});

const projectWith = (entities: CadEntity[]): CadProject => {
  const project = createBlankCadProject({ name: 'Circle review fix', units: 'm' });
  project.entities = entities;
  project.dimensionStyles = seedDimensionStyles();
  const textStyles = seedProfessionalTextStyles();
  project.styleLibrary.textStyles.push(...textStyles);
  return project;
};

const definitionFor = (child: CadBlockChild) => ({
  id: 'blk-c',
  name: 'C',
  basePoint: { x: 0, y: 0 },
  entities: [child],
  bodyAlignment: 'left' as const,
  titleGap: 0,
});

describe('circle anchor resolution (finding 1)', () => {
  it('center anchor resolves at the current center and tracks edits', () => {
    const project = projectWith([circle()]);
    const anchor = { kind: 'arc-point', entityId: 'circ-1', point: 'center', fallbackX: 0, fallbackY: 0 } as const;
    expect(resolveCadAnnotationAnchor(anchor, project)).toEqual({ ok: true, x: 10, y: 20 });
    const history = createCadHistoryState(project);
    const moved = runCadCommand(history, {
      key: 'GRIP_EDIT', entityId: 'circ-1', gripKind: 'circle-center', x: 1, y: 2,
    } as never);
    expect(resolveCadAnnotationAnchor(anchor, moved.present.project)).toEqual({ ok: true, x: 1, y: 2 });
  });
  it('start/end anchors on a circle stay BROKEN; deleted circle stays BROKEN', () => {
    const project = projectWith([circle()]);
    for (const point of ['start', 'end'] as const) {
      const anchor = { kind: 'arc-point', entityId: 'circ-1', point, fallbackX: 0, fallbackY: 0 } as const;
      const resolved = resolveCadAnnotationAnchor(anchor, project);
      expect(resolved.ok).toBe(false);
      if (!resolved.ok) expect(resolved.reason).toBe('BROKEN_REFERENCE');
    }
    const gone = projectWith([]);
    expect(
      isAnchorBroken({ kind: 'arc-point', entityId: 'circ-1', point: 'center', fallbackX: 0, fallbackY: 0 }, gone),
    ).toBe(true);
  });
  it('DIMRADIUS + DIMDIAMETER derive from a circle center anchor and re-measure', () => {
    for (const dimensionKind of ['radius', 'diameter'] as const) {
      const project = projectWith([
        circle(),
        { ...radiusDim([{ kind: 'arc-point', entityId: 'circ-1', point: 'center', fallbackX: 0, fallbackY: 0 }]), dimensionKind },
      ]);
      const derived = resolveDimensionDerivation(project, project.entities[1] as CadDimensionEntity);
      expect(derived?.geometry.measurement).toBeCloseTo(dimensionKind === 'radius' ? 15 : 30, 9);
      const dxf = deriveAnnotationPrimitives(project.entities[1] as CadDimensionEntity, project);
      expect(dxf.ok).toBe(true);
    }
  });
});

describe('circle block/DXF non-uniform gates (finding 2)', () => {
  const circleBlockProject = (scaleX: number, scaleY: number): CadProject => {
    const project = projectWith([]);
    const withDef = {
      ...project,
      blockDefinitions: [definitionFor(circle({ id: 'c1' }))],
      entities: [{
        ...base, id: 'ref-1', type: 'block-reference', blockDefinitionId: 'blk-c',
        x: 0, y: 0, rotationDeg: 0, scaleX, scaleY,
      }],
    } as unknown as CadProject;
    return withDef;
  };
  it('circle block + 2/1 scale emits no INSERT and omits with warning', () => {
    const result = buildDxfExportModelWithResult({ project: circleBlockProject(2, 1) });
    expect(result.output.inserts ?? []).toHaveLength(0);
    expect(result.omittedEntityIds ?? []).toContain('ref-1');
    expect(JSON.stringify(result.warnings ?? [])).toMatch(/non-uniform scale over a Circle child/);
  });
  it('circle block + 2/2 scale emits native BLOCK CIRCLE + INSERT; mirrored uniform stays valid', () => {
    for (const extra of [{}, { mirrored: true as const }]) {
      const project = circleBlockProject(2, 2);
      (project.entities[0] as { mirrored?: boolean }).mirrored = (extra as { mirrored?: boolean }).mirrored;
      const result = buildDxfExportModelWithResult({ project });
      expect(result.output.blocks?.[0]?.circles).toHaveLength(1);
      expect(result.output.inserts ?? []).toHaveLength(1);
      expect(result.omittedEntityIds ?? []).not.toContain('ref-1');
    }
  });
  it('non-circle non-uniform block keeps existing INSERT behavior', () => {
    const project = projectWith([]);
    const withDef = {
      ...project,
      blockDefinitions: [definitionFor({
        ...base, id: 'l1', type: 'line', fromStationId: 'A', toStationId: 'B',
        fromX: 0, fromY: 0, toX: 1, toY: 0, sourceObservationIds: [],
      })],
      entities: [{
        ...base, id: 'ref-1', type: 'block-reference', blockDefinitionId: 'blk-c',
        x: 0, y: 0, rotationDeg: 0, scaleX: 2, scaleY: 1,
      }],
    } as unknown as CadProject;
    const result = buildDxfExportModelWithResult({ project: withDef });
    expect((result.output.inserts ?? []).length).toBeGreaterThan(0);
  });
  it('BLOCK_INSERT refuses a circle definition at non-uniform scale', () => {
    const project = projectWith([]);
    const withDef = { ...project, blockDefinitions: [definitionFor(circle({ id: 'c1' }))] };
    const history = createCadHistoryState(withDef);
    const refused = runCadCommand(history, {
      key: 'BLOCK_INSERT', definitionId: 'blk-c', layerId: 'general', x: 0, y: 0, scaleX: 2, scaleY: 1,
    } as never);
    expect(refused).toBe(history);
    const admitted = runCadCommand(history, {
      key: 'BLOCK_INSERT', definitionId: 'blk-c', layerId: 'general', x: 0, y: 0, scaleX: 2, scaleY: 2,
    } as never);
    expect(admitted).not.toBe(history);
  });
});

describe('persisted circle validation (finding 3)', () => {
  it('valid circle clones exactly; malformed circles fail closed', () => {
    expect(cloneCadEntity(circle())).toEqual(circle());
    for (const bad of [
      { radius: 0 },
      { radius: -5 },
      { radius: 1e-13 },
      { centerX: NaN },
      { centerY: Infinity },
      { radius: Infinity },
    ]) {
      expect(() => cloneCadEntity({ ...circle(), ...bad })).toThrow(/invalid geometry/);
    }
  });
  it('old Arc 0/360 stays Arc through clone', () => {
    const arc = {
      ...base, id: 'a', type: 'arc', centerX: 0, centerY: 0, radius: 5,
      startAngleDeg: 0, endAngleDeg: 360,
    } as const;
    const cloned = cloneCadEntity(arc as never) as { type: string };
    expect(cloned.type).toBe('arc');
  });
});

describe('transform floor invariance (finding 4)', () => {
  it('tiny uniform scale fails atomically with no mutation', () => {
    const entity = circle({ radius: 1e-9 });
    const scale = uniformScaleAbout(0, 0, 1e-6);
    const classification = classifyTransform(scale)!;
    expect(classification.kind).toBe('SIMILARITY');
    const result = transformCadEntityGeometry(entity, scale, classification);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('CAD_TRANSFORM_CIRCLE_DEGENERATE_RESULT');
    expect(entity.radius).toBe(1e-9);
  });
  it('block expansion producing a sub-floor circle throws', () => {
    const definition = definitionFor(circle({ id: 'c1', radius: 1e-6 }));
    expect(() =>
      transformBlockChildToWorld(
        { ...definition.entities[0], id: 'c1' } as never,
        definition as never,
        { x: 0, y: 0, rotationDeg: 0, scaleX: 1e-9, scaleY: 1e-9 },
      ),
    ).toThrow(/CAD_BLOCK_CIRCLE_DEGENERATE_RESULT/);
  });
});

describe('no new geometry epsilon (finding 5)', () => {
  it('circle-owned code reuses CAD_XY_DEGENERATE_FLOOR; center falls back to +X rim', async () => {
    const { readFileSync } = await import('node:fs');
    for (const file of [
      'src/engine/cad/cadSpatialEntityCandidates.ts',
      'src/engine/cad/cadSpatialBlockSnaps.ts',
    ]) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/(?<![A-Z_0-9])1e-12(?![0-9])/);
      expect(text).toContain('CAD_XY_DEGENERATE_FLOOR');
    }
    expect(CAD_XY_DEGENERATE_FLOOR).toBe(1e-12);
  });
});
