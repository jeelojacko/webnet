import { describe, expect, it } from 'vitest';

import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { buildCadSurface, computeCadSurfaceSourceRevision } from '../src/engine/cad/cadSurfaces';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import {
  createSurfaceAnalysisCache,
  type SurfaceAnalysisCache,
} from '../src/engine/cad/surfaceAnalysisCache';
import { updateAnalysisAppearance, updateAnalysisBands } from '../src/engine/cad/cadAnalysisMaps';
import { queryAnalysisAt } from '../src/engine/cad/cadAnalysisInquiry';
import { buildAnalysisDisplayLayers } from '../src/engine/cad/cadAnalysisView.service';
import type { CadProject, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';
import type {
  SurfaceAnalysisRequest,
  SurfaceAnalysisResultPayload,
  SurfaceWorkerResponseMessage,
} from '../src/workers/surfaceWorkerHandler';
import {
  createSurfaceWorkerHandler,
  runSurfaceAnalysisFromRequest,
} from '../src/workers/surfaceWorkerHandler';
import type { PendingSurfaceAnalysis } from '../src/workers/surfaceWorkerClient';
import {
  SurfaceAnalysisService,
  type SurfaceAnalysisTransport,
} from '../src/workers/surfaceAnalysisService';

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

const baseProject = (): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Analysis', units: 'm' });
  return {
    ...drawing.project,
    entities: [
      point('b1', 'B1', 0, 0, 0),
      point('b2', 'B2', 10, 0, 0),
      point('b3', 'B3', 10, 10, 10),
      point('b4', 'B4', 0, 10, 10),
      point('c1', 'C1', 0, 0, 2),
      point('c2', 'C2', 10, 0, 2),
      point('c3', 'C3', 10, 10, 12),
      point('c4', 'C4', 0, 10, 12),
      point('f1', 'F1', 20, 0, 5),
      point('f2', 'F2', 30, 0, 5),
      point('f3', 'F3', 30, 10, 5),
      point('f4', 'F4', 20, 10, 5),
    ],
    surfaces: [
      { id: 'base-1', name: 'Base', definition: { pointSource: { kind: 'points', pointEntityIds: ['b1', 'b2', 'b3', 'b4'] } }, cachedRevision: null },
      { id: 'cmp-1', name: 'Comparison', definition: { pointSource: { kind: 'points', pointEntityIds: ['c1', 'c2', 'c3', 'c4'] } }, cachedRevision: null },
      { id: 'flat-5', name: 'Flat5', definition: { pointSource: { kind: 'points', pointEntityIds: ['f1', 'f2', 'f3', 'f4'] } }, cachedRevision: null },
    ],
    volumeSurfaces: [
      { id: 'vol-1', name: 'Earthwork', baseSurfaceId: 'base-1', comparisonSurfaceId: 'cmp-1' },
    ],
    analysisMaps: [
      {
        id: 'elev-1',
        name: 'Elevation',
        source: { kind: 'surface', surfaceId: 'base-1', metric: 'elevation' },
        bands: [
          { id: 'low', lower: 0, upper: 5, color: '#2f6fd0' },
          { id: 'high', lower: 5, upper: 10, color: '#c85a3f' },
        ],
      },
      {
        id: 'flat-elev',
        name: 'Flat elevation',
        source: { kind: 'surface', surfaceId: 'flat-5', metric: 'elevation' },
        bands: [
          { id: 'low', lower: 0, upper: 5, color: '#2f6fd0' },
          { id: 'high', lower: 5, upper: 10, color: '#c85a3f' },
        ],
      },
      {
        id: 'slope-1',
        name: 'Slope',
        source: { kind: 'surface', surfaceId: 'flat-5', metric: 'slope-percent' },
        bands: [
          { id: 'gentle', lower: 0, upper: 10, color: '#3fa66a' },
          { id: 'steep', lower: 10, upper: 100, color: '#c85a3f' },
        ],
      },
      {
        id: 'depth-1',
        name: 'Depth',
        source: { kind: 'volume', volumeSurfaceId: 'vol-1', metric: 'signed-depth' },
        bands: [
          { id: 'cut', lower: -5, upper: 0, color: '#2f6fd0' },
          { id: 'fill', lower: 0, upper: 5, color: '#c85a3f' },
        ],
      },
    ],
  };
};

const flush = async (rounds = 10): Promise<void> => {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
};

class StubAnalysisTransport implements SurfaceAnalysisTransport {
  alive = true;
  readonly derivations: Array<{
    requestId: string;
    request: SurfaceAnalysisRequest;
    resolve: (_result: SurfaceAnalysisResultPayload | null) => void;
    reject: (_error: Error) => void;
  }> = [];
  readonly cancelled: string[] = [];
  private nextId = 0;

  deriveAnalysis(request: SurfaceAnalysisRequest): PendingSurfaceAnalysis {
    this.nextId += 1;
    const requestId = `areq-${this.nextId}`;
    let resolve!: (_result: SurfaceAnalysisResultPayload | null) => void;
    let reject!: (_error: Error) => void;
    const done = new Promise<SurfaceAnalysisResultPayload | null>((res, rej) => {
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

const payloadFor = (request: SurfaceAnalysisRequest): SurfaceAnalysisResultPayload => {
  const result = runSurfaceAnalysisFromRequest(request);
  if (result instanceof Promise) throw new Error('test engine must stay sync');
  return {
    analysisId: request.analysisId,
    revision: request.geometryRevision,
    metric: request.metric,
    empty: false,
    result,
  };
};

interface Harness {
  service: SurfaceAnalysisService;
  transport: StubAnalysisTransport;
  project: () => CadProject;
  setProject: (_project: CadProject) => void;
  setDrawingId: (_id: string) => void;
  analysisCache: SurfaceAnalysisCache;
  tinCache: ReturnType<typeof createCadSurfaceCache>;
}

const harness = (): Harness => {
  let project = baseProject();
  let drawingId = 'drawing-1';
  const tinCache = createCadSurfaceCache('scope-1');
  const analysisCache = createSurfaceAnalysisCache('scope-1');
  for (const surface of project.surfaces!) {
    const revision = computeCadSurfaceSourceRevision(project, surface);
    const built = buildCadSurface(project, surface);
    expect(built.outcome).toBe('ok');
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
  const transport = new StubAnalysisTransport();
  const service = new SurfaceAnalysisService({
    drawingId: 'drawing-1',
    getProject: () => project,
    getDrawingId: () => drawingId,
    tinCache,
    analysisCache,
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
    analysisCache,
    tinCache,
  };
};

const requestWith = (h: Harness, analysisId: string): SurfaceAnalysisRequest => {
  h.service.requestAnalysis(analysisId);
  return h.transport.derivations[h.transport.derivations.length - 1]!.request;
};

describe('surface analysis worker op', () => {
  it('late result for a superseded revision never posts', () => {
    const posted: SurfaceWorkerResponseMessage[] = [];
    const queue: Array<() => void> = [];
    const handler = createSurfaceWorkerHandler({
      loadBuilder: () => Promise.reject(new Error('unused')),
      loadAnalysisFn: () => Promise.resolve(runSurfaceAnalysisFromRequest),
      postMessage: (message) => {
        posted.push(message);
      },
      defer: (callback) => {
        queue.push(callback);
      },
    });
    const mesh = { points: [0, 0, 0, 10, 0, 0, 10, 10, 10, 0, 10, 10], triangles: [0, 1, 2, 0, 2, 3] };
    const bands = [{ id: 'low', lower: 0, upper: 5 }, { id: 'high', lower: 5, upper: 10 }];
    handler.handleMessage({
      type: 'analysis',
      requestId: 'a-1',
      request: {
        analysisId: 'elev-1', geometryRevision: 'arev1:aaa', metric: 'elevation',
        sourceKind: 'surface', bands, surfaceMesh: mesh, includeDisplay: false,
      },
    });
    handler.handleMessage({
      type: 'analysis',
      requestId: 'a-2',
      request: {
        analysisId: 'elev-1', geometryRevision: 'arev1:bbb', metric: 'elevation',
        sourceKind: 'surface', bands, surfaceMesh: mesh, includeDisplay: false,
      },
    });
    while (queue.length > 0) queue.shift()!();
    return flush().then(() => {
      const successes = posted.filter((message) => message.type === 'analysis-success');
      expect(successes).toHaveLength(1);
      expect(successes[0]).toMatchObject({ requestId: 'a-2', geometryRevision: 'arev1:bbb' });
    });
  });

  it('engine failure posts analysis-failure', () => {
    const posted: SurfaceWorkerResponseMessage[] = [];
    const handler = createSurfaceWorkerHandler({
      loadBuilder: () => Promise.reject(new Error('unused')),
      loadAnalysisFn: () => Promise.reject(new Error('boom')),
      postMessage: (message) => {
        posted.push(message);
      },
      defer: (callback) => callback(),
    });
    handler.handleMessage({
      type: 'analysis',
      requestId: 'a-1',
      request: {
        analysisId: 'x', geometryRevision: 'arev1:aaa', metric: 'elevation',
        sourceKind: 'surface', bands: [{ id: 'b', lower: 0, upper: 1 }], includeDisplay: false,
      },
    });
    return flush().then(() => {
      expect(posted).toHaveLength(1);
      expect(posted[0]).toMatchObject({ type: 'analysis-failure', error: 'boom' });
    });
  });
});

describe('surface analysis service', () => {
  it('computes elevation analysis and derives CURRENT', async () => {
    const h = harness();
    const request = requestWith(h, 'elev-1');
    expect(request.includeDisplay).toBe(true);
    h.transport.derivations[0]!.resolve(payloadFor(request));
    await flush();
    expect(h.service.statusOf('elev-1').status).toBe('CURRENT');
  });

  it('late superseded result loses; only the latest wins', async () => {
    const h = harness();
    const first = requestWith(h, 'elev-1');
    const revisionA = first.geometryRevision;
    // Threshold change moves the revision; the second request supersedes.
    const updated = updateAnalysisBands(h.project().analysisMaps!, 'elev-1', {
      bands: [
        { id: 'low', lower: 0, upper: 4, color: '#2f6fd0' },
        { id: 'high', lower: 4, upper: 10, color: '#c85a3f' },
      ],
    });
    expect(Array.isArray(updated)).toBe(true);
    h.setProject({ ...h.project(), analysisMaps: updated as CadProject['analysisMaps'] });
    const second = requestWith(h, 'elev-1');
    expect(second.geometryRevision).not.toBe(revisionA);
    // Late arrival for A resolves first but must never apply.
    h.transport.derivations[0]!.resolve(payloadFor(first));
    await flush();
    expect(h.analysisCache.get('elev-1', revisionA)).toBeUndefined();
    expect(h.service.statusOf('elev-1').status).not.toBe('CURRENT');
    h.transport.derivations[1]!.resolve(payloadFor(second));
    await flush();
    expect(h.service.statusOf('elev-1').status).toBe('CURRENT');
    expect(h.analysisCache.get('elev-1', second.geometryRevision)).toBeDefined();
  });

  it('cross-drawing result is discarded', async () => {
    const h = harness();
    const request = requestWith(h, 'elev-1');
    h.setDrawingId('drawing-2');
    h.transport.derivations[0]!.resolve(payloadFor(request));
    await flush();
    expect(h.analysisCache.get('elev-1', request.geometryRevision)).toBeUndefined();
  });

  it('color-only change keeps the revision and needs no worker call', async () => {
    const h = harness();
    const request = requestWith(h, 'elev-1');
    h.transport.derivations[0]!.resolve(payloadFor(request));
    await flush();
    expect(h.service.statusOf('elev-1').status).toBe('CURRENT');
    const before = h.service.geometryRevisionOf('elev-1');
    const calls = h.transport.derivations.length;
    const recolored = updateAnalysisAppearance(h.project().analysisMaps!, 'elev-1', {
      bandColors: { low: '#000000' },
    });
    expect(Array.isArray(recolored)).toBe(true);
    h.setProject({ ...h.project(), analysisMaps: recolored as CadProject['analysisMaps'] });
    expect(h.service.geometryRevisionOf('elev-1')).toBe(before);
    expect(h.service.requestAnalysis('elev-1')).toContain('already current');
    expect(h.transport.derivations).toHaveLength(calls);
    // Display recolors from cache with no recompute.
    const layers = buildAnalysisDisplayLayers(h.project(), h.tinCache, h.analysisCache);
    expect(layers).toHaveLength(1);
    expect(layers[0]!.bands.find((band) => band.bandId === 'low')!.color).toBe('#000000');
  });

  it('threshold change derives NEEDS_RECALC and stale never renders CURRENT', async () => {
    const h = harness();
    const request = requestWith(h, 'elev-1');
    h.transport.derivations[0]!.resolve(payloadFor(request));
    await flush();
    expect(h.service.statusOf('elev-1').status).toBe('CURRENT');
    const changed = updateAnalysisBands(h.project().analysisMaps!, 'elev-1', {
      bands: [
        { id: 'low', lower: 0, upper: 6, color: '#2f6fd0' },
        { id: 'high', lower: 6, upper: 10, color: '#c85a3f' },
      ],
    });
    h.setProject({ ...h.project(), analysisMaps: changed as CadProject['analysisMaps'] });
    const { status, stale } = h.service.statusOf('elev-1');
    expect(status).toBe('NEEDS_RECALC');
    expect(stale).toBe(true);
    // Retained stale quantities exist, but no layer renders for the map.
    expect(h.analysisCache.retained('elev-1')).toHaveLength(1);
    expect(buildAnalysisDisplayLayers(h.project(), h.tinCache, h.analysisCache)).toHaveLength(0);
  });

  it('failure derives FAILED and retry recovers to CURRENT', async () => {
    const h = harness();
    requestWith(h, 'elev-1');
    h.transport.derivations[0]!.reject(new Error('worker exploded'));
    await flush();
    expect(h.service.statusOf('elev-1').status).toBe('FAILED');
    requestWith(h, 'elev-1');
    const retry = h.transport.derivations[1]!.request;
    h.transport.derivations[1]!.resolve(payloadFor(retry));
    await flush();
    expect(h.service.statusOf('elev-1').status).toBe('CURRENT');
  });

  it('deleted analysis discards its cache and pending work', async () => {
    const h = harness();
    requestWith(h, 'elev-1');
    h.service.handleAnalysisDeleted('elev-1');
    h.setProject({ ...h.project(), analysisMaps: [] });
    // Late arrival after delete never applies.
    h.transport.derivations[0]!.resolve(payloadFor(h.transport.derivations[0]!.request));
    await flush();
    expect(h.analysisCache.retained('elev-1')).toHaveLength(0);
  });
});

describe('analysis inquiry oracles', () => {
  it('elevation inquiry reports value + band from source geometry', async () => {
    const h = harness();
    const def = h.project().analysisMaps!.find((entry) => entry.id === 'flat-elev')!;
    const mesh = h.tinCache.get('flat-5', computeCadSurfaceSourceRevision(h.project(), h.project().surfaces!.find((s) => s.id === 'flat-5')!))!;
    const first = queryAnalysisAt(def, { surface: mesh }, 25, 5);
    const second = queryAnalysisAt(def, { surface: mesh }, 25, 5);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ metric: 'elevation', elevation: 5 });
    // Exact shared edge 5.0 classifies into the UPPER band ([lower, upper) rule).
    expect(first && first.metric === 'elevation' ? first.band?.bandId : null).toBe('high');
    expect(queryAnalysisAt(def, { surface: mesh }, 0, 0)).toBeNull();
  });

  it('slope inquiry reports percent/degrees + band', () => {
    const h = harness();
    const def = h.project().analysisMaps!.find((entry) => entry.id === 'slope-1')!;
    const project = h.project();
    const mesh = h.tinCache.get('flat-5', computeCadSurfaceSourceRevision(project, project.surfaces!.find((s) => s.id === 'flat-5')!))!;
    const result = queryAnalysisAt(def, { surface: mesh }, 25, 5);
    expect(result).toMatchObject({ metric: 'slope-percent', percent: 0, degrees: 0 });
    expect(result && result.metric === 'slope-percent' ? result.band?.bandId : null).toBe('gentle');
  });

  it('depth inquiry reports CUT/FILL/BALANCED + band, with boundary determinism', () => {
    const h = harness();
    const project = h.project();
    const def = project.analysisMaps!.find((entry) => entry.id === 'depth-1')!;
    const revOf = (id: string): string =>
      computeCadSurfaceSourceRevision(project, project.surfaces!.find((s) => s.id === id)!);
    const at = (baseId: string, cmpId: string, x: number, y: number) =>
      queryAnalysisAt(def, { base: h.tinCache.get(baseId, revOf(baseId))!, comparison: h.tinCache.get(cmpId, revOf(cmpId))! }, x, y);
    // cmp is uniformly +2 above base: FILL in the upper band.
    const fill = at('base-1', 'cmp-1', 1, 1);
    expect(fill).toMatchObject({ metric: 'signed-depth', side: 'FILL' });
    expect(fill && fill.metric === 'signed-depth' ? fill.delta : NaN).toBeCloseTo(2, 9);
    expect(fill && fill.metric === 'signed-depth' ? fill.band?.bandId : null).toBe('fill');
    // Identical meshes: zero delta is BALANCED; exact edge 0.0 takes the upper band.
    const balanced = at('base-1', 'base-1', 1, 1);
    expect(balanced).toMatchObject({ metric: 'signed-depth', delta: 0, side: 'BALANCED' });
    expect(balanced && balanced.metric === 'signed-depth' ? balanced.band?.bandId : null).toBe('fill');
    // Reversed: CUT in the lower band.
    const cut = at('cmp-1', 'base-1', 1, 1);
    expect(cut).toMatchObject({ metric: 'signed-depth', side: 'CUT' });
    expect(cut && cut.metric === 'signed-depth' ? cut.band?.bandId : null).toBe('cut');
  });
});

describe('analysis display aggregation', () => {
  it('builds one aggregated path per band, CURRENT only', async () => {
    const h = harness();
    const request = requestWith(h, 'elev-1');
    h.transport.derivations[0]!.resolve(payloadFor(request));
    await flush();
    const layers = buildAnalysisDisplayLayers(h.project(), h.tinCache, h.analysisCache);
    expect(layers).toHaveLength(1);
    const layer = layers[0]!;
    expect(layer.stale).toBe(false);
    expect(layer.bands.map((band) => band.bandId)).toEqual(['low', 'high']);
    for (const band of layer.bands) {
      expect(band.d).not.toBe('');
      // One aggregated path string per band: ring count matches region count.
      const rings = (band.d.match(/M/g) ?? []).length;
      expect(rings).toBe(band.regionCount);
      expect(rings).toBeGreaterThan(0);
    }
  });
});
