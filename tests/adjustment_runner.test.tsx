/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { useAdjustmentRunner } from '../src/hooks/useAdjustmentRunner';
import type { RunSessionOutcome } from '../src/engine/runSession';
import { createRunSessionRequest } from './helpers/runSessionRequest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const request = createRunSessionRequest();
const mockOutcome = {
  result: { success: true },
  effectiveExcludedIds: [],
  effectiveClusterApprovedMerges: [],
  droppedExclusions: 0,
  droppedOverrides: 0,
  droppedClusterMerges: 0,
  inputChangedSinceLastRun: false,
  elapsedMs: 1,
  profile: {
    totalElapsedMs: 1,
    solveInvocationCount: 1,
    stages: [{ id: 'main-solve', label: 'Main solve', durationMs: 1, solveCount: 1 }],
  },
} as unknown as RunSessionOutcome;

const mountHarness = async (
  directRunner: () => RunSessionOutcome,
): Promise<{ container: HTMLDivElement; cleanup: () => Promise<void> }> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  const Harness = () => {
    const { pipelineState, run, cancel } = useAdjustmentRunner(() => directRunner());
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            void run(request).catch(() => undefined);
          }}
        >
          Run
        </button>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
        <div id="status">{`${pipelineState.status}:${pipelineState.phase ?? 'none'}`}</div>
        <div id="detail">{`${pipelineState.detail ?? '-'}|${pipelineState.elapsedMs ?? '-'}|${
          pipelineState.solveIndex ?? '-'
        }/${pipelineState.solveTotalHint ?? '-'}|${pipelineState.iteration ?? '-'}|${
          pipelineState.maxIterations ?? '-'
        }`}</div>
      </div>
    );
  };

  await act(async () => {
    root.render(<Harness />);
  });

  return {
    container,
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

describe('useAdjustmentRunner', () => {
  it('shows queued state before the direct fallback run completes', async () => {
    vi.useFakeTimers();
    const workerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      value: undefined,
    });

    const mounted = await mountHarness(() => mockOutcome);
    const runButton = mounted.container.querySelectorAll('button')[0] as HTMLButtonElement;

    await act(async () => {
      runButton.click();
    });
    expect(mounted.container.querySelector('#status')?.textContent).toBe('running:queued');

    await act(async () => {
      vi.runAllTimers();
    });
    expect(mounted.container.querySelector('#status')?.textContent).toBe('idle:none');

    await mounted.cleanup();
    if (workerDescriptor) Object.defineProperty(globalThis, 'Worker', workerDescriptor);
    else delete (globalThis as { Worker?: unknown }).Worker;
    vi.useRealTimers();
  });

  it('supports cancelling a queued direct fallback run', async () => {
    vi.useFakeTimers();
    const workerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      value: undefined,
    });

    const mounted = await mountHarness(() => mockOutcome);
    const buttons = mounted.container.querySelectorAll('button');
    const runButton = buttons[0] as HTMLButtonElement;
    const cancelButton = buttons[1] as HTMLButtonElement;

    await act(async () => {
      runButton.click();
    });
    expect(mounted.container.querySelector('#status')?.textContent).toBe('running:queued');

    await act(async () => {
      cancelButton.click();
    });
    expect(mounted.container.querySelector('#status')?.textContent).toBe('cancelled:none');

    await act(async () => {
      vi.runAllTimers();
    });
    expect(mounted.container.querySelector('#status')?.textContent).toBe('cancelled:none');

    await mounted.cleanup();
    if (workerDescriptor) Object.defineProperty(globalThis, 'Worker', workerDescriptor);
    else delete (globalThis as { Worker?: unknown }).Worker;
    vi.useRealTimers();
  });

  it('captures worker-backed progress detail and timing while a run is in progress', async () => {
    const workerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');

    class MockWorker {
      onmessage: ((_event: MessageEvent) => void) | null = null;

      addEventListener(type: string, listener: (_event: MessageEvent) => void) {
        if (type === 'message') this.onmessage = listener;
      }

      removeEventListener(type: string, listener: (_event: MessageEvent) => void) {
        if (type === 'message' && this.onmessage === listener) this.onmessage = null;
      }

      postMessage(message: unknown) {
        this.onmessage?.({
          data: {
            type: 'artifact-progress',
            taskId: 'wrong-task',
            phase: 'queued',
          },
        } as MessageEvent);
        this.onmessage?.({
          data: {
            type: 'progress',
            runId: 123,
            phase: 'solving',
          },
        } as MessageEvent);
        const runId =
          typeof message === 'object' &&
          message != null &&
          'runId' in message &&
          typeof (message as { runId?: unknown }).runId === 'string'
            ? ((message as { runId: string }).runId as string)
            : 'worker-run';
        this.onmessage?.({
          data: {
            type: 'progress',
            runId,
            phase: 'solving',
            elapsedMs: 43210,
            stageLabel: 'Impact 2/8',
            solveIndex: 3,
            solveTotalHint: 9,
            iteration: 2,
            maxIterations: 10,
          },
        } as MessageEvent);
      }

      terminate() {}
    }

    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      value: MockWorker,
    });

    const mounted = await mountHarness(() => mockOutcome);
    const runButton = mounted.container.querySelectorAll('button')[0] as HTMLButtonElement;

    await act(async () => {
      runButton.click();
    });

    expect(mounted.container.querySelector('#status')?.textContent).toBe('running:solving');
    expect(mounted.container.querySelector('#detail')?.textContent).toBe(
      'Impact 2/8|43210|3/9|2|10',
    );

    await mounted.cleanup();
    if (workerDescriptor) Object.defineProperty(globalThis, 'Worker', workerDescriptor);
    else delete (globalThis as { Worker?: unknown }).Worker;
  });

  it('drops a worker-backed success that arrives after host cancellation', async () => {
    const workerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
    const instances: {
      onmessage: ((_event: MessageEvent) => void) | null;
      posted: unknown[];
    }[] = [];

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

    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      value: MockWorker,
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    let outcome = 'pending';
    const Harness = () => {
      const { pipelineState, run, cancel } = useAdjustmentRunner(() => mockOutcome);
      return (
        <div>
          <button
            type="button"
            onClick={() => {
              void run(request)
                .then(() => {
                  outcome = 'resolved';
                })
                .catch((error) => {
                  outcome = `rejected:${error instanceof Error ? error.message : String(error)}`;
                });
            }}
          >
            Run
          </button>
          <button type="button" onClick={cancel}>
            Cancel
          </button>
          <div id="status">{`${pipelineState.status}:${pipelineState.phase ?? 'none'}`}</div>
        </div>
      );
    };
    await act(async () => {
      root.render(<Harness />);
    });
    const buttons = container.querySelectorAll('button');
    await act(async () => {
      (buttons[0] as HTMLButtonElement).click();
    });
    const runId = (instances[0]?.posted[0] as { runId?: string })?.runId;
    expect(typeof runId).toBe('string');
    await act(async () => {
      (buttons[1] as HTMLButtonElement).click();
    });
    // Synchronous worker run completes after the host cancellation: the
    // late success must reject as cancelled so applyRunOutcome never runs.
    await act(async () => {
      instances[0]?.onmessage?.({
        data: { type: 'success', runId, payload: mockOutcome },
      } as MessageEvent);
    });
    expect(outcome).toBe('rejected:Run cancelled');
    expect(container.querySelector('#status')?.textContent).toBe('cancelled:none');
    // The worker's own late cancel acknowledgement finds no pending run
    // and is ignored without changing state.
    await act(async () => {
      instances[0]?.onmessage?.({ data: { type: 'cancelled', runId } } as MessageEvent);
    });
    expect(outcome).toBe('rejected:Run cancelled');
    expect(container.querySelector('#status')?.textContent).toBe('cancelled:none');
    await act(async () => {
      root.unmount();
    });
    container.remove();
    if (workerDescriptor) Object.defineProperty(globalThis, 'Worker', workerDescriptor);
    else delete (globalThis as { Worker?: unknown }).Worker;
  });

  it('still resolves a worker-backed success that arrives before cancellation', async () => {
    const workerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
    const instances: {
      onmessage: ((_event: MessageEvent) => void) | null;
      posted: unknown[];
    }[] = [];

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

    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      value: MockWorker,
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    let outcome = 'pending';
    const Harness = () => {
      const { pipelineState, run, cancel } = useAdjustmentRunner(() => mockOutcome);
      return (
        <div>
          <button
            type="button"
            onClick={() => {
              void run(request)
                .then(() => {
                  outcome = 'resolved';
                })
                .catch((error) => {
                  outcome = `rejected:${error instanceof Error ? error.message : String(error)}`;
                });
            }}
          >
            Run
          </button>
          <button type="button" onClick={cancel}>
            Cancel
          </button>
          <div id="status">{`${pipelineState.status}:${pipelineState.phase ?? 'none'}`}</div>
        </div>
      );
    };
    await act(async () => {
      root.render(<Harness />);
    });
    const buttons = container.querySelectorAll('button');
    await act(async () => {
      (buttons[0] as HTMLButtonElement).click();
    });
    const runId = (instances[0]?.posted[0] as { runId?: string })?.runId;
    await act(async () => {
      instances[0]?.onmessage?.({
        data: { type: 'success', runId, payload: mockOutcome },
      } as MessageEvent);
    });
    expect(outcome).toBe('resolved');
    expect(container.querySelector('#status')?.textContent).toBe('idle:none');
    await act(async () => {
      root.unmount();
    });
    container.remove();
    if (workerDescriptor) Object.defineProperty(globalThis, 'Worker', workerDescriptor);
    else delete (globalThis as { Worker?: unknown }).Worker;
  });
});
