/**
 * Phase 20C Wave-4A — bounded Home ribbon "Grading Groups" subgroup.
 *
 * Extends the DESIGN/GRADING area (no new top-level tab): Grade Group /
 * Calculate / Inquiry / Extract / Bake / Manager. Every button dispatches
 * through the one shell registry (`actions.runGradingGroupCommand` / the
 * group action seam). Buttons render disabled without a live workspace
 * action (never fake success).
 */
import React from 'react';
import {
  CAD_SHELL_COMMANDS,
  executeShellCommand,
  isShellCommandAvailable,
  type CadShellCommandDef,
} from './cadCommandRegistry';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';

const GROUP_KEYS: readonly string[] = [
  'GRADEGROUP',
  'GRADINGGROUPCALC',
  'GRADINGGROUPINQUIRY',
  'GRADINGGROUPEXTRACTDAYLIGHT',
  'GRADINGGROUPBAKE',
  'GRADINGGROUP',
];

const defFor = (key: string): CadShellCommandDef | null =>
  CAD_SHELL_COMMANDS.find((entry) => entry.key === key) ?? null;

export const CadGradingGroupRibbonGroup: React.FC<{
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
}> = ({ snapshot, actions }) => {
  if (actions?.runGradingGroupCommand == null) return null;
  return (
    <div className="cad-shell-ribbon-group" aria-label="Grading Groups">
      <span className="cad-shell-ribbon-group-label">Grading Groups</span>
      <div className="cad-shell-ribbon-buttons">
        {GROUP_KEYS.map((key) => {
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
              data-cad-grading-group-command={key}
            >
              {def.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
