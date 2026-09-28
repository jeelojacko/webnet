/**
 * Phase 20C Wave-4A — bounded Home ribbon "Grading Groups" subgroup.
 *
 * Extends the DESIGN/GRADING area (no new top-level tab): Grade Group /
 * Calculate / Inquiry / Extract / Bake / Manager. Every button dispatches
 * through the one shell registry (`actions.runGradingGroupCommand` / the
 * group action seam). Buttons render disabled without a live workspace
 * action (never fake success).
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

const GROUP_KEYS: readonly string[] = [
  'GRADEGROUP',
  'GRADINGGROUPCALC',
  'GRADINGGROUPINQUIRY',
  'GRADINGGROUPEXTRACTDAYLIGHT',
  'GRADINGGROUPBAKE',
  'GRADINGGROUP',
];

/** Curated Civil icons; omitted keys render a short text face. */
const GROUP_ICONS: Partial<Record<string, CadRibbonIconId>> = {
  GRADEGROUP: 'grading-group-create',
};

const GROUP_SHORT: Record<string, string> = {
  GRADEGROUP: 'Create',
  GRADINGGROUPCALC: 'Calc',
  GRADINGGROUPINQUIRY: 'Inquiry',
  GRADINGGROUPEXTRACTDAYLIGHT: 'Daylight',
  GRADINGGROUPBAKE: 'Bake',
  GRADINGGROUP: 'Manager',
};

const defFor = (key: string): CadShellCommandDef | null =>
  CAD_SHELL_COMMANDS.find((entry) => entry.key === key) ?? null;

export const CadGradingGroupRibbonGroup: React.FC<{
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
}> = ({ snapshot, actions }) => {
  if (actions?.runGradingGroupCommand == null) return null;
  return (
    <div className="cad-shell-ribbon-group" aria-label="Grading Groups">
      <div className="cad-shell-ribbon-buttons">
        {GROUP_KEYS.map((key, index) => {
          const def = defFor(key);
          if (def == null) return null;
          const available = isShellCommandAvailable(def, snapshot, actions);
          return (
            <CadRibbonIconButton
              key={`${key}-${index}`}
              className="cad-ribbon-tool"
              icon={GROUP_ICONS[key]}
              shortLabel={GROUP_SHORT[key] ?? def.label}
              label={def.label}
              title={`${def.label} — ${def.hint}`}
              disabled={!available}
              size="compact"
              onClick={() => executeShellCommand(def, actions, snapshot)}
              dataAttributes={{ 'data-cad-grading-group-command': key }}
            />
          );
        })}
      </div>
      <span className="cad-shell-ribbon-group-label">Grading Groups</span>
    </div>
  );
};
