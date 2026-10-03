/**
 * Phase 20M.2 WAVE H — minimal transition editor (SHELL/UI ONLY).
 *
 * Exactly two user-owned inputs: explicit numeric total width
 * (source-line meters) and a law selector fixed to the single registered
 * TRANSITION_LINEAR_V1 (version persisted). One transition per group at a
 * valid joint; unsupported joints show the truthful admission reason;
 * removal restores legacy. No auto-width, no implicit creation. Commits ride
 * GROUP_SET/TRANSITION + GROUP_CLEAR_TRANSITION (one undo step each) and
 * the operator recalculates after commit (revision participation belongs to
 * the sibling persistence wave — the notice says so).
 */
import React from 'react';
import type {
  GradingCriterion,
  GradingSide,
  ResolvedGradingSource,
} from '../../engine/cad/grading/gradingTypes';
import type { CadGradingGroup } from '../../engine/cad/grading/gradingGroupTypes';
import {
  TRANSITION_LAW_KIND,
  TRANSITION_LAW_VERSION,
} from '../../engine/cad/grading/gradingTransitionPolicy';
import {
  groupTransitions,
  transitionJointEligibility,
  validateTransitionWidth,
} from '../../engine/cad/grading/gradingTransitionAuthoring';
import type { CadGradingGroupShellCommand } from './cadGradingGroupShell';
import { buttonClass, inputClass } from '../../components/surveyCad/surveyManagerShared';
import { Field } from '../../components/surveyCad/surveyManagerShared.tsx';

interface CadGradingGroupTransitionPanelProps {
  group: CadGradingGroup;
  memberSources: readonly ResolvedGradingSource[] | null;
  memberCriteria: readonly GradingCriterion[];
  side: GradingSide;
  run: (_command: CadGradingGroupShellCommand) => boolean;
  onNotice: (_message: string) => void;
}

const jointCountOf = (group: CadGradingGroup): number => {
  const n = group.sourceCourses.length;
  return group.closed === true ? n : Math.max(0, n - 1);
};

export const CadGradingGroupTransitionPanel: React.FC<CadGradingGroupTransitionPanelProps> = ({
  group,
  memberSources,
  memberCriteria,
  side,
  run,
  onNotice,
}) => {
  const existing = groupTransitions(group);
  const current = existing.length > 0 ? existing[0]! : null;
  const joints = React.useMemo(() => {
    const count = jointCountOf(group);
    return Array.from({ length: count }, (_, index) => {
      if (!memberSources) return { index, eligible: null as null | { ok: true; jointId: string; memberIds: [string, string] } | { ok: false; reason: string } };
      return {
        index,
        eligible: transitionJointEligibility({
          group,
          memberSources,
          memberCriteria,
          side,
          jointIndex: index,
        }),
      };
    });
  }, [group, memberSources, memberCriteria, side]);
  const [jointIndex, setJointIndex] = React.useState(0);
  const [widthText, setWidthText] = React.useState(current ? String(current.width) : '');
  const selected = joints[jointIndex] ?? null;
  const selectedEligible = selected?.eligible != null && selected.eligible.ok === true ? selected.eligible : null;

  const handleAdd = (): void => {
    if (!selectedEligible) {
      onNotice('Transition not added — pick a supported joint.');
      return;
    }
    const width = Number(widthText);
    const lengths = memberSources
      ? ([memberSources[jointIndex]!.length, memberSources[jointIndex + 1]!.length] as [number, number])
      : null;
    const widthError = lengths ? validateTransitionWidth(width, lengths) : 'member sources unavailable';
    if (widthError) {
      onNotice(`Transition not added — ${widthError}.`);
      return;
    }
    const kinds = [memberCriteria[jointIndex]?.kind, memberCriteria[jointIndex + 1]?.kind];
    const ok = run({
      key: 'GROUP_SET_TRANSITION',
      groupId: group.id,
      intent: {
        policyVersion: 'trp1',
        jointId: selectedEligible.jointId,
        memberIds: [...selectedEligible.memberIds],
        width,
        lawKind: TRANSITION_LAW_KIND,
        lawVersion: TRANSITION_LAW_VERSION,
        criterionFamily: kinds[0] === kinds[1] ? kinds[0]! : '',
        side,
      },
    });
    onNotice(ok
      ? 'Transition staged — recalculate the group to apply it (revision accounting follows in the persistence wave).'
      : 'Transition not added — the intent was rejected.');
  };

  const handleRemove = (): void => {
    const ok = run({ key: 'GROUP_CLEAR_TRANSITION', groupId: group.id });
    onNotice(ok ? 'Transition removed — the group is legacy again; recalculate.' : 'Transition not removed.');
  };

  if (current) {
    return (
      <div className="mt-2" data-cad-grading-group-transition-panel>
        <p className="text-[11px] text-slate-300">
          Transition at {current.jointId} · {current.lawKind}/{current.lawVersion} · width {current.width} m (source-line).
        </p>
        <button type="button" className={buttonClass} onClick={handleRemove} data-cad-grading-group-transition-remove>
          Remove transition
        </button>
      </div>
    );
  }
  return (
    <div className="mt-2" data-cad-grading-group-transition-panel>
      <Field label="Joint">
        <select
          aria-label="Transition joint"
          className={inputClass}
          value={jointIndex}
          onChange={(e) => setJointIndex(Number(e.target.value))}
        >
          {joints.map((joint) => (
            <option key={joint.index} value={joint.index}>
              {`joint:${joint.index}`}
              {joint.eligible == null
                ? ' (sources unavailable)'
                : joint.eligible.ok === true
                  ? ''
                  : ` — ${joint.eligible.reason}`}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Total width, source-line meters">
        <input aria-label="Transition width" className={inputClass} value={widthText} onChange={(e) => setWidthText(e.target.value)} />
      </Field>
      <Field label="Transition law">
        <select aria-label="Transition law" className={inputClass} value={TRANSITION_LAW_KIND} onChange={() => undefined}>
          <option value={TRANSITION_LAW_KIND}>{`${TRANSITION_LAW_KIND}/${TRANSITION_LAW_VERSION}`}</option>
        </select>
      </Field>
      <button
        type="button"
        className={buttonClass}
        onClick={handleAdd}
        disabled={selectedEligible === null}
        data-cad-grading-group-transition-add
      >
        Add transition
      </button>
    </div>
  );
};
