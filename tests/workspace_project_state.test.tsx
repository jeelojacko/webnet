/** @vitest-environment jsdom */

import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { useWorkspaceProjectState } from '../src/hooks/useWorkspaceProjectState';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useWorkspaceProjectState', () => {
  it('restores workspace artifacts to their cleared defaults', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness = () => {
      const state = useWorkspaceProjectState<string, { id: string }, string, string, string, 'report'>({
        initialInput: 'INPUT',
        initialExportFormat: 'points',
        initialActiveTab: 'report',
        initialImportNotice: 'notice',
      });

      useEffect(() => {
        state.setImportReviewState({ id: 'review' });
        state.setPendingAnglePromptFile('prompt');
        state.setResult({ converged: true } as never);
        state.setRunDiagnostics('diag');
        state.setRunElapsedMs(12);
        state.setLastRunInput('LAST');
        state.setLastRunSettingsSnapshot('snapshot');
        state.setPendingEditorJumpLine(44);
        state.clearWorkspaceArtifacts();
      }, [state]);

      return (
        <div>
          <div data-input>{state.input}</div>
          <div data-export>{state.exportFormat}</div>
          <div data-notice>{state.importNotice ?? '-'}</div>
          <div data-review>{state.importReviewState ? 'set' : 'null'}</div>
          <div data-prompt>{state.pendingAnglePromptFile ?? '-'}</div>
          <div data-result>{state.result ? 'set' : 'null'}</div>
          <div data-diagnostics>{state.runDiagnostics ?? '-'}</div>
          <div data-elapsed>{state.runElapsedMs == null ? 'null' : String(state.runElapsedMs)}</div>
          <div data-last-input>{state.lastRunInput ?? '-'}</div>
          <div data-last-settings>{state.lastRunSettingsSnapshot ?? '-'}</div>
          <div data-jump>{state.pendingEditorJumpLine == null ? 'null' : String(state.pendingEditorJumpLine)}</div>
        </div>
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    expect(container.querySelector('[data-input]')?.textContent).toBe('INPUT');
    expect(container.querySelector('[data-export]')?.textContent).toBe('points');
    expect(container.querySelector('[data-notice]')?.textContent).toBe('notice');
    expect(container.querySelector('[data-review]')?.textContent).toBe('null');
    expect(container.querySelector('[data-prompt]')?.textContent).toBe('-');
    expect(container.querySelector('[data-result]')?.textContent).toBe('null');
    expect(container.querySelector('[data-diagnostics]')?.textContent).toBe('-');
    expect(container.querySelector('[data-elapsed]')?.textContent).toBe('null');
    expect(container.querySelector('[data-last-input]')?.textContent).toBe('-');
    expect(container.querySelector('[data-last-settings]')?.textContent).toBe('-');
    expect(container.querySelector('[data-jump]')?.textContent).toBe('null');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
