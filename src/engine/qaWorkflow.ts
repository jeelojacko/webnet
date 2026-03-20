import type {
  AdjustmentResult,
  ClusterApprovedMerge,
  Observation,
  ObservationOverride,
} from '../types';
import { formatObservationStationsLabel } from './resultDerivedModels';

export interface DerivedObservationRef {
  id: number;
  type: Observation['type'];
  stationsLabel: string;
  stationIds: string[];
  sourceLine: number | null;
  pairKey: string | null;
  searchText: string;
  absStdRes: number;
}

export interface DerivedStationRef {
  id: string;
  sourceLines: number[];
  observationIds: number[];
  searchText: string;
}

export interface DerivedMapLink {
  key: string;
  observationId: number;
  type: Observation['type'];
  fromId: string;
  toId: string;
  sourceLine: number | null;
  pairKey: string;
}

export interface DerivedQaResult {
  observations: DerivedObservationRef[];
  observationById: Map<number, DerivedObservationRef>;
  stations: DerivedStationRef[];
  stationById: Map<string, DerivedStationRef>;
  mapLinks: DerivedMapLink[];
  suspectObservationIds: number[];
}

export interface RunSnapshot<TSettingsSnapshot = unknown, TRunDiagnostics = unknown> {
  id: string;
  createdAt: string;
  label: string;
  inputFingerprint: string;
  settingsFingerprint: string;
  summary: RunSnapshotSummary;
  result: AdjustmentResult;
  runDiagnostics: TRunDiagnostics | null;
  settingsSnapshot: TSettingsSnapshot;
  excludedIds: number[];
  overrideIds: number[];
  overrides: Record<number, ObservationOverride>;
  approvedClusterMerges: ClusterApprovedMerge[];
  reopenState: SavedRunWorkspaceState | null;
}

export interface RunSnapshotSummary {
  converged: boolean;
  iterations: number;
  seuw: number;
  dof: number;
  stationCount: number;
  observationCount: number;
  suspectObservationCount: number;
  maxAbsStdRes: number;
}

export interface SavedRunSnapshot<TSettingsSnapshot = unknown, TRunDiagnostics = unknown>
  extends RunSnapshot<TSettingsSnapshot, TRunDiagnostics> {
  sourceRunId: string;
  savedAt: string;
  notes: string;
}

export interface SavedRunReviewState {
  reportView: {
    ellipseMode: '1sigma' | '95';
    reportFilterQuery: string;
    reportObservationTypeFilter: string;
    reportExclusionFilter: 'all' | 'included' | 'excluded';
    tableRowLimits: Record<string, number>;
    pinnedDetailSections: Array<{ id: string; label: string }>;
    collapsedDetailSections: Record<string, boolean>;
  };
  selection: {
    stationId: string | null;
    observationId: number | null;
    sourceLine: number | null;
    origin: 'report' | 'map' | 'suspect' | 'compare' | null;
  };
  pinnedObservationIds: number[];
}

export interface SavedRunWorkspaceState {
  activeTab: 'report' | 'processing-summary' | 'industry-output' | 'map';
  review: SavedRunReviewState;
  comparisonSelection: ComparisonSelection;
}

export interface ComparisonSelection {
  baselineRunId: string | null;
  pinnedBaselineRunId: string | null;
  stationMovementThreshold: number;
  residualDeltaThreshold: number;
}

export interface RunComparisonSummary {
  baselineLabel: string;
  currentLabel: string;
  summaryRows: Array<{ label: string; baseline: string; current: string; delta: string }>;
  movedStations: Array<{
    stationId: string;
    deltaHorizontal: number;
    deltaHeight: number | null;
    currentSourceLine: number | null;
  }>;
  residualChanges: Array<{
    observationId: number;
    stationsLabel: string;
    type: Observation['type'];
    sourceLine: number | null;
    baselineAbsStdRes: number;
    currentAbsStdRes: number;
    deltaAbsStdRes: number;
  }>;
  exclusionChanges: {
    added: number[];
    removed: number[];
  };
  overrideChanges: {
    added: number[];
    removed: number[];
  };
  clusterMergeDelta: number;
  settingsDiffs: string[];
}

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

const normalizeStationIds = (obs: Observation): string[] => {
  if (obs.type === 'angle') return [obs.at, obs.from, obs.to];
  if (obs.type === 'direction') return [obs.at, obs.to];
  if (obs.type === 'dist' || obs.type === 'gps' || obs.type === 'lev' || obs.type === 'zenith')
    return [obs.from, obs.to];
  if (obs.type === 'bearing' || obs.type === 'dir') return [obs.from, obs.to];
  return [];
};

export const buildObservationMatchKey = (obs: Observation): string =>
  `${obs.type}|${formatObservationStationsLabel(obs)}|${obs.sourceLine ?? -1}`;

const normalizeSearchText = (...parts: Array<string | number | null | undefined>): string =>
  parts
    .filter((part) => part != null && String(part).trim() !== '')
    .join(' ')
    .toLowerCase();

export const buildQaDerivedResult = (result: AdjustmentResult): DerivedQaResult => {
  const observationById = new Map<number, DerivedObservationRef>();
  const stationById = new Map<string, DerivedStationRef>();
  const mapLinks: DerivedMapLink[] = [];

  result.observations.forEach((obs) => {
    const stationIds = normalizeStationIds(obs);
    const pairStationIds =
      obs.type === 'dist' ||
      obs.type === 'gps' ||
      obs.type === 'lev' ||
      obs.type === 'zenith' ||
      obs.type === 'bearing' ||
      obs.type === 'dir'
        ? [stationIds[0], stationIds[1]].filter(Boolean)
        : obs.type === 'direction'
          ? [obs.at, obs.to]
          : [];
    const pairKey =
      pairStationIds.length === 2
        ? pairStationIds.slice().sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join('|')
        : null;
    const ref: DerivedObservationRef = {
      id: obs.id,
      type: obs.type,
      stationsLabel: formatObservationStationsLabel(obs),
      stationIds,
      sourceLine: obs.sourceLine ?? null,
      pairKey,
      searchText: normalizeSearchText(
        obs.type,
        formatObservationStationsLabel(obs),
        obs.sourceLine ?? '',
      ),
      absStdRes: Number.isFinite(obs.stdRes) ? Math.abs(obs.stdRes ?? 0) : 0,
    };
    observationById.set(obs.id, ref);
    stationIds.forEach((stationId) => {
      const current = stationById.get(stationId) ?? {
        id: stationId,
        sourceLines: [],
        observationIds: [],
        searchText: stationId.toLowerCase(),
      };
      current.observationIds.push(obs.id);
      if (ref.sourceLine != null) current.sourceLines.push(ref.sourceLine);
      current.searchText = normalizeSearchText(current.searchText, ref.searchText);
      stationById.set(stationId, current);
    });
    if (
      pairStationIds.length === 2 &&
      (obs.type === 'dist' || obs.type === 'gps' || obs.type === 'lev' || obs.type === 'bearing' || obs.type === 'dir')
    ) {
      mapLinks.push({
        key: `obs-${obs.id}`,
        observationId: obs.id,
        type: obs.type,
        fromId: pairStationIds[0],
        toId: pairStationIds[1],
        sourceLine: ref.sourceLine,
        pairKey: pairKey ?? `${pairStationIds[0]}|${pairStationIds[1]}`,
      });
    }
  });

  const observations = [...observationById.values()].sort((a, b) => b.absStdRes - a.absStdRes);
  const stations = [...stationById.values()].map((station) => ({
    ...station,
    sourceLines: station.sourceLines.slice().sort((a, b) => a - b),
  }));
  const suspectObservationIds = observations
    .filter((obs) => obs.absStdRes >= 2)
    .map((obs) => obs.id);

  return {
    observations,
    observationById,
    stations,
    stationById,
    mapLinks,
    suspectObservationIds,
  };
};

export const pushRunSnapshot = <TSettingsSnapshot, TRunDiagnostics>(
  history: Array<RunSnapshot<TSettingsSnapshot, TRunDiagnostics>>,
  snapshot: RunSnapshot<TSettingsSnapshot, TRunDiagnostics>,
  limit = 5,
): Array<RunSnapshot<TSettingsSnapshot, TRunDiagnostics>> =>
  [snapshot, ...history.filter((entry) => entry.id !== snapshot.id)].slice(0, limit);

export const resolveComparisonBaseline = <TSettingsSnapshot, TRunDiagnostics>(
  history: Array<RunSnapshot<TSettingsSnapshot, TRunDiagnostics>>,
  savedSnapshots: Array<SavedRunSnapshot<TSettingsSnapshot, TRunDiagnostics>>,
  currentSnapshot: RunSnapshot<TSettingsSnapshot, TRunDiagnostics> | null,
  selection: ComparisonSelection,
): RunSnapshot<TSettingsSnapshot, TRunDiagnostics> | null => {
  if (!currentSnapshot) return null;
  const candidates = buildComparisonCandidateSnapshots(history, savedSnapshots, currentSnapshot);
  const preferredId = selection.pinnedBaselineRunId ?? selection.baselineRunId;
  if (preferredId) {
    return candidates.find((entry) => entry.id === preferredId) ?? null;
  }
  return candidates[0] ?? null;
};

const formatDelta = (value: number): string => {
  if (!Number.isFinite(value)) return '-';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(4)}`;
};

export const buildRunComparison = <TSettingsSnapshot, TRunDiagnostics>(
  currentSnapshot: RunSnapshot<TSettingsSnapshot, TRunDiagnostics>,
  baselineSnapshot: RunSnapshot<TSettingsSnapshot, TRunDiagnostics>,
  selection: ComparisonSelection,
  settingsDiffs: string[],
): RunComparisonSummary => {
  const current = currentSnapshot.result;
  const baseline = baselineSnapshot.result;

  const summaryRows = [
    {
      label: 'Converged',
      baseline: baseline.converged ? 'Yes' : 'No',
      current: current.converged ? 'Yes' : 'No',
      delta: baseline.converged === current.converged ? '-' : 'changed',
    },
    {
      label: 'Iterations',
      baseline: String(baseline.iterations),
      current: String(current.iterations),
      delta: formatDelta(current.iterations - baseline.iterations),
    },
    {
      label: 'SEUW',
      baseline: baseline.seuw.toFixed(4),
      current: current.seuw.toFixed(4),
      delta: formatDelta(current.seuw - baseline.seuw),
    },
    {
      label: 'DOF',
      baseline: String(baseline.dof),
      current: String(current.dof),
      delta: formatDelta(current.dof - baseline.dof),
    },
    {
      label: 'Observations',
      baseline: String(baseline.observations.length),
      current: String(current.observations.length),
      delta: formatDelta(current.observations.length - baseline.observations.length),
    },
  ];

  const movedStations = Object.entries(current.stations)
    .map(([stationId, station]) => {
      const prior = baseline.stations[stationId];
      if (!prior) return null;
      const dE = station.x - prior.x;
      const dN = station.y - prior.y;
      const dH = station.h - prior.h;
      const deltaHorizontal = Math.hypot(dE, dN);
      const deltaHeight = Number.isFinite(dH) ? Math.abs(dH) : null;
      const sourceLines = currentSnapshot.result.parseState?.descriptionTrace
        ?.filter((entry) => entry.stationId === stationId)
        .map((entry) => entry.sourceLine) ?? [];
      if (deltaHorizontal < selection.stationMovementThreshold) return null;
      return {
        stationId,
        deltaHorizontal,
        deltaHeight,
        currentSourceLine: sourceLines.length > 0 ? Math.min(...sourceLines) : null,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry != null)
    .sort((a, b) => b.deltaHorizontal - a.deltaHorizontal);

  const baselineObsByKey = new Map(
    baseline.observations.map((obs) => [buildObservationMatchKey(obs), obs]),
  );
  const residualChanges = current.observations
    .map((obs) => {
      const prior = baselineObsByKey.get(buildObservationMatchKey(obs));
      const currentAbsStdRes = Number.isFinite(obs.stdRes) ? Math.abs(obs.stdRes ?? 0) : 0;
      const baselineAbsStdRes =
        prior && Number.isFinite(prior.stdRes) ? Math.abs(prior.stdRes ?? 0) : 0;
      const deltaAbsStdRes = Math.abs(currentAbsStdRes - baselineAbsStdRes);
      if (deltaAbsStdRes < selection.residualDeltaThreshold) return null;
      return {
        observationId: obs.id,
        stationsLabel: formatObservationStationsLabel(obs),
        type: obs.type,
        sourceLine: obs.sourceLine ?? null,
        baselineAbsStdRes,
        currentAbsStdRes,
        deltaAbsStdRes,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry != null)
    .sort((a, b) => b.deltaAbsStdRes - a.deltaAbsStdRes);

  const currentExcluded = new Set(currentSnapshot.excludedIds);
  const baselineExcluded = new Set(baselineSnapshot.excludedIds);
  const currentOverrideIds = new Set(currentSnapshot.overrideIds);
  const baselineOverrideIds = new Set(baselineSnapshot.overrideIds);

  return {
    baselineLabel: baselineSnapshot.label,
    currentLabel: currentSnapshot.label,
    summaryRows,
    movedStations,
    residualChanges,
    exclusionChanges: {
      added: [...currentExcluded].filter((id) => !baselineExcluded.has(id)).sort((a, b) => a - b),
      removed: [...baselineExcluded]
        .filter((id) => !currentExcluded.has(id))
        .sort((a, b) => a - b),
    },
    overrideChanges: {
      added: [...currentOverrideIds]
        .filter((id) => !baselineOverrideIds.has(id))
        .sort((a, b) => a - b),
      removed: [...baselineOverrideIds]
        .filter((id) => !currentOverrideIds.has(id))
        .sort((a, b) => a - b),
    },
    clusterMergeDelta:
      currentSnapshot.approvedClusterMerges.length - baselineSnapshot.approvedClusterMerges.length,
    settingsDiffs,
  };
};

export const buildRunComparisonText = (summary: RunComparisonSummary): string => {
  const lines: string[] = [];
  lines.push(`Comparison: ${summary.currentLabel} vs ${summary.baselineLabel}`);
  lines.push('');
  lines.push('Summary');
  summary.summaryRows.forEach((row) => {
    lines.push(`- ${row.label}: ${row.baseline} -> ${row.current} (${row.delta})`);
  });
  lines.push('');
  lines.push(
    `Exclusions: +${summary.exclusionChanges.added.length} / -${summary.exclusionChanges.removed.length}`,
  );
  lines.push(
    `Overrides: +${summary.overrideChanges.added.length} / -${summary.overrideChanges.removed.length}`,
  );
  lines.push(`Cluster merges delta: ${summary.clusterMergeDelta >= 0 ? '+' : ''}${summary.clusterMergeDelta}`);
  if (summary.settingsDiffs.length > 0) {
    lines.push('');
    lines.push('Settings');
    summary.settingsDiffs.forEach((line) => lines.push(`- ${line}`));
  }
  if (summary.movedStations.length > 0) {
    lines.push('');
    lines.push('Moved Stations');
    summary.movedStations.slice(0, 20).forEach((row) => {
      lines.push(
        `- ${row.stationId}: dHorz=${row.deltaHorizontal.toFixed(4)}${
          row.deltaHeight != null ? ` dZ=${row.deltaHeight.toFixed(4)}` : ''
        }${row.currentSourceLine != null ? ` line=${row.currentSourceLine}` : ''}`,
      );
    });
  }
  if (summary.residualChanges.length > 0) {
    lines.push('');
    lines.push('Residual Changes');
    summary.residualChanges.slice(0, 20).forEach((row) => {
      lines.push(
        `- #${row.observationId} ${row.type.toUpperCase()} ${row.stationsLabel}: ${row.baselineAbsStdRes.toFixed(2)} -> ${row.currentAbsStdRes.toFixed(2)} (d=${row.deltaAbsStdRes.toFixed(2)})${row.sourceLine != null ? ` line=${row.sourceLine}` : ''}`,
      );
    });
  }
  return lines.join('\n');
};
