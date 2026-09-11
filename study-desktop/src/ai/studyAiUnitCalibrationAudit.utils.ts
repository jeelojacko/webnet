/**
 * Small pure helpers shared by the calibration-80 audit: deterministic
 * counting, sourceCoverage/evidence anomaly flags and the risk category
 * classifier used by the human-review ordering. No IO, no wall clock.
 */
import type { AiStudyUnitProposal } from './studyAiTypes';
import type {
  CountTable,
  JobAuditRecord,
  RiskCategory,
  RiskCategoryIndex,
} from './studyAiUnitCalibrationAudit.types';

export const byJobId = (left: { jobId: string }, right: { jobId: string }): number =>
  left.jobId < right.jobId ? -1 : left.jobId > right.jobId ? 1 : 0;

export const countBy = (values: Array<string | number | null | undefined>): CountTable => {
  const counts: CountTable = {};
  for (const value of values) {
    const key = value === null || value === undefined ? 'null' : String(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
};

export const sortedUnique = (values: Iterable<string>): string[] =>
  Array.from(new Set(values)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/* ------------------------------------------------------------------ *
 * Source coverage / evidence anomaly flags                           *
 * ------------------------------------------------------------------ */

/**
 * Deterministic coverage/evidence anomaly flags used by risk category 9.
 * Rules (documented in the audit .md):
 *  - `coverage-over-6`: more than 6 child labels marked covered.
 *  - `coverage-under-3`: the approved focus declares ≥3 child labels but
 *    fewer than 3 are marked covered in sourceCoverage.
 *  - `objective-without-evidence`: any objective carries zero evidence rows.
 *  - `coverage-objectives-unlinked`: covered children never reference an
 *    objective id while the unit has ≥2 objectives.
 */
export const coverageFlagsOf = (proposal: AiStudyUnitProposal | undefined): string[] => {
  if (proposal === undefined) return [];
  const flags: string[] = [];
  const coverage = proposal.sourceCoverage ?? [];
  const children = coverage.flatMap((entry) => entry.childLabels ?? []);
  const covered = children.filter((child) => child.status === 'covered');
  if (covered.length > 6) flags.push('coverage-over-6');
  const approvedLabels = (proposal.approvedGroup?.focusSelections ?? []).flatMap(
    (selection) => selection.childLabels ?? [],
  );
  if (approvedLabels.length >= 3 && covered.length < 3) flags.push('coverage-under-3');
  const objectives = proposal.objectives ?? [];
  if (objectives.some((objective) => (objective.evidence ?? []).length === 0))
    flags.push('objective-without-evidence');
  const referenced = new Set(
    covered.flatMap((child) => child.objectiveIds ?? []),
  );
  if (covered.length > 0 && objectives.length >= 2 && referenced.size === 0)
    flags.push('coverage-objectives-unlinked');
  return flags.sort();
};

/* ------------------------------------------------------------------ *
 * Risk ordering                                                      *
 * ------------------------------------------------------------------ */

export const RISK_CATEGORY_LABELS = [
  'invalid or semantic-failed',
  'needs-map-revision',
  'warning-bearing or failed attempts',
  'final-QC correction unit',
  'regression anchor',
  'retry-history unit',
  '7+ objectives',
  'broad/focus outlier',
  'evidence/coverage anomaly',
  'remainder',
] as const;

const categoryAt = (index: RiskCategoryIndex): RiskCategory => ({
  index,
  label: RISK_CATEGORY_LABELS[index - 1],
});

/**
 * Deterministic risk classification; the first (lowest-numbered) matching
 * category wins, so each job appears exactly once at its highest-risk
 * category. Category list is the human-review ordering:
 *  1. invalid / semantic-failed (no accepted result, or accepted but the
 *     canonical revalidation has error issues)
 *  2. needs-map-revision (accepted proposal authoringStatus)
 *  3. warning-bearing (MAP_GROUP_TOO_BROAD / OUTSIDE_APPROVED_FOCUS) or with
 *     failed attempts in this run
 *  4. final-QC correction unit (selection correction flag)
 *  5. regression anchor (selection regression flag / anchor target list)
 *  6. retry-history unit (selection retry flag / retry target list)
 *  7. 7+ objectives
 *  8. broad/focus outlier (broad-group-risk tag, focus-none, or many focus
 *     child labels ≥6)
 *  9. evidence/coverage anomaly (coverage flags above)
 * 10. remainder
 */
export const riskCategoryFor = (
  record: JobAuditRecord,
  opts: { inAnchorTargets: boolean; inRetryTargets: boolean },
): RiskCategory => {
  if (record.status !== 'accepted' || record.validation.errorCount > 0)
    return categoryAt(1);
  if (record.authoringStatus === 'needs-map-revision') return categoryAt(2);
  const warningBearing = record.proposalWarnings.some(
    (code) =>
      code === 'MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT' ||
      code === 'OUTSIDE_APPROVED_FOCUS',
  );
  if (warningBearing || record.rejectedSemanticAttempts > 0) return categoryAt(3);
  if (record.selection.correction) return categoryAt(4);
  if (record.selection.regression || opts.inAnchorTargets) return categoryAt(5);
  if (record.selection.retry || opts.inRetryTargets) return categoryAt(6);
  if (record.objectiveCount >= 7) return categoryAt(7);
  const tags = record.selection.tags;
  if (tags.includes('broad-group-risk')) return categoryAt(8);
  if (record.focusStyle === 'none' || tags.includes('focus-none')) return categoryAt(8);
  const childLabelCount = (record.result?.approvedGroup?.focusSelections ?? []).reduce(
    (total, selection) => total + (selection.childLabels?.length ?? 0),
    0,
  );
  if (childLabelCount >= 6) return categoryAt(8);
  if (record.coverageFlags.length > 0) return categoryAt(9);
  return categoryAt(10);
};

/** Human-readable reason explaining why a record landed in its category. */
export const riskReasonFor = (
  record: JobAuditRecord,
  category: RiskCategory,
): string => {
  switch (category.index) {
    case 1:
      if (record.status === 'accepted') return `validator errors: ${record.validation.issueCodes.join(', ') || 'revalidation failed'}`;
      if (record.status === 'semantic-failed') return 'no accepted result after semantic attempts';
      if (record.status === 'provider-incomplete') return 'run ended before an accepted result (provider interruption)';
      return 'no accepted result and no failure artifacts (unattempted?)';
    case 2:
      return 'authoringStatus needs-map-revision';
    case 3: {
      const reasons: string[] = [];
      if (record.proposalWarnings.length > 0) reasons.push(`warnings: ${record.proposalWarnings.join(', ')}`);
      if (record.rejectedSemanticAttempts > 0) reasons.push(`${record.rejectedSemanticAttempts} rejected attempt(s)`);
      return reasons.join('; ') || 'warning-bearing';
    }
    case 4:
      return 'final-QC correction unit (selection correction flag)';
    case 5:
      return 'regression anchor (selection regression flag / anchor target)';
    case 6:
      return 'retry-history unit (selection retry flag / retry target)';
    case 7:
      return `${record.objectiveCount} objectives`;
    case 8: {
      if (record.selection.tags.includes('broad-group-risk')) return 'broad-group-risk tag';
      if (record.focusStyle === 'none') return 'focus-none';
      return 'many focus child labels';
    }
    case 9:
      return `coverage flags: ${record.coverageFlags.join(', ')}`;
    default:
      return 'remainder';
  }
};
