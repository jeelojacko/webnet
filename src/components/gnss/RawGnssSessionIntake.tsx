import React from 'react';
import { readSessionAntexEntry } from './GnssRawSessionPanel.utils';
import type { GnssAntexSubsetResult } from '../../engine/gnssAntexSubset';
import { readFileEntry, type RawFileEntry } from '../../hooks/useGnssRawBaseline';
import type { RawSessionAntexEntry } from '../../hooks/useRawGnssSessionProcessing';

export interface RawGnssSessionIntakeProps {
  readonly locked: boolean;
  readonly obs: RawFileEntry[];
  readonly nav: RawFileEntry[];
  readonly sp3: RawFileEntry | null;
  readonly antexFile: RawSessionAntexEntry | null;
  readonly antexLabel: string;
  readonly antexResult: GnssAntexSubsetResult | null;
  readonly antexWarning: string | null;
  readonly fileError: string | null;
  readonly onAddFiles: (_files: File[], _kind: 'obs' | 'nav') => void;
  readonly onRemoveObs: (_sha256: string) => void;
  readonly onRemoveNav: (_sha256: string) => void;
  readonly onSp3: (_entry: RawFileEntry | null) => void;
  readonly onAntexEntry: (_entry: RawSessionAntexEntry) => void;
  readonly onClearAntex: () => void;
  readonly onAntexLabel: (_label: string) => void;
  readonly onFileError: (_message: string) => void;
}

const pickMany = (
  event: React.ChangeEvent<HTMLInputElement>, fn: (_files: File[]) => void,
): void => {
  const files = event.target.files ? [...event.target.files] : [];
  if (files.length > 0) void fn(files);
  event.target.value = '';
};

/** Phase 12J.10 — file slots extracted from GnssRawSessionPanel, unchanged. */
export const RawGnssSessionIntake: React.FC<RawGnssSessionIntakeProps> = ({
  locked, obs, nav, sp3, antexFile, antexLabel, antexResult, antexWarning, fileError,
  onAddFiles, onRemoveObs, onRemoveNav, onSp3, onAntexEntry, onClearAntex, onAntexLabel, onFileError,
}) => (
  <>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-slate-300">
      <label className="block">
        Observation files (2–20 RINEX .o/.obs)
        <input type="file" data-testid="raw-session-obs-input" multiple accept=".o,.obs,.06o,.24o,.rnx,.txt"
          disabled={locked}
          onChange={(e) => pickMany(e, (f) => onAddFiles(f, 'obs'))}
          className="mt-1 block w-full text-xs text-slate-400" />
        {obs.map((e) => (
          <span key={e.sha256} className="block text-slate-400">{e.fileName}{' '}
            <button type="button" disabled={locked} onClick={() => onRemoveObs(e.sha256)}
              className="underline">remove</button>
          </span>
        ))}
      </label>
      <label className="block">
        NAV broadcast ephemeris (one or more)
        <input type="file" data-testid="raw-session-nav-input" multiple accept=".nav,.06n,.rnx,.txt"
          disabled={locked}
          onChange={(e) => pickMany(e, (f) => onAddFiles(f, 'nav'))}
          className="mt-1 block w-full text-xs text-slate-400" />
        {nav.map((e) => (
          <span key={e.sha256} className="block text-slate-400">{e.fileName}{' '}
            <button type="button" disabled={locked} onClick={() => onRemoveNav(e.sha256)}
              className="underline">remove</button>
          </span>
        ))}
      </label>
      <label className="block">
        SP3 precise ephemeris (optional)
        <input type="file" data-testid="raw-session-sp3-input" accept=".sp3,.txt"
          disabled={locked}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void readFileEntry(f).then(onSp3, (err: unknown) =>
              onFileError(err instanceof Error ? err.message : String(err)));
            e.target.value = '';
          }}
          className="mt-1 block w-full text-xs text-slate-400" />
        {sp3 && <span className="block text-slate-400">{sp3.fileName}{' '}
          <button type="button" disabled={locked} onClick={() => onSp3(null)} className="underline">remove</button></span>}
      </label>
      <label className="block">
        ANTEX antenna calibration (optional)
        <input type="file" data-testid="raw-session-antex-input" accept=".atx,.txt"
          disabled={locked}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void readSessionAntexEntry(f).then((entry) => {
              onAntexEntry(entry);
              if (antexLabel === '') onAntexLabel(entry.fileName);
            }, (err: unknown) =>
              onFileError(err instanceof Error ? err.message : String(err)));
            e.target.value = '';
          }}
          className="mt-1 block w-full text-xs text-slate-400" />
        {antexFile && <span className="block text-slate-400">{antexFile.fileName}{' '}
          <button type="button" disabled={locked} onClick={onClearAntex}
            className="underline">remove</button></span>}
        {antexResult && (
          <span data-testid="raw-session-antex-info" className="block text-slate-400">
            subset {antexResult.subsetSha256.slice(0, 16)}… · {antexResult.subsetSizeBytes} bytes ·
            {' '}{antexResult.receiverSerials.join(', ') || 'satellites only'}
          </span>
        )}
        {antexWarning && (
          <span data-testid="raw-session-antex-warning" className="block text-amber-300">
            {antexWarning}
          </span>
        )}
      </label>
      <label className="block">
        ANTEX label (provenance only, optional)
        <input type="text" data-testid="raw-session-antex" value={antexLabel}
          disabled={locked}
          onChange={(e) => onAntexLabel(e.target.value)} placeholder="e.g. igs20.atx"
          className="mt-1 block w-full bg-slate-800 border border-slate-600 px-1 py-0.5" />
      </label>
    </div>
    {fileError && <div data-testid="raw-session-file-error" className="text-xs text-red-300">{fileError}</div>}
  </>
);
