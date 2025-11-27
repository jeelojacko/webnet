import React from 'react'
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
  overrides,
  onOverride,
  onResetOverrides,
}) => {
  const unitScale = units === 'ft' ? FT_PER_M : 1
  const ellipseUnit = units === 'm' ? 'cm' : 'in'
  const ellipseScale = units === 'm' ? 100 : 12

  const sortedObs = [...result.observations]
    .map((obs, index) => ({ ...obs, originalIndex: index }))
    .sort((a, b) => Math.abs((b as Observation).stdRes || 0) - Math.abs((a as Observation).stdRes || 0))

  const byType = (type: Observation['type']) => sortedObs.filter((o) => o.type === type)

  const analysis = sortedObs.filter((o) => Math.abs((o as Observation).stdRes || 0) > 2)

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
              <th className="py-2 text-right">Obs</th>
              <th className="py-2 text-right">Calc</th>
              <th className="py-2 text-right">Residual</th>
              <th className="py-2 text-right px-4">StdRes</th>
            </tr>
          </thead>
          <tbody className="text-slate-300">
            {obsList.map((obs, i) => {
              const isFail = Math.abs(obs.stdRes || 0) > 3
              const isWarn = Math.abs(obs.stdRes || 0) > 1 && !isFail
              const excluded = excludedIds.has(obs.id)
              const override = overrides[obs.id]

              let stationsLabel = ''
              let calcStr = ''
              let resStr = ''
              let stdDevVal = obs.stdDev * unitScale

              if (obs.type === 'angle') {
                stationsLabel = `${obs.at}-${obs.from}-${obs.to}`
                calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-'
                resStr =
                  obs.residual != null
                    ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
                    : '-'
                stdDevVal = obs.stdDev * RAD_TO_DEG * 3600 // arcseconds
              } else if (obs.type === 'dist') {
                stationsLabel = `${obs.from}-${obs.to}`
                calcStr = obs.calc != null ? ((obs.calc as number) * unitScale).toFixed(4) : '-'
                resStr = obs.residual != null ? ((obs.residual as number) * unitScale).toFixed(4) : '-'
              } else if (obs.type === 'gps') {
                stationsLabel = `${obs.from}-${obs.to}`
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
                calcStr = obs.calc != null ? ((obs.calc as number) * unitScale).toFixed(4) : '-'
                resStr = obs.residual != null ? ((obs.residual as number) * unitScale).toFixed(4) : '-'
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
                  <td className="py-1 uppercase text-slate-500">{obs.type}</td>
                  <td className="py-1">{stationsLabel}</td>
                  <td className="py-1 text-right font-mono text-slate-400">
                    {obs.type === 'gps' ? (
                      <div className="flex items-center space-x-1 justify-end">
                        <input
                          type="number"
                          className="bg-slate-800 border border-slate-700 rounded px-1 w-20 text-right text-xs"
                          defaultValue={(obs.obs.dE * unitScale).toFixed(3)}
                          onBlur={(e) =>
                            onOverride(obs.id, {
                              obs: {
                                dE: parseFloat(e.target.value) / unitScale,
                                dN: (override?.obs as any)?.dN ?? obs.obs.dN,
                              },
                            })
                          }
                        />
                        <input
                          type="number"
                          className="bg-slate-800 border border-slate-700 rounded px-1 w-20 text-right text-xs"
                          defaultValue={(obs.obs.dN * unitScale).toFixed(3)}
                          onBlur={(e) =>
                            onOverride(obs.id, {
                              obs: {
                                dE: (override?.obs as any)?.dE ?? obs.obs.dE,
                                dN: parseFloat(e.target.value) / unitScale,
                              },
                            })
                          }
                        />
                      </div>
                    ) : (
                      <input
                        type="number"
                        className="bg-slate-800 border border-slate-700 rounded px-1 w-24 text-right text-xs"
                        defaultValue={
                          obs.type === 'angle'
                            ? (obs.obs * RAD_TO_DEG).toFixed(6)
                            : (obs.obs * unitScale).toFixed(4)
                        }
                        onBlur={(e) =>
                          onOverride(obs.id, {
                            obs:
                              obs.type === 'angle'
                                ? parseFloat(e.target.value)
                                : parseFloat(e.target.value) / unitScale,
                          })
                        }
                      />
                    )}
                  </td>
                  <td className="py-1 text-right font-mono text-slate-500">{calcStr}</td>
                  <td
                    className={`py-1 text-right font-bold font-mono ${
                      isFail ? 'text-red-500' : isWarn ? 'text-yellow-500' : 'text-green-500'
                    }`}
                  >
                    {resStr}
                  </td>
                  <td className="py-1 px-4 text-right font-mono text-slate-400">
                    <input
                      type="number"
                      className="bg-slate-800 border border-slate-700 rounded px-1 w-20 text-right text-xs"
                      defaultValue={stdDevVal.toFixed(4)}
                      onBlur={(e) =>
                        onOverride(obs.id, {
                          stdDev:
                            obs.type === 'angle'
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

      <div className="mb-8 border-b border-slate-800 pb-6">
        <h2 className="text-xl font-bold text-white mb-4">Adjustment Summary</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
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
          </div>
          <div className="bg-slate-900 p-4 rounded border border-slate-800 hidden md:block">
            <span className="block text-slate-500 text-xs mb-1">OBSERVATION BREAKDOWN</span>
            <div className="text-xs text-slate-300 space-y-0.5">
              <div>Distances: {byType('dist').length}</div>
              <div>Angles: {byType('angle').length}</div>
              <div>GPS: {byType('gps').length}</div>
              <div>Leveling: {byType('lev').length}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="mb-8">
        <h3 className="text-blue-400 font-bold mb-3 text-base uppercase tracking-wider">Adjusted Coordinates ({units})</h3>
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800 text-xs">
                <th className="py-2 font-semibold w-20">Stn</th>
                <th className="py-2 font-semibold text-right">Northing</th>
                <th className="py-2 font-semibold text-right">Easting</th>
                <th className="py-2 font-semibold text-right">Height</th>
                <th className="py-2 font-semibold text-center">Type</th>
                <th className="py-2 font-semibold text-right w-32">Ellipse ({ellipseUnit})</th>
                <th className="py-2 font-semibold text-right w-24">sH ({units})</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {Object.entries(result.stations).map(([id, stn]) => (
                <tr key={id} className="border-b border-slate-800/50 hover:bg-slate-900/50 transition-colors">
                  <td className="py-1 font-medium text-white">{id}</td>
                  <td className="py-1 text-right text-yellow-100/90">{(stn.y * unitScale).toFixed(4)}</td>
                  <td className="py-1 text-right text-yellow-100/90">{(stn.x * unitScale).toFixed(4)}</td>
                  <td className="py-1 text-right text-yellow-100/90">{(stn.h * unitScale).toFixed(4)}</td>
                  <td className="py-1 text-center">
                    {stn.fixed ? (
                      <span className="text-xs bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">FIXED</span>
                    ) : (
                      <span className="text-xs text-slate-500">ADJ</span>
                    )}
                  </td>
                  <td className="py-1 text-right text-xs text-slate-400">
                    {stn.errorEllipse
                      ? `${(stn.errorEllipse.semiMajor * ellipseScale * (units === 'ft' ? 0.0328084 : 1)).toFixed(1)} / ${(
                          stn.errorEllipse.semiMinor * ellipseScale * (units === 'ft' ? 0.0328084 : 1)
                        ).toFixed(1)}`
                      : '-'}
                  </td>
                  <td className="py-1 text-right text-xs text-slate-400">{stn.sH != null ? (stn.sH * unitScale).toFixed(3) : '-'}</td>
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
          <span>Toggle rows to exclude and press Re-run</span>
        </div>
        {renderTable(byType('angle'), 'Angles (TS)')}
        {renderTable(byType('dist'), 'Distances (TS)')}
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
