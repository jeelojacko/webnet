/**
 * Phase 12J.4 Track RUNTIME — dedicated raw-GNSS processing worker.
 *
 * Own channel ('gnss-raw-process'), own WASM instance per job, own protocol.
 * NEVER touches solve state, the project, or the existing worker protocol. Safe to terminate at any point: no shared mutable state, and
 * the host drops responses for superseded jobIds (see isCurrentJob).
 */
import type { GnssRawWasmModule } from '../engine/gnssRawRnx2rtkp';
import { runRawBaseline } from '../engine/gnssRawRnx2rtkp';
import {
  GNSS_RAW_WORKER_CHANNEL,
  type GnssRawWorkerRequest,
  type GnssRawWorkerResponse,
} from '../engine/gnssRawWorkerProtocol';
import type { RawGnssProcessingError } from '../engine/gnssRawTypes';

type PostFn = (_message: GnssRawWorkerResponse) => void;

export const resolveGnssRawWasmGlueUrl = (): string => {
  const base = import.meta.env.BASE_URL ?? '/';
  const locationHref = (globalThis as { location?: { href?: unknown } }).location?.href;
  if (typeof locationHref !== 'string' || locationHref.length === 0) {
    throw new Error('gnss-raw bundle requires a worker location (fail-closed).');
  }
  const basePath = base.endsWith('/') ? base : `${base}/`;
  return new URL(`${basePath}rtklib-rnx2rtkp.js`, locationHref).href;
};

const loadFreshModule = async (): Promise<GnssRawWasmModule> => {
  // Indirect dynamic import: keeps bundlers from rewriting this specifier.
  const indirectImport = new Function(
    'specifier',
    'return import(specifier);',
  ) as (_specifier: string) => Promise<unknown>;
  const imported = (await indirectImport(resolveGnssRawWasmGlueUrl())) as unknown as {
    default?: () => Promise<GnssRawWasmModule>;
  };
  if (!imported || typeof imported.default !== 'function') {
    throw new Error('gnss-raw WASM factory unavailable.');
  }
  return imported.default();
};

const toProcessingError = (error: unknown): RawGnssProcessingError => {
  const raw = (error as { rawGnss?: RawGnssProcessingError })?.rawGnss;
  if (raw != null) return raw;
  return {
    code: 'PROCESSOR_FAILURE',
    message: 'Raw GNSS processing failed.',
    detail: error instanceof Error ? error.message : String(error),
  };
};

/** Handles one run request with a fresh per-job WASM instance (isolation). */
export const handleGnssRawRun = async (
  request: GnssRawWorkerRequest,
  post: PostFn,
  loadModule: () => Promise<GnssRawWasmModule> = loadFreshModule,
): Promise<void> => {
  const { jobId, job } = request;
  const mod = await loadModule();
  const result = runRawBaseline(mod, job, (stage) => {
    post({ kind: 'gnss-raw-progress', channel: GNSS_RAW_WORKER_CHANNEL, jobId, stage });
  });
  post({ kind: 'gnss-raw-success', channel: GNSS_RAW_WORKER_CHANNEL, jobId, result });
};

const scope = globalThis as {
  onmessage?: ((_event: MessageEvent<GnssRawWorkerRequest>) => void) | null;
  postMessage?: (_message: unknown) => void;
};

if (typeof scope.postMessage === 'function' && typeof WorkerGlobalScope !== 'undefined') {
  scope.onmessage = (event: MessageEvent<GnssRawWorkerRequest>): void => {
    const request = event.data;
    if (request?.channel !== GNSS_RAW_WORKER_CHANNEL || request?.kind !== 'gnss-raw-run') return;
    const post: PostFn = (message) => scope.postMessage!(message);
    handleGnssRawRun(request, post).catch((error: unknown) => {
      post({
        kind: 'gnss-raw-failure',
        channel: GNSS_RAW_WORKER_CHANNEL,
        jobId: request.jobId,
        error: toProcessingError(error),
      });
    });
  };
}
