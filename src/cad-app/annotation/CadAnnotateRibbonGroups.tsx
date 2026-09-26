// Phase 18O — Annotate ribbon tab groups. Drawing commands dispatch through
// the shared shell registry (keys owned by the annotation command worker;
// unavailable keys render disabled). STYLES entries open the Annotation
// Styles manager: the registry dispatching path is tried first, and the
// manager opens directly when the workspace exposes `openAnnotationManager`
// but has not (yet) registered a starter for the style command key.

import React from 'react';
import {
  executeShellCommand,
  isShellCommandAvailable,
  resolveShellCommandText,
  type CadShellCommandDef,
} from '../shell/cadCommandRegistry';
import type { CadAnnotationManagerTab, CadShellActions, CadWorkspaceSnapshot } from '../shell/cadShellTypes';

interface CadAnnotateRibbonGroupsProps {
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
}

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

export const CadAnnotateRibbonGroups: React.FC<CadAnnotateRibbonGroupsProps> = ({ snapshot, actions }) => (
  <>
    {ANNOTATE_RIBBON_GROUPS.map((group) => (
      <AnnotateGroup key={group.label} spec={group} snapshot={snapshot} actions={actions} />
    ))}
  </>
);

const AnnotateGroup: React.FC<{
  spec: AnnotateGroupSpec;
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
}> = ({ spec, snapshot, actions }) => {
  const defs = spec.keys
    .map((key) => resolveShellCommandText(key))
    .filter((def): def is CadShellCommandDef => def != null);
  return (
    <div className="cad-shell-ribbon-group" aria-label={spec.label}>
      <span className="cad-shell-ribbon-group-label">{spec.label}</span>
      <div className="cad-shell-ribbon-buttons">
        {defs.map((def) => {
          const tab = STYLE_TAB_BY_KEY[def.key];
          const managerReady = tab != null && actions?.openAnnotationManager != null;
          const enabled = managerReady || isShellCommandAvailable(def, snapshot, actions);
          return (
            <button
              key={def.key}
              type="button"
              title={`${def.label} — ${tab != null ? 'Open the Annotation Styles manager.' : def.hint}`}
              aria-label={def.label}
              disabled={!enabled}
              className="cad-shell-ribbon-button"
              data-cad-annotation-command={def.key}
              onClick={() => {
                const started = executeShellCommand(def, actions);
                if (!started && tab != null) actions?.openAnnotationManager?.(tab);
              }}
            >
              {def.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
