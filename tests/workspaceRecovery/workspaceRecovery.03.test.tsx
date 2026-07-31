/** @vitest-environment jsdom */

import React, { useMemo, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useWorkspaceRecovery } from '../../src/hooks/useWorkspaceRecovery';
import type { RunSettingsSnapshot } from '../../src/appStateTypes';
import {
  act,
  buildSnapshot,
  createRoot,
  STORAGE_KEY,
  type Root,
} from './workspaceRecoveryTestSupport';

describe('useWorkspaceRecovery disabled and persistence errors', () => {
  it('disables browser draft recovery while a named local project is open', async () => {
    window.localStorage.clear();
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        savedAt: '2026-04-10T12:00:00.000Z',
        snapshot: buildSnapshot({ input: 'STORED DRAFT' }),
      }),
    );

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness = () => {
      const [disabled, setDisabled] = useState(true);
      const snapshot = useMemo(
        () => buildSnapshot({ input: disabled ? 'NAMED PROJECT' : 'UNTITLED WORKSPACE' }),
        [disabled],
      );
      const recovery = useWorkspaceRecovery({
        storageKey: STORAGE_KEY,
        snapshot,
        onRecover: () => undefined,
        disabled,
      });

      return (
        <div>
          <div data-has>{recovery.hasStoredDraft ? 'yes' : 'no'}</div>
          <div data-pending>{recovery.pendingRecovery ? 'yes' : 'no'}</div>
          <button data-enable onClick={() => setDisabled(false)} />
        </div>
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    expect(container.querySelector('[data-has]')?.textContent).toBe('no');
    expect(container.querySelector('[data-pending]')?.textContent).toBe('no');
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain('STORED DRAFT');

    await act(async () => {
      (container.querySelector('[data-enable]') as HTMLButtonElement).click();
    });

    expect(container.querySelector('[data-has]')?.textContent).toBe('yes');
    expect(container.querySelector('[data-pending]')?.textContent).toBe('yes');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('surfaces a non-fatal persistence error when localStorage write fails', async () => {
    vi.useFakeTimers();
    window.localStorage.clear();
    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness = () => {
      const recovery = useWorkspaceRecovery({
        storageKey: STORAGE_KEY,
        snapshot: buildSnapshot({ input: 'FAIL WRITE' }),
        onRecover: () => undefined,
      });
      return <div data-error>{recovery.persistError ?? '-'}</div>;
    };

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-error]')?.textContent).toContain('Quota exceeded');

    await act(async () => {
      root.unmount();
    });
    container.remove();
    setItemSpy.mockRestore();
    vi.useRealTimers();
  });

  it('rejects oversized recovery payloads before writing to localStorage', async () => {
    vi.useFakeTimers();
    window.localStorage.clear();

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness = () => {
      const recovery = useWorkspaceRecovery({
        storageKey: STORAGE_KEY,
        snapshot: buildSnapshot({ input: 'X'.repeat(1_600_000) }),
        onRecover: () => undefined,
      });
      return <div data-error>{recovery.persistError ?? '-'}</div>;
    };

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(container.querySelector('[data-error]')?.textContent).toContain(
      'Workspace draft too large to store locally',
    );
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });
});
