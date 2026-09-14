/**
 * Phase 12J.9 Track D — session review tables (REVIEW_ONLY, no math).
 *
 * Renders a processed or reimported raw session: warning banner, baseline
 * table with solution/ratio/formal-sigma columns, expandable station rows, node/edge
 * lists, per-baseline detail reusing GnssRawReview, and session JSON
 * download. Never adds to the project and never reruns any solve.
 */
import React from 'react';
import {
  buildRawSessionExport,
  serializeRawSessionExport,
  sessionBaselineDoc,
  type ProcessedRawGnssSession,
} from '../../engine/gnssRawSessionExport';
import { downloadTextFile } from '../../engine/gnssRawExport';
import type { ProcessedRawGnssBaseline } from '../../engine/gnssRawTypes';
import { GnssRawReview } from './GnssRawReview';

const fmt = (v: number, digits = 4): string =>
  Number.isFinite(v) ? v.toFixed(digits) : '—';

const sigma3d = (b: ProcessedRawGnssBaseline): number => {
  const s = b.covariance.xx + b.covariance.yy + b.covariance.zz;
  return s >= 0 && Number.isFinite(s) ? Math.sqrt(s) : NaN;
};

/** Session-level warnings derived from recorded results only (no recompute). */
const sessionReviewWarnings = (session: ProcessedRawGnssSession): string[] => {
  const warnings: string[] = [];
  if (session.status === 'PARTIAL') warnings.push('PARTIAL session: at least one edge has no result.');
  if (session.status === 'FAILED') warnings.push('FAILED session: no edge produced a result.');
  const planned = new Set(session.graph.edges.map((e) => `${e.from}->${e.to}`));
  for (const e of [...planned].sort()) {
    if (!session.baselines.some((b) => `${b.from}->${b.to}` === e)) {
      warnings.push(`failed edge ${e}: no baseline result recorded.`);
    }
  }
  for (const b of session.baselines) {
    const edge = `${b.from}->${b.to}`;
    if (b.status === 'FLOAT') warnings.push(`FLOAT solution on ${edge}: diagnostic only.`);
    if (b.status === 'FAILED') warnings.push(`FAILED solution on ${edge}.`);
    if (b.solutionQuality.ratio != null && b.solutionQuality.ratio < 3) {
      warnings.push(`weak ratio on ${edge}: ${b.solutionQuality.ratio}.`);
    }
    if (b.referenceFrame === 'UNKNOWN') warnings.push(`unknown frame on ${edge}.`);
    if (b.provenance.ephemerisRequested === 'PRECISE' && b.provenance.ephemerisUsed !== 'PRECISE') {
      warnings.push(`precise incomplete on ${edge}: fell back to ${b.provenance.ephemerisUsed}.`);
    }
  }
  if (session.antennaAssessment.overall === 'PARTIAL') {
    warnings.push('partial calibration: some stations lack ANTEX calibration.');
  }
  if (session.antennaAssessment.overall === 'NONE') {
    warnings.push('no station has ANTEX calibration (formal precision only).');
  }
  const intervals = [...new Set(
    session.stationFiles.map((f) => f.intervalSeconds).filter((v) => v != null),
  )];
  if (intervals.length > 1) warnings.push(`mixed intervals: ${intervals.sort((a, b) => a - b).join(', ')}s.`);
  const groups = new Map<string, string[]>();
  for (const d of session.dependencyGroups) {
    const list = groups.get(d.group) ?? [];
    list.push(d.edge);
    groups.set(d.group, list);
  }
  for (const edges of groups.values()) {
    if (edges.length > 1) warnings.push(`dependency correlated: ${edges.sort().join(', ')}.`);
  }
  return [...new Set(warnings)].sort();
};

const baselineWarnings = (b: ProcessedRawGnssBaseline): string => {
  const notes = [...b.acceptanceNotes];
  if (b.antennaAssessment.warning) notes.push(b.antennaAssessment.warning);
  return notes.length > 0 ? notes.join('; ') : '—';
};

interface ReviewProps {
  readonly session: ProcessedRawGnssSession;
}

export const GnssRawSessionReview: React.FC<ReviewProps> = ({ session }) => {
  const warnings = sessionReviewWarnings(session);
  const downloadSession = (): void => {
    downloadTextFile(
      `raw-session-${session.sessionId}.json`,
      serializeRawSessionExport(buildRawSessionExport(session)),
    );
  };
  return (
    <div data-testid="raw-session-review" className="space-y-2 text-xs text-slate-200">
      {warnings.length > 0 && (
        <div data-testid="raw-session-warnings" className="border border-amber-500 p-2 text-amber-200">
          <ul className="list-disc pl-5">
            {warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </div>
      )}
      <div data-testid="raw-session-status" className="text-slate-300">
        Session {session.sessionId} · {session.status} · {session.baselines.length} baseline(s) ·
        window {session.commonWindow ? `${session.commonWindow.start} .. ${session.commonWindow.stop}` : '—'}
      </div>
      <table data-testid="raw-session-baselines" className="w-full border border-slate-700 text-xs">
        <thead>
          <tr className="bg-slate-800">
            <th className="p-1 text-left">Baseline</th><th className="p-1 text-left">Length</th>
            <th className="p-1 text-left">Solution</th><th className="p-1 text-left">Ratio</th>
            <th className="p-1 text-left">Fixed/Total</th><th className="p-1 text-left">Sats</th>
            <th className="p-1 text-left">Formal σ</th><th className="p-1 text-left">Antenna</th>
            <th className="p-1 text-left">Ephemeris</th><th className="p-1 text-left">Warnings</th>
          </tr>
        </thead>
        <tbody>
          {session.baselines.map((b) => (
            <tr key={`${b.from}->${b.to}`} className="border-t border-slate-700">
              <td className="p-1">{b.from} → {b.to}</td>
              <td className="p-1">{fmt(b.baselineLength)} m</td>
              <td className="p-1">{b.status}</td>
              <td className="p-1">{b.solutionQuality.ratio ?? '—'}</td>
              <td className="p-1">{b.solutionQuality.fixedEpochs ?? '—'}/{b.solutionQuality.usedEpochs}</td>
              <td className="p-1">{b.solutionQuality.satellites}</td>
              <td className="p-1">{fmt(sigma3d(b), 6)} m</td>
              <td className="p-1">
                {b.antennaAssessment.base.calibration}/{b.antennaAssessment.rover.calibration}
              </td>
              <td className="p-1">{b.provenance.ephemerisUsed}</td>
              <td className="p-1">{baselineWarnings(b)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="space-y-1">
        {session.stationFiles.map((f) => (
          <details key={`${f.marker ?? f.fileName}-${f.sha256}`} data-testid="raw-session-station">
            <summary className="cursor-pointer text-slate-300">
              {f.marker ?? f.fileName} · {f.firstEpoch ?? '?'} .. {f.lastEpoch ?? '?'}
            </summary>
            <div className="pl-4 text-slate-400">
              RINEX {f.rinexVersion ?? '—'} · receiver {f.receiverModel ?? '—'} ·
              antenna {f.antennaModel || '—'} · H={f.antennaHeight ?? '—'} E={f.antennaEast ?? '—'} N={f.antennaNorth ?? '—'} ·
              span {f.firstEpoch ?? '—'} .. {f.lastEpoch ?? '—'} · interval {f.intervalSeconds ?? '—'}s ·
              approx XYZ {f.approxXyz ? f.approxXyz.map((v) => v.toFixed(3)).join(', ') : '—'} ·
              sha {f.sha256.slice(0, 16)}… ({f.fileName})
            </div>
          </details>
        ))}
      </div>
      <table data-testid="raw-session-nodes" className="w-full border border-slate-700 text-xs">
        <thead>
          <tr className="bg-slate-800">
            <th className="p-1 text-left">Node</th><th className="p-1 text-left">Edge</th>
            <th className="p-1 text-left">Dependency group</th>
          </tr>
        </thead>
        <tbody>
          {session.graph.edges.map((e) => {
            const group = session.dependencyGroups.find(
              (d) => d.edge === `${e.from}->${e.to}`,
            )?.group ?? e.dependencyGroup;
            return (
              <tr key={`${e.from}->${e.to}`} className="border-t border-slate-700">
                <td className="p-1">{e.from}, {e.to}</td>
                <td className="p-1">{e.from} → {e.to}</td>
                <td className="p-1">{group.slice(0, 16)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="space-y-1">
        {session.baselines.map((b) => (
          <details key={`detail-${b.from}->${b.to}`}>
            <summary className="cursor-pointer text-slate-300">
              Baseline detail {b.from} → {b.to}
            </summary>
            <div className="pl-3">
              <GnssRawReview result={b} exportDoc={sessionBaselineDoc(session, b.from, b.to)} />
            </div>
          </details>
        ))}
      </div>
      <button type="button" data-testid="raw-session-export" onClick={downloadSession}
        className="px-2 py-1 border border-slate-600 rounded hover:bg-slate-700">
        Download session JSON
      </button>
    </div>
  );
};
