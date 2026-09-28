// Phase 21A Wave 2 — thin ribbon shell: tabs + collapse + per-tab builders.
// Home/Annotate/Survey/Surface/Output live in CadRibbon*Tab.tsx so this file
// stays small. Tool-family sticky state arrives from CadApplicationShell
// (which wires notifyDrawingLifecycle to onDrawingLifecycle); tab switches
// and collapse never touch it. CadMenuBar routing is untouched.
import React, { useState } from 'react';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import { useCadToolFamilyState, type CadToolFamilyState } from './useCadToolFamilyState';
import { CadRibbonHomeTab } from './CadRibbonHomeTab';
import { CadRibbonAnnotateTab } from './CadRibbonAnnotateTab';
import { CadRibbonSurveyTab } from './CadRibbonSurveyTab';
import { CadRibbonSurfaceTab } from './CadRibbonSurfaceTab';
import { CadRibbonOutputTab } from './CadRibbonOutputTab';

interface CadRibbonProps {
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
  /** Shell-owned sticky state (lifecycle-wired); falls back to a local instance. */
  familyState?: CadToolFamilyState;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

const RIBBON_TABS = ['Home', 'Annotate', 'Survey', 'Surface', 'Output'] as const;
type RibbonTab = (typeof RIBBON_TABS)[number];

export const CadRibbon: React.FC<CadRibbonProps> = ({
  snapshot,
  actions,
  familyState: familyStateProp,
  collapsed,
  onToggleCollapsed,
}) => {
  const [tab, setTab] = useState<RibbonTab>('Home');
  const localFamilies = useCadToolFamilyState({ drawingId: snapshot?.drawingId ?? null });
  const familyState = familyStateProp ?? localFamilies;
  if (collapsed) {
    return (
      <div className="cad-shell-ribbon-collapsed" data-cad-ribbon>
        <button type="button" className="cad-shell-ribbon-tab" onClick={onToggleCollapsed} title="Show ribbon">
          Ribbon
        </button>
      </div>
    );
  }
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
        {tab === 'Home' ? <CadRibbonHomeTab snapshot={snapshot} actions={actions} familyState={familyState} /> : null}
        {tab === 'Annotate' ? <CadRibbonAnnotateTab snapshot={snapshot} actions={actions} /> : null}
        {tab === 'Survey' ? <CadRibbonSurveyTab snapshot={snapshot} actions={actions} /> : null}
        {tab === 'Surface' ? <CadRibbonSurfaceTab snapshot={snapshot} actions={actions} /> : null}
        {tab === 'Output' ? <CadRibbonOutputTab snapshot={snapshot} actions={actions} /> : null}
      </div>
    </div>
  );
};
