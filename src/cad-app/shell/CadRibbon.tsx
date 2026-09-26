import React, { useState } from 'react';
import {
  CAD_SHELL_COMMANDS,
  executeShellCommand,
  isShellCommandAvailable,
  type CadShellCommandDef,
} from './cadCommandRegistry';
import { CadLayersGroup } from './CadLayersGroup';
import { CadAnnotateRibbonGroups } from '../annotation/CadAnnotateRibbonGroups';
import type { CadShellActions, CadWorkspaceSnapshot, SurveyManagerKind } from './cadShellTypes';
import { surfaceBakeCapability, trySurfaceCommand } from './cadSurfaceSnapshot';
import { surfaceComposeCapability } from './cadSurfaceCompose';
import { confirmSurfaceBakeInPlace } from './cadSurfaceBakePrompt';

interface CadRibbonProps {
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

const RIBBON_TABS = ['Home', 'Annotate', 'Survey', 'Surface', 'Output'] as const;
type RibbonTab = (typeof RIBBON_TABS)[number];

const ribbonTooltip = (def: CadShellCommandDef): string => {
  const alias = def.aliases.length > 0 ? ` [${def.aliases.join(', ')}]` : '';
  return `${def.label}${alias} — ${def.hint}`;
};

/**
 * Phase 18B — compact ribbon. Home carries Draw/Modify/Parcel dispatch;
 * Output carries file deliverables (Save, Export Center, Sheets & Layers).
 * Same registry as menu + command dock; no duplicate command wiring.
 */
export const CadRibbon: React.FC<CadRibbonProps> = ({ snapshot, actions, collapsed, onToggleCollapsed }) => {
  const [tab, setTab] = useState<RibbonTab>('Home');
  const run = (def: CadShellCommandDef): void => {
    executeShellCommand(def, actions, snapshot);
  };
  if (collapsed) {
    return (
      <div className="cad-shell-ribbon-collapsed" data-cad-ribbon>
        <button type="button" className="cad-shell-ribbon-tab" onClick={onToggleCollapsed} title="Show ribbon">
          Ribbon
        </button>
      </div>
    );
  }
  const groups =
    tab === 'Home'
      ? (['Draw', 'Modify', 'Parcel', 'Edit'] as const)
      : tab === 'Annotate'
        ? ([] as const)
        : tab === 'Survey'
          ? ([] as const)
          : tab === 'Surface'
            ? ([] as const)
            : (['File'] as const);
  return (
    <div className="cad-shell-ribbon" data-cad-ribbon>
      <div className="cad-shell-ribbon-tabs" role="tablist" aria-label="Ribbon tabs">
        {RIBBON_TABS.map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={tab === entry}
            className={`cad-shell-ribbon-tab${tab === entry ? ' active' : ''}`}
            onClick={() => setTab(entry)}
          >
            {entry}
          </button>
        ))}
        <button type="button" className="cad-shell-ribbon-tab" onClick={onToggleCollapsed} title="Collapse ribbon">
          ▴
        </button>
      </div>
      <div className="cad-shell-ribbon-groups">
        {tab === 'Home' ? <CadLayersGroup snapshot={snapshot} actions={actions} /> : null}
        {tab === 'Home' ? <CadBlocksRibbonGroup snapshot={snapshot} actions={actions} /> : null}
        {tab === 'Annotate' ? <CadAnnotateRibbonGroups snapshot={snapshot} actions={actions} /> : null}
        {tab === 'Survey' ? <CadSurveyGroup snapshot={snapshot} actions={actions} /> : null}
        {tab === 'Surface' ? <CadSurfaceRibbonGroup snapshot={snapshot} actions={actions} /> : null}
        {groups.map((group) => (
          <div key={group} className="cad-shell-ribbon-group" aria-label={group}>
            <span className="cad-shell-ribbon-group-label">{group}</span>
            <div className="cad-shell-ribbon-buttons">
              {CAD_SHELL_COMMANDS.filter((def) => def.category === group).map((def) => (
                <button
                  key={def.key}
                  type="button"
                  title={ribbonTooltip(def)}
                  aria-label={def.label}
                  disabled={!isShellCommandAvailable(def, snapshot, actions)}
                  className="cad-shell-ribbon-button"
                  onClick={() => run(def)}
                  data-cad-command={def.key}
                >
                  {def.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * Phase 18N — compact BLOCKS group on Home: Insert (insert tab),
 * Create (definitions tab), Manager, Explode (selection). Same actions as
 * the command registry; no duplicate wiring.
 */
const CadBlocksRibbonGroup: React.FC<{
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
}> = ({ snapshot, actions }) => {
  const ready = snapshot != null && actions?.openBlockManager != null;
  const explodeReady = ready && (snapshot?.selectionCount ?? 0) > 0 && actions?.explodeSelectedBlocks != null;
  const buttons: Array<{ key: string; label: string; hint: string; disabled: boolean; onClick: () => void }> = [
    { key: 'insert', label: 'Insert', hint: 'Insert a block reference (Block Manager insert tab).', disabled: !ready, onClick: () => actions?.openBlockManager?.('insert') },
    { key: 'create', label: 'Create', hint: 'Create a block from the current selection.', disabled: !ready, onClick: () => actions?.openBlockManager?.('blocks') },
    { key: 'manager', label: 'Manager', hint: 'Open the Block Manager (definitions, survey symbols).', disabled: !ready, onClick: () => actions?.openBlockManager?.('blocks') },
    { key: 'explode', label: 'Explode', hint: 'Explode selected block references into plain entities.', disabled: !explodeReady, onClick: () => actions?.explodeSelectedBlocks?.() },
  ];
  return (
    <div className="cad-shell-ribbon-group" aria-label="Blocks">
      <span className="cad-shell-ribbon-group-label">Blocks</span>
      <div className="cad-shell-ribbon-buttons">
        {buttons.map((entry) => (
          <button
            key={entry.key}
            type="button"
            title={entry.hint}
            aria-label={entry.label}
            disabled={entry.disabled}
            className="cad-shell-ribbon-button"
            onClick={entry.onClick}
            data-cad-blocks={entry.key}
          >
            {entry.label}
          </button>
        ))}
      </div>
    </div>
  );
};

/**
 * Phase 18F — real SURFACE tab: CREATE (Create Surface), DEFINITION
 * (definition editors via the manager), BUILD (Rebuild selected +
 * Rebuild All), INQUIRY (Surface Elevation via the manager), STYLE
 * (Surface Styles via the manager). Phase 18H adds a DISPLAY group with a
 * Contours toggle (flips showContours on the selected surface's style via
 * the SURFACE_STYLE_UPDATE undo path). Phase 18I adds a VOLUME group
 * (Create Volume, Calculate, Difference Inquiry, Volume Report) backed by
 * the session SurfaceVolumeService; manual Calculate only. No Grading/Watershed.
 * Phase 18U adds an ANALYSIS group (Elevation/Slope/Manager/Inquiry),
 * a VOLUME Depth entry, and an Analysis Legend group; all route through the
 * surface manager palette and the shared command registry.
 */
const CadSurfaceRibbonGroup: React.FC<{
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
}> = ({ snapshot, actions }) => {
  const selectedSurfaceId = snapshot?.surface?.selectedSurfaceId ?? null;
  const selectedSurface = snapshot?.surface?.surfaces.find((row) => row.id === selectedSurfaceId) ?? null;
  const canEditTin = selectedSurface?.status === 'CURRENT';
  // Phase 18V — session point selection drives the bulk-edit enablement.
  const selectionCount = snapshot?.surface?.selection.count ?? 0;
  const canBulk = canEditTin && selectionCount > 0;
  const selectPoints = (mode: 'window' | 'polygon' | 'all' | 'clear' | 'invert'): void => {
    actions?.selectSurfacePoints?.(mode);
  };
  const startEdit = (mode: 'swap' | 'add-line' | 'delete-line' | 'add-point' | 'delete-point' | 'move-point' | 'set-elevation' | 'raise-lower'): void => {
    actions?.startSurfaceEditSession?.(mode);
  };
  // Manual Calculate gating mirrors the manager button: both source TINs Current.
  const canCalculateVolume = snapshot?.volume?.volumes.some(
    (row) => row.id === snapshot.volume?.selectedVolumeId && row.calculable,
  ) === true;
  const create = (): void => {
    try {
      actions?.runSurveyCommand({ key: 'SURFACE_CREATE' });
    } catch {
      // Missing executor: registry path reports unavailable; no fake.
    }
  };
  const openManager = (surfaceId?: string): void =>
    actions?.openSurveyManager('surfaces', surfaceId);
  // Phase 18W/18X — imported and baked explicit TINs keep native source editing
  // disabled (manager shows the same disabled state; the engine rejects native
  // source mutations).
  const hasExplicitTopology = selectedSurface != null && selectedSurface.definition.sourceKind !== 'native';
  const bake = selectedSurface != null ? surfaceBakeCapability(selectedSurface) : { copy: false, inPlace: false };
  // Phase 18Y — composition needs two CURRENT surfaces (sources never stale).
  const compose = surfaceComposeCapability(snapshot?.surface?.surfaces ?? []);
  const bakeCommand = (key: 'SURFBAKE' | 'SURFBAKECOPY'): void => {
    if (!selectedSurface || !actions) return;
    if (key === 'SURFBAKE' && !confirmSurfaceBakeInPlace(selectedSurface)) return;
    trySurfaceCommand(actions.runSurveyCommand, {
      key,
      surfaceId: selectedSurface.id,
      expectedRevision: selectedSurface.revision,
      // Session TIN currency (the project never persists cachedRevision).
      sessionCurrent: selectedSurface.status === 'CURRENT',
    });
  };
  const runDefinitionCommand = (key: string): void => {
    const def = CAD_SHELL_COMMANDS.find((entry) => entry.key === key);
    if (def) executeShellCommand(def, actions, snapshot);
    else openManager(selectedSurfaceId ?? undefined);
  };
  const group = (
    label: string,
    buttons: Array<{ key: string; label: string; hint: string; disabled: boolean; onClick: () => void }>
  ): React.ReactNode => (
    <div className="cad-shell-ribbon-group" aria-label={label}>
      <span className="cad-shell-ribbon-group-label">{label}</span>
      <div className="cad-shell-ribbon-buttons">
        {buttons.map((entry) => (
          <button
            key={entry.key}
            type="button"
            title={entry.hint}
            aria-label={entry.label}
            disabled={entry.disabled}
            className="cad-shell-ribbon-button"
            onClick={entry.onClick}
            data-cad-surface={entry.key}
          >
            {entry.label}
          </button>
        ))}
      </div>
    </div>
  );
  const ready = snapshot != null && actions != null;
  return (
    <>
      {group('Create', [
        { key: 'create', label: 'Create Surface', hint: 'Create a surface (auto name, current layer, UNBUILT).', disabled: !ready, onClick: create },
      ])}
      {group('Definition', [
        { key: 'point-group', label: 'Add Point Group', hint: 'Attach a point group (manager).', disabled: !ready, onClick: () => openManager(selectedSurfaceId ?? undefined) },
        { key: 'points', label: 'Add Points', hint: 'Add selected XYZ points (manager).', disabled: !ready, onClick: () => openManager(selectedSurfaceId ?? undefined) },
        { key: 'breaklines', label: 'Breaklines', hint: 'Add/edit breakline chains (manager).', disabled: !ready || hasExplicitTopology, onClick: () => runDefinitionCommand('SURFBREAKLINE') },
        { key: 'boundaries', label: 'Boundaries', hint: 'Create/edit boundary rings (manager).', disabled: !ready || hasExplicitTopology, onClick: () => runDefinitionCommand('SURFBOUNDARY') },
      ])}
      {group('Definition Tools', [
        {
          key: 'bake-copy',
          label: 'Bake Copy',
          hint: 'Create a new explicit-TIN surface from the selected surface\u2019s current mesh (original untouched).',
          disabled: !ready || !bake.copy,
          onClick: () => bakeCommand('SURFBAKECOPY'),
        },
        {
          key: 'bake-in-place',
          label: 'Bake In Place',
          hint: 'Replace the definition with a snapshot of the current mesh (clears edits; one undo step).',
          disabled: !ready || !bake.inPlace,
          onClick: () => bakeCommand('SURFBAKE'),
        },
        {
          key: 'compose',
          label: 'Compose',
          hint: 'Compose the selected surface (Base) with another CURRENT surface (Overlay) into one explicit TIN — composite copy or paste in place (manager dialog).',
          disabled: !ready || !compose.canCompose,
          onClick: () => runDefinitionCommand('SURFCOMPOSECOPY'),
        },
        {
          key: 'paste',
          label: 'Paste',
          hint: 'Paste an Overlay surface into the selected Target in place (manager dialog; target definition replaced, source unchanged).',
          disabled: !ready || !compose.canCompose,
          onClick: () => runDefinitionCommand('SURFPASTE'),
        },
      ])}
      {group('Build', [
        { key: 'rebuild', label: 'Rebuild', hint: 'Rebuild the selected surface.', disabled: !selectedSurfaceId || !actions, onClick: () => { if (selectedSurfaceId) actions?.rebuildSurface(selectedSurfaceId); } },
        { key: 'rebuild-all', label: 'Rebuild All', hint: 'Rebuild every surface needing it.', disabled: !ready, onClick: () => actions?.rebuildAllSurfaces() },
      ])}
      {group('Select Points', [
        { key: 'select-window', label: 'Window', hint: 'Select points inside an inclusive rectangle (needs a Current surface).', disabled: !actions?.selectSurfacePoints || !canEditTin, onClick: () => selectPoints('window') },
        { key: 'select-polygon', label: 'Polygon', hint: 'Select points inside a point-chain polygon (self-intersection blocks).', disabled: !actions?.selectSurfacePoints || !canEditTin, onClick: () => selectPoints('polygon') },
        { key: 'select-all', label: 'All', hint: 'Select every stable editable surface vertex (synthetic excluded).', disabled: !actions?.selectSurfacePoints || !canEditTin, onClick: () => selectPoints('all') },
        { key: 'select-invert', label: 'Invert', hint: 'Invert the current point selection.', disabled: !actions?.selectSurfacePoints || !canEditTin, onClick: () => selectPoints('invert') },
        { key: 'select-clear', label: 'Clear', hint: 'Clear the point selection.', disabled: !actions?.selectSurfacePoints, onClick: () => selectPoints('clear') },
      ])}
      {group('Edit', [
        { key: 'swap', label: 'Swap Edge', hint: 'Swap the diagonal of two adjacent FREE triangles (needs a Current surface + selected edge).', disabled: !actions?.startSurfaceEditSession || !canEditTin, onClick: () => startEdit('swap') },
        { key: 'add-line', label: 'Add TIN Line', hint: 'Force a TIN line between two mesh vertices (needs a Current surface).', disabled: !actions?.startSurfaceEditSession || !canEditTin, onClick: () => startEdit('add-line') },
        { key: 'delete-line', label: 'Delete TIN Line', hint: 'Delete a FREE TIN edge (boundary retreats, or an interior hole).', disabled: !actions?.startSurfaceEditSession || !canEditTin, onClick: () => startEdit('delete-line') },
        { key: 'add-point', label: 'Add Point', hint: 'Surface-only: add a point inside the CURRENT surface (survey data unchanged).', disabled: !actions?.startSurfaceEditSession || !canEditTin, onClick: () => startEdit('add-point') },
        { key: 'delete-point', label: 'Delete Point', hint: 'Surface-only: delete an interior vertex (survey data unchanged).', disabled: !actions?.startSurfaceEditSession || !canEditTin, onClick: () => startEdit('delete-point') },
        { key: 'move-point', label: 'Move Point', hint: 'Surface-only: move a vertex in XY, Z unchanged (survey data unchanged).', disabled: !actions?.startSurfaceEditSession || !canEditTin, onClick: () => startEdit('move-point') },
        { key: 'set-elevation', label: 'Set Elevation', hint: 'Surface-only elevation override on one vertex (survey data unchanged).', disabled: !actions?.startSurfaceEditSession || !canEditTin, onClick: () => startEdit('set-elevation') },
        { key: 'raise-lower', label: 'Raise/Lower', hint: 'Surface-only: shift every vertex by a delta (survey data unchanged).', disabled: !actions?.startSurfaceEditSession || !canEditTin, onClick: () => startEdit('raise-lower') },
        { key: 'bulk-set-z', label: 'Set Selected Z', hint: 'Surface-only: set the Z of SELECTED points only in one undoable edit.', disabled: !actions?.startSurfaceBulkEditSession || !canBulk, onClick: () => actions?.startSurfaceBulkEditSession?.('set-elevation') },
        { key: 'bulk-raise-lower', label: 'Raise/Lower Selected', hint: 'Surface-only: Raise/Lower SELECTED points only (never the entire surface).', disabled: !actions?.startSurfaceBulkEditSession || !canBulk, onClick: () => actions?.startSurfaceBulkEditSession?.('raise-lower') },
        { key: 'bulk-move', label: 'Move Selected', hint: 'Surface-only: move SELECTED points by a base+destination displacement.', disabled: !actions?.startSurfaceBulkEditSession || !canBulk, onClick: () => actions?.startSurfaceBulkEditSession?.('move') },
        { key: 'history', label: 'Edit History', hint: 'Open the TIN edit history list.', disabled: !ready, onClick: () => openManager(selectedSurfaceId ?? undefined) },
      ])}
      {group('Inquiry', [
        { key: 'elevation', label: 'Surface Elevation', hint: 'Query E/N/elevation (manager).', disabled: !ready, onClick: () => openManager(selectedSurfaceId ?? undefined) },
      ])}
      {group('Style', [
        { key: 'styles', label: 'Surface Styles', hint: 'Assign display styles (manager).', disabled: !ready, onClick: () => openManager(selectedSurfaceId ?? undefined) },
      ])}
      {group('Display', [
        { key: 'contours-toggle', label: 'Contours', hint: 'Toggle contour display on the selected surface style (manager).', disabled: !ready, onClick: () => openManager(selectedSurfaceId ?? undefined) },
      ])}
      {group('Analysis', [
        { key: 'new-elevation', label: 'Elevation', hint: 'Create an elevation-band analysis on the selected surface (5 equal bands).', disabled: !ready, onClick: () => actions?.createAnalysis?.('elevation') },
        { key: 'new-slope', label: 'Slope', hint: 'Create a slope-band analysis on the selected surface (5 equal bands).', disabled: !ready, onClick: () => actions?.createAnalysis?.('slope-percent') },
        { key: 'manager', label: 'Manager', hint: 'Open the analysis manager (rows, ranges, calculate, delete).', disabled: !ready, onClick: () => openManager(selectedSurfaceId ?? undefined) },
        { key: 'inquiry', label: 'Inquiry', hint: 'Query the exact metric + band at a plan point (manager inquiry).', disabled: !ready, onClick: () => openManager(selectedSurfaceId ?? undefined) },
      ])}
      {group('Volume', [
        { key: 'create-volume', label: 'Create Volume', hint: 'Create a TIN-to-TIN volume surface (manager).', disabled: !ready, onClick: () => openManager(selectedSurfaceId ?? undefined) },
        { key: 'depth', label: 'Depth', hint: 'Create a signed-depth analysis on the selected volume surface.', disabled: !ready, onClick: () => actions?.createAnalysis?.('signed-depth') },
        { key: 'calculate-volume', label: 'Calculate', hint: 'Calculate volumes for the selected volume surface (both sources must be Current).', disabled: !ready || !canCalculateVolume, onClick: () => actions?.calculateSelectedVolume() },
        { key: 'difference-inquiry', label: 'Difference Inquiry', hint: 'Query base/comparison elevations + CUT/FILL verdict (manager).', disabled: !ready, onClick: () => openManager(selectedSurfaceId ?? undefined) },
        { key: 'volume-report', label: 'Volume Report', hint: 'Download the Volume Summary CSV (Current volumes only, manager).', disabled: !ready, onClick: () => openManager(selectedSurfaceId ?? undefined) },
      ])}
      {group('Analysis Legend', [
        { key: 'create-legend', label: 'Create Legend', hint: 'Create a legend for the selected analysis (manager creates it at the insertion point).', disabled: !ready, onClick: () => openManager(selectedSurfaceId ?? undefined) },
      ])}
      {group('Profile', [
        { key: 'profile-create', label: 'Create Surface Profile', hint: 'Create a profile from an alignment + surface (manager).', disabled: !ready, onClick: () => actions?.openSurveyManager('profiles') },
        { key: 'profile-manager', label: 'Profile Manager', hint: 'Open the surface profile manager.', disabled: !ready, onClick: () => actions?.openSurveyManager('profiles') },
        { key: 'profile-view', label: 'Create Profile View', hint: 'Create a profile view from the selected profile.', disabled: !ready, onClick: () => actions?.createProfileView() },
        { key: 'profile-elevation', label: 'Profile Elevation', hint: 'Query profile elevation at a station (manager).', disabled: !ready, onClick: () => actions?.openSurveyManager('profiles') },
      ])}
      {group('Sections', [
        { key: 'sample-lines', label: 'Sample Lines', hint: 'Open the sample-line manager.', disabled: !ready, onClick: () => actions?.openSurveyManager('sections') },
        { key: 'sample-line-add', label: 'Add Sample Line', hint: 'Add a sample line at a station (manager).', disabled: !ready, onClick: () => actions?.openSurveyManager('sections') },
        { key: 'sample-line-interval', label: 'By Interval', hint: 'Generate sample lines by raw interval (manager).', disabled: !ready, onClick: () => actions?.openSurveyManager('sections') },
        { key: 'section-rebuild', label: 'Rebuild Sections', hint: 'Rebuild sections for the selected group (manual).', disabled: !ready, onClick: () => { const id = snapshot?.section?.selectedGroupId; if (id) actions?.rebuildSections(id); } },
        { key: 'section-views', label: 'Create Section Views', hint: 'Batch-create section views, one vertical stack (manager).', disabled: !ready, onClick: () => { const id = snapshot?.section?.selectedGroupId; if (id) actions?.createSectionViews(id); else actions?.openSurveyManager('sections'); } },
      ])}
    </>
  );
};

/**
 * Phase 18D — Survey tab: five entry points, each focusing the Toolspace
 * node or opening the matching manager. No new command groups.
 * Phase 18E — F2F group: six compact entries routing through the command
 * registry section focus (catalog/codes/review/regen/import/export).
 */
const CadSurveyGroup: React.FC<{
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
}> = ({ snapshot, actions }) => {
  const buttons: Array<{ kind: SurveyManagerKind; label: string; hint: string }> = [
    { kind: 'points', label: 'Points', hint: 'Focus the Toolspace Survey points.' },
    { kind: 'point-groups', label: 'Point Groups', hint: 'Open the Point Group manager.' },
    { kind: 'point-styles', label: 'Point Styles', hint: 'Open the Point Style manager.' },
    { kind: 'point-label-styles', label: 'Point Label Styles', hint: 'Open the Point Label Style manager.' },
    { kind: 'f2f', label: 'Field to Finish', hint: 'Open field-to-finish.' },
  ];
  const transform: Array<{ key: 'HELMERT2D' | 'GRIDGROUND'; label: string; hint: string }> = [
    { key: 'HELMERT2D', label: 'Helmert 2D', hint: 'Least-squares Helmert fit from explicit control pairs (Modify).' },
    { key: 'GRIDGROUND', label: 'Grid/Ground', hint: 'Uniform grid/ground scale about an origin (Modify).' },
  ];
  const runTransform = (key: 'HELMERT2D' | 'GRIDGROUND'): void => {
    actions?.startCommand(key);
  };
  const f2f: Array<{ section: string; label: string; hint: string }> = [
    { section: 'catalog', label: 'Field to Finish', hint: 'Open field-to-finish catalog.' },
    { section: 'codes', label: 'Feature Codes', hint: 'Open the feature-code manager.' },
    { section: 'review', label: 'Import/Review', hint: 'Open the F2F import review.' },
    { section: 'regen', label: 'Regenerate', hint: 'Open regeneration preview.' },
    { section: 'import', label: 'Catalog Import', hint: 'Open catalog file import.' },
    { section: 'export', label: 'Catalog Export', hint: 'Open catalog file export.' },
  ];
  return (
    <>
    <div className="cad-shell-ribbon-group" aria-label="Survey">
      <span className="cad-shell-ribbon-group-label">Survey</span>
      <div className="cad-shell-ribbon-buttons">
        {buttons.map((entry) => (
          <button
            key={entry.kind}
            type="button"
            title={entry.hint}
            aria-label={entry.label}
            disabled={!snapshot || !actions}
            className="cad-shell-ribbon-button"
            onClick={() => actions?.openSurveyManager(entry.kind)}
            data-cad-survey={entry.kind}
          >
            {entry.label}
          </button>
        ))}
        <button
          type="button"
          title="Open the survey symbol library (Block Manager symbols view)"
          aria-label="Survey Symbols"
          disabled={!snapshot || !actions?.openBlockManager}
          className="cad-shell-ribbon-button"
          onClick={() => actions?.openBlockManager?.('symbols')}
          data-cad-survey-symbols="true"
        >
          Survey Symbols
        </button>
      </div>
    </div>
    <div className="cad-shell-ribbon-group" aria-label="Transform">
      <span className="cad-shell-ribbon-group-label">Transform</span>
      <div className="cad-shell-ribbon-buttons">
        {transform.map((entry) => (
          <button
            key={entry.key}
            type="button"
            title={entry.hint}
            aria-label={entry.label}
            disabled={!snapshot || !actions || !(snapshot.availableCommands.includes(entry.key))}
            className="cad-shell-ribbon-button"
            onClick={() => runTransform(entry.key)}
            data-cad-transform={entry.key}
          >
            {entry.label}
          </button>
        ))}
      </div>
    </div>
    <div className="cad-shell-ribbon-group" aria-label="Field to Finish">
      <span className="cad-shell-ribbon-group-label">Field to Finish</span>
      <div className="cad-shell-ribbon-buttons">
        {f2f.map((entry) => (
          <button
            key={entry.section}
            type="button"
            title={entry.hint}
            aria-label={entry.label}
            disabled={!snapshot || !actions}
            className="cad-shell-ribbon-button"
            onClick={() => actions?.openSurveyManager('f2f', entry.section)}
            data-cad-f2f={entry.section}
          >
            {entry.label}
          </button>
        ))}
      </div>
    </div>
    </>
  );
};
