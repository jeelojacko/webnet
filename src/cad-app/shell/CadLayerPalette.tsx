import React from 'react';
import { LayerPanel } from '../../components/surveyCad/LayerPanel';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';

interface CadLayerPaletteProps {
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
}

/**
 * Phase 18C — dockable Layer Properties Manager. Full column set (status,
 * current, name, on, freeze, lock, plot, color, linetype, lineweight,
 * transparency, description, object count) backed by the project-owned
 * current-layer model; every mutation routes through an undoable LAYER_*
 * transaction. On/Freeze reach export now; viewport filtering rides the
 * scene-consumer filter path (renderer wave).
 */
export const CadLayerPalette: React.FC<CadLayerPaletteProps> = ({ snapshot, actions }) => {
  if (!snapshot) return <p className="cad-shell-empty">No drawing loaded.</p>;
  return (
    <div className="cad-shell-layers" data-cad-layers>
      <LayerPanel
        layers={snapshot.layers}
        currentLayerId={snapshot.currentLayerId}
        lineTypes={snapshot.lineTypes}
        entityCounts={snapshot.layerEntityCounts}
        onLayerCommand={actions ? (command) => void actions.runLayerCommand(command) : () => {}}
        onSetCurrent={actions ? (layerId) => void actions.setCurrentLayer(layerId) : () => {}}
      />
      <p className="cad-shell-gap-note">
        New entities take the current layer (★) with ByLayer appearance. Hiding
        (On) or freezing a layer hides its entities in the viewport and
        excludes them from plot output; locked layers stay selectable but
        reject edits. Populated layers, the General layer, and the current
        layer cannot be deleted — move objects off (or switch current) first.
      </p>
    </div>
  );
};
