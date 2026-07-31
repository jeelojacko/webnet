/** @vitest-environment jsdom */

import React, { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { useWorkspaceRecovery } from '../../src/hooks/useWorkspaceRecovery';
import type { RunSettingsSnapshot } from '../../src/appStateTypes';
import {
  act,
  buildSnapshot,
  createRoot,
  STORAGE_KEY,
  type Root,
} from './workspaceRecoveryTestSupport';

describe('useWorkspaceRecovery startup and import-review recovery', () => {
  it('offers startup recovery and restores the stored snapshot', async () => {
    window.localStorage.clear();
    const savedSnapshot = buildSnapshot({ input: 'RECOVERED INPUT' });
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        savedAt: '2026-03-18T12:00:00.000Z',
        snapshot: savedSnapshot,
      }),
    );

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness = () => {
      const [snapshot, setSnapshot] = useState(buildSnapshot());
      const recovery = useWorkspaceRecovery({
        storageKey: STORAGE_KEY,
        snapshot,
        onRecover: setSnapshot,
      });

      return (
        <div>
          <div data-has>{recovery.hasStoredDraft ? 'yes' : 'no'}</div>
          <div data-pending>{recovery.pendingRecovery ? 'yes' : 'no'}</div>
          <div data-input>{snapshot.input}</div>
          <button data-recover onClick={recovery.recoverDraft} />
        </div>
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    expect(container.querySelector('[data-pending]')?.textContent).toBe('yes');
    expect(container.querySelector('[data-input]')?.textContent).toBe('INPUT');

    await act(async () => {
      (container.querySelector('[data-recover]') as HTMLButtonElement).click();
    });

    expect(container.querySelector('[data-pending]')?.textContent).toBe('no');
    expect(container.querySelector('[data-input]')?.textContent).toBe('RECOVERED INPUT');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('round-trips an open import-review snapshot through recovery storage', async () => {
    window.localStorage.clear();
    const savedSnapshot = buildSnapshot({
      input: 'RECOVER IMPORT',
      savedRunSnapshots: [
        {
          id: 'saved-run-1',
          sourceRunId: 'run-3',
          createdAt: '2026-03-18T11:00:00.000Z',
          savedAt: '2026-03-18T11:05:00.000Z',
          label: 'Saved Run 03',
          notes: 'checkpoint',
          inputFingerprint: 'fnv1a:abc',
          settingsFingerprint: 'fnv1a:def',
          summary: {
            converged: true,
            iterations: 1,
            seuw: 1,
            dof: 1,
            stationCount: 1,
            observationCount: 0,
            suspectObservationCount: 0,
            maxAbsStdRes: 0,
          },
          result: {
            success: true,
            converged: true,
            iterations: 1,
            seuw: 1,
            dof: 1,
            stations: {
              A: { x: 0, y: 0, h: 0, fixed: true },
            },
            observations: [],
            logs: [],
          },
          runDiagnostics: null,
          settingsSnapshot: {
            solveProfile: 'industry-parity',
          } as unknown as RunSettingsSnapshot,
          excludedIds: [],
          overrideIds: [],
          overrides: {},
          approvedClusterMerges: [],
          reopenState: null,
        },
      ],
      importReview: {
        sourceName: 'imported.jxl',
        notice: { title: 'Imported JobXML dataset', detailLines: ['detail'] },
        sources: [
          {
            key: 'source:0',
            sourceName: 'imported.jxl',
            notice: { title: 'Imported JobXML dataset', detailLines: ['detail'] },
            dataset: {
              importerId: 'jobxml',
              formatLabel: 'JobXML',
              summary: 'summary',
              notice: { title: 'Imported JobXML dataset', detailLines: ['detail'] },
              comments: [],
              controlStations: [],
              observations: [],
              trace: [],
            },
            isPrimary: true,
          },
          {
            key: 'source:1',
            sourceName: 'imported.htm',
            notice: { title: 'Imported Survey Report', detailLines: ['detail'] },
            dataset: {
              importerId: 'trimble-survey-report',
              formatLabel: 'Survey Report',
              summary: 'summary',
              notice: { title: 'Imported Survey Report', detailLines: ['detail'] },
              comments: [],
              controlStations: [],
              observations: [],
              trace: [],
            },
            isPrimary: false,
          },
        ],
        dataset: {
          importerId: 'jobxml',
          formatLabel: 'JobXML',
          summary: 'summary',
          notice: { title: 'Imported JobXML dataset', detailLines: ['detail'] },
          comments: [],
          controlStations: [],
          observations: [],
          trace: [],
        },
        reviewModel: {
          groups: [],
          items: [],
          warnings: [],
          errors: [],
        },
        comparisonMode: 'non-mta-only',
        excludedItemIds: [],
        fixedItemIds: [],
        groupLabels: {},
        groupComments: {},
        rowOverrides: {},
        rowTypeOverrides: {},
        preset: 'clean-webnet',
        importFaceNormalizationMode: 'on',
        force2DOutput: false,
        nextSyntheticId: 1,
        nextSourceId: 2,
        conflicts: [],
        conflictResolutions: {},
        conflictRenameValues: {},
      },
    });
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        savedAt: '2026-03-18T12:00:00.000Z',
        snapshot: savedSnapshot,
      }),
    );

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness = () => {
      const [snapshot, setSnapshot] = useState(buildSnapshot());
      const recovery = useWorkspaceRecovery({
        storageKey: STORAGE_KEY,
        snapshot,
        onRecover: setSnapshot,
      });

      return (
        <div>
          <div data-import-source>{snapshot.importReview?.sourceName ?? '-'}</div>
          <div data-saved-runs>{snapshot.savedRunSnapshots.length}</div>
          <button data-recover onClick={recovery.recoverDraft} />
        </div>
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    await act(async () => {
      (container.querySelector('[data-recover]') as HTMLButtonElement).click();
    });

    expect(container.querySelector('[data-import-source]')?.textContent).toBe('imported.jxl');
    expect(container.querySelector('[data-saved-runs]')?.textContent).toBe('1');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
