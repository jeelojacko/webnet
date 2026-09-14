import React from 'react';
import {
  coverageText,
  durationText,
  type OccupationEntry,
} from './GnssRawSessionPanel.utils';
import type { SessionWindowResult } from '../../engine/gnssRawSessionModel';

export interface RawGnssSessionInventoryProps {
  readonly occupations: OccupationEntry[];
  readonly windowResult: SessionWindowResult | null;
  readonly duplicates: string[];
}

/** Phase 12J.10 — inventory table + duplicates extracted, unchanged. */
export const RawGnssSessionInventory: React.FC<RawGnssSessionInventoryProps> = ({
  occupations, windowResult, duplicates,
}) => (
  <>
    {occupations.length > 0 && (
      <table data-testid="raw-session-inventory" className="w-full text-xs text-slate-300 border border-slate-700">
        <thead>
          <tr className="bg-slate-800">
            <th className="p-1 text-left">Station</th><th className="p-1 text-left">Start</th>
            <th className="p-1 text-left">Stop</th><th className="p-1 text-left">Duration</th>
            <th className="p-1 text-left">Coverage</th>
          </tr>
        </thead>
        <tbody>
          {occupations.map((o) => {
            const key = o.meta.marker ?? o.fileName;
            const shortened = windowResult?.ok
              && ((o.meta.firstEpoch ?? '') < windowResult.start || (o.meta.lastEpoch ?? '') > windowResult.stop);
            return (
              <tr key={`${key}-${o.meta.sha256}`} className="border-t border-slate-700">
                <td className="p-1">{key}</td>
                <td className="p-1">{o.meta.firstEpoch ?? '—'}</td>
                <td className="p-1">{o.meta.lastEpoch ?? '—'}</td>
                <td className="p-1">{durationText(o.meta.firstEpoch, o.meta.lastEpoch)}</td>
                <td className="p-1">
                  {windowResult?.ok
                    ? coverageText(o.meta.firstEpoch, o.meta.lastEpoch, windowResult.start, windowResult.stop)
                    : '—'}
                  {shortened && <span className="ml-1 text-amber-300">shortened</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    )}
    {duplicates.length > 0 && (
      <div data-testid="raw-session-duplicates" className="text-xs text-amber-300">
        <ul className="list-disc pl-5">{duplicates.map((d) => <li key={d}>{d}</li>)}</ul>
      </div>
    )}
  </>
);
