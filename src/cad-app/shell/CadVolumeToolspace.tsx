import React from 'react';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';

/**
 * Phase 18I — volume rows under Surfaces in the Toolspace Survey tab.
 * Each volume carries a [VOLUME] tag plus Definition (Base/Comparison)
 * and Statistics children; status renders as TEXT (never color-only).
 * Clicking a volume selects it (Toolspace/manager converge).
 */
export const VolumesNode: React.FC<{
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions | null;
}> = ({ snapshot, actions }) => {
  const volume = snapshot.volume;
  if (!volume) return null;
  return (
    <details className="cad-shell-tree-group" open data-cad-volumes>
      <summary>{`Volume Surfaces (${volume.volumes.length})`}</summary>
      <div className="cad-shell-tree-children">
        {volume.volumes.map((row) => {
          const selected = volume.selectedVolumeId === row.id;
          return (
            <details
              key={row.id}
              className="cad-shell-tree-group"
              data-cad-volume={row.id}
              data-cad-volume-status={row.status}
            >
              <summary
                className="cad-shell-tree-node"
                data-selected={selected ? 'true' : undefined}
                title={`${row.name} — ${row.statusText}`}
                onClick={() => actions?.selectVolume(row.id)}
              >
                {row.name} [VOLUME]
                <span className="cad-shell-count">{row.statusText}{row.stale ? ' (stale)' : ''}</span>
              </summary>
              <div className="cad-shell-tree-children">
                <div className="cad-shell-tree-row" title="Definition sources">
                  Definition: Base {row.baseName} · Comparison {row.comparisonName}
                </div>
                <div className="cad-shell-tree-row" title="Volume statistics">
                  {row.quantities
                    ? `Stats: cut ${row.quantities.cutVolume.toFixed(1)} fill ${row.quantities.fillVolume.toFixed(1)} net ${row.quantities.netVolume.toFixed(1)}`
                    : row.staleQuantities
                      ? `Stats (STALE): cut ${row.staleQuantities.cutVolume.toFixed(1)} fill ${row.staleQuantities.fillVolume.toFixed(1)} net ${row.staleQuantities.netVolume.toFixed(1)}`
                      : 'Statistics: no quantities — calculate.'}
                </div>
              </div>
            </details>
          );
        })}
        {volume.volumes.length === 0 ? (
          <div className="cad-shell-tree-row cad-shell-empty">No volume surfaces — Surface tab → Create Volume.</div>
        ) : null}
      </div>
    </details>
  );
};
