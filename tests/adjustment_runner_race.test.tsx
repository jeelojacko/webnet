/** @vitest-environment jsdom */

import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAdjustmentRunner } from '../src/hooks/useAdjustmentRunner';
import type { RunSessionOutcome } from '../src/engine/runSession';
import { createRunSessionRequest } from './helpers/runSessionRequest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const request = createRunSessionRequest();

const makeOutcome = (marker: string): RunSessionOutcome =>
  ({
    result: { success: true, marker },
    marker,
    effectiveExcludedIds: [],
    effectiveClusterApprovedMerges: [],
    droppedExclusions: 0,
    droppedOverrides: 0,
    droppedClusterMerges: 0,
    inputChangedSinceLastRun: false,
    elapsedMs: 1,
    profile: { totalElapsedMs: 1, solveInvocationCount: 1, stages: [] },
  }) as unknown as RunSessionOutcome;

const outcomeA = makeOutcome('A');
const outcomeB = makeOutcome('B');

type WorkerInstance = {
  onmessage: ((_event: MessageEvent) => void) | null;
  posted: unknown[];
};

const installWorkerMock = (): { instances: WorkerInstance[]; restore: () => void } => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  const instances: WorkerInstance[] = [];
  class MockWorker {
    onmessage: ((_event: MessageEvent) => void) | null = null;

    posted: unknown[] = [];

    constructor() {
      instances.push(this);
    }

    addEventListener(type: string, listener: (_event: MessageEvent) => void) {
      if (type === 'message') this.onmessage = listener;
    }

    removeEventListener(type: string, listener: (_event: MessageEvent) => void) {
      if (type === 'message' && this.onmessage === listener) this.onmessage = null;
    }

    postMessage(message: unknown) {
      this.posted.push(message);
    }

    terminate() {}
  }
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: MockWorker });
  return {
    instances,
    restore: () => {
      if (descriptor) Object.defineProperty(globalThis, 'Worker', descriptor);
      else delete (globalThis as { Worker?: unknown }).Worker;
    },
  };
};

const disableWorker = (): (() => void) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: undefined });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, 'Worker', descriptor);
    else delete (globalThis as { Worker?: unknown }).Worker;
  };
};

type RunnerApi = {
  run: (_request: typeof request) => Promise<RunSessionOutcome>;
  cancel: () => void;
  status: () => string;
  detail: () => string;
};

const mountRunner = async (
  directRunner?: () => RunSessionOutcome,
): Promise<{ api: RunnerApi; cleanup: () => Promise<void> }> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const holder: { run: RunnerApi['run'] | null; cancel: (() => void) | null } = {
    run: null,
    cancel: null,
  };
  const Harness = () => {
    const { pipelineState, run, cancel } = useAdjustmentRunner(directRunner);
    useEffect(() => {
      holder.run = (req) => run(req);
      holder.cancel = cancel;
    }, [run, cancel]);
    return (
      <div>
        <div id="status">{`${pipelineState.status}:${pipelineState.phase ?? 'none'}:${pipelineState.runId ?? 'none'}`}</div>
        <div id="detail">{`${pipelineState.detail ?? '-'}|${pipelineState.solveIndex ?? '-'}/${pipelineState.solveTotalHint ?? '-'}|${pipelineState.iteration ?? '-'}/${pipelineState.maxIterations ?? '-'}`}</div>
      </div>
    );
  };
  await act(async () => {
    root.render(<Harness />);
  });
  if (!holder.run || !holder.cancel) throw new Error('harness did not mount');
  const api: RunnerApi = {
    run: (req) => holder.run!(req),
    cancel: () => holder.cancel!(),
    status: () => container.querySelector('#status')?.textContent ?? '',
    detail: () => container.querySelector('#detail')?.textContent ?? '',
  };
  return {
    api: {
      run: (req) => api.run(req),
      cancel: () => api.cancel(),
      status: () => container.querySelector('#status')?.textContent ?? '',
      detail: () => container.querySelector('#detail')?.textContent ?? '',
    },
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

const runIdOf = (posted: unknown): string => (posted as { runId: string }).runId;

const track = (promise: Promise<RunSessionOutcome>, tag: string, log: string[]): void => {
  void promise.then(
    (value) => {
      log.push(`${tag}:resolved:${(value as unknown as { marker?: string }).marker ?? '?'}`);
    },
    (error) => {
      log.push(`${tag}:rejected:${error instanceof Error ? error.message : String(error)}`);
    },
  );
};

const flush = async (): Promise<void> => {
  await act(async () => {});
};

afterEach(() => {
  vi.useRealTimers();
});

describe('adjustment runner race safety (worker-backed)', () => {
  it('A: A→B→Bsucc→Asucc-late applies B, ignores late A', async () => {
    const { instances, restore } = installWorkerMock();
    const { api, cleanup } = await mountRunner(() => outcomeA);
    const log: string[] = [];
    try {
      let promiseA: Promise<RunSessionOutcome>;
      let promiseB: Promise<RunSessionOutcome>;
      await act(async () => {
        promiseA = api.run(request);
        void promiseA.catch(() => undefined);
        promiseB = api.run(request);
        void promiseB.catch(() => undefined);
      });
      track(promiseA!, 'A', log);
      track(promiseB!, 'B', log);
      const [idA, idB] = instances[0]!.posted.map(runIdOf);
      expect(idA).not.toBe(idB);
      await flush();
      expect(log).toContain('A:rejected:Run superseded');
      await act(async () => {
        instances[0]!.onmessage?.({ data: { type: 'success', runId: idB, payload: outcomeB } } as MessageEvent);
      });
      await act(async () => {
        instances[0]!.onmessage?.({ data: { type: 'success', runId: idA, payload: outcomeA } } as MessageEvent);
      });
      await flush();
      expect(log).toContain('B:resolved:B');
      expect(log.filter((entry) => entry.startsWith('A:'))).toEqual(['A:rejected:Run superseded']);
      expect(api.status().startsWith('idle:none')).toBe(true);
    } finally {
      await cleanup();
      restore();
    }
  });

  it('B: A→B→Asucc→Bsucc ignores A, applies B', async () => {
    const { instances, restore } = installWorkerMock();
    const { api, cleanup } = await mountRunner(() => outcomeA);
    const log: string[] = [];
    try {
      let promiseA: Promise<RunSessionOutcome>;
      let promiseB: Promise<RunSessionOutcome>;
      await act(async () => {
        promiseA = api.run(request);
        void promiseA.catch(() => undefined);
        promiseB = api.run(request);
        void promiseB.catch(() => undefined);
      });
      track(promiseA!, 'A', log);
      track(promiseB!, 'B', log);
      const [idA, idB] = instances[0]!.posted.map(runIdOf);
      await flush();
      await act(async () => {
        instances[0]!.onmessage?.({ data: { type: 'success', runId: idA, payload: outcomeA } } as MessageEvent);
      });
      await flush();
      expect(log).toContain('A:rejected:Run superseded');
      expect(api.status().startsWith('running:queued')).toBe(true);
      await act(async () => {
        instances[0]!.onmessage?.({ data: { type: 'success', runId: idB, payload: outcomeB } } as MessageEvent);
      });
      await flush();
      expect(log).toContain('B:resolved:B');
      expect(api.status().startsWith('idle:none')).toBe(true);
    } finally {
      await cleanup();
      restore();
    }
  });

  it('C: A→B→Afail→Bsucc keeps B running, then applies B', async () => {
    const { instances, restore } = installWorkerMock();
    const { api, cleanup } = await mountRunner(() => outcomeA);
    const log: string[] = [];
    try {
      let promiseA: Promise<RunSessionOutcome>;
      let promiseB: Promise<RunSessionOutcome>;
      await act(async () => {
        promiseA = api.run(request);
        void promiseA.catch(() => undefined);
        promiseB = api.run(request);
        void promiseB.catch(() => undefined);
      });
      track(promiseA!, 'A', log);
      track(promiseB!, 'B', log);
      const [idA, idB] = instances[0]!.posted.map(runIdOf);
      await flush();
      await act(async () => {
        instances[0]!.onmessage?.({ data: { type: 'failure', runId: idA, error: 'stale boom' } } as MessageEvent);
      });
      await flush();
      expect(log).toContain('A:rejected:Run superseded');
      expect(api.status().startsWith('running:')).toBe(true);
      await act(async () => {
        instances[0]!.onmessage?.({ data: { type: 'success', runId: idB, payload: outcomeB } } as MessageEvent);
      });
      await flush();
      expect(log).toContain('B:resolved:B');
      expect(api.status().startsWith('idle:none')).toBe(true);
    } finally {
      await cleanup();
      restore();
    }
  });

  it('D: A→B→Bsucc→Afail-late keeps B, never reports failed', async () => {
    const { instances, restore } = installWorkerMock();
    const { api, cleanup } = await mountRunner(() => outcomeA);
    const log: string[] = [];
    try {
      let promiseA: Promise<RunSessionOutcome>;
      let promiseB: Promise<RunSessionOutcome>;
      await act(async () => {
        promiseA = api.run(request);
        void promiseA.catch(() => undefined);
        promiseB = api.run(request);
        void promiseB.catch(() => undefined);
      });
      track(promiseA!, 'A', log);
      track(promiseB!, 'B', log);
      const [idA, idB] = instances[0]!.posted.map(runIdOf);
      await flush();
      await act(async () => {
        instances[0]!.onmessage?.({ data: { type: 'success', runId: idB, payload: outcomeB } } as MessageEvent);
      });
      await act(async () => {
        instances[0]!.onmessage?.({ data: { type: 'failure', runId: idA, error: 'late boom' } } as MessageEvent);
      });
      await flush();
      expect(log).toContain('B:resolved:B');
      expect(api.status().startsWith('idle:none')).toBe(true);
    } finally {
      await cleanup();
      restore();
    }
  });

  it('E/F/G: cancel then late success/failure/gnss-failure never mutate incorrectly', async () => {
    for (const terminal of ['success', 'failure', 'gnss-failure'] as const) {
      const { instances, restore } = installWorkerMock();
      const { api, cleanup } = await mountRunner(() => outcomeA);
      const log: string[] = [];
      try {
        let promise: Promise<RunSessionOutcome>;
        await act(async () => {
          promise = api.run(request);
          void promise.catch(() => undefined);
        });
        track(promise!, 'A', log);
        const [idA] = instances[0]!.posted.map(runIdOf);
        await act(async () => {
          api.cancel();
        });
        const cancelPosted = instances[0]!.posted[1] as { type: string; runId: string };
        expect(cancelPosted.type).toBe('cancel');
        expect(cancelPosted.runId).toBe(idA);
        await act(async () => {
          if (terminal === 'success') {
            instances[0]!.onmessage?.({ data: { type: 'success', runId: idA, payload: outcomeA } } as MessageEvent);
          } else {
            instances[0]!.onmessage?.({ data: { type: terminal, runId: idA, error: 'late' } } as MessageEvent);
          }
        });
        await flush();
        expect(log).toEqual(['A:rejected:Run cancelled']);
        expect(api.status().startsWith('cancelled:none')).toBe(true);
      } finally {
        await cleanup();
        restore();
      }
    }
  });

  it('H: stale A progress never overwrites B progress fields', async () => {
    const { instances, restore } = installWorkerMock();
    const { api, cleanup } = await mountRunner(() => outcomeA);
    const log: string[] = [];
    try {
      let promiseB: Promise<RunSessionOutcome>;
      await act(async () => {
        api.run(request).catch(() => undefined);
        promiseB = api.run(request);
        void promiseB.catch(() => undefined);
      });
      track(promiseB!, 'B', log);
      const [idA, idB] = instances[0]!.posted.map(runIdOf);
      await flush();
      await act(async () => {
        instances[0]!.onmessage?.({
          data: { type: 'progress', runId: idA, phase: 'solving', stageLabel: 'stale-A', solveIndex: 1, solveTotalHint: 2, iteration: 1, maxIterations: 5 },
        } as MessageEvent);
      });
      // Stale progress from A is dropped: pipeline stays on B's queued run.
      expect(api.status().startsWith('running:queued')).toBe(true);
      await act(async () => {
        instances[0]!.onmessage?.({
          data: { type: 'progress', runId: idB, phase: 'solving', stageLabel: 'B-stage', solveIndex: 3, solveTotalHint: 9, iteration: 2, maxIterations: 10 },
        } as MessageEvent);
      });
      const detailAfterB = api.detail();
      expect(detailAfterB).toBe('B-stage|3/9|2/10');
      await act(async () => {
        instances[0]!.onmessage?.({
          data: { type: 'progress', runId: idA, phase: 'solving', stageLabel: 'stale-A-2', solveIndex: 7, solveTotalHint: 7, iteration: 7, maxIterations: 7 },
        } as MessageEvent);
      });
      expect(api.detail()).toBe(detailAfterB);
      await act(async () => {
        instances[0]!.onmessage?.({ data: { type: 'success', runId: idB, payload: outcomeB } } as MessageEvent);
      });
      await flush();
      expect(log).toContain('B:resolved:B');
      expect(api.status().startsWith('idle:none')).toBe(true);
    } finally {
      await cleanup();
      restore();
    }
  });

  it('I: cancel after A→B targets B; late A stays superseded', async () => {
    const { instances, restore } = installWorkerMock();
    const { api, cleanup } = await mountRunner(() => outcomeA);
    const log: string[] = [];
    try {
      let promiseA: Promise<RunSessionOutcome>;
      let promiseB: Promise<RunSessionOutcome>;
      await act(async () => {
        promiseA = api.run(request);
        void promiseA.catch(() => undefined);
        promiseB = api.run(request);
        void promiseB.catch(() => undefined);
      });
      track(promiseA!, 'A', log);
      track(promiseB!, 'B', log);
      const [idA, idB] = instances[0]!.posted.map(runIdOf);
      await flush();
      await act(async () => {
        api.cancel();
      });
      const cancelPosted = instances[0]!.posted[2] as { type: string; runId: string };
      expect(cancelPosted.type).toBe('cancel');
      expect(cancelPosted.runId).toBe(idB);
      await act(async () => {
        instances[0]!.onmessage?.({ data: { type: 'success', runId: idB, payload: outcomeB } } as MessageEvent);
      });
      await act(async () => {
        instances[0]!.onmessage?.({ data: { type: 'success', runId: idA, payload: outcomeA } } as MessageEvent);
      });
      await flush();
      expect(log).toContain('A:rejected:Run superseded');
      expect(log).toContain('B:rejected:Run cancelled');
      expect(api.status().startsWith('cancelled:none')).toBe(true);
    } finally {
      await cleanup();
      restore();
    }
  });

  it('apply-outcome race: B context wins, late A never applies', async () => {
    const { instances, restore } = installWorkerMock();
    const { api, cleanup } = await mountRunner(() => outcomeA);
    const applied: string[] = [];
    try {
      const apply = (marker: string) => (_outcome: RunSessionOutcome) => {
        applied.push(marker);
      };
      let idA = '';
      let idB = '';
      await act(async () => {
        // Mirror useAdjustmentWorkflow: run().then(apply with run context).
        void api.run(request).then(apply('A-context'), () => undefined);
        void api.run(request).then(apply('B-context'), () => undefined);
      });
      [idA, idB] = instances[0]!.posted.map(runIdOf);
      await flush();
      await act(async () => {
        instances[0]!.onmessage?.({ data: { type: 'success', runId: idA, payload: outcomeA } } as MessageEvent);
      });
      await act(async () => {
        instances[0]!.onmessage?.({ data: { type: 'success', runId: idB, payload: outcomeB } } as MessageEvent);
      });
      await flush();
      expect(applied).toEqual(['B-context']);
    } finally {
      await cleanup();
      restore();
    }
  });
});

describe('adjustment runner race safety (direct fallback)', () => {
  it('A→B applies B; A settles superseded without touching state', async () => {
    vi.useFakeTimers();
    const restoreWorker = disableWorker();
    const { api, cleanup } = await mountRunner(() => outcomeB);
    const applied: string[] = [];
    const log: string[] = [];
    try {
      await act(async () => {
        void api
          .run(request)
          .then((value) => {
            applied.push((value as unknown as { marker: string }).marker);
          })
          .catch((error) => {
            log.push(`A:${error instanceof Error ? error.message : String(error)}`);
          });
        void api
          .run(request)
          .then((value) => {
            applied.push((value as unknown as { marker: string }).marker);
          })
          .catch((error) => {
            log.push(`B:${error instanceof Error ? error.message : String(error)}`);
          });
      });
      await act(async () => {
        vi.runAllTimers();
      });
      await flush();
      expect(applied).toEqual(['B']);
      expect(log).toEqual(['A:Run superseded']);
      expect(api.status().startsWith('idle:none')).toBe(true);
    } finally {
      await cleanup();
      restoreWorker();
    }
  });

  it('B: stale direct completion cannot win when B is still queued', async () => {
    vi.useFakeTimers();
    const restoreWorker = disableWorker();
    let calls = 0;
    const { api, cleanup } = await mountRunner(() => {
      calls += 1;
      return calls === 1 ? outcomeA : outcomeB;
    });
    const applied: string[] = [];
    try {
      await act(async () => {
        // A is superseded eagerly at B start, so only B's direct solve runs.
        void api.run(request).then(
          () => applied.push('A'),
          () => applied.push('A-rejected'),
        );
        void api.run(request).then(
          () => applied.push('B'),
          () => applied.push('B-rejected'),
        );
      });
      await act(async () => {
        vi.runAllTimers();
      });
      await flush();
      expect(applied).toEqual(['A-rejected', 'B']);
      expect(calls).toBe(1);
      expect(api.status().startsWith('idle:none')).toBe(true);
    } finally {
      await cleanup();
      restoreWorker();
    }
  });

  it('cancel before direct solve settles as cancelled; late paths stay cancelled', async () => {
    vi.useFakeTimers();
    const restoreWorker = disableWorker();
    const { api, cleanup } = await mountRunner(() => outcomeA);
    const log: string[] = [];
    try {
      await act(async () => {
        void api.run(request).then(
          () => log.push('resolved'),
          (error) => log.push(`rejected:${error instanceof Error ? error.message : String(error)}`),
        );
      });
      await act(async () => {
        api.cancel();
      });
      expect(api.status().startsWith('cancelled:none')).toBe(true);
      await act(async () => {
        vi.runAllTimers();
      });
      await flush();
      expect(log).toEqual(['rejected:Run cancelled']);
      expect(api.status().startsWith('cancelled:none')).toBe(true);
    } finally {
      await cleanup();
      restoreWorker();
    }
  });

  it('direct throw of the current run still reports failed', async () => {
    vi.useFakeTimers();
    const restoreWorker = disableWorker();
    const { api, cleanup } = await mountRunner(() => {
      throw new Error('direct boom');
    });
    const log: string[] = [];
    try {
      await act(async () => {
        void api.run(request).then(
          () => log.push('resolved'),
          (error) => log.push(`rejected:${error instanceof Error ? error.message : String(error)}`),
        );
      });
      await act(async () => {
        vi.runAllTimers();
      });
      await flush();
      expect(log).toEqual(['rejected:direct boom']);
      expect(api.status().startsWith('failed:none')).toBe(true);
    } finally {
      await cleanup();
      restoreWorker();
    }
  });

  it('cancel suppresses a direct throw: stays cancelled, never failed', async () => {
    vi.useFakeTimers();
    const restoreWorker = disableWorker();
    let calls = 0;
    const { api, cleanup } = await mountRunner(() => {
      calls += 1;
      throw new Error('suppressed boom');
    });
    const log: string[] = [];
    try {
      await act(async () => {
        void api.run(request).then(
          () => log.push('resolved'),
          (error) => log.push(`rejected:${error instanceof Error ? error.message : String(error)}`),
        );
      });
      await act(async () => {
        api.cancel();
      });
      await act(async () => {
        vi.runAllTimers();
      });
      await flush();
      expect(calls).toBe(0);
      expect(log).toEqual(['rejected:Run cancelled']);
      expect(api.status().startsWith('cancelled:none')).toBe(true);
    } finally {
      await cleanup();
      restoreWorker();
    }
  });
});
