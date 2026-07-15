import React from 'react';
import { AlertTriangle, CheckCircle } from 'lucide-react';

import type { AdjustmentResult, Observation } from '../../types';
import type { SortedObservation } from '../../engine/resultDerivedModels';
import type { ReportObservationSelectorModel } from './reportObservationSelectors';
import { REPORT_STATIC_TOOLTIPS } from './reportTooltips';

type SourceLineRenderer = (_line: number | null | undefined) => React.ReactNode;

export const PendingRunSettingsDiffBanner: React.FC<{
  pendingRunSettingDiffs: string[];
}> = ({ pendingRunSettingDiffs }) => {
  if (pendingRunSettingDiffs.length === 0) return null;
  return (
    <div
      className="mb-4 rounded border border-amber-800/60 bg-amber-950/20 px-4 py-3 text-xs text-amber-100"
      style={{ order: -215 }}
    >
      <div className="font-semibold uppercase tracking-wide text-amber-200">
        Pending rerun settings diff
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {pendingRunSettingDiffs.slice(0, 6).map((diff) => (
          <span key={diff} className="rounded border border-amber-700/60 bg-amber-900/20 px-2 py-1">
            {diff}
          </span>
        ))}
        {pendingRunSettingDiffs.length > 6 ? (
          <span className="rounded border border-amber-700/60 bg-amber-900/20 px-2 py-1">
            +{pendingRunSettingDiffs.length - 6} more
          </span>
        ) : null}
      </div>
    </div>
  );
};

export const AdjustmentSummarySection: React.FC<{
  byType: (_type: Observation['type']) => SortedObservation[];
  isPreanalysis: boolean;
  isSpecialRunMode: boolean;
  result: AdjustmentResult;
}> = ({ byType, isPreanalysis, isSpecialRunMode, result }) => {
  if (isSpecialRunMode) return null;
  return (
    <div className="mb-8 border-b border-slate-800 pb-6" style={{ order: -210 }}>
      <h2
        className="text-xl font-bold text-slate-100 mb-4"
        title={REPORT_STATIC_TOOLTIPS['Adjustment Summary']}
      >
        Adjustment Summary
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 p-4 rounded border border-slate-800">
          <span className="block text-slate-500 text-xs mb-1" title={REPORT_STATIC_TOOLTIPS.STATUS}>
            STATUS
          </span>
          <div
            className={`flex items-center space-x-2 ${result.success ? 'text-green-400' : 'text-yellow-500'}`}
          >
            {result.success ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
            <span className="font-bold">
              {result.success ? 'CONVERGED' : 'NOT CONVERGED / WARNING'}
            </span>
          </div>
        </div>
        <div className="bg-slate-900 p-4 rounded border border-slate-800">
          <span
            className="block text-slate-500 text-xs mb-1"
            title={
              isPreanalysis
                ? 'Preanalysis uses the a-priori variance factor sigma0^2 = 1.0 and reports predicted precision only.'
                : 'SEUW = sqrt(vTPv / DOF). Values near 1 usually indicate realistic stochastic modeling.'
            }
          >
            {isPreanalysis ? 'A-PRIORI SIGMA0' : 'STD ERROR UNIT WEIGHT (SEUW)'}
          </span>
          <span
            className={`font-bold text-lg ${result.seuw > 1.5 ? 'text-yellow-400' : 'text-blue-400'}`}
          >
            {result.seuw.toFixed(4)}
          </span>
          <span className="text-slate-600 text-xs ml-2">
            {isPreanalysis ? '(predicted precision)' : `(DOF: ${result.dof})`}
          </span>
          {result.controlConstraints && (
            <div className="text-[10px] text-slate-500 mt-1">
              constraints: {result.controlConstraints.count} (E:{result.controlConstraints.x} N:
              {result.controlConstraints.y} H:{result.controlConstraints.h} corrXY:
              {result.controlConstraints.xyCorrelated ?? 0})
            </div>
          )}
        </div>
        <div className="bg-slate-900 p-4 rounded border border-slate-800 hidden md:block">
          <span
            className="block text-slate-500 text-xs mb-1"
            title={
              isPreanalysis
                ? 'Residual-based quality-control statistics are disabled in preanalysis mode.'
                : 'Global model test against expected variance at 95% confidence. PASS means SEUW is statistically consistent with stated precisions.'
            }
          >
            {isPreanalysis ? 'RESIDUAL QC' : 'CHI-SQUARE (95%)'}
          </span>
          {!isPreanalysis && result.chiSquare ? (
            <>
              <div
                className={`font-bold text-lg ${result.chiSquare.pass95 ? 'text-green-400' : 'text-red-400'}`}
              >
                {result.chiSquare.pass95 ? 'PASS' : 'FAIL'}
              </div>
              <div className="text-xs text-slate-500">
                T={result.chiSquare.T.toFixed(2)} p={result.chiSquare.p.toFixed(3)}
              </div>
              <div className="text-[10px] text-slate-500">
                [{result.chiSquare.lower.toFixed(2)}, {result.chiSquare.upper.toFixed(2)}]
              </div>
              <div className="text-[10px] text-slate-500">
                vf={result.chiSquare.varianceFactor.toFixed(3)} (
                {result.chiSquare.varianceFactorLower.toFixed(3)}..
                {result.chiSquare.varianceFactorUpper.toFixed(3)})
              </div>
              <div className="text-[10px] text-slate-500">
                ef=({Math.sqrt(result.chiSquare.varianceFactorLower).toFixed(3)}..
                {Math.sqrt(result.chiSquare.varianceFactorUpper).toFixed(3)})
              </div>
              {result.condition && (
                <div
                  className={`text-[10px] ${result.condition.flagged ? 'text-red-400' : 'text-slate-500'}`}
                >
                  cond={result.condition.estimate.toExponential(2)} /{' '}
                  {result.condition.threshold.toExponential(2)}
                </div>
              )}
            </>
          ) : (
            <div className="text-xs text-slate-500">
              {isPreanalysis ? 'Disabled for planning runs' : '-'}
            </div>
          )}
        </div>
        <div className="bg-slate-900 p-4 rounded border border-slate-800 hidden md:block">
          <span
            className="block text-slate-500 text-xs mb-1"
            title={REPORT_STATIC_TOOLTIPS['OBSERVATION BREAKDOWN']}
          >
            OBSERVATION BREAKDOWN
          </span>
          <div className="text-xs text-slate-300 space-y-0.5">
            <div>Distances: {byType('dist').length}</div>
            <div>Angles: {byType('angle').length}</div>
            <div>Directions: {byType('direction').length}</div>
            <div>GPS: {byType('gps').length}</div>
            <div>Leveling: {byType('lev').length}</div>
            <div>Bearings: {byType('bearing').length}</div>
            <div>Dirs: {byType('dir').length}</div>
            <div>Zenith: {byType('zenith').length}</div>
            {isPreanalysis && <div>Planned: {result.parseState?.plannedObservationCount ?? 0}</div>}
          </div>
        </div>
      </div>
    </div>
  );
};

export const DataCheckSummarySection: React.FC<{
  dataCheckDiffRows: ReportObservationSelectorModel['dataCheckDiffRows'];
  directionSetCount: number;
  isDataCheck: boolean;
  maxAbsStdRes: number;
  renderSourceLineLink: SourceLineRenderer;
  result: AdjustmentResult;
}> = ({
  dataCheckDiffRows,
  directionSetCount,
  isDataCheck,
  maxAbsStdRes,
  renderSourceLineLink,
  result,
}) => {
  if (!isDataCheck) return null;
  return (
    <div className="mb-6 border border-sky-700/40 rounded bg-sky-950/20" style={{ order: -210 }}>
      <div className="px-3 py-2 text-xs text-sky-200 uppercase tracking-wider border-b border-sky-800/40">
        Data Check Only: Differences from Observations
      </div>
      <div className="px-3 py-2 text-xs text-slate-300">
        Approximate-geometry check only. No least-squares adjustment statistics are produced in
        this mode.
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-3 pb-3 text-xs text-slate-300">
        <div className="rounded border border-sky-900/40 bg-slate-950/20 px-3 py-2">
          <div className="text-slate-500">Status</div>
          <div className={result.success ? 'text-sky-200 font-semibold' : 'text-amber-300 font-semibold'}>
            {result.success ? 'CHECK COMPLETED' : 'CHECK WARNING'}
          </div>
        </div>
        <div className="rounded border border-sky-900/40 bg-slate-950/20 px-3 py-2">
          <div className="text-slate-500">Observations Checked</div>
          <div>{result.observations.length}</div>
        </div>
        <div className="rounded border border-sky-900/40 bg-slate-950/20 px-3 py-2">
          <div className="text-slate-500">Direction Sets</div>
          <div>{directionSetCount}</div>
        </div>
        <div className="rounded border border-sky-900/40 bg-slate-950/20 px-3 py-2">
          <div className="text-slate-500">Max |t|</div>
          <div>{maxAbsStdRes.toFixed(2)}</div>
        </div>
      </div>
      <div className="overflow-auto px-3 pb-3">
        <table className="w-full text-xs">
          <thead className="text-slate-400 uppercase border-b border-slate-800">
            <tr>
              <th className="py-2 text-left">#</th>
              <th className="py-2 text-left">Type</th>
              <th className="py-2 text-left">Stations</th>
              <th className="py-2 text-right">Difference</th>
              <th className="py-2 text-right">|t|</th>
              <th className="py-2 text-right">Line</th>
            </tr>
          </thead>
          <tbody>
            {dataCheckDiffRows.map((row, idx) => (
              <tr key={`data-check-diff-${row.obs.id}-${idx}`} className="border-b border-slate-900/70">
                <td className="py-1">{idx + 1}</td>
                <td className="py-1 uppercase text-slate-400">{row.obs.type}</td>
                <td className="py-1">{row.stations}</td>
                <td className="py-1 text-right font-mono">{row.diffLabel}</td>
                <td className="py-1 text-right font-mono">
                  {row.obs.stdRes != null && Number.isFinite(row.obs.stdRes)
                    ? Math.abs(row.obs.stdRes).toFixed(2)
                    : '-'}
                </td>
                <td className="py-1 text-right font-mono text-slate-500">
                  {renderSourceLineLink(row.obs.sourceLine)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const BlunderDetectSummarySection: React.FC<{
  blunderCycleLines: string[];
  blunderFlaggedCount: number;
  isBlunderDetect: boolean;
  maxAbsStdRes: number;
  result: AdjustmentResult;
}> = ({ blunderCycleLines, blunderFlaggedCount, isBlunderDetect, maxAbsStdRes, result }) => {
  if (!isBlunderDetect) return null;
  return (
    <div className="mb-6 border border-amber-700/40 rounded bg-amber-950/20" style={{ order: -210 }}>
      <div className="px-3 py-2 text-xs text-amber-200 uppercase tracking-wider border-b border-amber-800/40">
        Blunder Detect Mode
      </div>
      <div className="px-3 py-2 text-xs text-slate-300">
        Iterative deweighting diagnostics run. This is screening support and not a replacement for
        full adjustment QA.
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-3 pb-3 text-xs text-slate-300">
        <div className="rounded border border-amber-900/40 bg-slate-950/20 px-3 py-2">
          <div className="text-slate-500">Status</div>
          <div className={result.success ? 'text-amber-200 font-semibold' : 'text-red-300 font-semibold'}>
            {result.success ? 'DIAGNOSTIC SOLVE COMPLETED' : 'DIAGNOSTIC WARNING'}
          </div>
        </div>
        <div className="rounded border border-amber-900/40 bg-slate-950/20 px-3 py-2">
          <div className="text-slate-500">Deweight Cycles</div>
          <div>{blunderCycleLines.length}</div>
        </div>
        <div className="rounded border border-amber-900/40 bg-slate-950/20 px-3 py-2">
          <div className="text-slate-500">Remaining |t| &gt;= 3</div>
          <div>{blunderFlaggedCount}</div>
        </div>
        <div className="rounded border border-amber-900/40 bg-slate-950/20 px-3 py-2">
          <div className="text-slate-500">Max |t|</div>
          <div>{maxAbsStdRes.toFixed(2)}</div>
        </div>
      </div>
      {blunderCycleLines.length > 0 && (
        <div className="px-3 pb-3">
          <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">Cycle Trace</div>
          <div className="space-y-1 text-xs text-slate-300">
            {blunderCycleLines.map((line, idx) => (
              <div key={`blunder-cycle-${idx}`} className="font-mono">
                {line}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
