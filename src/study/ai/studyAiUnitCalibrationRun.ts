/**
 * Frozen calibration-80 orchestration: read the prepared preflight jobs +
 * corpus + frozen proposals, run the deterministic selection in
 * `studyAiUnitCalibration.ts`, rewrite the 80 selected jobs for the sibling
 * run via `rewriteUnitJobForRun`, validate all 80 against the NEW runId,
 * write the prepared run (batch size 8, prepared 0/0, fixed generatedAt),
 * and return the full deterministic result for report building.
 *
 * Pure orchestration: no provider calls, no wall-clock output. Fail-closed
 * at every stage (`inputs` / `selection` / `validation`).
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { NbLawContentPackage } from '../content/nbLawTypes';
import {
  CANONICAL_RESULTS_REL_PATH,
  FROZEN_MAP_RUN_ID,
  MAP_PROPOSALS_REL_PATH,
  RUNS_DIR_REL,
  canonicalRunDir,
  readJsonFile,
  readJsonlFile,
  sha256File,
} from './studyAiMapFreezeGate';
import { PROVENANCE_CLASSES, classifyJobProvenance } from './studyAiUnitInventory';
import { hashText, rewriteUnitJobForRun, writeUnitAuthoringRun } from './studyAiUnitJobPrep';
import {
  FROZEN_UNIT_PREFLIGHT_RUN_ID,
  FROZEN_UNIT_PROMPT_SPEC_VERSION,
} from './studyAiUnitPreflight';
import { inspectPreparedRunLayout } from './studyAiUnitPreflightReport';
import {
  validateAiUnitAuthoringJob,
  type AiUnitAuthoringValidationContext,
} from './studyAiUnitJobValidation';
import { UNIT_COVERAGE_FEATURES } from './studyAiUnitCalibrationFeatures';
import {
  CALIBRATION_DOMAIN_TARGETS,
  CALIBRATION_PRIORITY_TARGETS,
  selectCalibrationJobs,
  UNIT_CALIBRATION_BATCH_SIZE,
  UNIT_CALIBRATION_DATE_TAG,
  UNIT_CALIBRATION_GENERATED_AT,
  UNIT_CALIBRATION_PROVIDER_KIND,
  UNIT_CALIBRATION_RUN_ID,
  UNIT_CALIBRATION_SEED_TAG,
  UNIT_CALIBRATION_TOTAL,
  type UnitCalibrationJobRecord,
  type UnitCalibrationSelectionNote,
  type UnitCalibrationTargetSpec,
} from './studyAiUnitCalibration';
import type { AiStudyMapProposal, AiUnitAuthoringJob } from './studyAiTypes';

/* ------------------------------------------------------------------ *
 * Run options + result types                                         *
 * ------------------------------------------------------------------ */

export type RunUnitCalibration80Options = {
  /** Prepared preflight run directory (default canonical preflight run). */
  preflightRunDir?: string;
  /** Canonical frozen map run directory. */
  runDir?: string;
  corpusPackagePath?: string;
  /** Root the calibration sibling run is written under. */
  runDirRoot?: string;
  runId?: string;
  batchSize?: number;
  generatedAt?: string;
  dateTag?: string;
  groupingCorrectionJobIds?: readonly string[];
  retryTargets?: readonly UnitCalibrationTargetSpec[];
  regressionAnchors?: readonly UnitCalibrationTargetSpec[];
};

export type UnitCalibration80Abort = {
  ok: false;
  stage: 'inputs' | 'selection' | 'validation';
  issues: string[];
  notes: UnitCalibrationSelectionNote[];
};

export type UnitCalibration80Success = {
  ok: true;
  dateTag: string;
  seedTag: string;
  runId: string;
  generatedAt: string;
  sourceMapRunId: string;
  promptSpecVersion: string;
  batchSize: number;
  preflightRunDir: string;
  runDir: string;
  corpusPackagePath: string;
  corpusPackageId: string | null;
  corpusContentHash: string;
  inputArtifacts: {
    preflightRunJson: string | null;
    preflightBatchFiles: Array<{ file: string; sha256: string }>;
    preflightBatchDigest: string;
    corpusPackageSha256: string | null;
    frozenProposalsSha256: string | null;
    frozenResultsSha256: string | null;
  };
  selected: AiUnitAuthoringJob[];
  rewrittenJobs: AiUnitAuthoringJob[];
  records: UnitCalibrationJobRecord[];
  notes: UnitCalibrationSelectionNote[];
  counts: {
    jobCount: number;
    pinCount: number;
    retryRepresentatives: number;
    anchorTaggedJobs: number;
    correctionJobIds: number;
  };
  priority: { target: Record<string, number>; actual: Record<string, number> };
  domain: { target: Record<string, number>; actual: Record<string, number> };
  retryTargetCoverage: Array<{ targetId: string; unitJobId: string | null }>;
  anchorTargetCoverage: Array<{ targetId: string; unitJobId: string | null }>;
  featureCoverage: Record<string, number>;
  provenanceMix: Record<string, number>;
  sizeBuckets: Record<string, number>;
  combine: { combineJobs: number; multiSourceJobs: number; maxSourceKeys: number };
  focusStyles: Record<string, number>;
  validation: { checkedJobs: number; issuesTotal: number; sampleIssues: string[] };
  layout: ReturnType<typeof inspectPreparedRunLayout>;
};

export type UnitCalibration80Result = UnitCalibration80Success | UnitCalibration80Abort;

type CalibrationInputs = {
  ok: true;
  preflightRunDir: string;
  runDir: string;
  corpusPackagePath: string;
  packageObject: NbLawContentPackage;
  jobs: AiUnitAuthoringJob[];
  proposals: AiStudyMapProposal[];
  corpusContentHash: string;
};

type InputFailure = { ok: false; issues: string[] };

/* ------------------------------------------------------------------ *
 * Phase helpers                                                      *
 * ------------------------------------------------------------------ */

const readPreparedUnitJobs = (runDir: string): AiUnitAuthoringJob[] => {
  const jobsDir = join(runDir, 'jobs');
  if (!existsSync(jobsDir)) return [];
  return readdirSync(jobsDir)
    .filter((file) => file.endsWith('.jobs.jsonl'))
    .sort()
    .flatMap((file) => readJsonlFile<AiUnitAuthoringJob>(join(jobsDir, file)));
};

/** Load and sanity-check the corpus, preflight jobs, and frozen proposals. */
const loadCalibrationInputs = (opts: RunUnitCalibration80Options): CalibrationInputs | InputFailure => {
  const preflightRunDir = opts.preflightRunDir ?? join(RUNS_DIR_REL, FROZEN_UNIT_PREFLIGHT_RUN_ID);
  const runDir = opts.runDir ?? canonicalRunDir(FROZEN_MAP_RUN_ID);
  const corpusPackagePath =
    opts.corpusPackagePath ?? 'study-content/packages/nb-sit-statute-corpus.content-package.json';
  const packageObject = readJsonFile<NbLawContentPackage>(corpusPackagePath);
  if (packageObject === null) {
    return { ok: false, issues: [`Cannot read corpus package at ${corpusPackagePath}.`] };
  }
  const jobs = readPreparedUnitJobs(preflightRunDir);
  const proposals = readJsonFile<AiStudyMapProposal[]>(join(runDir, MAP_PROPOSALS_REL_PATH)) ?? [];
  if (jobs.length === 0) {
    return { ok: false, issues: [`No prepared unit jobs found under ${preflightRunDir}/jobs.`] };
  }
  const uniqueJobIds = new Set(jobs.map((job) => job.jobId));
  if (uniqueJobIds.size !== jobs.length) {
    return {
      ok: false,
      issues: [`Preflight job set contains ${jobs.length - uniqueJobIds.size} duplicate jobIds.`],
    };
  }
  // Run-level corpus content hash (run.json convention). NOTE: prepared jobs
  // carry their parent proposal's corpusContentHash (map-time manifest), which
  // may differ from this package-level hash; the preflight precedent keeps them
  // separate (run.json vs the job field) and validates each job against its own
  // proposal. Do not require equality here.
  return {
    ok: true,
    preflightRunDir,
    runDir,
    corpusPackagePath,
    packageObject,
    jobs,
    proposals,
    corpusContentHash: hashText(JSON.stringify(packageObject.sourceHashes)),
  };
};

/**
 * Validate every rewritten job against the NEW runId (recompute-consistency
 * is what matters: rewriteUnitJobForRun rehashes with runId in the base).
 */
const validateRewrittenJobs = (
  rewrittenJobs: AiUnitAuthoringJob[],
  proposals: AiStudyMapProposal[],
  packageObject: NbLawContentPackage,
  corpusContentHash: string,
  runId: string,
): { issuesTotal: number; sampleIssues: string[] } => {
  const proposalById = new Map(proposals.map((proposal) => [proposal.id, proposal]));
  const sampleIssues: string[] = [];
  let issuesTotal = 0;
  const recordIssue = (issue: string): void => {
    issuesTotal += 1;
    if (sampleIssues.length < 20) sampleIssues.push(issue);
  };
  for (const job of rewrittenJobs) {
    const proposal = proposalById.get(job.sourceMapProposalId);
    if (proposal === undefined) {
      recordIssue(`PROPOSAL_MISSING: no frozen proposal for ${job.sourceMapProposalId}.`);
      continue;
    }
    const groupIndex = proposal.proposedGroups.findIndex(
      (group) => group.groupId === job.approvedGroup.groupId,
    );
    if (groupIndex < 0) {
      recordIssue(`GROUP_INDEX_MISSING: group ${job.approvedGroup.groupId} not found on ${proposal.id}.`);
      continue;
    }
    const ctx: AiUnitAuthoringValidationContext = {
      run: {
        runId,
        jobType: 'unit-authoring',
        providerKind: UNIT_CALIBRATION_PROVIDER_KIND,
        promptSpecVersion: FROZEN_UNIT_PROMPT_SPEC_VERSION,
      },
      sourceMapRunId: FROZEN_MAP_RUN_ID,
      proposal,
      groupIndex,
      package: packageObject,
      corpusContentHash,
    };
    for (const issue of validateAiUnitAuthoringJob(job, ctx)) recordIssue(issue);
  }
  return { issuesTotal, sampleIssues };
};

/** Deterministic coverage/provenance/size aggregation over the records. */
const summarizeRecords = (records: UnitCalibrationJobRecord[]): {
  featureCoverage: Record<string, number>;
  provenanceMix: Record<string, number>;
  sizeBuckets: Record<string, number>;
  focusStyles: Record<string, number>;
  combineJobs: number;
  multiSourceJobs: number;
  maxSourceKeys: number;
} => {
  const featureCoverage: Record<string, number> = {};
  for (const feature of UNIT_COVERAGE_FEATURES) featureCoverage[feature] = 0;
  const provenanceMix: Record<string, number> = {};
  for (const provenance of PROVENANCE_CLASSES) provenanceMix[provenance] = 0;
  const sizeBuckets: Record<string, number> = {};
  const focusStyles: Record<string, number> = {};
  let combineJobs = 0;
  let multiSourceJobs = 0;
  let maxSourceKeys = 0;
  for (const record of records) {
    for (const tag of record.tags) {
      if (tag in featureCoverage) featureCoverage[tag] += 1;
    }
    provenanceMix[record.provenance] += 1;
    sizeBuckets[record.sizeBucket] = (sizeBuckets[record.sizeBucket] ?? 0) + 1;
    focusStyles[record.focusStyle] = (focusStyles[record.focusStyle] ?? 0) + 1;
    if (record.parentKind === 'combine') combineJobs += 1;
    if (record.sourceKeyCount > 1) multiSourceJobs += 1;
    maxSourceKeys = Math.max(maxSourceKeys, record.sourceKeyCount);
  }
  return { featureCoverage, provenanceMix, sizeBuckets, focusStyles, combineJobs, multiSourceJobs, maxSourceKeys };
};

/** Per-batch SHA-256s of the preflight run plus one digest over them. */
const collectPreflightArtifacts = (preflightRunDir: string): {
  preflightRunJson: string | null;
  preflightBatchFiles: Array<{ file: string; sha256: string }>;
  preflightBatchDigest: string;
} => {
  const jobsDir = join(preflightRunDir, 'jobs');
  const preflightBatchFiles = existsSync(jobsDir)
    ? readdirSync(jobsDir)
        .filter((file) => file.endsWith('.jobs.jsonl'))
        .sort()
        .map((file) => ({
          file: `jobs/${file}`,
          sha256: sha256File(join(jobsDir, file)) ?? '',
        }))
    : [];
  const preflightBatchDigest = hashText(
    JSON.stringify(preflightBatchFiles.map((entry) => `${entry.file}:${entry.sha256}`)),
  );
  return {
    preflightRunJson: sha256File(join(preflightRunDir, 'run.json')),
    preflightBatchFiles,
    preflightBatchDigest,
  };
};

/* ------------------------------------------------------------------ *
 * Orchestration                                                       *
 * ------------------------------------------------------------------ */

/**
 * Run the full deterministic calibration-80. Steps fail closed:
 *   inputs      — corpus/preflight/proposal read failures, duplicate jobIds
 *   selection   — `selectCalibrationJobs` issues (pin count, priority target
 *                 shortfall, selection ≠ 80)
 *   validation  — any `validateAiUnitAuthoringJob` issue on the 80 rewritten
 *                 jobs (ctx runId is the NEW calibration runId; jobId is
 *                 preserved, inputHash recomputed over runId-inclusive base)
 * On success the sibling prepared run is written and the full result
 * (records, distributions, layout, rewritten jobs) is returned for report
 * building.
 */
export const runUnitCalibration80 = (opts: RunUnitCalibration80Options = {}): UnitCalibration80Result => {
  const inputs = loadCalibrationInputs(opts);
  if (!inputs.ok) {
    return { ok: false, stage: 'inputs', issues: inputs.issues, notes: [] };
  }
  const runId = opts.runId ?? UNIT_CALIBRATION_RUN_ID;
  const runDirRoot = opts.runDirRoot ?? RUNS_DIR_REL;
  const batchSize = opts.batchSize ?? UNIT_CALIBRATION_BATCH_SIZE;
  const generatedAt = opts.generatedAt ?? UNIT_CALIBRATION_GENERATED_AT;
  const dateTag = opts.dateTag ?? UNIT_CALIBRATION_DATE_TAG;
  const { packageObject, jobs, proposals, corpusContentHash } = inputs;

  const selection = selectCalibrationJobs({
    jobs,
    package: packageObject,
    proposals,
    groupingCorrectionJobIds: opts.groupingCorrectionJobIds,
    retryTargets: opts.retryTargets,
    regressionAnchors: opts.regressionAnchors,
    provenanceOfMapJob: (mapJobId) => classifyJobProvenance(inputs.runDir, mapJobId),
  });
  if (!selection.ok || selection.selected.length !== UNIT_CALIBRATION_TOTAL) {
    return {
      ok: false,
      stage: 'selection',
      issues: selection.issues,
      notes: selection.notes,
    };
  }

  const rewrittenJobs = selection.selected.map((job) => rewriteUnitJobForRun(job, runId));
  const validation = validateRewrittenJobs(
    rewrittenJobs,
    proposals,
    packageObject,
    corpusContentHash,
    runId,
  );
  if (validation.issuesTotal > 0) {
    return {
      ok: false,
      stage: 'validation',
      issues: validation.sampleIssues.slice(0, 20),
      notes: selection.notes,
    };
  }

  const newRunDir = join(runDirRoot, runId);
  writeUnitAuthoringRun({
    runDir: newRunDir,
    jobs: rewrittenJobs,
    batchSize,
    meta: {
      runId,
      sourceMapRunId: FROZEN_MAP_RUN_ID,
      promptSpecVersion: FROZEN_UNIT_PROMPT_SPEC_VERSION,
      createdAt: generatedAt,
      updatedAt: generatedAt,
      corpusContentHash,
      providerKind: UNIT_CALIBRATION_PROVIDER_KIND,
      sourcePackageId: packageObject.id,
      notes: `Calibration-80 selection from frozen Study Map run ${FROZEN_MAP_RUN_ID} via preflight ${FROZEN_UNIT_PREFLIGHT_RUN_ID} (dateTag ${dateTag}, seed ${UNIT_CALIBRATION_SEED_TAG}); ${selection.selected.length} validated unit jobs.`,
    },
  });

  const summary = summarizeRecords(selection.records);
  const artifacts = collectPreflightArtifacts(inputs.preflightRunDir);
  const correctionParentCount = new Set(
    selection.records.filter((record) => record.correction).map((record) => record.mapJobId),
  ).size;
  return {
    ok: true,
    dateTag,
    seedTag: UNIT_CALIBRATION_SEED_TAG,
    runId,
    generatedAt,
    sourceMapRunId: FROZEN_MAP_RUN_ID,
    promptSpecVersion: FROZEN_UNIT_PROMPT_SPEC_VERSION,
    batchSize,
    preflightRunDir: inputs.preflightRunDir,
    runDir: newRunDir,
    corpusPackagePath: inputs.corpusPackagePath,
    corpusPackageId: packageObject.id,
    corpusContentHash,
    inputArtifacts: {
      preflightRunJson: artifacts.preflightRunJson,
      preflightBatchFiles: artifacts.preflightBatchFiles,
      preflightBatchDigest: artifacts.preflightBatchDigest,
      corpusPackageSha256: sha256File(inputs.corpusPackagePath),
      frozenProposalsSha256: sha256File(join(inputs.runDir, MAP_PROPOSALS_REL_PATH)),
      frozenResultsSha256: sha256File(join(inputs.runDir, CANONICAL_RESULTS_REL_PATH)),
    },
    selected: selection.selected,
    rewrittenJobs,
    records: selection.records,
    notes: selection.notes,
    counts: {
      jobCount: selection.selected.length,
      pinCount: selection.records.filter((record) => record.correction).length,
      retryRepresentatives: selection.records.filter((record) => record.retry).length,
      anchorTaggedJobs: selection.records.filter((record) => record.regression).length,
      correctionJobIds: correctionParentCount,
    },
    priority: { target: { ...CALIBRATION_PRIORITY_TARGETS }, actual: selection.priorityActual },
    domain: { target: { ...CALIBRATION_DOMAIN_TARGETS }, actual: selection.domainActual },
    retryTargetCoverage: selection.retryTargetCoverage,
    anchorTargetCoverage: selection.anchorTargetCoverage,
    featureCoverage: summary.featureCoverage,
    provenanceMix: summary.provenanceMix,
    sizeBuckets: summary.sizeBuckets,
    combine: {
      combineJobs: summary.combineJobs,
      multiSourceJobs: summary.multiSourceJobs,
      maxSourceKeys: summary.maxSourceKeys,
    },
    focusStyles: summary.focusStyles,
    validation: {
      checkedJobs: rewrittenJobs.length,
      issuesTotal: 0,
      sampleIssues: [],
    },
    layout: inspectPreparedRunLayout(newRunDir, batchSize, rewrittenJobs.length),
  };
};
