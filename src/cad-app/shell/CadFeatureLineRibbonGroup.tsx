/**
 * Phase 20A — bounded Home ribbon "Feature Line" subgroup.
 *
 * Every button dispatches an undoable engine command through the one shell
 * registry (`actions.runFeatureLineCommand`); prompts collect the numeric
 * input a ribbon button cannot gather inline. "Set Vertices from Surface" is
 * vertex-only (no continuous drape). Buttons render disabled without a live
 * workspace/action (never fake success).
 */
import React from 'react';
import {
  CAD_SHELL_COMMANDS,
  executeShellCommand,
  isShellCommandAvailable,
  type CadShellCommandDef,
} from './cadCommandRegistry';
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

const defFor = (key: string): CadShellCommandDef | null =>
  CAD_SHELL_COMMANDS.find((entry) => entry.key === key) ?? null;

export const CadFeatureLineRibbonGroup: React.FC<{
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
}> = ({ snapshot, actions }) => {
  if (actions?.runFeatureLineCommand == null) return null;
  return (
    <div className="cad-shell-ribbon-group" aria-label="Feature Line">
      <span className="cad-shell-ribbon-group-label">Feature Line</span>
      <div className="cad-shell-ribbon-buttons">
        {FEATURE_LINE_KEYS.map((key) => {
          const def = defFor(key);
          if (def == null) return null;
          const available = isShellCommandAvailable(def, snapshot, actions);
          return (
            <button
              key={key}
              type="button"
              title={`${def.label} — ${def.hint}`}
              aria-label={def.label}
              disabled={!available}
              className="cad-shell-ribbon-button"
              onClick={() => executeShellCommand(def, actions, snapshot)}
              data-cad-feature-line={key}
            >
              {def.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
