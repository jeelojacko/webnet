/**
 * Phase 20F — shared grading criterion fields (shell-only React).
 *
 * One field set reused by the Manage Create form AND the inline Edit
 * Criteria editor (grading + grading-group), so parsing/formatting lives in
 * exactly one place (`cadGradingCriterionInput`).
 */
import React from 'react';
import { inputClass } from '../../components/surveyCad/surveyManagerShared';
import { Field } from '../../components/surveyCad/surveyManagerShared.tsx';
import type { GradingTerminationKind } from '../../engine/cad/grading/gradingTypes';
import type { GradingCriterionDraft } from './cadGradingCriterionInput';
import { gradingMethodLabel, summarizeGradingCriterionDraft } from './cadGradingCriterionInput';
import {
  formatSignedGradePercent,
  parseHorizontalVerticalRatio,
  resolveSignedGradeRatio,
  type GradingInputMode,
  type GradingSlopeDirection,
} from './cadGradingShell';

const METHODS: readonly GradingTerminationKind[] = ['surface', 'distance', 'elevation'];

export interface CadGradingCriterionFieldsProps {
  draft: GradingCriterionDraft;
  onChange: (_draft: GradingCriterionDraft) => void;
  lengthUnit: string;
  /** Surface-only slot (target surface selector + CURRENT gate). */
  surfaceSlot?: React.ReactNode;
  /** Test attr prefix, e.g. `cad-grading` or `cad-grading-group`. */
  dataPrefix?: string;
  /**
   * Phase 20F.1: allowed termination methods. Defaults to all three.
   * Pass a single method to lock the composer to one family (the Method
   * selector collapses to a locked label — cross-family options are never
   * offered). Used by the per-course criteria editor.
   */
  methods?: readonly GradingTerminationKind[];
}

const GradeFields: React.FC<{
  draft: GradingCriterionDraft;
  onChange: (_draft: GradingCriterionDraft) => void;
  prefix: string;
}> = ({ draft, onChange, prefix }) => {
  const resolved = resolveSignedGradeRatio(draft.inputMode, Number(draft.magnitude), draft.direction);
  return (
    <>
      <Field label="Grade input">
        <select
          aria-label="Grade input method"
          className={inputClass}
          value={draft.inputMode}
          onChange={(e) => onChange({ ...draft, inputMode: e.target.value as GradingInputMode })}
        >
          <option value="percent">Percent</option>
          <option value="h-v">nH:1V</option>
        </select>
      </Field>
      <Field label="Signed grade">
        <input
          aria-label="Grade magnitude"
          className={inputClass}
          data-cad-grading-field={`${prefix}-magnitude`}
          value={draft.magnitude}
          onChange={(e) => onChange({ ...draft, magnitude: e.target.value })}
        />
      </Field>
      <Field label="Direction">
        <select
          aria-label="Grade direction"
          className={inputClass}
          value={draft.direction}
          onChange={(e) => onChange({ ...draft, direction: e.target.value as GradingSlopeDirection })}
        >
          <option value="up">Up</option>
          <option value="level">Level</option>
          <option value="down">Down</option>
        </select>
      </Field>
      <div className="self-end text-[11px] text-emerald-300" data-cad-grading-resolved-ratio={`${prefix}-grade`}>
        {resolved == null ? 'invalid' : formatSignedGradePercent(resolved)}
      </div>
    </>
  );
};

const CutFillFields: React.FC<{
  draft: GradingCriterionDraft;
  onChange: (_draft: GradingCriterionDraft) => void;
}> = ({ draft, onChange }) => {
  const cut = resolveSignedGradeRatio('h-v', parseHorizontalVerticalRatio(draft.cutMagnitude) ?? NaN, 'up');
  const fill = resolveSignedGradeRatio('h-v', parseHorizontalVerticalRatio(draft.fillMagnitude) ?? NaN, 'down');
  return (
    <>
      <Field label="Cut (nH:1V)">
        <input aria-label="Cut ratio" className={inputClass} value={draft.cutMagnitude} onChange={(e) => onChange({ ...draft, cutMagnitude: e.target.value })} />
      </Field>
      <Field label="Fill (nH:1V)">
        <input aria-label="Fill ratio" className={inputClass} value={draft.fillMagnitude} onChange={(e) => onChange({ ...draft, fillMagnitude: e.target.value })} />
      </Field>
      <div className="col-span-2 text-[11px] text-emerald-300" data-cad-grading-resolved-ratio="cut-fill">
        Cut {cut == null ? 'invalid' : formatSignedGradePercent(cut)} · Fill {fill == null ? 'invalid' : formatSignedGradePercent(fill)}
      </div>
    </>
  );
};

export const CadGradingCriterionFields: React.FC<CadGradingCriterionFieldsProps> = ({
  draft,
  onChange,
  lengthUnit,
  surfaceSlot,
  dataPrefix = 'cad-grading',
  methods = METHODS,
}) => {
  const offered = METHODS.filter((method) => methods.includes(method));
  const locked = offered.length === 1 ? offered[0]! : null;
  // Locked-family invariant: when locked to one family, the visible method and
  // the parsed criterion are forced to it, so an incoming mismatch can never
  // display or emit a different criterion than the locked label claims.
  const active = locked != null && draft.method !== locked ? { ...draft, method: locked } : draft;
  const summary = summarizeGradingCriterionDraft(active, lengthUnit);
  return (
    <>
      {locked != null ? (
        <p className="self-end text-[11px] text-slate-400" data-cad-grading-field={`${dataPrefix}-method-locked`}>
          Method: {gradingMethodLabel(locked)} (locked to group family)
        </p>
      ) : (
        <Field label="Method">
          <select
            aria-label="Grading method"
            className={inputClass}
            data-cad-grading-field={`${dataPrefix}-method`}
            value={active.method}
            onChange={(e) => onChange({ ...active, method: e.target.value as GradingTerminationKind })}
          >
            {offered.map((method) => (
              <option key={method} value={method}>{gradingMethodLabel(method)}</option>
            ))}
          </select>
        </Field>
      )}
      {active.method === 'surface' ? (
        <>
          {surfaceSlot}
          <Field label="Criterion">
            <select
              aria-label="Criterion kind"
              className={inputClass}
              value={active.surfaceMode}
              onChange={(e) => onChange({ ...active, surfaceMode: e.target.value as 'fixed' | 'cut-fill' })}
            >
              <option value="fixed">Fixed grade</option>
              <option value="cut-fill">Cut / Fill</option>
            </select>
          </Field>
          {active.surfaceMode === 'fixed' ? (
            <GradeFields draft={active} onChange={onChange} prefix={dataPrefix} />
          ) : (
            <CutFillFields draft={active} onChange={onChange} />
          )}
        </>
      ) : (
        <>
          <GradeFields draft={active} onChange={onChange} prefix={dataPrefix} />
          {active.method === 'distance' ? (
            <Field label={`Target distance (${lengthUnit})`}>
              <input
                aria-label="Target distance"
                className={inputClass}
                data-cad-grading-field={`${dataPrefix}-distance`}
                value={active.distance}
                onChange={(e) => onChange({ ...active, distance: e.target.value })}
              />
            </Field>
          ) : (
            <Field label={`Target elevation (${lengthUnit})`}>
              <input
                aria-label="Target elevation"
                className={inputClass}
                data-cad-grading-field={`${dataPrefix}-elevation`}
                value={active.targetElevation}
                onChange={(e) => onChange({ ...active, targetElevation: e.target.value })}
              />
            </Field>
          )}
        </>
      )}
      <div className="col-span-2 text-[11px] text-slate-300" data-cad-grading-criterion-summary>
        {summary == null ? 'Criterion: invalid' : `Criterion: ${summary}`}
      </div>
    </>
  );
};
