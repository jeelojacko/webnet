import type { ActiveCommandKey } from '../../hooks/surveyCad/useSurveyCadCommandTypes';
import {
  CAD_LINE_L1_COMMAND_KEYS,
  CAD_LINE_L1_COMMAND_META,
} from '../../hooks/surveyCad/useSurveyCadLineL1Keys';
import {
  FEATURE_LINE_SHELL_KEYS,
  executeFeatureLineShellCommand,
  featureLineShellAvailable,
} from './cadFeatureLineShell';
import {
  GRADING_SHELL_KEYS,
  executeGradingShellCommand,
  gradingShellAvailable,
} from './cadGradingShell';
import {
  GRADINGGROUP_SHELL_KEYS,
  executeGradingGroupShellCommand,
  gradingGroupShellAvailable,
} from './cadGradingGroupShell';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import { requestDefinitionFocus, requestSurfaceComposeFocus } from './CadSurfaceDefinitionParts';
import { surfaceComposeCapability } from './cadSurfaceCompose';

/**
 * Phase 18W — the acting surface for definition commands: the selected
 * surface, else the only surface. Null = ambiguous, open the manager.
 */
const resolveDefinitionSurfaceId = (snapshot: CadWorkspaceSnapshot | null | undefined): string | null => {
  const surfaces = snapshot?.surface?.surfaces ?? [];
  const selected = snapshot?.surface?.selectedSurfaceId ?? null;
  if (selected && surfaces.some((row) => row.id === selected)) return selected;
  return surfaces.length === 1 ? surfaces[0]!.id : null;
};

const focusSurfaceDefinition = (
  actions: CadShellActions,
  snapshot: CadWorkspaceSnapshot | null | undefined,
  section: 'breaklines' | 'boundaries',
  targetId: string,
): boolean => {
  const surfaceId = resolveDefinitionSurfaceId(snapshot);
  if (!surfaceId) {
    actions.openSurveyManager('surfaces');
    return true;
  }
  requestDefinitionFocus({ surfaceId, section, targetId });
  actions.openSurveyManager('surfaces', surfaceId);
  return true;
};

/** Breakline focus: single breakline, else the entity-backed one under selection. */
const resolveBreaklineFocus = (
  actions: CadShellActions,
  snapshot: CadWorkspaceSnapshot | null | undefined,
): string => {
  const surfaceId = resolveDefinitionSurfaceId(snapshot);
  if (!surfaceId) return '__section';
  const row = snapshot?.surface?.surfaces.find((entry) => entry.id === surfaceId);
  const breaklines = row?.definition.breaklines ?? [];
  if (breaklines.length === 1) return breaklines[0]!.id;
  const selected = new Set(snapshot?.selectedEntityIds ?? []);
  for (const entry of breaklines) {
    if (entry.kind !== 'entity') continue;
    const detail = actions.describeBreaklineChain?.(surfaceId, entry.id);
    if (detail?.sourceEntityId && selected.has(detail.sourceEntityId)) return entry.id;
  }
  return '__section';
};

/** Boundary focus: selected source entity, else the single boundary. */
const resolveBoundaryFocus = (
  snapshot: CadWorkspaceSnapshot | null | undefined,
): string => {
  const surfaceId = resolveDefinitionSurfaceId(snapshot);
  if (!surfaceId) return '__section';
  const row = snapshot?.surface?.surfaces.find((entry) => entry.id === surfaceId);
  const boundaries = row?.definition.boundaries ?? [];
  const selected = new Set(snapshot?.selectedEntityIds ?? []);
  const matched = boundaries.find((entry) => selected.has(entry.sourceEntityId))
    ?? (boundaries.length === 1 ? boundaries[0]! : null);
  return matched ? matched.sourceEntityId : '__section';
};

/** Direct commit when unambiguous; otherwise focus the manager. */
const makeBoundaryIndependent = (
  actions: CadShellActions,
  snapshot: CadWorkspaceSnapshot | null | undefined,
): boolean => {
  const surfaceId = resolveDefinitionSurfaceId(snapshot);
  if (!surfaceId) {
    actions.openSurveyManager('surfaces');
    return true;
  }
  const row = snapshot?.surface?.surfaces.find((entry) => entry.id === surfaceId);
  const boundaries = row?.definition.boundaries ?? [];
  const selected = new Set(snapshot?.selectedEntityIds ?? []);
  const matched = boundaries.find((entry) => selected.has(entry.sourceEntityId))
    ?? (boundaries.length === 1 ? boundaries[0]! : null);
  if (!matched) return focusSurfaceDefinition(actions, snapshot, 'boundaries', '__section');
  const detail = actions.describeBoundarySourceDetail?.(matched.sourceEntityId);
  if (detail && detail.sharedUses > 1 && !window.confirm(
    `Boundary source shared by ${detail.sharedUses} surfaces. Make an independent copy for this surface?`,
  )) {
    return true;
  }
  return actions.runSurveyCommand({
    key: 'SURFACE_MAKE_BOUNDARY_INDEPENDENT',
    surfaceId,
    kind: matched.kind,
    sourceEntityId: matched.sourceEntityId,
  });
};

export type CadShellCommandCategory =
  | 'Draw'
  | 'Annotate'
  | 'Modify'
  | 'Measure'
  | 'Parcel'
  | 'Edit'
  | 'File'
  | 'Surface'
  | 'Design';

/**
 * Phase 18B — the ONE shell command definition map. Menu, ribbon, command
 * dock, and context menus all dispatch through `executeShellCommand`; the
 * workspace owns the machinery behind `CadShellActions`. Entries whose
 * starter is absent from the live snapshot render disabled, never fake.
 */
export interface CadShellCommandDef {
  /** UI command key, or a SHELL_ pseudo-key for chrome actions. */
  key: ActiveCommandKey | string;
  label: string;
  aliases: string[];
  category: CadShellCommandCategory;
  hint: string;
  shortcut?: string;
  kind: 'session' | 'action';
}

const session = (
  key: string,
  label: string,
  category: CadShellCommandCategory,
  hint: string,
  aliases: string[] = [],
  shortcut?: string,
): CadShellCommandDef => ({ key, label, aliases, category, hint, shortcut, kind: 'session' });

const action = (
  key: string,
  label: string,
  category: CadShellCommandCategory,
  hint: string,
  shortcut?: string,
  aliases: string[] = [],
): CadShellCommandDef => ({ key, label, aliases, category, hint, shortcut, kind: 'action' });

/**
 * Phase 18O annotation session commands. The engine command keys ship with
 * this batch; the workspace starters land with the annotation UI, so these
 * entries stay disabled until `availableCommands` reports the matching key.
 */
const annotation = (
  key: string,
  label: string,
  hint: string,
  aliases: string[] = [],
): CadShellCommandDef => ({ key, label, aliases, category: 'Annotate', hint, kind: 'session' });

export const CAD_SHELL_COMMANDS: CadShellCommandDef[] = [
  // Draw
  session('POINT', 'Point', 'Draw', 'Place a survey point.'),
  session('COGO_POINT', 'COGO Point', 'Draw', 'Place a point by coordinates.'),
  session('LINE', 'Line', 'Draw', 'Draw a line segment.', ['L']),
  // CAD Draw Phase L1 — the 16 Line-creation modes (full keys, no aliases).
  ...CAD_LINE_L1_COMMAND_KEYS.map((key) =>
    session(key, CAD_LINE_L1_COMMAND_META[key].label, 'Draw', CAD_LINE_L1_COMMAND_META[key].hint),
  ),
  session('PLINE', 'Polyline', 'Draw', 'Draw a connected polyline.', ['PL']),
  // Phase C3 — count-changing polyline vertex topology (pick-gated sessions;
  // aliases PIV/PDV are collision-free with every key and alias above).
  session('PLINEINSERTVERTEX', 'Insert Polyline Vertex', 'Modify', 'Insert a vertex on a polyline course (pick the polyline then the course point).', ['PIV']),
  session('PLINEDELETEVERTEX', 'Delete Polyline Vertex', 'Modify', 'Delete a polyline vertex (pick the polyline then the vertex).', ['PDV']),
  session('RECTANGLE', 'Rectangle', 'Draw', 'Rectangle from two corners.'),
  session('POLYGON', 'Polygon', 'Draw', 'Regular polygon from center and radius point.'),
  session('CIRCLE', 'Circle', 'Draw', 'Circle from center and radius.'),
  session('CIRCLECD', 'Circle Diameter', 'Draw', 'Circle from fixed center and diameter; radius is half.'),
  session('CIRCLE2P', 'Circle (2-Point)', 'Draw', 'Circle with two points as opposite diameter endpoints.'),
  session('CIRCLE3P', 'Circle (3-Point)', 'Draw', 'Circumcircle through three points.'),
  session('CIRCLETTR', 'Circle (Tan, Tan, Radius)', 'Draw', 'Circle tangent to two objects with a fixed radius.'),
  session('CIRCLETTT', 'Circle (Tan, Tan, Tan)', 'Draw', 'Circle tangent to three objects (Apollonius).'),
  session('TRAVERSE', 'Traverse', 'Draw', 'Draft an open/closed traverse.'),
  session('ARC_3PT', 'Arc (3-Point)', 'Draw', 'Arc through three points.'),
  session('ARC_SCE', 'Arc (Start/Center/End)', 'Draw', 'Arc from start, center, end.'),
  session('ARC_CSE', 'Arc (Center/Start/End)', 'Draw', 'Arc from center, start, end.'),
  session('ARC_SCA', 'Arc (Start/Center/Angle)', 'Draw', 'Arc from start, center, angle.'),
  session('ARC_CSA', 'Arc (Center/Start/Angle)', 'Draw', 'Arc from center, start, angle.'),
  session('ARC_SCL', 'Arc (Start/Center/Length)', 'Draw', 'Arc from start, center, length.'),
  session('ARC_CSL', 'Arc (Center/Start/Length)', 'Draw', 'Arc from center, start, length.'),
  session('ARC_SEA', 'Arc (Start/End/Angle)', 'Draw', 'Arc from start, end, angle.'),
  session('ARC_SED', 'Arc (Start/End/Direction)', 'Draw', 'Arc from start, end, direction.'),
  session('ARC_SER', 'Arc (Start/End/Radius)', 'Draw', 'Arc from start, end, radius.'),
  session('CONTINUE_CURVE', 'Continue Curve', 'Draw', 'Continue the selected arc.'),
  session('BESTFITLINE', 'Best Fit Line', 'Draw', 'Least-squares best-fit line from sample points.', ['BFL']),
  session('BESTFITARC', 'Best Fit Arc', 'Draw', 'Least-squares best-fit arc from sample points.', ['BFA']),
  session('BESTFITPARABOLA', 'Best Fit Parabola', 'Draw', 'Least-squares best-fit parabola from sample points.', ['BFP']),
  session('TANGENT_CURVE', 'Tangent Curve', 'Draw', 'WebNet-native 3-point tangent arc: PI + back-tangent + ahead-tangent + radius. Civil line workflows live on the new Between/On rows.'),
  session('CURVE_BETWEEN_TWO_LINES', 'Curve Between Two Lines', 'Draw', 'Tangent arc between two picked lines; trims both lines to PC/PT.', ['CURVEBETWEENTWOLINES']),
  session('CURVE_ON_TWO_LINES', 'Curve On Two Lines', 'Draw', 'Tangent arc fixed on two picked lines; sources stay unchanged.', ['CURVEONTWOLINES']),
  session('CURVE_THROUGH_POINT', 'Curve Through Point', 'Draw', 'Tangent arc through a picked point; trims both lines.', ['CURVETHROUGHPOINT']),
  session('MULTIPLE_CURVES', 'Multiple Curves', 'Draw', 'Chain of 2-10 tangent curves with one floating curve; sources unchanged.', ['MULTIPLECURVES']),
  session('CURVE_FROM_END', 'Curve From End of Object', 'Draw', 'Point- or radius-mode continuation from a line/arc end; source unchanged.', ['CURVEFROMENDOFOBJECT']),
  session('REVERSE_OR_COMPOUND', 'Reverse or Compound Curve', 'Draw', 'G1 reverse (opposite turn) or compound (same turn) continuation; source unchanged.', ['REVERSEORCOMPOUND']),
  session('BATCH_COGO', 'Batch COGO', 'Draw', 'Create points from a COGO list.'),
  // Modify
  session('MOVE', 'Move', 'Modify', 'Move selected entities.', ['M']),
  session('COPY', 'Copy', 'Modify', 'Copy selected entities.', ['CO']),
  session('ROTATE', 'Rotate', 'Modify', 'Rotate selected entities about a base point.', ['RO']),
  session('SCALE', 'Scale', 'Modify', 'Scale selected entities about a base point.', ['SC']),
  session('MIRROR', 'Mirror', 'Modify', 'Mirror selected entities across an axis.', ['MI']),
  session('ALIGN2D', 'Align 2D', 'Modify', 'Align selected entities from two source points to two target points.'),
  session('HELMERT2D', 'Helmert 2D', 'Modify', 'Least-squares Helmert fit from explicit control pairs (2+).', ['HELMERT']),
  session('GRIDGROUND', 'Grid/Ground', 'Modify', 'Uniform grid/ground scale about an origin by a combined factor.'),
  session(
    'PROJECTTRANSFORM',
    'Project Transform',
    'Modify',
    'Transform the whole drawing: least-squares Helmert or grid/ground scaling.',
    ['SURVEYTRANSFORM', 'PROJECTTRANS'],
  ),
  session('EXTEND', 'Extend', 'Modify', 'Extend to a boundary.', ['EX']),
  session('TRIM', 'Trim', 'Modify', 'Trim at a cutting edge.', ['TR']),
  session('FILLET', 'Fillet', 'Modify', 'Round two lines with an arc.'),
  session('PASTE', 'Paste', 'Modify', 'Paste entities from the clipboard.'),
  // Measure / COGO reports
  session('INVERSE', 'Inverse', 'Measure', 'Bearing and distance between points.'),
  session('MULTI_INVERSE', 'Multi Inverse', 'Measure', 'Inverse across several legs.'),
  session('AREA', 'Area', 'Measure', 'Report polygon area.'),
  session('BEARING_REPORT', 'Bearing Report', 'Measure', 'Report a bearing.'),
  session('DISTANCE_REPORT', 'Distance Report', 'Measure', 'Report a distance.'),
  session('TURNED_POINT', 'Turned Point', 'Measure', 'Point by turned angle.'),
  session('DEFLECT_POINT', 'Deflection Point', 'Measure', 'Point by deflection angle.'),
  session('POINT_ALONG_LINE', 'Point Along Line', 'Measure', 'Point at distance along a line.'),
  session('EXTEND_LINE', 'Extend Line', 'Measure', 'Project a point past a line end.'),
  session('OFFSET_POINT', 'Offset Point', 'Measure', 'Point at an offset.'),
  session('CURVE_SOLVER', 'Curve Solver', 'Measure', 'Solve circular curve parameters.'),
  session('RADIAL_BEARING', 'Radial Bearing', 'Measure', 'Bearing radial to a curve.'),
  session('POINT_ON_CURVE', 'Point on Curve', 'Measure', 'Point at a true distance along/through a curve from its start.'),
  session('SUBDIVIDE_CURVE', 'Subdivide Curve', 'Measure', 'Place marker points along a curve; the arc is never split.'),
  session('OFFSET_CURVE', 'Offset Curve', 'Draw', 'Parallel curve at an offset.'),
  session('PI_CURVE', 'PI Curve', 'Draw', 'Tangent arc at a PI point (radius + delta); the arc does not pass through the PI.'),
  session('CHORD_BEARING_CURVE', 'Chord Bearing Curve', 'Draw', 'Curve from chord bearing.'),
  session('REVERSE_CURVE', 'Reverse Curve', 'Draw', 'Reverse curve from an arc.'),
  session('COMPOUND_CURVE', 'Compound Curve', 'Draw', 'Compound curve from an arc.'),
  session('BEARING_BEARING_INTX', 'Bearing/Bearing Intersection', 'Measure', 'Intersect two bearings.'),
  session('BEARING_DISTANCE_INTX', 'Bearing/Distance Intersection', 'Measure', 'Intersect bearing and distance.'),
  session('DISTANCE_DISTANCE_INTX', 'Distance/Distance Intersection', 'Measure', 'Intersect two distances.'),
  session('LINE_CIRCLE_INTX', 'Line/Circle Intersection', 'Measure', 'Intersect a line and circle.'),
  session('PERP_INTX', 'Perpendicular Intersection', 'Measure', 'Perpendicular foot of a point.'),
  session('OFFSET_INTX', 'Offset Intersection', 'Measure', 'Intersection at an offset.'),
  session('SKEW_INTX', 'Skew Intersection', 'Measure', 'Skew intersection of lines.'),
  session('ALIGNMENT_OFFSET_CREATE', 'Alignment Offset', 'Measure', 'Offset alignment geometry.'),
  session('ALIGNMENT_STATION_EQUATION', 'Station Equation', 'Measure', 'Add a station equation.'),
  session('ALIGNMENT_OFFSET_POINT', 'Alignment Offset Point', 'Measure', 'Point by alignment offset.'),
  session('ALIGNMENT_INTERVAL_POINTS', 'Alignment Interval Points', 'Measure', 'Points at intervals.'),
  // Parcel
  session('PARCEL_SPLIT_BEARING', 'Split by Bearing', 'Parcel', 'Split a parcel by bearing.'),
  session('PARCEL_SPLIT_AREA', 'Split by Area', 'Parcel', 'Split a parcel by target area.'),
  session('PARCELCOURSEARC', 'Set Parcel Course Arc', 'Parcel', 'Adopt a selected arc onto a parcel course.'),
  session('PARCELCOURSELINE', 'Straighten Parcel Course', 'Parcel', 'Retire a parcel arc course to its chord.'),
  // Phase 19A — parcel report/description tables (select a parcel, then pick
  // the table insertion point; one CREATE transaction each).
  session('PARCELTABLE', 'Parcel Table', 'Parcel', 'Create a parcel course table from the selected parcel.', ['PARCELCOURSETABLE']),
  session('PARCELREPORT', 'Parcel Report', 'Parcel', 'Create a parcel summary report table from the selected parcel.', ['PARCELSUMMARYTABLE']),
  session('PARCELDESC', 'Parcel Description', 'Parcel', 'Create a parcel description (course) table from the selected parcel.', ['PARCELDESCRIPTION']),
  // Phase 19D — plan designation + parcel network / shared boundary. These
  // ride the same Home "Parcel" category but the ribbon surfaces them only
  // through the bounded Network subgroup (see CadRibbon). "Plan Role" is
  // user-assigned display metadata, never a legal conclusion.
  session(
    'PARCELDESIGNATE',
    'Designate Parcels',
    'Parcel',
    'Set plan designation / plan role / description on selected parcels (metadata only).',
    ['PARCELDESIG'],
  ),
  session(
    'PARCELNUMBER',
    'Number Parcels',
    'Parcel',
    'Bulk-assign deterministic plan designations to selected parcels.',
    ['PARCELNUM'],
  ),
  session(
    'PARCELLINK',
    'Link Shared Boundary',
    'Parcel',
    'Link two coincident parcel courses as one shared boundary (refs only).',
    ['PARCELSHAREBOUNDARY'],
  ),
  session(
    'PARCELUNLINK',
    'Unlink Shared Boundary',
    'Parcel',
    'Remove a shared-boundary link; parcel geometry is unchanged.',
    ['PARCELSHAREUNLINK'],
  ),
  session(
    'PARCELCHECK',
    'Validate Parcel Network',
    'Parcel',
    'Plan-topology QA: overlaps, unlinked shared courses, broken links (never legal).',
  ),
  session(
    'PARCELSCHEDULE',
    'Parcel Schedule',
    'Parcel',
    'Derive the live parcel schedule (designation, role, area, courses).',
  ),
  session(
    'PARCELSHAREDEDIT',
    'Edit Shared Boundary',
    'Parcel',
    'Edit both sides of a shared boundary in one atomic transaction.',
  ),
  // Edit chrome actions (no aliases; shortcuts mirror the workspace keyboard)
  action('SHELL_UNDO', 'Undo', 'Edit', 'Undo the last change.', 'Ctrl+Z'),
  action('SHELL_REDO', 'Redo', 'Edit', 'Redo the undone change.', 'Ctrl+Y'),
  action('SHELL_SELECT_ALL', 'Select All', 'Edit', 'Select every entity.', 'Ctrl+A'),
  action('SHELL_CLEAR_SELECTION', 'Clear Selection', 'Edit', 'Clear the selection.', 'Esc'),
  action('SHELL_ERASE', 'Erase', 'Edit', 'Delete selected entities.', 'Del'),
  // File chrome actions
  action('SHELL_NEW', 'New Drawing', 'File', 'Start a blank drawing.'),
  action('SHELL_OPEN', 'Open Drawing', 'File', 'Open a WNCAD file.'),
  action('SHELL_SAVE', 'Save Drawing', 'File', 'Save the drawing (WNCAD).', 'Ctrl+S'),
  action('SHELL_EXPORT_CENTER', 'Export Center', 'File', 'Open export and deliverables.'),
  action('SHELL_SHEETS_LAYERS', 'Sheets & Layers', 'File', 'Open sheets, layers, and field-to-finish.'),
  // Phase 18M — LandXML production import entry point (review staged in the
  // workspace; worker 3 owns commit + imported-TIN scheduling). One flat File
  // item; typed LANDXMLIMPORT resolves to the same definition.
  action(
    'SHELL_IMPORT_LANDXML',
    'Import LandXML',
    'File',
    'Import LandXML points, alignments, and TIN surfaces.',
    undefined,
    ['LANDXMLIMPORT'],
  ),
  // Phase 18N — block commands. BLOCK/INSERT open the Block Manager
  // (BLOCK needs a selection for New-from-selection; INSERT arms the
  // pick-point loop); EXPLODE runs on the current selection; BLOCKS
  // opens the manager (typed BLOCKS, aliases mirror command-UI style).
  action('BLOCK', 'Block', 'Draw', 'Create a block from the current selection (Block Manager).', undefined, ['B']),
  action('INSERT', 'Insert', 'Draw', 'Insert a block reference (pick point, repeat on, Esc ends).', undefined, ['I']),
  action('EXPLODE', 'Explode', 'Modify', 'Explode selected block references into plain entities.', undefined, ['X']),
  // Phase 18C — Layer Properties Manager (current-layer dropdown lives in the ribbon Layers group).
  action('LAYER', 'Layers', 'Edit', 'Open the Layer Properties Manager.', undefined),
  action('BLOCKS', 'Block Manager', 'Edit', 'Open the Block Manager (definitions, survey symbols, insert).'),
  // Phase 18F — surface commands (definition edits are undoable SURFACE_*
  // transactions; rebuild runs the session mesh builder; inquiry opens the
  // manager inquiry section). Phase 18H added contour display; phase 18I
  // adds volume commands (manager Calculate/report paths, manual only).
  action('SURFACE', 'Surface', 'Surface', 'Open the surface manager.'),
  action('SURFACEMANAGER', 'Surface Manager', 'Surface', 'Open the surface manager.'),
  action('SURFCREATE', 'Create Surface', 'Surface', 'Create a surface (auto name, current layer).'),
  action('SURFREBUILD', 'Rebuild Surfaces', 'Surface', 'Rebuild every surface needing it.'),
  action('SURFELEV', 'Surface Elevation', 'Surface', 'Query surface elevation (manager inquiry).'),
  // Phase 18S — TIN-topology edit sessions (pick loops over the CURRENT
  // mesh; each commit is one undoable SURFACE_*_EDIT + worker rebuild).
  // SURFEDITS opens the edit history (manager surfaces section).
  action('SURFSWAPEDGE', 'Swap Edge', 'Surface', 'Swap a TIN edge diagonal (repeat picks, Enter/Esc ends).', undefined, ['SWAPEDGE']),
  action('SURFADDLINE', 'Add TIN Line', 'Surface', 'Add a forced TIN line between two vertices (repeat, Enter/Esc ends).', undefined, ['ADDTINLINE']),
  action('SURFDELETELINE', 'Delete Line', 'Surface', 'Delete a TIN edge (repeat picks, Enter/Esc ends).', undefined, ['DELTINLINE']),
  // Phase 18T — surface-local point/elevation edits (pick loops over the
  // CURRENT mesh; each commit is one undoable SURFACE_ADD_EDIT + worker
  // rebuild; Surface-only, survey data never changes).
  action('SURFADDPOINT', 'Add Point', 'Surface', 'Add a surface-only point inside the CURRENT surface (pick XY, type Elevation, Enter commits).', undefined, ['ADDSURFPOINT']),
  action('SURFDELETEPOINT', 'Delete Point', 'Surface', 'Delete a surface-only interior vertex (pick, Enter commits; boundary/constrained block).', undefined, ['DELETESURFPOINT']),
  action('SURFMOVEPOINT', 'Move Point', 'Surface', 'Move a surface-only vertex in XY, Z unchanged (pick vertex + target, Enter commits).', undefined, ['MOVESURFPOINT']),
  action('SURFSETELEV', 'Set Elevation', 'Surface', 'Surface-only elevation override on one vertex (pick, type elevation, Enter commits).', undefined, ['SETELEVSURF']),
  action('SURFRAISELOWER', 'Raise/Lower Surface', 'Surface', 'Shift every surface-only vertex by a delta (type delta, Enter twice confirms).', undefined, ['RAISELOWERSURF']),
  action('SURFEDITS', 'Edit History', 'Surface', 'Open the TIN edit history (surfaces manager).'),
  // Phase 18V — region/point selection + bulk edits (session-UI only; each
  // bulk action commits ONE undoable SURFACE_ADD_EDIT against a fresh
  // revision, zero refs ⇒ no edit/undo entry).
  action('SURFSELECTPOINTS', 'Select Points', 'Surface', 'Select surface points by window/polygon/All/Clear (synthetic vertices excluded).'),
  action('SURFSETELEVMULTI', 'Set Selected Z', 'Surface', 'Set the elevation of every selected point in one undoable edit.'),
  action('SURFRAISELOWERSELECTED', 'Raise/Lower Selected', 'Surface', 'Shift every selected point by a ΔZ in one undoable edit.'),
  action('SURFMOVEPOINTS', 'Move Selected', 'Surface', 'Move every selected point by a base+destination displacement in one undoable edit.'),
  action('SURFSLOPE', 'Surface Slope', 'Surface', 'Query surface slope/aspect (manager inquiry).'),
  action('SURFCONTOURS', 'Surface Contours', 'Surface', 'Edit contour display style (manager contours section).'),
  // Phase 18W — boundary/breakline source editing (manager-first commands;
  // the manager transaction and the command share one undoable engine op).
  action('SURFBREAKLINE', 'Breakline', 'Surface', 'Add a breakline from 2+ survey points in order (manager).'),
  action('SURFBREAKLINEEDIT', 'Edit Breakline', 'Surface', 'Edit a breakline chain (manager).'),
  action('SURFBOUNDARY', 'Boundary', 'Surface', 'Create + attach a boundary ring (manager).', undefined, ['SURFBOUNDARYCREATE']),
  action('SURFBOUNDARYEDIT', 'Edit Boundary', 'Surface', 'Edit boundary vertices (manager).'),
  action('SURFBOUNDARYMAKEINDEPENDENT', 'Make Boundary Independent', 'Surface', 'Copy a boundary source for one surface (manager).'),
  // Phase 18X — explicit bake (SURFACE tab, SEPARATE from the TIN EDIT
  // group). Requires a CURRENT surface + fresh revision, lock-blocked,
  // one undo entry; Bake is in-place, Bake to Copy makes "<Source> - Baked".
  action('SURFBAKE', 'Bake Surface', 'Surface', 'Freeze the current mesh into an explicit TIN on this surface: clears sources/breaklines/boundaries/edits, geometry preserved, Undo restores.', undefined, ['BAKE']),
  action('SURFBAKECOPY', 'Bake to Copy', 'Surface', 'Freeze the current mesh into a new explicit TIN copy ("<Source> - Baked"). Source unchanged.', undefined, ['BAKECOPY']),
  // Phase 18Y — exact two-surface composition (sibling of the 18X bake
  // group; needs two CURRENT surfaces and opens the manager Compose dialog).
  action('SURFCOMPOSE', 'Compose Surface', 'Surface', 'Compose two surfaces into one explicit TIN (manager): composite copy or paste the overlay into the target in place.', undefined, ['COMPOSE']),
  action('SURFCOMPOSECOPY', 'Compose to Copy', 'Surface', 'Create a new explicit-TIN surface from a Base + Overlay (manager dialog; neither source changes).'),
  action('SURFPASTE', 'Paste Into Surface', 'Surface', 'Paste an Overlay into a Target in place (manager dialog; target definition replaced, source unchanged).', undefined, ['SURFCOMPOSEPASTE']),
  // Phase 20D — design workflow (manager-first routing like SURFBAKE/
  // SURFCOMPOSE: the manager Design Workflow section owns the arguments;
  // typed keys resolve here but never execute inline. No aliases: every
  // short token collides with an existing alias family, so none is added.)
  action('DESIGNSURFACE', 'Create Design Copy', 'Surface', 'Copy a CURRENT surface into a new Design-role surface (explicit TIN snapshot; source unchanged; manager workflow).'),
  action('DESIGNPATCH', 'Build Design Patch', 'Surface', 'Build a Design Patch surface from a CURRENT closed flat grading group (pad interior + grading shell; manager workflow).'),
  action('DESIGNAPPLY', 'Apply Patch', 'Surface', 'Apply a Design Patch onto a Design target in place (Existing Ground targets stay blocked; manager workflow).'),
  action('DESIGNVOLUME', 'Earthwork Volume', 'Surface', 'Track an Existing-Ground vs Design volume (find-or-create; Calculate stays explicit; manager workflow).'),
  action('SURFPURPOSE', 'Set Surface Purpose', 'Surface', 'Set the workflow role on a surface (Existing Ground / Design / Design Patch / Reference; metadata only; manager).'),
  // Phase 18I — volume commands (all route through the surface manager;
  // Calculate runs the session volume service for the selected volume,
  // never auto-started, LOCK-gated by the volume transaction path).
  action('SURFVOLUME', 'Create Volume', 'Surface', 'Create a TIN-to-TIN volume surface (manager).'),
  action('SURFVOLCALC', 'Calculate Volume', 'Surface', 'Calculate volumes for the selected volume (both sources must be Current).'),
  action('SURFDIFF', 'Surface Difference', 'Surface', 'Query base/comparison elevations + CUT/FILL verdict (manager).'),
  action('SURFVOLREPORT', 'Volume Report', 'Surface', 'Download the Volume Summary CSV (Current volumes only, manager).'),
  // Phase 18U — analysis maps + legends. Every entry routes through the
  // surface manager's ANALYSIS section; the shell paths share this registry
  // (ribbon ANALYSIS/VOLUME groups + Analysis Legend on the SURFACE tab).
  action('SURFELEVANALYSIS', 'New Elevation Analysis', 'Surface', 'Create an elevation-band analysis on the selected surface (5 equal bands).', undefined, ['ELEVANALYSIS']),
  action('SURFSLOPEANALYSIS', 'New Slope Analysis', 'Surface', 'Create a slope-band analysis on the selected surface (5 equal bands).', undefined, ['SLOPEANALYSIS']),
  action('VOLUMEDEPTHANALYSIS', 'New Depth Analysis', 'Surface', 'Create a signed-depth analysis on the selected volume surface.', undefined, ['DEPTHANALYSIS']),
  action('SURFANALYSIS', 'Analysis Manager', 'Surface', 'Open the analysis manager (rows, ranges, calculate, delete).', undefined, ['ANALYSISMANAGER']),
  action('SURFANALYSISINQUIRY', 'Analysis Inquiry', 'Surface', 'Query the exact metric + band at a plan point (manager inquiry).', undefined, ['ANALYSISINQUIRY']),
  action('SURFANALYSISLEGEND', 'Analysis Legend', 'Surface', 'Create a legend for the selected analysis (rows read from the map at render time).', undefined, ['ANALYSISLEGEND']),
  // Phase 18J — profile commands (all route through the profile manager;
  // Rebuild runs the session profile service for the selected profile).
  action('PROFILE', 'Profile', 'Surface', 'Open the surface profile manager.'),
  action('PROFILEMANAGER', 'Profile Manager', 'Surface', 'Open the surface profile manager.'),
  action('PROFILECREATE', 'Create Surface Profile', 'Surface', 'Create a surface profile from an alignment + surface (manager).'),
  action('PROFILEVIEW', 'Create Profile View', 'Surface', 'Create a profile view from the selected profile.'),
  action('PROFILEELEV', 'Profile Elevation', 'Surface', 'Query profile elevation at a station (manager).'),
  action('PROFILEREBUILD', 'Rebuild Profile', 'Surface', 'Rebuild the selected surface profile (manual).'),
  action('PROFILESTYLE', 'Profile Styles', 'Surface', 'Edit profile display styles (manager).'),
  // Phase 18K — section commands (all route through the sample-line
  // manager; Rebuild runs the session section service for the selected
  // group, never auto-started).
  action('SAMPLELINES', 'Sample Lines', 'Surface', 'Open the sample-line manager.'),
  action('SAMPLELINE', 'Add Sample Line', 'Surface', 'Add a sample line at a station (manager).'),
  action('SECTIONREBUILD', 'Rebuild Sections', 'Surface', 'Rebuild sections for the selected group (manual).'),
  action('SECTIONVIEW', 'Create Section Views', 'Surface', 'Batch-create section views for the selected group.'),
  action('SECTIONELEV', 'Section Elevation', 'Surface', 'Query section elevation at an offset (manager).'),
  // Phase 18O annotation commands (skills share the CREATE_*/SET_* engine keys;
  // TEXT aliases MText, MLEADER is an honest single-leader alias of Leader).
  annotation('MTEXT', 'Multiline Text', 'Create multiline text.', ['TEXT', 'MT']),
  annotation('LEADER', 'Leader', 'Create a leader with an arrowhead.', ['MLEADER', 'LE']),
  annotation('DIM', 'Dimension', 'Create a dimension.'),
  annotation('DIMLINEAR', 'Linear Dimension', 'Create a linear dimension.', ['DLI']),
  annotation('DIMALIGNED', 'Aligned Dimension', 'Create an aligned dimension.', ['DAL']),
  annotation('DIMANGULAR', 'Angular Dimension', 'Create an angular dimension.', ['DAN']),
  annotation('DIMRADIUS', 'Radius Dimension', 'Create a radius dimension.', ['DRA']),
  annotation('DIMDIAMETER', 'Diameter Dimension', 'Create a diameter dimension.', ['DDI']),
  annotation('BDLABEL', 'Bearing/Distance Label', 'Create a bearing/distance label.', ['BD']),
  annotation('CURVELABEL', 'Curve Label', 'Create a curve label.', ['CL']),
  annotation('TEXTSTYLE', 'Text Styles', 'Edit annotation text styles.', ['STYLE']),
  annotation('DIMSTYLE', 'Dimension Styles', 'Edit dimension styles.'),
  annotation('LEADERSTYLE', 'Leader Styles', 'Edit leader styles.'),
  annotation('SURVEYLABELSTYLE', 'Survey Label Styles', 'Edit bearing and curve label styles.', ['SLS']),
  // Phase 19A — TABLES group creation commands + style manager entry.
  annotation('LINETABLE', 'Line Table', 'Create a line annotation table from the selected lines (pick insertion).', ['LT']),
  annotation('CURVETABLE', 'Curve Table', 'Create a curve annotation table from the selected arcs (pick insertion).', ['CT']),
  annotation('POINTTABLE', 'Point Table', 'Create a point table from the selection (else Station ID order).', ['PT']),
  action('TABLESTYLE', 'Survey Table Styles', 'Annotate', 'Edit survey table styles (rows, padding, borders, text).', undefined, ['TABLESTYLES']),
  // Phase 20A — 3D feature lines (bounded DESIGN/FEATURE LINE ribbon group).
  // Every entry dispatches an undoable engine command through
  // actions.runFeatureLineCommand; prompts supply the numeric input the
  // ribbon cannot collect inline. Both faces of the surface method are
  // vertex-only (no drape/tessellation).
  action('FEATURELINECREATE', 'Create Feature Line', 'Design', 'Create a feature line from the current selection (ordered survey points snapshot, or a connected Line/Polyline/Arc chain copied exactly); prompts for a constant elevation.', undefined, ['FL']),
  action('FLSETZ', 'Set Elevations', 'Design', 'Set every vertex of the selected feature line to one absolute elevation (Z only, XY unchanged).', undefined, ['FEATURELINEELEV']),
  action('FLGRADE', 'Set Grade', 'Design', 'Grade the selected feature line over its full span (grade-all-intermediates, negative percent falls).'),
  action('FLRAISELOWER', 'Raise/Lower', 'Design', 'Raise or lower every vertex of the selected feature line by a signed delta.'),
  action('FLINTERPOLATE', 'Interpolate', 'Design', 'Fix the endpoints and interpolate intermediates by cumulative plan station.', undefined, ['FLINTERP']),
  action('FLSURFACEELEV', 'Set Vertices from Surface', 'Design', 'Set each vertex elevation from the CURRENT surface at its XY (vertex-only; off-surface vertices block the commit; no continuous drape).'),
  action('FLINQUIRY', 'Feature Line Inquiry', 'Design', 'Report start/end station, plan/3D length, ΔZ, grade, slope angle, bearing, and curve metrics for the selected feature line.', undefined, ['FLINQ']),
  action('FLINSERTVERTEX', 'Insert Vertex', 'Design', 'Insert a vertex on the selected feature line at an entered course and station (rides the course exactly; ambiguous geometry fails closed).', undefined, ['FLINSERT']),
  action('FLDELETEVERTEX', 'Delete Vertex', 'Design', 'Delete a vertex of the selected feature line (line+line joins straight; ambiguous arc joins blocked).', undefined, ['FLDELVERT']),
  action('SURFACE_ADDFEATURELINEBREAKLINE', 'Add Feature Line Breakline', 'Design', 'Add the selected feature line as an entity-backed surface breakline (its own vertex Z is consumed by the build).', undefined, ['SURFAFLBREAKLINE']),
  // Phase 20B — Grade-to-Surface / daylight grading (bounded DESIGN group).
  // GRADETOSURFACE runs the selection-driven creation prompts
  // (`actions.runGradingCommand`); the rest open the manager or fire the
  // explicit Calculate / Extract / Bake actions. GTS alias is collision-free.
  action('GRADETOSURFACE', 'Grade to Surface', 'Design', 'Grade a feature-line course to a CURRENT target surface (pick course, side, criterion, max distance, curve tolerance).', undefined, ['GTS']),
  // Phase 20F — analytic termination: signed grade to a target distance or
  // elevation. No target surface is ever requested. GTD/GTE collision-free.
  action('GRADETODISTANCE', 'Grade to Distance', 'Design', 'Grade a feature-line course at a signed grade for a target horizontal distance (manager create form; no target surface).', undefined, ['GTD']),
  action('GRADETOELEVATION', 'Grade to Elevation', 'Design', 'Grade a feature-line course at a signed grade to a target elevation (manager create form; no target surface).', undefined, ['GTE']),
  action('GRADETORELATIVEELEVATION', 'Grade to Relative Elevation', 'Design', 'Grade a feature-line course at a signed grade to a signed relative elevation offset from the source profile (manager create form; no target surface).', undefined, ['GTRE']),
  action('GRADING', 'Grading Manager', 'Design', 'Open the grading manager (rows, create, calculate, inquiry).'),
  action('GRADINGCALC', 'Calculate Grading', 'Design', 'Build the selected grading result (both sources must be Current; explicit, never auto-started).'),
  action('GRADINGINQUIRY', 'Grading Inquiry', 'Design', 'Open the grading inquiry report (CURRENT only; stale answers honestly).', undefined, ['GRADINGINQ']),
  action('GRADINGEXTRACTDAYLIGHT', 'Extract Daylight', 'Design', 'Create a snapshot feature line from the CURRENT daylight tie line (one undo entry; no live dependency).', undefined, ['EXTRACTDAYLIGHT']),
  action('GRADINGBAKE', 'Bake Grading Surface', 'Design', 'Freeze the CURRENT grading mesh into an explicit-TIN surface (nonzero area; one undo entry).'),
  // Phase 20C — grading groups (bounded DESIGN group; explicit args only,
  // the interactive pick-flow belongs to the UI wave). GG alias is collision-free.
  action('GRADEGROUP', 'Grade Group', 'Design', 'Create a grading group from explicit courses against a CURRENT target surface (single side, shared criterion).', undefined, ['GG']),
  action('GRADINGGROUP', 'Grading Group Manager', 'Design', 'Open the grading-group manager (rows, create, calculate, inquiry).'),
  action('GRADINGGROUPCALC', 'Calculate Grading Group', 'Design', 'Build the selected grading-group result (explicit, never auto-started).'),
  action('GRADINGGROUPINQUIRY', 'Grading Group Inquiry', 'Design', 'Open the grading-group inquiry report (CURRENT only; stale answers honestly).', undefined, ['GRADINGGROUPINQ']),
  action('GRADINGGROUPCRITERIA', 'Grading Group Criteria', 'Design', 'Edit per-course grading criteria for the selected group (manager criteria editor).', undefined, ['GGCRITERIA']),
  action('GRADINGGROUPEXTRACTDAYLIGHT', 'Extract Group Daylight', 'Design', 'Create a snapshot feature line from the CURRENT group daylight boundary (one undo entry; no live dependency).', undefined, ['GROUPEXTRACTDAYLIGHT']),
  action('GRADINGGROUPBAKE', 'Bake Grading Group Surface', 'Design', 'Freeze the CURRENT group mesh into an explicit-TIN surface (nonzero area; one undo entry).'),
];

const COMMAND_BY_KEY = new Map<string, CadShellCommandDef>(
  CAD_SHELL_COMMANDS.map((def) => [def.key, def]),
);

const ALIAS_TO_KEY = new Map<string, string>();
for (const def of CAD_SHELL_COMMANDS) {
  for (const alias of def.aliases) ALIAS_TO_KEY.set(alias.toUpperCase(), def.key);
}

/** Resolve typed text to a command: exact key first, then alias (case-insensitive). */
export const resolveShellCommandText = (text: string): CadShellCommandDef | null => {
  const token = text.trim().toUpperCase();
  if (token.length === 0) return null;
  const direct = COMMAND_BY_KEY.get(token);
  if (direct) return direct;
  const aliased = ALIAS_TO_KEY.get(token);
  return aliased != null ? (COMMAND_BY_KEY.get(aliased) ?? null) : null;
};

/**
 * Autocomplete match class, best (0) to worst (4): 0 exact key, 1 exact alias,
 * 2 key prefix, 3 alias prefix, 4 fuzzy substring (the label fallback).
 */
const autocompleteMatchClass = (def: CadShellCommandDef, token: string): number => {
  const key = def.key.toUpperCase();
  const aliases = def.aliases.map((alias) => alias.toUpperCase());
  if (key === token) return 0;
  if (aliases.includes(token)) return 1;
  if (key.startsWith(token)) return 2;
  if (aliases.some((alias) => alias.startsWith(token))) return 3;
  return 4;
};

/**
 * Prefix matches across names + keys + aliases for dock autocomplete.
 *
 * Deterministic ranking law (CAD Draw Phase L1): matches are grouped into
 * specificity tiers (exact key / exact alias / key prefix / alias prefix /
 * fuzzy substring) and each tier is ordered shortest key first. The tiers are
 * then interleaved round-robin so a single long key family — e.g. the 17
 * `LINE*` rows added by Phase L1 — cannot monopolize the bounded result set
 * and crowd out short legacy matches such as `PLINE` for the query `L`. An
 * empty token keeps plain registry order.
 */
export const autocompleteShellCommands = (
  prefix: string,
  availableKeys: ReadonlySet<string> | null,
  limit = 8,
): CadShellCommandDef[] => {
  const token = prefix.trim().toUpperCase();
  const matches = CAD_SHELL_COMMANDS.filter((def) => {
    if (def.kind !== 'session') return false;
    if (availableKeys && !availableKeys.has(def.key)) return false;
    if (token.length === 0) return true;
    return (
      def.key.startsWith(token) ||
      def.label.toUpperCase().includes(token) ||
      def.aliases.some((alias) => alias.startsWith(token))
    );
  });
  if (token.length === 0) return matches.slice(0, limit);
  const tiers: CadShellCommandDef[][] = [[], [], [], [], []];
  for (const def of matches) tiers[autocompleteMatchClass(def, token)]!.push(def);
  // Explicit `Array.prototype.sort` is stable, so equal-length keys keep
  // registry order within a tier.
  for (const tier of tiers) tier.sort((a, b) => a.key.length - b.key.length);
  const ranked: CadShellCommandDef[] = [];
  for (let pass = 0; ranked.length < limit; pass += 1) {
    let advanced = false;
    for (const tier of tiers) {
      if (pass >= tier.length) continue;
      ranked.push(tier[pass]!);
      advanced = true;
      if (ranked.length >= limit) break;
    }
    if (!advanced) break;
  }
  return ranked;
};

/** True when the live workspace can run this definition right now. */
export const isShellCommandAvailable = (
  def: CadShellCommandDef,
  snapshot: CadWorkspaceSnapshot | null,
  actions: CadShellActions | null,
): boolean => {
  if (!snapshot || !actions) return false;
  if (def.kind === 'action') {
    if (FEATURE_LINE_SHELL_KEYS.has(def.key)) return featureLineShellAvailable(def.key, snapshot);
    if (GRADING_SHELL_KEYS.has(def.key)) {
      return actions.runGradingCommand != null && gradingShellAvailable(def.key, snapshot);
    }
    if (GRADINGGROUP_SHELL_KEYS.has(def.key)) {
      // Phase 20F.3 — forward the snapshot so selection-driven group keys
      // gate on the resolved selected row (never action-presence alone).
      return actions.runGradingGroupCommand != null && gradingGroupShellAvailable(def.key, actions, snapshot);
    }
    switch (def.key) {
      case 'SHELL_UNDO':
        return snapshot.canUndo;
      case 'SHELL_REDO':
        return snapshot.canRedo;
      case 'SHELL_ERASE':
        return snapshot.selectionCount > 0;
      case 'EXPLODE':
        return snapshot.selectionCount > 0;
      case 'SHELL_IMPORT_LANDXML':
        // Live workspace present (guard above) — the file picker is always available.
        return true;
      case 'SURFBAKE':
      case 'SURFBAKECOPY': {
        // CURRENT only: BUILDING/UNBUILT/NEEDS_REBUILD/FAILED all disable.
        const surfaceId = resolveDefinitionSurfaceId(snapshot);
        const row = surfaceId
          ? snapshot.surface?.surfaces.find((entry) => entry.id === surfaceId) ?? null
          : null;
        return row?.status === 'CURRENT';
      }
      case 'SURFCOMPOSE':
        // Dialog opener: always available with a live workspace.
        return true;
      case 'DESIGNSURFACE':
      case 'DESIGNPATCH':
      case 'DESIGNAPPLY':
      case 'DESIGNVOLUME':
      case 'SURFPURPOSE':
        // Phase 20D — manager-first workflow openers: live workspace only.
        return true;
      case 'SURFCOMPOSECOPY':
      case 'SURFPASTE':
        return surfaceComposeCapability(snapshot.surface?.surfaces ?? []).canCompose;
      default:
        return true;
    }
  }
  return snapshot.availableCommands.includes(def.key);
};

/** Route one definition to existing workspace machinery. False = not started. */
export const executeShellCommand = (
  def: CadShellCommandDef,
  actions: CadShellActions | null,
  snapshot?: CadWorkspaceSnapshot | null,
): boolean => {
  if (!actions) return false;
  if (def.kind === 'session') return actions.startCommand(def.key as ActiveCommandKey);
  if (FEATURE_LINE_SHELL_KEYS.has(def.key)) return executeFeatureLineShellCommand(def.key, actions, snapshot);
  if (GRADING_SHELL_KEYS.has(def.key)) return executeGradingShellCommand(def.key, actions, snapshot);
  if (GRADINGGROUP_SHELL_KEYS.has(def.key)) {
    // Phase 20F.3 — forward the snapshot (selection-driven dispatch).
    // The registry path carries no explicit options: explicit group targeting
    // belongs to direct adapter callers, which the adapter covers.
    return executeGradingGroupShellCommand(def.key, actions, snapshot);
  }
  switch (def.key) {
    case 'SHELL_UNDO':
      actions.undo();
      return true;
    case 'SHELL_REDO':
      actions.redo();
      return true;
    case 'SHELL_SELECT_ALL':
      actions.selectAll();
      return true;
    case 'SHELL_CLEAR_SELECTION':
      actions.clearSelection();
      return true;
    case 'SHELL_ERASE':
      actions.eraseSelection();
      return true;
    case 'SHELL_NEW':
      actions.newDrawing();
      return true;
    case 'SHELL_OPEN':
      actions.openDrawingFile();
      return true;
    case 'SHELL_SAVE':
      actions.saveDrawing();
      return true;
    case 'SHELL_EXPORT_CENTER':
      actions.toggleExportCenter();
      return true;
    case 'SHELL_SHEETS_LAYERS':
      actions.toggleDraftingPanel();
      return true;
    case 'SHELL_IMPORT_LANDXML':
      actions.requestLandXmlImport();
      return true;
    case 'LAYER':
      actions.openLayerManager();
      return true;
    case 'BLOCK':
      actions.openBlockManager?.('blocks');
      return actions.openBlockManager != null;
    case 'INSERT':
      actions.openBlockManager?.('insert');
      return actions.openBlockManager != null;
    case 'BLOCKS':
      actions.openBlockManager?.('blocks');
      return actions.openBlockManager != null;
    case 'EXPLODE':
      actions.explodeSelectedBlocks?.();
      return actions.explodeSelectedBlocks != null;
    case 'SURFACE':
    case 'SURFACEMANAGER':
      actions.openSurveyManager('surfaces');
      return true;
    case 'SURFCREATE':
      try {
        return actions.runSurveyCommand({ key: 'SURFACE_CREATE' });
      } catch {
        return false;
      }
    case 'SURFREBUILD':
      actions.rebuildAllSurfaces();
      return true;
    case 'SURFELEV':
    case 'SURFSLOPE':
    case 'SURFCONTOURS':
      actions.openSurveyManager('surfaces');
      return true;
    case 'SURFBREAKLINE':
      return focusSurfaceDefinition(actions, snapshot, 'breaklines', '__create');
    case 'SURFBREAKLINEEDIT':
      return focusSurfaceDefinition(actions, snapshot, 'breaklines', resolveBreaklineFocus(actions, snapshot));
    case 'SURFBOUNDARY':
      return focusSurfaceDefinition(actions, snapshot, 'boundaries', '__create');
    case 'SURFBOUNDARYEDIT':
      return focusSurfaceDefinition(actions, snapshot, 'boundaries', resolveBoundaryFocus(snapshot));
    case 'SURFBOUNDARYMAKEINDEPENDENT':
      return makeBoundaryIndependent(actions, snapshot);
    case 'SURFCOMPOSE':
    case 'SURFCOMPOSECOPY':
    case 'SURFPASTE': {
      requestSurfaceComposeFocus(def.key === 'SURFPASTE' ? 'paste' : 'copy');
      actions.openSurveyManager('surfaces', resolveDefinitionSurfaceId(snapshot) ?? undefined);
      return true;
    }
    case 'DESIGNSURFACE':
    case 'DESIGNPATCH':
    case 'DESIGNAPPLY':
    case 'DESIGNVOLUME':
    case 'SURFPURPOSE':
      // Phase 20D — manager-first like SURFBAKE/SURFCOMPOSE: the Design
      // Workflow section owns the arguments; never fake execution here.
      actions.openSurveyManager('surfaces', resolveDefinitionSurfaceId(snapshot) ?? undefined);
      return true;
    case 'SURFBAKE':
    case 'SURFBAKECOPY': {
      const surfaceId = resolveDefinitionSurfaceId(snapshot);
      const row = surfaceId
        ? snapshot?.surface?.surfaces.find((entry) => entry.id === surfaceId) ?? null
        : null;
      if (!surfaceId || !row) {
        actions.openSurveyManager('surfaces');
        return true;
      }
      if (row.status !== 'CURRENT') {
        actions.openSurveyManager('surfaces', surfaceId);
        return true;
      }
      try {
        return actions.runSurveyCommand({
          key: def.key === 'SURFBAKE' ? 'SURFBAKE' : 'SURFBAKECOPY',
          surfaceId,
          expectedRevision: row.revision,
          // Session TIN currency (the project never persists cachedRevision).
          sessionCurrent: true,
        });
      } catch {
        return false;
      }
    }
    case 'SURFSWAPEDGE':
      return actions.startSurfaceEditSession?.('swap') ?? false;
    case 'SURFADDLINE':
      return actions.startSurfaceEditSession?.('add-line') ?? false;
    case 'SURFDELETELINE':
      return actions.startSurfaceEditSession?.('delete-line') ?? false;
    case 'SURFADDPOINT':
      return actions.startSurfaceEditSession?.('add-point') ?? false;
    case 'SURFDELETEPOINT':
      return actions.startSurfaceEditSession?.('delete-point') ?? false;
    case 'SURFMOVEPOINT':
      return actions.startSurfaceEditSession?.('move-point') ?? false;
    case 'SURFSETELEV':
      return actions.startSurfaceEditSession?.('set-elevation') ?? false;
    case 'SURFRAISELOWER':
      return actions.startSurfaceEditSession?.('raise-lower') ?? false;
    case 'SURFSELECTPOINTS':
      return actions.selectSurfacePoints?.('window') ?? false;
    case 'SURFSETELEVMULTI':
      return actions.startSurfaceBulkEditSession?.('set-elevation') ?? false;
    case 'SURFRAISELOWERSELECTED':
      return actions.startSurfaceBulkEditSession?.('raise-lower') ?? false;
    case 'SURFMOVEPOINTS':
      return actions.startSurfaceBulkEditSession?.('move') ?? false;
    case 'SURFEDITS':
      actions.openSurveyManager('surfaces');
      return true;
    case 'SURFVOLUME':
    case 'SURFDIFF':
    case 'SURFVOLREPORT':
      actions.openSurveyManager('surfaces');
      return true;
    case 'SURFVOLCALC':
      actions.calculateSelectedVolume();
      return true;
    case 'SURFELEVANALYSIS':
      return actions.createAnalysis?.('elevation') != null;
    case 'SURFSLOPEANALYSIS':
      return actions.createAnalysis?.('slope-percent') != null;
    case 'VOLUMEDEPTHANALYSIS':
      return actions.createAnalysis?.('signed-depth') != null;
    case 'SURFANALYSIS':
    case 'SURFANALYSISINQUIRY':
    case 'SURFANALYSISLEGEND':
      actions.openSurveyManager('surfaces');
      return true;
    case 'PROFILE':
    case 'PROFILEMANAGER':
    case 'PROFILECREATE':
    case 'PROFILEELEV':
    case 'PROFILESTYLE':
    case 'PROFILEREBUILD':
      actions.openSurveyManager('profiles');
      return true;
    case 'PROFILEVIEW':
      actions.createProfileView();
      return true;
    case 'SAMPLELINES':
    case 'SAMPLELINE':
    case 'SECTIONELEV':
    case 'SECTIONVIEW':
    case 'SECTIONREBUILD':
      actions.openSurveyManager('sections');
      return true;
    case 'TABLESTYLE':
      if (actions.openSurveyTableManager == null) return false;
      actions.openSurveyTableManager();
      return true;
    default:
      return false;
  }
};
