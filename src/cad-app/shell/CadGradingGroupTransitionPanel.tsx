/**
 * Phase 20N.1 WAVE H — per-joint transition list/editor (SHELL/UI ONLY).
 *
 * Lists EVERY current intent in canonical joint order (joint + width/law per
 * row); the add form stages a new joint and re-staging an existing joint
 * replaces its width in place (never a duplicate record). Removal drops only
 * the named joint via GROUP_CLEAR_TRANSITION { jointId }. Width is explicit
 * user input (source-line meters); the law selector is fixed to the single
 * registered TRANSITION_LINEAR_V1. No auto-width, no implicit creation.
 * Commits ride GROUP_SET_TRANSITION + GROUP_CLEAR_TRANSITION (one undo step
 * each); the operator recalculates after commit.
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
import type { TransitionPersistedIntent } from '../../engine/cad/grading/gradingTransitionProvenance';
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

const jointIndexOf = (jointId: string): number | null => {
  const m = /^joint:(\d+)$/.exec(jointId);
  return m ? Number(m[1]) : null;
};

/** Stored list is truthful only when strictly increasing AND consecutive. */
const storedOrderWarning = (existing: readonly TransitionPersistedIntent[]): string | null => {
  const indices = existing.map((entry) => jointIndexOf(entry.jointId));
  if (indices.some((index) => index === null)) return 'Stored transitions carry a malformed joint id — recalculation will fail closed.';
  for (let i = 1; i < indices.length; i += 1) {
    if (indices[i]! !== indices[i - 1]! + 1) {
      return 'Stored transitions are sparse or out of order — recalculation will fail closed; remove and re-stage them in order.';
    }
  }
  return null;
};

/**
 * Bounded separation verdict from available geometry only: with real member
 * lengths, adjacent staged transitions whose half-widths meet or overlap the
 * shared member are not authorized. Returns null when not detectable.
 */
const separationError = (
  merged: readonly TransitionPersistedIntent[],
  lengths: Readonly<Record<string, readonly [number, number]>> | null,
): string | null => {
  if (!lengths) return null;
  const ordered = [...merged].sort((a, b) => (jointIndexOf(a.jointId) ?? 0) - (jointIndexOf(b.jointId) ?? 0));
  for (let i = 0; i + 1 < ordered.length; i += 1) {
    const gap = lengths[ordered[i]!.jointId]?.[1];
    if (!Number.isFinite(gap) || !(gap! > 0)) return null;
    const halfSpan = ordered[i]!.width / 2 + ordered[i + 1]!.width / 2;
    if (halfSpan === gap) return 'touching transitions are not authorized — narrow a width';
    if (halfSpan > gap!) return 'overlapping transitions are not authorized — narrow a width';
  }
  return null;
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
  const ordered = React.useMemo(
    () => [...existing].sort((a, b) => (jointIndexOf(a.jointId) ?? 0) - (jointIndexOf(b.jointId) ?? 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [group],
  );
  const orderWarning = storedOrderWarning(existing);
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
  const existingByJoint = React.useMemo(() => new Map(existing.map((entry) => [entry.jointId, entry])), [group]); // eslint-disable-line react-hooks/exhaustive-deps
  const [jointIndex, setJointIndex] = React.useState(0);
  const [widthText, setWidthText] = React.useState('');
  const selected = joints[jointIndex] ?? null;
  const selectedEligible = selected?.eligible != null && selected.eligible.ok === true ? selected.eligible : null;
  const selectedExisting = selectedEligible ? (existingByJoint.get(selectedEligible.jointId) ?? null) : null;

  const pickJoint = (index: number): void => {
    setJointIndex(index);
    const jointId = `joint:${index}`;
    const staged = existingByJoint.get(jointId);
    setWidthText(staged ? String(staged.width) : '');
  };

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
    if (memberSources) {
      const jointLengths: Record<string, readonly [number, number]> = {};
      for (let j = 0; j + 1 < memberSources.length; j += 1) {
        jointLengths[`joint:${j}`] = [memberSources[j]!.length, memberSources[j + 1]!.length];
      }
      const merged: TransitionPersistedIntent[] = [
        ...existing.filter((entry) => entry.jointId !== selectedEligible.jointId),
        {
          policyVersion: 'trp1',
          jointId: selectedEligible.jointId,
          memberIds: [...selectedEligible.memberIds],
          width,
          lawKind: TRANSITION_LAW_KIND,
          lawVersion: TRANSITION_LAW_VERSION,
          criterionFamily: '',
          side,
        },
      ];
      const separation = separationError(merged, jointLengths);
      if (separation) {
        onNotice(`Transition not added — ${separation}.`);
        return;
      }
    }
    const kinds = [memberCriteria[jointIndex]?.kind, memberCriteria[jointIndex + 1]?.kind];
    const isEdit = selectedExisting != null;
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
      ? isEdit
        ? 'Transition updated — recalculate the group to apply it.'
        : 'Transition staged — recalculate the group to apply it (revision accounting follows in the persistence wave).'
      : 'Transition not added — the intent was rejected.');
  };

  const handleRemove = (jointId: string): void => {
    const ok = run({ key: 'GROUP_CLEAR_TRANSITION', groupId: group.id, jointId });
    onNotice(ok ? `Transition at ${jointId} removed — recalculate.` : `Transition at ${jointId} not removed.`);
  };

  return (
    <div className="mt-2" data-cad-grading-group-transition-panel>
      {orderWarning ? (
        <p className="text-[11px] text-amber-300" data-cad-grading-group-transition-order-warning>{orderWarning}</p>
      ) : null}
      {ordered.length > 0 ? (
        <ul className="mb-2 space-y-1" data-cad-grading-group-transition-list>
          {ordered.map((entry) => (
            <li key={entry.jointId} className="flex items-center gap-2 text-[11px] text-slate-300" data-cad-grading-group-transition-row={entry.jointId}>
              <span>
                Transition at {entry.jointId} · {entry.lawKind}/{entry.lawVersion} · width {entry.width} m (source-line).
              </span>
              <button
                type="button"
                className={buttonClass}
                onClick={() => handleRemove(entry.jointId)}
                data-cad-grading-group-transition-remove={entry.jointId}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-slate-400">No transitions staged — legacy grading applies.</p>
      )}
      <Field label="Joint">
        <select
          aria-label="Transition joint"
          className={inputClass}
          value={jointIndex}
          onChange={(e) => pickJoint(Number(e.target.value))}
        >
          {joints.map((joint) => (
            <option key={joint.index} value={joint.index}>
              {`joint:${joint.index}`}
              {existingByJoint.has(`joint:${joint.index}`) ? ' (staged — edits width)' : ''}
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
        {selectedExisting ? 'Update transition' : 'Add transition'}
      </button>
    </div>
  );
};
