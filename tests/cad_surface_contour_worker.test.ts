import { describe, expect, it } from 'vitest';

import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import {
  computeCadSurfaceSourceRevision,
  deriveSurfaceStatus,
} from '../src/engine/cad/cadSurfaces';
import { buildSurfaceBuildRequest } from '../src/engine/cad/cadSurfaceTypes';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import type { CadProject, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';
import { createCadSurfaceContourCache } from '../src/engine/cad/surfaceContourCache';
import {
  computeContourGeometryRevision,
  SURFACE_CONTOUR_SEGMENT_LIMIT,
  toContourGeometrySpec,
} from '../src/engine/cad/surfaceContours/contourStyleRevision';
import type {
  CadSurfaceContourSet,
  ContourLevelSpec,
} from '../src/engine/cad/surfaceContours/contourTypes';
import {
  buildSurfaceMeshFromRequest,
  createSurfaceWorkerHandler,
  type SurfaceContourRequest,
  type SurfaceWorkerResponseMessage,
} from '../src/workers/surfaceWorkerHandler';
import {
  SURFACE_CONTOUR_MALFORMED,
  SurfaceWorkerClient,
  type SurfaceWorkerPort,
} from '../src/workers/surfaceWorkerClient';
import {
  SurfaceContourService,
  type SurfaceContourTransport,
} from '../src/workers/surfaceContourService';

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

const SPEC_A: ContourLevelSpec = { minorInterval: 1, majorEvery: 5, baseElevation: 0 };
const SPEC_B: ContourLevelSpec = { minorInterval: 5, majorEvery: 5, baseElevation: 0 };

const projectWithSurface = (): { project: CadProject; surfaceId: string; revision: string } => {
  const drawing = createBlankCadDrawingDocument({ name: 'Contours', units: 'm' });
  const project: CadProject = {
    ...drawing.project,
    entities: [
      point('pt-1', 'A', 0, 0, 10),
      point('pt-2', 'B', 10, 0, 11),
      point('pt-3', 'C', 10, 10, 12),
      point('pt-4', 'D', 0, 10, 13),
    ],
    surfaces: [
      {
        id: 's1',
        name: 'Site',
        definition: { pointSource: { kind: 'points', pointEntityIds: ['pt-1', 'pt-2', 'pt-3', 'pt-4'] } },
        cachedRevision: null,
      },
    ],
  };
  const surface = project.surfaces![0]!;
  return { project, surfaceId: surface.id, revision: computeCadSurfaceSourceRevision(project, surface) };
};

const fakeSet = (surfaceId: string, revision: string, geometryRevision: string): CadSurfaceContourSet => ({
  surfaceId,
  surfaceRevision: revision,
  styleRevision: geometryRevision,
  minorPaths: [],
  majorPaths: [],
  minLevel: null,
  maxLevel: null,
  stats: {
    levelCount: 0,
    minorLevelCount: 0,
    majorLevelCount: 0,
    minorPathCount: 0,
    majorPathCount: 0,
    totalLength: 0,
    segmentCount: 0,
  },
});

const contourRequest = (
  surfaceId: string,
  revision: string,
  geometryRevision: string,
  spec: ContourLevelSpec = SPEC_A,
): SurfaceContourRequest => ({
  surfaceId,
  surfaceRevision: revision,
  contourGeometryRevision: geometryRevision,
  mesh: {
    points: [
      { x: 0, y: 0, z: 10 },
      { x: 10, y: 0, z: 11 },
      { x: 10, y: 10, z: 12 },
      { x: 0, y: 10, z: 13 },
    ],
    triangles: [[0, 1, 2], [0, 2, 3]],
  },
  spec,
});

const flush = async (rounds = 5): Promise<void> => {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
};

describe('contour geometry revision', () => {
  it('is stable for appearance-only changes, sensitive to interval/major/base', () => {
    const base = computeContourGeometryRevision(toContourGeometrySpec(SPEC_A));
    // Appearance-only (color/weight/opacity/labels/showContours) never enters the spec.
    expect(computeContourGeometryRevision(toContourGeometrySpec({ ...SPEC_A }))).toBe(base);
    expect(
      computeContourGeometryRevision(
        toContourGeometrySpec({ ...SPEC_A, minorInterval: 2 }),
      ),
    ).not.toBe(base);
    expect(
      computeContourGeometryRevision(toContourGeometrySpec({ ...SPEC_A, majorEvery: 4 })),
    ).not.toBe(base);
    expect(
      computeContourGeometryRevision(toContourGeometrySpec({ ...SPEC_A, baseElevation: 100 })),
    ).not.toBe(base);
    expect(base.startsWith('crev1:')).toBe(true);
  });
});

describe('contour worker handler', () => {
  it('supersedes A when B arrives: late A is discarded, B wins', async () => {
    const { revision } = projectWithSurface();
    const revA = computeContourGeometryRevision(toContourGeometrySpec(SPEC_A));
    const revB = computeContourGeometryRevision(toContourGeometrySpec(SPEC_B));
    const posted: SurfaceWorkerResponseMessage[] = [];
    let resolveA!: (_set: CadSurfaceContourSet) => void;
    let resolveB!: (_set: CadSurfaceContourSet) => void;
    const gateA = new Promise<CadSurfaceContourSet>((resolve) => { resolveA = resolve; });
    const gateB = new Promise<CadSurfaceContourSet>((resolve) => { resolveB = resolve; });
    let calls = 0;
    const handler = createSurfaceWorkerHandler({
      loadBuilder: () => Promise.reject(new Error('unused')),
      loadContourExtractor: () => Promise.resolve(() => {
        calls += 1;
        return calls === 1 ? gateA : gateB;
      }),
      postMessage: (message) => { posted.push(message); },
      defer: (callback) => callback(),
    });
    handler.handleMessage({ type: 'contours', requestId: 'c1', request: contourRequest('s1', revision, revA) });
    handler.handleMessage({ type: 'contours', requestId: 'c2', request: contourRequest('s1', revision, revB, SPEC_B) });
    await flush();
    resolveA(fakeSet('s1', revision, revA));
    await flush();
    expect(posted.filter((m) => m.type === 'contour-success')).toHaveLength(0);
    resolveB(fakeSet('s1', revision, revB));
    await flush();
    const wins = posted.filter((m) => m.type === 'contour-success');
    expect(wins).toHaveLength(1);
    expect((wins[0] as { geometryRevision: string }).geometryRevision).toBe(revB);
  });

  it('blocks over-limit levels with a stable diagnostic (no silent bump)', async () => {
    const { revision } = projectWithSurface();
    const posted: SurfaceWorkerResponseMessage[] = [];
    const handler = createSurfaceWorkerHandler({
      loadBuilder: () => Promise.reject(new Error('unused')),
      loadContourExtractor: () => Promise.reject(new Error('must not extract')),
      postMessage: (message) => { posted.push(message); },
      defer: (callback) => callback(),
    });
    handler.handleMessage({
      type: 'contours',
      requestId: 'c1',
      request: contourRequest('s1', revision, 'crev1:x', {
        minorInterval: 0.0001, majorEvery: 5, baseElevation: 0,
      }),
    });
    await flush();
    expect(posted).toHaveLength(1);
    expect(posted[0]!.type).toBe('contour-failure');
    expect((posted[0] as { error: string }).error).toContain('SURFACE_CONTOUR_LEVEL_LIMIT');
  });

  it('blocks over-limit segments with a stable diagnostic (no silent truncation)', async () => {
    const { revision } = projectWithSurface();
    const posted: SurfaceWorkerResponseMessage[] = [];
    const handler = createSurfaceWorkerHandler({
      loadBuilder: () => Promise.reject(new Error('unused')),
      loadContourExtractor: () => Promise.resolve((args) => ({
        ...fakeSet(args.surfaceId, args.surfaceRevision, args.styleRevision),
        stats: { ...fakeSet(args.surfaceId, args.surfaceRevision, args.styleRevision).stats, segmentCount: SURFACE_CONTOUR_SEGMENT_LIMIT + 1 },
      })),
      postMessage: (message) => { posted.push(message); },
      defer: (callback) => callback(),
    });
    handler.handleMessage({ type: 'contours', requestId: 'c1', request: contourRequest('s1', revision, 'crev1:x') });
    await flush(10);
    expect(posted).toHaveLength(1);
    expect(posted[0]!.type).toBe('contour-failure');
    expect((posted[0] as { error: string }).error).toContain('SURFACE_CONTOUR_SEGMENT_LIMIT');
  });
});

describe('contour client', () => {
  const createLoopback = (): { client: SurfaceWorkerClient; emit: (_data: unknown) => void } => {
    const listeners = new Map<string, Set<(_event: unknown) => void>>();
    const port: SurfaceWorkerPort = {
      postMessage: (): void => undefined,
      terminate: (): void => undefined,
      addEventListener: (type, listener): void => {
        const set = listeners.get(type) ?? new Set();
        set.add(listener);
        listeners.set(type, set);
      },
      removeEventListener: (type, listener): void => {
        listeners.get(type)?.delete(listener);
      },
    };
    const client = new SurfaceWorkerClient(port);
    return {
      client,
      emit: (data) => {
        for (const listener of listeners.get('message') ?? []) listener({ data });
      },
    };
  };

  it('cancel settles null; malformed contour-success rejects', async () => {
    const { revision } = projectWithSurface();
    const revA = computeContourGeometryRevision(toContourGeometrySpec(SPEC_A));
    const { client, emit } = createLoopback();
    const pending = client.deriveContours(contourRequest('s1', revision, revA));
    pending.cancel();
    await expect(pending.done).resolves.toBeNull();

    const pending2 = client.deriveContours(contourRequest('s1', revision, revA));
    const failed = pending2.done;
    emit({ type: 'contour-success', requestId: pending2.requestId, surfaceId: 's1', revision, geometryRevision: revA, result: { bogus: true } });
    await expect(failed).rejects.toThrow(SURFACE_CONTOUR_MALFORMED);
    client.dispose();
  });
});

/** Manually-driven contour transport stub (deterministic completion order). */
class StubContourTransport implements SurfaceContourTransport {
  alive = true;
  readonly derivations: Array<{
    requestId: string;
    request: SurfaceContourRequest;
    resolve: (_set: CadSurfaceContourSet | null) => void;
    reject: (_error: Error) => void;
  }> = [];
  readonly cancelled: string[] = [];
  private nextId = 0;

  deriveContours(request: SurfaceContourRequest): ReturnType<SurfaceContourTransport['deriveContours']> {
    this.nextId += 1;
    const requestId = `creq-${this.nextId}`;
    let resolve!: (_set: CadSurfaceContourSet | null) => void;
    let reject!: (_error: Error) => void;
    const done = new Promise<CadSurfaceContourSet | null>((res, rej) => { resolve = res; reject = rej; });
    // Attach a noop catch guard so un-awaited rejections never crash the suite.
    done.catch(() => undefined);
    this.derivations.push({ requestId, request, resolve, reject });
    return { requestId, done, cancel: () => this.cancel(requestId) };
  }

  cancel(requestId: string): void {
    this.cancelled.push(requestId);
  }

  dispose(): void {
    this.alive = false;
  }
}

const serviceHarness = (): {
  service: SurfaceContourService;
  transport: StubContourTransport;
  project: () => CadProject;
  setProject: (_project: CadProject) => void;
  drawingId: () => string;
  setDrawingId: (_id: string) => void;
  revision: string;
  tinCache: ReturnType<typeof createCadSurfaceCache>;
  contourCache: ReturnType<typeof createCadSurfaceContourCache>;
} => {
  const fixture = projectWithSurface();
  let project = fixture.project;
  let drawingId = 'drawing-1';
  const tinCache = createCadSurfaceCache('scope-1');
  const contourCache = createCadSurfaceContourCache('scope-1');
  // Seed a CURRENT TIN: real snapshot → real engine triangulation.
  const request = buildSurfaceBuildRequest(project, fixture.surfaceId, fixture.revision)!;
  const mesh = buildSurfaceMeshFromRequest(request);
  tinCache.set(fixture.surfaceId, fixture.revision, {
    revision: fixture.revision,
    points: mesh.points,
    triangles: mesh.triangles,
    stats: mesh.stats,
    grid: mesh.grid,
    adjacency: mesh.adjacency,
    edgeKinds: mesh.edgeKinds,
  });
  project = {
    ...project,
    surfaces: project.surfaces!.map((entry) => ({ ...entry, cachedRevision: fixture.revision })),
  };
  const transport = new StubContourTransport();
  const service = new SurfaceContourService({
    drawingId: 'drawing-1',
    getProject: () => project,
    getDrawingId: () => drawingId,
    tinCache,
    contourCache,
    createTransport: () => transport,
    shouldAutoDerive: () => false,
    notify: () => undefined,
    onStateChange: () => undefined,
  });
  return {
    service,
    transport,
    project: () => project,
    setProject: (next) => { project = next; },
    drawingId: () => drawingId,
    setDrawingId: (id) => { drawingId = id; },
    revision: fixture.revision,
    tinCache,
    contourCache,
  };
};

describe('contour service ownership', () => {
  it('style change while building: late A is discarded, B wins, no leaked BUILDING', async () => {
    const h = serviceHarness();
    const revA = computeContourGeometryRevision(toContourGeometrySpec(SPEC_A));
    const revB = computeContourGeometryRevision(toContourGeometrySpec(SPEC_B));
    h.service.requestContours('s1', SPEC_A);
    expect(h.service.buildingContourIds().has('s1')).toBe(true);
    h.service.requestContours('s1', SPEC_B);
    expect(h.transport.derivations).toHaveLength(2);
    // Late A arrives after supersession: discarded, never cached.
    h.transport.derivations[0]!.resolve(fakeSet('s1', h.revision, revA));
    await flush(10);
    expect(h.contourCache.get('s1', h.revision, revA)).toBeUndefined();
    expect(h.service.buildingContourIds().has('s1')).toBe(true);
    h.transport.derivations[1]!.resolve(fakeSet('s1', h.revision, revB));
    await flush(10);
    expect(h.contourCache.get('s1', h.revision, revB)).toBeDefined();
    expect(h.service.buildingContourIds().size).toBe(0);
    expect(h.service.statusOf('s1', revB)).toEqual({ status: 'CURRENT', stale: false });
  });

  it('rejects cross-drawing late results', async () => {
    const h = serviceHarness();
    const revA = computeContourGeometryRevision(toContourGeometrySpec(SPEC_A));
    h.service.requestContours('s1', SPEC_A);
    h.setDrawingId('drawing-2');
    h.transport.derivations[0]!.resolve(fakeSet('s1', h.revision, revA));
    await flush(10);
    expect(h.contourCache.get('s1', h.revision, revA)).toBeUndefined();
    expect(h.service.buildingContourIds().size).toBe(0);
  });

  it('gates stale meshes: TIN not CURRENT blocks with SURFACE_CONTOUR_STALE_TIN', () => {
    const h = serviceHarness();
    h.setProject({
      ...h.project(),
      surfaces: h.project().surfaces!.map((entry) => ({ ...entry, cachedRevision: null })),
    });
    const message = h.service.requestContours('s1', SPEC_A);
    expect(message).toContain('not CURRENT');
    expect(h.transport.derivations).toHaveLength(0);
    const diagnostic = h.service.contourDiagnostics().get('s1')?.error ?? '';
    expect(diagnostic).toContain('SURFACE_CONTOUR_STALE_TIN');
  });

  it('failure leaves the TIN CURRENT (TIN inquiries keep working)', async () => {
    const h = serviceHarness();
    const revA = computeContourGeometryRevision(toContourGeometrySpec(SPEC_A));
    h.service.requestContours('s1', SPEC_A);
    h.transport.derivations[0]!.reject(new Error('boom'));
    await flush(10);
    expect(h.service.statusOf('s1', revA).status).toBe('FAILED');
    // TIN untouched: cache hit + derived CURRENT.
    expect(h.tinCache.get('s1', h.revision)).toBeDefined();
    const surface = h.project().surfaces![0]!;
    expect(deriveSurfaceStatus(h.project(), surface)).toBe('CURRENT');
    expect(h.service.buildingContourIds().size).toBe(0);
  });

  it('bounds the cache to current + ≤1 stale set', async () => {
    const h = serviceHarness();
    const specs: ContourLevelSpec[] = [
      { minorInterval: 1, majorEvery: 5, baseElevation: 0 },
      { minorInterval: 2, majorEvery: 5, baseElevation: 0 },
      { minorInterval: 4, majorEvery: 5, baseElevation: 0 },
    ];
    for (const spec of specs) {
      h.service.requestContours('s1', spec);
      const pending = h.transport.derivations[h.transport.derivations.length - 1]!;
      pending.resolve(fakeSet('s1', h.revision, computeContourGeometryRevision(toContourGeometrySpec(spec))));
      await flush(10);
    }
    expect(h.contourCache.retained('s1').length).toBeLessThanOrEqual(2);
  });
});
