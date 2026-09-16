import React from 'react';
import type { AdjustmentResult } from '../../types';

const DESCRIPTIVE_TITLE =
  'Descriptive only — not a statistical test, probability, or significance.';

const Desc: React.FC<{ title?: string }> = ({ title }) => (
  <span
    className="ml-1 normal-case tracking-normal text-slate-500"
    title={title ?? DESCRIPTIVE_TITLE}
  >
    DESCRIPTIVE
  </span>
);

const fmt = (v: number | null | undefined, digits: number): string =>
  v != null && Number.isFinite(v) ? v.toFixed(digits) : '-';

const Sub: React.FC<{ label: string; title: string; children: React.ReactNode }> = ({
  label,
  title,
  children,
}) => (
  <div className="mt-3 border-t border-slate-800 pt-2">
    <div className="uppercase tracking-wider text-slate-500" title={title}>
      {label}
      <Desc title={title} />
    </div>
    <div className="mt-1 text-slate-300">{children}</div>
  </div>
);

const findTargetLine = (
  result: AdjustmentResult,
  setId?: string,
  target?: string,
): number | null | undefined => {
  if (!setId) return undefined;
  const rows = result.directionTargetDiagnostics ?? [];
  const hit =
    rows.find((r) => r.setId === setId && (target == null || r.target === target)) ??
    rows.find((r) => r.setId === setId);
  return hit?.sourceLine;
};

const SystematicPatternSection: React.FC<{
  isDataCheck: boolean;
  isPreanalysis: boolean;
  renderSourceLineLink: (_line: number | null | undefined) => React.ReactNode;
  result: AdjustmentResult;
}> = ({ isDataCheck, isPreanalysis, renderSourceLineLink, result }) => {
  if (isPreanalysis || isDataCheck) return null;
  const sys = result.systematicDiagnostics;
  if (!sys) {
    return (
      <div className="mb-6 text-xs text-slate-500">
        Systematic pattern diagnostics unavailable for this run.
      </div>
    );
  }
  if (!sys.available) {
    return (
      <div className="mb-6 text-xs text-slate-300">
        <span
          className="uppercase tracking-wider text-slate-500 mr-2"
          title={DESCRIPTIVE_TITLE}
        >
          Systematic pattern diagnostics
          <Desc />
        </span>
        <div className="mt-1 text-slate-400">
          unavailable — {sys.unavailableReason ?? 'no residuals'}
        </div>
      </div>
    );
  }
  const dt = sys.distanceTrend;
  const fb = sys.directionFaceBalance;
  const lp = sys.levelingPatterns;
  const zp = sys.zenithPatterns;
  const gp = sys.gnssPatterns;
  const repeats = sys.directionRepeatSameSign.filter((r) => r.status === 'descriptive');
  const summary: string[] = [
    dt.identifiable
      ? `Distance residuals show a descriptive slope of ${fmt(dt.slopeMmPerKm, 3)} mm/km over ${fmt(dt.minDist, 1)}–${fmt(dt.maxDist, 1)} m.`
      : `Distance trend insufficient (${dt.reason ?? 'no data'}).`,
    `Face balance: ${fb.balancedSets} balanced / ${fb.unbalancedSets} unbalanced sets` +
      (fb.largestFacePairDeltaArcSec != null
        ? `, largest face-pair delta ${fmt(fb.largestFacePairDeltaArcSec, 2)}".`
        : '.'),
    lp.status === 'descriptive'
      ? `Leveling input-sequence drift ${fmt(lp.driftMmPerKm, 3)} mm/km over ${fmt(lp.cumulativeKm, 3)} km.`
      : `Leveling patterns ${lp.status} (${lp.reason ?? 'no data'}).`,
  ];
  return (
    <div className="mb-6 text-xs text-slate-300">
      <span
        className="uppercase tracking-wider text-slate-500 mr-2"
        title="Descriptive residual-pattern summaries only: no formal tests, no p-values, no significance claims. Residuals are correlated with rank-deficient covariance, so IID-based runs/Pearson/OLS tests do not apply."
      >
        Systematic pattern diagnostics
        <Desc title="Descriptive residual-pattern summaries only: no formal tests, no p-values, no significance claims." />
      </span>
      {summary.map((line) => (
        <div key={line} className="mt-1 text-slate-200">
          {line}
        </div>
      ))}

      {sys.setupFamilies.length > 0 && (
        <Sub
          label="Setup patterns"
          title="Setup-family means describe residuals grouped by station and family; per-set direction means absorb orientation unknowns."
        >
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left border-collapse font-mono text-[11px]">
              <thead>
                <tr className="text-slate-500">
                  <th className="text-left pr-3 font-normal">Station</th>
                  <th className="text-left pr-3 font-normal">Family</th>
                  <th className="text-right pr-3 font-normal">n</th>
                  <th className="text-right pr-3 font-normal">Mean</th>
                  <th className="text-right pr-3 font-normal">RMS</th>
                  <th className="text-right pr-3 font-normal">Max|v|</th>
                  <th className="text-right pr-3 font-normal">+/-zero</th>
                  <th className="text-right font-normal">LocalFail</th>
                </tr>
              </thead>
              <tbody>
                {sys.setupFamilies.map((f) => (
                  <tr
                    key={`${f.station}-${f.family}`}
                    className="border-t border-slate-800"
                  >
                    <td className="pr-3 text-slate-200">{f.station}</td>
                    <td className="pr-3 text-slate-400">{f.family}</td>
                    <td className="pr-3 text-right">{f.count}</td>
                    <td className="pr-3 text-right">
                      {f.meanResidual != null ? f.meanResidual.toFixed(4) : '-'}
                    </td>
                    <td className="pr-3 text-right">
                      {f.rmsResidual != null ? f.rmsResidual.toFixed(4) : '-'}
                    </td>
                    <td className="pr-3 text-right">
                      {f.maxAbsResidual != null ? f.maxAbsResidual.toFixed(4) : '-'}
                    </td>
                    <td className="pr-3 text-right">
                      {f.posCount}/{f.negCount}/{f.zeroUntestableCount}
                    </td>
                    <td className="text-right">{f.localFailCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Sub>
      )}

      <Sub
        label="Distance trends"
        title="Distance residuals increase with measured distance over this span; consistent with scale or modeling effects; review calibration, reductions, control, geometry."
      >
        n={dt.count}, range {fmt(dt.minDist, 2)}–{fmt(dt.maxDist, 2)} m, slope{' '}
        {fmt(dt.slopeMmPerKm, 3)} mm/km, intercept {fmt(dt.interceptMm, 3)} mm,
        corr {fmt(dt.corrInterceptSlope, 3)}, identifiable{' '}
        {dt.identifiable ? 'YES' : 'NO'}, status {dt.status}
        {dt.reason ? ` — ${dt.reason}` : ''}
      </Sub>

      <Sub
        label="Direction face"
        title="Face-pair differences describe observed FL/FR agreement for this set; review instrument, targets, and setup stability."
      >
        {sys.worstDirectionSet && (
          <div>
            Worst set {sys.worstDirectionSet.setId} @ {sys.worstDirectionSet.occupy}
            {sys.worstDirectionSet.residualRmsArcSec != null
              ? ` rms ${sys.worstDirectionSet.residualRmsArcSec.toFixed(2)}"`
              : ''}{' '}
            line{' '}
            {renderSourceLineLink(
              findTargetLine(result, sys.worstDirectionSet.setId),
            )}{' '}
            (per-set means absorb orientation unknowns)
          </div>
        )}
        <div>
          Balanced {fb.balancedSets} / unbalanced {fb.unbalancedSets}
          {fb.largestFacePairDeltaArcSec != null && (
            <>
              {'; largest pair delta '}
              {fmt(fb.largestFacePairDeltaArcSec, 2)}&quot;
              {fb.largestFacePairSetId
                ? ` (${fb.largestFacePairSetId}${fb.largestFacePairTarget ? ` ${fb.largestFacePairTarget}` : ''})`
                : ''}{' '}
              line{' '}
              {renderSourceLineLink(
                findTargetLine(result, fb.largestFacePairSetId, fb.largestFacePairTarget),
              )}
            </>
          )}
          {fb.reason ? ` — ${fb.reason}` : ''}
        </div>
        {sys.worstDirectionRepeat && (
          <div>
            Most repeated target {sys.worstDirectionRepeat.occupy}-&gt;
            {sys.worstDirectionRepeat.target} ({sys.worstDirectionRepeat.setCount}{' '}
            sets)
          </div>
        )}
      </Sub>

      {repeats.length > 0 && (
        <Sub
          label="Direction repeat same-sign"
          title="Repeated-target same-sign counts describe observed agreement across sets; no p-value."
        >
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left border-collapse font-mono text-[11px]">
              <thead>
                <tr className="text-slate-500">
                  <th className="text-left pr-3 font-normal">Occupy</th>
                  <th className="text-left pr-3 font-normal">Target</th>
                  <th className="text-right pr-3 font-normal">Sets</th>
                  <th className="text-right pr-3 font-normal">SameSign</th>
                  <th className="text-left font-normal">Dominant</th>
                </tr>
              </thead>
              <tbody>
                {repeats.slice(0, 10).map((r) => (
                  <tr
                    key={`${r.occupy}-${r.target}`}
                    className="border-t border-slate-800"
                  >
                    <td className="pr-3 text-slate-200">{r.occupy}</td>
                    <td className="pr-3 text-slate-200">{r.target}</td>
                    <td className="pr-3 text-right">{r.setCount}</td>
                    <td className="pr-3 text-right">{r.sameSignCount}</td>
                    <td>{r.dominantSign}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Sub>
      )}

      <Sub
        label="Zenith"
        title="Zenith residual vs distance describes the observed pattern only; review reductions, control, and geometry."
      >
        n={zp.count}, slope {fmt(zp.slopeVsDistanceArcSecPerKm, 3)}&quot;/km, +/-
        {zp.posCount}/{zp.negCount}, status {zp.status}
        {zp.reason ? ` — ${zp.reason}` : ''}
      </Sub>

      <Sub
        label="Leveling"
        title="Leveling residuals in input-document order (not time); drift describes sequence trend only; review procedures, control, and section lengths."
      >
        n={lp.count} (input sequence), {fmt(lp.cumulativeKm, 3)} km, drift{' '}
        {fmt(lp.driftMmPerKm, 3)} mm/km, +/-{lp.posCount}/{lp.negCount},
        longest {lp.longestPos}/{lp.longestNeg}, changes {lp.signChanges},
        status {lp.status}
        {lp.reason ? ` — ${lp.reason}` : ''}
      </Sub>

      <Sub
        label="GNSS"
        title="GNSS component means describe the observed residuals; review processing, control, and geometry."
      >
        {gp.status === 'descriptive'
          ? `n=${gp.count}, E ${fmt(gp.meanEMm, 2)}/${fmt(gp.rmsEMm, 2)} mm, N ${fmt(gp.meanNMm, 2)}/${fmt(gp.rmsNMm, 2)} mm, U ${fmt(gp.meanUMm, 2)}/${fmt(gp.rmsUMm, 2)} mm (mean/rms)`
          : `n=${gp.count}, status ${gp.status} — ${gp.reason ?? 'no data'}`}
      </Sub>

      {sys.signRuns.length > 0 && (
        <Sub
          label="Sign runs"
          title="Sign-run counts describe the observed sequence; no runs-test p-value."
        >
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left border-collapse font-mono text-[11px]">
              <thead>
                <tr className="text-slate-500">
                  <th className="text-left pr-3 font-normal">Key</th>
                  <th className="text-right pr-3 font-normal">n</th>
                  <th className="text-right pr-3 font-normal">+/-</th>
                  <th className="text-right pr-3 font-normal">Longest</th>
                  <th className="text-right font-normal">Changes</th>
                </tr>
              </thead>
              <tbody>
                {sys.signRuns.map((r) => (
                  <tr key={r.key} className="border-t border-slate-800">
                    <td className="pr-3 text-slate-200">{r.key}</td>
                    <td className="pr-3 text-right">{r.count}</td>
                    <td className="pr-3 text-right">
                      {r.pos}/{r.neg}
                    </td>
                    <td className="pr-3 text-right">
                      {r.longestPos}/{r.longestNeg}
                    </td>
                    <td className="text-right">{r.signChanges}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Sub>
      )}

      {sys.warnings.length > 0 && (
        <div className="mt-2 text-slate-400">
          {sys.warnings.map((w) => (
            <div key={w}>Note: {w}</div>
          ))}
        </div>
      )}
      {sys.robustNote && <div className="mt-1 text-slate-400">{sys.robustNote}</div>}
      {sys.freeNetworkNote && (
        <div className="mt-1 text-slate-400">{sys.freeNetworkNote}</div>
      )}
    </div>
  );
};

export default SystematicPatternSection;
