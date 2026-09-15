/** @vitest-environment jsdom */

/**
 * Phase 13F fixes — multifile durability UI test (agent tier, synthetic only).
 *
 * REAL unmount/remount through the production hook + production persistence
 * layer (not test-code reconstruction): drive useGnssMultifileProject,
 * unmount the tree (modal close), remount (reopen), and assert
 * sources + settings + frozen results survive per the snapshot policy.
 * Project isolation (close/reopen under a different named project) rides
 * the same store.
 */
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  useGnssMultifileProject,
  type GnssMultifileProject,
  type GnssProjectRunFn,
} from '../../src/hooks/useGnssMultifileProject';
import type { GnssMultifileProjectStore } from '../../src/engine/gnssMultifilePersistence';
import type { GnssRunOutcome } from '../../src/hooks/useGnssBaselineWorker';
import { setGnssMultifileEnabled } from '../../src/engine/gnssMultifileFlag';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FRAME = 'ITRF2020@2020.0';
const EPOCH = '2020.0';
const ELLIPSOID = 'GRS80';
const COV = 'COV 0.000025 0 0 0.000025 0 0.000025';

const nativeText = (extra: string): string =>
  [
    `FRAME ECEF ${FRAME} EPOCH ${EPOCH} ELLIPSOID ${ELLIPSOID}`,
    'UNITS M',
    'GX A 4000000 1000000 4800000 FIXED',
    'GX B 4000100 1000050 4800020 FREE',
    `BL A B 100 50 20 ID B1 SESSION S1${extra}`,
    COV,
    '',
  ].join('\n');

const fakeRun: GnssProjectRunFn = (input) =>
  Promise.resolve({
    route: 'test-inline',
    reasons: ['test'],
    workerBacked: false,
    result: {
      stations: input.stations,
      converged: true,
    },
  } as unknown as GnssRunOutcome);

const memoryStore = (): GnssMultifileProjectStore => {
  const data: Record<string, string> = {};
  return {
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
};

const mountHook = (
  projectId: string,
  store: GnssMultifileProjectStore,
  api: { current: GnssMultifileProject | null },
): { root: Root; el: HTMLElement } => {
  const Harness: React.FC = () => {
    const project = useGnssMultifileProject({ projectId, store });
    useEffect(() => {
      api.current = project;
    });
    return null;
  };
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => {
    root.render(<Harness />);
  });
  return { root, el };
};

const unmountHook = (mounted: { root: Root; el: HTMLElement }): void => {
  act(() => {
    mounted.root.unmount();
  });
  mounted.el.remove();
};

beforeEach(() => {
  setGnssMultifileEnabled(true);
});

describe('multifile project durability (unmount/remount, project isolation)', () => {
  it('modal close/reopen preserves sources + settings + frozen results per policy', async () => {
    const store = memoryStore();
    const api: { current: GnssMultifileProject | null } = { current: null };
    const first = mountHook('proj-1', store, api);
    act(() => {
      api.current?.addSource('p1.dat', nativeText(''));
      api.current?.addSource('p2.dat', nativeText(''));
    });
    expect(api.current?.sources).toHaveLength(2);
    act(() => {
      api.current?.toggleFixed('B', true);
      api.current?.changeDatumMode('allow-free');
      api.current?.setCenteringSigma('0.005');
    });
    await act(async () => {
      await api.current?.solve(fakeRun);
    });
    expect(api.current?.snapshot).not.toBeNull();
    expect(api.current?.stale).toBe(false);
    const solvedFingerprint = api.current?.snapshot?.fingerprint;
    // Post-solve rename: live state moves on, the frozen snapshot must not.
    const firstId = api.current?.sources[0]?.id ?? '';
    act(() => {
      api.current?.renameSource(firstId, 'renamed.dat');
    });
    expect(api.current?.stale).toBe(true);
    expect(api.current?.snapshot?.enabledSources.some((source) => source.name === 'p1.dat')).toBe(true);

    // Modal close (unmount) + reopen (remount): everything durable returns.
    unmountHook(first);
    const api2: { current: GnssMultifileProject | null } = { current: null };
    const second = mountHook('proj-1', store, api2);
    try {
      expect(api2.current?.sources.map((source) => source.name).sort()).toEqual(['p2.dat', 'renamed.dat']);
      expect(api2.current?.sources).toHaveLength(2);
      expect(api2.current?.controlOverrides).toEqual({ B: true });
      expect(api2.current?.datumMode).toBe('allow-free');
      expect(api2.current?.centeringSigma).toBe('0.005');
      expect(api2.current?.snapshot?.fingerprint).toBe(solvedFingerprint);
      // Frozen review context survived: old name/hashes, not the rename.
      expect(api2.current?.snapshot?.enabledSources.some((source) => source.name === 'p1.dat')).toBe(true);
      expect(api2.current?.snapshot?.datumMode).toBe('allow-free');
      // Restored post-edit state is stale per policy until re-adjust.
      expect(api2.current?.stale).toBe(true);
      expect(api2.current?.provenanceLines[0]).toMatch(/Multifile composition provenance/);
    } finally {
      unmountHook(second);
    }
  });

  it('opening a different named project starts empty (no cross-project leak)', async () => {
    const store = memoryStore();
    const api: { current: GnssMultifileProject | null } = { current: null };
    const first = mountHook('proj-A', store, api);
    act(() => {
      api.current?.addSource('p1.dat', nativeText(''));
    });
    await act(async () => {
      await api.current?.solve(fakeRun);
    });
    expect(api.current?.snapshot).not.toBeNull();
    unmountHook(first);

    const api2: { current: GnssMultifileProject | null } = { current: null };
    const second = mountHook('proj-B', store, api2);
    try {
      expect(api2.current?.sources).toHaveLength(0);
      expect(api2.current?.snapshot).toBeNull();
    } finally {
      unmountHook(second);
    }

    // Original project still intact after the switch.
    const api3: { current: GnssMultifileProject | null } = { current: null };
    const third = mountHook('proj-A', store, api3);
    try {
      expect(api3.current?.sources).toHaveLength(1);
      expect(api3.current?.snapshot).not.toBeNull();
    } finally {
      unmountHook(third);
    }
  });
});
