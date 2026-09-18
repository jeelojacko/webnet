import { describe, expect, it } from 'vitest';

import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { buildCadSurface, computeCadSurfaceSourceRevision } from '../src/engine/cad/cadSurfaces';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { createCadSurfaceVolumeCache } from '../src/engine/cad/surfaceVolumeCache';
import { computeVolumeSurfaceRevision } from '../src/engine/cad/cadVolumeSurfaces';
import type { CadProject, CadSurveyPointEntity, CadVolumeResult } from '../src/engine/cad/cadTypes';
import type { SurfaceVolumeRequest, SurfaceWorkerResponseMessage } from '../src/workers/surfaceWorkerHandler';
import { createSurfaceWorkerHandler } from '../src/workers/surfaceWorkerHandler';
import type { PendingSurfaceVolume } from '../src/workers/surfaceWorkerClient';
import {
  SurfaceVolumeService,
  type SurfaceVolumeTransport,
} from '../src/workers/surfaceVolumeService';

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

const baseProject = (): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Volumes', units: 'm' });
  return {
    ...drawing.project,
    entities: [
      point('b1', 'B1', 0, 0, 0),
      point('b2', 'B2', 10, 0, 0),
      point('b3', 'B3', 10, 10, 0),
      point('b4', 'B4', 0, 10, 0),
      point('c1', 'C1', 0, 0, 2),
      point('c2', 'C2', 10, 0, 2),
      point('c3', 'C3', 10, 10, 2),
      point('c4', 'C4', 0, 10, 2),
    ],
    surfaces: [
      { id: 'base-1', name: 'Base', definition: { pointSource: { kind: 'points', pointEntityIds: ['b1', 'b2', 'b3', 'b4'] } }, cachedRevision: null },
      { id: 'cmp-1', name: 'Comparison', definition: { pointSource: { kind: 'points', pointEntityIds: ['c1', 'c2', 'c3', 'c4'] } }, cachedRevision: null },
    ],
    volumeSurfaces: [
      { id: 'vol-1', name: 'Earthwork', baseSurfaceId: 'base-1', comparisonSurfaceId: 'cmp-1' },
    ],
  };
};

const flush = async (rounds = 10): Promise<void> => {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
};

class StubVolumeTransport implements SurfaceVolumeTransport {
  alive = true;
  readonly derivations: Array<{
    requestId: string;
    request: SurfaceVolumeRequest;
    resolve: (_result: CadVolumeResult | null) => void;
    reject: (_error: Error) => void;
  }> = [];
  readonly cancelled: string[] = [];
  private nextId = 0;

  deriveVolume(request: SurfaceVolumeRequest): PendingSurfaceVolume {
    this.nextId += 1;
    const requestId = `vreq-${this.nextId}`;
    let resolve!: (_result: CadVolumeResult | null) => void;
    let reject!: (_error: Error) => void;
    const done = new Promise<CadVolumeResult | null>((res, rej) => {
      resolve = res;
      reject = rej;
    });
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

const resultFor = (revision: string, overlapArea = 10): CadVolumeResult => ({
  baseSurfaceId: 'base-1',
  comparisonSurfaceId: 'cmp-1',
  revision,
  overlapArea,
  cutArea: overlapArea,
  fillArea: 0,
  cutVolume: overlapArea,
  fillVolume: 0,
  netVolume: -overlapArea,
  averageCutDepth: 1,
  averageFillDepth: 0,
  maxCutDepth: 1,
  maxFillDepth: 0,
  minDelta: -1,
  maxDelta: 0,
  baseArea: 50,
  comparisonArea: 50,
  stats: {},
});

interface Harness {
  service: SurfaceVolumeService;
  transport: StubVolumeTransport;
  project: () => CadProject;
  setProject: (_project: CadProject) => void;
  setDrawingId: (_id: string) => void;
  volumeRevision: string;
  volumeCache: ReturnType<typeof createCadSurfaceVolumeCache>;
}

const harness = (options: { withComparisonTin?: boolean } = {}): Harness => {
  let project = baseProject();
  let drawingId = 'drawing-1';
  const tinCache = createCadSurfaceCache('scope-1');
  const volumeCache = createCadSurfaceVolumeCache('scope-1');
  const baseRev = computeCadSurfaceSourceRevision(project, project.surfaces![0]!);
  const cmpRev = computeCadSurfaceSourceRevision(project, project.surfaces![1]!);
  for (const [id, revision] of [['base-1', baseRev], ['cmp-1', cmpRev]] as const) {
    if (id === 'cmp-1' && options.withComparisonTin === false) continue;
    const surface = project.surfaces!.find((entry) => entry.id === id)!;
    const built = buildCadSurface(project, surface);
    tinCache.set(id, revision, {
      revision,
      points: built.points,
      triangles: built.triangles,
      stats: built.stats,
      grid: built.grid,
      adjacency: built.adjacency,
      edgeKinds: built.edgeKinds,
    });
  }
  const volumeRevision = computeVolumeSurfaceRevision({
    baseId: 'base-1',
    baseRev,
    cmpId: 'cmp-1',
    cmpRev,
  });
  const transport = new StubVolumeTransport();
  const service = new SurfaceVolumeService({
    drawingId: 'drawing-1',
    getProject: () => project,
    getDrawingId: () => drawingId,
    tinCache,
    volumeCache,
    createTransport: () => transport,
    notify: () => undefined,
    onStateChange: () => undefined,
  });
  return {
    service,
    transport,
    project: () => project,
    setProject: (next) => {
      project = next;
    },
    setDrawingId: (id) => {
      drawingId = id;
    },
    volumeRevision,
    volumeCache,
  };
};

describe('volume service ownership', () => {
  it('supersedes: a late first request is discarded, the second wins, no leaked BUILDING', async () => {
    const h = harness();
    h.service.requestVolume('vol-1');
    expect(h.service.buildingVolumeIds().has('vol-1')).toBe(true);
    h.service.requestVolume('vol-1');
    expect(h.transport.derivations).toHaveLength(2);
    h.transport.derivations[0]!.resolve(resultFor(h.volumeRevision));
    await flush();
    expect(h.volumeCache.get('vol-1', h.volumeRevision)).toBeUndefined();
    expect(h.service.buildingVolumeIds().has('vol-1')).toBe(true);
    h.transport.derivations[1]!.resolve(resultFor(h.volumeRevision));
    await flush();
    expect(h.volumeCache.get('vol-1', h.volumeRevision)).toBeDefined();
    expect(h.service.buildingVolumeIds().size).toBe(0);
    expect(h.service.statusOf('vol-1')).toEqual({ status: 'CURRENT', stale: false });
  });

  it('discards a result whose revision no longer matches the sources', async () => {
    const h = harness();
    h.service.requestVolume('vol-1');
    // Source definition moves while the request is in flight.
    h.setProject({
      ...h.project(),
      surfaces: h.project().surfaces!.map((surface) =>
        surface.id === 'base-1'
          ? { ...surface, definition: { pointSource: { kind: 'points' as const, pointEntityIds: ['b1', 'b2', 'b3'] } } }
          : surface,
      ),
    });
    h.transport.derivations[0]!.resolve(resultFor(h.volumeRevision));
    await flush();
    expect(h.volumeCache.get('vol-1', h.volumeRevision)).toBeUndefined();
    expect(h.service.buildingVolumeIds().size).toBe(0);
    expect(h.service.statusOf('vol-1').status).not.toBe('CURRENT');
  });

  it('discards a result that reports a stale revision', async () => {
    const h = harness();
    h.service.requestVolume('vol-1');
    h.transport.derivations[0]!.resolve(resultFor('vrev1:stale'));
    await flush();
    expect(h.volumeCache.get('vol-1', 'vrev1:stale')).toBeUndefined();
    expect(h.volumeCache.get('vol-1', h.volumeRevision)).toBeUndefined();
  });

  it('rejects cross-drawing late results', async () => {
    const h = harness();
    h.service.requestVolume('vol-1');
    h.setDrawingId('drawing-2');
    h.transport.derivations[0]!.resolve(resultFor(h.volumeRevision));
    await flush();
    expect(h.volumeCache.get('vol-1', h.volumeRevision)).toBeUndefined();
    expect(h.service.buildingVolumeIds().size).toBe(0);
  });

  it('never auto-starts volume work on source rebuild (manual-calc default)', async () => {
    const h = harness();
    h.service.notifyMeshBuilt('base-1');
    await flush();
    expect(h.transport.derivations).toHaveLength(0);
    expect(h.service.buildingVolumeIds().size).toBe(0);
  });

  it('records FAILED diagnostics on worker failure and blocks when a source TIN is missing', async () => {
    const h = harness();
    h.service.requestVolume('vol-1');
    h.transport.derivations[0]!.reject(new Error('volume blew up'));
    await flush();
    expect(h.service.volumeDiagnostics().get('vol-1')?.error).toContain('volume blew up');
    expect(h.service.statusOf('vol-1').status).toBe('FAILED');

    const blocked = harness({ withComparisonTin: false });
    const message = blocked.service.requestVolume('vol-1');
    expect(message).toContain('not CURRENT');
    expect(blocked.transport.derivations).toHaveLength(0);
    expect(blocked.service.statusOf('vol-1').status).toBe('SOURCE_NOT_CURRENT');
  });

  it('maps a zero-overlap success to NO_OVERLAP, not CURRENT', async () => {
    const h = harness();
    h.service.requestVolume('vol-1');
    h.transport.derivations[0]!.resolve(resultFor(h.volumeRevision, 0));
    await flush();
    expect(h.volumeCache.get('vol-1', h.volumeRevision)).toBeDefined();
    expect(h.service.statusOf('vol-1')).toEqual({ status: 'NO_OVERLAP', stale: false });
  });

  it('dispose cancels in-flight work and clears the cache', async () => {
    const h = harness();
    h.service.requestVolume('vol-1');
    h.service.dispose();
    expect(h.transport.cancelled).toHaveLength(1);
    expect(h.service.buildingVolumeIds().size).toBe(0);
    expect(h.volumeCache.get('vol-1', h.volumeRevision)).toBeUndefined();
  });
});

describe('volume worker handler', () => {
  const fakeEngineResult = (overlap = 10) => ({
    quantities: {
      overlapArea: overlap,
      cutArea: overlap,
      fillArea: 0,
      cutVolume: overlap,
      fillVolume: 0,
      netVolume: -overlap,
      averageCutDepth: 1,
      averageFillDepth: 0,
      maxCutDepth: 1,
      maxFillDepth: 0,
      minDelta: -1,
      maxDelta: 0,
      baseArea: 50,
      comparisonArea: 50,
      pairCount: 2,
      polygonCount: 1,
    },
    regions: [{ kind: 'cut' as const, rings: [0, 0, 1, 0, 1, 1] }],
  });

  const volumeRequest = (revision: string, includeDisplay = true): SurfaceVolumeRequest => ({
    volumeSurfaceId: 'vol-1',
    volumeRevision: revision,
    drawingId: 'drawing-1',
    base: { surfaceId: 'base-1', mesh: { points: [0, 0, 0, 1, 0, 0, 0, 1, 0], triangles: [0, 1, 2] } },
    comparison: { surfaceId: 'cmp-1', mesh: { points: [0, 0, 1, 1, 0, 1, 0, 1, 1], triangles: [0, 1, 2] } },
    includeDisplay,
  });

  it('maps engine quantities into a CadVolumeResult with ids and revision', async () => {
    const posted: SurfaceWorkerResponseMessage[] = [];
    const handler = createSurfaceWorkerHandler({
      loadBuilder: () => Promise.reject(new Error('unused')),
      loadVolumeEngine: () => Promise.resolve(() => fakeEngineResult(12)),
      postMessage: (message) => { posted.push(message); },
      defer: (callback) => callback(),
    });
    handler.handleMessage({ type: 'volume', requestId: 'v1', request: volumeRequest('vrev1:test') });
    await flush();
    expect(posted).toHaveLength(1);
    const success = posted[0] as Extract<SurfaceWorkerResponseMessage, { type: 'volume-success' }>;
    expect(success.type).toBe('volume-success');
    expect(success.result.baseSurfaceId).toBe('base-1');
    expect(success.result.comparisonSurfaceId).toBe('cmp-1');
    expect(success.result.revision).toBe('vrev1:test');
    expect(success.result.overlapArea).toBe(12);
    expect(success.result.displayRegions).toHaveLength(1);
    expect(success.result.stats.candidatePairCount).toBe(2);
  });

  it('omits displayRegions when display is not requested', async () => {
    const posted: SurfaceWorkerResponseMessage[] = [];
    const handler = createSurfaceWorkerHandler({
      loadBuilder: () => Promise.reject(new Error('unused')),
      loadVolumeEngine: () => Promise.resolve(() => fakeEngineResult()),
      postMessage: (message) => { posted.push(message); },
      defer: (callback) => callback(),
    });
    handler.handleMessage({ type: 'volume', requestId: 'v1', request: volumeRequest('vrev1:test', false) });
    await flush();
    const success = posted[0] as Extract<SurfaceWorkerResponseMessage, { type: 'volume-success' }>;
    expect('displayRegions' in success.result).toBe(false);
  });

  it('latest-wins per volume id: a superseded engine result is discarded', async () => {
    const posted: SurfaceWorkerResponseMessage[] = [];
    let resolveFirst!: () => void;
    const gate = new Promise<void>((resolve) => { resolveFirst = resolve; });
    let calls = 0;
    const handler = createSurfaceWorkerHandler({
      loadBuilder: () => Promise.reject(new Error('unused')),
      loadVolumeEngine: () =>
        Promise.resolve(async () => {
          calls += 1;
          if (calls === 1) await gate;
          return fakeEngineResult();
        }),
      postMessage: (message) => { posted.push(message); },
      defer: (callback) => callback(),
    });
    handler.handleMessage({ type: 'volume', requestId: 'v1', request: volumeRequest('vrev1:a') });
    handler.handleMessage({ type: 'volume', requestId: 'v2', request: volumeRequest('vrev1:b') });
    await flush();
    const successes = posted.filter((message) => message.type === 'volume-success');
    expect(successes).toHaveLength(1);
    expect((successes[0] as { volumeRevision: string }).volumeRevision).toBe('vrev1:b');
    resolveFirst();
    await flush();
    expect(posted.filter((message) => message.type === 'volume-success')).toHaveLength(1);
  });

  it('reports engine throws as volume-failure', async () => {
    const posted: SurfaceWorkerResponseMessage[] = [];
    const handler = createSurfaceWorkerHandler({
      loadBuilder: () => Promise.reject(new Error('unused')),
      loadVolumeEngine: () => Promise.resolve(() => { throw new Error('volume: no'); }),
      postMessage: (message) => { posted.push(message); },
      defer: (callback) => callback(),
    });
    handler.handleMessage({ type: 'volume', requestId: 'v1', request: volumeRequest('vrev1:test') });
    await flush();
    expect(posted).toHaveLength(1);
    expect(posted[0]!.type).toBe('volume-failure');
    expect((posted[0] as { error: string }).error).toContain('volume: no');
  });
});

describe('surface volume cache eviction', () => {
  it('keeps current + one stale by insertion order, never lexicographic key order', () => {
    const cache = createCadSurfaceVolumeCache('scope');
    cache.set('vol-1', resultFor('vrev1:aaa'));
    cache.set('vol-1', resultFor('vrev1:zzz'));
    cache.set('vol-1', resultFor('vrev1:bbb'));
    expect(cache.get('vol-1', 'vrev1:aaa')).toBeUndefined();
    expect(cache.get('vol-1', 'vrev1:zzz')).toBeDefined();
    expect(cache.get('vol-1', 'vrev1:bbb')).toBeDefined();
    expect(cache.retained('vol-1').map((entry) => entry.revision)).toEqual(['vrev1:zzz', 'vrev1:bbb']);
  });

  it('invalidate + clear drop every revision for a volume or all volumes', () => {
    const cache = createCadSurfaceVolumeCache('scope');
    cache.set('vol-1', resultFor('vrev1:aaa'));
    cache.set('vol-2', resultFor('vrev1:bbb'));
    cache.invalidate('vol-1');
    expect(cache.get('vol-1', 'vrev1:aaa')).toBeUndefined();
    expect(cache.get('vol-2', 'vrev1:bbb')).toBeDefined();
    cache.clear();
    expect(cache.get('vol-2', 'vrev1:bbb')).toBeUndefined();
  });
});
