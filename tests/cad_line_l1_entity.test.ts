import { describe, expect, it } from 'vitest';
import { createCadHistoryState, runCadCommand, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
import {
  resolveCadLineExtension,
  resolveCadLineExtensionFromText,
  resolveCadLineFromEnd,
} from '../src/engine/cad/cadLineEntityResolvers';
import type { CadArcEntity, CadCircleEntity, CadLineEntity, CadPolylineEntity } from '../src/engine/cad/cadTypes';
import { buildCadLineL1Project } from './cadLineL1TestSupport';

const okValue = <T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T => {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}`);
  return result.value;
};

const lineEntity = (overrides?: Partial<CadLineEntity>): CadLineEntity => ({
  id: 'line-1',
  type: 'line',
  layerId: 'general',
  visible: true,
  locked: false,
  fromStationId: 'A',
  toStationId: 'B',
  fromX: 0,
  fromY: 0,
  toX: 10,
  toY: 0,
  sourceObservationIds: [],
  metadata: { createdBy: 'LINE', entityName: 'LINE1', manual: true },
  ...overrides,
});

const arcEntity = (overrides?: Partial<CadArcEntity>): CadArcEntity => ({
  id: 'arc-1',
  type: 'arc',
  layerId: 'general',
  visible: true,
  locked: false,
  centerX: 0,
  centerY: 0,
  radius: 10,
  startAngleDeg: 0,
  endAngleDeg: 90,
  ...overrides,
});

describe('L1 from-end resolver', () => {
  it('extends a line collinear outward from either end', () => {
    expect(okValue(resolveCadLineFromEnd(lineEntity(), { endpoint: 'end', distance: 5 }))).toEqual({ x: 15, y: 0 });
    expect(okValue(resolveCadLineFromEnd(lineEntity(), { endpoint: 'start', distance: 5 }))).toEqual({ x: -5, y: 0 });
  });

  it('extends an arc along the true tangent at the selected endpoint', () => {
    const end = okValue(resolveCadLineFromEnd(arcEntity(), { endpoint: 'end', distance: 5 }));
    expect(end.x).toBeCloseTo(-5, 9);
    expect(end.y).toBeCloseTo(10, 9);
    const start = okValue(resolveCadLineFromEnd(arcEntity(), { endpoint: 'start', distance: 5 }));
    expect(start.x).toBeCloseTo(10, 9);
    expect(start.y).toBeCloseTo(-5, 9);
  });

  it('extends an open polyline terminal segment only', () => {
    const polyline: CadPolylineEntity = {
      id: 'pl-1',
      type: 'polyline',
      layerId: 'general',
      visible: true,
      locked: false,
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      vertexLabels: ['A', 'B', 'C'],
      closed: false,
    };
    expect(okValue(resolveCadLineFromEnd(polyline, { endpoint: 'end', distance: 5 }))).toEqual({ x: 10, y: 15 });
    expect(okValue(resolveCadLineFromEnd(polyline, { endpoint: 'start', distance: 5 }))).toEqual({ x: -5, y: 0 });
  });

  it('rejects closed polylines and circles', () => {
    const closed: CadPolylineEntity = {
      id: 'pl-2',
      type: 'polyline',
      layerId: 'general',
      visible: true,
      locked: false,
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      vertexLabels: ['A', 'B', 'C'],
      closed: true,
    };
    const circle: CadCircleEntity = {
      id: 'c-1',
      type: 'circle',
      layerId: 'general',
      visible: true,
      locked: false,
      centerX: 0,
      centerY: 0,
      radius: 5,
    };
    expect(resolveCadLineFromEnd(closed, { endpoint: 'end', distance: 5 })).toMatchObject({
      ok: false,
      error: { code: 'CLOSED_SOURCE_UNSUPPORTED' },
    });
    expect(resolveCadLineFromEnd(circle, { endpoint: 'end', distance: 5 })).toMatchObject({
      ok: false,
      error: { code: 'CLOSED_SOURCE_UNSUPPORTED' },
    });
  });
});

describe('L1 line extension edit', () => {
  it('extends outward with a signed delta and preserves id/layer/labels', () => {
    const project = buildCadLineL1Project({ entities: [lineEntity()] });
    const result = okValue(
      resolveCadLineExtension(project, {
        entityId: 'line-1',
        pickPoint: { x: 9, y: 0 },
        target: { kind: 'delta', delta: 5 },
      }),
    );
    expect(result.endpoint).toBe('to');
    expect(result.entity.toX).toBeCloseTo(15, 9);
    expect(result.entity.fromX).toBe(0);
    expect(result.entity.id).toBe('line-1');
    expect(result.entity.layerId).toBe('general');
    expect(result.entity.metadata).toEqual({ createdBy: 'LINE', entityName: 'LINE1', manual: true });
    expect([result.entity.fromStationId, result.entity.toStationId]).toEqual(['A', 'B']);
  });

  it('sets an explicit total length from the fixed opposite end', () => {
    const project = buildCadLineL1Project({ entities: [lineEntity()] });
    expect(
      okValue(
        resolveCadLineExtension(project, {
          entityId: 'line-1',
          pickPoint: { x: 1, y: 0 },
          target: { kind: 'total', total: 20 },
        }),
      ).entity.fromX,
    ).toBeCloseTo(-10, 9);
    expect(
      okValue(resolveCadLineExtensionFromText(project, { entityId: 'line-1', pickPoint: { x: 9, y: 0 }, text: 'T20' }))
        .entity.toX,
    ).toBeCloseTo(20, 9);
  });

  it('fails closed on midpoint picks, sub-floor results, locked lines and wrong types', () => {
    const project = buildCadLineL1Project({ entities: [lineEntity()] });
    expect(
      resolveCadLineExtension(project, {
        entityId: 'line-1',
        pickPoint: { x: 5, y: 0 },
        target: { kind: 'delta', delta: 5 },
      }),
    ).toMatchObject({ ok: false, error: { code: 'AMBIGUOUS_ENDPOINT' } });
    expect(
      resolveCadLineExtension(project, {
        entityId: 'line-1',
        pickPoint: { x: 9, y: 0 },
        target: { kind: 'delta', delta: -20 },
      }),
    ).toMatchObject({ ok: false, error: { code: 'DEGENERATE' } });
    const locked = buildCadLineL1Project({ entities: [lineEntity({ locked: true })] });
    expect(
      resolveCadLineExtension(locked, {
        entityId: 'line-1',
        pickPoint: { x: 9, y: 0 },
        target: { kind: 'delta', delta: 5 },
      }),
    ).toMatchObject({ ok: false, error: { code: 'ENTITY_NOT_EDITABLE' } });
    const arcProject = buildCadLineL1Project({ entities: [arcEntity()] });
    expect(
      resolveCadLineExtension(arcProject, {
        entityId: 'arc-1',
        pickPoint: { x: 0, y: 0 },
        target: { kind: 'delta', delta: 5 },
      }),
    ).toMatchObject({ ok: false, error: { code: 'ENTITY_TYPE_UNSUPPORTED' } });
  });

  it('applies the extension as an EDIT with exactly one undo entry', () => {
    const project = buildCadLineL1Project({ entities: [lineEntity()] });
    const base = createCadHistoryState(project);
    const resolved = okValue(
      resolveCadLineExtension(project, {
        entityId: 'line-1',
        pickPoint: { x: 9, y: 0 },
        target: { kind: 'total', total: 20 },
      }),
    );
    const edited = runCadCommand(base, {
      key: 'GRIP_EDIT',
      entityId: 'line-1',
      gripKind: resolved.endpoint === 'to' ? 'line-end' : 'line-start',
      x: resolved.endpoint === 'to' ? resolved.entity.toX : resolved.entity.fromX,
      y: resolved.endpoint === 'to' ? resolved.entity.toY : resolved.entity.fromY,
    });
    expect(edited.undoStack).toHaveLength(1);
    const line = edited.present.project.entities[0] as CadLineEntity;
    expect(line).toMatchObject({ id: 'line-1', layerId: 'general', fromStationId: 'A', toStationId: 'B' });
    expect(line.toX).toBeCloseTo(20, 9);
    const undone = undoCadHistory(edited);
    expect((undone.present.project.entities[0] as CadLineEntity).toX).toBe(10);
  });
});
