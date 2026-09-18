import { describe, expect, it } from 'vitest';

import { computeCadSurfaceSourceRevision } from '../src/engine/cad/cadSurfaces';
import { buildSurfaceBuildRequest } from '../src/engine/cad/cadSurfaceTypes';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState, runCadCommand } from '../src/engine/cad/cadUndoRedo';
import type { CadProject, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';
import {
  buildSurfaceMeshFromRequest,
  createSurfaceWorkerHandler,
  type SurfaceWorkerMesh,
  type SurfaceWorkerRequestMessage,
  type SurfaceWorkerResponseMessage,
} from '../src/workers/surfaceWorkerHandler';
import {
  SURFACE_BUILD_MALFORMED,
  SURFACE_BUILD_UNAVAILABLE,
  SurfaceWorkerClient,
  type SurfaceWorkerPort,
} from '../src/workers/surfaceWorkerClient';

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

const projectWithSurface = (): { project: CadProject; surfaceId: string; revision: string } => {
  const drawing = createBlankCadDrawingDocument({ name: 'Client', units: 'm' });
  let history = createCadHistoryState({
    ...drawing.project,
    entities: [
      point('pt-1', 'A', 0, 0, 10),
      point('pt-2', 'B', 10, 0, 11),
      point('pt-3', 'C', 10, 10, 12),
      point('pt-4', 'D', 0, 10, 13),
    ],
  });
  history = runCadCommand(history, {
    key: 'SURFACE_CREATE',
    name: 'Site',
    pointSource: { kind: 'points', pointEntityIds: ['pt-1', 'pt-2', 'pt-3', 'pt-4'] },
  });
  const project = history.present.project;
  const surface = project.surfaces![0]!;
  return { project, surfaceId: surface.id, revision: computeCadSurfaceSourceRevision(project, surface) };
};

/** In-process worker port backed by the real handler (async like postMessage). */
const createFakePort = (): SurfaceWorkerPort & {
  posted: SurfaceWorkerRequestMessage[];
  emitError: () => void;
  emitRaw: (_message: unknown) => void;
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
    emitError: (): void => {
      for (const listener of listeners.get('error') ?? []) listener({});
    },
    emitRaw: (message: unknown): void => {
      for (const listener of listeners.get('message') ?? []) listener({ data: message });
    },
  };
  const handler = createSurfaceWorkerHandler({
    loadBuilder: async () => buildSurfaceMeshFromRequest,
    postMessage: (message: SurfaceWorkerResponseMessage) => {
      setTimeout(() => port.emitRaw(message), 0);
    },
  });
  return port;
};

const flush = async (rounds = 10): Promise<void> => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

describe('SurfaceWorkerClient', () => {
  it('resolves a real engine mesh through the handler', async () => {
    const port = createFakePort();
    const client = new SurfaceWorkerClient(port);
    const { project, surfaceId, revision } = projectWithSurface();
    const request = buildSurfaceBuildRequest(project, surfaceId, revision)!;
    const mesh = await client.build(request).done;
    expect(mesh).not.toBeNull();
    expect(mesh!.outcome).toBe('ok');
    expect(mesh!.triangles).toHaveLength(2);
    client.dispose();
  });

  it('settles cancel as null and drops the late worker arrival', async () => {
    const port = createFakePort();
    const client = new SurfaceWorkerClient(port);
    const { project, surfaceId, revision } = projectWithSurface();
    const pending = client.build(buildSurfaceBuildRequest(project, surfaceId, revision)!);
    pending.cancel();
    await expect(pending.done).resolves.toBeNull();
    await flush();
    expect(client.alive).toBe(true);
    client.dispose();
  });

  it('settles every pending build on dispose with no leaked promises', async () => {
    const port = createFakePort();
    const client = new SurfaceWorkerClient(port);
    const { project, surfaceId, revision } = projectWithSurface();
    const first = client.build(buildSurfaceBuildRequest(project, surfaceId, revision)!);
    const second = client.build(buildSurfaceBuildRequest(project, surfaceId, revision)!);
    client.dispose();
    await expect(first.done).resolves.toBeNull();
    await expect(second.done).resolves.toBeNull();
    expect(client.alive).toBe(false);
  });

  it('rejects pending builds when the worker dies', async () => {
    const port = createFakePort();
    const client = new SurfaceWorkerClient(port);
    const { project, surfaceId, revision } = projectWithSurface();
    const pending = client.build(buildSurfaceBuildRequest(project, surfaceId, revision)!);
    port.emitError();
    await expect(pending.done).rejects.toThrow(SURFACE_BUILD_UNAVAILABLE);
    expect(client.alive).toBe(false);
  });

  it('fails closed on a malformed success response', async () => {
    const port = createFakePort();
    const client = new SurfaceWorkerClient(port);
    const { project, surfaceId, revision } = projectWithSurface();
    const pending = client.build(buildSurfaceBuildRequest(project, surfaceId, revision)!);
    // Malformed: success shape but no result payload.
    port.emitRaw({ type: 'success', requestId: pending.requestId, surfaceId, revision });
    await expect(pending.done).rejects.toThrow(SURFACE_BUILD_MALFORMED);
    client.dispose();
  });

  it('ignores garbage messages and unknown request ids', async () => {
    const port = createFakePort();
    const client = new SurfaceWorkerClient(port);
    const { project, surfaceId, revision } = projectWithSurface();
    const pending = client.build(buildSurfaceBuildRequest(project, surfaceId, revision)!);
    port.emitRaw(null);
    port.emitRaw({ type: 'success', requestId: 'nope', result: {} });
    port.emitRaw({ type: 'progress', requestId: pending.requestId });
    const mesh: SurfaceWorkerMesh | null = await pending.done;
    expect(mesh?.outcome).toBe('ok');
    client.dispose();
  });
});
