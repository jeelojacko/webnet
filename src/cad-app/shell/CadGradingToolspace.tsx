/**
 * Phase 20B — Toolspace Design → Gradings node.
 *
 * Name / Status / Side / Target summary with an expandable criterion +
 * CURRENT result block. No daylight children (one row per grading). Stale
 * results show an explicit STALE label; never a silent CURRENT claim.
 */
import React from 'react';
import { numeric } from '../../engine/cad/cadPropertiesModel';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import type { CadGradingRow } from './cadGradingSnapshot';
import { gradingMethodLabel } from './cadGradingCriterionInput';
import { gradingTargetSummary } from './cadGradingShell';

const TreeGroup: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <details className="cad-shell-tree-group" open>
    <summary>{label}</summary>
    <div className="cad-shell-tree-children">{children}</div>
  </details>
);

const DefinitionRow: React.FC<{ row: CadGradingRow }> = ({ row }) => (
  <div className="cad-shell-tree-row" data-cad-grading-definition={row.id} data-cad-grading-method={row.method}>
    <span>Method {gradingMethodLabel(row.method)}</span>
    <span> · Source {row.sourceName}</span>
    <span> · {row.side}</span>
    <span> · {gradingTargetSummary(row.definition.criterion, row.targetName, row.lengthUnit)}</span>
    <span> · max {numeric(row.maxSearchDistance)} {row.lengthUnit}</span>
  </div>
);

const ResultRow: React.FC<{ row: CadGradingRow }> = ({ row }) => {
  if (row.metrics == null) {
    return (
      <div className="cad-shell-tree-row" data-cad-grading-result={row.id}>
        {row.stale ? 'Result: STALE (recalculate)' : 'Result: none — Calculate'}
      </div>
    );
  }
  const m = row.metrics;
  return (
    <div className="cad-shell-tree-row" data-cad-grading-result={row.id}>
      {row.stale ? 'Result (STALE): ' : 'Result: '}
      <span>{row.accuracyText}</span>
      <span> · source {numeric(m.sourceLength)} {row.lengthUnit}</span>
      <span> · tie {numeric(m.minProjectionDistance)}–{numeric(m.maxProjectionDistance)} {row.lengthUnit}</span>
      <span> · mean {numeric(m.meanProjectionDistance)} {row.lengthUnit}</span>
      <span> · plan {numeric(m.gradingPlanArea)} {row.areaUnit}</span>
      <span> · 3D {numeric(m.grading3dArea)} {row.areaUnit}</span>
      <span> · {m.vertexCount} {row.boundaryLabel.toLowerCase()} verts</span>
      <span> · {m.triangleCount} tri</span>
      <span data-cad-grading-cutfill>
        {' '}· cut/fill/tied {row.cutFillApplicable ? `${numeric(m.cutSourceLength)}/${numeric(m.fillSourceLength)}/${numeric(m.tiedSourceLength)} ${row.lengthUnit}` : '— (analytic)'}
      </span>
      <span> · diagnostics {m.diagnostics.length > 0 ? m.diagnostics.join('/') : 'none'}</span>
    </div>
  );
};

export const GradingsNode: React.FC<{
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
}> = ({ snapshot, actions }) => {
  const data = snapshot?.grading;
  if (!data) return null;
  return (
    <TreeGroup label={`Gradings (${data.gradings.length})`}>
      {data.gradings.map((row) => {
        const selected = data.selectedGradingId === row.id;
        return (
          <details key={row.id} className="cad-shell-tree-group" open data-cad-grading={row.id}>
            <summary
              className="cad-shell-tree-node"
              data-selected={selected ? 'true' : undefined}
              data-cad-grading-status={row.status}
              title={`${row.name} — ${row.statusText}`}
              onClick={() => actions?.selectGrading?.(row.id)}
            >
              {row.name}
              <span className="cad-shell-count">
                {row.statusText}
                {row.stale ? ' (stale)' : ''}
              </span>
            </summary>
            <div className="cad-shell-tree-children">
              <DefinitionRow row={row} />
              <ResultRow row={row} />
            </div>
          </details>
        );
      })}
      {data.gradings.length === 0 ? (
        <div className="cad-shell-tree-row cad-shell-empty">
          No gradings — Home → Grading → Grade to Surface.
        </div>
      ) : null}
    </TreeGroup>
  );
};
