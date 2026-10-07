import { describe, expect, it } from 'vitest';
import { createCadHistoryState, redoCadHistory, runCadCommand, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
import {
  appendCadLineChainPoint,
  buildCadLineEntities,
  cadLineChainToSegments,
  createCadLineChainDraft,
  undoCadLineChainPoint,
} from '../src/engine/cad/cadLineBatch';
import type { CadLineEntity } from '../src/engine/cad/cadTypes';
import { buildCadLineL1Project } from './cadLineL1TestSupport';

const A = { x: 0, y: 0, label: 'A' };
const B = { x: 10, y: 0, label: 'B' };
const C = { x: 10, y: 10, label: 'C' };
const D = { x: 0, y: 10, label: 'D' };

const lineEntities = (entities: CadLineEntity[]) => entities;

describe('L1 chain draft contract', () => {
  it('never mutates while drafting and rejects duplicates', () => {
    const empty = createCadLineChainDraft();
    const one = appendCadLineChainPoint(empty, A);
    expect(empty.points).toEqual([]);
    expect(one.ok && one.value.points).toEqual([A]);
    if (!one.ok) throw new Error('append failed');
    expect(appendCadLineChainPoint(one.value, A)).toMatchObject({ ok: false, error: { code: 'DEGENERATE' } });
    expect(undoCadLineChainPoint(one.value).points).toEqual([]);
  });

  it('converts a chain into ordered segments', () => {
    let draft = createCadLineChainDraft();
    for (const point of [A, B, C, D]) {
      const next = appendCadLineChainPoint(draft, point);
      if (!next.ok) throw new Error('append failed');
      draft = next.value;
    }
    const segments = cadLineChainToSegments(draft);
    expect(segments.ok && segments.value).toEqual([
      { start: A, end: B },
      { start: B, end: C },
      { start: C, end: D },
    ]);
    expect(cadLineChainToSegments(createCadLineChainDraft())).toMatchObject({
      ok: false,
      error: { code: 'POINT_RANGE_TOO_SHORT' },
    });
  });
});

describe('L1 LINE_CREATE_BATCH transaction', () => {
  it('creates N first-class lines in one undo entry and selects them', () => {
    const base = createCadHistoryState(buildCadLineL1Project());
    const segments = [
      { start: A, end: B },
      { start: B, end: C },
      { start: C, end: D },
    ];
    const state = runCadCommand(base, { key: 'LINE_CREATE_BATCH', segments, createdBy: 'LINE_POINT_RANGE' });
    const created = lineEntities(state.present.project.entities as CadLineEntity[]);
    expect(created).toHaveLength(3);
    expect(created.map((entity) => entity.type)).toEqual(['line', 'line', 'line']);
    expect(created.every((entity) => entity.layerId === 'general')).toBe(true);
    expect(created.every((entity) => entity.metadata?.createdBy === 'LINE_POINT_RANGE')).toBe(true);
    expect(created.map((entity) => entity.metadata?.entityName)).toEqual(['LINE1', 'LINE2', 'LINE3']);
    expect(state.undoStack).toHaveLength(1);
    expect(state.present.selection.selectedEntityIds).toEqual(created.map((entity) => entity.id));

    const undone = undoCadHistory(state);
    expect(undone.present.project.entities).toHaveLength(0);
    const redone = redoCadHistory(undone);
    expect(redone.present.project.entities).toHaveLength(3);
  });

  it('rejects the whole batch atomically when any segment is degenerate', () => {
    const base = createCadHistoryState(buildCadLineL1Project());
    const state = runCadCommand(base, {
      key: 'LINE_CREATE_BATCH',
      segments: [
        { start: A, end: B },
        { start: C, end: { x: C.x, y: C.y, label: 'C2' } },
      ],
      createdBy: 'LINE_BATCH',
    });
    expect(state).toBe(base);
    expect(state.present.project.entities).toHaveLength(0);
  });

  it('routes single-segment modes through the same builder', () => {
    const project = buildCadLineL1Project();
    const built = buildCadLineEntities(project, [{ start: A, end: B }], 'LINE_BEARING');
    expect(built).toHaveLength(1);
    expect(built![0]).toMatchObject({
      type: 'line',
      layerId: 'general',
      fromStationId: 'A',
      toStationId: 'B',
      metadata: { createdBy: 'LINE_BEARING', entityName: 'LINE1', manual: true },
    });
    expect(buildCadLineEntities(project, [], 'LINE')).toBeNull();
  });

  it('keeps plain LINE backward compatible (name, layer, createdBy, labels)', () => {
    const base = createCadHistoryState(buildCadLineL1Project());
    const state = runCadCommand(base, { key: 'LINE', start: A, end: B });
    const line = lineEntities(state.present.project.entities as CadLineEntity[]);
    expect(line).toHaveLength(1);
    expect(line[0]).toMatchObject({
      type: 'line',
      layerId: 'general',
      fromStationId: 'A',
      toStationId: 'B',
      metadata: { createdBy: 'LINE', entityName: 'LINE1', manual: true },
    });
    expect(state.commandState.prompt).toBe('LINE committed from A to B.');
    const degenerate = runCadCommand(base, { key: 'LINE', start: A, end: { x: 0, y: 0, label: 'A2' } });
    expect(degenerate).toBe(base);
  });
});
