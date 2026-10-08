/** @vitest-environment jsdom */
/**
 * PERF-185.1 correction — contour auto-derive must be revision-aware.
 *
 * Regression under test: the auto-derive sweep used to skip a surface
 * whenever ANY contour request was pending (`buildingContourIds().has(...)`).
 * If interval A was still deriving when the user changed the style to
 * interval B, the sweep skipped B. A then completed and cached A; completion
 * only bumps `contourVersion` (intentionally not an effect dependency), so B
 * was never requested until an unrelated project edit or TIN build.
 *
 * This is a real component integration test: the workspace owns a real
 * `SurfaceContourService` (no `requestContours` stub) backed by a fake
 * transport that holds both requests open. It proves:
 *  - a style change under a pending request issues a second derive for B;
 *  - the stale A completion never clears or replaces B's pending request;
 *  - B converges to CURRENT (and A never does);
 *  - there is no duplicate request storm.
 */
import React, { useState } from 'react';
import { act } from 'react';
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

// Hoisted runtime state for the mocked worker client (usable inside the
// `vi.mock` factory, which is hoisted above imports).
const transportState = vi.hoisted(() => ({
  requests: [] as FakeContourEntry[],
  nextId: 0,
}));

vi.mock('../src/workers/surfaceWorkerClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/workers/surfaceWorkerClient')>();
  class FakeSurfaceWorkerClient {
    readonly alive = true;
    build(request: import('../src/engine/cad/cadSurfaceTypes').SurfaceBuildRequest): {
      requestId: string;
      done: Promise<unknown>;
      cancel: () => void;
    } {
      const requestId = `sreq-${transportState.nextId}`;
      transportState.nextId += 1;
      // Real deterministic engine build off the snapshot, so the TIN becomes
      // CURRENT exactly as the worker path would (just on the microtask
      // queue). Contour derivations stay held open below.
      const done = (async () => buildSurfaceMeshFromRequest(request))();
      return { requestId, done, cancel: () => {} };
    }
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

import type {
  CadDrawingDocument,
  CadProject,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';
import type { CadSurfaceContourSet } from '../src/engine/cad/surfaceContours/contourTypes';
import type { ParseOptions } from '../src/types';
import { buildSurfaceMeshFromRequest } from '../src/workers/surfaceWorkerHandler';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { SURFACE_STYLE_CONTOURS_ID } from '../src/engine/cad/cadSurfaceStyles';
import { createCadShellLink, type CadShellLink } from '../src/cad-app/shell/cadShellLink';
import { SurfaceContourService } from '../src/workers/surfaceContourService';
import SurveyCadWorkspace from '../src/components/SurveyCadWorkspace';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (typeof (globalThis as { Worker?: unknown }).Worker === 'undefined') {
  (globalThis as { Worker?: unknown }).Worker = class {};
}

const SURFACE_ID = 'surf:race';
const PARSE_OPTIONS: ParseOptions = {
  units: 'm',
  coordMode: '2D',
  coordSystemMode: 'local',
  localDatumScheme: 'average-scale',
  averageScaleFactor: 1,
  commonElevation: 0,
  averageGeoidHeight: 0,
  observationMode: {
    bearing: 'grid',
    distance: 'measured',
    angle: 'measured',
    direction: 'measured',
  },
  gridBearingMode: 'grid',
  gridDistanceMode: 'measured',
  gridAngleMode: 'measured',
  gridDirectionMode: 'measured',
  runMode: 'adjustment',
  preanalysisMode: false,
  order: 'EN',
  angleStationOrder: 'atfromto',
  deltaMode: 'slope',
  mapMode: 'off',
  normalize: true,
  faceNormalizationMode: 'on',
  lonSign: 'west-negative',
};

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

const buildFixture = (): CadDrawingDocument => {
  const drawing = createBlankCadDrawingDocument({ name: 'Race', units: 'm' });
  const project: CadProject = {
    ...drawing.project,
    entities: [
      point('pt-1', 'A', 0, 0, 10),
      point('pt-2', 'B', 10, 0, 11),
      point('pt-3', 'C', 10, 10, 12),
      point('pt-4', 'D', 0, 10, 13),
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
  return { ...drawing, project };
};

const flush = async (rounds = 10): Promise<void> => {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
};

/** Yield to the macrotask queue so dynamic imports + deferred worker
 *  completions settle before asserting. */
const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flush();
};

const Harness: React.FC<{
  link: CadShellLink;
  initial: CadDrawingDocument;
}> = ({ link, initial }) => {
  // Controlled drawing (the standalone CAD app pattern): a command's
  // `emitDrawingChange` feeds this state back as the new `drawing` prop, so
  // the top-level `cadProject` (and the auto-derive epoch) follows the edit.
  const [drawing, setDrawing] = useState<CadDrawingDocument | null>(initial);
  return (
    <SurveyCadWorkspace
      input=""
      instrumentLibrary={{}}
      parseOptions={PARSE_OPTIONS}
      units="m"
      result={null}
      drawing={drawing}
      onDrawingChange={setDrawing}
      shellLink={link}
      shellChrome
    />
  );
};

interface Mounted {
  root: Root;
  link: CadShellLink;
}

const mount = async (drawing: CadDrawingDocument): Promise<Mounted> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const link = createCadShellLink();
  await act(async () => {
    root.render(<Harness link={link} initial={drawing} />);
  });
  await act(async () => {
    await flush();
  });
  return { root, link };
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

beforeEach(() => {
  transportState.requests.length = 0;
  transportState.nextId = 0;
});

describe('PERF-185.1 contour auto-derive race (interval change while pending)', () => {
  it('requests B while A is pending, keeps B pending across stale A, and converges to B', async () => {
    const requestSpy = vi.spyOn(SurfaceContourService.prototype, 'requestContours');
    try {
      const view = await mount(buildFixture());
      expect(transportState.requests).toHaveLength(0);

      // Build the TIN → the auto-derive effect requests interval A (default 1).
      await act(async () => {
        view.link.actions!.rebuildSurface(SURFACE_ID);
      });
      await act(async () => {
        await settle();
      });
      expect(requestSpy).toHaveBeenCalledTimes(1);
      expect(transportState.requests).toHaveLength(1);
      const requestA = transportState.requests[0]!;
      expect(requestA.surfaceId).toBe(SURFACE_ID);
      expect(requestA.cancelled).toBe(false);
      const service = requestSpy.mock.instances[0] as unknown as SurfaceContourService;
      expect(service.pendingContourRequest(SURFACE_ID)).toEqual({
        revision: requestA.surfaceRevision,
        geometryRevision: requestA.contourGeometryRevision,
      });

      // Change the contour interval to 2 while A is still deriving. The
      // revision-aware gate must NOT skip the surface just because A is
      // pending; it must request B (superseding A).
      await act(async () => {
        const applied = view.link.actions!.runSurveyCommand({
          key: 'SURFACE_STYLE_UPDATE',
          styleId: SURFACE_STYLE_CONTOURS_ID,
          patch: { minorContourInterval: 2, majorContourEvery: 5, contourBaseElevation: 0 },
        });
        expect(applied).toBe(true);
      });
      await act(async () => {
        await settle();
      });
      expect(requestSpy).toHaveBeenCalledTimes(2);
      expect(transportState.requests).toHaveLength(2);
      const requestB = transportState.requests[1]!;
      expect(requestB.contourGeometryRevision).not.toBe(requestA.contourGeometryRevision);
      // A was superseded (cancelled) and B is the only live request.
      expect(requestA.cancelled).toBe(true);
      expect(requestB.cancelled).toBe(false);
      expect(service.pendingContourRequest(SURFACE_ID)).toEqual({
        revision: requestB.surfaceRevision,
        geometryRevision: requestB.contourGeometryRevision,
      });

      // Stale A completes late. It must be discarded: B stays pending, A is
      // never CURRENT, and no third request is spawned (no duplicate storm).
      await act(async () => {
        requestA.resolve(fakeSet(requestA));
        await flush();
      });
      expect(transportState.requests).toHaveLength(2);
      expect(service.pendingContourRequest(SURFACE_ID)).toEqual({
        revision: requestB.surfaceRevision,
        geometryRevision: requestB.contourGeometryRevision,
      });
      expect(service.statusOf(SURFACE_ID, requestA.contourGeometryRevision).status).not.toBe('CURRENT');

      // B completes → CURRENT. This proves A's late completion did not clear
      // or replace B's pending request.
      await act(async () => {
        requestB.resolve(fakeSet(requestB));
        await flush();
      });
      expect(transportState.requests).toHaveLength(2);
      expect(service.pendingContourRequest(SURFACE_ID)).toBeNull();
      expect(service.statusOf(SURFACE_ID, requestB.contourGeometryRevision)).toEqual({
        status: 'CURRENT',
        stale: false,
      });
      expect(service.statusOf(SURFACE_ID, requestA.contourGeometryRevision).status).not.toBe('CURRENT');

      // Appearance-only edit re-runs the sweep for the same geometry revision:
      // B is cached, so no new request — the gate converges without looping.
      await act(async () => {
        view.link.actions!.runSurveyCommand({
          key: 'SURFACE_STYLE_UPDATE',
          styleId: SURFACE_STYLE_CONTOURS_ID,
          patch: { minorContour: { color: '#123456' } },
        });
      });
      await act(async () => {
        await settle();
      });
      expect(requestSpy).toHaveBeenCalledTimes(2);
      expect(transportState.requests).toHaveLength(2);
      view.root.unmount();
    } finally {
      requestSpy.mockRestore();
    }
  });
});
