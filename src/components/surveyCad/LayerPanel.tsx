import React, { useMemo, useState } from 'react';
import {
  nextDeterministicLayerName,
  validateLayerDelete,
  validateLayerRename,
  validateSetCurrent,
} from './LayerPanel.guards';
import type { LayerPanelProps } from './LayerPanel.types';
import { LayerManagerRow } from './LayerManagerRow';

/**
 * Phase 18C Layer Properties Manager: status/current, name, on, freeze,
 * lock, plot, color, linetype, lineweight, transparency, description +
 * entity count. Sort + name filter + inline edits + deterministic
 * Layer1/Layer2… naming. Delete is blocked for `general`, the current
 * layer, and layers with entities (count + message, no silent erase).
 * Every mutation routes through an undoable LAYER_* transaction.
 */
export const LayerPanel = ({
  layers,
  currentLayerId,
  lineTypes,
  entityCounts = {},
  onLayerCommand,
  onSetCurrent,
}: LayerPanelProps): React.JSX.Element => {
  const [filter, setFilter] = useState('');
  const [sortDesc, setSortDesc] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const visibleRows = useMemo(() => {
    const token = filter.trim().toLowerCase();
    const rows = token
      ? layers.filter((layer) => layer.name.toLowerCase().includes(token))
      : [...layers];
    rows.sort((a, b) => {
      const order = a.name.localeCompare(b.name);
      return sortDesc ? -order : order;
    });
    return rows;
  }, [layers, filter, sortDesc]);

  const create = (): void => {
    setMessage(null);
    setConfirmDeleteId(null);
    onLayerCommand({ key: 'LAYER_CREATE', name: nextDeterministicLayerName(layers) });
  };

  const requestSetCurrent = (layerId: string): void => {
    const blocked = validateSetCurrent(layers, layerId);
    if (blocked) {
      setMessage(blocked);
      return;
    }
    setMessage(null);
    onSetCurrent(layerId);
  };

  const commitRename = (layerId: string): void => {
    const blocked = validateLayerRename(layers, layerId, editName);
    if (blocked) {
      setMessage(blocked);
      setEditingId(null);
      return;
    }
    setMessage(null);
    setEditingId(null);
    onLayerCommand({ key: 'LAYER_RENAME', layerId, name: editName.trim() });
  };

  const requestDelete = (layerId: string): void => {
    if (confirmDeleteId === layerId) {
      setConfirmDeleteId(null);
      setMessage(null);
      onLayerCommand({ key: 'LAYER_DELETE', layerId });
      return;
    }
    const blocked = validateLayerDelete(layers, entityCounts, currentLayerId, layerId);
    if (blocked) {
      setMessage(blocked);
      setConfirmDeleteId(null);
      return;
    }
    setMessage(null);
    setConfirmDeleteId(layerId);
  };

  return (
    <section aria-label="Layer properties manager">
      <h2>Layers</h2>
      <div>
        <label>
          Filter layers
          <input
            aria-label="Filter layers"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Name contains…"
          />
        </label>
        <button
          type="button"
          aria-label={sortDesc ? 'Sort layers A to Z' : 'Sort layers Z to A'}
          onClick={() => setSortDesc((current) => !current)}
        >
          {sortDesc ? 'Sort A–Z' : 'Sort Z–A'}
        </button>
        <button type="button" aria-label="Create layer" onClick={create}>
          New layer
        </button>
      </div>
      {message ? <p role="status">{message}</p> : null}
      <table>
        <thead>
          <tr>
            <th scope="col">Status</th>
            <th scope="col">Current</th>
            <th scope="col">Name</th>
            <th scope="col">On</th>
            <th scope="col">Freeze</th>
            <th scope="col">Lock</th>
            <th scope="col">Plot</th>
            <th scope="col">Color</th>
            <th scope="col">Linetype</th>
            <th scope="col">Lineweight</th>
            <th scope="col">Transparency</th>
            <th scope="col">Description</th>
            <th scope="col">Objects</th>
            <th scope="col">Delete</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((layer) => (
            <LayerManagerRow
              key={layer.id}
              layer={layer}
              isCurrent={layer.id === currentLayerId}
              entityCount={entityCounts[layer.id] ?? 0}
              lineTypes={lineTypes}
              onLayerCommand={onLayerCommand}
              onSetCurrent={requestSetCurrent}
              onDeleteRequest={requestDelete}
              confirmArmed={confirmDeleteId === layer.id}
              onCancelDelete={() => {
                setConfirmDeleteId(null);
                setMessage(null);
              }}
              editing={editingId === layer.id}
              editName={editName}
              onEditNameChange={setEditName}
              onCommitRename={commitRename}
              onStartRename={(id) => {
                setMessage(null);
                setEditingId(id);
                setEditName(layers.find((entry) => entry.id === id)?.name ?? '');
              }}
            />
          ))}
        </tbody>
      </table>
    </section>
  );
};
