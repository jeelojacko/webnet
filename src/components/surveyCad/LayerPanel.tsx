import React, { useState } from 'react';
import type { CadLayer } from '../../engine/cad/cadTypes';

export interface LayerPanelProps {
  layers: CadLayer[];
  /** Entity count per layer id; drives the populated-layer delete guard. */
  entityCounts?: Record<string, number>;
  onCreate?: (_name: string) => void;
  onRename?: (_layerId: string, _name: string) => void;
  onToggleVisibility?: (_layerId: string, _visible: boolean) => void;
  onToggleLocked?: (_layerId: string, _locked: boolean) => void;
  onTogglePrintable?: (_layerId: string, _printable: boolean) => void;
  onDelete?: (_layerId: string) => void;
  /** Request-hide wording: the flag reaches export, not the viewport (18C). */
  visibilityRequestOnly?: boolean;
}

export const LayerPanel = ({
  layers,
  entityCounts = {},
  onCreate,
  onRename,
  onToggleVisibility,
  onToggleLocked,
  onTogglePrintable,
  onDelete,
  visibilityRequestOnly = false,
}: LayerPanelProps): React.JSX.Element => {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const create = (): void => {
    const name = newName.trim();
    if (!name) return;
    onCreate?.(name);
    setNewName('');
  };

  const commitRename = (layerId: string): void => {
    const name = editName.trim();
    if (name) onRename?.(layerId, name);
    setEditingId(null);
  };

  const requestDelete = (layerId: string): void => {
    if (confirmDeleteId === layerId) {
      onDelete?.(layerId);
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(layerId);
    }
  };

  return (
    <section aria-label="Layer panel">
      <h2>Layers</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          create();
        }}
      >
        <label>
          New layer name
          <input
            aria-label="New layer name"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
          />
        </label>
        <button type="submit" aria-label="Create layer">Add layer</button>
      </form>
      <ul>
        {layers.map((layer) => {
          const count = entityCounts[layer.id] ?? 0;
          const armed = confirmDeleteId === layer.id;
          return (
            <li key={layer.id}>
              {editingId === layer.id ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    commitRename(layer.id);
                  }}
                >
                  <label>
                    Rename layer {layer.name}
                    <input
                      aria-label={`Rename layer ${layer.name}`}
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                      onBlur={() => commitRename(layer.id)}
                      autoFocus
                    />
                  </label>
                </form>
              ) : (
                <span>{layer.name}</span>
              )}
              <span aria-label={`${count} objects on ${layer.name}`}>{` (${count})`}</span>
              <button
                type="button"
                aria-label={
                  layer.visible
                    ? visibilityRequestOnly
                      ? `Request hiding layer ${layer.name} (export only; viewport unchanged)`
                      : `Hide layer ${layer.name}`
                    : `Show layer ${layer.name}`
                }
                aria-pressed={layer.visible}
                onClick={() => onToggleVisibility?.(layer.id, !layer.visible)}
              >
                {layer.visible ? (visibilityRequestOnly ? 'Request hide' : 'Hide') : 'Show'}
              </button>
              <button
                type="button"
                aria-label={layer.locked ? `Unlock layer ${layer.name}` : `Lock layer ${layer.name}`}
                aria-pressed={layer.locked}
                onClick={() => onToggleLocked?.(layer.id, !layer.locked)}
              >
                {layer.locked ? 'Unlock' : 'Lock'}
              </button>
              <button
                type="button"
                aria-label={layer.printable === false ? `Mark layer ${layer.name} printable` : `Mark layer ${layer.name} non-printable`}
                aria-pressed={layer.printable !== false}
                onClick={() => onTogglePrintable?.(layer.id, layer.printable === false)}
              >
                {layer.printable === false ? 'Non-printing' : 'Printing'}
              </button>
              <button
                type="button"
                aria-label={`Rename layer ${layer.name}`}
                onClick={() => {
                  setEditingId(layer.id);
                  setEditName(layer.name);
                }}
              >
                Rename
              </button>
              <button
                type="button"
                aria-label={
                  armed
                    ? `Confirm delete layer ${layer.name}${count > 0 ? ` with ${count} objects` : ''}`
                    : `Delete layer ${layer.name}`
                }
                onClick={() => requestDelete(layer.id)}
              >
                {armed ? (count > 0 ? `Confirm delete (${count} objects)` : 'Confirm delete') : 'Delete'}
              </button>
              {armed && (
                <button type="button" aria-label={`Cancel delete layer ${layer.name}`} onClick={() => setConfirmDeleteId(null)}>
                  Cancel
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};
