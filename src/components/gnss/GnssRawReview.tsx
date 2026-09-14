/**
 * Phase 12J.4 — review screen for a processed raw static baseline.
 *
 * Shows baseline markers, session start/stop/duration + interval
 * requested/resolved, solution FIXED/FLOAT/FAILED, dX/dY/dZ + length,
 * ratio/fixed-used epochs/sats, ephemeris requested/used, antenna base +
 * rover status, full 3x3 covariance + formal sigmas with the canonical
 * FORMAL_PRECISION_NOTICE wording and FORMAL_UNCALIBRATED badge, plus
 * expandable diagnostics and provenance with hashes.
 *
 * Export policy: FIXED → authoritative JSON; FLOAT → diagnostic JSON only,
 * clearly NOT EXPORTABLE as a survey baseline; FAILED → no export.
 */
import React from 'react';
import {
  downloadTextFile,
  isAuthoritativeExportable,
  isDiagnosticExportable,
  serializeRawBaselineExport,
  type RawBaselineExport,
} from '../../engine/gnssRawExport';
import {
  FORMAL_PRECISION_NOTICE,
  type ProcessedRawGnssBaseline,
} from '../../engine/gnssRawTypes';

interface ReviewProps {
  readonly result: ProcessedRawGnssBaseline;
  readonly exportDoc: RawBaselineExport | null;
}

const fmt = (v: number, digits = 4): string =>
  Number.isFinite(v) ? v.toFixed(digits) : '—';

const durationText = (start: string, stop: string): string => {
  const ms = Date.parse(stop) - Date.parse(start);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  return `${Math.round(ms / 1000)} s`;
};

export const GnssRawReview: React.FC<ReviewProps> = ({ result, exportDoc }) => {
  const cov = result.covariance;
  const sigma = (v: number): number => (v >= 0 && Number.isFinite(v) ? Math.sqrt(v) : NaN);
  const authoritative = isAuthoritativeExportable(result);
  const diagnosticOnly = isDiagnosticExportable(result);
  const download = (kind: 'authoritative' | 'diagnostic'): void => {
    if (!exportDoc) return;
    const name = `raw-baseline-${result.from}-${result.to}-${result.status}.json`;
    downloadTextFile(name, serializeRawBaselineExport(exportDoc));
    void kind;
  };
  return (
    <div data-testid="raw-review" className="space-y-2 text-xs text-slate-200">
      <div className="flex flex-wrap items-center gap-2">
        <span data-testid="raw-solution" className="font-semibold">Solution: {result.status}</span>
        <span data-testid="raw-formal-badge" className="px-1 border border-amber-500 text-amber-300">
          FORMAL_UNCALIBRATED
        </span>
        <span data-testid="raw-baseline-markers">{result.from} → {result.to}</span>
      </div>
      <div data-testid="raw-session">
        Session {result.start} .. {result.stop} ({durationText(result.start, result.stop)}) ·
        interval requested {String(result.provenance.intervalRequested)} /
        resolved {result.provenance.intervalResolved}s
      </div>
      <div data-testid="raw-vector">
        dX {fmt(result.deltaX)} m · dY {fmt(result.deltaY)} m · dZ {fmt(result.deltaZ)} m ·
        length {fmt(result.baselineLength, 4)} m
      </div>
      <div data-testid="raw-quality">
        ratio {result.solutionQuality.ratio ?? '—'} · fixed epochs{' '}
        {result.solutionQuality.fixedEpochs ?? '—'}/{result.solutionQuality.usedEpochs} ·
        sats {result.solutionQuality.satellites} · acceptance {result.acceptance}
      </div>
      <div data-testid="raw-ephemeris">
        Ephemeris requested {result.provenance.ephemerisRequested} /
        used {result.provenance.ephemerisUsed} · frame {result.referenceFrame} ·
        {result.coordinateReference}
      </div>
      <div data-testid="raw-antenna">
        Base {result.antennaAssessment.base.marker} [{result.antennaAssessment.base.model || 'unknown'}]{' '}
        {result.antennaAssessment.base.calibration} · Rover {result.antennaAssessment.rover.marker}{' '}
        [{result.antennaAssessment.rover.model || 'unknown'}] {result.antennaAssessment.rover.calibration}
        {result.antennaAssessment.warning && (
          <span className="block text-amber-300">{result.antennaAssessment.warning}</span>
        )}
      </div>
      <table data-testid="raw-covariance" className="border border-slate-700 text-xs">
        <caption className="text-left text-slate-400">
          Formal covariance (m²) — {FORMAL_PRECISION_NOTICE}
          <span className="block">
            Formal σx {fmt(sigma(cov.xx), 6)} m · σy {fmt(sigma(cov.yy), 6)} m · σz{' '}
            {fmt(sigma(cov.zz), 6)} m
          </span>
        </caption>
        <tbody>
          <tr><td className="p-1">{fmt(cov.xx, 9)}</td><td className="p-1">{fmt(cov.xy, 9)}</td><td className="p-1">{fmt(cov.xz, 9)}</td></tr>
          <tr><td className="p-1">{fmt(cov.xy, 9)}</td><td className="p-1">{fmt(cov.yy, 9)}</td><td className="p-1">{fmt(cov.yz, 9)}</td></tr>
          <tr><td className="p-1">{fmt(cov.xz, 9)}</td><td className="p-1">{fmt(cov.yz, 9)}</td><td className="p-1">{fmt(cov.zz, 9)}</td></tr>
        </tbody>
      </table>
      <details data-testid="raw-diagnostics">
        <summary className="cursor-pointer text-slate-300">Diagnostics + provenance</summary>
        <ul className="list-disc pl-5 text-slate-400">
          {result.diagnostics.map((line) => <li key={line}>{line}</li>)}
          {result.acceptanceNotes.map((line) => <li key={line}>{line}</li>)}
        </ul>
        <div className="text-slate-400">
          base {result.provenance.baseObsSha256} · rover {result.provenance.roverObsSha256} ·
          nav {result.provenance.navSha256.join(',')} · sp3 {result.provenance.sp3Sha256 ?? '—'} ·
          options {result.provenance.optionsHash} · {result.provenance.processor}
        </div>
      </details>
      {authoritative && exportDoc && (
        <button type="button" data-testid="raw-export-json" onClick={() => download('authoritative')}
          className="px-2 py-1 border border-slate-600 rounded hover:bg-slate-700">
          Export authoritative JSON
        </button>
      )}
      {diagnosticOnly && (
        <div data-testid="raw-float-policy" className="border border-amber-500 p-2 text-amber-200">
          FLOAT solution: diagnostic view only — NOT EXPORTABLE as a survey baseline.
          {exportDoc && (
            <button type="button" data-testid="raw-export-diagnostic" onClick={() => download('diagnostic')}
              className="ml-2 px-2 py-1 border border-amber-500 rounded hover:bg-slate-700">
              Download diagnostic JSON
            </button>
          )}
        </div>
      )}
      {result.status === 'FAILED' && (
        <div data-testid="raw-failed-policy" className="text-red-300">
          FAILED solution: no export available.
        </div>
      )}
    </div>
  );
};
