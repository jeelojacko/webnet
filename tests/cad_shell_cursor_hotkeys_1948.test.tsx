/** @vitest-environment jsdom */
/**
 * STRUCT-194.8 — shell cursor + keyboard extraction hooks.
 *
 * Real hooks mounted through a tiny harness:
 *   - `useSurveyCadShellCursorAndInsertKeyEffects`: block-INSERT Escape only
 *     disarms for non-typing targets; cursor readout publishes via the
 *     imperative pointer channel (snapped -> 3-decimal raw -> null) exactly
 *     once per pointer event and never on an idle render (#183/#184).
 *   - `useSurveyCadSurfaceEditHotkeys`: exact Escape/Enter priority, typing
 *     exclusion, status notice, and StrictMode listener install/remove.
 *
 * Fast + deterministic; agent tier. No worker/native module.
 */
import React, { act, StrictMode, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  useSurveyCadShellCursorAndInsertKeyEffects,
  type CadBlockInsertPick,
} from '../src/hooks/surveyCad/useSurveyCadShellCursorAndInsertKeyEffects';
import {
  useSurveyCadSurfaceEditHotkeys,
  type SurveyCadSurfaceEditHotkeysArgs,
} from '../src/hooks/surveyCad/useSurveyCadSurfaceEditHotkeys';
import type { CadSnapCandidate } from '../src/engine/cad/cadTypes';
import type { CadShellLink } from '../src/cad-app/shell/cadShellLink';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ARM_PICK: CadBlockInsertPick = { definitionId: 'b1', scale: 1, rotationDeg: 0, repeat: false };

interface CursorApi {
  arm: () => void;
  armed: () => boolean;
}

interface PointerStore {
  listener: ((_point: { x: number; y: number } | null) => void) | null;
  subscribe: (_listener: (_point: { x: number; y: number } | null) => void) => () => void;
}

const makePointerStore = (): PointerStore => {
  const store: PointerStore = {
    listener: null,
    subscribe: (listener) => {
      store.listener = listener;
      return () => {
        store.listener = null;
      };
    },
  };
  return store;
};

const CursorHarness: React.FC<{
  link: CadShellLink;
  snap: CadSnapCandidate | null;
  pointerRef: { current: { x: number; y: number } | null };
  pointerStore: PointerStore;
  onReady: (_api: CursorApi) => void;
}> = ({ link, snap, pointerRef, pointerStore, onReady }) => {
  const [pick, setPick] = useState<CadBlockInsertPick | null>(null);
  useSurveyCadShellCursorAndInsertKeyEffects({
    blockInsertPick: pick,
    setBlockInsertPick: setPick,
    shellLink: link,
    cursorActiveSnap: snap,
    cursorPointerWorldPointRef: pointerRef,
    subscribeCursorPointerWorldPoint: pointerStore.subscribe,
  });
  useEffect(() => {
    onReady({ arm: () => setPick(ARM_PICK), armed: () => pick != null });
  }, [pick, onReady]);
  return <input data-testid="typing-target" />;
};

const snap = (x: number, y: number, label: string): CadSnapCandidate =>
  ({ id: 's1', kind: 'endpoint', sourceEntityId: 'sp:e1', x, y, distance: 0, label }) as CadSnapCandidate;

interface Mounted {
  root: Root;
  container: HTMLElement;
}

const mounted: Mounted[] = [];

const mount = async (element: React.ReactElement): Promise<Mounted> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  const view: Mounted = { root, container };
  mounted.push(view);
  return view;
};

const unmount = async (view: Mounted): Promise<void> => {
  await act(async () => {
    view.root.unmount();
  });
  view.container.remove();
};

afterEach(async () => {
  for (const view of mounted.splice(0)) {
    await unmount(view);
  }
});

const dispatchKey = (key: string, target: EventTarget = document.body): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
};

const holder = <T,>(): { value: T | null } => ({ value: null });

describe('STRUCT-194.8 useSurveyCadShellCursorAndInsertKeyEffects', () => {
  it('disarms block INSERT on Escape for a non-typing target but keeps it for an input', async () => {
    const publishCursor = vi.fn();
    const link = { publishCursor } as unknown as CadShellLink;
    const box = holder<CursorApi>();
    const pointerRef = { current: null };
    const view = await mount(
      <CursorHarness
        link={link}
        snap={null}
        pointerRef={pointerRef}
        pointerStore={makePointerStore()}
        onReady={(api) => {
          box.value = api;
        }}
      />,
    );
    await act(async () => {
      box.value!.arm();
    });
    expect(box.value!.armed()).toBe(true);
    // Typing target keeps the pick.
    await act(async () => {
      dispatchKey('Escape', view.container.querySelector('input')!);
    });
    expect(box.value!.armed()).toBe(true);
    // Non-typing target disarms.
    await act(async () => {
      dispatchKey('Escape');
    });
    expect(box.value!.armed()).toBe(false);
  });

  it('publishes the cursor through the imperative channel: snap, 3-decimal raw, null', async () => {
    const publishCursor = vi.fn();
    const link = { publishCursor } as unknown as CadShellLink;
    const box = holder<CursorApi>();
    const pointerRef: { current: { x: number; y: number } | null } = { current: null };
    const pointerStore = makePointerStore();
    const snapCandidate = snap(3, 4, 'Endpoint');
    const view = await mount(
      <CursorHarness
        link={link}
        snap={null}
        pointerRef={pointerRef}
        pointerStore={pointerStore}
        onReady={(api) => {
          box.value = api;
        }}
      />,
    );
    // Mount publishes once with null (no pointer yet).
    expect(publishCursor).toHaveBeenCalledTimes(1);
    expect(publishCursor).toHaveBeenLastCalledWith(null);

    // A raw pointer read through the imperative channel formats to 3 decimals.
    pointerRef.current = { x: 1.23456, y: -2.5 };
    await act(async () => {
      pointerStore.listener?.(pointerRef.current);
    });
    expect(publishCursor).toHaveBeenLastCalledWith({ x: 1.23456, y: -2.5, label: '1.235,-2.500' });

    // A snap re-runs the effect through the activeSnap dependency.
    await act(async () => {
      view.root.render(
        <CursorHarness
          link={link}
          snap={snapCandidate}
          pointerRef={pointerRef}
          pointerStore={pointerStore}
          onReady={(api) => {
            box.value = api;
          }}
        />,
      );
    });
    expect(publishCursor).toHaveBeenLastCalledWith({ x: 3, y: 4, label: 'Endpoint' });

    // Back to no snap + no pointer publishes null again.
    pointerRef.current = null;
    await act(async () => {
      view.root.render(
        <CursorHarness
          link={link}
          snap={null}
          pointerRef={pointerRef}
          pointerStore={pointerStore}
          onReady={(api) => {
            box.value = api;
          }}
        />,
      );
    });
    expect(publishCursor).toHaveBeenLastCalledWith(null);

    // An idle render with unchanged deps must not publish.
    const calls = publishCursor.mock.calls.length;
    await act(async () => {
      view.root.render(
        <CursorHarness
          link={link}
          snap={null}
          pointerRef={pointerRef}
          pointerStore={pointerStore}
          onReady={(api) => {
            box.value = api;
          }}
        />,
      );
    });
    expect(publishCursor.mock.calls.length).toBe(calls);
  });
});

// ---------------------------------------------------------------------------
// useSurveyCadSurfaceEditHotkeys
// ---------------------------------------------------------------------------

const makeSessions = (out: string[], config: {
  edit?: boolean;
  point?: boolean;
  bulkSelection?: boolean;
  bulkEdit?: boolean;
  bulkEditEnter?: boolean;
  bulkSelectionEnter?: boolean;
}): SurveyCadSurfaceEditHotkeysArgs => {
  const session = (name: string, live: boolean, enter: boolean) => ({
    session: live ? { mode: name } : null,
    cancel: () => out.push(`cancel:${name}`),
    handleEnter: () => {
      out.push(`enter:${name}`);
      return enter;
    },
    previewPrimitives: [],
  });
  return {
    surfaceEditSessions: session('edit', config.edit ?? false, true) as never,
    surfacePointEditSessions: session('point', config.point ?? false, true) as never,
    surfaceBulkSelection: session('bulkSelection', config.bulkSelection ?? false, config.bulkSelectionEnter ?? true) as never,
    surfaceBulkEditSessions: session('bulkEdit', config.bulkEdit ?? false, config.bulkEditEnter ?? true) as never,
    setFileStatusText: ((value: React.SetStateAction<string>) => {
      out.push(`status:${typeof value === 'function' ? 'fn' : value}`);
    }) as never,
  };
};

const HotkeyHarness: React.FC<{ args: SurveyCadSurfaceEditHotkeysArgs }> = ({ args }) => {
  useSurveyCadSurfaceEditHotkeys(args);
  return <input data-testid="typing-target" />;
};

describe('STRUCT-194.8 useSurveyCadSurfaceEditHotkeys', () => {
  it('Escape cancels edit -> point -> bulkSelection -> bulkEdit and posts one notice', async () => {
    const out: string[] = [];
    const args = makeSessions(out, { edit: true });
    await mount(<HotkeyHarness args={args} />);
    await act(async () => {
      dispatchKey('Escape');
    });
    expect(out).toEqual([
      'cancel:edit',
      'cancel:point',
      'cancel:bulkSelection',
      'cancel:bulkEdit',
      'status:Surface edit session ended.',
    ]);
  });

  it('Enter commits point -> bulkEdit -> bulkSelection -> edit in priority order', async () => {
    const pointOut: string[] = [];
    await mount(<HotkeyHarness args={makeSessions(pointOut, {
      point: true,
      bulkEdit: true,
      bulkSelection: true,
      edit: true,
    })} />);
    await act(async () => {
      dispatchKey('Enter');
    });
    expect(pointOut).toEqual(['enter:point']);

    const bulkEditOut: string[] = [];
    await mount(<HotkeyHarness args={makeSessions(bulkEditOut, { bulkEdit: true, bulkEditEnter: true })} />);
    await act(async () => {
      dispatchKey('Enter');
    });
    expect(bulkEditOut).toEqual(['enter:bulkEdit']);

    const fallthroughOut: string[] = [];
    await mount(<HotkeyHarness args={makeSessions(fallthroughOut, {
      bulkEdit: true,
      bulkEditEnter: false,
      bulkSelection: true,
      bulkSelectionEnter: true,
    })} />);
    await act(async () => {
      dispatchKey('Enter');
    });
    expect(fallthroughOut).toEqual(['enter:bulkEdit', 'enter:bulkSelection']);
  });

  it('ignores keys from typing targets', async () => {
    const out: string[] = [];
    const args = makeSessions(out, { edit: true });
    const view = await mount(<HotkeyHarness args={args} />);
    await act(async () => {
      dispatchKey('Escape', view.container.querySelector('input')!);
      dispatchKey('Enter', view.container.querySelector('input')!);
    });
    expect(out).toEqual([]);
  });

  it('installs the capture listener under StrictMode and removes it on unmount', async () => {
    const out: string[] = [];
    const args = makeSessions(out, { edit: true });
    const view = await mount(
      <StrictMode>
        <HotkeyHarness args={args} />
      </StrictMode>,
    );
    await act(async () => {
      dispatchKey('Escape');
    });
    expect(out.length).toBeGreaterThan(0);
    out.length = 0;
    await unmount(view);
    await act(async () => {
      dispatchKey('Escape');
    });
    expect(out).toEqual([]);
  });
});
