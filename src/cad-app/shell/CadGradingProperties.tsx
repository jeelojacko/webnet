/**
 * Phase 20B — Properties block for the selected grading.
 *
 * Definition + criterion + derived status + CURRENT metrics only; no raw
 * arrays. Recalculation status is text, never color-only. Phase 20F:
 * analytic termination (distance/elevation) never shows a target surface,
 * and cut/fill/tied source lengths read N/A (—) instead of a fake zero.
 */
import React from 'react';
import { numeric } from '../../engine/cad/cadPropertiesModel';
import { gradingMethodLabel } from './cadGradingCriterionInput';
import { gradingTargetSummary } from './cadGradingShell';
import { relativeElevationDisplay } from './cadGradingDisplay';
import type { CadGradingRow } from './cadGradingSnapshot';

export const GradingPropertiesBlock: React.FC<{ row: CadGradingRow }> = ({ row }) => {
  const m = row.metrics;
  const lengthUnit = row.lengthUnit;
  const areaUnit = row.areaUnit;
  const relative = relativeElevationDisplay(row.definition.criterion, lengthUnit);
  const sourceRelation = row.cutFillApplicable
    ? `cut ${numeric(m?.cutSourceLength)} · fill ${numeric(m?.fillSourceLength)} · tied ${numeric(m?.tiedSourceLength)} ${lengthUnit}`
    : '— (analytic)';
  return (
    <div data-cad-grading-properties={row.id} data-cad-grading-method={row.method}>
      <h3>Grading</h3>
      <dl>
        <div><dt>Name</dt><dd>{row.name}</dd></div>
        <div><dt>Method</dt><dd data-cad-grading-properties-method>{gradingMethodLabel(row.method)}</dd></div>
        <div><dt>Source</dt><dd>{row.sourceName}</dd></div>
        <div><dt>Course</dt><dd>{row.definition.sourceCourse.vertexAId} → {row.definition.sourceCourse.vertexBId}</dd></div>
        <div><dt>Side</dt><dd>{row.side}</dd></div>
        <div><dt>Target</dt><dd>{gradingTargetSummary(row.definition.criterion, row.targetName, lengthUnit)}</dd></div>
        <div><dt>Criterion</dt><dd>{row.criterionText}</dd></div>
        {relative ? (
          <>
            <div><dt>Grade</dt><dd data-cad-grading-relative-grade>{relative.grade}</dd></div>
            <div><dt>Relative elevation</dt><dd data-cad-grading-relative-elevation>{relative.relativeElevation}</dd></div>
            <div><dt>Derived horizontal offset</dt><dd data-cad-grading-relative-offset>{relative.derivedOffset}</dd></div>
          </>
        ) : null}
        <div><dt>Max distance</dt><dd>{numeric(row.maxSearchDistance)} {lengthUnit}</dd></div>
        <div><dt>Curve tolerance</dt><dd>{numeric(row.curveChordTolerance)} {lengthUnit}</dd></div>
        <div><dt>Status</dt><dd data-cad-grading-status-reason>{row.statusText}{row.stale ? ' (stale result withheld)' : ''}{row.diagnostic ? ` — ${row.diagnostic}` : ''}</dd></div>
        <div><dt>Accuracy</dt><dd>{row.accuracyText}</dd></div>
        {m ? (
          <>
            <div><dt>Source length</dt><dd>{numeric(m.sourceLength)} {lengthUnit}</dd></div>
            <div><dt>Tie distance</dt><dd>{numeric(m.minProjectionDistance)} – {numeric(m.maxProjectionDistance)} {lengthUnit} (mean {numeric(m.meanProjectionDistance)})</dd></div>
            <div><dt>Plan area</dt><dd>{numeric(m.gradingPlanArea)} {areaUnit}</dd></div>
            <div><dt>3D area</dt><dd>{numeric(m.grading3dArea)} {areaUnit}</dd></div>
            <div><dt>{row.boundaryLabel} vertices</dt><dd>{m.vertexCount}</dd></div>
            <div><dt>Triangles</dt><dd>{m.triangleCount}</dd></div>
            <div><dt>Cut / Fill / Tied length</dt><dd data-cad-grading-cutfill>{sourceRelation}</dd></div>
            <div><dt>Multiple roots</dt><dd>{m.multipleSolutionCount}</dd></div>
            <div><dt>Diagnostics</dt><dd>{m.diagnostics.length > 0 ? m.diagnostics.join(' · ') : 'none'}</dd></div>
          </>
        ) : null}
      </dl>
    </div>
  );
};
