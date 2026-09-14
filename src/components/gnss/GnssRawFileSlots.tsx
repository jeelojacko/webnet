/**
 * Phase 12J.4 — role-explicit file slots + parsed metadata table.
 *
 * BASE / ROVER / NAV (+optional SP3). Per-file metadata (marker, version,
 * span, interval, approx XYZ, antenna HEN/model, receiver, constellations,
 * signals) comes from the preflight gate; NAV/SP3 rows show name + hash.
 */
import React from 'react';
import type { PreflightOk } from '../../engine/gnssRawPreflight';
import type { RawGnssProcessingError } from '../../engine/gnssRawTypes';
import type { RawFileEntry } from '../../hooks/useGnssRawBaseline';

interface FileSlotsProps {
  readonly base: RawFileEntry | null;
  readonly rover: RawFileEntry | null;
  readonly nav: RawFileEntry[];
  readonly sp3: RawFileEntry | null;
  readonly ephemeris: 'BROADCAST' | 'PRECISE';
  readonly preflight: PreflightOk | RawGnssProcessingError | null;
  readonly onBase: (_file: File) => void;
  readonly onRover: (_file: File) => void;
  readonly onNav: (_files: File[]) => void;
  readonly onSp3: (_file: File) => void;
  readonly onClearNav: (_index: number) => void;
  readonly onClearSp3: () => void;
  readonly onSwap: () => void;
}

const pickOne = (event: React.ChangeEvent<HTMLInputElement>, fn: (_file: File) => void): void => {
  const file = event.target.files?.[0];
  if (file) fn(file);
  event.target.value = '';
};

const pickMany = (event: React.ChangeEvent<HTMLInputElement>, fn: (_files: File[]) => void): void => {
  const files = event.target.files ? [...event.target.files] : [];
  if (files.length > 0) fn(files);
  event.target.value = '';
};

const fmtXyz = (xyz: [number, number, number] | null): string =>
  xyz ? xyz.map((v) => v.toFixed(3)).join(', ') : '—';

export const GnssRawFileSlots: React.FC<FileSlotsProps> = ({
  base, rover, nav, sp3, ephemeris, preflight, onBase, onRover, onNav, onSp3, onClearNav, onClearSp3, onSwap,
}) => {
  const ok = preflight && !('code' in preflight) ? preflight : null;
  const broadcast = ephemeris === 'BROADCAST';
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <label className="block text-xs text-slate-300">
          BASE observation (RINEX)
          <input type="file" data-testid="raw-base-input" accept=".obs,.06o,.24o,.rnx,.txt"
            onChange={(e) => pickOne(e, onBase)} className="mt-1 block w-full text-xs text-slate-400" />
          {base && <span className="text-slate-400">{base.fileName} ({base.bytes.byteLength} B)</span>}
        </label>
        <label className="block text-xs text-slate-300">
          ROVER observation (RINEX)
          <input type="file" data-testid="raw-rover-input" accept=".obs,.06o,.24o,.rnx,.txt"
            onChange={(e) => pickOne(e, onRover)} className="mt-1 block w-full text-xs text-slate-400" />
          {rover && <span className="text-slate-400">{rover.fileName} ({rover.bytes.byteLength} B)</span>}
        </label>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <label className="block text-xs text-slate-300">
          NAV broadcast ephemeris (one or more)
          <input type="file" data-testid="raw-nav-input" multiple accept=".nav,.06n,.rnx,.txt"
            onChange={(e) => pickMany(e, onNav)} className="mt-1 block w-full text-xs text-slate-400" />
          {nav.map((entry, i) => (
            <span key={entry.sha256} className="block text-slate-400">
              {entry.fileName}{' '}
              <button type="button" onClick={() => onClearNav(i)} className="underline">remove</button>
            </span>
          ))}
        </label>
        <label className={`block text-xs ${broadcast ? 'text-slate-500' : 'text-slate-300'}`}>
          SP3 precise ephemeris (optional; required for precise mode)
          <input type="file" data-testid="raw-sp3-input" accept=".sp3,.txt" disabled={broadcast}
            onChange={(e) => pickOne(e, onSp3)} className="mt-1 block w-full text-xs text-slate-400 disabled:opacity-40" />
          {broadcast && (
            <span data-testid="raw-sp3-hint" className="block text-slate-500">
              SP3 is only used with Precise ephemeris.
            </span>
          )}
          {sp3 && (
            <span className="text-slate-400">{sp3.fileName}{' '}
              <button type="button" onClick={onClearSp3} className="underline">remove</button>
            </span>
          )}
        </label>
      </div>
      <div className="flex items-center gap-3 text-xs">
        <button type="button" data-testid="raw-swap" onClick={onSwap} disabled={!base || !rover}
          className="px-2 py-1 border border-slate-600 rounded hover:bg-slate-700 disabled:opacity-40">
          Swap base/rover
        </button>
        {ok && (
          <span data-testid="raw-common-span" className="text-slate-300">
            Common span {ok.commonStart} .. {ok.commonStop} · interval {ok.resolvedInterval}s
          </span>
        )}
      </div>
      {ok && (
        <table data-testid="raw-metadata-table" className="w-full text-xs text-slate-300 border border-slate-700">
          <thead>
            <tr className="bg-slate-800">
              <th className="p-1 text-left">File</th><th className="p-1 text-left">Marker</th>
              <th className="p-1 text-left">Version</th><th className="p-1 text-left">Span</th>
              <th className="p-1 text-left">Interval</th><th className="p-1 text-left">Approx XYZ</th>
              <th className="p-1 text-left">Antenna</th><th className="p-1 text-left">Receiver</th>
              <th className="p-1 text-left">Const/Signals</th>
            </tr>
          </thead>
          <tbody>
            {[ok.base, ok.rover].map((meta) => (
              <tr key={meta.role} className="border-t border-slate-700">
                <td className="p-1">{meta.role} {meta.fileName}</td>
                <td className="p-1">{meta.marker ?? '—'}</td>
                <td className="p-1">{meta.rinexVersion ?? '—'}</td>
                <td className="p-1">{meta.firstEpoch ?? '—'} .. {meta.lastEpoch ?? '—'}</td>
                <td className="p-1">{meta.intervalSeconds ?? '—'}</td>
                <td className="p-1">{fmtXyz(meta.approxXyz)}</td>
                <td className="p-1">{meta.antennaModel || '—'} H={meta.antennaHeight ?? '—'}</td>
                <td className="p-1">{meta.receiverModel ?? '—'}</td>
                <td className="p-1">{meta.constellations.join(',')} / {meta.signals.join(',')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
