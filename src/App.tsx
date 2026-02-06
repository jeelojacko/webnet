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
  Download,
} from 'lucide-react'
import InputPane from './components/InputPane'
import ReportView from './components/ReportView'
import MapView from './components/MapView'
import { LSAEngine } from './engine/adjust'
import { RAD_TO_DEG, radToDmsStr } from './engine/angles'
import type {
  AdjustmentResult,
  InstrumentLibrary,
  ObservationOverride,
  CoordMode,
  OrderMode,
  DeltaMode,
  MapMode,
  AngleMode,
  VerticalReductionMode,
} from './types'

const FT_PER_M = 3.280839895

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
# I <CODE> <Desc-with-dashes> <edm_const(m)> <edm_ppm> <hz_precision(")> <va_precision(")> <inst_centr(m)> <tgt_centr(m)> [gps_xy_std(m)] [lev_std(mm/km)]
I TS1   TS-Geodetic-1mm+1ppm      0.001   1.0   1.0   1.0   0.003   0.003   0.020   1.5
I TS2   TS-Construction-3mm+2ppm  0.003   2.0   3.0   3.0   0.003   0.003   0.050   2.0
I GPS1  GNSS-Base-Rover-Fix       0.0   0.0   0.0   0.0   0.0   0.0   0.010   4.0
I LEV1  Digital-Level-0.7mm       0.0   0.0   0.0   0.0   0.0   0.0   0.000   0.7

# --- CONTROL / STATIONS ---
# C <ID> <E> <N> <H> [! ! ! to fix components; lone * is legacy-fixed with warning]
C 1000  5000.000 5000.000  100.000  !
C 1001  5300.000 5000.000  102.000  !
C 1002  5150.000 5300.000  101.500  !

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
  angleMode: AngleMode
  deltaMode: DeltaMode
  mapMode: MapMode
  mapScaleFactor?: number
  normalize: boolean
  applyCurvatureRefraction: boolean
  refractionCoefficient: number
  verticalReduction: VerticalReductionMode
  levelWeight?: number
  lonSign: 'west-positive' | 'west-negative'
}

type TabKey = 'report' | 'map'

/****************************
 * UI COMPONENTS
 ****************************/
const App: React.FC = () => {
  const [input, setInput] = useState<string>(DEFAULT_INPUT)
  const [result, setResult] = useState<AdjustmentResult | null>(null)
  const [lastRunInput, setLastRunInput] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('report')
  const [settings, setSettings] = useState<SettingsState>({ maxIterations: 10, units: 'm' })
  const [parseSettings, setParseSettings] = useState<ParseSettings>({
    coordMode: '3D',
    order: 'EN',
    angleMode: 'auto',
    deltaMode: 'slope',
    mapMode: 'off',
    mapScaleFactor: 1,
    normalize: true,
    applyCurvatureRefraction: false,
    refractionCoefficient: 0.13,
    verticalReduction: 'none',
    levelWeight: undefined,
    lonSign: 'west-negative',
  })
  const [selectedInstrument, setSelectedInstrument] = useState('')
  const [splitPercent, setSplitPercent] = useState(35) // left pane width (%)
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [excludedIds, setExcludedIds] = useState<Set<number>>(new Set())
  const [overrides, setOverrides] = useState<Record<number, ObservationOverride>>({})
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const isResizingRef = useRef(false)
  const settingsRef = useRef<HTMLDivElement | null>(null)

  const instrumentLibrary: InstrumentLibrary = useMemo(() => {
    const lines = input.split('\n')
    const lib: InstrumentLibrary = {}

    for (const raw of lines) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue

      const parts = line.split(/\s+/)
      if (parts[0]?.toUpperCase() === 'I' && parts.length >= 4) {
        const instCode = parts[1]
        const desc = parts[2]?.replace(/-/g, ' ') ?? ''
        const numeric = parts
          .slice(3)
          .map((p) => parseFloat(p))
          .filter((v) => !Number.isNaN(v))
        const legacy = numeric.length > 0 && numeric.length < 6
        const edmConst = legacy ? (numeric[1] ?? 0) : (numeric[0] ?? 0)
        const edmPpm = legacy ? (numeric[0] ?? 0) : (numeric[1] ?? 0)
        const hzPrec = legacy ? (numeric[2] ?? 0) : (numeric[2] ?? 0)
        const vaPrec = legacy ? (numeric[2] ?? 0) : (numeric[3] ?? 0)
        const instCentr = legacy ? 0 : (numeric[4] ?? 0)
        const tgtCentr = legacy ? 0 : (numeric[5] ?? 0)
        const gpsStd = legacy ? (numeric[3] ?? 0) : (numeric[6] ?? 0)
        const levStd = legacy ? (numeric[4] ?? 0) : (numeric[7] ?? 0)
        lib[instCode] = {
          code: instCode,
          desc,
          edm_const: edmConst,
          edm_ppm: edmPpm,
          hzPrecision_sec: hzPrec,
          vaPrecision_sec: vaPrec,
          instCentr_m: instCentr,
          tgtCentr_m: tgtCentr,
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

  useEffect(() => {
    if (!isSettingsOpen) return
    const handleClick = (event: MouseEvent) => {
      if (!settingsRef.current) return
      if (!settingsRef.current.contains(event.target as Node)) {
        setIsSettingsOpen(false)
      }
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsSettingsOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [isSettingsOpen])

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

  const buildResultsText = (res: AdjustmentResult): string => {
    const lines: string[] = []
    const now = new Date()
    const ellipse95Scale = 2.4477
    const linearUnit = settings.units === 'ft' ? 'ft' : 'm'
    const unitScale = settings.units === 'ft' ? FT_PER_M : 1
    lines.push(`# WebNet Adjustment Results`)
    lines.push(`# Generated: ${now.toLocaleString()}`)
    lines.push(`# Linear units: ${linearUnit}`)
    lines.push(
      `# Reduction: mapMode=${parseSettings.mapMode}, mapScale=${(parseSettings.mapScaleFactor ?? 1).toFixed(8)}, curvRef=${parseSettings.applyCurvatureRefraction ? 'ON' : 'OFF'}, k=${parseSettings.refractionCoefficient.toFixed(3)}, vRed=${parseSettings.verticalReduction}`,
    )
    lines.push('')
    lines.push(`Status: ${res.converged ? 'CONVERGED' : 'NOT CONVERGED'}`)
    lines.push(`Iterations: ${res.iterations}`)
    lines.push(`SEUW: ${res.seuw.toFixed(4)} (DOF: ${res.dof})`)
    if (res.condition) {
      lines.push(
        `Normal matrix condition estimate: ${res.condition.estimate.toExponential(4)} (threshold ${res.condition.threshold.toExponential(
          2,
        )}) ${res.condition.flagged ? 'WARNING' : 'OK'}`,
      )
    }
    if (res.controlConstraints) {
      lines.push(
        `Weighted control constraints: ${res.controlConstraints.count} (E=${res.controlConstraints.x}, N=${res.controlConstraints.y}, H=${res.controlConstraints.h})`,
      )
    }
    if (res.chiSquare) {
      lines.push(
        `Chi-square: T=${res.chiSquare.T.toFixed(4)} dof=${res.chiSquare.dof} p=${res.chiSquare.p.toFixed(
          4,
        )} (${res.chiSquare.pass95 ? 'PASS' : 'FAIL'} @95%)`,
      )
      lines.push(
        `Chi-square 95% interval: [${res.chiSquare.lower.toFixed(4)}, ${res.chiSquare.upper.toFixed(
          4,
        )}]`,
      )
      lines.push(
        `Variance factor: ${res.chiSquare.varianceFactor.toFixed(
          4,
        )} (accepted: ${res.chiSquare.varianceFactorLower.toFixed(
          4,
        )} .. ${res.chiSquare.varianceFactorUpper.toFixed(4)})`,
      )
    }
    lines.push('')
    lines.push('--- Adjusted Coordinates ---')
    lines.push(
      'ID\tNorthing\tEasting\tHeight\tType\tσN\tσE\tσH\tEllMaj\tEllMin\tEllAz\tEllMaj95\tEllMin95',
    )
    Object.entries(res.stations).forEach(([id, st]) => {
      const type = st.fixed ? 'FIXED' : 'ADJ'
      const sN = st.sN != null ? (st.sN * unitScale).toFixed(4) : '-'
      const sE = st.sE != null ? (st.sE * unitScale).toFixed(4) : '-'
      const sH = st.sH != null ? (st.sH * unitScale).toFixed(4) : '-'
      const ellMaj = st.errorEllipse ? (st.errorEllipse.semiMajor * unitScale).toFixed(4) : '-'
      const ellMin = st.errorEllipse ? (st.errorEllipse.semiMinor * unitScale).toFixed(4) : '-'
      const ellAz = st.errorEllipse ? st.errorEllipse.theta.toFixed(2) : '-'
      const ellMaj95 = st.errorEllipse
        ? (st.errorEllipse.semiMajor * ellipse95Scale * unitScale).toFixed(4)
        : '-'
      const ellMin95 = st.errorEllipse
        ? (st.errorEllipse.semiMinor * ellipse95Scale * unitScale).toFixed(4)
        : '-'
      lines.push(
        `${id}\t${(st.y * unitScale).toFixed(4)}\t${(st.x * unitScale).toFixed(4)}\t${(
          st.h * unitScale
        ).toFixed(4)}\t${type}\t${sN}\t${sE}\t${sH}\t${ellMaj}\t${ellMin}\t${ellAz}\t${ellMaj95}\t${ellMin95}`,
      )
    })
    lines.push('')
    if (res.typeSummary && Object.keys(res.typeSummary).length > 0) {
      lines.push('--- Per-Type Summary ---')
      const summaryRows = Object.entries(res.typeSummary).map(([type, s]) => ({
        type,
        count: s.count.toString(),
        rms: (s.unit === 'm' ? s.rms * unitScale : s.rms).toFixed(4),
        maxAbs: (s.unit === 'm' ? s.maxAbs * unitScale : s.maxAbs).toFixed(4),
        maxStdRes: s.maxStdRes.toFixed(3),
        over3: s.over3.toString(),
        over4: s.over4.toString(),
        unit: s.unit === 'm' ? linearUnit : s.unit,
      }))
      const header = {
        type: 'Type',
        count: 'Count',
        rms: 'RMS',
        maxAbs: 'MaxAbs',
        maxStdRes: 'MaxStdRes',
        over3: '>3σ',
        over4: '>4σ',
        unit: 'Unit',
      }
      const widths = {
        type: Math.max(header.type.length, ...summaryRows.map((r) => r.type.length)),
        count: Math.max(header.count.length, ...summaryRows.map((r) => r.count.length)),
        rms: Math.max(header.rms.length, ...summaryRows.map((r) => r.rms.length)),
        maxAbs: Math.max(header.maxAbs.length, ...summaryRows.map((r) => r.maxAbs.length)),
        maxStdRes: Math.max(header.maxStdRes.length, ...summaryRows.map((r) => r.maxStdRes.length)),
        over3: Math.max(header.over3.length, ...summaryRows.map((r) => r.over3.length)),
        over4: Math.max(header.over4.length, ...summaryRows.map((r) => r.over4.length)),
        unit: Math.max(header.unit.length, ...summaryRows.map((r) => r.unit.length)),
      }
      const pad = (value: string, size: number) => value.padEnd(size, ' ')
      lines.push(
        [
          pad(header.type, widths.type),
          pad(header.count, widths.count),
          pad(header.rms, widths.rms),
          pad(header.maxAbs, widths.maxAbs),
          pad(header.maxStdRes, widths.maxStdRes),
          pad(header.over3, widths.over3),
          pad(header.over4, widths.over4),
          pad(header.unit, widths.unit),
        ].join('  '),
      )
      summaryRows.forEach((row) => {
        lines.push(
          [
            pad(row.type, widths.type),
            pad(row.count, widths.count),
            pad(row.rms, widths.rms),
            pad(row.maxAbs, widths.maxAbs),
            pad(row.maxStdRes, widths.maxStdRes),
            pad(row.over3, widths.over3),
            pad(row.over4, widths.over4),
            pad(row.unit, widths.unit),
          ].join('  '),
        )
      })
      lines.push('')
    }
    if (res.relativePrecision && res.relativePrecision.length > 0) {
      lines.push('--- Relative Precision (Unknowns) ---')
      const relRows = res.relativePrecision.map((r) => ({
        from: r.from,
        to: r.to,
        sigmaN: (r.sigmaN * unitScale).toFixed(4),
        sigmaE: (r.sigmaE * unitScale).toFixed(4),
        sigmaDist: r.sigmaDist != null ? (r.sigmaDist * unitScale).toFixed(4) : '-',
        sigmaAz: r.sigmaAz != null ? (r.sigmaAz * RAD_TO_DEG * 3600).toFixed(2) : '-',
        ellMaj: r.ellipse ? (r.ellipse.semiMajor * unitScale).toFixed(4) : '-',
        ellMin: r.ellipse ? (r.ellipse.semiMinor * unitScale).toFixed(4) : '-',
        ellAz: r.ellipse ? r.ellipse.theta.toFixed(2) : '-',
      }))
      const header = {
        from: 'From',
        to: 'To',
        sigmaN: 'σN',
        sigmaE: 'σE',
        sigmaDist: 'σDist',
        sigmaAz: 'σAz(")',
        ellMaj: 'EllMaj',
        ellMin: 'EllMin',
        ellAz: 'EllAz',
      }
      const widths = {
        from: Math.max(header.from.length, ...relRows.map((r) => r.from.length)),
        to: Math.max(header.to.length, ...relRows.map((r) => r.to.length)),
        sigmaN: Math.max(header.sigmaN.length, ...relRows.map((r) => r.sigmaN.length)),
        sigmaE: Math.max(header.sigmaE.length, ...relRows.map((r) => r.sigmaE.length)),
        sigmaDist: Math.max(header.sigmaDist.length, ...relRows.map((r) => r.sigmaDist.length)),
        sigmaAz: Math.max(header.sigmaAz.length, ...relRows.map((r) => r.sigmaAz.length)),
        ellMaj: Math.max(header.ellMaj.length, ...relRows.map((r) => r.ellMaj.length)),
        ellMin: Math.max(header.ellMin.length, ...relRows.map((r) => r.ellMin.length)),
        ellAz: Math.max(header.ellAz.length, ...relRows.map((r) => r.ellAz.length)),
      }
      const pad = (value: string, size: number) => value.padEnd(size, ' ')
      lines.push(
        [
          pad(header.from, widths.from),
          pad(header.to, widths.to),
          pad(header.sigmaN, widths.sigmaN),
          pad(header.sigmaE, widths.sigmaE),
          pad(header.sigmaDist, widths.sigmaDist),
          pad(header.sigmaAz, widths.sigmaAz),
          pad(header.ellMaj, widths.ellMaj),
          pad(header.ellMin, widths.ellMin),
          pad(header.ellAz, widths.ellAz),
        ].join('  '),
      )
      relRows.forEach((r) => {
        lines.push(
          [
            pad(r.from, widths.from),
            pad(r.to, widths.to),
            pad(r.sigmaN, widths.sigmaN),
            pad(r.sigmaE, widths.sigmaE),
            pad(r.sigmaDist, widths.sigmaDist),
            pad(r.sigmaAz, widths.sigmaAz),
            pad(r.ellMaj, widths.ellMaj),
            pad(r.ellMin, widths.ellMin),
            pad(r.ellAz, widths.ellAz),
          ].join('  '),
        )
      })
      lines.push('')
    }
    if (res.traverseDiagnostics) {
      lines.push('--- Traverse Diagnostics ---')
      lines.push(`Closure count: ${res.traverseDiagnostics.closureCount}`)
      lines.push(
        `Misclosure: dE=${(res.traverseDiagnostics.misclosureE * unitScale).toFixed(4)} ${linearUnit}, dN=${(
          res.traverseDiagnostics.misclosureN * unitScale
        ).toFixed(4)} ${linearUnit}, Mag=${(res.traverseDiagnostics.misclosureMag * unitScale).toFixed(4)} ${linearUnit}`,
      )
      lines.push(
        `Traverse distance: ${(res.traverseDiagnostics.totalTraverseDistance * unitScale).toFixed(
          4,
        )} ${linearUnit}`,
      )
      lines.push(
        `Closure ratio: ${
          res.traverseDiagnostics.closureRatio != null
            ? `1:${res.traverseDiagnostics.closureRatio.toFixed(0)}`
            : '-'
        }`,
      )
      lines.push('')
    }
    if (res.directionSetDiagnostics && res.directionSetDiagnostics.length > 0) {
      lines.push('--- Direction Set Diagnostics ---')
      const rows = res.directionSetDiagnostics.map((d) => ({
        setId: d.setId,
        occupy: d.occupy,
        raw: String(d.rawCount),
        reduced: String(d.reducedCount),
        pairs: String(d.pairedTargets),
        face1: String(d.face1Count),
        face2: String(d.face2Count),
        orient: d.orientationDeg != null ? d.orientationDeg.toFixed(4) : '-',
        rms: d.residualRmsArcSec != null ? d.residualRmsArcSec.toFixed(2) : '-',
        max: d.residualMaxArcSec != null ? d.residualMaxArcSec.toFixed(2) : '-',
        orientSe: d.orientationSeArcSec != null ? d.orientationSeArcSec.toFixed(2) : '-',
      }))
      const header = {
        setId: 'Set',
        occupy: 'Occupy',
        raw: 'Raw',
        reduced: 'Reduced',
        pairs: 'Pairs',
        face1: 'F1',
        face2: 'F2',
        orient: 'Orient(deg)',
        rms: 'RMS(")',
        max: 'Max(")',
        orientSe: 'OrientSE(")',
      }
      const widths = {
        setId: Math.max(header.setId.length, ...rows.map((r) => r.setId.length)),
        occupy: Math.max(header.occupy.length, ...rows.map((r) => r.occupy.length)),
        raw: Math.max(header.raw.length, ...rows.map((r) => r.raw.length)),
        reduced: Math.max(header.reduced.length, ...rows.map((r) => r.reduced.length)),
        pairs: Math.max(header.pairs.length, ...rows.map((r) => r.pairs.length)),
        face1: Math.max(header.face1.length, ...rows.map((r) => r.face1.length)),
        face2: Math.max(header.face2.length, ...rows.map((r) => r.face2.length)),
        orient: Math.max(header.orient.length, ...rows.map((r) => r.orient.length)),
        rms: Math.max(header.rms.length, ...rows.map((r) => r.rms.length)),
        max: Math.max(header.max.length, ...rows.map((r) => r.max.length)),
        orientSe: Math.max(header.orientSe.length, ...rows.map((r) => r.orientSe.length)),
      }
      const pad = (value: string, size: number) => value.padEnd(size, ' ')
      lines.push(
        [
          pad(header.setId, widths.setId),
          pad(header.occupy, widths.occupy),
          pad(header.raw, widths.raw),
          pad(header.reduced, widths.reduced),
          pad(header.pairs, widths.pairs),
          pad(header.face1, widths.face1),
          pad(header.face2, widths.face2),
          pad(header.orient, widths.orient),
          pad(header.rms, widths.rms),
          pad(header.max, widths.max),
          pad(header.orientSe, widths.orientSe),
        ].join('  '),
      )
      rows.forEach((r) => {
        lines.push(
          [
            pad(r.setId, widths.setId),
            pad(r.occupy, widths.occupy),
            pad(r.raw, widths.raw),
            pad(r.reduced, widths.reduced),
            pad(r.pairs, widths.pairs),
            pad(r.face1, widths.face1),
            pad(r.face2, widths.face2),
            pad(r.orient, widths.orient),
            pad(r.rms, widths.rms),
            pad(r.max, widths.max),
            pad(r.orientSe, widths.orientSe),
          ].join('  '),
        )
      })
      lines.push('')
    }
    if (res.directionTargetDiagnostics && res.directionTargetDiagnostics.length > 0) {
      lines.push('--- Direction Target Repeatability (ranked) ---')
      const rows = res.directionTargetDiagnostics.map((d, idx) => ({
        rank: String(idx + 1),
        setId: d.setId,
        occupy: d.occupy,
        target: d.target,
        line: d.sourceLine != null ? String(d.sourceLine) : '-',
        raw: String(d.rawCount),
        face1: String(d.face1Count),
        face2: String(d.face2Count),
        spread: d.rawSpreadArcSec != null ? d.rawSpreadArcSec.toFixed(2) : '-',
        redSigma: d.reducedSigmaArcSec != null ? d.reducedSigmaArcSec.toFixed(2) : '-',
        residual: d.residualArcSec != null ? d.residualArcSec.toFixed(2) : '-',
        stdRes: d.stdRes != null ? d.stdRes.toFixed(2) : '-',
        local: d.localPass == null ? '-' : d.localPass ? 'PASS' : 'FAIL',
        mdb: d.mdbArcSec != null ? d.mdbArcSec.toFixed(2) : '-',
        score: d.suspectScore.toFixed(1),
      }))
      const header = {
        rank: '#',
        setId: 'Set',
        occupy: 'Occupy',
        target: 'Target',
        line: 'Line',
        raw: 'Raw',
        face1: 'F1',
        face2: 'F2',
        spread: 'Spread(")',
        redSigma: 'RedSigma(")',
        residual: 'Residual(")',
        stdRes: 'StdRes',
        local: 'Local',
        mdb: 'MDB(")',
        score: 'Score',
      }
      const widths = {
        rank: Math.max(header.rank.length, ...rows.map((r) => r.rank.length)),
        setId: Math.max(header.setId.length, ...rows.map((r) => r.setId.length)),
        occupy: Math.max(header.occupy.length, ...rows.map((r) => r.occupy.length)),
        target: Math.max(header.target.length, ...rows.map((r) => r.target.length)),
        line: Math.max(header.line.length, ...rows.map((r) => r.line.length)),
        raw: Math.max(header.raw.length, ...rows.map((r) => r.raw.length)),
        face1: Math.max(header.face1.length, ...rows.map((r) => r.face1.length)),
        face2: Math.max(header.face2.length, ...rows.map((r) => r.face2.length)),
        spread: Math.max(header.spread.length, ...rows.map((r) => r.spread.length)),
        redSigma: Math.max(header.redSigma.length, ...rows.map((r) => r.redSigma.length)),
        residual: Math.max(header.residual.length, ...rows.map((r) => r.residual.length)),
        stdRes: Math.max(header.stdRes.length, ...rows.map((r) => r.stdRes.length)),
        local: Math.max(header.local.length, ...rows.map((r) => r.local.length)),
        mdb: Math.max(header.mdb.length, ...rows.map((r) => r.mdb.length)),
        score: Math.max(header.score.length, ...rows.map((r) => r.score.length)),
      }
      const pad = (value: string, size: number) => value.padEnd(size, ' ')
      lines.push(
        [
          pad(header.rank, widths.rank),
          pad(header.setId, widths.setId),
          pad(header.occupy, widths.occupy),
          pad(header.target, widths.target),
          pad(header.line, widths.line),
          pad(header.raw, widths.raw),
          pad(header.face1, widths.face1),
          pad(header.face2, widths.face2),
          pad(header.spread, widths.spread),
          pad(header.redSigma, widths.redSigma),
          pad(header.residual, widths.residual),
          pad(header.stdRes, widths.stdRes),
          pad(header.local, widths.local),
          pad(header.mdb, widths.mdb),
          pad(header.score, widths.score),
        ].join('  '),
      )
      rows.forEach((r) => {
        lines.push(
          [
            pad(r.rank, widths.rank),
            pad(r.setId, widths.setId),
            pad(r.occupy, widths.occupy),
            pad(r.target, widths.target),
            pad(r.line, widths.line),
            pad(r.raw, widths.raw),
            pad(r.face1, widths.face1),
            pad(r.face2, widths.face2),
            pad(r.spread, widths.spread),
            pad(r.redSigma, widths.redSigma),
            pad(r.residual, widths.residual),
            pad(r.stdRes, widths.stdRes),
            pad(r.local, widths.local),
            pad(r.mdb, widths.mdb),
            pad(r.score, widths.score),
          ].join('  '),
        )
      })
      lines.push('')

      const suspects = res.directionTargetDiagnostics
        .filter((d) => d.localPass === false || (d.stdRes ?? 0) >= 2 || (d.rawSpreadArcSec ?? 0) >= 5)
        .slice(0, 20)
      if (suspects.length > 0) {
        lines.push('--- Direction Target Suspects ---')
        const suspectRows = suspects.map((d, idx) => ({
          rank: String(idx + 1),
          setId: d.setId,
          stations: `${d.occupy}-${d.target}`,
          spread: d.rawSpreadArcSec != null ? d.rawSpreadArcSec.toFixed(2) : '-',
          stdRes: d.stdRes != null ? d.stdRes.toFixed(2) : '-',
          local: d.localPass == null ? '-' : d.localPass ? 'PASS' : 'FAIL',
          score: d.suspectScore.toFixed(1),
        }))
        const suspectHeader = {
          rank: '#',
          setId: 'Set',
          stations: 'Stations',
          spread: 'Spread(")',
          stdRes: 'StdRes',
          local: 'Local',
          score: 'Score',
        }
        const suspectWidths = {
          rank: Math.max(suspectHeader.rank.length, ...suspectRows.map((r) => r.rank.length)),
          setId: Math.max(suspectHeader.setId.length, ...suspectRows.map((r) => r.setId.length)),
          stations: Math.max(suspectHeader.stations.length, ...suspectRows.map((r) => r.stations.length)),
          spread: Math.max(suspectHeader.spread.length, ...suspectRows.map((r) => r.spread.length)),
          stdRes: Math.max(suspectHeader.stdRes.length, ...suspectRows.map((r) => r.stdRes.length)),
          local: Math.max(suspectHeader.local.length, ...suspectRows.map((r) => r.local.length)),
          score: Math.max(suspectHeader.score.length, ...suspectRows.map((r) => r.score.length)),
        }
        lines.push(
          [
            pad(suspectHeader.rank, suspectWidths.rank),
            pad(suspectHeader.setId, suspectWidths.setId),
            pad(suspectHeader.stations, suspectWidths.stations),
            pad(suspectHeader.spread, suspectWidths.spread),
            pad(suspectHeader.stdRes, suspectWidths.stdRes),
            pad(suspectHeader.local, suspectWidths.local),
            pad(suspectHeader.score, suspectWidths.score),
          ].join('  '),
        )
        suspectRows.forEach((r) => {
          lines.push(
            [
              pad(r.rank, suspectWidths.rank),
              pad(r.setId, suspectWidths.setId),
              pad(r.stations, suspectWidths.stations),
              pad(r.spread, suspectWidths.spread),
              pad(r.stdRes, suspectWidths.stdRes),
              pad(r.local, suspectWidths.local),
              pad(r.score, suspectWidths.score),
            ].join('  '),
          )
        })
        lines.push('')
      }
    }
    if (res.directionRepeatabilityDiagnostics && res.directionRepeatabilityDiagnostics.length > 0) {
      lines.push('--- Direction Repeatability By Occupy-Target (multi-set) ---')
      const rows = res.directionRepeatabilityDiagnostics.map((d, idx) => ({
        rank: String(idx + 1),
        occupy: d.occupy,
        target: d.target,
        sets: String(d.setCount),
        localFail: String(d.localFailCount),
        faceUnbal: String(d.faceUnbalancedSets),
        resMean: d.residualMeanArcSec != null ? d.residualMeanArcSec.toFixed(2) : '-',
        resRms: d.residualRmsArcSec != null ? d.residualRmsArcSec.toFixed(2) : '-',
        resRange: d.residualRangeArcSec != null ? d.residualRangeArcSec.toFixed(2) : '-',
        resMax: d.residualMaxArcSec != null ? d.residualMaxArcSec.toFixed(2) : '-',
        stdRms: d.stdResRms != null ? d.stdResRms.toFixed(2) : '-',
        maxStd: d.maxStdRes != null ? d.maxStdRes.toFixed(2) : '-',
        spreadMean: d.meanRawSpreadArcSec != null ? d.meanRawSpreadArcSec.toFixed(2) : '-',
        spreadMax: d.maxRawSpreadArcSec != null ? d.maxRawSpreadArcSec.toFixed(2) : '-',
        worstSet: d.worstSetId ?? '-',
        line: d.worstLine != null ? String(d.worstLine) : '-',
        score: d.suspectScore.toFixed(1),
      }))
      const header = {
        rank: '#',
        occupy: 'Occupy',
        target: 'Target',
        sets: 'Sets',
        localFail: 'LocalFail',
        faceUnbal: 'FaceUnbal',
        resMean: 'ResMean(")',
        resRms: 'ResRMS(")',
        resRange: 'ResRange(")',
        resMax: 'ResMax(")',
        stdRms: 'RMS|t|',
        maxStd: 'Max|t|',
        spreadMean: 'SpreadMean(")',
        spreadMax: 'SpreadMax(")',
        worstSet: 'WorstSet',
        line: 'Line',
        score: 'Score',
      }
      const widths = {
        rank: Math.max(header.rank.length, ...rows.map((r) => r.rank.length)),
        occupy: Math.max(header.occupy.length, ...rows.map((r) => r.occupy.length)),
        target: Math.max(header.target.length, ...rows.map((r) => r.target.length)),
        sets: Math.max(header.sets.length, ...rows.map((r) => r.sets.length)),
        localFail: Math.max(header.localFail.length, ...rows.map((r) => r.localFail.length)),
        faceUnbal: Math.max(header.faceUnbal.length, ...rows.map((r) => r.faceUnbal.length)),
        resMean: Math.max(header.resMean.length, ...rows.map((r) => r.resMean.length)),
        resRms: Math.max(header.resRms.length, ...rows.map((r) => r.resRms.length)),
        resRange: Math.max(header.resRange.length, ...rows.map((r) => r.resRange.length)),
        resMax: Math.max(header.resMax.length, ...rows.map((r) => r.resMax.length)),
        stdRms: Math.max(header.stdRms.length, ...rows.map((r) => r.stdRms.length)),
        maxStd: Math.max(header.maxStd.length, ...rows.map((r) => r.maxStd.length)),
        spreadMean: Math.max(header.spreadMean.length, ...rows.map((r) => r.spreadMean.length)),
        spreadMax: Math.max(header.spreadMax.length, ...rows.map((r) => r.spreadMax.length)),
        worstSet: Math.max(header.worstSet.length, ...rows.map((r) => r.worstSet.length)),
        line: Math.max(header.line.length, ...rows.map((r) => r.line.length)),
        score: Math.max(header.score.length, ...rows.map((r) => r.score.length)),
      }
      const pad = (value: string, size: number) => value.padEnd(size, ' ')
      lines.push(
        [
          pad(header.rank, widths.rank),
          pad(header.occupy, widths.occupy),
          pad(header.target, widths.target),
          pad(header.sets, widths.sets),
          pad(header.localFail, widths.localFail),
          pad(header.faceUnbal, widths.faceUnbal),
          pad(header.resMean, widths.resMean),
          pad(header.resRms, widths.resRms),
          pad(header.resRange, widths.resRange),
          pad(header.resMax, widths.resMax),
          pad(header.stdRms, widths.stdRms),
          pad(header.maxStd, widths.maxStd),
          pad(header.spreadMean, widths.spreadMean),
          pad(header.spreadMax, widths.spreadMax),
          pad(header.worstSet, widths.worstSet),
          pad(header.line, widths.line),
          pad(header.score, widths.score),
        ].join('  '),
      )
      rows.forEach((r) => {
        lines.push(
          [
            pad(r.rank, widths.rank),
            pad(r.occupy, widths.occupy),
            pad(r.target, widths.target),
            pad(r.sets, widths.sets),
            pad(r.localFail, widths.localFail),
            pad(r.faceUnbal, widths.faceUnbal),
            pad(r.resMean, widths.resMean),
            pad(r.resRms, widths.resRms),
            pad(r.resRange, widths.resRange),
            pad(r.resMax, widths.resMax),
            pad(r.stdRms, widths.stdRms),
            pad(r.maxStd, widths.maxStd),
            pad(r.spreadMean, widths.spreadMean),
            pad(r.spreadMax, widths.spreadMax),
            pad(r.worstSet, widths.worstSet),
            pad(r.line, widths.line),
            pad(r.score, widths.score),
          ].join('  '),
        )
      })
      lines.push('')

      const suspects = res.directionRepeatabilityDiagnostics
        .filter((d) => d.localFailCount > 0 || (d.maxStdRes ?? 0) >= 2 || (d.maxRawSpreadArcSec ?? 0) >= 5)
        .slice(0, 20)
      if (suspects.length > 0) {
        lines.push('--- Direction Repeatability Suspects ---')
        const suspectRows = suspects.map((d, idx) => ({
          rank: String(idx + 1),
          stations: `${d.occupy}-${d.target}`,
          sets: String(d.setCount),
          resRange: d.residualRangeArcSec != null ? d.residualRangeArcSec.toFixed(2) : '-',
          maxStd: d.maxStdRes != null ? d.maxStdRes.toFixed(2) : '-',
          spreadMax: d.maxRawSpreadArcSec != null ? d.maxRawSpreadArcSec.toFixed(2) : '-',
          localFail: String(d.localFailCount),
          score: d.suspectScore.toFixed(1),
        }))
        const suspectHeader = {
          rank: '#',
          stations: 'Stations',
          sets: 'Sets',
          resRange: 'ResRange(")',
          maxStd: 'Max|t|',
          spreadMax: 'SpreadMax(")',
          localFail: 'LocalFail',
          score: 'Score',
        }
        const suspectWidths = {
          rank: Math.max(suspectHeader.rank.length, ...suspectRows.map((r) => r.rank.length)),
          stations: Math.max(suspectHeader.stations.length, ...suspectRows.map((r) => r.stations.length)),
          sets: Math.max(suspectHeader.sets.length, ...suspectRows.map((r) => r.sets.length)),
          resRange: Math.max(suspectHeader.resRange.length, ...suspectRows.map((r) => r.resRange.length)),
          maxStd: Math.max(suspectHeader.maxStd.length, ...suspectRows.map((r) => r.maxStd.length)),
          spreadMax: Math.max(suspectHeader.spreadMax.length, ...suspectRows.map((r) => r.spreadMax.length)),
          localFail: Math.max(suspectHeader.localFail.length, ...suspectRows.map((r) => r.localFail.length)),
          score: Math.max(suspectHeader.score.length, ...suspectRows.map((r) => r.score.length)),
        }
        lines.push(
          [
            pad(suspectHeader.rank, suspectWidths.rank),
            pad(suspectHeader.stations, suspectWidths.stations),
            pad(suspectHeader.sets, suspectWidths.sets),
            pad(suspectHeader.resRange, suspectWidths.resRange),
            pad(suspectHeader.maxStd, suspectWidths.maxStd),
            pad(suspectHeader.spreadMax, suspectWidths.spreadMax),
            pad(suspectHeader.localFail, suspectWidths.localFail),
            pad(suspectHeader.score, suspectWidths.score),
          ].join('  '),
        )
        suspectRows.forEach((r) => {
          lines.push(
            [
              pad(r.rank, suspectWidths.rank),
              pad(r.stations, suspectWidths.stations),
              pad(r.sets, suspectWidths.sets),
              pad(r.resRange, suspectWidths.resRange),
              pad(r.maxStd, suspectWidths.maxStd),
              pad(r.spreadMax, suspectWidths.spreadMax),
              pad(r.localFail, suspectWidths.localFail),
              pad(r.score, suspectWidths.score),
            ].join('  '),
          )
        })
        lines.push('')
      }
    }
    if (res.setupDiagnostics && res.setupDiagnostics.length > 0) {
      lines.push('--- Setup Diagnostics ---')
      const rows = res.setupDiagnostics.map((s) => ({
        station: s.station,
        dirSets: String(s.directionSetCount),
        dirObs: String(s.directionObsCount),
        angles: String(s.angleObsCount),
        dist: String(s.distanceObsCount),
        zen: String(s.zenithObsCount),
        lev: String(s.levelingObsCount),
        gps: String(s.gpsObsCount),
        travDist: (s.traverseDistance * unitScale).toFixed(3),
        orientRms: s.orientationRmsArcSec != null ? s.orientationRmsArcSec.toFixed(2) : '-',
        orientSe: s.orientationSeArcSec != null ? s.orientationSeArcSec.toFixed(2) : '-',
        rmsStd: s.rmsStdRes != null ? s.rmsStdRes.toFixed(2) : '-',
        maxStd: s.maxStdRes != null ? s.maxStdRes.toFixed(2) : '-',
        localFail: String(s.localFailCount),
        worstObs:
          s.worstObsType != null ? `${s.worstObsType.toUpperCase()} ${s.worstObsStations ?? ''}`.trim() : '-',
        worstLine: s.worstObsLine != null ? String(s.worstObsLine) : '-',
      }))
      const header = {
        station: 'Setup',
        dirSets: 'DirSets',
        dirObs: 'DirObs',
        angles: 'Angles',
        dist: 'Dist',
        zen: 'Zen',
        lev: 'Lev',
        gps: 'GPS',
        travDist: `TravDist(${linearUnit})`,
        orientRms: 'OrientRMS(")',
        orientSe: 'OrientSE(")',
        rmsStd: 'RMS|t|',
        maxStd: 'Max|t|',
        localFail: 'LocalFail',
        worstObs: 'WorstObs',
        worstLine: 'Line',
      }
      const widths = {
        station: Math.max(header.station.length, ...rows.map((r) => r.station.length)),
        dirSets: Math.max(header.dirSets.length, ...rows.map((r) => r.dirSets.length)),
        dirObs: Math.max(header.dirObs.length, ...rows.map((r) => r.dirObs.length)),
        angles: Math.max(header.angles.length, ...rows.map((r) => r.angles.length)),
        dist: Math.max(header.dist.length, ...rows.map((r) => r.dist.length)),
        zen: Math.max(header.zen.length, ...rows.map((r) => r.zen.length)),
        lev: Math.max(header.lev.length, ...rows.map((r) => r.lev.length)),
        gps: Math.max(header.gps.length, ...rows.map((r) => r.gps.length)),
        travDist: Math.max(header.travDist.length, ...rows.map((r) => r.travDist.length)),
        orientRms: Math.max(header.orientRms.length, ...rows.map((r) => r.orientRms.length)),
        orientSe: Math.max(header.orientSe.length, ...rows.map((r) => r.orientSe.length)),
        rmsStd: Math.max(header.rmsStd.length, ...rows.map((r) => r.rmsStd.length)),
        maxStd: Math.max(header.maxStd.length, ...rows.map((r) => r.maxStd.length)),
        localFail: Math.max(header.localFail.length, ...rows.map((r) => r.localFail.length)),
        worstObs: Math.max(header.worstObs.length, ...rows.map((r) => r.worstObs.length)),
        worstLine: Math.max(header.worstLine.length, ...rows.map((r) => r.worstLine.length)),
      }
      const pad = (value: string, size: number) => value.padEnd(size, ' ')
      lines.push(
        [
          pad(header.station, widths.station),
          pad(header.dirSets, widths.dirSets),
          pad(header.dirObs, widths.dirObs),
          pad(header.angles, widths.angles),
          pad(header.dist, widths.dist),
          pad(header.zen, widths.zen),
          pad(header.lev, widths.lev),
          pad(header.gps, widths.gps),
          pad(header.travDist, widths.travDist),
          pad(header.orientRms, widths.orientRms),
          pad(header.orientSe, widths.orientSe),
          pad(header.rmsStd, widths.rmsStd),
          pad(header.maxStd, widths.maxStd),
          pad(header.localFail, widths.localFail),
          pad(header.worstObs, widths.worstObs),
          pad(header.worstLine, widths.worstLine),
        ].join('  '),
      )
      rows.forEach((r) => {
        lines.push(
          [
            pad(r.station, widths.station),
            pad(r.dirSets, widths.dirSets),
            pad(r.dirObs, widths.dirObs),
            pad(r.angles, widths.angles),
            pad(r.dist, widths.dist),
            pad(r.zen, widths.zen),
            pad(r.lev, widths.lev),
            pad(r.gps, widths.gps),
            pad(r.travDist, widths.travDist),
            pad(r.orientRms, widths.orientRms),
            pad(r.orientSe, widths.orientSe),
            pad(r.rmsStd, widths.rmsStd),
            pad(r.maxStd, widths.maxStd),
            pad(r.localFail, widths.localFail),
            pad(r.worstObs, widths.worstObs),
            pad(r.worstLine, widths.worstLine),
          ].join('  '),
        )
      })
      lines.push('')

      const setupSuspects = [...res.setupDiagnostics]
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
      if (setupSuspects.length > 0) {
        lines.push('--- Setup Suspects ---')
        const suspectRows = setupSuspects.map((s, idx) => ({
          rank: String(idx + 1),
          station: s.station,
          localFail: String(s.localFailCount),
          maxStd: s.maxStdRes != null ? s.maxStdRes.toFixed(2) : '-',
          rmsStd: s.rmsStdRes != null ? s.rmsStdRes.toFixed(2) : '-',
          worstObs:
            s.worstObsType != null ? `${s.worstObsType.toUpperCase()} ${s.worstObsStations ?? ''}`.trim() : '-',
          line: s.worstObsLine != null ? String(s.worstObsLine) : '-',
        }))
        const suspectHeader = {
          rank: '#',
          station: 'Setup',
          localFail: 'LocalFail',
          maxStd: 'Max|t|',
          rmsStd: 'RMS|t|',
          worstObs: 'WorstObs',
          line: 'Line',
        }
        const suspectWidths = {
          rank: Math.max(suspectHeader.rank.length, ...suspectRows.map((r) => r.rank.length)),
          station: Math.max(suspectHeader.station.length, ...suspectRows.map((r) => r.station.length)),
          localFail: Math.max(suspectHeader.localFail.length, ...suspectRows.map((r) => r.localFail.length)),
          maxStd: Math.max(suspectHeader.maxStd.length, ...suspectRows.map((r) => r.maxStd.length)),
          rmsStd: Math.max(suspectHeader.rmsStd.length, ...suspectRows.map((r) => r.rmsStd.length)),
          worstObs: Math.max(suspectHeader.worstObs.length, ...suspectRows.map((r) => r.worstObs.length)),
          line: Math.max(suspectHeader.line.length, ...suspectRows.map((r) => r.line.length)),
        }
        lines.push(
          [
            pad(suspectHeader.rank, suspectWidths.rank),
            pad(suspectHeader.station, suspectWidths.station),
            pad(suspectHeader.localFail, suspectWidths.localFail),
            pad(suspectHeader.maxStd, suspectWidths.maxStd),
            pad(suspectHeader.rmsStd, suspectWidths.rmsStd),
            pad(suspectHeader.worstObs, suspectWidths.worstObs),
            pad(suspectHeader.line, suspectWidths.line),
          ].join('  '),
        )
        suspectRows.forEach((r) => {
          lines.push(
            [
              pad(r.rank, suspectWidths.rank),
              pad(r.station, suspectWidths.station),
              pad(r.localFail, suspectWidths.localFail),
              pad(r.maxStd, suspectWidths.maxStd),
              pad(r.rmsStd, suspectWidths.rmsStd),
              pad(r.worstObs, suspectWidths.worstObs),
              pad(r.line, suspectWidths.line),
            ].join('  '),
          )
        })
        lines.push('')
      }
    }
    if (res.sideshots && res.sideshots.length > 0) {
      lines.push('--- Post-Adjusted Sideshots ---')
      const rows = res.sideshots.map((s) => ({
        from: s.from,
        to: s.to,
        line: s.sourceLine != null ? String(s.sourceLine) : '-',
        mode: s.mode,
        az: s.azimuth != null ? radToDmsStr(s.azimuth) : '-',
        azSrc: s.azimuthSource ?? '-',
        hd: (s.horizDistance * unitScale).toFixed(4),
        dH: s.deltaH != null ? (s.deltaH * unitScale).toFixed(4) : '-',
        northing: s.northing != null ? (s.northing * unitScale).toFixed(4) : '-',
        easting: s.easting != null ? (s.easting * unitScale).toFixed(4) : '-',
        height: s.height != null ? (s.height * unitScale).toFixed(4) : '-',
        sigmaN: s.sigmaN != null ? (s.sigmaN * unitScale).toFixed(4) : '-',
        sigmaE: s.sigmaE != null ? (s.sigmaE * unitScale).toFixed(4) : '-',
        sigmaH: s.sigmaH != null ? (s.sigmaH * unitScale).toFixed(4) : '-',
        note: s.note ?? '-',
      }))
      const header = {
        from: 'From',
        to: 'To',
        line: 'Line',
        mode: 'Mode',
        az: 'Az',
        azSrc: 'AzSrc',
        hd: `HD(${linearUnit})`,
        dH: `dH(${linearUnit})`,
        northing: `Northing(${linearUnit})`,
        easting: `Easting(${linearUnit})`,
        height: `Height(${linearUnit})`,
        sigmaN: `σN(${linearUnit})`,
        sigmaE: `σE(${linearUnit})`,
        sigmaH: `σH(${linearUnit})`,
        note: 'Note',
      }
      const widths = {
        from: Math.max(header.from.length, ...rows.map((r) => r.from.length)),
        to: Math.max(header.to.length, ...rows.map((r) => r.to.length)),
        line: Math.max(header.line.length, ...rows.map((r) => r.line.length)),
        mode: Math.max(header.mode.length, ...rows.map((r) => r.mode.length)),
        az: Math.max(header.az.length, ...rows.map((r) => r.az.length)),
        azSrc: Math.max(header.azSrc.length, ...rows.map((r) => r.azSrc.length)),
        hd: Math.max(header.hd.length, ...rows.map((r) => r.hd.length)),
        dH: Math.max(header.dH.length, ...rows.map((r) => r.dH.length)),
        northing: Math.max(header.northing.length, ...rows.map((r) => r.northing.length)),
        easting: Math.max(header.easting.length, ...rows.map((r) => r.easting.length)),
        height: Math.max(header.height.length, ...rows.map((r) => r.height.length)),
        sigmaN: Math.max(header.sigmaN.length, ...rows.map((r) => r.sigmaN.length)),
        sigmaE: Math.max(header.sigmaE.length, ...rows.map((r) => r.sigmaE.length)),
        sigmaH: Math.max(header.sigmaH.length, ...rows.map((r) => r.sigmaH.length)),
        note: Math.max(header.note.length, ...rows.map((r) => r.note.length)),
      }
      const pad = (value: string, size: number) => value.padEnd(size, ' ')
      lines.push(
        [
          pad(header.from, widths.from),
          pad(header.to, widths.to),
          pad(header.line, widths.line),
          pad(header.mode, widths.mode),
          pad(header.az, widths.az),
          pad(header.azSrc, widths.azSrc),
          pad(header.hd, widths.hd),
          pad(header.dH, widths.dH),
          pad(header.northing, widths.northing),
          pad(header.easting, widths.easting),
          pad(header.height, widths.height),
          pad(header.sigmaN, widths.sigmaN),
          pad(header.sigmaE, widths.sigmaE),
          pad(header.sigmaH, widths.sigmaH),
          pad(header.note, widths.note),
        ].join('  '),
      )
      rows.forEach((r) => {
        lines.push(
          [
            pad(r.from, widths.from),
            pad(r.to, widths.to),
            pad(r.line, widths.line),
            pad(r.mode, widths.mode),
            pad(r.az, widths.az),
            pad(r.azSrc, widths.azSrc),
            pad(r.hd, widths.hd),
            pad(r.dH, widths.dH),
            pad(r.northing, widths.northing),
            pad(r.easting, widths.easting),
            pad(r.height, widths.height),
            pad(r.sigmaN, widths.sigmaN),
            pad(r.sigmaE, widths.sigmaE),
            pad(r.sigmaH, widths.sigmaH),
            pad(r.note, widths.note),
          ].join('  '),
        )
      })
      lines.push('')
    }
    lines.push('--- Observations & Residuals ---')
    lines.push(`MDB units: arcsec for angular types; ${linearUnit} for linear types`)
    const rows: {
      type: string
      stations: string
      sourceLine: string
      obs: string
      calc: string
      residual: string
      stdRes: string
      redundancy: string
      localTest: string
      mdb: string
      stdResAbs: number
    }[] = []
    const isAngularType = (type: string) =>
      type === 'angle' || type === 'direction' || type === 'bearing' || type === 'dir' || type === 'zenith'
    const formatMdb = (value: number, angular: boolean): string => {
      if (!Number.isFinite(value)) return 'inf'
      return angular
        ? `${(value * RAD_TO_DEG * 3600).toFixed(2)}"`
        : (value * unitScale).toFixed(4)
    }
    res.observations.forEach((obs) => {
      let stations = ''
      let obsStr = ''
      let calcStr = ''
      let resStr = ''
      const angular = isAngularType(obs.type)
      if (obs.type === 'angle') {
        stations = `${obs.at}-${obs.from}-${obs.to}`
        obsStr = radToDmsStr(obs.obs)
        calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-'
        resStr =
          obs.residual != null
            ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
            : '-'
      } else if (obs.type === 'direction') {
        const reductionLabel =
          obs.rawCount != null
            ? ` [raw ${obs.rawCount}->1, F1:${obs.rawFace1Count ?? '-'} F2:${obs.rawFace2Count ?? '-'}]`
            : ''
        stations = `${obs.at}-${obs.to} (${obs.setId})${reductionLabel}`
        obsStr = radToDmsStr(obs.obs)
        calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-'
        resStr =
          obs.residual != null
            ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
            : '-'
      } else if (obs.type === 'dir') {
        stations = `${obs.from}-${obs.to}`
        obsStr = radToDmsStr(obs.obs)
        calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-'
        resStr =
          obs.residual != null
            ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
            : '-'
      } else if (obs.type === 'dist') {
        stations = `${obs.from}-${obs.to}`
        obsStr = (obs.obs * unitScale).toFixed(4)
        calcStr = obs.calc != null ? ((obs.calc as number) * unitScale).toFixed(4) : '-'
        resStr = obs.residual != null ? ((obs.residual as number) * unitScale).toFixed(4) : '-'
      } else if (obs.type === 'bearing') {
        stations = `${obs.from}-${obs.to}`
        obsStr = radToDmsStr(obs.obs)
        calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-'
        resStr =
          obs.residual != null
            ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
            : '-'
      } else if (obs.type === 'zenith') {
        stations = `${obs.from}-${obs.to}`
        obsStr = radToDmsStr(obs.obs)
        calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-'
        resStr =
          obs.residual != null
            ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
            : '-'
      } else if (obs.type === 'gps') {
        stations = `${obs.from}-${obs.to}`
        obsStr = `dE=${(obs.obs.dE * unitScale).toFixed(3)}, dN=${(obs.obs.dN * unitScale).toFixed(3)}`
        calcStr =
          obs.calc != null
            ? `dE=${((obs.calc as { dE: number }).dE * unitScale).toFixed(3)}, dN=${(
                (obs.calc as { dN: number; dE: number }).dN * unitScale
              ).toFixed(3)}`
            : '-'
        resStr =
          obs.residual != null
            ? `vE=${((obs.residual as { vE: number }).vE * unitScale).toFixed(3)}, vN=${(
                (obs.residual as { vN: number; vE: number }).vN * unitScale
              ).toFixed(3)}`
            : '-'
      } else if (obs.type === 'lev') {
        stations = `${obs.from}-${obs.to}`
        obsStr = (obs.obs * unitScale).toFixed(4)
        calcStr = obs.calc != null ? ((obs.calc as number) * unitScale).toFixed(4) : '-'
        resStr = obs.residual != null ? ((obs.residual as number) * unitScale).toFixed(4) : '-'
      }

      const localTest =
        obs.localTestComponents != null
          ? `E:${obs.localTestComponents.passE ? 'PASS' : 'FAIL'} N:${
              obs.localTestComponents.passN ? 'PASS' : 'FAIL'
            }`
          : obs.localTest != null
            ? obs.localTest.pass
              ? 'PASS'
              : 'FAIL'
            : '-'
      const mdb =
        obs.mdbComponents != null
          ? `E=${formatMdb(obs.mdbComponents.mE, angular)}, N=${formatMdb(obs.mdbComponents.mN, angular)}`
          : obs.mdb != null
            ? formatMdb(obs.mdb, angular)
            : '-'
      const stdResAbs = Math.abs(obs.stdRes ?? 0)

      rows.push({
        type: obs.type,
        stations,
        sourceLine: obs.sourceLine != null ? String(obs.sourceLine) : '-',
        obs: obsStr || '-',
        calc: calcStr || '-',
        residual: resStr || '-',
        stdRes:
          obs.stdResComponents != null
            ? `${obs.stdResComponents.tE.toFixed(3)}/${obs.stdResComponents.tN.toFixed(3)}`
            : obs.stdRes != null
              ? obs.stdRes.toFixed(3)
              : '-',
        redundancy:
          typeof obs.redundancy === 'object'
            ? `${obs.redundancy.rE.toFixed(3)}/${obs.redundancy.rN.toFixed(3)}`
            : obs.redundancy != null
              ? obs.redundancy.toFixed(3)
              : '-',
        localTest,
        mdb,
        stdResAbs,
      })
    })

    rows.sort((a, b) => b.stdResAbs - a.stdResAbs)
    const suspects = rows
      .filter((r) => r.localTest.includes('FAIL') || r.stdResAbs >= 2)
      .slice(0, 20)

    if (suspects.length > 0) {
      lines.push('--- Top Suspects ---')
      const suspectHeader = {
        rank: '#',
        type: 'Type',
        stations: 'Stations',
        line: 'Line',
        stdRes: 'StdRes',
        local: 'Local',
        mdb: 'MDB',
      }
      const suspectRows = suspects.map((r, idx) => ({
        rank: String(idx + 1),
        type: r.type,
        stations: r.stations,
        line: r.sourceLine,
        stdRes: r.stdRes,
        local: r.localTest,
        mdb: r.mdb,
      }))
      const suspectWidths = {
        rank: Math.max(suspectHeader.rank.length, ...suspectRows.map((r) => r.rank.length)),
        type: Math.max(suspectHeader.type.length, ...suspectRows.map((r) => r.type.length)),
        stations: Math.max(
          suspectHeader.stations.length,
          ...suspectRows.map((r) => r.stations.length),
        ),
        line: Math.max(suspectHeader.line.length, ...suspectRows.map((r) => r.line.length)),
        stdRes: Math.max(suspectHeader.stdRes.length, ...suspectRows.map((r) => r.stdRes.length)),
        local: Math.max(suspectHeader.local.length, ...suspectRows.map((r) => r.local.length)),
        mdb: Math.max(suspectHeader.mdb.length, ...suspectRows.map((r) => r.mdb.length)),
      }
      const pad = (value: string, size: number) => value.padEnd(size, ' ')
      lines.push(
        [
          pad(suspectHeader.rank, suspectWidths.rank),
          pad(suspectHeader.type, suspectWidths.type),
          pad(suspectHeader.stations, suspectWidths.stations),
          pad(suspectHeader.line, suspectWidths.line),
          pad(suspectHeader.stdRes, suspectWidths.stdRes),
          pad(suspectHeader.local, suspectWidths.local),
          pad(suspectHeader.mdb, suspectWidths.mdb),
        ].join('  '),
      )
      suspectRows.forEach((r) => {
        lines.push(
          [
            pad(r.rank, suspectWidths.rank),
            pad(r.type, suspectWidths.type),
            pad(r.stations, suspectWidths.stations),
            pad(r.line, suspectWidths.line),
            pad(r.stdRes, suspectWidths.stdRes),
            pad(r.local, suspectWidths.local),
            pad(r.mdb, suspectWidths.mdb),
          ].join('  '),
        )
      })
      lines.push('')
    }

    const headers = {
      type: 'Type',
      stations: 'Stations',
      sourceLine: 'Line',
      obs: 'Obs',
      calc: 'Calc',
      residual: 'Residual',
      stdRes: 'StdRes',
      redundancy: 'Redund',
      localTest: 'Local',
      mdb: 'MDB',
    }
    const widths = {
      type: Math.max(headers.type.length, ...rows.map((r) => r.type.length)),
      stations: Math.max(headers.stations.length, ...rows.map((r) => r.stations.length)),
      sourceLine: Math.max(headers.sourceLine.length, ...rows.map((r) => r.sourceLine.length)),
      obs: Math.max(headers.obs.length, ...rows.map((r) => r.obs.length)),
      calc: Math.max(headers.calc.length, ...rows.map((r) => r.calc.length)),
      residual: Math.max(headers.residual.length, ...rows.map((r) => r.residual.length)),
      stdRes: Math.max(headers.stdRes.length, ...rows.map((r) => r.stdRes.length)),
      redundancy: Math.max(headers.redundancy.length, ...rows.map((r) => r.redundancy.length)),
      localTest: Math.max(headers.localTest.length, ...rows.map((r) => r.localTest.length)),
      mdb: Math.max(headers.mdb.length, ...rows.map((r) => r.mdb.length)),
    }
    const pad = (value: string, size: number) => value.padEnd(size, ' ')
    lines.push(
      [
        pad(headers.type, widths.type),
        pad(headers.stations, widths.stations),
        pad(headers.sourceLine, widths.sourceLine),
        pad(headers.obs, widths.obs),
        pad(headers.calc, widths.calc),
        pad(headers.residual, widths.residual),
        pad(headers.stdRes, widths.stdRes),
        pad(headers.redundancy, widths.redundancy),
        pad(headers.localTest, widths.localTest),
        pad(headers.mdb, widths.mdb),
      ].join('  '),
    )
    rows.forEach((r) => {
      lines.push(
        [
          pad(r.type, widths.type),
          pad(r.stations, widths.stations),
          pad(r.sourceLine, widths.sourceLine),
          pad(r.obs, widths.obs),
          pad(r.calc, widths.calc),
          pad(r.residual, widths.residual),
          pad(r.stdRes, widths.stdRes),
          pad(r.redundancy, widths.redundancy),
          pad(r.localTest, widths.localTest),
          pad(r.mdb, widths.mdb),
        ].join('  '),
      )
    })
    lines.push('')
    lines.push('--- Processing Log ---')
    res.logs.forEach((l) => lines.push(l))

    return lines.join('\n')
  }

  const handleExportResults = async () => {
    if (!result) return
    const text = buildResultsText(result)
    const suggestedName = `webnet-results-${new Date().toISOString().slice(0, 10)}.txt`
    const picker = (window as any).showSaveFilePicker
    if (picker) {
      try {
        const handle = await picker({
          suggestedName,
          types: [
            {
              description: 'Text Files',
              accept: { 'text/plain': ['.txt'] },
            },
          ],
        })
        const writable = await handle.createWritable()
        await writable.write(text)
        await writable.close()
        return
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return
      }
    }

    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = suggestedName
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
    setLastRunInput(input)
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
        angleMode: parseSettings.angleMode,
        deltaMode: parseSettings.deltaMode,
        mapMode: parseSettings.mapMode,
        mapScaleFactor: parseSettings.mapScaleFactor,
        normalize: parseSettings.normalize,
        applyCurvatureRefraction: parseSettings.applyCurvatureRefraction,
        refractionCoefficient: parseSettings.refractionCoefficient,
        verticalReduction: parseSettings.verticalReduction,
        levelWeight: parseSettings.levelWeight,
        lonSign: parseSettings.lonSign,
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

  const handleResetToLastRun = () => {
    if (lastRunInput != null) setInput(lastRunInput)
    setResult(null)
    setExcludedIds(new Set())
    setOverrides({})
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-slate-900 text-slate-100 font-sans overflow-hidden">
      <header className="h-16 bg-slate-800 border-b border-slate-700 flex items-center px-3 md:px-4 shrink-0 w-full gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-1.5 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition-colors"
            title={isSidebarOpen ? 'Close Input Sidebar' : 'Open Input Sidebar'}
          >
            {isSidebarOpen ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}
          </button>
          <div className="flex items-center space-x-2 min-w-0">
            <Activity className="text-blue-400" size={24} />
            <div className="flex flex-col min-w-0">
              <h1 className="text-lg font-bold tracking-wide text-white leading-none truncate">
                WebNet <span className="text-blue-400 font-light">Adjustment</span>
              </h1>
              <span className="text-xs text-slate-500 truncate">Survey LSA - TS + GPS + Leveling</span>
            </div>
          </div>
          <div className="relative" ref={settingsRef}>
            <button
              onClick={() => setIsSettingsOpen((prev) => !prev)}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded border text-xs uppercase tracking-wide ${
                isSettingsOpen
                  ? 'bg-slate-700 border-slate-500 text-white'
                  : 'bg-slate-900/60 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
              aria-expanded={isSettingsOpen}
              aria-haspopup="true"
            >
              <Settings size={14} />
              <span>Settings</span>
            </button>

            {isSettingsOpen && (
              <div className="absolute left-0 mt-2 w-[620px] max-w-[calc(100vw-1.5rem)] bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-4 z-50">
                <div className="text-xs text-slate-400 uppercase tracking-wider mb-3">
                  Adjustment Settings
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
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
                    <div className="flex items-center justify-between gap-3">
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
                    <div className="flex items-center justify-between gap-3">
                      <label className="text-xs text-slate-400 font-medium uppercase">Coord</label>
                      <select
                        value={parseSettings.coordMode}
                        onChange={(e) => handleParseSetting('coordMode', e.target.value as CoordMode)}
                        className="bg-slate-800 text-xs border border-slate-600 text-white rounded px-2 py-1 outline-none focus:border-blue-500"
                      >
                        <option value="2D">2D (.2D)</option>
                        <option value="3D">3D (.3D)</option>
                      </select>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <label className="text-xs text-slate-400 font-medium uppercase">Order</label>
                      <select
                        value={parseSettings.order}
                        onChange={(e) => handleParseSetting('order', e.target.value as OrderMode)}
                        className="bg-slate-800 text-xs border border-slate-600 text-white rounded px-2 py-1 outline-none focus:border-blue-500"
                      >
                        <option value="EN">EN (.ORDER EN)</option>
                        <option value="NE">NE (.ORDER NE)</option>
                      </select>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <label className="text-xs text-slate-400 font-medium uppercase">A Mode</label>
                      <select
                        value={parseSettings.angleMode}
                        onChange={(e) => handleParseSetting('angleMode', e.target.value as AngleMode)}
                        className="bg-slate-800 text-xs border border-slate-600 text-white rounded px-2 py-1 outline-none focus:border-blue-500"
                      >
                        <option value="auto">AUTO (.AMODE AUTO)</option>
                        <option value="angle">ANGLE (.AMODE ANGLE)</option>
                        <option value="dir">DIR (.AMODE DIR)</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
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
                    <div className="flex items-center justify-between gap-3">
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
                    <div className="flex items-center justify-between gap-3">
                      <label className="text-xs text-slate-400 font-medium uppercase">Map Scale</label>
                      <input
                        type="number"
                        min={0.5}
                        max={1.5}
                        step={0.000001}
                        value={parseSettings.mapScaleFactor ?? ''}
                        onChange={(e) =>
                          handleParseSetting(
                            'mapScaleFactor',
                            e.target.value === '' ? undefined : parseFloat(e.target.value),
                          )
                        }
                        className="w-24 bg-slate-800 text-xs border border-slate-600 text-white rounded px-2 py-1 outline-none focus:border-blue-500 text-center"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <label className="text-xs text-slate-400 font-medium uppercase">Curv/Ref</label>
                      <input
                        type="checkbox"
                        className="accent-blue-500"
                        checked={parseSettings.applyCurvatureRefraction}
                        onChange={(e) => handleParseSetting('applyCurvatureRefraction', e.target.checked)}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <label className="text-xs text-slate-400 font-medium uppercase">Refraction K</label>
                      <input
                        type="number"
                        min={-1}
                        max={1}
                        step={0.01}
                        value={parseSettings.refractionCoefficient}
                        onChange={(e) =>
                          handleParseSetting(
                            'refractionCoefficient',
                            Number.isFinite(parseFloat(e.target.value))
                              ? parseFloat(e.target.value)
                              : 0.13,
                          )
                        }
                        className="w-20 bg-slate-800 text-xs border border-slate-600 text-white rounded px-2 py-1 outline-none focus:border-blue-500 text-center"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <label className="text-xs text-slate-400 font-medium uppercase">V Red</label>
                      <select
                        value={parseSettings.verticalReduction}
                        onChange={(e) =>
                          handleParseSetting('verticalReduction', e.target.value as VerticalReductionMode)
                        }
                        className="bg-slate-800 text-xs border border-slate-600 text-white rounded px-2 py-1 outline-none focus:border-blue-500"
                      >
                        <option value="none">None (.VRED NONE)</option>
                        <option value="curvref">CurvRef (.VRED CURVREF)</option>
                      </select>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <label className="text-xs text-slate-400 font-medium uppercase">Normalize</label>
                      <input
                        type="checkbox"
                        className="accent-blue-500"
                        checked={parseSettings.normalize}
                        onChange={(e) => handleParseSetting('normalize', e.target.checked)}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3">
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
                    <div className="flex items-center justify-between gap-3">
                      <label className="text-xs text-slate-400 font-medium uppercase">Lon Sign</label>
                      <select
                        value={parseSettings.lonSign}
                        onChange={(e) =>
                          handleParseSetting('lonSign', e.target.value as ParseSettings['lonSign'])
                        }
                        className="bg-slate-800 text-xs border border-slate-600 text-white rounded px-2 py-1 outline-none focus:border-blue-500"
                      >
                        <option value="west-negative">West Negative (.LONSIGN W-)</option>
                        <option value="west-positive">West Positive (.LONSIGN W+)</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800">
                  <div className="flex items-center justify-between gap-3">
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
                    <div className="mt-2 text-[10px] text-slate-500">
                      {instrumentLibrary[selectedInstrument].desc} - edm:{' '}
                      {instrumentLibrary[selectedInstrument].edm_const}m +{' '}
                      {instrumentLibrary[selectedInstrument].edm_ppm}ppm - HZ:{' '}
                      {instrumentLibrary[selectedInstrument].hzPrecision_sec}" - VA:{' '}
                      {instrumentLibrary[selectedInstrument].vaPrecision_sec}" - cent:{' '}
                      {instrumentLibrary[selectedInstrument].instCentr_m}/
                      {instrumentLibrary[selectedInstrument].tgtCentr_m}m - GPS:{' '}
                      {instrumentLibrary[selectedInstrument].gpsStd_xy}m - lev:{' '}
                      {instrumentLibrary[selectedInstrument].levStd_mmPerKm}mm/km
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 ml-auto shrink-0">
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
            onClick={handleExportResults}
            disabled={!result}
            title={result ? 'Export Results' : 'Run adjustment to export results'}
            className={`p-2 rounded text-slate-300 transition-colors ${
              result ? 'bg-slate-700 hover:bg-slate-600' : 'bg-slate-800 opacity-50 cursor-not-allowed'
            }`}
          >
            <Download size={18} />
          </button>
          <button
            onClick={handleRun}
            className="flex items-center space-x-2 bg-green-600 hover:bg-green-500 text-white px-4 py-1.5 rounded text-sm font-medium transition-colors shadow-lg shadow-green-900/20"
          >
            <Play size={16} /> <span>Adjust</span>
          </button>
          <button
            onClick={handleResetToLastRun}
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
