/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { useImportReviewWorkflow } from '../src/hooks/useImportReviewWorkflow';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useImportReviewWorkflow', () => {
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
        faceNormalizationMode: 'on',
        fileInputRef,
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
      });
    };

    await click('choose');
    expect(container.querySelector('[data-prompt]')?.textContent).toBe('sample.jobxml');
    expect(container.querySelector('[data-angle]')?.textContent).toBe('reduced');
    expect(container.querySelector('[data-face]')?.textContent).toBe('on');

    await click('cancel');
    expect(container.querySelector('[data-prompt]')?.textContent).toBe('-');
    expect(setInput).not.toHaveBeenCalled();
    expect(resetWorkspaceForImportedInput).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
