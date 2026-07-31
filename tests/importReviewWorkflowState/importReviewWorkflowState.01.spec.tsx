/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';

import {
  act,
  createRoot,
  parseSettings,
  type Root,
  useImportReviewWorkflow,
  vi,
} from './importReviewWorkflowStateTestSupport';

describe('useImportReviewWorkflow prompt and file routing', () => {
  it('opens and clears the angle-mode prompt for prompt-required import files', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const fileInputRef = { current: null as HTMLInputElement | null };
    const setInput = vi.fn();
    const setProjectIncludeFiles = vi.fn();
    const setImportNotice = vi.fn();
    const resetWorkspaceForImportedInput = vi.fn();

    const Harness = () => {
      const state = useImportReviewWorkflow({
        coordMode: '3D',
        currentInput: '',
        currentIncludeFiles: {},
        faceNormalizationMode: 'on',
        fileInputRef,
        parseSettings,
        projectInstruments: {},
        setInput,
        setProjectIncludeFiles,
        setImportNotice,
        resetWorkspaceForImportedInput,
      });

      return (
        <div>
          <div data-prompt>{state.pendingAnglePromptFile?.file.name ?? '-'}</div>
          <div data-angle>{state.pendingAnglePromptFile?.angleMode ?? '-'}</div>
          <div data-face>{state.pendingAnglePromptFile?.faceMode ?? '-'}</div>
          <div data-style>{state.pendingAnglePromptFile?.importStyle ?? '-'}</div>
          <button
            onClick={() =>
              state.handleFileChange({
                target: {
                  files: [new File(['<xml />'], 'sample.jobxml', { type: 'text/xml' })],
                  value: '',
                },
              } as never)
            }
          >
            choose
          </button>
          <button onClick={() => state.handleImportAnglePromptSetImportStyle('industry-style')}>
            industry
          </button>
          <button onClick={state.handleImportAnglePromptCancel}>cancel</button>
        </div>
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const click = async (label: string) => {
      const button = Array.from(container.querySelectorAll('button')).find(
        (entry) => entry.textContent === label,
      ) as HTMLButtonElement | undefined;
      if (!button) throw new Error(`Missing button ${label}`);
      await act(async () => {
        button.click();
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });
    };

    await click('choose');
    expect(container.querySelector('[data-prompt]')?.textContent).toBe('sample.jobxml');
    expect(container.querySelector('[data-angle]')?.textContent).toBe('reduced');
    expect(container.querySelector('[data-face]')?.textContent).toBe('on');
    expect(container.querySelector('[data-style]')?.textContent).toBe('generic');

    await click('industry');
    expect(container.querySelector('[data-style]')?.textContent).toBe('industry-style');

    await click('cancel');
    expect(container.querySelector('[data-prompt]')?.textContent).toBe('-');
    expect(setInput).not.toHaveBeenCalled();
    expect(resetWorkspaceForImportedInput).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('routes plain dat imports to project source-file append when a project handler exists', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const fileInputRef = { current: null as HTMLInputElement | null };
    const setInput = vi.fn();
    const importProjectSourceFiles = vi.fn(async () => true);

    const Harness = () => {
      const state = useImportReviewWorkflow({
        coordMode: '3D',
        currentInput: 'ORIGINAL',
        currentIncludeFiles: {},
        faceNormalizationMode: 'on',
        fileInputRef,
        importProjectSourceFiles,
        parseSettings,
        projectInstruments: {},
        setInput,
        setProjectIncludeFiles: () => undefined,
        setImportNotice: () => undefined,
        resetWorkspaceForImportedInput: () => undefined,
      });

      return (
        <button
          onClick={() =>
            void state.handleFileChange({
              target: {
                files: [
                  new File(['A'], 'traverse.dat', { type: 'text/plain' }),
                  new File(['B'], 'control.dat', { type: 'text/plain' }),
                ],
                value: '',
              },
            } as never)
          }
        >
          choose
        </button>
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const button = container.querySelector('button') as HTMLButtonElement;
    await act(async () => {
      button.click();
    });

    expect(importProjectSourceFiles).toHaveBeenCalledTimes(1);
    const importedFiles = (
      importProjectSourceFiles.mock.calls as unknown as Array<[File[]]>
    )[0]?.[0];
    expect(importedFiles?.map((file) => file.name)).toEqual([
      'traverse.dat',
      'control.dat',
    ]);
    expect(setInput).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
