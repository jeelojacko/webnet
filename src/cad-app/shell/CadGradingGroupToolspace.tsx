/**
 * Phase 20C Wave-4A — Toolspace Design → Grading Groups node.
 *
 * Name / course count / side / target / status summary with an expandable
 * corner + CURRENT result block. No per-daylight-point tree (one row per
 * group). Stale results show an explicit STALE label; never a silent
 * CURRENT claim.
 */
import React from 'react';
import { numeric } from '../../engine/cad/cadPropertiesModel';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import type { CadGradingGroupRow } from './cadGradingGroupSnapshot';
import { gradingTargetSummary } from './cadGradingShell';
import { relativeElevationDisplay } from './cadGradingDisplay';

const TreeGroup: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <details className="cad-shell-tree-group" open>
    <summary>{label}</summary>
    <div className="cad-shell-tree-children">{children}</div>
  </details>
);

const DefinitionRow: React.FC<{ row: CadGradingGroupRow }> = ({ row }) => {
  const relative = relativeElevationDisplay(row.definition.criterion, row.lengthUnit);
  return (
    <div className="cad-shell-tree-row" data-cad-grading-group-definition={row.id} data-cad-grading-group-method={row.methodSummary.label}>
      <span>Method {row.methodSummary.label}{row.methodSummary.mixedAnalytic ? ` (${row.methodSummary.detail})` : ''}</span>
      <span> · Source {row.sourceName}</span>
      <span> · {row.courseCount} courses{row.closed ? ' (closed)' : ''}</span>
      <span> · {row.side}</span>
      <span> · {row.methodSummary.mixedAnalytic ? 'Target: Not applicable' : gradingTargetSummary(row.definition.criterion, row.targetName, row.lengthUnit)}</span>
      {relative ? (
        <>
          <span data-cad-grading-group-relative-grade> · Grade {relative.grade}</span>
          <span data-cad-grading-group-relative-elevation> · Δ {relative.relativeElevation}</span>
          <span data-cad-grading-group-relative-offset> · offset {relative.derivedOffset}</span>
        </>
      ) : null}
      <span> · max {numeric(row.maxSearchDistance)} {row.lengthUnit}</span>
    </div>
  );
};

/** Phase 20E: group default + override count (never per-override child nodes). */
const CriteriaRow: React.FC<{ row: CadGradingGroupRow }> = ({ row }) => (
  <div className="cad-shell-tree-row" data-cad-grading-group-criteria-summary={row.id}>
    <span>Criteria: Default {row.criterionText}</span>
    <span> · Overrides:{row.overrideCount}</span>
  </div>
);

const ResultRow: React.FC<{ row: CadGradingGroupRow }> = ({ row }) => {
  if (row.metrics == null) {
    return (
      <div className="cad-shell-tree-row" data-cad-grading-group-result={row.id}>
        {row.stale ? 'Result: STALE (recalculate)' : 'Result: none — Calculate'}
      </div>
    );
  }
  const m = row.metrics;
  return (
    <div className="cad-shell-tree-row" data-cad-grading-group-result={row.id}>
      {row.stale ? 'Result (STALE): ' : 'Result: '}
      <span>{row.accuracyText}</span>
      <span> · {m.memberCount} members</span>
      <span> · {m.cornerCount} corners</span>
      <span> · source {numeric(m.sourceLength)} {row.lengthUnit}</span>
      <span> · tie {numeric(m.minProjectionDistance)}–{numeric(m.maxProjectionDistance)} {row.lengthUnit}</span>
      <span> · mean {numeric(m.meanProjectionDistance)} {row.lengthUnit}</span>
      <span> · plan {numeric(m.gradingPlanArea)} {row.areaUnit}</span>
      <span> · 3D {numeric(m.grading3dArea)} {row.areaUnit}</span>
      <span> · {m.triangleCount} tri</span>
      <span data-cad-grading-group-cutfill>
        {' '}· cut/fill/tied {row.cutFillApplicable ? `${numeric(m.cutSourceLength)}/${numeric(m.fillSourceLength)}/${numeric(m.tiedSourceLength)} ${row.lengthUnit}` : '— (analytic)'}
      </span>
      <span> · diagnostics {m.diagnostics.length > 0 ? m.diagnostics.join('/') : 'none'}</span>
    </div>
  );
};

const CornerRow: React.FC<{ row: CadGradingGroupRow }> = ({ row }) => {
  if (row.cornerSummary.length === 0) return null;
  return (
    <div className="cad-shell-tree-row" data-cad-grading-group-corners={row.id}>
      {row.cornerSummary.map((line, index) => (
        <div key={index}>{line}</div>
      ))}
    </div>
  );
};

export const GradingGroupsNode: React.FC<{
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
}> = ({ snapshot, actions }) => {
  const data = snapshot?.gradingGroups;
  if (!data) return null;
  return (
    <TreeGroup label={`Grading Groups (${data.groups.length})`}>
      {data.groups.map((row) => {
        const selected = data.selectedGroupId === row.id;
        return (
          <details key={row.id} className="cad-shell-tree-group" open data-cad-grading-group={row.id}>
            <summary
              className="cad-shell-tree-node"
              data-selected={selected ? 'true' : undefined}
              data-cad-grading-group-status={row.status}
              title={`${row.name} — ${row.statusText}`}
              onClick={() => actions?.selectGradingGroup?.(row.id)}
            >
              {row.name}
              <span className="cad-shell-count">
                {row.statusText}
                {row.stale ? ' (stale)' : ''}
              </span>
            </summary>
            <div className="cad-shell-tree-children">
              <DefinitionRow row={row} />
              <CriteriaRow row={row} />
              <ResultRow row={row} />
              {row.diagnostic ? (
                <div className="cad-shell-tree-row" data-cad-grading-group-diagnostic={row.id}>
                  Failed — {row.diagnostic}
                </div>
              ) : null}
              <CornerRow row={row} />
            </div>
          </details>
        );
      })}
      {data.groups.length === 0 ? (
        <div className="cad-shell-tree-row cad-shell-empty">
          No grading groups — Home → Grading → Grade Group.
        </div>
      ) : null}
    </TreeGroup>
  );
};
