/** @vitest-environment jsdom */
/**
 * STRUCT-194.6 — `useSurveyCadComposeLifecycle` coverage.
 *
 * Drives the REAL production hook with the REAL `SurfaceComposeService` and
 * the REAL compose command builders; only the worker transport is faked (the
 * same module seam the #185 / 18Y suites use). Pins the pre-extraction
 * contract:
 *   - the pending-mode ref is stable across unrelated rerenders;
 *   - the service is memoized on `[drawingId, surfaceCache, cadWorkspace]`
 *     (a fresh workspace identity replaces the service and disposes the old);
 *   - the worker URL resolves the SAME `src/workers/surfaceWorker.ts` module
 *     after the move into `src/hooks/surveyCad/`;
 *   - copy vs paste build the exact SURFCOMPOSE / SURFCOMPOSEPASTE payload
 *     with the exact source revisions, and the exact success/rejection status;
 *   - a missing source returns without deleting the pending mode;
 *   - a stale revision is never applied; a late/superseded result never
 *     mutates the drawing.
 */
import React, { act, useEffect, useImperativeHandle, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ComposeTransportRequest {
  requestId: string;
  request: {
    drawingId: string;
    base: { surfaceId: string; revision: string };
    overlay: { surfaceId: string; revision: string };
  };
  resolve: (_result: unknown) => void;
  reject: (_error: Error) => void;
}

interface ComposeTransportEntry {
  alive: boolean;
  requests: ComposeTransportRequest[];
  cancelled: string[];
}

const transportState = vi.hoisted(() => ({
  workerUrls: [] as string[],
  transports: [] as ComposeTransportEntry[],
  nextId: 0,
}));

vi.mock('../src/workers/surfaceWorkerClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/workers/surfaceWorkerClient')>();
  class FakeSurfaceWorkerClient {
    readonly alive = true;
    private readonly entry: ComposeTransportEntry;
    constructor(port: { url?: string }) {
      if (typeof port?.url === 'string') transportState.workerUrls.push(port.url);
      const entry: ComposeTransportEntry = { alive: true, requests: [], cancelled: [] };
      this.entry = entry;
      transportState.transports.push(entry);
    }
    deriveCompose(request: ComposeTransportRequest['request']): {
      requestId: string;
      done: Promise<unknown>;
      cancel: () => void;
    } {
      const requestId = `kreq-${transportState.nextId}`;
      transportState.nextId += 1;
      let resolve!: (_result: unknown) => void;
      let reject!: (_error: Error) => void;
      const done = new Promise<unknown>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      done.catch(() => undefined);
      this.entry.requests.push({ requestId, request, resolve, reject });
      return {
        requestId,
        done,
        cancel: () => {
          this.entry.cancelled.push(requestId);
          resolve(null);
        },
      };
    }
    cancel(requestId: string): void {
      this.entry.cancelled.push(requestId);
    }
    dispose(): void {
      this.entry.alive = false;
    }
  }
  return { ...actual, SurfaceWorkerClient: FakeSurfaceWorkerClient };
});

import type { CadCommand } from '../src/engine/cad/cadTransactions.types';
import type { CadProject, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { buildCadSurface, computeCadSurfaceSourceRevision } from '../src/engine/cad/cadSurfaces';
import { SURFACE_COMPOSE_STALE_REVISION } from '../src/engine/cad/cadTransactionsSurfaceComposeCommands';
import {
  useSurveyCadComposeLifecycle,
  type SurveyCadComposeLifecycle,
} from '../src/hooks/surveyCad/useSurveyCadComposeLifecycle';

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

const BASE_ID = 'base-1';
const OVERLAY_ID = 'overlay-1';
const BASE_NAME = 'Base';
const OVERLAY_NAME = 'Overlay';

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

const makeProject = (baseShift = 0): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Compose', units: 'm' });
  return {
    ...drawing.project,
    entities: [
      point('b1', 0, 0, 0 + baseShift),
      point('b2', 10, 0, 0 + baseShift),
      point('b3', 10, 10, 0 + baseShift),
      point('b4', 0, 10, 0 + baseShift),
      point('o1', 20, 0, 5),
      point('o2', 30, 0, 5),
      point('o3', 30, 10, 5),
      point('o4', 20, 10, 5),
    ],
    surfaces: [
      { id: BASE_ID, name: BASE_NAME, definition: { pointSource: { kind: 'points', pointEntityIds: ['b1', 'b2', 'b3', 'b4'] } }, cachedRevision: null },
      { id: OVERLAY_ID, name: OVERLAY_NAME, definition: { pointSource: { kind: 'points', pointEntityIds: ['o1', 'o2', 'o3', 'o4'] } }, cachedRevision: null },
    ],
  };
};

const seedTin = (cache: ReturnType<typeof createCadSurfaceCache>, project: CadProject, surfaceId: string): string => {
  const surface = project.surfaces!.find((entry) => entry.id === surfaceId)!;
  const revision = computeCadSurfaceSourceRevision(project, surface);
  const built = buildCadSurface(project, surface);
  cache.set(surfaceId, revision, {
    revision,
    points: built.points,
    triangles: built.triangles,
    stats: built.stats,
    grid: built.grid,
    adjacency: built.adjacency,
    edgeKinds: built.edgeKinds,
  });
  return revision;
};

const flush = async (rounds = 12): Promise<void> => {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
};

const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flush();
};

const successPayload = (seed = 1): unknown => ({
  vertices: [0, 0, seed, 10, 0, seed, 0, 10, seed],
  faces: [0, 1, 2],
  diagnostics: {
    baseOnlyArea: 50,
    overlayArea: 50,
    overlapArea: 0,
    resultArea: 100,
    seamLength: 0,
    maxSeamMismatch: 0,
    outputVertexCount: 3,
    outputTriangleCount: 1,
  },
});

interface ComposeControls {
  setProject: (_project: CadProject) => void;
  setDrawingId: (_drawingId: string) => void;
  bumpWorkspace: () => void;
  bump: () => void;
}

interface HarnessProps {
  ref: RefObject<ComposeControls | null>;
  initialProject: CadProject;
  initialDrawingId: string;
  surfaceCache: ReturnType<typeof createCadSurfaceCache>;
  runLayerCommand: (_command: CadCommand) => boolean;
  setFileStatusText: Dispatch<SetStateAction<string>>;
  onApi: (_api: SurveyCadComposeLifecycle) => void;
}

const Harness: React.FC<HarnessProps> = ({ ref, initialProject, initialDrawingId, surfaceCache, runLayerCommand, setFileStatusText, onApi }) => {
  const [project, setProject] = useState(initialProject);
  const [drawingId, setDrawingId] = useState(initialDrawingId);
  const [workspaceEpoch, setWorkspaceEpoch] = useState(0);
  const [, setTick] = useState(0);
  const activeProjectForBuildsRef = useRef(project);
  const drawingIdForBuildsRef = useRef(drawingId);
  useEffect(() => {
    activeProjectForBuildsRef.current = project;
    drawingIdForBuildsRef.current = drawingId;
  });
  const cadWorkspace = useMemo(() => {
    void workspaceEpoch;
    return { runLayerCommand: (command: CadCommand): boolean => runLayerCommand(command) };
  }, [workspaceEpoch, runLayerCommand]);
  useImperativeHandle(ref, () => ({
    setProject,
    setDrawingId,
    bumpWorkspace: () => setWorkspaceEpoch((value) => value + 1),
    bump: () => setTick((value) => value + 1),
  }));
  const api = useSurveyCadComposeLifecycle({
    drawingId,
    surfaceCache,
    activeProjectForBuildsRef,
    drawingIdForBuildsRef,
    cadWorkspace,
    setFileStatusText,
  });
  useEffect(() => {
    onApi(api);
  });
  return null;
};

interface Mounted {
  root: Root;
  controls: RefObject<ComposeControls | null>;
  api: () => SurveyCadComposeLifecycle;
  notices: string[];
  commands: CadCommand[];
  setRunLayerCommand: (_result: boolean) => void;
}

const mount = async (
  project: CadProject,
  surfaceCache: ReturnType<typeof createCadSurfaceCache>,
  drawingId = 'd1',
): Promise<Mounted> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const controls: RefObject<ComposeControls | null> = { current: null };
  const holder: { current: SurveyCadComposeLifecycle | null } = { current: null };
  const notices: string[] = [];
  const commands: CadCommand[] = [];
  let runResult = true;
  const setFileStatusText: Dispatch<SetStateAction<string>> = (action) => {
    notices.push(typeof action === 'function' ? action('') : action);
  };
  const runLayerCommand = (command: CadCommand): boolean => {
    commands.push(command);
    return runResult;
  };
  await act(async () => {
    root.render(
      <Harness
        ref={controls}
        initialProject={project}
        initialDrawingId={drawingId}
        surfaceCache={surfaceCache}
        runLayerCommand={runLayerCommand}
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
    notices,
    commands,
    setRunLayerCommand: (result) => {
      runResult = result;
    },
  };
};

beforeEach(() => {
  transportState.workerUrls.length = 0;
  transportState.transports.length = 0;
  transportState.nextId = 0;
  (globalThis as { Worker?: unknown }).Worker = FakeWorker;
  document.body.innerHTML = '';
});

const spec = { baseSurfaceId: BASE_ID, overlaySurfaceId: OVERLAY_ID, policy: { id: 'overlay-coverage-wins' } };

describe('STRUCT-194.6 compose lifecycle hook', () => {
  it('keeps the pending-mode ref and service identity across unrelated rerenders', async () => {
    const project = makeProject();
    const cache = createCadSurfaceCache('d1');
    seedTin(cache, project, BASE_ID);
    seedTin(cache, project, OVERLAY_ID);
    const view = await mount(project, cache);
    const first = view.api();
    await act(async () => {
      view.controls.current!.bump();
      view.controls.current!.bump();
    });
    const again = view.api();
    expect(again.pendingComposeModeRef).toBe(first.pendingComposeModeRef);
    expect(again.composeService).toBe(first.composeService);
    view.root.unmount();
  });

  it('replaces the service (and disposes the old) on a fresh cadWorkspace identity', async () => {
    const project = makeProject();
    const cache = createCadSurfaceCache('d1');
    seedTin(cache, project, BASE_ID);
    seedTin(cache, project, OVERLAY_ID);
    const view = await mount(project, cache);
    const before = view.api();
    await act(async () => {
      view.controls.current!.bumpWorkspace();
    });
    const after = view.api();
    expect(after.composeService).not.toBe(before.composeService);
    expect(after.pendingComposeModeRef).toBe(before.pendingComposeModeRef);
    expect(before.composeService.buildingComposeKeys().size).toBe(0);
    view.root.unmount();
  });

  it('applies a copy compose with the exact SURFCOMPOSE payload, revisions, status, and one dispatch', async () => {
    const project = makeProject();
    const cache = createCadSurfaceCache('d1');
    const baseRevision = seedTin(cache, project, BASE_ID);
    const overlayRevision = seedTin(cache, project, OVERLAY_ID);
    const view = await mount(project, cache);
    const api = view.api();
    api.pendingComposeModeRef.current.set(`${BASE_ID}|${OVERLAY_ID}`, 'copy');
    const message = api.composeService.requestCompose(spec);
    expect(message).toBe('Composing “Base” + “Overlay”…');
    const entry = transportState.transports.at(-1)!;
    expect(entry.requests).toHaveLength(1);
    expect(entry.requests[0]!.request.base.revision).toBe(baseRevision);
    expect(entry.requests[0]!.request.overlay.revision).toBe(overlayRevision);
    await act(async () => {
      entry.requests[0]!.resolve(successPayload(7));
      await settle();
    });
    expect(view.commands).toHaveLength(1);
    expect(view.commands[0]).toMatchObject({
      key: 'SURFCOMPOSE',
      baseSurfaceId: BASE_ID,
      baseExpectedRevision: baseRevision,
      overlaySurfaceId: OVERLAY_ID,
      overlayExpectedRevision: overlayRevision,
      vertices: [0, 0, 7, 10, 0, 7, 0, 10, 7],
      faces: [0, 1, 2],
    });
    expect(view.notices).toEqual([`Composite copy created from “${BASE_NAME}” + “${OVERLAY_NAME}”.`]);
    expect(api.pendingComposeModeRef.current.has(`${BASE_ID}|${OVERLAY_ID}`)).toBe(false);
    view.root.unmount();
  });

  it('applies a paste compose with the exact SURFCOMPOSEPASTE payload and status', async () => {
    const project = makeProject();
    const cache = createCadSurfaceCache('d1');
    const baseRevision = seedTin(cache, project, BASE_ID);
    const overlayRevision = seedTin(cache, project, OVERLAY_ID);
    const view = await mount(project, cache);
    const api = view.api();
    api.pendingComposeModeRef.current.set(`${BASE_ID}|${OVERLAY_ID}`, 'paste');
    api.composeService.requestCompose(spec);
    const entry = transportState.transports.at(-1)!;
    await act(async () => {
      entry.requests[0]!.resolve(successPayload(3));
      await settle();
    });
    expect(view.commands).toHaveLength(1);
    expect(view.commands[0]).toMatchObject({
      key: 'SURFCOMPOSEPASTE',
      targetSurfaceId: BASE_ID,
      targetExpectedRevision: baseRevision,
      sourceSurfaceId: OVERLAY_ID,
      sourceExpectedRevision: overlayRevision,
    });
    expect(view.notices.at(-1)).toBe(`Pasted “${OVERLAY_NAME}” into “${BASE_NAME}”.`);
    view.root.unmount();
  });

  it('reports the exact rejection status when the history commit is refused', async () => {
    const project = makeProject();
    const cache = createCadSurfaceCache('d1');
    seedTin(cache, project, BASE_ID);
    seedTin(cache, project, OVERLAY_ID);
    const view = await mount(project, cache);
    view.setRunLayerCommand(false);
    // The fake workspace closes over a ref, so re-point it by remounting is not
    // needed: swap the command result through a mutable holder on the api.
    const api = view.api();
    const entry = (() => {
      api.pendingComposeModeRef.current.set(`${BASE_ID}|${OVERLAY_ID}`, 'copy');
      api.composeService.requestCompose(spec);
      return transportState.transports.at(-1)!;
    })();
    await act(async () => {
      entry.requests[0]!.resolve(successPayload());
      await settle();
    });
    expect(view.notices.at(-1)).toBe('Compose rejected — a source revision moved or the target layer is locked.');
    view.root.unmount();
  });

  it('blocks a stale revision without applying and notifies retry', async () => {
    const project = makeProject();
    const cache = createCadSurfaceCache('d1');
    seedTin(cache, project, BASE_ID);
    seedTin(cache, project, OVERLAY_ID);
    const view = await mount(project, cache);
    const api = view.api();
    api.composeService.requestCompose(spec);
    const entry = transportState.transports.at(-1)!;
    await act(async () => {
      view.controls.current!.setProject(makeProject(4));
      await flush();
    });
    await act(async () => {
      entry.requests[0]!.resolve(successPayload());
      await settle();
    });
    expect(view.commands).toHaveLength(0);
    expect(view.notices).toContain(SURFACE_COMPOSE_STALE_REVISION);
    view.root.unmount();
  });

  it('never applies a late result from the old drawing after a drawing switch', async () => {
    const project = makeProject();
    const cache = createCadSurfaceCache('d1');
    seedTin(cache, project, BASE_ID);
    seedTin(cache, project, OVERLAY_ID);
    const view = await mount(project, cache, 'd1');
    const api = view.api();
    api.composeService.requestCompose(spec);
    const entry = transportState.transports.at(-1)!;
    await act(async () => {
      view.controls.current!.setDrawingId('d2');
      await flush();
    });
    await act(async () => {
      entry.requests[0]!.resolve(successPayload());
      await settle();
    });
    expect(view.commands).toHaveLength(0);
    view.root.unmount();
  });

  it('drops a superseded first result and applies only the latest one', async () => {
    const project = makeProject();
    const cache = createCadSurfaceCache('d1');
    seedTin(cache, project, BASE_ID);
    seedTin(cache, project, OVERLAY_ID);
    const view = await mount(project, cache);
    const api = view.api();
    api.composeService.requestCompose(spec);
    api.composeService.requestCompose(spec);
    const entry = transportState.transports.at(-1)!;
    expect(entry.requests).toHaveLength(2);
    await act(async () => {
      entry.requests[0]!.resolve(successPayload(1));
      await settle();
    });
    expect(view.commands).toHaveLength(0);
    await act(async () => {
      entry.requests[1]!.resolve(successPayload(2));
      await settle();
    });
    expect(view.commands).toHaveLength(1);
    expect((view.commands[0] as { vertices: number[] }).vertices[2]).toBe(2);
    view.root.unmount();
  });

  it('returns a missing-source block without deleting the pending mode', async () => {
    const project = makeProject();
    const cache = createCadSurfaceCache('d1');
    seedTin(cache, project, BASE_ID);
    seedTin(cache, project, OVERLAY_ID);
    const view = await mount(project, cache);
    const api = view.api();
    api.pendingComposeModeRef.current.set(`${BASE_ID}|missing`, 'paste');
    const message = api.composeService.requestCompose({
      baseSurfaceId: BASE_ID,
      overlaySurfaceId: 'missing',
      policy: { id: 'overlay-coverage-wins' },
    });
    expect(message).toBe('Composition blocked: a source surface is missing.');
    expect(api.pendingComposeModeRef.current.get(`${BASE_ID}|missing`)).toBe('paste');
    expect(view.commands).toHaveLength(0);
    view.root.unmount();
  });

  it('constructs the worker from the moved path resolving to src/workers/surfaceWorker.ts', async () => {
    const project = makeProject();
    const cache = createCadSurfaceCache('d1');
    seedTin(cache, project, BASE_ID);
    seedTin(cache, project, OVERLAY_ID);
    const view = await mount(project, cache);
    view.api().composeService.requestCompose(spec);
    expect(transportState.workerUrls).toHaveLength(1);
    expect(new URL(transportState.workerUrls[0]!).pathname.endsWith('/src/workers/surfaceWorker.ts')).toBe(true);
    view.root.unmount();
  });
});
