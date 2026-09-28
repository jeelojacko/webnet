// Phase 21A Wave 2 — Annotate tab: Text / Leaders / Dimensions /
// Survey Labels / Tables / Styles icon grids. Dispatch stays registry-only;
// STYLES entries keep the manager fallback (registry first, Annotation
// Styles manager when no starter is registered). No curated icons exist for
// DIM, BDLABEL, CURVELABEL, LEADERSTYLE, SURVEYLABELSTYLE, PARCELREPORT, or
// PARCELDESC — those keep short text faces.
import React from 'react';
import {
  executeShellCommand,
  isShellCommandAvailable,
  resolveShellCommandText,
  type CadShellCommandDef,
} from './cadCommandRegistry';
import { CadRibbonIconButton } from './CadRibbonIconButton';
import type {
  CadAnnotationManagerTab,
  CadShellActions,
  CadWorkspaceSnapshot,
} from './cadShellTypes';
import { commandIconFor, registryTooltipFor, shortLabelFor, RibbonGroup } from './CadRibbonShared';

interface AnnotateGroupSpec {
  label: string;
  keys: string[];
}

const ANNOTATE_RIBBON_GROUPS: AnnotateGroupSpec[] = [
  { label: 'Text', keys: ['MTEXT'] },
  { label: 'Leaders', keys: ['LEADER'] },
  {
    label: 'Dimensions',
    keys: ['DIM', 'DIMLINEAR', 'DIMALIGNED', 'DIMANGULAR', 'DIMRADIUS', 'DIMDIAMETER'],
  },
  { label: 'Survey Labels', keys: ['BDLABEL', 'CURVELABEL'] },
  {
    label: 'Tables',
    keys: [
      'LINETABLE',
      'CURVETABLE',
      'PARCELTABLE',
      'POINTTABLE',
      'PARCELREPORT',
      'PARCELDESC',
      'TABLESTYLE',
    ],
  },
  { label: 'Styles', keys: ['TEXTSTYLE', 'DIMSTYLE', 'LEADERSTYLE', 'SURVEYLABELSTYLE'] },
];

/** Command key -> manager tab for the STYLES group. */
const STYLE_TAB_BY_KEY: Record<string, CadAnnotationManagerTab> = {
  TEXTSTYLE: 'text',
  DIMSTYLE: 'dimension',
  LEADERSTYLE: 'leader',
  SURVEYLABELSTYLE: 'bearing-label',
};

const AnnotateButton: React.FC<{
  def: CadShellCommandDef;
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
}> = ({ def, snapshot, actions }) => {
  const tab = STYLE_TAB_BY_KEY[def.key];
  const managerReady = tab != null && actions?.openAnnotationManager != null;
  const enabled = managerReady || isShellCommandAvailable(def, snapshot, actions);
  return (
    <CadRibbonIconButton
      className="cad-ribbon-tool"
      icon={commandIconFor(def.key)}
      shortLabel={shortLabelFor(def)}
      label={def.label}
      title={tab != null ? `${def.label} — Open the Annotation Styles manager.` : registryTooltipFor(def)}
      disabled={!enabled}
      size="compact"
      commandKey={def.key}
      onClick={() => {
        const started = executeShellCommand(def, actions, snapshot);
        if (!started && tab != null) actions?.openAnnotationManager?.(tab);
      }}
    />
  );
};

export const CadRibbonAnnotateTab: React.FC<{
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
}> = ({ snapshot, actions }) => (
  <>
    {ANNOTATE_RIBBON_GROUPS.map((group) => (
      <RibbonGroup key={group.label} label={group.label}>
        {group.keys.map((key) => {
          const def = resolveShellCommandText(key);
          if (def == null) return null;
          return <AnnotateButton key={key} def={def} snapshot={snapshot} actions={actions} />;
        })}
      </RibbonGroup>
    ))}
  </>
);
