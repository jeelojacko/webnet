import React from 'react';
import type { OccupationEntry } from './GnssRawSessionPanel.utils';
import type {
  SessionAntennaTable,
  SessionWindowResult,
} from '../../engine/gnssRawSessionModel';
import type { SessionGraph } from '../../engine/gnssRawSessionGraph';

export type RawSessionTreePolicy = 'STAR' | 'MST' | 'MANUAL';

export interface RawGnssSessionGraphControlsProps {
  readonly locked: boolean;
  readonly occupations: OccupationEntry[];
  readonly policy: RawSessionTreePolicy;
  readonly base: string;
  readonly manualText: string;
  readonly markers: string[];
  readonly explicitWindow: boolean;
  readonly windowResult: SessionWindowResult | null;
  readonly graph: SessionGraph | null;
  readonly graphErrors: string[] | null;
  readonly antennas: SessionAntennaTable | null;
  readonly antexWarning: string | null;
  readonly onPolicy: (_policy: RawSessionTreePolicy) => void;
  readonly onBase: (_base: string) => void;
  readonly onManualText: (_text: string) => void;
}

/** Phase 12J.10 — tree picker + window + edges + antennas extracted, unchanged. */
export const RawGnssSessionGraphControls: React.FC<RawGnssSessionGraphControlsProps> = ({
  locked, occupations, policy, base, manualText, markers, explicitWindow,
  windowResult, graph, graphErrors, antennas, antexWarning,
  onPolicy, onBase, onManualText,
}) => (
  <>
    {occupations.length > 0 && (
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
        <label className="block">Tree policy
          <select data-testid="raw-session-policy" value={policy}
            disabled={locked}
            onChange={(e) => onPolicy(e.target.value as RawSessionTreePolicy)}
            className="ml-1 bg-slate-800 border border-slate-600 px-1 py-0.5">
            <option value="STAR">STAR</option>
            <option value="MST">MST</option>
            <option value="MANUAL">MANUAL</option>
          </select>
        </label>
        <label className="block">Base
          <select data-testid="raw-session-base" value={base}
            disabled={locked}
            onChange={(e) => onBase(e.target.value)}
            className="ml-1 bg-slate-800 border border-slate-600 px-1 py-0.5">
            <option value="">auto (first marker)</option>
            {markers.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        {policy === 'MST' && <span className="text-slate-500">MST ignores the base selector.</span>}
        {windowResult?.ok && (
          <span data-testid="raw-session-window" className="text-slate-300">
            Window {explicitWindow ? 'EXPLICIT' : 'AUTO'} · {windowResult.start} .. {windowResult.stop}
          </span>
        )}
        {windowResult && !windowResult.ok && (
          <span data-testid="raw-session-window-error" className="text-red-300">{windowResult.message}</span>
        )}
      </div>
    )}
    {policy === 'MANUAL' && (
      <label className="block text-xs text-slate-300">Manual legs (one FROM-TO per line)
        <textarea data-testid="raw-session-manual" value={manualText}
          disabled={locked}
          onChange={(e) => onManualText(e.target.value)} rows={3}
          className="mt-1 block w-full bg-slate-800 border border-slate-600 px-1 py-0.5" />
      </label>
    )}
    {graph && (
      <div data-testid="raw-session-edges" className="text-xs text-slate-300">
        {graph.kind} · {graph.edges.map((e) => `${e.from}→${e.to}`).join(', ') || 'no legs'}
      </div>
    )}
    {graphErrors && (
      <div data-testid="raw-session-graph-error" className="text-xs text-red-300">
        {graphErrors.join('; ')}
      </div>
    )}
    {antennas && (
      <div>
        <table data-testid="raw-session-antennas" className="w-full text-xs text-slate-300 border border-slate-700">
          <thead>
            <tr className="bg-slate-800">
              <th className="p-1 text-left">Station</th><th className="p-1 text-left">Antenna</th>
              <th className="p-1 text-left">Radome</th><th className="p-1 text-left">Resolution</th>
            </tr>
          </thead>
          <tbody>
            {antennas.stations.map((s) => (
              <tr key={s.marker} className="border-t border-slate-700">
                <td className="p-1">{s.marker}</td>
                <td className="p-1">{s.model.split(/\s+/)[0] || '—'}</td>
                <td className="p-1">{s.model.split(/\s+/).slice(1).join(' ') || '—'}</td>
                <td className="p-1">{s.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {antennas.overall !== 'COMPLETE' && (
          <div data-testid="raw-session-antenna-banner" className="text-xs text-amber-300">
            Antenna calibration {antennas.overall}: formal precision only, nothing substituted.
            {antexWarning && <span className="block">{antexWarning}</span>}
          </div>
        )}
      </div>
    )}
  </>
);
