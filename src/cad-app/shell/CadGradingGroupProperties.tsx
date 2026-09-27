/**
 * Phase 20C Wave-4A — Properties block for the selected grading group.
 *
 * Definition + status + CURRENT metrics only; no arrays. Recalculation
 * status is text, never color-only.
 */
import React from 'react';
import { numeric } from '../../engine/cad/cadPropertiesModel';
import type { CadGradingGroupRow } from './cadGradingGroupSnapshot';

export const GradingGroupPropertiesBlock: React.FC<{ row: CadGradingGroupRow }> = ({ row }) => (
  <div data-cad-grading-group-properties={row.id}>
    <h3>Grading Group</h3>
    <dl>
      <div><dt>Name</dt><dd>{row.name}</dd></div>
      <div><dt>Source</dt><dd>{row.sourceName}</dd></div>
      <div><dt>Courses</dt><dd>{row.courseCount}{row.closed ? ' (closed)' : ''} · {row.courseRefs}</dd></div>
      <div><dt>Side</dt><dd>{row.side}</dd></div>
      <div><dt>Target</dt><dd>{row.targetName}</dd></div>
      <div><dt>Criterion</dt><dd>{row.criterionText}</dd></div>
      <div><dt>Corner</dt><dd>{row.cornerMode}</dd></div>
      <div><dt>Max distance</dt><dd>{numeric(row.maxSearchDistance)} m</dd></div>
      <div><dt>Curve tolerance</dt><dd>{numeric(row.curveChordTolerance)} m</dd></div>
      <div><dt>Status</dt><dd>{row.statusText}{row.stale ? ' (stale result withheld)' : ''}</dd></div>
      <div><dt>Accuracy</dt><dd>{row.accuracyText}{row.curveCornerApproximated ? ' (corner)' : ''}</dd></div>
      {row.metrics ? (
        <>
          <div><dt>Members / Corners</dt><dd>{row.metrics.memberCount} / {row.metrics.cornerCount}</dd></div>
          <div><dt>Tie distance</dt><dd>{numeric(row.metrics.minProjectionDistance)} – {numeric(row.metrics.maxProjectionDistance)} m (mean {numeric(row.metrics.meanProjectionDistance)})</dd></div>
          <div><dt>Plan area</dt><dd>{numeric(row.metrics.gradingPlanArea)} m²</dd></div>
          <div><dt>3D area</dt><dd>{numeric(row.metrics.grading3dArea)} m²</dd></div>
          <div><dt>Triangles</dt><dd>{row.metrics.triangleCount}</dd></div>
          <div><dt>Multiple roots</dt><dd>{row.metrics.multipleSolutionCount}</dd></div>
        </>
      ) : null}
    </dl>
  </div>
);
