import React, { useState } from 'react';
import {
  CAD_SHELL_COMMANDS,
  executeShellCommand,
  isShellCommandAvailable,
  type CadShellCommandDef,
} from './cadCommandRegistry';
import { CadLayersGroup } from './CadLayersGroup';
import type { CadShellActions, CadWorkspaceSnapshot, SurveyManagerKind } from './cadShellTypes';

interface CadRibbonProps {
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

const RIBBON_TABS = ['Home', 'Survey', 'Output'] as const;
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
      : tab === 'Survey'
        ? ([] as const)
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
        {tab === 'Home' ? <CadLayersGroup snapshot={snapshot} actions={actions} /> : null}
        {tab === 'Survey' ? <CadSurveyGroup snapshot={snapshot} actions={actions} /> : null}
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

/**
 * Phase 18D — Survey tab: five entry points, each focusing the Toolspace
 * node or opening the matching manager. No new command groups.
 * Phase 18E — F2F group: six compact entries routing through the command
 * registry section focus (catalog/codes/review/regen/import/export).
 */
const CadSurveyGroup: React.FC<{
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
}> = ({ snapshot, actions }) => {
  const buttons: Array<{ kind: SurveyManagerKind; label: string; hint: string }> = [
    { kind: 'points', label: 'Points', hint: 'Focus the Toolspace Survey points.' },
    { kind: 'point-groups', label: 'Point Groups', hint: 'Open the Point Group manager.' },
    { kind: 'point-styles', label: 'Point Styles', hint: 'Open the Point Style manager.' },
    { kind: 'point-label-styles', label: 'Point Label Styles', hint: 'Open the Point Label Style manager.' },
    { kind: 'f2f', label: 'Field to Finish', hint: 'Open field-to-finish.' },
  ];
  const f2f: Array<{ section: string; label: string; hint: string }> = [
    { section: 'catalog', label: 'Field to Finish', hint: 'Open field-to-finish catalog.' },
    { section: 'codes', label: 'Feature Codes', hint: 'Open the feature-code manager.' },
    { section: 'review', label: 'Import/Review', hint: 'Open the F2F import review.' },
    { section: 'regen', label: 'Regenerate', hint: 'Open regeneration preview.' },
    { section: 'import', label: 'Catalog Import', hint: 'Open catalog file import.' },
    { section: 'export', label: 'Catalog Export', hint: 'Open catalog file export.' },
  ];
  return (
    <>
    <div className="cad-shell-ribbon-group" aria-label="Survey">
      <span className="cad-shell-ribbon-group-label">Survey</span>
      <div className="cad-shell-ribbon-buttons">
        {buttons.map((entry) => (
          <button
            key={entry.kind}
            type="button"
            title={entry.hint}
            aria-label={entry.label}
            disabled={!snapshot || !actions}
            className="cad-shell-ribbon-button"
            onClick={() => actions?.openSurveyManager(entry.kind)}
            data-cad-survey={entry.kind}
          >
            {entry.label}
          </button>
        ))}
      </div>
    </div>
    <div className="cad-shell-ribbon-group" aria-label="Field to Finish">
      <span className="cad-shell-ribbon-group-label">Field to Finish</span>
      <div className="cad-shell-ribbon-buttons">
        {f2f.map((entry) => (
          <button
            key={entry.section}
            type="button"
            title={entry.hint}
            aria-label={entry.label}
            disabled={!snapshot || !actions}
            className="cad-shell-ribbon-button"
            onClick={() => actions?.openSurveyManager('f2f', entry.section)}
            data-cad-f2f={entry.section}
          >
            {entry.label}
          </button>
        ))}
      </div>
    </div>
    </>
  );
};
