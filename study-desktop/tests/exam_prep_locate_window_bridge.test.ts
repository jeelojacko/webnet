/** @vitest-environment jsdom */

// Exam Prep Locate — native window/event bridge (Tauri transport, mocked APIs).
//
// The desktop path must never depend on `window.open`/BroadcastChannel: the
// stable single picker window is reused/focused by label, typed parent-child
// events carry the existing pick/control payloads, stale sessions and
// malformed payloads are filtered, listeners clean up exactly once, and every
// failure is explicit (never a silent fallback).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTauriLocateWindowBridge,
  LOCATE_MAIN_WINDOW_LABEL,
  LOCATE_PICKER_WINDOW_LABEL,
  LOCATE_TAURI_CONTROL_EVENT,
  LOCATE_TAURI_PICK_EVENT,
  resolveLocateWindowBridge,
  type LocateTauriDeps,
} from '../src/examPrep/locateWindowBridge';
import { STUDY_LIBRARY_PATH } from '../src/studyWindow';

type Handler = (_payload: unknown) => void;

const createMockDeps = () => {
  const listeners = new Map<string, Set<Handler>>();
  const windows = new Map<string, { setFocus: () => Promise<void>; close: () => Promise<void> }>();
  const focusCalls: string[] = [];
  const closeCalls: string[] = [];
  const emitted: Array<{ target: string; event: string; payload: unknown }> = [];
  let failEmit = false;
  let failCreate = false;
  const deps: LocateTauriDeps = {
    getByLabel: async (label) => windows.get(label) ?? null,
    create: async (label, _url) => {
      if (failCreate) throw new Error('create failed');
      const handle = {
        setFocus: async () => {
          focusCalls.push(label);
        },
        close: async () => {
          closeCalls.push(label);
        },
      };
      windows.set(label, handle);
      createdUrls.push({ label, url: _url });
      return handle;
    },
    emitTo: async (target, event, payload) => {
      if (failEmit) throw new Error('emit failed');
      emitted.push({ target, event, payload });
      // Loop back to local listeners like the Tauri event bus would.
      listeners.get(event)?.forEach((handler) => handler(payload));
    },
    listen: async (event, handler) => {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(handler);
      return () => {
        listeners.get(event)?.delete(handler);
      };
    },
  };
  const createdUrls: Array<{ label: string; url: string }> = [];
  const state = {
    get windows() {
      return windows;
    },
    focusCalls,
    closeCalls,
    get emitted() {
      return emitted;
    },
    get createdUrls() {
      return createdUrls;
    },
    listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
    setFailEmit: (value: boolean) => {
      failEmit = value;
    },
    setFailCreate: (value: boolean) => {
      failCreate = value;
    },
  };
  return { deps, state };
};

const request = {
  prompt: 'Find the provision about licences',
  token: 'locate-pick-abc123',
  sprintId: 'locate-sprint-xyz',
};

/** Lets the bridge's async listen() registrations (and cleanups) settle. */
const flushBridge = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('Tauri Locate window bridge', () => {
  it('creates the stable picker window once with the native Study picker route', async () => {
    const { deps, state } = createMockDeps();
    const bridge = createTauriLocateWindowBridge(deps);
    expect(bridge.platform).toBe('tauri');

    const opened = await bridge.openPicker(request);
    expect(opened).toEqual({ opened: true });
    expect(state.createdUrls).toHaveLength(1);
    const [created] = state.createdUrls;
    expect(created.label).toBe(LOCATE_PICKER_WINDOW_LABEL);
    // Native Study composition: the child loads the SAME picker route — no
    // duplicate Study implementation, only the transport differs.
    expect(created.url).toContain(STUDY_LIBRARY_PATH);
    expect(created.url).toContain('studyPicker=locate');
    expect(created.url).toContain(encodeURIComponent(request.token));
    expect(created.url).toContain(encodeURIComponent(request.sprintId));
    // Initial context is pushed for the mount race.
    expect(
      state.emitted.some(
        (entry) =>
          entry.target === LOCATE_PICKER_WINDOW_LABEL &&
          entry.event === LOCATE_TAURI_CONTROL_EVENT,
      ),
    ).toBe(true);
  });

  it('reuses and focuses the existing picker window instead of creating a second one', async () => {
    const { deps, state } = createMockDeps();
    const bridge = createTauriLocateWindowBridge(deps);

    await bridge.openPicker(request);
    const second = await bridge.openPicker({ ...request, token: 'locate-pick-next' });
    expect(second).toEqual({ opened: true });
    expect(state.createdUrls).toHaveLength(1);
    const handle = state.windows.get(LOCATE_PICKER_WINDOW_LABEL);
    expect(handle).toBeDefined();
    expect(state.focusCalls).toEqual([LOCATE_PICKER_WINDOW_LABEL]);
    // Fresh context for the new item is pushed to the reused window.
    const lastContext = [...state.emitted]
      .reverse()
      .find((entry) => entry.event === LOCATE_TAURI_CONTROL_EVENT);
    expect(lastContext?.payload).toMatchObject({
      type: 'picker-context',
      token: 'locate-pick-next',
      sprintId: request.sprintId,
    });
  });

  it('closes the picker window and tolerates a missing window', async () => {
    const { deps, state } = createMockDeps();
    const bridge = createTauriLocateWindowBridge(deps);

    await bridge.closePicker(); // no window yet — must not throw
    await bridge.openPicker(request);
    await bridge.closePicker();
    expect(state.closeCalls).toEqual([LOCATE_PICKER_WINDOW_LABEL]);
  });

  it('never touches window.open or BroadcastChannel on the desktop path', async () => {
    const { deps } = createMockDeps();
    const bridge = createTauriLocateWindowBridge(deps);
    const openSpy = vi.spyOn(window, 'open');
    const channelNames: string[] = [];
    const RealBroadcastChannel = globalThis.BroadcastChannel;
    class SpyChannel {
      constructor(name: string) {
        channelNames.push(name);
      }
      postMessage() {}
      close() {}
      set onmessage(_handler: unknown) {}
    }
    (globalThis as Record<string, unknown>).BroadcastChannel = SpyChannel;

    try {
      await bridge.openPicker(request);
      await bridge.postPick(request.token, 'doc-a', null);
      await bridge.postControlToPicker({
        type: 'picker-context',
        sprintId: request.sprintId,
        token: request.token,
        prompt: request.prompt,
      });
      const cleanup = bridge.subscribePicks(request.token, () => undefined);
      cleanup();
      expect(openSpy).not.toHaveBeenCalled();
      expect(channelNames).toEqual([]);
    } finally {
      openSpy.mockRestore();
      (globalThis as Record<string, unknown>).BroadcastChannel = RealBroadcastChannel;
    }
  });

  it('delivers typed picks and control messages for the live session', async () => {
    const { deps, state } = createMockDeps();
    const bridge = createTauriLocateWindowBridge(deps);

    const picks: unknown[] = [];
    const controls: unknown[] = [];
    const stopPicks = bridge.subscribePicks(request.token, (pick) => picks.push(pick));
    const stopControls = bridge.subscribeControl(request.sprintId, (message) =>
      controls.push(message),
    );

    expect(await bridge.postPick(request.token, 'doc-registry-act', 'section:34')).toBe('sent');
    expect(await bridge.postControlToParent({ type: 'picker-ready', sprintId: request.sprintId })).toBe(
      'sent',
    );
    expect(picks).toEqual([
      {
        type: 'study-locate-pick',
        token: request.token,
        documentId: 'doc-registry-act',
        sourceKey: 'section:34',
      },
    ]);
    expect(controls).toEqual([{ type: 'picker-ready', sprintId: request.sprintId }]);
    expect(
      state.emitted.find((entry) => entry.event === LOCATE_TAURI_PICK_EVENT)?.target,
    ).toBe(LOCATE_MAIN_WINDOW_LABEL);

    stopPicks();
    stopControls();
  });

  it('ignores stale-token picks, foreign-sprint control, and malformed payloads', async () => {
    const { deps } = createMockDeps();
    const bridge = createTauriLocateWindowBridge(deps);

    const picks: unknown[] = [];
    const controls: unknown[] = [];
    bridge.subscribePicks(request.token, (pick) => picks.push(pick));
    bridge.subscribeControl(request.sprintId, (message) => controls.push(message));
    // Let the async listen() registrations settle.
    await flushBridge();

    const publish = async (event: string, payload: unknown) => {
      // Publish straight through the mock bus, bypassing the typed posters.
      await deps.emitTo(LOCATE_MAIN_WINDOW_LABEL, event, payload);
    };

    await publish(LOCATE_TAURI_PICK_EVENT, {
      type: 'study-locate-pick',
      token: 'locate-pick-stale',
      documentId: 'doc-other',
      sourceKey: null,
    });
    await publish(LOCATE_TAURI_CONTROL_EVENT, {
      type: 'picker-context',
      sprintId: 'locate-sprint-foreign',
      token: 'locate-pick-abc123',
      prompt: 'other',
    });
    await publish(LOCATE_TAURI_PICK_EVENT, { type: 'other' });
    await publish(LOCATE_TAURI_PICK_EVENT, null);
    await publish(LOCATE_TAURI_PICK_EVENT, 'nope');
    await publish(LOCATE_TAURI_CONTROL_EVENT, { type: 'picker-ready' });

    expect(picks).toEqual([]);
    expect(controls).toEqual([]);
  });

  it('cleans up listeners exactly once and keeps independent subscribes separate', async () => {
    const { deps, state } = createMockDeps();
    const bridge = createTauriLocateWindowBridge(deps);

    const stopA = bridge.subscribePicks(request.token, () => undefined);
    const stopB = bridge.subscribePicks(request.token, () => undefined);
    await flushBridge();
    expect(state.listenerCount(LOCATE_TAURI_PICK_EVENT)).toBe(2);

    stopA();
    await flushBridge();
    expect(state.listenerCount(LOCATE_TAURI_PICK_EVENT)).toBe(1);
    stopA(); // duplicate cleanup is safe
    await flushBridge();
    expect(state.listenerCount(LOCATE_TAURI_PICK_EVENT)).toBe(1);
    stopB();
    await flushBridge();
    expect(state.listenerCount(LOCATE_TAURI_PICK_EVENT)).toBe(0);
  });

  it('surfaces failures explicitly instead of silently falling back', async () => {
    const { deps, state } = createMockDeps();
    const bridge = createTauriLocateWindowBridge(deps);

    state.setFailEmit(true);
    expect(await bridge.postPick(request.token, 'doc-a', null)).toBe('error');
    expect(
      await bridge.postControlToPicker({
        type: 'picker-context',
        sprintId: request.sprintId,
        token: request.token,
        prompt: request.prompt,
      }),
    ).toBe('error');
    expect(
      await bridge.postControlToParent({ type: 'picker-ready', sprintId: request.sprintId }),
    ).toBe('error');

    state.setFailEmit(false);
    state.setFailCreate(true);
    const opened = await bridge.openPicker(request);
    expect(opened.opened).toBe(false);
  });

  it('resolves the browser bridge outside the Tauri runtime (behavior unchanged)', () => {
    const bridge = resolveLocateWindowBridge();
    expect(bridge.platform).toBe('browser');
  });
});
