/**
 * Shared synthetic fixtures for the frozen-map freeze-gate / unit-inventory
 * tests. Builds a small temp frozen-run layout (results JSONL, provenance
 * sidecars, prepared jobs, proposals, freeze report, decision file, corpus
 * package) under an OS temp dir. All file writes are JSON — no corpus reads,
 * no model calls, deterministic.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type {
  AiStudyDisposition,
  AiStudyMapJob,
  AiStudyMapProposal,
  AiStudyMapResult,
} from '../../src/study/ai/studyAiTypes';
import { RUNS_DIR_REL } from '../../src/study/ai/studyAiMapFreezeGate';

export type FrozenRunFixture = {
  root: string;
  runId: string;
  runDir: string;
  freezeReportPath: string;
  decisionFilePath: string;
  corpusPackagePath: string;
  cleanup: () => void;
};

const sha256Text = (text: string): string =>
  createHash('sha256').update(text).digest('hex');

export const sha256Of = (text: string): string => sha256Text(text);

/** Create a temp run layout; caller writes content into it with the helpers below. */
export const createFrozenRunFixture = (runId: string): FrozenRunFixture => {
  const root = mkdtempSync(join(tmpdir(), 'frozen-run-'));
  const runDir = join(root, RUNS_DIR_REL, runId);
  mkdirSync(join(runDir, 'jobs'), { recursive: true });
  mkdirSync(join(runDir, 'results'), { recursive: true });
  mkdirSync(join(runDir, 'reports'), { recursive: true });
  return {
    root,
    runId,
    runDir,
    freezeReportPath: join(root, 'freeze-report.json'),
    decisionFilePath: join(root, 'decisions.json'),
    corpusPackagePath: join(root, 'corpus.content-package.json'),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
};

export const writeTextFile = (filePath: string, text: string): void => {
  writeFileSync(filePath, text);
};

export const writeJsonFile = (filePath: string, value: unknown): void => {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

export const writeJobs = (runDir: string, jobs: AiStudyMapJob[]): void => {
  writeFileSync(
    join(runDir, 'jobs', 'batch-001.jobs.jsonl'),
    `${jobs.map((job) => JSON.stringify(job)).join('\n')}\n`,
  );
};

export const writeResultsJsonl = (runDir: string, rows: AiStudyMapResult[]): void => {
  writeFileSync(
    join(runDir, 'results', 'local-map.results.jsonl'),
    `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
  );
};

export const writeSidecar = (runDir: string, sidecar: Record<string, unknown>): void => {
  const jobId = String(sidecar.jobId ?? 'unknown');
  writeJsonFile(join(runDir, 'results', `${jobId}.provenance.json`), sidecar);
};

export const writeProposals = (runDir: string, proposals: AiStudyMapProposal[]): void => {
  writeJsonFile(join(runDir, 'reports', 'map-proposals.json'), proposals);
};

/* ------------------------------------------------------------------ *
 * Object builders                                                     *
 * ------------------------------------------------------------------ */

export type JobSpec = {
  jobId: string;
  runId: string;
  documentId: string;
  documentTitle: string;
  sectionKey: string;
  sectionLabel: string;
  heading?: string;
  sourceStatus?: AiStudyMapJob['target']['sourceStatus'];
  contentFlags?: AiStudyMapJob['target']['contentFlags'];
  exactCharacters?: number;
  corpusContentHash?: string;
};

export const makeJob = (spec: JobSpec): AiStudyMapJob => {
  const heading = spec.heading ?? 'Heading';
  const exactCharacters = spec.exactCharacters ?? 120;
  const sectionKey = spec.sectionKey;
  return {
    schemaVersion: 1,
    jobId: spec.jobId,
    runId: spec.runId,
    promptSpecVersion: 'study-map-v3',
    corpusContentHash: spec.corpusContentHash ?? 'corpus-hash-a',
    inputHash: `input-${spec.jobId}`,
    document: {
      documentId: spec.documentId,
      title: spec.documentTitle,
      type: 'act',
    },
    target: {
      sourceKeys: [sectionKey],
      sectionLabels: [spec.sectionLabel],
      componentType: 'section',
      heading,
      exactSourceText: `${heading}\n\n${spec.sectionLabel}Operative text of ${spec.sectionLabel}.`,
      operativeSourceText: `${heading}\n\n${spec.sectionLabel}Operative text of ${spec.sectionLabel}.`,
      sourceMetadata: {},
      sourceStatus: spec.sourceStatus ?? 'current',
      contentFlags: spec.contentFlags,
      approximateInputSize: {
        exactCharacters,
        operativeCharacters: exactCharacters - 20,
        largeSection: false,
      },
      sourceFocusOptions: [{ sourceKey: sectionKey, label: spec.sectionLabel, childLabels: [`${spec.sectionLabel}(1)`] }],
      sourceHashes: { [sectionKey]: `hash-${spec.jobId}` },
    },
    context: { omittedContextWarnings: [] },
  };
};

export type GroupSpec = {
  groupId: string;
  title?: string;
  sourceKeys?: string[];
  childLabels?: string[];
  definedTerms?: string[];
  evidenceText?: string[];
  reason?: string;
  learningGoal?: string;
};

export const makeGroup = (spec: GroupSpec): AiStudyMapResult['proposedGroups'][number] => ({
  groupId: spec.groupId,
  titleSuggestion: spec.title ?? `Title for ${spec.groupId}`,
  sourceKeys: spec.sourceKeys ?? ['section:1'],
  focusSelections: [
    {
      sourceKey: (spec.sourceKeys ?? ['section:1'])[0],
      childLabels: spec.childLabels ?? [],
      definedTerms: spec.definedTerms ?? [],
      evidenceText: spec.evidenceText ?? [],
    },
  ],
  reason: spec.reason ?? `Reason for ${spec.groupId}`,
  approximateLearningGoal: spec.learningGoal ?? `Learning goal for ${spec.groupId}`,
});

export const makeResult = (
  overrides: Partial<AiStudyMapResult> & { jobId: string; runId: string },
): AiStudyMapResult => {
  const { jobId, runId, ...rest } = overrides;
  return {
    schemaVersion: 1,
    jobId,
    runId,
    corpusContentHash: 'corpus-hash-a',
    promptSpecVersion: 'study-map-v3',
    disposition: 'standalone',
    confidence: 'high',
    reason: `Reason for ${jobId}`,
    suggestedPriority: 'P3',
    proposedGroups: [],
    warnings: [],
    ...rest,
  };
};

/** Build the stored proposal that validate-results would write for a result row. */
export const makeProposal = (
  row: AiStudyMapResult,
  job: AiStudyMapJob,
  overrides: Partial<AiStudyMapProposal> = {},
): AiStudyMapProposal => ({
  id: `${row.runId}:${row.jobId}`,
  schemaVersion: 1,
  runId: row.runId,
  jobId: row.jobId,
  corpusContentHash: row.corpusContentHash,
  inputHash: job.inputHash,
  document: { ...job.document },
  targetSourceKeys: [...job.target.sourceKeys],
  targetSectionLabels: [...job.target.sectionLabels],
  targetHeading: job.target.heading,
  disposition: row.disposition,
  confidence: row.confidence,
  reason: row.reason,
  suggestedPriority: row.suggestedPriority ?? null,
  proposedGroups: row.proposedGroups,
  warnings: [...row.warnings],
  conflictCodes: [],
  reviewStatus: 'validated',
  validationStatus: 'valid',
  validationMessages: [],
  createdAt: '2026-09-02T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
  ...overrides,
});

export type SidecarSpec = {
  jobId: string;
  sourceRun?: string;
  promotionSourceRun?: string;
  hasPromotion?: boolean;
  hasRecovery?: boolean;
  humanAdjudicated?: boolean;
  adjudicationReason?: string;
};

export const makeSidecar = (spec: SidecarSpec): Record<string, unknown> => {
  const sidecar: Record<string, unknown> = {
    jobId: spec.jobId,
    runId: 'synth-run',
    accepted: true,
  };
  if (spec.sourceRun) sidecar.sourceRun = spec.sourceRun;
  if (spec.hasPromotion)
    sidecar.promotion = {
      promotedVia: 'study:ai:promote-result',
      sourceRun: spec.promotionSourceRun ?? 'retry-synth-run',
    };
  if (spec.hasRecovery)
    sidecar.recovery = { recoveredFromHistoricalAttempt: true, sourceAttempt: 2 };
  if (spec.humanAdjudicated || spec.adjudicationReason) {
    sidecar.adjudication = {
      humanAdjudicated: spec.humanAdjudicated ?? spec.adjudicationReason !== undefined,
      sourceRun: spec.sourceRun,
      adjudicationReason: spec.adjudicationReason,
    };
  }
  return sidecar;
};

export const makeDispositionGroups = (
  disposition: AiStudyDisposition,
  count: number,
): AiStudyMapResult['proposedGroups'] =>
  count === 0
    ? []
    : Array.from({ length: count }, (_, index) => makeGroup({ groupId: `g${index + 1}` }));

export type FreezeReportSpec = {
  runId: string;
  decisionFileSha256?: string;
  proposalsSha256?: string;
  proposalsFile?: string;
  resultRows?: number;
  priorityDistribution?: Record<string, number>;
  resultRowsInvalid?: number;
  adjudicationFailed?: number;
  pinnedAnchorsAllFound?: boolean;
  groupingJobIds?: string[];
};

/** Write a freeze report fixture; sha values default to the sha of the given files. */
export const writeFreezeReport = (
  fixture: FrozenRunFixture,
  spec: FreezeReportSpec,
  decisionFileText: string,
  proposalsFileText: string,
): void => {
  const decisionFileSha256 =
    spec.decisionFileSha256 ?? sha256Of(decisionFileText);
  const proposalsSha256 = spec.proposalsSha256 ?? sha256Of(proposalsFileText);
  const proposalsFile = spec.proposalsFile ?? `${fixture.runId}/reports/map-proposals.json`;
  writeJsonFile(fixture.freezeReportPath, {
    schemaVersion: 1,
    kind: 'study-map-final-freeze-report',
    runId: spec.runId,
    dateTag: '20260902',
    inputs: { decisionFileSha256 },
    adjudication: {
      failed: spec.adjudicationFailed ?? 0,
      verification: { resultRowsInvalid: spec.resultRowsInvalid ?? 0 },
    },
    finalState: {
      resultRows: spec.resultRows ?? 0,
      priorityDistribution: spec.priorityDistribution ?? {},
      pinnedAnchors: { allFound: spec.pinnedAnchorsAllFound ?? true },
    },
    groupingCorrections: (spec.groupingJobIds ?? []).map((jobId) => ({ jobId })),
    regeneratedReports: [{ file: proposalsFile, sha256: proposalsSha256 }],
  });
};
