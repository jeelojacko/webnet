/** @vitest-environment jsdom */
/**
 * STRUCT-194.4 — `useSurveyCadContourLifecycle` coverage.
 *
 * Drives the REAL production hook with a mocked worker transport that holds
 * contour requests open, so the extracted contour lifecycle keeps the #185
 * contract:
 *   - auto-derive once per missing eligible set; completion (which bumps
 *     `contourVersion`) never re-triggers the sweep;
 *   - revision-aware A→B supersession under a pending request (late A is
 *     discarded, B converges to CURRENT);
 *   - CURRENT-only when the TIN is fresh, newest retained stale set for
 *     display when the source revision moved without a rebuilt TIN;
 *   - the scene-input object is identity-stable unless project/version
 *     changes;
 *   - duplicate style ids resolve first-wins;
 *   - dispose on unmount.
 */
import React, { act, useEffect, useImperativeHandle, useRef, useState, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeContourEntry {
  requestId: string;
  surfaceId: string;
  surfaceRevision: string;
  contourGeometryRevision: string;
  cancelled: boolean;
  resolve: (_set: unknown) => void;
  reject: (_error: unknown) => void;
}

const transportState = vi.hoisted(() => ({
  requests: [] as FakeContourEntry[],
  nextId: 0,
}));

vi.mock('../src/workers/surfaceWorkerClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/workers/surfaceWorkerClient')>();
  class FakeSurfaceWorkerClient {
    readonly alive = true;
    deriveContours(request: {
      surfaceId: string;
      surfaceRevision: string;
      contourGeometryRevision: string;
    }): { requestId: string; done: Promise<unknown>; cancel: () => void } {
      const requestId = `creq-${transportState.nextId}`;
      transportState.nextId += 1;
      let resolve!: (_set: unknown) => void;
      let reject!: (_error: unknown) => void;
      const done = new Promise<unknown>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      const entry: FakeContourEntry = {
        requestId,
        surfaceId: request.surfaceId,
        surfaceRevision: request.surfaceRevision,
        contourGeometryRevision: request.contourGeometryRevision,
        cancelled: false,
        resolve,
        reject,
      };
      transportState.requests.push(entry);
      return { requestId, done, cancel: () => { entry.cancelled = true; } };
    }
    cancel(requestId: string): void {
      const entry = transportState.requests.find((candidate) => candidate.requestId === requestId);
      if (entry) entry.cancelled = true;
    }
    dispose(): void {}
  }
  return { ...actual, SurfaceWorkerClient: FakeSurfaceWorkerClient };
});

import type { CadProject, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { computeCadSurfaceSourceRevision, buildCadSurface } from '../src/engine/cad/cadSurfaces';
import { applySurfaceBuildSuccess, createCadSurfaceCache, type CadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { SURFACE_STYLE_CONTOURS_ID } from '../src/engine/cad/cadSurfaceStyles';
import { contourLevelSpecFromStyle } from '../src/engine/cad/cadSurfaceContourView';
import { computeContourGeometryRevision, toContourGeometrySpec } from '../src/engine/cad/surfaceContours/contourStyleRevision';
import type { CadSurfaceContourSet } from '../src/engine/cad/surfaceContours/contourTypes';
import { SurfaceContourService } from '../src/workers/surfaceContourService';
import {
  useSurveyCadContourLifecycle,
  type SurveyCadContourLifecycle,
} from '../src/hooks/surveyCad/useSurveyCadContourLifecycle';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (typeof (globalThis as { Worker?: unknown }).Worker === 'undefined') {
  (globalThis as { Worker?: unknown }).Worker = class {};
}

const SURFACE_ID = 'surf:contour';

const point = (
  id: string,
  x: number,
  y: number,
  z: number,
): CadSurveyPointEntity => ({
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

const makeProject = (zOffset = 0, surfaceStyles?: CadProject['surfaceStyles']): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Contour', units: 'm' });
  const base: CadProject = {
    ...drawing.project,
    entities: [
      point('pt-1', 0, 0, 10 + zOffset),
      point('pt-2', 10, 0, 11 + zOffset),
      point('pt-3', 10, 10, 12 + zOffset),
      point('pt-4', 0, 10, 13 + zOffset),
    ],
    surfaces: [
      {
        id: SURFACE_ID,
        name: 'Contour Site',
        styleId: SURFACE_STYLE_CONTOURS_ID,
        definition: {
          pointSource: { kind: 'points', pointEntityIds: ['pt-1', 'pt-2', 'pt-3', 'pt-4'] },
        },
        cachedRevision: null,
      },
    ],
  };
  return surfaceStyles ? { ...base, surfaceStyles } : base;
};

const withInterval = (project: CadProject, interval: number): CadProject => ({
  ...project,
  surfaceStyles: (project.surfaceStyles ?? []).map((style) =>
    style.id === SURFACE_STYLE_CONTOURS_ID ? { ...style, minorContourInterval: interval } : style,
  ),
});

const seedTin = (project: CadProject, cache: CadSurfaceCache): string => {
  const surface = project.surfaces![0]!;
  const revision = computeCadSurfaceSourceRevision(project, surface);
  const result = buildCadSurface(project, surface);
  applySurfaceBuildSuccess(project, cache, surface.id, revision, result);
  return revision;
};

const geometryRevisionForStyle = (style: CadProject['surfaceStyles'] extends (infer T)[] | undefined ? T : never): string => {
  const spec = contourLevelSpecFromStyle(style);
  if (!spec) throw new Error('contours style expected');
  return computeContourGeometryRevision(toContourGeometrySpec(spec));
};

const geometryRevisionFor = (project: CadProject): string => {
  const surface = project.surfaces![0]!;
  const style = (project.surfaceStyles ?? []).find((entry) => entry.id === surface.styleId)!;
  return geometryRevisionForStyle(style);
};

const flush = async (rounds = 12): Promise<void> => {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
};

const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flush();
};

const fakeSet = (entry: FakeContourEntry): CadSurfaceContourSet => ({
  surfaceId: entry.surfaceId,
  surfaceRevision: entry.surfaceRevision,
  styleRevision: entry.contourGeometryRevision,
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

interface ContourControls {
  setProject: (_project: CadProject) => void;
  setBuildVersion: (_value: number) => void;
  bump: () => void;
}

interface HarnessProps {
  ref: RefObject<ContourControls | null>;
  initialProject: CadProject;
  cache: CadSurfaceCache;
  setFileStatusText: (_text: string) => void;
  onApi: (_api: SurveyCadContourLifecycle) => void;
}

const Harness: React.FC<HarnessProps> = ({ ref, initialProject, cache, setFileStatusText, onApi }) => {
  const [project, setProject] = useState(initialProject);
  const [buildVersion, setBuildVersion] = useState(0);
  // A dedicated unrelated counter so `bump` forces a REAL React render
  // instead of bailing out on an unchanged value.
  const [, forceUnrelatedRender] = useState(0);
  const activeProjectForBuildsRef = useRef(project);
  // eslint-disable-next-line react-hooks/refs
  activeProjectForBuildsRef.current = project;
  const drawingIdForBuildsRef = useRef('d1');
  // eslint-disable-next-line react-hooks/refs
  drawingIdForBuildsRef.current = 'd1';
  useImperativeHandle(ref, () => ({
    setProject,
    setBuildVersion,
    bump: () => forceUnrelatedRender((value) => value + 1),
  }));
  const api = useSurveyCadContourLifecycle({
    activeDrawingId: 'd1',
    cadProject: project,
    surfaceCache: cache,
    surfaceBuildVersion: buildVersion,
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
  controls: RefObject<ContourControls | null>;
  api: () => SurveyCadContourLifecycle;
}

const mount = async (project: CadProject, cache: CadSurfaceCache): Promise<Mounted> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const controls: RefObject<ContourControls | null> = { current: null };
  const holder: { current: SurveyCadContourLifecycle | null } = { current: null };
  await act(async () => {
    root.render(
      <Harness
        ref={controls}
        initialProject={project}
        cache={cache}
        setFileStatusText={vi.fn()}
        onApi={(api) => {
          holder.current = api;
        }}
      />,
    );
  });
  await act(async () => {
    await settle();
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
  transportState.requests.length = 0;
  transportState.nextId = 0;
  document.body.innerHTML = '';
});

describe('STRUCT-194.4 contour lifecycle hook', () => {
  it('auto-derives once, converges after completion, and does not re-trigger on contourVersion bumps', async () => {
    const project = makeProject();
    const cache = createCadSurfaceCache('d1');
    const revision = seedTin(project, cache);
    const view = await mount(project, cache);
    expect(transportState.requests).toHaveLength(1);
    const requestA = transportState.requests[0]!;
    expect(requestA.surfaceRevision).toBe(revision);
    expect(requestA.contourGeometryRevision).toBe(geometryRevisionFor(project));

    await act(async () => {
      requestA.resolve(fakeSet(requestA));
      await flush();
    });
    expect(view.api().contourService.pendingContourRequest(SURFACE_ID)).toBeNull();
    expect(view.api().contourCache.get(SURFACE_ID, revision, requestA.contourGeometryRevision)).toBeDefined();

    // Completion bumped contourVersion; an unrelated render must not re-request.
    await act(async () => {
      view.controls.current!.bump();
      await settle();
    });
    expect(transportState.requests).toHaveLength(1);
    view.root.unmount();
  });

  it('supersedes A with B under a pending request and converges to B only', async () => {
    const projectA = makeProject();
    const cache = createCadSurfaceCache('d1');
    const revision = seedTin(projectA, cache);
    const view = await mount(projectA, cache);
    const requestA = transportState.requests[0]!;
    const geometryA = geometryRevisionFor(projectA);

    const projectB = withInterval(projectA, 2);
    await act(async () => {
      view.controls.current!.setProject(projectB);
      await settle();
    });
    expect(transportState.requests).toHaveLength(2);
    const requestB = transportState.requests[1]!;
    const geometryB = geometryRevisionFor(projectB);
    expect(geometryB).not.toBe(geometryA);
    expect(requestA.cancelled).toBe(true);
    expect(requestB.cancelled).toBe(false);

    // Stale A completes late: discarded; B stays pending.
    await act(async () => {
      requestA.resolve(fakeSet(requestA));
      await flush();
    });
    expect(transportState.requests).toHaveLength(2);
    expect(view.api().contourService.pendingContourRequest(SURFACE_ID)).toEqual({
      revision,
      geometryRevision: geometryB,
    });
    expect(view.api().contourCache.get(SURFACE_ID, revision, geometryA)).toBeUndefined();

    await act(async () => {
      requestB.resolve(fakeSet(requestB));
      await flush();
    });
    expect(view.api().contourService.pendingContourRequest(SURFACE_ID)).toBeNull();
    expect(view.api().contourCache.get(SURFACE_ID, revision, geometryB)).toBeDefined();
    expect(view.api().contourCache.get(SURFACE_ID, revision, geometryA)).toBeUndefined();
    view.root.unmount();
  });

  it('keeps B CURRENT when B completes first and stale A arrives late', async () => {
    const projectA = makeProject();
    const cache = createCadSurfaceCache('d1');
    const revision = seedTin(projectA, cache);
    const view = await mount(projectA, cache);
    const requestA = transportState.requests[0]!;
    const geometryA = geometryRevisionFor(projectA);

    const projectB = withInterval(projectA, 2);
    await act(async () => {
      view.controls.current!.setProject(projectB);
      await settle();
    });
    expect(transportState.requests).toHaveLength(2);
    const requestB = transportState.requests[1]!;
    const geometryB = geometryRevisionFor(projectB);
    expect(geometryB).not.toBe(geometryA);
    expect(requestA.cancelled).toBe(true);
    expect(requestB.cancelled).toBe(false);

    // B completes first: CURRENT becomes B only.
    await act(async () => {
      requestB.resolve(fakeSet(requestB));
      await flush();
    });
    expect(view.api().contourService.pendingContourRequest(SURFACE_ID)).toBeNull();
    expect(view.api().contourCache.get(SURFACE_ID, revision, geometryB)).toBeDefined();
    expect(view.api().contourCache.get(SURFACE_ID, revision, geometryA)).toBeUndefined();

    // Stale A arrives late: discarded — B stays CURRENT and A is never cached.
    await act(async () => {
      requestA.resolve(fakeSet(requestA));
      await flush();
    });
    expect(transportState.requests).toHaveLength(2);
    expect(view.api().contourService.pendingContourRequest(SURFACE_ID)).toBeNull();
    expect(view.api().contourCache.get(SURFACE_ID, revision, geometryB)).toBeDefined();
    expect(view.api().contourCache.get(SURFACE_ID, revision, geometryA)).toBeUndefined();

    // An unrelated render after A settles must not re-request (converged).
    await act(async () => {
      view.controls.current!.bump();
      await settle();
    });
    expect(transportState.requests).toHaveLength(2);
    expect(view.api().contourService.pendingContourRequest(SURFACE_ID)).toBeNull();
    expect(view.api().surfaceContourInputs.getContours(SURFACE_ID)?.set.styleRevision).toBe(geometryB);
    view.root.unmount();
  });

  it('shows CURRENT when the TIN is fresh and the newest retained stale set when the TIN revision moved', async () => {
    const projectA = makeProject();
    const cache = createCadSurfaceCache('d1');
    const revisionA = seedTin(projectA, cache);
    const view = await mount(projectA, cache);
    const requestA = transportState.requests[0]!;
    await act(async () => {
      requestA.resolve(fakeSet(requestA));
      await flush();
    });
    expect(view.api().surfaceContourInputs.getContours(SURFACE_ID)?.set).toBe(
      view.api().contourCache.get(SURFACE_ID, revisionA, requestA.contourGeometryRevision),
    );

    // Source revision moves (a point edit) without a rebuilt TIN: no new
    // request, and the scene falls back to the retained stale set.
    const projectB = makeProject(5);
    const revisionB = computeCadSurfaceSourceRevision(projectB, projectB.surfaces![0]!);
    expect(revisionB).not.toBe(revisionA);
    await act(async () => {
      view.controls.current!.setProject(projectB);
      await settle();
    });
    expect(transportState.requests).toHaveLength(1);
    const stale = view.api().surfaceContourInputs.getContours(SURFACE_ID);
    expect(stale?.set.surfaceRevision).toBe(revisionA);

    // Rebuild the TIN at the new revision + advance the build epoch: the sweep
    // requests B for the moved revision.
    seedTin(projectB, cache);
    await act(async () => {
      view.controls.current!.setBuildVersion(1);
      await settle();
    });
    expect(transportState.requests).toHaveLength(2);
    const requestB = transportState.requests[1]!;
    expect(requestB.surfaceRevision).toBe(revisionB);
    expect(view.api().contourCache.get(SURFACE_ID, revisionA, requestA.contourGeometryRevision)).toBeDefined();

    await act(async () => {
      requestB.resolve(fakeSet(requestB));
      await flush();
    });
    const current = view.api().surfaceContourInputs.getContours(SURFACE_ID);
    expect(current?.set.surfaceRevision).toBe(revisionB);
    expect(current?.set.styleRevision).toBe(requestB.contourGeometryRevision);
    view.root.unmount();
  });

  it('keeps the scene-input object identity stable across unrelated renders and disposes on unmount', async () => {
    const disposeSpy = vi.spyOn(SurfaceContourService.prototype, 'dispose');
    try {
      const project = makeProject();
      const cache = createCadSurfaceCache('d1');
      seedTin(project, cache);
      const view = await mount(project, cache);
      const first = view.api().surfaceContourInputs;
      await act(async () => {
        view.controls.current!.bump();
      });
      expect(view.api().surfaceContourInputs).toBe(first);
      await act(async () => {
        view.root.unmount();
      });
      expect(disposeSpy).toHaveBeenCalled();
    } finally {
      disposeSpy.mockRestore();
    }
  });

  it('resolves duplicate style ids first-wins in the auto-derive sweep', async () => {
    const base = makeProject();
    const template = (base.surfaceStyles ?? []).find((style) => style.id === SURFACE_STYLE_CONTOURS_ID)!;
    const duplicated: CadProject['surfaceStyles'] = [
      { ...template, minorContourInterval: 2 },
      { ...template, minorContourInterval: 7 },
    ];
    const project = makeProject(0, duplicated);
    const cache = createCadSurfaceCache('d1');
    seedTin(project, cache);
    await mount(project, cache);
    expect(transportState.requests).toHaveLength(1);
    expect(transportState.requests[0]!.contourGeometryRevision).toBe(geometryRevisionForStyle(duplicated[0]!));
    expect(transportState.requests[0]!.contourGeometryRevision).not.toBe(geometryRevisionForStyle(duplicated[1]!));
  });
});
