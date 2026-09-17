import React, { useEffect, useState } from 'react';
import type { CadEntityPropertyRow, CadPropertiesTypeGroup } from '../../engine/cad/cadPropertiesModel';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';

interface CadPropertiesPaletteProps {
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
}

const rowKey = (row: CadEntityPropertyRow): string => row.key;

/**
 * Phase 18B — dockable Properties palette.
 * - No selection: drawing summary (name, units, entities, layers, dependency).
 * - Single: full row set with inline edit via the existing transaction/undo.
 * - Multi: one tab per entity type; rows common to every entity in the group,
 *   differing values shown as *VARIES*; edits commit per entity through the
 *   same single-undo path as the existing panel.
 */
export const CadPropertiesPalette: React.FC<CadPropertiesPaletteProps> = ({ snapshot, actions }) => {
  if (!snapshot) return <p className="cad-shell-empty">No drawing loaded.</p>;
  if (!snapshot.properties || snapshot.selectionCount === 0) {
    return (
      <div className="cad-shell-props" data-cad-properties="none">
        <h3>No selection</h3>
        <dl>
          <div><dt>Drawing</dt><dd>{snapshot.drawingName}</dd></div>
          <div><dt>Units</dt><dd>{snapshot.units}</dd></div>
          <div><dt>Entities</dt><dd>{snapshot.entityCount}</dd></div>
          <div><dt>Layers</dt><dd>{snapshot.layers.length}</dd></div>
          <div><dt>Status</dt><dd>{snapshot.dependencyStatus}</dd></div>
        </dl>
      </div>
    );
  }
  const panel = snapshot.properties;
  if (panel.mode === 'single') {
    return (
      <div className="cad-shell-props" data-cad-properties="single">
        <h3>{panel.entity.entityLabel}</h3>
        <PropertyRows
          rows={panel.entity.properties}
          entityId={panel.entity.entityId}
          actions={actions}
        />
      </div>
    );
  }
  return <MultiProperties groups={panel.groups} defaultTypeKey={panel.defaultTypeKey} actions={actions} />;
};

const MultiProperties: React.FC<{
  groups: CadPropertiesTypeGroup[];
  defaultTypeKey: string;
  actions: CadShellActions | null;
}> = ({ groups, defaultTypeKey, actions }) => {
  const [typeKey, setTypeKey] = useState(defaultTypeKey);
  useEffect(() => setTypeKey(defaultTypeKey), [defaultTypeKey, groups.length]);
  const group = groups.find((entry) => entry.typeKey === typeKey) ?? groups[0];
  if (!group) return <p className="cad-shell-empty">Nothing to show.</p>;
  // Common-only rows: keep keys present on every entity in the group.
  const keyCounts = new Map<string, number>();
  for (const entity of group.entities) {
    for (const row of entity.properties) keyCounts.set(rowKey(row), (keyCounts.get(rowKey(row)) ?? 0) + 1);
  }
  const commonKeys = new Set(
    [...keyCounts.entries()].filter(([, count]) => count === group.entities.length).map(([key]) => key),
  );
  const first = new Map(group.entities[0]?.properties.map((row) => [rowKey(row), row]) ?? []);
  const commonRows = [...commonKeys].map((key) => {
    const base = first.get(key);
    const values = new Set(
      group.entities.map((entity) => entity.properties.find((row) => rowKey(row) === key)?.value),
    );
    return { base: base!, varies: values.size > 1 };
  });
  return (
    <div className="cad-shell-props" data-cad-properties="multi">
      <div role="tablist" aria-label="Selection groups" className="cad-shell-tabs">
        <button type="button" role="tab" aria-selected={false} className="cad-shell-tab" disabled title="Edit scope is per type below">
          All ({groups.reduce((n, entry) => n + entry.entities.length, 0)})
        </button>
        {groups.map((entry) => (
          <button
            key={entry.typeKey}
            type="button"
            role="tab"
            aria-selected={entry.typeKey === group.typeKey}
            className={`cad-shell-tab${entry.typeKey === group.typeKey ? ' active' : ''}`}
            onClick={() => setTypeKey(entry.typeKey)}
          >
            {entry.typeLabel} ({entry.entities.length})
          </button>
        ))}
      </div>
      <h3>{group.typeLabel} — {group.entities.length} selected</h3>
      {commonRows.map(({ base, varies }) => (
        <MultiPropertyRow
          key={base.key}
          row={base}
          varies={varies}
          entityIds={group.entities.map((entity) => entity.entityId)}
          actions={actions}
        />
      ))}
      {commonRows.length === 0 ? (
        <p className="cad-shell-empty">No common properties across these types.</p>
      ) : null}
    </div>
  );
};

const PropertyRows: React.FC<{
  rows: CadEntityPropertyRow[];
  entityId: string;
  actions: CadShellActions | null;
}> = ({ rows, entityId, actions }) => (
  <dl>
    {rows.map((row) => (
      <PropertyRow key={row.key} row={row} entityIds={[entityId]} varies={false} actions={actions} />
    ))}
  </dl>
);

const MultiPropertyRow: React.FC<{
  row: CadEntityPropertyRow;
  varies: boolean;
  entityIds: string[];
  actions: CadShellActions | null;
}> = ({ row, varies, entityIds, actions }) => (
  <PropertyRow row={row} entityIds={entityIds} varies={varies} actions={actions} />
);

const PropertyRow: React.FC<{
  row: CadEntityPropertyRow;
  entityIds: string[];
  varies: boolean;
  actions: CadShellActions | null;
}> = ({ row, entityIds, varies, actions }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const entityScope = entityIds.join(',');
  useEffect(() => {
    setDraft(null);
    setError(null);
  }, [row.value, entityScope]);
  const commit = (): void => {
    if (draft == null || !row.editableField || !actions) return;
    let ok = true;
    let reason: string | null = null;
    for (const entityId of entityIds) {
      const outcome = actions.editField(entityId, row.editableField, draft);
      ok = outcome.applied && ok;
      if (!outcome.applied && reason == null) reason = outcome.reason ?? 'INVALID_VALUE';
    }
    if (ok) {
      setDraft(null);
      setError(null);
    } else {
      setError(
        reason === 'LAYER_LOCKED'
          ? 'Rejected: source layer is locked (LAYER_LOCKED).'
          : 'Rejected: invalid value.',
      );
    }
  };
  if (!row.editableField || !actions) {
    return (
      <div>
        <dt>{row.label}</dt>
        <dd>{varies ? '*VARIES*' : row.value}</dd>
      </div>
    );
  }
  return (
    <div>
      <dt>{row.label}</dt>
      <dd>
        <input
          aria-label={row.label}
          value={draft ?? (varies ? '' : row.value)}
          placeholder={varies && draft == null ? '*VARIES*' : undefined}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') setDraft(null);
          }}
          onBlur={() => {
            if (draft != null) commit();
          }}
        />
        {error ? <span role="status">{error}</span> : null}
      </dd>
    </div>
  );
};
