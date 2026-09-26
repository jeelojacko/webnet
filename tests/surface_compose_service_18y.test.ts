/**
 * Phase 18Y composition worker + client + service pins (agent tier).
 *
 * Covers the `compose` protocol (success/failure/latest-wins/malformed),
 * the client `kreq-` settlement contract, and the SurfaceComposeService
 * ownership tuple: latest-wins supersession, revision-change discard,
 * cross-drawing discard, unmount dispose, same-source block, and the
 * CURRENT-TIN block. The worker computes geometry only — history mutation
 * is the caller's `applyCompose`, which these tests spy on.
 */
import { describe, expect, it } from 'vitest';

import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { buildCadSurface, computeCadSurfaceSourceRevision } from '../src/engine/cad/cadSurfaces';
import { makeWebnetComposeProvenance } from '../src/engine/cad/cadImportedTin';
import type { ComposeResult } from '../src/engine/cad/surfaceCompose';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { SURFACE_COMPOSE_SAME_SOURCE } from '../src/engine/cad/cadTransactionsSurfaceComposeCommands';
import type { CadProject, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';
import {
  createSurfaceWorkerHandler,
  type SurfaceComposeEngineFn,
  type SurfaceComposeRequest,
  type SurfaceComposeResultPayload,
  type SurfaceWorkerRequestMessage,
  type SurfaceWorkerResponseMessage,
} from '../src/workers/surfaceWorkerHandler';
import {
  SURFACE_COMPOSE_MALFORMED,
  SurfaceWorkerClient,
  type PendingSurfaceCompose,
  type SurfaceWorkerPort,
} from '../src/workers/surfaceWorkerClient';
import {
  SurfaceComposeService,
  type SurfaceComposeComputed,
  type SurfaceComposeTransport,
} from '../src/workers/surfaceComposeService';

const point = (id: string, x: number, y: number, z: number): CadSurveyPointEntity => ({
  id, type: 'survey-point', layerId: 'points', visible: true, locked: false,
  stationId: id, x, y, z, pointClass: 'free', source: 'parsed-input',
});

const baseProject = (): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Compose', units: 'm' });
  return {
    ...drawing.project,
    entities: [
      point('b1', 0, 0, 0), point('b2', 10, 0, 0), point('b3', 10, 10, 0), point('b4', 0, 10, 0),
      point('o1', 20, 0, 5), point('o2', 30, 0, 5), point('o3', 30, 10, 5), point('o4', 20, 10, 5),
    ],
    surfaces: [
      { id: 'base-1', name: 'Base', definition: { pointSource: { kind: 'points', pointEntityIds: ['b1', 'b2', 'b3', 'b4'] } }, cachedRevision: null },
      { id: 'overlay-1', name: 'Overlay', definition: { pointSource: { kind: 'points', pointEntityIds: ['o1', 'o2', 'o3', 'o4'] } }, cachedRevision: null },
    ],
  };
};

const flush = async (rounds = 12): Promise<void> => {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
};

const composeRequest = (
  baseRevision: string,
  overlayRevision: string,
): SurfaceComposeRequest => ({
  drawingId: 'drawing-1',
  base: { surfaceId: 'base-1', surfaceName: 'Base', revision: baseRevision, mesh: { points: [0, 0, 0, 10, 0, 0, 0, 10, 0], triangles: [0, 1, 2] } },
  overlay: { surfaceId: 'overlay-1', surfaceName: 'Overlay', revision: overlayRevision, mesh: { points: [0, 0, 1, 10, 0, 1, 0, 10, 1], triangles: [0, 1, 2] } },
  policy: { id: 'overlay-coverage-wins' },
});

const DIAGNOSTICS = {
  baseOnlyArea: 50,
  overlayArea: 50,
  overlapArea: 0,
  resultArea: 100,
  seamLength: 0,
  maxSeamMismatch: 0,
  outputVertexCount: 3,
  outputTriangleCount: 1,
};

const composeSuccess = (): ComposeResult => ({
  ok: true,
  vertices: [0, 0, 1, 10, 0, 1, 0, 10, 1],
  faces: [0, 1, 2],
  diagnostics: DIAGNOSTICS,
  provenance: makeWebnetComposeProvenance({
    baseSurfaceId: 'base-1',
    baseSurfaceName: 'Base',
    baseRevision: 'rev-a',
    overlaySurfaceId: 'overlay-1',
    overlaySurfaceName: 'Overlay',
    overlayRevision: 'rev-b',
  }),
  digest: 'etin1:test',
});

const fakeEngine = (result: ComposeResult = composeSuccess()): SurfaceComposeEngineFn => () => result;

// ---------------------------------------------------------------------------
// Worker handler
// ---------------------------------------------------------------------------

describe('18Y surface worker compose handler', () => {
  it('maps an ok engine result to compose-success', async () => {
    const posted: SurfaceWorkerResponseMessage[] = [];
    const handler = createSurfaceWorkerHandler({
      loadBuilder: () => Promise.reject(new Error('unused')),
      loadComposeFn: () => Promise.resolve(fakeEngine()),
      postMessage: (message) => { posted.push(message); },
      defer: (callback) => callback(),
    });
    handler.handleMessage({ type: 'compose', requestId: 'k1', request: composeRequest('rev-a', 'rev-b') });
    await flush();
    expect(posted).toHaveLength(1);
    const success = posted[0] as Extract<SurfaceWorkerResponseMessage, { type: 'compose-success' }>;
    expect(success.type).toBe('compose-success');
    expect(success.baseRevision).toBe('rev-a');
    expect(success.overlayRevision).toBe('rev-b');
    expect(success.result.faces).toEqual([0, 1, 2]);
    expect(success.result.diagnostics).toEqual(DIAGNOSTICS);
  });

  it('runs the real exact engine through the default compose op (integration)', async () => {
    const posted: SurfaceWorkerResponseMessage[] = [];
    const handler = createSurfaceWorkerHandler({
      loadBuilder: () => Promise.reject(new Error('unused')),
      // No loadComposeFn override: the default wires composeSurfaceMeshes.
      postMessage: (message) => { posted.push(message); },
      defer: (callback) => callback(),
    });
    handler.handleMessage({
      type: 'compose',
      requestId: 'k1',
      request: {
        base: {
          surfaceId: 'base-1',
          surfaceName: 'Base',
          revision: 'rev-a',
          mesh: { points: [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0], triangles: [0, 1, 2, 0, 2, 3] },
        },
        overlay: {
          surfaceId: 'overlay-1',
          surfaceName: 'Overlay',
          revision: 'rev-b',
          mesh: { points: [10, 0, 0, 20, 0, 0, 20, 10, 0, 10, 10, 0], triangles: [0, 1, 2, 0, 2, 3] },
        },
        policy: { id: 'overlay-coverage-wins' },
      },
    });
    await flush();
    expect(posted).toHaveLength(1);
    const success = posted[0] as Extract<SurfaceWorkerResponseMessage, { type: 'compose-success' }>;
    expect(success.type).toBe('compose-success');
    expect(success.result.faces.length).toBeGreaterThanOrEqual(3);
    expect(success.result.diagnostics.resultArea).toBeGreaterThan(0);
  });

  it('maps a fail-closed engine result to compose-failure', async () => {
    const posted: SurfaceWorkerResponseMessage[] = [];
    const handler = createSurfaceWorkerHandler({
      loadBuilder: () => Promise.reject(new Error('unused')),
      loadComposeFn: () =>
        Promise.resolve(
          fakeEngine({
            ok: false,
            reason: 'SURFACE_COMPOSE_SEAM_Z_MISMATCH',
            maxMismatch: 0.01,
            x: 0,
            y: 0,
            baseZ: 1,
            overlayZ: 1.01,
          }),
        ),
      postMessage: (message) => { posted.push(message); },
      defer: (callback) => callback(),
    });
    handler.handleMessage({ type: 'compose', requestId: 'k1', request: composeRequest('rev-a', 'rev-b') });
    await flush();
    expect(posted[0]!.type).toBe('compose-failure');
    expect((posted[0] as { error: string }).error).toContain('SEAM_Z_MISMATCH');
  });

  it('reports an engine throw as compose-failure', async () => {
    const posted: SurfaceWorkerResponseMessage[] = [];
    const handler = createSurfaceWorkerHandler({
      loadBuilder: () => Promise.reject(new Error('unused')),
      loadComposeFn: () => Promise.resolve(() => { throw new Error('compose: no'); }),
      postMessage: (message) => { posted.push(message); },
      defer: (callback) => callback(),
    });
    handler.handleMessage({ type: 'compose', requestId: 'k1', request: composeRequest('rev-a', 'rev-b') });
    await flush();
    expect(posted[0]!.type).toBe('compose-failure');
    expect((posted[0] as { error: string }).error).toContain('compose: no');
  });

  it('is latest-wins per (drawing, base, overlay, policy): a superseded result is dropped', async () => {
    const posted: SurfaceWorkerResponseMessage[] = [];
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let calls = 0;
    const handler = createSurfaceWorkerHandler({
      loadBuilder: () => Promise.reject(new Error('unused')),
      loadComposeFn: () =>
        Promise.resolve(async () => {
          calls += 1;
          if (calls === 1) await gate;
          return composeSuccess();
        }),
      postMessage: (message) => { posted.push(message); },
      defer: (callback) => callback(),
    });
    handler.handleMessage({ type: 'compose', requestId: 'k1', request: composeRequest('rev-a', 'rev-b') });
    handler.handleMessage({ type: 'compose', requestId: 'k2', request: composeRequest('rev-a2', 'rev-b') });
    await flush();
    const successes = posted.filter((message) => message.type === 'compose-success');
    expect(successes).toHaveLength(1);
    expect((successes[0] as { baseRevision: string }).baseRevision).toBe('rev-a2');
    releaseFirst();
    await flush();
    expect(posted.filter((message) => message.type === 'compose-success')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const createFakePort = (engine: SurfaceComposeEngineFn): SurfaceWorkerPort & {
  posted: SurfaceWorkerRequestMessage[];
  emitRaw: (_message: unknown) => void;
  emitError: () => void;
} => {
  const listeners = new Map<string, Set<(_event: unknown) => void>>();
  const port = {
    posted: [] as SurfaceWorkerRequestMessage[],
    postMessage: (message: unknown): void => {
      port.posted.push(message as SurfaceWorkerRequestMessage);
      setTimeout(() => handler.handleMessage(message as SurfaceWorkerRequestMessage), 0);
    },
    terminate: (): void => undefined,
    addEventListener: (type: string, listener: (_event: unknown) => void): void => {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, listener: (_event: unknown) => void): void => {
      listeners.get(type)?.delete(listener);
    },
    emitRaw: (message: unknown): void => {
      for (const listener of listeners.get('message') ?? []) listener({ data: message });
    },
    emitError: (): void => {
      for (const listener of listeners.get('error') ?? []) listener({});
    },
  };
  const handler = createSurfaceWorkerHandler({
    loadBuilder: () => Promise.reject(new Error('unused')),
    loadComposeFn: () => Promise.resolve(engine),
    postMessage: (message: SurfaceWorkerResponseMessage) => {
      setTimeout(() => port.emitRaw(message), 0);
    },
  });
  return port;
};

describe('18Y SurfaceWorkerClient.deriveCompose', () => {
  it('uses the kreq- prefix and resolves the composed topology', async () => {
    const port = createFakePort(fakeEngine());
    const client = new SurfaceWorkerClient(port);
    const pending = client.deriveCompose(composeRequest('rev-a', 'rev-b'));
    expect(pending.requestId.startsWith('kreq-')).toBe(true);
    expect(port.posted[0]).toMatchObject({ type: 'compose' });
    const result = await pending.done;
    expect(result?.faces).toEqual([0, 1, 2]);
    client.dispose();
  });

  it('rejects a malformed compose payload', async () => {
    const port = createFakePort(fakeEngine());
    const client = new SurfaceWorkerClient(port);
    const pending = client.deriveCompose(composeRequest('rev-a', 'rev-b'));
    await flush();
    port.emitRaw({
      type: 'compose-success',
      requestId: pending.requestId,
      baseSurfaceId: 'base-1',
      baseRevision: 'rev-a',
      overlaySurfaceId: 'overlay-1',
      overlayRevision: 'rev-b',
      result: { vertices: 'nope', faces: [0, 1, 2], diagnostics: DIAGNOSTICS },
    });
    await expect(pending.done).rejects.toThrow(SURFACE_COMPOSE_MALFORMED);
    client.dispose();
  });

  it('settles cancel as null', async () => {
    const port = createFakePort(fakeEngine());
    const client = new SurfaceWorkerClient(port);
    const pending = client.deriveCompose(composeRequest('rev-a', 'rev-b'));
    pending.cancel();
    await expect(pending.done).resolves.toBeNull();
    client.dispose();
  });

  it('rejects every pending compose on fatal worker death', async () => {
    const port = createFakePort(fakeEngine());
    const client = new SurfaceWorkerClient(port);
    const pending = client.deriveCompose(composeRequest('rev-a', 'rev-b'));
    port.emitError();
    await expect(pending.done).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class StubComposeTransport implements SurfaceComposeTransport {
  alive = true;
  readonly derivations: Array<{
    requestId: string;
    request: SurfaceComposeRequest;
    resolve: (_result: SurfaceComposeResultPayload | null) => void;
    reject: (_error: Error) => void;
  }> = [];
  readonly cancelled: string[] = [];
  private nextId = 0;

  deriveCompose(request: SurfaceComposeRequest): PendingSurfaceCompose {
    this.nextId += 1;
    const requestId = `kreq-${this.nextId}`;
    let resolve!: (_result: SurfaceComposeResultPayload | null) => void;
    let reject!: (_error: Error) => void;
    const done = new Promise<SurfaceComposeResultPayload | null>((res, rej) => {
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

interface Harness {
  service: SurfaceComposeService;
  transport: StubComposeTransport;
  project: () => CadProject;
  setProject: (_project: CadProject) => void;
  setDrawingId: (_id: string) => void;
  applied: SurfaceComposeComputed[];
  notices: string[];
}

const harness = (options: { withOverlayTin?: boolean } = {}): Harness => {
  let project = baseProject();
  let drawingId = 'drawing-1';
  const tinCache = createCadSurfaceCache('scope-1');
  const baseRevision = computeCadSurfaceSourceRevision(project, project.surfaces![0]!);
  const overlayRevision = computeCadSurfaceSourceRevision(project, project.surfaces![1]!);
  for (const [id, revision] of [['base-1', baseRevision], ['overlay-1', overlayRevision]] as const) {
    if (id === 'overlay-1' && options.withOverlayTin === false) continue;
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
  const transport = new StubComposeTransport();
  const applied: SurfaceComposeComputed[] = [];
  const notices: string[] = [];
  const service = new SurfaceComposeService({
    drawingId: 'drawing-1',
    getProject: () => project,
    getDrawingId: () => drawingId,
    tinCache,
    createTransport: () => transport,
    notify: (message) => { notices.push(message); },
    onStateChange: () => undefined,
    applyCompose: (computed) => { applied.push(computed); },
  });
  return {
    service,
    transport,
    project: () => project,
    setProject: (next) => { project = next; },
    setDrawingId: (id) => { drawingId = id; },
    applied,
    notices,
  };
};

const spec = (overrides: Partial<{ baseSurfaceId: string; overlaySurfaceId: string }> = {}) => ({
  baseSurfaceId: 'base-1',
  overlaySurfaceId: 'overlay-1',
  policy: { id: 'overlay-coverage-wins' },
  ...overrides,
});

const composed = (revisionSeed = 1): SurfaceComposeResultPayload => ({
  vertices: [0, 0, revisionSeed, 10, 0, revisionSeed, 0, 10, revisionSeed],
  faces: [0, 1, 2],
  diagnostics: DIAGNOSTICS,
});

describe('18Y SurfaceComposeService ownership', () => {
  it('applies the first successful completion', async () => {
    const h = harness();
    h.service.requestCompose(spec());
    expect(h.service.isBuilding(spec())).toBe(true);
    h.transport.derivations[0]!.resolve(composed());
    await flush();
    expect(h.applied).toHaveLength(1);
    expect(h.applied[0]!.baseSurfaceId).toBe('base-1');
    expect(h.applied[0]!.overlayRevision).toBe(h.transport.derivations[0]!.request.overlay.revision);
    expect(h.service.isBuilding(spec())).toBe(false);
  });

  it('supersedes: a late first result is discarded, the second wins', async () => {
    const h = harness();
    h.service.requestCompose(spec());
    h.service.requestCompose(spec());
    expect(h.transport.derivations).toHaveLength(2);
    expect(h.transport.cancelled).toHaveLength(1);
    h.transport.derivations[0]!.resolve(composed(1));
    await flush();
    expect(h.applied).toHaveLength(0);
    h.transport.derivations[1]!.resolve(composed(2));
    await flush();
    expect(h.applied).toHaveLength(1);
    expect(h.applied[0]!.vertices[2]).toBe(2);
    expect(h.service.isBuilding(spec())).toBe(false);
  });

  it('discards a result whose source revision moved, and notifies retry', async () => {
    const h = harness();
    h.service.requestCompose(spec());
    h.setProject({
      ...h.project(),
      surfaces: h.project().surfaces!.map((surface) =>
        surface.id === 'base-1'
          ? { ...surface, definition: { pointSource: { kind: 'points' as const, pointEntityIds: ['b1', 'b2', 'b3'] } } }
          : surface,
      ),
    });
    h.transport.derivations[0]!.resolve(composed());
    await flush();
    expect(h.applied).toHaveLength(0);
    expect(h.notices.some((message) => message.includes('retry'))).toBe(true);
    expect(h.service.isBuilding(spec())).toBe(false);
  });

  it('discards cross-drawing late results', async () => {
    const h = harness();
    h.service.requestCompose(spec());
    h.setDrawingId('drawing-2');
    h.transport.derivations[0]!.resolve(composed());
    await flush();
    expect(h.applied).toHaveLength(0);
    expect(h.service.isBuilding(spec())).toBe(false);
  });

  it('records a diagnostic on worker failure and never applies', async () => {
    const h = harness();
    h.service.requestCompose(spec());
    h.transport.derivations[0]!.reject(new Error('compose blew up'));
    await flush();
    expect(h.applied).toHaveLength(0);
    expect([...h.service.composeDiagnostics().values()][0]?.error).toContain('compose blew up');
  });

  it('blocks same-source and missing-TIN requests before creating a worker', () => {
    const h = harness();
    expect(h.service.requestCompose(spec({ overlaySurfaceId: 'base-1' }))).toBe(SURFACE_COMPOSE_SAME_SOURCE);
    expect(h.transport.derivations).toHaveLength(0);
    const missing = harness({ withOverlayTin: false });
    expect(missing.service.requestCompose(spec())).toContain('not CURRENT');
    expect(missing.transport.derivations).toHaveLength(0);
    expect(missing.applied).toHaveLength(0);
  });

  it('dispose cancels in-flight work and drops the pending set', () => {
    const h = harness();
    h.service.requestCompose(spec());
    h.service.dispose();
    expect(h.transport.cancelled).toHaveLength(1);
    expect(h.service.buildingComposeKeys().size).toBe(0);
  });
});
