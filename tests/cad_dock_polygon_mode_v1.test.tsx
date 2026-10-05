/** @vitest-environment jsdom */

// Shapes V1 dock pin: while a POLYGON session is in mode phase, `I` means
// Inscribed and must reach the session — never resolve to INSERT. Outside
// that phase the I→INSERT alias stays intact (no global remap).
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { CadCommandDock } from '../src/cad-app/shell/CadCommandDock';
import { createCadShellLink } from '../src/cad-app/shell/cadShellLink';
import type { CadShellActions, CadWorkspaceSnapshot } from '../src/cad-app/shell/cadShellTypes';

const snapshot = (over: Partial<CadWorkspaceSnapshot>): CadWorkspaceSnapshot =>
  ({
    availableCommands: ['POLYGON', 'INSERT', 'LINE'],
    activeCommandKey: null,
    commandPrompt: 'Idle — type a command.',
    commandInputValue: '',
    ...over,
  }) as CadWorkspaceSnapshot;

const actions = () =>
  ({
    startCommand: vi.fn(() => true),
    submitSessionText: vi.fn(),
    openBlockManager: vi.fn(),
  }) as unknown as CadShellActions;

const render = async (node: ReactNode): Promise<{ container: HTMLElement; root: Root }> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  return { container, root };
};

const setInputValue = (input: HTMLInputElement, value: string): void => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const pressEnter = async (input: HTMLInputElement): Promise<void> => {
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
};

describe('dock polygon mode phase owns I', () => {
  it('routes `I` to the POLYGON session, not INSERT', async () => {
    const link = createCadShellLink();
    const shellActions = actions();
    link.actions = shellActions;
    const { container, root } = await render(
      <CadCommandDock
        link={link}
        snapshot={snapshot({
          activeCommandKey: 'POLYGON',
          commandPrompt: 'POLYGON active. 6 sides. Inscribed or Circumscribed? [I/C] <I>.',
        })}
        heightPx={148}
        onResize={() => {}}
      />,
    );
    const input = container.querySelector('[data-cad-command-input]') as HTMLInputElement;
    await act(async () => {
      setInputValue(input, 'I');
    });
    await pressEnter(input);
    expect(shellActions.submitSessionText).toHaveBeenCalledWith('I');
    expect(shellActions.startCommand).not.toHaveBeenCalled();
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps the I→INSERT alias with no active polygon mode session', async () => {    const link = createCadShellLink();
    const shellActions = actions();
    link.actions = shellActions;
    const { container, root } = await render(
      <CadCommandDock link={link} snapshot={snapshot({})} heightPx={148} onResize={() => {}} />,
    );
    const input = container.querySelector('[data-cad-command-input]') as HTMLInputElement;
    await act(async () => {
      setInputValue(input, 'I');
    });
    await pressEnter(input);
    expect(shellActions.submitSessionText).not.toHaveBeenCalled();
    expect(shellActions.openBlockManager).toHaveBeenCalledWith('insert');
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('routes `I` to the session after an invalid mode entry (error prompt hides the [I/C] marker)', async () => {
    const link = createCadShellLink();
    const shellActions = actions();
    link.actions = shellActions;
    const { container, root } = await render(
      <CadCommandDock
        link={link}
        snapshot={snapshot({
          activeCommandKey: 'POLYGON',
          // resultText precedence: the invalid-retry prompt replaces the
          // phase prompt, so the [I/C] marker is gone — still mode phase.
          commandPrompt: 'POLYGON mode invalid. Enter `I` for Inscribed or `C` for Circumscribed (empty = Inscribed).',
        })}
        heightPx={148}
        onResize={() => {}}
      />,
    );
    const input = container.querySelector('[data-cad-command-input]') as HTMLInputElement;
    await act(async () => {
      setInputValue(input, 'I');
    });
    await pressEnter(input);
    expect(shellActions.submitSessionText).toHaveBeenCalledWith('I');
    expect(shellActions.startCommand).not.toHaveBeenCalled();
    expect(shellActions.openBlockManager).not.toHaveBeenCalled();
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
