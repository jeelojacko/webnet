/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { useArtifactBuilder } from '../src/hooks/useArtifactBuilder';
import type {
  ArtifactRequestMessage,
  ArtifactSuccessMessage,
} from '../src/engine/adjustmentWorkerProtocol';
import type {
  BuildExportArtifactsRequest,
  BuildExportArtifactsResult,
} from '../src/engine/exportArtifacts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const artifactRequest = {
  exportFormat: 'webnet',
  dateStamp: '2026-03-20',
} as BuildExportArtifactsRequest;

const artifactResult: BuildExportArtifactsResult = {
  files: [
    {
      name: 'webnet-results-2026-03-20.txt',
      mimeType: 'text/plain',
      text: 'WEBNET REPORT',
    },
  ],
};

const mountHarness = async (
  directBuilder: (_request: BuildExportArtifactsRequest) => BuildExportArtifactsResult,
): Promise<{ container: HTMLDivElement; cleanup: () => Promise<void> }> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  const Harness = () => {
    const { buildArtifacts } = useArtifactBuilder(directBuilder);
    const [status, setStatus] = React.useState('idle');
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            void buildArtifacts(artifactRequest)
              .then((result) => setStatus(result.files[0]?.name ?? 'none'))
              .catch((error) =>
                setStatus(`error:${error instanceof Error ? error.message : String(error)}`),
              );
          }}
        >
          Build
        </button>
        <div id="status">{status}</div>
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

describe('useArtifactBuilder', () => {
  it('falls back to the direct builder when workers are unavailable', async () => {
    vi.useFakeTimers();
    const workerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      value: undefined,
    });
    const directBuilder = vi.fn(() => artifactResult);

    const mounted = await mountHarness(directBuilder);
    const button = mounted.container.querySelector('button') as HTMLButtonElement;

    await act(async () => {
      button.click();
      vi.runAllTimers();
    });

    expect(directBuilder).toHaveBeenCalledWith(artifactRequest);
    expect(mounted.container.querySelector('#status')?.textContent).toBe(
      'webnet-results-2026-03-20.txt',
    );

    await mounted.cleanup();
    if (workerDescriptor) Object.defineProperty(globalThis, 'Worker', workerDescriptor);
    else delete (globalThis as { Worker?: unknown }).Worker;
    vi.useRealTimers();
  });

  it('routes artifact builds through the worker message path when workers are available', async () => {
    class MockWorker {
      listener: ((_: MessageEvent<ArtifactSuccessMessage>) => void) | null = null;
      postedMessages: ArtifactRequestMessage[] = [];

      addEventListener(
        _type: string,
        listener: (_: MessageEvent<ArtifactSuccessMessage>) => void,
      ) {
        this.listener = listener;
      }

      removeEventListener() {}

      postMessage(message: ArtifactRequestMessage) {
        this.postedMessages.push(message);
        const response: ArtifactSuccessMessage = {
          type: 'artifact-success',
          taskId: message.taskId,
          payload: artifactResult,
        };
        this.listener?.({ data: response } as MessageEvent<ArtifactSuccessMessage>);
      }

      terminate() {}
    }

    const workerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
    const workerInstance = new MockWorker();
    class MockWorkerConstructor {
      constructor(_url: URL, _options?: unknown) {
        return workerInstance;
      }
    }
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      value: MockWorkerConstructor,
    });
    const directBuilder = vi.fn(() => artifactResult);

    const mounted = await mountHarness(directBuilder);
    const button = mounted.container.querySelector('button') as HTMLButtonElement;

    await act(async () => {
      button.click();
    });

    expect(workerInstance.postedMessages).toHaveLength(1);
    expect(workerInstance.postedMessages[0]).toEqual(
      expect.objectContaining({
        type: 'artifact',
        payload: artifactRequest,
      }),
    );
    expect(directBuilder).not.toHaveBeenCalled();
    expect(mounted.container.querySelector('#status')?.textContent).toBe(
      'webnet-results-2026-03-20.txt',
    );

    await mounted.cleanup();
    if (workerDescriptor) Object.defineProperty(globalThis, 'Worker', workerDescriptor);
    else delete (globalThis as { Worker?: unknown }).Worker;
  });
});
