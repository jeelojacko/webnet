import React, { useMemo } from 'react'
import { AlertTriangle, CheckCircle, FileText } from 'lucide-react'
import { RAD_TO_DEG, radToDmsStr } from '../engine/angles'
import type { AdjustmentResult, Observation } from '../types'

type Units = 'm' | 'ft'

interface ReportViewProps {
  result: AdjustmentResult
  units: Units
}

const ReportView: React.FC<ReportViewProps> = ({ result, units }) => {
  const ellipseUnit = units === 'm' ? 'cm' : 'in'
  const ellipseScale = units === 'm' ? 100 : 12

  const sortedObs = useMemo(
    () =>
      [...result.observations]
        .map((obs, index) => ({ ...obs, originalIndex: index }))
        .sort((a, b) => Math.abs((b as Observation).stdRes || 0) - Math.abs((a as Observation).stdRes || 0)),
    [result.observations],
  )

  const byType = (type: Observation['type']) => sortedObs.filter((o) => o.type === type)

  const analysis = sortedObs.filter((o) => Math.abs((o as Observation).stdRes || 0) > 2)

  const renderTable = (obsList: Observation[], title: string) => {
    if (!obsList.length) return null
    return (
      <div className="mb-6 bg-slate-900/30 border border-slate-800/50 rounded overflow-hidden">
        <div className="bg-slate-800/50 px-4 py-2 border-b border-slate-700 flex items-center justify-between">
          <span className="text-blue-400 font-bold uppercase tracking-wider text-xs">{title}</span>
        </div>
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-slate-800/50">
              <th className="py-2 px-4">Type</th>
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

              let stationsLabel = ''
              let obsStr = ''
              let calcStr = ''
              let resStr = ''

              if (obs.type === 'angle') {
                stationsLabel = `${obs.at}-${obs.from}-${obs.to}`
                obsStr = radToDmsStr(obs.obs)
                calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-'
                resStr =
                  obs.residual != null
                    ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
                    : '-'
              } else if (obs.type === 'dist') {
                stationsLabel = `${obs.from}-${obs.to}`
                obsStr = obs.obs.toFixed(4)
                calcStr = obs.calc != null ? (obs.calc as number).toFixed(4) : '-'
                resStr = obs.residual != null ? (obs.residual as number).toFixed(4) : '-'
              } else if (obs.type === 'gps') {
                stationsLabel = `${obs.from}-${obs.to}`
                obsStr = `dE=${obs.obs.dE.toFixed(3)}, dN=${obs.obs.dN.toFixed(3)}`
                calcStr =
                  obs.calc != null
                    ? `dE=${(obs.calc as { dE: number }).dE.toFixed(3)}, dN=${(
                        obs.calc as { dN: number; dE: number }
                      ).dN.toFixed(3)}`
                    : '-'
                resStr =
                  obs.residual != null
                    ? `vE=${(obs.residual as { vE: number }).vE.toFixed(3)}, vN=${(
                        obs.residual as { vN: number; vE: number }
                      ).vN.toFixed(3)}`
                    : '-'
              } else if (obs.type === 'lev') {
                stationsLabel = `${obs.from}-${obs.to}`
                obsStr = obs.obs.toFixed(4)
                calcStr = obs.calc != null ? (obs.calc as number).toFixed(4) : '-'
                resStr = obs.residual != null ? (obs.residual as number).toFixed(4) : '-'
              }

              return (
                <tr key={i} className="border-b border-slate-800/30">
                  <td className="py-1 px-4 uppercase text-slate-500">{obs.type}</td>
                  <td className="py-1">{stationsLabel}</td>
                  <td className="py-1 text-right font-mono text-slate-400">{obsStr}</td>
                  <td className="py-1 text-right font-mono text-slate-500">{calcStr}</td>
                  <td
                    className={`py-1 text-right font-bold font-mono ${
                      isFail ? 'text-red-500' : isWarn ? 'text-yellow-500' : 'text-green-500'
                    }`}
                  >
                    {resStr}
                  </td>
                  <td className="py-1 px-4 text-right font-mono text-slate-400">
                    {obs.stdRes != null ? obs.stdRes.toFixed(2) : '-'}
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
      {analysis.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-bold text-white mb-4">Outlier Analysis (&gt; 2 sigma)</h2>
          <div className="bg-red-900/10 border border-red-800/50 rounded p-3 flex items-start space-x-2 mb-4">
            <AlertTriangle className="text-red-400 mt-0.5" size={18} />
            <div className="text-xs text-red-100">
              Residuals above 2.0 sigma are highlighted. Consider re-weighting or removing gross errors.
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
                  <td className="py-1 text-right text-yellow-100/90">{stn.y.toFixed(4)}</td>
                  <td className="py-1 text-right text-yellow-100/90">{stn.x.toFixed(4)}</td>
                  <td className="py-1 text-right text-yellow-100/90">{stn.h.toFixed(4)}</td>
                  <td className="py-1 text-center">
                    {stn.fixed ? (
                      <span className="text-xs bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">FIXED</span>
                    ) : (
                      <span className="text-xs text-slate-500">ADJ</span>
                    )}
                  </td>
                  <td className="py-1 text-right text-xs text-slate-400">
                    {stn.errorEllipse
                      ? `${(stn.errorEllipse.semiMajor * ellipseScale).toFixed(1)} / ${(stn.errorEllipse.semiMinor * ellipseScale).toFixed(1)}`
                      : '-'}
                  </td>
                  <td className="py-1 text-right text-xs text-slate-400">{stn.sH != null ? stn.sH.toFixed(3) : '-'}</td>
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
