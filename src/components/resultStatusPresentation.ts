import type { ResultIntegrityState } from '../engine/resultIntegrity';

export type RunStatusTone = 'success' | 'planning' | 'failure' | 'muted';

export interface ResultIntegrityBadge {
  label: string;
  tone: RunStatusTone;
}

/**
 * Compact toolbar badge. Shares the tone vocabulary with
 * `adjustmentSummaryStatus` so the global badge and the report Adjustment
 * Summary cannot contradict: a completed non-deliverable run
 * (preanalysis/data-check/blunder-detect) reads as planning-only in both,
 * never as a green deliverable success and never as a failed solve.
 */
export const resultIntegrityBadge = (state: ResultIntegrityState): ResultIntegrityBadge => {
  switch (state) {
    case 'FRESH_SUCCESS':
      return { label: '● Current', tone: 'success' };
    case 'FRESH_NOT_DELIVERABLE_MODE':
      return { label: '◐ Planning only', tone: 'planning' };
    case 'FRESH_FAILED':
      return { label: '✖ Run failed', tone: 'failure' };
    case 'STALE_SUCCESS':
    case 'STALE_FAILED':
      return { label: '▲ Stale — re-run', tone: 'planning' };
    case 'NO_RESULT':
    default:
      return { label: '○ No result', tone: 'muted' };
  }
};

export interface AdjustmentSummaryStatus {
  label: string;
  secondary: string | null;
  tone: RunStatusTone;
}

/**
 * Report Adjustment Summary STATUS card. Preanalysis is the only
 * non-deliverable mode that reaches this section (data-check and
 * blunder-detect render their own summary sections), so a successful
 * preanalysis solve is presented as a completed planning run — amber
 * "PRE-ANALYSIS COMPLETE / PLANNING ONLY", never green CONVERGED and never a
 * failure. Any unsuccessful result stays a failure.
 */
export const adjustmentSummaryStatus = (params: {
  success: boolean;
  preanalysisMode: boolean;
}): AdjustmentSummaryStatus => {
  if (params.preanalysisMode && params.success) {
    return { label: 'PRE-ANALYSIS COMPLETE', secondary: 'PLANNING ONLY', tone: 'planning' };
  }
  if (params.success) {
    return { label: 'CONVERGED', secondary: null, tone: 'success' };
  }
  return { label: 'NOT CONVERGED / WARNING', secondary: null, tone: 'failure' };
};
