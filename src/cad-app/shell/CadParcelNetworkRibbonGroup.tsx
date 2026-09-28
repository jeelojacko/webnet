/**
 * Phase 19D — bounded Home ribbon "Parcel Network" subgroup.
 *
 * The generic Parcel category would otherwise grow by seven buttons. This
 * group surfaces only the network essentials (Designate, Number, Link,
 * Validate) and tucks the secondary actions (Unlink, Schedule) behind split
 * carets. Shared Boundary Edit stays contextual in Toolspace/Properties.
 *
 * "Plan Role" is user-assigned display metadata, never a legal conclusion.
 * Role presentation is deliberately NOT color-coded here: layer/style owns
 * appearance; this group only dispatches registry commands.
 *
 * Phase 21B: icon-first faces for Designate/Number where a truthful Civil 3D
 * asset was curated; full labels stay in the tooltip/aria-label.
 */
import React, { useState } from 'react';
import {
  CAD_SHELL_COMMANDS,
  executeShellCommand,
  isShellCommandAvailable,
  type CadShellCommandDef,
} from './cadCommandRegistry';
import { CadRibbonIconButton } from './CadRibbonIconButton';
import type { CadRibbonIconId } from '../assets/icons/cadRibbonIcons';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';

const defFor = (key: string): CadShellCommandDef | null =>
  CAD_SHELL_COMMANDS.find((entry) => entry.key === key) ?? null;

interface SplitEntry {
  key: string;
  secondary: string[];
}

const PARCEL_NETWORK_ENTRIES: readonly SplitEntry[] = [
  { key: 'PARCELDESIGNATE', secondary: [] },
  { key: 'PARCELNUMBER', secondary: [] },
  { key: 'PARCELLINK', secondary: ['PARCELUNLINK'] },
  { key: 'PARCELCHECK', secondary: ['PARCELSCHEDULE'] },
];

/** Curated Civil icons; omitted keys render a short text face. */
const NETWORK_ICONS: Partial<Record<string, CadRibbonIconId>> = {
  PARCELDESIGNATE: 'parcel-props-edit',
  PARCELNUMBER: 'parcel-renumber-tags',
};

const NETWORK_SHORT: Record<string, string> = {
  PARCELDESIGNATE: 'Designate',
  PARCELNUMBER: 'Number',
  PARCELLINK: 'Link',
  PARCELUNLINK: 'Unlink',
  PARCELCHECK: 'Validate',
  PARCELSCHEDULE: 'Schedule',
};

const RibbonButton: React.FC<{
  def: CadShellCommandDef | null;
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
  secondary?: boolean;
  onAfterRun?: () => void;
}> = ({ def, snapshot, actions, secondary = false, onAfterRun }) => {
  const available = def != null && isShellCommandAvailable(def, snapshot, actions);
  return (
    <CadRibbonIconButton
      className={`cad-ribbon-tool${secondary ? ' cad-shell-ribbon-button-secondary' : ''}`}
      icon={def != null ? NETWORK_ICONS[def.key] : undefined}
      shortLabel={def != null ? NETWORK_SHORT[def.key] ?? def.label : '—'}
      label={def?.label ?? 'Unavailable'}
      title={def ? `${def.label} — ${def.hint}` : 'Command unavailable.'}
      disabled={!available}
      size="compact"
      onClick={() => {
        if (def == null) return;
        executeShellCommand(def, actions, snapshot);
        onAfterRun?.();
      }}
      dataAttributes={{ 'data-cad-parcel-network': def?.key ?? 'unavailable' }}
    />
  );
};

export const CadParcelNetworkRibbonGroup: React.FC<{
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
}> = ({ snapshot, actions }) => {
  const [openKey, setOpenKey] = useState<string | null>(null);
  return (
    <div className="cad-shell-ribbon-group" aria-label="Parcel Network">
      <span className="cad-shell-ribbon-group-label">Network</span>
      <div className="cad-shell-ribbon-buttons">
        {PARCEL_NETWORK_ENTRIES.map((entry) => {
          const def = defFor(entry.key);
          const secondaries = entry.secondary
            .map((key) => defFor(key))
            .filter((candidate): candidate is CadShellCommandDef => candidate != null);
          if (secondaries.length === 0) {
            return <RibbonButton key={entry.key} def={def} snapshot={snapshot} actions={actions} />;
          }
          const open = openKey === entry.key;
          return (
            <div key={entry.key} className="cad-shell-ribbon-split">
              <RibbonButton def={def} snapshot={snapshot} actions={actions} />
              <button
                type="button"
                className="cad-shell-ribbon-split-caret"
                aria-label={`More ${def?.label ?? entry.key} actions`}
                aria-expanded={open}
                title={`More actions (${secondaries.map((item) => item.label).join(', ')})`}
                onClick={() => setOpenKey(open ? null : entry.key)}
                data-cad-parcel-network-caret={entry.key}
              >
                ▾
              </button>
              {open ? (
                <div role="menu" className="cad-shell-menu cad-shell-ribbon-split-menu">
                  {secondaries.map((item) => (
                    <RibbonButton
                      key={item.key}
                      def={item}
                      snapshot={snapshot}
                      actions={actions}
                      secondary
                      onAfterRun={() => setOpenKey(null)}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};
