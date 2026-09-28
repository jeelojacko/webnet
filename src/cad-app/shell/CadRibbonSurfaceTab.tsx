// Phase 21A Wave 2 — Surface tab (moved verbatim from CadRibbon.tsx,
// re-chromed into the compact grid; no handler/semantics changes).
//
// CREATE / DEFINITION / DEFINITION TOOLS / BUILD / SELECT POINTS / EDIT /
// INQUIRY / STYLE / DISPLAY / ANALYSIS / VOLUME / ANALYSIS LEGEND / PROFILE
// / SECTIONS. Phase 21B added icons to the controls with a truthful curated
// Civil asset; the rest keep a short text face. Surface dispatch stays on the
// existing action/manager paths (not the draw registry); only the group chrome
// is shared (RibbonGroup caption-bottom grid).
import React from 'react';
import {
  CAD_SHELL_COMMANDS,
  executeShellCommand,
} from './cadCommandRegistry';
import { CadRibbonIconButton } from './CadRibbonIconButton';
import type { CadRibbonIconId } from '../assets/icons/cadRibbonIcons';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import { surfaceBakeCapability, trySurfaceCommand } from './cadSurfaceSnapshot';
import { surfaceComposeCapability } from './cadSurfaceCompose';
import { confirmSurfaceBakeInPlace } from './cadSurfaceBakePrompt';
import { RibbonGroup } from './CadRibbonShared';

interface SurfaceButton {
  key: string;
  label: string;
  short: string;
  /** Curated Civil icon; omitted keys keep a short text face. */
  icon?: CadRibbonIconId;
  hint: string;
  disabled: boolean;
  onClick: () => void;
}

const SurfaceGroup: React.FC<{ label: string; buttons: SurfaceButton[] }> = ({ label, buttons }) => (
  <RibbonGroup label={label}>
    {buttons.map((entry) => (
      <CadRibbonIconButton
        key={entry.key}
        className="cad-ribbon-tool"
        icon={entry.icon}
        shortLabel={entry.short}
        label={entry.label}
        title={`${entry.label} — ${entry.hint}`}
        disabled={entry.disabled}
        size="compact"
        onClick={entry.onClick}
      />
    ))}
  </RibbonGroup>
);

export const CadRibbonSurfaceTab: React.FC<{
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
}> = ({ snapshot, actions }) => {
  const selectedSurfaceId = snapshot?.surface?.selectedSurfaceId ?? null;
  const selectedSurface = snapshot?.surface?.surfaces.find((row) => row.id === selectedSurfaceId) ?? null;
  const canEditTin = selectedSurface?.status === 'CURRENT';
  const selectionCount = snapshot?.surface?.selection.count ?? 0;
  const canBulk = canEditTin && selectionCount > 0;
  const selectPoints = (mode: 'window' | 'polygon' | 'all' | 'clear' | 'invert'): void => {
    actions?.selectSurfacePoints?.(mode);
  };
  const startEdit = (mode: 'swap' | 'add-line' | 'delete-line' | 'add-point' | 'delete-point' | 'move-point' | 'set-elevation' | 'raise-lower'): void => {
    actions?.startSurfaceEditSession?.(mode);
  };
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
  const hasExplicitTopology = selectedSurface != null && selectedSurface.definition.sourceKind !== 'native';
  const bake = selectedSurface != null ? surfaceBakeCapability(selectedSurface) : { copy: false, inPlace: false };
  const compose = surfaceComposeCapability(snapshot?.surface?.surfaces ?? []);
  const bakeCommand = (key: 'SURFBAKE' | 'SURFBAKECOPY'): void => {
    if (!selectedSurface || !actions) return;
    if (key === 'SURFBAKE' && !confirmSurfaceBakeInPlace(selectedSurface)) return;
    trySurfaceCommand(actions.runSurveyCommand, {
      key,
      surfaceId: selectedSurface.id,
      expectedRevision: selectedSurface.revision,
      sessionCurrent: selectedSurface.status === 'CURRENT',
    });
  };
  const runDefinitionCommand = (key: string): void => {
    const def = CAD_SHELL_COMMANDS.find((entry) => entry.key === key);
    if (def) executeShellCommand(def, actions, snapshot);
    else openManager(selectedSurfaceId ?? undefined);
  };
  const ready = snapshot != null && actions != null;
  return (
    <>
      <SurfaceGroup label="Create" buttons={[
        { key: 'create', label: 'Create Surface', short: 'Create', icon: 'surface-create', hint: 'Create a surface (auto name, current layer, UNBUILT).', disabled: !ready, onClick: create },
      ]} />
      <SurfaceGroup label="Definition" buttons={[
        { key: 'point-group', label: 'Add Point Group', short: 'Group', hint: 'Attach a point group (manager).', disabled: !ready, onClick: () => openManager(selectedSurfaceId ?? undefined) },
        { key: 'points', label: 'Add Points', short: 'Points', icon: 'surface-add-point', hint: 'Add selected XYZ points (manager).', disabled: !ready, onClick: () => openManager(selectedSurfaceId ?? undefined) },
        { key: 'breaklines', label: 'Breaklines', short: 'Break', icon: 'surface-breakline', hint: 'Add/edit breakline chains (manager).', disabled: !ready || hasExplicitTopology, onClick: () => runDefinitionCommand('SURFBREAKLINE') },
        { key: 'boundaries', label: 'Boundaries', short: 'Bound', icon: 'surface-boundary', hint: 'Create/edit boundary rings (manager).', disabled: !ready || hasExplicitTopology, onClick: () => runDefinitionCommand('SURFBOUNDARY') },
      ]} />
      <SurfaceGroup label="Definition Tools" buttons={[
        { key: 'bake-copy', label: 'Bake Copy', short: 'Bake', hint: 'New explicit-TIN surface from the current mesh (original untouched).', disabled: !ready || !bake.copy, onClick: () => bakeCommand('SURFBAKECOPY') },
        { key: 'bake-in-place', label: 'Bake In Place', short: 'Bake In', hint: 'Replace the definition with a snapshot of the current mesh (one undo step).', disabled: !ready || !bake.inPlace, onClick: () => bakeCommand('SURFBAKE') },
        { key: 'compose', label: 'Compose', short: 'Compose', hint: 'Compose Base with another CURRENT surface (manager dialog).', disabled: !ready || !compose.canCompose, onClick: () => runDefinitionCommand('SURFCOMPOSECOPY') },
        { key: 'paste', label: 'Paste', short: 'Paste', icon: 'surface-paste', hint: 'Paste an Overlay surface into the selected Target (manager dialog).', disabled: !ready || !compose.canCompose, onClick: () => runDefinitionCommand('SURFPASTE') },
        { key: 'design-copy', label: 'Create Design Copy', short: 'Design', hint: 'Copy the CURRENT surface into a Design-role surface (manager).', disabled: !ready || !bake.copy, onClick: () => runDefinitionCommand('DESIGNSURFACE') },
        { key: 'build-patch', label: 'Build Design Patch', short: 'Patch', hint: 'Build a Design Patch from a CURRENT closed flat grading group (manager).', disabled: !ready, onClick: () => runDefinitionCommand('DESIGNPATCH') },
        { key: 'apply-patch', label: 'Apply Patch', short: 'Apply', hint: 'Apply a Design Patch onto a Design target (manager).', disabled: !ready || !compose.canCompose, onClick: () => runDefinitionCommand('DESIGNAPPLY') },
        { key: 'earthwork-volume', label: 'Earthwork Volume', short: 'Earth', icon: 'surface-volume-report', hint: 'Track an Existing-Ground vs Design volume (manager).', disabled: !ready, onClick: () => runDefinitionCommand('DESIGNVOLUME') },
      ]} />
      <SurfaceGroup label="Build" buttons={[
        { key: 'rebuild', label: 'Rebuild', short: 'Rebuild', hint: 'Rebuild the selected surface.', disabled: !selectedSurfaceId || !actions, onClick: () => { if (selectedSurfaceId) actions?.rebuildSurface(selectedSurfaceId); } },
        { key: 'rebuild-all', label: 'Rebuild All', short: 'All', hint: 'Rebuild every surface needing it.', disabled: !ready, onClick: () => actions?.rebuildAllSurfaces() },
      ]} />
      <SurfaceGroup label="Select Points" buttons={[
        { key: 'select-window', label: 'Window', short: 'Window', hint: 'Select points inside an inclusive rectangle.', disabled: !actions?.selectSurfacePoints || !canEditTin, onClick: () => selectPoints('window') },
        { key: 'select-polygon', label: 'Polygon', short: 'Poly', hint: 'Select points inside a point-chain polygon.', disabled: !actions?.selectSurfacePoints || !canEditTin, onClick: () => selectPoints('polygon') },
        { key: 'select-all', label: 'All', short: 'All', hint: 'Select every stable editable surface vertex.', disabled: !actions?.selectSurfacePoints || !canEditTin, onClick: () => selectPoints('all') },
        { key: 'select-invert', label: 'Invert', short: 'Invert', hint: 'Invert the current point selection.', disabled: !actions?.selectSurfacePoints || !canEditTin, onClick: () => selectPoints('invert') },
        { key: 'select-clear', label: 'Clear', short: 'Clear', hint: 'Clear the point selection.', disabled: !actions?.selectSurfacePoints, onClick: () => selectPoints('clear') },
      ]} />
      <SurfaceGroup label="Edit" buttons={[
        { key: 'swap', label: 'Swap Edge', short: 'Swap', icon: 'surface-swap-edge', hint: 'Swap the diagonal of two adjacent FREE triangles.', disabled: !actions?.startSurfaceEditSession || !canEditTin, onClick: () => startEdit('swap') },
        { key: 'add-line', label: 'Add TIN Line', short: 'Add Ln', icon: 'surface-line-add', hint: 'Force a TIN line between two mesh vertices.', disabled: !actions?.startSurfaceEditSession || !canEditTin, onClick: () => startEdit('add-line') },
        { key: 'delete-line', label: 'Delete TIN Line', short: 'Del Ln', hint: 'Delete a FREE TIN edge.', disabled: !actions?.startSurfaceEditSession || !canEditTin, onClick: () => startEdit('delete-line') },
        { key: 'add-point', label: 'Add Point', short: 'Add Pt', icon: 'surface-add-point', hint: 'Surface-only: add a point inside the CURRENT surface.', disabled: !actions?.startSurfaceEditSession || !canEditTin, onClick: () => startEdit('add-point') },
        { key: 'delete-point', label: 'Delete Point', short: 'Del Pt', hint: 'Surface-only: delete an interior vertex.', disabled: !actions?.startSurfaceEditSession || !canEditTin, onClick: () => startEdit('delete-point') },
        { key: 'move-point', label: 'Move Point', short: 'Move', hint: 'Surface-only: move a vertex in XY, Z unchanged.', disabled: !actions?.startSurfaceEditSession || !canEditTin, onClick: () => startEdit('move-point') },
        { key: 'set-elevation', label: 'Set Elevation', short: 'Set Z', hint: 'Surface-only elevation override on one vertex.', disabled: !actions?.startSurfaceEditSession || !canEditTin, onClick: () => startEdit('set-elevation') },
        { key: 'raise-lower', label: 'Raise/Lower', short: 'Raise', hint: 'Surface-only: shift every vertex by a delta.', disabled: !actions?.startSurfaceEditSession || !canEditTin, onClick: () => startEdit('raise-lower') },
        { key: 'bulk-set-z', label: 'Set Selected Z', short: 'Sel Z', hint: 'Surface-only: set the Z of SELECTED points only.', disabled: !actions?.startSurfaceBulkEditSession || !canBulk, onClick: () => actions?.startSurfaceBulkEditSession?.('set-elevation') },
        { key: 'bulk-raise-lower', label: 'Raise/Lower Selected', short: 'Sel ±', hint: 'Surface-only: Raise/Lower SELECTED points only.', disabled: !actions?.startSurfaceBulkEditSession || !canBulk, onClick: () => actions?.startSurfaceBulkEditSession?.('raise-lower') },
        { key: 'bulk-move', label: 'Move Selected', short: 'Sel Mv', hint: 'Surface-only: move SELECTED points by displacement.', disabled: !actions?.startSurfaceBulkEditSession || !canBulk, onClick: () => actions?.startSurfaceBulkEditSession?.('move') },
        { key: 'history', label: 'Edit History', short: 'Hist', hint: 'Open the TIN edit history list.', disabled: !ready, onClick: () => openManager(selectedSurfaceId ?? undefined) },
      ]} />
      <SurfaceGroup label="Inquiry" buttons={[
        { key: 'elevation', label: 'Surface Elevation', short: 'Elev', hint: 'Query E/N/elevation (manager).', disabled: !ready, onClick: () => openManager(selectedSurfaceId ?? undefined) },
      ]} />
      <SurfaceGroup label="Style" buttons={[
        { key: 'styles', label: 'Surface Styles', short: 'Styles', icon: 'surface-style', hint: 'Assign display styles (manager).', disabled: !ready, onClick: () => openManager(selectedSurfaceId ?? undefined) },
      ]} />
      <SurfaceGroup label="Display" buttons={[
        { key: 'contours-toggle', label: 'Contours', short: 'Contours', icon: 'surface-contours', hint: 'Toggle contour display on the selected surface style (manager).', disabled: !ready, onClick: () => openManager(selectedSurfaceId ?? undefined) },
      ]} />
      <SurfaceGroup label="Analysis" buttons={[
        { key: 'new-elevation', label: 'Elevation', short: 'Elev', hint: 'Elevation-band analysis (5 equal bands).', disabled: !ready, onClick: () => actions?.createAnalysis?.('elevation') },
        { key: 'new-slope', label: 'Slope', short: 'Slope', hint: 'Slope-band analysis (5 equal bands).', disabled: !ready, onClick: () => actions?.createAnalysis?.('slope-percent') },
        { key: 'manager', label: 'Manager', short: 'Mgr', hint: 'Open the analysis manager.', disabled: !ready, onClick: () => openManager(selectedSurfaceId ?? undefined) },
        { key: 'inquiry', label: 'Inquiry', short: 'Query', hint: 'Query the exact metric + band at a plan point.', disabled: !ready, onClick: () => openManager(selectedSurfaceId ?? undefined) },
      ]} />
      <SurfaceGroup label="Volume" buttons={[
        { key: 'create-volume', label: 'Create Volume', short: 'Create', icon: 'surface-volume', hint: 'Create a TIN-to-TIN volume surface (manager).', disabled: !ready, onClick: () => openManager(selectedSurfaceId ?? undefined) },
        { key: 'depth', label: 'Depth', short: 'Depth', hint: 'Signed-depth analysis on the selected volume surface.', disabled: !ready, onClick: () => actions?.createAnalysis?.('signed-depth') },
        { key: 'calculate-volume', label: 'Calculate', short: 'Calc', hint: 'Calculate volumes (both sources must be Current).', disabled: !ready || !canCalculateVolume, onClick: () => actions?.calculateSelectedVolume() },
        { key: 'difference-inquiry', label: 'Difference Inquiry', short: 'Diff', hint: 'Query base/comparison elevations + CUT/FILL verdict.', disabled: !ready, onClick: () => openManager(selectedSurfaceId ?? undefined) },
        { key: 'volume-report', label: 'Volume Report', short: 'Report', icon: 'surface-volume-report', hint: 'Download the Volume Summary CSV.', disabled: !ready, onClick: () => openManager(selectedSurfaceId ?? undefined) },
      ]} />
      <SurfaceGroup label="Analysis Legend" buttons={[
        { key: 'create-legend', label: 'Create Legend', short: 'Legend', hint: 'Create a legend for the selected analysis.', disabled: !ready, onClick: () => openManager(selectedSurfaceId ?? undefined) },
      ]} />
      <SurfaceGroup label="Profile" buttons={[
        { key: 'profile-create', label: 'Create Surface Profile', short: 'Create', hint: 'Create a profile from an alignment + surface (manager).', disabled: !ready, onClick: () => actions?.openSurveyManager('profiles') },
        { key: 'profile-manager', label: 'Profile Manager', short: 'Mgr', hint: 'Open the surface profile manager.', disabled: !ready, onClick: () => actions?.openSurveyManager('profiles') },
        { key: 'profile-view', label: 'Create Profile View', short: 'View', icon: 'profile-view', hint: 'Create a profile view from the selected profile.', disabled: !ready, onClick: () => actions?.createProfileView() },
        { key: 'profile-elevation', label: 'Profile Elevation', short: 'Elev', hint: 'Query profile elevation at a station (manager).', disabled: !ready, onClick: () => actions?.openSurveyManager('profiles') },
      ]} />
      <SurfaceGroup label="Sections" buttons={[
        { key: 'sample-lines', label: 'Sample Lines', short: 'Lines', hint: 'Open the sample-line manager.', disabled: !ready, onClick: () => actions?.openSurveyManager('sections') },
        { key: 'sample-line-add', label: 'Add Sample Line', short: 'Add', hint: 'Add a sample line at a station (manager).', disabled: !ready, onClick: () => actions?.openSurveyManager('sections') },
        { key: 'sample-line-interval', label: 'By Interval', short: 'Interval', hint: 'Generate sample lines by raw interval (manager).', disabled: !ready, onClick: () => actions?.openSurveyManager('sections') },
        { key: 'section-rebuild', label: 'Rebuild Sections', short: 'Rebuild', hint: 'Rebuild sections for the selected group (manual).', disabled: !ready, onClick: () => { const id = snapshot?.section?.selectedGroupId; if (id) actions?.rebuildSections(id); } },
        { key: 'section-views', label: 'Create Section Views', short: 'Views', icon: 'section-view', hint: 'Batch-create section views, one vertical stack (manager).', disabled: !ready, onClick: () => { const id = snapshot?.section?.selectedGroupId; if (id) actions?.createSectionViews(id); else actions?.openSurveyManager('sections'); } },
      ]} />
    </>
  );
};
