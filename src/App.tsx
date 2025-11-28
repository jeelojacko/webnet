// WebNet Adjustment (TypeScript)

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  FileText,
  Map as MapIcon,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  RefreshCw,
  Settings,
} from 'lucide-react'
import InputPane from './components/InputPane'
import ReportView from './components/ReportView'
import MapView from './components/MapView'
import { LSAEngine } from './engine/adjust'
import type {
  AdjustmentResult,
  InstrumentLibrary,
  ObservationOverride,
  CoordMode,
  OrderMode,
  DeltaMode,
  MapMode,
} from './types'

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

type ParseSettings = {
  coordMode: CoordMode
  order: OrderMode
  deltaMode: DeltaMode
  mapMode: MapMode
  normalize: boolean
  levelWeight?: number
}

type TabKey = 'report' | 'map'

/****************************
 * UI COMPONENTS
 ****************************/
const App: React.FC = () => {
  const [input, setInput] = useState<string>(DEFAULT_INPUT)
  const [result, setResult] = useState<AdjustmentResult | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('report')
  const [settings, setSettings] = useState<SettingsState>({ maxIterations: 10, units: 'm' })
  const [parseSettings, setParseSettings] = useState<ParseSettings>({
    coordMode: '3D',
    order: 'EN',
    deltaMode: 'slope',
    mapMode: 'off',
    normalize: true,
    levelWeight: undefined,
  })
  const [selectedInstrument, setSelectedInstrument] = useState('')
  const [splitPercent, setSplitPercent] = useState(35) // left pane width (%)
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [excludedIds, setExcludedIds] = useState<Set<number>>(new Set())
  const [overrides, setOverrides] = useState<Record<number, ObservationOverride>>({})
  const fileInputRef = useRef<HTMLInputElement | null>(null)
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

  const handleDownload = () => {
    const blob = new Blob([input], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'webnet.dat'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      setInput(text)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const triggerFileSelect = () => {
    fileInputRef.current?.click()
  }

  const handleRun = () => {
    const engine = new LSAEngine({
      input,
      maxIterations: settings.maxIterations,
      instrumentLibrary,
      excludeIds: excludedIds,
      overrides,
      parseOptions: {
        units: settings.units,
        coordMode: parseSettings.coordMode,
        order: parseSettings.order,
        deltaMode: parseSettings.deltaMode,
        mapMode: parseSettings.mapMode,
        normalize: parseSettings.normalize,
        levelWeight: parseSettings.levelWeight,
      },
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

  const handleParseSetting = <K extends keyof ParseSettings>(key: K, value: ParseSettings[K]) => {
    setParseSettings((prev) => ({ ...prev, [key]: value }))
  }

  const toggleExclude = (id: number) => {
    setExcludedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const clearExclusions = () => setExcludedIds(new Set())

  const handleOverride = (id: number, payload: ObservationOverride) => {
    setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], ...payload } }))
  }

  const resetOverrides = () => setOverrides({})

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

          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2">
              <label className="text-xs text-slate-400 font-medium uppercase">Delta Mode</label>
              <select
                value={parseSettings.deltaMode}
                onChange={(e) => handleParseSetting('deltaMode', e.target.value as DeltaMode)}
                className="bg-slate-800 text-xs border border-slate-600 text-white rounded px-2 py-1 outline-none focus:border-blue-500"
              >
                <option value="slope">Slope + Zenith (.DELTA OFF)</option>
                <option value="horiz">Horizontal + dH (.DELTA ON)</option>
              </select>
            </div>

            <div className="flex items-center space-x-2">
              <label className="text-xs text-slate-400 font-medium uppercase">Map Mode</label>
              <select
                value={parseSettings.mapMode}
                onChange={(e) => handleParseSetting('mapMode', e.target.value as MapMode)}
                className="bg-slate-800 text-xs border border-slate-600 text-white rounded px-2 py-1 outline-none focus:border-blue-500"
              >
                <option value="off">Off</option>
                <option value="on">On</option>
                <option value="anglecalc">AngleCalc</option>
              </select>
            </div>

            <div className="flex items-center space-x-2">
              <label className="text-xs text-slate-400 font-medium uppercase">Normalize</label>
              <input
                type="checkbox"
                className="accent-blue-500"
                checked={parseSettings.normalize}
                onChange={(e) => handleParseSetting('normalize', e.target.checked)}
              />
            </div>

            <div className="flex items-center space-x-2">
              <label className="text-xs text-slate-400 font-medium uppercase">.LWEIGHT (mm/km)</label>
              <input
                type="number"
                min={0}
                step={0.1}
                value={parseSettings.levelWeight ?? ''}
                onChange={(e) =>
                  handleParseSetting(
                    'levelWeight',
                    e.target.value === '' ? undefined : parseFloat(e.target.value),
                  )
                }
                className="w-20 bg-slate-800 text-xs border border-slate-600 text-white rounded px-2 py-1 outline-none focus:border-blue-500 text-center"
              />
            </div>
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
          <input
            ref={fileInputRef}
            type="file"
            accept=".dat,.txt"
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            onClick={triggerFileSelect}
            className="p-2 bg-slate-700 hover:bg-slate-600 rounded text-slate-300 transition-colors"
          >
            <FileText size={18} />
          </button>
          <button
            onClick={handleDownload}
            className="p-2 bg-slate-700 hover:bg-slate-600 rounded text-slate-300 transition-colors"
          >
            <RefreshCw size={18} className="rotate-90" />
          </button>
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
            <div style={{ width: `${splitPercent}%` }}>
              <InputPane input={input} onChange={setInput} />
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
              <button
                onClick={() => setActiveTab('map')}
                className={`px-6 py-3 text-sm font-medium flex items-center space-x-2 border-b-2 transition-colors ${
                  activeTab === 'map'
                    ? 'border-blue-500 text-white bg-slate-800'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <MapIcon size={16} /> <span>Map & Ellipses</span>
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
              <>
                {activeTab === 'report' && (
                  <ReportView
                    result={result}
                    units={settings.units}
                    excludedIds={excludedIds}
                    onToggleExclude={toggleExclude}
                    onReRun={handleRun}
                    onClearExclusions={clearExclusions}
                    overrides={overrides}
                    onOverride={handleOverride}
                    onResetOverrides={resetOverrides}
                  />
                )}
                {activeTab === 'map' && <MapView result={result} units={settings.units} />}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
