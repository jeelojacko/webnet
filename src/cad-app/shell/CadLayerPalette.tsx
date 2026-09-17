import React from 'react';
import { LayerPanel } from '../../components/surveyCad/LayerPanel';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';

interface CadLayerPaletteProps {
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
}

/**
 * Phase 18B — dockable layer manager. Columns are the honest supported
 * subset (name, color, visible, locked, printable, entity count). There is
 * no current-layer/active-layer concept in the engine: the ribbon/status
 * layer control is display-only and says so (gap note below, 18C candidate).
 */
export const CadLayerPalette: React.FC<CadLayerPaletteProps> = ({ snapshot, actions }) => {
  if (!snapshot) return <p className="cad-shell-empty">No drawing loaded.</p>;
  return (
    <div className="cad-shell-layers" data-cad-layers>
      <LayerPanel
        layers={snapshot.layers}
        entityCounts={snapshot.layerEntityCounts}
        onToggleVisibility={
          actions ? (layerId, visible) => actions.setLayerPatch(layerId, { visible }) : undefined
        }
        onToggleLocked={actions ? (layerId, locked) => actions.setLayerPatch(layerId, { locked }) : undefined}
        onTogglePrintable={
          actions ? (layerId, printable) => actions.setLayerPatch(layerId, { printable }) : undefined
        }
        onCreate={actions ? (name) => actions.createLayer(name) : undefined}
        onRename={actions ? (layerId, name) => actions.setLayerPatch(layerId, { name }) : undefined}
        onDelete={actions ? (layerId) => actions.deleteLayer(layerId) : undefined}
      />
      <p className="cad-shell-gap-note">
        No active layer yet — new entities use their default layer. Populated layers cannot be deleted;
        move objects off first. A current-layer model arrives with the engine change (18C).
      </p>
    </div>
  );
};
