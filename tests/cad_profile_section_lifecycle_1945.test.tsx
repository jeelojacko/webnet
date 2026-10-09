/** @vitest-environment jsdom */
/**
 * STRUCT-194.5 — `useSurveyCadProfileSectionLifecycle` coverage.
 *
 * Drives the REAL extracted hook with the REAL production profile / section
 * services and only the worker transport mocked, pinning the pre-extraction
 * contract:
 *   - one cache / service per drawing id, identity-stable across unrelated
 *     rerenders; disposal on replace/unmount;
 *   - a source-rebuild notice fires exactly once per NEW mesh revision and is
 *     skipped on an unrelated rerender;
 *   - an alignment notice fires only when the `JSON.stringify(entity)` digest
 *     changes (the first observation never notifies);
 *   - the profile and section diff refs stay independent and persist across a
 *     `drawingId` change;
 *   - both worker paths resolve `src/workers/surfaceWorker.ts`; a missing
 *     `Worker` falls back to a blocked (null-transport) result;
 *   - snapshot inputs keep their exact shape and identity.
 */
import React, { act, useEffect, useImperativeHandle, useMemo, useState, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const transportState = vi.hoisted(() => ({
  workerUrls: [] as string[],
  requests: [] as Array<{ kind: string; requestId: string }>,
  nextId: 0,
}));

vi.mock('../src/workers/surfaceWorkerClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/workers/surfaceWorkerClient')>();
  const pending = (kind: string): { requestId: string; done: Promise<unknown>; cancel: () => void } => {
    const requestId = `${kind}-${transportState.nextId}`;
    transportState.nextId += 1;
    transportState.requests.push({ kind, requestId });
    return { requestId, done: new Promise<unknown>(() => undefined), cancel: () => undefined };
  };
  class FakeSurfaceWorkerClient {
    readonly alive = true;
    constructor(worker: { url?: string }) {
      if (typeof worker?.url === 'string') transportState.workerUrls.push(worker.url);
    }
    deriveProfile(): { requestId: string; done: Promise<unknown>; cancel: () => void } {
      return pending('profile');
    }
    deriveSections(): { requestId: string; done: Promise<unknown>; cancel: () => void } {
      return pending('section');
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

import type { CadAlignmentElement, CadProject, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { SurfaceProfileService } from '../src/workers/surfaceProfileService';
import { SurfaceSectionService } from '../src/workers/surfaceSectionService';
import {
  useSurveyCadProfileSectionLifecycle,
  type SurveyCadProfileSectionLifecycle,
} from '../src/hooks/surveyCad/useSurveyCadProfileSectionLifecycle';

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

const line = (x0: number, y0: number, x1: number, y1: number): CadAlignmentElement => ({
  kind: 'line',
  start: { x: x0, y: y0 },
  end: { x: x1, y: y1 },
});

const baseProject = (): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'ProfileSection', units: 'm' });
  return {
    ...drawing.project,
    entities: [
      point('p1', 0, 0, 5),
      point('p2', 10, 0, 5),
      point('p3', 10, 10, 5),
      point('p4', 0, 10, 5),
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
    sampleLineGroups: [
      {
        id: 'grp-1',
        name: 'Corridor',
        alignmentEntityId: 'align-1',
        surfaceSources: [{ surfaceId: 'surf-1' }],
        sampleLines: [
          { id: 'line-1', rawStation: 2, leftWidth: 5, rightWidth: 5, skewDeg: 0 },
          { id: 'line-2', rawStation: 6, leftWidth: 5, rightWidth: 5, skewDeg: 0 },
        ],
      },
    ],
  };
};

const withMovedAlignment = (project: CadProject): CadProject => ({
  ...project,
  entities: project.entities.map((entity) =>
    entity.id === 'align-1' && entity.type === 'alignment'
      ? { ...entity, elements: [line(0, 6, 10, 6)] }
      : entity,
  ),
});

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

const flush = async (rounds = 12): Promise<void> => {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
};

const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flush();
};

interface HookControls {
  setProject: (_project: CadProject) => void;
  setMeshSessions: (_sessions: Record<string, string[]>) => void;
  setDrawingId: (_drawingId: string) => void;
  bump: () => void;
  surfaceCache: () => ReturnType<typeof createCadSurfaceCache>;
}

interface HarnessProps {
  ref: RefObject<HookControls | null>;
  initialProject: CadProject;
  initialDrawingId: string;
  onApi: (_api: SurveyCadProfileSectionLifecycle) => void;
}

const Harness: React.FC<HarnessProps> = ({ ref, initialProject, initialDrawingId, onApi }) => {
  const [project, setProject] = useState(initialProject);
  const [drawingId, setDrawingId] = useState(initialDrawingId);
  const [meshSessions, setMeshSessions] = useState<Record<string, string[]>>({});
  const [, setTick] = useState(0);
  const [, setFileStatusText] = useState('');
  const surfaceCache = useMemo(() => createCadSurfaceCache(drawingId), [drawingId]);
  const activeProjectForBuildsRef = { current: project } as { current: CadProject };
  const drawingIdForBuildsRef = { current: drawingId } as { current: string };
  useImperativeHandle(ref, () => ({
    setProject,
    setMeshSessions,
    setDrawingId,
    bump: () => setTick((value) => value + 1),
    surfaceCache: () => surfaceCache,
  }));
  const api = useSurveyCadProfileSectionLifecycle({
    drawingId,
    project,
    surfaceCache,
    surfaceMeshSessions: meshSessions,
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
  api: () => SurveyCadProfileSectionLifecycle;
}

const mount = async (project: CadProject, drawingId = 'd1'): Promise<Mounted> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const controls: RefObject<HookControls | null> = { current: null };
  const holder: { current: SurveyCadProfileSectionLifecycle | null } = { current: null };
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

describe('STRUCT-194.5 profile/section lifecycle hook', () => {
  it('keeps services + snapshot inputs identity-stable across unrelated rerenders and starts nothing', async () => {
    const view = await mount(baseProject());
    const first = view.api();
    await act(async () => {
      view.controls.current!.bump();
      view.controls.current!.bump();
    });
    const again = view.api();
    expect(again.profileService).toBe(first.profileService);
    expect(again.profileCache).toBe(first.profileCache);
    expect(again.sectionService).toBe(first.sectionService);
    expect(again.sectionCache).toBe(first.sectionCache);
    expect(again.surfaceProfileInputs).toBe(first.surfaceProfileInputs);
    expect(again.surfaceSectionInputs).toBe(first.surfaceSectionInputs);
    expect(transportState.requests).toHaveLength(0);
    view.root.unmount();
  });

  it('creates fresh services on a drawing switch and disposes the old ones', async () => {
    const profileDispose = vi.spyOn(SurfaceProfileService.prototype, 'dispose');
    const sectionDispose = vi.spyOn(SurfaceSectionService.prototype, 'dispose');
    try {
      const view = await mount(baseProject(), 'd1');
      const before = view.api();
      await act(async () => {
        view.controls.current!.setDrawingId('d2');
      });
      const after = view.api();
      expect(after.profileService).not.toBe(before.profileService);
      expect(after.sectionService).not.toBe(before.sectionService);
      expect(profileDispose).toHaveBeenCalled();
      expect(sectionDispose).toHaveBeenCalled();
      view.root.unmount();
    } finally {
      profileDispose.mockRestore();
      sectionDispose.mockRestore();
    }
  });

  it('notifies each service exactly once per NEW mesh revision and never on an unrelated rerender', async () => {
    const profileMesh = vi.spyOn(SurfaceProfileService.prototype, 'notifyMeshBuilt');
    const sectionMesh = vi.spyOn(SurfaceSectionService.prototype, 'notifyMeshBuilt');
    try {
      const view = await mount(baseProject());
      profileMesh.mockClear();
      sectionMesh.mockClear();
      await act(async () => {
        view.controls.current!.setMeshSessions({ 'surf-1': ['rev-1'] });
      });
      expect(profileMesh).toHaveBeenCalledTimes(1);
      expect(profileMesh).toHaveBeenCalledWith('surf-1');
      expect(sectionMesh).toHaveBeenCalledTimes(1);
      expect(sectionMesh).toHaveBeenCalledWith('surf-1');
      await act(async () => {
        view.controls.current!.bump();
      });
      expect(profileMesh).toHaveBeenCalledTimes(1);
      expect(sectionMesh).toHaveBeenCalledTimes(1);
      await act(async () => {
        view.controls.current!.setMeshSessions({ 'surf-1': ['rev-1', 'rev-2'] });
      });
      expect(profileMesh).toHaveBeenCalledTimes(2);
      expect(sectionMesh).toHaveBeenCalledTimes(2);
      view.root.unmount();
    } finally {
      profileMesh.mockRestore();
      sectionMesh.mockRestore();
    }
  });

  it('notifies alignment changes only when the entity digest changes (first observation is silent)', async () => {
    const profileAlign = vi.spyOn(SurfaceProfileService.prototype, 'notifyAlignmentChanged');
    const sectionAlign = vi.spyOn(SurfaceSectionService.prototype, 'notifyAlignmentChanged');
    try {
      const project = baseProject();
      const view = await mount(project);
      expect(profileAlign).not.toHaveBeenCalled();
      expect(sectionAlign).not.toHaveBeenCalled();
      await act(async () => {
        view.controls.current!.setProject(withMovedAlignment(project));
      });
      expect(profileAlign).toHaveBeenCalledTimes(1);
      expect(profileAlign).toHaveBeenCalledWith('align-1');
      expect(sectionAlign).toHaveBeenCalledTimes(1);
      expect(sectionAlign).toHaveBeenCalledWith('align-1');
      await act(async () => {
        view.controls.current!.bump();
      });
      expect(profileAlign).toHaveBeenCalledTimes(1);
      expect(sectionAlign).toHaveBeenCalledTimes(1);
      view.root.unmount();
    } finally {
      profileAlign.mockRestore();
      sectionAlign.mockRestore();
    }
  });

  it('exposes the exact snapshot-input shapes backed by the live caches', async () => {
    const view = await mount(baseProject());
    const api = view.api();
    const surfaceCache = view.controls.current!.surfaceCache();
    expect(api.surfaceProfileInputs.tinCache).toBe(surfaceCache);
    expect(api.surfaceProfileInputs.profileCache).toBe(api.profileCache);
    expect(api.surfaceProfileInputs.version).toBe(0);
    expect(api.surfaceProfileInputs.buildingProfileIds.size).toBe(0);
    expect(api.surfaceSectionInputs.sectionCache).toBe(api.sectionCache);
    expect(api.surfaceSectionInputs.version).toBe(0);
    expect(api.surfaceSectionInputs.buildingGroupIds.size).toBe(0);
    view.root.unmount();
  });

  it('routes profile + section worker construction to src/workers/surfaceWorker.ts', async () => {
    const view = await mount(baseProject());
    seedTin(baseProject(), view.controls.current!.surfaceCache());
    await act(async () => {
      view.api().profileService.requestProfile('prof-1');
      view.api().sectionService.requestGroup('grp-1');
      await settle();
    });
    expect(transportState.workerUrls).toHaveLength(2);
    for (const url of transportState.workerUrls) {
      expect(new URL(url).pathname.endsWith('/src/workers/surfaceWorker.ts')).toBe(true);
    }
    expect(transportState.requests.map((entry) => entry.kind).sort()).toEqual(['profile', 'section']);
    view.root.unmount();
  });

  it('falls back to a blocked (null-transport) result when Worker is unavailable', async () => {
    (globalThis as { Worker?: unknown }).Worker = undefined;
    const view = await mount(baseProject());
    seedTin(baseProject(), view.controls.current!.surfaceCache());
    await act(async () => {
      const profileMessage = view.api().profileService.requestProfile('prof-1');
      const sectionMessage = view.api().sectionService.requestGroup('grp-1');
      await settle();
      expect(profileMessage).toContain('worker unavailable');
      expect(sectionMessage).toContain('worker unavailable');
    });
    expect(transportState.workerUrls).toHaveLength(0);
    view.root.unmount();
  });
});
