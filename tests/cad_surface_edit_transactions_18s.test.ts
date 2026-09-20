import { describe, expect, it } from 'vitest';

import { createCadSurfaceCache, type CadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import {
  buildCadSurface,
  computeCadSurfaceSourceRevision,
} from '../src/engine/cad/cadSurfaces';
import {
  backfillCadSurfaces,
  buildSurfaceBuildRequest,
  clearSurfaceBuildCacheOnLoad,
  cloneCadSurfaceDefinition,
} from '../src/engine/cad/cadSurfaceTypes';
import {
  checkSurfaceEditRevision,
  SURFACE_EDIT_STALE_REVISION,
} from '../src/engine/cad/cadTransactionsSurfaceCommands';
import { executeCadCommand } from '../src/engine/cad/cadTransactions';
import type { CadCommand } from '../src/engine/cad/cadTransactions.types';
import type { CadProject, CadSurface, CadSurfaceEdit, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';
import { createCadHistoryState, redoCadHistory, runCadCommand, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import {
  pickSurfaceEdge,
  pickSurfaceVertex,
  surfaceEditPickTolerance,
  type SurfaceEditPickInput,
} from '../src/engine/cad/cadSurfaceEditPicking';
import { TIN_EDGE_FREE } from '../src/engine/cad/tin/tinTypes';
import {
  executeShellCommand,
  resolveShellCommandText,
} from '../src/cad-app/shell/cadCommandRegistry';
import type { CadShellActions } from '../src/cad-app/shell/cadShellTypes';
import { trySurfaceCommand } from '../src/cad-app/shell/cadSurfaceSnapshot';
import {
  currentSurfaceEditMesh,
  SURFACE_EDIT_STALE_MESH_MESSAGE,
} from '../src/hooks/surveyCad/useSurveyCadSurfaceEditSessions';
import { buildSurfaceMeshFromRequest, type SurfaceWorkerMesh } from '../src/workers/surfaceWorkerHandler';
import type { PendingSurfaceBuild, SurfaceBuildTransport } from '../src/workers/surfaceWorkerClient';
import { SurfaceBuildService, type SurfaceBuildServiceDeps } from '../src/workers/surfaceBuildService';
import type { SurfaceBuildRequest } from '../src/engine/cad/cadSurfaceTypes';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const point = (id: string, stationId: string, x: number, y: number, z: number): CadSurveyPointEntity => ({
  id,
  type: 'survey-point',
  layerId: 'points',
  visible: true,
  locked: false,
  stationId,
  x,
  y,
  z,
  pointClass: 'free',
  source: 'parsed-input',
});

const projectWithPoints = (): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Edit Tx', units: 'm' });
  return {
    ...drawing.project,
    entities: [
      point('pt-1', 'A', 0, 0, 10),
      point('pt-2', 'B', 10, 0, 11),
      point('pt-3', 'C', 10, 10, 12),
      point('pt-4', 'D', 0, 10, 13),
    ],
  };
};

const historyWithSurface = () => {
  let history = createCadHistoryState(projectWithPoints());
  history = runCadCommand(history, {
    key: 'SURFACE_CREATE',
    name: 'Site',
    pointSource: { kind: 'points', pointEntityIds: ['pt-1', 'pt-2', 'pt-3', 'pt-4'] },
  });
  const surface = history.present.project.surfaces![0]!;
  return { history, surfaceId: surface.id };
};

const revisionOf = (project: CadProject, surfaceId: string): string =>
  computeCadSurfaceSourceRevision(project, project.surfaces!.find((s) => s.id === surfaceId)!);

const swapDraft = { kind: 'swap-edge', edge: { a: { key: 'source:pt-1' }, b: { key: 'source:pt-3' } } } as const;

const addSwap = (surfaceId: string, expectedRevision: string): CadCommand => ({
  key: 'SURFACE_ADD_EDIT',
  surfaceId,
  edit: { kind: 'swap-edge', edge: { a: { key: 'source:pt-1' }, b: { key: 'source:pt-3' } } },
  expectedRevision,
});

// ---------------------------------------------------------------------------
// SURFACE_*_EDIT transactions
// ---------------------------------------------------------------------------

describe('18S SURFACE_*_EDIT transactions', () => {
  it('adds an edit with a stable drawing-owned id and clears the cached build', () => {
    const { history, surfaceId } = historyWithSurface();
    const revision = revisionOf(history.present.project, surfaceId);
    const next = runCadCommand(history, addSwap(surfaceId, revision));
    expect(next).not.toBe(history);
    const surface = next.present.project.surfaces![0]!;
    expect(surface.definition.edits).toHaveLength(1);
    expect(surface.definition.edits![0]!.id.startsWith('cad-surface-edit-')).toBe(true);
    expect(surface.definition.edits![0]).toEqual({ ...swapDraft, id: surface.definition.edits![0]!.id });
    expect(('enabled' in surface.definition.edits![0]!)).toBe(false);
    expect(surface.cachedRevision).toBeNull();
    expect(surface.buildDiagnostic).toBeUndefined();
    expect(revisionOf(next.present.project, surfaceId)).not.toBe(revision);
  });

  it('undoes/redoes an add in one entry', () => {
    const { history, surfaceId } = historyWithSurface();
    const revision = revisionOf(history.present.project, surfaceId);
    const added = runCadCommand(history, addSwap(surfaceId, revision));
    const undone = undoCadHistory(added);
    expect(undone.present.project.surfaces![0]!.definition.edits ?? []).toEqual([]);
    expect(revisionOf(undone.present.project, surfaceId)).toBe(revision);
    const redone = redoCadHistory(undone);
    expect(redone.present.project.surfaces![0]!.definition.edits).toHaveLength(1);
  });

  it('rejects unknown surfaces, bad drafts, stale revisions, and volume ids', () => {
    const { history, surfaceId } = historyWithSurface();
    const revision = revisionOf(history.present.project, surfaceId);
    expect(runCadCommand(history, addSwap('nope', revision))).toBe(history);
    expect(runCadCommand(history, {
      key: 'SURFACE_ADD_EDIT', surfaceId,
      edit: { kind: 'swap-edge', edge: { a: { key: '' }, b: { key: 'source:pt-3' } } },
      expectedRevision: revision,
    } as CadCommand)).toBe(history);
    expect(runCadCommand(history, {
      key: 'SURFACE_ADD_EDIT', surfaceId,
      edit: { kind: 'nope' },
      expectedRevision: revision,
    } as unknown as CadCommand)).toBe(history);
    // Stale: add once (revision moves), then replay the old revision.
    const added = runCadCommand(history, addSwap(surfaceId, revision));
    expect(runCadCommand(added, addSwap(surfaceId, revision))).toBe(added);
    expect(checkSurfaceEditRevision(added.present.project, surfaceId, revision)).toBe(SURFACE_EDIT_STALE_REVISION);
    // Volume-surface ids live in a separate array: never editable here.
    const withVolume: CadProject = {
      ...added.present.project,
      volumeSurfaces: [{ id: 'vol-1', name: 'V', baseSurfaceId: surfaceId, comparisonSurfaceId: surfaceId }],
    };
    expect(checkSurfaceEditRevision(withVolume, 'vol-1', 'whatever')).toBe('SURFACE_NOT_FOUND');
    const snapshot = { project: withVolume, selection: added.present.selection };
    expect(executeCadCommand(snapshot, addSwap('vol-1', 'whatever'))).toBeNull();
  });

  it('blocks all four ops when the surface layer is locked', () => {
    const { history, surfaceId } = historyWithSurface();
    const layerId = history.present.project.layers.find((l) => l.id === 'general')?.id ?? history.present.project.layers[0]!.id;
    const locked: CadProject = {
      ...history.present.project,
      layers: history.present.project.layers.map((l) => (l.id === layerId ? { ...l, locked: true } : l)),
      surfaces: history.present.project.surfaces!.map((s) => (s.id === surfaceId ? { ...s, layerId } : s)),
    };
    const revision = revisionOf(locked, surfaceId);
    const snapshot = { project: locked, selection: history.present.selection };
    expect(executeCadCommand(snapshot, addSwap(surfaceId, revision))).toBeNull();
    expect(executeCadCommand(snapshot, { key: 'SURFACE_DELETE_EDIT', surfaceId, editId: 'e', expectedRevision: revision })).toBeNull();
    expect(executeCadCommand(snapshot, { key: 'SURFACE_MOVE_EDIT', surfaceId, editId: 'e', direction: 'up', expectedRevision: revision })).toBeNull();
    expect(executeCadCommand(snapshot, { key: 'SURFACE_SET_EDIT_ENABLED', surfaceId, editId: 'e', enabled: false, expectedRevision: revision })).toBeNull();
  });

  it('deletes, moves, and enables edits with exact order semantics', () => {
    const { history, surfaceId } = historyWithSurface();
    let state = history;
    const rev = (): string => revisionOf(state.present.project, surfaceId);
    state = runCadCommand(state, addSwap(surfaceId, rev()));
    state = runCadCommand(state, {
      key: 'SURFACE_ADD_EDIT', surfaceId,
      edit: { kind: 'delete-line', edge: { a: { key: 'source:pt-1' }, b: { key: 'source:pt-2' } } },
      expectedRevision: rev(),
    });
    const [first, second] = state.present.project.surfaces![0]!.definition.edits!;
    // Move second up, then back down.
    state = runCadCommand(state, { key: 'SURFACE_MOVE_EDIT', surfaceId, editId: second!.id, direction: 'up', expectedRevision: rev() });
    expect(state.present.project.surfaces![0]!.definition.edits!.map((e) => e.id)).toEqual([second!.id, first!.id]);
    state = runCadCommand(state, { key: 'SURFACE_MOVE_EDIT', surfaceId, editId: second!.id, direction: 'down', expectedRevision: rev() });
    expect(state.present.project.surfaces![0]!.definition.edits!.map((e) => e.id)).toEqual([first!.id, second!.id]);
    // Ends and unknown ids are no-ops.
    expect(runCadCommand(state, { key: 'SURFACE_MOVE_EDIT', surfaceId, editId: first!.id, direction: 'up', expectedRevision: rev() })).toBe(state);
    expect(runCadCommand(state, { key: 'SURFACE_MOVE_EDIT', surfaceId, editId: second!.id, direction: 'down', expectedRevision: rev() })).toBe(state);
    expect(runCadCommand(state, { key: 'SURFACE_MOVE_EDIT', surfaceId, editId: 'nope', direction: 'up', expectedRevision: rev() })).toBe(state);
    // Disable then re-enable (true restores the canonical absent field).
    state = runCadCommand(state, { key: 'SURFACE_SET_EDIT_ENABLED', surfaceId, editId: first!.id, enabled: false, expectedRevision: rev() });
    expect(state.present.project.surfaces![0]!.definition.edits![0]).toEqual({ ...first, enabled: false });
    expect(runCadCommand(state, { key: 'SURFACE_SET_EDIT_ENABLED', surfaceId, editId: first!.id, enabled: false, expectedRevision: rev() })).toBe(state);
    state = runCadCommand(state, { key: 'SURFACE_SET_EDIT_ENABLED', surfaceId, editId: first!.id, enabled: true, expectedRevision: rev() });
    expect(state.present.project.surfaces![0]!.definition.edits![0]).toEqual(first);
    // Delete one; unknown id is a no-op.
    state = runCadCommand(state, { key: 'SURFACE_DELETE_EDIT', surfaceId, editId: first!.id, expectedRevision: rev() });
    expect(state.present.project.surfaces![0]!.definition.edits!.map((e) => e.id)).toEqual([second!.id]);
    expect(runCadCommand(state, { key: 'SURFACE_DELETE_EDIT', surfaceId, editId: 'nope', expectedRevision: rev() })).toBe(state);
  });

  it('checkSurfaceEditRevision maps ok / missing / stale', () => {
    const { history, surfaceId } = historyWithSurface();
    const revision = revisionOf(history.present.project, surfaceId);
    expect(checkSurfaceEditRevision(history.present.project, surfaceId, revision)).toBe('ok');
    expect(checkSurfaceEditRevision(history.present.project, 'nope', revision)).toBe('SURFACE_NOT_FOUND');
    expect(checkSurfaceEditRevision(history.present.project, surfaceId, 'stale')).toBe(SURFACE_EDIT_STALE_REVISION);
  });
});

// ---------------------------------------------------------------------------
// Clone / backfill round-trip (WNCAD persistence comes via these)
// ---------------------------------------------------------------------------

describe('18S edit-stack clone/backfill', () => {
  const edits: CadSurfaceEdit[] = [
    { id: 'e1', kind: 'swap-edge', edge: { a: { key: 'source:pt-1' }, b: { key: 'source:pt-3' } } },
    { id: 'e2', kind: 'add-line', enabled: false, from: { key: 'source:pt-1' }, to: { key: 'source:pt-2' } },
    { id: 'e3', kind: 'delete-line', edge: { a: { key: 'source:pt-2' }, b: { key: 'source:pt-4' } } },
  ];

  it('survives clone/backfill with ids/types/refs/enabled/order exact', () => {
    const surface: CadSurface = {
      id: 's1',
      name: 'Site',
      definition: { pointSource: { kind: 'points', pointEntityIds: ['pt-1'] }, edits },
      cachedRevision: 'srev1:abc',
      buildDiagnostic: 'boom',
    };
    const cloned = cloneCadSurfaceDefinition(surface.definition);
    expect(cloned.edits).toEqual(edits);
    expect(cloned.edits).not.toBe(edits);
    const backfilled = backfillCadSurfaces([{ ...surface, definition: cloned }]);
    expect(backfilled[0]!.definition.edits).toEqual(edits);
    // Mutation isolation: editing the source never touches the clone.
    (edits[0] as { id: string }).id = 'mutated';
    expect(cloned.edits![0]!.id).toBe('e1');
    (edits[0] as { id: string }).id = 'e1';
  });

  it('reopen normalization keeps edits but drops the untrusted cached build', () => {
    const surface: CadSurface = {
      id: 's1',
      name: 'Site',
      definition: { pointSource: { kind: 'points', pointEntityIds: ['pt-1'] }, edits },
      cachedRevision: 'srev1:abc',
      buildDiagnostic: 'boom',
    };
    const reopened = clearSurfaceBuildCacheOnLoad(surface);
    expect(reopened.definition.edits).toEqual(edits);
    expect(reopened.cachedRevision).toBeNull();
    expect(reopened.buildDiagnostic).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Picking helpers
// ---------------------------------------------------------------------------

const quadInput = (overrides?: Partial<SurfaceEditPickInput>): SurfaceEditPickInput => ({
  surfaceId: 's1',
  sourceKind: 'native',
  revision: 'srev1:x',
  points: [
    { entityId: 'pt-1', x: 0, y: 0, z: 10 },
    { entityId: 'pt-2', x: 10, y: 0, z: 11 },
    { entityId: 'pt-3', x: 10, y: 10, z: 12 },
    { entityId: 'pt-4', x: 0, y: 10, z: 13 },
  ],
  triangles: [[0, 1, 2], [0, 2, 3]],
  worldPoint: { x: 0, y: 0 },
  tolerance: 1,
  ...overrides,
});

describe('18S surface edit picking', () => {
  it('picks the nearest vertex as a stable ref, misses outside tolerance', () => {
    const hit = pickSurfaceVertex(quadInput({ worldPoint: { x: 0.4, y: 0.3 } }));
    expect(hit).toEqual({ surfaceId: 's1', revision: 'srev1:x', vertexRef: { key: 'source:pt-1' }, worldPoint: { x: 0, y: 0 } });
    expect(pickSurfaceVertex(quadInput({ worldPoint: { x: 5, y: 5 } }))).toBeNull();
  });

  it('blocks synthetic vertices instead of emitting a ref', () => {
    const input = quadInput({
      points: [...quadInput().points, { entityId: 'steiner:s1:0', x: 5, y: 5, z: 0 }],
      triangles: [[0, 1, 2], [0, 2, 3]],
      worldPoint: { x: 5, y: 5 },
      tolerance: 1,
    });
    const hit = pickSurfaceVertex(input);
    expect(hit).toEqual({ blocked: 'synthetic', reason: expect.any(String) });
  });

  it('maps imported mesh ids to imported refs', () => {
    const hit = pickSurfaceVertex(quadInput({
      sourceKind: 'imported-tin',
      points: [{ entityId: 's1:v2', x: 10, y: 10, z: 12 }],
      triangles: [],
      worldPoint: { x: 10, y: 10 },
    }));
    expect(hit).toEqual({ surfaceId: 's1', revision: 'srev1:x', vertexRef: { key: 'imported:s1:2' }, worldPoint: { x: 10, y: 10 } });
  });

  it('picks edges canonically with adjacency, kind, and no index leaks', () => {
    const hit = pickSurfaceEdge(quadInput({ worldPoint: { x: 5, y: 5 } }));
    expect(hit).not.toBeNull();
    if (!hit || 'blocked' in hit) throw new Error('expected an edge pick');
    // Diagonal 0-2 in canonical ref order.
    expect(hit.edge.a.key <= hit.edge.b.key).toBe(true);
    expect([hit.edge.a.key, hit.edge.b.key].sort()).toEqual(['source:pt-1', 'source:pt-3']);
    expect(hit.adjacentCount).toBe(2);
    expect(hit.edgeKind).toBe(TIN_EDGE_FREE);
    expect(hit).toEqual({
      surfaceId: 's1',
      revision: 'srev1:x',
      edge: hit.edge,
      edgeKind: TIN_EDGE_FREE,
      adjacentCount: 2,
      worldPoint: { x: 5, y: 5 },
    });
    // Boundary edge reports a single adjacent triangle.
    const boundary = pickSurfaceEdge(quadInput({ worldPoint: { x: 5, y: 0.2 } }));
    if ('blocked' in boundary! || !boundary) throw new Error('expected boundary edge');
    expect(boundary.adjacentCount).toBe(1);
    expect(pickSurfaceEdge(quadInput({ worldPoint: { x: 50, y: 50 } }))).toBeNull();
  });

  it('blocks synthetic-touching edges', () => {
    const hit = pickSurfaceEdge(quadInput({
      points: [...quadInput().points, { entityId: 'boundary:s1:0', x: 5, y: -0.1, z: 0 }],
      triangles: [[0, 1, 2], [0, 2, 3], [0, 4, 1]],
      worldPoint: { x: 5, y: -0.1 },
      tolerance: 0.5,
    }));
    expect(hit == null || 'blocked' in hit).toBe(true);
  });

  it('derives the pick radius from drawing bounds like CAD snapping', () => {
    expect(surfaceEditPickTolerance(null)).toBe(1);
    expect(surfaceEditPickTolerance({ minX: 0, minY: 0, maxX: 100, maxY: 50 })).toBe(1);
    expect(surfaceEditPickTolerance({ minX: 0, minY: 0, maxX: 10, maxY: 10 })).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// Shell commands + snapshot seam
// ---------------------------------------------------------------------------

describe('18S shell edit commands', () => {
  const actions = (overrides?: Partial<CadShellActions>): CadShellActions => ({
    startCommand: () => false,
    undo: () => undefined,
    redo: () => undefined,
    selectAll: () => undefined,
    clearSelection: () => undefined,
    eraseSelection: () => undefined,
    selectEntities: () => undefined,
    editField: () => ({ applied: true }),
    runLayerCommand: () => true,
    runSurveyCommand: () => true,
    selectSurface: () => undefined,
    selectVolume: () => undefined,
    selectProfile: () => undefined,
    rebuildProfile: () => '',
    createProfileView: () => undefined,
    selectProfileView: () => undefined,
    queryProfileElevation: () => '',
    selectSampleLineGroup: () => undefined,
    selectSampleLine: () => undefined,
    rebuildSections: () => '',
    rebuildSectionLine: () => '',
    createSectionViews: () => '',
    selectSectionView: () => undefined,
    querySectionElevation: () => '',
    requestVolume: () => '',
    startVolumePick: () => undefined,
    queryVolumeDifference: () => null,
    calculateSelectedVolume: () => undefined,
    startSurfacePick: () => undefined,
    querySurfaceElevation: () => null,
    querySurfaceSlope: () => null,
    rebuildSurface: () => '',
    rebuildAllSurfaces: () => '',
    describeBreaklineSource: () => null,
    describeBoundarySource: () => null,
    openSurveyManager: () => undefined,
    selectAllSurveyPoints: () => undefined,
    selectSurveyGroupPoints: () => undefined,
    setCurrentLayer: () => true,
    openLayerManager: () => undefined,
    setSnapPreference: () => undefined,
    newDrawing: () => undefined,
    openDrawingFile: () => undefined,
    saveDrawing: () => undefined,
    requestLandXmlImport: () => undefined,
    toggleDraftingPanel: () => undefined,
    toggleExportCenter: () => undefined,
    cancelCommand: () => undefined,
    confirmCommandInput: () => undefined,
    ...overrides,
  });

  it('resolves SURF* keys and aliases', () => {
    expect(resolveShellCommandText('SURFSWAPEDGE')?.key).toBe('SURFSWAPEDGE');
    expect(resolveShellCommandText('SWAPEDGE')?.key).toBe('SURFSWAPEDGE');
    expect(resolveShellCommandText('swapedge')?.key).toBe('SURFSWAPEDGE');
    expect(resolveShellCommandText('SURFADDLINE')?.key).toBe('SURFADDLINE');
    expect(resolveShellCommandText('ADDTINLINE')?.key).toBe('SURFADDLINE');
    expect(resolveShellCommandText('SURFDELETELINE')?.key).toBe('SURFDELETELINE');
    expect(resolveShellCommandText('DELTINLINE')?.key).toBe('SURFDELETELINE');
    expect(resolveShellCommandText('SURFEDITS')?.key).toBe('SURFEDITS');
  });

  it('routes edit sessions through workspace actions, history through the manager', () => {
    const seen: string[] = [];
    const shell = actions({
      startSurfaceEditSession: (mode) => {
        seen.push(mode);
        return true;
      },
      openSurveyManager: (kind) => void seen.push(`manager:${kind}`),
    });
    expect(executeShellCommand(resolveShellCommandText('SWAPEDGE')!, shell)).toBe(true);
    expect(executeShellCommand(resolveShellCommandText('SURFADDLINE')!, shell)).toBe(true);
    expect(executeShellCommand(resolveShellCommandText('DELTINLINE')!, shell)).toBe(true);
    expect(executeShellCommand(resolveShellCommandText('SURFEDITS')!, shell)).toBe(true);
    expect(seen).toEqual(['swap', 'add-line', 'delete-line', 'manager:surfaces']);
    expect(executeShellCommand(resolveShellCommandText('SURFSWAPEDGE')!, actions())).toBe(false);
  });

  it('trySurfaceCommand covers the new ops (true/false/throw/absent)', () => {
    const { history, surfaceId } = historyWithSurface();
    const revision = revisionOf(history.present.project, surfaceId);
    const run = (command: CadCommand): boolean => {
      const result = executeCadCommand({ project: history.present.project, selection: history.present.selection }, command);
      return result != null;
    };
    expect(trySurfaceCommand(run, addSwap(surfaceId, revision))).toBe(true);
    expect(trySurfaceCommand(run, addSwap('nope', revision))).toBe(false);
    expect(trySurfaceCommand(() => { throw new Error('missing'); }, addSwap(surfaceId, revision))).toBe(false);
    expect(trySurfaceCommand(undefined, addSwap(surfaceId, revision))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Edit-session mesh gate
// ---------------------------------------------------------------------------

describe('18S edit-session mesh gate', () => {
  it('requires a CURRENT mesh and reports the rebuild message otherwise', () => {
    expect(SURFACE_EDIT_STALE_MESH_MESSAGE).toBe('Rebuild the surface before editing TIN topology.');
    const project = projectWithPoints();
    let history = createCadHistoryState(project);
    history = runCadCommand(history, {
      key: 'SURFACE_CREATE',
      name: 'Site',
      pointSource: { kind: 'points', pointEntityIds: ['pt-1', 'pt-2', 'pt-3', 'pt-4'] },
    });
    const surfaceId = history.present.project.surfaces![0]!.id;
    const cache = createCadSurfaceCache('test-18s');
    // UNBUILT: no session mesh.
    expect(currentSurfaceEditMesh(history.present.project, cache, surfaceId, new Set())).toBeNull();
    // CURRENT: session mesh for the content revision.
    const surface = history.present.project.surfaces![0]!;
    const revision = revisionOf(history.present.project, surfaceId);
    const built = buildCadSurface(history.present.project, surface);
    expect(built.outcome).toBe('ok');
    cache.set(surfaceId, revision, {
      revision,
      points: built.points,
      triangles: built.triangles,
      stats: built.stats,
      grid: built.grid,
      adjacency: built.adjacency,
      edgeKinds: built.edgeKinds,
    });
    expect(currentSurfaceEditMesh(history.present.project, cache, surfaceId, new Set())?.revision).toBe(revision);
    // BUILDING overlay blocks even with a mesh.
    expect(currentSurfaceEditMesh(history.present.project, cache, surfaceId, new Set([surfaceId]))).toBeNull();
    // Unknown surface blocks.
    expect(currentSurfaceEditMesh(history.present.project, cache, 'nope', new Set())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Service ownership: edit commits race the worker (existing harness pattern)
// ---------------------------------------------------------------------------

class StubTransport implements SurfaceBuildTransport {
  alive = true;
  readonly builds: Array<{
    requestId: string;
    request: SurfaceBuildRequest;
    resolve: (_mesh: SurfaceWorkerMesh | null) => void;
    reject: (_error: Error) => void;
  }> = [];
  private nextId = 0;

  build(request: SurfaceBuildRequest): PendingSurfaceBuild {
    this.nextId += 1;
    const requestId = `stub-${this.nextId}`;
    let handle!: { resolve: (_m: SurfaceWorkerMesh | null) => void; reject: (_e: Error) => void };
    const done = new Promise<SurfaceWorkerMesh | null>((resolve, reject) => {
      handle = { resolve, reject };
    });
    this.builds.push({ requestId, request, ...handle });
    return { requestId, done, cancel: () => this.cancel(requestId) };
  }

  cancel(requestId: string): void {
    const index = this.builds.findIndex((entry) => entry.requestId === requestId);
    if (index >= 0) this.builds.splice(index, 1)[0]!.resolve(null);
  }

  dispose(): void {
    this.alive = false;
    for (const entry of this.builds.splice(0)) entry.resolve(null);
  }
}

const createServiceHarness = () => {
  let project: CadProject = (() => {
    const base = projectWithPoints();
    return {
      ...base,
      surfaces: [{
        id: 's1',
        name: 'Site',
        definition: { pointSource: { kind: 'points', pointEntityIds: ['pt-1', 'pt-2', 'pt-3', 'pt-4'] } },
        cachedRevision: null,
      } satisfies CadSurface],
    };
  })();
  let drawingId = 'drawing-a';
  const stub = new StubTransport();
  const cache: CadSurfaceCache = createCadSurfaceCache('test-18s-service');
  const notices: string[] = [];
  const revisions = new Map<string, string[]>();
  const service = new SurfaceBuildService({
    drawingId: 'drawing-a',
    getProject: () => project,
    getDrawingId: () => drawingId,
    cache,
    createTransport: (() => stub) as SurfaceBuildServiceDeps['createTransport'],
    getBuiltRevisions: (surfaceId) => revisions.get(surfaceId) ?? [],
    recordRevision: (surfaceId, revision) => {
      revisions.set(surfaceId, [...(revisions.get(surfaceId) ?? []), revision].slice(-2));
    },
    notify: (message) => notices.push(message),
    onStateChange: () => undefined,
  });
  const meshFor = (surfaceId: string): SurfaceWorkerMesh => {
    const surface = project.surfaces!.find((entry) => entry.id === surfaceId)!;
    const revision = computeCadSurfaceSourceRevision(project, surface);
    return buildSurfaceMeshFromRequest(buildSurfaceBuildRequest(project, surfaceId, revision)!);
  };
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 10; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  return {
    service, stub, cache, notices,
    project: () => project,
    setProject: (next: CadProject) => {
      project = next;
    },
    drawingId: () => drawingId,
    setDrawingId: (next: string) => {
      drawingId = next;
    },
    meshFor,
    flush,
  };
};

const commitEdit = (project: CadProject, edit: Omit<Extract<CadSurfaceEdit, { kind: 'swap-edge' }>, 'id'>): CadProject => {
  const surface = project.surfaces![0]!;
  const revision = computeCadSurfaceSourceRevision(project, surface);
  const result = executeCadCommand(
    { project, selection: { selectedEntityIds: [] } },
    { key: 'SURFACE_ADD_EDIT', surfaceId: surface.id, edit, expectedRevision: revision },
  );
  if (!result) throw new Error('edit commit rejected');
  return result.nextSnapshot.project;
};

describe('18S edit commits race the worker', () => {
  it('edit A then edit B before A finishes: B wins, late A discarded', async () => {
    const harness = createServiceHarness();
    // Derive a valid interior edge from the real mesh (never guess).
    const base = harness.project();
    const mesh = buildCadSurface(base, base.surfaces![0]!);
    expect(mesh.outcome).toBe('ok');
    const counts = new Map<string, number>();
    for (const tri of mesh.triangles) {
      for (const [u, v] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]] as const) {
        const key = `${Math.min(u, v)}>${Math.max(u, v)}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    const interior = [...counts.entries()].find(([, n]) => n === 2)![0].split('>').map(Number) as [number, number];
    const refOf = (index: number): { key: string } => ({ key: `source:${mesh.points[index].entityId}` });
    let project = commitEdit(base, { kind: 'swap-edge', edge: { a: refOf(interior[0]), b: refOf(interior[1]) } });
    const editAId = project.surfaces![0]!.definition.edits![0]!.id;
    harness.setProject(project);
    harness.service.rebuildSurface('s1');
    const buildA = harness.stub.builds[0]!;
    // Edit B disables A (valid geometry on every revision, fresh revision).
    const surfaceB = project.surfaces![0]!;
    const revB = computeCadSurfaceSourceRevision(project, surfaceB);
    const committedB = executeCadCommand(
      { project, selection: { selectedEntityIds: [] } },
      { key: 'SURFACE_SET_EDIT_ENABLED', surfaceId: surfaceB.id, editId: editAId, enabled: false, expectedRevision: revB },
    );
    if (!committedB) throw new Error('edit B commit rejected');
    project = committedB.nextSnapshot.project;
    harness.setProject(project);
    harness.service.rebuildSurface('s1');
    // Rebuild supersedes same-surface work: only the latest build stands.
    expect(harness.stub.builds).toHaveLength(1);
    const buildB = harness.stub.builds[0]!;
    expect(buildB.request.revision).toBe(computeCadSurfaceSourceRevision(project, project.surfaces![0]!));
    expect(buildB.request.definition.edits).toEqual([{ ...project.surfaces![0]!.definition.edits![0]! }]);
    expect(buildB.request.definition.edits![0]!.enabled).toBe(false);
    buildA.resolve(harness.meshFor('s1'));
    await harness.flush();
    // Late A carried the older revision: never CURRENT under B's definition.
    expect(harness.cache.get('s1', buildA.request.revision)).toBeUndefined();
    buildB.resolve(harness.meshFor('s1'));
    await harness.flush();
    expect(harness.cache.get('s1', buildB.request.revision)).toBeDefined();
    harness.service.dispose();
  });

  it('commit then undo before the worker returns: late result discarded, no ghost edit', async () => {
    const harness = createServiceHarness();
    const before = harness.project();
    const committed = commitEdit(before, { kind: 'swap-edge', edge: { a: { key: 'source:pt-1' }, b: { key: 'source:pt-3' } } });
    expect(committed.surfaces![0]!.definition.edits).toHaveLength(1);
    harness.setProject(committed);
    harness.service.rebuildSurface('s1');
    const build = harness.stub.builds[0]!;
    // Undo the edit before the worker returns.
    harness.setProject(before);
    build.resolve(harness.meshFor('s1'));
    await harness.flush();
    expect(harness.cache.get('s1', build.request.revision)).toBeUndefined();
    expect(harness.project().surfaces![0]!.definition.edits ?? []).toEqual([]);
    harness.service.dispose();
  });
});
