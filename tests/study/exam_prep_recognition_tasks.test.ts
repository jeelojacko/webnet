// Exam Prep Phase 2 — deterministic Recognition task derivation.
//
// Recognition tasks are derived PURELY from every A-D/NAV unit's
// `recognitionCues` in canonical manifest order (317: A 36 / B 35 / C 103 /
// D 24 / NAV 119; DRILL excluded). Each task id is
// `recognition:{unitId}:{1-based cueIndex}` and the expected documents are
// the source unit's exact `sourceDocumentIds`. mustLocate / mustRecall /
// drill answers never create recognition tasks, and no FSRS is involved.

import { describe, expect, it } from 'vitest';
import { EXAM_PREP_MANIFEST } from '../../src/study/examPrep/examPrepManifest';
import {
  deriveExamPrepRecognitionTasks,
  EXAM_PREP_RECOGNITION_TASKS,
} from '../../src/study/examPrep/examPrepRecognitionTasks';
import { EXAM_PREP_TOTAL_RECOGNITION_TASKS } from '../../src/study/examPrep/examPrepConstants';
import { isExamPrepLearnUnit } from '../../src/study/examPrep/examPrepRecallTasks';
import type { ExamPrepRecognitionTask } from '../../src/study/examPrep/examPrepTypes';

const units = EXAM_PREP_MANIFEST.units;

describe('Exam Prep deterministic Recognition task derivation', () => {
  it('derives exactly one task per A-D/NAV recognition cue in canonical order (317 total)', () => {
    const cueCount = units
      .filter(isExamPrepLearnUnit)
      .reduce((sum, unit) => sum + unit.recognitionCues.length, 0);
    expect(cueCount).toBe(317);
    expect(EXAM_PREP_TOTAL_RECOGNITION_TASKS).toBe(317);
    expect(EXAM_PREP_RECOGNITION_TASKS).toHaveLength(317);
    expect(deriveExamPrepRecognitionTasks(units)).toHaveLength(317);
    expect(new Set(EXAM_PREP_RECOGNITION_TASKS.map((task) => task.id)).size).toBe(317);
    // deterministic across derivations
    const again = deriveExamPrepRecognitionTasks(units);
    expect(again.map((task) => task.id)).toEqual(EXAM_PREP_RECOGNITION_TASKS.map((task) => task.id));
  });

  it('distributes exactly A36/B35/C103/D24/NAV119 with zero DRILL tasks', () => {
    const count = (tier: string) =>
      EXAM_PREP_RECOGNITION_TASKS.filter((task) => task.tier === tier).length;
    expect(count('A')).toBe(36);
    expect(count('B')).toBe(35);
    expect(count('C')).toBe(103);
    expect(count('D')).toBe(24);
    expect(count('NAV')).toBe(119);
    expect(count('DRILL')).toBe(0);
    expect(EXAM_PREP_RECOGNITION_TASKS.some((task) => task.unitId.startsWith('DRILL-'))).toBe(false);
  });

  it('uses ids recognition:{unitId}:{1-based cueIndex} and mirrors each frozen cue verbatim', () => {
    for (const unit of units) {
      const unitTasks = EXAM_PREP_RECOGNITION_TASKS.filter((task) => task.unitId === unit.id);
      if (unit.tier === 'DRILL') {
        expect(unitTasks).toHaveLength(0);
        continue;
      }
      expect(unitTasks).toHaveLength(unit.recognitionCues.length);
      unit.recognitionCues.forEach((cue, index) => {
        const task = unitTasks[index];
        expect(task?.id).toBe(`recognition:${unit.id}:${index + 1}`);
        expect(task?.cueIndex).toBe(index + 1);
        expect(task?.cue).toBe(cue);
        expect(task?.unitTitle).toBe(unit.title);
        expect(task?.tier).toBe(unit.tier);
      });
    }
  });

  it('expectedDocumentIds are exactly the source unit sourceDocumentIds (copy, no DRILL)', () => {
    for (const task of EXAM_PREP_RECOGNITION_TASKS) {
      const unit = units.find((entry) => entry.id === task.unitId);
      expect(unit).toBeTruthy();
      expect(task.expectedDocumentIds).toEqual(unit?.sourceDocumentIds ?? []);
      // DRILL answer lookups never leak into recognition cues
      expect(unit?.tier).not.toBe('DRILL');
    }
  });

  it('keeps canonical manifest order and carries reviewWeight + curriculumIndex', () => {
    const indexByUnit = new Map(units.map((unit, index) => [unit.id, index]));
    const seenUnits = new Set<string>();
    for (const task of EXAM_PREP_RECOGNITION_TASKS) {
      const unit = units[indexByUnit.get(task.unitId) ?? -1];
      expect(unit).toBeTruthy();
      expect(task.reviewWeight).toBe(unit?.reviewWeight);
      expect(task.curriculumIndex).toBe(indexByUnit.get(task.unitId));
      // cueIndex strictly ascending within a unit
      if (seenUnits.has(task.unitId)) continue;
      seenUnits.add(task.unitId);
      const unitTasks = EXAM_PREP_RECOGNITION_TASKS.filter(
        (entry) => entry.unitId === task.unitId,
      );
      const cueIndexes = unitTasks.map((entry) => entry.cueIndex);
      expect(cueIndexes).toEqual([...cueIndexes].sort((a, b) => a - b));
      expect(new Set(cueIndexes).size).toBe(cueIndexes.length);
    }
    // first task per unit appears in ascending curriculumIndex order
    const firstPerUnit = new Map<string, ExamPrepRecognitionTask>();
    for (const task of EXAM_PREP_RECOGNITION_TASKS) {
      if (!firstPerUnit.has(task.unitId)) firstPerUnit.set(task.unitId, task);
    }
    const firsts = [...firstPerUnit.values()];
    const curriculumOrder = [...firsts].sort(
      (a, b) => a.curriculumIndex - b.curriculumIndex,
    );
    expect(firsts.map((task) => task.id)).toEqual(curriculumOrder.map((task) => task.id));
  });

  it('never creates recognition tasks from mustLocate, mustRecall, or drill answers', () => {
    // every task maps back to an actual unit cue, so unrelated strings never
    // appear as cues
    const cueByUnit = new Map(units.map((unit) => [unit.id, unit.recognitionCues]));
    for (const task of EXAM_PREP_RECOGNITION_TASKS) {
      expect(cueByUnit.get(task.unitId)?.includes(task.cue)).toBe(true);
    }
  });
});
