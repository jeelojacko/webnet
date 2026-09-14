/**
 * Phase 12J.9 Track C — bounded session worker pool (no math, no UI).
 *
 * Runs one session's edges over the existing gnss-raw worker protocol
 * (handleGnssRawRun message kinds, isCurrentJob token gate) with at most
 * PAR concurrent Workers (default 2); the rest wait in a bounded queue.
 * Per-edge processor state is independent (fresh module per job in the
 * worker); only immutable input bytes are shared. One edge failing never
 * touches its siblings: the session goes PARTIAL naming the exact edge.
 *
 * Security bounds: max 20 stations per session, max 19 queued jobs, no
 * archive extraction anywhere, and MEMFS staging reuses the fixed
 * /work/*.obs|nav|pos names in stageInputs — user filenames never enter
 * the worker filesystem (they stay provenance-only).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { GNSS_RAW_WORKER_CHANNEL, isCurrentJob } from '../engine/gnssRawWorkerProtocol';
import type { GnssRawRnx2rtkpJob } from '../engine/gnssRawRnx2rtkp';
import { assignDependencyGroup } from '../engine/gnssRawSession';
import { SESSION_STOCHASTIC_FREEZE } from '../engine/gnssRawSessionModel';
import {
  revalidateGraph,
  type SessionGraph,
  type SessionGraphEdge,
} from '../engine/gnssRawSessionGraph';
import type { ProcessedRawGnssBaseline, RawGnssProcessingError } from '../engine/gnssRawTypes';
import type { RawSessionStatus } from '../engine/gnssRawSessionExport';

export const SESSION_MAX_STATIONS = 20;
export const SESSION_MAX_QUEUED_JOBS = 19;
export const DEFAULT_SESSION_PAR = 2;

export interface SessionEdgeSpec {
  readonly edgeId: string;
  readonly from: string;
  readonly to: string;
  readonly job: GnssRawRnx2rtkpJob;
}

export type SessionEdgeState = 'queued' | 'active' | 'done' | 'failed' | 'cancelled';

export interface SessionEdgeRecord {
  readonly spec: SessionEdgeSpec;
  state: SessionEdgeState;
  result: ProcessedRawGnssBaseline | null;
  error: RawGnssProcessingError | null;
}

export interface SessionJobDriver {
  start(
    _spec: SessionEdgeSpec,
    _events: {
      onSuccess: (_result: ProcessedRawGnssBaseline) => void;
      onFailure: (_error: RawGnssProcessingError) => void;
    },
  ): () => void;
}

export type SessionPoolSnapshot = {
  readonly [edgeId: string]: SessionEdgeState;
};

/**
 * Framework-free pool core: concurrency bound, failure isolation,
 * token-gated cancel. The React hook below is a thin driver adapter.
 */
export class RawSessionPool {
  private readonly par: number;
  private readonly driver: SessionJobDriver;
  private onChange: () => void;
  private readonly edges = new Map<string, SessionEdgeRecord>();
  private order: string[] = [];
  private active = 0;
  private generation = 0;
  private cancelled = false;
  private cancels: Array<() => void> = [];

  constructor(driver: SessionJobDriver, par: number = DEFAULT_SESSION_PAR) {
    this.driver = driver;
    this.par = Math.max(1, par);
    this.onChange = () => {};
  }

  /** Hook wiring: notify React after each settle so snapshots refresh. */
  setOnChange(fn: () => void): void {
    this.onChange = fn;
  }

  private settled(): void {
    this.onChange();
  }

  get activeCount(): number {
    return this.active;
  }

  get isCancelled(): boolean {
    return this.cancelled;
  }

  enqueue(specs: readonly SessionEdgeSpec[]): void {
    if (this.cancelled) return;
    if (this.order.length + specs.length > SESSION_MAX_QUEUED_JOBS + this.par) {
      throw new Error(`Session queue bound: max ${SESSION_MAX_QUEUED_JOBS} queued jobs.`);
    }
    for (const spec of specs) {
      if (this.edges.has(spec.edgeId)) throw new Error(`Duplicate edge ${spec.edgeId}.`);
      this.edges.set(spec.edgeId, { spec, state: 'queued', result: null, error: null });
      this.order.push(spec.edgeId);
    }
    this.pump();
  }

  snapshot(): SessionPoolSnapshot {
    const out: Record<string, SessionEdgeState> = {};
    for (const [id, rec] of this.edges) out[id] = rec.state;
    return out;
  }

  edgeError(edgeId: string): RawGnssProcessingError | null {
    return this.edges.get(edgeId)?.error ?? null;
  }

  edgeResult(edgeId: string): ProcessedRawGnssBaseline | null {
    return this.edges.get(edgeId)?.result ?? null;
  }

  completedResults(): ProcessedRawGnssBaseline[] {
    return [...this.edges.values()]
      .filter((r) => r.state === 'done' && r.result)
      .map((r) => r.result!)
      .sort((a, b) => (`${a.from}->${a.to}` < `${b.from}->${b.to}` ? -1 : 1));
  }

  failedEdges(): string[] {
    return [...this.edges.entries()]
      .filter(([, r]) => r.state === 'failed')
      .map(([id]) => id)
      .sort();
  }

  sessionStatus(): RawSessionStatus {
    if (this.cancelled) return 'CANCELLED';
    const recs = [...this.edges.values()];
    if (recs.length === 0) return 'FAILED';
    if (recs.some((r) => r.state === 'queued' || r.state === 'active')) {
      return recs.some((r) => r.state === 'failed') ? 'PARTIAL' : 'FAILED';
    }
    const done = recs.filter((r) => r.state === 'done').length;
    const failed = recs.filter((r) => r.state === 'failed').length;
    if (failed === 0 && done === recs.length) return 'COMPLETE';
    if (done > 0) return 'PARTIAL';
    return 'FAILED';
  }

  /** Release a latched cancel so the pool accepts new work.
   * Safe after StrictMode remount (no jobs yet) and before an explicit
   * user re-run. Drops terminal 'cancelled' records only; done/failed
   * results are retained. Never called while jobs are active. */
  reset(): void {
    if (this.active > 0) return;
    this.cancelled = false;
    for (const [id, rec] of this.edges) {
      if (rec.state === 'cancelled') this.edges.delete(id);
    }
    this.order = [];
  }

  cancel(): void {
    this.generation += 1;
    this.cancelled = true;
    for (const cancel of this.cancels) {
      try {
        cancel();
      } catch { /* terminate is best-effort */ }
    }
    this.cancels = [];
    this.active = 0;
    for (const rec of this.edges.values()) {
      if (rec.state === 'queued' || rec.state === 'active') rec.state = 'cancelled';
    }
    this.order = [];
  }

  private pump(): void {
    if (this.cancelled) return;
    while (this.active < this.par && this.order.length > 0) {
      const id = this.order.shift()!;
      const rec = this.edges.get(id);
      if (!rec || rec.state !== 'queued') continue;
      rec.state = 'active';
      this.active += 1;
      const token = this.generation;
      const cancel = this.driver.start(rec.spec, {
        onSuccess: (result) => {
          if (token !== this.generation || rec.state !== 'active') return;
          rec.state = 'done';
          rec.result = result;
          this.active -= 1;
          this.pump();
          this.settled();
        },
        onFailure: (error) => {
          if (token !== this.generation || rec.state !== 'active') return;
          rec.state = 'failed';
          rec.error = error;
          this.active -= 1;
          this.pump();
          this.settled();
        },
      });
      this.cancels.push(cancel);
    }
  }
}

export const checkStationBound = (stations: readonly string[]): void => {
  if (stations.length > SESSION_MAX_STATIONS) {
    throw new Error(`Session bound: max ${SESSION_MAX_STATIONS} stations, got ${stations.length}.`);
  }
};

/**
 * Replacement edge: drops the failed leg, inserts the caller-supplied
 * pair as a zero-vector planned edge, and revalidates the tree. The
 * modification is recorded in graph provenance.
 */
export const replaceSessionEdge = (
  graph: SessionGraph,
  failedEdge: { readonly from: string; readonly to: string },
  replacement: { readonly from: string; readonly to: string },
): { readonly graph: SessionGraph; readonly ok: boolean; readonly errors: string[] } => {
  const kept = graph.edges.filter(
    (e) => !(e.from === failedEdge.from && e.to === failedEdge.to),
  );
  const planned: SessionGraphEdge = {
    from: replacement.from,
    to: replacement.to,
    deltaX: 0,
    deltaY: 0,
    deltaZ: 0,
    covariance: { xx: 0, xy: 0, xz: 0, yy: 0, yz: 0, zz: 0 },
    baseObsSha: '',
    roverObsSha: '',
    dependencyGroup: assignDependencyGroup({
      baseObsSha: replacement.from,
      roverObsSha: replacement.to,
    }),
    stochastic: SESSION_STOCHASTIC_FREEZE,
  };
  const next: SessionGraph = { ...graph, edges: [...kept, planned] };
  const { graph: recorded, validation } = revalidateGraph(
    next,
    `replace ${failedEdge.from}->${failedEdge.to} with ${replacement.from}->${replacement.to}`,
  );
  return {
    graph: recorded,
    ok: validation.ok,
    errors: validation.ok ? [] : validation.errors,
  };
}

const createWorkerDriver = (register: (_cancel: () => void) => void): SessionJobDriver => ({
  start: (spec, events) => {
    const worker = new Worker(new URL('../workers/gnssRawWorker.ts', import.meta.url), {
      type: 'module',
    });
    const jobId = spec.edgeId;
    let live: string | null = jobId;
    worker.onmessage = (event: MessageEvent): void => {
      const message = event.data as { jobId?: string; kind?: string };
      if (!isCurrentJob(live, String(message.jobId ?? ''))) return;
      if (message.kind === 'gnss-raw-success') {
        live = null;
        events.onSuccess((message as { result: ProcessedRawGnssBaseline }).result);
        worker.terminate();
      } else if (message.kind === 'gnss-raw-failure') {
        live = null;
        events.onFailure((message as { error: RawGnssProcessingError }).error);
        worker.terminate();
      }
    };
    worker.onerror = () => {
      if (!isCurrentJob(live, jobId)) return;
      live = null;
      events.onFailure({ code: 'PROCESSOR_FAILURE', message: `Raw GNSS worker failed for ${jobId}.` });
      worker.terminate();
    };
    worker.postMessage({ kind: 'gnss-raw-run', channel: GNSS_RAW_WORKER_CHANNEL, jobId, job: spec.job });
    const cancel = (): void => {
      live = null;
      worker.terminate();
    };
    register(cancel);
    return cancel;
  },
});

export interface UseGnssRawSession {
  readonly snapshot: SessionPoolSnapshot;
  readonly status: RawSessionStatus;
  readonly failed: string[];
  readonly failedDetails: Readonly<Record<string, string>>;
  readonly start: (_sessionId: string, _specs: readonly SessionEdgeSpec[]) => void;
  readonly cancel: () => void;
  readonly results: ProcessedRawGnssBaseline[];
}

/** Bounded queue over one Worker per active job (PAR default 2). */
export const useGnssRawSession = (par: number = DEFAULT_SESSION_PAR): UseGnssRawSession => {
  const [cancels] = useState<Array<() => void>>(() => []);
  const [tick, bump] = useState(0);
  const refresh = useCallback(() => bump((n) => n + 1), []);
  const [pool] = useState(
    () => new RawSessionPool(
      createWorkerDriver((cancel) => {
        cancels.push(cancel);
      }),
      par,
    ),
  );

  useEffect(() => {
    pool.reset();
    pool.setOnChange(refresh);
    return () => {
      pool.cancel();
      cancels.length = 0;
    };
  }, [pool, refresh, cancels]);

  const start = useCallback(
    (_sessionId: string, specs: readonly SessionEdgeSpec[]): void => {
      checkStationBound([...new Set(specs.flatMap((s) => [s.from, s.to]))]);
      pool.reset();
      pool.enqueue(specs);
      refresh();
    },
    [pool, refresh],
  );

  const cancel = useCallback((): void => {
    pool.cancel();
    refresh();
  }, [pool, refresh]);

  return useMemo(
    () => ({
      snapshot: pool.snapshot(),
      status: pool.sessionStatus(),
      failed: pool.failedEdges(),
      failedDetails: Object.fromEntries(
        pool.failedEdges().map((id) => [id, pool.edgeError(id)?.message ?? 'unknown failure']),
      ),
      start,
      cancel,
      results: pool.completedResults(),
    }),
    [pool, start, cancel, tick],
  );
};
