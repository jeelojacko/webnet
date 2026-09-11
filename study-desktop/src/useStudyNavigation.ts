// Study — SPA navigation hook.
//
// Owns the Study routing state and the namespaced history metadata stamped on
// every history entry under `window.history.state.__webnetStudy`, plus
// main-scroll capture/restore for the nested `[data-study-scroll-root]`
// element rendered by StudyLayout.
//
// Metadata contract (`StudyHistoryMetadata`):
//   - `studyEntry`: true — marks the entry as owned by the Study SPA. The
//     current (direct-load) entry is `replaceState`d on mount so every entry
//     carries it; pre-existing top-level history state is preserved.
//   - `url`: the FULL destination URL (path + search + hash) the entry was
//     pushed for. Popstate restores from it so hash changes rerender where
//     needed.
//   - `canReturn`: true only for entries reached through an in-app
//     `navigate()`. The initial direct-load entry stays false, so the header
//     Return control never offers to leave the Study app.
//   - `scrollTop`: the nested main's scroll offset to restore when this entry
//     is shown again; refreshed on the leaving entry before every push.
//
// Caller-supplied state (e.g. `{ returnTo, sourceKeys }`) stays at the TOP
// level of the pushed state object — only `__webnetStudy` is added beneath it
// — so existing consumers reading `window.history.state.returnTo` keep
// working.

import { useCallback, useEffect, useRef, useState } from 'react';

export const STUDY_HISTORY_KEY = '__webnetStudy';

export type StudyHistoryMetadata = {
  /** Marks this entry as owned by the Study SPA. */
  studyEntry: boolean;
  /** Full URL (path + search + hash) of the history entry it was pushed for. */
  url: string;
  /** True only for entries reached through an in-app `navigate()` call. */
  canReturn: boolean;
  /** Main-scroll offset to restore when this entry is shown again. */
  scrollTop: number;
};

export type StudyHistoryState = { [STUDY_HISTORY_KEY]?: StudyHistoryMetadata };

/** Reads the namespaced metadata of the current browser history entry. */
export const readStudyHistoryMetadata = (): StudyHistoryMetadata | undefined =>
  (window.history.state as StudyHistoryState | null)?.[STUDY_HISTORY_KEY];

const fullLocationNow = (): string =>
  `${window.location.pathname}${window.location.search}${window.location.hash}`;

/** Post-render scheduling that degrades to an immediate call outside browsers. */
const scheduleFrame = (callback: () => void): number => {
  if (typeof window.requestAnimationFrame === 'function') {
    return window.requestAnimationFrame(callback);
  }
  callback();
  return 0;
};

const cancelFrame = (frame: number): void => {
  if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(frame);
};

export const useStudyNavigation = () => {
  const [routePath, setRoutePath] = useState<string>(() => fullLocationNow());
  const mainScrollRef = useRef<HTMLElement | null>(null);
  const routePathRef = useRef<string>(fullLocationNow());
  const scrollByLocationRef = useRef(new Map<string, number>());
  const transitionRef = useRef<'initial' | 'push' | 'pop'>('initial');
  const firstRenderRef = useRef(true);

  // Keep a committed-route snapshot so leaving handlers can attribute the
  // outgoing page's scroll offset before the URL state changes.
  useEffect(() => {
    routePathRef.current = routePath;
  }, [routePath]);

  // Stamp the initial (direct-load) entry with studyEntry + canReturn:false so
  // the header Return stays hidden until an in-app navigation happens.
  // Pre-existing top-level history state is preserved.
  useEffect(() => {
    const existing = window.history.state as Record<string, unknown> | null;
    if ((existing?.[STUDY_HISTORY_KEY] as StudyHistoryMetadata | undefined)?.studyEntry) return;
    const url = fullLocationNow();
    window.history.replaceState(
      {
        ...(existing ?? {}),
        [STUDY_HISTORY_KEY]: { studyEntry: true, url, canReturn: false, scrollTop: 0 },
      },
      '',
      url,
    );
  }, []);

  /** Records the leaving page's scroll in the runtime map (push and pop). */
  const captureLeavingScroll = useCallback((): void => {
    const outgoingUrl = routePathRef.current;
    const main = mainScrollRef.current;
    if (!main) return;
    scrollByLocationRef.current.set(outgoingUrl, main.scrollTop);
  }, []);

  /**
   * Refreshes the CURRENT entry's persisted `scrollTop` before a push. Only
   * called while the outgoing entry is still the browser's current state, so
   * back/forward can read the restore offset straight off the landing entry.
   */
  const persistLeavingScrollMetadata = useCallback((): void => {
    const outgoingUrl = routePathRef.current;
    const main = mainScrollRef.current;
    const existing = window.history.state as Record<string, unknown> | null;
    const metadata = existing?.[STUDY_HISTORY_KEY] as StudyHistoryMetadata | undefined;
    if (!main || !metadata) return;
    window.history.replaceState(
      { ...existing, [STUDY_HISTORY_KEY]: { ...metadata, scrollTop: main.scrollTop } },
      '',
      outgoingUrl,
    );
  }, []);

  useEffect(() => {
    const handlePop = (event: PopStateEvent) => {
      captureLeavingScroll();
      const incoming = (event.state as StudyHistoryState | null)?.[STUDY_HISTORY_KEY]?.url;
      transitionRef.current = 'pop';
      setRoutePath(incoming ?? fullLocationNow());
    };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, [captureLeavingScroll]);

  // Post-render main scroll handling: fresh navigations start at the top of
  // the new page, while back/forward restores the recorded scroll of the entry
  // being shown (runtime map first, then the landing entry's metadata). The
  // first mount is skipped so direct loads keep the browser's native scroll
  // (and per-page hash deep links).
  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    const transition = transitionRef.current;
    transitionRef.current = 'initial';
    const main = mainScrollRef.current;
    if (!main) return;
    if (transition === 'pop') {
      // Prefer the destination entry's persisted value: runtime URL keys can
      // collide when the same URL appears more than once in browser history.
      const restoreTop =
        readStudyHistoryMetadata()?.scrollTop ??
        scrollByLocationRef.current.get(routePath) ??
        0;
      const frame = scheduleFrame(() => {
        const element = mainScrollRef.current;
        if (element) element.scrollTop = restoreTop;
      });
      return () => cancelFrame(frame);
    }
    if (transition === 'push') main.scrollTop = 0;
  }, [routePath]);

  const navigate = useCallback(
    (path: string, state: unknown = null) => {
      captureLeavingScroll();
      persistLeavingScrollMetadata();
      const caller =
        typeof state === 'object' && state !== null
          ? (state as Record<string, unknown>)
          : {};
      const metadata: StudyHistoryMetadata = {
        studyEntry: true,
        url: path,
        canReturn: true,
        scrollTop: 0,
      };
      window.history.pushState({ ...caller, [STUDY_HISTORY_KEY]: metadata }, '', path);
      transitionRef.current = 'push';
      routePathRef.current = path;
      setRoutePath(path);
    },
    [captureLeavingScroll, persistLeavingScrollMetadata],
  );

  const returnToPrevious = useCallback(() => {
    window.history.back();
  }, []);

  const canReturn = readStudyHistoryMetadata()?.canReturn === true;

  return {
    routePath,
    navigate,
    canReturn,
    returnToPrevious,
    mainScrollRef,
  };
};
