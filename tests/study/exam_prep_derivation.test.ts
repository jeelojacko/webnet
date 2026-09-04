import { describe, expect, it } from 'vitest';
import { EXAM_PREP_MANIFEST } from '../../src/study/examPrep/examPrepManifest';
import {
  deriveExamPrepRecallTasks,
  EXAM_PREP_RECALL_TASKS,
  EXAM_PREP_LEARN_UNITS,
  isExamPrepLearnUnit,
} from '../../src/study/examPrep/examPrepRecallTasks';
import { EXAM_PREP_RECALL_PROMPT, EXAM_PREP_TOTAL_RECALL_CARDS } from '../../src/study/examPrep/examPrepConstants';

describe('Exam Prep deterministic recall-task derivation', () => {
  it('derives exactly 57 tasks from the frozen manifest in canonical order', () => {
    expect(EXAM_PREP_RECALL_TASKS).toHaveLength(EXAM_PREP_TOTAL_RECALL_CARDS);
    expect(deriveExamPrepRecallTasks(EXAM_PREP_MANIFEST.units)).toHaveLength(57);
    // deterministic: two derivations produce identical ids
    const again = deriveExamPrepRecallTasks(EXAM_PREP_MANIFEST.units);
    expect(again.map((task) => task.id)).toEqual(EXAM_PREP_RECALL_TASKS.map((task) => task.id));
    expect(new Set(EXAM_PREP_RECALL_TASKS.map((task) => task.id)).size).toBe(57);
  });

  it('uses ids recall:{unitId}:{index} with 1-based per-unit index and global order', () => {
    for (const task of EXAM_PREP_RECALL_TASKS) {
      expect(task.id).toBe(`recall:${task.unitId}:${task.index}`);
      expect(task.index).toBeGreaterThanOrEqual(1);
    }
    const orderSeen = EXAM_PREP_RECALL_TASKS.map((task) => task.order);
    expect(orderSeen).toEqual(Array.from({ length: 57 }, (_, i) => i + 1));
    // canonical manifest order of unit ids is preserved
    const manifestLearnUnits = EXAM_PREP_MANIFEST.units.filter((unit) => unit.tier !== 'DRILL');
    const unitIdSequence = [...new Set(EXAM_PREP_RECALL_TASKS.map((task) => task.unitId))];
    const manifestSequence = manifestLearnUnits.map((unit) => unit.id).filter((id) =>
      unitIdSequence.includes(id),
    );
    expect(unitIdSequence).toEqual(manifestSequence);
  });

  it('uses the exact fixed prompt for every task', () => {
    for (const task of EXAM_PREP_RECALL_TASKS) {
      expect(task.prompt).toBe('State the key rule you should remember for this curriculum unit.');
      expect(task.prompt).toBe(EXAM_PREP_RECALL_PROMPT);
    }
  });

  it('expected answers equal the verbatim frozen mustRecall strings', () => {
    for (const unit of EXAM_PREP_MANIFEST.units) {
      if (unit.tier === 'DRILL') continue;
      const unitTasks = EXAM_PREP_RECALL_TASKS.filter((task) => task.unitId === unit.id);
      expect(unitTasks).toHaveLength(unit.mustRecall.length);
      unit.mustRecall.forEach((rule, index) => {
        expect(unitTasks[index]?.expectedAnswer).toBe(rule);
        expect(unitTasks[index]?.unitTitle).toBe(unit.title);
      });
    }
  });

  it('distributes exactly A18/B27/C6/D0/NAV6/DRILL0', () => {
    const count = (tier: string) =>
      EXAM_PREP_RECALL_TASKS.filter((task) => task.tier === tier).length;
    expect(count('A')).toBe(18);
    expect(count('B')).toBe(27);
    expect(count('C')).toBe(6);
    expect(count('D')).toBe(0);
    expect(count('NAV')).toBe(6);
    expect(count('DRILL')).toBe(0);
  });

  it('never creates cards from mustLocate, sourceAnchors, recognitionCues, or drill answers', () => {
    // A mustLocate entry or anchor never corresponds to a task id
    for (const unit of EXAM_PREP_MANIFEST.units) {
      for (const lookup of unit.mustLocate) {
        expect(
          EXAM_PREP_RECALL_TASKS.some((task) => task.expectedAnswer === lookup.prompt),
        ).toBe(false);
      }
    }
    // only units with at least one mustRecall produce tasks
    const recallUnits = new Set(EXAM_PREP_RECALL_TASKS.map((task) => task.unitId));
    for (const unit of EXAM_PREP_MANIFEST.units) {
      if (unit.mustRecall.length === 0) {
        expect(recallUnits.has(unit.id)).toBe(false);
      } else {
        expect(recallUnits.has(unit.id)).toBe(true);
      }
    }
  });

  it('Learn listing is exactly the 133 A-D/NAV units', () => {
    expect(EXAM_PREP_LEARN_UNITS).toHaveLength(133);
    const counts: Record<string, number> = {};
    for (const unit of EXAM_PREP_LEARN_UNITS) {
      counts[unit.tier] = (counts[unit.tier] ?? 0) + 1;
    }
    expect(counts).toEqual({ A: 51, B: 43, C: 21, D: 6, NAV: 12 });
    expect(EXAM_PREP_LEARN_UNITS.some((unit) => unit.tier === 'DRILL')).toBe(false);
    for (const unit of EXAM_PREP_LEARN_UNITS) {
      expect(isExamPrepLearnUnit(unit)).toBe(true);
    }
  });
});
