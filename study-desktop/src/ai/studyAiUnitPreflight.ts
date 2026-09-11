/**
 * Frozen Study Map → Unit Authoring preflight.
 *
 * `runFrozenUnitPreflight(opts)` runs the whole deterministic preflight in
 * one importable call: freeze gate → equivalence audit → frozen eligibility →
 * job build → cardinality invariants → per-job validation → prepared run
 * write. Aborts fail-closed at every stage with a structured result; the
 * cardinality invariants are hard assertions (throw). No provider calls, no
 * wall-clock output (timestamps are the fixed preflight values).
 *
 * Frozen eligibility: proposals come from the FROZEN adjudicated map — the
 * freeze report is the final human authority, so every grouped canonical row
 * is treated as approved and every bypass is recorded (reviewStatus other
 * than 'approved', conflict codes retained at warning level, needs-review
 * rows accepted into the frozen state). Still fail-closed: invalid /
 * not-validated rows, rejected/stale review states, unresolvable documents or
 * group sourceKeys, and zero-group grouped rows all abort the run.
 *
 * Deterministic report content (distributions, run layout, report JSON + md
 * renderers) lives in `studyAiUnitPreflightReport.ts`.
 */
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { NbLawContentPackage } from '../content/nbLawTypes';
import {
  CANONICAL_RESULTS_REL_PATH,
  FREEZE_DECISION_FILE_REL_PATH,
  FREEZE_REPORT_REL_PATH,
  FROZEN_MAP_RUN_ID,
  MAP_PROPOSALS_REL_PATH,
  RUNS_DIR_REL,
  auditMapProposalEquivalence,
  canonicalRunDir,
  readJsonFile,
  readMapProposals,
  sha256File,
  verifyFrozenStudyMap,
  type FrozenMapVerification,
  type MapEquivalenceAudit,
} from './studyAiMapFreezeGate';
import {
  CORPUS_PACKAGE_REL_PATH,
  classifyJobProvenance,
  type ProvenanceClass,
} from './studyAiUnitInventory';
import {
  buildUnitAuthoringJob,
  hashText,
  writeUnitAuthoringRun,
} from './studyAiUnitJobPrep';
import type { AiStudyMapProposal, AiUnitAuthoringJob } from './studyAiTypes';
import {
  validateAiUnitAuthoringJob,
  type AiUnitAuthoringValidationContext,
} from './studyAiUnitJobValidation';
import {
  inspectPreparedRunLayout,
  summarizeJobDistributions,
  type PreparedRunLayout,
  type UnitPreflightDistributions,
} from './studyAiUnitPreflightReport';

/* ------------------------------------------------------------------ *
 * Frozen preflight constants                                          *
 * ------------------------------------------------------------------ */

export const FROZEN_UNIT_PREFLIGHT_RUN_ID = 'ai-units-2026-09-02-frozen-map-v4-preflight';
export const FROZEN_UNIT_PREFLIGHT_DATE_TAG = '20260902';
export const FROZEN_UNIT_PREFLIGHT_GENERATED_AT = '2026-09-02T00:00:00.000Z';
export const FROZEN_UNIT_PROMPT_SPEC_VERSION = 'unit-authoring-v4';
export const FROZEN_UNIT_PREFLIGHT_BATCH_SIZE = 20;
export const FROZEN_UNIT_PREFLIGHT_PROVIDER_KIND = 'local-openai-compatible' as const;
export const FROZEN_UNIT_JOB_TYPE = 'unit-authoring' as const;

/**
 * Report filename version tag for preflight-family outputs: '' under the
 * default v4 spec (so v4 artifacts keep their exact historical names) and
 * the spec suffix (e.g. 'v5') for newer specs so a v5 preflight emits
 * `unit-authoring-preflight-v5-<dateTag>.*` instead of overwriting v4
 * artifacts.
 */
export const unitAuthoringReportVersionTag = (promptSpecVersion: string): string => {
  if (promptSpecVersion === FROZEN_UNIT_PROMPT_SPEC_VERSION) return '';
  const suffix = promptSpecVersion.replace(/^unit-authoring-/, '');
  return suffix !== promptSpecVersion ? suffix : '';
};

export type FrozenUnitPreflightOptions = {
  /** Freeze report path (default: tracked reports/study-map-final-freeze-*.json). */
  freezeReportPath?: string;
  /** Canonical frozen map run directory (default: canonicalRunDir()). */
  runDir?: string;
  /** Final human decision file used by the freeze gate. */
  decisionFilePath?: string;
  /** Corpus content package path. */
  corpusPackagePath?: string;
  /** New run id. */
  runId?: string;
  /** Root the prepared run is written under (default study-content/ai/runs). */
  runDirRoot?: string;
  /** Unit default batch size. */
  batchSize?: number;
  /** Fixed run.json createdAt/updatedAt (no wall-clock). */
  generatedAt?: string;
  dateTag?: string;
  /** Unit authoring prompt spec version stamped on jobs / run.json / reports
   *  (default FROZEN_UNIT_PROMPT_SPEC_VERSION, 'unit-authoring-v4'). */
  promptSpecVersion?: string;
  /** Freeze-gate expectations (defaults to the frozen constants; synthetic
   *  fixtures override them). */
  expectedResultRows?: number;
  expectedPriorityDistribution?: Record<string, number>;
  groupingCorrectionJobIds?: string[];
};

/* ------------------------------------------------------------------ *
 * Eligibility                                                         *
 * ------------------------------------------------------------------ */

export type FrozenProposalEligibility = {
  proposal: AiStudyMapProposal;
  disposition: AiStudyMapProposal['disposition'];
  grouped: boolean;
  reviewStatus: AiStudyMapProposal['reviewStatus'];
  validationStatus: AiStudyMapProposal['validationStatus'];
  provenanceClass: ProvenanceClass;
  groupCount: number;
  /** Eligible proposals produce one job per group. */
  eligible: boolean;
  /** Human-readable bypass/accepted reason for eligible proposals. */
  reason?: string;
  /** Fail-closed issue (eligible=false + issue ⇒ abort). */
  issue?: string;
};

const GROUPED_DISPOSITIONS = new Set(['standalone', 'split', 'combine']);
const ZERO_JOB_DISPOSITIONS = new Set(['skip', 'reference-only']);
const ACCEPTED_VALIDATION_STATUS = new Set(['valid', 'warnings']);
const ABORT_REVIEW_STATUSES = new Set(['rejected', 'stale', 'superseded', 'deferred']);

/**
 * Frozen eligibility for one canonical proposal. Skip/reference-only rows
 * contribute zero jobs; everything else is decided here. Callers aggregate
 * `issue` fields into fail-closed aborts.
 */
export const assessFrozenProposalEligibility = (
  proposal: AiStudyMapProposal,
  provenanceClass: ProvenanceClass,
): FrozenProposalEligibility => {
  const base = {
    proposal,
    disposition: proposal.disposition,
    grouped: proposal.proposedGroups.length > 0,
    reviewStatus: proposal.reviewStatus,
    validationStatus: proposal.validationStatus,
    provenanceClass,
    groupCount: proposal.proposedGroups.length,
    eligible: false,
  };
  if (ZERO_JOB_DISPOSITIONS.has(proposal.disposition)) {
    return { ...base, reason: `disposition ${proposal.disposition} produces zero jobs` };
  }
  if (!GROUPED_DISPOSITIONS.has(proposal.disposition)) {
    return {
      ...base,
      issue: `unexpected disposition ${JSON.stringify(proposal.disposition)} on the frozen run`,
    };
  }
  if (!base.grouped) {
    return {
      ...base,
      issue: `grouped disposition ${proposal.disposition} with zero proposedGroups violates the frozen result contract`,
    };
  }
  if (!ACCEPTED_VALIDATION_STATUS.has(proposal.validationStatus)) {
    return {
      ...base,
      issue: `validationStatus ${JSON.stringify(
        proposal.validationStatus,
      )} is not valid/warnings (fail closed)`,
    };
  }
  if (ABORT_REVIEW_STATUSES.has(proposal.reviewStatus)) {
    return {
      ...base,
      issue: `reviewStatus ${JSON.stringify(proposal.reviewStatus)} cannot feed unit authoring`,
    };
  }
  const reasons: string[] = [];
  if (proposal.reviewStatus === 'needs-review' || proposal.reviewStatus === 'generated') {
    const adjudicated = provenanceClass !== 'original';
    reasons.push(
      adjudicated
        ? 'reviewStatus bypass: row adjudicated (final freeze authority)'
        : 'reviewStatus bypass: row accepted into the frozen canonical state (final freeze authority)',
    );
  }
  if (proposal.conflictCodes.length > 0) {
    reasons.push(
      `conflict codes ${proposal.conflictCodes.join(',')} retained on a warnings-level frozen row; accepted under the freeze final authority`,
    );
  }
  return {
    ...base,
    eligible: true,
    reason:
      reasons.length > 0
        ? reasons.join('; ')
        : 'grouped frozen proposal (validated) accepted as approved',
  };
};

/* ------------------------------------------------------------------ *
 * Preflight result                                                    *
 * ------------------------------------------------------------------ */

export type FrozenUnitPreflightSuccess = {
  ok: true;
  stage: 'complete';
  dateTag: string;
  runId: string;
  generatedAt: string;
  sourceMapRunId: string;
  promptSpecVersion: string;
  batchSize: number;
  runDir: string;
  corpusPackagePath: string;
  corpusPackageId: string | null;
  corpusPackageSha256: string | null;
  corpusContentHash: string;
  frozenSourceIdentity: {
    freezeReportPath: string;
    freezeReportSha256: string | null;
    canonicalResultsSha256: string | null;
    proposalsSha256: string | null;
  };
  gate: FrozenMapVerification;
  equivalence: MapEquivalenceAudit;
  proposals: AiStudyMapProposal[];
  eligibilities: FrozenProposalEligibility[];
  bypasses: {
    groupedProposals: number;
    eligibleProposals: number;
    zeroJobDispositions: Record<string, number>;
    reviewStatusCounts: Record<string, number>;
    needsReviewAccepted: number;
    needsReviewAdjudicated: number;
    conflictCodedAccepted: number;
    acceptedConflictJobIds: string[];
    acceptedNeedsReviewJobIds: string[];
    bypassProposalIds: string[];
  };
  counts: {
    totalResults: number;
    groupedResults: number;
    zeroGroupResults: number;
    proposedGroups: number;
    expectedJobs: number;
    jobs: number;
  };
  cardinality: {
    uniqueJobIds: number;
    uniqueProposalGroupKeys: number;
    zeroGroupJobs: number;
    nonEligibleProposalJobs: number;
    expectedMatchesBuilt: boolean;
    everyProposalGroupOnce: boolean;
  };
  validation: { checkedJobs: number; issuesTotal: number; sampleIssues: string[] };
  jobs: AiUnitAuthoringJob[];
  distributions: UnitPreflightDistributions;
  layout: PreparedRunLayout;
};

export type FrozenUnitPreflightAbort = {
  ok: false;
  stage: 'gate' | 'equivalence' | 'eligibility' | 'validation';
  issues: string[];
  detail: unknown;
};

export type FrozenUnitPreflightResult = FrozenUnitPreflightSuccess | FrozenUnitPreflightAbort;

/* ------------------------------------------------------------------ *
 * Orchestration                                                       *
 * ------------------------------------------------------------------ */

/**
 * Run the complete deterministic preflight. Steps 1-2 and 4/7 abort
 * fail-closed; the cardinality invariants (step 6) are hard assertions and
 * throw. On success the prepared run is written and the full result (counts,
 * bypasses, distributions, layout, jobs) is returned for report building.
 */
export const runFrozenUnitPreflight = (
  opts: FrozenUnitPreflightOptions = {},
): FrozenUnitPreflightResult => {
  const freezeReportPath = opts.freezeReportPath ?? FREEZE_REPORT_REL_PATH;
  const runDir = opts.runDir ?? canonicalRunDir(FROZEN_MAP_RUN_ID);
  const decisionFilePath = opts.decisionFilePath ?? FREEZE_DECISION_FILE_REL_PATH;
  const corpusPackagePath = opts.corpusPackagePath ?? CORPUS_PACKAGE_REL_PATH;
  const runId = opts.runId ?? FROZEN_UNIT_PREFLIGHT_RUN_ID;
  const runDirRoot = opts.runDirRoot ?? RUNS_DIR_REL;
  const batchSize = opts.batchSize ?? FROZEN_UNIT_PREFLIGHT_BATCH_SIZE;
  const generatedAt = opts.generatedAt ?? FROZEN_UNIT_PREFLIGHT_GENERATED_AT;
  const dateTag = opts.dateTag ?? FROZEN_UNIT_PREFLIGHT_DATE_TAG;
  const promptSpecVersion = opts.promptSpecVersion ?? FROZEN_UNIT_PROMPT_SPEC_VERSION;

  // Step 1: freeze gate (fail closed).
  const gate = verifyFrozenStudyMap({
    freezeReportPath,
    runDir,
    decisionFilePath,
    expectedResultRows: opts.expectedResultRows,
    expectedPriorityDistribution: opts.expectedPriorityDistribution,
    groupingCorrectionJobIds: opts.groupingCorrectionJobIds,
  });
  if (!gate.ok) {
    return {
      ok: false,
      stage: 'gate',
      issues: gate.issues.map((issue) => `${issue.code}: ${issue.message}`),
      detail: gate,
    };
  }

  // Step 2: map/proposal/job equivalence audit (abort on any mismatch).
  const equivalence = auditMapProposalEquivalence({ runDir });
  if (equivalence.totalMismatches > 0) {
    return {
      ok: false,
      stage: 'equivalence',
      issues: equivalence.mismatches.map(
        (mismatch) => `${mismatch.kind}: ${mismatch.jobId} ${mismatch.detail}`,
      ),
      detail: equivalence,
    };
  }

  // Step 3: load the corpus package and the frozen proposals.
  const packageObject = readJsonFile<NbLawContentPackage>(corpusPackagePath);
  const proposals = readMapProposals(runDir);
  if (packageObject === null) {
    return {
      ok: false,
      stage: 'eligibility',
      issues: [`Cannot read or parse corpus package at ${corpusPackagePath}.`],
      detail: {},
    };
  }
  const corpusContentHash = hashText(JSON.stringify(packageObject.sourceHashes));

  // Step 4: frozen eligibility (every group sourceKey must resolve).
  const eligibilities = proposals.map((proposal) =>
    assessFrozenProposalEligibility(proposal, classifyJobProvenance(runDir, proposal.jobId)),
  );
  const eligibilityIssues = eligibilities
    .filter((entry) => entry.issue !== undefined)
    .map((entry) => `${entry.proposal.id}: ${entry.issue}`);
  if (eligibilityIssues.length > 0) {
    return {
      ok: false,
      stage: 'eligibility',
      issues: eligibilityIssues.slice(0, 20),
      detail: { total: eligibilityIssues.length },
    };
  }
  const eligible = eligibilities.filter((entry) => entry.eligible);

  // Step 5: build every job (runId fixed, frozen priority stamped, batch 20).
  const expectedJobs = eligible.reduce((total, entry) => total + entry.groupCount, 0);
  const documentsById = new Map(packageObject.documents.map((doc) => [doc.id, doc]));
  const jobs: AiUnitAuthoringJob[] = [];
  const jobKeys: Array<{ proposalId: string; groupIndex: number }> = [];
  const eligibilityByProposalId = new Map(
    eligibilities.map((entry) => [entry.proposal.id, entry]),
  );
  for (const entry of eligible) {
    const proposal = entry.proposal;
    const document = documentsById.get(proposal.document.documentId);
    if (!document) {
      return {
        ok: false,
        stage: 'eligibility',
        issues: [
          `Proposal ${proposal.id} document ${proposal.document.documentId} is missing from the corpus package.`,
        ],
        detail: {},
      };
    }
    proposal.proposedGroups.forEach((group, groupIndex) => {
      jobs.push(
        buildUnitAuthoringJob({
          proposal,
          group,
          package: packageObject,
          runId,
          promptSpecVersion,
          corpusContentHash,
          sourceMapRunId: FROZEN_MAP_RUN_ID,
          withFrozenPriority: true,
          frozenPriority: proposal.suggestedPriority ?? undefined,
        }),
      );
      jobKeys.push({ proposalId: proposal.id, groupIndex });
    });
  }

  // Step 6: cardinality invariants (hard assertions).
  assertCardinality(jobs, jobKeys, eligible, eligibilityByProposalId, expectedJobs);

  // Step 7: validate every job (abort on ANY issue, bounded list).
  const provenanceByJobId = new Map(
    eligible.map((entry) => [entry.proposal.id, entry.provenanceClass]),
  );
  const sampleIssues: string[] = [];
  let validationIssuesTotal = 0;
  jobs.forEach((job, index) => {
    const entry = eligibilityByProposalId.get(job.sourceMapProposalId);
    if (!entry) return;
    const ctx: AiUnitAuthoringValidationContext = {
      run: {
        runId,
        jobType: FROZEN_UNIT_JOB_TYPE,
        providerKind: FROZEN_UNIT_PREFLIGHT_PROVIDER_KIND,
        promptSpecVersion,
      },
      sourceMapRunId: FROZEN_MAP_RUN_ID,
      proposal: entry.proposal,
      groupIndex: jobKeys[index].groupIndex,
      package: packageObject,
      corpusContentHash,
    };
    const issues = validateAiUnitAuthoringJob(job, ctx);
    validationIssuesTotal += issues.length;
    issues.slice(0, Math.max(0, 20 - sampleIssues.length)).forEach((issue) => {
      sampleIssues.push(issue);
    });
  });
  if (validationIssuesTotal > 0) {
    return {
      ok: false,
      stage: 'validation',
      issues: sampleIssues.slice(0, 20),
      detail: { checkedJobs: jobs.length, total: validationIssuesTotal },
    };
  }

  // Step 8: write the prepared run (fixed generatedAt, prepared state).
  const newRunDir = join(runDirRoot, runId);
  writeUnitAuthoringRun({
    runDir: newRunDir,
    jobs,
    batchSize,
    meta: {
      runId,
      sourceMapRunId: FROZEN_MAP_RUN_ID,
      promptSpecVersion,
      createdAt: generatedAt,
      updatedAt: generatedAt,
      corpusContentHash,
      providerKind: FROZEN_UNIT_PREFLIGHT_PROVIDER_KIND,
      sourcePackageId: packageObject.id,
      notes: `Prepared from frozen Study Map run ${FROZEN_MAP_RUN_ID} (dateTag ${dateTag}); ${jobs.length} unit jobs, all validated.`,
    },
  });

  const bypasses = summarizeBypasses(eligibilities);
  const groupedResults = eligibilities.filter((entry) => entry.grouped).length;
  const zeroGroupResults = eligibilities.length - groupedResults;
  const proposedGroups = eligibilities.reduce((total, entry) => total + entry.groupCount, 0);

  return {
    ok: true,
    stage: 'complete',
    dateTag,
    runId,
    generatedAt,
    sourceMapRunId: FROZEN_MAP_RUN_ID,
    promptSpecVersion,
    batchSize,
    runDir: newRunDir,
    corpusPackagePath,
    corpusPackageId: packageObject.id,
    corpusPackageSha256: sha256File(corpusPackagePath),
    corpusContentHash,
    frozenSourceIdentity: {
      freezeReportPath,
      freezeReportSha256: sha256File(freezeReportPath),
      canonicalResultsSha256: sha256File(join(runDir, CANONICAL_RESULTS_REL_PATH)),
      proposalsSha256: sha256File(join(runDir, MAP_PROPOSALS_REL_PATH)),
    },
    gate,
    equivalence,
    proposals,
    eligibilities,
    bypasses,
    counts: {
      totalResults: eligibilities.length,
      groupedResults,
      zeroGroupResults,
      proposedGroups,
      expectedJobs,
      jobs: jobs.length,
    },
    cardinality: {
      uniqueJobIds: new Set(jobs.map((job) => job.jobId)).size,
      uniqueProposalGroupKeys: new Set(
        jobKeys.map((key) => `${key.proposalId}::${key.groupIndex}`),
      ).size,
      zeroGroupJobs: jobs.filter((job) => job.approvedGroup.sourceKeys.length === 0).length,
      nonEligibleProposalJobs: jobs.filter(
        (job) => !eligibilityByProposalId.get(job.sourceMapProposalId)?.eligible,
      ).length,
      expectedMatchesBuilt: jobs.length === expectedJobs,
      everyProposalGroupOnce:
        jobs.length === expectedJobs &&
        new Set(jobKeys.map((key) => `${key.proposalId}::${key.groupIndex}`)).size === jobs.length,
    },
    validation: {
      checkedJobs: jobs.length,
      issuesTotal: validationIssuesTotal,
      sampleIssues,
    },
    jobs,
    distributions: summarizeJobDistributions(jobs, provenanceByJobId),
    layout: inspectPreparedRunLayout(newRunDir, batchSize, jobs.length),
  };
};

/* ------------------------------------------------------------------ *
 * Bypass accounting + cardinality                                     *
 * ------------------------------------------------------------------ */

const countUp = (counts: Record<string, number>, key: string): void => {
  counts[key] = (counts[key] ?? 0) + 1;
};

const summarizeBypasses = (
  eligibilities: FrozenProposalEligibility[],
): FrozenUnitPreflightSuccess['bypasses'] => {
  const zeroJobDispositions: Record<string, number> = {};
  const reviewStatusCounts: Record<string, number> = {};
  const eligible = eligibilities.filter((entry) => entry.eligible);
  for (const entry of eligibilities) {
    if (entry.groupCount === 0) countUp(zeroJobDispositions, entry.disposition);
    countUp(reviewStatusCounts, entry.reviewStatus);
  }
  const acceptedConflictJobIds: string[] = [];
  const acceptedNeedsReviewJobIds: string[] = [];
  const bypassProposalIds: string[] = [];
  let conflictCodedAccepted = 0;
  let needsReviewAccepted = 0;
  let needsReviewAdjudicated = 0;
  for (const entry of eligible) {
    const adjudicated = entry.provenanceClass !== 'original';
    if (entry.reviewStatus !== 'approved') {
      bypassProposalIds.push(entry.proposal.id);
      if (entry.reviewStatus === 'needs-review' || entry.reviewStatus === 'generated') {
        needsReviewAccepted += 1;
        if (adjudicated) needsReviewAdjudicated += 1;
        acceptedNeedsReviewJobIds.push(entry.proposal.jobId);
      }
    }
    if (entry.proposal.conflictCodes.length > 0) {
      conflictCodedAccepted += 1;
      acceptedConflictJobIds.push(entry.proposal.jobId);
    }
  }
  return {
    groupedProposals: eligibilities.filter((entry) => entry.grouped).length,
    eligibleProposals: eligible.length,
    zeroJobDispositions,
    reviewStatusCounts,
    needsReviewAccepted,
    needsReviewAdjudicated,
    conflictCodedAccepted,
    acceptedConflictJobIds,
    acceptedNeedsReviewJobIds,
    bypassProposalIds,
  };
};

const assertCardinality = (
  jobs: AiUnitAuthoringJob[],
  jobKeys: Array<{ proposalId: string; groupIndex: number }>,
  eligible: FrozenProposalEligibility[],
  eligibilityByProposalId: Map<string, FrozenProposalEligibility>,
  expectedJobs: number,
): void => {
  if (jobs.length !== expectedJobs) {
    throw new Error(
      `Cardinality violation: expected ${expectedJobs} unit jobs from ${eligible.length} eligible proposals, built ${jobs.length}.`,
    );
  }
  const jobIds = new Set(jobs.map((job) => job.jobId));
  if (jobIds.size !== jobs.length) {
    throw new Error(
      `Cardinality violation: ${jobs.length} jobs contain ${jobs.length - jobIds.size} duplicate jobIds.`,
    );
  }
  const proposalGroupKeys = new Set(jobKeys.map((key) => `${key.proposalId}::${key.groupIndex}`));
  if (proposalGroupKeys.size !== jobs.length) {
    throw new Error(
      `Cardinality violation: expected every (proposalId, groupIndex) to appear exactly once; found ${proposalGroupKeys.size} unique keys for ${jobs.length} jobs.`,
    );
  }
  for (const job of jobs) {
    const entry = eligibilityByProposalId.get(job.sourceMapProposalId);
    if (!entry?.eligible) {
      throw new Error(
        `Cardinality violation: job ${job.jobId} references non-eligible proposal ${job.sourceMapProposalId}.`,
      );
    }
    if (job.approvedGroup.sourceKeys.length === 0) {
      throw new Error(`Cardinality violation: zero-source group produced job ${job.jobId}.`);
    }
  }
  const expectedProposalIds = eligible.map((entry) => entry.proposal.id).sort();
  const builtProposalIds = [...new Set(jobKeys.map((key) => key.proposalId))].sort();
  if (!isDeepStrictEqual(expectedProposalIds, builtProposalIds)) {
    throw new Error('Cardinality violation: job proposal id set differs from the eligible proposal set.');
  }
};
