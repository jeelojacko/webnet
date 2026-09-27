/**
 * Phase 20B — bounded Home ribbon "Grading" subgroup.
 *
 * Every button dispatches through the one shell registry
 * (`actions.runGradingCommand` / the grading action seam); GRADETOSURFACE
 * runs the selection-driven creation prompts, the rest open the manager or
 * fire the explicit Calculate / Extract / Bake actions. Buttons render
 * disabled without a live workspace/action (never fake success).
 */
import React from 'react';
import {
  CAD_SHELL_COMMANDS,
  executeShellCommand,
  isShellCommandAvailable,
  type CadShellCommandDef,
} from './cadCommandRegistry';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';

const GRADING_KEYS: readonly string[] = [
  'GRADETOSURFACE',
  'GRADING',
  'GRADINGCALC',
  'GRADINGINQUIRY',
  'GRADINGEXTRACTDAYLIGHT',
  'GRADINGBAKE',
];

const defFor = (key: string): CadShellCommandDef | null =>
  CAD_SHELL_COMMANDS.find((entry) => entry.key === key) ?? null;

export const CadGradingRibbonGroup: React.FC<{
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
}> = ({ snapshot, actions }) => {
  if (actions?.runGradingCommand == null) return null;
  return (
    <div className="cad-shell-ribbon-group" aria-label="Grading">
      <span className="cad-shell-ribbon-group-label">Grading</span>
      <div className="cad-shell-ribbon-buttons">
        {GRADING_KEYS.map((key) => {
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
              data-cad-grading-command={key}
            >
              {def.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
