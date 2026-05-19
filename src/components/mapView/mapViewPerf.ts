export interface MapViewPerfStat {
  count: number;
  totalMs: number;
  maxMs: number;
  minMs: number;
  lastMs: number;
  samplesMs: number[];
}

export interface MapViewPerfSnapshot {
  label: string;
  metadata: Record<string, unknown>;
  counters: Record<string, number>;
  timings: Record<string, MapViewPerfStat>;
}

type MapPerfGlobal = typeof globalThis & {
  __WEBNET_ENABLE_MAP_PERF_CAPTURE__?: boolean;
  __WEBNET_MAP_PERF__?: MapViewPerfSnapshot | null;
};

const getPerfGlobal = (): MapPerfGlobal => globalThis as MapPerfGlobal;

export const isMapViewPerfCaptureEnabled = (): boolean =>
  getPerfGlobal().__WEBNET_ENABLE_MAP_PERF_CAPTURE__ === true;

export const resetMapViewPerfCapture = (
  label: string,
  metadata: Record<string, unknown> = {},
): MapViewPerfSnapshot | null => {
  if (!isMapViewPerfCaptureEnabled()) return null;
  const snapshot: MapViewPerfSnapshot = {
    label,
    metadata: { ...metadata },
    counters: {},
    timings: {},
  };
  getPerfGlobal().__WEBNET_MAP_PERF__ = snapshot;
  return snapshot;
};

export const getLatestMapViewPerfCapture = (): MapViewPerfSnapshot | null =>
  getPerfGlobal().__WEBNET_MAP_PERF__ ?? null;

export const noteMapViewPerfCounter = (name: string, delta = 1): void => {
  const snapshot = getLatestMapViewPerfCapture();
  if (!snapshot) return;
  snapshot.counters[name] = (snapshot.counters[name] ?? 0) + delta;
};

export const noteMapViewPerfMetadata = (name: string, value: unknown): void => {
  const snapshot = getLatestMapViewPerfCapture();
  if (!snapshot) return;
  snapshot.metadata[name] = value;
};

export const recordMapViewPerfDuration = (name: string, durationMs: number): void => {
  const snapshot = getLatestMapViewPerfCapture();
  if (!snapshot) return;
  const existing = snapshot.timings[name];
  if (!existing) {
    snapshot.timings[name] = {
      count: 1,
      totalMs: durationMs,
      maxMs: durationMs,
      minMs: durationMs,
      lastMs: durationMs,
      samplesMs: [durationMs],
    };
    return;
  }
  existing.count += 1;
  existing.totalMs += durationMs;
  existing.maxMs = Math.max(existing.maxMs, durationMs);
  existing.minMs = Math.min(existing.minMs, durationMs);
  existing.lastMs = durationMs;
  existing.samplesMs.push(durationMs);
};

export const measureMapViewPerf = <T,>(name: string, fn: () => T): T => {
  if (!isMapViewPerfCaptureEnabled()) return fn();
  const startedAt =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  try {
    return fn();
  } finally {
    const finishedAt =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    recordMapViewPerfDuration(name, finishedAt - startedAt);
  }
};
