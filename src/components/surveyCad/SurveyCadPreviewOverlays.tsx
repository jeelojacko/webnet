import React from 'react';
import type { CadSnapCandidate, CadSnapKind } from '../../engine/cad/cadTypes';
import type { CadSnapPreferences } from '../../hooks/surveyCad/useSurveyCadSnapping';
import { SNAP_BADGE_LABELS, SNAP_MENU_LABELS } from './SurveyCadPreview.constants';

type PreviewAccent = { stroke: string; fill: string; text: string } | null;

export const SurveyCadCommandHelpOverlay: React.FC<{
  commandStatusText: string;
  commandHelpText: string;
  commandInputEnabled: boolean;
  commandModifierHint: string;
  constructionHint: string;
}> = ({
  commandStatusText,
  commandHelpText,
  commandInputEnabled,
  commandModifierHint,
  constructionHint,
}) => (
  <>
    <div
      className="pointer-events-none absolute bottom-16 left-1/2 w-[min(44rem,calc(100%-12rem))] -translate-x-1/2 text-center text-[11px] leading-4 text-slate-300"
      data-survey-cad-command-help
    >
      {commandStatusText ? (
        <>
          <div className="pb-1 text-cyan-200" data-survey-cad-command-status>
            {commandStatusText}
          </div>
          {commandInputEnabled ? <div>{commandHelpText}</div> : null}
        </>
      ) : null}
    </div>
    {commandModifierHint ? (
      <div
        className="pointer-events-none absolute bottom-3 right-16 rounded border border-amber-500/30 bg-slate-950/88 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-200"
        data-survey-cad-command-modifier-hint
      >
        {commandModifierHint}
      </div>
    ) : null}
    {constructionHint ? (
      <div
        className="pointer-events-none absolute right-16 top-16 rounded border border-cyan-500/25 bg-slate-950/88 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-cyan-100"
        data-survey-cad-construction-hint
      >
        {constructionHint}
      </div>
    ) : null}
  </>
);

export const SurveyCadSnapBadge: React.FC<{
  activeSnap: CadSnapCandidate | null;
  activeSnapAccent: PreviewAccent;
}> = ({ activeSnap, activeSnapAccent }) =>
  activeSnap ? (
    <div
      className="pointer-events-none absolute left-3 top-16 rounded border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]"
      style={{
        borderColor: activeSnapAccent?.stroke ?? '#fbbf24',
        backgroundColor: activeSnapAccent?.fill ?? '#0f172a',
        color: activeSnapAccent?.text ?? '#fef3c7',
      }}
      data-survey-cad-snap-badge
    >
      {SNAP_BADGE_LABELS[activeSnap.kind]}: {activeSnap.label}
    </div>
  ) : null;

export const SurveyCadSnapControls: React.FC<{
  snapMenuOpen: boolean;
  setSnapMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  showParcelLabels: boolean;
  snapPreferences: CadSnapPreferences;
  onToggleParcelLabels: () => void;
  onSnapPreferenceChange: (_kind: CadSnapKind, _enabled: boolean) => void;
}> = ({
  snapMenuOpen,
  setSnapMenuOpen,
  showParcelLabels,
  snapPreferences,
  onToggleParcelLabels,
  onSnapPreferenceChange,
}) => (
  <div className="absolute bottom-3 right-3 flex items-center gap-2" data-survey-cad-snap-menu>
    {snapMenuOpen ? (
      <div className="absolute bottom-9 right-0 mb-1 w-44 rounded border border-slate-700 bg-slate-950/95 p-2 shadow-xl">
        <div className="pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
          Object Snaps
        </div>
        {Object.entries(SNAP_MENU_LABELS).map(([kind, label]) => {
          const snapKind = kind as CadSnapKind;
          return (
            <label
              key={snapKind}
              className="flex cursor-pointer items-center justify-between gap-3 py-1 text-xs text-slate-200"
            >
              <span>{label}</span>
              <input
                type="checkbox"
                checked={snapPreferences[snapKind]}
                onChange={(event) => onSnapPreferenceChange(snapKind, event.target.checked)}
                data-survey-cad-snap-toggle={snapKind}
              />
            </label>
          );
        })}
      </div>
    ) : null}
    <button
      type="button"
      className={`rounded border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors ${
        showParcelLabels
          ? 'border-cyan-500/80 bg-cyan-500/10 text-cyan-100'
          : 'border-slate-700/90 bg-slate-950/90 text-slate-300 hover:border-cyan-500/80'
      }`}
      onClick={onToggleParcelLabels}
      data-survey-cad-parcel-label-toggle
    >
      Parcel Labels
    </button>
    <button
      type="button"
      className="rounded border border-slate-700/90 bg-slate-950/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-200 transition-colors hover:border-cyan-500/80"
      onClick={() => setSnapMenuOpen((current) => !current)}
      data-survey-cad-snap-menu-button
    >
      Snaps
    </button>
  </div>
);

export const SurveyCadCommandInputBar: React.FC<{
  commandInputRef: React.RefObject<HTMLInputElement | null>;
  commandInputValue: string;
  commandInputPlaceholder: string;
  commandInputEnabled: boolean;
  onCommandInputChange: (_value: string) => void;
  onCommandInputEnter: () => void;
  onCommandInputEscape: () => void;
}> = ({
  commandInputRef,
  commandInputValue,
  commandInputPlaceholder,
  commandInputEnabled,
  onCommandInputChange,
  onCommandInputEnter,
  onCommandInputEscape,
}) => (
  <div className="absolute bottom-3 left-1/2 w-[min(32rem,calc(100%-12rem))] -translate-x-1/2">
    <input
      ref={commandInputRef}
      type="text"
      value={commandInputValue}
      onChange={(event) => onCommandInputChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onCommandInputEnter();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          onCommandInputEscape();
        }
      }}
      placeholder={commandInputPlaceholder}
      className="w-full rounded border border-slate-700/90 bg-slate-950/90 px-3 py-2 text-xs text-slate-100 outline-none transition-colors placeholder:text-slate-500 focus:border-cyan-500/80"
      disabled={!commandInputEnabled}
      data-survey-cad-command-input
    />
  </div>
);
