/** @vitest-environment jsdom */

/**
 * Phase B2 — global command dock contract.
 *
 * Pins the single-buffer rule (session value is the authority while a session
 * is active; one dock-owned idle entry buffer otherwise), AutoCAD-style
 * idle first-key capture, registry autocomplete (highlight/Enter/Tab/
 * double-click/ARIA), the bounded UI history log, and the compact
 * collapsed/expanded layout.
 */
import React, { useState } from 'react';
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CadCommandDock } from '../src/cad-app/shell/CadCommandDock';
import { createCadShellLink } from '../src/cad-app/shell/cadShellLink';
import {
  DEFAULT_SHELL_LAYOUT,
  useCadShellLayout,
  type CadShellLayoutController,
} from '../src/cad-app/shell/useCadShellLayout';
import { CAD_SHELL_LAYOUT_STORAGE_KEY } from '../src/cad-app/shell/cadShellTypes';
import type { CadShellActions, CadWorkspaceSnapshot } from '../src/cad-app/shell/cadShellTypes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const snapshot = (over: Partial<CadWorkspaceSnapshot> = {}): CadWorkspaceSnapshot =>
  ({
    availableCommands: ['LINE', 'PLINE', 'POINT', 'CIRCLE', 'MOVE', 'COPY', 'INVERSE'],
    activeCommandKey: null,
    commandPrompt: 'Idle — type a command.',
    commandInputValue: '',
    ...over,
  }) as CadWorkspaceSnapshot;

const actions = (): CadShellActions =>
  ({
    startCommand: vi.fn(() => true),
    submitSessionText: vi.fn(),
    confirmCommandInput: vi.fn(),
    cancelCommand: vi.fn(),
    openBlockManager: vi.fn(),
  }) as unknown as CadShellActions;

/** Owns the session buffer the way the live workspace does (round-trip). */
const DockHarness: React.FC<{
  over?: Partial<CadWorkspaceSnapshot>;
  shellActions: CadShellActions;
  expanded?: boolean;
  onToggle?: (_expanded: boolean) => void;
}> = ({ over, shellActions, expanded, onToggle }) => {
  const [sessionValue, setSessionValue] = useState((over?.commandInputValue as string) ?? '');
  const link = React.useMemo(() => createCadShellLink(), []);
  const wiredActions = React.useMemo(
    () => ({ ...shellActions, setSessionInputValue: setSessionValue }),
    [shellActions, setSessionValue],
  );
  return (
    <CadCommandDock
      link={link}
      actionsOverride={wiredActions}
      snapshot={snapshot({ ...over, commandInputValue: sessionValue })}
      heightPx={200}
      onResize={() => {}}
      historyExpanded={expanded}
      onToggleHistory={onToggle}
    />
  );
};

const promptRow = (container: HTMLElement): HTMLElement =>
  container.querySelector('[data-cad-command-prompt]') as HTMLElement;

const dockSection = (container: HTMLElement): HTMLElement =>
  container.querySelector('[data-cad-command-dock]') as HTMLElement;

/** Controlled dock wired to the persisted shell layout (stale-height probe). */
const LayoutDockHarness: React.FC<{
  shellActions: CadShellActions;
  expose: (_controller: CadShellLayoutController) => void;
}> = ({ shellActions, expose }) => {
  const controller = useCadShellLayout();
  expose(controller);
  const link = React.useMemo(() => createCadShellLink(), []);
  const wiredActions = React.useMemo(
    () => ({ ...shellActions, setSessionInputValue: () => {} }),
    [shellActions],
  );
  return (
    <CadCommandDock
      link={link}
      actionsOverride={wiredActions}
      snapshot={snapshot()}
      heightPx={controller.layout.commandHeightPx}
      onResize={controller.setCommandHeight}
      historyExpanded={controller.layout.commandHistoryExpanded}
      onToggleHistory={controller.setCommandHistoryExpanded}
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

const cleanup = async (container: HTMLElement, root: Root): Promise<void> => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
};

const input = (container: HTMLElement): HTMLInputElement =>
  container.querySelector('[data-cad-command-input]') as HTMLInputElement;

const setInputValue = (element: HTMLInputElement, value: string): void => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
};

const keyDown = async (
  target: EventTarget,
  key: string,
  init: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {},
): Promise<void> => {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
};

const viewportKey = (
  key: string,
  init: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {},
): Promise<void> => keyDown(document.body, key, init);

const suggestionButtons = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll('[data-cad-command-suggestion]'));

beforeEach(() => {
  window.localStorage.clear();
});

describe('phase B2 single input buffer', () => {
  it('renders the live session buffer verbatim when a session is active', async () => {
    const shellActions = actions();
    const { container, root } = await render(
      <DockHarness shellActions={shellActions} over={{ activeCommandKey: 'LINE', commandInputValue: '12,34' }} />,
    );
    expect(input(container).value).toBe('12,34');
    await cleanup(container, root);
  });

  it('dock edits write the session buffer while a session is active', async () => {
    const shellActions = actions();
    const { container, root } = await render(
      <DockHarness shellActions={shellActions} over={{ activeCommandKey: 'LINE' }} />,
    );
    await act(async () => {
      setInputValue(input(container), '5');
    });
    expect(input(container).value).toBe('5');
    expect(shellActions.startCommand).not.toHaveBeenCalled();
    await cleanup(container, root);
  });

  it('keeps idle edits in the shell entry buffer', async () => {
    const shellActions = actions();
    const { container, root } = await render(<DockHarness shellActions={shellActions} />);
    await act(async () => {
      setInputValue(input(container), 'ci');
    });
    expect(input(container).value).toBe('ci');
    expect(shellActions.submitSessionText).not.toHaveBeenCalled();
    await cleanup(container, root);
  });

  it('session Enter submits the visible value instead of resolving a command', async () => {
    const shellActions = actions();
    const { container, root } = await render(
      <DockHarness shellActions={shellActions} over={{ activeCommandKey: 'LINE' }} />,
    );
    await act(async () => {
      setInputValue(input(container), 'L');
    });
    await keyDown(input(container), 'Enter');
    // `L` normally resolves to LINE, but the live session wins.
    expect(shellActions.submitSessionText).toHaveBeenCalledWith('L');
    expect(shellActions.startCommand).not.toHaveBeenCalled();
    await cleanup(container, root);
  });

  it('drops an abandoned idle draft when a session takes over', async () => {
    const shellActions = actions();
    const { container, root } = await render(<DockHarness shellActions={shellActions} />);
    await act(async () => {
      setInputValue(input(container), 'LI');
    });
    await act(async () => {
      root.render(<DockHarness shellActions={shellActions} over={{ activeCommandKey: 'LINE' }} />);
    });
    await act(async () => {
      root.render(<DockHarness shellActions={shellActions} />);
    });
    expect(input(container).value).toBe('');
    await cleanup(container, root);
  });
});

describe('phase B2 idle first-key capture', () => {
  it('captures viewport typing into the one dock buffer and focuses the input', async () => {
    const shellActions = actions();
    const { container, root } = await render(<DockHarness shellActions={shellActions} />);
    await viewportKey('c');
    await viewportKey('i');
    await viewportKey('r');
    expect(input(container).value).toBe('cir');
    expect(document.activeElement).toBe(input(container));
    await cleanup(container, root);
  });

  it('never steals interactive targets or modifier/delete keys', async () => {
    const shellActions = actions();
    const { container, root } = await render(<DockHarness shellActions={shellActions} />);
    const foreign = document.createElement('textarea');
    document.body.appendChild(foreign);
    await keyDown(foreign, 'a');
    expect(input(container).value).toBe('');
    await viewportKey('a', { ctrlKey: true });
    await viewportKey('a', { metaKey: true });
    await viewportKey('a', { altKey: true });
    await viewportKey('Delete');
    expect(input(container).value).toBe('');
    foreign.remove();
    await cleanup(container, root);
  });

  it('never captures Space so grip-edit/snap cycling keeps working', async () => {
    const shellActions = actions();
    const { container, root } = await render(<DockHarness shellActions={shellActions} />);
    await viewportKey(' ');
    expect(input(container).value).toBe('');
    await cleanup(container, root);
  });

  it('edits with Backspace and clears with Escape', async () => {
    const shellActions = actions();
    const { container, root } = await render(<DockHarness shellActions={shellActions} />);
    await viewportKey('l');
    await viewportKey('i');
    await viewportKey('Backspace');
    expect(input(container).value).toBe('l');
    await viewportKey('Escape');
    expect(input(container).value).toBe('');
    // Empty idle Escape falls through to the workspace cancel handler.
    expect(shellActions.cancelCommand).not.toHaveBeenCalled();
    await cleanup(container, root);
  });

  it('submits idle viewport Enter', async () => {
    const shellActions = actions();
    const { container, root } = await render(<DockHarness shellActions={shellActions} />);
    await viewportKey('L');
    await viewportKey('Enter');
    expect(shellActions.startCommand).toHaveBeenCalledWith('LINE');
    expect(input(container).value).toBe('');
    await cleanup(container, root);
  });
});

describe('phase B2 autocomplete', () => {
  it('shows bounded suggestions with key, label, and aliases', async () => {
    const shellActions = actions();
    const { container, root } = await render(<DockHarness shellActions={shellActions} />);
    await act(async () => {
      setInputValue(input(container), 'PL');
    });
    const list = container.querySelector('[role="listbox"]');
    expect(list).not.toBeNull();
    expect(list?.textContent).toContain('PLINE');
    expect(list?.textContent).toContain('Polyline');
    expect(list?.textContent).toContain('(PL)');
    expect(suggestionButtons(container).length).toBeLessThanOrEqual(8);
    await cleanup(container, root);
  });

  it('highlights with ArrowDown/ArrowUp and wraps', async () => {
    const shellActions = actions();
    const { container, root } = await render(<DockHarness shellActions={shellActions} />);
    await act(async () => {
      setInputValue(input(container), 'L');
    });
    const options = Array.from(container.querySelectorAll('[role="option"]'));
    expect(options.length).toBeGreaterThan(1);
    await keyDown(input(container), 'ArrowDown');
    expect(input(container).getAttribute('aria-activedescendant')).toBe(options[0]?.id);
    await keyDown(input(container), 'ArrowDown');
    expect(input(container).getAttribute('aria-activedescendant')).toBe(options[1]?.id);
    await keyDown(input(container), 'ArrowUp');
    expect(input(container).getAttribute('aria-activedescendant')).toBe(options[0]?.id);
    // Wrap up from the first to the last.
    await keyDown(input(container), 'ArrowUp');
    expect(input(container).getAttribute('aria-activedescendant')).toBe(options[options.length - 1]?.id);
    await cleanup(container, root);
  });

  it('executes the highlighted suggestion on Enter', async () => {
    const shellActions = actions();
    const { container, root } = await render(<DockHarness shellActions={shellActions} />);
    await act(async () => {
      setInputValue(input(container), 'LI');
    });
    await keyDown(input(container), 'ArrowDown');
    await keyDown(input(container), 'Enter');
    expect(shellActions.startCommand).toHaveBeenCalledWith('LINE');
    await cleanup(container, root);
  });

  it('falls back to the exact alias resolve when nothing is highlighted', async () => {
    const shellActions = actions();
    const { container, root } = await render(
      <DockHarness shellActions={shellActions} over={{ availableCommands: ['LINE'] }} />,
    );
    // No session command matches `I`; the idle alias must still resolve.
    await act(async () => {
      setInputValue(input(container), 'I');
    });
    await keyDown(input(container), 'Enter');
    expect(shellActions.openBlockManager).toHaveBeenCalledWith('insert');
    await cleanup(container, root);
  });

  it('Tab completes without executing', async () => {
    const shellActions = actions();
    const { container, root } = await render(<DockHarness shellActions={shellActions} />);
    await act(async () => {
      setInputValue(input(container), 'PL');
    });
    await keyDown(input(container), 'Tab');
    expect(input(container).value).toBe('PLINE');
    expect(shellActions.startCommand).not.toHaveBeenCalled();
    await cleanup(container, root);
  });

  it('double-click executes and hover highlights without executing', async () => {
    const shellActions = actions();
    const { container, root } = await render(<DockHarness shellActions={shellActions} />);
    await act(async () => {
      setInputValue(input(container), 'PL');
    });
    const button = suggestionButtons(container)[0] as HTMLElement;
    await act(async () => {
      button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: null }));
    });
    expect(input(container).getAttribute('aria-activedescendant')).toBe('cad-shell-command-suggest-PLINE');
    expect(shellActions.startCommand).not.toHaveBeenCalled();
    await act(async () => {
      button.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(shellActions.startCommand).toHaveBeenCalledWith('PLINE');
    await cleanup(container, root);
  });

  it('exposes combobox/listbox ARIA state only while suggestions are open', async () => {
    const shellActions = actions();
    const { container, root } = await render(<DockHarness shellActions={shellActions} />);
    expect(input(container).getAttribute('role')).toBe('combobox');
    expect(input(container).getAttribute('aria-expanded')).toBe('false');
    await act(async () => {
      setInputValue(input(container), 'PL');
    });
    expect(input(container).getAttribute('aria-expanded')).toBe('true');
    expect(input(container).getAttribute('aria-controls')).toBe('cad-shell-command-suggest');
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();
    expect(container.querySelectorAll('[role="option"]').length).toBeGreaterThan(0);
    await cleanup(container, root);
  });

  it('never offers an unavailable command', async () => {
    const shellActions = actions();
    const { container, root } = await render(
      <DockHarness shellActions={shellActions} over={{ availableCommands: ['POINT'] }} />,
    );
    await act(async () => {
      setInputValue(input(container), 'L');
    });
    // LINE exists in the registry but is not in availableCommands.
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(suggestionButtons(container)).toHaveLength(0);
    await cleanup(container, root);
  });

  it('shows no suggestions during an active session', async () => {
    const shellActions = actions();
    const { container, root } = await render(
      <DockHarness shellActions={shellActions} over={{ activeCommandKey: 'LINE' }} />,
    );
    await act(async () => {
      setInputValue(input(container), 'PL');
    });
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    await cleanup(container, root);
  });
});

describe('phase B2 history fallback and log', () => {
  it('recalls history on ArrowUp when suggestions are hidden', async () => {
    const shellActions = actions();
    const { container, root } = await render(<DockHarness shellActions={shellActions} />);
    await act(async () => {
      setInputValue(input(container), 'ZZZ');
    });
    await keyDown(input(container), 'Enter');
    expect(input(container).value).toBe('');
    await keyDown(input(container), 'ArrowUp');
    expect(input(container).value).toBe('ZZZ');
    await keyDown(input(container), 'ArrowDown');
    expect(input(container).value).toBe('');
    await cleanup(container, root);
  });

  it('records commands started outside the dock from the activeCommandKey seam', async () => {
    const shellActions = actions();
    const { container, root } = await render(<DockHarness shellActions={shellActions} />);
    await act(async () => {
      root.render(<DockHarness shellActions={shellActions} over={{ activeCommandKey: 'MOVE' }} />);
    });
    await act(async () => {
      (container.querySelector('[data-cad-command-history-toggle]') as HTMLElement).click();
    });
    const log = container.querySelector('[data-cad-command-history]');
    expect(log?.textContent).toContain('MOVE');
    await cleanup(container, root);
  });

  it('dedupes a typed start against the same external transition', async () => {
    const shellActions = actions();
    const { container, root } = await render(<DockHarness shellActions={shellActions} />);
    await act(async () => {
      setInputValue(input(container), 'L');
    });
    await keyDown(input(container), 'Enter');
    expect(shellActions.startCommand).toHaveBeenCalledWith('LINE');
    await act(async () => {
      root.render(<DockHarness shellActions={shellActions} over={{ activeCommandKey: 'LINE' }} />);
    });
    await act(async () => {
      (container.querySelector('[data-cad-command-history-toggle]') as HTMLElement).click();
    });
    const entries = Array.from(
      container.querySelectorAll('[data-cad-command-history] span'),
    ).map((node) => node.textContent);
    expect(entries).toEqual(['L']);
    await cleanup(container, root);
  });
});

describe('phase B2 compact layout', () => {
  it('collapsed by default renders no history panel, resize handle, or fixed height', async () => {
    const shellActions = actions();
    const { container, root } = await render(<DockHarness shellActions={shellActions} />);
    expect(container.querySelector('[data-cad-command-expanded]')?.getAttribute('data-cad-command-expanded')).toBe('false');
    expect(container.querySelector('[data-cad-command-history]')).toBeNull();
    expect(container.querySelector('.cad-shell-command-resize')).toBeNull();
    const section = container.querySelector('[data-cad-command-dock]') as HTMLElement;
    expect(section.style.height).toBe('');
    await cleanup(container, root);
  });

  it('chevron toggles the panel, never submits, and labels both states', async () => {
    const shellActions = actions();
    const { container, root } = await render(<DockHarness shellActions={shellActions} />);
    const toggle = container.querySelector('[data-cad-command-history-toggle]') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-label')).toBe('Show command history');
    // Collapsed points down (expand below); expanded points up (collapse).
    expect(toggle.textContent).toBe('⌄');
    await act(async () => {
      toggle.click();
    });
    expect(toggle.getAttribute('aria-label')).toBe('Hide command history');
    expect(toggle.textContent).toBe('⌃');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(shellActions.startCommand).not.toHaveBeenCalled();
    expect((container.querySelector('[data-cad-command-dock]') as HTMLElement).style.height).toBe('200px');
    expect(container.querySelector('.cad-shell-command-resize')).not.toBeNull();
    await act(async () => {
      toggle.click();
    });
    expect(container.querySelector('[data-cad-command-history]')).toBeNull();
    await cleanup(container, root);
  });

  it('expanded history is scrollable and auto-scrolls to the newest entry', async () => {
    const shellActions = actions();
    const { container, root } = await render(<DockHarness shellActions={shellActions} />);
    await act(async () => {
      setInputValue(input(container), 'ZZZ');
    });
    await keyDown(input(container), 'Enter');
    await act(async () => {
      (container.querySelector('[data-cad-command-history-toggle]') as HTMLElement).click();
    });
    const log = container.querySelector('[data-cad-command-history]') as HTMLElement;
    expect(log.style.overflowY).toBe('auto');
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 480 });
    await act(async () => {
      setInputValue(input(container), 'YYY');
    });
    await keyDown(input(container), 'Enter');
    expect(log.scrollTop).toBe(480);
    await cleanup(container, root);
  });

  it('controlled expansion reports toggles through the callback', async () => {
    const shellActions = actions();
    const onToggle = vi.fn();
    const { container, root } = await render(
      <DockHarness shellActions={shellActions} expanded={false} onToggle={onToggle} />,
    );
    await act(async () => {
      (container.querySelector('[data-cad-command-history-toggle]') as HTMLElement).click();
    });
    expect(onToggle).toHaveBeenCalledWith(true);
    await cleanup(container, root);
  });
});

describe('phase B2 collapsed status row (no third echo row)', () => {
  it('fresh collapsed dock renders exactly two rows: status + input', async () => {
    const shellActions = actions();
    const { container, root } = await render(<DockHarness shellActions={shellActions} />);
    const section = dockSection(container);
    expect(section.children).toHaveLength(2);
    expect(promptRow(container).textContent).toContain('Idle');
    expect(container.querySelector('.cad-shell-command-echo')).toBeNull();
    expect(section.style.height).toBe('');
    await cleanup(container, root);
  });

  it('shows a completed command echo inside the status row, not a third row', async () => {
    const shellActions = actions();
    const { container, root } = await render(<DockHarness shellActions={shellActions} />);
    await act(async () => {
      setInputValue(input(container), 'L');
    });
    await keyDown(input(container), 'Enter');
    expect(shellActions.startCommand).toHaveBeenCalledWith('LINE');
    const section = dockSection(container);
    expect(section.children).toHaveLength(2);
    const status = promptRow(container);
    expect(status.textContent).toContain('Started Line.');
    expect(status.getAttribute('data-cad-command-status')).toBe('echo');
    const echoes = Array.from(container.querySelectorAll('.cad-shell-command-echo'));
    expect(echoes).toHaveLength(1);
    expect(echoes[0]).toBe(status);
    await cleanup(container, root);
  });

  it('shows an unknown-command error in the status row while idle', async () => {
    const shellActions = actions();
    const { container, root } = await render(<DockHarness shellActions={shellActions} />);
    await act(async () => {
      setInputValue(input(container), 'ZZZ');
    });
    await keyDown(input(container), 'Enter');
    expect(dockSection(container).children).toHaveLength(2);
    expect(promptRow(container).textContent).toContain('Unknown command');
    await cleanup(container, root);
  });

  it('expanded history logs the executed command entry', async () => {
    const shellActions = actions();
    const { container, root } = await render(<DockHarness shellActions={shellActions} />);
    await act(async () => {
      setInputValue(input(container), 'L');
    });
    await keyDown(input(container), 'Enter');
    await act(async () => {
      (container.querySelector('[data-cad-command-history-toggle]') as HTMLElement).click();
    });
    const rows = Array.from(
      container.querySelectorAll('[data-cad-command-history] span'),
    ).map((node) => node.textContent);
    expect(rows).toEqual(['L']);
    await cleanup(container, root);
  });

  it('collapsing after use returns to the two-row compact baseline', async () => {
    const shellActions = actions();
    const { container, root } = await render(<DockHarness shellActions={shellActions} />);
    await act(async () => {
      setInputValue(input(container), 'L');
    });
    await keyDown(input(container), 'Enter');
    const toggle = container.querySelector('[data-cad-command-history-toggle]') as HTMLElement;
    await act(async () => {
      toggle.click();
    });
    expect(dockSection(container).style.height).toBe('200px');
    await act(async () => {
      toggle.click();
    });
    const section = dockSection(container);
    expect(section.style.height).toBe('');
    expect(section.children).toHaveLength(2);
    // Feedback survives the collapse without adding a row.
    expect(promptRow(container).textContent).toContain('Started Line.');
    await cleanup(container, root);
  });

  it('ignores a stale persisted commandHeightPx while collapsed (no blank reservoir)', async () => {
    window.localStorage.setItem(
      CAD_SHELL_LAYOUT_STORAGE_KEY,
      JSON.stringify({ version: 1, commandHeightPx: 320, commandHistoryExpanded: false }),
    );
    let controller: CadShellLayoutController | null = null;
    const { container, root } = await render(
      <LayoutDockHarness
        shellActions={actions()}
        expose={(value) => {
          controller = value;
        }}
      />,
    );
    expect(controller!.layout.commandHeightPx).toBe(320);
    expect(controller!.layout.commandHistoryExpanded).toBe(false);
    const section = dockSection(container);
    expect(section.style.height).toBe('');
    expect(section.children).toHaveLength(2);
    await act(async () => {
      setInputValue(input(container), 'L');
    });
    await keyDown(input(container), 'Enter');
    expect(section.children).toHaveLength(2);
    expect(section.style.height).toBe('');
    await cleanup(container, root);
  });
});

describe('phase B2 layout persistence', () => {
  const LayoutProbe: React.FC<{ expose: (_controller: CadShellLayoutController) => void }> = ({ expose }) => {
    const controller = useCadShellLayout();
    expose(controller);
    return null;
  };

  it('reset workspace returns the dock to collapsed defaults', async () => {
    let controller: CadShellLayoutController | null = null;
    const { container, root } = await render(<LayoutProbe expose={(value) => { controller = value; }} />);
    expect(controller!.layout.commandHistoryExpanded).toBe(DEFAULT_SHELL_LAYOUT.commandHistoryExpanded);
    await act(async () => {
      controller!.setCommandHistoryExpanded(true);
    });
    expect(controller!.layout.commandHistoryExpanded).toBe(true);
    await act(async () => {
      controller!.resetWorkspace();
    });
    expect(controller!.layout.commandHistoryExpanded).toBe(false);
    expect(controller!.layout.commandHeightPx).toBe(DEFAULT_SHELL_LAYOUT.commandHeightPx);
    await cleanup(container, root);
  });
});
