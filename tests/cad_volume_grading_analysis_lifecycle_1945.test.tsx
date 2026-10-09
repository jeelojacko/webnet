/** @vitest-environment jsdom */
/**
 * STRUCT-194.5 — `useSurveyCadVolumeGradingAnalysisLifecycle` coverage.
 *
 * Drives the REAL extracted hook with the REAL production services and only
 * the worker transport mocked (the same `surfaceWorkerClient` module seam the
 * #185 / #194.4 suites use), pinning the pre-extraction contract:
 *   - one cache / service per drawing id, identity-stable across unrelated
 *     rerenders (no per-pointer recreation);
 *   - a drawing switch builds fresh services and disposes the old ones;
 *   - every service's worker path resolves the SAME
 *     `src/workers/surfaceWorker.ts` module after the move into
 *     `src/hooks/surveyCad/`; a missing `Worker` falls back to null;
 *   - the reconciliation sweep is keyed on the project reference (fires on a
 *     definition/target/criteria edit — never on an unrelated rerender) and
 *     never auto-starts Calculate;
 *   - Calculate is explicit only for volume/grading/analysis; a stale worker
 *     result is never promoted CURRENT.
 */
import React, { act, useEffect, useImperativeHandle, useMemo, useState, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakePendingEntry {
  kind: string;
  requestId: string;
  resolve: (_value: unknown) => void;
  reject: (_error: unknown) => void;
}

const transportState = vi.hoisted(() => ({
  workerUrls: [] as string[],
  requests: [] as FakePendingEntry[],
  nextId: 0,
}));

vi.mock('../src/workers/surfaceWorkerClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/workers/surfaceWorkerClient')>();
  const pending = (kind: string): { requestId: string; done: Promise<unknown>; cancel: () => void } => {
    const requestId = `${kind}-${transportState.nextId}`;
    transportState.nextId += 1;
    let resolve!: (_value: unknown) => void;
    let reject!: (_error: unknown) => void;
    const done = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    done.catch(() => undefined);
    transportState.requests.push({ kind, requestId, resolve, reject });
    return { requestId, done, cancel: () => undefined };
  };
  class FakeSurfaceWorkerClient {
    readonly alive = true;
    constructor(worker: { url?: string }) {
      if (typeof worker?.url === 'string') transportState.workerUrls.push(worker.url);
    }
    deriveVolume(): { requestId: string; done: Promise<unknown>; cancel: () => void } {
      return pending('volume');
    }
    deriveGrading(): { requestId: string; done: Promise<unknown>; cancel: () => void } {
      return pending('grading');
    }
    deriveGroupGrading(): { requestId: string; done: Promise<unknown>; cancel: () => void } {
      return pending('group');
    }
    deriveAnalysis(): { requestId: string; done: Promise<unknown>; cancel: () => void } {
      return pending('analysis');
    }
    cancel(): void {}
    dispose(): void {}
  }
  return { ...actual, SurfaceWorkerClient: FakeSurfaceWorkerClient };
});

import type { CadFeatureLineEntity, CadProject, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';
import type { CadVolumeResult } from '../src/engine/cad/cadTypes';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { createCadSurfaceVolumeCache } from '../src/engine/cad/surfaceVolumeCache';
import { createCadGradingCache } from '../src/engine/cad/grading/gradingCache';
import { createCadGradingGroupCache } from '../src/engine/cad/grading/gradingGroupCache';
import { generateAnalysisBands } from '../src/engine/cad/cadAnalysisMaps';
import { SurfaceVolumeService } from '../src/workers/surfaceVolumeService';
import { SurfaceGradingService } from '../src/workers/surfaceGradingService';
import { SurfaceAnalysisService } from '../src/workers/surfaceAnalysisService';
import {
  useSurveyCadVolumeGradingAnalysisLifecycle,
  type SurveyCadVolumeGradingAnalysisLifecycle,
} from '../src/hooks/surveyCad/useSurveyCadVolumeGradingAnalysisLifecycle';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeWorker {
  readonly url: string;
  constructor(url: string | URL) {
    this.url = String(url);
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  postMessage(): void {}
  terminate(): void {}
}
(globalThis as { Worker?: unknown }).Worker = FakeWorker;

const point = (id: string, x: number, y: number, z: number): CadSurveyPointEntity => ({
  id,
  type: 'survey-point',
  layerId: 'points',
  visible: true,
  locked: false,
  stationId: id,
  x,
  y,
  z,
  pointClass: 'free',
  source: 'parsed-input',
});

const featureLine = (): CadFeatureLineEntity => ({
  id: 'fl-1',
  type: 'feature-line',
  layerId: 'general',
  visible: true,
  locked: false,
  name: 'FL',
  vertices: [
    { id: 'fv-a', x: 0, y: 5, z: 10 },
    { id: 'fv-b', x: 10, y: 5, z: 10 },
  ],
});

const baseProject = (): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Lifecycle', units: 'm' });
  const generatedBands = generateAnalysisBands(3, 0, 12);
  if ('error' in generatedBands) throw new Error(generatedBands.error);
  return {
    ...drawing.project,
    entities: [
      point('pt-1', 0, 0, 0),
      point('pt-2', 10, 0, 4),
      point('pt-3', 10, 10, 8),
      point('pt-4', 0, 10, 12),
      point('pt-b1', 0, 0, 0),
      point('pt-b2', 10, 0, 0),
      point('pt-b3', 10, 10, 0),
      point('pt-b4', 0, 10, 0),
      point('pt-c1', 0, 0, 2),
      point('pt-c2', 10, 0, 2),
      point('pt-c3', 10, 10, 2),
      point('pt-c4', 0, 10, 2),
      featureLine(),
    ],
    surfaces: [
      { id: 'srf-1', name: 'Pond', definition: { pointSource: { kind: 'points', pointEntityIds: ['pt-1', 'pt-2', 'pt-3', 'pt-4'] } }, cachedRevision: null },
      { id: 'srf-base', name: 'Base', definition: { pointSource: { kind: 'points', pointEntityIds: ['pt-b1', 'pt-b2', 'pt-b3', 'pt-b4'] } }, cachedRevision: null },
      { id: 'srf-cmp', name: 'Design', definition: { pointSource: { kind: 'points', pointEntityIds: ['pt-c1', 'pt-c2', 'pt-c3', 'pt-c4'] } }, cachedRevision: null },
    ],
    volumeSurfaces: [
      { id: 'vol-1', name: 'Earthwork', baseSurfaceId: 'srf-base', comparisonSurfaceId: 'srf-cmp' },
    ],
    gradings: [
      {
        id: 'grad-1',
        name: 'G',
        sourceFeatureLineId: 'fl-1',
        sourceCourse: { vertexAId: 'fv-a', vertexBId: 'fv-b' },
        targetSurfaceId: 'srf-1',
        side: 'left',
        criterion: { kind: 'fixed', gradeRatio: -0.5 },
        maxSearchDistance: 1000,
        curveChordTolerance: 0.01,
      },
    ],
    analysisMaps: [
      {
        id: 'map-1',
        name: 'Elev',
        source: { kind: 'surface', surfaceId: 'srf-1', metric: 'elevation' },
        bands: generatedBands.bands,
      },
    ],
  };
};

const seedTin = (project: CadProject, cache: ReturnType<typeof createCadSurfaceCache>): void => {
  for (const surface of project.surfaces ?? []) {
    const built = buildCadSurface(project, surface);
    if (built.outcome !== 'ok') throw new Error(`fixture build failed for ${surface.id}`);
    cache.set(surface.id, built.revision, {
      revision: built.revision,
      points: built.points,
      triangles: built.triangles,
      stats: built.stats,
      grid: built.grid,
      adjacency: built.adjacency,
      edgeKinds: built.edgeKinds,
    });
  }
};

const volumeResult = (): CadVolumeResult => ({
  baseSurfaceId: 'srf-base',
  comparisonSurfaceId: 'srf-cmp',
  revision: 'vrev1:resolved',
  overlapArea: 10,
  cutArea: 10,
  fillArea: 0,
  cutVolume: 10,
  fillVolume: 0,
  netVolume: -10,
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

const flush = async (rounds = 12): Promise<void> => {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
};

const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flush();
};

interface HookControls {
  setProject: (_project: CadProject) => void;
  setDrawingId: (_drawingId: string) => void;
  bump: () => void;
  surfaceCache: () => ReturnType<typeof createCadSurfaceCache>;
}

interface HarnessProps {
  ref: RefObject<HookControls | null>;
  initialProject: CadProject;
  initialDrawingId: string;
  onApi: (_api: SurveyCadVolumeGradingAnalysisLifecycle) => void;
}

const Harness: React.FC<HarnessProps> = ({
  ref,
  initialProject,
  initialDrawingId,
  onApi,
}) => {
  const [project, setProject] = useState(initialProject);
  const [drawingId, setDrawingId] = useState(initialDrawingId);
  const [, setTick] = useState(0);
  const [, setVolumeVersion] = useState(0);
  const [gradingVersion, setGradingVersion] = useState(0);
  const [, setAnalysisVersion] = useState(0);
  const [, setFileStatusText] = useState('');
  const surfaceCache = useMemo(() => createCadSurfaceCache(drawingId), [drawingId]);
  const volumeCache = useMemo(() => createCadSurfaceVolumeCache(drawingId), [drawingId]);
  const gradingCache = useMemo(() => createCadGradingCache(drawingId), [drawingId]);
  const groupCache = useMemo(() => createCadGradingGroupCache(drawingId), [drawingId]);
  const activeProjectForBuildsRef = { current: project } as { current: CadProject };
  const drawingIdForBuildsRef = { current: drawingId } as { current: string };
  useImperativeHandle(ref, () => ({
    setProject,
    setDrawingId,
    bump: () => setTick((value) => value + 1),
    surfaceCache: () => surfaceCache,
  }));
  const api = useSurveyCadVolumeGradingAnalysisLifecycle({
    drawingId,
    project,
    caches: { surfaceCache, volumeCache, gradingCache, groupCache },
    state: { gradingVersion, setVolumeVersion, setGradingVersion, setAnalysisVersion },
    activeProjectForBuildsRef,
    drawingIdForBuildsRef,
    setFileStatusText,
  });
  useEffect(() => {
    onApi(api);
  });
  return null;
};

interface Mounted {
  root: Root;
  controls: RefObject<HookControls | null>;
  api: () => SurveyCadVolumeGradingAnalysisLifecycle;
}

const mount = async (project: CadProject, drawingId = 'd1'): Promise<Mounted> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const controls: RefObject<HookControls | null> = { current: null };
  const holder: { current: SurveyCadVolumeGradingAnalysisLifecycle | null } = { current: null };
  await act(async () => {
    root.render(
      <Harness
        ref={controls}
        initialProject={project}
        initialDrawingId={drawingId}
        onApi={(api) => {
          holder.current = api;
        }}
      />,
    );
  });
  await act(async () => {
    await flush();
  });
  return {
    root,
    controls,
    api: () => {
      if (!holder.current) throw new Error('hook not mounted');
      return holder.current;
    },
  };
};

beforeEach(() => {
  transportState.workerUrls.length = 0;
  transportState.requests.length = 0;
  transportState.nextId = 0;
  (globalThis as { Worker?: unknown }).Worker = FakeWorker;
  document.body.innerHTML = '';
});

describe('STRUCT-194.5 volume/grading/analysis lifecycle hook', () => {
  it('keeps services + snapshot inputs identity-stable across unrelated rerenders and starts nothing', async () => {
    const view = await mount(baseProject());
    const first = view.api();
    await act(async () => {
      view.controls.current!.bump();
      view.controls.current!.bump();
    });
    const again = view.api();
    expect(again.volumeService).toBe(first.volumeService);
    expect(again.gradingService).toBe(first.gradingService);
    expect(again.analysisPlane).toBe(first.analysisPlane);
    expect(again.gradingInputs).toBe(first.gradingInputs);
    expect(again.groupInputs).toBe(first.groupInputs);
    // Manual Calculate only: mounting + unrelated renders never touch a worker.
    expect(transportState.workerUrls).toHaveLength(0);
    expect(transportState.requests).toHaveLength(0);
    view.root.unmount();
  });

  it('creates fresh services on a drawing switch and disposes the old ones', async () => {
    const volumeDispose = vi.spyOn(SurfaceVolumeService.prototype, 'dispose');
    const gradingDispose = vi.spyOn(SurfaceGradingService.prototype, 'dispose');
    const analysisDispose = vi.spyOn(SurfaceAnalysisService.prototype, 'dispose');
    try {
      const view = await mount(baseProject(), 'd1');
      const before = view.api();
      await act(async () => {
        view.controls.current!.setDrawingId('d2');
      });
      const after = view.api();
      expect(after.volumeService).not.toBe(before.volumeService);
      expect(after.gradingService).not.toBe(before.gradingService);
      expect(after.analysisPlane).not.toBe(before.analysisPlane);
      expect(volumeDispose).toHaveBeenCalled();
      expect(gradingDispose).toHaveBeenCalled();
      expect(analysisDispose).toHaveBeenCalled();
      view.root.unmount();
    } finally {
      volumeDispose.mockRestore();
      gradingDispose.mockRestore();
      analysisDispose.mockRestore();
    }
  });

  it('routes every service worker construction to src/workers/surfaceWorker.ts', async () => {
    const view = await mount(baseProject());
    seedTin(baseProject(), view.controls.current!.surfaceCache());
    await act(async () => {
      view.api().volumeService.requestVolume('vol-1');
      view.api().gradingService.requestGrading('grad-1');
      view.api().analysisPlane.requestCalculate('map-1');
      await settle();
    });
    expect(transportState.workerUrls).toHaveLength(3);
    for (const url of transportState.workerUrls) {
      expect(new URL(url).pathname.endsWith('/src/workers/surfaceWorker.ts')).toBe(true);
    }
    // volume + grading + analysis each reached the transport exactly once.
    expect(transportState.requests.map((entry) => entry.kind).sort()).toEqual([
      'analysis',
      'grading',
      'volume',
    ]);
    view.root.unmount();
  });

  it('falls back to null transport when Worker is unavailable (analysis sync fallback, volume blocked)', async () => {
    (globalThis as { Worker?: unknown }).Worker = undefined;
    const view = await mount(baseProject());
    const project = baseProject();
    seedTin(project, view.controls.current!.surfaceCache());
    await act(async () => {
      const analysisMessage = view.api().analysisPlane.requestCalculate('map-1');
      const volumeMessage = view.api().volumeService.requestVolume('vol-1');
      await settle();
      expect(analysisMessage).toContain('calculated');
      expect(volumeMessage).toContain('worker unavailable');
    });
    expect(transportState.workerUrls).toHaveLength(0);
    view.root.unmount();
  });

  it('reconciles pending grading work on a project edit but never on an unrelated rerender', async () => {
    const reconcile = vi.spyOn(SurfaceGradingService.prototype, 'reconcilePendingWithProject');
    try {
      const project = baseProject();
      const view = await mount(project);
      reconcile.mockClear();
      await act(async () => {
        view.controls.current!.bump();
      });
      expect(reconcile).not.toHaveBeenCalled();
      await act(async () => {
        view.controls.current!.setProject({
          ...project,
          gradings: project.gradings!.map((grading) => ({
            ...grading,
            criterion: { kind: 'fixed' as const, gradeRatio: -0.25 },
          })),
        });
      });
      expect(reconcile).toHaveBeenCalledTimes(1);
      view.root.unmount();
    } finally {
      reconcile.mockRestore();
    }
  });

  it('never promotes a stale volume worker result to CURRENT and cancels in-flight work on source rebuild', async () => {
    const view = await mount(baseProject());
    seedTin(baseProject(), view.controls.current!.surfaceCache());
    await act(async () => {
      view.api().volumeService.requestVolume('vol-1');
      await settle();
    });
    expect(transportState.requests).toHaveLength(1);
    const pending = transportState.requests[0]!;
    expect(pending.kind).toBe('volume');
    // A late result carrying a revision that no longer matches is discarded.
    await act(async () => {
      pending.resolve({ ...volumeResult(), revision: 'vrev1:stale' });
      await settle();
    });
    const api = view.api();
    expect(api.volumeService.buildingVolumeIds().size).toBe(0);
    expect(api.volumeService.statusOf('vol-1').status).not.toBe('CURRENT');
    // Source rebuild cancels in-flight work without auto-starting a new request.
    await act(async () => {
      api.volumeService.requestVolume('vol-1');
      await settle();
    });
    const before = transportState.requests.length;
    api.volumeService.notifyMeshBuilt('srf-base');
    await act(async () => {
      await settle();
    });
    expect(api.volumeService.buildingVolumeIds().size).toBe(0);
    expect(transportState.requests.length).toBe(before);
    view.root.unmount();
  });

  it('retires an in-flight analysis result on a source rebuild without auto-starting', async () => {
    const view = await mount(baseProject());
    seedTin(baseProject(), view.controls.current!.surfaceCache());
    await act(async () => {
      view.api().analysisPlane.requestCalculate('map-1');
      await settle();
    });
    expect(transportState.requests).toHaveLength(1);
    const before = transportState.requests.length;
    view.api().analysisPlane.notifySourceRebuilt('srf-1');
    await act(async () => {
      await settle();
    });
    expect(transportState.requests.length).toBe(before);
    view.root.unmount();
  });
});
