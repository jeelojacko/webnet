/**
 * Deterministic Unit Authoring job preparation: the shared construction path
 * used by scripts/studyAiAuthoring.ts `prepare-units` and by the frozen
 * Study Map → Unit Authoring bridge. Pure logic; no provider calls, no
 * wall-clock output (timestamps are caller-supplied).
 *
 * Frozen hash contracts (reproduce EXACTLY; never canonicalize, never
 * reorder):
 *  - hashText: sha256 hex of the input string
 *  - unit jobId:
 *      `unit-${hashText(JSON.stringify({ mapRunId, proposalId, groupId,
 *        promptSpecVersion, sourceKeys })).slice(0, 16)}`
 *    over PLAIN JSON.stringify of that identity payload
 *  - unit inputHash: hashText(JSON.stringify(base)) where base is the whole
 *    job object still carrying `inputHash: ''` at its literal position
 *  - sibling-run rewrite (Phase 4B.2.1 precedent):
 *      { ...job, runId: newRunId, inputHash: '' } then recompute inputHash;
 *    jobId is unchanged.
 *
 * The component-text analysis the builder needs (cleanAiSourceText,
 * sourceStatusFromComponent, contentFlagsFromComponent) is shared from
 * studyAiComponentText.ts, which mirrors scripts/studyAiAuthoring.ts
 * verbatim.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NbLawContentPackage, NbLawDocumentComponent } from '../content/nbLawTypes';
import {
  cleanAiSourceText,
  contentFlagsFromComponent,
  sourceStatusFromComponent,
} from './studyAiComponentText';
import type { AiProposedSourceGroup, AiStudyMapProposal } from './studyAiTypes';
import type {
  AiAuthoringProviderKind,
  AiAuthoringRun,
  AiSuggestedPriority,
  AiUnitAuthoringJob,
} from './studyAiTypes';

export const hashText = (value: string): string =>
  createHash('sha256').update(value).digest('hex');


const UNIT_AUTHORING_DEFAULT_BATCH_SIZE = 20;

export type BuildUnitAuthoringJobArgs = {
  proposal: AiStudyMapProposal;
  group: AiProposedSourceGroup;
  package: NbLawContentPackage;
  runId: string;
  promptSpecVersion: string;
  /** Corpus package content hash; used only when the proposal lacks one. */
  corpusContentHash: string;
  /** Map run the proposal belongs to (the jobId identity payload mapRunId /
   *  `sourceMapRunId`). Defaults to `proposal.runId`; scripts/studyAiAuthoring.ts
   *  passes its `--run` value, which matches `proposal.runId` for every
   *  prepared run. */
  sourceMapRunId?: string;
  /** When true, stamp `frozenMapPriority` as the LAST field of the hashed
   *  base, so non-frozen output stays byte-identical to current behavior. */
  withFrozenPriority?: boolean;
  frozenPriority?: AiSuggestedPriority;
};

/**
 * Builds one AiUnitAuthoringJob for an approved map proposal group.
 * Reproduces the object-literal field order, the jobId identity payload, and
 * the inputHash computation of scripts/studyAiAuthoring.ts exactly.
 *
 * Fail closed: throws when the proposal's document is missing from the
 * content package or when none of the group's sourceKeys resolve to a
 * component (callers must pre-filter those groups, mirroring the CLI gate).
 */
export const buildUnitAuthoringJob = (args: BuildUnitAuthoringJobArgs): AiUnitAuthoringJob => {
  const {
    proposal,
    group,
    package: contentPackage,
    runId,
    promptSpecVersion,
    corpusContentHash,
    sourceMapRunId = proposal.runId,
    withFrozenPriority = false,
    frozenPriority,
  } = args;
  const document = contentPackage.documents.find(
    (entry) => entry.id === proposal.document.documentId,
  );
  if (!document) {
    throw new Error(
      `Cannot build unit authoring job for proposal ${proposal.id} group ${group.groupId}: document ${proposal.document.documentId} is missing from the content package.`,
    );
  }
  const componentsByKey = new Map(
    document.components.map((component) => [component.sourceKey, component]),
  );
  const components = group.sourceKeys
    .map((sourceKey) => componentsByKey.get(sourceKey))
    .filter((component): component is NbLawDocumentComponent => Boolean(component));
  if (components.length === 0) {
    throw new Error(
      `Cannot build unit authoring job for proposal ${proposal.id} group ${group.groupId}: no sourceKeys resolve to components in document ${proposal.document.documentId}.`,
    );
  }
  const sourceTexts = components.map((component) => cleanAiSourceText(component.text));
  const exactSourceText = components.map((component) => component.text).join('\n\n');
  const operativeSourceText = sourceTexts
    .map((entry) => entry.operativeSourceText)
    .join('\n\n');
  const base = {
    schemaVersion: 1 as const,
    jobId: `unit-${hashText(
      JSON.stringify({
        mapRunId: sourceMapRunId,
        proposalId: proposal.id,
        groupId: group.groupId,
        promptSpecVersion,
        sourceKeys: group.sourceKeys,
      }),
    ).slice(0, 16)}`,
    runId,
    promptSpecVersion,
    sourceMapRunId,
    sourceMapProposalId: proposal.id,
    corpusContentHash: proposal.corpusContentHash ?? corpusContentHash,
    inputHash: '',
    document: proposal.document,
    approvedGroup: group,
    mapDisposition: proposal.disposition,
    mapReason: proposal.reason,
    approximateLearningGoal: group.approximateLearningGoal,
    group,
    sourceHashes: Object.fromEntries(
      components.map((component) => [component.sourceKey, component.contentHash]),
    ),
    sourceStatuses: Object.fromEntries(
      components.map((component) => [
        component.sourceKey,
        sourceStatusFromComponent(component),
      ]),
    ),
    contentFlagsBySourceKey: Object.fromEntries(
      components.map((component) => [
        component.sourceKey,
        contentFlagsFromComponent(component),
      ]),
    ),
    exactSourceText,
    operativeSourceText,
    sourceMetadata: {
      amendmentHistory: sourceTexts.flatMap(
        (entry) => entry.sourceMetadata.amendmentHistory ?? [],
      ),
      consolidationNotes: sourceTexts.flatMap(
        (entry) => entry.sourceMetadata.consolidationNotes ?? [],
      ),
      cleaningWarnings: sourceTexts.flatMap(
        (entry) => entry.sourceMetadata.cleaningWarnings ?? [],
      ),
    },
    context: {
      previous: proposal.context?.previous,
      next: proposal.context?.next,
      relevantDefinitions: proposal.context?.relevantDefinitions,
      directlyReferencedProvisions: proposal.context?.directlyReferencedProvisions,
      relatedSourceKeys: proposal.targetSourceKeys.filter(
        (sourceKey) => !group.sourceKeys.includes(sourceKey),
      ),
      warnings: proposal.warnings,
      omittedContextWarnings: proposal.context?.omittedContextWarnings,
    },
  };
  const hashedBase = withFrozenPriority ? { ...base, frozenMapPriority: frozenPriority } : base;
  return { ...hashedBase, inputHash: hashText(JSON.stringify(hashedBase)) };
};

/**
 * Rewrites a prepared job for a sibling run (Phase 4B.2.1 precedent):
 * runId is replaced, inputHash is recomputed over the whole object with
 * `inputHash: ''`; jobId and every other field are preserved.
 */
export const rewriteUnitJobForRun = (
  job: AiUnitAuthoringJob,
  newRunId: string,
): AiUnitAuthoringJob => {
  const base = {
    ...job,
    runId: newRunId,
    inputHash: '',
  };
  return { ...base, inputHash: hashText(JSON.stringify(base)) };
};

/** Sequential slicing helper: batch-NNN.jobs.jsonl writers slice with it. */
export const sliceIntoBatches = <T>(rows: readonly T[], batchSize: number): T[][] => {
  const batches: T[][] = [];
  for (let index = 0; index < rows.length; index += batchSize) {
    batches.push(rows.slice(index, index + batchSize));
  }
  return batches;
};

export type UnitAuthoringRunMeta = {
  runId: string;
  sourceMapRunId: string;
  promptSpecVersion: string;
  createdAt: string;
  updatedAt: string;
  corpusContentHash: string;
  providerKind?: AiAuthoringProviderKind;
  sourcePackageId?: string;
  notes?: string;
  /** unit-job-report.json extras (undefined keys are omitted, as today). */
  strategy?: string | boolean;
  candidateMapProposals?: number;
  selectedMapProposals?: number;
  approvedEligibleMapProposals?: number;
};

export type WriteUnitAuthoringRunOptions = {
  /** Run directory; used verbatim in CODEX_INSTRUCTIONS.md. */
  runDir: string;
  jobs: AiUnitAuthoringJob[];
  batchSize?: number;
  meta: UnitAuthoringRunMeta;
};

/**
 * Writes a prepared unit-authoring run exactly like the current
 * `prepare-units` command: run.json (schemaVersion 1, providerKind, jobType
 * 'unit-authoring', status 'prepared', completedCount 0, invalidCount 0),
 * sequential batch-NNN.jobs.jsonl slices, reports/unit-job-report.json, and
 * CODEX_INSTRUCTIONS.md. Timestamps and run metadata come from the caller so
 * deterministic bridge runs can pass fixed values.
 */
export const writeUnitAuthoringRun = (options: WriteUnitAuthoringRunOptions): void => {
  const { runDir, jobs, batchSize = UNIT_AUTHORING_DEFAULT_BATCH_SIZE, meta } = options;
  const jobsDir = join(runDir, 'jobs');
  const reportsDir = join(runDir, 'reports');
  mkdirSync(jobsDir, { recursive: true });
  mkdirSync(join(runDir, 'results'), { recursive: true });
  mkdirSync(reportsDir, { recursive: true });
  const run = {
    schemaVersion: 1,
    runId: meta.runId,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    providerKind: meta.providerKind ?? 'external-codex',
    jobType: 'unit-authoring',
    promptSpecVersion: meta.promptSpecVersion,
    corpusContentHash: meta.corpusContentHash,
    sourcePackageId: meta.sourcePackageId,
    status: 'prepared',
    jobCount: jobs.length,
    completedCount: 0,
    invalidCount: 0,
    notes: meta.notes,
  } satisfies AiAuthoringRun;
  writeFileSync(join(runDir, 'run.json'), `${JSON.stringify(run, null, 2)}\n`);
  sliceIntoBatches(jobs, batchSize).forEach((batch, batchIndex) => {
    const batchNumber = batchIndex + 1;
    writeFileSync(
      join(jobsDir, `batch-${String(batchNumber).padStart(3, '0')}.jobs.jsonl`),
      `${batch.map((row) => JSON.stringify(row)).join('\n')}\n`,
    );
  });
  writeFileSync(
    join(runDir, 'CODEX_INSTRUCTIONS.md'),
    [
      '# Codex Instructions',
      '',
      `Process ONLY the requested content job files in ${runDir}/jobs using study-content/ai/specs/${meta.promptSpecVersion}.md.`,
      'Write JSONL results to the matching file under results/, for example batch-001.results.jsonl.',
      'Write only the requested result file(s). Use one JSON object per line.',
      'Do not wrap JSONL in Markdown code fences. Do not add commentary to JSONL.',
      'Do not modify application source code.',
      'Do not edit prompt/spec/schema files.',
      'Do not use external legal research or legal memory.',
      'Do not browse web/external legal sources.',
      'Do not use legal memory to supplement supplied source.',
      'The approvedGroup is the AUTHORING SOURCE. The context block is CONTEXT FOR UNDERSTANDING ONLY.',
      'Do not author objectives or study answers from context-only law or unselected sibling focus.',
      'Preserve jobId, runId, inputHash, corpusContentHash, and promptSpecVersion.',
      `Follow promptSpecVersion ${meta.promptSpecVersion}.`,
      'Keep official source, AI study answers, and inference notes separate.',
      'Resume by skipping jobIds that already have valid result lines.',
      'Never rewrite valid existing result lines unless explicitly told to regenerate them.',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(reportsDir, 'unit-job-report.json'),
    `${JSON.stringify(
      {
        unitRunId: meta.runId,
        sourceMapRunId: meta.sourceMapRunId,
        jobs: jobs.length,
        strategy: meta.strategy,
        candidateMapProposals: meta.candidateMapProposals,
        selectedMapProposals: meta.selectedMapProposals,
        approvedEligibleMapProposals: meta.approvedEligibleMapProposals,
        selectedGroups: jobs.map((job) => ({
          jobId: job.jobId,
          source: `${job.document.documentId}:${job.approvedGroup.sourceKeys.join(',')}`,
          title: job.approvedGroup.titleSuggestion,
          focusSelections: job.approvedGroup.focusSelections,
          promptSpecVersion: job.promptSpecVersion,
          inputHash: job.inputHash,
          corpusContentHash: job.corpusContentHash,
        })),
      },
      null,
      2,
    )}\n`,
  );
};
