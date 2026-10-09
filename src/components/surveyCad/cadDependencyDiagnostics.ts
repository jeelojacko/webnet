/**
 * STRUCT-194.1 — pure drawing-dependency diagnostics extracted from
 * SurveyCadWorkspace.
 *
 * No React, no DOM, no stores: the same pure engine evaluation the workspace
 * already used, split out so the root keeps only the memo that supplies the
 * stable inputs. The chip wording (cause words, action hint, status label,
 * punctuation) is preserved exactly.
 */
import {
  summarizeDrawingDependency,
  type CadDependencyReasonCode,
  type DrawingDependencySummary,
} from '../../engine/cad/cadAdjustmentDependency';
import {
  buildDraftLabelEntityStatusMap,
  evaluateDraftLabelDependencies,
  hasStaleDerivedDraftLabel,
} from '../../engine/cad/cadDraftLabelDependency';
import type { CadDrawingDocument } from '../../engine/cad/cadTypes';
import type { ResultDependencyIdentity } from '../../engine/resultIntegrity';

/** Phase 17E: first reason code in words for the dependency status chip. */
export const DEPENDENCY_CAUSE_WORDS: Record<CadDependencyReasonCode, string> = {
  CAD_CURRENT: 'dependencies current',
  CAD_NO_DEPENDENCY: 'manual only',
  CAD_SOURCE_RESULT_STALE: 'result stale',
  CAD_SOURCE_RESULT_REPLACED: 'result replaced',
  CAD_SOURCE_STATION_MISSING: 'linked stations missing',
  CAD_LEGACY_DEPENDENCY_UNKNOWN: 'unstamped legacy entities',
  CAD_PARCEL_METRICS_STALE: 'parcel metrics changed',
  CAD_F2F_SYNC_INCOMPLETE: 'field-to-finish sync incomplete',
  CAD_DERIVED_LABEL_STALE: 'derived annotations stale',
  CAD_OWNER_CONFLICT: 'conflicting ownership',
};

/** Phase 17E: action hint for the dependency status chip. */
export const DEPENDENCY_ACTION_HINT: Record<CadDependencyReasonCode, string> = {
  CAD_CURRENT: '',
  CAD_NO_DEPENDENCY: '',
  CAD_SOURCE_RESULT_STALE: 'Refresh adjusted points',
  CAD_SOURCE_RESULT_REPLACED: 'Refresh adjusted points',
  CAD_SOURCE_STATION_MISSING: 'Refresh adjusted points',
  CAD_LEGACY_DEPENDENCY_UNKNOWN: 'Review parcel',
  CAD_PARCEL_METRICS_STALE: 'Review parcel',
  CAD_F2F_SYNC_INCOMPLETE: 'Sync linked F2F',
  CAD_DERIVED_LABEL_STALE: 'Refresh derived annotations',
  CAD_OWNER_CONFLICT: 'Review parcel',
};

const FALLBACK_REASON: CadDependencyReasonCode = 'CAD_OWNER_CONFLICT';

export interface DrawingDependencyInputs {
  stationIds: Set<string>;
  f2fLinkStatus?: string;
  f2fLinkSourceKind?: string;
}

/**
 * Full drawing dependency summary: engine entity evaluation plus the
 * draft-label augmentation (a stale derived label promotes an otherwise
 * non-stale summary to STALE and appends CAD_DERIVED_LABEL_STALE).
 */
export const summarizeActiveDrawingDependency = (
  drawing: CadDrawingDocument,
  current: ResultDependencyIdentity | null,
  inputs: DrawingDependencyInputs,
): DrawingDependencySummary => {
  const summary = summarizeDrawingDependency(drawing.project, current, {
    stationIds: inputs.stationIds,
    f2fLinkStatus: inputs.f2fLinkStatus,
    f2fLinkSourceKind: inputs.f2fLinkSourceKind,
  });
  if (summary.status === 'STALE') return summary;
  const labels = drawing.draft?.labels ?? [];
  if (labels.length === 0) return summary;
  const statusMap = buildDraftLabelEntityStatusMap(drawing.project.entities, current, {
    stationIds: inputs.stationIds,
    f2fLinkStatus: inputs.f2fLinkStatus,
    f2fLinkSourceKind: inputs.f2fLinkSourceKind,
  });
  if (!hasStaleDerivedDraftLabel(evaluateDraftLabelDependencies(labels, statusMap))) return summary;
  return {
    ...summary,
    status: 'STALE',
    reasons: summary.reasons.includes('CAD_DERIVED_LABEL_STALE')
      ? summary.reasons
      : [...summary.reasons, 'CAD_DERIVED_LABEL_STALE'],
  };
};

/** First cause phrase for the summary's leading reason. */
export const getDependencyCause = (summary: DrawingDependencySummary): string =>
  DEPENDENCY_CAUSE_WORDS[summary.reasons[0] ?? FALLBACK_REASON];

/** Action hint, or null for a current/manual-only drawing. */
export const getDependencyAction = (summary: DrawingDependencySummary): string | null =>
  summary.status === 'CURRENT' || summary.status === 'MANUAL_ONLY'
    ? null
    : DEPENDENCY_ACTION_HINT[summary.reasons[0] ?? FALLBACK_REASON];

/** Chip status label; MANUAL_ONLY renders as MANUAL-ONLY. */
export const formatDependencyStatusLabel = (summary: DrawingDependencySummary): string =>
  summary.status === 'MANUAL_ONLY' ? 'MANUAL-ONLY' : summary.status;

/**
 * Exact chip text, including the leading `CAD status:` prefix, the em-dash
 * separator, and the trailing action sentence when present.
 */
export const formatDependencyChipText = (summary: DrawingDependencySummary): string => {
  const cause = getDependencyCause(summary);
  if (summary.status === 'CURRENT' || summary.status === 'MANUAL_ONLY') {
    return `CAD status: ${formatDependencyStatusLabel(summary)} — ${cause}.`;
  }
  const action = getDependencyAction(summary);
  return `CAD status: ${formatDependencyStatusLabel(summary)} — ${cause}.${action ? ` ${action}.` : ''}`;
};
