/**
 * Phase 20E Wave-2A — per-course criteria editor (SHELL/UI ONLY).
 * Phase 20J Wave C2 — all five kinds (no domain lock): Surface Fixed /
 * Cut-Fill plus Distance / Elevation / Relative Elevation mix freely across
 * courses (hybrid). The override composer rides the shared criterion
 * machinery (`gradingCriterionDraftFromCriterion` +
 * `parseGradingCriterionDraft` + `<CadGradingCriterionFields>`, no local
 * parser). A Surface edit on a target-free group needs an explicit CURRENT
 * target (attached first, never silently); resetting the last Surface
 * override explains target-free and clears the dormant target id.
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
  gradingCriterionRequiresSurface,
  gradingTerminationDomain,
  type GradingCriterion,
} from '../../engine/cad/grading/gradingTypes';
import type { CadGradingGroup } from '../../engine/cad/grading/gradingGroupTypes';
import {
  buildCourseCriterionMap,
  effectiveCriterionForCourse,
  resolveGroupMemberCriteria,
} from '../../engine/cad/grading/gradingGroupCourseCriteria';
import type { CadGradingGroupShellCommand } from './cadGradingGroupShell';
import { CadGradingCriterionFields } from './CadGradingCriterionFields';
import {
  gradingCriterionDraftFromCriterion,
  parseGradingCriterionDraft,
  type GradingCriterionDraft,
} from './cadGradingCriterionInput';
import { HYBRID_CORNER_WARNING } from './cadGradingGroupMethodSummary';
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
  /** Eligible CURRENT target surfaces (target attach offers these only). */
  currentSurfaces?: ReadonlyArray<{ id: string; name: string }>;
}

/** Effective criteria with the named course indices reset to the group default. */
const effectiveAfterReset = (group: CadGradingGroup, reset: ReadonlySet<number>): GradingCriterion[] => {
  const map = buildCourseCriterionMap(group);
  return group.sourceCourses.map((course, index) =>
    reset.has(index) ? group.criterion : effectiveCriterionForCourse(group, map, course),
  );
};

/** True when every criterion in the set terminates analytically (target-free). */
const isFullyAnalytic = (criteria: readonly GradingCriterion[]): boolean =>
  criteria.every((criterion) => gradingTerminationDomain(criterion) === 'analytic');

/** Canonical identity of a persisted default criterion, used to resync the
 * composer on default/domain changes (undo/redo, Set Group Default) WITHOUT
 * resetting it on override-only edits that leave the default untouched. */
const criterionKey = (criterion: GradingCriterion): string => {
  switch (criterion.kind) {
    case 'fixed':
      return `fixed:${criterion.gradeRatio}`;
    case 'cut-fill':
      return `cut-fill:${criterion.cutGradeRatio}:${criterion.fillGradeRatio}`;
    case 'distance':
      return `distance:${criterion.gradeRatio}:${criterion.distance}`;
    case 'elevation':
      return `elevation:${criterion.gradeRatio}:${criterion.targetElevation}`;
    case 'relative-elevation':
      return `relative-elevation:${criterion.gradeRatio}:${criterion.relativeElevation}`;
  }
};

export const CadGradingGroupCriteriaPanel: React.FC<CadGradingGroupCriteriaPanelProps> = ({
  group,
  run,
  onNotice,
  lengthUnit = 'm',
  currentSurfaces = [],
}) => {
  const defaultKey = criterionKey(group.criterion);
  const [selected, setSelected] = React.useState<ReadonlySet<number>>(new Set());
  const [draft, setDraft] = React.useState<GradingCriterionDraft>(() =>
    gradingCriterionDraftFromCriterion(group.criterion),
  );
  // Target attach for a first Surface edit on a target-free group: offer
  // the first eligible CURRENT surface, explicit and never silent.
  const [targetId, setTargetId] = React.useState(() => currentSurfaces[0]?.id ?? '');
  // A newly selected group starts with no ticks.
  React.useEffect(() => {
    setSelected(new Set());
  }, [group.id]);
  // Refresh the composer whenever the persisted default changes: a new
  // group, undo/redo, or Set Group Default. Override-only edits leave the
  // default untouched, so active typing survives them.
  React.useEffect(() => {
    setDraft(gradingCriterionDraftFromCriterion(group.criterion));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id, defaultKey]);

  const overrideIndices = React.useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < group.sourceCourses.length; i += 1) {
      if (isCourseCriterionOverride(group, i)) out.push(i);
    }
    return out;
  }, [group]);
  // Courses riding the group default = the ones a default change will move.
  const defaultFollowerCount = group.sourceCourses.length - overrideIndices.length;

  const draftCriterion = parseGradingCriterionDraft(draft);
  // Hybrid warning: the live effective set already mixes, or the parsed
  // draft would introduce the missing domain on apply. A caution only —
  // never a calculability claim.
  const effectiveDomains = React.useMemo(() => {
    const domains = new Set(resolveGroupMemberCriteria(group).map(gradingTerminationDomain));
    if (draftCriterion) domains.add(gradingTerminationDomain(draftCriterion));
    return domains;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, draft]);
  const showHybridWarning = effectiveDomains.has('surface') && effectiveDomains.has('analytic');
  // A Surface draft on a group with NO stored target needs an explicit
  // CURRENT target riding in the SAME transaction (never silent). A stored
  // id — even a stale one — satisfies the authoring gate; target currency
  // stays Calculate's gate, never the editor's.
  const needsTargetAttach = draftCriterion != null && gradingCriterionRequiresSurface(draftCriterion) && group.targetSurfaceId == null;
  /** Selected CURRENT target, or null when none is eligible/selected. */
  const pickedTarget = currentSurfaces.some((surface) => surface.id === targetId) ? targetId : null;

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
    // First Surface edit on a target-free group: the explicit CURRENT
    // target rides in the SAME transaction (one Undo step); no eligible
    // target blocks before anything mutates.
    if (needsTargetAttach && pickedTarget == null) {
      onNotice('Override rejected — surface grading needs a CURRENT target; pick one first.');
      return;
    }
    const ok = run({
      key: 'GROUP_SET_COURSE_CRITERIA',
      groupId: group.id,
      courses: indices.map((i) => ({ ...group.sourceCourses[i]! })),
      criterion,
      ...(needsTargetAttach ? { targetSurfaceId: pickedTarget! } : {}),
    });
    onNotice(ok
      ? `${indices.length} course${indices.length === 1 ? '' : 's'} overridden — recalculate.` +
        (needsTargetAttach ? ' Target attached (same Undo step).' : ' Undo reverts (one step).')
      : 'Override rejected — no changes applied (check course refs and criterion).');
  };

  /**
   * Reset overrides. Landing fully analytic drops the dormant target id in
   * the SAME engine transaction, so the notice explains target-free with a
   * single Undo step — never a second silent command.
   */
  const resetCourses = (indices: number[]): boolean => {
    if (indices.length === 0) {
      onNotice('Nothing to reset — selected courses already ride the group default.');
      return false;
    }
    const ok = run({
      key: 'GROUP_RESET_COURSE_CRITERIA',
      groupId: group.id,
      courses: indices.map((i) => ({ ...group.sourceCourses[i]! })),
    });
    if (!ok) {
      onNotice('Reset rejected — no overrides on the named courses.');
      return false;
    }
    if (group.targetSurfaceId != null && isFullyAnalytic(effectiveAfterReset(group, new Set(indices)))) {
      onNotice('Group is now fully analytic (target-free) — stored target cleared with the reset. Undo reverts (one step).');
      return true;
    }
    onNotice(`${indices.length} override${indices.length === 1 ? '' : 's'} cleared — recalculate. Undo reverts (one step).`);
    return true;
  };

  const resetSelected = (): void => {
    resetCourses([...selected].filter((i) => isCourseCriterionOverride(group, i)));
  };

  const setDefault = (): void => {
    const criterion = parseGradingCriterionDraft(draft);
    if (!criterion) {
      onNotice('Default rejected — check the criterion values.');
      return;
    }
    // Surface default on a target-free group: the explicit CURRENT target
    // rides in the SAME transaction (atomic). A fully analytic result with
    // a stored id clears it in the same transaction (target-free); a group
    // with no stored id omits the field entirely (never a no-op clear).
    const prospective = group.sourceCourses.map((_course, i) =>
      isCourseCriterionOverride(group, i) ? effectiveCourseCriterion(group, i) : criterion,
    );
    const clearsTarget = group.targetSurfaceId != null && isFullyAnalytic(prospective);
    if (needsTargetAttach && pickedTarget == null) {
      onNotice('Default rejected — surface grading needs a CURRENT target; pick one first.');
      return;
    }
    const command: CadGradingGroupShellCommand = needsTargetAttach
      ? { key: 'GROUP_EDIT_CRITERIA', groupId: group.id, criterion, targetSurfaceId: pickedTarget! }
      : clearsTarget
        ? { key: 'GROUP_EDIT_CRITERIA', groupId: group.id, criterion, targetSurfaceId: null }
        : { key: 'GROUP_EDIT_CRITERIA', groupId: group.id, criterion };
    const ok = run(command);
    onNotice(ok
      ? `Group default set — ${defaultFollowerCount} course${defaultFollowerCount === 1 ? '' : 's'} changed, ${overrideIndices.length} override${overrideIndices.length === 1 ? '' : 's'} kept` +
        (needsTargetAttach ? ' · target attached (same Undo step).' : clearsTarget ? ' · now fully analytic (target-free); stored target cleared (same Undo step).' : '. Undo reverts (one step).')
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
        <table className="w-max min-w-full text-left text-[11px]">
          <thead className="whitespace-nowrap text-slate-400">
            <tr><th aria-label="Select">✓</th><th className="pr-2">Course</th><th className="pr-2">From</th><th className="pr-2">To</th><th className="pr-2">Type</th><th className="pr-2">Effective Criterion</th><th className="pr-2">Source</th><th>Action</th></tr>
          </thead>
          <tbody>
            {group.sourceCourses.map((course, index) => {
              const effective = effectiveCourseCriterion(group, index);
              const override = isCourseCriterionOverride(group, index);
              return (
                <tr key={`${course.vertexAId}>${course.vertexBId}`} data-cad-grading-group-criteria-row={index} className="whitespace-nowrap">
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${courseNumberLabel(index)}`}
                      checked={selected.has(index)}
                      onChange={() => toggle(index)}
                    />
                  </td>
                  <td className="pr-2">{courseNumberLabel(index)}</td>
                  <td className="pr-2">{shortVertexLabel(course.vertexAId)}</td>
                  <td className="pr-2">{shortVertexLabel(course.vertexBId)}</td>
                  <td className="pr-2">{courseCriterionTypeText(effective)}</td>
                  <td className="pr-2">{formatGradingCriterion(effective)}</td>
                  <td className="pr-2">{override ? 'Override' : 'Default'}</td>
                  <td>
                    <div className="flex gap-1">
                      <button type="button" className={buttonClass} onClick={() => applyTo([index])} data-cad-grading-group-criteria-override={index}>
                        Override
                      </button>
                      {override ? (
                        <button type="button" className={buttonClass} onClick={() => {
                          resetCourses([index]);
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
          onChange={setDraft}
          lengthUnit={lengthUnit}
          dataPrefix="cad-grading-group-criteria"
        />
      </div>
      {needsTargetAttach ? (
        <div className="mb-2" data-cad-grading-group-criteria-target>
          <label className="grid gap-1 text-[11px] text-slate-300">
            Target surface (CURRENT, required for Surface — attached before the edit)
            <select
              aria-label="Criteria target surface"
              className="mb-1 w-full border border-slate-600 bg-slate-800 text-[11px]"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
            >
              {currentSurfaces.length === 0 ? <option value="">No CURRENT surface</option> : null}
              {currentSurfaces.map((surface) => (
                <option key={surface.id} value={surface.id}>{surface.name}</option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      {showHybridWarning ? (
        <p className="mb-2 text-[11px] text-amber-300" data-cad-grading-group-hybrid-warning>
          {HYBRID_CORNER_WARNING}
        </p>
      ) : null}
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
