import type { AdjustmentResult } from '../types';
import type { PersistedSavedRunSnapshot } from '../appStateTypes';
import {
  buildRunSnapshotSummary,
  buildValueFingerprint,
  cloneSavedRunSnapshots,
} from './qaWorkflow';
import {
  isRecord,
  sanitizeClusterApprovedMerges,
  sanitizeNumberArray,
  sanitizeObservationOverrides,
} from './projectFileSanitizers';

const sanitizeSavedRunWorkspaceState = (
  value: unknown,
): PersistedSavedRunSnapshot['reopenState'] => {
  if (!isRecord(value) || !isRecord(value.review) || !isRecord(value.review.reportView)) {
    return null;
  }
  const review = value.review;
  const reportView = isRecord(review.reportView) ? review.reportView : {};
  const selection = isRecord(review.selection) ? review.selection : {};
  const comparisonSelection = isRecord(value.comparisonSelection) ? value.comparisonSelection : {};
  const tableRowLimits: Record<string, number> = {};
  if (isRecord(reportView.tableRowLimits)) {
    Object.entries(reportView.tableRowLimits).forEach(([key, rawLimit]) => {
      if (!key.trim() || typeof rawLimit !== 'number' || !Number.isFinite(rawLimit)) return;
      tableRowLimits[key] = Math.max(0, Math.floor(rawLimit));
    });
  }
  const pinnedDetailSections = Array.isArray(reportView.pinnedDetailSections)
    ? reportView.pinnedDetailSections
        .map((entry: unknown) => {
          if (!isRecord(entry)) return null;
          const id = typeof entry.id === 'string' ? entry.id.trim() : '';
          const label = typeof entry.label === 'string' ? entry.label : '';
          if (!id) return null;
          return { id, label };
        })
        .filter(
          (entry: { id: string; label: string } | null): entry is {
            id: string;
            label: string;
          } => entry != null,
        )
    : [];
  const collapsedDetailSections: Record<string, boolean> = {};
  if (isRecord(reportView.collapsedDetailSections)) {
    Object.entries(reportView.collapsedDetailSections).forEach(([key, rawCollapsed]) => {
      if (!key.trim() || typeof rawCollapsed !== 'boolean') return;
      collapsedDetailSections[key] = rawCollapsed;
    });
  }
  const pinnedObservationIds = Array.isArray(review.pinnedObservationIds)
    ? review.pinnedObservationIds.filter(
        (entry): entry is number => typeof entry === 'number' && Number.isFinite(entry),
      )
    : [];
  return {
    activeTab:
      value.activeTab === 'processing-summary' ||
      value.activeTab === 'industry-output' ||
      value.activeTab === 'map'
        ? value.activeTab
        : 'report',
    review: {
      reportView: {
        ellipseMode: reportView.ellipseMode === '95' ? '95' : '1sigma',
        reportFilterQuery:
          typeof reportView.reportFilterQuery === 'string' ? reportView.reportFilterQuery : '',
        reportObservationTypeFilter:
          typeof reportView.reportObservationTypeFilter === 'string'
            ? reportView.reportObservationTypeFilter
            : 'all',
        reportExclusionFilter:
          reportView.reportExclusionFilter === 'included' ||
          reportView.reportExclusionFilter === 'excluded'
            ? reportView.reportExclusionFilter
            : 'all',
        tableRowLimits,
        pinnedDetailSections,
        collapsedDetailSections,
      },
      selection: {
        stationId: typeof selection.stationId === 'string' ? selection.stationId : null,
        observationId:
          typeof selection.observationId === 'number' && Number.isFinite(selection.observationId)
            ? selection.observationId
            : null,
        sourceLine:
          typeof selection.sourceLine === 'number' && Number.isFinite(selection.sourceLine)
            ? selection.sourceLine
            : null,
        origin:
          selection.origin === 'report' ||
          selection.origin === 'map' ||
          selection.origin === 'suspect' ||
          selection.origin === 'compare'
            ? selection.origin
            : null,
      },
      pinnedObservationIds,
    },
    comparisonSelection: {
      baselineRunId:
        typeof comparisonSelection.baselineRunId === 'string'
          ? comparisonSelection.baselineRunId
          : null,
      pinnedBaselineRunId:
        typeof comparisonSelection.pinnedBaselineRunId === 'string'
          ? comparisonSelection.pinnedBaselineRunId
          : null,
      stationMovementThreshold:
        typeof comparisonSelection.stationMovementThreshold === 'number' &&
        Number.isFinite(comparisonSelection.stationMovementThreshold)
          ? comparisonSelection.stationMovementThreshold
          : 0.001,
      residualDeltaThreshold:
        typeof comparisonSelection.residualDeltaThreshold === 'number' &&
        Number.isFinite(comparisonSelection.residualDeltaThreshold)
          ? comparisonSelection.residualDeltaThreshold
          : 0.25,
    },
  };
};

export const sanitizeSavedRunSnapshots = (value: unknown): PersistedSavedRunSnapshot[] => {
  if (!Array.isArray(value)) return [];
  const rows: PersistedSavedRunSnapshot[] = [];
  value.forEach((entry, index) => {
    if (!isRecord(entry) || !isRecord(entry.result)) return;
    const result = entry.result as unknown as AdjustmentResult;
    const summaryFallback = buildRunSnapshotSummary(result);
    const id =
      typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : `saved-run-${index + 1}`;
    const sourceRunId =
      typeof entry.sourceRunId === 'string' && entry.sourceRunId.trim()
        ? entry.sourceRunId.trim()
        : id;
    const createdAt =
      typeof entry.createdAt === 'string' && entry.createdAt.trim()
        ? entry.createdAt.trim()
        : new Date(0).toISOString();
    const savedAt =
      typeof entry.savedAt === 'string' && entry.savedAt.trim() ? entry.savedAt.trim() : createdAt;
    const label =
      typeof entry.label === 'string' && entry.label.trim()
        ? entry.label.trim()
        : `Saved Run ${String(index + 1).padStart(2, '0')}`;
    const notes = typeof entry.notes === 'string' ? entry.notes : '';
    const settingsSnapshot = isRecord(entry.settingsSnapshot)
      ? ({
          ...(entry.settingsSnapshot as PersistedSavedRunSnapshot['settingsSnapshot']),
          precisionReportingMode: 'industry-standard',
          solveProfile: 'industry-parity',
          parseCompatibilityMode: 'strict',
          parseModeMigrated: true,
        } as PersistedSavedRunSnapshot['settingsSnapshot'])
      : ({} as PersistedSavedRunSnapshot['settingsSnapshot']);
    const summarySource = isRecord(entry.summary) ? entry.summary : {};
    rows.push({
      id,
      sourceRunId,
      createdAt,
      savedAt,
      label,
      notes,
      inputFingerprint:
        typeof entry.inputFingerprint === 'string' && entry.inputFingerprint.trim()
          ? entry.inputFingerprint.trim()
          : `legacy:${index + 1}`,
      settingsFingerprint:
        typeof entry.settingsFingerprint === 'string' && entry.settingsFingerprint.trim()
          ? entry.settingsFingerprint.trim()
          : buildValueFingerprint(settingsSnapshot),
      summary: {
        converged:
          typeof summarySource.converged === 'boolean'
            ? summarySource.converged
            : summaryFallback.converged,
        iterations:
          typeof summarySource.iterations === 'number' && Number.isFinite(summarySource.iterations)
            ? summarySource.iterations
            : summaryFallback.iterations,
        seuw:
          typeof summarySource.seuw === 'number' && Number.isFinite(summarySource.seuw)
            ? summarySource.seuw
            : summaryFallback.seuw,
        dof:
          typeof summarySource.dof === 'number' && Number.isFinite(summarySource.dof)
            ? summarySource.dof
            : summaryFallback.dof,
        stationCount:
          typeof summarySource.stationCount === 'number' &&
          Number.isFinite(summarySource.stationCount)
            ? summarySource.stationCount
            : summaryFallback.stationCount,
        observationCount:
          typeof summarySource.observationCount === 'number' &&
          Number.isFinite(summarySource.observationCount)
            ? summarySource.observationCount
            : summaryFallback.observationCount,
        suspectObservationCount:
          typeof summarySource.suspectObservationCount === 'number' &&
          Number.isFinite(summarySource.suspectObservationCount)
            ? summarySource.suspectObservationCount
            : summaryFallback.suspectObservationCount,
        maxAbsStdRes:
          typeof summarySource.maxAbsStdRes === 'number' &&
          Number.isFinite(summarySource.maxAbsStdRes)
            ? summarySource.maxAbsStdRes
            : summaryFallback.maxAbsStdRes,
      },
      result,
      runDiagnostics: (entry.runDiagnostics ?? null) as PersistedSavedRunSnapshot['runDiagnostics'],
      settingsSnapshot,
      excludedIds: sanitizeNumberArray(entry.excludedIds).sort((a, b) => a - b),
      activePreanalysisAdditionIds: Array.isArray(entry.activePreanalysisAdditionIds)
        ? entry.activePreanalysisAdditionIds
            .filter(
              (value): value is string => typeof value === 'string' && value.trim().length > 0,
            )
            .map((value) => value.trim())
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        : [],
      overrideIds: sanitizeNumberArray(entry.overrideIds).sort((a, b) => a - b),
      overrides: sanitizeObservationOverrides(entry.overrides),
      approvedClusterMerges: sanitizeClusterApprovedMerges(entry.approvedClusterMerges),
      reopenState: sanitizeSavedRunWorkspaceState(entry.reopenState),
    });
  });
  return cloneSavedRunSnapshots(rows);
};
