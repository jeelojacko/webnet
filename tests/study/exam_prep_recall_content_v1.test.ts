// Exam Prep — Recall Content V1 learner-layer QA tests.
//
// Pins the human-authored Recall Content V1 layer (57 specific prompts, 16
// answer overrides) against the frozen Recall task pool: exact coverage in
// canonical order, prompt quality, resolver behaviour (fail closed), pinned
// semantic examples, and source-anchor grounding for the override cards.
// Frozen curriculum + frozen task projection stay untouched.

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../../src/study/ai/studyAiResultContract';
import {
  EXAM_PREP_RECALL_CONTENT_ID,
  EXAM_PREP_RECALL_CONTENT_V1,
  examPrepRecallContentV1Hash,
  resolveExamPrepRecallLearnerContent,
} from '../../src/study/examPrep/examPrepRecallContentV1';
import { EXAM_PREP_RECALL_TASKS } from '../../src/study/examPrep/examPrepRecallTasks';
import { EXAM_PREP_RECALL_PROMPT } from '../../src/study/examPrep/examPrepConstants';
import { EXAM_PREP_MANIFEST } from '../../src/study/examPrep/examPrepManifest';
import type { ExamPrepRecallTask } from '../../src/study/examPrep/examPrepTypes';

/** The 16 cards that carry a polished expected-answer override. */
const EXPECTED_OVERRIDE_TASK_IDS = [
  'recall:A-NBLS-01:1',
  'recall:A-NBLS-01:2',
  'recall:A-NBLS-01:3',
  'recall:A-NBLS-04:1',
  'recall:A-NBLS-04:2',
  'recall:A-SURV-03:1',
  'recall:A-SURV-03:2',
  'recall:A-SURV-03:3',
  'recall:A-REG-02:1',
  'recall:A-REG-03:1',
  'recall:A-REG-03:2',
  'recall:B-AIR-02:1',
  'recall:B-CWA-02:1',
  'recall:B-EASE-02:1',
  'recall:B-EXPR-02:1',
  'recall:NAV-11:1',
];

const recordByTaskId = new Map(
  EXAM_PREP_RECALL_CONTENT_V1.map((record) => [record.taskId, record]),
);

const taskById = new Map(EXAM_PREP_RECALL_TASKS.map((task) => [task.id, task]));

const unitById = new Map(EXAM_PREP_MANIFEST.units.map((unit) => [unit.id, unit]));

const fabricatedTask = (id: string): ExamPrepRecallTask => ({
  id,
  unitId: 'FAKE-00',
  unitTitle: 'Fabricated unit',
  tier: 'A',
  index: 1,
  order: 999,
  reviewWeight: 'low',
  curriculumIndex: 999,
  prompt: EXAM_PREP_RECALL_PROMPT,
  expectedAnswer: 'fabricated answer',
});

describe('Exam Prep Recall Content V1 coverage', () => {
  it('has exactly 57 records', () => {
    expect(EXAM_PREP_RECALL_CONTENT_V1).toHaveLength(57);
  });

  it('covers exactly the frozen Recall task ids in canonical order', () => {
    expect(EXAM_PREP_RECALL_CONTENT_V1.map((record) => record.taskId)).toEqual(
      EXAM_PREP_RECALL_TASKS.map((task) => task.id),
    );
  });

  it('has no duplicate, missing, or unknown task ids', () => {
    const ids = EXAM_PREP_RECALL_CONTENT_V1.map((record) => record.taskId);
    expect(new Set(ids).size).toBe(57);
    const frozen = new Set(EXAM_PREP_RECALL_TASKS.map((task) => task.id));
    for (const id of ids) expect(frozen.has(id)).toBe(true);
  });

  it('gives every card a non-empty prompt distinct from the generic prompt', () => {
    for (const record of EXAM_PREP_RECALL_CONTENT_V1) {
      expect(record.prompt.trim().length).toBeGreaterThan(0);
      expect(record.prompt).not.toBe(EXAM_PREP_RECALL_PROMPT);
    }
  });

  it('gives all 57 cards unique prompt strings', () => {
    const prompts = EXAM_PREP_RECALL_CONTENT_V1.map((record) => record.prompt);
    expect(new Set(prompts).size).toBe(57);
  });
});

describe('Exam Prep Recall Content V1 answer overrides', () => {
  it('defines exactly the 16 expected overrides; the other 41 stay canonical', () => {
    const withOverride = EXAM_PREP_RECALL_CONTENT_V1.filter(
      (record) => record.expectedAnswerOverride !== undefined,
    );
    expect(withOverride.map((record) => record.taskId).sort()).toEqual(
      [...EXPECTED_OVERRIDE_TASK_IDS].sort(),
    );
    expect(withOverride).toHaveLength(16);
    const canonical = EXAM_PREP_RECALL_CONTENT_V1.filter(
      (record) => record.expectedAnswerOverride === undefined,
    );
    expect(canonical).toHaveLength(41);
    for (const record of withOverride) {
      expect(record.expectedAnswerOverride?.trim().length).toBeGreaterThan(0);
    }
  });

  it('resolves an override card to its authored expected answer', () => {
    const task = taskById.get('recall:B-EASE-02:1');
    expect(task).toBeTruthy();
    const resolved = resolveExamPrepRecallLearnerContent(task!);
    expect(resolved.prompt).toBe(recordByTaskId.get('recall:B-EASE-02:1')?.prompt);
    expect(resolved.expectedAnswer).toBe(
      recordByTaskId.get('recall:B-EASE-02:1')?.expectedAnswerOverride,
    );
    expect(resolved.expectedAnswer).toContain('20 years');
    expect(resolved.expectedAnswer).toContain('40 years');
  });

  it('resolves a canonical card to the frozen task expected answer', () => {
    const task = taskById.get('recall:A-LTA-01:1');
    expect(task).toBeTruthy();
    expect(recordByTaskId.get('recall:A-LTA-01:1')?.expectedAnswerOverride).toBeUndefined();
    const resolved = resolveExamPrepRecallLearnerContent(task!);
    expect(resolved.expectedAnswer).toBe(task!.expectedAnswer);
  });

  it('fails closed for a fabricated task id', () => {
    expect(() => resolveExamPrepRecallLearnerContent(fabricatedTask('recall:FAKE-00:1'))).toThrow(
      'recall:FAKE-00:1',
    );
  });
});

describe('Exam Prep Recall Content V1 identity', () => {
  it('pins the content id', () => {
    expect(EXAM_PREP_RECALL_CONTENT_ID).toBe('nb-sit-recall-content-v1');
  });

  it('pins the deterministic content hash', () => {
    expect(examPrepRecallContentV1Hash).toBe(
      '9c07b1b12d932259329defe098f8bb86db6363be563d3bd34ccc788743b8d3b8',
    );
  });

  it('recomputes the pinned hash from the records with Node crypto (fail closed on drift)', () => {
    const recomputed = createHash('sha256')
      .update(canonicalJson(EXAM_PREP_RECALL_CONTENT_V1), 'utf8')
      .digest('hex');
    expect(recomputed).toBe(examPrepRecallContentV1Hash);
  });
});

describe('Exam Prep Recall Content V1 pinned semantic examples', () => {
  it('cues the three A-NBLS-01 cards distinctly', () => {
    const first = recordByTaskId.get('recall:A-NBLS-01:1')?.prompt ?? '';
    const second = recordByTaskId.get('recall:A-NBLS-01:2')?.prompt ?? '';
    const third = recordByTaskId.get('recall:A-NBLS-01:3')?.prompt ?? '';
    expect(first).toContain('boundary determination');
    expect(second).toContain('certification');
    expect(third).toContain('watercourse');
    expect(new Set([first, second, third]).size).toBe(3);
  });

  it('separates A-NBLS-04 signing/seal from ownership/employee-exception', () => {
    const first = recordByTaskId.get('recall:A-NBLS-04:1')?.prompt ?? '';
    const second = recordByTaskId.get('recall:A-NBLS-04:2')?.prompt ?? '';
    expect(first).toContain('signing/sealing');
    expect(second).toContain('owns');
    expect(second).toContain('employee exception');
  });

  it('cues the three A-SURV-03 cards distinctly', () => {
    const first = recordByTaskId.get('recall:A-SURV-03:1')?.prompt ?? '';
    const second = recordByTaskId.get('recall:A-SURV-03:2')?.prompt ?? '';
    const third = recordByTaskId.get('recall:A-SURV-03:3')?.prompt ?? '';
    expect(first).toContain('which legal monuments');
    expect(second).toContain('subdivision work included');
    expect(third).toContain('certify');
  });

  it('separates A-REG-03 witness from affidavit/acknowledgment', () => {
    const first = recordByTaskId.get('recall:A-REG-03:1')?.prompt ?? '';
    const second = recordByTaskId.get('recall:A-REG-03:2')?.prompt ?? '';
    expect(first).toContain('witness');
    expect(second).toContain('affidavit');
    expect(second).toContain('acknowledgment');
  });

  it('keeps the B-EASE-02 override on the 20/40-year rule', () => {
    const override =
      recordByTaskId.get('recall:B-EASE-02:1')?.expectedAnswerOverride ?? '';
    expect(override).toContain('20 years');
    expect(override).toContain('40 years');
  });

  it('keeps the A-SURV-03:1 override on the Surveys Act s.7 scope', () => {
    const override = recordByTaskId.get('recall:A-SURV-03:1')?.expectedAnswerOverride ?? '';
    expect(override).toBe(
      'In an integrated survey area, a surveyor must tie all legal monuments they establish to the coordinate monuments when those monuments pertain to Crown Lands, subdivisions when a subdivision plan is required under the Community Planning Act, or parcels whose owners request inclusion.',
    );
  });

  it('pins the exact A-SURV-03:1 override wording', () => {
    expect(recordByTaskId.get('recall:A-SURV-03:1')?.expectedAnswerOverride).toBe(
      'In an integrated survey area, a surveyor must tie all legal monuments they establish to the coordinate monuments when those monuments pertain to Crown Lands, subdivisions when a subdivision plan is required under the Community Planning Act, or parcels whose owners request inclusion.',
    );
  });

  it('keeps the B-AIR-02:1 override on the s.5(1) correctness/compliance certification', () => {
    const override = recordByTaskId.get('recall:B-AIR-02:1')?.expectedAnswerOverride ?? '';
    expect(override).toContain('certifying its correctness and compliance with section 4');
  });

  it('separates NAV-01 classification from NAV-11 access vs evidence', () => {
    const nav01 = recordByTaskId.get('recall:NAV-01:1')?.prompt ?? '';
    const nav11 = recordByTaskId.get('recall:NAV-11:1')?.prompt ?? '';
    expect(nav01).toContain('classification');
    expect(nav11).toContain('finding or obtaining');
    expect(nav11).toContain('evidence');
    expect(recordByTaskId.get('recall:NAV-11:1')?.expectedAnswerOverride).toBeTruthy();
  });
});

describe('Exam Prep Recall Content V1 source grounding', () => {
  it('grounds A-NBLS-04:1 in the owning unit section:30(2) anchor', () => {
    const unit = unitById.get('A-NBLS-04');
    expect(unit).toBeTruthy();
    expect(unit!.sourceAnchors.map((anchor) => anchor.sourceKey)).toContain('section:30(2)');
  });

  it('grounds A-NBLS-04:2 in the owning unit section:31(1) and 31(2) anchors', () => {
    const unit = unitById.get('A-NBLS-04');
    expect(unit).toBeTruthy();
    const keys = unit!.sourceAnchors.map((anchor) => anchor.sourceKey);
    expect(keys).toContain('section:31(1)');
    expect(keys).toContain('section:31(2)');
  });

  it('grounds A-SURV-03:1/:2 in the owning unit section:7 anchor', () => {
    const unit = unitById.get('A-SURV-03');
    expect(unit).toBeTruthy();
    expect(unit!.sourceAnchors.map((anchor) => anchor.sourceKey)).toContain('section:7');
  });

  it('grounds A-SURV-03:3 in the owning unit section:8 anchor', () => {
    const unit = unitById.get('A-SURV-03');
    expect(unit).toBeTruthy();
    expect(unit!.sourceAnchors.map((anchor) => anchor.sourceKey)).toContain('section:8');
  });

  it('derives every pinned anchor from the owning frozen unit only', () => {
    for (const [unitId, keys] of [
      ['A-NBLS-04', ['section:30(2)', 'section:31(1)', 'section:31(2)']],
      ['A-SURV-03', ['section:7', 'section:8']],
    ] as const) {
      const unit = unitById.get(unitId);
      expect(unit).toBeTruthy();
      const ownKeys = new Set(unit!.sourceAnchors.map((anchor) => anchor.sourceKey));
      for (const key of keys) expect(ownKeys.has(key)).toBe(true);
    }
  });
});
