/**
 * Deterministic Markdown renderers for the four calibration-80 audit
 * artifacts. Pure functions of the machine documents built by
 * `buildAuditDocs`; no IO, no wall clock, no RNG. All ordering follows the
 * documents (jobId-stable / risk-ordered).
 */
import type {
  AuditBundle,
  AuditDoc,
  FinalQcDoc,
  JobAuditRecord,
  RegressionAnchorsDoc,
  ReviewDoc,
  ReviewUnitEntry,
} from './studyAiUnitCalibrationAudit.types';
import { RISK_CATEGORY_LABELS } from './studyAiUnitCalibrationAudit.utils';

type MdLine = string | string[] | MdLine[];

const md = (lines: MdLine[]): string => {
  const out: string[] = [];
  const flatten = (value: MdLine): void => {
    if (typeof value === 'string') out.push(value);
    else value.forEach(flatten);
  };
  lines.forEach(flatten);
  return `${out.join('\n')}\n`;
};

const tableRow = (cells: Array<string | number>): string =>
  `| ${cells.map(String).join(' | ')} |`;

const clip = (value: string, limit: number): string =>
  value.length <= limit ? value : `${value.slice(0, limit)}…`;

const countTable = (counts: Record<string, number>): string[] =>
  Object.entries(counts)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `- \`${key}\`: ${value}`);

/* ------------------------------------------------------------------ *
 * result-audit .md                                                   *
 * ------------------------------------------------------------------ */

export const renderAuditMarkdown = (audit: AuditDoc): string => {
  const c = audit.completion;
  const lines: Array<string | string[]> = [
    `# Calibration-80 Result Audit — ${audit.dateTag}`,
    '',
    `Run: \`${audit.runId}\` · prompt spec \`${audit.promptSpecVersion}\` · generated at \`${audit.generatedAt}\``,
    `Selection report: \`${audit.inputs.selectionReportPath}\``,
    '',
    '## Completion',
    '',
    tableRow(['status', 'jobs']),
    tableRow(['---', '---:']),
    tableRow(['expected', c.expected]),
    tableRow(['accepted', c.accepted]),
    tableRow(['semantic-failed', c.semanticFailed]),
    tableRow(['provider-incomplete', c.providerIncomplete]),
    tableRow(['nothing', c.nothing]),
    '',
    '### Per batch',
    '',
    tableRow(['batch', 'expected', 'accepted', 'semantic-failed', 'provider-incomplete', 'nothing']),
    tableRow(['---', '---:', '---:', '---:', '---:', '---:']),
    ...c.perBatch.map((row) =>
      tableRow([
        row.batch,
        row.expected,
        row.accepted,
        row.semanticFailed,
        row.providerIncomplete,
        row.nothing,
      ]),
    ),
    '',
    '## Priority gap reconciliation (selected = accepted + failed + incomplete + nothing)',
    '',
    tableRow(['priority', 'target', 'selected', 'accepted', 'semantic-failed', 'provider-incomplete', 'nothing', 'gap']),
    tableRow(['---', '---:', '---:', '---:', '---:', '---:', '---:', '---:']),
    ...audit.gap.priority.rows.map((row) =>
      tableRow([
        row.priority,
        row.target,
        row.selected,
        row.accepted,
        row.semanticFailed,
        row.providerIncomplete,
        row.nothing,
        row.gap,
      ]),
    ),
    '',
    `Gap exact: **${audit.gap.priority.exact ? 'yes' : 'no'}**`,
    '',
    `> ${audit.gap.priority.note}`,
  ];

  lines.push(
    '',
    '## Audit errors',
    '',
    audit.auditErrors.length === 0
      ? ['- none']
      : audit.auditErrors.map(
          (error) => `- \`${error.code}\`${error.jobId ? ` ${error.jobId}` : ''}: ${error.message}`,
        ),
  );

  lines.push(
    '',
    '## Findings (counted; expected data unless flagged)',
    '',
    audit.auditFindings.length === 0
      ? ['- none']
      : audit.auditFindings.flatMap((finding) => [
          `- **${finding.code}**: ${finding.count} — ${finding.note}`,
          ...finding.jobIds.map((jobId) => `  - ${jobId}`),
        ]),
  );

  lines.push(
    '',
    '## Identity & priority protection',
    '',
    `Checked accepted proposals: ${audit.identity.checkedProposals}`,
    `suggestedPriority matches frozen: ${audit.identity.suggestedPriorityMatches}`,
    `suggestedPriority mismatches: ${audit.identity.suggestedPriorityMismatches.length}`,
    `identity errors: ${audit.identity.errors.length}`,
  );

  lines.push(
    '',
    '## Validator re-run (canonical)',
    '',
    tableRow(['status', 'proposals']),
    tableRow(['---', '---:']),
    tableRow(['revalidated', audit.validation.revalidated]),
    tableRow(['valid', audit.validation.valid]),
    tableRow(['warnings', audit.validation.warnings]),
    tableRow(['invalid', audit.validation.invalid]),
    tableRow(['not-revalidated', audit.validation.notRevalidated]),
    '',
    'Issue codes (count):',
    '',
    countTable(audit.validation.issueCodeCounts),
    '',
    'Issue severities:',
    '',
    countTable({
      error: audit.validation.issueSeverityCounts.error,
      warning: audit.validation.issueSeverityCounts.warning,
    }),
  );

  lines.push(
    '',
    '## Distributions',
    '',
    '### authoringStatus',
    '',
    countTable(audit.distributions.authoringStatus),
    '',
    '### suggestedPriority (accepted)',
    '',
    countTable(audit.distributions.suggestedPriority),
    '',
    '### confidence',
    '',
    countTable(audit.distributions.confidence),
    '',
    '### warnings',
    '',
    countTable(audit.distributions.warnings),
    '',
    '### objectives per unit',
    '',
    countTable(audit.distributions.objectives),
  );
  if (audit.distributions.sevenPlusObjectives.length > 0)
    lines.push(
      '',
      '7+ objectives:',
      '',
      ...audit.distributions.sevenPlusObjectives.map((jobId) => `- ${jobId}`),
    );
  lines.push(
    '',
    '### domains (selection tags)',
    '',
    countTable(audit.distributions.domains),
    '',
    '### focus styles',
    '',
    countTable(audit.distributions.focusStyles),
    '',
    '### mapDisposition',
    '',
    countTable(audit.distributions.mapDisposition),
    '',
    '### parent kind',
    '',
    countTable(audit.distributions.parentKind),
    '',
    '### source count (per unit)',
    '',
    countTable(audit.distributions.sourceCounts),
    '',
    '### size buckets',
    '',
    countTable(audit.distributions.sizeBuckets),
    '',
    '### provenance',
    '',
    countTable(audit.distributions.provenance),
    '',
    '### attempts used per job',
    '',
    countTable(audit.distributions.attemptsUsed),
    '',
    '### issue codes across attempts',
    '',
    countTable(audit.distributions.issueCodesAcrossAttempts),
    '',
    '### provider event references per job',
    '',
    countTable(audit.distributions.providerEventReferences),
  );

  lines.push(
    '',
    '## Named subsets',
    '',
    `final-QC corrections: ${audit.subsets.finalQc.count} units across ${audit.subsets.finalQc.parents.length} parents`,
    ...audit.subsets.finalQc.parents.map(
      (parent) => `- ${parent.documentTitle} s.${parent.sections.join('/')} (${parent.count})`,
    ),
    '',
    `regression anchors: ${audit.subsets.regressionAnchors.count}`,
    ...audit.subsets.regressionAnchors.rows.map(
      (row) => `- ${row.targetId} → ${row.unitJobId || 'unresolved'} [${row.outcome}]`,
    ),
    '',
    `retry targets: ${audit.subsets.retryNine.count}`,
    ...audit.subsets.retryNine.rows.map(
      (row) => `- ${row.targetId} → ${row.unitJobId || 'unresolved'} [${row.outcome}]`,
    ),
    '',
    `containsRepealedSubprovision probes: ${audit.subsets.containsRepealedSubprovision.count}`,
    ...audit.subsets.containsRepealedSubprovision.unitJobIds.map((jobId) => `- ${jobId}`),
  );

  lines.push(
    '',
    '## Inputs',
    '',
    `selection report sha256: \`${audit.inputs.selectionReportSha256}\``,
    `run.json sha256: \`${audit.inputs.runJsonSha256}\``,
    `local-run-metadata sha256: \`${audit.inputs.metadataSha256}\``,
    `local-unit.results.jsonl sha256: \`${audit.inputs.resultsJsonlSha256}\``,
    `package sha256: \`${audit.inputs.packageSha256}\``,
    `spec sha256: \`${audit.inputs.specSha256}\``,
    '',
    'batch files:',
    '',
    ...audit.inputs.batchFiles.map((file) => `- \`${file.file}\` ${file.sha256}`),
    '',
    `metadata jobIds match selection: ${audit.inputs.metadataJobIdsMatchSelection ? 'yes' : 'no'}`,
    `metadata jobCount: ${audit.inputs.metadataJobCount}; selection jobCount: ${audit.inputs.selectionJobCount}`,
  );
  return md(lines);
};

/* ------------------------------------------------------------------ *
 * Human-review .md (risk-ordered, compact per-unit sections)         *
 * ------------------------------------------------------------------ */

const renderUnitSection = (unit: ReviewUnitEntry): Array<string | string[]> => {
  const src = unit.sourceContext;
  const gen = unit.generated;
  const lines: Array<string | string[]> = [];
  lines.push(
    `### ${unit.rank}. \`${unit.jobId}\` — category ${unit.categoryIndex} (${unit.categoryLabel})`,
    '',
    `status: ${unit.status} · batch ${unit.batch} · ${unit.domain} · ${unit.categoryReason}`,
  );
  lines.push(
    '',
    `document: ${src.documentTitle}${src.sections.length > 0 ? ` s.${src.sections.join('/')}` : ''} · group: ${clip(src.groupTitle, 90)}`,
    `source keys: ${src.sourceKeys.join(', ') || '—'} · focus child labels: ${
      src.focus.flatMap((f) => f.childLabels).join(', ') || '—'
    }`,
    `source length: ${src.exactSourceTextLength ?? '—'} chars · preview: \`${clip(src.exactSourcePreview, 140)}\``,
    `tags: ${src.tags.join(' ') || '—'}`,
  );
  if (gen) {
    lines.push(
      '',
      `title: ${clip(gen.title, 110)}`,
      `main question: ${clip(gen.mainQuestion, 130)}`,
      `summary: ${clip(gen.studySummary, 150)}`,
      `objectives: ${gen.objectiveCount} · authoringStatus: ${gen.authoringStatus} · confidence: ${gen.confidence}`,
    );
    if (gen.warnings.length > 0)
      lines.push(`warnings: ${gen.warnings.join(', ')}`);
    gen.objectives.slice(0, 8).forEach((objective) => {
      lines.push(`- [${objective.type}] ${clip(objective.objective, 130)} (${objective.evidenceCount} evidence)`);
    });
    if (gen.mapRevisionSuggestion.present)
      lines.push(
        `map revision suggestion: ${gen.mapRevisionSuggestion.proposedGroupCount} groups — ${clip(
          gen.mapRevisionSuggestion.reason,
          110,
        )}`,
      );
  } else {
    lines.push('', 'no accepted proposal');
  }
  if (unit.attempts.rejectedSemanticAttempts > 0 || unit.attempts.perAttempt.length > 0) {
    lines.push('', 'attempts:');
    unit.attempts.perAttempt.forEach((attempt) => {
      lines.push(
        `- attempt ${attempt.attempt} (${attempt.kind}): ${attempt.issueCodes.join(', ') || 'no issue codes'}`,
      );
    });
  }
  if (unit.identityErrors.length > 0) {
    lines.push('', 'identity errors:');
    unit.identityErrors.forEach((error) => lines.push(`- ${error.code}: ${error.message}`));
  }
  return lines;
};

export const renderHumanReviewMarkdown = (review: ReviewDoc): string => {
  const lines: Array<string | string[]> = [
    `# Calibration-80 Human Review — ${review.dateTag}`,
    '',
    `Run: \`${review.runId}\` · ${review.total} units`,
    `Generated at: \`${review.generatedAt}\``,
    '',
    'Risk-ordered deterministic review. Categories (highest risk first):',
    ...RISK_CATEGORY_LABELS.map((label, index) => `${index + 1}. ${label}`),
    '',
    'A unit appears once, at its earliest (highest-risk) category; named subset membership stacks as labels. Within a category units sort by jobId (stable)',
    '',
    ...review.units.flatMap(renderUnitSection),
  ];
  return md(lines);
};

/* ------------------------------------------------------------------ *
 * Regression anchors .md                                             *
 * ------------------------------------------------------------------ */

export const renderRegressionAnchorsMarkdown = (doc: RegressionAnchorsDoc): string =>
  md([
    `# Calibration-80 Regression Anchors — ${doc.dateTag}`,
    '',
    `Run: \`${doc.runId}\` · ${doc.total} anchors`,
    '',
    tableRow(['target', 'unit jobId', 'resolved', 'outcome', 'priority', 'authoringStatus', 'objectives', 'title']),
    tableRow(['---', '---', '---:', '---', '---', '---', '---:', '---']),
    ...doc.anchors.map((anchor) =>
      tableRow([
        anchor.targetId,
        anchor.unitJobId ?? '—',
        anchor.resolved ? 'yes' : 'no',
        anchor.outcome,
        anchor.priority ?? '—',
        anchor.authoringStatus ?? '—',
        anchor.objectiveCount,
        clip(anchor.title, 60),
      ]),
    ),
  ]);

/* ------------------------------------------------------------------ *
 * Final-QC .md                                                       *
 * ------------------------------------------------------------------ */

export const renderFinalQcMarkdown = (doc: FinalQcDoc): string => {
  const lines: Array<string | string[]> = [
    `# Calibration-80 Final-QC Correction Units — ${doc.dateTag}`,
    '',
    `Run: \`${doc.runId}\` · ${doc.total} correction units under ${doc.parents.length} correction parents`,
    '',
  ];
  for (const parent of doc.parents) {
    lines.push(
      `## ${parent.documentTitle} s.${parent.sections.join('/')} (${parent.count} units)`,
      '',
      tableRow(['unit jobId', 'status', 'priority', 'authoringStatus', 'warnings', 'objectives', 'one-line summary']),
      tableRow(['---', '---', '---', '---', '---', '---:', '---']),
      ...parent.units.map((unit) =>
        tableRow([
          unit.jobId,
          unit.status,
          unit.suggestedPriority ?? '—',
          unit.authoringStatus ?? '—',
          unit.warnings.length > 0 ? unit.warnings.join(', ') : '—',
          unit.objectiveCount,
          clip(unit.oneLineSummary, 110),
        ]),
      ),
      '',
    );
  }
  return md(lines);
};

/* ------------------------------------------------------------------ *
 * Aggregate md renderer used by the CLI and by tests                 *
 * ------------------------------------------------------------------ */

export const renderAllMarkdown = (bundle: AuditBundle) => ({
  auditMd: renderAuditMarkdown(bundle.audit),
  humanReviewMd: renderHumanReviewMarkdown(bundle.review),
  regressionAnchorsMd: renderRegressionAnchorsMarkdown(bundle.regressionAnchors),
  finalQcMd: renderFinalQcMarkdown(bundle.finalQc),
});

export type { AuditBundle, AuditDoc, FinalQcDoc, JobAuditRecord, RegressionAnchorsDoc, ReviewDoc, ReviewUnitEntry };
