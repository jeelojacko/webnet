import { describe, expect, it } from 'vitest';
import { EXAM_PREP_LEARN_UNITS } from '../../src/study/examPrep/examPrepRecallTasks';
import {
  appendImmutableAttempt,
  removeById,
  upsertById,
} from '../../src/study/examPrep/examPrepStateUpdates';
import { selectStudiedLearnUnitCount } from '../../src/study/examPrep/examPrepSelectors';
import {
  currentBinding,
  makeRecallAttempt,
  makeUnitProgress,
} from './exam_prep_test_support';

const unitA = EXAM_PREP_LEARN_UNITS[0];
const unitB = EXAM_PREP_LEARN_UNITS[1];
if (!unitA || !unitB) throw new Error('expected learn units');

describe('Exam Prep immutable state updates', () => {
  it('upserts by id without duplicating', () => {
    const record = makeUnitProgress(unitA.id, '2026-09-05T00:00:00.000Z');
    const updated = { ...record, studiedAt: '2026-09-06T00:00:00.000Z', updatedAt: '2026-09-06T00:00:00.000Z' };
    const once = upsertById([record], updated);
    expect(once).toHaveLength(1);
    expect(once[0]).toEqual(updated);
    const withNew = upsertById([record], makeUnitProgress(unitB.id));
    expect(withNew).toHaveLength(2);
  });

  it('removes by id', () => {
    const a = makeUnitProgress(unitA.id);
    const b = makeUnitProgress(unitB.id);
    expect(removeById([a, b], a.id)).toEqual([b]);
  });

  it('appends immutable attempts once and never rewrites an existing attempt id', () => {
    const attempt = makeRecallAttempt({ id: 'attempt-x', taskId: 'recall:x:1', unitId: unitA.id });
    const attempts = appendImmutableAttempt([], attempt);
    expect(attempts).toEqual([attempt]);
    const again = appendImmutableAttempt(attempts, attempt);
    expect(again).toHaveLength(1);
  });

  it('unit studied progress is independent per unit and per hash', () => {
    const aCurrent = makeUnitProgress(unitA.id, '2026-09-05T00:00:00.000Z', currentBinding);
    const aArchived = makeUnitProgress(unitA.id, '2026-08-01T00:00:00.000Z', {
      curriculumId: currentBinding.curriculumId,
      curriculumContentHash: 'archive-hash',
    });
    const bCurrent = makeUnitProgress(unitB.id, '2026-09-04T00:00:00.000Z', currentBinding);
    // studied counts are unaffected by unit B or archived copies of A
    expect(selectStudiedLearnUnitCount([aArchived])).toBe(0);
    expect(selectStudiedLearnUnitCount([aCurrent, bCurrent, aArchived])).toBe(2);
    expect(selectStudiedLearnUnitCount([aCurrent, aArchived])).toBe(1);
  });
});
