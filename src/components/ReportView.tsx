import React from 'react'
import { useState } from 'react'
import { AlertTriangle, CheckCircle } from 'lucide-react'
import type { AdjustmentResult, Observation } from '../types'
import { RAD_TO_DEG, radToDmsStr } from '../engine/angles'

const FT_PER_M = 3.280839895

interface ReportViewProps {
  result: AdjustmentResult
  units: 'm' | 'ft'
  excludedIds: Set<number>
  onToggleExclude: (_id: number) => void
  onReRun: () => void
  onClearExclusions: () => void
  overrides: Record<number, { obs?: number | { dE: number; dN: number }; stdDev?: number }>
  onOverride: (_id: number, _payload: { obs?: number | { dE: number; dN: number }; stdDev?: number }) => void
  onResetOverrides: () => void
}

const ReportView: React.FC<ReportViewProps> = ({
  result,
  units,
  excludedIds,
  onToggleExclude,
  onReRun,
  onClearExclusions,
  overrides: _overrides,
  onOverride,
  onResetOverrides,
}) => {
  const unitScale = units === 'ft' ? FT_PER_M : 1
  const ellipseUnit = units === 'm' ? 'cm' : 'in'
  const ellipseScale = units === 'm' ? 100 : 12
  const [ellipseMode, setEllipseMode] = useState<'1sigma' | '95'>('1sigma')
  const ellipseConfidenceScale = ellipseMode === '95' ? 2.4477 : 1

  const sortedObs = [...result.observations]
    .map((obs, index) => ({ ...obs, originalIndex: index }))
    .sort((a, b) => Math.abs((b as Observation).stdRes || 0) - Math.abs((a as Observation).stdRes || 0))

  const byType = (type: Observation['type']) => sortedObs.filter((o) => o.type === type)

  const analysis = sortedObs.filter((o) => Math.abs((o as Observation).stdRes || 0) > 2)
  const topSuspects = sortedObs
    .filter((o) => {
      const obs = o as Observation
      return (obs.localTest != null && !obs.localTest.pass) || Math.abs(obs.stdRes || 0) >= 2
    })
    .slice(0, 20)
  const topDirectionTargetSuspects = [...(result.directionTargetDiagnostics ?? [])]
    .filter((d) => d.localPass === false || (d.stdRes ?? 0) >= 2 || (d.rawSpreadArcSec ?? 0) >= 5)
    .slice(0, 20)
  const setupSuspects = [...(result.setupDiagnostics ?? [])]
    .filter((s) => s.localFailCount > 0 || (s.maxStdRes ?? 0) >= 2)
    .sort((a, b) => {
      if (b.localFailCount !== a.localFailCount) return b.localFailCount - a.localFailCount
      const bMax = b.maxStdRes ?? 0
      const aMax = a.maxStdRes ?? 0
      if (bMax !== aMax) return bMax - aMax
      const bRms = b.rmsStdRes ?? 0
      const aRms = a.rmsStdRes ?? 0
      if (bRms !== aRms) return bRms - aRms
      return a.station.localeCompare(b.station)
    })
    .slice(0, 20)
  const isAngularType = (type: Observation['type']) =>
    type === 'angle' ||
    type === 'direction' ||
    type === 'bearing' ||
    type === 'dir' ||
    type === 'zenith'
  const formatMdb = (value: number, angular: boolean): string => {
    if (!Number.isFinite(value)) return 'inf'
    return angular
      ? `${(value * RAD_TO_DEG * 3600).toFixed(2)}"`
      : (value * unitScale).toFixed(4)
  }

  const renderTable = (obsList: Observation[], title: string) => {
    if (!obsList.length) return null
    return (
      <div className="mb-6 bg-slate-900/30 border border-slate-800/50 rounded overflow-hidden">
        <div className="bg-slate-800/50 px-4 py-2 border-b border-slate-700 flex items-center justify-between">
          <span className="text-blue-400 font-bold uppercase tracking-wider text-xs">{title}</span>
          <span className="text-[10px] text-slate-500">Toggle exclusions below and click Re-run</span>
        </div>
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-slate-800/50">
              <th className="py-2 px-4">Use</th>
              <th className="py-2">Type</th>
              <th className="py-2">Stations</th>
              <th className="py-2 text-right">Line</th>
              <th className="py-2 text-right">Obs</th>
              <th className="py-2 text-right">Calc</th>
              <th className="py-2 text-right">Residual</th>
              <th className="py-2 text-right">StdRes</th>
              <th className="py-2 text-right">Redund</th>
              <th className="py-2 text-right">Local</th>
              <th className="py-2 text-right">MDB</th>
              <th className="py-2 text-right px-4">StdDev (override)</th>
            </tr>
          </thead>
          <tbody className="text-slate-300">
            {obsList.map((obs, i) => {
              const isFail = Math.abs(obs.stdRes || 0) > 3
              const isWarn = Math.abs(obs.stdRes || 0) > 1 && !isFail
              const excluded = excludedIds.has(obs.id)
              let stationsLabel = ''
              let obsStr = ''
              let calcStr = ''
              let resStr = ''
              let stdResStr = '-'
              let redundancyStr = '-'
              let localStr = '-'
              let mdbStr = '-'
              let stdDevVal = obs.stdDev * unitScale
              const sigmaSource = obs.sigmaSource || 'explicit'
              const sigmaPlaceholder =
                sigmaSource === 'default'
                  ? 'auto'
                  : sigmaSource === 'fixed'
                    ? 'fixed'
                    : sigmaSource === 'float'
                      ? 'float'
                      : ''
              const angular = isAngularType(obs.type)

              if (obs.type === 'angle') {
                stationsLabel = `${obs.at}-${obs.from}-${obs.to}`
                obsStr = radToDmsStr(obs.obs)
                calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-'
                resStr =
                  obs.residual != null
                    ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
                    : '-'
                stdDevVal = obs.stdDev * RAD_TO_DEG * 3600 // arcseconds
              } else if (obs.type === 'direction') {
                const reductionLabel =
                  obs.rawCount != null
                    ? ` [raw ${obs.rawCount}->1, F1:${obs.rawFace1Count ?? '-'} F2:${obs.rawFace2Count ?? '-'}]`
                    : ''
                stationsLabel = `${obs.at}-${obs.to} (${obs.setId})${reductionLabel}`
                obsStr = radToDmsStr(obs.obs)
                calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-'
                resStr =
                  obs.residual != null
                    ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
                    : '-'
                stdDevVal = obs.stdDev * RAD_TO_DEG * 3600 // arcseconds
              } else if (obs.type === 'dist') {
                stationsLabel = `${obs.from}-${obs.to}`
                obsStr = (obs.obs * unitScale).toFixed(4)
                calcStr = obs.calc != null ? ((obs.calc as number) * unitScale).toFixed(4) : '-'
                resStr = obs.residual != null ? ((obs.residual as number) * unitScale).toFixed(4) : '-'
              } else if (obs.type === 'gps') {
                stationsLabel = `${obs.from}-${obs.to}`
                obsStr = `dE=${(obs.obs.dE * unitScale).toFixed(3)}, dN=${(
                  obs.obs.dN * unitScale
                ).toFixed(3)}`
                calcStr =
                  obs.calc != null
                    ? `dE=${((obs.calc as { dE: number }).dE * unitScale).toFixed(3)}, dN=${(
                      obs.calc as { dN: number; dE: number }
                    ).dN.toFixed(3)}`
                    : '-'
                resStr =
                  obs.residual != null
                    ? `vE=${((obs.residual as { vE: number }).vE * unitScale).toFixed(3)}, vN=${(
                      obs.residual as { vN: number; vE: number }
                    ).vN.toFixed(3)}`
                    : '-'
              } else if (obs.type === 'lev') {
                stationsLabel = `${obs.from}-${obs.to}`
                obsStr = (obs.obs * unitScale).toFixed(4)
                calcStr = obs.calc != null ? ((obs.calc as number) * unitScale).toFixed(4) : '-'
                resStr = obs.residual != null ? ((obs.residual as number) * unitScale).toFixed(4) : '-'
              } else if (obs.type === 'bearing') {
                stationsLabel = `${obs.from}-${obs.to}`
                obsStr = radToDmsStr(obs.obs)
                calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-'
                resStr =
                  obs.residual != null
                    ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
                    : '-'
                stdDevVal = obs.stdDev * RAD_TO_DEG * 3600
              } else if (obs.type === 'dir') {
                stationsLabel = `${obs.from}-${obs.to}`
                obsStr = radToDmsStr(obs.obs)
                calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-'
                resStr =
                  obs.residual != null
                    ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
                    : '-'
                stdDevVal = obs.stdDev * RAD_TO_DEG * 3600
              } else if (obs.type === 'zenith') {
                stationsLabel = `${obs.from}-${obs.to}`
                obsStr = radToDmsStr(obs.obs)
                calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-'
                resStr =
                  obs.residual != null
                    ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
                    : '-'
                stdDevVal = obs.stdDev * RAD_TO_DEG * 3600
              }

              const stdDevDisplay =
                sigmaSource === 'default' || sigmaSource === 'fixed' || sigmaSource === 'float'
                  ? ''
                  : stdDevVal.toFixed(4)

              if (obs.stdResComponents) {
                stdResStr = `${obs.stdResComponents.tE.toFixed(2)}/${obs.stdResComponents.tN.toFixed(2)}`
              } else if (obs.stdRes != null) {
                stdResStr = obs.stdRes.toFixed(2)
              }

              if (typeof obs.redundancy === 'object' && obs.redundancy) {
                redundancyStr = `${obs.redundancy.rE.toFixed(2)}/${obs.redundancy.rN.toFixed(2)}`
              } else if (typeof obs.redundancy === 'number') {
                redundancyStr = obs.redundancy.toFixed(2)
              }
              if (obs.localTestComponents) {
                localStr = `E:${obs.localTestComponents.passE ? 'P' : 'F'} N:${
                  obs.localTestComponents.passN ? 'P' : 'F'
                }`
              } else if (obs.localTest) {
                localStr = obs.localTest.pass ? 'PASS' : 'FAIL'
              }
              if (obs.mdbComponents) {
                mdbStr = `E=${formatMdb(obs.mdbComponents.mE, angular)} N=${formatMdb(
                  obs.mdbComponents.mN,
                  angular,
                )}`
              } else if (obs.mdb != null) {
                mdbStr = formatMdb(obs.mdb, angular)
              }

              return (
                <tr key={i} className={`border-b border-slate-800/30 ${excluded ? 'opacity-50' : ''}`}>
                  <td className="py-1 px-4">
                    <input
                      type="checkbox"
                      checked={!excluded}
                      onChange={() => onToggleExclude(obs.id)}
                      className="accent-blue-500"
                    />
                  </td>
                  <td className="py-1 uppercase text-slate-500">
                    {obs.type === 'dir' ? 'dir' : obs.type}
                  </td>
                  <td className="py-1">{stationsLabel}</td>
                  <td className="py-1 text-right font-mono text-slate-500">
                    {obs.sourceLine != null ? obs.sourceLine : '-'}
                  </td>
                  <td className="py-1 text-right font-mono text-slate-400">{obsStr || '-'}</td>
                  <td className="py-1 text-right font-mono text-slate-500">{calcStr}</td>
                  <td
                    className={`py-1 text-right font-bold font-mono ${isFail ? 'text-red-500' : isWarn ? 'text-yellow-500' : 'text-green-500'
                      }`}
                  >
                    {resStr}
                  </td>
                  <td className="py-1 text-right font-mono text-slate-400">{stdResStr}</td>
                  <td className="py-1 text-right font-mono text-slate-500">{redundancyStr}</td>
                  <td
                    className={`py-1 text-right font-mono ${
                      localStr.includes('F') || localStr === 'FAIL' ? 'text-red-400' : 'text-slate-400'
                    }`}
                  >
                    {localStr}
                  </td>
                  <td className="py-1 text-right font-mono text-slate-500">{mdbStr}</td>
                  <td className="py-1 px-4 text-right font-mono text-slate-400">
                    <input
                      type="number"
                      className="bg-slate-800 border border-slate-700 rounded px-1 w-20 text-right text-xs"
                      defaultValue={stdDevDisplay}
                      placeholder={sigmaPlaceholder}
                      onBlur={(e) =>
                        onOverride(obs.id, {
                          stdDev:
                            e.target.value.trim() === ''
                              ? undefined
                              : obs.type === 'angle' ||
                                  obs.type === 'direction' ||
                                  obs.type === 'bearing' ||
                                  obs.type === 'dir' ||
                                  obs.type === 'zenith'
                                ? parseFloat(e.target.value) / (RAD_TO_DEG * 3600)
                                : parseFloat(e.target.value) / unitScale,
                        })
                      }
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="p-6 font-mono text-sm w-full">
      <div className="flex items-center justify-between mb-4 text-xs text-slate-400">
        <div className="space-x-3">
          <button
            onClick={onReRun}
            className="px-3 py-1 bg-green-700 hover:bg-green-600 text-white rounded"
          >
            Re-run with exclusions
          </button>
          <button onClick={onClearExclusions} className="px-3 py-1 bg-slate-700 rounded">
            Reset exclusions
          </button>
          <button onClick={onResetOverrides} className="px-3 py-1 bg-slate-700 rounded">
            Reset overrides
          </button>
        </div>
        <div className="space-x-2 text-slate-500">
          <span>Unit scale: {unitScale.toFixed(4)} ({units})</span>
        </div>
      </div>

      {analysis.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-bold text-white mb-4">Outlier Analysis (&gt; 2 sigma)</h2>
          <div className="bg-red-900/10 border border-red-800/50 rounded p-3 flex items-start space-x-2 mb-4">
            <AlertTriangle className="text-red-400 mt-0.5" size={18} />
            <div className="text-xs text-red-100">
              Residuals above 2.0 sigma are highlighted. Toggle them off and re-run to test re-weighting.
            </div>
          </div>
        </div>
      )}
      {topSuspects.length > 0 && (
        <div className="mb-8 border border-slate-800 rounded overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-800 bg-slate-900/60 text-xs uppercase tracking-wider text-slate-400">
            Top Suspects (ranked)
          </div>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800/60">
                <th className="py-2 px-3">#</th>
                <th className="py-2">Type</th>
                <th className="py-2">Stations</th>
                <th className="py-2 text-right">Line</th>
                <th className="py-2 text-right">StdRes</th>
                <th className="py-2 text-right">Local</th>
                <th className="py-2 text-right px-3">MDB</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {topSuspects.map((obs, idx) => {
                const angular = isAngularType(obs.type)
                const local =
                  obs.localTestComponents != null
                    ? `E:${obs.localTestComponents.passE ? 'P' : 'F'} N:${
                        obs.localTestComponents.passN ? 'P' : 'F'
                      }`
                    : obs.localTest != null
                      ? obs.localTest.pass
                        ? 'PASS'
                        : 'FAIL'
                      : '-'
                const mdb =
                  obs.mdbComponents != null
                    ? `E=${formatMdb(obs.mdbComponents.mE, angular)} N=${formatMdb(
                        obs.mdbComponents.mN,
                        angular,
                      )}`
                    : obs.mdb != null
                      ? formatMdb(obs.mdb, angular)
                      : '-'
                return (
                  <tr key={`sus-${obs.id}-${idx}`} className="border-b border-slate-800/30">
                    <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                    <td className="py-1 uppercase text-slate-400">{obs.type}</td>
                    <td className="py-1">
                      {'at' in obs && 'from' in obs && 'to' in obs
                        ? `${obs.at}-${obs.from}-${obs.to}`
                        : 'at' in obs && 'to' in obs
                          ? `${obs.at}-${obs.to}`
                          : 'from' in obs && 'to' in obs
                            ? `${obs.from}-${obs.to}`
                            : '-'}
                    </td>
                    <td className="py-1 text-right font-mono text-slate-500">
                      {obs.sourceLine != null ? obs.sourceLine : '-'}
                    </td>
                    <td className="py-1 text-right font-mono">{(obs.stdRes ?? 0).toFixed(2)}</td>
                    <td
                      className={`py-1 text-right font-mono ${
                        local.includes('F') || local === 'FAIL' ? 'text-red-400' : 'text-slate-300'
                      }`}
                    >
                      {local}
                    </td>
                    <td className="py-1 px-3 text-right font-mono text-slate-400">{mdb}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mb-8 border-b border-slate-800 pb-6">
        <h2 className="text-xl font-bold text-white mb-4">Adjustment Summary</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-900 p-4 rounded border border-slate-800">
            <span className="block text-slate-500 text-xs mb-1">STATUS</span>
            <div className={`flex items-center space-x-2 ${result.success ? 'text-green-400' : 'text-yellow-500'}`}>
              {result.success ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
              <span className="font-bold">{result.success ? 'CONVERGED' : 'NOT CONVERGED / WARNING'}</span>
            </div>
          </div>
          <div className="bg-slate-900 p-4 rounded border border-slate-800">
            <span className="block text-slate-500 text-xs mb-1">STD ERROR UNIT WEIGHT (SEUW)</span>
            <span className={`font-bold text-lg ${result.seuw > 1.5 ? 'text-yellow-400' : 'text-blue-400'}`}>
              {result.seuw.toFixed(4)}
            </span>
            <span className="text-slate-600 text-xs ml-2">(DOF: {result.dof})</span>
            {result.controlConstraints && (
              <div className="text-[10px] text-slate-500 mt-1">
                constraints: {result.controlConstraints.count} (E:{result.controlConstraints.x} N:
                {result.controlConstraints.y} H:{result.controlConstraints.h})
              </div>
            )}
          </div>
          <div className="bg-slate-900 p-4 rounded border border-slate-800 hidden md:block">
            <span className="block text-slate-500 text-xs mb-1">CHI-SQUARE (95%)</span>
            {result.chiSquare ? (
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
                {result.condition && (
                  <div className={`text-[10px] ${result.condition.flagged ? 'text-red-400' : 'text-slate-500'}`}>
                    cond={result.condition.estimate.toExponential(2)} /{' '}
                    {result.condition.threshold.toExponential(2)}
                  </div>
                )}
              </>
            ) : (
              <div className="text-xs text-slate-500">-</div>
            )}
          </div>
          <div className="bg-slate-900 p-4 rounded border border-slate-800 hidden md:block">
            <span className="block text-slate-500 text-xs mb-1">OBSERVATION BREAKDOWN</span>
            <div className="text-xs text-slate-300 space-y-0.5">
              <div>Distances: {byType('dist').length}</div>
              <div>Angles: {byType('angle').length}</div>
              <div>Directions: {byType('direction').length}</div>
              <div>GPS: {byType('gps').length}</div>
              <div>Leveling: {byType('lev').length}</div>
              <div>Bearings: {byType('bearing').length}</div>
              <div>Dirs: {byType('dir').length}</div>
              <div>Zenith: {byType('zenith').length}</div>
            </div>
          </div>
        </div>
      </div>

      {result.traverseDiagnostics && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          <div className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-900/40">
            Traverse Diagnostics
          </div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 p-3 text-xs text-slate-300">
            <div>
              <div className="text-slate-500">Closure Count</div>
              <div>{result.traverseDiagnostics.closureCount}</div>
            </div>
            <div>
              <div className="text-slate-500">Misclosure dE ({units})</div>
              <div>{(result.traverseDiagnostics.misclosureE * unitScale).toFixed(4)}</div>
            </div>
            <div>
              <div className="text-slate-500">Misclosure dN ({units})</div>
              <div>{(result.traverseDiagnostics.misclosureN * unitScale).toFixed(4)}</div>
            </div>
            <div>
              <div className="text-slate-500">Misclosure Mag ({units})</div>
              <div>{(result.traverseDiagnostics.misclosureMag * unitScale).toFixed(4)}</div>
            </div>
            <div>
              <div className="text-slate-500">Traverse Dist ({units})</div>
              <div>{(result.traverseDiagnostics.totalTraverseDistance * unitScale).toFixed(4)}</div>
            </div>
            <div>
              <div className="text-slate-500">Closure Ratio</div>
              <div>
                {result.traverseDiagnostics.closureRatio != null
                  ? `1:${result.traverseDiagnostics.closureRatio.toFixed(0)}`
                  : '-'}
              </div>
            </div>
          </div>
        </div>
      )}

      {result.directionSetDiagnostics && result.directionSetDiagnostics.length > 0 && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          <div className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-900/40">
            Direction Set Diagnostics
          </div>
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800">
                  <th className="py-2 px-3 font-semibold">Set</th>
                  <th className="py-2 px-3 font-semibold">Occupy</th>
                  <th className="py-2 px-3 font-semibold text-right">Raw</th>
                  <th className="py-2 px-3 font-semibold text-right">Reduced</th>
                  <th className="py-2 px-3 font-semibold text-right">Pairs</th>
                  <th className="py-2 px-3 font-semibold text-right">F1</th>
                  <th className="py-2 px-3 font-semibold text-right">F2</th>
                  <th className="py-2 px-3 font-semibold text-right">Orient (deg)</th>
                  <th className="py-2 px-3 font-semibold text-right">RMS (")</th>
                  <th className="py-2 px-3 font-semibold text-right">Max (")</th>
                  <th className="py-2 px-3 font-semibold text-right">Orient SE (")</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {result.directionSetDiagnostics.map((d) => (
                  <tr key={`${d.setId}-${d.occupy}`} className="border-b border-slate-800/50">
                    <td className="py-1 px-3">{d.setId}</td>
                    <td className="py-1 px-3">{d.occupy}</td>
                    <td className="py-1 px-3 text-right">{d.rawCount}</td>
                    <td className="py-1 px-3 text-right">{d.reducedCount}</td>
                    <td className="py-1 px-3 text-right">{d.pairedTargets}</td>
                    <td className="py-1 px-3 text-right">{d.face1Count}</td>
                    <td className="py-1 px-3 text-right">{d.face2Count}</td>
                    <td className="py-1 px-3 text-right">
                      {d.orientationDeg != null ? d.orientationDeg.toFixed(4) : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {d.residualRmsArcSec != null ? d.residualRmsArcSec.toFixed(2) : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {d.residualMaxArcSec != null ? d.residualMaxArcSec.toFixed(2) : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {d.orientationSeArcSec != null ? d.orientationSeArcSec.toFixed(2) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result.directionTargetDiagnostics && result.directionTargetDiagnostics.length > 0 && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          <div className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-900/40">
            Direction Target Repeatability (ranked)
          </div>
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800">
                  <th className="py-2 px-3 font-semibold">#</th>
                  <th className="py-2 px-3 font-semibold">Set</th>
                  <th className="py-2 px-3 font-semibold">Occupy</th>
                  <th className="py-2 px-3 font-semibold">Target</th>
                  <th className="py-2 px-3 font-semibold text-right">Line</th>
                  <th className="py-2 px-3 font-semibold text-right">Raw</th>
                  <th className="py-2 px-3 font-semibold text-right">F1</th>
                  <th className="py-2 px-3 font-semibold text-right">F2</th>
                  <th className="py-2 px-3 font-semibold text-right">Spread (")</th>
                  <th className="py-2 px-3 font-semibold text-right">Red Sigma (")</th>
                  <th className="py-2 px-3 font-semibold text-right">Residual (")</th>
                  <th className="py-2 px-3 font-semibold text-right">StdRes</th>
                  <th className="py-2 px-3 font-semibold text-right">Local</th>
                  <th className="py-2 px-3 font-semibold text-right">MDB (")</th>
                  <th className="py-2 px-3 font-semibold text-right">Score</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {result.directionTargetDiagnostics.map((d, idx) => (
                  <tr key={`${d.setId}-${d.occupy}-${d.target}-${idx}`} className="border-b border-slate-800/50">
                    <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                    <td className="py-1 px-3">{d.setId}</td>
                    <td className="py-1 px-3">{d.occupy}</td>
                    <td className="py-1 px-3">{d.target}</td>
                    <td className="py-1 px-3 text-right text-slate-500">{d.sourceLine ?? '-'}</td>
                    <td className="py-1 px-3 text-right">{d.rawCount}</td>
                    <td className="py-1 px-3 text-right">{d.face1Count}</td>
                    <td className="py-1 px-3 text-right">{d.face2Count}</td>
                    <td className="py-1 px-3 text-right">{d.rawSpreadArcSec != null ? d.rawSpreadArcSec.toFixed(2) : '-'}</td>
                    <td className="py-1 px-3 text-right">{d.reducedSigmaArcSec != null ? d.reducedSigmaArcSec.toFixed(2) : '-'}</td>
                    <td className="py-1 px-3 text-right">{d.residualArcSec != null ? d.residualArcSec.toFixed(2) : '-'}</td>
                    <td className="py-1 px-3 text-right">{d.stdRes != null ? d.stdRes.toFixed(2) : '-'}</td>
                    <td className={`py-1 px-3 text-right ${d.localPass === false ? 'text-red-400' : ''}`}>
                      {d.localPass == null ? '-' : d.localPass ? 'PASS' : 'FAIL'}
                    </td>
                    <td className="py-1 px-3 text-right">{d.mdbArcSec != null ? d.mdbArcSec.toFixed(2) : '-'}</td>
                    <td className="py-1 px-3 text-right font-mono">{d.suspectScore.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {topDirectionTargetSuspects.length > 0 && (
        <div className="mb-8 border border-slate-800 rounded overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-800 bg-slate-900/60 text-xs uppercase tracking-wider text-slate-400">
            Direction Target Suspects (top)
          </div>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800/60">
                <th className="py-2 px-3">#</th>
                <th className="py-2">Set</th>
                <th className="py-2">Stations</th>
                <th className="py-2 text-right">Spread (")</th>
                <th className="py-2 text-right">StdRes</th>
                <th className="py-2 text-right">Local</th>
                <th className="py-2 text-right px-3">Score</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {topDirectionTargetSuspects.map((d, idx) => (
                <tr key={`dts-${d.setId}-${d.occupy}-${d.target}-${idx}`} className="border-b border-slate-800/30">
                  <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                  <td className="py-1">{d.setId}</td>
                  <td className="py-1">{`${d.occupy}-${d.target}`}</td>
                  <td className="py-1 text-right font-mono">
                    {d.rawSpreadArcSec != null ? d.rawSpreadArcSec.toFixed(2) : '-'}
                  </td>
                  <td className="py-1 text-right font-mono">{d.stdRes != null ? d.stdRes.toFixed(2) : '-'}</td>
                  <td className={`py-1 text-right font-mono ${d.localPass === false ? 'text-red-400' : ''}`}>
                    {d.localPass == null ? '-' : d.localPass ? 'PASS' : 'FAIL'}
                  </td>
                  <td className="py-1 px-3 text-right font-mono">{d.suspectScore.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result.setupDiagnostics && result.setupDiagnostics.length > 0 && (
        <div className="mb-8 border border-slate-800 rounded overflow-hidden">
          <div className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-900/40">
            Setup Diagnostics
          </div>
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800">
                  <th className="py-2 px-3 font-semibold">Setup</th>
                  <th className="py-2 px-3 font-semibold text-right">Dir Sets</th>
                  <th className="py-2 px-3 font-semibold text-right">Dir Obs</th>
                  <th className="py-2 px-3 font-semibold text-right">Angles</th>
                  <th className="py-2 px-3 font-semibold text-right">Dist</th>
                  <th className="py-2 px-3 font-semibold text-right">Zen</th>
                  <th className="py-2 px-3 font-semibold text-right">Lev</th>
                  <th className="py-2 px-3 font-semibold text-right">GPS</th>
                  <th className="py-2 px-3 font-semibold text-right">Trav Dist ({units})</th>
                  <th className="py-2 px-3 font-semibold text-right">Orient RMS (")</th>
                  <th className="py-2 px-3 font-semibold text-right">Orient SE (")</th>
                  <th className="py-2 px-3 font-semibold text-right">RMS |t|</th>
                  <th className="py-2 px-3 font-semibold text-right">Max |t|</th>
                  <th className="py-2 px-3 font-semibold text-right">Local Fail</th>
                  <th className="py-2 px-3 font-semibold">Worst Obs</th>
                  <th className="py-2 px-3 font-semibold text-right">Line</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {result.setupDiagnostics.map((s) => (
                  <tr key={s.station} className="border-b border-slate-800/50">
                    <td className="py-1 px-3">{s.station}</td>
                    <td className="py-1 px-3 text-right">{s.directionSetCount}</td>
                    <td className="py-1 px-3 text-right">{s.directionObsCount}</td>
                    <td className="py-1 px-3 text-right">{s.angleObsCount}</td>
                    <td className="py-1 px-3 text-right">{s.distanceObsCount}</td>
                    <td className="py-1 px-3 text-right">{s.zenithObsCount}</td>
                    <td className="py-1 px-3 text-right">{s.levelingObsCount}</td>
                    <td className="py-1 px-3 text-right">{s.gpsObsCount}</td>
                    <td className="py-1 px-3 text-right">{(s.traverseDistance * unitScale).toFixed(3)}</td>
                    <td className="py-1 px-3 text-right">
                      {s.orientationRmsArcSec != null ? s.orientationRmsArcSec.toFixed(2) : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {s.orientationSeArcSec != null ? s.orientationSeArcSec.toFixed(2) : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">{s.rmsStdRes != null ? s.rmsStdRes.toFixed(2) : '-'}</td>
                    <td className="py-1 px-3 text-right">{s.maxStdRes != null ? s.maxStdRes.toFixed(2) : '-'}</td>
                    <td className="py-1 px-3 text-right">{s.localFailCount}</td>
                    <td className="py-1 px-3 text-slate-400">
                      {s.worstObsType != null
                        ? `${s.worstObsType.toUpperCase()} ${s.worstObsStations ?? ''}`.trim()
                        : '-'}
                    </td>
                    <td className="py-1 px-3 text-right text-slate-500">{s.worstObsLine ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {setupSuspects.length > 0 && (
        <div className="mb-8 border border-slate-800 rounded overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-800 bg-slate-900/60 text-xs uppercase tracking-wider text-slate-400">
            Setup Suspects (ranked)
          </div>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800/60">
                <th className="py-2 px-3">#</th>
                <th className="py-2">Setup</th>
                <th className="py-2 text-right">Local Fail</th>
                <th className="py-2 text-right">Max |t|</th>
                <th className="py-2 text-right">RMS |t|</th>
                <th className="py-2">Worst Obs</th>
                <th className="py-2 text-right px-3">Line</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {setupSuspects.map((s, idx) => (
                <tr key={`ss-${s.station}-${idx}`} className="border-b border-slate-800/30">
                  <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                  <td className="py-1">{s.station}</td>
                  <td className={`py-1 text-right font-mono ${s.localFailCount > 0 ? 'text-red-400' : ''}`}>
                    {s.localFailCount}
                  </td>
                  <td className="py-1 text-right font-mono">{s.maxStdRes != null ? s.maxStdRes.toFixed(2) : '-'}</td>
                  <td className="py-1 text-right font-mono">{s.rmsStdRes != null ? s.rmsStdRes.toFixed(2) : '-'}</td>
                  <td className="py-1 text-slate-400">
                    {s.worstObsType != null
                      ? `${s.worstObsType.toUpperCase()} ${s.worstObsStations ?? ''}`.trim()
                      : '-'}
                  </td>
                  <td className="py-1 px-3 text-right font-mono text-slate-500">{s.worstObsLine ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result.sideshots && result.sideshots.length > 0 && (
        <div className="mb-8 border border-slate-800 rounded overflow-hidden">
          <div className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-900/40">
            Post-Adjusted Sideshots
          </div>
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800">
                  <th className="py-2 px-3 font-semibold">From</th>
                  <th className="py-2 px-3 font-semibold">To</th>
                  <th className="py-2 px-3 font-semibold text-right">Line</th>
                  <th className="py-2 px-3 font-semibold text-right">Mode</th>
                  <th className="py-2 px-3 font-semibold text-right">Az</th>
                  <th className="py-2 px-3 font-semibold text-right">Az Src</th>
                  <th className="py-2 px-3 font-semibold text-right">HD ({units})</th>
                  <th className="py-2 px-3 font-semibold text-right">dH ({units})</th>
                  <th className="py-2 px-3 font-semibold text-right">Northing ({units})</th>
                  <th className="py-2 px-3 font-semibold text-right">Easting ({units})</th>
                  <th className="py-2 px-3 font-semibold text-right">Height ({units})</th>
                  <th className="py-2 px-3 font-semibold text-right">σN ({units})</th>
                  <th className="py-2 px-3 font-semibold text-right">σE ({units})</th>
                  <th className="py-2 px-3 font-semibold text-right">σH ({units})</th>
                  <th className="py-2 px-3 font-semibold">Note</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {result.sideshots.map((s) => (
                  <tr key={s.id} className="border-b border-slate-800/50">
                    <td className="py-1 px-3">{s.from}</td>
                    <td className="py-1 px-3">{s.to}</td>
                    <td className="py-1 px-3 text-right">{s.sourceLine ?? '-'}</td>
                    <td className="py-1 px-3 text-right">{s.mode}</td>
                    <td className="py-1 px-3 text-right">
                      {s.azimuth != null ? radToDmsStr(s.azimuth) : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">{s.azimuthSource ?? '-'}</td>
                    <td className="py-1 px-3 text-right">{(s.horizDistance * unitScale).toFixed(4)}</td>
                    <td className="py-1 px-3 text-right">
                      {s.deltaH != null ? (s.deltaH * unitScale).toFixed(4) : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {s.northing != null ? (s.northing * unitScale).toFixed(4) : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {s.easting != null ? (s.easting * unitScale).toFixed(4) : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {s.height != null ? (s.height * unitScale).toFixed(4) : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {s.sigmaN != null ? (s.sigmaN * unitScale).toFixed(4) : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {s.sigmaE != null ? (s.sigmaE * unitScale).toFixed(4) : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {s.sigmaH != null ? (s.sigmaH * unitScale).toFixed(4) : '-'}
                    </td>
                    <td className="py-1 px-3 text-slate-500">{s.note ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-blue-400 font-bold text-base uppercase tracking-wider">Adjusted Coordinates ({units})</h3>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>Ellipse</span>
            <div className="flex rounded border border-slate-700 overflow-hidden">
              <button
                onClick={() => setEllipseMode('1sigma')}
                className={`px-2 py-0.5 ${ellipseMode === '1sigma' ? 'bg-slate-700 text-white' : 'bg-slate-900/60 text-slate-400'}`}
              >
                1σ
              </button>
              <button
                onClick={() => setEllipseMode('95')}
                className={`px-2 py-0.5 ${ellipseMode === '95' ? 'bg-slate-700 text-white' : 'bg-slate-900/60 text-slate-400'}`}
              >
                95%
              </button>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800 text-xs">
                <th className="py-2 font-semibold w-20">Stn</th>
                <th className="py-2 font-semibold text-right">Northing</th>
                <th className="py-2 font-semibold text-right">Easting</th>
                <th className="py-2 font-semibold text-right">Height</th>
                <th className="py-2 font-semibold text-right">σN</th>
                <th className="py-2 font-semibold text-right">σE</th>
                <th className="py-2 font-semibold text-right">σH</th>
                <th className="py-2 font-semibold text-center">Type</th>
                <th className="py-2 font-semibold text-right w-32">Ellipse ({ellipseUnit})</th>
                <th className="py-2 font-semibold text-right w-20">Az (deg)</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {Object.entries(result.stations).map(([id, stn]) => (
                <tr key={id} className="border-b border-slate-800/50 hover:bg-slate-900/50 transition-colors">
                  <td className="py-1 font-medium text-white">{id}</td>
                  <td className="py-1 text-right text-yellow-100/90">{(stn.y * unitScale).toFixed(4)}</td>
                  <td className="py-1 text-right text-yellow-100/90">{(stn.x * unitScale).toFixed(4)}</td>
                  <td className="py-1 text-right text-yellow-100/90">{(stn.h * unitScale).toFixed(4)}</td>
                  <td className="py-1 text-right text-xs text-slate-400">
                    {stn.sN != null ? (stn.sN * unitScale).toFixed(4) : '-'}
                  </td>
                  <td className="py-1 text-right text-xs text-slate-400">
                    {stn.sE != null ? (stn.sE * unitScale).toFixed(4) : '-'}
                  </td>
                  <td className="py-1 text-right text-xs text-slate-400">
                    {stn.sH != null ? (stn.sH * unitScale).toFixed(4) : '-'}
                  </td>
                  <td className="py-1 text-center">
                    {stn.fixed ? (
                      <span className="text-xs bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">FIXED</span>
                    ) : (
                      <span className="text-xs text-slate-500">ADJ</span>
                    )}
                  </td>
                  <td className="py-1 text-right text-xs text-slate-400">
                    {stn.errorEllipse
                      ? `${(
                          stn.errorEllipse.semiMajor *
                          ellipseConfidenceScale *
                          ellipseScale *
                          (units === 'ft' ? 0.0328084 : 1)
                        ).toFixed(1)} / ${(
                          stn.errorEllipse.semiMinor *
                          ellipseConfidenceScale *
                          ellipseScale *
                          (units === 'ft' ? 0.0328084 : 1)
                        ).toFixed(1)}`
                      : '-'}
                  </td>
                  <td className="py-1 text-right text-xs text-slate-400">
                    {stn.errorEllipse ? stn.errorEllipse.theta.toFixed(2) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mb-8">
        <h3 className="text-blue-400 font-bold mb-3 text-base uppercase tracking-wider">Observations & Residuals</h3>
        <div className="bg-slate-800/50 rounded p-2 mb-2 text-xs text-slate-400 flex items-center justify-between">
          <span>Sorted by |StdRes|</span>
          <span>MDB: arcsec (angular) / {units} (linear). Toggle rows to exclude and press Re-run</span>
        </div>
        {result.typeSummary && Object.keys(result.typeSummary).length > 0 && (
          <div className="mb-4 border border-slate-800 rounded">
            <div className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800">
              Per-Type Summary
            </div>
            <div className="overflow-x-auto w-full">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-800">
                    <th className="py-2 px-3 font-semibold">Type</th>
                    <th className="py-2 px-3 font-semibold text-right">Count</th>
                    <th className="py-2 px-3 font-semibold text-right">RMS</th>
                    <th className="py-2 px-3 font-semibold text-right">Max |Res|</th>
                    <th className="py-2 px-3 font-semibold text-right">Max |StdRes|</th>
                    <th className="py-2 px-3 font-semibold text-right">&gt;3σ</th>
                    <th className="py-2 px-3 font-semibold text-right">&gt;4σ</th>
                    <th className="py-2 px-3 font-semibold text-right">Unit</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {Object.entries(result.typeSummary).map(([type, summary]) => (
                    <tr key={type} className="border-b border-slate-800/50">
                      <td className="py-1 px-3 uppercase text-slate-400">{type}</td>
                      <td className="py-1 px-3 text-right">{summary.count}</td>
                      <td className="py-1 px-3 text-right">{summary.rms.toFixed(4)}</td>
                      <td className="py-1 px-3 text-right">{summary.maxAbs.toFixed(4)}</td>
                      <td className="py-1 px-3 text-right">{summary.maxStdRes.toFixed(3)}</td>
                      <td className="py-1 px-3 text-right">{summary.over3}</td>
                      <td className="py-1 px-3 text-right">{summary.over4}</td>
                      <td className="py-1 px-3 text-right">{summary.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {result.relativePrecision && result.relativePrecision.length > 0 && (
          <div className="mb-4 border border-slate-800 rounded">
            <div className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800">
              Relative Precision (Unknowns)
            </div>
            <div className="overflow-x-auto w-full">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-800">
                    <th className="py-2 px-3 font-semibold">From</th>
                    <th className="py-2 px-3 font-semibold">To</th>
                    <th className="py-2 px-3 font-semibold text-right">σN</th>
                    <th className="py-2 px-3 font-semibold text-right">σE</th>
                    <th className="py-2 px-3 font-semibold text-right">σDist</th>
                    <th className="py-2 px-3 font-semibold text-right">σAz (")</th>
                    <th className="py-2 px-3 font-semibold text-right">Ellipse ({ellipseUnit})</th>
                    <th className="py-2 px-3 font-semibold text-right">Az (deg)</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {result.relativePrecision.map((rel, idx) => (
                    <tr key={`${rel.from}-${rel.to}-${idx}`} className="border-b border-slate-800/50">
                      <td className="py-1 px-3">{rel.from}</td>
                      <td className="py-1 px-3">{rel.to}</td>
                      <td className="py-1 px-3 text-right">{(rel.sigmaN * unitScale).toFixed(4)}</td>
                      <td className="py-1 px-3 text-right">{(rel.sigmaE * unitScale).toFixed(4)}</td>
                      <td className="py-1 px-3 text-right">
                        {rel.sigmaDist != null ? (rel.sigmaDist * unitScale).toFixed(4) : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {rel.sigmaAz != null ? (rel.sigmaAz * RAD_TO_DEG * 3600).toFixed(2) : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {rel.ellipse
                          ? `${(
                              rel.ellipse.semiMajor *
                              ellipseConfidenceScale *
                              ellipseScale *
                              (units === 'ft' ? 0.0328084 : 1)
                            ).toFixed(1)} / ${(
                              rel.ellipse.semiMinor *
                              ellipseConfidenceScale *
                              ellipseScale *
                              (units === 'ft' ? 0.0328084 : 1)
                            ).toFixed(1)}`
                          : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {rel.ellipse ? rel.ellipse.theta.toFixed(2) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {renderTable(byType('angle'), 'Angles (TS)')}
        {renderTable(byType('direction'), 'Directions (DB/DN)')}
        {renderTable(byType('dist'), 'Distances (TS)')}
        {renderTable(byType('bearing'), 'Bearings/Azimuths')}
        {renderTable(byType('dir'), 'Directions (Azimuth)')}
        {renderTable(byType('zenith'), 'Zenith/Vertical Angles')}
        {renderTable(byType('gps'), 'GPS Vectors')}
        {renderTable(byType('lev'), 'Leveling dH')}
      </div>

      <div className="mt-8 bg-slate-900 p-4 rounded border border-slate-800 font-mono text-xs text-slate-400">
        <div className="font-bold text-slate-300 mb-2 uppercase">Processing Log</div>
        {result.logs.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  )
}

export default ReportView
