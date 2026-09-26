import React from 'react';
import type { CadSnapKind } from '../../engine/cad/cadTypes';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import type { CadToolspaceTab } from './cadShellTypes';
import { VolumesNode } from './CadVolumeToolspace';
import { SurfaceAnalysesNode } from './CadAnalysisToolspace';
import { SurfaceProfilesNode, ProfileViewsNode } from './CadProfileToolspace';
import { SampleLineGroupsNode, SectionViewsNode, SectionStylesNode } from './CadSampleLineToolspace';
import { CadAnnotationToolspaceNodes } from '../annotation/CadAnnotationToolspace';
import { type CadSurfaceRow } from './cadSurfaceSnapshot';
import { cadSurfaceEditStatusText } from './cadSurfaceEditSummaries';

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
    {tab === 'survey' ? <SurveyTab snapshot={snapshot} actions={actions} /> : null}
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

type SurveyMenuTarget =
  | { kind: 'points' }
  | { kind: 'group'; id: string; name: string };

/**
 * Phase 18D — Survey tab: real Points node (count + basic table) and the
 * Point Groups tree with live membership counts. Right-click drives group
 * management through the existing SURVEY_* undo path. No Zoom to Points:
 * the workspace has no fit-extents helper, so the item is omitted.
 */
const SurveyTab: React.FC<{ snapshot: CadWorkspaceSnapshot | null; actions: CadShellActions | null }> = ({
  snapshot,
  actions,
}) => {
  const [menu, setMenu] = React.useState<{ x: number; y: number; target: SurveyMenuTarget } | null>(null);
  React.useEffect(() => {
    if (!menu) return;
    const close = (): void => setMenu(null);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);
  if (!snapshot) return <p className="cad-shell-empty">No drawing loaded.</p>;
  const survey = snapshot.survey;
  const closeMenu = (): void => setMenu(null);
  const runGroup = (groupId: string, direction: 'up' | 'down'): void => {
    actions?.runSurveyCommand({ key: 'SURVEY_GROUP_TABLE', op: 'move', groupId, direction });
    closeMenu();
  };
  const deleteGroup = (groupId: string): void => {
    actions?.runSurveyCommand({ key: 'SURVEY_GROUP_TABLE', op: 'delete', groupId });
    closeMenu();
  };
  return (
    <div className="cad-shell-tree">
      {snapshot.stationCount > 0 ? (
        <TreeGroup label={`Adjusted stations (${snapshot.stationCount})`}>
          <div className="cad-shell-tree-row">{snapshot.stationCount} stations linked from the adjustment source.</div>
          <div className="cad-shell-tree-row cad-shell-empty">Dependency: {snapshot.dependencyStatus}.</div>
        </TreeGroup>
      ) : null}
      {!survey || survey.pointCount === 0 ? (
        <p className="cad-shell-empty">
          No survey points in the drawing. Use File → Sheets &amp; Layers → field-to-finish, or import adjusted
          points, to bring survey stations into the drawing.
        </p>
      ) : null}
      {survey && survey.pointCount > 0 ? (
        <>
          <TreeGroup label={`Points (${survey.pointCount})`}>
            <div
              className="cad-shell-tree-row"
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ x: event.clientX, y: event.clientY, target: { kind: 'points' } });
              }}
            >
              {survey.pointCount} survey points (right-click: Select All).
            </div>
            <details className="cad-shell-tree-group">
              <summary>Point table{survey.tableTruncated ? ` (first ${survey.table.length})` : ''}</summary>
              <SurveyPointTable snapshot={snapshot} actions={actions} />
            </details>
          </TreeGroup>
          <TreeGroup label={`Point Groups (${survey.groups.length})`}>
            {[...survey.groups]
              .sort((a, b) => a.priority - b.priority)
              .map((group) => (
                <div
                  key={group.id}
                  className="cad-shell-tree-row"
                  title={`${group.name} — ${group.memberCount} matching points`}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenu({ x: event.clientX, y: event.clientY, target: { kind: 'group', id: group.id, name: group.name } });
                  }}
                >
                  {group.name}
                  <span className="cad-shell-count">{group.memberCount}</span>
                </div>
              ))}
            <button
              type="button"
              className="cad-shell-tree-node"
              onClick={() => actions?.openSurveyManager('point-groups')}
            >
              + New Point Group
            </button>
          </TreeGroup>
        </>
      ) : null}
      <SurfacesNode snapshot={snapshot} actions={actions} />
      <VolumesNode snapshot={snapshot} actions={actions} />
      {snapshot ? <SurfaceProfilesNode snapshot={snapshot} actions={actions} /> : null}
      {snapshot ? <ProfileViewsNode snapshot={snapshot} actions={actions} /> : null}
      {snapshot ? <SampleLineGroupsNode snapshot={snapshot} actions={actions} /> : null}
      {snapshot ? <SectionViewsNode snapshot={snapshot} actions={actions} /> : null}
      <F2FNode snapshot={snapshot} actions={actions} />
      {menu ? (
        <div role="menu" className="cad-shell-menu" style={{ left: menu.x, top: menu.y, position: 'fixed' }} data-cad-survey-menu>
          {menu.target.kind === 'points' ? (
            <button
              type="button"
              role="menuitem"
              className="cad-shell-menu-item"
              onClick={() => {
                actions?.selectAllSurveyPoints();
                closeMenu();
              }}
            >
              <span>Select All</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                className="cad-shell-menu-item"
                onClick={() => {
                  actions?.openSurveyManager('point-groups', menu.target.kind === 'group' ? menu.target.id : undefined);
                  closeMenu();
                }}
              >
                <span>Properties</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="cad-shell-menu-item"
                onClick={() => {
                  if (menu.target.kind === 'group') actions?.selectSurveyGroupPoints(menu.target.id);
                  closeMenu();
                }}
              >
                <span>Select Points</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="cad-shell-menu-item"
                onClick={() => menu.target.kind === 'group' && runGroup(menu.target.id, 'up')}
              >
                <span>Move Up</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="cad-shell-menu-item"
                onClick={() => menu.target.kind === 'group' && runGroup(menu.target.id, 'down')}
              >
                <span>Move Down</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="cad-shell-menu-item"
                onClick={() => {
                  actions?.openSurveyManager('point-groups', menu.target.kind === 'group' ? menu.target.id : undefined);
                  closeMenu();
                }}
              >
                <span>Rename</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="cad-shell-menu-item"
                onClick={() => menu.target.kind === 'group' && deleteGroup(menu.target.id)}
              >
                <span>Delete</span>
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
};

/** Basic point table: row click selects the viewport point; no editing, no virtualization. */
const SurveyPointTable: React.FC<{ snapshot: CadWorkspaceSnapshot; actions: CadShellActions | null }> = ({
  snapshot,
  actions,
}) => {
  const survey = snapshot.survey;
  if (!survey) return null;
  const selectedIds = new Set(snapshot.selectedEntityIds);
  const layerNames = new Map(snapshot.layers.map((layer) => [layer.id, layer.name]));
  return (
    <div className="cad-shell-table-wrap">
      <table className="cad-shell-table" data-cad-point-table>
        <thead>
          <tr>
            <th>Point</th>
            <th>Easting</th>
            <th>Northing</th>
            <th>Elevation</th>
            <th>Description</th>
            <th>Feature Code</th>
            <th>Layer</th>
            <th>Point Style</th>
            <th>Label Style</th>
            <th>Point Groups</th>
          </tr>
        </thead>
        <tbody>
          {survey.table.map((row) => (
            <tr
              key={row.entityId}
              data-selected={selectedIds.has(row.entityId) ? 'true' : undefined}
              onClick={() => actions?.selectEntities([row.entityId])}
            >
              <td>{row.stationId}</td>
              <td>{row.x.toFixed(3)}</td>
              <td>{row.y.toFixed(3)}</td>
              <td>{row.z == null ? '--' : row.z.toFixed(3)}</td>
              <td>{row.description ?? ''}</td>
              <td>{row.featureCode ?? ''}</td>
              <td>{layerNames.get(row.layerId) ?? row.layerId}</td>
              <td>{row.effectivePointStyleName}</td>
              <td>{row.effectiveLabelStyleName}</td>
              <td>{row.matchingGroupNames.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {survey.tableTruncated ? (
        <div className="cad-shell-tree-row cad-shell-empty">
          Showing first {survey.table.length} of {survey.pointCount} points.
        </div>
      ) : null}
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
      <TreeGroup label={`Layers (${snapshot.layers.length})`}>
        {snapshot.layers.map((layer) => {
          const isCurrent = layer.id === snapshot.currentLayerId;
          const blocked = layer.visible === false || layer.frozen === true;
          return (
            <button
              key={layer.id}
              type="button"
              className="cad-shell-tree-node"
              title={
                isCurrent
                  ? `${layer.name} — current layer`
                  : blocked
                    ? `${layer.name} — cannot be current while ${layer.visible === false ? 'off' : 'frozen'}`
                    : `${layer.name} — set current`
              }
              disabled={isCurrent || blocked}
              onClick={() => actions?.setCurrentLayer(layer.id)}
            >
              <span
                className="cad-shell-layer-swatch"
                style={{ backgroundColor: layer.color }}
                aria-hidden="true"
              />
              {isCurrent ? `★ ${layer.name}` : layer.name}
              <span className="cad-shell-count">{snapshot.layerEntityCounts[layer.id] ?? 0}</span>
            </button>
          );
        })}
        {snapshot.layers.length === 0 ? <div className="cad-shell-tree-row cad-shell-empty">No layers.</div> : null}
      </TreeGroup>
      <TreeGroup label={`Linetypes (${snapshot.lineTypes.length})`}>
        {snapshot.lineTypes.map((lineType) => {
          const usedByLayers = snapshot.layers.filter((layer) => layer.lineTypeId === lineType.id).length;
          return (
            <div key={lineType.id} className="cad-shell-tree-row" title={`${lineType.name} — ${usedByLayers} layer${usedByLayers === 1 ? '' : 's'}`}>
              <svg width="48" height="8" aria-hidden="true">
                <line
                  x1="0"
                  y1="4"
                  x2="48"
                  y2="4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeDasharray={lineType.dashPattern.length > 0 ? lineType.dashPattern.join(' ') : undefined}
                />
              </svg>
              {lineType.name}
              <span className="cad-shell-count">{usedByLayers}</span>
            </div>
          );
        })}
        {snapshot.lineTypes.length === 0 ? <div className="cad-shell-tree-row cad-shell-empty">No linetypes.</div> : null}
      </TreeGroup>
      {snapshot.survey ? (
        <>
          <TreeGroup label={`Point Styles (${snapshot.survey.pointStyles.length})`}>
            {snapshot.survey.pointStyles.map((style) => (
              <button
                key={style.id}
                type="button"
                className="cad-shell-tree-node"
                title={`${style.name} — open the Point Style manager`}
                onClick={() => actions?.openSurveyManager('point-styles', style.id)}
              >
                {style.name}
              </button>
            ))}
          </TreeGroup>
          <TreeGroup label={`Point Label Styles (${snapshot.survey.labelStyles.length})`}>
            {snapshot.survey.labelStyles.map((style) => (
              <button
                key={style.id}
                type="button"
                className="cad-shell-tree-node"
                title={`${style.name} — open the Point Label Style manager`}
                onClick={() => actions?.openSurveyManager('point-label-styles', style.id)}
              >
                {style.name}
              </button>
            ))}
          </TreeGroup>
        </>
      ) : null}
      {snapshot ? <SectionStylesNode snapshot={snapshot} actions={actions} /> : null}
      <BlocksNode snapshot={snapshot} actions={actions} />
      <CadAnnotationToolspaceNodes snapshot={snapshot} actions={actions} />
      <TreeGroup label="Drawing">
        <div className="cad-shell-tree-row">Units: {snapshot.units}</div>
      </TreeGroup>
    </div>
  );
};

/**
 * Phase 18N — Blocks node (definitions only, never references).
 * Clicking a definition opens the Block Manager; the manager owns all
 * mutations. Empty state points at Survey Symbols (lazy-seed gate).
 */
const BlocksNode: React.FC<{ snapshot: CadWorkspaceSnapshot | null; actions: CadShellActions | null }> = ({
  snapshot,
  actions,
}) => {
  if (!snapshot) return null;
  const blocks = snapshot.blocks;
  const definitions = [...(blocks?.definitions ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <TreeGroup label={`Blocks (${definitions.length})`}>
      {definitions.map((definition) => (
        <button
          key={definition.id}
          type="button"
          className="cad-shell-tree-node"
          title={`${definition.name} — ${definition.entities.length} entities, ${blocks?.referenceCounts[definition.id] ?? 0} references. Open the Block Manager.`}
          onClick={() => actions?.openBlockManager?.('blocks')}
          data-cad-toolspace-block={definition.id}
        >
          {definition.name}
          <span className="cad-shell-count">{blocks?.referenceCounts[definition.id] ?? 0}</span>
        </button>
      ))}
      {definitions.length === 0 ? (
        <div className="cad-shell-tree-row cad-shell-empty">No blocks — open the Block Manager or Survey Symbols.</div>
      ) : null}
      <button
        type="button"
        className="cad-shell-tree-node"
        onClick={() => actions?.openBlockManager?.('symbols')}
        data-cad-toolspace-symbols="true"
      >
        Survey Symbols…
      </button>
    </TreeGroup>
  );
};

const TreeGroup: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <details className="cad-shell-tree-group" open>
    <summary>{label}</summary>
    <div className="cad-shell-tree-children">{children}</div>
  </details>
);


/**
 * Phase 18S — Definition child node (native counts or imported LandXML TIN)
 * with an Edits child listing the ordered stack: "1 Swap Edge P104 – P117".
 * Refs are readable labels (native station short labels, imported V<i>);
 * raw entity ids/UUIDs are never shown.
 */
const SurfaceDefinitionTree: React.FC<{ row: CadSurfaceRow }> = ({ row }) => {
  const def = row.definition;
  const source = def.sourceKind === 'imported-tin'
    ? (def.importedSourceText ?? 'Imported LandXML TIN')
    : def.pointSourceKind === 'point-group'
      ? `Point Groups (${def.pointGroupIds.length}): ${def.pointGroupNames.join(', ') || '—'}`
      : `${def.pointCount} points`;
  return (
    <details className="cad-shell-tree-group" open data-cad-surface-definition={row.id}>
      <summary>Definition</summary>
      <div className="cad-shell-tree-children">
        <div className="cad-shell-tree-row" title="Definition counts">
          {source}
          {' · '}breaklines {def.breaklineCount}
          {' · '}outer {def.outerBoundaryCount} void {def.voidBoundaryCount}
        </div>
        <details
          className="cad-shell-tree-group"
          data-cad-surface-breaklines-node={row.id}
        >
          <summary>Breaklines ({def.breaklineCount})</summary>
          <div className="cad-shell-tree-children">
            {def.breaklineCount === 0 ? (
              <div className="cad-shell-tree-row cad-shell-empty">No breaklines.</div>
            ) : (
              def.breaklines.map((entry) => (
                <div
                  key={entry.id}
                  className="cad-shell-tree-row"
                  data-cad-surface-breakline={entry.id}
                  title={entry.kind === 'point-chain' ? 'Point chain' : 'Entity-backed'}
                >
                  {entry.name}
                  <span className="cad-shell-count">{entry.kind === 'point-chain' ? 'chain' : 'entity'}</span>
                </div>
              ))
            )}
          </div>
        </details>
        <details
          className="cad-shell-tree-group"
          data-cad-surface-boundaries-node={row.id}
        >
          <summary>Boundaries (outer {def.outerBoundaryCount} void {def.voidBoundaryCount})</summary>
          <div className="cad-shell-tree-children">
            {def.boundaries.length === 0 ? (
              <div className="cad-shell-tree-row cad-shell-empty">No boundaries.</div>
            ) : (
              def.boundaries.map((entry, index) => (
                <div
                  key={`${entry.kind}:${entry.sourceEntityId}:${index}`}
                  className="cad-shell-tree-row"
                  data-cad-surface-boundary={entry.sourceEntityId}
                  title={entry.sourceEntityId}
                >
                  {entry.kind === 'outer' ? 'Outer' : 'Void'}: {entry.sourceLabel}
                </div>
              ))
            )}
          </div>
        </details>
        <details
          className="cad-shell-tree-group"
          open={row.editCount > 0}
          data-cad-surface-edits-node={row.id}
        >
          <summary>Edits ({row.editCount})</summary>
          <div className="cad-shell-tree-children">
            {row.editCount === 0 ? (
              <div className="cad-shell-tree-row cad-shell-empty">No TIN edits.</div>
            ) : (
              row.edits.map((edit, index) => (
                <div
                  key={edit.id}
                  className="cad-shell-tree-row"
                  data-cad-surface-edit={edit.id}
                  title={`${edit.description} — ${cadSurfaceEditStatusText(edit.status)}`}
                >
                  {index + 1} {edit.description}
                  <span className="cad-shell-count">{cadSurfaceEditStatusText(edit.status)}</span>
                </div>
              ))
            )}
          </div>
        </details>
      </div>
    </details>
  );
};

/**
 * Phase 18H — Contours child per surface: style intervals only.
 * Never a per-polyline listing (aggregated display model).
 */
const SurfaceContoursRow: React.FC<{
  snapshot: CadWorkspaceSnapshot;
  rowId: string;
  styleId: string | null;
}> = ({ snapshot, rowId, styleId }) => {
  const style = styleId != null
    ? snapshot.surface?.styles.find((entry) => entry.id === styleId) ?? null
    : null;
  const text = !style || !style.showContours
    ? 'Contours: off'
    : `Contours: minor ${style.minorContourInterval ?? '—'} major every ${style.majorContourEvery ?? '—'}`;
  return (
    <div
      className="cad-shell-tree-row"
      title="Contour display (style intervals; derivation status lives in the manager)"
      data-cad-surface-contours={rowId}
    >
      {text}
    </div>
  );
};

/**
 * Phase 18F — Surfaces tree: Surfaces > surface > Definition +
 * Statistics. Status renders as TEXT (never a color-only badge).
 * Clicking a surface selects it (Toolspace/manager/viewport converge);
 * right-click offers Rebuild / Manager / Delete through the undo path.
 */
const SurfacesNode: React.FC<{ snapshot: CadWorkspaceSnapshot | null; actions: CadShellActions | null }> = ({
  snapshot,
  actions,
}) => {
  const [menu, setMenu] = React.useState<{ x: number; y: number; surfaceId: string; surfaceName: string } | null>(null);
  React.useEffect(() => {
    if (!menu) return;
    const close = (): void => setMenu(null);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);
  const surface = snapshot?.surface;
  if (!snapshot || !surface) return null;
  const closeMenu = (): void => setMenu(null);
  return (
    <TreeGroup label={`Surfaces (${surface.surfaces.length})`}>
      {surface.surfaces.map((row) => {
        const selected = surface.selectedSurfaceId === row.id;
        return (
          <details
            key={row.id}
            className="cad-shell-tree-group"
            data-cad-surface={row.id}
            data-cad-surface-status={row.status}
            data-surface-build-path={row.buildPath}
          >
            <summary
              className="cad-shell-tree-node"
              data-selected={selected ? 'true' : undefined}
              title={`${row.name} — ${row.statusText}`}
              onClick={() => actions?.selectSurface(row.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ x: event.clientX, y: event.clientY, surfaceId: row.id, surfaceName: row.name });
              }}
            >
              {row.name}
              <span className="cad-shell-count">{row.statusText}</span>
            </summary>
            <div className="cad-shell-tree-children">
              <SurfaceDefinitionTree row={row} />
              <div className="cad-shell-tree-row" title="Build statistics">
                {row.stats
                  ? `Stats: ${row.stats.vertices}v ${row.stats.triangles}t Z ${row.stats.minZ?.toFixed(3) ?? '—'}…${row.stats.maxZ?.toFixed(3) ?? '—'}${row.stats.stale ? ' (stale)' : ''}`
                  : 'Statistics: no mesh — rebuild.'}
              </div>
              {row.brokenIds.length > 0 ? (
                <div className="cad-shell-tree-row" title={row.brokenNames.join(', ')}>
                  Broken: {row.brokenNames.join(', ')}
                </div>
              ) : null}
              <SurfaceContoursRow snapshot={snapshot} rowId={row.id} styleId={row.styleId} />
              <SurfaceAnalysesNode snapshot={snapshot} actions={actions} surfaceId={row.id} />
            </div>
          </details>
        );
      })}
      {surface.surfaces.length === 0 ? (
        <div className="cad-shell-tree-row cad-shell-empty">No surfaces — ribbon Surface → Create.</div>
      ) : null}
      <button
        type="button"
        className="cad-shell-tree-node"
        onClick={() => actions?.openSurveyManager('surfaces')}
      >
        + New Surface
      </button>
      {menu ? (
        <div role="menu" className="cad-shell-menu" style={{ left: menu.x, top: menu.y, position: 'fixed' }} data-cad-surface-menu>
          <button
            type="button"
            role="menuitem"
            className="cad-shell-menu-item"
            onClick={() => {
              actions?.selectSurface(menu.surfaceId);
              actions?.openSurveyManager('surfaces', menu.surfaceId);
              closeMenu();
            }}
          >
            <span>Properties</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="cad-shell-menu-item"
            onClick={() => {
              actions?.selectSurface(menu.surfaceId);
              actions?.rebuildSurface(menu.surfaceId);
              closeMenu();
            }}
          >
            <span>Rebuild</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="cad-shell-menu-item"
            onClick={() => {
              if (window.confirm(`Delete surface “${menu.surfaceName}”? Definition only; undoable.`)) {
                actions?.runSurveyCommand({ key: 'SURFACE_DELETE', surfaceId: menu.surfaceId });
              }
              closeMenu();
            }}
          >
            <span>Delete</span>
          </button>
        </div>
      ) : null}
    </TreeGroup>
  );
};

/**
 * Phase 18E — F2F node. Children focus manager sections in the drafting
 * panel (no duplicate state; snapshot is derived per publish).
 */
const F2FNode: React.FC<{ snapshot: CadWorkspaceSnapshot | null; actions: CadShellActions | null }> = ({
  snapshot,
  actions,
}) => {
  const f2f = snapshot?.f2f;
  if (!snapshot || !f2f) return null;
  const focus = (section: string): void => actions?.openSurveyManager('f2f', section);
  const rows: Array<{ section: string; label: string; detail: string }> = [
    { section: 'catalog', label: 'Active Catalog', detail: `${f2f.catalogName} v${f2f.catalogVersion} · rev ${f2f.catalogRevision}${f2f.catalogState === 'READY' ? '' : ' · MISSING LEGACY'}` },
    { section: 'codes', label: 'Feature Codes', detail: `${f2f.definitionCount} definitions` },
    { section: 'aliases', label: 'Aliases', detail: `${f2f.aliasCount} aliases` },
    { section: 'review', label: 'Import Review', detail: 'load + match + map' },
    { section: 'generated', label: 'Generated Features', detail: `${f2f.generatedPoints} pts · ${f2f.generatedLabels} lbl · ${f2f.generatedLinework} lw · ${f2f.overrides} ovr · ${f2f.detached} det` },
    { section: 'unmapped', label: 'Unmapped Codes', detail: `${f2f.unmapped} unmapped` },
    { section: 'link', label: 'Link Status', detail: f2f.linkStatus },
  ];
  return (
    <TreeGroup label="Field to Finish">
      {rows.map((row) => (
        <button
          key={row.section}
          type="button"
          className="cad-shell-tree-node"
          title={row.detail}
          onClick={() => focus(row.section)}
          data-cad-f2f-node={row.section}
        >
          {row.label}
          <span className="cad-shell-count">{row.detail}</span>
        </button>
      ))}
    </TreeGroup>
  );
};
