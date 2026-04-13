/** @vitest-environment jsdom */

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import InputPane from '../src/components/InputPane';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('InputPane project files UI', () => {
  it('keeps the project files button available before a named project exists', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const onOpenProjectFiles = vi.fn();

    await act(async () => {
      root.render(
        <InputPane
          input="C A 0 0 0 ! !"
          onChange={() => undefined}
          projectFiles={[]}
          onOpenProjectFiles={onOpenProjectFiles}
        />,
      );
    });

    const button = Array.from(container.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('Project Files'),
    ) as HTMLButtonElement | undefined;
    expect(button).toBeDefined();

    await act(async () => {
      button?.click();
    });

    expect(onOpenProjectFiles).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('opens the project files popover and toggles run participation', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const onSetProjectFileEnabled = vi.fn();

    await act(async () => {
      root.render(
        <InputPane
          input="C A 0 0 0 ! !"
          onChange={() => undefined}
          projectFiles={[
            {
              id: 'file-1',
              name: 'alpha.dat',
              kind: 'dat',
              order: 0,
              tabOrder: 0,
              isCheckedForRun: true,
              isOpenInTab: true,
              isFocusedTab: true,
              enabled: true,
              isActive: true,
              isMain: true,
            },
          ]}
          projectRunValidation={{ ok: true, errors: [], warnings: [] }}
          onSetProjectFileEnabled={onSetProjectFileEnabled}
        />,
      );
    });

    const button = Array.from(container.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('Project Files'),
    ) as HTMLButtonElement | undefined;
    expect(button).toBeDefined();

    await act(async () => {
      button?.click();
    });

    expect(container.textContent).toContain('alpha.dat');
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    expect(checkbox?.checked).toBe(true);

    await act(async () => {
      checkbox?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onSetProjectFileEnabled).toHaveBeenCalledWith('file-1', false);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('renders open file tabs and closes a tab without deleting the file', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const onCloseFileTab = vi.fn();

    await act(async () => {
      root.render(
        <InputPane
          input="C A 0 0 0 ! !"
          onChange={() => undefined}
          projectFiles={[
            {
              id: 'file-1',
              name: 'alpha.dat',
              kind: 'dat',
              order: 0,
              tabOrder: 0,
              isCheckedForRun: true,
              isOpenInTab: true,
              isFocusedTab: true,
              enabled: true,
              isActive: true,
              isMain: true,
            },
          ]}
          onCloseFileTab={onCloseFileTab}
        />,
      );
    });

    expect(container.textContent).toContain('alpha.dat');
    const closeButton = container.querySelector('[aria-label="Close alpha.dat"]') as HTMLButtonElement | null;
    expect(closeButton).not.toBeNull();

    await act(async () => {
      closeButton?.click();
    });

    expect(onCloseFileTab).toHaveBeenCalledWith('file-1');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps open tab order stable when project file list order changes', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(
        <InputPane
          input="C A 0 0 0 ! !"
          onChange={() => undefined}
          projectFiles={[
            {
              id: 'file-2',
              name: 'beta.dat',
              kind: 'dat',
              order: 0,
              tabOrder: 1,
              isCheckedForRun: true,
              isOpenInTab: true,
              isFocusedTab: false,
              enabled: true,
              isActive: false,
              isMain: false,
            },
            {
              id: 'file-1',
              name: 'alpha.dat',
              kind: 'dat',
              order: 1,
              tabOrder: 0,
              isCheckedForRun: true,
              isOpenInTab: true,
              isFocusedTab: true,
              enabled: true,
              isActive: true,
              isMain: true,
            },
          ]}
        />,
      );
    });

    const closeButtons = Array.from(
      container.querySelectorAll('button[aria-label^="Close "]'),
    ) as HTMLButtonElement[];
    expect(closeButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Close alpha.dat',
      'Close beta.dat',
    ]);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
