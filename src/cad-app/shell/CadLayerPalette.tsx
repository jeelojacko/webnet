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
 * no current-layer/active-layer concept in the engine (gap note below,
 * 18C candidate). Visibility toggles hide entities in the viewport.
 */
export const CadLayerPalette: React.FC<CadLayerPaletteProps> = ({ snapshot, actions }) => {
  if (!snapshot) return <p className="cad-shell-empty">No drawing loaded.</p>;
  return (
    <div className="cad-shell-layers" data-cad-layers>
      <LayerPanel
        layers={snapshot.layers}
        entityCounts={snapshot.layerEntityCounts}
        visibilityRequestOnly
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
        No active layer yet — new entities use their default layer. Hiding a layer does not hide its
        entities in the viewport yet — 18C. Populated layers cannot be deleted; move objects off
        first. A current-layer model arrives with the engine change (18C).
      </p>
    </div>
  );
};
