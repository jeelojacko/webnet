/**
 * Phase 12J.4 — raw static-baseline options form.
 *
 * Defaults: static GPS L1/L2, elevation mask 10°, interval AUTO, broadcast
 * ephemeris. Advanced (bounded): mask number, explicit interval,
 * broadcast/precise toggle (precise without SP3 fails closed at preflight),
 * optional time window within the common span.
 */
import React from 'react';
import type { RawBaselineOptions } from '../../hooks/useGnssRawBaseline';

interface OptionsProps {
  readonly options: RawBaselineOptions;
  readonly onChange: (_next: RawBaselineOptions) => void;
}

const num = (value: string, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const GnssRawOptionsForm: React.FC<OptionsProps> = ({ options, onChange }) => (
  <fieldset className="border border-slate-700 p-2 text-xs text-slate-300">
    <legend className="px-1">Processing options (static GPS L1/L2)</legend>
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
      <label className="block">
        Elevation mask (°)
        <input type="number" data-testid="raw-mask" min={0} max={30} step={1}
          value={options.elevationMaskDegrees}
          onChange={(e) => onChange({ ...options, elevationMaskDegrees: num(e.target.value, 10) })}
          className="mt-1 block w-full bg-slate-800 border border-slate-600 px-1 py-0.5" />
      </label>
      <label className="block">
        Interval
        <select data-testid="raw-interval-mode" value={options.intervalMode}
          onChange={(e) => onChange({ ...options, intervalMode: e.target.value as 'AUTO' | 'EXPLICIT' })}
          className="mt-1 block w-full bg-slate-800 border border-slate-600 px-1 py-0.5">
          <option value="AUTO">AUTO (from epochs)</option>
          <option value="EXPLICIT">Explicit</option>
        </select>
      </label>
      {options.intervalMode === 'EXPLICIT' && (
        <label className="block">
          Interval (s)
          <input type="number" data-testid="raw-interval" min={1} max={3600} step={1}
            value={options.intervalSeconds}
            onChange={(e) => onChange({ ...options, intervalSeconds: num(e.target.value, 30) })}
            className="mt-1 block w-full bg-slate-800 border border-slate-600 px-1 py-0.5" />
        </label>
      )}
      <label className="block">
        Ephemeris
        <select data-testid="raw-ephemeris" value={options.ephemeris}
          onChange={(e) => onChange({ ...options, ephemeris: e.target.value as 'BROADCAST' | 'PRECISE' })}
          className="mt-1 block w-full bg-slate-800 border border-slate-600 px-1 py-0.5">
          <option value="BROADCAST">Broadcast (NAV)</option>
          <option value="PRECISE">Precise (SP3 required)</option>
        </select>
      </label>
      <label className="block">
        Window start (optional ISO)
        <input type="text" data-testid="raw-window-start" value={options.windowStart} placeholder="within common span"
          onChange={(e) => onChange({ ...options, windowStart: e.target.value })}
          className="mt-1 block w-full bg-slate-800 border border-slate-600 px-1 py-0.5" />
      </label>
      <label className="block">
        Window stop (optional ISO)
        <input type="text" data-testid="raw-window-stop" value={options.windowStop} placeholder="within common span"
          onChange={(e) => onChange({ ...options, windowStop: e.target.value })}
          className="mt-1 block w-full bg-slate-800 border border-slate-600 px-1 py-0.5" />
      </label>
    </div>
  </fieldset>
);
