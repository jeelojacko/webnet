import React from 'react';
import type { CadSnapKind } from '../../engine/cad/cadTypes';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import type { CadToolspaceTab } from './cadShellTypes';

interface CadToolspaceProps {
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
  tab: CadToolspaceTab;
  onTabChange: (_tab: CadToolspaceTab) => void;
}

const TABS: Array<{ id: CadToolspaceTab; label: string }> = [
  { id: 'prospector', label: 'Prospector' },
  { id: 'survey', label: 'Survey' },
  { id: 'settings', label: 'Settings' },
];

const SNAP_LABELS: CadSnapKind[] = [
  'point-node',
  'endpoint',
  'midpoint',
  'center',
  'arc-midpoint',
  'quadrant',
  'intersection',
  'apparent-intersection',
  'extension',
  'perpendicular',
  'parallel',
  'direction',
  'tangent',
  'nearest',
];

/**
 * Phase 18B — Toolspace browser (WebNet-specific; OpenCADStudio has none).
 * Prospector is backed by real drawing data only — entities grouped by type,
 * layers, and sheets. Clicking a node selects it in the viewport where cheap
 * (entity ids, layer members); no forced tree auto-scroll from the viewport.
 */
export const CadToolspace: React.FC<CadToolspaceProps> = ({ snapshot, actions, tab, onTabChange }) => (
  <div className="cad-shell-toolspace" data-cad-toolspace>
    <div role="tablist" aria-label="Toolspace tabs" className="cad-shell-tabs">
      {TABS.map((entry) => (
        <button
          key={entry.id}
          type="button"
          role="tab"
          aria-selected={tab === entry.id}
          className={`cad-shell-tab${tab === entry.id ? ' active' : ''}`}
          onClick={() => onTabChange(entry.id)}
        >
          {entry.label}
        </button>
      ))}
    </div>
    {tab === 'prospector' ? <ProspectorTab snapshot={snapshot} actions={actions} /> : null}
    {tab === 'survey' ? <SurveyTab snapshot={snapshot} /> : null}
    {tab === 'settings' ? <SettingsTab snapshot={snapshot} actions={actions} /> : null}
  </div>
);

const ProspectorTab: React.FC<{ snapshot: CadWorkspaceSnapshot | null; actions: CadShellActions | null }> = ({
  snapshot,
  actions,
}) => {
  if (!snapshot) return <p className="cad-shell-empty">No drawing loaded.</p>;
  return (
    <div className="cad-shell-tree">
      <TreeGroup label={`Drawing — ${snapshot.entityCount} entities`}>
        <div className="cad-shell-tree-row" title="Entities currently selected in the viewport">
          Selected ({snapshot.selectionCount})
        </div>
        {snapshot.selectionPreview.slice(0, 50).map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="cad-shell-tree-node"
            title={`${entry.type} — ${entry.label}`}
            onClick={() => actions?.selectEntities([entry.id])}
          >
            {entry.label}
          </button>
        ))}
        {snapshot.selectionCount > 50 ? (
          <div className="cad-shell-tree-row">…{snapshot.selectionCount - 50} more selected</div>
        ) : null}
        {snapshot.selectionCount === 0 ? (
          <div className="cad-shell-tree-row cad-shell-empty">Nothing selected — pick entities in the viewport.</div>
        ) : null}
      </TreeGroup>
      <TreeGroup label={`Layers (${snapshot.layers.length})`}>
        {snapshot.layers.map((layer) => (
          <div key={layer.id} className="cad-shell-tree-row" title={`${layer.name} — ${layer.visible ? 'visible' : 'hidden'}`}>
            <span
              className="cad-shell-layer-swatch"
              style={{ backgroundColor: layer.color }}
              aria-hidden="true"
            />
            {layer.name}
            <span className="cad-shell-count">{snapshot.layerEntityCounts[layer.id] ?? 0}</span>
          </div>
        ))}
        {snapshot.layers.length === 0 ? <div className="cad-shell-tree-row cad-shell-empty">No layers.</div> : null}
      </TreeGroup>
      <TreeGroup label={`Sheets (${snapshot.sheets.length})`}>
        {snapshot.sheets.map((sheet) => (
          <div key={sheet.id} className="cad-shell-tree-row" title={sheet.name}>
            {sheet.name}
          </div>
        ))}
        {snapshot.sheets.length === 0 ? (
          <div className="cad-shell-tree-row cad-shell-empty">No sheets — model only.</div>
        ) : null}
      </TreeGroup>
    </div>
  );
};

const SurveyTab: React.FC<{ snapshot: CadWorkspaceSnapshot | null }> = ({ snapshot }) => {
  if (!snapshot) return <p className="cad-shell-empty">No drawing loaded.</p>;
  if (snapshot.stationCount === 0) {
    return (
      <p className="cad-shell-empty">
        No adjustment source imported. Use File → Sheets &amp; Layers → field-to-finish, or import adjusted points,
        to bring survey stations into the drawing.
      </p>
    );
  }
  return (
    <div className="cad-shell-tree">
      <TreeGroup label={`Adjusted stations (${snapshot.stationCount})`}>
        <div className="cad-shell-tree-row">{snapshot.stationCount} stations linked from the adjustment source.</div>
        <div className="cad-shell-tree-row cad-shell-empty">Dependency: {snapshot.dependencyStatus}.</div>
      </TreeGroup>
    </div>
  );
};

const SettingsTab: React.FC<{ snapshot: CadWorkspaceSnapshot | null; actions: CadShellActions | null }> = ({
  snapshot,
  actions,
}) => {
  if (!snapshot) return <p className="cad-shell-empty">No drawing loaded.</p>;
  return (
    <div className="cad-shell-tree">
      <TreeGroup label="Object snap modes">
        {SNAP_LABELS.map((kind) => (
          <label key={kind} className="cad-shell-check-row" title={`Toggle ${kind} snap`}>
            <input
              type="checkbox"
              checked={snapshot.snapPreferences[kind] ?? false}
              onChange={(event) => actions?.setSnapPreference(kind, event.target.checked)}
            />
            {kind}
          </label>
        ))}
      </TreeGroup>
      <TreeGroup label="Drawing">
        <div className="cad-shell-tree-row">Units: {snapshot.units}</div>
      </TreeGroup>
    </div>
  );
};

const TreeGroup: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <details className="cad-shell-tree-group" open>
    <summary>{label}</summary>
    <div className="cad-shell-tree-children">{children}</div>
  </details>
);

