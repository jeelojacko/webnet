import { describe, expect, it } from 'vitest';

import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { computeCadSurfaceSourceRevision } from '../src/engine/cad/cadSurfaces';
import {
  boundaryRingsFromDefinition,
  candidateRingOfEntity,
  PARCEL_REFERENCE_ONLY,
  validateBoundaryVertexEdit,
  validateSurfaceBoundaryCandidate,
  type BoundaryRingPoint,
} from '../src/engine/cad/cadBoundaryCandidateValidation';
import { countSurfaceDefinitionReferencesToEntity } from '../src/engine/cad/cadSurfaceDefinitionReferences';
import {
  createCadHistoryState,
  runCadCommand,
  undoCadHistory,
  type CadHistoryState,
} from '../src/engine/cad/cadUndoRedo';
import type { CadCommand } from '../src/engine/cad/cadTransactions.types';
import type {
  CadEntity,
  CadParcelEntity,
  CadPolygonEntity,
  CadPolylineEntity,
  CadProject,
  CadSurface,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';

// Engine-level oracles only (ring XY + revisions). Full rebuild/domain pins
// over the triangulated mesh belong to the follow-up test job.

const RECTANGLE: BoundaryRingPoint[] = [
  { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
];
/** 10x10 outer minus a 2-wide x 6-tall notch -> analytic area 88. */
const NOTCH: BoundaryRingPoint[] = [
  { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 6, y: 10 },
  { x: 6, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 },
];

const rectRing = (x0: number, y0: number, x1: number, y1: number): BoundaryRingPoint[] =>
  [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

const ringArea = (ring: ReadonlyArray<BoundaryRingPoint>): number => {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
};

const xy = (entity: { vertices: ReadonlyArray<{ x: number; y: number }> }) =>
  entity.vertices.map(({ x, y }) => ({ x, y }));

const polygonEntity = (id: string, vertices: BoundaryRingPoint[]): CadPolygonEntity => ({
  id, type: 'polygon', layerId: 'general', visible: true, locked: false,
  vertices: vertices.map((p) => ({ ...p })), vertexLabels: vertices.map(() => ''),
});

const polylineEntity = (id: string, vertices: BoundaryRingPoint[]): CadPolylineEntity => ({
  id, type: 'polyline', layerId: 'general', visible: true, locked: false,
  vertices: vertices.map((p) => ({ ...p })), vertexLabels: vertices.map(() => ''), closed: false,
});

const parcelEntity = (id: string): CadParcelEntity => ({
  id, type: 'parcel', layerId: 'general', visible: true, locked: false,
  vertices: RECTANGLE.map((p) => ({ ...p })), vertexLabels: RECTANGLE.map(() => ''), parcelName: 'Lot 1',
});

const surveyPoint = (id: string, stationId: string, x: number, y: number, z: number): CadSurveyPointEntity =>
  ({ id, type: 'survey-point', layerId: 'general', visible: true, locked: false, stationId, x, y, z,
    pointClass: 'free', source: 'parsed-input' });

const projectWith = (extra: CadEntity[] = []): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Phase 18W', units: 'm' });
  return { ...drawing.project, entities: [
    surveyPoint('pt-1', 'A', 0, 0, 10), surveyPoint('pt-2', 'B', 10, 0, 11),
    surveyPoint('pt-3', 'C', 10, 10, 12), surveyPoint('pt-4', 'D', 0, 10, 13),
    ...extra,
  ] };
};

const addSurface = (history: CadHistoryState, name: string): CadHistoryState =>
  runCadCommand(history, {
    key: 'SURFACE_CREATE', name,
    pointSource: { kind: 'points', pointEntityIds: ['pt-1', 'pt-2', 'pt-3', 'pt-4'] },
  });

const singleSurfaceHistory = (extra: CadEntity[] = []): CadHistoryState =>
  addSurface(createCadHistoryState(projectWith(extra)), 'Site');

const surfaceOf = (state: CadHistoryState, index = 0): CadSurface => state.present.project.surfaces![index]!;
const entityOf = (state: CadHistoryState, id: string): CadEntity | undefined =>
  state.present.project.entities.find((entity) => entity.id === id);
const boundaryEntries = (state: CadHistoryState, kind: 'outer' | 'void') =>
  (surfaceOf(state).definition.boundaries ?? []).filter((entry) => entry.type === kind);
const ringsOf = (state: CadHistoryState, index = 0) =>
  boundaryRingsFromDefinition(state.present.project, surfaceOf(state, index));

const sourceRing = (state: CadHistoryState, kind: 'outer' | 'void', at = 0): BoundaryRingPoint[] => {
  const entry = boundaryEntries(state, kind)[at]!;
  const ring = candidateRingOfEntity(entityOf(state, entry.sourceEntityId)!);
  if (!ring) throw new Error('boundary source is not a ring entity');
  return ring;
};

const netArea = (state: CadHistoryState): number => {
  const rings = ringsOf(state);
  return rings.outers.reduce((sum, ring) => sum + ringArea(ring), 0) -
    rings.voids.reduce((sum, ring) => sum + ringArea(ring), 0);
};

const revisionOf = (state: CadHistoryState, surfaceId: string): string =>
  computeCadSurfaceSourceRevision(state.present.project,
    state.present.project.surfaces!.find((entry) => entry.id === surfaceId)!);

const createBoundary = (surfaceId: string, kind: 'outer' | 'void', vertices: BoundaryRingPoint[],
  sourceLabel?: string, replaceVoidSourceEntityId?: string): CadCommand =>
  ({ key: 'SURFACE_CREATE_BOUNDARY_SOURCE', surfaceId, kind, vertices,
    ...(sourceLabel == null ? {} : { sourceLabel }),
    ...(replaceVoidSourceEntityId == null ? {} : { replaceVoidSourceEntityId }) });

const replaceBoundary = (surfaceId: string, kind: 'outer' | 'void', sourceEntityId: string): CadCommand =>
  ({ key: 'SURFACE_REPLACE_BOUNDARY_SOURCE', surfaceId, kind, sourceEntityId });

const makeIndependent = (surfaceId: string, kind: 'outer' | 'void', sourceEntityId?: string): CadCommand =>
  ({ key: 'SURFACE_MAKE_BOUNDARY_INDEPENDENT', surfaceId, kind,
    ...(sourceEntityId == null ? {} : { sourceEntityId }) });

const gripVertex = (entityId: string, vertexIndex: number, x: number, y: number): CadCommand =>
  ({ key: 'GRIP_EDIT', entityId, gripKind: 'vertex', vertexIndex, x, y });

const editVertex = (entityId: string, vertexIndex: number, x: number, y: number): CadCommand =>
  ({ key: 'EDIT_ENTITY', entityId, edit: { kind: 'polyline-vertex', vertexIndex, x, y } });

// ---------------------------------------------------------------------------
// SURFACE_CREATE_BOUNDARY_SOURCE
// ---------------------------------------------------------------------------

describe('18W boundary source creation', () => {
  it('creates one entity-backed polygon source and clears the cached build', () => {
    const history = singleSurfaceHistory();
    const surfaceId = surfaceOf(history).id;
    const next = runCadCommand(history, createBoundary(surfaceId, 'outer', RECTANGLE, 'Parcel A'));
    expect(next).not.toBe(history);
    expect(next.undoStack).toHaveLength(history.undoStack.length + 1);
    const entries = boundaryEntries(next, 'outer');
    expect(entries).toHaveLength(1);
    const source = entityOf(next, entries[0]!.sourceEntityId)! as CadPolygonEntity;
    expect(source.type).toBe('polygon');
    expect(xy(source)).toEqual(RECTANGLE);
    expect((source.metadata as { entityName?: string }).entityName).toBe('Parcel A');
    expect(source.vertices.some((v) => 'z' in v)).toBe(false);
    expect(surfaceOf(next).cachedRevision).toBeNull();
    expect(ringArea(sourceRing(next, 'outer'))).toBe(100);
  });

  it('rejects degenerate candidates and locked surfaces', () => {
    const history = singleSurfaceHistory();
    const surfaceId = surfaceOf(history).id;
    expect(runCadCommand(history, createBoundary(surfaceId, 'outer', rectRing(0, 0, 10, 0)))).toBe(history);
    expect(runCadCommand(history, createBoundary(surfaceId, 'outer',
      [{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }]))).toBe(history);
    const locked: CadProject = {
      ...history.present.project,
      layers: history.present.project.layers.map((layer) =>
        layer.id === 'general' ? { ...layer, locked: true } : layer),
      surfaces: history.present.project.surfaces!.map((surface) => ({ ...surface, layerId: 'general' })),
    };
    const lockedState: CadHistoryState = { ...history, present: { ...history.present, project: locked } };
    expect(runCadCommand(lockedState, createBoundary(surfaceId, 'outer', RECTANGLE))).toBe(lockedState);
  });
});

// ---------------------------------------------------------------------------
// Vertex edits (polygon grips + polyline EDIT_ENTITY) — analytic areas
// ---------------------------------------------------------------------------

describe('18W boundary vertex edits', () => {
  it('moves a corner with an exact analytic area and blocks a bow-tie move', () => {
    const history = singleSurfaceHistory();
    const surfaceId = surfaceOf(history).id;
    const created = runCadCommand(history, createBoundary(surfaceId, 'outer', RECTANGLE));
    const sourceId = boundaryEntries(created, 'outer')[0]!.sourceEntityId;
    const moved = runCadCommand(created, gripVertex(sourceId, 2, 15, 10));
    expect(moved).not.toBe(created);
    expect(ringArea(ringsOf(moved).outers[0]!)).toBe(125);
    const blocked = runCadCommand(moved, gripVertex(sourceId, 1, -5, 5));
    expect(blocked).toBe(moved);
    expect(blocked.undoStack).toHaveLength(moved.undoStack.length);
    expect(sourceRing(blocked, 'outer')[1]).toEqual({ x: 10, y: 0 });
    expect(validateBoundaryVertexEdit(blocked.present.project, surfaceId, sourceId, [
      { x: 0, y: 0 }, { x: -5, y: 5 }, { x: 15, y: 10 }, { x: 0, y: 10 },
    ])).not.toBeNull();
  });

  it('blocks a bow-tie polyline move via EDIT_ENTITY (no history entry)', () => {
    const polylineId = 'pl-rect';
    const history = singleSurfaceHistory([polylineEntity(polylineId, RECTANGLE)]);
    const surfaceId = surfaceOf(history).id;
    const attached = runCadCommand(history, {
      key: 'SURFACE_ADD_BOUNDARY', surfaceId, kind: 'outer', sourceEntityId: polylineId,
    });
    const before = attached.present.project.entities.find((e) => e.id === polylineId);
    const blocked = runCadCommand(attached, editVertex(polylineId, 2, -5, 5));
    expect(blocked).toBe(attached);
    expect(blocked.undoStack).toHaveLength(attached.undoStack.length);
    expect(blocked.present.project.entities.find((e) => e.id === polylineId)).toEqual(before);
    expect(blocked.present.project.surfaces).toEqual(attached.present.project.surfaces);
    const valid = runCadCommand(attached, editVertex(polylineId, 3, -5, 10));
    expect(valid).not.toBe(attached);
    expect(ringArea(sourceRing(valid, 'outer'))).toBe(125);
  });

  it('keeps a collinear insert area-equivalent and blocks delete below 3 vertices', () => {
    const inserted: BoundaryRingPoint[] = [
      { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ];
    const history = singleSurfaceHistory([polylineEntity('pl-insert', inserted)]);
    const surfaceId = surfaceOf(history).id;
    let state = runCadCommand(history, createBoundary(surfaceId, 'outer', RECTANGLE));
    const originalId = boundaryEntries(state, 'outer')[0]!.sourceEntityId;
    state = runCadCommand(state, replaceBoundary(surfaceId, 'outer', 'pl-insert'));
    expect(state).not.toBe(history);
    expect(boundaryEntries(state, 'outer')[0]!.sourceEntityId).toBe('pl-insert');
    expect(entityOf(state, originalId)).toBeDefined();
    expect(sourceRing(state, 'outer')).toHaveLength(5);
    expect(ringArea(sourceRing(state, 'outer'))).toBe(100);
    const project = state.present.project;
    expect(validateBoundaryVertexEdit(project, surfaceId, 'pl-insert', inserted)).toBeNull();
    expect(validateBoundaryVertexEdit(project, surfaceId, 'pl-insert', RECTANGLE)).toBeNull();
    expect(validateBoundaryVertexEdit(project, surfaceId, 'pl-insert',
      [{ x: 0, y: 0 }, { x: 10, y: 10 }])).toBe('SURFACE_BOUNDARY_INVALID');
  });

  it('keeps a concave notch at its analytic area (no convex-hull leak)', () => {
    const history = singleSurfaceHistory();
    const surfaceId = surfaceOf(history).id;
    const state = runCadCommand(history, createBoundary(surfaceId, 'outer', NOTCH));
    const ring = sourceRing(state, 'outer');
    expect(ringArea(ring)).toBe(88);
    expect(ringArea(ring)).toBeLessThan(100);
    expect(validateBoundaryVertexEdit(state.present.project, surfaceId,
      boundaryEntries(state, 'outer')[0]!.sourceEntityId, ring)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Void behaviour
// ---------------------------------------------------------------------------

describe('18W void boundaries', () => {
  it('keeps the net domain at 96 while translating/resizing a void', () => {
    const history = singleSurfaceHistory([
      polygonEntity('pg-moved', rectRing(3, 3, 5, 5)),
      polygonEntity('pg-big', rectRing(1, 1, 5, 3)),
    ]);
    const surfaceId = surfaceOf(history).id;
    let state = runCadCommand(history, createBoundary(surfaceId, 'outer', RECTANGLE));
    state = runCadCommand(state, createBoundary(surfaceId, 'void', rectRing(4, 4, 6, 6)));
    expect(ringsOf(state).voids).toHaveLength(1);
    expect(ringArea(ringsOf(state).voids[0]!)).toBe(4);
    expect(netArea(state)).toBe(96);
    state = runCadCommand(state, replaceBoundary(surfaceId, 'void', 'pg-moved'));
    expect(netArea(state)).toBe(96);
    state = runCadCommand(state, replaceBoundary(surfaceId, 'void', 'pg-big'));
    expect(ringArea(ringsOf(state).voids[0]!)).toBe(8);
    expect(netArea(state)).toBe(92);
    expect(runCadCommand(state, createBoundary(surfaceId, 'void', rectRing(20, 20, 22, 22)))).toBe(state);
    expect(validateSurfaceBoundaryCandidate(state.present.project, surfaceOf(state), 'void',
      rectRing(20, 20, 22, 22))).toBe('SURFACE_VOID_INVALID');
    expect(validateSurfaceBoundaryCandidate(state.present.project, surfaceOf(state), 'void',
      rectRing(0, 0, 2, 2))).toBe('SURFACE_VOID_INVALID');
  });

  it('accepts two disjoint voids, blocks intersect, removes all of kind', () => {
    const history = singleSurfaceHistory();
    const surfaceId = surfaceOf(history).id;
    let state = runCadCommand(history, createBoundary(surfaceId, 'outer', RECTANGLE));
    state = runCadCommand(state, createBoundary(surfaceId, 'void', rectRing(1, 1, 3, 3)));
    state = runCadCommand(state, createBoundary(surfaceId, 'void', rectRing(7, 7, 9, 9)));
    expect(ringsOf(state).voids).toHaveLength(2);
    expect(netArea(state)).toBe(92);
    const secondVoidId = boundaryEntries(state, 'void')[1]!.sourceEntityId;
    const blocked = runCadCommand(state, gripVertex(secondVoidId, 0, 2, 3));
    expect(blocked).toBe(state);
    expect(blocked.undoStack).toHaveLength(state.undoStack.length);
    // REMOVE_BOUNDARY asymmetry preserved: no sourceEntityId removes all of kind.
    const removed = runCadCommand(state, { key: 'SURFACE_REMOVE_BOUNDARY', surfaceId, kind: 'void' });
    expect(boundaryEntries(removed, 'void')).toHaveLength(0);
    expect(entityOf(removed, secondVoidId)).toBeDefined();
    expect(netArea(removed)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Parcel sources + shared references
// ---------------------------------------------------------------------------

describe('18W parcel and shared-source safety', () => {
  it('copies a parcel into a new polygon without touching the parcel', () => {
    const history = singleSurfaceHistory([parcelEntity('parcel-1')]);
    const surfaceId = surfaceOf(history).id;
    const state = runCadCommand(history, {
      key: 'SURFACE_ADD_BOUNDARY', surfaceId, kind: 'outer', sourceEntityId: 'parcel-1',
    });
    const parcelBefore = JSON.stringify(entityOf(state, 'parcel-1'));
    expect(validateBoundaryVertexEdit(state.present.project, surfaceId, 'parcel-1',
      [...RECTANGLE, { x: 0, y: 0 }])).toBe(PARCEL_REFERENCE_ONLY);
    const independent = runCadCommand(state, makeIndependent(surfaceId, 'outer'));
    expect(independent).not.toBe(state);
    expect(independent.undoStack).toHaveLength(state.undoStack.length + 1);
    expect(JSON.stringify(entityOf(independent, 'parcel-1'))).toBe(parcelBefore);
    const copyId = boundaryEntries(independent, 'outer')[0]!.sourceEntityId;
    expect(copyId).not.toBe('parcel-1');
    const copy = entityOf(independent, copyId)! as CadPolygonEntity;
    expect(copy.type).toBe('polygon');
    expect(copy.layerId).toBe('general');
    expect(xy(copy)).toEqual(RECTANGLE);
    expect(netArea(independent)).toBe(100);
    const edited = runCadCommand(independent, gripVertex(copyId, 2, 15, 10));
    expect(edited).not.toBe(independent);
    expect(JSON.stringify(entityOf(edited, 'parcel-1'))).toBe(parcelBefore);
    expect(boundaryEntries(undoCadHistory(independent), 'outer')[0]!.sourceEntityId).toBe('parcel-1');
  });

  it('stales every sharing surface, restores on undo, isolates with a copy', () => {
    let history = createCadHistoryState(projectWith([polygonEntity('poly-x', RECTANGLE)]));
    history = addSurface(history, 'A');
    history = addSurface(history, 'B');
    const [aId, bId] = history.present.project.surfaces!.map((surface) => surface.id) as [string, string];
    history = runCadCommand(history, {
      key: 'SURFACE_ADD_BOUNDARY', surfaceId: aId, kind: 'outer', sourceEntityId: 'poly-x',
    });
    history = runCadCommand(history, {
      key: 'SURFACE_ADD_BOUNDARY', surfaceId: bId, kind: 'outer', sourceEntityId: 'poly-x',
    });
    expect(countSurfaceDefinitionReferencesToEntity(history.present.project, 'poly-x')).toEqual({
      boundaryUses: [{ surfaceId: aId, kind: 'outer' }, { surfaceId: bId, kind: 'outer' }],
      breaklineUses: [],
    });
    const revA = revisionOf(history, aId);
    const revB = revisionOf(history, bId);
    const edited = runCadCommand(history, gripVertex('poly-x', 2, 15, 10));
    expect(revisionOf(edited, aId)).not.toBe(revA);
    expect(revisionOf(edited, bId)).not.toBe(revB);
    const undone = undoCadHistory(edited);
    expect(revisionOf(undone, aId)).toBe(revA);
    expect(revisionOf(undone, bId)).toBe(revB);
    // Independent copy on A isolates A; B keeps the shared source.
    const isolated = runCadCommand(undone, makeIndependent(aId, 'outer'));
    const copyId = isolated.present.project.surfaces!.find((s) => s.id === aId)!
      .definition.boundaries![0]!.sourceEntityId;
    expect(copyId).not.toBe('poly-x');
    expect(countSurfaceDefinitionReferencesToEntity(isolated.present.project, 'poly-x')).toEqual({
      boundaryUses: [{ surfaceId: bId, kind: 'outer' }],
      breaklineUses: [],
    });
    const revA2 = revisionOf(isolated, aId);
    const revB2 = revisionOf(isolated, bId);
    const copyEdited = runCadCommand(isolated, gripVertex(copyId, 2, 15, 10));
    expect(revisionOf(copyEdited, aId)).not.toBe(revA2);
    expect(revisionOf(copyEdited, bId)).toBe(revB2);
  });

  it('rejects the new boundary commands on imported-TIN definitions', () => {
    const project = projectWith([polygonEntity('poly-x', RECTANGLE)]);
    project.surfaces = [{
      id: 'surf-imported',
      name: 'Imported',
      definition: {
        pointSource: { kind: 'points', pointEntityIds: [] },
        sourceKind: 'imported-tin',
        importedTin: {
          vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
          faces: [0, 1, 2],
          provenance: { format: 'LandXML', fileName: 'site.xml', surfaceName: 'S' },
        },
      },
      cachedRevision: null,
    }];
    const history = createCadHistoryState(project);
    expect(runCadCommand(history, createBoundary('surf-imported', 'outer', RECTANGLE))).toBe(history);
    expect(runCadCommand(history, replaceBoundary('surf-imported', 'outer', 'poly-x'))).toBe(history);
    expect(runCadCommand(history, makeIndependent('surf-imported', 'outer'))).toBe(history);
  });
});

// ---------------------------------------------------------------------------
// Single-transaction pins (§76: each operator action = one history entry)
// ---------------------------------------------------------------------------

describe('18W single-transaction pins', () => {
  it('batch vertex moves commit in ONE history entry; one undo restores', () => {
    const history = singleSurfaceHistory([polylineEntity('pl-batch', RECTANGLE)]);
    const surfaceId = surfaceOf(history).id;
    const attached = runCadCommand(history, {
      key: 'SURFACE_ADD_BOUNDARY', surfaceId, kind: 'outer', sourceEntityId: 'pl-batch',
    });
    const before = xy(entityOf(attached, 'pl-batch')! as CadPolylineEntity);
    const depth = attached.undoStack.length;
    const moved = runCadCommand(attached, {
      key: 'EDIT_ENTITY',
      entityId: 'pl-batch',
      edit: {
        kind: 'polyline-vertices',
        vertices: [
          { vertexIndex: 0, x: 1, y: 1 },
          { vertexIndex: 2, x: 9, y: 9 },
        ],
      },
    });
    expect(moved).not.toBe(attached);
    expect(moved.undoStack).toHaveLength(depth + 1);
    const after = xy(entityOf(moved, 'pl-batch')! as CadPolylineEntity);
    expect(after[0]).toEqual({ x: 1, y: 1 });
    expect(after[1]).toEqual(before[1]);
    expect(after[2]).toEqual({ x: 9, y: 9 });
    expect(xy(entityOf(undoCadHistory(moved), 'pl-batch')! as CadPolylineEntity)).toEqual(before);
  });

  it('rejects a self-intersecting batch with no history entry', () => {
    const history = singleSurfaceHistory([polylineEntity('pl-bowtie', RECTANGLE)]);
    const surfaceId = surfaceOf(history).id;
    const attached = runCadCommand(history, {
      key: 'SURFACE_ADD_BOUNDARY', surfaceId, kind: 'outer', sourceEntityId: 'pl-bowtie',
    });
    const blocked = runCadCommand(attached, {
      key: 'EDIT_ENTITY',
      entityId: 'pl-bowtie',
      edit: {
        kind: 'polyline-vertices',
        vertices: [
          { vertexIndex: 0, x: 1, y: 1 },
          { vertexIndex: 2, x: -5, y: 5 },
        ],
      },
    });
    expect(blocked).toBe(attached);
    expect(blocked.undoStack).toHaveLength(attached.undoStack.length);
  });

  it('void source swap commits create+remove in ONE history entry', () => {
    const history = singleSurfaceHistory([polylineEntity('pl-outer', RECTANGLE)]);
    const surfaceId = surfaceOf(history).id;
    const withOuter = runCadCommand(history, createBoundary(surfaceId, 'outer', RECTANGLE));
    const withVoid = runCadCommand(withOuter, createBoundary(surfaceId, 'void', rectRing(4, 4, 6, 6)));
    const oldVoidId = boundaryEntries(withVoid, 'void')[0]!.sourceEntityId;
    const depth = withVoid.undoStack.length;
    const entityCount = withVoid.present.project.entities.length;
    const swapped = runCadCommand(withVoid, createBoundary(surfaceId, 'void', rectRing(3, 3, 7, 7), undefined, oldVoidId));
    expect(swapped).not.toBe(withVoid);
    expect(swapped.undoStack).toHaveLength(depth + 1);
    const voids = boundaryEntries(swapped, 'void');
    expect(voids).toHaveLength(1);
    expect(voids[0]!.sourceEntityId).not.toBe(oldVoidId);
    expect(ringArea(sourceRing(swapped, 'void'))).toBe(16);
    // Old source entity stays in the drawing (definition-only rebind), new polygon added.
    expect(swapped.present.project.entities.length).toBe(entityCount + 1);
    const undone = undoCadHistory(swapped);
    expect(boundaryEntries(undone, 'void')[0]!.sourceEntityId).toBe(oldVoidId);
    expect(undone.present.project.entities.length).toBe(entityCount);
    expect(ringArea(sourceRing(undone, 'void'))).toBe(4);
  });

  it('void swap rejects an unknown old source with no history entry', () => {
    const history = singleSurfaceHistory();
    const surfaceId = surfaceOf(history).id;
    const withOuter = runCadCommand(history, createBoundary(surfaceId, 'outer', RECTANGLE));
    const withVoid = runCadCommand(withOuter, createBoundary(surfaceId, 'void', rectRing(4, 4, 6, 6)));
    const blocked = runCadCommand(withVoid, createBoundary(surfaceId, 'void', rectRing(3, 3, 7, 7), undefined, 'no-such-source'));
    expect(blocked).toBe(withVoid);
    expect(blocked.undoStack).toHaveLength(withVoid.undoStack.length);
  });
});
