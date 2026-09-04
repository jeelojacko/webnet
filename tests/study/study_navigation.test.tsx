/** @vitest-environment jsdom */

// Study SPA navigation contract: full-URL route state, `__webnetStudy`
// history metadata (studyEntry/canReturn/scrollTop), pre-existing top-level
// history state preservation, and nested-main scroll capture/restore.

import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  STUDY_HISTORY_KEY,
  useStudyNavigation,
} from '../../src/study/useStudyNavigation';

type NavigationValue = ReturnType<typeof useStudyNavigation>;

const HookHarness = ({ onValue }: { onValue: (_value: NavigationValue) => void }) => {
  const value = useStudyNavigation();
  useEffect(() => {
    onValue(value);
  }, [onValue, value]);
  return null;
};

const flushFrames = async (): Promise<void> => {
  await act(async () => {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  });
};

const backAndFlush = async (): Promise<void> => {
  await act(async () => {
    window.history.back();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 10));
  });
  await flushFrames();
};

const studyState = () => {
  const state = window.history.state as Record<string, unknown> | null;
  return state?.[STUDY_HISTORY_KEY] as Record<string, unknown> | undefined;
};

describe('study navigation history + scroll', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let navigation: { current: NavigationValue | null };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    navigation = { current: null };
    window.history.replaceState(null, '', '/study/session');
  });

  afterEach(() => {
    root?.unmount();
    container?.remove();
    root = null;
    container = null;
    navigation = { current: null };
  });

  const mount = async (): Promise<void> => {
    await act(async () => {
      root?.render(
        <HookHarness
          onValue={(next) => {
            navigation.current = next;
          }}
        />,
      );
    });
    if (!navigation.current) throw new Error('hook did not mount');
  };

  const navigate = async (path: string, state: unknown = null): Promise<void> => {
    const current = navigation.current;
    if (!current) throw new Error('hook not mounted');
    await act(async () => {
      current.navigate(path, state);
      await Promise.resolve();
    });
  };

  it('stamps the direct-load entry with canReturn false metadata', async () => {
    await mount();
    expect(navigation.current?.routePath).toBe('/study/session');
    expect(navigation.current?.canReturn).toBe(false);
    expect(studyState()).toMatchObject({ studyEntry: true, canReturn: false, url: '/study/session' });
  });

  it('preserves pre-existing top-level history state when stamping the initial entry', async () => {
    window.history.replaceState({ returnTo: '/study/library' }, '', '/study/session');
    await mount();
    const raw = window.history.state as Record<string, unknown>;
    expect(raw.returnTo).toBe('/study/library');
    expect(studyState()).toMatchObject({ studyEntry: true, canReturn: false });
  });

  it('navigate() keeps caller state at the top level and namespaces metadata under __webnetStudy', async () => {
    await mount();
    await navigate('/study/library?tab=units', { returnTo: '/study/session', sourceKeys: ['x'] });
    expect(window.location.pathname).toBe('/study/library');
    expect(window.location.search).toBe('?tab=units');
    const raw = window.history.state as Record<string, unknown>;
    expect(raw.returnTo).toBe('/study/session');
    expect(raw.sourceKeys).toEqual(['x']);
    expect(studyState()).toMatchObject({
      studyEntry: true,
      url: '/study/library?tab=units',
      canReturn: true,
      scrollTop: 0,
    });
    expect(navigation.current?.routePath).toBe('/study/library?tab=units');
    expect(navigation.current?.canReturn).toBe(true);
  });

  it('passes the hash through to route state for hash deep links', async () => {
    await mount();
    await navigate('/study/document/doc-x#section:12(1)');
    expect(window.location.hash).toBe('#section:12(1)');
    expect(navigation.current?.routePath).toBe('/study/document/doc-x#section:12(1)');
    expect(studyState()).toMatchObject({
      studyEntry: true,
      url: '/study/document/doc-x#section:12(1)',
      canReturn: true,
    });
  });

  it('restores the full location and per-entry canReturn on back/forward', async () => {
    await mount();
    await navigate('/study/library');
    await navigate('/study/manage');
    expect(navigation.current?.routePath).toBe('/study/manage');
    expect(navigation.current?.canReturn).toBe(true);

    await backAndFlush();
    expect(window.location.pathname).toBe('/study/library');
    expect(navigation.current?.routePath).toBe('/study/library');
    expect(navigation.current?.canReturn).toBe(true);

    await backAndFlush();
    expect(window.location.pathname).toBe('/study/session');
    expect(navigation.current?.routePath).toBe('/study/session');
    // The direct-load entry was replaceState'd with canReturn false.
    expect(navigation.current?.canReturn).toBe(false);
  });

  it('returnToPrevious() performs the browser back step', async () => {
    await mount();
    await navigate('/study/learn');
    const current = navigation.current;
    await act(async () => {
      current?.returnToPrevious();
    });
    await flushFrames();
    expect(window.location.pathname).toBe('/study/session');
    expect(navigation.current?.routePath).toBe('/study/session');
    expect(navigation.current?.canReturn).toBe(false);
  });

  it('preserves the leaving entry scroll on navigate and restores it on back', async () => {
    await mount();
    const scroller = document.createElement('main');
    document.body.appendChild(scroller);
    const current = navigation.current;
    if (!current) throw new Error('hook not mounted');
    await act(async () => {
      current.mainScrollRef.current = scroller;
    });

    // Fresh pushes start the scroller at the top of the new page.
    await navigate('/study/library');
    expect(scroller.scrollTop).toBe(0);

    await act(async () => {
      scroller.scrollTop = 150;
    });
    await navigate('/study/manage');
    expect(scroller.scrollTop).toBe(0);
    // The leaving entry's metadata now records where it was.
    expect(studyState()).toMatchObject({ canReturn: true });

    await act(async () => {
      scroller.scrollTop = 99;
    });
    await backAndFlush();
    expect(window.location.pathname).toBe('/study/library');
    // Post-render restoration puts the library list back where it was.
    expect(scroller.scrollTop).toBe(150);
  });
});
