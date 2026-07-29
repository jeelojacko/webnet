import { formatObservationStationsLabel } from './resultDerivedModels';
import { buildObservationMatchKey } from './qaWorkflowDerived';
import { buildComparisonCandidateSnapshots } from './qaWorkflowSnapshots';
import type {
  ComparisonSelection,
  RunComparisonSummary,
  RunSnapshot,
  SavedRunSnapshot,
} from './qaWorkflowTypes';

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
  const currentPreanalysisAdditions = new Set(currentSnapshot.activePreanalysisAdditionIds ?? []);
  const baselinePreanalysisAdditions = new Set(
    baselineSnapshot.activePreanalysisAdditionIds ?? [],
  );
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
    preanalysisAdditionChanges: {
      added: [...currentPreanalysisAdditions]
        .filter((id) => !baselinePreanalysisAdditions.has(id))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
      removed: [...baselinePreanalysisAdditions]
        .filter((id) => !currentPreanalysisAdditions.has(id))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
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
    `Preanalysis additions: +${summary.preanalysisAdditionChanges.added.length} / -${summary.preanalysisAdditionChanges.removed.length}`,
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
