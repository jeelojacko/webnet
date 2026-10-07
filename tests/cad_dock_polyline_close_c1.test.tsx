/** @vitest-environment jsdom */

// C1 dock pin: while a PLINE session runs, `C` and `U` stay in the single
// workspace session buffer (never re-resolved as shell commands), and the
// idle autocomplete list stays hidden for the whole session.
import React, { useState } from 'react';
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { CadCommandDock } from '../src/cad-app/shell/CadCommandDock';
import { createCadShellLink } from '../src/cad-app/shell/cadShellLink';
import type { CadShellActions, CadWorkspaceSnapshot } from '../src/cad-app/shell/cadShellTypes';

const snapshot = (over: Partial<CadWorkspaceSnapshot>): CadWorkspaceSnapshot =>
  ({
    availableCommands: ['PLINE', 'COPY', 'UNDO', 'CIRCLE', 'LINE'],
    activeCommandKey: null,
    commandPrompt: 'Idle — type a command.',
    commandInputValue: '',
    ...over,
  }) as CadWorkspaceSnapshot;

const actions = (): CadShellActions =>
  ({
    startCommand: vi.fn(() => true),
    submitSessionText: vi.fn(),
    setSessionInputValue: vi.fn(),
  }) as unknown as CadShellActions;

const StatefulDock: React.FC<{
  over: Partial<CadWorkspaceSnapshot>;
  shellActions: CadShellActions;
}> = ({ over, shellActions }) => {
  const [value, setValue] = useState('');
  const link = React.useMemo(() => createCadShellLink(), []);
  const wiredActions = React.useMemo(
    () => ({ ...shellActions, setSessionInputValue: setValue }),
    [shellActions, setValue],
  );
  return (
    <CadCommandDock
      link={link}
      actionsOverride={wiredActions}
      snapshot={snapshot({ ...over, commandInputValue: value })}
      heightPx={148}
      onResize={() => {}}
    />
  );
};

const render = async (node: ReactNode): Promise<{ container: HTMLElement; root: Root }> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  return { container, root };
};

const setInputValue = (element: HTMLInputElement, value: string): void => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
};

const pressEnter = async (element: HTMLInputElement): Promise<void> => {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
};

describe('dock PLINE session owns C/U', () => {
  it('shows the typed C in the buffer, echoes no suggestions, and submits to the session', async () => {
    const shellActions = actions();
    const { container, root } = await render(
      <StatefulDock
        shellActions={shellActions}
        over={{
          activeCommandKey: 'PLINE',
          commandPrompt: 'PLINE active. 3 vertices captured. Press Enter to finish open, or type Close to close the ring. [Close/Undo]',
        }}
      />,
    );
    const element = container.querySelector('[data-cad-command-input]') as HTMLInputElement;
    await act(async () => {
      setInputValue(element, 'C');
    });
    expect(element.value).toBe('C');
    expect(container.querySelectorAll('[data-cad-command-suggestion]')).toHaveLength(0);
    await pressEnter(element);
    expect(shellActions.submitSessionText).toHaveBeenCalledWith('C');
    expect(shellActions.startCommand).not.toHaveBeenCalled();
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps U on the session path instead of resolving to global UNDO', async () => {
    const shellActions = actions();
    const { container, root } = await render(
      <StatefulDock
        shellActions={shellActions}
        over={{
          activeCommandKey: 'PLINE',
          commandPrompt: 'PLINE active. 2 vertices captured. [Undo]',
        }}
      />,
    );
    const element = container.querySelector('[data-cad-command-input]') as HTMLInputElement;
    await act(async () => {
      setInputValue(element, 'U');
    });
    expect(element.value).toBe('U');
    expect(container.querySelectorAll('[data-cad-command-suggestion]')).toHaveLength(0);
    await pressEnter(element);
    expect(shellActions.submitSessionText).toHaveBeenCalledWith('U');
    expect(shellActions.startCommand).not.toHaveBeenCalled();
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
