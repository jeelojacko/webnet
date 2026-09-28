/**
 * Phase 20B — bounded Home ribbon "Grading" subgroup.
 *
 * Every button dispatches through the one shell registry
 * (`actions.runGradingCommand` / the grading action seam); GRADETOSURFACE
 * runs the selection-driven creation prompts, the rest open the manager or
 * fire the explicit Calculate / Extract / Bake actions. Buttons render
 * disabled without a live workspace/action (never fake success).
 *
 * Phase 21B: icon-first faces where a truthful Civil 3D asset was curated;
 * full labels stay in tooltip/aria-label. Dispatch is unchanged.
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

const GRADING_KEYS: readonly string[] = [
  'GRADETOSURFACE',
  'GRADING',
  'GRADINGCALC',
  'GRADINGINQUIRY',
  'GRADINGEXTRACTDAYLIGHT',
  'GRADINGBAKE',
];

/** Curated Civil icons; omitted keys render a short text face. */
const GRADING_ICONS: Partial<Record<string, CadRibbonIconId>> = {
  GRADETOSURFACE: 'grading-create',
};

const GRADING_SHORT: Record<string, string> = {
  GRADETOSURFACE: 'Grade',
  GRADING: 'Manager',
  GRADINGCALC: 'Calc',
  GRADINGINQUIRY: 'Inquiry',
  GRADINGEXTRACTDAYLIGHT: 'Daylight',
  GRADINGBAKE: 'Bake',
};

const defFor = (key: string): CadShellCommandDef | null =>
  CAD_SHELL_COMMANDS.find((entry) => entry.key === key) ?? null;

export const CadGradingRibbonGroup: React.FC<{
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
}> = ({ snapshot, actions }) => {
  if (actions?.runGradingCommand == null) return null;
  return (
    <div className="cad-shell-ribbon-group" aria-label="Grading">
      <div className="cad-shell-ribbon-buttons">
        {GRADING_KEYS.map((key) => {
          const def = defFor(key);
          if (def == null) return null;
          const available = isShellCommandAvailable(def, snapshot, actions);
          return (
            <CadRibbonIconButton
              key={key}
              className="cad-ribbon-tool"
              icon={GRADING_ICONS[key]}
              shortLabel={GRADING_SHORT[key] ?? def.label}
              label={def.label}
              title={`${def.label} — ${def.hint}`}
              disabled={!available}
              size="compact"
              onClick={() => executeShellCommand(def, actions, snapshot)}
              dataAttributes={{ 'data-cad-grading-command': key }}
            />
          );
        })}
      </div>
      <span className="cad-shell-ribbon-group-label">Grading</span>
    </div>
  );
};
