// Phase 21A Wave 2 — Survey tab: Survey entries, Transform, Field to
// Finish, Tables. Same manager/registry routing as before, re-chromed into
// the compact icon grid. No curated icons exist for the Toolspace-manager
// entries or F2F sections, so those keep short text faces; the Tables group
// is registry-dispatched with table icons where truthful.
import React from 'react';
import {
  executeShellCommand,
  isShellCommandAvailable,
  CAD_SHELL_COMMANDS,
} from './cadCommandRegistry';
import { CadRibbonIconButton } from './CadRibbonIconButton';
import type { CadShellActions, CadWorkspaceSnapshot, SurveyManagerKind } from './cadShellTypes';
import { commandIconFor, RibbonGroup } from './CadRibbonShared';

const SURVEY_ENTRIES: Array<{ kind: SurveyManagerKind; label: string; short: string; hint: string }> = [
  { kind: 'points', label: 'Points', short: 'Points', hint: 'Focus the Toolspace Survey points.' },
  { kind: 'point-groups', label: 'Point Groups', short: 'Groups', hint: 'Open the Point Group manager.' },
  { kind: 'point-styles', label: 'Point Styles', short: 'Styles', hint: 'Open the Point Style manager.' },
  { kind: 'point-label-styles', label: 'Point Label Styles', short: 'Labels', hint: 'Open the Point Label Style manager.' },
  { kind: 'f2f', label: 'Field to Finish', short: 'F2F', hint: 'Open field-to-finish.' },
];

const TRANSFORM_KEYS = ['HELMERT2D', 'GRIDGROUND'] as const;

const F2F_SECTIONS: Array<{ section: string; label: string; short: string; hint: string }> = [
  { section: 'catalog', label: 'Field to Finish', short: 'F2F', hint: 'Open field-to-finish catalog.' },
  { section: 'codes', label: 'Feature Codes', short: 'Codes', hint: 'Open the feature-code manager.' },
  { section: 'review', label: 'Import/Review', short: 'Review', hint: 'Open the F2F import review.' },
  { section: 'regen', label: 'Regenerate', short: 'Regen', hint: 'Open regeneration preview.' },
  { section: 'import', label: 'Catalog Import', short: 'Import', hint: 'Open catalog file import.' },
  { section: 'export', label: 'Catalog Export', short: 'Export', hint: 'Open catalog file export.' },
];

const SURVEY_TABLE_RIBBON_KEYS = [
  'LINETABLE',
  'CURVETABLE',
  'PARCELTABLE',
  'POINTTABLE',
  'PARCELREPORT',
  'PARCELDESC',
  'TABLESTYLE',
] as const;

export const CadRibbonSurveyTab: React.FC<{
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
}> = ({ snapshot, actions }) => {
  const ready = snapshot != null && actions != null;
  return (
    <>
      <RibbonGroup label="Survey">
        {SURVEY_ENTRIES.map((entry) => (
          <CadRibbonIconButton
            key={entry.kind}
            className="cad-ribbon-tool"
            shortLabel={entry.short}
            label={entry.label}
            title={`${entry.label} — ${entry.hint}`}
            disabled={!ready}
            size="compact"
            onClick={() => actions?.openSurveyManager(entry.kind)}
          />
        ))}
        <CadRibbonIconButton
          className="cad-ribbon-tool"
          icon={commandIconFor('BLOCKS')}
          shortLabel="Symbols"
          label="Survey Symbols"
          title="Survey Symbols — Open the survey symbol library (Block Manager symbols view)."
          disabled={!ready || actions?.openBlockManager == null}
          size="compact"
          onClick={() => actions?.openBlockManager?.('symbols')}
        />
      </RibbonGroup>
      <RibbonGroup label="Transform">
        {TRANSFORM_KEYS.map((key) => {
          const def = CAD_SHELL_COMMANDS.find((entry) => entry.key === key) ?? null;
          if (def == null) return null;
          const short = key === 'HELMERT2D' ? 'Helmert' : 'Grid';
          return (
            <CadRibbonIconButton
              key={key}
              className="cad-ribbon-tool"
              shortLabel={short}
              label={def.label}
              title={`${def.label} — ${def.hint}`}
              disabled={!isShellCommandAvailable(def, snapshot, actions)}
              size="compact"
              commandKey={key}
              onClick={() => executeShellCommand(def, actions, snapshot)}
            />
          );
        })}
      </RibbonGroup>
      <RibbonGroup label="Field to Finish">
        {F2F_SECTIONS.map((entry) => (
          <CadRibbonIconButton
            key={entry.section}
            className="cad-ribbon-tool"
            shortLabel={entry.short}
            label={entry.label}
            title={`${entry.label} — ${entry.hint}`}
            disabled={!ready}
            size="compact"
            onClick={() => actions?.openSurveyManager('f2f', entry.section)}
          />
        ))}
      </RibbonGroup>
      <RibbonGroup label="Tables">
        {SURVEY_TABLE_RIBBON_KEYS.map((key) => {
          const def = CAD_SHELL_COMMANDS.find((entry) => entry.key === key) ?? null;
          if (def == null) return null;
          const enabled = ready && isShellCommandAvailable(def, snapshot, actions);
          const short = key === 'TABLESTYLE' ? 'Style' : key === 'PARCELREPORT' ? 'Report' : key === 'PARCELDESC' ? 'Desc' : key.replace('TABLE', '');
          return (
            <CadRibbonIconButton
              key={key}
              className="cad-ribbon-tool"
              icon={commandIconFor(key)}
              shortLabel={short}
              label={def.label}
              title={`${def.label} — ${def.hint}`}
              disabled={!enabled}
              size="compact"
              commandKey={key}
              onClick={() => executeShellCommand(def, actions, snapshot)}
            />
          );
        })}
      </RibbonGroup>
    </>
  );
};
