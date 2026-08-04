/** @vitest-environment jsdom */

import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  clickProjectFilesButton,
  findButtonByText,
  makeProjectFile,
  renderInputPane,
} from './inputPaneProjectFilesTestSupport';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('InputPane project files UI', () => {
  it('windows highlight and line-number rendering for large inputs', async () => {
    const input = Array.from({ length: 240 }, (_, index) => `C P${index + 1} ${index} ${index} 0`).join('\n');
    const { container, unmount } = await renderInputPane({ input });

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();
    Object.defineProperty(textarea!, 'clientHeight', {
      configurable: true,
      value: 240,
    });

    await act(async () => {
      textarea!.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    const lineNumbers = container.querySelector('[data-input-line-numbers]') as HTMLDivElement | null;
    const highlight = container.querySelector('[data-input-highlight-window]') as HTMLPreElement | null;
    expect(lineNumbers).not.toBeNull();
    expect(highlight).not.toBeNull();
    expect(lineNumbers?.textContent).toContain('1');
    expect(lineNumbers?.textContent).not.toContain('240');
    expect(highlight?.textContent).toContain('P1');
    expect(highlight?.textContent).not.toContain('P240');

    await act(async () => {
      textarea!.scrollTop = 3200;
      textarea!.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    expect(lineNumbers?.textContent).toContain('150');
    expect(highlight?.textContent).toContain('P150');
    expect(highlight?.textContent).not.toContain('P40');

    await unmount();
  });

  it('keeps the project files button available before a named project exists', async () => {
    const onOpenProjectFiles = vi.fn();
    const { container, unmount } = await renderInputPane({
      projectFiles: [],
      onOpenProjectFiles,
    });

    const button = findButtonByText(container, 'Project Files');
    expect(button).toBeDefined();

    await act(async () => {
      button?.click();
    });

    expect(onOpenProjectFiles).toHaveBeenCalledTimes(1);

    await unmount();
  });

  it('opens the project files popover and toggles run participation', async () => {
    const onSetProjectFileEnabled = vi.fn();
    const { container, unmount } = await renderInputPane({
      projectFiles: [
        makeProjectFile({
          id: 'file-1',
          name: 'alpha.dat',
          tabOrder: 0,
          isOpenInTab: true,
          isFocusedTab: true,
          isActive: true,
          isMain: true,
        }),
      ],
      projectRunValidation: { ok: true, errors: [], warnings: [] },
      onSetProjectFileEnabled,
    });

    await clickProjectFilesButton(container);

    expect(container.textContent).toContain('alpha.dat');
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    expect(checkbox?.checked).toBe(true);

    await act(async () => {
      checkbox?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onSetProjectFileEnabled).toHaveBeenCalledWith('file-1', false);

    await unmount();
  });

  it('shows explicit file-state markers and keeps checkbox clicks scoped to enable state', async () => {
    const onSetProjectFileEnabled = vi.fn();
    const onFocusProjectFile = vi.fn();
    const onOpenFileTab = vi.fn();
    const { container, unmount } = await renderInputPane({
      projectFiles: [
        makeProjectFile({
          id: 'file-1',
          name: 'main.dat',
          tabOrder: 0,
          isOpenInTab: true,
          isFocusedTab: true,
          isActive: true,
          isMain: true,
        }),
        makeProjectFile({
          id: 'file-2',
          name: 'notes.txt',
          kind: 'notes',
          order: 1,
          isCheckedForRun: false,
          enabled: false,
        }),
      ],
      onSetProjectFileEnabled,
      onFocusProjectFile,
      onOpenFileTab,
    });

    await clickProjectFilesButton(container);

    expect(container.textContent).toContain('main');
    expect(container.textContent).toContain('open');
    expect(container.textContent).toContain('active');
    expect(container.textContent).toContain('unchecked');

    const checkbox = container.querySelector(
      'input[aria-label="Include notes.txt in run"]',
    ) as HTMLInputElement | null;
    expect(checkbox?.checked).toBe(false);

    await act(async () => {
      checkbox?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onSetProjectFileEnabled).toHaveBeenCalledWith('file-2', true);
    expect(onFocusProjectFile).not.toHaveBeenCalled();
    expect(onOpenFileTab).not.toHaveBeenCalled();

    await unmount();
  });

  it('renders open file tabs and closes a tab without deleting the file', async () => {
    const onCloseFileTab = vi.fn();
    const { container, unmount } = await renderInputPane({
      projectFiles: [
        makeProjectFile({
          id: 'file-1',
          name: 'alpha.dat',
          tabOrder: 0,
          isOpenInTab: true,
          isFocusedTab: true,
          isActive: true,
          isMain: true,
        }),
      ],
      onCloseFileTab,
    });

    expect(container.textContent).toContain('alpha.dat');
    const closeButton = container.querySelector('[aria-label="Close alpha.dat"]') as HTMLButtonElement | null;
    expect(closeButton).not.toBeNull();

    await act(async () => {
      closeButton?.click();
    });

    expect(onCloseFileTab).toHaveBeenCalledWith('file-1');

    await unmount();
  });

  it('exposes quick project-file actions from the popover without using the context menu', async () => {
    const onOpenProjectFiles = vi.fn();
    const onAddProjectSourceFile = vi.fn();
    const onOpenFileTab = vi.fn();
    const onFocusProjectFile = vi.fn();
    const onDuplicateProjectFile = vi.fn();
    const onDeleteProjectFile = vi.fn();
    const { container, unmount } = await renderInputPane({
      projectFiles: [
        makeProjectFile({
          id: 'file-1',
          name: 'main.dat',
          tabOrder: 0,
          isOpenInTab: true,
          isFocusedTab: true,
          isActive: true,
          isMain: true,
        }),
        makeProjectFile({
          id: 'file-2',
          name: 'notes.txt',
          kind: 'notes',
          order: 1,
          isCheckedForRun: false,
          enabled: false,
        }),
      ],
      onOpenProjectFiles,
      onAddProjectSourceFile,
      onOpenFileTab,
      onFocusProjectFile,
      onDuplicateProjectFile,
      onDeleteProjectFile,
    });

    await clickProjectFilesButton(container);

    expect(container.textContent).toContain('1 checked / 1 open');

    const addSourceButton = container.querySelector(
      'button[aria-label="Open notes.txt"]',
    ) as HTMLButtonElement | null;
    expect(addSourceButton).not.toBeNull();

    await act(async () => {
      (
        findButtonByText(container, 'Add Source')
      )?.click();
    });
    expect(onAddProjectSourceFile).toHaveBeenCalledTimes(1);

    await act(async () => {
      addSourceButton?.click();
    });
    expect(onOpenFileTab).toHaveBeenCalledWith('file-2');

    await act(async () => {
      (container.querySelector('button[aria-label="Edit notes.txt"]') as HTMLButtonElement | null)?.click();
    });
    expect(onFocusProjectFile).toHaveBeenCalledWith('file-2');

    await act(async () => {
      (
        container.querySelector('button[aria-label="Duplicate notes.txt"]') as HTMLButtonElement | null
      )?.click();
    });
    expect(onDuplicateProjectFile).toHaveBeenCalledWith('file-2');

    await act(async () => {
      (
        container.querySelector('button[aria-label="Remove notes.txt"]') as HTMLButtonElement | null
      )?.click();
    });
    expect(onDeleteProjectFile).toHaveBeenCalledWith('file-2');

    await act(async () => {
      (
        findButtonByText(container, 'Project Options')
      )?.click();
    });
    expect(onOpenProjectFiles).toHaveBeenCalledTimes(1);

    await unmount();
  });

  it('keeps open tab order stable when project file list order changes', async () => {
    const { container, unmount } = await renderInputPane({
      projectFiles: [
        makeProjectFile({
          id: 'file-2',
          name: 'beta.dat',
          order: 0,
          tabOrder: 1,
          isOpenInTab: true,
        }),
        makeProjectFile({
          id: 'file-1',
          name: 'alpha.dat',
          order: 1,
          tabOrder: 0,
          isOpenInTab: true,
          isFocusedTab: true,
          isActive: true,
          isMain: true,
        }),
      ],
    });

    const closeButtons = Array.from(
      container.querySelectorAll('button[aria-label^="Close "]'),
    ) as HTMLButtonElement[];
    expect(closeButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Close alpha.dat',
      'Close beta.dat',
    ]);

    await unmount();
  });
});
