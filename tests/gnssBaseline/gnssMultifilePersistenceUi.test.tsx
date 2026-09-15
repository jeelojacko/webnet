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

const spyingStore = (): GnssMultifileProjectStore & {
  readonly writes: { key: string; value: string }[];
} => {
  const data: Record<string, string> = {};
  const writes: { key: string; value: string }[] = [];
  return {
    writes,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
      writes.push({ key, value });
    },
  };
};

const mountSwitchableHook = (
  initialProjectId: string,
  store: GnssMultifileProjectStore,
  api: { current: GnssMultifileProject | null },
): { root: Root; el: HTMLElement; show: (_projectId: string) => void } => {
  const Harness: React.FC<{ pid: string }> = ({ pid }) => {
    const project = useGnssMultifileProject({ projectId: pid, store });
    useEffect(() => {
      api.current = project;
    });
    return null;
  };
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  const show = (pid: string): void => {
    act(() => {
      root.render(<Harness pid={pid} />);
    });
  };
  show(initialProjectId);
  return { root, el, show };
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

  it('same-mount projectId switch (rerender A→B→A) never writes A state under the B key', async () => {
    const store = spyingStore();
    const api: { current: GnssMultifileProject | null } = { current: null };
    const mounted = mountSwitchableHook('switch-A', store, api);
    try {
      act(() => {
        api.current?.addSource('a-only.dat', nativeText(''));
      });
      await act(async () => {
        await api.current?.solve(fakeRun);
      });
      expect(api.current?.sources.map((source) => source.name)).toEqual(['a-only.dat']);
      expect(api.current?.snapshot).not.toBeNull();
      const fingerprintA = api.current?.snapshot?.fingerprint;
      store.writes.length = 0;

      // Same-mount switch to an empty project: B must hydrate empty even
      // though the switch commit still closes over A's live state.
      mounted.show('switch-B');
      expect(api.current?.sources).toHaveLength(0);
      expect(api.current?.snapshot).toBeNull();
      const bWrites = store.writes.filter(
        (write) => write.key === 'webnet.gnss-multifile-project.v1.switch-B',
      );
      expect(bWrites.length).toBeGreaterThan(0);
      for (const write of bWrites) {
        expect(write.value).not.toContain('a-only.dat');
      }

      // B keeps independent state.
      act(() => {
        api.current?.addSource('b-only.dat', nativeText('EXTRA'));
      });
      expect(api.current?.sources.map((source) => source.name)).toEqual(['b-only.dat']);

      // Switch back: A is intact, B's content never leaked into it.
      mounted.show('switch-A');
      expect(api.current?.sources.map((source) => source.name)).toEqual(['a-only.dat']);
      expect(api.current?.snapshot?.fingerprint).toBe(fingerprintA);

      // And B still holds only its own content.
      mounted.show('switch-B');
      expect(api.current?.sources.map((source) => source.name)).toEqual(['b-only.dat']);
      const bWritesAfter = store.writes.filter(
        (write) => write.key === 'webnet.gnss-multifile-project.v1.switch-B',
      );
      for (const write of bWritesAfter) {
        expect(write.value).not.toContain('a-only.dat');
      }
    } finally {
      unmountHook(mounted);
    }
  });

  it('pending A solve that resolves after a same-mount switch never snapshots into B', async () => {
    const store = spyingStore();
    const api: { current: GnssMultifileProject | null } = { current: null };
    const mounted = mountSwitchableHook('race-A', store, api);
    try {
      act(() => {
        api.current?.addSource('a-only.dat', nativeText(''));
      });
      // Deferred worker: A starts a solve but the promise stays pending.
      let resolveRun: () => void = () => {};
      const deferredRun: GnssProjectRunFn = (input) =>
        new Promise<GnssRunOutcome>((resolve) => {
          resolveRun = () =>
            resolve({
              route: 'test-inline',
              reasons: ['test'],
              workerBacked: false,
              result: { stations: input.stations, converged: true },
            } as unknown as GnssRunOutcome);
        });
      let pending: Promise<void> | undefined;
      act(() => {
        pending = api.current?.solve(deferredRun);
      });
      expect(api.current?.solving).toBe(true);

      // Same-mount switch while A is still solving: B hydrates empty.
      mounted.show('race-B');
      expect(api.current?.sources).toHaveLength(0);
      expect(api.current?.snapshot).toBeNull();
      expect(api.current?.solving).toBe(false);

      // A's late result resolves now and must be dropped, not snapshotted
      // into B (nor persisted under B's key).
      await act(async () => {
        resolveRun();
        await pending;
      });
      expect(api.current?.sources).toHaveLength(0);
      expect(api.current?.snapshot).toBeNull();
      expect(api.current?.solving).toBe(false);
      const bWrites = store.writes.filter(
        (write) => write.key === 'webnet.gnss-multifile-project.v1.race-B',
      );
      expect(bWrites.length).toBeGreaterThan(0);
      for (const write of bWrites) {
        expect(write.value).not.toContain('a-only.dat');
      }

      // A keeps its source but holds no snapshot: the superseded solve
      // never committed anywhere.
      mounted.show('race-A');
      expect(api.current?.sources.map((source) => source.name)).toEqual(['a-only.dat']);
      expect(api.current?.snapshot).toBeNull();
    } finally {
      unmountHook(mounted);
    }
  });
});
