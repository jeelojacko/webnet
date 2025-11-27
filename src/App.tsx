// WebNet Adjustment (TypeScript)

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  FileText,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  RefreshCw,
  Settings,
} from 'lucide-react'
import { LSAEngine } from './engine/adjust'
import { RAD_TO_DEG, radToDmsStr } from './engine/angles'
import type { AdjustmentResult, InstrumentLibrary, Observation } from './types'

/****************************
 * CONSTANTS & DEFAULT INPUT
 ****************************/
const DEFAULT_INPUT = `# WebNet Example - 10 Point Mixed Network
# - 3 control points with fixed XYH
# - 7 unknown stations (XYH adjusted)
# - Total station sets (angles & distances)
# - GPS vectors (planimetric)
# - Leveling height differences
# - Instrument library and usage

# --- INSTRUMENT LIBRARY ---
# I <CODE> <Desc-with-dashes> <dist_a_ppm> <dist_b_const> <angle_std(")> <gps_xy_std(m)> <lev_std(mm/km)>
I TS1   TS-Geodetic-1mm+1ppm      1.0   0.001   1.0    0.020   1.5
I TS2   TS-Construction-3mm+2ppm  2.0   0.003   3.0    0.050   2.0
I GPS1  GNSS-Base-Rover-Fix       0.5   0.002   2.0    0.010   4.0
I LEV1  Digital-Level-0.7mm       0.0   0.000   0.0    0.000   0.7

# --- CONTROL / STATIONS ---
# C <ID> <E> <N> <H> [* for fixed]
C 1000  5000.000 5000.000  100.000  *
C 1001  5300.000 5000.000  102.000  *
C 1002  5150.000 5300.000  101.500  *

C 2000  5050.000 5050.000  100.200
C 2001  5250.000 5050.000  101.000
C 2002  5200.000 5200.000  101.200
C 2003  5100.000 5200.000  100.800
C 2004  5000.000 5300.000  100.600
C 2005  5300.000 5300.000  101.400
C 2006  5150.000 5400.000  101.000

# --- TOTAL STATION DISTANCES (2 sets) ---
# D <InstCode> <SetID> <From> <To> <Dist(m)> <Std(m-raw)>
D TS1  S1  1000 2000   70.711   0.003
D TS1  S1  2000 2001  200.000   0.003
D TS1  S1  2001 1001   70.711   0.003
D TS1  S1  1001 2002  223.607   0.003
D TS1  S1  2002 2003  100.000   0.003
D TS1  S1  2003 1000  223.607   0.003

# Second set with slight differences (redundant but realistic)
D TS1  S2  1000 2000   70.712   0.003
D TS1  S2  2000 2001  200.001   0.003
D TS1  S2  2001 1001   70.710   0.003
D TS1  S2  1001 2002  223.606   0.003
D TS1  S2  2002 2003  100.000   0.003
D TS1  S2  2003 1000  223.606   0.003

# --- TOTAL STATION ANGLES (Sets S1/S2) ---
# A <InstCode> <SetID> <At> <From> <To> <Angle(dms)> <Std(")>
# Angles are generated from the station coordinates.
A TS1  S1  1000 1001 2000  315.0000  1.0
A TS1  S1  1000 2000 2003  341.3354  1.0
A TS1  S1  1001 1000 2001  045.0000  1.0
A TS1  S1  1001 2001 2002  018.2606  1.0
A TS1  S1  1002 2003 2002  306.5212  1.0
A TS1  S1  1002 2004 2005  180.0000  1.0

# Slightly perturbed second set
A TS1  S2  1000 1001 2000  315.0000  1.0
A TS1  S2  1000 2000 2003  341.3354  1.0
A TS1  S2  1001 1000 2001  044.5960  1.0
A TS1  S2  1001 2001 2002  018.2606  1.0
A TS1  S2  1002 2003 2002  306.5212  1.0
A TS1  S2  1002 2004 2005  180.0000  1.0

# --- GPS OBSERVATIONS (planimetric) ---
# G <InstCode> <From> <To> <dE(m)> <dN(m)> <Std_XY(m)>
# These are baselines derived from coordinates with tiny noise.
G GPS1 1000 1001  299.999   0.001  0.010
G GPS1 1001 1002 -149.999 299.999  0.010
G GPS1 1002 1000 -150.000 -300.000 0.010

G GPS1 1000 2004   0.001 300.001  0.020
G GPS1 1001 2005  -0.002 299.998  0.020
G GPS1 1002 2006   0.001 100.000  0.020

# --- LEVELING OBSERVATIONS ---
# L <InstCode> <From> <To> <dH(m)> <Len(km)> <Std(mm/km-raw)>
# These tie ALL unknown heights into the network.
L LEV1 1000 1001   2.0009   0.30   0.7
L LEV1 1001 1002  -0.4991   0.34   0.7
L LEV1 1002 1000  -1.5009   0.34   0.7

L LEV1 1000 2000   0.1992   0.07   0.7
L LEV1 2000 2001   0.8007   0.20   0.7
L LEV1 2001 1001   1.0005   0.07   0.7

L LEV1 1002 2003  -0.6997   0.11   0.7
L LEV1 2003 2004  -0.2004   0.14   0.7
L LEV1 2004 1000  -0.5998   0.30   0.7

# Extra lines to constrain heights of 2002, 2005, 2006
L LEV1 1001 2002  -0.7998   0.22   0.7
L LEV1 1001 2005  -0.5998   0.30   0.7
L LEV1 1002 2006  -0.5007   0.10   0.7
`

type Units = 'm' | 'ft'

type SettingsState = {
  maxIterations: number
  units: Units
}

/****************************
 * UI COMPONENTS
 ****************************/
const App: React.FC = () => {
  const [input, setInput] = useState<string>(DEFAULT_INPUT)
  const [result, setResult] = useState<AdjustmentResult | null>(null)
  const [activeTab, setActiveTab] = useState<'report'>('report')
  const [settings, setSettings] = useState<SettingsState>({ maxIterations: 10, units: 'm' })
  const [selectedInstrument, setSelectedInstrument] = useState('')
  const [splitPercent, setSplitPercent] = useState(35) // left pane width (%)
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const isResizingRef = useRef(false)

  const instrumentLibrary: InstrumentLibrary = useMemo(() => {
    const lines = input.split('\n')
    const lib: InstrumentLibrary = {}

    for (const raw of lines) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue

      const parts = line.split(/\s+/)
      if (parts[0]?.toUpperCase() === 'I' && parts.length >= 8) {
        const instCode = parts[1]
        const desc = parts[2]?.replace(/-/g, ' ') ?? ''
        const distA = parseFloat(parts[3])
        const distB = parseFloat(parts[4])
        const angStd = parseFloat(parts[5])
        const gpsStd = parseFloat(parts[6])
        const levStd = parseFloat(parts[7])
        lib[instCode] = {
          code: instCode,
          desc,
          distA_ppm: distA,
          distB_const: distB,
          angleStd_sec: angStd,
          gpsStd_xy: gpsStd,
          levStd_mmPerKm: levStd,
        }
      }
    }
    return lib
  }, [input])

  useEffect(() => {
    const codes = Object.keys(instrumentLibrary)
    if (!selectedInstrument && codes.length > 0) {
      setSelectedInstrument(codes[0])
    } else if (selectedInstrument && !instrumentLibrary[selectedInstrument]) {
      setSelectedInstrument(codes[0] || '')
    }
  }, [instrumentLibrary, selectedInstrument])

  // handle dragging of vertical divider
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current || !layoutRef.current || !isSidebarOpen) return

      const bounds = layoutRef.current.getBoundingClientRect()
      const offsetX = e.clientX - bounds.left
      let pct = (offsetX / bounds.width) * 100

      const min = 20
      const max = 80
      if (pct < min) pct = min
      if (pct > max) pct = max

      setSplitPercent(pct)
    }

    const handleMouseUp = () => {
      isResizingRef.current = false
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isSidebarOpen])

  const handleDividerMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    isResizingRef.current = true
  }

  const handleRun = () => {
    const engine = new LSAEngine({
      input,
      maxIterations: settings.maxIterations,
      instrumentLibrary,
    })

    const solved = engine.solve()
    setResult(solved)
    setActiveTab('report')
  }

  const handleUnitChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSettings({ ...settings, units: e.target.value as Units })
  }

  const handleIterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10) || 1
    setSettings({ ...settings, maxIterations: val })
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-slate-900 text-slate-100 font-sans overflow-hidden">
      <header className="h-16 bg-slate-800 border-b border-slate-700 flex items-center justify-between px-4 shrink-0 w-full">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-1.5 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition-colors"
            title={isSidebarOpen ? 'Close Input Sidebar' : 'Open Input Sidebar'}
          >
            {isSidebarOpen ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}
          </button>
          <div className="flex items-center space-x-2">
            <Activity className="text-blue-400" size={24} />
            <div className="flex flex-col">
              <h1 className="text-lg font-bold tracking-wide text-white leading-none">
                WebNet <span className="text-blue-400 font-light">Adjustment</span>
              </h1>
              <span className="text-xs text-slate-500">Survey LSA - TS + GPS + Leveling</span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-4 bg-slate-900/50 px-4 py-1.5 rounded border border-slate-700">
          <div className="flex items-center space-x-2">
            <label className="text-xs text-slate-400 font-medium uppercase">Units</label>
            <select
              value={settings.units}
              onChange={handleUnitChange}
              className="bg-slate-800 text-xs border border-slate-600 text-white rounded px-2 py-1 outline-none focus:border-blue-500"
            >
              <option value="m">Meters (m)</option>
              <option value="ft">Feet (ft)</option>
            </select>
          </div>

          <div className="w-px h-4 bg-slate-700 mx-2" />

          <div className="flex items-center space-x-2">
            <label className="text-xs text-slate-400 font-medium uppercase">Max Iter</label>
            <input
              type="number"
              min={1}
              max={100}
              value={settings.maxIterations}
              onChange={handleIterChange}
              className="w-20 bg-slate-800 text-xs border border-slate-600 text-white rounded px-2 py-1 outline-none focus:border-blue-500 text-center"
            />
          </div>

          <div className="w-px h-4 bg-slate-700 mx-2" />

          <div className="flex flex-col">
            <div className="flex items-center space-x-2">
              <Settings size={14} className="text-slate-400" />
              <label className="text-xs text-slate-400 font-medium uppercase">Instrument</label>
              <select
                value={selectedInstrument}
                onChange={(e) => setSelectedInstrument(e.target.value)}
                className="bg-slate-800 text-xs border border-slate-600 text-white rounded px-2 py-1 outline-none focus:border-blue-500"
              >
                {Object.keys(instrumentLibrary).length === 0 && <option value="">(none)</option>}
                {Object.values(instrumentLibrary).map((inst) => (
                  <option key={inst.code} value={inst.code}>
                    {inst.code}
                  </option>
                ))}
              </select>
            </div>
            {selectedInstrument && instrumentLibrary[selectedInstrument] && (
              <div className="mt-1 text-[10px] text-slate-500">
                {instrumentLibrary[selectedInstrument].desc} - dist: {instrumentLibrary[selectedInstrument].distA_ppm}
                ppm + {instrumentLibrary[selectedInstrument].distB_const}m - angle: {instrumentLibrary[selectedInstrument].angleStd_sec}"
                - GPS: {instrumentLibrary[selectedInstrument].gpsStd_xy}m - lev: {instrumentLibrary[selectedInstrument].levStd_mmPerKm}mm/km
              </div>
            )}
          </div>
        </div>

        <div className="flex space-x-2">
          <button
            onClick={handleRun}
            className="flex items-center space-x-2 bg-green-600 hover:bg-green-500 text-white px-4 py-1.5 rounded text-sm font-medium transition-colors shadow-lg shadow-green-900/20"
          >
            <Play size={16} /> <span>Adjust</span>
          </button>
          <button
            onClick={() => setInput(DEFAULT_INPUT)}
            className="p-2 bg-slate-700 hover:bg-slate-600 rounded text-slate-300 transition-colors"
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </header>

      <div ref={layoutRef} className="flex-1 flex overflow-hidden w-full">
        {isSidebarOpen && (
          <>
            <div
              className="border-r border-slate-700 flex flex-col min-w-[260px] flex-none"
              style={{ width: `${splitPercent}%` }}
            >
              <div className="bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-400 flex justify-between items-center">
                <span>INPUT DATA (.dat)</span> <FileText size={14} />
              </div>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="flex-1 bg-slate-900 text-slate-300 p-4 font-mono text-xs resize-none focus:outline-none leading-relaxed selection:bg-blue-500/30"
                spellCheck={false}
              />
            </div>

            <div
              onMouseDown={handleDividerMouseDown}
              className="w-[4px] flex-none cursor-col-resize bg-slate-800 hover:bg-slate-600 transition-colors"
            />
          </>
        )}

        <div className="flex flex-col bg-slate-950 flex-1 min-w-0 overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 pr-4">
            <div className="flex">
              <button
                onClick={() => setActiveTab('report')}
                className={`px-6 py-3 text-sm font-medium flex items-center space-x-2 border-b-2 transition-colors ${
                  activeTab === 'report'
                    ? 'border-blue-500 text-white bg-slate-800'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <FileText size={16} /> <span>Adjustment Report</span>
              </button>
            </div>
            {!isSidebarOpen && (
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="text-xs flex items-center space-x-1 text-slate-500 hover:text-slate-300"
              >
                <Minimize2 size={12} /> <span>Show Input</span>
              </button>
            )}
          </div>

          <div className="flex-1 overflow-auto w-full">
            {!result ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-4">
                <Activity size={48} className="opacity-20" />
                <p>Paste/edit data, then press "Adjust" to solve.</p>
              </div>
            ) : (
              <ReportView result={result} settings={settings} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

interface ReportViewProps {
  result: AdjustmentResult
  settings: SettingsState
}

const ReportView: React.FC<ReportViewProps> = ({ result, settings }) => {
  const units = settings.units
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

export default App
