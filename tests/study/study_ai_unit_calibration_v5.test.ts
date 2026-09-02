/**
 * Tests for the cal80-v5 sibling run builder + V4/V5 crosswalk
 * (`src/study/ai/studyAiUnitCalibrationV5.ts`).
 *
 * Pure synthetic tests exercise the exported matching / priority-parity /
 * crosswalk-row functions over in-memory job lists: order-preserving 3/5
 * match, fail-closed missing-key / duplicate-key / cohort-size errors,
 * priority parity errors, and byte determinism of the row construction.
 * A real-data integration test (skipped when the gitignored cal80-v4 run,
 * v5 preflight run, corpus package, or canonical proposals are absent) runs
 * `buildCal80V5Run` into a temp run root and asserts 80/80 — it never writes
 * into study-content/ai/runs.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJsonFile } from '../../src/study/ai/studyAiMapFreezeGate';
import { RUNS_DIR_REL } from '../../src/study/ai/studyAiMapFreezeGate';
import { canonicalRunDir, FROZEN_MAP_RUN_ID } from '../../src/study/ai/studyAiMapFreezeGate';
import type { AiUnitAuthoringJob } from '../../src/study/ai/studyAiTypes';
import type { AiSuggestedPriority } from '../../src/study/ai/studyAiTypes';
import type { AiSourceContentFlags } from '../../src/study/ai/studyAiTypes';
import {
  CAL80_V4_RUN_ID,
  V5_PREFLIGHT_RUN_ID,
  assertCohortPriorityParity,
  buildCal80V5Run,
  matchV4CohortToV5Preflight,
} from '../../src/study/ai/studyAiUnitCalibrationV5';
import {
  buildV4V5CrosswalkReport,
  buildV4V5CrosswalkRows,
} from '../../src/study/ai/studyAiUnitCalibrationV5Report';
import { renderV4V5CrosswalkReportMd } from '../../src/study/ai/studyAiUnitCalibrationV5Report';

/* ------------------------------------------------------------------ *
 * Synthetic builders                                                 *
 * ------------------------------------------------------------------ */

const MAP_RUN_ID = 'ai-map-synthetic-v5';

let jobSeq = 0;

type UnitJobSpec = {
  proposalId: string;
  groupId: string;
  priority: AiSuggestedPriority;
  promptSpecVersion: 'unit-authoring-v4' | 'unit-authoring-v5';
  runId: string;
};

const makeSourceKey = (groupId: string): string => `section:${groupId}`;

/** Minimal but complete unit job for the pure matching tests. */
const makeUnitJob = (spec: UnitJobSpec): AiUnitAuthoringJob => {
  jobSeq += 1;
  const specLabel = spec.promptSpecVersion === 'unit-authoring-v5' ? 'v5' : 'v4';
  const sourceKey = makeSourceKey(spec.groupId);
  const flags: AiSourceContentFlags = {
    containsRepealedSubprovision: false,
    repealOnly: false,
    commencementOnly: false,
    citationOnly: false,
    transitional: false,
    consequentialAmendment: false,
    staticGeographicBoundaryDescription: false,
  };
  return {
    schemaVersion: 1,
    jobId: `unit-${specLabel}-${String(jobSeq).padStart(4, '0')}`,
    runId: spec.runId,
    promptSpecVersion: spec.promptSpecVersion,
    sourceMapRunId: MAP_RUN_ID,
    sourceMapProposalId: spec.proposalId,
    corpusContentHash: 'corpus-hash-synth',
    frozenMapPriority: spec.priority,
    inputHash: `input-${specLabel}-${String(jobSeq).padStart(4, '0')}`,
    document: { documentId: 'doc-synth', title: 'Synthetic Act', type: 'act' },
    approvedGroup: {
      groupId: spec.groupId,
      titleSuggestion: `Title for ${spec.groupId}`,
      sourceKeys: [sourceKey],
      focusSelections: [],
      reason: `Reason for ${spec.groupId}`,
      approximateLearningGoal: `Goal for ${spec.groupId}`,
    },
    mapDisposition: 'split',
    mapReason: `Reason for ${spec.proposalId}`,
    approximateLearningGoal: `Goal for ${spec.groupId}`,
    group: {
      groupId: spec.groupId,
      titleSuggestion: `Title for ${spec.groupId}`,
      sourceKeys: [sourceKey],
      focusSelections: [],
      reason: `Reason for ${spec.groupId}`,
      approximateLearningGoal: `Goal for ${spec.groupId}`,
    },
    sourceHashes: { [sourceKey]: `hash-${spec.groupId}` },
    sourceStatuses: { [sourceKey]: 'current' },
    contentFlagsBySourceKey: { [sourceKey]: flags },
    exactSourceText: `Source text of ${spec.groupId}.`,
    operativeSourceText: `Operative source text of ${spec.groupId}.`,
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

const V4_RUN = 'ai-units-2026-09-02-frozen-map-cal80-v4';
const V5_RUN = 'ai-units-2026-09-02-frozen-map-cal80-v5';

const v4Job = (proposalId: string, groupId: string, priority: AiSuggestedPriority): AiUnitAuthoringJob =>
  makeUnitJob({ proposalId, groupId, priority, promptSpecVersion: 'unit-authoring-v4', runId: V4_RUN });

const v5Job = (proposalId: string, groupId: string, priority: AiSuggestedPriority): AiUnitAuthoringJob =>
  makeUnitJob({ proposalId, groupId, priority, promptSpecVersion: 'unit-authoring-v5', runId: V5_RUN });

const keyA = 'map-synth:a';
const keyB = 'map-synth:b';
const keyC = 'map-synth:c';
const keyD = 'map-synth:d';
const keyE = 'map-synth:e';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const trackTemp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'cal80-v5-'));
  tempDirs.push(dir);
  return dir;
};

/* ------------------------------------------------------------------ *
 * Pure matching                                                      *
 * ------------------------------------------------------------------ */

describe('matchV4CohortToV5Preflight (pure)', () => {
  it('matches a 3-job cohort inside a 5-job v5 preflight set in v4 order', () => {
    const cohort = [v4Job(keyA, 'group-a', 'P1'), v4Job(keyB, 'group-b', 'P2'), v4Job(keyC, 'group-c', 'P3')];
    // v5 preflight order differs from the cohort; priorities mirror the map.
    const preflight = [
      v5Job(keyD, 'group-d', 'P4'),
      v5Job(keyB, 'group-b', 'P2'),
      v5Job(keyE, 'group-e', 'P1'),
      v5Job(keyA, 'group-a', 'P1'),
      v5Job(keyC, 'group-c', 'P3'),
    ];
    const match = matchV4CohortToV5Preflight({
      v4CohortJobs: cohort,
      v5PreflightJobs: preflight,
      expectedCohortSize: 3,
    });
    expect(match.cohortKeys).toEqual([
      { proposalId: keyA, groupId: 'group-a' },
      { proposalId: keyB, groupId: 'group-b' },
      { proposalId: keyC, groupId: 'group-c' },
    ]);
    expect(match.matchedV5Jobs.map((job) => job.sourceMapProposalId)).toEqual([keyA, keyB, keyC]);
    expect(() => assertCohortPriorityParity(cohort, match.matchedV5Jobs)).not.toThrow();
    // Crosswalk rows: 3/3, order preserved, identities changed (v5 vs v4).
    const rows = buildV4V5CrosswalkRows(cohort, match.matchedV5Jobs);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.seq)).toEqual([1, 2, 3]);
    expect(rows[0]).toMatchObject({
      proposalId: keyA,
      groupId: 'group-a',
      jobIdChanged: true,
      mapRunId: MAP_RUN_ID,
      documentIds: ['section:group-a'],
      titleSuggestion: 'Title for group-a',
      frozenMapPriority: 'P1',
      semanticMatch: true,
    });
    expect(rows[0].v4JobId).not.toBe(rows[0].v5JobId);
    expect(rows[0].v4InputHash).not.toBe(rows[0].v5InputHash);
  });

  it('fails closed naming the key when a cohort key is missing from the v5 map', () => {
    const cohort = [v4Job(keyA, 'group-a', 'P1'), v4Job(keyB, 'group-b', 'P2'), v4Job(keyC, 'group-c', 'P3')];
    const preflight = [v5Job(keyA, 'group-a', 'P1'), v5Job(keyB, 'group-b', 'P2')];
    expect(() =>
      matchV4CohortToV5Preflight({
        v4CohortJobs: cohort,
        v5PreflightJobs: preflight,
        expectedCohortSize: 3,
      }),
    ).toThrow(/missing from the v5 preflight/);
    expect(() =>
      matchV4CohortToV5Preflight({
        v4CohortJobs: cohort,
        v5PreflightJobs: preflight,
        expectedCohortSize: 3,
      }),
    ).toThrow(/group-c/);
    expect(() =>
      matchV4CohortToV5Preflight({
        v4CohortJobs: cohort,
        v5PreflightJobs: preflight,
        expectedCohortSize: 3,
      }),
    ).toThrow(new RegExp(keyC.replace(/:/g, '\\:')));
  });

  it('fails closed on a duplicate (proposalId, groupId) in the v5 map', () => {
    const cohort = [v4Job(keyA, 'group-a', 'P1'), v4Job(keyB, 'group-b', 'P2'), v4Job(keyC, 'group-c', 'P3')];
    const preflight = [
      v5Job(keyA, 'group-a', 'P1'),
      v5Job(keyA, 'group-a', 'P1'),
      v5Job(keyB, 'group-b', 'P2'),
      v5Job(keyC, 'group-c', 'P3'),
      v5Job(keyD, 'group-d', 'P4'),
    ];
    expect(() =>
      matchV4CohortToV5Preflight({
        v4CohortJobs: cohort,
        v5PreflightJobs: preflight,
        expectedCohortSize: 3,
      }),
    ).toThrow(/duplicate \(sourceMapProposalId, groupId\) key\(s\) in the v5 preflight/);
    expect(() =>
      matchV4CohortToV5Preflight({
        v4CohortJobs: cohort,
        v5PreflightJobs: preflight,
        expectedCohortSize: 3,
      }),
    ).toThrow(/group-a/);
  });

  it('fails closed when the v4 cohort size differs from the expected cohort size', () => {
    const cohort = [v4Job(keyA, 'group-a', 'P1'), v4Job(keyB, 'group-b', 'P2'), v4Job(keyC, 'group-c', 'P3')];
    const preflight = [
      v5Job(keyA, 'group-a', 'P1'),
      v5Job(keyB, 'group-b', 'P2'),
      v5Job(keyC, 'group-c', 'P3'),
    ];
    expect(() =>
      matchV4CohortToV5Preflight({
        v4CohortJobs: cohort,
        v5PreflightJobs: preflight,
        expectedCohortSize: 80,
      }),
    ).toThrow(/expected 80 jobs, found 3/);
  });

  it('fails closed on duplicate keys inside the v4 cohort run itself', () => {
    const cohort = [v4Job(keyA, 'group-a', 'P1'), v4Job(keyA, 'group-a', 'P1')];
    expect(() =>
      matchV4CohortToV5Preflight({
        v4CohortJobs: cohort,
        v5PreflightJobs: [v5Job(keyA, 'group-a', 'P1')],
        expectedCohortSize: 2,
      }),
    ).toThrow(/inside the v4 cohort run/);
  });
});

describe('assertCohortPriorityParity (pure)', () => {
  it('fails closed naming seq and both priorities on an index-level mismatch', () => {
    const v4 = [v4Job(keyA, 'group-a', 'P1'), v4Job(keyB, 'group-b', 'P2')];
    const v5 = [v5Job(keyA, 'group-a', 'P1'), v5Job(keyB, 'group-b', 'P3')];
    expect(() => assertCohortPriorityParity(v4, v5)).toThrow(/seq 2/);
    expect(() => assertCohortPriorityParity(v4, v5)).toThrow(/v4 frozenMapPriority P2 vs v5 P3/);
  });

  it('passes when every index echoes the map-side priority', () => {
    const v4 = [v4Job(keyA, 'group-a', 'P4'), v4Job(keyB, 'group-b', 'P1')];
    const v5 = [v5Job(keyA, 'group-a', 'P4'), v5Job(keyB, 'group-b', 'P1')];
    expect(() => assertCohortPriorityParity(v4, v5)).not.toThrow();
  });
});

/* ------------------------------------------------------------------ *
 * Crosswalk rows + report content (pure)                             *
 * ------------------------------------------------------------------ */

describe('crosswalk row construction (pure)', () => {
  it('produces a byte-identical JSON string across two runs of the same inputs', () => {
    const cohort = [v4Job(keyA, 'group-a', 'P1'), v4Job(keyB, 'group-b', 'P2'), v4Job(keyC, 'group-c', 'P3')];
    const preflight = [
      v5Job(keyC, 'group-c', 'P3'),
      v5Job(keyB, 'group-b', 'P2'),
      v5Job(keyA, 'group-a', 'P1'),
    ];
    const match = matchV4CohortToV5Preflight({
      v4CohortJobs: cohort,
      v5PreflightJobs: preflight,
      expectedCohortSize: 3,
    });
    const first = JSON.stringify(buildV4V5CrosswalkRows(cohort, match.matchedV5Jobs));
    const second = JSON.stringify(buildV4V5CrosswalkRows(cohort, match.matchedV5Jobs));
    expect(first).toBe(second);
    const report = buildV4V5CrosswalkReport({
      dateTag: '20260902',
      v4RunId: V4_RUN,
      v5RunId: V5_RUN,
      specShas: { v4: 'sha-v4', v5: 'sha-v5' },
      rows: buildV4V5CrosswalkRows(cohort, match.matchedV5Jobs),
    });
    expect(report).toEqual({
      report: 'unit-calibration-v4-v5-crosswalk',
      dateTag: '20260902',
      v4RunId: V4_RUN,
      v5RunId: V5_RUN,
      specShas: { v4: 'sha-v4', v5: 'sha-v5' },
      cohortSize: 3,
      matched: 3,
      unmatched: 0,
      rows: expect.any(Array),
    });
    // The markdown renderer is stable over the JSON rows.
    const md = renderV4V5CrosswalkReportMd(report);
    expect(md).toContain('| 1 | `unit-v4-');
    expect(md).toContain(`- V4 run: \`${V4_RUN}\``);
    expect(md).toContain('Matched: 3 / unmatched: 0');
  });
});

/* ------------------------------------------------------------------ *
 * Orchestration: real cal80-v4 + v5 preflight runs (read-only)       *
 * ------------------------------------------------------------------ */

const realCal80V4Run = join(RUNS_DIR_REL, CAL80_V4_RUN_ID);
const realV5PreflightRun = join(RUNS_DIR_REL, V5_PREFLIGHT_RUN_ID);
const realPackage = 'study-content/packages/nb-sit-statute-corpus.content-package.json';
const realMapRunDir = canonicalRunDir(FROZEN_MAP_RUN_ID);
const realDataPresent =
  existsSync(join(realCal80V4Run, 'run.json')) &&
  existsSync(join(realV5PreflightRun, 'run.json')) &&
  existsSync(realPackage) &&
  existsSync(join(realMapRunDir, 'reports', 'map-proposals.json'));

describe.skipIf(!realDataPresent)('buildCal80V5Run (real dirs into temp output root)', () => {
  it('builds 80/80 with the expected distribution and byte-identical reruns', { timeout: 120000 }, () => {
    const firstRoot = trackTemp();
    const secondRoot = trackTemp();
    const first = buildCal80V5Run({ runDirRoot: firstRoot });
    expect(first.ok).toBe(true);
    expect(first.cohort).toEqual({ expected: 80, matched: 80, unmatched: 0 });
    expect(first.promptSpecVersion).toBe('unit-authoring-v5');
    expect(first.priorityDistribution).toEqual({ P1: 24, P2: 28, P3: 20, P4: 8 });
    expect(first.rewrittenJobs).toHaveLength(80);
    expect(first.layout.batchCount).toBe(10);
    expect(first.validation.issuesTotal).toBe(0);
    expect(first.crosswalk.rows).toHaveLength(80);
    for (const row of first.crosswalk.rows) {
      expect(row.semanticMatch).toBe(true);
      expect(row.jobIdChanged).toBe(true);
    }
    // Post-write run.json sanity (written under the temp root only).
    const writtenRun = readJsonFile<{ jobCount: number; promptSpecVersion: string }>(
      join(first.runDir, 'run.json'),
    );
    expect(writtenRun).not.toBeNull();
    expect(writtenRun?.jobCount).toBe(80);
    expect(writtenRun?.promptSpecVersion).toBe('unit-authoring-v5');
    // Deterministic rerun into a second temp root: identical crosswalk bytes.
    const second = buildCal80V5Run({ runDirRoot: secondRoot });
    expect(JSON.stringify(first.crosswalk)).toBe(JSON.stringify(second.crosswalk));
    expect(JSON.stringify(first.priorityDistribution)).toBe(JSON.stringify(second.priorityDistribution));
  });
});
