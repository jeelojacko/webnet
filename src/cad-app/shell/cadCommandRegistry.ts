import type { ActiveCommandKey } from '../../hooks/surveyCad/useSurveyCadCommandTypes';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';

export type CadShellCommandCategory =
  | 'Draw'
  | 'Modify'
  | 'Measure'
  | 'Parcel'
  | 'Edit'
  | 'File'
  | 'Surface';

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
  key: ActiveCommandKey,
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
): CadShellCommandDef => ({ key, label, aliases: [], category, hint, shortcut, kind: 'action' });

export const CAD_SHELL_COMMANDS: CadShellCommandDef[] = [
  // Draw
  session('POINT', 'Point', 'Draw', 'Place a survey point.'),
  session('COGO_POINT', 'COGO Point', 'Draw', 'Place a point by coordinates.'),
  session('LINE', 'Line', 'Draw', 'Draw a line segment.', ['L']),
  session('PLINE', 'Polyline', 'Draw', 'Draw a connected polyline.', ['PL']),
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
  session('TANGENT_CURVE', 'Tangent Curve', 'Draw', 'Tangent curve from selected line.'),
  session('BATCH_COGO', 'Batch COGO', 'Draw', 'Create points from a COGO list.'),
  // Modify
  session('MOVE', 'Move', 'Modify', 'Move selected entities.', ['M']),
  session('COPY', 'Copy', 'Modify', 'Copy selected entities.', ['CO']),
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
  session('POINT_ON_CURVE', 'Point on Curve', 'Measure', 'Point at station on a curve.'),
  session('SUBDIVIDE_CURVE', 'Subdivide Curve', 'Measure', 'Split a curve into parts.'),
  session('OFFSET_CURVE', 'Offset Curve', 'Measure', 'Parallel curve at an offset.'),
  session('PI_CURVE', 'PI Curve', 'Measure', 'Curve through a PI point.'),
  session('CHORD_BEARING_CURVE', 'Chord Bearing Curve', 'Measure', 'Curve from chord bearing.'),
  session('REVERSE_CURVE', 'Reverse Curve', 'Measure', 'Reverse curve from an arc.'),
  session('COMPOUND_CURVE', 'Compound Curve', 'Measure', 'Compound curve from an arc.'),
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
  // Phase 18C — Layer Properties Manager (current-layer dropdown lives in the ribbon Layers group).
  action('LAYER', 'Layers', 'Edit', 'Open the Layer Properties Manager.', undefined),
  // Phase 18F — surface commands (definition edits are undoable SURFACE_*
  // transactions; rebuild runs the session mesh builder; inquiry opens the
  // manager inquiry section). No contour/volume commands in 18F.
  action('SURFACE', 'Surface', 'Surface', 'Open the surface manager.'),
  action('SURFACEMANAGER', 'Surface Manager', 'Surface', 'Open the surface manager.'),
  action('SURFCREATE', 'Create Surface', 'Surface', 'Create a surface (auto name, current layer).'),
  action('SURFREBUILD', 'Rebuild Surfaces', 'Surface', 'Rebuild every surface needing it.'),
  action('SURFELEV', 'Surface Elevation', 'Surface', 'Query surface elevation (manager inquiry).'),
  action('SURFSLOPE', 'Surface Slope', 'Surface', 'Query surface slope/aspect (manager inquiry).'),
  action('SURFCONTOURS', 'Surface Contours', 'Surface', 'Edit contour display style (manager contours section).'),
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

/** Prefix matches across names + keys + aliases for dock autocomplete. Deterministic order. */
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
  return matches.slice(0, limit);
};

/** True when the live workspace can run this definition right now. */
export const isShellCommandAvailable = (
  def: CadShellCommandDef,
  snapshot: CadWorkspaceSnapshot | null,
  actions: CadShellActions | null,
): boolean => {
  if (!snapshot || !actions) return false;
  if (def.kind === 'action') {
    switch (def.key) {
      case 'SHELL_UNDO':
        return snapshot.canUndo;
      case 'SHELL_REDO':
        return snapshot.canRedo;
      case 'SHELL_ERASE':
        return snapshot.selectionCount > 0;
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
): boolean => {
  if (!actions) return false;
  if (def.kind === 'session') return actions.startCommand(def.key as ActiveCommandKey);
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
    case 'LAYER':
      actions.openLayerManager();
      return true;
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
    default:
      return false;
  }
};
