/**
 * Deterministic Markdown renderers for the two V4/V5 calibration comparison
 * artifacts (WV5): the machine comparison companion and the 80-row
 * side-by-side human review. Pure functions of the documents built by
 * `buildCompareDocs`; no IO, no wall clock, no RNG. Stable ordering follows
 * the documents (crosswalk seq / risk tier then seq).
 */
import type {
  AnchorComparisonRow,
  CompareHumanReviewDoc,
  ComparisonDoc,
  NamedSubsetRows,
  OcrCaseSection,
  QuestionLengthStats,
} from './studyAiUnitCalibrationCompare.types';
import { COMPARE_TIER_LABELS, OCR_TARGET_STRINGS } from './studyAiUnitCalibrationCompare.types';

const md = (lines: MdTree[]): string => {
  const out: string[] = [];
  const flatten = (value: MdTree): void => {
    if (typeof value === 'string') out.push(value);
    else value.forEach(flatten);
  };
  lines.forEach(flatten);
  return `${out.join('\n')}\n`;
};

type MdTree = string | MdTree[];

const tableRow = (cells: Array<string | number>): string =>
  `| ${cells.map(String).join(' | ')} |`;

const clip = (value: string, limit: number): string =>
  value.length <= limit ? value : `${value.slice(0, limit)}…`;

const statusCell = (status: string | null): string => status ?? 'no-accepted-result';

const warningCell = (warnings: string[]): string =>
  warnings.length === 0 ? '—' : warnings.join(', ');

/* ------------------------------------------------------------------ *
 * comparison .md                                                    *
 * ------------------------------------------------------------------ */

const renderPerRunBlock = (doc: ComparisonDoc): MdTree[] => {
  const lines: Array<string | string[]> = ['## Per-run outcomes', ''];
  for (const [key, run] of [
    ['v4', doc.perRun.v4],
    ['v5', doc.perRun.v5],
  ] as const) {
    lines.push(
      `### ${key} — ${run.runId}`,
      '',
      `model ${run.model} · endpoint \`${run.endpoint}\` · concurrency ${run.concurrency}`,
      `prompt spec \`${run.promptSpecVersion}\` · spec sha256 \`${run.specSha256}\``,
      '',
      tableRow(['status', 'jobs']),
      tableRow(['---', '---:']),
      tableRow(['accepted', run.accepted]),
      tableRow(['semantic-failed', run.semanticFailed]),
      tableRow(['provider-incomplete', run.providerIncomplete]),
      tableRow(['nothing', run.nothing]),
      tableRow(['jobs total', run.jobsTotal]),
      '',
      `rejected attempt files: ${run.totalRejectedAttemptFiles} (semantic ${run.rejectedSemanticAttempts} / provider ${run.providerAttempts})`,
      run.worstRetryJob === null
        ? 'worst retry job: none'
        : `worst retry job: \`${run.worstRetryJob.jobId}\` (${run.worstRetryJob.rejectedAttemptFiles} rejected attempt files)`,
      '',
    );
  }
  return lines;
};

const renderMatrixBlock = (doc: ComparisonDoc): MdTree[] => {
  const matrix = doc.statusTransitionMatrix;
  const lines: Array<string | string[]> = ['## Status transition matrix (v4 row → v5 column)', ''];
  lines.push(tableRow(['v4 \\ v5', ...matrix.v5Statuses, 'total']));
  lines.push(tableRow(['---', ...matrix.v5Statuses.map(() => '---:'), '---:']));
  for (const v4Status of matrix.v4Statuses) {
    const byV5 = matrix.counts[v4Status];
    const total = matrix.v5Statuses.reduce((sum, v5Status) => sum + (byV5[v5Status] ?? 0), 0);
    lines.push(tableRow([v4Status, ...matrix.v5Statuses.map((v5Status) => byV5[v5Status] ?? 0), total]));
  }
  lines.push('', `total rows: ${matrix.total}`, '');
  return lines;
};

const renderRevisionBlock = (doc: ComparisonDoc): MdTree[] => {
  const lines: Array<string | string[]> = ['## V5 revision consistency (target: all zero)', ''];
  const flags: Array<keyof ComparisonDoc['revisionConsistencyV5']> = [
    'generatedWithBroadWarning',
    'generatedWithSuggestion',
    'needsRevisionWithoutBroadWarning',
    'needsRevisionWithoutSuggestion',
    'needsRevisionWithContradictoryReason',
  ];
  const nonzero = flags.filter((flag) => doc.revisionConsistencyV5[flag].count > 0);
  if (nonzero.length === 0) {
    lines.push('_All five V5 revision-consistency buckets are zero._', '');
    return lines;
  }
  lines.push(tableRow(['bucket', 'count', 'v5 jobIds']));
  lines.push(tableRow(['---', '---:', '---']));
  for (const flag of flags) {
    const bucket = doc.revisionConsistencyV5[flag];
    if (bucket.count === 0) continue;
    lines.push(tableRow([flag, bucket.count, bucket.jobIds.map((id) => `\`${id}\``).join(', ')]));
  }
  lines.push('');
  return lines;
};

const renderWarningsBlock = (doc: ComparisonDoc): MdTree[] => {
  const warnings = doc.warnings;
  const lines: Array<string | string[]> = [
    '## Warning histogram (canonical-validation warning codes)',
    '',
    tableRow(['code', 'v4', 'v5']),
    tableRow(['---', '---:', '---:']),
  ];
  for (const code of warnings.codes) {
    lines.push(tableRow([code, warnings.v4[code] ?? 0, warnings.v5[code] ?? 0]));
  }
  lines.push(
    tableRow(['total', warnings.v4Total, warnings.v5Total]),
    '',
    'V4 coverage-warning audit reconciliation:',
    `- expected: APPROVED_FOCUS_NOT_COVERED ${warnings.v4CoverageReconciliation.expected.APPROVED_FOCUS_NOT_COVERED} / UNCOVERED_SUBSTANTIVE_SOURCE ${warnings.v4CoverageReconciliation.expected.UNCOVERED_SUBSTANTIVE_SOURCE} (total ${warnings.v4CoverageReconciliation.expected.total})`,
    `- recomputed: APPROVED_FOCUS_NOT_COVERED ${warnings.v4CoverageReconciliation.recomputed.APPROVED_FOCUS_NOT_COVERED} / UNCOVERED_SUBSTANTIVE_SOURCE ${warnings.v4CoverageReconciliation.recomputed.UNCOVERED_SUBSTANTIVE_SOURCE} (total ${warnings.v4CoverageReconciliation.recomputed.total})`,
    `- matched: ${warnings.v4CoverageReconciliation.matched}`,
    '',
  );
  return lines;
};

const questionStatsRow = (label: string, stats: QuestionLengthStats): string[] => [
  label,
  String(stats.count),
  String(stats.meanLengthChars),
  String(stats.overMain180),
  String(stats.overMain240),
  String(stats.overGuided160),
  String(stats.overGuided220),
];

const renderQuestionsBlock = (doc: ComparisonDoc): MdTree[] => {
  const lines: Array<string | string[]> = [
    '## Question lengths (chars)',
    '',
    tableRow(['run', 'main n', 'main mean', 'main >180', 'main >240', 'guided >160', 'guided >220']),
    tableRow(['---', '---:', '---:', '---:', '---:', '---:', '---:']),
    questionStatsRow('v4', doc.questions.v4),
    questionStatsRow('v5', doc.questions.v5),
    '',
  ];
  return lines;
};

const renderObjectivesBlock = (doc: ComparisonDoc): MdTree[] => {
  const keys = Array.from(
    new Set([...Object.keys(doc.objectives.v4), ...Object.keys(doc.objectives.v5)]),
  ).sort((a, b) => Number(a) - Number(b) || (a < b ? -1 : 1));
  const lines: Array<string | string[]> = [
    '## Objective-count histogram (accepted proposals)',
    '',
    tableRow(['objectives', 'v4', 'v5']),
    tableRow(['---', '---:', '---:']),
  ];
  for (const key of keys) {
    lines.push(tableRow([key, doc.objectives.v4[key] ?? 0, doc.objectives.v5[key] ?? 0]));
  }
  lines.push('');
  return lines;
};

const anchorRow = (anchor: AnchorComparisonRow): string[] => [
  String(anchor.seq),
  `\`${anchor.v4JobId}\` → \`${anchor.v5JobId}\``,
  statusCell(anchor.v4Status),
  statusCell(anchor.v5Status),
  warningCell(anchor.v4Warnings),
  warningCell(anchor.v5Warnings),
  anchor.verdict,
];

const renderAnchorsBlock = (doc: ComparisonDoc): MdTree[] => {
  const lines: Array<string | string[]> = [
    '## Regression anchors (7)',
    '',
    tableRow(['seq', 'v4JobId → v5JobId', 'v4 status', 'v5 status', 'v4 warnings', 'v5 warnings', 'verdict']),
    tableRow(['---', '---', '---', '---', '---', '---', '---']),
  ];
  for (const anchor of doc.anchors) lines.push(tableRow(anchorRow(anchor)));
  lines.push('');
  return lines;
};

const ocrLine = (label: string, presence: OcrCaseSection['byLaws']): string[] => [
  `- \`${label}\` in v4 job exactSourceText: ${presence.v4JobExactSourceText} · v4 evidence union: ${presence.v4EvidenceUnion} · v5 evidence union: ${presence.v5EvidenceUnion}` +
    (presence.v5ObjectiveIds.length > 0
      ? ` · v5 objective ids: ${presence.v5ObjectiveIds.join(', ')}`
      : ''),
];

const renderOcrBlock = (doc: ComparisonDoc): MdTree[] => {
  const ocr = doc.ocrCase;
  const [byLaws, registrar] = OCR_TARGET_STRINGS;
  const lines: Array<string | string[]> = [
    '## OCR case — Land Surveyors Act s.18(2) cohort job',
    '',
    `crosswalk seq ${ocr.seq} · v4 \`${ocr.v4JobId}\` → v5 \`${ocr.v5JobId}\``,
    `group: ${ocr.groupId} · title: ${ocr.titleSuggestion}`,
    ...ocrLine(byLaws, ocr.byLaws),
    ...ocrLine(registrar, ocr.registrar),
    '',
  ];
  return lines;
};

const renderNamedSubsetsBlock = (doc: ComparisonDoc): MdTree[] => {
  const lines: Array<string | string[]> = ['## Named subsets (v4→v5 status pairs)', ''];
  const subsets: Array<[string, NamedSubsetRows]> = [
    ['final-qc-20', doc.namedSubsets.finalQc20],
    ['anchors-7', doc.namedSubsets.anchors7],
    ['retry-9', doc.namedSubsets.retry9],
    ['repealed-mix-16', doc.namedSubsets.repealedMix16],
  ];
  for (const [name, subset] of subsets) {
    lines.push(`### ${name} (${subset.count})`, '');
    if (subset.rows.length === 0) {
      lines.push('_no rows_', '');
      continue;
    }
    const transitions: Record<string, number> = {};
    for (const row of subset.rows) {
      const key = `${statusCell(row.v4Status)} → ${statusCell(row.v5Status)}`;
      transitions[key] = (transitions[key] ?? 0) + 1;
    }
    lines.push(
      tableRow(['seq', 'v4JobId', 'v5JobId', 'v4 status', 'v5 status']),
      tableRow(['---', '---', '---', '---', '---']),
    );
    for (const row of subset.rows) {
      lines.push(
        tableRow([
          row.seq,
          `\`${row.v4JobId}\``,
          `\`${row.v5JobId}\``,
          statusCell(row.v4Status),
          statusCell(row.v5Status),
        ]),
      );
    }
    lines.push(
      '',
      `transitions: ${Object.entries(transitions)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([transition, count]) => `${transition} ${count}`)
        .join(' · ')}`,
      '',
    );
  }
  return lines;
};

export const renderComparisonMarkdown = (doc: ComparisonDoc): string =>
  md([
    `# Unit calibration V4 → V5 comparison — ${doc.dateTag}`,
    '',
    `V4 run: \`${doc.perRun.v4.runId}\` · V5 run: \`${doc.perRun.v5.runId}\` · generated at \`${doc.generatedAt}\``,
    `cohort: ${doc.cohortSize} jobs matched by crosswalk seq (crosswalk sha256 ${doc.crosswalkSha256 ?? 'n/a'})`,
    `spec sha256 — v4 \`${doc.specShas.v4 ?? 'n/a'}\` · v5 \`${doc.specShas.v5 ?? 'n/a'}\``,
    '',
    renderPerRunBlock(doc),
    renderMatrixBlock(doc),
    renderRevisionBlock(doc),
    renderWarningsBlock(doc),
    renderQuestionsBlock(doc),
    renderObjectivesBlock(doc),
    renderAnchorsBlock(doc),
    renderOcrBlock(doc),
    renderNamedSubsetsBlock(doc),
  ]);

/* ------------------------------------------------------------------ *
 * human review .md                                                  *
 * ------------------------------------------------------------------ */

const reviewSummaryLines = (doc: CompareHumanReviewDoc): MdTree[] => {
  const s = doc.summary;
  const lines: Array<string | string[]> = [
    '## Summary',
    '',
    'Status transitions (v4 → v5): ' +
      Object.entries(s.statusTransitions)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([transition, count]) => `${transition} ${count}`)
        .join(' · '),
    '',
    `V5 revision-consistency buckets (target zero): ${Object.entries(s.revisionConsistency)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([flag, count]) => `${flag} ${count}`)
      .join(' · ')}`,
    '',
    `OCR artifacts present — v4 job exactSourceText: ${s.ocrCase.v4JobExactSourceText} · v4 evidence union: ${s.ocrCase.v4EvidenceUnion} · v5 evidence union: ${s.ocrCase.v5EvidenceUnion}`,
    '',
    `Tier counts: ${Object.entries(s.tierCounts)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([tier, count]) => `T${tier} ${count}`)
      .join(' · ')}`,
    '',
  ];
  return lines;
};

const reviewRow = (row: CompareHumanReviewDoc['rows'][number]): string[] => [
  String(row.seq),
  `\`${row.v4JobId}\``,
  `\`${row.v5JobId}\``,
  row.documentIds.join(', '),
  row.frozenMapPriority,
  `${statusCell(row.v4.authoringStatus)} → ${statusCell(row.v5.authoringStatus)}`,
  `${row.v4.warnings.length}/${row.v5.warnings.length}`,
  `${row.v4.attemptCount}/${row.v5.attemptCount}`,
  clip(row.titleSuggestion, 56),
];

const renderTierSection = (
  doc: CompareHumanReviewDoc,
  tier: 1 | 2 | 3 | 4 | 5 | 6,
): MdTree[] => {
  const rows = doc.rows.filter((row) => row.tier === tier);
  const lines: Array<string | string[]> = [
    `## Tier ${tier} — ${COMPARE_TIER_LABELS[tier]} (${rows.length})`,
    '',
  ];
  if (rows.length === 0) {
    lines.push('_no rows_', '');
    return lines;
  }
  lines.push(
    tableRow(['seq', 'v4JobId', 'v5JobId', 'docs', 'P', 'v4 → v5 status', 'warn v4/v5', 'att v4/v5', 'title']),
    tableRow(['---', '---', '---', '---', '---', '---', '---:', '---:', '---']),
  );
  for (const row of rows) lines.push(tableRow(reviewRow(row)));
  lines.push('');
  for (const row of rows) {
    const mainV4 = row.v4.mainQuestion ? clip(row.v4.mainQuestion, 200) : null;
    const mainV5 = row.v5.mainQuestion ? clip(row.v5.mainQuestion, 200) : null;
    lines.push(
      `### T${row.tier} · seq ${row.seq} — ${row.titleSuggestion}`,
      '',
      `v4 \`${row.v4JobId}\` → v5 \`${row.v5JobId}\` · docs ${row.documentIds.join(', ')} · P ${row.frozenMapPriority}`,
      `v4: ${row.v4.outcome} · authoringStatus ${statusCell(row.v4.authoringStatus)} · warnings ${warningCell(row.v4.warnings)} · objectives ${row.v4.objectiveCount} · attempts ${row.v4.attemptCount}`,
      `v5: ${row.v5.outcome} · authoringStatus ${statusCell(row.v5.authoringStatus)} · warnings ${warningCell(row.v5.warnings)} · objectives ${row.v5.objectiveCount} · attempts ${row.v5.attemptCount}`,
    );
    if (mainV4 !== null) lines.push(`v4 main question: ${mainV4}`);
    if (mainV5 !== null) lines.push(`v5 main question: ${mainV5}`);
    if (row.v5.validationIssues.length > 0) {
      lines.push(
        `v5 validation: ${row.v5.validationIssues
          .map((issue) => `${issue.severity}:${issue.code}`)
          .join(', ')}`,
      );
    } else {
      lines.push('v5 validation: none');
    }
    if (row.v5.mapRevisionSuggestion !== null) {
      const suggestion = row.v5.mapRevisionSuggestion;
      lines.push(
        `v5 map revision: ${suggestion.reason}`,
        `v5 proposed groups: ${suggestion.proposedGroupTitles.join(' | ')}`,
      );
    }
    lines.push('');
  }
  return lines;
};

export const renderCompareHumanReviewMarkdown = (doc: CompareHumanReviewDoc): string =>
  md([
    `# Calibration V4/V5 Human Review — ${doc.dateTag}`,
    '',
    `V4 run: \`${doc.v4RunId}\` · V5 run: \`${doc.v5RunId}\` · ${doc.cohortSize} jobs · generated at \`${doc.generatedAt}\``,
    '',
    'Risk-ordered deterministic review. Tiers (first match wins; ties by crosswalk seq):',
    '1. v5-failure (no accepted V5 result / provider-incomplete)',
    '2. v5-needs-revision (V5 authoringStatus needs-map-revision)',
    '3. status-change (V4 and V5 authoringStatus differ)',
    '4. warning-heavy (V5 warning count ≥ 3, or ≥ V4 + 2)',
    '5. named (anchors / final-QC / retry / repealed-mix subset member)',
    '6. remainder',
    '',
    reviewSummaryLines(doc),
    renderTierSection(doc, 1),
    renderTierSection(doc, 2),
    renderTierSection(doc, 3),
    renderTierSection(doc, 4),
    renderTierSection(doc, 5),
    renderTierSection(doc, 6),
  ]);
