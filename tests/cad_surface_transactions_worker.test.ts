import { describe, expect, it } from 'vitest';

import {
  applySurfaceBuildFailure,
  applySurfaceBuildSuccess,
  createCadSurfaceCache,
} from '../src/engine/cad/cadSurfaceCache';
import {
  buildCadSurface,
  computeCadSurfaceSourceRevision,
  deriveSurfaceStatus,
  type CadSurfaceBuildStats,
} from '../src/engine/cad/cadSurfaces';
import { buildSurfaceBuildRequest } from '../src/engine/cad/cadSurfaceTypes';
import { createCadHistoryState, redoCadHistory, runCadCommand, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import {
  buildSurfaceMeshFromRequest,
  createSurfaceWorkerHandler,
  type SurfaceWorkerMesh,
  type SurfaceWorkerResponseMessage,
} from '../src/workers/surfaceWorkerHandler';
import type { CadProject, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';

const point = (
  id: string,
  stationId: string,
  x: number,
  y: number,
  z: number,
): CadSurveyPointEntity => ({
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
  const drawing = createBlankCadDrawingDocument({ name: 'Surface Worker', units: 'm' });
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

const emptyStats = (): CadSurfaceBuildStats => ({
  resolvedPointCount: 0,
  usedPointCount: 0,
  skippedMissingZCount: 0,
  triangleCount: 0,
  minZ: null,
  maxZ: null,
  minX: null,
  minY: null,
  maxX: null,
  maxY: null,
  planimetricArea: 0,
  surface3DArea: 0,
  meanElevation: null,
  minFaceSlopeRatio: null,
  maxFaceSlopeRatio: null,
  meanFaceSlopeRatio: null,
});

const flush = async (rounds = 5): Promise<void> => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

describe('CAD surface transactions + worker', () => {
  it('undos/redos a point-group source edit with revision following definition', () => {
    let history = createCadHistoryState(projectWithPoints());
    history = runCadCommand(history, {
      key: 'SURFACE_CREATE',
      name: 'Site',
      pointSource: { kind: 'points', pointEntityIds: ['pt-1', 'pt-2', 'pt-3'] },
    });
    const surfaceId = history.present.project.surfaces![0]!.id;
    const base = computeCadSurfaceSourceRevision(history.present.project, history.present.project.surfaces![0]!);
    history = runCadCommand(history, { key: 'SURFACE_ADD_POINT_GROUP', surfaceId, pointGroupId: 'point-group-all' });
    expect(history.present.project.surfaces![0]!.definition.pointSource).toEqual({
      kind: 'point-group',
      pointGroupIds: ['point-group-all'],
    });
    const edited = computeCadSurfaceSourceRevision(history.present.project, history.present.project.surfaces![0]!);
    expect(edited).not.toBe(base);
    history = undoCadHistory(history);
    expect(history.present.project.surfaces![0]!.definition.pointSource).toEqual({
      kind: 'points',
      pointEntityIds: ['pt-1', 'pt-2', 'pt-3'],
    });
    expect(computeCadSurfaceSourceRevision(history.present.project, history.present.project.surfaces![0]!)).toBe(base);
  });

  it('blocks surface style delete while referenced, rewires with a replacement', () => {
    let history = createCadHistoryState(projectWithPoints());
    history = runCadCommand(history, { key: 'SURFACE_CREATE', name: 'Site', styleId: 'surface-style-triangles' });
    const surfaceId = history.present.project.surfaces![0]!.id;
    const blocked = runCadCommand(history, { key: 'SURFACE_STYLE_DELETE', styleId: 'surface-style-triangles' });
    expect(blocked).toBe(history);
    const rewired = runCadCommand(history, {
      key: 'SURFACE_STYLE_DELETE',
      styleId: 'surface-style-triangles',
      replacementId: 'surface-style-boundary',
    });
    expect(rewired.present.project.surfaces![0]!.styleId).toBe('surface-style-boundary');
    expect(rewired.present.project.surfaceStyles!.some((style) => style.id === 'surface-style-triangles')).toBe(false);
    expect(rewired.present.project.surfaces![0]!.id).toBe(surfaceId);
    const redone = redoCadHistory(rewired);
    expect(redone.present.project.surfaceStyles!.some((style) => style.id === 'surface-style-triangles')).toBe(false);
  });

  it('rebuilds worker-identical meshes from the compact request (no whole project)', async () => {
    let history = createCadHistoryState(projectWithPoints());
    history = runCadCommand(history, {
      key: 'SURFACE_CREATE',
      name: 'Site',
      pointSource: { kind: 'points', pointEntityIds: ['pt-1', 'pt-2', 'pt-3', 'pt-4'] },
    });
    const project = history.present.project;
    const surface = project.surfaces![0]!;
    const revision = computeCadSurfaceSourceRevision(project, surface);
    const request = buildSurfaceBuildRequest(project, surface.id, revision);
    expect(request).not.toBeNull();
    // No whole project crosses the boundary: ids + compact snapshots only.
    expect(Object.keys(request!)).toEqual(['surfaceId', 'revision', 'points', 'extraEntities', 'pointGroups', 'definition']);
    const direct = buildCadSurface(project, surface);
    const viaWorker = buildSurfaceMeshFromRequest(request!);
    expect(viaWorker.revision).toBe(direct.revision);
    expect(viaWorker.triangles).toEqual(direct.triangles);
    expect(viaWorker.outcome).toBe('ok');
  });

  it('discards a superseded build (latest-wins) and never marks it CURRENT', async () => {
    const posted: SurfaceWorkerResponseMessage[] = [];
    const resolvers: Array<(_mesh: SurfaceWorkerMesh) => void> = [];
    const handler = createSurfaceWorkerHandler({
      loadBuilder: async () => () =>
        new Promise<SurfaceWorkerMesh>((resolve) => {
          resolvers.push(resolve);
        }),
      postMessage: (message) => posted.push(message),
      defer: (callback) => callback(),
    });
    const meshFor = (revision: string): SurfaceWorkerMesh => ({
      outcome: 'ok',
      revision,
      reasonCodes: [],
      points: [],
      triangles: [],
      stats: emptyStats(),
      grid: { minX: 0, minY: 0, cellSize: 1, cells: new Map() },
      adjacency: [],
      edgeKinds: [],
    });
    handler.handleMessage({
      type: 'build',
      requestId: 'req-a',
      request: { surfaceId: 's1', revision: 'rev-a', points: [], extraEntities: [], definition: { pointSource: { kind: 'points', pointEntityIds: [] } } },
    });
    handler.handleMessage({
      type: 'build',
      requestId: 'req-b',
      request: { surfaceId: 's1', revision: 'rev-b', points: [], extraEntities: [], definition: { pointSource: { kind: 'points', pointEntityIds: [] } } },
    });
    await flush();
    expect(resolvers).toHaveLength(2);
    // A completes late after B superseded it: discarded, no success posted.
    resolvers[0]!(meshFor('rev-a'));
    await flush();
    expect(posted.some((message) => message.type === 'success' && message.requestId === 'req-a')).toBe(false);
    resolvers[1]!(meshFor('rev-b'));
    await flush();
    expect(posted.some((message) => message.type === 'success' && message.requestId === 'req-b')).toBe(true);

    // Client-side: the stale A result can never mark the surface CURRENT.
    let history = createCadHistoryState(projectWithPoints());
    history = runCadCommand(history, {
      key: 'SURFACE_CREATE',
      name: 'Site',
      pointSource: { kind: 'points', pointEntityIds: ['pt-1', 'pt-2', 'pt-3', 'pt-4'] },
    });
    const cache = createCadSurfaceCache('scope-a');
    const project = history.present.project;
    const surface = project.surfaces![0]!;
    const revision = computeCadSurfaceSourceRevision(project, surface);
    const staleApplied = applySurfaceBuildSuccess(project, cache, surface.id, 'rev-a', meshFor('rev-a'));
    expect(staleApplied).toBe(project);
    expect(deriveSurfaceStatus(staleApplied, surface)).not.toBe('CURRENT');
    expect(revision.startsWith('srev1:')).toBe(true);
  });

  it('records worker failure as a diagnostic without CURRENT', async () => {
    const posted: SurfaceWorkerResponseMessage[] = [];
    const handler = createSurfaceWorkerHandler({
      loadBuilder: async () => () => {
        throw new Error('triangulation crashed');
      },
      postMessage: (message) => posted.push(message),
      defer: (callback) => callback(),
    });
    handler.handleMessage({
      type: 'build',
      requestId: 'req-fail',
      request: { surfaceId: 's1', revision: 'rev-1', points: [], extraEntities: [], definition: { pointSource: { kind: 'points', pointEntityIds: [] } } },
    });
    await flush();
    const failure = posted.find((message) => message.type === 'failure');
    expect(failure).toMatchObject({ requestId: 'req-fail', error: 'triangulation crashed' });

    let history = createCadHistoryState(projectWithPoints());
    history = runCadCommand(history, {
      key: 'SURFACE_CREATE',
      name: 'Site',
      pointSource: { kind: 'points', pointEntityIds: ['pt-1', 'pt-2', 'pt-3', 'pt-4'] },
    });
    const project = history.present.project;
    const surface = project.surfaces![0]!;
    const revision = computeCadSurfaceSourceRevision(project, surface);
    const failed = applySurfaceBuildFailure(project, surface.id, revision, 'triangulation crashed');
    expect(failed.surfaces![0]!.buildDiagnostic).toBe('triangulation crashed');
    expect(deriveSurfaceStatus(failed, failed.surfaces![0]!)).not.toBe('CURRENT');
  });

  it('derives FAILED for a blocked engine build (duplicate XY conflict)', () => {
    const conflict: CadProject = {
      ...projectWithPoints(),
      entities: [
        point('pt-1', 'A', 0, 0, 10),
        point('pt-2', 'B', 0, 0, 99),
        point('pt-3', 'C', 10, 0, 11),
        point('pt-4', 'D', 10, 10, 12),
      ],
    };
    let history = createCadHistoryState(conflict);
    history = runCadCommand(history, {
      key: 'SURFACE_CREATE',
      name: 'Site',
      pointSource: { kind: 'points', pointEntityIds: ['pt-1', 'pt-2', 'pt-3', 'pt-4'] },
    });
    const project = history.present.project;
    const surface = project.surfaces![0]!;
    const result = buildCadSurface(project, surface);
    expect(result.outcome).toBe('blocked');
    expect(result.reasonCodes).toContain('SURFACE_DUPLICATE_XY_CONFLICT');
    expect(deriveSurfaceStatus(project, surface)).toBe('FAILED');
  });

  it('keeps scoped caches independent across documents', () => {
    const first = createCadSurfaceCache('doc-a');
    const second = createCadSurfaceCache('doc-b');
    first.set('s1', 'rev-1', { revision: 'rev-1', points: [], triangles: [], stats: emptyStats(), grid: { minX: 0, minY: 0, cellSize: 1, cells: new Map() }, adjacency: [], edgeKinds: [] });
    expect(second.get('s1', 'rev-1')).toBeUndefined();
    first.invalidate('s1');
    expect(first.get('s1', 'rev-1')).toBeUndefined();
  });
});

describe('CAD surface multi-group transactions', () => {
  it('adds two groups additively, rejects dupes, and undoes/redoes a remove', () => {
    let history = createCadHistoryState(projectWithPoints());
    history = runCadCommand(history, {
      key: 'SURFACE_CREATE',
      name: 'Site',
      pointSource: { kind: 'points', pointEntityIds: ['pt-1', 'pt-2', 'pt-3'] },
    });
    const surfaceId = history.present.project.surfaces![0]!.id;
    history = runCadCommand(history, { key: 'SURFACE_ADD_POINT_GROUP', surfaceId, pointGroupId: 'point-group-all' });
    history = runCadCommand(history, { key: 'SURFACE_ADD_POINT_GROUP', surfaceId, pointGroupId: 'point-group-control' });
    expect(history.present.project.surfaces![0]!.definition.pointSource).toEqual({
      kind: 'point-group',
      pointGroupIds: ['point-group-all', 'point-group-control'],
    });
    // Duplicate add is rejected (history unchanged).
    expect(
      runCadCommand(history, { key: 'SURFACE_ADD_POINT_GROUP', surfaceId, pointGroupId: 'point-group-all' }),
    ).toBe(history);
    history = runCadCommand(history, { key: 'SURFACE_REMOVE_POINT_GROUP', surfaceId, pointGroupId: 'point-group-all' });
    expect(history.present.project.surfaces![0]!.definition.pointSource).toEqual({
      kind: 'point-group',
      pointGroupIds: ['point-group-control'],
    });
    history = undoCadHistory(history);
    expect(history.present.project.surfaces![0]!.definition.pointSource).toEqual({
      kind: 'point-group',
      pointGroupIds: ['point-group-all', 'point-group-control'],
    });
    history = redoCadHistory(history);
    expect(history.present.project.surfaces![0]!.definition.pointSource).toEqual({
      kind: 'point-group',
      pointGroupIds: ['point-group-control'],
    });
    // The union still builds (control matches nothing, all-group removed).
    const project = history.present.project;
    const result = buildCadSurface(project, project.surfaces![0]!);
    expect(result.outcome).toBe('insufficient');
    expect(result.reasonCodes).toContain('SURFACE_TOO_FEW_POINTS');
  });
});
