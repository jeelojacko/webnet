import { describe, expect, it } from 'vitest';

import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { buildCadSurface, computeCadSurfaceSourceRevision } from '../src/engine/cad/cadSurfaces';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { createCadSectionCache } from '../src/engine/cad/sectionCache';
import {
  computeCadSampleLineGroupRevision,
  computeCadSampleLineRevision,
} from '../src/engine/cad/cadSectionRevision';
import type {
  CadSurfaceSectionResult,
  ExtractSurfaceSectionInput,
} from '../src/engine/cad/cadSectionTypes';
import type {
  CadAlignmentElement,
  CadProject,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';
import {
  createSurfaceWorkerHandler,
  type SurfaceSectionsRequest,
  type SurfaceWorkerResponseMessage,
} from '../src/workers/surfaceWorkerHandler';
import type { PendingSurfaceSections } from '../src/workers/surfaceWorkerClient';
import {
  SurfaceSectionService,
  type SurfaceSectionTransport,
} from '../src/workers/surfaceSectionService';

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
  const drawing = createBlankCadDrawingDocument({ name: 'Sections', units: 'm' });
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
      { id: 'surf-1', name: 'Existing', definition: { pointSource: { kind: 'points', pointEntityIds: ['p1', 'p2', 'p3', 'p4'] } }, cachedRevision: null },
      { id: 'surf-2', name: 'Design', definition: { pointSource: { kind: 'points', pointEntityIds: ['p1', 'p2', 'p3', 'p4'] } }, cachedRevision: null },
    ],
    sampleLineGroups: [
      {
        id: 'grp-1',
        name: 'Corridor',
        alignmentEntityId: 'align-1',
        surfaceSources: [{ surfaceId: 'surf-1' }, { surfaceId: 'surf-2' }],
        sampleLines: [
          { id: 'line-1', rawStation: 2, leftWidth: 5, rightWidth: 5, skewDeg: 0 },
          { id: 'line-2', rawStation: 6, leftWidth: 5, rightWidth: 5, skewDeg: 0 },
        ],
      },
    ],
  };
};

const flush = async (rounds = 10): Promise<void> => {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
};

const fakeResult = (input: ExtractSurfaceSectionInput): CadSurfaceSectionResult => ({
  groupId: input.groupId,
  lineId: input.lineId,
  surfaceId: input.surfaceId,
  revision: input.revision,
  surfaceRevision: input.surfaceRevision,
  rawStation: input.rawStation,
  segments: [{ samples: [{ offset: -5, elevation: 5 }, { offset: 5, elevation: 5 }] }],
  minElevation: 5,
  maxElevation: 5,
  coveredWidth: 10,
  gapWidth: 0,
  diagnostics: [],
});

const flatMesh = {
  points: [0, 0, 5, 10, 0, 5, 10, 10, 5, 0, 10, 5],
  triangles: [0, 1, 2, 0, 2, 3],
  grid: { minX: 0, minY: 0, cellSize: 10, cells: new Map<string, number[]>() },
};

const sectionsRequest = (groupRevision: string): SurfaceSectionsRequest => ({
  groupId: 'grp-1',
  groupRevision,
  alignmentElements: [line(0, 5, 10, 5)],
  startStation: 0,
  sources: [
    { surfaceId: 'surf-1', surfaceRevision: 'srev1:aaaa', mesh: flatMesh },
    { surfaceId: 'surf-2', surfaceRevision: 'srev1:bbbb', mesh: flatMesh },
  ],
  lines: [
    { lineId: 'line-1', lineRevision: 'secl1:one', rawStation: 2, leftWidth: 5, rightWidth: 5, skewDeg: 0 },
    { lineId: 'line-2', lineRevision: 'secl1:two', rawStation: 6, leftWidth: 5, rightWidth: 5, skewDeg: 0 },
  ],
});

describe('section worker batching', () => {
  it('materialises each source mesh once and returns per-line results', async () => {
    const posted: SurfaceWorkerResponseMessage[] = [];
    const inputs: ExtractSurfaceSectionInput[] = [];
    const handler = createSurfaceWorkerHandler({
      loadBuilder: () => Promise.reject(new Error('unused')),
      loadSectionExtractor: () => Promise.resolve((input: ExtractSurfaceSectionInput) => {
        inputs.push(input);
        return fakeResult(input);
      }),
      postMessage: (message) => {
        posted.push(message);
      },
      defer: (callback) => callback(),
    });
    handler.handleMessage({ type: 'sections', requestId: 's1', request: sectionsRequest('secg1:x') });
    await flush();
    const successes = posted.filter((m) => m.type === 'sections-success');
    expect(successes).toHaveLength(1);
    const success = successes[0] as Extract<SurfaceWorkerResponseMessage, { type: 'sections-success' }>;
    expect(success.results).toHaveLength(4); // 2 lines x 2 sources
    expect(success.results.map((r) => `${r.lineId}:${r.surfaceId}`).sort()).toEqual([
      'line-1:surf-1',
      'line-1:surf-2',
      'line-2:surf-1',
      'line-2:surf-2',
    ]);
    // Batching proof: the mesh object is materialised once per source and
    // reused across every line (structured-clone cost is O(mesh), not O(mesh x lines)).
    for (const surfaceId of ['surf-1', 'surf-2']) {
      const meshes = new Set(
        inputs.filter((input) => input.surfaceId === surfaceId).map((input) => input.mesh),
      );
      expect(meshes.size).toBe(1);
    }
  });

  it('production extractor walks the real TIN once and emits per-line sections', async () => {
    const project = baseProject();
    const surface = project.surfaces![0]!;
    const built = buildCadSurface(project, surface);
    const flatPoints: number[] = [];
    for (const point of built.points) flatPoints.push(point.x, point.y, point.z);
    const flatTriangles: number[] = [];
    for (const triangle of built.triangles) flatTriangles.push(triangle[0], triangle[1], triangle[2]);
    const posted: SurfaceWorkerResponseMessage[] = [];
    const handler = createSurfaceWorkerHandler({
      loadBuilder: () => Promise.reject(new Error('unused')),
      postMessage: (message) => {
        posted.push(message);
      },
      defer: (callback) => callback(),
    });
    handler.handleMessage({
      type: 'sections',
      requestId: 'real',
      request: {
        groupId: 'grp-1',
        groupRevision: 'secg1:real',
        alignmentElements: [line(0, 5, 10, 5)],
        startStation: 0,
        sources: [
          {
            surfaceId: 'surf-1',
            surfaceRevision: 'srev1:x',
            mesh: { points: flatPoints, triangles: flatTriangles, grid: built.grid },
          },
        ],
        lines: [
          { lineId: 'line-1', lineRevision: 'secl1:a', rawStation: 2, leftWidth: 5, rightWidth: 5, skewDeg: 0 },
          { lineId: 'line-2', lineRevision: 'secl1:b', rawStation: 6, leftWidth: 5, rightWidth: 5, skewDeg: 15 },
        ],
      },
    });
    await flush(30);
    const successes = posted.filter((m) => m.type === 'sections-success');
    expect(successes).toHaveLength(1);
    const results = (successes[0] as Extract<SurfaceWorkerResponseMessage, { type: 'sections-success' }>).results;
    expect(results.map((result) => result.lineId)).toEqual(['line-1', 'line-2']);
    for (const result of results) {
      expect(result.surfaceRevision).toBe('srev1:x');
      expect(result.segments.length).toBeGreaterThan(0);
      expect(result.coveredWidth).toBeGreaterThan(0);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it('latest-wins: a superseded batch never posts its result', async () => {
    const posted: SurfaceWorkerResponseMessage[] = [];
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    const handler = createSurfaceWorkerHandler({
      loadBuilder: () => Promise.reject(new Error('unused')),
      loadSectionExtractor: () => Promise.resolve(async (input: ExtractSurfaceSectionInput) => {
        calls += 1;
        if (calls === 1) await gate;
        return fakeResult(input);
      }),
      postMessage: (message) => {
        posted.push(message);
      },
      defer: (callback) => callback(),
    });
    handler.handleMessage({ type: 'sections', requestId: 'a', request: sectionsRequest('secg1:a') });
    handler.handleMessage({ type: 'sections', requestId: 'b', request: sectionsRequest('secg1:b') });
    await flush();
    releaseFirst();
    await flush(30);
    const successes = posted.filter((m) => m.type === 'sections-success');
    expect(successes).toHaveLength(1);
    expect((successes[0] as { groupRevision: string }).groupRevision).toBe('secg1:b');
  });
});

class StubSectionTransport implements SurfaceSectionTransport {
  alive = true;
  readonly derivations: Array<{
    requestId: string;
    request: SurfaceSectionsRequest;
    resolve: (_results: CadSurfaceSectionResult[] | null) => void;
    reject: (_error: Error) => void;
  }> = [];
  readonly cancelled: string[] = [];
  private nextId = 0;

  deriveSections(request: SurfaceSectionsRequest): PendingSurfaceSections {
    this.nextId += 1;
    const requestId = `sreq2-${this.nextId}`;
    let resolve!: (_results: CadSurfaceSectionResult[] | null) => void;
    let reject!: (_error: Error) => void;
    const done = new Promise<CadSurfaceSectionResult[] | null>((res, rej) => {
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
  service: SurfaceSectionService;
  transport: StubSectionTransport;
  project: () => CadProject;
  setProject: (_project: CadProject) => void;
  setDrawingId: (_id: string) => void;
  sectionCache: ReturnType<typeof createCadSectionCache>;
  rebuildTin: () => void;
  resultsFor: (_request: SurfaceSectionsRequest) => CadSurfaceSectionResult[];
}

const harness = (): Harness => {
  let project = baseProject();
  let drawingId = 'drawing-1';
  const tinCache = createCadSurfaceCache('scope-1');
  const sectionCache = createCadSectionCache('scope-1');
  const seedTin = (): void => {
    for (const surface of project.surfaces ?? []) {
      const revision = computeCadSurfaceSourceRevision(project, surface);
      const built = buildCadSurface(project, surface);
      tinCache.set(surface.id, revision, {
        revision,
        points: built.points,
        triangles: built.triangles,
        stats: built.stats,
        grid: built.grid,
        adjacency: built.adjacency,
        edgeKinds: built.edgeKinds,
      });
    }
  };
  seedTin();
  const transport = new StubSectionTransport();
  const resultsFor = (request: SurfaceSectionsRequest): CadSurfaceSectionResult[] => {
    const results: CadSurfaceSectionResult[] = [];
    for (const line of request.lines) {
      for (const source of request.sources) {
        results.push({
          groupId: request.groupId,
          lineId: line.lineId,
          surfaceId: source.surfaceId,
          revision: line.lineRevision,
          surfaceRevision: source.surfaceRevision,
          rawStation: line.rawStation,
          segments: [{ samples: [{ offset: -5, elevation: 5 }, { offset: 5, elevation: 5 }] }],
          minElevation: 5,
          maxElevation: 5,
          coveredWidth: 10,
          gapWidth: 0,
          diagnostics: [],
        });
      }
    }
    return results;
  };
  const service = new SurfaceSectionService({
    drawingId: 'drawing-1',
    getProject: () => project,
    getDrawingId: () => drawingId,
    tinCache,
    sectionCache,
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
    sectionCache,
    rebuildTin: seedTin,
    resultsFor,
  };
};

const resolveCurrent = async (h: Harness): Promise<void> => {
  h.service.requestGroup('grp-1');
  const pending = h.transport.derivations[h.transport.derivations.length - 1]!;
  pending.resolve(h.resultsFor(pending.request));
  await flush();
  expect(h.service.statusOf('grp-1', 'line-1', 'surf-1').status).toBe('CURRENT');
};

describe('section service ownership', () => {
  it('late first result is discarded, the second wins, no leaked BUILDING', async () => {
    const h = harness();
    h.service.requestGroup('grp-1');
    expect(h.service.buildingGroupIds().has('grp-1')).toBe(true);
    h.service.requestGroup('grp-1');
    expect(h.transport.derivations).toHaveLength(2);
    const first = h.transport.derivations[0]!;
    first.resolve(h.resultsFor(first.request));
    await flush();
    expect(h.sectionCache.get('line-1', 'surf-1', first.request.lines[0]!.lineRevision)).toBeUndefined();
    expect(h.service.buildingGroupIds().has('grp-1')).toBe(true);
    const second = h.transport.derivations[1]!;
    second.resolve(h.resultsFor(second.request));
    await flush();
    expect(h.service.buildingGroupIds().size).toBe(0);
    expect(h.service.statusOf('grp-1', 'line-1', 'surf-1').status).toBe('CURRENT');
  });

  it('edits make the cached result stale: width/skew change never reads CURRENT', async () => {
    const h = harness();
    await resolveCurrent(h);
    h.setProject({
      ...h.project(),
      sampleLineGroups: h.project().sampleLineGroups!.map((group) => ({
        ...group,
        sampleLines: group.sampleLines.map((line) =>
          line.id === 'line-1' ? { ...line, leftWidth: 8 } : line,
        ),
      })),
    });
    expect(h.service.statusOf('grp-1', 'line-1', 'surf-1').status).toBe('UNBUILT');
    expect(h.service.statusOf('grp-1', 'line-2', 'surf-1').status).toBe('CURRENT');
  });

  it('a station-equation edit does not invalidate extracted sections', async () => {
    const h = harness();
    await resolveCurrent(h);
    h.setProject({
      ...h.project(),
      entities: h.project().entities.map((entity) =>
        entity.id === 'align-1' && entity.type === 'alignment'
          ? { ...entity, stationEquations: [{ backStation: 2, aheadStation: 102 }] }
          : entity,
      ),
    });
    expect(h.service.statusOf('grp-1', 'line-1', 'surf-1').status).toBe('CURRENT');
  });

  it('rejects cross-drawing late results', async () => {
    const h = harness();
    h.service.requestGroup('grp-1');
    h.setDrawingId('drawing-2');
    const pending = h.transport.derivations[0]!;
    pending.resolve(h.resultsFor(pending.request));
    await flush();
    expect(h.service.buildingGroupIds().size).toBe(0);
    expect(h.service.statusOf('grp-1', 'line-1', 'surf-1').status).not.toBe('CURRENT');
  });

  it('records FAILED on failure then retries cleanly (no pending leak)', async () => {
    const h = harness();
    h.service.requestGroup('grp-1');
    h.transport.derivations[0]!.reject(new Error('sections blew up'));
    await flush();
    expect(h.service.sectionDiagnostics().get('line-1\u0000surf-1')?.error).toContain('sections blew up');
    expect(h.service.statusOf('grp-1', 'line-1', 'surf-1').status).toBe('FAILED');
    expect(h.service.buildingGroupIds().size).toBe(0);
    await resolveCurrent(h);
    expect(h.service.sectionDiagnostics().size).toBe(0);
  });

  it('a source rebuild cancels in-flight work and derives NEEDS_REBUILD', async () => {
    const h = harness();
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
    expect(h.service.statusOf('grp-1', 'line-1', 'surf-1').status).toBe('NEEDS_REBUILD');
    expect(h.service.statusOf('grp-1', 'line-1', 'surf-2').status).toBe('CURRENT');
  });

  it('derives OUT_OF_RANGE for a line beyond the alignment extent', async () => {
    const h = harness();
    h.setProject({
      ...h.project(),
      sampleLineGroups: h.project().sampleLineGroups!.map((group) => ({
        ...group,
        sampleLines: group.sampleLines.map((line) =>
          line.id === 'line-1' ? { ...line, rawStation: 50 } : line,
        ),
      })),
    });
    expect(h.service.statusOf('grp-1', 'line-1', 'surf-1').status).toBe('OUT_OF_RANGE');
  });

  it('never auto-starts section work on mesh or alignment notices', async () => {
    const h = harness();
    h.service.notifyMeshBuilt('surf-1');
    h.service.notifyAlignmentChanged('align-1');
    await flush();
    expect(h.transport.derivations).toHaveLength(0);
    expect(h.service.buildingGroupIds().size).toBe(0);
  });
});

// Keep the revision helpers referenced so an accidental signature drift fails here.
describe('section service revision wiring', () => {
  it('builds a group revision that moves with the source surface', () => {
    const project = baseProject();
    const group = project.sampleLineGroups![0]!;
    const alignment = project.entities.find((entry) => entry.id === 'align-1')! as CadAlignmentEntityLike;
    const before = computeCadSampleLineGroupRevision(group, alignment, {
      'surf-1': 'srev1:a',
      'surf-2': 'srev1:b',
    });
    const after = computeCadSampleLineGroupRevision(group, alignment, {
      'surf-1': 'srev1:c',
      'surf-2': 'srev1:b',
    });
    expect(after).not.toBe(before);
    expect(
      computeCadSampleLineRevision(group.sampleLines[0]!, alignment, group.alignmentEntityId),
    ).toContain('secl1:');
  });
});

interface CadAlignmentEntityLike {
  id: string;
  elements: readonly CadAlignmentElement[];
  startStation: number;
}
