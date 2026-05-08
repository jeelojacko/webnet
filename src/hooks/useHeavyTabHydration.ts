import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceTabKey } from '../appStateTypes';
import { noteUiHydrationState } from './useUiPerfMonitor';

type HydrationStatus = 'cold' | 'warming' | 'ready';
type HydrationState = Record<WorkspaceTabKey, HydrationStatus>;

const createColdHydrationState = (): HydrationState => ({
  report: 'cold',
  'processing-summary': 'cold',
  'industry-output': 'cold',
  map: 'cold',
});

const createResultHydrationState = (): HydrationState => ({
  report: 'ready',
  'processing-summary': 'cold',
  'industry-output': 'cold',
  map: 'cold',
});

const scheduleAfterPaint = (callback: () => void): (() => void) => {
  const timeoutId = globalThis.setTimeout(callback, 16);
  return () => globalThis.clearTimeout(timeoutId);
};

export const useHeavyTabHydration = (
  result: unknown,
  activeTab: WorkspaceTabKey,
) => {
  const [hydrationState, setHydrationState] = useState<HydrationState>(() =>
    result ? createResultHydrationState() : createColdHydrationState(),
  );
  const hydrationStateRef = useRef(hydrationState);
  const activeWarmCancelRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    hydrationStateRef.current = hydrationState;
  }, [hydrationState]);

  useEffect(() => {
    const nextState = result ? createResultHydrationState() : createColdHydrationState();
    setHydrationState(nextState);
  }, [result]);

  useEffect(() => {
    if (!result) return undefined;
    const activeStatus = hydrationStateRef.current[activeTab];
    noteUiHydrationState(activeTab, activeStatus);
    if (activeStatus !== 'cold' || activeTab === 'report') return undefined;
    setHydrationState((current) =>
      current[activeTab] === 'cold'
        ? { ...current, [activeTab]: 'warming' }
        : current,
    );
    noteUiHydrationState(activeTab, 'warming');
    activeWarmCancelRef.current?.();
    const cancel = scheduleAfterPaint(() => {
      setHydrationState((current) =>
        current[activeTab] === 'ready' ? current : { ...current, [activeTab]: 'ready' },
      );
      noteUiHydrationState(activeTab, 'ready');
    });
    activeWarmCancelRef.current = cancel;
    return () => cancel();
  }, [activeTab, result]);

  useEffect(
    () => () => {
      activeWarmCancelRef.current?.();
    },
    [],
  );

  const canRenderTab = useMemo(
    () => (tab: WorkspaceTabKey) => tab === 'report' || hydrationState[tab] === 'ready',
    [hydrationState],
  );

  return {
    hydrationState,
    canRenderTab,
  };
};

const scheduleIdle = (callback: () => void): (() => void) => {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    const idleWindow = window as Window & {
      requestIdleCallback: (
        _cb: (_deadline: { didTimeout: boolean; timeRemaining: () => number }) => void,
      ) => number;
      cancelIdleCallback?: (_id: number) => void;
    };
    const idleId = idleWindow.requestIdleCallback(() => callback());
    return () => idleWindow.cancelIdleCallback?.(idleId);
  }
  const timeoutId = globalThis.setTimeout(callback, 32);
  return () => globalThis.clearTimeout(timeoutId);
};

export const useSequentialTabPrewarm = (
  result: unknown,
  preloaders: Array<() => Promise<unknown>>,
) => {
  const interactedRef = useRef(false);

  useEffect(() => {
    if (!result) return undefined;
    interactedRef.current = false;
    const cancelers: Array<() => void> = [];
    let cancelled = false;

    const handleUserInteraction = () => {
      interactedRef.current = true;
    };

    window.addEventListener('pointerdown', handleUserInteraction, { passive: true });
    window.addEventListener('keydown', handleUserInteraction);
    window.addEventListener('wheel', handleUserInteraction, { passive: true });

    const warmIndex = (index: number) => {
      if (cancelled || interactedRef.current || index >= preloaders.length) return;
      const cancel = scheduleIdle(() => {
        if (cancelled || interactedRef.current) return;
        void preloaders[index]().finally(() => {
          warmIndex(index + 1);
        });
      });
      cancelers.push(cancel);
    };

    warmIndex(0);

    return () => {
      cancelled = true;
      cancelers.forEach((cancel) => cancel());
      window.removeEventListener('pointerdown', handleUserInteraction);
      window.removeEventListener('keydown', handleUserInteraction);
      window.removeEventListener('wheel', handleUserInteraction);
    };
  }, [preloaders, result]);
};
