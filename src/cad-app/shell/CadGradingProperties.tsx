/**
 * Phase 20B — Properties block for the selected grading.
 *
 * Definition + criterion + derived status + CURRENT metrics only; no raw
 * arrays. Recalculation status is text, never color-only.
 */
import React from 'react';
import { numeric } from '../../engine/cad/cadPropertiesModel';
import type { CadGradingRow } from './cadGradingSnapshot';

export const GradingPropertiesBlock: React.FC<{ row: CadGradingRow }> = ({ row }) => (
  <div data-cad-grading-properties={row.id}>
    <h3>Grading</h3>
    <dl>
      <div><dt>Name</dt><dd>{row.name}</dd></div>
      <div><dt>Source</dt><dd>{row.sourceName}</dd></div>
      <div><dt>Course</dt><dd>{row.definition.sourceCourse.vertexAId} → {row.definition.sourceCourse.vertexBId}</dd></div>
      <div><dt>Side</dt><dd>{row.side}</dd></div>
      <div><dt>Target</dt><dd>{row.targetName}</dd></div>
      <div><dt>Criterion</dt><dd>{row.criterionText}</dd></div>
      <div><dt>Max distance</dt><dd>{numeric(row.maxSearchDistance)} m</dd></div>
      <div><dt>Curve tolerance</dt><dd>{numeric(row.curveChordTolerance)} m</dd></div>
      <div><dt>Status</dt><dd>{row.statusText}{row.stale ? ' (stale result withheld)' : ''}</dd></div>
      <div><dt>Accuracy</dt><dd>{row.accuracyText}</dd></div>
      {row.metrics ? (
        <>
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
