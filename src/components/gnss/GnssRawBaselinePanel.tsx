/**
 * Phase 12J.4 — raw static baseline processing workflow panel.
 *
 * File slots → options → preflight gate → dedicated-worker run with
 * 7-stage progress → review/export. Review only: this panel never adds to
 * the project, never reruns any solve, and imports no project state.
 */
import React, { useMemo } from 'react';
import { GNSS_RAW_PROGRESS_STAGES } from '../../engine/gnssRawRnx2rtkp';
import { buildRawBaselineExport } from '../../engine/gnssRawExport';
import type { PreflightOk } from '../../engine/gnssRawPreflight';
import { FORMAL_PRECISION_NOTICE } from '../../engine/gnssRawTypes';
import { useGnssRawBaseline } from '../../hooks/useGnssRawBaseline';
import { GnssRawFileSlots } from './GnssRawFileSlots';
import { GnssRawOptionsForm } from './GnssRawOptionsForm';
import { GnssRawReview } from './GnssRawReview';

export const GnssRawBaselinePanel: React.FC = () => {
  const hook = useGnssRawBaseline();
  const { preflight, status, stage, result, runError, fileError } = hook;
  const gateError = preflight && 'code' in preflight ? preflight : null;
  const ok = preflight && !('code' in preflight) ? (preflight as PreflightOk) : null;

  const exportDoc = useMemo(() => {
    if (!result || !ok) return null;
    return buildRawBaselineExport(
      ok.base,
      ok.rover,
      {
        elevationMaskDegrees: hook.options.elevationMaskDegrees,
        intervalRequested:
          hook.options.intervalMode === 'AUTO' ? 'AUTO' : hook.options.intervalSeconds,
        ephemerisRequested: hook.options.ephemeris,
        windowStart: hook.options.windowStart.trim() === '' ? null : hook.options.windowStart.trim(),
        windowStop: hook.options.windowStop.trim() === '' ? null : hook.options.windowStop.trim(),
      },
      result,
    );
  }, [result, ok, hook.options]);

  const stageIndex = stage ? GNSS_RAW_PROGRESS_STAGES.indexOf(stage) : -1;

  return (
    <div data-testid="raw-baseline-panel" className="space-y-3 p-4">
      <div className="text-xs text-slate-400">
        <p>
          Raw static baseline processing converts simultaneous RINEX observation files into
          an ECEF baseline vector that still needs review before use.
        </p>
        <p className="mt-1">{FORMAL_PRECISION_NOTICE}</p>
      </div>
      <GnssRawFileSlots
        base={hook.base} rover={hook.rover} nav={hook.nav} sp3={hook.sp3}
        preflight={hook.preflight}
        onBase={(file) => void hook.setBaseFile(file)}
        onRover={(file) => void hook.setRoverFile(file)}
        onNav={(files) => void hook.addNavFiles(files)}
        onSp3={(file) => void hook.setSp3File(file)}
        onClearNav={hook.clearNav} onClearSp3={hook.clearSp3} onSwap={hook.swap}
      />
      <GnssRawOptionsForm options={hook.options} onChange={hook.setOptions} />
      {fileError && <div data-testid="raw-file-error" className="text-xs text-red-300">{fileError}</div>}
      {gateError && (
        <div data-testid="raw-preflight-error" className="text-xs text-red-300">
          {gateError.code}: {gateError.message}
          {gateError.detail && <span className="block text-slate-400">{gateError.detail}</span>}
        </div>
      )}
      {ok && ok.warnings.map((warning) => (
        <div key={warning} className="text-xs text-amber-300">{warning}</div>
      ))}
      <div className="flex items-center gap-2">
        <button type="button" data-testid="raw-process" onClick={hook.run}
          disabled={!ok || status === 'running'}
          className="px-2 py-1 text-xs border border-slate-600 rounded hover:bg-slate-700 disabled:opacity-40">
          Process baseline
        </button>
        {status === 'running' && (
          <button type="button" data-testid="raw-cancel" onClick={hook.cancel}
            className="px-2 py-1 text-xs border border-slate-600 rounded hover:bg-slate-700">
            Cancel
          </button>
        )}
        {(status === 'done' || status === 'failed' || status === 'cancelled') && (
          <button type="button" data-testid="raw-reset" onClick={hook.reset}
            className="px-2 py-1 text-xs border border-slate-600 rounded hover:bg-slate-700">
            Reset
          </button>
        )}
      </div>
      {status === 'running' && (
        <div data-testid="raw-progress" className="text-xs text-slate-300">
          Stage {stageIndex + 1}/7: {stage ?? 'starting…'}
        </div>
      )}
      {runError && (
        <div data-testid="raw-run-error" className="text-xs text-red-300">
          {runError.code}: {runError.message}
        </div>
      )}
      {status === 'cancelled' && (
        <div data-testid="raw-cancelled" className="text-xs text-slate-400">
          Run cancelled — no result was kept.
        </div>
      )}
      {result && <GnssRawReview result={result} exportDoc={exportDoc} />}
    </div>
  );
};
