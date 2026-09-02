/**
 * Tests for the frozen calibration-80 selection (`selectCalibrationJobs` /
 * `runUnitCalibration80`).
 *
 * Synthetic tests exercise the deterministic selection with an in-memory pool
 * of unit jobs + a tiny corpus: pin inclusion and dedupe (one job satisfying
 * several pin sets is counted once), the exactly-80 invariant under the real
 * default priority targets, priority inheritance (a selected job's
 * frozenMapPriority is never altered and equals its proposal priority), tag
 * stacking (retry target and regression anchor resolving to one shared parent
 * — the OH&S s.9 situation), and byte-identical deterministic re-runs.
 *
 * Real-data tests (skipped when the gitignored canonical runs / package are
 * absent) assert the brief guarantees on the actual 4,251-job preflight and
 * deep-equal the freshly computed selection report against the tracked
 * `reports/unit-calibration-80-20260902.json` (i.e. report byte determinism
 * across independent runs).
 */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AiProposedSourceGroup,
  AiSourceContentFlags,
  AiSourceStatus,
  AiStudyMapProposal,
  AiSuggestedPriority,
  AiUnitAuthoringJob,
} from '../../src/study/ai/studyAiTypes';
import type { NbLawContentPackage } from '../../src/study/content/nbLawTypes';
import {
  FROZEN_MAP_RUN_ID,
  FROZEN_GROUPING_CORRECTION_JOB_IDS,
  canonicalRunDir,
} from '../../src/study/ai/studyAiMapFreezeGate';
import {
  CALIBRATION_PRIORITY_TARGETS,
  FROZEN_REGRESSION_ANCHORS,
  FROZEN_RETRY_TARGETS,
  SELECTION_TAG_GROUPING_ADJUDICATION,
  SELECTION_TAG_REGRESSION_ANCHOR,
  SELECTION_TAG_RETRY_HISTORY,
  selectCalibrationJobs,
  type UnitCalibrationSelection,
} from '../../src/study/ai/studyAiUnitCalibration';
import { buildUnitCalibrationJobTags, classifyDomainByDocumentTitle } from '../../src/study/ai/studyAiUnitCalibrationFeatures';
import { runUnitCalibration80, type UnitCalibration80Success } from '../../src/study/ai/studyAiUnitCalibrationRun';
import { buildUnitCalibration80Report } from '../../src/study/ai/studyAiUnitCalibrationReport';
import { readJsonFile } from '../../src/study/ai/studyAiMapFreezeGate';

/* ------------------------------------------------------------------ *
 * Synthetic builders                                                 *
 * ------------------------------------------------------------------ */

const MAP_RUN_ID = 'ai-map-synthetic-cal';
const FROZEN_TARGET_RUN_ID = 'ai-units-2026-09-02-frozen-map-cal80-v4';

let jobCounter = 0;

type UnitJobSpec = {
  parentJobId: string;
  groupId?: string;
  documentId: string;
  documentTitle: string;
  priority: AiSuggestedPriority;
  disposition?: 'standalone' | 'split' | 'combine';
  sourceKeys?: string[];
  title?: string;
  goal?: string;
  focusCount?: number;
  keyPrefix?: string;
  sourceStatuses?: Record<string, AiSourceStatus>;
  contentFlags?: Record<string, AiSourceContentFlags | undefined>;
};

/** Minimal but complete unit job for the pure selection tests. */
const makeUnitJob = (spec: UnitJobSpec): AiUnitAuthoringJob => {
  jobCounter += 1;
  const parentJobId = spec.parentJobId;
  const groupId = spec.groupId ?? `g${jobCounter}`;
  const sourceKeys = spec.sourceKeys ?? [`${spec.keyPrefix ?? spec.documentId}:section:${groupId}`];
  const focusCount = spec.focusCount ?? 1;
  const group: AiProposedSourceGroup = {
    groupId,
    titleSuggestion: spec.title ?? `Title for ${groupId}`,
    sourceKeys,
    focusSelections: Array.from({ length: focusCount }, (_, index) => ({
      sourceKey: sourceKeys[0],
      ...(focusCount > 1 ? { childLabels: [`child-${index}`] } : {}),
    })),
    reason: `Reason for ${groupId}`,
    approximateLearningGoal: spec.goal ?? `Goal for ${groupId} under ${spec.documentTitle}.`,
  };
  return {
    schemaVersion: 1,
    jobId: `unit-synth-${String(jobCounter).padStart(4, '0')}`,
    runId: FROZEN_TARGET_RUN_ID,
    promptSpecVersion: 'unit-authoring-v4',
    sourceMapRunId: MAP_RUN_ID,
    sourceMapProposalId: `${MAP_RUN_ID}:${parentJobId}`,
    corpusContentHash: 'corpus-hash-synth',
    frozenMapPriority: spec.priority,
    inputHash: '',
    document: { documentId: spec.documentId, title: spec.documentTitle, type: 'act' },
    approvedGroup: group,
    mapDisposition: spec.disposition ?? 'split',
    mapReason: `Reason for ${parentJobId}`,
    approximateLearningGoal: group.approximateLearningGoal,
    group,
    sourceHashes: Object.fromEntries(sourceKeys.map((key) => [key, `hash-${key}`])),
    sourceStatuses: spec.sourceStatuses ?? Object.fromEntries(sourceKeys.map((key) => [key, 'current'])),
    contentFlagsBySourceKey:
      spec.contentFlags ?? Object.fromEntries(sourceKeys.map((key) => [key, {}])),
    exactSourceText: `Source text of ${sourceKeys.join(',')} for ${groupId}.`,
    operativeSourceText: `Operative source text of ${sourceKeys.join(',')} for ${groupId}.`,
    sourceMetadata: {},
    context: {
      previous: undefined,
      next: undefined,
      relevantDefinitions: [],
      directlyReferencedProvisions: [],
      relatedSourceKeys: [],
      warnings: [],
      omittedContextWarnings: [],
    },
  };
};

/** Proposal for one synthetic map parent (needed by retry/anchor resolution
 *  and the priority-inheritance assertion). */
const makeProposalFor = (
  parentJobId: string,
  documentId: string,
  documentTitle: string,
  sectionLabel: string,
  priority: AiSuggestedPriority,
): AiStudyMapProposal =>
  ({
    id: `${MAP_RUN_ID}:${parentJobId}`,
    schemaVersion: 1,
    runId: MAP_RUN_ID,
    jobId: parentJobId,
    corpusContentHash: 'corpus-hash-synth',
    document: { documentId, title: documentTitle, type: 'act' },
    targetSourceKeys: [`${documentId}:section:${sectionLabel}`],
    targetSectionLabels: [sectionLabel],
    disposition: 'split',
    confidence: 'high',
    reason: `Reason for ${parentJobId}`,
    suggestedPriority: priority,
    proposedGroups: [],
    warnings: [],
    conflictCodes: [],
    reviewStatus: 'approved',
    validationStatus: 'valid',
    validationMessages: [],
    createdAt: '2026-09-02T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
  }) as unknown as AiStudyMapProposal;

/** Tiny corpus: one component per doc with the target section label. */
const syntheticPackage = (
  entries: Array<{ documentId: string; title: string; label: string }>,
): NbLawContentPackage =>
  ({
    schemaVersion: 1,
    id: 'calibration-synthetic-corpus',
    documents: entries.map((entry) => ({
      schemaVersion: 1,
      id: entry.documentId,
      officialTitle: entry.title,
      documentType: 'act',
      components: [
        {
          id: `c-${entry.documentId}-${entry.label}`,
          sourceKey: `${entry.documentId}:section:${entry.label}`,
          componentType: 'section',
          label: entry.label,
          heading: `Section ${entry.label}`,
          text: `Text of section ${entry.label} of ${entry.title}.`,
          subsections: [],
          contentHash: `hash-${entry.documentId}-${entry.label}`,
        },
      ],
    })),
    sourceHashes: {},
  }) as unknown as NbLawContentPackage;

const selectFrom = (
  jobs: AiUnitAuthoringJob[],
  proposals: AiStudyMapProposal[],
  packageObject: NbLawContentPackage,
  options: {
    correctionIds?: readonly string[];
    retryTargets?: typeof FROZEN_RETRY_TARGETS;
    anchors?: typeof FROZEN_REGRESSION_ANCHORS;
  } = {},
): UnitCalibrationSelection =>
  selectCalibrationJobs({
    jobs,
    package: packageObject,
    proposals,
    groupingCorrectionJobIds: options.correctionIds,
    retryTargets: options.retryTargets,
    regressionAnchors: options.anchors,
    provenanceOfMapJob: (_mapJobId) => 'original',
  });

const textOfSelection = (selection: UnitCalibrationSelection): string =>
  JSON.stringify({
    ok: selection.ok,
    issues: selection.issues,
    notes: selection.notes,
    jobIds: selection.records.map((record) => record.unitJobId),
    priorityActual: selection.priorityActual,
    domainActual: selection.domainActual,
  });

/* ------------------------------------------------------------------ *
 * Synthetic selection tests                                          *
 * ------------------------------------------------------------------ */

describe('selectCalibrationJobs (synthetic pool)', () => {
  it('selects exactly 80 default-target jobs with correct priorities and includes all pins', () => {
    const packageObject = syntheticPackage([
      { documentId: 'doc-core', title: 'Surveys Act', label: '9' },
      { documentId: 'doc-cad', title: 'Assessment Act', label: '9' },
      { documentId: 'doc-adj', title: 'Public Health Act', label: '9' },
    ]);
    // Two correction parents with two jobs each ⇒ 4 pins.
    const correctionIds = ['map-cor-a', 'map-cor-b', 'map-cor-skip'];
    const jobs: AiUnitAuthoringJob[] = [];
    const proposals: AiStudyMapProposal[] = [];
    const push = (
      parentJobId: string,
      documentId: string,
      title: string,
      priority: AiSuggestedPriority,
      label: string,
      disposition: 'standalone' | 'split' | 'combine' = 'split',
    ): void => {
      jobs.push(
        makeUnitJob({
          parentJobId,
          documentId,
          documentTitle: title,
          priority,
          disposition,
          sourceKeys: [`${documentId}:section:${label}`],
          keyPrefix: documentId,
        }),
      );
      proposals.push(makeProposalFor(parentJobId, documentId, title, label, priority));
    };
    push('map-cor-a', 'doc-core', 'Surveys Act', 'P3', '1');
    push('map-cor-a', 'doc-core', 'Surveys Act', 'P3', '1');
    push('map-cor-b', 'doc-cad', 'Assessment Act', 'P2', '2');
    push('map-cor-b', 'doc-cad', 'Assessment Act', 'P2', '2');
    // Enough fill pool across priorities (130 jobs, rotating P1..P4).
    const titles = [
      { id: 'doc-core', title: 'Surveys Act' },
      { id: 'doc-cad', title: 'Assessment Act' },
      { id: 'doc-adj', title: 'Public Health Act' },
    ];
    const priorities: AiSuggestedPriority[] = ['P1', 'P2', 'P3', 'P4'];
    for (let index = 0; index < 130; index += 1) {
      const doc = titles[index % titles.length];
      push(`map-fill-${index}`, doc.id, doc.title, priorities[index % 4], '1');
    }
    const selection = selectFrom(jobs, proposals, packageObject, {
      correctionIds,
      retryTargets: [],
      anchors: [],
    });
    expect(selection.ok).toBe(true);
    expect(selection.selected.length).toBe(80);
    expect(new Set(selection.selected.map((job) => job.jobId)).size).toBe(80);
    // Every correction-parent job is pinned exactly once.
    const pinJobIds = new Set(
      selection.records.filter((record) => record.correction).map((record) => record.unitJobId),
    );
    expect(pinJobIds.size).toBe(4);
    const pinParents = new Set(['map-cor-a', 'map-cor-b']);
    for (const job of jobs) {
      const parent = job.sourceMapProposalId.split(':').pop();
      if (parent !== undefined && pinParents.has(parent)) {
        expect(pinJobIds.has(job.jobId)).toBe(true);
      }
    }
    // Priority targets are met exactly; priorities were inherited, never changed.
    expect(selection.priorityActual).toEqual({
      P1: CALIBRATION_PRIORITY_TARGETS.P1,
      P2: CALIBRATION_PRIORITY_TARGETS.P2,
      P3: CALIBRATION_PRIORITY_TARGETS.P3,
      P4: CALIBRATION_PRIORITY_TARGETS.P4,
    });
    const proposalPriorityById = new Map(proposals.map((proposal) => [proposal.id, proposal.suggestedPriority]));
    for (const record of selection.records) {
      expect(record.priority).toBe(proposalPriorityById.get(record.sourceMapProposalId) ?? record.priority);
    }
    const noteCodes = selection.notes.map((note) => note.code);
    expect(noteCodes).toContain('pin-zero-jobs');
  });

  it('dedupes: one job satisfying a retry target and an anchor is counted once with stacked tags', () => {
    const packageObject = syntheticPackage([
      { documentId: 'doc-cad', title: 'Assessment Act', label: '9' },
      { documentId: 'doc-adj', title: 'Municipalities Act', label: '9' },
    ]);
    const sharedTarget = { targetId: 'Assessment Act s.9', documentTitle: 'Assessment Act', sectionLabel: '9' };
    const anchorOnlyTarget = { targetId: 'Municipalities Act s.9', documentTitle: 'Municipalities Act', sectionLabel: '9' };
    const jobs: AiUnitAuthoringJob[] = [];
    const proposals: AiStudyMapProposal[] = [];
    const push = (parent: string, docId: string, title: string, priority: AiSuggestedPriority): void => {
      jobs.push(makeUnitJob({ parentJobId: parent, documentId: docId, documentTitle: title, priority }));
      proposals.push(makeProposalFor(parent, docId, title, '9', priority));
    };
    push('map-retry-shared', 'doc-cad', 'Assessment Act', 'P2');
    push('map-anchor-only', 'doc-adj', 'Municipalities Act', 'P1');
    for (let index = 0; index < 120; index += 1) {
      push(`map-fill-${index}`, index % 2 === 0 ? 'doc-cad' : 'doc-adj', index % 2 === 0 ? 'Assessment Act' : 'Municipalities Act', (['P1', 'P2', 'P3', 'P4'] as const)[index % 4]);
    }
    const selection = selectFrom(jobs, proposals, packageObject, {
      retryTargets: [sharedTarget],
      anchors: [sharedTarget, anchorOnlyTarget],
    });
    expect(selection.ok).toBe(true);
    // The shared parent's first job satisfies both sets; tags stack, one job.
    const stacked = selection.records.filter(
      (record) => record.retry && record.regression && record.tags.includes(SELECTION_TAG_RETRY_HISTORY),
    );
    expect(stacked.length).toBe(1);
    expect(stacked[0].tags).toContain(SELECTION_TAG_RETRY_HISTORY);
    expect(stacked[0].tags).toContain(SELECTION_TAG_REGRESSION_ANCHOR);
    expect(stacked[0].tags).not.toContain(SELECTION_TAG_GROUPING_ADJUDICATION);
    const unionCounts = {
      retryTagged: selection.records.filter((record) => record.retry).length,
      regressionTagged: selection.records.filter((record) => record.regression).length,
    };
    // 1 shared + 1 anchor-only, no double counting in the total.
    expect(selection.records.length).toBe(80);
    expect(unionCounts).toEqual({ retryTagged: 1, regressionTagged: 2 });
    expect(selection.retryTargetCoverage[0].unitJobId).toBe(stacked[0].unitJobId);
    expect(selection.anchorTargetCoverage[0].unitJobId).toBe(stacked[0].unitJobId);
    expect(selection.anchorTargetCoverage[1].unitJobId).not.toBe(stacked[0].unitJobId);
  });

  it('is byte-deterministic across re-runs and orders records stably', () => {
    const packageObject = syntheticPackage([
      { documentId: 'doc-core', title: 'Surveys Act', label: '9' },
      { documentId: 'doc-cad', title: 'Assessment Act', label: '9' },
      { documentId: 'doc-adj', title: 'Public Health Act', label: '9' },
    ]);
    const jobs: AiUnitAuthoringJob[] = [];
    const proposals: AiStudyMapProposal[] = [];
    for (let index = 0; index < 150; index += 1) {
      const docId = index % 3 === 0 ? 'doc-core' : index % 3 === 1 ? 'doc-cad' : 'doc-adj';
      const title = docId === 'doc-core' ? 'Surveys Act' : docId === 'doc-cad' ? 'Assessment Act' : 'Public Health Act';
      const priority = (['P1', 'P2', 'P3', 'P4'] as const)[index % 4];
      jobs.push(makeUnitJob({ parentJobId: `map-fill-${index}`, documentId: docId, documentTitle: title, priority }));
    }
    const first = selectFrom(jobs, proposals, packageObject);
    const second = selectFrom(jobs, proposals, packageObject);
    expect(first.ok).toBe(true);
    expect(textOfSelection(first)).toBe(textOfSelection(second));
    // Records carry ascending stable indexes 1..80.
    const indexes = first.records.map((record) => record.index);
    expect(indexes).toEqual(indexes.map((_, i) => i + 1));
    // Classifier sanity (documented title-keyword table).
    expect(classifyDomainByDocumentTitle('Registry Act')).toBe('core');
    expect(classifyDomainByDocumentTitle('Assessment Act')).toBe('cadastral');
    expect(classifyDomainByDocumentTitle('Public Health Act')).toBe('adjacent');
  });
});

/* ------------------------------------------------------------------ *
 * repealed-mix tag semantics                                         *
 * ------------------------------------------------------------------ */

describe('buildUnitCalibrationJobTags (repealed-mix semantics)', () => {
  const tagJob = (
    index: number,
    overrides: Pick<UnitJobSpec, 'sourceKeys' | 'sourceStatuses' | 'contentFlags'>,
  ): AiUnitAuthoringJob =>
    makeUnitJob({
      parentJobId: `map-tag-${index}`,
      documentId: 'doc-adj',
      documentTitle: 'Public Health Act',
      priority: 'P1',
      sourceKeys: overrides.sourceKeys ?? ['k1'],
      sourceStatuses: overrides.sourceStatuses,
      contentFlags: overrides.contentFlags,
    });

  it("tags 'repealed-mix' when a content flag has containsRepealedSubprovision true (all-live statuses)", () => {
    const job = tagJob(1, {
      sourceKeys: ['k1', 'k2'],
      contentFlags: { k1: { containsRepealedSubprovision: true }, k2: { containsRepealedSubprovision: false } },
    });
    expect(buildUnitCalibrationJobTags(job)).toContain('repealed-mix');
  });

  it("still tags via the status-mix branch when flags are false or absent (current + repealed sources)", () => {
    const flagMixed = tagJob(2, {
      sourceKeys: ['k1', 'k2'],
      sourceStatuses: { k1: 'current', k2: 'repealed' },
      contentFlags: { k1: { containsRepealedSubprovision: false }, k2: { containsRepealedSubprovision: false } },
    });
    const flagAbsent = tagJob(3, {
      sourceKeys: ['k1', 'k2'],
      sourceStatuses: { k1: 'historical', k2: 'current' },
    });
    expect(buildUnitCalibrationJobTags(flagMixed)).toContain('repealed-mix');
    expect(buildUnitCalibrationJobTags(flagAbsent)).toContain('repealed-mix');
  });

  it('does not tag when neither a status mix nor a repealed-subprovision flag is present', () => {
    const flagFalse = tagJob(4, {
      sourceKeys: ['k1'],
      contentFlags: { k1: { containsRepealedSubprovision: false } },
    });
    const plain = tagJob(5, { sourceKeys: ['k1'] });
    const tags = buildUnitCalibrationJobTags(flagFalse);
    expect(tags).not.toContain('repealed-mix');
    expect(buildUnitCalibrationJobTags(plain)).not.toContain('repealed-mix');
    expect(tags).toContain('parent-split');
    expect(tags).toContain('focus-single');
  });
});

/* ------------------------------------------------------------------ *
 * Real data (skip when the gitignored runs/package are absent)        *
 * ------------------------------------------------------------------ */

const realRunDir = canonicalRunDir(FROZEN_MAP_RUN_ID);
const realPreflightDir = join('study-content', 'ai', 'runs', 'ai-units-2026-09-02-frozen-map-v4-preflight');
const realPackage = 'study-content/packages/nb-sit-statute-corpus.content-package.json';
const realReportPath = 'reports/unit-calibration-80-20260902.json';
const realDataPresent =
  existsSync(realRunDir) &&
  existsSync(join(realRunDir, 'reports', 'map-proposals.json')) &&
  existsSync(join(realPreflightDir, 'jobs')) &&
  existsSync(realPackage);

describe.skipIf(!realDataPresent)('frozen calibration-80 (real data)', () => {
  it(
    'selects exactly 80 with the documented pins / retry coverage / anchors and byte-equal report content',
    { timeout: 240000 },
    () => {
      const result = runUnitCalibration80({});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const success = result as UnitCalibration80Success;
      expect(success.counts.jobCount).toBe(80);
      expect(success.counts.pinCount).toBe(20);
      expect(success.counts.retryRepresentatives).toBe(9);
      expect(success.counts.anchorTaggedJobs).toBe(7);
      expect(success.counts.correctionJobIds).toBe(8);
      expect(success.validation.checkedJobs).toBe(80);
      expect(success.validation.issuesTotal).toBe(0);
      // Pins: every unit job of the 8 grouped correction parents (skip excluded).
      const correctionParents = FROZEN_GROUPING_CORRECTION_JOB_IDS.filter(
        (mapJobId) => mapJobId !== 'map-d747c4a97d7161d3',
      );
      const pinned = success.records.filter((record) => record.correction);
      expect(pinned.length).toBe(20);
      const pinnedParents = new Set(pinned.map((record) => record.mapJobId));
      expect(correctionParents.length).toBe(8);
      for (const parent of correctionParents) {
        expect(pinnedParents.has(parent)).toBe(true);
      }
      for (const record of pinned) {
        expect(record.selectionReason).toBe('pin');
        expect(record.tags).toContain(SELECTION_TAG_GROUPING_ADJUDICATION);
      }
      // Every retry target covered by a map-retry-history job; every anchor covered.
      for (const row of success.retryTargetCoverage) {
        expect(row.unitJobId).not.toBeNull();
      }
      expect(FROZEN_RETRY_TARGETS.length).toBe(9);
      expect(new Set(success.records.filter((record) => record.retry).map((record) => record.mapJobId)).size).toBe(9);
      for (const row of success.anchorTargetCoverage) {
        expect(row.unitJobId).not.toBeNull();
      }
      // OH&S s.9 stacks retry + regression on one job.
      const stacked = success.records.filter((record) => record.retry && record.regression);
      expect(stacked.length).toBe(1);
      expect(success.records.filter((record) => record.regression).length).toBe(7);
      // Distributions meet the targets exactly.
      expect(success.priority.actual).toEqual(success.priority.target);
      expect(success.domain.actual).toEqual(success.domain.target);
      // Deterministic byte equality with the tracked selection report (written by
      // an independent earlier CLI run of the same module).
      const tracked = readJsonFile<Record<string, unknown>>(realReportPath);
      if (tracked !== null) {
        const rebuilt = buildUnitCalibration80Report(success) as unknown as Record<string, unknown>;
        expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(tracked));
      }
      console.log(
        `[real-data] calibration ok; jobCount=${success.counts.jobCount} ` +
          `priority=${JSON.stringify(success.priority.actual)} ` +
          `domain=${JSON.stringify(success.domain.actual)} validationIssues=${success.validation.issuesTotal} ` +
          `batchFiles=${success.layout.batchCount}`,
      );
    },
  );
});
