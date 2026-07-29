import type { AdjustmentResult } from '../types';
import type {
  ComparisonSelection,
  RunSnapshot,
  RunSnapshotSummary,
  SavedRunSnapshot,
} from './qaWorkflowTypes';

export const DEFAULT_COMPARISON_SELECTION: ComparisonSelection = {
  baselineRunId: null,
  pinnedBaselineRunId: null,
  stationMovementThreshold: 0.001,
  residualDeltaThreshold: 0.25,
};

const stableStringifyValue = (value: unknown): string => {
  if (value == null) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringifyValue(entry)).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((key) => `${JSON.stringify(key)}:${stableStringifyValue(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(String(value));
};

const hashString = (value: string): string => {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

export const buildValueFingerprint = (value: unknown): string =>
  `fnv1a:${hashString(stableStringifyValue(value))}`;

export const buildRunSnapshotSummary = (result: AdjustmentResult): RunSnapshotSummary => {
  let maxAbsStdRes = 0;
  let suspectObservationCount = 0;
  result.observations.forEach((obs) => {
    const absStdRes = Number.isFinite(obs.stdRes) ? Math.abs(obs.stdRes ?? 0) : 0;
    if (absStdRes >= 2) suspectObservationCount += 1;
    if (absStdRes > maxAbsStdRes) maxAbsStdRes = absStdRes;
  });
  return {
    converged: result.converged,
    iterations: result.iterations,
    seuw: result.seuw,
    dof: result.dof,
    stationCount: Object.keys(result.stations ?? {}).length,
    observationCount: result.observations.length,
    suspectObservationCount,
    maxAbsStdRes,
  };
};

export const cloneSavedRunSnapshots = <TSettingsSnapshot, TRunDiagnostics>(
  snapshots: Array<SavedRunSnapshot<TSettingsSnapshot, TRunDiagnostics>>,
): Array<SavedRunSnapshot<TSettingsSnapshot, TRunDiagnostics>> =>
  JSON.parse(JSON.stringify(snapshots)) as Array<SavedRunSnapshot<TSettingsSnapshot, TRunDiagnostics>>;

export const pushSavedRunSnapshot = <TSettingsSnapshot, TRunDiagnostics>(
  history: Array<SavedRunSnapshot<TSettingsSnapshot, TRunDiagnostics>>,
  snapshot: SavedRunSnapshot<TSettingsSnapshot, TRunDiagnostics>,
  limit = 10,
): Array<SavedRunSnapshot<TSettingsSnapshot, TRunDiagnostics>> =>
  [snapshot, ...history.filter((entry) => entry.id !== snapshot.id)].slice(0, limit);

const getSnapshotSourceIdentity = <TSettingsSnapshot, TRunDiagnostics>(
  snapshot: RunSnapshot<TSettingsSnapshot, TRunDiagnostics>,
): string =>
  'sourceRunId' in snapshot && typeof snapshot.sourceRunId === 'string'
    ? snapshot.sourceRunId
    : snapshot.id;

export const buildComparisonCandidateSnapshots = <TSettingsSnapshot, TRunDiagnostics>(
  history: Array<RunSnapshot<TSettingsSnapshot, TRunDiagnostics>>,
  savedSnapshots: Array<SavedRunSnapshot<TSettingsSnapshot, TRunDiagnostics>>,
  currentSnapshot: RunSnapshot<TSettingsSnapshot, TRunDiagnostics> | null,
): Array<RunSnapshot<TSettingsSnapshot, TRunDiagnostics>> => {
  if (!currentSnapshot) return [];
  const currentIdentity = getSnapshotSourceIdentity(currentSnapshot);
  const seenIds = new Set<string>();
  const seenSourceIdentities = new Set<string>([currentIdentity]);
  const candidates: Array<RunSnapshot<TSettingsSnapshot, TRunDiagnostics>> = [];
  [...history, ...savedSnapshots].forEach((entry) => {
    if (entry.id === currentSnapshot.id || seenIds.has(entry.id)) return;
    const sourceIdentity = getSnapshotSourceIdentity(entry);
    if (seenSourceIdentities.has(sourceIdentity)) return;
    seenIds.add(entry.id);
    seenSourceIdentities.add(sourceIdentity);
    candidates.push(entry);
  });
  return candidates;
};

export const pushRunSnapshot = <TSettingsSnapshot, TRunDiagnostics>(
  history: Array<RunSnapshot<TSettingsSnapshot, TRunDiagnostics>>,
  snapshot: RunSnapshot<TSettingsSnapshot, TRunDiagnostics>,
  limit = 5,
): Array<RunSnapshot<TSettingsSnapshot, TRunDiagnostics>> =>
  [snapshot, ...history.filter((entry) => entry.id !== snapshot.id)].slice(0, limit);
