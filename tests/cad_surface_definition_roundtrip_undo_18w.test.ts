/**
 * Phase 18W roundtrip + undo pins (agent tier, fast, no harness).
 *
 * Companion to cad_surface_definition_lifecycle_18w.test.ts:
 * - WNCAD save/reopen: chain order exact, boundary refs exact, independent
 *   copy keeps the parcel byte-identical while referencing the new polygon,
 *   rebuild-equivalent across the roundtrip;
 * - display-truth consistency: entity→point-chain conversion with station
 *   refs stays healthy (no bogus BROKEN_REFERENCE in Toolspace);
 * - undo/redo: every 18W op is exactly one history entry and round-trips;
 *   invalid ops commit nothing.
 */
import { describe, expect, it } from 'vitest';

import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { findSurfaceBrokenRefs, resolveSurfaceDisplayStatus } from '../src/engine/cad/cadSurfaceView';
import { createCadHistoryState, redoCadHistory, runCadCommand, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
import type { CadCommand } from '../src/engine/cad/cadTransactions.types';
import type {
  CadEntity,
  CadPolygonEntity,
  CadProject,
  CadSurface,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';

const point = (
  id: string,
  stationId: string,
  x: number,
  y: number,
  z: number,
): CadSurveyPointEntity => ({
  id, type: 'survey-point', layerId: 'points', visible: true, locked: false,
  stationId, x, y, z, pointClass: 'free', source: 'parsed-input',
});

const QUAD: Array<[string, string, number, number, number]> = [
  ['pt-a', 'A', 0, 0, 10], ['pt-b', 'B', 10, 0, 11],
  ['pt-c', 'C', 10, 10, 12], ['pt-d', 'D', 0, 10, 13],
  ['pt-e', 'E', 5, 5, 14],
];

const rect = (id: string, x0: number, y0: number, x1: number, y1: number): CadPolygonEntity => ({
  id, type: 'polygon', layerId: 'general', visible: true, locked: false,
  vertices: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
  vertexLabels: ['', '', '', ''],
});

const projectWith = (entities: CadEntity[]): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Roundtrip 18W', units: 'm' });
  return { ...drawing.project, entities };
};

const run = (history: ReturnType<typeof createCadHistoryState>, command: CadCommand) =>
  runCadCommand(history, command);

const surfaceId = 'surf-18w';

const surfaceWithBreakline = (chain: string[]): CadSurface => ({
  id: surfaceId, name: 'Site',
  definition: {
    pointSource: { kind: 'points', pointEntityIds: ['pt-a', 'pt-b', 'pt-c', 'pt-d', 'pt-e'] },
    breaklines: [{ id: 'bl-1', source: { kind: 'point-chain', pointEntityIds: chain }, type: 'standard' }],
  },
  cachedRevision: null,
});

const quadProject = (): CadProject =>
  projectWith(QUAD.map(([id, station, x, y, z]) => point(id, station, x, y, z)));

const historyWithChain = (chain = ['pt-a', 'pt-e', 'pt-c']) =>
  createCadHistoryState({ ...quadProject(), surfaces: [surfaceWithBreakline(chain)] });

// ---------------------------------------------------------------------------
// WNCAD save/reopen
// ---------------------------------------------------------------------------

describe('18W WNCAD roundtrip', () => {
  const roundtrip = (project: CadProject): CadProject => {
    const drawing = createBlankCadDrawingDocument({ name: 'Roundtrip 18W', units: 'm' });
    const parsed = parseCadDrawingFile(serializeCadDrawingFile({ ...drawing, project }));
    if (!parsed.ok) throw new Error(`roundtrip parse failed: ${parsed.errors.join('; ')}`);
    return parsed.drawing.project;
  };

  it('chain order, boundary refs, and independent copy survive save/reopen', () => {
    let history = createCadHistoryState(projectWith([
      ...QUAD.map(([id, station, x, y, z]) => point(id, station, x, y, z)),
      {
        id: 'parcel-1', type: 'parcel', layerId: 'general', visible: true, locked: false,
        vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
        vertexLabels: ['', '', '', ''], parcelName: 'Lot 1',
      } as CadEntity,
    ]));
    history = run(history, {
      key: 'SURFACE_CREATE', name: 'Site',
      pointSource: { kind: 'points', pointEntityIds: ['pt-a', 'pt-b', 'pt-c', 'pt-d', 'pt-e'] },
    });
    const createdId = history.present.project.surfaces![0]!.id;
    history = run(history, {
      key: 'SURFACE_ADD_BREAKLINE', surfaceId: createdId, pointIds: ['pt-a', 'pt-e', 'pt-c'], name: 'Ridge',
    });
    const blId = history.present.project.surfaces![0]!.definition.breaklines![0]!.id;
    history = run(history, {
      key: 'SURFACE_BREAKLINE_INSERT_POINT', surfaceId: createdId, breaklineId: blId,
      pointEntityId: 'pt-b', insertIndex: 1,
    });
    history = run(history, {
      key: 'SURFACE_ADD_BOUNDARY', surfaceId: createdId, kind: 'outer', sourceEntityId: 'parcel-1',
    });
    history = run(history, {
      key: 'SURFACE_MAKE_BOUNDARY_INDEPENDENT', surfaceId: createdId, kind: 'outer',
    });
    const before = history.present.project;
    const beforeSurface = before.surfaces![0]!;
    const parcelBefore = JSON.stringify(before.entities.find((e) => e.id === 'parcel-1'));
    const reopened = roundtrip(before);
    const afterSurface = reopened.surfaces![0]!;
    const chain = afterSurface.definition.breaklines!.find((b) => b.id === blId)!;
    if (chain.source.kind !== 'point-chain') throw new Error('expected point chain after reopen');
    expect(chain.source.pointEntityIds).toEqual(['pt-a', 'pt-b', 'pt-e', 'pt-c']);
    expect(chain.name).toBe('Ridge');
    const boundary = afterSurface.definition.boundaries![0]!;
    expect(boundary.type).toBe('outer');
    expect(boundary.sourceEntityId).not.toBe('parcel-1');
    // Phase 19A: reopen backfills deterministic course ids on legacy parcels;
    // geometry is otherwise byte-identical (courseIds trails, as persisted).
    const parcelBeforeWithCourses = JSON.stringify({
      ...JSON.parse(parcelBefore),
      courseIds: [
        'parcel-course:parcel-1:0',
        'parcel-course:parcel-1:1',
        'parcel-course:parcel-1:2',
        'parcel-course:parcel-1:3',
      ],
    });
    expect(JSON.stringify(reopened.entities.find((e) => e.id === 'parcel-1'))).toBe(parcelBeforeWithCourses);
    const copy = reopened.entities.find((e) => e.id === boundary.sourceEntityId)!;
    expect(copy.type).toBe('polygon');
    // Equivalent rebuild across the roundtrip.
    const beforeBuild = buildCadSurface(before, beforeSurface);
    const afterBuild = buildCadSurface(reopened, afterSurface);
    expect(beforeBuild.outcome).toBe('ok');
    expect(afterBuild.outcome).toBe('ok');
    expect(afterBuild.triangles).toEqual(beforeBuild.triangles);
  });
});

// ---------------------------------------------------------------------------
// Display truth consistency: station-id chains are healthy, not broken
// ---------------------------------------------------------------------------

describe('18W display-truth consistency', () => {
  it('entity→point-chain conversion with station refs stays healthy', () => {
    let history = createCadHistoryState(projectWith([
      ...QUAD.map(([id, station, x, y, z]) => point(id, station, x, y, z)),
      {
        id: 'ch-1', type: 'polyline', layerId: 'general', visible: true, locked: false,
        vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
        vertexLabels: ['A', 'B'], closed: false,
      } as CadEntity,
    ]));
    history = run(history, {
      key: 'SURFACE_CREATE', name: 'Site',
      pointSource: { kind: 'points', pointEntityIds: ['pt-a', 'pt-b', 'pt-c', 'pt-d', 'pt-e'] },
    });
    const createdId = history.present.project.surfaces![0]!.id;
    history = run(history, {
      key: 'SURFACE_ADD_BREAKLINE', surfaceId: createdId, pointIds: ['pt-a', 'pt-b'], name: 'Toe',
    });
    // Entity-backed breakline over the same stations, then convert: the
    // stored refs are station ids, which collection resolves — the UI health
    // check must agree (no bogus BROKEN_REFERENCE in Toolspace).
    const withEntity: CadProject = {
      ...history.present.project,
      surfaces: history.present.project.surfaces!.map((s) => ({
        ...s,
        definition: {
          ...s.definition,
          breaklines: [...(s.definition.breaklines ?? []),
            { id: 'bl-f2f', source: { kind: 'entity', entityId: 'ch-1' }, type: 'standard' }],
        },
      })),
    };
    const converted = run(createCadHistoryState(withEntity), {
      key: 'SURFACE_BREAKLINE_CONVERT_TO_POINT_CHAIN', surfaceId: createdId, breaklineId: 'bl-f2f',
    });
    const project = converted.present.project;
    const surface = project.surfaces!.find((s) => s.id === createdId)!;
    expect(findSurfaceBrokenRefs(project, surface).brokenIds).toEqual([]);
    const built = buildCadSurface(project, surface);
    expect(built.outcome).toBe('ok');
    expect(resolveSurfaceDisplayStatus(project, surface, true).status).toBe('CURRENT');
  });
});

// ---------------------------------------------------------------------------
// Undo/redo: every 18W op is one entry and round-trips
// ---------------------------------------------------------------------------

describe('18W undo/redo single-entry pins', () => {
  const definitionOf = (history: ReturnType<typeof createCadHistoryState>): string =>
    JSON.stringify(history.present.project.surfaces);

  const checkRoundTrip = (
    history: ReturnType<typeof createCadHistoryState>,
    command: CadCommand,
  ): void => {
    const depth = history.undoStack.length;
    const next = run(history, command);
    expect(next).not.toBe(history);
    expect(next.undoStack).toHaveLength(depth + 1);
    expect(definitionOf(undoCadHistory(next))).toBe(definitionOf(history));
    expect(definitionOf(redoCadHistory(undoCadHistory(next)))).toBe(definitionOf(next));
  };

  it('breakline ops each commit one undoable entry', () => {
    const history = historyWithChain(['pt-a', 'pt-e', 'pt-c']);
    checkRoundTrip(history, {
      key: 'SURFACE_RENAME_BREAKLINE', surfaceId, breaklineId: 'bl-1', name: 'Ridge',
    });
    checkRoundTrip(history, {
      key: 'SURFACE_BREAKLINE_INSERT_POINT', surfaceId, breaklineId: 'bl-1',
      pointEntityId: 'pt-b', insertIndex: 1,
    });
    checkRoundTrip(history, {
      key: 'SURFACE_BREAKLINE_REMOVE_POINT', surfaceId, breaklineId: 'bl-1', index: 0,
    });
    checkRoundTrip(history, { key: 'SURFACE_BREAKLINE_REVERSE', surfaceId, breaklineId: 'bl-1' });
    checkRoundTrip(history, {
      key: 'SURFACE_BREAKLINE_REPLACE_CHAIN', surfaceId, breaklineId: 'bl-1',
      pointEntityIds: ['pt-b', 'pt-e', 'pt-d'],
    });
  });

  it('boundary ops each commit one undoable entry', () => {
    let history = createCadHistoryState(projectWith([
      ...QUAD.map(([id, station, x, y, z]) => point(id, station, x, y, z)),
      rect('poly-alt', 1, 1, 9, 9),
    ]));
    history = run(history, {
      key: 'SURFACE_CREATE', name: 'Site',
      pointSource: { kind: 'points', pointEntityIds: ['pt-a', 'pt-b', 'pt-c', 'pt-d', 'pt-e'] },
    });
    const createdId = history.present.project.surfaces![0]!.id;
    const created = run(history, {
      key: 'SURFACE_CREATE_BOUNDARY_SOURCE', surfaceId: createdId, kind: 'outer',
      vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
    });
    expect(created.undoStack).toHaveLength(history.undoStack.length + 1);
    const outerId = created.present.project.surfaces![0]!.definition.boundaries![0]!.sourceEntityId;
    checkRoundTrip(created, {
      key: 'SURFACE_REPLACE_BOUNDARY_SOURCE', surfaceId: createdId, kind: 'outer', sourceEntityId: 'poly-alt',
    });
    const replaced = run(created, {
      key: 'SURFACE_REPLACE_BOUNDARY_SOURCE', surfaceId: createdId, kind: 'outer', sourceEntityId: 'poly-alt',
    });
    checkRoundTrip(replaced, {
      key: 'SURFACE_MAKE_BOUNDARY_INDEPENDENT', surfaceId: createdId, kind: 'outer',
    });
    checkRoundTrip(created, {
      key: 'EDIT_ENTITY', entityId: outerId,
      edit: { kind: 'polyline-vertices', vertices: [{ vertexIndex: 0, x: 1, y: 1 }, { vertexIndex: 2, x: 9, y: 9 }] },
    });
  });

  it('invalid ops commit nothing and leave no history entry', () => {
    const history = historyWithChain(['pt-a', 'pt-e', 'pt-c']);
    const depth = history.undoStack.length;
    const blocked: CadCommand[] = [
      { key: 'SURFACE_BREAKLINE_INSERT_POINT', surfaceId, breaklineId: 'bl-1', pointEntityId: 'ghost', insertIndex: 1 },
      { key: 'SURFACE_BREAKLINE_REPLACE_CHAIN', surfaceId, breaklineId: 'bl-1', pointEntityIds: ['pt-a'] },
      { key: 'SURFACE_RENAME_BREAKLINE', surfaceId, breaklineId: 'missing', name: 'X' },
    ];
    // Removing index 0 twice would leave a sub-2 chain; the second is blocked.
    const once = run(history, { key: 'SURFACE_BREAKLINE_REMOVE_POINT', surfaceId, breaklineId: 'bl-1', index: 0 });
    expect(run(once, { key: 'SURFACE_BREAKLINE_REMOVE_POINT', surfaceId, breaklineId: 'bl-1', index: 0 })).toBe(once);
    for (const command of blocked) {
      expect(run(history, command)).toBe(history);
    }
    expect(history.undoStack).toHaveLength(depth);
  });
});
