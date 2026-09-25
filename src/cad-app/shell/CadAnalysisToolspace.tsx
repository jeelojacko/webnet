import React from 'react';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';

/**
 * Phase 18U — analyses under their source node in the Toolspace:
 * Surfaces → surface → Analyses → (Elevation Map, Slope Map)
 * Volume Surfaces → volume → Analyses → (Depth Map)
 * Legends ride under the analysis that owns them. Aggregated rows only —
 * band regions/polygons are never listed (map display model).
 */
const AnalysisRows: React.FC<{
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions | null;
  sourceId: string;
  emptyText: string;
}> = ({ snapshot, actions, sourceId, emptyText }) => {
  const analysis = snapshot.analysis;
  if (!analysis) return null;
  const rows = analysis.analyses.filter((row) => row.sourceId === sourceId);
  return (
    <>
      {rows.map((row) => {
        const selected = analysis.selectedAnalysisId === row.id;
        const legends = analysis.legends.filter((legend) => legend.analysisId === row.id);
        return (
          <details
            key={row.id}
            className="cad-shell-tree-group"
            data-cad-analysis={row.id}
            data-cad-analysis-status={row.status}
          >
            <summary
              className="cad-shell-tree-node"
              data-selected={selected ? 'true' : undefined}
              title={`${row.name} — ${row.statusText}`}
              onClick={() => actions?.selectAnalysis?.(row.id)}
            >
              {row.typeLabel} Map
              <span className="cad-shell-count">
                {row.statusText}
                {row.stale ? ' (stale)' : ''}
              </span>
            </summary>
            <div className="cad-shell-tree-children">
              <div className="cad-shell-tree-row" title="Analysis definition">
                {row.name} · {row.bandCount} band{row.bandCount === 1 ? '' : 's'} ·{' '}
                {row.classifiedArea == null
                  ? 'no measured area'
                  : `${row.classifiedArea.toFixed(2)} classified`}
              </div>
              {legends.length > 0 ? (
                <details className="cad-shell-tree-group" data-cad-analysis-legends-node={row.id}>
                  <summary>Legends ({legends.length})</summary>
                  <div className="cad-shell-tree-children">
                    {legends.map((legend) => (
                      <div
                        key={legend.legendId}
                        className="cad-shell-tree-row"
                        data-cad-analysis-legend={legend.legendId}
                        title={`${legend.title} — ${legend.statusText}`}
                        onClick={() => actions?.selectAnalysisLegend?.(legend.legendId)}
                      >
                        {legend.title}
                        <span className="cad-shell-count">{legend.statusText}</span>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          </details>
        );
      })}
      {rows.length === 0 ? (
        <div className="cad-shell-tree-row cad-shell-empty" data-cad-analysis-empty={sourceId}>
          {emptyText}
        </div>
      ) : null}
    </>
  );
};

export const SurfaceAnalysesNode: React.FC<{
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions | null;
  surfaceId: string;
}> = ({ snapshot, actions, surfaceId }) => (
  <details className="cad-shell-tree-group" data-cad-surface-analyses={surfaceId}>
    <summary>Analyses</summary>
    <div className="cad-shell-tree-children">
      <AnalysisRows
        snapshot={snapshot}
        actions={actions}
        sourceId={surfaceId}
        emptyText="No analysis maps — Surface → Analysis → Elevation/Slope."
      />
    </div>
  </details>
);

export const VolumeAnalysesNode: React.FC<{
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions | null;
  volumeId: string;
}> = ({ snapshot, actions, volumeId }) => (
  <details className="cad-shell-tree-group" data-cad-volume-analyses={volumeId}>
    <summary>Analyses</summary>
    <div className="cad-shell-tree-children">
      <AnalysisRows
        snapshot={snapshot}
        actions={actions}
        sourceId={volumeId}
        emptyText="No depth maps — Surface → VOLUME → Depth."
      />
    </div>
  </details>
);
