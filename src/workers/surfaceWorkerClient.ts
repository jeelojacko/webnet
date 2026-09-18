import type { SurfaceBuildRequest } from '../engine/cad/cadSurfaceTypes';
import type {
  SurfaceWorkerResponseMessage,
} from './surfaceWorkerHandler';
import type { SurfaceWorkerMesh } from './surfaceWorkerHandler';

export type { SurfaceWorkerMesh };

/**
 * Phase 18G — narrow typed production client for surfaceWorker.
 *
 * One client per document session (never per click): build/cancel/dispose
 * only. Messages carry plain data (requestId + surfaceId + revision +
 * compact snapshot) — no React. Progress messages are dropped (no fake
 * progress); only terminal outcomes settle.
 *
 * Settlement contract: `done` resolves to the mesh on success, to null
 * when the request was cancelled/superseded/disposed (settle silently —
 * the service drops it), and rejects only on real failure
 * (worker-reported failure, malformed response, or worker death).
 */

export const SURFACE_BUILD_UNAVAILABLE = 'Surface worker unavailable.';
export const SURFACE_BUILD_MALFORMED = 'Malformed surface worker response.';

export interface PendingSurfaceBuild {
  requestId: string;
  done: Promise<SurfaceWorkerMesh | null>;
  cancel: () => void;
}

/** Minimal worker surface the client drives (real Worker satisfies this). */
export interface SurfaceWorkerPort {
  postMessage: (_message: unknown) => void;
  terminate: () => void;
  addEventListener: (_type: string, _listener: (_event: unknown) => void) => void;
  removeEventListener: (_type: string, _listener: (_event: unknown) => void) => void;
}

export interface SurfaceBuildTransport {
  readonly alive: boolean;
  build: (_request: SurfaceBuildRequest) => PendingSurfaceBuild;
  cancel: (_requestId: string) => void;
  dispose: () => void;
}

const TERMINAL_TYPES = new Set(['success', 'failure', 'cancelled']);
const OK_OUTCOMES = new Set(['ok', 'insufficient', 'blocked']);

type TerminalSurfaceWorkerMessage = Exclude<SurfaceWorkerResponseMessage, { type: 'progress' }>;

const isResponseMessage = (value: unknown): value is TerminalSurfaceWorkerMessage => {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Record<string, unknown>;
  return (
    typeof message['type'] === 'string' &&
    TERMINAL_TYPES.has(message['type'] as string) &&
    typeof message['requestId'] === 'string'
  );
};

const isWellFormedMesh = (value: unknown): value is SurfaceWorkerMesh => {
  if (typeof value !== 'object' || value === null) return false;
  const mesh = value as Record<string, unknown>;
  return (
    typeof mesh['outcome'] === 'string' &&
    OK_OUTCOMES.has(mesh['outcome'] as string) &&
    Array.isArray(mesh['points']) &&
    Array.isArray(mesh['triangles']) &&
    typeof mesh['stats'] === 'object' &&
    mesh['stats'] !== null &&
    typeof mesh['grid'] === 'object' &&
    mesh['grid'] !== null &&
    Array.isArray(mesh['adjacency']) &&
    Array.isArray(mesh['edgeKinds'])
  );
};

export class SurfaceWorkerClient implements SurfaceBuildTransport {
  private readonly port: SurfaceWorkerPort;
  private readonly pending = new Map<
    string,
    {
      resolve: (_mesh: SurfaceWorkerMesh | null) => void;
      reject: (_error: Error) => void;
      settled: boolean;
    }
  >();
  private nextRequestId = 0;
  private dead = false;
  private readonly handleMessage = (event: unknown): void => {
    const data = (event as { data?: unknown })?.data;
    if (!isResponseMessage(data)) return;
    const entry = this.pending.get(data.requestId);
    if (!entry || entry.settled) return;
    if (data.type === 'cancelled') {
      entry.settled = true;
      this.pending.delete(data.requestId);
      entry.resolve(null);
      return;
    }
    if (data.type === 'failure') {
      entry.settled = true;
      this.pending.delete(data.requestId);
      entry.reject(new Error(data.error || 'Surface build failed.'));
      return;
    }
    if (!isWellFormedMesh(data.result)) {
      entry.settled = true;
      this.pending.delete(data.requestId);
      entry.reject(new Error(SURFACE_BUILD_MALFORMED));
      return;
    }
    entry.settled = true;
    this.pending.delete(data.requestId);
    entry.resolve(data.result);
  };
  private readonly handleFatal = (): void => {
    this.failAll(new Error(SURFACE_BUILD_UNAVAILABLE));
  };

  constructor(port: SurfaceWorkerPort) {
    this.port = port;
    port.addEventListener('message', this.handleMessage);
    port.addEventListener('error', this.handleFatal);
  }

  get alive(): boolean {
    return !this.dead;
  }

  build(request: SurfaceBuildRequest): PendingSurfaceBuild {
    this.nextRequestId += 1;
    const requestId = `sreq-${this.nextRequestId}`;
    let entry!: { resolve: (_m: SurfaceWorkerMesh | null) => void; reject: (_e: Error) => void; settled: boolean };
    const done = new Promise<SurfaceWorkerMesh | null>((resolve, reject) => {
      entry = { resolve, reject, settled: false };
    });
    this.pending.set(requestId, entry);
    try {
      this.port.postMessage({ type: 'build', requestId, request });
    } catch (error) {
      this.pending.delete(requestId);
      entry.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return {
      requestId,
      done,
      cancel: () => this.cancel(requestId),
    };
  }

  cancel(requestId: string): void {
    const entry = this.pending.get(requestId);
    if (!entry || entry.settled) return;
    entry.settled = true;
    this.pending.delete(requestId);
    try {
      this.port.postMessage({ type: 'cancel', requestId });
    } catch {
      // Local settle already applied; a dead port fails closed via dispose.
    }
    entry.resolve(null);
  }

  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    try {
      this.port.removeEventListener('message', this.handleMessage);
      this.port.removeEventListener('error', this.handleFatal);
    } catch {
      // Listener removal is best-effort on a dead port.
    }
    for (const [requestId, entry] of this.pending) {
      if (!entry.settled) {
        entry.settled = true;
        entry.resolve(null);
      }
      this.pending.delete(requestId);
    }
    try {
      this.port.terminate();
    } catch {
      // Termination is best-effort.
    }
  }

  private failAll(error: Error): void {
    if (this.dead) return;
    this.dead = true;
    for (const [requestId, entry] of this.pending) {
      if (!entry.settled) {
        entry.settled = true;
        entry.reject(error);
      }
      this.pending.delete(requestId);
    }
    try {
      this.port.removeEventListener('message', this.handleMessage);
      this.port.removeEventListener('error', this.handleFatal);
      this.port.terminate();
    } catch {
      // Fatal path never throws.
    }
  }
}
