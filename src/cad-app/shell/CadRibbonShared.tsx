/* eslint-disable react-refresh/only-export-components -- shared ribbon chrome: group wrapper + registry icon helpers by design */
// Phase 21A Wave 2 — shared ribbon chrome for the icon regroup.
//
// RibbonGroup renders the buttons first and the caption second; CSS order
// pins the caption to the bottom of the one compact band. RegistryIconButton
// is the only per-command button here: icon-first face (short 1-2 word
// caption), full label + aliases in the tooltip/aria, dispatch ONLY through
// executeShellCommand/isShellCommandAvailable — no parallel wiring.
//
// Icon gaps (no truthful curated asset in cadRibbonIcons.ts) render a short
// text face: icon is optional in COMMAND_ICONS, never a placeholder emoji or
// a wrong-meaning glyph. Planned/no-icon families (ellipse, shapes,
// hatch primaries) likewise keep a text face per the sibling manifest
// fallback policy (icon field omitted where no truthful asset exists).
import React from 'react';
import {
  executeShellCommand,
  isShellCommandAvailable,
  resolveShellCommandText,
  type CadShellCommandDef,
} from './cadCommandRegistry';
import { CadRibbonIconButton } from './CadRibbonIconButton';
import type { CadRibbonIconId } from '../assets/icons/cadRibbonIcons';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';

export interface RibbonGroupProps {
  label: string;
  children: React.ReactNode;
}

/** Buttons first, caption last — CSS pins the caption to the band bottom. */
export const RibbonGroup: React.FC<RibbonGroupProps> = ({ label, children }) => (
  <div className="cad-shell-ribbon-group" aria-label={label}>
    <div className="cad-shell-ribbon-buttons">{children}</div>
    <span className="cad-shell-ribbon-group-label">{label}</span>
  </div>
);

/** Truthful icon per command key; absent = short text face (never a guess). */
const COMMAND_ICONS: Partial<Record<string, CadRibbonIconId>> = {
  COGO_POINT: 'draw-point',
  POINT: 'draw-point',
  PLINE: 'draw-polyline',
  BLOCK: 'block',
  INSERT: 'block-insert-dwg',
  MOVE: 'modify-move',
  COPY: 'modify-copy',
  ROTATE: 'modify-rotate',
  SCALE: 'modify-scale',
  MIRROR: 'modify-mirror',
  TRIM: 'modify-trim',
  EXTEND: 'modify-extend',
  FILLET: 'modify-fillet',
  EXPLODE: 'modify-explode',
  ALIGN2D: 'align-3d',
  SHELL_UNDO: 'edit-undo',
  SHELL_REDO: 'edit-redo',
  SHELL_ERASE: 'modify-erase',
  LAYER: 'layers',
  BLOCKS: 'block',
  SHELL_NEW: 'file-new',
  SHELL_OPEN: 'file-open',
  SHELL_SAVE: 'file-save',
  MTEXT: 'text-multiline',
  TEXTSTYLE: 'text-style',
  LEADER: 'leader-quick',
  DIMLINEAR: 'dim-linear',
  DIMALIGNED: 'dim-aligned',
  DIMANGULAR: 'dim-angular',
  DIMRADIUS: 'dim-radius',
  DIMDIAMETER: 'dim-diameter',
  DIMSTYLE: 'dim-style',
  LINETABLE: 'table',
  CURVETABLE: 'table',
  PARCELTABLE: 'table',
  POINTTABLE: 'table',
  TABLESTYLE: 'table-style',
  PARCELCOURSEARC: 'parcel-segments-edit',
  PARCELCOURSELINE: 'parcel-segments-edit',
  PARCELREPORT: 'table',
  PARCELDESC: 'table',
  SHELL_IMPORT_LANDXML: 'landxml-import',
};

/** 1-2 word icon faces; full labels live in flyouts/tooltips/aria. */
const COMMAND_SHORT_LABELS: Partial<Record<string, string>> = {
  COGO_POINT: 'Point',
  TRAVERSE: 'Traverse',
  BLOCK: 'Block',
  INSERT: 'Insert',
  PASTE: 'Paste',
  ALIGN2D: 'Align',
  HELMERT2D: 'Helmert',
  GRIDGROUND: 'Grid',
  PROJECTTRANSFORM: 'Project',
  SHELL_UNDO: 'Undo',
  SHELL_REDO: 'Redo',
  SHELL_SELECT_ALL: 'Select',
  SHELL_CLEAR_SELECTION: 'Clear',
  SHELL_ERASE: 'Erase',
  LAYER: 'Layers',
  BLOCKS: 'Blocks',
  SHELL_NEW: 'New',
  SHELL_OPEN: 'Open',
  SHELL_SAVE: 'Save',
  SHELL_EXPORT_CENTER: 'Export',
  SHELL_SHEETS_LAYERS: 'Sheets',
  SHELL_IMPORT_LANDXML: 'Import',
  MTEXT: 'Text',
  LEADER: 'Leader',
  DIM: 'Dim',
  DIMLINEAR: 'Linear',
  DIMALIGNED: 'Aligned',
  DIMANGULAR: 'Angular',
  DIMRADIUS: 'Radius',
  DIMDIAMETER: 'Diameter',
  BDLABEL: 'B/D',
  CURVELABEL: 'Curve',
  TEXTSTYLE: 'Text',
  DIMSTYLE: 'Dim',
  LEADERSTYLE: 'Leader',
  SURVEYLABELSTYLE: 'Labels',
  LINETABLE: 'Line',
  CURVETABLE: 'Curve',
  PARCELTABLE: 'Parcel',
  POINTTABLE: 'Points',
  PARCELREPORT: 'Report',
  PARCELDESC: 'Desc',
  TABLESTYLE: 'Style',
};

export const commandIconFor = (key: string): CadRibbonIconId | undefined => COMMAND_ICONS[key];

export const shortLabelFor = (def: CadShellCommandDef): string =>
  COMMAND_SHORT_LABELS[def.key] ?? def.label;

export const registryTooltipFor = (def: CadShellCommandDef): string => {
  const alias = def.aliases.length > 0 ? ` [${def.aliases.join(', ')}]` : '';
  return `${def.label}${alias} — ${def.hint}`;
};

export interface RegistryIconButtonProps {
  commandKey: string;
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
  active?: boolean;
}

/**
 * One registry command as an icon-first ribbon button. Unknown keys render
 * nothing (never a dead face); availability comes from the registry alone.
 */
export const RegistryIconButton: React.FC<RegistryIconButtonProps> = ({
  commandKey,
  snapshot,
  actions,
  active = false,
}) => {
  const def = resolveShellCommandText(commandKey);
  if (def == null) return null;
  return (
    <CadRibbonIconButton
      className="cad-ribbon-tool"
      icon={commandIconFor(def.key)}
      shortLabel={shortLabelFor(def)}
      label={def.label}
      title={registryTooltipFor(def)}
      disabled={!isShellCommandAvailable(def, snapshot, actions)}
      active={active}
      size="compact"
      commandKey={def.key}
      onClick={() => executeShellCommand(def, actions, snapshot)}
    />
  );
};

/** Render a fixed key order as icon buttons (unknown keys skipped). */
export const RegistryIconRow: React.FC<{
  keys: readonly string[];
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
  activeCommandKey?: string | null;
}> = ({ keys, snapshot, actions, activeCommandKey }) => (
  <>
    {keys.map((key) => (
      <RegistryIconButton
        key={key}
        commandKey={key}
        snapshot={snapshot}
        actions={actions}
        active={activeCommandKey != null && activeCommandKey === key}
      />
    ))}
  </>
);
