/**
 * Phase 20A — bounded Home ribbon "Feature Line" subgroup.
 *
 * Every button dispatches an undoable engine command through the one shell
 * registry (`actions.runFeatureLineCommand`); prompts collect the numeric
 * input a ribbon button cannot gather inline. "Set Vertices from Surface" is
 * vertex-only (no continuous drape). Buttons render disabled without a live
 * workspace/action (never fake success).
 *
 * Phase 21B: icon-first faces where a truthful Civil 3D asset was curated.
 * Faces without a curated icon keep a short text face; the full label stays
 * in the tooltip and aria-label. Icons are presentation only — dispatch is
 * still exclusively `executeShellCommand`.
 */
import React from 'react';
import {
  CAD_SHELL_COMMANDS,
  executeShellCommand,
  isShellCommandAvailable,
  type CadShellCommandDef,
} from './cadCommandRegistry';
import { CadRibbonIconButton } from './CadRibbonIconButton';
import type { CadRibbonIconId } from '../assets/icons/cadRibbonIcons';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';

const FEATURE_LINE_KEYS: readonly string[] = [
  'FEATURELINECREATE',
  'FLSETZ',
  'FLGRADE',
  'FLRAISELOWER',
  'FLINTERPOLATE',
  'FLSURFACEELEV',
  'FLINQUIRY',
  'FLINSERTVERTEX',
  'FLDELETEVERTEX',
  'SURFACE_ADDFEATURELINEBREAKLINE',
];

/** Curated Civil icons; omitted keys render a short text face. */
const FEATURE_LINE_ICONS: Partial<Record<string, CadRibbonIconId>> = {
  FEATURELINECREATE: 'feature-line-create',
  FLSETZ: 'feature-line-elevation',
  FLRAISELOWER: 'feature-line-raise-lower',
  FLSURFACEELEV: 'feature-line-elev-from-surface',
  FLINSERTVERTEX: 'feature-line-insert-vertex',
};

const FEATURE_LINE_SHORT: Record<string, string> = {
  FEATURELINECREATE: 'Create',
  FLSETZ: 'Elev',
  FLGRADE: 'Grade',
  FLRAISELOWER: 'Raise',
  FLINTERPOLATE: 'Interp',
  FLSURFACEELEV: 'Surf Z',
  FLINQUIRY: 'Inquiry',
  FLINSERTVERTEX: 'Insert',
  FLDELETEVERTEX: 'Delete',
  SURFACE_ADDFEATURELINEBREAKLINE: 'Breakline',
};

const defFor = (key: string): CadShellCommandDef | null =>
  CAD_SHELL_COMMANDS.find((entry) => entry.key === key) ?? null;

export const CadFeatureLineRibbonGroup: React.FC<{
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
}> = ({ snapshot, actions }) => {
  if (actions?.runFeatureLineCommand == null) return null;
  return (
    <div className="cad-shell-ribbon-group" aria-label="Feature Line">
      <div className="cad-shell-ribbon-buttons">
        {FEATURE_LINE_KEYS.map((key) => {
          const def = defFor(key);
          if (def == null) return null;
          const available = isShellCommandAvailable(def, snapshot, actions);
          return (
            <CadRibbonIconButton
              key={key}
              className="cad-ribbon-tool"
              icon={FEATURE_LINE_ICONS[key]}
              shortLabel={FEATURE_LINE_SHORT[key] ?? def.label}
              label={def.label}
              title={`${def.label} — ${def.hint}`}
              disabled={!available}
              size="compact"
              onClick={() => executeShellCommand(def, actions, snapshot)}
              dataAttributes={{ 'data-cad-feature-line': key }}
            />
          );
        })}
      </div>
      <span className="cad-shell-ribbon-group-label">Feature Line</span>
    </div>
  );
};
