/**
 * Tests for the frozen-map provenance classifier and the group inventory
 * builder. All fixtures are synthetic (small temp run layout). A real-data
 * test (skipped when the canonical run is absent) builds the actual inventory
 * and asserts only the brief-guaranteed facts, printing the actual counts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AiStudyMapResult } from '../../src/study/ai/studyAiTypes';
import { FROZEN_MAP_RUN_ID, FROZEN_RESULT_ROW_COUNT } from '../../src/study/ai/studyAiMapFreezeGate';
import {
  GROUPING_ADJUDICATION_REASON,
  RETRY9_RUN_ID,
  buildFrozenMapGroupInventory,
  classifyJobProvenance,
  classifyProvenanceSidecar,
  renderFrozenMapGroupInventoryMd,
  writeFrozenMapGroupInventory,
  type MapProvenanceSidecar,
} from '../../src/study/ai/studyAiUnitInventory';
import {
  createFrozenRunFixture,
  makeGroup,
  makeJob,
  makeProposal,
  makeResult,
  makeSidecar,
  writeJobs,
  writeProposals,
  writeResultsJsonl,
  writeTextFile,
  type FrozenRunFixture,
} from './study_ai_frozen_fixtures';

let fixtures: FrozenRunFixture[] = [];

afterEach(() => {
  for (const fixture of fixtures) fixture.cleanup();
  fixtures = [];
});

const track = (fixture: FrozenRunFixture): FrozenRunFixture => {
  fixtures.push(fixture);
  return fixture;
};

/* ------------------------------------------------------------------ *
 * Provenance classifier                                               *
 * ------------------------------------------------------------------ */

describe('classifyProvenanceSidecar (synthetic sidecars)', () => {
  it('classifies the final grouping adjudications', () => {
    const sidecar = makeSidecar({
      jobId: 'map-final-qc',
      humanAdjudicated: true,
      adjudicationReason: GROUPING_ADJUDICATION_REASON,
    });
    expect(classifyProvenanceSidecar(sidecar)).toBe('final-QC-adjudicated');
  });

  it('classifies priority-only human adjudications as human-adjudicated', () => {
    const sidecar = makeSidecar({
      jobId: 'map-human',
      humanAdjudicated: true,
      adjudicationReason: 'post-qc-final-human-priority-adjudication',
    });
    expect(classifyProvenanceSidecar(sidecar)).toBe('human-adjudicated');
  });

  it('classifies a promotion sidecar referencing the retry run as retry-promoted', () => {
    const sidecar = makeSidecar({
      jobId: 'map-promoted',
      sourceRun: RETRY9_RUN_ID,
      hasPromotion: true,
      promotionSourceRun: RETRY9_RUN_ID,
    });
    expect(classifyProvenanceSidecar(sidecar)).toBe('retry-promoted');
  });

  it('classifies a tail-adjudication sidecar that references the retry source run', () => {
    const sidecar = makeSidecar({
      jobId: 'map-tail',
      humanAdjudicated: true,
      sourceRun: RETRY9_RUN_ID,
      adjudicationReason: 'final-production-tail-human-adjudication',
    });
    expect(classifyProvenanceSidecar(sidecar)).toBe('retry-promoted');
  });

  it('classifies a recovery sidecar as recovered', () => {
    const sidecar = makeSidecar({ jobId: 'map-recovered', hasRecovery: true });
    expect(classifyProvenanceSidecar(sidecar)).toBe('recovered');
  });

  it('classifies plain accepted sidecars and missing sidecars as original', () => {
    expect(classifyProvenanceSidecar(null)).toBe('original');
    expect(classifyProvenanceSidecar(undefined)).toBe('original');
    expect(classifyProvenanceSidecar({ jobId: 'map-plain', accepted: true })).toBe('original');
  });

  it('gives retry-promoted precedence over a co-present recovery block', () => {
    const sidecar: MapProvenanceSidecar = {
      jobId: 'map-both',
      accepted: true,
      recovery: { recoveredFromHistoricalAttempt: true },
      promotion: { sourceRun: RETRY9_RUN_ID },
    };
    expect(classifyProvenanceSidecar(sidecar)).toBe('retry-promoted');
  });

  it('reads sidecars from a run dir (missing sidecar is original)', () => {
    const fixture = track(createFrozenRunFixture('classifier-run'));
    writeTextFile(
      join(fixture.runDir, 'results', 'map-present.provenance.json'),
      `${JSON.stringify(makeSidecar({ jobId: 'map-present', hasRecovery: true }))}\n`,
    );
    expect(classifyJobProvenance(fixture.runDir, 'map-present')).toBe('recovered');
    expect(classifyJobProvenance(fixture.runDir, 'map-missing')).toBe('original');
  });
});

/* ------------------------------------------------------------------ *
 * Inventory builder (synthetic fixture)                               *
 * ------------------------------------------------------------------ */

/** Build a 3-result fixture: split (2 groups, human-adjudicated), standalone
 *  (1 group, retry-promoted), skip (0 groups, original). Result rows are
 *  written in scrambled order to prove the sort is corpus/section-driven. */
const buildInventoryFixture = () => {
  const fixture = track(createFrozenRunFixture('inv-run'));
  const runId = 'inv-run';
  const jobSplit = makeJob({
    jobId: 'map-split-aa',
    runId,
    documentId: 'doc-a',
    documentTitle: 'Act A',
    sectionKey: 'section:1',
    sectionLabel: '1',
    heading: 'Interpretation',
    exactCharacters: 300,
  });
  const jobStandalone = makeJob({
    jobId: 'map-std-bb',
    runId,
    documentId: 'doc-a',
    documentTitle: 'Act A',
    sectionKey: 'section:2',
    sectionLabel: '2',
    heading: 'Application',
    exactCharacters: 200,
    contentFlags: { containsRepealedSubprovision: true },
  });
  const jobSkip = makeJob({
    jobId: 'map-skip-cc',
    runId,
    documentId: 'doc-b',
    documentTitle: 'Act B',
    sectionKey: 'section:1',
    sectionLabel: '1',
  });
  writeJobs(fixture.runDir, [jobSplit, jobStandalone, jobSkip]);

  const splitGroups = [
    makeGroup({
      groupId: 'g1',
      childLabels: ['1(1)', '1(2)'],
      definedTerms: ['agricultural land'],
      evidenceText: ['1(1)Operative'],
    }),
    makeGroup({ groupId: 'g2', childLabels: ['1(3)'] }),
  ];
  const rowSplit: AiStudyMapResult = makeResult({
    jobId: 'map-split-aa',
    runId,
    disposition: 'split',
    suggestedPriority: 'P3',
    proposedGroups: splitGroups,
  });
  const rowStandalone: AiStudyMapResult = makeResult({
    jobId: 'map-std-bb',
    runId,
    disposition: 'standalone',
    suggestedPriority: 'P2',
    proposedGroups: [
      makeGroup({ groupId: 'g1', sourceKeys: ['section:2'], childLabels: ['2(1)'], definedTerms: ['application'] }),
    ],
  });
  const rowSkip: AiStudyMapResult = makeResult({
    jobId: 'map-skip-cc',
    runId,
    disposition: 'skip',
    suggestedPriority: null,
    proposedGroups: [],
  });
  // Deliberately scrambled: skip, standalone, split.
  writeResultsJsonl(fixture.runDir, [rowSkip, rowStandalone, rowSplit]);

  const proposals = [rowSplit, rowStandalone, rowSkip].map((row) => {
    const job = [jobSplit, jobStandalone, jobSkip].find((candidate) => candidate.jobId === row.jobId);
    if (!job) throw new Error(`no job for ${row.jobId}`);
    return makeProposal(row, job);
  });
  writeProposals(fixture.runDir, proposals);

  writeTextFile(
    join(fixture.runDir, 'results', 'map-split-aa.provenance.json'),
    `${JSON.stringify(
      makeSidecar({
        jobId: 'map-split-aa',
        humanAdjudicated: true,
        sourceRun: 'final-map-qc-adjudications-20260901-src',
        adjudicationReason: 'post-qc-final-human-priority-adjudication',
      }),
    )}\n`,
  );
  writeTextFile(
    join(fixture.runDir, 'results', 'map-std-bb.provenance.json'),
    `${JSON.stringify(
      makeSidecar({
        jobId: 'map-std-bb',
        sourceRun: RETRY9_RUN_ID,
        hasPromotion: true,
        promotionSourceRun: RETRY9_RUN_ID,
      }),
    )}\n`,
  );
  writeTextFile(
    join(fixture.runDir, 'results', 'map-skip-cc.provenance.json'),
    `${JSON.stringify({ jobId: 'map-skip-cc', accepted: true })}\n`,
  );

  // Tiny corpus package: document order doc-a then doc-b.
  writeTextFile(
    fixture.corpusPackagePath,
    `${JSON.stringify({
      schemaVersion: 1,
      documents: [{ id: 'doc-a', title: 'Act A' }, { id: 'doc-b', title: 'Act B' }],
    })}\n`,
  );
  return { fixture, runId };
};

const inventoryArgsFor = (fixture: FrozenRunFixture) => ({
  runDir: fixture.runDir,
  sourceMapRunId: 'inv-run',
  corpusPackagePath: fixture.corpusPackagePath,
  freezeReportPath: fixture.freezeReportPath,
  groupingAdjudicatedJobIds: ['map-split-aa'],
});

describe('buildFrozenMapGroupInventory (synthetic fixture)', () => {
  it('emits one row per group with cardinality, sort and exact summary numbers', () => {
    const { fixture } = buildInventoryFixture();
    const inventory = buildFrozenMapGroupInventory(inventoryArgsFor(fixture));

    expect(inventory.kind).toBe('frozen-map-unit-group-inventory');
    expect(inventory.dateTag).toBe('20260902');
    expect(inventory.sourceMapRunId).toBe('inv-run');

    // Cardinality: 2 grouped results (split 2 + standalone 1) → 3 rows; skip → 0.
    expect(inventory.summary.totalResults).toBe(3);
    expect(inventory.summary.groupedResults).toBe(2);
    expect(inventory.summary.zeroGroupResults).toBe(1);
    expect(inventory.summary.totalGroups).toBe(3);
    expect(inventory.rows).toHaveLength(3);
    expect(inventory.summary.finalGroupingAdjudicationRows).toBe(2);

    // Sort: doc-a (job file order split then standalone), then groups by groupId.
    expect(inventory.rows.map((row) => row.inventoryRowId)).toEqual([
      'map-split-aa::g1',
      'map-split-aa::g2',
      'map-std-bb::g1',
    ]);

    const [splitG1, splitG2, standalone] = inventory.rows;
    expect(splitG1).toMatchObject({
      mapJobId: 'map-split-aa',
      documentId: 'doc-a',
      documentTitle: 'Act A',
      sectionLabels: ['1'],
      heading: 'Interpretation',
      mapDisposition: 'split',
      suggestedPriority: 'P3',
      mapPriority: 'P3',
      mapConfidence: 'high',
      provenanceClass: 'human-adjudicated',
      groupId: 'g1',
      groupTitle: 'Title for g1',
      groupReason: 'Reason for g1',
      approximateLearningGoal: 'Learning goal for g1',
      sourceKeys: ['section:1'],
      parentKind: 'split',
      parentGroupCount: 2,
      finalGroupingAdjudicated: true,
      retryOrRecovered: false,
      sourceStatuses: { 'section:1': 'current' },
      contentFlagsBySourceKey: { 'section:1': null },
      exactSourceCharacters: 300,
      operativeSourceCharacters: 280,
    });
    expect(splitG1.childLabelCount).toBe(2);
    expect(splitG1.definedTermCount).toBe(1);
    expect(splitG1.evidenceTextCount).toBe(1);
    expect(splitG1.focusSelections[0].childLabels).toEqual(['1(1)', '1(2)']);
    expect(splitG2.childLabelCount).toBe(1);
    expect(splitG2.definedTermCount).toBe(0);
    expect(splitG2.evidenceTextCount).toBe(0);
    expect(splitG2.inventoryRowId).toBe('map-split-aa::g2');
    expect(splitG2.finalGroupingAdjudicated).toBe(true);

    expect(standalone.provenanceClass).toBe('retry-promoted');
    expect(standalone.retryOrRecovered).toBe(true);
    expect(standalone.finalGroupingAdjudicated).toBe(false);
    expect(standalone.parentKind).toBe('standalone');
    expect(standalone.sectionLabels).toEqual(['2']);
    expect(standalone.heading).toBe('Application');
    expect(standalone.contentFlagsBySourceKey).toEqual({
      'section:2': { containsRepealedSubprovision: true },
    });
    expect(standalone.sourceStatuses).toEqual({ 'section:2': 'current' });

    expect(inventory.summary.rowsByPriority).toEqual({ P2: 1, P3: 2 });
    expect(inventory.summary.rowsByParentKind).toEqual({ split: 2, standalone: 1 });
    expect(inventory.summary.rowsByProvenanceClass).toEqual({
      'final-QC-adjudicated': 0,
      'human-adjudicated': 2,
      'retry-promoted': 1,
      recovered: 0,
      original: 0,
    });
    expect(inventory.summary.unexpectedParentKindValues).toEqual([]);
  });

  it('derives grouping job ids from the freeze report when not passed', () => {
    const { fixture } = buildInventoryFixture();
    writeTextFile(
      fixture.freezeReportPath,
      `${JSON.stringify({
        schemaVersion: 1,
        groupingCorrections: [{ jobId: 'map-split-aa' }],
      })}\n`,
    );
    const inventory = buildFrozenMapGroupInventory({
      runDir: fixture.runDir,
      sourceMapRunId: 'inv-run',
      corpusPackagePath: fixture.corpusPackagePath,
      freezeReportPath: fixture.freezeReportPath,
    });
    expect(inventory.summary.finalGroupingAdjudicationRows).toBe(2);
  });

  it('renders a deterministic markdown report with a rows table', () => {
    const { fixture } = buildInventoryFixture();
    const inventory = buildFrozenMapGroupInventory(inventoryArgsFor(fixture));
    const md = renderFrozenMapGroupInventoryMd(inventory);
    expect(md).toContain('# Frozen Map → Unit Group Inventory — 20260902');
    expect(md).toContain('| final-QC-adjudicated | 0 |');
    expect(md).toContain('| map-split-aa::g1 |');
    expect(md).not.toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/m);

    const jsonPath = join(fixture.root, 'report.json');
    const mdPath = join(fixture.root, 'report.md');
    writeFrozenMapGroupInventory(inventory, jsonPath, mdPath);
    const roundTripped = JSON.parse(readFileSync(jsonPath, 'utf8')) as ReturnType<
      typeof buildFrozenMapGroupInventory
    >;
    expect(roundTripped.rows).toHaveLength(3);
    expect(roundTripped.summary).toEqual(inventory.summary);
  });
});

/* ------------------------------------------------------------------ *
 * Real data (skip when the gitignored canonical run is absent)        *
 * ------------------------------------------------------------------ */

const realRunDir = 'study-content/ai/runs';
const realRunPresent = existsSync(
  join(realRunDir, FROZEN_MAP_RUN_ID, 'results', 'local-map.results.jsonl'),
);

describe.skipIf(!realRunPresent)('frozen canonical run inventory (real data)', () => {
  it('builds the inventory with the brief-guaranteed counts', () => {
    const inventory = buildFrozenMapGroupInventory();
    const { summary } = inventory;
    expect(inventory.sourceMapRunId).toBe(FROZEN_MAP_RUN_ID);
    expect(summary.totalResults).toBe(FROZEN_RESULT_ROW_COUNT);
    expect(summary.groupedResults + summary.zeroGroupResults).toBe(FROZEN_RESULT_ROW_COUNT);
    expect(summary.totalGroups).toBe(inventory.rows.length);
    expect(summary.finalGroupingAdjudicationRows).toBe(20);
    expect(summary.unexpectedParentKindValues).toEqual([]);
    expect(inventory.freezeReportSha256).toBeTruthy();
    expect(inventory.canonicalResultsSha256).toBeTruthy();
    expect(inventory.proposalsSha256).toBeTruthy();
    console.log(
      `[real-data] inventory totalResults=${summary.totalResults} ` +
        `groupedResults=${summary.groupedResults} zeroGroupResults=${summary.zeroGroupResults} ` +
        `totalGroups=${summary.totalGroups} finalGroupingAdjudicationRows=${summary.finalGroupingAdjudicationRows}`,
    );
    console.log(
      `[real-data] provenance ${JSON.stringify(summary.rowsByProvenanceClass)} ` +
        `priority ${JSON.stringify(summary.rowsByPriority)} ` +
        `parentKind ${JSON.stringify(summary.rowsByParentKind)}`,
    );
  });
});
