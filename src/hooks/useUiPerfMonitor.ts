import { useEffect } from 'react';
import type { WorkspaceTabKey } from '../appStateTypes';

export type PostSolveStageTiming = {
  name: string;
  atMs: number;
  durationMs?: number;
};

export type UiPerfSnapshot = {
  runId: string;
  startedAtMs: number;
  stages: Record<string, PostSolveStageTiming>;
  readyTabs: Partial<Record<WorkspaceTabKey, number>>;
  tabClickLatencyMs: Partial<Record<WorkspaceTabKey, number>>;
  hydrationStates: Partial<Record<WorkspaceTabKey, 'cold' | 'warming' | 'ready'>>;
  longTaskDurationsMs: number[];
};

type PendingTabClick = {
  tab: WorkspaceTabKey;
  startedAtMs: number;
};

let latestUiPerfSnapshot: UiPerfSnapshot | null = null;
let pendingTabClick: PendingTabClick | null = null;
let nextUiPerfRunSequence = 1;

const isPerfEnabled = (): boolean => import.meta.env.DEV;

const nowMs = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const ensureSnapshot = (): UiPerfSnapshot | null => {
  if (!isPerfEnabled()) return null;
  return latestUiPerfSnapshot;
};

const logSnapshot = () => {
  if (!isPerfEnabled() || !latestUiPerfSnapshot) return;
  (globalThis as typeof globalThis & { __WEBNET_UI_PERF__?: UiPerfSnapshot }).__WEBNET_UI_PERF__ =
    latestUiPerfSnapshot;
};

export const beginUiPerfRun = (): string | null => {
  if (!isPerfEnabled()) return null;
  const runId = `ui-run-${nextUiPerfRunSequence++}`;
  latestUiPerfSnapshot = {
    runId,
    startedAtMs: nowMs(),
    stages: {},
    readyTabs: {},
    tabClickLatencyMs: {},
    hydrationStates: {},
    longTaskDurationsMs: [],
  };
  pendingTabClick = null;
  logSnapshot();
  return runId;
};

export const getLatestUiPerfSnapshot = (): UiPerfSnapshot | null => latestUiPerfSnapshot;

export const noteUiPerfStage = (name: string, durationMs?: number) => {
  const snapshot = ensureSnapshot();
  if (!snapshot) return;
  snapshot.stages[name] = {
    name,
    atMs: nowMs() - snapshot.startedAtMs,
    ...(durationMs != null ? { durationMs } : {}),
  };
  logSnapshot();
};

export const measureUiPerfBlock = <T,>(name: string, fn: () => T): T => {
  const startedAtMs = nowMs();
  try {
    return fn();
  } finally {
    noteUiPerfStage(name, nowMs() - startedAtMs);
  }
};

export const noteUiHydrationState = (
  tab: WorkspaceTabKey,
  state: 'cold' | 'warming' | 'ready',
) => {
  const snapshot = ensureSnapshot();
  if (!snapshot) return;
  snapshot.hydrationStates[tab] = state;
  logSnapshot();
};

export const noteUiTabReady = (tab: WorkspaceTabKey) => {
  const snapshot = ensureSnapshot();
  if (!snapshot) return;
  if (snapshot.readyTabs[tab] == null) {
    snapshot.readyTabs[tab] = nowMs() - snapshot.startedAtMs;
  }
  if (pendingTabClick && pendingTabClick.tab === tab && snapshot.tabClickLatencyMs[tab] == null) {
    snapshot.tabClickLatencyMs[tab] = nowMs() - pendingTabClick.startedAtMs;
    pendingTabClick = null;
  }
  logSnapshot();
};

export const noteUiTabClickStart = (tab: WorkspaceTabKey) => {
  const snapshot = ensureSnapshot();
  if (!snapshot) return;
  pendingTabClick = {
    tab,
    startedAtMs: nowMs(),
  };
  logSnapshot();
};

export const noteUiLongTask = (durationMs: number) => {
  const snapshot = ensureSnapshot();
  if (!snapshot) return;
  snapshot.longTaskDurationsMs.push(durationMs);
  logSnapshot();
};

export const useUiLongTaskObserver = () => {
  useEffect(() => {
    if (!isPerfEnabled()) return undefined;
    if (typeof PerformanceObserver === 'undefined') return undefined;
    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          noteUiLongTask(entry.duration);
        });
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch {
      return undefined;
    }
    return () => observer?.disconnect();
  }, []);
};
