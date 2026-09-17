import React, { useState } from 'react';
import {
  CAD_SHELL_COMMANDS,
  executeShellCommand,
  isShellCommandAvailable,
  type CadShellCommandDef,
} from './cadCommandRegistry';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';

interface CadRibbonProps {
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

const RIBBON_TABS = ['Home', 'Output'] as const;
type RibbonTab = (typeof RIBBON_TABS)[number];

const ribbonTooltip = (def: CadShellCommandDef): string => {
  const alias = def.aliases.length > 0 ? ` [${def.aliases.join(', ')}]` : '';
  return `${def.label}${alias} — ${def.hint}`;
};

/**
 * Phase 18B — compact ribbon. Home carries Draw/Modify/Parcel dispatch;
 * Output carries file deliverables (Save, Export Center, Sheets & Layers).
 * Same registry as menu + command dock; no duplicate command wiring.
 */
export const CadRibbon: React.FC<CadRibbonProps> = ({ snapshot, actions, collapsed, onToggleCollapsed }) => {
  const [tab, setTab] = useState<RibbonTab>('Home');
  const run = (def: CadShellCommandDef): void => {
    executeShellCommand(def, actions);
  };
  if (collapsed) {
    return (
      <div className="cad-shell-ribbon-collapsed" data-cad-ribbon>
        <button type="button" className="cad-shell-ribbon-tab" onClick={onToggleCollapsed} title="Show ribbon">
          Ribbon
        </button>
      </div>
    );
  }
  const groups =
    tab === 'Home'
      ? (['Draw', 'Modify', 'Parcel', 'Edit'] as const)
      : (['File'] as const);
  return (
    <div className="cad-shell-ribbon" data-cad-ribbon>
      <div className="cad-shell-ribbon-tabs" role="tablist" aria-label="Ribbon tabs">
        {RIBBON_TABS.map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={tab === entry}
            className={`cad-shell-ribbon-tab${tab === entry ? ' active' : ''}`}
            onClick={() => setTab(entry)}
          >
            {entry}
          </button>
        ))}
        <button type="button" className="cad-shell-ribbon-tab" onClick={onToggleCollapsed} title="Collapse ribbon">
          ▴
        </button>
      </div>
      <div className="cad-shell-ribbon-groups">
        {groups.map((group) => (
          <div key={group} className="cad-shell-ribbon-group" aria-label={group}>
            <span className="cad-shell-ribbon-group-label">{group}</span>
            <div className="cad-shell-ribbon-buttons">
              {CAD_SHELL_COMMANDS.filter((def) => def.category === group).map((def) => (
                <button
                  key={def.key}
                  type="button"
                  title={ribbonTooltip(def)}
                  aria-label={def.label}
                  disabled={!isShellCommandAvailable(def, snapshot, actions)}
                  className="cad-shell-ribbon-button"
                  onClick={() => run(def)}
                  data-cad-command={def.key}
                >
                  {def.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
