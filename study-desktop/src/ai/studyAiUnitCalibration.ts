/**
 * Frozen Study Map → Unit Authoring calibration-80 SELECTION.
 *
 * Deterministic, importable, no wall-clock. Reads no files itself: the
 * orchestration in `studyAiUnitCalibrationRun.ts` feeds it the preflight
 * jobs (4,251), the corpus package, the frozen map proposals, and a
 * provenance classifier; report rendering lives in
 * `studyAiUnitCalibrationReport.ts`.
 *
 * Selection pipeline (hard pins first, then targets, then deterministic
 * fill; dedupe by unit jobId — one job may carry several tags):
 *   1. Grouping-adjudication pins (20): every unit job whose parent map
 *      jobId is in `FROZEN_GROUPING_CORRECTION_JOB_IDS` except the Service NB
 *      Act s.56 skip (zero groups → zero jobs).
 *   2. Retry-nine representatives: one unit job per permanently-failed map
 *      target (`FROZEN_RETRY_TARGETS`), resolved through the corpus package
 *      (document title + section number in the component label) to the
 *      frozen proposal(s) whose `targetSourceKeys` include that sourceKey,
 *      then to the first approved-group job of the parent by jobId.
 *   3. Regression anchors (`FROZEN_REGRESSION_ANCHORS`), same resolution
 *      method; OH&S s.9 legitimately satisfies both sets (tags stack, job
 *      counted once).
 *   4. Deterministic fill to exactly 80 with PURE ORDERING (no RNG): while a
 *      priority is under target pick, scanning the remaining pool in stable
 *      jobId order, the job of that priority with the best
 *      (domain-deficit desc, domain rank asc, not-yet-covered feature gain
 *      desc, stable index asc) score. Priorities are INHERITED from
 *      `frozenMapPriority`; never modified.
 *
 * Per-job features (tags) are extracted deterministically from the job
 * payload (see `buildUnitCalibrationJobTags`): no provider calls, no
 * wall-clock output anywhere. Pure logic — importable by tests.
 */
import type { NbLawContentPackage, NbLawDocumentComponent } from '../content/nbLawTypes';
import { FROZEN_GROUPING_CORRECTION_JOB_IDS } from './studyAiMapFreezeGate';
import { type ProvenanceClass } from './studyAiUnitInventory';
import {
  DOMAIN_ORDER,
  buildUnitCalibrationJobTags,
  classifyDomainByDocumentTitle,
  normalizeTitle,
  unionTags,
  unitSourceSizeBucket,
  type UnitCalibrationDomain,
} from './studyAiUnitCalibrationFeatures';
import type { AiStudyMapProposal, AiSuggestedPriority, AiUnitAuthoringJob } from './studyAiTypes';

/* ------------------------------------------------------------------ *
 * Frozen calibration constants                                       *
 * ------------------------------------------------------------------ */

export const UNIT_CALIBRATION_RUN_ID = 'ai-units-2026-09-02-frozen-map-cal80-v4';
export const UNIT_CALIBRATION_DATE_TAG = '20260902';
export const UNIT_CALIBRATION_SEED_TAG = '20260902';
export const UNIT_CALIBRATION_GENERATED_AT = '2026-09-02T00:00:00.000Z';
export const UNIT_CALIBRATION_BATCH_SIZE = 8;
export const UNIT_CALIBRATION_PROVIDER_KIND = 'local-openai-compatible' as const;
export const UNIT_CALIBRATION_TOTAL = 80;

export const CALIBRATION_PRIORITY_TARGETS: Record<AiSuggestedPriority, number> = {
  P1: 24,
  P2: 28,
  P3: 20,
  P4: 8,
};

export const CALIBRATION_DOMAIN_TARGETS: Record<UnitCalibrationDomain, number> = {
  core: 34,
  cadastral: 28,
  adjacent: 18,
};

/** One frozen map target resolved through the corpus (title + section label). */
export type UnitCalibrationTargetSpec = {
  targetId: string;
  documentTitle: string;
  sectionLabel: string;
};

/** The nine permanently-failed map targets (final-production-retry-9 set). */
export const FROZEN_RETRY_TARGETS: readonly UnitCalibrationTargetSpec[] = [
  { targetId: 'Assessment Act s.15.3', documentTitle: 'Assessment Act', sectionLabel: '15.3' },
  { targetId: 'Community Planning Act s.1', documentTitle: 'Community Planning Act', sectionLabel: '1' },
  { targetId: 'Community Planning Act s.75', documentTitle: 'Community Planning Act', sectionLabel: '75' },
  { targetId: 'Gas Distribution Act s.52', documentTitle: 'Gas Distribution Act, 1999', sectionLabel: '52' },
  { targetId: 'Mining Act s.68', documentTitle: 'Mining Act', sectionLabel: '68' },
  { targetId: 'Municipalities Act s.100', documentTitle: 'Municipalities Act', sectionLabel: '100' },
  { targetId: 'Occupational Health and Safety Act s.9', documentTitle: 'Occupational Health and Safety Act', sectionLabel: '9' },
  { targetId: 'Property Act s.44', documentTitle: 'Property Act', sectionLabel: '44' },
  { targetId: 'Registry Act s.44', documentTitle: 'Registry Act', sectionLabel: '44' },
];

/** Final frozen descendants required as v4 unit regression anchors. */
export const FROZEN_REGRESSION_ANCHORS: readonly UnitCalibrationTargetSpec[] = [
  { targetId: 'Boundaries Confirmation Act s.10', documentTitle: 'Boundaries Confirmation Act', sectionLabel: '10' },
  { targetId: 'Surveys Act s.1', documentTitle: 'Surveys Act', sectionLabel: '1' },
  { targetId: 'Land Titles Act s.18', documentTitle: 'Land Titles Act', sectionLabel: '18' },
  { targetId: 'Registry Act s.19', documentTitle: 'Registry Act', sectionLabel: '19' },
  { targetId: 'Regulation 95-166 s.3', documentTitle: 'REGULATION 95-166', sectionLabel: '3' },
  { targetId: 'Community Planning Act s.125', documentTitle: 'Community Planning Act', sectionLabel: '125' },
  // Same frozen target as the retry-nine OH&S s.9 row: tags stack, job counts once.
  { targetId: 'Occupational Health and Safety Act s.9', documentTitle: 'Occupational Health and Safety Act', sectionLabel: '9' },
];

export const SELECTION_TAG_GROUPING_ADJUDICATION = 'final-map-grouping-adjudication';
export const SELECTION_TAG_RETRY_HISTORY = 'map-retry-history';
export const SELECTION_TAG_REGRESSION_ANCHOR = 'unit-v4-regression-anchor';

export type UnitCalibrationSelectionReason = 'pin' | 'retry' | 'anchor' | 'fill-priority' | 'fill-coverage';

export type UnitCalibrationJobRecord = {
  index: number;
  unitJobId: string;
  mapJobId: string;
  sourceMapProposalId: string;
  documentId: string;
  documentTitle: string;
  sections: string[];
  priority: AiSuggestedPriority | null;
  disposition: string;
  parentKind: string;
  domain: UnitCalibrationDomain;
  groupTitle: string;
  groupGoal: string;
  sourceKeys: string[];
  sourceKeyCount: number;
  exactSourceCharacters: number;
  sizeBucket: string;
  focusStyle: 'none' | 'single' | 'multiple';
  provenance: ProvenanceClass;
  tags: string[];
  selectionReason: UnitCalibrationSelectionReason;
  correction: boolean;
  retry: boolean;
  regression: boolean;
  retryTargetId?: string;
  anchorTargetId?: string;
};

export type UnitCalibrationSelectionNote = {
  code: string;
  message: string;
};

/* ------------------------------------------------------------------ *
 * Pure in-memory selection                                           *
 * ------------------------------------------------------------------ */

const TEXT_LIMIT = 180;

const clipText = (value: string | undefined, limit: number): string => {
  if (value === undefined) return '';
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
};

export type SelectCalibrationJobsArgs = {
  /** Every prepared preflight job (dedupe by unit jobId). */
  jobs: AiUnitAuthoringJob[];
  package: NbLawContentPackage;
  /** Frozen map proposals indexed by `id`. */
  proposals: AiStudyMapProposal[];
  /** Parent map jobIds of the grouping-adjudication pins. */
  groupingCorrectionJobIds?: readonly string[];
  retryTargets?: readonly UnitCalibrationTargetSpec[];
  regressionAnchors?: readonly UnitCalibrationTargetSpec[];
  priorityTargets?: Record<AiSuggestedPriority, number>;
  domainTargets?: Record<UnitCalibrationDomain, number>;
  /** Deterministic provenance classifier for one parent map jobId. */
  provenanceOfMapJob: (_mapJobId: string) => ProvenanceClass;
};

export type UnitCalibrationSelection = {
  ok: boolean;
  issues: string[];
  notes: UnitCalibrationSelectionNote[];
  selected: AiUnitAuthoringJob[];
  records: UnitCalibrationJobRecord[];
  priorityActual: Record<string, number>;
  domainActual: Record<string, number>;
  pinJobIds: string[];
  retryTargetCoverage: Array<{ targetId: string; unitJobId: string | null; note?: string }>;
  anchorTargetCoverage: Array<{ targetId: string; unitJobId: string | null; note?: string }>;
};

const countBy = (records: readonly UnitCalibrationJobRecord[], key: 'priority' | 'domain'): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const record of records) {
    const value = key === 'priority' ? (record.priority ?? 'null') : record.domain;
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
};

/**
 * Deterministic fill score. Lower is better. Compare candidates of one
 * priority class by: (1) domain deficit desc — most under-target domain
 * first; (2) domain rank asc; (3) not-yet-covered feature gain desc;
 * (4) stable pool index asc (jobId-sorted pool). Pure ordering, no RNG.
 */
const fillScore = (
  jobIndex: number,
  domainDeficit: number,
  domainRank: number,
  featureGain: number,
): [number, number, number, number] => [-domainDeficit, domainRank, -featureGain, jobIndex];

export const selectCalibrationJobs = (args: SelectCalibrationJobsArgs): UnitCalibrationSelection => {
  const ctx = buildSelectContext(args);
  const pinJobIds = selectGroupingAdjudicationPins(ctx);
  selectRetryNineRepresentatives(ctx);
  selectRegressionAnchorRepresentatives(ctx);
  fillToPriorityTargets(ctx);
  const records = buildCalibrationRecords(ctx);
  const targetTotal = Object.values(ctx.priorityTargets).reduce((t, v) => t + v, 0);
  if (ctx.selected.length !== targetTotal) {
    ctx.issues.push(
      `Selection produced ${ctx.selected.length} jobs; expected exactly ${targetTotal}.`,
    );
  }
  const PRIORITY_ORDER: readonly AiSuggestedPriority[] = ['P1', 'P2', 'P3', 'P4'];
  for (const priority of PRIORITY_ORDER) {
    const actual = ctx.selected.filter((job) => job.frozenMapPriority === priority).length;
    const target = ctx.priorityTargets[priority];
    if (actual !== target) {
      ctx.issues.push(`Priority target not met for ${priority}: selected ${actual}, target ${target}.`);
    }
  }
  return {
    ok: ctx.issues.length === 0,
    issues: ctx.issues,
    notes: ctx.notes,
    selected: ctx.selected,
    records,
    priorityActual: countBy(records, 'priority'),
    domainActual: countBy(records, 'domain'),
    pinJobIds,
    retryTargetCoverage: ctx.retryTargets.map((target) => ({
      targetId: target.targetId,
      unitJobId: ctx.retryTargetsCovered.get(target.targetId) ?? null,
    })),
    anchorTargetCoverage: ctx.regressionAnchors.map((target) => ({
      targetId: target.targetId,
      unitJobId: ctx.anchorTargetsCovered.get(target.targetId) ?? null,
    })),
  };
};

/* ------------------------------------------------------------------ *
 * Selection context and phase helpers                                *
 * ------------------------------------------------------------------ */

type CalibrationSelectContext = {
  groupingCorrectionJobIds: readonly string[];
  retryTargets: readonly UnitCalibrationTargetSpec[];
  regressionAnchors: readonly UnitCalibrationTargetSpec[];
  priorityTargets: Record<AiSuggestedPriority, number>;
  domainTargets: Record<UnitCalibrationDomain, number>;
  provenanceOfMapJob: (_mapJobId: string) => ProvenanceClass;
  issues: string[];
  notes: UnitCalibrationSelectionNote[];
  package: NbLawContentPackage;
  proposals: AiStudyMapProposal[];
  pool: AiUnitAuthoringJob[];
  poolIndex: (_job: AiUnitAuthoringJob) => number;
  parentMapJobId: (_job: AiUnitAuthoringJob) => string;
  jobsOfParent: Map<string, AiUnitAuthoringJob[]>;
  jobFeatures: Map<string, string[]>;
  jobCoverageTags: (_job: AiUnitAuthoringJob) => string[];
  sectionOf: (_sourceKey: string) => string;
  selected: AiUnitAuthoringJob[];
  selectedIds: Set<string>;
  extraTags: Map<string, string[]>;
  reasons: Map<string, UnitCalibrationSelectionReason>;
  retryTargetsCovered: Map<string, string>;
  anchorTargetsCovered: Map<string, string>;
  coveredFeatures: Set<string>;
};

const buildSelectContext = (args: SelectCalibrationJobsArgs): CalibrationSelectContext => {
  const pool = [...args.jobs].sort((a, b) => (a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0));
  const poolIndexById = new Map(pool.map((job, index) => [job.jobId, index]));
  const poolIndex = (job: AiUnitAuthoringJob): number =>
    poolIndexById.get(job.jobId) ?? Number.MAX_SAFE_INTEGER;
  const componentsByKey = new Map<string, NbLawDocumentComponent>();
  for (const doc of args.package.documents) {
    for (const component of doc.components) componentsByKey.set(component.sourceKey, component);
  }
  const sectionOf = (sourceKey: string): string =>
    componentsByKey.get(sourceKey)?.label ?? sourceKey.split(':').pop() ?? sourceKey;
  const parentMapJobId = (job: AiUnitAuthoringJob): string =>
    job.sourceMapProposalId.split(':').pop() ?? job.sourceMapProposalId;
  const jobsOfParent = new Map<string, AiUnitAuthoringJob[]>();
  for (const job of pool) {
    const parent = parentMapJobId(job);
    const list = jobsOfParent.get(parent) ?? [];
    list.push(job);
    jobsOfParent.set(parent, list);
  }
  const jobFeatures = new Map<string, string[]>();
  for (const job of pool) jobFeatures.set(job.jobId, buildUnitCalibrationJobTags(job));
  const provenanceCache = new Map<string, ProvenanceClass>();
  const provenanceOf = (mapJobId: string): ProvenanceClass => {
    const cached = provenanceCache.get(mapJobId);
    if (cached !== undefined) return cached;
    const value = args.provenanceOfMapJob(mapJobId);
    provenanceCache.set(mapJobId, value);
    return value;
  };
  const jobCoverageTags = (job: AiUnitAuthoringJob): string[] =>
    unionTags(jobFeatures.get(job.jobId) ?? [], [`prov-${provenanceOf(parentMapJobId(job))}`]);
  return {
    groupingCorrectionJobIds:
      args.groupingCorrectionJobIds ?? FROZEN_GROUPING_CORRECTION_JOB_IDS,
    retryTargets: args.retryTargets ?? FROZEN_RETRY_TARGETS,
    regressionAnchors: args.regressionAnchors ?? FROZEN_REGRESSION_ANCHORS,
    priorityTargets: args.priorityTargets ?? CALIBRATION_PRIORITY_TARGETS,
    domainTargets: args.domainTargets ?? CALIBRATION_DOMAIN_TARGETS,
    provenanceOfMapJob: args.provenanceOfMapJob,
    issues: [],
    notes: [],
    package: args.package,
    proposals: args.proposals,
    pool,
    poolIndex,
    parentMapJobId,
    jobsOfParent,
    jobFeatures,
    jobCoverageTags,
    sectionOf,
    selected: [],
    selectedIds: new Set<string>(),
    extraTags: new Map<string, string[]>(),
    reasons: new Map<string, UnitCalibrationSelectionReason>(),
    retryTargetsCovered: new Map<string, string>(),
    anchorTargetsCovered: new Map<string, string>(),
    coveredFeatures: new Set<string>(),
  };
};

const addSelected = (
  ctx: CalibrationSelectContext,
  job: AiUnitAuthoringJob,
  reason: UnitCalibrationSelectionReason,
  tags: readonly string[],
): void => {
  if (ctx.selectedIds.has(job.jobId)) return;
  ctx.selectedIds.add(job.jobId);
  ctx.selected.push(job);
  ctx.reasons.set(job.jobId, reason);
  ctx.extraTags.set(job.jobId, [...tags]);
  for (const tag of ctx.jobCoverageTags(job)) ctx.coveredFeatures.add(tag);
};

const tagSelected = (ctx: CalibrationSelectContext, job: AiUnitAuthoringJob, tags: readonly string[]): void => {
  if (!ctx.selectedIds.has(job.jobId)) return;
  const existing = ctx.extraTags.get(job.jobId) ?? [];
  ctx.extraTags.set(job.jobId, unionTags(existing, tags));
};

/** Phase 1: every unit job of a grouping-adjudication correction parent. */
const selectGroupingAdjudicationPins = (ctx: CalibrationSelectContext): string[] => {
  const correctionIds = ctx.groupingCorrectionJobIds;
  const pinMapJobIds = correctionIds.filter(
    (mapJobId) => (ctx.jobsOfParent.get(mapJobId)?.length ?? 0) > 0,
  );
  for (const mapJobId of pinMapJobIds) {
    for (const job of ctx.jobsOfParent.get(mapJobId) ?? []) {
      addSelected(ctx, job, 'pin', [SELECTION_TAG_GROUPING_ADJUDICATION]);
    }
  }
  if (pinMapJobIds.length !== correctionIds.length) {
    ctx.notes.push({
      code: 'pin-zero-jobs',
      message: `Grouping-correction map job(s) with zero unit jobs (expected for a skip correction, e.g. Service NB Act s.56): ${correctionIds
        .filter((mapJobId) => !pinMapJobIds.includes(mapJobId))
        .join(', ')}.`,
    });
  }
  return [...ctx.selectedIds];
};

/** Phases 2-3: one unit job per retry/regression target (dedupe; stack). */
const selectRetryNineRepresentatives = (ctx: CalibrationSelectContext): void => {
  for (const target of ctx.retryTargets) {
    const rep = representativeOfTarget(
      target,
      ctx.package,
      ctx.proposals,
      ctx.jobsOfParent,
      ctx.selectedIds,
      ctx.notes,
      'retry',
    );
    if (rep === null) {
      ctx.retryTargetsCovered.delete(target.targetId);
      continue;
    }
    addSelected(ctx, rep, 'retry', [SELECTION_TAG_RETRY_HISTORY]);
    ctx.retryTargetsCovered.set(target.targetId, rep.jobId);
  }
};

const selectRegressionAnchorRepresentatives = (ctx: CalibrationSelectContext): void => {
  for (const target of ctx.regressionAnchors) {
    const rep = representativeOfTarget(
      target,
      ctx.package,
      ctx.proposals,
      ctx.jobsOfParent,
      ctx.selectedIds,
      ctx.notes,
      'anchor',
    );
    if (rep === null) {
      ctx.anchorTargetsCovered.delete(target.targetId);
      continue;
    }
    addSelected(ctx, rep, 'anchor', [SELECTION_TAG_REGRESSION_ANCHOR]);
    tagSelected(ctx, rep, [SELECTION_TAG_REGRESSION_ANCHOR]);
    ctx.anchorTargetsCovered.set(target.targetId, rep.jobId);
  }
};

const priorityCountsOf = (ctx: CalibrationSelectContext): Record<AiSuggestedPriority, number> => {
  const counts: Record<AiSuggestedPriority, number> = { P1: 0, P2: 0, P3: 0, P4: 0 };
  for (const job of ctx.selected) {
    const priority = job.frozenMapPriority;
    if (priority !== undefined) counts[priority] += 1;
  }
  return counts;
};

const domainCountsOf = (ctx: CalibrationSelectContext): Record<UnitCalibrationDomain, number> => {
  const counts: Record<UnitCalibrationDomain, number> = { core: 0, cadastral: 0, adjacent: 0 };
  for (const job of ctx.selected) {
    counts[classifyDomainByDocumentTitle(job.document.title)] += 1;
  }
  return counts;
};

/**
 * Best candidate of one priority class for the fill: scan the remaining pool
 * in stable jobId order and keep the lowest (domain-deficit desc, domain rank
 * asc, uncovered-feature gain desc, stable index asc) score.
 */
const pickFillJob = (
  ctx: CalibrationSelectContext,
  priority: AiSuggestedPriority,
): AiUnitAuthoringJob | null => {
  const domainTargets = ctx.domainTargets;
  const domains = domainCountsOf(ctx);
  const candidates: Array<{ job: AiUnitAuthoringJob; index: number; score: [number, number, number, number] }> = [];
  for (const job of ctx.pool) {
    if (ctx.selectedIds.has(job.jobId)) continue;
    if (job.frozenMapPriority !== priority) continue;
    const domain = classifyDomainByDocumentTitle(job.document.title);
    const deficit = domainTargets[domain] - domains[domain];
    const rank = DOMAIN_ORDER.indexOf(domain);
    const gain = ctx.jobCoverageTags(job).filter((tag) => !ctx.coveredFeatures.has(tag)).length;
    candidates.push({
      job,
      index: ctx.poolIndex(job),
      score: fillScore(ctx.poolIndex(job), deficit, rank, gain),
    });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    for (let i = 0; i < a.score.length; i += 1) {
      if (a.score[i] !== b.score[i]) return a.score[i] - b.score[i];
    }
    return 0;
  });
  return candidates[0].job;
};

/** Phase 4: fill deficits per priority (P1→P2→P3→P4 order) to the targets. */
const fillToPriorityTargets = (ctx: CalibrationSelectContext): void => {
  const priorityTargets = ctx.priorityTargets;
  const deficits = (): AiSuggestedPriority[] => {
    const counts = priorityCountsOf(ctx);
    return PRIORITY_ORDER_FILL.filter((priority) => counts[priority] < priorityTargets[priority]);
  };
  for (let guard = 0; guard < 1000; guard += 1) {
    const current = deficits();
    if (current.length === 0) return;
    let progressed = false;
    for (const priority of current) {
      const job = pickFillJob(ctx, priority);
      if (job === null) continue;
      const gain = ctx.jobCoverageTags(job).filter((tag) => !ctx.coveredFeatures.has(tag)).length;
      addSelected(ctx, job, gain > 0 ? 'fill-coverage' : 'fill-priority', []);
      progressed = true;
    }
    if (!progressed) {
      ctx.notes.push({
        code: 'fill-pool-exhausted',
        message: 'Fill could not reach the priority targets (pool exhausted).',
      });
      return;
    }
  }
};

const PRIORITY_ORDER_FILL: readonly AiSuggestedPriority[] = ['P1', 'P2', 'P3', 'P4'];

/** Deterministic per-job record for one selected job. */
const toCalibrationRecord = (
  ctx: CalibrationSelectContext,
  job: AiUnitAuthoringJob,
  index: number,
): UnitCalibrationJobRecord => {
  const mapJobId = ctx.parentMapJobId(job);
  const group = job.approvedGroup;
  const provenanceClass = ctx.provenanceOfMapJob(mapJobId);
  const features = ctx.jobFeatures.get(job.jobId) ?? [];
  const tags = unionTags(features, [`prov-${provenanceClass}`], ctx.extraTags.get(job.jobId) ?? []);
  const retryTargetId = [...ctx.retryTargetsCovered.entries()].find(([, jobId]) => jobId === job.jobId)?.[0];
  const anchorTargetId = [...ctx.anchorTargetsCovered.entries()].find(([, jobId]) => jobId === job.jobId)?.[0];
  const reason = ctx.reasons.get(job.jobId) ?? 'fill-priority';
  const focusCount = group.focusSelections.length;
  const focusStyle: UnitCalibrationJobRecord['focusStyle'] =
    focusCount === 0 ? 'none' : focusCount === 1 ? 'single' : 'multiple';
  return {
    index: index + 1,
    unitJobId: job.jobId,
    mapJobId,
    sourceMapProposalId: job.sourceMapProposalId,
    documentId: job.document.documentId,
    documentTitle: job.document.title.replace(/\s+/g, ' ').trim(),
    sections: [...new Set(group.sourceKeys.map(ctx.sectionOf))],
    priority: job.frozenMapPriority ?? null,
    disposition: job.mapDisposition,
    parentKind: job.mapDisposition,
    domain: classifyDomainByDocumentTitle(job.document.title),
    groupTitle: clipText(group.titleSuggestion ?? '', TEXT_LIMIT),
    groupGoal: clipText(group.approximateLearningGoal ?? '', TEXT_LIMIT),
    sourceKeys: [...group.sourceKeys],
    sourceKeyCount: group.sourceKeys.length,
    exactSourceCharacters: job.exactSourceText.length,
    sizeBucket: unitSourceSizeBucket(job.exactSourceText.length),
    focusStyle,
    provenance: provenanceClass,
    tags,
    selectionReason: reason,
    correction: tags.includes(SELECTION_TAG_GROUPING_ADJUDICATION),
    retry: tags.includes(SELECTION_TAG_RETRY_HISTORY),
    regression: tags.includes(SELECTION_TAG_REGRESSION_ANCHOR),
    ...(retryTargetId !== undefined ? { retryTargetId } : {}),
    ...(anchorTargetId !== undefined ? { anchorTargetId } : {}),
  };
};

const buildCalibrationRecords = (ctx: CalibrationSelectContext): UnitCalibrationJobRecord[] =>
  ctx.selected.map((job, index) => toCalibrationRecord(ctx, job, index));

/**
 * Pick one unit job for a resolved frozen target (retry target or regression
 * anchor). Resolution: find the frozen proposals whose `targetSourceKeys`
 * include the corpus component of (document title + section label), then
 * choose the parent's first approved-group unit job by jobId. If a job of
 * that parent is ALREADY selected (e.g. OH&S s.9 satisfying both the retry
 * set and the anchor set), that job is reused so the tags stack and the job
 * is counted once. Returns null (with a note) when the target has no unit
 * job with approved groups.
 */
const representativeOfTarget = (
  target: UnitCalibrationTargetSpec,
  packageObject: NbLawContentPackage,
  proposals: AiStudyMapProposal[],
  jobsOfParent: Map<string, AiUnitAuthoringJob[]>,
  selectedIds: Set<string>,
  notes: UnitCalibrationSelectionNote[],
  kind: 'retry' | 'anchor',
): AiUnitAuthoringJob | null => {
  const parents = resolveTargetParents(target, packageObject, proposals, notes, kind);
  for (const parent of parents) {
    const candidates = jobsOfParent.get(parent) ?? [];
    if (candidates.length === 0) continue;
    const alreadySelected = candidates.find((job) => selectedIds.has(job.jobId));
    if (alreadySelected !== undefined) return alreadySelected;
    return candidates[0];
  }
  if (parents.length > 0) {
    notes.push({
      code: `${kind}-no-unit-job`,
      message: `${kind === 'retry' ? 'Retry target' : 'Regression anchor'} ${target.targetId} has no unit job with approved groups in the prepared run.`,
    });
  }
  return null;
};

/**
 * Resolve one frozen target (document title + section label) through the
 * corpus package to the frozen map proposals whose `targetSourceKeys` include
 * the resolved component sourceKey. Returns an empty list (with a note) when
 * the document/component is missing or no proposal targets it.
 */
const resolveTargetParents = (
  target: UnitCalibrationTargetSpec,
  packageObject: NbLawContentPackage,
  proposals: AiStudyMapProposal[],
  notes: UnitCalibrationSelectionNote[],
  kind: 'retry' | 'anchor',
): string[] => {
  const document = packageObject.documents.find(
    (doc) => normalizeTitle(doc.officialTitle) === normalizeTitle(target.documentTitle),
  );
  if (document === undefined) {
    notes.push({
      code: `${kind}-document-unresolved`,
      message: `Corpus document "${target.documentTitle}" not found for target ${target.targetId}.`,
    });
    return [];
  }
  const component = document.components.find((entry) => entry.label === target.sectionLabel);
  if (component === undefined) {
    notes.push({
      code: `${kind}-section-unresolved`,
      message: `Corpus component "${target.sectionLabel}" not found in ${document.id} for target ${target.targetId}.`,
    });
    return [];
  }
  const parents = proposals
    .filter(
      (proposal) =>
        proposal.document.documentId === document.id &&
        proposal.targetSourceKeys.includes(component.sourceKey),
    )
    .map((proposal) => proposal.jobId)
    .sort();
  if (parents.length === 0) {
    notes.push({
      code: `${kind}-no-frozen-result`,
      message: `No frozen canonical result targets ${component.sourceKey} (${target.targetId}).`,
    });
  }
  return parents;
};


