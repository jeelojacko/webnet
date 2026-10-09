/** @vitest-environment jsdom */
/**
 * STRUCT-194.4 — `useSurveyCadSurfaceBuildLifecycle` coverage.
 *
 * Drives the REAL production hook with a mocked worker transport (the same
 * module seam the #185 suites use) so the extracted surface-build lifecycle is
 * pinned to the pre-extraction contract:
 *   - one cache / revision index / service per drawing id, identity-stable
 *     across unrelated rerenders;
 *   - the three live refs mirror the latest project / drawing / sessions every
 *     render;
 *   - a drawing switch builds a new cache + service and disposes the old one;
 *   - the built-revision history stays bounded (current + ≤1 previous);
 *   - a missing Worker falls back to the bounded sync build (no crash);
 *   - the worker URL resolves the SAME `src/workers/surfaceWorker.ts` module
 *     after the move into `src/hooks/surveyCad/`.
 */
import React, { act, useEffect, useImperativeHandle, useState, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted state for the mocked worker client (usable inside the `vi.mock`
// factory, which Vitest hoists above the imports).
const transportState = vi.hoisted(() => ({
  workerUrls: [] as string[],
  nextId: 0,
}));

vi.mock('../src/workers/surfaceWorkerClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/workers/surfaceWorkerClient')>();
  class FakeSurfaceWorkerClient {
    readonly alive = true;
    constructor(port: { url?: string }) {
      if (typeof port?.url === 'string') transportState.workerUrls.push(port.url);
    }
    build(request: import('../src/engine/cad/cadSurfaceTypes').SurfaceBuildRequest): {
      requestId: string;
      done: Promise<unknown>;
      cancel: () => void;
    } {
      const requestId = `sreq-${transportState.nextId}`;
      transportState.nextId += 1;
      const done = (async () => buildSurfaceMeshFromRequest(request))();
      return { requestId, done, cancel: () => undefined };
    }
    cancel(): void {}
    dispose(): void {}
  }
  return { ...actual, SurfaceWorkerClient: FakeSurfaceWorkerClient };
});

import type { CadProject, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { computeCadSurfaceSourceRevision } from '../src/engine/cad/cadSurfaces';
import { SURFACE_STYLE_TRIANGLES_ID } from '../src/engine/cad/cadSurfaceStyles';
import { buildSurfaceMeshFromRequest } from '../src/workers/surfaceWorkerHandler';
import { SurfaceBuildService } from '../src/workers/surfaceBuildService';
import {
  useSurveyCadSurfaceBuildLifecycle,
  type SurveyCadSurfaceBuildLifecycle,
} from '../src/hooks/surveyCad/useSurveyCadSurfaceBuildLifecycle';

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

const SURFACE_ID = 'surf:build';

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

const makeProject = (zOffset: number): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Build', units: 'm' });
  return {
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
        name: 'Build Site',
        styleId: SURFACE_STYLE_TRIANGLES_ID,
        definition: {
          pointSource: { kind: 'points', pointEntityIds: ['pt-1', 'pt-2', 'pt-3', 'pt-4'] },
        },
        cachedRevision: null,
      },
    ],
  };
};

const surfaceRevision = (project: CadProject): string =>
  computeCadSurfaceSourceRevision(project, project.surfaces![0]!);

const flush = async (rounds = 12): Promise<void> => {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
};

const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flush();
};

interface BuildControls {
  setProject: (_project: CadProject) => void;
  setDrawingId: (_drawingId: string) => void;
  bump: () => void;
}

interface HarnessProps {
  ref: RefObject<BuildControls | null>;
  initialProject: CadProject;
  initialDrawingId: string;
  setFileStatusText: (_text: string) => void;
  onApi: (_api: SurveyCadSurfaceBuildLifecycle) => void;
}

const Harness: React.FC<HarnessProps> = ({ ref, initialProject, initialDrawingId, setFileStatusText, onApi }) => {
  const [project, setProject] = useState(initialProject);
  const [drawingId, setDrawingId] = useState(initialDrawingId);
  const [, setTick] = useState(0);
  useImperativeHandle(ref, () => ({
    setProject,
    setDrawingId,
    bump: () => setTick((value) => value + 1),
  }));
  const api = useSurveyCadSurfaceBuildLifecycle({
    activeDrawingId: drawingId,
    cadProject: project,
    setFileStatusText,
  });
  useEffect(() => {
    onApi(api);
  });
  return null;
};

interface Mounted {
  root: Root;
  controls: RefObject<BuildControls | null>;
  api: () => SurveyCadSurfaceBuildLifecycle;
}

const mount = async (project: CadProject, drawingId = 'd1'): Promise<Mounted> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const controls: RefObject<BuildControls | null> = { current: null };
  const holder: { current: SurveyCadSurfaceBuildLifecycle | null } = { current: null };
  const setFileStatusText = vi.fn();
  await act(async () => {
    root.render(
      <Harness
        ref={controls}
        initialProject={project}
        initialDrawingId={drawingId}
        setFileStatusText={setFileStatusText}
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
  transportState.nextId = 0;
  (globalThis as { Worker?: unknown }).Worker = FakeWorker;
  document.body.innerHTML = '';
});

describe('STRUCT-194.4 surface-build lifecycle hook', () => {
  it('keeps cache / revision index / service identity across unrelated rerenders', async () => {
    const view = await mount(makeProject(0));
    const first = view.api();
    await act(async () => {
      view.controls.current!.bump();
      view.controls.current!.bump();
    });
    const again = view.api();
    expect(again.surfaceCache).toBe(first.surfaceCache);
    expect(again.surfaceRevisionIndex).toBe(first.surfaceRevisionIndex);
    expect(again.surfaceBuildService).toBe(first.surfaceBuildService);
    expect(again.activeProjectForBuildsRef).toBe(first.activeProjectForBuildsRef);
    expect(again.drawingIdForBuildsRef).toBe(first.drawingIdForBuildsRef);
    expect(again.surfaceBuildInputs.buildVersion).toBe(0);
    view.root.unmount();
  });

  it('mirrors the latest project / drawing / sessions into the live refs every render', async () => {
    const projectA = makeProject(0);
    const view = await mount(projectA, 'd1');
    const projectB = makeProject(5);
    await act(async () => {
      view.controls.current!.setProject(projectB);
      view.controls.current!.setDrawingId('d2');
    });
    const api = view.api();
    expect(api.activeProjectForBuildsRef.current).toBe(projectB);
    expect(api.drawingIdForBuildsRef.current).toBe('d2');
    expect(api.surfaceMeshSessionsForBuildsRef.current).toBe(api.surfaceMeshSessions);
    view.root.unmount();
  });

  it('creates a new cache + service on a drawing switch and disposes the old service', async () => {
    const disposeSpy = vi.spyOn(SurfaceBuildService.prototype, 'dispose');
    try {
      const view = await mount(makeProject(0), 'd1');
      const before = view.api();
      await act(async () => {
        view.controls.current!.setDrawingId('d2');
      });
      const after = view.api();
      expect(after.surfaceCache).not.toBe(before.surfaceCache);
      expect(after.surfaceBuildService).not.toBe(before.surfaceBuildService);
      expect(after.drawingIdForBuildsRef.current).toBe('d2');
      expect(disposeSpy).toHaveBeenCalled();
      view.root.unmount();
      expect(disposeSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    } finally {
      disposeSpy.mockRestore();
    }
  });

  it('keeps the built-revision history bounded to current + one previous', async () => {
    const view = await mount(makeProject(0));
    const api = view.api();
    const revisions: string[] = [];
    for (const offset of [0, 5, 9]) {
      const project = offset === 0 ? makeProject(0) : makeProject(offset);
      await act(async () => {
        view.controls.current!.setProject(project);
        await flush();
      });
      await act(async () => {
        api.surfaceBuildService.rebuildSurface(SURFACE_ID);
        await settle();
      });
      revisions.push(surfaceRevision(project));
    }
    const history = view.api().surfaceMeshSessions[SURFACE_ID] ?? [];
    expect(history).toHaveLength(2);
    expect(history[history.length - 1]).toBe(revisions[revisions.length - 1]);
    expect(history).not.toContain(revisions[0]);
    view.root.unmount();
  });

  it('exposes refreshed build inputs when the service reports a state change', async () => {
    const view = await mount(makeProject(0));
    const before = view.api().surfaceBuildInputs;
    await act(async () => {
      view.api().surfaceBuildService.rebuildSurface(SURFACE_ID);
    });
    const during = view.api().surfaceBuildInputs;
    expect(during).not.toBe(before);
    expect(during.buildVersion).toBeGreaterThan(before.buildVersion);
    await act(async () => {
      await settle();
    });
    const after = view.api().surfaceBuildInputs;
    expect(after.buildingSurfaceIds.has(SURFACE_ID)).toBe(false);
    view.root.unmount();
  });

  it('falls back to the bounded sync build (no crash, no transport) when Worker is undefined', async () => {
    (globalThis as { Worker?: unknown }).Worker = undefined;
    const view = await mount(makeProject(0));
    await act(async () => {
      const message = view.api().surfaceBuildService.rebuildSurface(SURFACE_ID);
      await settle();
      expect(message).toContain('sync fallback');
    });
    const api = view.api();
    const history = api.surfaceMeshSessions[SURFACE_ID] ?? [];
    expect(history).toHaveLength(1);
    expect(api.surfaceCache.get(SURFACE_ID, history[0]!)).toBeDefined();
    view.root.unmount();
  });

  it('constructs the worker from the moved path resolving to src/workers/surfaceWorker.ts', async () => {
    const view = await mount(makeProject(0));
    await act(async () => {
      view.api().surfaceBuildService.rebuildSurface(SURFACE_ID);
      await settle();
    });
    expect(transportState.workerUrls).toHaveLength(1);
    expect(new URL(transportState.workerUrls[0]!).pathname.endsWith('/src/workers/surfaceWorker.ts')).toBe(true);
    view.root.unmount();
  });
});
