/**
 * Phase 20F.2 §19 — Cut/Fill criterion draft round-trip.
 *
 * The criterion producer (`defaultGradingCriterionDraft` cut/fill defaults,
 * `gradingCriterionDraftFromCriterion` re-open) and the draft parser must
 * agree on the explicit `nH:1V` textual form. A persisted Cut/Fill criterion
 * must reopen to a draft that parses straight back to the same semantics,
 * and bare magnitudes (`2`, `3`) must stay rejected.
 */
import { describe, expect, it } from 'vitest';

import {
  defaultGradingCriterionDraft,
  gradingCriterionDraftFromCriterion,
  parseGradingCriterionDraft,
} from '../src/cad-app/shell/cadGradingCriterionInput';
import { parseHorizontalVerticalRatio } from '../src/cad-app/shell/cadGradingShell';
import type { GradingCriterion } from '../src/engine/cad/grading/gradingTypes';

const cutFill = (cutGradeRatio: number, fillGradeRatio: number): GradingCriterion => ({
  kind: 'cut-fill',
  cutGradeRatio,
  fillGradeRatio,
});

describe('Phase 20F.2 cut/fill draft round-trip', () => {
  it('default surface draft parses as valid Cut/Fill the moment the kind is chosen', () => {
    const draft = { ...defaultGradingCriterionDraft('surface'), surfaceMode: 'cut-fill' as const };
    expect(draft.cutMagnitude).toBe('2:1');
    expect(draft.fillMagnitude).toBe('3:1');
    expect(parseGradingCriterionDraft(draft)).toEqual(cutFill(0.5, -1 / 3));
  });

  it('round-trips 2H:1V / 3H:1V and 1.5H:1V exactly', () => {
    const cases: GradingCriterion[] = [
      cutFill(0.5, -1 / 3),
      cutFill(1 / 1.5, -0.5),
    ];
    for (const criterion of cases) {
      const draft = gradingCriterionDraftFromCriterion(criterion);
      expect(draft.surfaceMode).toBe('cut-fill');
      expect(draft.cutMagnitude).toMatch(/H:1V$/);
      expect(draft.fillMagnitude).toMatch(/H:1V$/);
      expect(parseGradingCriterionDraft(draft)).toEqual(criterion);
    }
  });

  it('round-trips non-round engine values to the same semantic cut/fill', () => {
    for (const criterion of [cutFill(0.123456, -0.7777777), cutFill(0.025, -0.975)]) {
      if (criterion.kind !== 'cut-fill') continue;
      const parsed = parseGradingCriterionDraft(gradingCriterionDraftFromCriterion(criterion));
      expect(parsed?.kind).toBe('cut-fill');
      if (parsed?.kind === 'cut-fill') {
        expect(parsed.cutGradeRatio).toBeCloseTo(criterion.cutGradeRatio, 12);
        expect(parsed.fillGradeRatio).toBeCloseTo(criterion.fillGradeRatio, 12);
      }
    }
  });

  it('names the canonical runs for the round-number cases', () => {
    const two = gradingCriterionDraftFromCriterion(cutFill(0.5, -1 / 3));
    expect(two.cutMagnitude).toBe('2H:1V');
    expect(two.fillMagnitude).toBe('3H:1V');
    const oneAndAHalf = gradingCriterionDraftFromCriterion(cutFill(1 / 1.5, -0.5));
    expect(oneAndAHalf.cutMagnitude).toBe('1.5H:1V');
    expect(oneAndAHalf.fillMagnitude).toBe('2H:1V');
  });

  it('still rejects bare magnitudes and keeps explicit nH:1V accepted', () => {
    expect(parseHorizontalVerticalRatio('2')).toBeNull();
    expect(parseHorizontalVerticalRatio('3')).toBeNull();
    expect(parseHorizontalVerticalRatio('2:1')).toBeCloseTo(0.5, 12);
    expect(parseHorizontalVerticalRatio('2H:1V')).toBeCloseTo(0.5, 12);

    const bare = {
      ...defaultGradingCriterionDraft('surface'),
      surfaceMode: 'cut-fill' as const,
      cutMagnitude: '2',
      fillMagnitude: '3',
    };
    expect(parseGradingCriterionDraft(bare)).toBeNull();
  });

  it('re-open of an existing Cut/Fill is valid without editing anything', () => {
    const persisted = cutFill(0.4, -1 / 3);
    expect(parseGradingCriterionDraft(gradingCriterionDraftFromCriterion(persisted))).toEqual(persisted);
  });
});
