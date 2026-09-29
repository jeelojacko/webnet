/**
 * Phase 20E Wave-2A — per-course criteria editor (SHELL/UI ONLY).
 * Phase 20F.1 — override composer rides the shared criterion machinery
 * (`gradingCriterionDraftFromCriterion` + `parseGradingCriterionDraft` +
 * `<CadGradingCriterionFields>`, no local parser) and locks to the group
 * termination family: Surface groups offer Fixed + Cut/Fill only, Distance
 * groups Distance-only, Elevation groups Elevation-only. Cross-family
 * options are never offered, so the engine single-family gate cannot trip
 * from this UI.
 *
 * COURSE CRITERIA table (Course / From / To / Type / Effective Criterion /
 * Source) over the persisted traversal. Override and Reset ride one
 * transaction each (`GROUP_SET/RESET_COURSE_CRITERIA`); multi-select apply
 * is a single command (one undo). Sparse semantics: a criterion equal to
 * the group default removes the override record (`criteriaEqual`).
 * "Apply to All as Default" is explicit: set-group-default PLUS
 * clear-overrides as two labeled Undo steps — never a silent erase.
 * Changing the group default shows a live preview
 * ("N courses will change; M overrides remain") before commit.
 */
import React from 'react';
import {
  gradingTerminationKind,
  type GradingTerminationKind,
} from '../../engine/cad/grading/gradingTypes';
import type { GradingCriterion } from '../../engine/cad/grading/gradingTypes';
import type { CadGradingGroup } from '../../engine/cad/grading/gradingGroupTypes';
import type { CadGradingGroupShellCommand } from './cadGradingGroupShell';
import { CadGradingCriterionFields } from './CadGradingCriterionFields';
import {
  gradingCriterionDraftFromCriterion,
  parseGradingCriterionDraft,
  type GradingCriterionDraft,
} from './cadGradingCriterionInput';
import { formatGradingCriterion } from './cadGradingShell';
import {
  courseCriterionTypeText,
  courseNumberLabel,
  effectiveCourseCriterion,
  isCourseCriterionOverride,
  shortVertexLabel,
} from './cadGradingGroupCourseCriteria';
import { buttonClass } from '../../components/surveyCad/surveyManagerShared';

interface CadGradingGroupCriteriaPanelProps {
  group: CadGradingGroup;
  run: (_command: CadGradingGroupShellCommand) => boolean;
  onNotice: (_message: string) => void;
  lengthUnit?: string;
}

/** Clamp a draft back to the group family (the composer never leaves it). */
const clampToFamily = (
  family: GradingTerminationKind,
  draft: GradingCriterionDraft,
): GradingCriterionDraft =>
  draft.method === family ? draft : { ...draft, method: family };

const draftForFamily = (
  family: GradingTerminationKind,
  criterion: GradingCriterion,
): GradingCriterionDraft =>
  clampToFamily(family, gradingCriterionDraftFromCriterion(criterion));

export const CadGradingGroupCriteriaPanel: React.FC<CadGradingGroupCriteriaPanelProps> = ({
  group,
  run,
  onNotice,
  lengthUnit = 'm',
}) => {
  const family = gradingTerminationKind(group.criterion);
  const [selected, setSelected] = React.useState<ReadonlySet<number>>(new Set());
  const [draft, setDraft] = React.useState<GradingCriterionDraft>(() =>
    draftForFamily(family, group.criterion),
  );
  // A newly selected group starts the composer from its own default.
  React.useEffect(() => {
    setDraft(draftForFamily(gradingTerminationKind(group.criterion), group.criterion));
    setSelected(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id]);

  const overrideIndices = React.useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < group.sourceCourses.length; i += 1) {
      if (isCourseCriterionOverride(group, i)) out.push(i);
    }
    return out;
  }, [group]);
  // Courses riding the group default = the ones a default change will move.
  const defaultFollowerCount = group.sourceCourses.length - overrideIndices.length;

  const toggle = (index: number): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const applyTo = (indices: number[]): void => {
    const criterion = parseGradingCriterionDraft(draft);
    if (!criterion) {
      onNotice('Override rejected — check the criterion values.');
      return;
    }
    if (indices.length === 0) {
      onNotice('Nothing selected — tick one or more courses first.');
      return;
    }
    const ok = run({
      key: 'GROUP_SET_COURSE_CRITERIA',
      groupId: group.id,
      courses: indices.map((i) => ({ ...group.sourceCourses[i]! })),
      criterion,
    });
    onNotice(ok
      ? `${indices.length} course${indices.length === 1 ? '' : 's'} overridden — recalculate. Undo reverts (one step).`
      : 'Override rejected — no changes applied (check course refs and termination family).');
  };

  const resetSelected = (): void => {
    const indices = [...selected].filter((i) => isCourseCriterionOverride(group, i));
    if (indices.length === 0) {
      onNotice('Nothing to reset — selected courses already ride the group default.');
      return;
    }
    const ok = run({
      key: 'GROUP_RESET_COURSE_CRITERIA',
      groupId: group.id,
      courses: indices.map((i) => ({ ...group.sourceCourses[i]! })),
    });
    onNotice(ok
      ? `${indices.length} override${indices.length === 1 ? '' : 's'} cleared — recalculate. Undo reverts (one step).`
      : 'Reset rejected — no overrides on the named courses.');
  };

  const setDefault = (): void => {
    const criterion = parseGradingCriterionDraft(draft);
    if (!criterion) {
      onNotice('Default rejected — check the criterion values.');
      return;
    }
    const ok = run({ key: 'GROUP_EDIT_CRITERIA', groupId: group.id, criterion });
    onNotice(ok
      ? `Group default set — ${defaultFollowerCount} course${defaultFollowerCount === 1 ? '' : 's'} changed, ${overrideIndices.length} override${overrideIndices.length === 1 ? '' : 's'} kept. Undo reverts (one step).`
      : 'Default rejected — no changes applied (check the criterion values).');
  };

  const applyAllAsDefault = (): void => {
    const criterion = parseGradingCriterionDraft(draft);
    if (!criterion) {
      onNotice('Apply-to-all rejected — check the criterion values.');
      return;
    }
    const confirmed = window.confirm(
      `Apply to All as Default: set the group default to ${formatGradingCriterion(criterion)}` +
      ` AND clear ${overrideIndices.length} override${overrideIndices.length === 1 ? '' : 's'}.` +
      ' This commits two Undo steps (default, then clear). Proceed?',
    );
    if (!confirmed) return;
    if (!run({ key: 'GROUP_EDIT_CRITERIA', groupId: group.id, criterion })) {
      onNotice('Apply-to-all rejected — group default edit failed; no overrides touched.');
      return;
    }
    if (overrideIndices.length > 0) {
      const cleared = run({
        key: 'GROUP_RESET_COURSE_CRITERIA',
        groupId: group.id,
        courses: overrideIndices.map((i) => ({ ...group.sourceCourses[i]! })),
      });
      onNotice(cleared
        ? 'Applied to all as default — overrides cleared. Two Undo steps restore (clear, then default).'
        : 'Group default set, but clearing overrides failed — clear them manually. Two Undo steps restore.');
      return;
    }
    onNotice('Applied to all as default — no overrides to clear. One Undo step restores.');
  };

  return (
    <section className="mt-2" data-cad-grading-group-criteria={group.id}>
      <p className="mb-1 text-[11px] text-slate-300" data-cad-grading-group-criteria-default>
        Group default: {formatGradingCriterion(group.criterion)} · Overrides: {overrideIndices.length}
      </p>
      <div className="mb-2 overflow-auto">
        <table className="w-full text-left text-[11px]">
          <thead className="text-slate-400">
            <tr><th aria-label="Select">✓</th><th>Course</th><th>From</th><th>To</th><th>Type</th><th>Effective Criterion</th><th>Source</th><th>Action</th></tr>
          </thead>
          <tbody>
            {group.sourceCourses.map((course, index) => {
              const effective = effectiveCourseCriterion(group, index);
              const override = isCourseCriterionOverride(group, index);
              return (
                <tr key={`${course.vertexAId}>${course.vertexBId}`} data-cad-grading-group-criteria-row={index}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${courseNumberLabel(index)}`}
                      checked={selected.has(index)}
                      onChange={() => toggle(index)}
                    />
                  </td>
                  <td>{courseNumberLabel(index)}</td>
                  <td>{shortVertexLabel(course.vertexAId)}</td>
                  <td>{shortVertexLabel(course.vertexBId)}</td>
                  <td>{courseCriterionTypeText(effective)}</td>
                  <td>{formatGradingCriterion(effective)}</td>
                  <td>{override ? 'Override' : 'Default'}</td>
                  <td>
                    <div className="flex gap-1">
                      <button type="button" className={buttonClass} onClick={() => applyTo([index])} data-cad-grading-group-criteria-override={index}>
                        Override
                      </button>
                      {override ? (
                        <button type="button" className={buttonClass} onClick={() => {
                          const ok = run({
                            key: 'GROUP_RESET_COURSE_CRITERIA',
                            groupId: group.id,
                            courses: [{ ...course }],
                          });
                          onNotice(ok ? 'Override cleared — recalculate.' : 'Reset rejected.');
                        }} data-cad-grading-group-criteria-reset={index}>
                          Reset to Default
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mb-2 grid grid-cols-2 gap-2" data-cad-grading-group-criteria-form>
        <CadGradingCriterionFields
          draft={draft}
          onChange={(next) => setDraft(clampToFamily(family, next))}
          lengthUnit={lengthUnit}
          dataPrefix="cad-grading-group-criteria"
          methods={[family]}
        />
      </div>
      <div className="mb-2 flex flex-wrap gap-1">
        <button type="button" className={buttonClass} onClick={() => applyTo([...selected])} data-cad-grading-group-criteria-apply-selected>
          Apply to Selected
        </button>
        <button type="button" className={buttonClass} onClick={resetSelected} data-cad-grading-group-criteria-reset-selected>
          Reset to Default
        </button>
        <button type="button" className={buttonClass} onClick={applyAllAsDefault} data-cad-grading-group-criteria-apply-all>
          Apply to All as Default
        </button>
      </div>
      <div className="border-t border-slate-700 pt-2">
        <p className="mb-1 text-[11px] text-slate-300" data-cad-grading-group-criteria-default-preview>
          New default affects {defaultFollowerCount} course{defaultFollowerCount === 1 ? '' : 's'}; {overrideIndices.length} override{overrideIndices.length === 1 ? '' : 's'} remain.
        </p>
        <button type="button" className={buttonClass} onClick={setDefault} data-cad-grading-group-criteria-set-default>
          Set Group Default
        </button>
      </div>
    </section>
  );
};
