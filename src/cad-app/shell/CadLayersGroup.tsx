import React from 'react';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';

interface CadLayersGroupProps {
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
}

/**
 * Phase 18C ribbon HOME Layers group: current-layer dropdown (color chip +
 * name), set-current on select, manager button. Mutations route through
 * the guarded shell actions (undoable LAYER_* transactions).
 */
export const CadLayersGroup: React.FC<CadLayersGroupProps> = ({ snapshot, actions }) => {
  if (!snapshot) return null;
  const current = snapshot.layers.find((layer) => layer.id === snapshot.currentLayerId);
  return (
    <div className="cad-shell-ribbon-group" aria-label="Layers">
      <span className="cad-shell-ribbon-group-label">Layers</span>
      <div className="cad-shell-ribbon-buttons">
        <label className="cad-shell-layer-current">
          <span
            className="cad-shell-layer-swatch"
            style={{ backgroundColor: current?.color ?? '#94a3b8' }}
            aria-hidden="true"
          />
          <select
            aria-label="Current layer"
            title={current ? `Current layer: ${current.name}` : 'Current layer'}
            value={snapshot.currentLayerId}
            disabled={!actions}
            onChange={(event) => actions?.setCurrentLayer(event.target.value)}
            data-cad-current-layer
          >
            {snapshot.layers.map((layer) => (
              <option key={layer.id} value={layer.id}>
                {layer.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          title="Open the Layer Properties Manager"
          aria-label="Open layer manager"
          disabled={!actions}
          className="cad-shell-ribbon-button"
          onClick={() => actions?.openLayerManager()}
          data-cad-command="LAYER"
        >
          Layers
        </button>
      </div>
    </div>
  );
};
