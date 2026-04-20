import type { ImportConflict, ImportResolution } from './importConflictReview';
import type { RunComparisonSummary } from './qaWorkflow';
import type { AdjustmentResult } from '../types';
import type { ClusterReviewDecision } from '../appStateTypes';

export type ReviewQueueSeverity = 'high' | 'medium' | 'low';
export type ReviewQueueSourceType =
  | 'import-conflict'
  | 'suspect-observation'
  | 'cluster-candidate'
  | 'compare-residual'
  | 'compare-station';

export type ReviewQueueTarget =
  | { kind: 'observation'; observationId: number; sourceLine?: number | null }
  | { kind: 'station'; stationId: string; sourceLine?: number | null }
  | { kind: 'source-line'; sourceLine: number };

export interface ReviewQueueItem {
  id: string;
  title: string;
  subtitle: string;
  severity: ReviewQueueSeverity;
  sourceType: ReviewQueueSourceType;
  resolved: boolean;
  target: ReviewQueueTarget;
  preferredTab: 'report' | 'map';
  sourceGroup: string;
}

export interface BuildReviewQueueArgs {
  result: AdjustmentResult | null;
  excludedIds: Set<number>;
  clusterReviewDecisions: Record<string, ClusterReviewDecision>;
  comparisonSummary: RunComparisonSummary | null;
  importConflicts: ImportConflict[];
  conflictResolutions: Record<string, ImportResolution>;
  conflictRenameValues: Record<string, string>;
}

const severityRank: Record<ReviewQueueSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const sourceRank: Record<ReviewQueueSourceType, number> = {
  'import-conflict': 0,
  'suspect-observation': 1,
  'cluster-candidate': 2,
  'compare-residual': 3,
  'compare-station': 4,
};

const normalizeGroup = (value?: string | null): string => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : 'workspace';
};

const inferImportConflictResolved = (
  conflict: ImportConflict,
  resolution: ImportResolution | undefined,
  renameValue: string | undefined,
): boolean => {
  if (!resolution) return false;
  if (resolution !== 'rename-incoming') return true;
  return (renameValue ?? '').trim().length > 0;
};

const inferImportConflictSeverity = (type: ImportConflict['type']): ReviewQueueSeverity => {
  if (type === 'station-id-collision' || type === 'control-state-conflict') return 'high';
  if (type === 'duplicate-observation-family') return 'medium';
  return 'low';
};

const inferObservationSourceLine = (
  observations: AdjustmentResult['observations'],
  observationId: number,
): number | null => observations.find((obs) => obs.id === observationId)?.sourceLine ?? null;

export const buildReviewQueue = (args: BuildReviewQueueArgs): ReviewQueueItem[] => {
  const items: ReviewQueueItem[] = [];

  args.importConflicts.forEach((conflict) => {
    const resolution = args.conflictResolutions[conflict.resolutionKey];
    const renameValue = args.conflictRenameValues[conflict.resolutionKey];
    const resolved = inferImportConflictResolved(conflict, resolution, renameValue);
    items.push({
      id: `import:${conflict.id}`,
      title: conflict.title,
      subtitle: conflict.targetLabel,
      severity: inferImportConflictSeverity(conflict.type),
      sourceType: 'import-conflict',
      resolved,
      target:
        conflict.sourceLine != null
          ? { kind: 'source-line', sourceLine: conflict.sourceLine }
          : { kind: 'source-line', sourceLine: 1 },
      preferredTab: 'report',
      sourceGroup: normalizeGroup(conflict.incomingSourceName),
    });
  });

  if (args.result) {
    args.result.observations
      .filter((obs) => Number.isFinite(obs.stdRes) && Math.abs(obs.stdRes ?? 0) >= 2)
      .forEach((obs) => {
        const absStdRes = Math.abs(obs.stdRes ?? 0);
        items.push({
          id: `suspect:${obs.id}`,
          title: `${obs.type.toUpperCase()} suspect`,
          subtitle: `|StdRes| ${absStdRes.toFixed(2)}`,
          severity: absStdRes >= 4 ? 'high' : absStdRes >= 3 ? 'medium' : 'low',
          sourceType: 'suspect-observation',
          resolved: args.excludedIds.has(obs.id),
          target: {
            kind: 'observation',
            observationId: obs.id,
            sourceLine: obs.sourceLine ?? null,
          },
          preferredTab: 'report',
          sourceGroup: normalizeGroup(obs.sourceFile),
        });
      });

    (args.result.clusterDiagnostics?.candidates ?? []).forEach((candidate) => {
      const decision = args.clusterReviewDecisions[candidate.key];
      const resolved = (decision?.status ?? 'pending') !== 'pending';
      items.push({
        id: `cluster:${candidate.key}`,
        title: 'Cluster candidate',
        subtitle: `${candidate.representativeId} +${Math.max(0, candidate.memberCount - 1)} station(s)`,
        severity: candidate.maxSeparation > 0.1 ? 'high' : candidate.maxSeparation > 0.05 ? 'medium' : 'low',
        sourceType: 'cluster-candidate',
        resolved,
        target: { kind: 'station', stationId: candidate.representativeId, sourceLine: null },
        preferredTab: 'report',
        sourceGroup: 'cluster-review',
      });
    });
  }

  args.comparisonSummary?.residualChanges.forEach((row) => {
    const absDelta = Math.abs(row.deltaAbsStdRes);
    items.push({
      id: `compare-residual:${row.observationId}`,
      title: 'Residual delta',
      subtitle: `${row.stationsLabel} Δ|StdRes| ${absDelta.toFixed(2)}`,
      severity: absDelta >= 2 ? 'high' : absDelta >= 1 ? 'medium' : 'low',
      sourceType: 'compare-residual',
      resolved: false,
      target: {
        kind: 'observation',
        observationId: row.observationId,
        sourceLine: row.sourceLine ?? null,
      },
      preferredTab: 'report',
      sourceGroup: 'run-compare',
    });
  });

  args.comparisonSummary?.movedStations.forEach((row) => {
    items.push({
      id: `compare-station:${row.stationId}`,
      title: 'Station movement',
      subtitle: `${row.stationId} ΔH ${row.deltaHorizontal.toFixed(4)} m`,
      severity: row.deltaHorizontal >= 0.05 ? 'high' : row.deltaHorizontal >= 0.01 ? 'medium' : 'low',
      sourceType: 'compare-station',
      resolved: false,
      target: {
        kind: 'station',
        stationId: row.stationId,
        sourceLine: row.currentSourceLine ?? null,
      },
      preferredTab: 'map',
      sourceGroup: 'run-compare',
    });
  });

  const resultObservations = args.result?.observations ?? [];
  return items.sort((left, right) => {
    const severityDelta = severityRank[left.severity] - severityRank[right.severity];
    if (severityDelta !== 0) return severityDelta;
    const sourceDelta = sourceRank[left.sourceType] - sourceRank[right.sourceType];
    if (sourceDelta !== 0) return sourceDelta;
    const leftLine =
      left.target.kind === 'source-line'
        ? left.target.sourceLine
        : left.target.sourceLine ?? inferObservationSourceLine(resultObservations, (left.target as { observationId?: number }).observationId ?? -1) ?? Number.MAX_SAFE_INTEGER;
    const rightLine =
      right.target.kind === 'source-line'
        ? right.target.sourceLine
        : right.target.sourceLine ?? inferObservationSourceLine(resultObservations, (right.target as { observationId?: number }).observationId ?? -1) ?? Number.MAX_SAFE_INTEGER;
    if (leftLine !== rightLine) return leftLine - rightLine;
    return left.id.localeCompare(right.id, undefined, { numeric: true });
  });
};
