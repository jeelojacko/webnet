import { dmsToRad, RAD_TO_DEG, SEC_TO_RAD } from './angles'
import type {
  AngleObservation,
  DistanceObservation,
  DirectionRejectDiagnostic,
  DirObservation,
  GpsObservation,
  Instrument,
  InstrumentLibrary,
  LevelObservation,
  Observation,
  ParseResult,
  StationMap,
  StationId,
  ParseOptions,
  MapMode,
  AngleMode,
} from '../types'

const defaultParseOptions: ParseOptions = {
  units: 'm',
  coordMode: '3D',
  order: 'EN',
  deltaMode: 'slope',
  mapMode: 'off',
  normalize: true,
  mapScaleFactor: 1,
  applyCurvatureRefraction: false,
  refractionCoefficient: 0.13,
  verticalReduction: 'none',
  lonSign: 'west-negative',
  currentInstrument: undefined,
  edmMode: 'additive',
  applyCentering: true,
  addCenteringToExplicit: false,
  debug: false,
  angleMode: 'auto',
  tsCorrelationEnabled: false,
  tsCorrelationRho: 0.25,
  tsCorrelationScope: 'set',
  robustMode: 'none',
  robustK: 1.5,
}

const FT_PER_M = 3.280839895
const EARTH_RADIUS_M = 6378137
const FACE2_WEIGHT = 0.707 // face-2 weighting factor per common spec
const DEG_TO_RAD = Math.PI / 180
const AMODE_AUTO_MAX_DIR_RAD = 3 * DEG_TO_RAD
const AMODE_AUTO_MARGIN_RAD = 0.5 * DEG_TO_RAD
const stripInlineComment = (line: string): string => {
  const hash = line.indexOf('#')
  const quote = line.indexOf("'")
  let cut = -1
  if (hash >= 0) cut = hash
  if (quote >= 0) cut = cut >= 0 ? Math.min(cut, quote) : quote
  return cut >= 0 ? line.slice(0, cut).trim() : line
}

const isNumericToken = (token: string): boolean => {
  if (!token) return false
  if (token === '!' || token === '*') return false
  return !Number.isNaN(Number(token))
}

const parseFixityTokens = (
  tokens: string[],
  componentCount: number,
): { fixities: boolean[]; hasTokens: boolean; legacyStarFixed: boolean } => {
  const raw = tokens.filter((t) => t === '!' || t === '*')
  if (!raw.length) {
    return { fixities: new Array(componentCount).fill(false), hasTokens: false, legacyStarFixed: false }
  }
  if (raw.length === 1 && raw[0] === '!') {
    return {
      fixities: new Array(componentCount).fill(true),
      hasTokens: true,
      legacyStarFixed: false,
    }
  }
  if (raw.length === 1 && raw[0] === '*') {
    return {
      fixities: new Array(componentCount).fill(true),
      hasTokens: true,
      legacyStarFixed: true,
    }
  }
  const fixities = new Array(componentCount).fill(false)
  for (let i = 0; i < componentCount && i < raw.length; i += 1) {
    fixities[i] = raw[i] === '!'
  }
  return { fixities, hasTokens: true, legacyStarFixed: false }
}

const applyFixities = (
  station: StationMap[string],
  fix: { x?: boolean; y?: boolean; h?: boolean },
  coordMode: ParseOptions['coordMode'],
): void => {
  if (fix.x != null) station.fixedX = fix.x
  if (fix.y != null) station.fixedY = fix.y
  if (fix.h != null) station.fixedH = fix.h
  const fx = station.fixedX ?? false
  const fy = station.fixedY ?? false
  const fh = station.fixedH ?? false
  station.fixed = coordMode === '2D' ? fx && fy : fx && fy && fh
}

type SigmaToken =
  | { kind: 'default' }
  | { kind: 'numeric'; value: number }
  | { kind: 'fixed' }
  | { kind: 'float' }

type SigmaSource = 'default' | 'explicit' | 'fixed' | 'float'

const FIXED_SIGMA = 1e-9
const FLOAT_SIGMA = 1e9

const wrapToPi = (val: number): number => {
  let v = val
  if (v > Math.PI) v -= 2 * Math.PI
  if (v < -Math.PI) v += 2 * Math.PI
  return v
}

const wrapTo2Pi = (val: number): number => {
  let v = val % (2 * Math.PI)
  if (v < 0) v += 2 * Math.PI
  return v
}

const weightedCircularMean = (values: number[], weights?: number[]): number => {
  if (!values.length) return 0
  let sumSin = 0
  let sumCos = 0
  for (let i = 0; i < values.length; i += 1) {
    const w = Math.max(weights?.[i] ?? 1, 0)
    sumSin += w * Math.sin(values[i])
    sumCos += w * Math.cos(values[i])
  }
  if (Math.abs(sumSin) < 1e-18 && Math.abs(sumCos) < 1e-18) {
    return wrapTo2Pi(values[0] ?? 0)
  }
  return wrapTo2Pi(Math.atan2(sumSin, sumCos))
}

const weightedCircularSpread = (values: number[], mean: number, weights?: number[]): number => {
  if (!values.length) return 0
  let sumW = 0
  let sumSq = 0
  for (let i = 0; i < values.length; i += 1) {
    const w = Math.max(weights?.[i] ?? 1, 0)
    const r = wrapToPi(values[i] - mean)
    sumW += w
    sumSq += w * r * r
  }
  if (sumW <= 0) return 0
  return Math.sqrt(sumSq / sumW)
}

const azimuthFromTo = (
  stations: StationMap,
  from: StationId,
  to: StationId,
): { az: number; dist: number } | null => {
  const s1 = stations[from]
  const s2 = stations[to]
  if (!s1 || !s2) return null
  const dx = s2.x - s1.x
  const dy = s2.y - s1.y
  let az = Math.atan2(dx, dy)
  if (az < 0) az += 2 * Math.PI
  return { az, dist: Math.sqrt(dx * dx + dy * dy) }
}

const parseSigmaToken = (token?: string): SigmaToken | null => {
  if (!token) return null
  if (token === '&' || token === '?') return { kind: 'default' }
  if (token === '!') return { kind: 'fixed' }
  if (token === '*') return { kind: 'float' }
  const value = parseFloat(token)
  if (!Number.isNaN(value)) return { kind: 'numeric', value }
  return null
}

const extractSigmaTokens = (
  tokens: string[],
  count: number,
): { sigmas: SigmaToken[]; rest: string[] } => {
  const sigmas: SigmaToken[] = []
  let idx = 0
  for (; idx < tokens.length && sigmas.length < count; idx += 1) {
    const token = tokens[idx]
    if (token.includes('/')) break
    const parsed = parseSigmaToken(token)
    if (!parsed) break
    sigmas.push(parsed)
  }
  return { sigmas, rest: tokens.slice(idx) }
}

const resolveSigma = (
  token: SigmaToken | undefined,
  defaultSigma: number,
): { sigma: number; source: SigmaSource } => {
  if (!token || token.kind === 'default') return { sigma: defaultSigma, source: 'default' }
  if (token.kind === 'numeric') return { sigma: token.value, source: 'explicit' }
  if (token.kind === 'fixed') return { sigma: FIXED_SIGMA, source: 'fixed' }
  return { sigma: FLOAT_SIGMA, source: 'float' }
}

const defaultDistanceSigma = (
  inst: Instrument | undefined,
  dist: number,
  edmMode: ParseOptions['edmMode'],
  fallback = 0.005,
): number => {
  if (!inst) return fallback
  const ppmTerm = inst.edm_ppm * 1e-6 * dist
  if (edmMode === 'propagated') {
    return Math.sqrt(inst.edm_const * inst.edm_const + ppmTerm * ppmTerm)
  }
  return Math.abs(inst.edm_const) + Math.abs(ppmTerm)
}

const parseFromTo = (
  parts: string[],
  startIndex: number,
): { from: string; to: string; nextIndex: number } => {
  const token = parts[startIndex]
  if (!token) return { from: '', to: '', nextIndex: startIndex + 1 }
  if (token.includes('-')) {
    const [from, to] = token.split('-')
    return { from, to, nextIndex: startIndex + 1 }
  }
  const from = token
  const to = parts[startIndex + 1] ?? ''
  return { from, to, nextIndex: startIndex + 2 }
}

const extractHiHt = (
  tokens: string[],
): { hi?: number; ht?: number; rest: string[] } => {
  const idx = tokens.findIndex((t) => t.includes('/'))
  if (idx < 0) return { rest: tokens }
  const token = tokens[idx]
  const [hiStr, htStr] = token.split('/')
  const hi = parseFloat(hiStr)
  const ht = parseFloat(htStr)
  const rest = tokens.filter((_, i) => i !== idx)
  return {
    hi: Number.isNaN(hi) ? undefined : hi,
    ht: Number.isNaN(ht) ? undefined : ht,
    rest,
  }
}

const toDegrees = (token: string): number => {
  if (!token) return Number.NaN
  if (token.includes('-')) return dmsToRad(token) * RAD_TO_DEG
  return parseFloat(token)
}

const projectLatLonToEN = (
  latDeg: number,
  lonDeg: number,
  originLatDeg: number,
  originLonDeg: number,
) => {
  const lat = (latDeg * Math.PI) / 180
  const lon = (lonDeg * Math.PI) / 180
  const lat0 = (originLatDeg * Math.PI) / 180
  const lon0 = (originLonDeg * Math.PI) / 180
  const dLat = lat - lat0
  const dLon = lon - lon0
  const north = EARTH_RADIUS_M * dLat
  const east = EARTH_RADIUS_M * Math.cos(lat0) * dLon
  return { east, north }
}

export const parseInput = (
  input: string,
  existingInstruments: InstrumentLibrary = {},
  opts: Partial<ParseOptions> = {},
): ParseResult => {
  type DirectionFace = 'face1' | 'face2'
  interface RawDirectionShot {
    to: StationId
    obs: number
    stdDev: number
    sigmaSource: SigmaSource
    sourceLine: number
    face: DirectionFace
  }

  const stations: StationMap = {}
  const observations: Observation[] = []
  const instrumentLibrary: InstrumentLibrary = { ...existingInstruments }
  const logs: string[] = []
  const directionRejectDiagnostics: DirectionRejectDiagnostic[] = []
  const state: ParseOptions = { ...defaultParseOptions, ...opts }
  let orderExplicit = false
  const traverseCtx: {
    occupy?: string
    backsight?: string
    backsightRefAngle?: number
    dirSetId?: string
    dirInstCode?: string
    dirRawShots?: RawDirectionShot[]
  } = {}
  let faceMode: 'unknown' | 'face1' | 'face2' = 'unknown'
  let directionSetCount = 0

  const lines = input.split('\n')
  let lineNum = 0
  let obsId = 0
  const pushObservation = <T extends Observation>(obs: T): void => {
    if (obs.sourceLine == null) obs.sourceLine = lineNum
    observations.push(obs)
  }
  const combineSigmaSources = (shots: RawDirectionShot[]): SigmaSource => {
    if (!shots.length) return 'default'
    if (shots.some((s) => s.sigmaSource === 'fixed')) return 'fixed'
    if (shots.every((s) => s.sigmaSource === 'float')) return 'float'
    if (shots.every((s) => s.sigmaSource === 'default')) return 'default'
    return 'explicit'
  }
  const reduceDirectionShots = (
    setId: string,
    occupy: StationId,
    instCode: string,
    shots: RawDirectionShot[],
  ): void => {
    if (!shots.length) return

    if (!state.normalize) {
      shots.forEach((shot) => {
        pushObservation({
          id: obsId++,
          type: 'direction',
          instCode,
          setId,
          at: occupy,
          to: shot.to,
          obs: shot.obs,
          stdDev: shot.stdDev,
          sigmaSource: shot.sigmaSource,
          sourceLine: shot.sourceLine,
          rawCount: 1,
          rawFace1Count: shot.face === 'face1' ? 1 : 0,
          rawFace2Count: shot.face === 'face2' ? 1 : 0,
          rawSpread: 0,
          rawMaxResidual: 0,
          reducedSigma: shot.stdDev,
        })
      })
      logs.push(`Direction set ${setId} @ ${occupy}: kept ${shots.length} raw direction(s)`)
      return
    }

    const byTarget = new Map<StationId, RawDirectionShot[]>()
    shots.forEach((shot) => {
      const list = byTarget.get(shot.to) ?? []
      list.push(shot)
      byTarget.set(shot.to, list)
    })

    let reducedCount = 0
    let pairedTargets = 0
    let face1Total = 0
    let face2Total = 0

    const targets = [...byTarget.keys()].sort((a, b) => a.localeCompare(b))
    targets.forEach((to) => {
      const targetShots = byTarget.get(to) ?? []
      if (!targetShots.length) return
      const face1Count = targetShots.filter((s) => s.face === 'face1').length
      const face2Count = targetShots.length - face1Count
      face1Total += face1Count
      face2Total += face2Count
      if (face1Count > 0 && face2Count > 0) pairedTargets += 1

      const normalized = targetShots.map((shot) => {
        const obs = shot.face === 'face2' ? wrapTo2Pi(shot.obs - Math.PI) : wrapTo2Pi(shot.obs)
        const weight = 1 / Math.max(shot.stdDev * shot.stdDev, 1e-24)
        return { ...shot, normalizedObs: obs, weight }
      })
      const obsValues = normalized.map((s) => s.normalizedObs)
      const obsWeights = normalized.map((s) => s.weight)
      const reducedObs = weightedCircularMean(obsValues, obsWeights)
      const sumW = obsWeights.reduce((acc, w) => acc + w, 0)
      const reducedSigma = sumW > 0 ? Math.sqrt(1 / sumW) : normalized[0].stdDev
      const residuals = normalized.map((shot) => wrapToPi(shot.normalizedObs - reducedObs))
      const spread = weightedCircularSpread(obsValues, reducedObs, obsWeights)
      const rawMaxResidual = residuals.length
        ? Math.max(...residuals.map((r) => Math.abs(r)))
        : 0

      const faceStats = (face: DirectionFace): { mean?: number; spread?: number } => {
        const faceShots = normalized.filter((s) => s.face === face)
        if (!faceShots.length) return {}
        const faceObs = faceShots.map((s) => s.normalizedObs)
        const faceWeights = faceShots.map((s) => s.weight)
        const mean = weightedCircularMean(faceObs, faceWeights)
        const faceSpread = weightedCircularSpread(faceObs, mean, faceWeights)
        return { mean, spread: faceSpread }
      }

      const face1Stats = faceStats('face1')
      const face2Stats = faceStats('face2')
      const facePairDelta =
        face1Stats.mean != null && face2Stats.mean != null
          ? Math.abs(wrapToPi(face1Stats.mean - face2Stats.mean))
          : undefined

      pushObservation({
        id: obsId++,
        type: 'direction',
        instCode,
        setId,
        at: occupy,
        to,
        obs: reducedObs,
        stdDev: reducedSigma,
        sigmaSource: combineSigmaSources(targetShots),
        sourceLine: Math.min(...targetShots.map((s) => s.sourceLine)),
        rawCount: targetShots.length,
        rawFace1Count: face1Count,
        rawFace2Count: face2Count,
        rawSpread: spread,
        rawMaxResidual,
        facePairDelta,
        face1Spread: face1Stats.spread,
        face2Spread: face2Stats.spread,
        reducedSigma,
      })
      reducedCount += 1
    })

    logs.push(
      `Direction set reduction ${setId} @ ${occupy}: raw ${shots.length} -> reduced ${reducedCount} (paired targets=${pairedTargets}, F1=${face1Total}, F2=${face2Total})`,
    )
  }
  const flushDirectionSet = (reason: string): void => {
    if (!traverseCtx.dirSetId || !traverseCtx.occupy) return
    const shots = traverseCtx.dirRawShots ?? []
    const instCode = traverseCtx.dirInstCode ?? ''
    if (!shots.length) {
      logs.push(`Direction set ${traverseCtx.dirSetId} @ ${traverseCtx.occupy}: no directions (${reason})`)
      directionRejectDiagnostics.push({
        setId: traverseCtx.dirSetId,
        occupy: traverseCtx.occupy,
        sourceLine: lineNum,
        recordType: reason === 'DE' ? 'DE' : reason === 'new DB' ? 'DB' : 'UNKNOWN',
        reason: 'no-shots',
        detail: `No valid direction observations kept (${reason})`,
      })
    } else {
      reduceDirectionShots(traverseCtx.dirSetId, traverseCtx.occupy, instCode, shots)
    }
    traverseCtx.occupy = undefined
    traverseCtx.backsight = undefined
    traverseCtx.dirSetId = undefined
    traverseCtx.dirInstCode = undefined
    traverseCtx.dirRawShots = undefined
    faceMode = 'unknown'
  }

  for (const raw of lines) {
    lineNum += 1
    const trimmed = raw.trim()
    if (!trimmed) continue
    const line = stripInlineComment(trimmed)
    if (!line || line.startsWith('#')) continue

    // Inline options
    if (line.startsWith('.')) {
      const parts = line.split(/\s+/)
      const op = parts[0].toUpperCase()
      if (op === '.UNITS' && parts[1]) {
        state.units = parts[1].toLowerCase() === 'us' || parts[1].toLowerCase() === 'ft' ? 'ft' : 'm'
        logs.push(`Units set to ${state.units}`)
      } else if (op === '.COORD' && parts[1]) {
        state.coordMode = parts[1].toUpperCase() === '2D' ? '2D' : '3D'
        logs.push(`Coord mode set to ${state.coordMode}`)
      } else if (op === '.ORDER' && parts[1]) {
        const o = parts[1].toUpperCase()
        if (o === 'NE' || o === 'EN') state.order = o as 'NE' | 'EN'
        orderExplicit = true
        logs.push(`Order set to ${state.order}`)
      } else if (op === '.2D') {
        state.coordMode = '2D'
        logs.push('Coord mode forced to 2D')
      } else if (op === '.3D') {
        state.coordMode = '3D'
        logs.push('Coord mode forced to 3D')
      } else if (op === '.DELTA' && parts[1]) {
        state.deltaMode = parts[1].toUpperCase() === 'ON' ? 'horiz' : 'slope'
        logs.push(`Delta mode set to ${state.deltaMode}`)
      } else if (op === '.MAPMODE') {
        const mode = (parts[1] || '').toUpperCase()
        const mapMode: MapMode =
          mode === 'ANGLECALC' ? 'anglecalc' : mode === 'ON' || mode === 'GRID' ? 'on' : 'off'
        state.mapMode = mapMode
        logs.push(`Map mode set to ${mapMode}`)
      } else if (op === '.MAPSCALE' && parts[1]) {
        const factor = parseFloat(parts[1])
        if (Number.isFinite(factor) && factor > 0) {
          state.mapScaleFactor = factor
          logs.push(`Map scale factor set to ${factor}`)
        }
      } else if (op === '.LWEIGHT' && parts[1]) {
        const val = parseFloat(parts[1])
        if (!Number.isNaN(val)) {
          state.levelWeight = val
          logs.push(`Level weight set to ${val}`)
        }
      } else if (op === '.NORMALIZE') {
        const mode = (parts[1] || '').toUpperCase()
        state.normalize = mode !== 'OFF'
        logs.push(`Normalize set to ${state.normalize}`)
      } else if (op === '.LONSIGN') {
        const mode = (parts[1] || '').toUpperCase()
        state.lonSign = mode === 'WESTPOS' || mode === 'POSW' ? 'west-positive' : 'west-negative'
        logs.push(`Longitude sign set to ${state.lonSign}`)
      } else if (op === '.EDM') {
        const mode = (parts[1] || '').toUpperCase()
        state.edmMode = mode === 'PROPAGATED' || mode === 'RSS' ? 'propagated' : 'additive'
        logs.push(`EDM mode set to ${state.edmMode}`)
      } else if (op === '.CENTERING') {
        const mode = (parts[1] || '').toUpperCase()
        state.applyCentering = mode !== 'OFF'
        logs.push(`Centering inflation set to ${state.applyCentering}`)
      } else if (op === '.ADDC') {
        const mode = (parts[1] || '').toUpperCase()
        state.addCenteringToExplicit = mode === 'ON'
        logs.push(`Add centering to explicit std dev set to ${state.addCenteringToExplicit}`)
      } else if (op === '.DEBUG') {
        const mode = (parts[1] || '').toUpperCase()
        state.debug = mode !== 'OFF'
        logs.push(`Debug logging set to ${state.debug}`)
      } else if (op === '.CURVREF') {
        const mode = (parts[1] || '').toUpperCase()
        if (mode === 'ON' || mode === 'OFF') {
          state.applyCurvatureRefraction = mode === 'ON'
          logs.push(`Curvature/refraction set to ${state.applyCurvatureRefraction}`)
        } else if (parts[1] && Number.isFinite(parseFloat(parts[1]))) {
          state.refractionCoefficient = parseFloat(parts[1])
          state.applyCurvatureRefraction = true
          logs.push(
            `Curvature/refraction enabled with k=${state.refractionCoefficient.toFixed(3)}`,
          )
        }
      } else if (op === '.REFRACTION' && parts[1]) {
        const k = parseFloat(parts[1])
        if (Number.isFinite(k)) {
          state.refractionCoefficient = k
          logs.push(`Refraction coefficient set to ${k}`)
        }
      } else if (op === '.VRED') {
        const mode = (parts[1] || '').toUpperCase()
        state.verticalReduction =
          mode === 'CR' || mode === 'CURVREF' || mode === 'CURVATURE' ? 'curvref' : 'none'
        logs.push(`Vertical reduction set to ${state.verticalReduction}`)
      } else if (op === '.AMODE') {
        const mode = (parts[1] || '').toUpperCase()
        let angleMode: AngleMode = 'auto'
        if (mode === 'ANGLE') angleMode = 'angle'
        if (mode === 'DIR' || mode === 'AZ' || mode === 'AZIMUTH') angleMode = 'dir'
        state.angleMode = angleMode
        logs.push(`A-record mode set to ${angleMode}`)
      } else if (op === '.ROBUST') {
        const mode = (parts[1] || '').toUpperCase()
        const maybeK = parseFloat(parts[2] || parts[1] || '')
        if (!mode || mode === 'OFF' || mode === 'NONE' || mode === '0') {
          state.robustMode = 'none'
          logs.push('Robust mode set to none')
        } else {
          state.robustMode = 'huber'
          if (Number.isFinite(maybeK)) {
            state.robustK = Math.max(0.5, Math.min(10, maybeK))
          }
          logs.push(`Robust mode set to huber (k=${(state.robustK ?? 1.5).toFixed(2)})`)
        }
      } else if (op === '.TSCORR') {
        const parseScope = (token?: string): ParseOptions['tsCorrelationScope'] | undefined => {
          const mode = (token || '').toUpperCase()
          if (mode === 'SETUP') return 'setup'
          if (mode === 'SET') return 'set'
          return undefined
        }
        const parseRho = (token?: string): number | undefined => {
          const val = parseFloat(token || '')
          if (!Number.isFinite(val)) return undefined
          return Math.min(0.95, Math.max(0, val))
        }
        const t1 = (parts[1] || '').toUpperCase()
        const t2 = (parts[2] || '').toUpperCase()
        let enabled = state.tsCorrelationEnabled ?? false
        let rho = state.tsCorrelationRho ?? 0.25
        let scope: ParseOptions['tsCorrelationScope'] = state.tsCorrelationScope ?? 'set'

        if (!t1 || t1 === 'ON' || t1 === 'TRUE') {
          enabled = true
          const maybeScope = parseScope(t2)
          const maybeRho = parseRho(parts[2])
          if (maybeScope) scope = maybeScope
          else if (maybeRho != null) rho = maybeRho
        } else if (t1 === 'OFF' || t1 === 'FALSE' || t1 === '0') {
          enabled = false
        } else {
          const scope1 = parseScope(t1)
          const rho1 = parseRho(parts[1])
          if (scope1) {
            enabled = true
            scope = scope1
            const rho2 = parseRho(parts[2])
            if (rho2 != null) rho = rho2
          } else if (rho1 != null) {
            enabled = true
            rho = rho1
            const scope2 = parseScope(t2)
            if (scope2) scope = scope2
          } else {
            logs.push(`Warning: unrecognized .TSCORR option at line ${lineNum}; expected ON/OFF/SET/SETUP/rho`)
          }
        }

        state.tsCorrelationEnabled = enabled
        state.tsCorrelationRho = rho
        state.tsCorrelationScope = scope
        logs.push(
          `TS correlation set to ${enabled ? 'ON' : 'OFF'} (scope=${scope}, rho=${rho.toFixed(3)})`,
        )
      } else if (op === '.I' && parts[1]) {
        state.currentInstrument = parts[1]
        logs.push(`Current instrument set to ${state.currentInstrument}`)
      } else if (op === '.TS' && parts[1]) {
        state.currentInstrument = parts[1]
        logs.push(`Current instrument set to ${state.currentInstrument}`)
      } else if (op === '.END') {
        if (traverseCtx.dirSetId) flushDirectionSet('.END')
        logs.push('END encountered; stopping parse')
        break
      }
      continue
    }

    const parts = line.split(/\s+/)
    const code = parts[0]?.toUpperCase()

    try {
      if (code === 'I') {
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
        const inst: Instrument = {
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
        instrumentLibrary[instCode] = inst
      } else if (code === 'C') {
        const id = parts[1]
        const tokens = parts.slice(2)
        const numeric = tokens.filter(isNumericToken).map((p) => parseFloat(p))
        const is3D = state.coordMode === '3D'
        const coordCount = is3D ? 3 : 2
        const coords = numeric.slice(0, coordCount)
        const stds = numeric.slice(coordCount)
        const north = state.order === 'NE' ? coords[0] ?? 0 : coords[1] ?? 0
        const east = state.order === 'NE' ? coords[1] ?? 0 : coords[0] ?? 0
        const h = is3D ? coords[2] ?? 0 : 0
        const { fixities, legacyStarFixed } = parseFixityTokens(tokens, coordCount)
        if (legacyStarFixed) {
          logs.push(
            `Warning: legacy lone "*" fixity at line ${lineNum} treated as fixed. Prefer "!" for fixed components.`,
          )
        }
        const fixN = state.order === 'NE' ? fixities[0] : fixities[1]
        const fixE = state.order === 'NE' ? fixities[1] : fixities[0]
        const fixH = is3D ? fixities[2] : false
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1
        const st =
          stations[id] ?? ({ x: 0, y: 0, h: 0, fixed: false, fixedX: false, fixedY: false, fixedH: false } as any)
        st.x = east * toMeters
        st.y = north * toMeters
        if (is3D) st.h = h * toMeters

        applyFixities(st, { x: fixE, y: fixN, h: is3D ? fixH : undefined }, state.coordMode)

        const seN = state.order === 'NE' ? stds[0] : stds[1]
        const seE = state.order === 'NE' ? stds[1] : stds[0]
        const seH = is3D ? stds[2] : undefined
        if (!st.fixedX && seE) {
          st.sx = seE * toMeters
          st.constraintX = st.x
        }
        if (!st.fixedY && seN) {
          st.sy = seN * toMeters
          st.constraintY = st.y
        }
        if (is3D && !st.fixedH && seH) {
          st.sh = seH * toMeters
          st.constraintH = st.h
        }

        stations[id] = st
      } else if (code === 'P' || code === 'PH') {
        // Geodetic position (lat/long [+H]) projected to local EN using first P as origin (equirectangular)
        const id = parts[1]
        const latDeg = toDegrees(parts[2])
        let lonDeg = toDegrees(parts[3])
        if (state.lonSign === 'west-positive') {
          lonDeg = -lonDeg
        }
        const tokens = parts.slice(2)
        const restNumeric = parts.slice(4).filter(isNumericToken).map((p) => parseFloat(p))
        const coordCount = state.coordMode === '3D' ? 3 : 2
        const elev = state.coordMode === '3D' ? restNumeric[0] ?? 0 : 0
        const seN = state.coordMode === '3D' ? restNumeric[1] ?? 0 : restNumeric[0] ?? 0
        const seE = state.coordMode === '3D' ? restNumeric[2] ?? 0 : restNumeric[1] ?? 0
        const seH = state.coordMode === '3D' ? restNumeric[3] ?? 0 : 0
        const { fixities, legacyStarFixed } = parseFixityTokens(tokens, coordCount)
        if (legacyStarFixed) {
          logs.push(
            `Warning: legacy lone "*" fixity at line ${lineNum} treated as fixed. Prefer "!" for fixed components.`,
          )
        }

        if (state.originLatDeg == null || state.originLonDeg == null) {
          state.originLatDeg = latDeg
          state.originLonDeg = lonDeg
          logs.push(`P origin set to ${latDeg.toFixed(6)}, ${lonDeg.toFixed(6)}`)
        }
        const { east, north } = projectLatLonToEN(
          latDeg,
          lonDeg,
          state.originLatDeg ?? latDeg,
          state.originLonDeg ?? lonDeg,
        )
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1
        const st: any =
          stations[id] ??
          ({ x: 0, y: 0, h: 0, fixed: false, fixedX: false, fixedY: false, fixedH: false } as any)
        st.x = east
        st.y = north
        st.h = elev * toMeters
        st.latDeg = latDeg
        st.lonDeg = lonDeg
        st.heightType = code === 'PH' ? 'ellipsoid' : 'orthometric'
        applyFixities(
          st,
          { x: fixities[1] ?? false, y: fixities[0] ?? false, h: coordCount === 3 ? fixities[2] : undefined },
          state.coordMode,
        )
        if (!st.fixedY && seN) {
          st.sy = seN * toMeters
          st.constraintY = st.y
        }
        if (!st.fixedX && seE) {
          st.sx = seE * toMeters
          st.constraintX = st.x
        }
        if (state.coordMode === '3D' && !st.fixedH && seH) {
          st.sh = seH * toMeters
          st.constraintH = st.h
        }
        stations[id] = st
        logs.push(`P record projected to local EN (meters) for ${id}`)
      } else if (code === 'CH' || code === 'EH') {
        // Coordinate or elevation with ellipsoid height
        const id = parts[1]
        const tokens = parts.slice(2)
        const numeric = tokens.filter(isNumericToken).map((p) => parseFloat(p))
        const is3D = state.coordMode === '3D'
        const coordCount = is3D ? 3 : 2
        const coords = numeric.slice(0, coordCount)
        const stds = numeric.slice(coordCount)
        const north = state.order === 'NE' ? coords[0] ?? 0 : coords[1] ?? 0
        const east = state.order === 'NE' ? coords[1] ?? 0 : coords[0] ?? 0
        const h = is3D ? coords[2] ?? 0 : coords[0] ?? 0
        const { fixities, legacyStarFixed } = parseFixityTokens(tokens, coordCount)
        if (legacyStarFixed) {
          logs.push(
            `Warning: legacy lone "*" fixity at line ${lineNum} treated as fixed. Prefer "!" for fixed components.`,
          )
        }
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1
        const st: any =
          stations[id] ??
          ({ x: 0, y: 0, h: 0, fixed: false, fixedX: false, fixedY: false, fixedH: false } as any)
        st.x = east * toMeters
        st.y = north * toMeters
        st.h = h * toMeters
        st.heightType = 'ellipsoid'

        const fixN = state.order === 'NE' ? fixities[0] : fixities[1]
        const fixE = state.order === 'NE' ? fixities[1] : fixities[0]
        const fixH = is3D ? fixities[2] : false
        applyFixities(st, { x: fixE, y: fixN, h: is3D ? fixH : undefined }, state.coordMode)

        const seN = state.order === 'NE' ? stds[0] : stds[1]
        const seE = state.order === 'NE' ? stds[1] : stds[0]
        const seH = is3D ? stds[2] : undefined
        if (!st.fixedX && seE) {
          st.sx = seE * toMeters
          st.constraintX = st.x
        }
        if (!st.fixedY && seN) {
          st.sy = seN * toMeters
          st.constraintY = st.y
        }
        if (is3D && !st.fixedH && seH) {
          st.sh = seH * toMeters
          st.constraintH = st.h
        }

        stations[id] = st
      } else if (code === 'E') {
        // Elevation only: E Station Elev [StdErr] [fixity]
        const id = parts[1]
        const tokens = parts.slice(2)
        const numeric = tokens.filter(isNumericToken).map((p) => parseFloat(p))
        const elev = numeric[0] ?? 0
        const stdErr = numeric[1] ?? 0
        const { fixities, legacyStarFixed } = parseFixityTokens(tokens, 1)
        if (legacyStarFixed) {
          logs.push(
            `Warning: legacy lone "*" fixity at line ${lineNum} treated as fixed. Prefer "!" for fixed components.`,
          )
        }
        const fixH = fixities[0] ?? false
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1
        const st: any =
          stations[id] ??
          ({ x: 0, y: 0, h: 0, fixed: false, fixedX: false, fixedY: false, fixedH: false } as any)
        st.h = elev * toMeters
        applyFixities(st, { h: fixH }, state.coordMode)
        if (!st.fixedH && stdErr) {
          st.sh = stdErr * toMeters
          st.constraintH = st.h
        }
        stations[id] = st
      } else if (code === 'D') {
        const hasInst =
          (!!parts[1] && !!instrumentLibrary[parts[1]]) ||
          (parts.length > 5 && /[A-Za-z]/.test(parts[1]) && /[A-Za-z]/.test(parts[2]))
        const explicitInst = hasInst ? parts[1] : ''
        const instCode = explicitInst || state.currentInstrument || ''
        const setId = hasInst ? parts[2] : ''
        const startIdx = hasInst ? 3 : 1
        const { from, to, nextIndex } = parseFromTo(parts, startIdx)
        const distToken = parts[nextIndex]
        const dist = parseFloat(distToken)
        const restTokens = parts.slice(nextIndex + 1)
        const { sigmas, rest } = extractSigmaTokens(restTokens, 1)
        const { hi, ht } = extractHiHt(rest)

        const inst = instCode ? instrumentLibrary[instCode] : undefined
        const defaultSigma = defaultDistanceSigma(inst, dist, state.edmMode, 0.005)
        const { sigma, source } = resolveSigma(sigmas[0], defaultSigma)

        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1
        const obs: DistanceObservation = {
          id: obsId++,
          type: 'dist',
          subtype: 'ts',
          instCode,
          setId,
          from,
          to,
          obs: dist * toMeters,
          stdDev: sigma * toMeters,
          sigmaSource: source,
          hi: hi != null ? hi * toMeters : undefined,
          ht: ht != null ? ht * toMeters : undefined,
          mode: state.deltaMode,
        }
        pushObservation(obs)
      } else if (code === 'A') {
        const tokens = parts[1].includes('-') ? parts[1].split('-') : []
        const hasInst = tokens.length === 0
        const explicitInst = hasInst ? parts[1] : ''
        const instCode = explicitInst || state.currentInstrument || ''
        const setId = hasInst ? parts[2] : ''
        const at = hasInst ? parts[3] : tokens[0]
        const from = hasInst ? parts[4] : tokens[1]
        const to = hasInst ? parts[5] : tokens[2]
        const angToken = hasInst ? parts[6] : parts[2]
        const angleRad = dmsToRad(angToken)
        const stdTokenIndex = hasInst ? 7 : 3
        const { sigmas } = extractSigmaTokens(parts.slice(stdTokenIndex), 1)

        const inst = instCode ? instrumentLibrary[instCode] : undefined
        const defaultSigma = inst?.hzPrecision_sec ?? 5
        const resolved = resolveSigma(sigmas[0], defaultSigma)
        let sigmaSec = resolved.sigma
        if (angleRad >= Math.PI) sigmaSec *= FACE2_WEIGHT

        let useDir = state.angleMode === 'dir'
        if (state.angleMode === 'auto') {
          const azTo = azimuthFromTo(stations, at, to)
          const azFrom = azimuthFromTo(stations, at, from)
          if (azTo && azFrom) {
            let predAngle = azTo.az - azFrom.az
            if (predAngle < 0) predAngle += 2 * Math.PI
            const rAngle = Math.abs(wrapToPi(angleRad - predAngle))

            const predDir = azTo.az
            const r0 = wrapToPi(angleRad - predDir)
            const r1 = wrapToPi(angleRad + Math.PI - predDir)
            const rDir = Math.abs(r0) <= Math.abs(r1) ? Math.abs(r0) : Math.abs(r1)

            const clearlyDir =
              rDir <= AMODE_AUTO_MAX_DIR_RAD && rAngle - rDir >= AMODE_AUTO_MARGIN_RAD
            useDir = clearlyDir
            if (!useDir && rDir < rAngle && rDir <= AMODE_AUTO_MAX_DIR_RAD) {
              logs.push(
                `A record ambiguous at line ${lineNum}; kept ANGLE (rDir=${(
                  (rDir * RAD_TO_DEG) * 3600
                ).toFixed(1)}", rAng=${((rAngle * RAD_TO_DEG) * 3600).toFixed(
                  1,
                )}"). Use ".AMODE DIR" for azimuth mode.`,
              )
            }
          }
        }

        if (useDir) {
          const obs: DirObservation = {
            id: obsId++,
            type: 'dir',
            instCode,
            setId,
            from: at,
            to,
            obs: angleRad,
            stdDev: sigmaSec * SEC_TO_RAD,
            sigmaSource: resolved.source,
            flip180: true,
          }
          pushObservation(obs)
          logs.push(`A record classified as DIR at line ${lineNum} (${at}-${to})`)
        } else {
          const obs: AngleObservation = {
            id: obsId++,
            type: 'angle',
            instCode,
            setId,
            at,
            from,
            to,
            obs: angleRad,
            stdDev: sigmaSec * SEC_TO_RAD,
            sigmaSource: resolved.source,
          }
          pushObservation(obs)
        }
      } else if (code === 'V') {
        // Vertical observation: zenith (slope mode) or deltaH (delta mode)
        const { from, to, nextIndex } = parseFromTo(parts, 1)
        const valToken = parts[nextIndex]
        const stdTokens = parts.slice(nextIndex + 1)
        const { sigmas } = extractSigmaTokens(stdTokens, 1)
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1
        if (state.deltaMode === 'horiz') {
          const dh = parseFloat(valToken) * toMeters
          const resolved = resolveSigma(sigmas[0], 0.001)
          const std = resolved.sigma * toMeters
          const obs: LevelObservation = {
            id: obsId++,
            type: 'lev',
            instCode: state.currentInstrument ?? '',
            from,
            to,
            obs: dh,
            lenKm: 0,
            stdDev: std || 0.001,
            sigmaSource: resolved.source,
          }
          pushObservation(obs)
        } else {
          const zenRad = valToken.includes('-') ? dmsToRad(valToken) : (parseFloat(valToken) * Math.PI) / 180
          const inst = state.currentInstrument ? instrumentLibrary[state.currentInstrument] : undefined
          const base = inst?.vaPrecision_sec ?? 5
          const resolved = resolveSigma(sigmas[0], base)
          const stdArc = resolved.sigma || base
          pushObservation({
            id: obsId++,
            type: 'zenith',
            instCode: state.currentInstrument ?? '',
            from,
            to,
            obs: zenRad,
            stdDev: (stdArc || 5) * SEC_TO_RAD,
            sigmaSource: resolved.source,
          })
        }
      } else if (code === 'DV') {
        // Distance + vertical: in delta mode, HD + deltaH; in slope mode slope distance + zenith
        const { from, to, nextIndex } = parseFromTo(parts, 1)
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1
        const instCode = state.currentInstrument ?? ''
        const inst = instCode ? instrumentLibrary[instCode] : undefined
        if (state.deltaMode === 'horiz') {
          const dist = parseFloat(parts[nextIndex])
          const dh = parseFloat(parts[nextIndex + 1])
          const restTokens = parts.slice(nextIndex + 2)
          const { sigmas, rest } = extractSigmaTokens(restTokens, 2)
          const { hi, ht } = extractHiHt(rest)
          const defaultDist = defaultDistanceSigma(inst, dist, state.edmMode, 0.005)
          const distResolved = resolveSigma(sigmas[0], defaultDist)
          const dhResolved = resolveSigma(sigmas[1], 0.001)
          pushObservation({
            id: obsId++,
            type: 'dist',
            subtype: 'ts',
            instCode,
            setId: '',
            from,
            to,
            obs: dist * toMeters,
            stdDev: distResolved.sigma * toMeters,
            sigmaSource: distResolved.source,
            hi: hi != null ? hi * toMeters : undefined,
            ht: ht != null ? ht * toMeters : undefined,
            mode: 'horiz',
          })
          pushObservation({
            id: obsId++,
            type: 'lev',
            instCode,
            from,
            to,
            obs: dh * toMeters,
            lenKm: 0,
            stdDev: dhResolved.sigma * toMeters,
            sigmaSource: dhResolved.source,
          })
        } else {
          const dist = parseFloat(parts[nextIndex])
          const zen = parts[nextIndex + 1]
          const restTokens = parts.slice(nextIndex + 2)
          const { sigmas, rest } = extractSigmaTokens(restTokens, 2)
          const { hi, ht } = extractHiHt(rest)
          const defaultDist = defaultDistanceSigma(inst, dist, state.edmMode, 0.005)
          const distResolved = resolveSigma(sigmas[0], defaultDist)
          const defaultZen = inst?.vaPrecision_sec ?? 5
          const zenResolved = resolveSigma(sigmas[1], defaultZen)
          if (!zen) {
            logs.push(`DV slope missing zenith at line ${lineNum}, skipping`)
            continue
          }
          const zenRad = zen.includes('-') ? dmsToRad(zen) : (parseFloat(zen) * Math.PI) / 180
          pushObservation({
            id: obsId++,
            type: 'dist',
            subtype: 'ts',
            instCode,
            setId: '',
            from,
            to,
            obs: dist * toMeters,
            stdDev: distResolved.sigma * toMeters,
            sigmaSource: distResolved.source,
            hi: hi != null ? hi * toMeters : undefined,
            ht: ht != null ? ht * toMeters : undefined,
            mode: 'slope',
          })
          pushObservation({
            id: obsId++,
            type: 'zenith',
            instCode,
            from,
            to,
            obs: zenRad,
            stdDev: (zenResolved.sigma || 5) * SEC_TO_RAD,
            sigmaSource: zenResolved.source,
            hi: hi != null ? hi * toMeters : undefined,
            ht: ht != null ? ht * toMeters : undefined,
          })
        }
      } else if (code === 'BM') {
        // Bearing + measurements. Bearing stored/logged; dist parsed; zenith or deltaH captured based on mode
        const from = parts[1]
        const to = parts[2]
        const bearing = parts[3]
        const dist = parseFloat(parts[4])
        const vert = parts[5]
        const instCode = state.currentInstrument ?? ''
        const inst = instCode ? instrumentLibrary[instCode] : undefined
        const { sigmas } = extractSigmaTokens(parts.slice(6), 3)
        let sigBear: SigmaToken | undefined
        let sigDist: SigmaToken | undefined
        let sigVert: SigmaToken | undefined
        if (sigmas.length === 1) {
          sigDist = sigmas[0]
        } else {
          sigBear = sigmas[0]
          sigDist = sigmas[1]
          sigVert = sigmas[2]
        }
        const distDefault = defaultDistanceSigma(inst, dist, state.edmMode, 0.005)
        const distResolved = resolveSigma(sigDist, distDefault)
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1
        pushObservation({
          id: obsId++,
          type: 'dist',
          subtype: 'ts',
          instCode,
          setId: '',
          from,
          to,
          obs: dist * toMeters,
          stdDev: distResolved.sigma * toMeters,
          sigmaSource: distResolved.source,
          mode: state.deltaMode,
        })
        if (state.deltaMode === 'horiz' && vert) {
          const dh = parseFloat(vert) * toMeters
          const dhResolved = resolveSigma(sigVert, 0.001)
          pushObservation({
            id: obsId++,
            type: 'lev',
            instCode,
            from,
            to,
            obs: dh,
            lenKm: 0,
            stdDev: dhResolved.sigma * toMeters,
            sigmaSource: dhResolved.source,
          })
        } else if (vert) {
          const zenRad = vert.includes('-') ? dmsToRad(vert) : (parseFloat(vert) * Math.PI) / 180
          const baseZen = inst?.vaPrecision_sec ?? 5
          const zenResolved = resolveSigma(sigVert, baseZen)
          pushObservation({
            id: obsId++,
            type: 'zenith',
            instCode,
            from,
            to,
            obs: zenRad,
            stdDev: (zenResolved.sigma || 5) * SEC_TO_RAD,
            sigmaSource: zenResolved.source,
          })
        }
        const bearingRad = bearing.includes('-') ? dmsToRad(bearing) : (parseFloat(bearing) * Math.PI) / 180
        const bearResolved = resolveSigma(sigBear, inst?.hzPrecision_sec ?? 5)
        pushObservation({
          id: obsId++,
          type: 'bearing',
          instCode,
          from,
          to,
          obs: bearingRad,
          stdDev: (bearResolved.sigma || 5) * SEC_TO_RAD,
          sigmaSource: bearResolved.source,
        })
      } else if (code === 'M') {
        // Measure: angle + dist + vertical
        const stations = parts[1].split('-')
        if (stations.length !== 3) {
          logs.push(`M record malformed at line ${lineNum}`)
        } else {
          const [at, from, to] = stations
          const ang = parts[2]
          const dist = parseFloat(parts[3])
          const vert = parts[4]
          const restTokens = parts.slice(5)
          const { sigmas, rest } = extractSigmaTokens(restTokens, 3)
          const { hi, ht } = extractHiHt(rest)
          const instCode = state.currentInstrument ?? ''
          const inst = instCode ? instrumentLibrary[instCode] : undefined
          const angResolved = resolveSigma(sigmas[0], inst?.hzPrecision_sec ?? 5)
          const distResolved = resolveSigma(
            sigmas[1],
            defaultDistanceSigma(inst, dist, state.edmMode, 0.005),
          )
          const vertResolved = resolveSigma(sigmas[2], inst?.vaPrecision_sec ?? 5)
          const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1
          const angRad = dmsToRad(ang)
          const faceWeight =
            angRad >= Math.PI ? angResolved.sigma * FACE2_WEIGHT : angResolved.sigma
          pushObservation({
            id: obsId++,
            type: 'angle',
            instCode,
            setId: '',
            at,
            from,
            to,
            obs: angRad,
            stdDev: faceWeight * SEC_TO_RAD,
            sigmaSource: angResolved.source,
          })
          pushObservation({
            id: obsId++,
            type: 'dist',
            subtype: 'ts',
            instCode,
            setId: '',
            from: at,
            to,
            obs: dist * toMeters,
            stdDev: distResolved.sigma * toMeters,
            sigmaSource: distResolved.source,
            hi: hi != null ? hi * toMeters : undefined,
            ht: ht != null ? ht * toMeters : undefined,
            mode: state.deltaMode,
          })
          if (state.deltaMode === 'horiz' && vert) {
            const dh = parseFloat(vert) * toMeters
            pushObservation({
              id: obsId++,
              type: 'lev',
              instCode,
              from: at,
              to,
              obs: dh,
              lenKm: 0,
              stdDev: (vertResolved.sigma ?? 0.001) * toMeters,
              sigmaSource: vertResolved.source,
            })
          } else if (vert) {
            const zenRad = vert.includes('-') ? dmsToRad(vert) : (parseFloat(vert) * Math.PI) / 180
            pushObservation({
              id: obsId++,
              type: 'zenith',
              instCode,
              from: at,
              to,
              obs: zenRad,
              stdDev: ((vertResolved.sigma ?? 5) || 5) * SEC_TO_RAD,
              sigmaSource: vertResolved.source,
              hi: hi != null ? hi * toMeters : undefined,
              ht: ht != null ? ht * toMeters : undefined,
            })
          }
        }
      } else if (code === 'B') {
        const { from, to, nextIndex } = parseFromTo(parts, 1)
        const bearingToken = parts[nextIndex]
        const instCode = state.currentInstrument ?? ''
        const inst = instCode ? instrumentLibrary[instCode] : undefined
        const { sigmas } = extractSigmaTokens(parts.slice(nextIndex + 1), 1)
        const resolved = resolveSigma(sigmas[0], inst?.hzPrecision_sec ?? 5)
        const stdArc = resolved.sigma || 5
        const bearingRad = bearingToken.includes('-')
          ? dmsToRad(bearingToken)
          : (parseFloat(bearingToken) * Math.PI) / 180
        pushObservation({
          id: obsId++,
          type: 'bearing',
          instCode,
          from,
          to,
          obs: bearingRad,
          stdDev: (stdArc || 5) * SEC_TO_RAD,
          sigmaSource: resolved.source,
        })
      } else if (code === 'TB') {
        // Traverse begin: set occupy + backsight context
        traverseCtx.occupy = parts[1]
        traverseCtx.backsight = parts[2]
        faceMode = 'unknown'
        logs.push(`Traverse start at ${traverseCtx.occupy} backsight ${traverseCtx.backsight}`)
      } else if (code === 'T' || code === 'TE') {
        // Traverse legs: angle + dist + vertical relative to current occupy/backsight
        if (!traverseCtx.occupy || !traverseCtx.backsight) {
          logs.push(`Traverse context missing at line ${lineNum}, skipping ${code}`)
          continue
        }
        if (
          code !== 'TE' &&
          (traverseCtx.occupy === parts[1] || traverseCtx.backsight === parts[1])
        ) {
          logs.push(`Traverse leg cannot occupy/backsight same as foresight at line ${lineNum}`)
          continue
        }
        const to = parts[1]
        const ang = parts[2]
        const dist = parseFloat(parts[3] || '0')
        const vert = parts[4]
        const { sigmas } = extractSigmaTokens(parts.slice(5), 3)
        const instCode = state.currentInstrument ?? ''
        const inst = instCode ? instrumentLibrary[instCode] : undefined
        const angResolved = resolveSigma(sigmas[0], inst?.hzPrecision_sec ?? 5)
        const distResolved = resolveSigma(
          sigmas[1],
          defaultDistanceSigma(inst, dist, state.edmMode, 0.005),
        )
        const vertResolved = resolveSigma(sigmas[2], inst?.vaPrecision_sec ?? 5)
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1
        const angRad = dmsToRad(ang)
        const isFace2 = angRad >= Math.PI
        if (state.normalize === false) {
          const thisFace = isFace2 ? 'face2' : 'face1'
          if (faceMode === 'unknown') faceMode = thisFace
          if (faceMode !== thisFace) {
            logs.push(`Mixed face traverse angle rejected at line ${lineNum}`)
          } else {
            pushObservation({
              id: obsId++,
              type: 'angle',
              instCode,
              setId: code,
              at: traverseCtx.occupy,
              from: traverseCtx.backsight,
              to,
              obs: angRad,
              stdDev: (angResolved.sigma || 5) * SEC_TO_RAD,
              sigmaSource: angResolved.source,
            })
          }
        } else {
          const angStd = (angResolved.sigma || 5) * (isFace2 ? FACE2_WEIGHT : 1)
          pushObservation({
            id: obsId++,
            type: 'angle',
            instCode,
            setId: code,
            at: traverseCtx.occupy,
            from: traverseCtx.backsight,
            to,
            obs: angRad,
            stdDev: angStd * SEC_TO_RAD,
            sigmaSource: angResolved.source,
          })
        }
        if (dist > 0) {
          pushObservation({
            id: obsId++,
            type: 'dist',
            subtype: 'ts',
            instCode,
            setId: code,
            from: traverseCtx.occupy,
            to,
            obs: dist * toMeters,
            stdDev: (distResolved.sigma || 0.005) * toMeters,
            sigmaSource: distResolved.source,
            mode: state.deltaMode,
          })
        }
        if (vert) {
          if (state.deltaMode === 'horiz') {
            const dh = parseFloat(vert) * toMeters
            pushObservation({
              id: obsId++,
              type: 'lev',
              instCode,
              setId: code,
              from: traverseCtx.occupy,
              to,
              obs: dh,
              lenKm: 0,
              stdDev: (vertResolved.sigma || 0.001) * toMeters,
              sigmaSource: vertResolved.source,
            })
          } else {
            const zenRad = vert.includes('-')
              ? dmsToRad(vert)
              : (parseFloat(vert) * Math.PI) / 180
            pushObservation({
              id: obsId++,
              type: 'zenith',
              instCode,
              setId: code,
              from: traverseCtx.occupy,
              to,
              obs: zenRad,
              stdDev: (vertResolved.sigma || 5) * SEC_TO_RAD,
              sigmaSource: vertResolved.source,
            })
          }
        }
        if (code === 'TE') {
          logs.push(`Traverse end to ${to}`)
          traverseCtx.occupy = undefined
          traverseCtx.backsight = undefined
          faceMode = 'unknown'
        } else {
          const prevOccupy = traverseCtx.occupy
          traverseCtx.occupy = to
          traverseCtx.backsight = prevOccupy
        }
      } else if (code === 'DB') {
        if (traverseCtx.dirSetId) {
          flushDirectionSet('new DB')
        }
        const hasInst = parts[1] && instrumentLibrary[parts[1]]
        const instCode = hasInst ? parts[1] : state.currentInstrument ?? ''
        const occupy = hasInst ? parts[2] : parts[1]
        const backsight = hasInst ? parts[3] : parts[2]

        traverseCtx.occupy = occupy
        traverseCtx.backsight = backsight
        traverseCtx.dirInstCode = instCode
        traverseCtx.dirRawShots = []
        directionSetCount += 1
        traverseCtx.dirSetId = `${occupy || 'SET'}#${directionSetCount}`
        faceMode = 'unknown'

        if (backsight) {
          logs.push(
            `Direction set start at ${traverseCtx.occupy} backsight ${backsight}${instCode ? ` (inst ${instCode})` : ''}`,
          )
        } else {
          logs.push(
            `Direction set start at ${traverseCtx.occupy}${instCode ? ` (inst ${instCode})` : ''}`,
          )
        }
      } else if (code === 'DN' || code === 'DM') {
        if (!traverseCtx.occupy || !traverseCtx.dirSetId) {
          logs.push(`Direction context missing at line ${lineNum}, skipping ${code}`)
          directionRejectDiagnostics.push({
            setId: 'UNKNOWN',
            occupy: 'UNKNOWN',
            sourceLine: lineNum,
            recordType: code,
            reason: 'missing-context',
            detail: `Direction context missing at line ${lineNum}`,
          })
          continue
        }

        const to = parts[1]
        const ang = parts[2]
        const angRad = dmsToRad(ang)

        const dist = code === 'DM' ? parseFloat(parts[3] || '0') : 0
        const vert = code === 'DM' ? parts[4] : undefined
        const sigmaStart = code === 'DM' ? 5 : 3
        const sigmaCount = code === 'DM' ? 3 : 1
        const { sigmas } = extractSigmaTokens(parts.slice(sigmaStart), sigmaCount)
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1

        const inst = traverseCtx.dirInstCode ? instrumentLibrary[traverseCtx.dirInstCode] : undefined
        const dirResolved = resolveSigma(sigmas[0], inst?.hzPrecision_sec ?? 5)
        let stdAng = dirResolved.sigma || 5

        if (state.normalize === false) {
          const thisFace = angRad >= Math.PI ? 'face2' : 'face1'
          if (faceMode === 'unknown') faceMode = thisFace
          if (faceMode !== thisFace) {
            logs.push(`Mixed face direction rejected at line ${lineNum}`)
            directionRejectDiagnostics.push({
              setId: traverseCtx.dirSetId,
              occupy: traverseCtx.occupy,
              target: to,
              sourceLine: lineNum,
              recordType: code,
              reason: 'mixed-face',
              expectedFace: faceMode,
              actualFace: thisFace,
              detail: `Mixed face direction rejected at line ${lineNum}`,
            })
            continue
          }
        }

        const thisFace: DirectionFace = angRad >= Math.PI ? 'face2' : 'face1'
        const raw: RawDirectionShot = {
          to,
          obs: angRad,
          stdDev: stdAng * SEC_TO_RAD,
          sigmaSource: dirResolved.source,
          sourceLine: lineNum,
          face: thisFace,
        }
        const existing = traverseCtx.dirRawShots ?? []
        existing.push(raw)
        traverseCtx.dirRawShots = existing

        if (code === 'DM' && dist > 0) {
          const distResolved = resolveSigma(
            sigmas[1],
            defaultDistanceSigma(inst, dist, state.edmMode, 0.005),
          )
          pushObservation({
            id: obsId++,
            type: 'dist',
            subtype: 'ts',
            instCode: traverseCtx.dirInstCode ?? '',
            setId: code,
            from: traverseCtx.occupy,
            to,
            obs: dist * toMeters,
            stdDev: distResolved.sigma * toMeters,
            sigmaSource: distResolved.source,
            mode: state.deltaMode,
          })
          if (vert) {
            if (state.deltaMode === 'horiz') {
              const dh = parseFloat(vert) * toMeters
              const dhResolved = resolveSigma(sigmas[2], 0.001)
              pushObservation({
                id: obsId++,
                type: 'lev',
                instCode: traverseCtx.dirInstCode ?? '',
                from: traverseCtx.occupy,
                to,
                obs: dh,
                lenKm: 0,
                stdDev: dhResolved.sigma * toMeters,
                sigmaSource: dhResolved.source,
              })
            } else {
              const zenRad = vert.includes('-')
                ? dmsToRad(vert)
                : (parseFloat(vert) * Math.PI) / 180
              const zenResolved = resolveSigma(sigmas[2], inst?.vaPrecision_sec ?? 5)
              pushObservation({
                id: obsId++,
                type: 'zenith',
                instCode: traverseCtx.dirInstCode ?? '',
                from: traverseCtx.occupy,
                to,
                obs: zenRad,
                stdDev: (zenResolved.sigma || 5) * SEC_TO_RAD,
                sigmaSource: zenResolved.source,
              })
            }
          }
        }
      } else if (code === 'DE') {
        if (traverseCtx.dirSetId) flushDirectionSet('DE')
        logs.push('Direction set end')
      } else if (code === 'SS') {
        // Sideshot: dist + optional vertical
        const from = parts[1]
        const to = parts[2]
        if (from === to || from === traverseCtx.backsight || to === traverseCtx.occupy) {
          logs.push(`Invalid sideshot occupy/backsight at line ${lineNum}, skipping`)
          continue
        }
        if (traverseCtx.occupy && from !== traverseCtx.occupy) {
          logs.push(`Sideshot must originate from current occupy (${traverseCtx.occupy}) at line ${lineNum}`)
          continue
        }
        if (stations[to]?.fixed) {
          logs.push(`Sideshot cannot target fixed/control station (${to}) at line ${lineNum}`)
          continue
        }
        const instCode = state.currentInstrument ?? ''
        const inst = instCode ? instrumentLibrary[instCode] : undefined
        const firstTokenRaw = parts[3] || ''
        const isAzPrefix = /^AZ=/i.test(firstTokenRaw) || firstTokenRaw.startsWith('@')
        const isHzPrefix = /^(HZ|HA|ANG)=/i.test(firstTokenRaw)
        const isDmsAngle = firstTokenRaw.includes('-')
        const isSetupAngleByPattern =
          !isAzPrefix &&
          !isHzPrefix &&
          isDmsAngle &&
          Number.isFinite(parseFloat(parts[4] || '')) &&
          !!traverseCtx.backsight
        const angleMode: 'none' | 'az' | 'hz' = isAzPrefix
          ? 'az'
          : isHzPrefix || isSetupAngleByPattern
            ? 'hz'
            : 'none'
        let azimuthObs: number | undefined
        let azimuthStdDev: number | undefined
        let hzObs: number | undefined
        let hzStdDev: number | undefined
        let distIndex = 3
        let vertIndex = 4
        let sigmaIndex = 5
        if (angleMode !== 'none') {
          const cleanAngle = firstTokenRaw
            .replace(/^(AZ|HZ|HA|ANG)=/i, '')
            .replace(/^@/, '')
          const angleDeg = toDegrees(cleanAngle)
          if (!Number.isFinite(angleDeg)) {
            logs.push(`Invalid sideshot horizontal angle/azimuth at line ${lineNum}, skipping`)
            continue
          }
          const angleRad = (angleDeg * Math.PI) / 180
          if (angleMode === 'az') {
            azimuthObs = angleRad
          } else {
            hzObs = angleRad
          }
          distIndex = 4
          vertIndex = 5
          sigmaIndex = 6
        }
        const dist = parseFloat(parts[distIndex] || '0')
        const vert = parts[vertIndex]
        if (!Number.isFinite(dist) || dist <= 0) {
          logs.push(`Invalid sideshot distance at line ${lineNum}, skipping`)
          continue
        }
        const { sigmas } = extractSigmaTokens(parts.slice(sigmaIndex), 3)
        let sigmaAzToken: SigmaToken | undefined
        let sigmaDistToken: SigmaToken | undefined
        let sigmaVertToken: SigmaToken | undefined
        if (angleMode !== 'none') {
          if (vert) {
            if (sigmas.length >= 3) {
              sigmaAzToken = sigmas[0]
              sigmaDistToken = sigmas[1]
              sigmaVertToken = sigmas[2]
            } else if (sigmas.length === 2) {
              sigmaDistToken = sigmas[0]
              sigmaVertToken = sigmas[1]
            } else if (sigmas.length === 1) {
              sigmaDistToken = sigmas[0]
            }
          } else if (sigmas.length >= 2) {
            sigmaAzToken = sigmas[0]
            sigmaDistToken = sigmas[1]
          } else if (sigmas.length === 1) {
            sigmaDistToken = sigmas[0]
          }
          const hzResolved = resolveSigma(sigmaAzToken, inst?.hzPrecision_sec ?? 10)
          if (angleMode === 'az') {
            azimuthStdDev = hzResolved.sigma * SEC_TO_RAD
          } else {
            hzStdDev = hzResolved.sigma * SEC_TO_RAD
          }
        } else {
          sigmaDistToken = sigmas[0]
          sigmaVertToken = sigmas[1]
        }
        const distResolved = resolveSigma(
          sigmaDistToken,
          defaultDistanceSigma(inst, dist, state.edmMode, 0.01),
        )
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1
        pushObservation({
          id: obsId++,
          type: 'dist',
          subtype: 'ts',
          instCode,
          setId: 'SS',
          from,
          to,
          obs: dist * toMeters,
          stdDev: distResolved.sigma * toMeters,
          sigmaSource: distResolved.source,
          mode: state.deltaMode,
          // mark sideshots to allow downstream exclusion if desired
          calc: {
            sideshot: true,
            azimuthObs,
            azimuthStdDev,
            hzObs,
            hzStdDev,
            backsightId: hzObs != null ? traverseCtx.backsight : undefined,
            azimuthSource:
              azimuthObs != null ? 'explicit' : hzObs != null ? 'setup' : 'target',
          },
        })
        if (vert) {
          if (state.deltaMode === 'horiz') {
            const dh = parseFloat(vert) * toMeters
            const dhResolved = resolveSigma(sigmaVertToken, 0.001)
            pushObservation({
              id: obsId++,
              type: 'lev',
              instCode,
              from,
              to,
              obs: dh,
              lenKm: 0,
              stdDev: dhResolved.sigma * toMeters,
              sigmaSource: dhResolved.source,
              calc: { sideshot: true },
            })
          } else {
            const zenRad = vert.includes('-')
              ? dmsToRad(vert)
              : (parseFloat(vert) * Math.PI) / 180
            const zenResolved = resolveSigma(sigmaVertToken, inst?.vaPrecision_sec ?? 5)
            pushObservation({
              id: obsId++,
              type: 'zenith',
              instCode,
              from,
              to,
              obs: zenRad,
              stdDev: zenResolved.sigma * SEC_TO_RAD,
              sigmaSource: zenResolved.source,
              calc: { sideshot: true },
            })
          }
        }
      } else if (code === 'G') {
        const instCode = parts[1]
        const from = parts[2]
        const to = parts[3]
        const dE = parseFloat(parts[4])
        const dN = parseFloat(parts[5])
        const stdEraw = parseFloat(parts[6] || '')
        const stdNraw = parseFloat(parts[7] || '')
        const corrRaw = parseFloat(parts[8] || '')

        const inst = instrumentLibrary[instCode]
        const defaultStd = inst?.gpsStd_xy && inst.gpsStd_xy > 0 ? inst.gpsStd_xy : 0.01
        let sigmaE = Number.isNaN(stdEraw) ? defaultStd : stdEraw
        let sigmaN = Number.isNaN(stdNraw) ? sigmaE : stdNraw
        const corr = Number.isNaN(corrRaw) ? 0 : Math.max(-0.999, Math.min(0.999, corrRaw))

        if (inst && inst.gpsStd_xy > 0) {
          sigmaE = Math.sqrt(sigmaE * sigmaE + inst.gpsStd_xy * inst.gpsStd_xy)
          sigmaN = Math.sqrt(sigmaN * sigmaN + inst.gpsStd_xy * inst.gpsStd_xy)
        }
        const sigmaMean = Math.sqrt((sigmaE * sigmaE + sigmaN * sigmaN) / 2)

        const obs: GpsObservation = {
          id: obsId++,
          type: 'gps',
          instCode,
          from,
          to,
          obs: {
            dE: state.units === 'ft' ? dE / FT_PER_M : dE,
            dN: state.units === 'ft' ? dN / FT_PER_M : dN,
          },
          stdDev: state.units === 'ft' ? sigmaMean / FT_PER_M : sigmaMean,
          stdDevE: state.units === 'ft' ? sigmaE / FT_PER_M : sigmaE,
          stdDevN: state.units === 'ft' ? sigmaN / FT_PER_M : sigmaN,
          corrEN: corr,
        }
        pushObservation(obs)
      } else if (code === 'L') {
        const instCode = parts[1]
        const from = parts[2]
        const to = parts[3]
        const dH = parseFloat(parts[4] || '0')
        const lenRaw = parseFloat(parts[5] || '0')
        const lenKm =
          Number.isFinite(lenRaw) && lenRaw > 0
            ? state.units === 'ft'
              ? lenRaw / FT_PER_M / 1000
              : lenRaw
            : 0
        const stdMmPerKmRaw = parseFloat(parts[6] || '')
        const baseStd = Number.isNaN(stdMmPerKmRaw)
          ? state.levelWeight ?? 0
          : stdMmPerKmRaw
        if (Number.isNaN(stdMmPerKmRaw) && state.levelWeight != null) {
          logs.push(
            `.LWEIGHT applied for leveling at line ${lineNum}: ${state.levelWeight} mm/km`,
          )
        }

        const inst = instrumentLibrary[instCode]
        let sigma = (baseStd * lenKm) / 1000.0
        if (inst && inst.levStd_mmPerKm > 0) {
          const lib = (inst.levStd_mmPerKm * lenKm) / 1000.0
          sigma = Math.sqrt(sigma * sigma + lib * lib)
        }

        const obs: LevelObservation = {
          id: obsId++,
          type: 'lev',
          instCode,
          from,
          to,
          obs: state.units === 'ft' ? dH / FT_PER_M : dH,
          lenKm,
          stdDev: sigma,
        }
        pushObservation(obs)
      } else {
        logs.push(`Unrecognized code "${code}" at line ${lineNum}, skipping`)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logs.push(`Error on line ${lineNum}: ${msg}`)
    }
  }

  if (traverseCtx.dirSetId) {
    flushDirectionSet('EOF')
  }

  const unknowns = Object.keys(stations).filter((id) => {
    const st = stations[id]
    if (!st) return false
    const fx = st.fixedX ?? false
    const fy = st.fixedY ?? false
    const fh = st.fixedH ?? false
    return state.coordMode === '2D' ? !(fx && fy) : !(fx && fy && fh)
  })
  const typeSummary = observations.reduce<Record<string, number>>((acc, o) => {
    acc[o.type] = (acc[o.type] ?? 0) + 1
    return acc
  }, {})
  if (!orderExplicit) {
    logs.push(
      `Warning: .ORDER not specified; using ${state.order}. If your coordinates are North East, add ".ORDER NE".`,
    )
  }
  if (directionRejectDiagnostics.length > 0) {
    logs.push(`Direction rejects: ${directionRejectDiagnostics.length}`)
  }
  logs.push(
    `Counts: ${Object.entries(typeSummary)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')}`,
  )
  logs.push(
    `Stations: ${Object.keys(stations).length} (unknown: ${unknowns.length}). Obs: ${observations.length}`,
  )

  return {
    stations,
    observations,
    instrumentLibrary,
    unknowns,
    parseState: { ...state },
    logs,
    directionRejectDiagnostics,
  }
}

