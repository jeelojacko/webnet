import { describe, expect, it } from 'vitest';

import { createCadSurfaceCache, type CadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { computeCadSurfaceSourceRevision, type CadSurfaceBuildStats } from '../src/engine/cad/cadSurfaces';
import { buildSurfaceBuildRequest, type SurfaceBuildRequest } from '../src/engine/cad/cadSurfaceTypes';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import type { CadProject, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';
import {
  buildSurfaceMeshFromRequest,
  type SurfaceWorkerMesh,
} from '../src/workers/surfaceWorkerHandler';
import type { PendingSurfaceBuild, SurfaceBuildTransport } from '../src/workers/surfaceWorkerClient';
import {
  SurfaceBuildService,
  SYNC_FALLBACK_POINT_LIMIT,
  type SurfaceBuildServiceDeps,
} from '../src/workers/surfaceBuildService';

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

const quadEntities = (): CadSurveyPointEntity[] => [
  point('pt-1', 'A', 0, 0, 10),
  point('pt-2', 'B', 10, 0, 11),
  point('pt-3', 'C', 10, 10, 12),
  point('pt-4', 'D', 0, 10, 13),
];

const emptyExtras = () => ({
  grid: { minX: 0, minY: 0, cellSize: 1, cells: new Map() },
  adjacency: [],
  edgeKinds: [],
});

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
});

const projectWithSurfaces = (ids: string[]): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Service', units: 'm' });
  return {
    ...drawing.project,
    entities: quadEntities(),
    surfaces: ids.map((id, index) => ({
      id,
      name: `Surface ${index + 1}`,
      definition: { pointSource: { kind: 'points', pointEntityIds: ['pt-1', 'pt-2', 'pt-3', 'pt-4'] } },
      cachedRevision: null,
    })),
  };
};

/** Manually-driven transport stub (deterministic completion order). */
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

interface Harness {
  service: SurfaceBuildService;
  stub: StubTransport;
  cache: CadSurfaceCache;
  notices: string[];
  revisions: Map<string, string[]>;
  project: () => CadProject;
  setProject: (_project: CadProject) => void;
  drawingId: () => string;
  setDrawingId: (_id: string) => void;
  meshFor: (_surfaceId: string) => SurfaceWorkerMesh;
  flush: () => Promise<void>;
}

const createHarness = (opts?: {
  surfaceIds?: string[];
  createTransport?: SurfaceBuildServiceDeps['createTransport'];
}): Harness => {
  let project = projectWithSurfaces(opts?.surfaceIds ?? ['s1']);
  let drawingId = 'drawing-a';
  const stub = new StubTransport();
  const cache = createCadSurfaceCache('test');
  const notices: string[] = [];
  const revisions = new Map<string, string[]>();
  const service = new SurfaceBuildService({
    drawingId: 'drawing-a',
    getProject: () => project,
    getDrawingId: () => drawingId,
    cache,
    createTransport: opts?.createTransport ?? (() => stub),
    getBuiltRevisions: (surfaceId) => revisions.get(surfaceId) ?? [],
    recordRevision: (surfaceId, revision) => {
      revisions.set(surfaceId, [...(revisions.get(surfaceId) ?? []), revision].slice(-2));
    },
    notify: (message) => notices.push(message),
    onStateChange: () => undefined,
  });
  return {
    service,
    stub,
    cache,
    notices,
    revisions,
    project: () => project,
    setProject: (next) => {
      project = next;
    },
    drawingId: () => drawingId,
    setDrawingId: (next) => {
      drawingId = next;
    },
    meshFor: (surfaceId) => {
      const surface = project.surfaces!.find((entry) => entry.id === surfaceId)!;
      const revision = computeCadSurfaceSourceRevision(project, surface);
      return buildSurfaceMeshFromRequest(buildSurfaceBuildRequest(project, surfaceId, revision)!);
    },
    flush: async () => {
      for (let i = 0; i < 10; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    },
  };
};

describe('SurfaceBuildService', () => {
  it('short-circuits already-current surfaces without touching the worker', () => {
    const h = createHarness();
    const surface = h.project().surfaces![0]!;
    const revision = computeCadSurfaceSourceRevision(h.project(), surface);
    h.cache.set('s1', revision, {
      revision,
      points: [],
      triangles: [],
      stats: emptyStats(),
      ...emptyExtras(),
    });
    expect(h.service.rebuildSurface('s1')).toBe('“Surface 1” is already current.');
    expect(h.stub.builds).toHaveLength(0);
  });

  it('reports missing surfaces without touching the worker', () => {
    const h = createHarness();
    expect(h.service.rebuildSurface('nope')).toBe('Surface not found.');
    expect(h.stub.builds).toHaveLength(0);
  });

  it('builds through the worker and reports the human-readable result', async () => {
    const h = createHarness();
    expect(h.service.rebuildSurface('s1')).toBe('“Surface 1” building…');
    expect(h.service.buildingSurfaceIds().has('s1')).toBe(true);
    expect(h.stub.builds).toHaveLength(1);
    expect(h.stub.builds[0]!.request.drawingId).toBe('drawing-a');
    h.stub.builds[0]!.resolve(h.meshFor('s1'));
    await h.flush();
    expect(h.service.buildingSurfaceIds().has('s1')).toBe(false);
    expect(h.notices).toEqual(['“Surface 1” rebuilt: 2 triangles from 4 points.']);
    const surface = h.project().surfaces![0]!;
    const revision = computeCadSurfaceSourceRevision(h.project(), surface);
    expect(h.cache.get('s1', revision)?.stats.triangleCount).toBe(2);
  });

  it('supersedes: A requested, B requested, A finishes last → B stays CURRENT', async () => {
    const h = createHarness();
    h.service.rebuildSurface('s1');
    const buildA = h.stub.builds[0]!;
    // Source edit revs the definition; the second request supersedes the first.
    const extra = point('pt-5', 'E', 5, 5, 13);
    h.setProject({
      ...h.project(),
      entities: [...h.project().entities, extra],
      surfaces: [{
        ...h.project().surfaces![0]!,
        definition: {
          pointSource: { kind: 'points', pointEntityIds: ['pt-1', 'pt-2', 'pt-3', 'pt-4', 'pt-5'] },
        },
      }],
    });
    h.service.rebuildSurface('s1');
    // The stub drops the cancelled A entry, so B is the surviving build.
    const buildB = h.stub.builds[h.stub.builds.length - 1]!;
    expect(buildB.request.revision).not.toBe(buildA.request.revision);
    buildB.resolve(h.meshFor('s1'));
    await h.flush();
    // A finishes late: discarded, B stays CURRENT.
    buildA.resolve({
      outcome: 'ok',
      revision: buildA.request.revision,
      reasonCodes: [],
      points: [],
      triangles: [[0, 1, 2] as [number, number, number]],
      ...emptyExtras(),
      stats: { ...emptyStats(), triangleCount: 999, usedPointCount: 999 },
    });
    await h.flush();
    const surface = h.project().surfaces![0]!;
    const current = computeCadSurfaceSourceRevision(h.project(), surface);
    expect(h.cache.get('s1', current)?.stats.triangleCount).not.toBe(999);
    expect(h.notices).toEqual([`“Surface 1” rebuilt: ${h.cache.get('s1', current)!.stats.triangleCount} triangles from 5 points.`]);
  });

  it('never populates another drawing (cross-drawing isolation)', async () => {
    const h = createHarness();
    h.service.rebuildSurface('s1');
    h.setDrawingId('drawing-b');
    h.stub.builds[0]!.resolve(h.meshFor('s1'));
    await h.flush();
    const surface = h.project().surfaces![0]!;
    expect(h.cache.get('s1', computeCadSurfaceSourceRevision(h.project(), surface))).toBeUndefined();
    expect(h.notices).toEqual([]);
  });

  it('drops completions for surfaces deleted mid-build (no resurrection)', async () => {
    const h = createHarness();
    h.service.rebuildSurface('s1');
    const mesh = h.meshFor('s1');
    h.setProject({ ...h.project(), surfaces: [] });
    h.stub.builds[0]!.resolve(mesh);
    await h.flush();
    expect(h.notices).toEqual([]);
    expect(h.service.buildingSurfaceIds().size).toBe(0);
  });

  it('reports worker failure as FAILED with retry, keeping the old stale mesh', async () => {
    const h = createHarness();
    // Seed a stale mesh from an older revision.
    const surface = h.project().surfaces![0]!;
    const oldRevision = computeCadSurfaceSourceRevision(h.project(), surface);
    const oldMesh = h.meshFor('s1');
    h.cache.set('s1', oldRevision, {
      revision: oldRevision,
      points: oldMesh.points,
      triangles: oldMesh.triangles,
      stats: oldMesh.stats,
      grid: oldMesh.grid,
      adjacency: oldMesh.adjacency,
      edgeKinds: oldMesh.edgeKinds,
    });
    h.revisions.set('s1', [oldRevision]);
    // Rev the definition so the build targets a new revision.
    const extra = point('pt-5', 'E', 5, 5, 13);
    h.setProject({
      ...h.project(),
      entities: [...h.project().entities, extra],
      surfaces: [{
        ...surface,
        definition: {
          pointSource: { kind: 'points', pointEntityIds: ['pt-1', 'pt-2', 'pt-3', 'pt-4', 'pt-5'] },
        },
      }],
    });
    h.service.rebuildSurface('s1');
    h.stub.builds[0]!.reject(new Error('triangulation crashed'));
    await h.flush();
    expect(h.notices).toEqual(['“Surface 1” rebuild failed: triangulation crashed.']);
    const diagnostics = h.service.sessionDiagnostics();
    expect(diagnostics.get('s1')?.error).toBe('triangulation crashed');
    // Old stale mesh untouched.
    expect(h.cache.get('s1', oldRevision)?.stats.triangleCount).toBe(2);
    // Retry succeeds and clears the diagnostic.
    h.service.rebuildSurface('s1');
    expect(h.service.sessionDiagnostics().has('s1')).toBe(false);
    h.stub.builds[1]!.resolve(h.meshFor('s1'));
    await h.flush();
    expect(h.notices[1]).toContain('rebuilt:');
    expect(h.service.sessionDiagnostics().has('s1')).toBe(false);
  });

  it('fails closed on engine non-ok outcomes without caching', async () => {
    const h = createHarness();
    h.service.rebuildSurface('s1');
    const revision = h.stub.builds[0]!.request.revision;
    h.stub.builds[0]!.resolve({
      outcome: 'insufficient',
      revision,
      reasonCodes: ['SURFACE_TOO_FEW_POINTS'],
      points: [],
      triangles: [],
      stats: emptyStats(),
      ...emptyExtras(),
    });
    await h.flush();
    expect(h.notices).toEqual(['“Surface 1” has insufficient data: SURFACE_TOO_FEW_POINTS']);
    expect(h.cache.get('s1', revision)).toBeUndefined();
  });

  it('discards results whose revision no longer matches', async () => {
    const h = createHarness();
    h.service.rebuildSurface('s1');
    const stale = h.stub.builds[0]!;
    h.stub.builds[0]!.resolve({ ...h.meshFor('s1'), revision: 'srev1:stale' });
    await h.flush();
    expect(h.notices).toEqual([]);
    expect(h.cache.get('s1', stale.request.revision)).toBeUndefined();
  });

  it('settles pending builds on dispose with no BUILDING-forever', async () => {
    const h = createHarness();
    h.service.rebuildSurface('s1');
    expect(h.service.buildingSurfaceIds().size).toBe(1);
    h.service.dispose();
    expect(h.service.buildingSurfaceIds().size).toBe(0);
    await h.flush();
    expect(h.notices).toEqual([]);
  });

  it('rebuilds all serially with the preserved summary and isolated failures', async () => {
    const h = createHarness({ surfaceIds: ['s1', 's2', 's3'] });
    // s3 already current.
    const s3 = h.project().surfaces![2]!;
    const s3Revision = computeCadSurfaceSourceRevision(h.project(), s3);
    h.cache.set('s3', s3Revision, {
      revision: s3Revision,
      points: [],
      triangles: [],
      stats: emptyStats(),
      ...emptyExtras(),
    });
    expect(h.service.rebuildAllSurfaces()).toBe('Rebuilding 2 surfaces…');
    expect(h.stub.builds).toHaveLength(1);
    // First fails; the queue must still advance to the second.
    h.stub.builds[0]!.reject(new Error('boom'));
    await h.flush();
    expect(h.stub.builds).toHaveLength(2);
    h.stub.builds[1]!.resolve(h.meshFor('s2'));
    await h.flush();
    expect(h.notices).toEqual(['Rebuilt 1, already current 1, 1 not built.']);
    // Failed surface cached nothing; rebuilt surface did.
    const s1 = h.project().surfaces![0]!;
    expect(h.cache.get('s1', computeCadSurfaceSourceRevision(h.project(), s1))).toBeUndefined();
    const s2 = h.project().surfaces![1]!;
    expect(h.cache.get('s2', computeCadSurfaceSourceRevision(h.project(), s2))).toBeDefined();
  });

  it('reports no surfaces and all-current summaries immediately', () => {
    const empty = createHarness({ surfaceIds: [] });
    expect(empty.service.rebuildAllSurfaces()).toBe('No surfaces to rebuild.');
    const h = createHarness({ surfaceIds: ['s1'] });
    const surface = h.project().surfaces![0]!;
    const revision = computeCadSurfaceSourceRevision(h.project(), surface);
    h.cache.set('s1', revision, { revision, points: [], triangles: [], stats: emptyStats(), ...emptyExtras() });
    expect(h.service.rebuildAllSurfaces()).toBe('Rebuilt 0, already current 1, 0 not built.');
  });

  it('falls back to a disclosed sync build for small surfaces when the worker is missing', async () => {
    const h = createHarness({ createTransport: () => null });
    const message = h.service.rebuildSurface('s1');
    expect(message).toContain('rebuilt: 2 triangles from 4 points.');
    expect(message).toContain('sync fallback');
    const surface = h.project().surfaces![0]!;
    expect(h.cache.get('s1', computeCadSurfaceSourceRevision(h.project(), surface))).toBeDefined();
  });

  it('blocks large surfaces when the worker is missing instead of triangulating on the main thread', () => {
    const entities: CadSurveyPointEntity[] = [];
    for (let i = 0; i < SYNC_FALLBACK_POINT_LIMIT + 1; i += 1) {
      entities.push(point(`big-${i}`, `S${i}`, i % 100, Math.floor(i / 100), 100 + i * 0.01));
    }
    const drawing = createBlankCadDrawingDocument({ name: 'Big', units: 'm' });
    const big: CadProject = {
      ...drawing.project,
      entities,
      surfaces: [{
        id: 'big',
        name: 'Big Surface',
        definition: { pointSource: { kind: 'points', pointEntityIds: entities.map((entry) => entry.id) } },
        cachedRevision: null,
      }],
    };
    let current = big;
    const cache = createCadSurfaceCache('big');
    const notices: string[] = [];
    const service = new SurfaceBuildService({
      drawingId: 'drawing-big',
      getProject: () => current,
      getDrawingId: () => 'drawing-big',
      cache,
      createTransport: () => {
        throw new Error('no worker');
      },
      getBuiltRevisions: () => [],
      recordRevision: () => undefined,
      notify: (text) => notices.push(text),
      onStateChange: () => undefined,
    });
    const message = service.rebuildSurface('big');
    expect(message).toContain('worker unavailable');
    expect(message).toContain(`${SYNC_FALLBACK_POINT_LIMIT}-point`);
    expect(service.sessionDiagnostics().get('big')).toBeDefined();
    expect(cache.get('big', computeCadSurfaceSourceRevision(current, current.surfaces![0]!))).toBeUndefined();
  });

  it('retries worker construction after death so the next rebuild recovers', async () => {
    let attempts = 0;
    const transports: StubTransport[] = [];
    const h = createHarness({
      createTransport: () => {
        attempts += 1;
        const transport = new StubTransport();
        transports.push(transport);
        return transport;
      },
    });
    h.service.rebuildSurface('s1');
    // Worker dies mid-build: failure recorded, transport dropped.
    transports[0]!.alive = false;
    transports[0]!.builds[0]!.reject(new Error('worker gone'));
    await h.flush();
    expect(h.notices).toEqual(['“Surface 1” rebuild failed: worker gone.']);
    // Retry constructs a fresh worker and succeeds.
    h.service.rebuildSurface('s1');
    expect(attempts).toBe(2);
    transports[1]!.builds[0]!.resolve(h.meshFor('s1'));
    await h.flush();
    expect(h.notices[1]).toContain('rebuilt:');
  });

  it('bounds the cache to current + one previous stale revision', async () => {
    const h = createHarness();
    for (const extra of [['pt-5', 5, 5], ['pt-6', 6, 6], ['pt-7', 7, 7]] as const) {
      const [id, x, y] = extra;
      const surface = h.project().surfaces![0]!;
      const nextEntities = [...h.project().entities, point(id, id, x, y, 12)];
      const ids = [...(surface.definition.pointSource as { pointEntityIds: string[] }).pointEntityIds, id];
      h.setProject({
        ...h.project(),
        entities: nextEntities,
        surfaces: [{ ...surface, definition: { pointSource: { kind: 'points', pointEntityIds: ids } } }],
      });
      h.service.rebuildSurface('s1');
      h.stub.builds[h.stub.builds.length - 1]!.resolve(h.meshFor('s1'));
      await h.flush();
    }
    // Three builds; only the last two revisions survive in cache + index.
    expect(h.revisions.get('s1')).toHaveLength(2);
    const surface = h.project().surfaces![0]!;
    const current = computeCadSurfaceSourceRevision(h.project(), surface);
    expect(h.cache.get('s1', current)).toBeDefined();
    expect(h.cache.get('s1', h.revisions.get('s1')![0]!)).toBeDefined();
  });
});

describe('SurfaceBuildService sync-fallback route tracking', () => {
  it('marks fallback-built revisions, clears the marker on a worker rebuild, expires on edit, clears on dispose', async () => {
    let transport: StubTransport | null = null;
    const h = createHarness({ createTransport: () => transport });
    h.service.rebuildSurface('s1');
    const surface = h.project().surfaces![0]!;
    const revision = computeCadSurfaceSourceRevision(h.project(), surface);
    expect(h.service.syncFallbackRevisions().get('s1')).toBe(revision);
    // Worker recovers: source edit + worker rebuild clears the marker.
    transport = h.stub;
    const extra = point('pt-5', 'E', 5, 5, 13);
    h.setProject({
      ...h.project(),
      entities: [...h.project().entities, extra],
      surfaces: [{
        ...h.project().surfaces![0]!,
        definition: {
          pointSource: { kind: 'points', pointEntityIds: ['pt-1', 'pt-2', 'pt-3', 'pt-4', 'pt-5'] },
        },
      }],
    });
    h.service.rebuildSurface('s1');
    const build = h.stub.builds[h.stub.builds.length - 1]!;
    build.resolve(h.meshFor('s1'));
    await h.flush();
    expect(h.service.syncFallbackRevisions().has('s1')).toBe(false);
    const next = h.project().surfaces![0]!;
    expect(computeCadSurfaceSourceRevision(h.project(), next)).not.toBe(revision);
    h.service.dispose();
    expect(h.service.syncFallbackRevisions().size).toBe(0);
  });
});
