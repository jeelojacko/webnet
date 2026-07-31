/** @vitest-environment jsdom */

import React, { useEffect, useMemo, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useWorkspaceRecovery } from '../../src/hooks/useWorkspaceRecovery';
import type { RunSettingsSnapshot } from '../../src/appStateTypes';
import {
  act,
  buildSnapshot,
  createRoot,
  defaultReportViewSnapshot,
  STORAGE_KEY,
  type Root,
} from './workspaceRecoveryTestSupport';

describe('useWorkspaceRecovery draft persistence', () => {
  it('discards a pending startup draft without immediately re-saving the current snapshot', async () => {
    window.localStorage.clear();
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        savedAt: '2026-03-18T12:00:00.000Z',
        snapshot: buildSnapshot({ input: 'OLD INPUT' }),
      }),
    );

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness = () => {
      const recovery = useWorkspaceRecovery({
        storageKey: STORAGE_KEY,
        snapshot: useMemo(() => buildSnapshot({ input: 'CURRENT INPUT' }), []),
        onRecover: () => undefined,
      });

      return <button data-discard onClick={recovery.discardRecoveredDraft} />;
    };

    await act(async () => {
      root.render(<Harness />);
    });

    await act(async () => {
      (container.querySelector('[data-discard]') as HTMLButtonElement).click();
    });

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('clears the current draft and only re-saves after the snapshot changes', async () => {
    vi.useFakeTimers();
    window.localStorage.clear();

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness = () => {
      const [suffix, setSuffix] = useState('A');
      const snapshot = useMemo(() => buildSnapshot({ input: `INPUT-${suffix}` }), [suffix]);
      const recovery = useWorkspaceRecovery({
        storageKey: STORAGE_KEY,
        snapshot,
        onRecover: () => undefined,
      });

      useEffect(() => {
        if (!window.localStorage.getItem(STORAGE_KEY)) return;
      }, []);

      return (
        <div>
          <button data-clear onClick={recovery.clearCurrentDraft} />
          <button data-change onClick={() => setSuffix('B')} />
        </div>
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    await act(async () => {
      (container.querySelector('[data-clear]') as HTMLButtonElement).click();
    });

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

    await act(async () => {
      (container.querySelector('[data-change]') as HTMLButtonElement).click();
      await vi.runAllTimersAsync();
    });

    const rawAfterChange = window.localStorage.getItem(STORAGE_KEY);
    expect(rawAfterChange).not.toBeNull();
    expect(rawAfterChange).toContain('INPUT-B');

    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  it('replaces the persisted draft snapshot when a project-style load swaps the workspace state', async () => {
    vi.useFakeTimers();
    window.localStorage.clear();

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness = () => {
      const [snapshot, setSnapshot] = useState(
        buildSnapshot({
          input: 'DRAFT INPUT',
          exportFormat: 'points',
          projectIncludeFiles: { 'draft.dat': 'C P1 0 0 0' },
        }),
      );
      useWorkspaceRecovery({
        storageKey: STORAGE_KEY,
        snapshot,
        onRecover: () => undefined,
      });

      return (
        <button
          data-load-project
          onClick={() =>
            setSnapshot(
              buildSnapshot({
                input: 'PROJECT INPUT',
                exportFormat: 'industry-style',
                projectIncludeFiles: { 'loaded.dat': 'C P2 1 1 1' },
                view: {
                  activeTab: 'map',
                  splitPercent: 42,
                  isSidebarOpen: false,
                  review: {
                    reportView: {
                      ...defaultReportViewSnapshot,
                      ellipseMode: '95',
                      reportFilterQuery: 'p2',
                      reportObservationTypeFilter: 'dist',
                      reportExclusionFilter: 'included',
                      tableRowLimits: { sample: 250 },
                      pinnedDetailSections: [{ id: 'angles-ts', label: 'Angles (TS)' }],
                      collapsedDetailSections: {
                        ...defaultReportViewSnapshot.collapsedDetailSections,
                        'angles-ts': true,
                      },
                    },
                    selection: {
                      stationId: 'P2',
                      observationId: null,
                      sourceLine: 12,
                      origin: 'report',
                    },
                    pinnedObservationIds: [7],
                    runFreshness: 'reviewing',
                    blockingReasons: ['1 setting change(s) pending rerun'],
                  },
                },
              }),
            )
          }
        />
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const initialRaw = window.localStorage.getItem(STORAGE_KEY);
    expect(initialRaw).toContain('DRAFT INPUT');
    expect(initialRaw).not.toContain('PROJECT INPUT');

    await act(async () => {
      (container.querySelector('[data-load-project]') as HTMLButtonElement).click();
      await vi.runAllTimersAsync();
    });

    const replacedRaw = window.localStorage.getItem(STORAGE_KEY);
    expect(replacedRaw).toContain('PROJECT INPUT');
    expect(replacedRaw).toContain('industry-style');
    expect(replacedRaw).toContain('loaded.dat');
    expect(replacedRaw).toContain('"activeTab":"map"');
    expect(replacedRaw).toContain('"reportFilterQuery":"p2"');
    expect(replacedRaw).not.toContain('DRAFT INPUT');

    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });
});
