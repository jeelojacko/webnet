/**
 * Phase 20C Wave-4A — Properties block for the selected grading group
 * (+ 20E per-course criteria: group default + override count, and a member
 * picker showing the effective criterion + Default/Override provenance).
 *
 * Definition + status + CURRENT metrics only; no arrays. Recalculation
 * status is text, never color-only.
 */
import React from 'react';
import { numeric } from '../../engine/cad/cadPropertiesModel';
import type { CadGradingGroupRow } from './cadGradingGroupSnapshot';
import {
  courseNumberLabel,
  effectiveCourseCriterion,
  courseCriterionSourceText,
  shortVertexLabel,
} from './cadGradingGroupCourseCriteria';
import { formatGradingCriterion, gradingTargetSummary } from './cadGradingShell';
import { relativeElevationDisplay } from './cadGradingDisplay';

export const GradingGroupPropertiesBlock: React.FC<{ row: CadGradingGroupRow }> = ({ row }) => {
  const [memberIndex, setMemberIndex] = React.useState(0);
  const clamped = Math.min(memberIndex, Math.max(0, row.definition.sourceCourses.length - 1));
  const course = row.definition.sourceCourses[clamped];
  const relative = relativeElevationDisplay(row.definition.criterion, row.lengthUnit);
  const memberCriterion = course ? effectiveCourseCriterion(row.definition, clamped) : null;
  const memberRelative = memberCriterion ? relativeElevationDisplay(memberCriterion, row.lengthUnit) : null;
  return (
    <div data-cad-grading-group-properties={row.id} data-cad-grading-group-method={row.methodSummary.label}>
      <h3>Grading Group</h3>
      <dl>
        <div><dt>Name</dt><dd>{row.name}</dd></div>
        <div><dt>Method</dt><dd data-cad-grading-group-properties-method>{row.methodSummary.label}</dd></div>
        {row.methodSummary.mixedAnalytic ? (
          <div><dt>Methods</dt><dd data-cad-grading-group-properties-methods>{row.methodSummary.detail}</dd></div>
        ) : null}
        <div><dt>Domain</dt><dd>{row.analytic ? 'Analytic' : 'Surface'}</dd></div>
        <div><dt>Source</dt><dd>{row.sourceName}</dd></div>
        <div><dt>Courses</dt><dd>{row.courseCount}{row.closed ? ' (closed)' : ''} · {row.courseRefs}</dd></div>
        <div><dt>Side</dt><dd>{row.side}</dd></div>
        <div><dt>Target</dt><dd>{row.methodSummary.mixedAnalytic ? 'Not applicable' : gradingTargetSummary(row.definition.criterion, row.targetName, row.lengthUnit)}</dd></div>
        <div><dt>Default Criterion</dt><dd>{row.criterionText}</dd></div>
        {relative ? (
          <>
            <div><dt>Default Grade</dt><dd data-cad-grading-group-relative-grade>{relative.grade}</dd></div>
            <div><dt>Default Relative Elevation</dt><dd data-cad-grading-group-relative-elevation>{relative.relativeElevation}</dd></div>
            <div><dt>Derived horizontal offset</dt><dd data-cad-grading-group-relative-offset>{relative.derivedOffset}</dd></div>
          </>
        ) : null}
        <div><dt>Override Count</dt><dd>{row.overrideCount}</dd></div>
        <div><dt>Corner</dt><dd>{row.cornerMode}</dd></div>
        <div><dt>Max distance</dt><dd>{numeric(row.maxSearchDistance)} {row.lengthUnit}</dd></div>
        <div><dt>Curve tolerance</dt><dd>{numeric(row.curveChordTolerance)} {row.lengthUnit}</dd></div>
        <div><dt>Status</dt><dd data-cad-grading-group-status-reason>{row.statusText}{row.stale ? ' (stale result withheld)' : ''}{row.diagnostic ? ` — ${row.diagnostic}` : ''}</dd></div>
        <div><dt>Accuracy</dt><dd>{row.accuracyText}{row.curveCornerApproximated ? ' (corner)' : ''}</dd></div>
        {course ? (
          <>
            <div>
              <dt>Member</dt>
              <dd>
                <select
                  aria-label="Properties member"
                  value={String(clamped)}
                  onChange={(e) => setMemberIndex(Number(e.target.value))}
                  data-cad-grading-group-properties-member
                >
                  {row.definition.sourceCourses.map((entry, i) => (
                    <option key={`${entry.vertexAId}>${entry.vertexBId}`} value={String(i)}>
                      {courseNumberLabel(i)} ({shortVertexLabel(entry.vertexAId)}→{shortVertexLabel(entry.vertexBId)})
                    </option>
                  ))}
                </select>
              </dd>
            </div>
            <div><dt>Member Effective</dt><dd>{formatGradingCriterion(effectiveCourseCriterion(row.definition, clamped))}</dd></div>
            {memberRelative ? (
              <>
                <div><dt>Member Effective Grade</dt><dd data-cad-grading-group-member-relative-grade>{memberRelative.grade}</dd></div>
                <div><dt>Member Effective Relative Elevation</dt><dd data-cad-grading-group-member-relative-elevation>{memberRelative.relativeElevation}</dd></div>
                <div><dt>Member Derived Offset</dt><dd data-cad-grading-group-member-relative-offset>{memberRelative.derivedOffset}</dd></div>
              </>
            ) : null}
            <div><dt>Member Source</dt><dd>{courseCriterionSourceText(row.definition, clamped)}</dd></div>
          </>
        ) : null}
        {row.metrics ? (
          <>
            <div><dt>Members / Corners</dt><dd>{row.metrics.memberCount} / {row.metrics.cornerCount}</dd></div>
            <div><dt>Source length</dt><dd>{numeric(row.metrics.sourceLength)} {row.lengthUnit}</dd></div>
            <div><dt>Tie distance</dt><dd>{numeric(row.metrics.minProjectionDistance)} – {numeric(row.metrics.maxProjectionDistance)} {row.lengthUnit} (mean {numeric(row.metrics.meanProjectionDistance)})</dd></div>
            <div><dt>Plan area</dt><dd>{numeric(row.metrics.gradingPlanArea)} {row.areaUnit}</dd></div>
            <div><dt>3D area</dt><dd>{numeric(row.metrics.grading3dArea)} {row.areaUnit}</dd></div>
            <div><dt>{row.boundaryLabel} vertices</dt><dd>{row.metrics.vertexCount}</dd></div>
            <div><dt>Triangles</dt><dd>{row.metrics.triangleCount}</dd></div>
            <div><dt>Cut / Fill / Tied length</dt><dd data-cad-grading-group-cutfill>{row.cutFillApplicable ? `${numeric(row.metrics.cutSourceLength)} / ${numeric(row.metrics.fillSourceLength)} / ${numeric(row.metrics.tiedSourceLength)} ${row.lengthUnit}` : '— (analytic)'}</dd></div>
            <div><dt>Multiple roots</dt><dd>{row.metrics.multipleSolutionCount}</dd></div>
            <div><dt>Diagnostics</dt><dd>{row.metrics.diagnostics.length > 0 ? row.metrics.diagnostics.join(' · ') : 'none'}</dd></div>
          </>
        ) : null}
      </dl>
    </div>
  );
};
