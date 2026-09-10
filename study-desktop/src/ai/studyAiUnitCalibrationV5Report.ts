/**
 * Crosswalk report content for the cal80-v5 sibling run: pure row
 * construction over the matched v4 cohort / v5 sibling job lists plus the
 * deterministic JSON + markdown report builders (`buildV4V5CrosswalkRows`,
 * `buildV4V5CrosswalkReport`, `renderV4V5CrosswalkReportMd`). No file I/O,
 * no provider calls, no wall-clock output — byte-identical across reruns.
 * The run orchestration lives in `studyAiUnitCalibrationV5.ts`.
 */
import type { AiUnitAuthoringJob } from './studyAiTypes';
import type { AiSuggestedPriority } from './studyAiTypes';

/* ------------------------------------------------------------------ *
 * Crosswalk rows                                                     *
 * ------------------------------------------------------------------ */

export type V4V5CrosswalkRow = {
  /** Position in v4 run order (1-based). */
  seq: number;
  proposalId: string;
  groupId: string;
  v4JobId: string;
  v5JobId: string;
  /** Expected: true — promptSpecVersion is part of the locked jobId hash. */
  jobIdChanged: boolean;
  mapRunId: string;
  /** approvedGroup.sourceKeys of the shared semantic cohort job. */
  documentIds: string[];
  titleSuggestion: string;
  frozenMapPriority: AiSuggestedPriority | null;
  v4InputHash: string;
  v5InputHash: string;
  semanticMatch: true;
};

/** The v5 sibling at each index corresponds 1:1 to the v4 cohort job. */
export const buildV4V5CrosswalkRows = (
  v4CohortJobs: readonly AiUnitAuthoringJob[],
  v5SiblingJobs: readonly AiUnitAuthoringJob[],
): V4V5CrosswalkRow[] => {
  if (v4CohortJobs.length !== v5SiblingJobs.length) {
    throw new Error(
      `Cal80-v5 fail-closed: crosswalk rows need one v5 sibling per v4 cohort job, got ${v4CohortJobs.length} v4 vs ${v5SiblingJobs.length} v5.`,
    );
  }
  return v4CohortJobs.map((v4Job, index) => {
    const v5Job = v5SiblingJobs[index];
    const group = v4Job.approvedGroup;
    return {
      seq: index + 1,
      proposalId: v4Job.sourceMapProposalId,
      groupId: group.groupId,
      v4JobId: v4Job.jobId,
      v5JobId: v5Job.jobId,
      jobIdChanged: v4Job.jobId !== v5Job.jobId,
      mapRunId: v4Job.sourceMapRunId,
      documentIds: [...group.sourceKeys],
      titleSuggestion: group.titleSuggestion,
      frozenMapPriority: v4Job.frozenMapPriority ?? null,
      v4InputHash: v4Job.inputHash,
      v5InputHash: v5Job.inputHash,
      semanticMatch: true,
    };
  });
};

/* ------------------------------------------------------------------ *
 * Report content                                                     *
 * ------------------------------------------------------------------ */

export type V4V5CrosswalkSpecShas = {
  v4: string;
  v5: string;
};

export type V4V5CrosswalkReport = {
  report: 'unit-calibration-v4-v5-crosswalk';
  dateTag: string;
  v4RunId: string;
  v5RunId: string;
  specShas: V4V5CrosswalkSpecShas;
  cohortSize: number;
  matched: number;
  unmatched: number;
  rows: V4V5CrosswalkRow[];
};

export const buildV4V5CrosswalkReport = (args: {
  dateTag: string;
  v4RunId: string;
  v5RunId: string;
  specShas: V4V5CrosswalkSpecShas;
  rows: V4V5CrosswalkRow[];
}): V4V5CrosswalkReport => ({
  report: 'unit-calibration-v4-v5-crosswalk',
  dateTag: args.dateTag,
  v4RunId: args.v4RunId,
  v5RunId: args.v5RunId,
  specShas: args.specShas,
  cohortSize: args.rows.length,
  matched: args.rows.length,
  unmatched: 0,
  rows: args.rows,
});

/* ------------------------------------------------------------------ *
 * Report markdown                                                    *
 * ------------------------------------------------------------------ */

const cell = (value: string): string => value.replace(/\n/g, ' ').replace(/\|/g, '\\|');

const rowLine = (row: V4V5CrosswalkRow): string =>
  `| ${row.seq} | \`${row.v4JobId}\` | \`${row.v5JobId}\` | ${cell(
    row.documentIds.join(' / '),
  )} | ${cell(row.titleSuggestion)} | ${row.frozenMapPriority ?? 'null'} | ${row.semanticMatch} |`;

export const renderV4V5CrosswalkReportMd = (report: V4V5CrosswalkReport): string => {
  const lines = [
    `# Unit calibration V4 → V5 crosswalk — ${report.dateTag}`,
    '',
    'Deterministic V4/V5 sibling crosswalk for the frozen calibration-80 cohort.',
    '',
    `- V4 run: \`${report.v4RunId}\` (prompt spec unit-authoring-v4, spec sha256 \`${report.specShas.v4}\`)`,
    `- V5 run: \`${report.v5RunId}\` (prompt spec unit-authoring-v5, spec sha256 \`${report.specShas.v5}\`)`,
    `- Cohort: ${report.cohortSize} jobs matched by (sourceMapProposalId, groupId)`,
    `- Matched: ${report.matched} / unmatched: ${report.unmatched}`,
    '',
    '| seq | v4JobId | v5JobId | document(s) | title | P | matched |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const row of report.rows) lines.push(rowLine(row));
  lines.push('');
  return lines.join('\n');
};
