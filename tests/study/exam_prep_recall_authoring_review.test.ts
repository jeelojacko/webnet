// Exam Prep — deterministic Recall authoring-review bundle tests.

import { describe, expect, it } from 'vitest';
import { EXAM_PREP_RECALL_TASKS } from '../../src/study/examPrep/examPrepRecallTasks';
import { EXAM_PREP_LOCATE_TASKS } from '../../src/study/examPrep/examPrepLocateTasks';
import { EXAM_PREP_MANIFEST } from '../../src/study/examPrep/examPrepManifest';
import { EXAM_PREP_RECALL_PROMPT } from '../../src/study/examPrep/examPrepConstants';
import { EXAM_PREP_DOCUMENT_TITLES } from '../../src/study/examPrep/examPrepDocTitles';
import {
  buildExamPrepRecallAuthoringBundle,
  buildExamPrepRecallAuthoringSummary,
  deriveExamPrepRecallAuthoringRecords,
  EXAM_PREP_RECALL_AUTHORING_BASELINE_COMMIT,
} from '../../src/study/examPrep/qa/examPrepRecallAuthoringReview';
import {
  buildExamPrepRecallAuthoringMarkdown,
  serializeExamPrepRecallAuthoringJson,
} from '../../src/study/examPrep/qa/examPrepRecallAuthoringReport';

const unitById = new Map(EXAM_PREP_MANIFEST.units.map((unit) => [unit.id, unit]));
const locateByUnit = new Map<string, typeof EXAM_PREP_LOCATE_TASKS>();
for (const task of EXAM_PREP_LOCATE_TASKS) {
  locateByUnit.set(task.unitId, [...(locateByUnit.get(task.unitId) ?? []), task]);
}

describe('Exam Prep Recall authoring review bundle', () => {
  it('derives exactly 57 records in canonical Recall order with unique task ids', () => {
    const records = deriveExamPrepRecallAuthoringRecords();
    expect(records).toHaveLength(57);
    expect(records.map((record) => record.taskId)).toEqual(
      EXAM_PREP_RECALL_TASKS.map((task) => task.id),
    );
    expect(new Set(records.map((record) => record.taskId)).size).toBe(57);
    expect(records[0]?.order).toBe(1);
    expect(records[56]?.order).toBe(57);
  });

  it('keeps every current card byte-equal to the frozen task (no content change)', () => {
    const records = deriveExamPrepRecallAuthoringRecords();
    for (const record of records) {
      const task = EXAM_PREP_RECALL_TASKS.find((entry) => entry.id === record.taskId);
      expect(task).toBeTruthy();
      expect(record.currentCard.currentPrompt).toBe(EXAM_PREP_RECALL_PROMPT);
      expect(record.currentCard.currentPrompt).toBe(task?.prompt);
      expect(record.currentCard.currentExpectedAnswer).toBe(task?.expectedAnswer);
      expect(record.currentCard.currentAnswerCharCount).toBe(task?.expectedAnswer.length);
      expect(record.currentCard.currentAnswerWordCount).toBeGreaterThan(0);
      expect(record.unitTitle).toBe(task?.unitTitle);
      expect(record.tier).toBe(task?.tier);
      expect(record.reviewWeight).toBe(task?.reviewWeight);
    }
  });

  it('surfaces owning-unit context (goal/depths/core/cues) from the exact frozen unit', () => {
    const records = deriveExamPrepRecallAuthoringRecords();
    for (const record of records) {
      const unit = unitById.get(record.unitId);
      expect(unit).toBeTruthy();
      expect(record.unitContext.examGoal).toBe(unit?.examGoal);
      expect(record.unitContext.learningDepths).toEqual(unit?.learningDepths);
      expect(record.unitContext.coreUnderstanding).toEqual(unit?.coreUnderstanding);
      expect(record.unitContext.recognitionCues).toEqual(unit?.recognitionCues);
      expect(record.relationships.mustRecallCount).toBe(unit?.mustRecall.length);
      expect(record.relationships.mustRecallIndex).toBeGreaterThanOrEqual(1);
      expect(record.relationships.mustRecallIndex).toBeLessThanOrEqual(
        unit?.mustRecall.length ?? 0,
      );
    }
  });

  it('source anchors and lookups come from the owning frozen unit only — nothing invented', () => {
    const records = deriveExamPrepRecallAuthoringRecords();
    const allFrozenSourceKeys = new Set<string>();
    for (const unit of EXAM_PREP_MANIFEST.units) {
      for (const anchor of unit.sourceAnchors) allFrozenSourceKeys.add(anchor.sourceKey);
      for (const lookup of unit.mustLocate) {
        if (lookup.sourceKey) allFrozenSourceKeys.add(lookup.sourceKey);
      }
    }
    for (const record of records) {
      const unit = unitById.get(record.unitId);
      expect(unit).toBeTruthy();
      expect(record.sourceContext.sourceDocumentIds).toEqual(unit?.sourceDocumentIds);
      expect(record.sourceContext.documentTitles).toEqual(
        unit?.sourceDocumentIds.map((id) => EXAM_PREP_DOCUMENT_TITLES[id] ?? id),
      );
      // Anchors exactly mirror the owning unit's frozen anchor list.
      expect(record.sourceContext.sourceAnchors).toHaveLength(unit?.sourceAnchors.length ?? 0);
      expect(
        record.sourceContext.sourceAnchors.map((anchor) => anchor.sourceKey),
      ).toEqual(unit?.sourceAnchors.map((anchor) => anchor.sourceKey));
      for (const anchor of record.sourceContext.sourceAnchors) {
        expect(allFrozenSourceKeys.has(anchor.sourceKey)).toBe(true);
        expect(anchor.documentTitle).toBe(
          EXAM_PREP_DOCUMENT_TITLES[anchor.documentId] ?? anchor.documentId,
        );
      }
      // Lookup context mirrors the owning unit's mustLocate.
      const unitLocate = locateByUnit.get(record.unitId) ?? [];
      expect(record.lookupContext).toHaveLength(unitLocate.length);
      expect(record.lookupContext.map((lookup) => lookup.sourceKey)).toEqual(
        unitLocate.map((lookup) => lookup.expectedSourceKey),
      );
    }
  });

  it('flags: known QA values preserved; new flags deterministic', () => {
    const records = deriveExamPrepRecallAuthoringRecords();
    const summary = buildExamPrepRecallAuthoringSummary(records);
    expect(summary.totalCards).toBe(57);
    // Existing QA-mechanical values stay pinned (fragment = 10, >240 = 5).
    expect(summary.counts.fragmentLike).toBe(10);
    expect(summary.counts.longAnswer).toBe(5);
    // Scout/derivation-confirmed deterministic values for the full pool.
    expect(summary.counts.genericPrompt).toBe(57); // all cards share the generic prompt
    expect(summary.counts.multiRecallUnit).toBe(18); // 8 units x their entries
    expect(summary.counts.veryLongAnswer).toBe(0);
    expect(summary.counts.numericDetail).toBe(6);
    expect(summary.counts.exceptionLanguage).toBe(11);
    expect(summary.counts.multipleConcepts).toBe(27);
    expect(summary.counts.answerOverlapsLocate).toBe(5);
    // Every flagged id appears under exactly its flag, all from the 57 set.
    const ids = new Set(records.map((record) => record.taskId));
    for (const flag of Object.values(summary.taskIdsByFlag)) {
      for (const id of flag) expect(ids.has(id)).toBe(true);
    }
    const multiUnits = new Set(
      EXAM_PREP_MANIFEST.units
        .filter((unit) => unit.mustRecall.length > 1)
        .map((unit) => unit.id),
    );
    expect(multiUnits).toEqual(
      new Set(['A-NBLS-01', 'A-NBLS-04', 'A-REG-03', 'A-SURV-03', 'B-AGRI-02', 'B-CONDO-02', 'B-LIM-02', 'B-MIN-03']),
    );
    expect(new Set(summary.taskIdsByFlag.multiRecallUnit).size).toBe(18);
  });

  it('A-SURV-03 and A-NBLS-01 each contribute three review records', () => {
    const records = deriveExamPrepRecallAuthoringRecords();
    const surv = records.filter((record) => record.unitId === 'A-SURV-03');
    const nbls = records.filter((record) => record.unitId === 'A-NBLS-01');
    expect(surv.map((record) => record.taskId)).toEqual([
      'recall:A-SURV-03:1',
      'recall:A-SURV-03:2',
      'recall:A-SURV-03:3',
    ]);
    expect(nbls.map((record) => record.taskId)).toEqual([
      'recall:A-NBLS-01:1',
      'recall:A-NBLS-01:2',
      'recall:A-NBLS-01:3',
    ]);
    for (const record of [...surv, ...nbls]) {
      expect(record.flags.multiRecallUnit).toBe(true);
      expect(record.relationships.otherRecallTaskIds).toHaveLength(2);
    }
  });

  it('leaves every human-authoring field null', () => {
    const records = deriveExamPrepRecallAuthoringRecords();
    for (const record of records) {
      expect(record.decision).toBeNull();
      expect(record.proposedPrompt).toBeNull();
      expect(record.proposedAnswer).toBeNull();
      expect(record.proposedAction).toBeNull();
      expect(record.reviewNotes).toBeNull();
    }
  });

  it('bundle metadata is frozen and stable (no wall clock)', () => {
    const bundle = buildExamPrepRecallAuthoringBundle();
    expect(bundle.totalCards).toBe(57);
    expect(bundle.baselineCommit).toBe(EXAM_PREP_RECALL_AUTHORING_BASELINE_COMMIT);
    expect(bundle.curriculumId).toBe(EXAM_PREP_MANIFEST.curriculumId);
    expect(bundle.manifestContentHash).toBe(EXAM_PREP_MANIFEST.contentHash);
    expect(bundle.corpusContentHash).toBe(EXAM_PREP_MANIFEST.sourceCorpusContentHash);
    expect(bundle.generatedFrom).toContain('current frozen Exam Curriculum V1');
  });

  it('generated Markdown has one section per card, summary, and multi-card appendix', () => {
    const bundle = buildExamPrepRecallAuthoringBundle();
    const summary = buildExamPrepRecallAuthoringSummary(bundle.records);
    const markdown = buildExamPrepRecallAuthoringMarkdown(bundle, summary);
    for (const task of EXAM_PREP_RECALL_TASKS) {
      expect(markdown).toContain(task.id);
      expect(markdown).toContain(`## ${String(task.order).padStart(2, '0')} — ${task.id}`);
    }
    expect(markdown).toContain('## Group summary');
    expect(markdown).toContain('## Multi-card units appendix');
    // A-SURV-03's three answers appear together in the appendix body.
    const appendixStart = markdown.indexOf('## Multi-card units appendix');
    const appendix = markdown.slice(appendixStart);
    expect(appendix).toContain('### A-SURV-03');
    expect(appendix).toContain('recall:A-SURV-03:1');
    expect(appendix).toContain('recall:A-SURV-03:2');
    expect(appendix).toContain('recall:A-SURV-03:3');
    expect(appendix).toContain('### A-NBLS-01');
    expect(appendix).toContain('recall:A-NBLS-01:3');
  });

  it('JSON serialization is deterministic and contains all requested fields', () => {
    const bundle = buildExamPrepRecallAuthoringBundle();
    const json = serializeExamPrepRecallAuthoringJson(bundle);
    const parsed = JSON.parse(json);
    expect(parsed.records).toHaveLength(57);
    expect(parsed.decision).toBeUndefined(); // metadata-only object shape
    expect(parsed.records[0]).toMatchObject({
      taskId: 'recall:A-NBLS-01:1',
      decision: null,
      proposedPrompt: null,
      proposedAnswer: null,
      proposedAction: null,
      reviewNotes: null,
    });
    expect(serializeExamPrepRecallAuthoringJson(bundle)).toBe(json);
    const bundle2 = buildExamPrepRecallAuthoringBundle();
    expect(serializeExamPrepRecallAuthoringJson(bundle2)).toBe(json);
    expect(
      buildExamPrepRecallAuthoringMarkdown(
        bundle2,
        buildExamPrepRecallAuthoringSummary(bundle2.records),
      ),
    ).toBe(buildExamPrepRecallAuthoringMarkdown(bundle, buildExamPrepRecallAuthoringSummary(bundle.records)));
  });
});
