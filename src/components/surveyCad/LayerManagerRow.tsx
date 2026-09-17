import React from 'react';
import { formatLineweightOption, SUPPORTED_CAD_LINEWEIGHTS } from './LayerPanel.constants';
import type { LayerManagerRowProps } from './LayerPanel.types';

const isHexColor = (color: string): boolean => /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color);

/**
 * Phase 18C Layer Manager row: inline cells dispatch undoable LAYER_*
 * transactions directly. Guards (delete/rename/set-current) run in the
 * manager before dispatching; this row only collects input.
 */
export const LayerManagerRow: React.FC<LayerManagerRowProps> = ({
  layer,
  isCurrent,
  entityCount,
  lineTypes,
  onLayerCommand,
  onSetCurrent,
  onDeleteRequest,
  confirmArmed,
  onCancelDelete,
  editing,
  editName,
  onEditNameChange,
  onCommitRename,
  onStartRename,
}) => {
  const status = [
    isCurrent ? 'current' : null,
    layer.visible === false ? 'off' : null,
    layer.frozen === true ? 'frozen' : null,
    layer.locked ? 'locked' : null,
  ]
    .filter((entry): entry is string => entry != null)
    .join(' ');
  const commitDescriptionValue = (next: string): void => {
    if (next !== (layer.description ?? '')) onLayerCommand({ key: 'LAYER_DESCRIPTION', layerId: layer.id, description: next });
  };
  const commitTransparencyValue = (rawValue: string): void => {
    const raw = Number.parseFloat(rawValue);
    if (!Number.isFinite(raw)) return;
    const transparency = Math.min(100, Math.max(0, raw)) / 100;
    if (transparency !== (layer.transparency ?? 0)) {
      onLayerCommand({ key: 'LAYER_TRANSPARENCY', layerId: layer.id, transparency });
    }
  };
  const commitValueOnEnter = (event: React.KeyboardEvent<HTMLInputElement>, commit: (_value: string) => void): void => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    commit(event.currentTarget.value);
  };
  return (
    <tr>
      <td title={status || 'on'}>{isCurrent ? '★' : status ? '◌' : '●'}</td>
      <td>
        <input
          type="radio"
          aria-label={`Set current layer ${layer.name}`}
          checked={isCurrent}
          onChange={() => onSetCurrent(layer.id)}
        />
      </td>
      <td>
        {editing ? (
          <input
            aria-label={`Rename layer ${layer.name}`}
            value={editName}
            autoFocus
            onChange={(event) => onEditNameChange(event.target.value)}
            onBlur={() => onCommitRename(layer.id)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onCommitRename(layer.id);
              else commitValueOnEnter(event, () => onCommitRename(layer.id));
            }}
          />
        ) : (
          <>
            <span>{layer.name}</span>{' '}
            <button type="button" aria-label={`Rename layer ${layer.name}`} onClick={() => onStartRename(layer.id)}>
              Rename
            </button>
          </>
        )}
      </td>
      <td>
        <input
          type="checkbox"
          aria-label={`Toggle on/off for layer ${layer.name}`}
          checked={layer.visible !== false}
          onChange={(event) => onLayerCommand({ key: 'LAYER_VISIBILITY', layerId: layer.id, visible: event.target.checked })}
        />
      </td>
      <td>
        <input
          type="checkbox"
          aria-label={`Toggle freeze for layer ${layer.name}`}
          checked={layer.frozen === true}
          onChange={(event) => onLayerCommand({ key: 'LAYER_FROZEN', layerId: layer.id, frozen: event.target.checked })}
        />
      </td>
      <td>
        <input
          type="checkbox"
          aria-label={layer.locked ? `Unlock layer ${layer.name}` : `Lock layer ${layer.name}`}
          checked={layer.locked}
          onChange={(event) => onLayerCommand({ key: 'LAYER_LOCKED', layerId: layer.id, locked: event.target.checked })}
        />
      </td>
      <td>
        <input
          type="checkbox"
          aria-label={`Toggle plot for layer ${layer.name}`}
          checked={layer.printable !== false}
          onChange={(event) => onLayerCommand({ key: 'LAYER_PRINTABLE', layerId: layer.id, printable: event.target.checked })}
        />
      </td>
      <td>
        <input
          type="color"
          aria-label={`Color for layer ${layer.name}`}
          title={layer.color}
          value={isHexColor(layer.color) ? layer.color : '#ffffff'}
          onChange={(event) => onLayerCommand({ key: 'LAYER_COLOR', layerId: layer.id, color: event.target.value })}
        />
      </td>
      <td>
        <select
          aria-label={`Linetype for layer ${layer.name}`}
          value={layer.lineTypeId ?? 'continuous'}
          onChange={(event) => onLayerCommand({ key: 'LAYER_LINETYPE', layerId: layer.id, lineTypeId: event.target.value })}
        >
          {lineTypes.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </td>
      <td>
        <select
          aria-label={`Lineweight for layer ${layer.name}`}
          value={layer.lineweightMm == null ? '' : String(layer.lineweightMm)}
          onChange={(event) => {
            const raw = event.target.value;
            onLayerCommand({
              key: 'LAYER_LINEWEIGHT',
              layerId: layer.id,
              ...(raw === '' ? {} : { lineweightMm: Number.parseFloat(raw) }),
            });
          }}
        >
          {SUPPORTED_CAD_LINEWEIGHTS.map((entry) => (
            <option key={entry == null ? 'default' : String(entry)} value={entry == null ? '' : String(entry)}>
              {formatLineweightOption(entry)}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          type="number"
          aria-label={`Transparency percent for layer ${layer.name}`}
          defaultValue={Math.round((layer.transparency ?? 0) * 100)}
          min={0}
          max={100}
          onBlur={(event) => commitTransparencyValue(event.currentTarget.value)}
          onKeyDown={(event) => commitValueOnEnter(event, commitTransparencyValue)}
        />
      </td>
      <td>
        <input
          type="text"
          aria-label={`Description for layer ${layer.name}`}
          defaultValue={layer.description ?? ''}
          placeholder="—"
          onBlur={(event) => commitDescriptionValue(event.currentTarget.value)}
          onKeyDown={(event) => commitValueOnEnter(event, commitDescriptionValue)}
        />
      </td>
      <td aria-label={`${entityCount} objects on ${layer.name}`}>{entityCount}</td>
      <td>
        {confirmArmed ? (
          <>
            <button type="button" aria-label={`Confirm delete layer ${layer.name}`} onClick={() => onDeleteRequest(layer.id)}>
              Confirm
            </button>{' '}
            <button type="button" aria-label={`Cancel delete layer ${layer.name}`} onClick={onCancelDelete}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" aria-label={`Delete layer ${layer.name}`} onClick={() => onDeleteRequest(layer.id)}>
            Delete
          </button>
        )}
      </td>
    </tr>
  );
};
