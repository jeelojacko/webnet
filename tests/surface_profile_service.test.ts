import { describe, expect, it } from 'vitest';

import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { buildCadSurface, computeCadSurfaceSourceRevision } from '../src/engine/cad/cadSurfaces';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { computeSurfaceProfileRevision } from '../src/engine/cad/cadProfileRevision';
import { createCadProfileCache } from '../src/engine/cad/profileCache';
import type {
  CadAlignmentElement,
  CadProject,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';
import type { CadSurfaceProfileResult } from '../src/engine/cad/profiles/profileExtraction';
import type { SurfaceProfileRequest } from '../src/workers/surfaceWorkerHandler';
import type { PendingSurfaceProfile } from '../src/workers/surfaceWorkerClient';
import {
  SurfaceProfileService,
  type SurfaceProfileTransport,
} from '../src/workers/surfaceProfileService';

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

const line = (x0: number, y0: number, x1: number, y1: number): CadAlignmentElement => ({
  kind: 'line',
  start: { x: x0, y: y0 },
  end: { x: x1, y: y1 },
});

const baseProject = (): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Profiles', units: 'm' });
  return {
    ...drawing.project,
    entities: [
      point('p1', 'P1', 0, 0, 5),
      point('p2', 'P2', 10, 0, 5),
      point('p3', 'P3', 10, 10, 5),
      point('p4', 'P4', 0, 10, 5),
      {
        id: 'align-1',
        type: 'alignment',
        layerId: 'general',
        visible: true,
        locked: false,
        name: 'CL',
        elements: [line(0, 5, 10, 5)],
        startStation: 0,
      },
    ],
    surfaces: [
      { id: 'surf-1', name: 'Site', definition: { pointSource: { kind: 'points', pointEntityIds: ['p1', 'p2', 'p3', 'p4'] } }, cachedRevision: null },
    ],
    surfaceProfiles: [{ id: 'prof-1', name: 'CL Profile', alignmentEntityId: 'align-1', surfaceId: 'surf-1' }],
  };
};

const flush = async (rounds = 10): Promise<void> => {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
};

class StubProfileTransport implements SurfaceProfileTransport {
  alive = true;
  readonly derivations: Array<{
    requestId: string;
    request: SurfaceProfileRequest;
    resolve: (_result: CadSurfaceProfileResult | null) => void;
    reject: (_error: Error) => void;
  }> = [];
  readonly cancelled: string[] = [];
  private nextId = 0;

  deriveProfile(request: SurfaceProfileRequest): PendingSurfaceProfile {
    this.nextId += 1;
    const requestId = `preq-${this.nextId}`;
    let resolve!: (_result: CadSurfaceProfileResult | null) => void;
    let reject!: (_error: Error) => void;
    const done = new Promise<CadSurfaceProfileResult | null>((res, rej) => {
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

const resultFor = (profileRevision: string): CadSurfaceProfileResult => ({
  profileId: 'prof-1',
  revision: profileRevision,
  rawStartStation: 0,
  rawEndStation: 10,
  segments: [
    {
      samples: [
        { rawChainage: 0, displayStation: 0, x: 0, y: 5, elevation: 5 },
        { rawChainage: 10, displayStation: 10, x: 10, y: 5, elevation: 5 },
      ],
    },
  ],
  minElevation: 5,
  maxElevation: 5,
  coveredLength: 10,
  gapLength: 0,
  diagnostics: [],
});

interface Harness {
  service: SurfaceProfileService;
  transport: StubProfileTransport;
  project: () => CadProject;
  setProject: (_project: CadProject) => void;
  setDrawingId: (_id: string) => void;
  profileRevision: string;
  profileCache: ReturnType<typeof createCadProfileCache>;
  /** Rebuild the session TIN for the (possibly edited) surface and seed the cache. */
  rebuildTin: () => string;
}

const harness = (): Harness => {
  let project = baseProject();
  let drawingId = 'drawing-1';
  const tinCache = createCadSurfaceCache('scope-1');
  const profileCache = createCadProfileCache('scope-1');
  const surface = project.surfaces![0]!;
  const surfaceRev = computeCadSurfaceSourceRevision(project, surface);
  const built = buildCadSurface(project, surface);
  tinCache.set(surface.id, surfaceRev, {
    revision: surfaceRev,
    points: built.points,
    triangles: built.triangles,
    stats: built.stats,
    grid: built.grid,
    adjacency: built.adjacency,
    edgeKinds: built.edgeKinds,
  });
  const alignment = project.entities.find((entry) => entry.id === 'align-1')!;
  const profileRevision = computeSurfaceProfileRevision(
    project.surfaceProfiles![0]!,
    {
      id: alignment.id,
      elements: (alignment as { elements: readonly CadAlignmentElement[] }).elements,
      startStation: (alignment as { startStation: number }).startStation,
    },
    surfaceRev,
  );
  const transport = new StubProfileTransport();
  const rebuildTin = (): string => {
    const current = project.surfaces!.find((entry) => entry.id === 'surf-1')!;
    const revision = computeCadSurfaceSourceRevision(project, current);
    const rebuilt = buildCadSurface(project, current);
    tinCache.set(current.id, revision, {
      revision,
      points: rebuilt.points,
      triangles: rebuilt.triangles,
      stats: rebuilt.stats,
      grid: rebuilt.grid,
      adjacency: rebuilt.adjacency,
      edgeKinds: rebuilt.edgeKinds,
    });
    return revision;
  };
  const service = new SurfaceProfileService({
    drawingId: 'drawing-1',
    getProject: () => project,
    getDrawingId: () => drawingId,
    tinCache,
    profileCache,
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
    profileRevision,
    profileCache,
    rebuildTin,
  };
};

const resolveCurrent = async (h: Harness): Promise<void> => {
  h.service.requestProfile('prof-1');
  const pending = h.transport.derivations[h.transport.derivations.length - 1]!;
  expect(pending.request.profileRevision).toBe(h.profileRevision);
  pending.resolve(resultFor(h.profileRevision));
  await flush();
  expect(h.service.statusOf('prof-1')).toEqual({ status: 'CURRENT', stale: false });
};

describe('profile service ownership', () => {
  it('late first result is discarded, the second wins, no leaked BUILDING', async () => {
    const h = harness();
    h.service.requestProfile('prof-1');
    expect(h.service.buildingProfileIds().has('prof-1')).toBe(true);
    h.service.requestProfile('prof-1');
    expect(h.transport.derivations).toHaveLength(2);
    h.transport.derivations[0]!.resolve(resultFor(h.profileRevision));
    await flush();
    expect(h.profileCache.get('prof-1', h.profileRevision)).toBeUndefined();
    expect(h.service.buildingProfileIds().has('prof-1')).toBe(true);
    h.transport.derivations[1]!.resolve(resultFor(h.profileRevision));
    await flush();
    expect(h.profileCache.get('prof-1', h.profileRevision)).toBeDefined();
    expect(h.service.buildingProfileIds().size).toBe(0);
    expect(h.service.statusOf('prof-1')).toEqual({ status: 'CURRENT', stale: false });
  });

  it('alignment change can never become CURRENT from a stale result', async () => {
    const h = harness();
    await resolveCurrent(h);
    // Move the alignment sideways while the profile id stays the same.
    h.setProject({
      ...h.project(),
      entities: h.project().entities.map((entity) =>
        entity.id === 'align-1' && entity.type === 'alignment'
          ? { ...entity, elements: [line(0, 6, 10, 6)] }
          : entity,
      ),
    });
    h.service.notifyAlignmentChanged('align-1');
    const status = h.service.statusOf('prof-1');
    expect(status.status).not.toBe('CURRENT');
    expect(h.profileCache.get('prof-1', h.profileRevision)).toBeDefined();
  });

  it('surface rebuild invalidates: in-flight cancelled, status NEEDS_REBUILD', async () => {
    const h = harness();
    h.service.requestProfile('prof-1');
    h.service.notifyMeshBuilt('surf-1');
    expect(h.service.buildingProfileIds().size).toBe(0);
    expect(h.transport.cancelled).toHaveLength(1);
    // The late arrival after the rebuild notice never applies.
    h.transport.derivations[0]!.resolve(resultFor(h.profileRevision));
    await flush();
    expect(h.profileCache.get('prof-1', h.profileRevision)).toBeUndefined();

    // Re-derive against the old mesh, then move the surface definition
    // and rebuild the session TIN (manual derivation still required).
    await resolveCurrent(h);
    h.setProject({
      ...h.project(),
      surfaces: h.project().surfaces!.map((surface) =>
        surface.id === 'surf-1'
          ? { ...surface, definition: { pointSource: { kind: 'points' as const, pointEntityIds: ['p1', 'p2', 'p3'] } } }
          : surface,
      ),
    });
    h.rebuildTin();
    h.service.notifyMeshBuilt('surf-1');
    // Manual derivation only: the notice cancels nothing new and starts nothing.
    expect(h.transport.derivations).toHaveLength(2);
    expect(h.service.statusOf('prof-1').status).toBe('NEEDS_REBUILD');
  });

  it('rejects cross-drawing late results', async () => {
    const h = harness();
    h.service.requestProfile('prof-1');
    h.setDrawingId('drawing-2');
    h.transport.derivations[0]!.resolve(resultFor(h.profileRevision));
    await flush();
    expect(h.profileCache.get('prof-1', h.profileRevision)).toBeUndefined();
    expect(h.service.buildingProfileIds().size).toBe(0);
  });

  it('cancel drops the pending request and discards the late arrival', async () => {
    const h = harness();
    h.service.requestProfile('prof-1');
    h.service.cancelProfile('prof-1');
    expect(h.service.buildingProfileIds().size).toBe(0);
    expect(h.transport.cancelled).toHaveLength(1);
    h.transport.derivations[0]!.resolve(resultFor(h.profileRevision));
    await flush();
    expect(h.profileCache.get('prof-1', h.profileRevision)).toBeUndefined();
    expect(h.service.statusOf('prof-1').status).toBe('UNBUILT');
  });

  it('records FAILED on worker failure and blocks when the source TIN is missing', async () => {
    const h = harness();
    h.service.requestProfile('prof-1');
    h.transport.derivations[0]!.reject(new Error('profile blew up'));
    await flush();
    expect(h.service.profileDiagnostics().get('prof-1')?.error).toContain('profile blew up');
    expect(h.service.statusOf('prof-1').status).toBe('FAILED');
  });

  it('never auto-starts profile work on mesh or alignment notices', async () => {
    const h = harness();
    h.service.notifyMeshBuilt('surf-1');
    h.service.notifyAlignmentChanged('align-1');
    await flush();
    expect(h.transport.derivations).toHaveLength(0);
    expect(h.service.buildingProfileIds().size).toBe(0);
  });
});
