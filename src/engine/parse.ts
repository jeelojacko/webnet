import { dmsToRad, RAD_TO_DEG, SEC_TO_RAD } from './angles'
import type {
  AngleObservation,
  DirectionObservation,
  DistanceObservation,
  GpsObservation,
  Instrument,
  InstrumentLibrary,
  LevelObservation,
  Observation,
  ParseResult,
  StationMap,
  ParseOptions,
  MapMode,
} from '../types'

const defaultParseOptions: ParseOptions = {
  units: 'm',
  coordMode: '3D',
  order: 'EN',
  deltaMode: 'slope',
  mapMode: 'off',
  normalize: true,
  lonSign: 'west-negative',
}

const FT_PER_M = 3.280839895
const EARTH_RADIUS_M = 6378137
const FACE2_WEIGHT = 0.707 // face-2 weighting factor per common spec
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
): { fixities: boolean[]; hasTokens: boolean } => {
  const raw = tokens.filter((t) => t === '!' || t === '*')
  if (!raw.length) {
    return { fixities: new Array(componentCount).fill(false), hasTokens: false }
  }
  const hasBang = raw.includes('!')
  const flags = hasBang ? raw.map((t) => t === '!') : raw.map(() => true)
  if (flags.length === 1 && flags[0]) {
    return { fixities: new Array(componentCount).fill(true), hasTokens: true }
  }
  const fixities = new Array(componentCount).fill(false)
  for (let i = 0; i < componentCount && i < flags.length; i += 1) {
    fixities[i] = flags[i]
  }
  return { fixities, hasTokens: true }
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
  const stations: StationMap = {}
  const observations: Observation[] = []
  const instrumentLibrary: InstrumentLibrary = { ...existingInstruments }
  const logs: string[] = []
  const state: ParseOptions = { ...defaultParseOptions, ...opts }
  let orderExplicit = false
  const traverseCtx: {
    occupy?: string
    backsight?: string
    backsightRefAngle?: number
    dirSetId?: string
    dirInstCode?: string
  } = {}
  let faceMode: 'unknown' | 'face1' | 'face2' = 'unknown'
  let directionSetCount = 0

  const lines = input.split('\n')
  let lineNum = 0
  let obsId = 0

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
          mode === 'ANGLECALC' ? 'anglecalc' : mode === 'ON' ? 'on' : 'off'
        state.mapMode = mapMode
        logs.push(`Map mode set to ${mapMode}`)
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
      } else if (op === '.END') {
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
        const distA = parseFloat(parts[3] ?? '0')
        const distB = parseFloat(parts[4] ?? '0')
        const angStd = parseFloat(parts[5] ?? '0')
        const gpsStd = parseFloat(parts[6] ?? '0')
        const levStd = parseFloat(parts[7] ?? '0')
        const inst: Instrument = {
          code: instCode,
          desc,
          distA_ppm: distA,
          distB_const: distB,
          angleStd_sec: angStd,
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
        const { fixities } = parseFixityTokens(tokens, coordCount)
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
        if (!st.fixedX && seE) (st as any).sx = seE * toMeters
        if (!st.fixedY && seN) (st as any).sy = seN * toMeters
        if (is3D && !st.fixedH && seH) (st as any).sh = seH * toMeters

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
        const { fixities } = parseFixityTokens(tokens, coordCount)

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
        if (!st.fixedY && seN) st.sy = seN * toMeters
        if (!st.fixedX && seE) st.sx = seE * toMeters
        if (state.coordMode === '3D' && !st.fixedH && seH) st.sh = seH * toMeters
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
        const { fixities } = parseFixityTokens(tokens, coordCount)
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
        if (!st.fixedX && seE) st.sx = seE * toMeters
        if (!st.fixedY && seN) st.sy = seN * toMeters
        if (is3D && !st.fixedH && seH) st.sh = seH * toMeters

        stations[id] = st
      } else if (code === 'E') {
        // Elevation only: E Station Elev [StdErr] [fixity]
        const id = parts[1]
        const tokens = parts.slice(2)
        const numeric = tokens.filter(isNumericToken).map((p) => parseFloat(p))
        const elev = numeric[0] ?? 0
        const stdErr = numeric[1] ?? 0
        const { fixities } = parseFixityTokens(tokens, 1)
        const fixH = fixities[0] ?? false
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1
        const st: any =
          stations[id] ??
          ({ x: 0, y: 0, h: 0, fixed: false, fixedX: false, fixedY: false, fixedH: false } as any)
        st.h = elev * toMeters
        applyFixities(st, { h: fixH }, state.coordMode)
        if (!st.fixedH && stdErr) st.sh = stdErr * toMeters
        stations[id] = st
      } else if (code === 'D') {
        const hasInst =
          (!!parts[1] && !!instrumentLibrary[parts[1]]) ||
          (parts.length > 5 && /[A-Za-z]/.test(parts[1]) && /[A-Za-z]/.test(parts[2]))
        const instCode = hasInst ? parts[1] : ''
        const setId = hasInst ? parts[2] : ''
        const startIdx = hasInst ? 3 : 1
        const { from, to, nextIndex } = parseFromTo(parts, startIdx)
        const distToken = parts[nextIndex]
        const dist = parseFloat(distToken)
        const restTokens = parts.slice(nextIndex + 1)
        const { hi, ht, rest } = extractHiHt(restTokens)
        const numeric = rest.filter(isNumericToken).map((p) => parseFloat(p))
        const stdRaw = numeric[0] ?? 0

        const inst = instCode ? instrumentLibrary[instCode] : undefined
        let sigma = stdRaw
        if (inst) {
          const a = inst.distA_ppm * 1e-6 * dist
          const b = inst.distB_const
          sigma = Math.sqrt(a * a + b * b + stdRaw * stdRaw)
        }

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
          hi: hi != null ? hi * toMeters : undefined,
          ht: ht != null ? ht * toMeters : undefined,
          mode: state.deltaMode,
        }
        observations.push(obs)
      } else if (code === 'A') {
        const tokens = parts[1].includes('-') ? parts[1].split('-') : []
        const hasInst = tokens.length === 0
        const instCode = hasInst ? parts[1] : ''
        const setId = hasInst ? parts[2] : ''
        const at = hasInst ? parts[3] : tokens[0]
        const from = hasInst ? parts[4] : tokens[1]
        const to = hasInst ? parts[5] : tokens[2]
        const angToken = hasInst ? parts[6] : parts[2]
        const angleRad = dmsToRad(angToken)
        const stdRawArcsec = parseFloat(hasInst ? parts[7] : parts[3] || '0')

        const inst = instCode ? instrumentLibrary[instCode] : undefined
        let sigmaSec = stdRawArcsec || (inst?.angleStd_sec ?? 1)
        if (inst && inst.angleStd_sec > 0) {
          sigmaSec = Math.sqrt(stdRawArcsec * stdRawArcsec + inst.angleStd_sec * inst.angleStd_sec)
        }
        if (angleRad >= Math.PI) sigmaSec *= FACE2_WEIGHT

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
        }
        observations.push(obs)
      } else if (code === 'V') {
        // Vertical observation: zenith (slope mode) or deltaH (delta mode)
        const { from, to, nextIndex } = parseFromTo(parts, 1)
        const valToken = parts[nextIndex]
        const stdToken = parts[nextIndex + 1]
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1
        if (state.deltaMode === 'horiz') {
          const dh = parseFloat(valToken) * toMeters
          const std = parseFloat(stdToken || '0') * toMeters
          const obs: LevelObservation = {
            id: obsId++,
            type: 'lev',
            instCode: '',
            from,
            to,
            obs: dh,
            lenKm: 0,
            stdDev: std || 0.001,
          }
          observations.push(obs)
        } else {
          const zenRad = valToken.includes('-') ? dmsToRad(valToken) : (parseFloat(valToken) * Math.PI) / 180
          const stdArc = parseFloat(stdToken || '5') // arcseconds
          observations.push({
            id: obsId++,
            type: 'zenith',
            instCode: '',
            from,
            to,
            obs: zenRad,
            stdDev: (stdArc || 5) * SEC_TO_RAD,
          })
        }
      } else if (code === 'DV') {
        // Distance + vertical: in delta mode, HD + deltaH; in slope mode slope distance + zenith
        const { from, to, nextIndex } = parseFromTo(parts, 1)
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1
        if (state.deltaMode === 'horiz') {
          const dist = parseFloat(parts[nextIndex])
          const dh = parseFloat(parts[nextIndex + 1])
          const restTokens = parts.slice(nextIndex + 2)
          const { hi, ht, rest } = extractHiHt(restTokens)
          const numeric = rest.filter(isNumericToken).map((p) => parseFloat(p))
          const stdDist = numeric[0] ?? 0.005
          const stdDh = numeric[1] ?? 0
          observations.push({
            id: obsId++,
            type: 'dist',
            subtype: 'ts',
            instCode: '',
            setId: '',
            from,
            to,
            obs: dist * toMeters,
            stdDev: stdDist * toMeters,
            hi: hi != null ? hi * toMeters : undefined,
            ht: ht != null ? ht * toMeters : undefined,
            mode: 'horiz',
          })
          observations.push({
            id: obsId++,
            type: 'lev',
            instCode: '',
            from,
            to,
            obs: dh * toMeters,
            lenKm: 0,
            stdDev: stdDh * toMeters,
          })
        } else {
          const dist = parseFloat(parts[nextIndex])
          const zen = parts[nextIndex + 1]
          const restTokens = parts.slice(nextIndex + 2)
          const { hi, ht, rest } = extractHiHt(restTokens)
          const numeric = rest.filter(isNumericToken).map((p) => parseFloat(p))
          const stdDist = numeric[0] ?? 0.005
          const stdZen = numeric[1] ?? 5
          if (!zen) {
            logs.push(`DV slope missing zenith at line ${lineNum}, skipping`)
            continue
          }
          const zenRad = zen.includes('-') ? dmsToRad(zen) : (parseFloat(zen) * Math.PI) / 180
          observations.push({
            id: obsId++,
            type: 'dist',
            subtype: 'ts',
            instCode: '',
            setId: '',
            from,
            to,
            obs: dist * toMeters,
            stdDev: stdDist * toMeters,
            hi: hi != null ? hi * toMeters : undefined,
            ht: ht != null ? ht * toMeters : undefined,
            mode: 'slope',
          })
          observations.push({
            id: obsId++,
            type: 'zenith',
            instCode: '',
            from,
            to,
            obs: zenRad,
            stdDev: (stdZen || 5) * SEC_TO_RAD,
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
        const stdDist = parts[6] ? parseFloat(parts[6]) : 0.005
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1
        observations.push({
          id: obsId++,
          type: 'dist',
          subtype: 'ts',
          instCode: '',
          setId: '',
          from,
          to,
          obs: dist * toMeters,
          stdDev: stdDist * toMeters,
          mode: state.deltaMode,
        })
        if (state.deltaMode === 'horiz' && vert) {
          const dh = parseFloat(vert) * toMeters
          observations.push({
            id: obsId++,
            type: 'lev',
            instCode: '',
            from,
            to,
            obs: dh,
            lenKm: 0,
            stdDev: 0.001,
          })
        } else if (vert) {
          const zenRad = vert.includes('-') ? dmsToRad(vert) : (parseFloat(vert) * Math.PI) / 180
          observations.push({
            id: obsId++,
            type: 'zenith',
            instCode: '',
            from,
            to,
            obs: zenRad,
            stdDev: (stdDist || 5) * SEC_TO_RAD,
          })
        }
        const bearingRad = bearing.includes('-') ? dmsToRad(bearing) : (parseFloat(bearing) * Math.PI) / 180
        observations.push({
          id: obsId++,
          type: 'bearing',
          instCode: '',
          from,
          to,
          obs: bearingRad,
          stdDev: (stdDist || 5) * SEC_TO_RAD,
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
          const { hi, ht, rest } = extractHiHt(restTokens)
          const numeric = rest.filter(isNumericToken).map((p) => parseFloat(p))
          const stdAng = numeric[0] ?? 5
          const stdDist = numeric[1] ?? 0.005
          const stdVert = numeric[2]
          const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1
          const angRad = dmsToRad(ang)
          const faceWeight = angRad >= Math.PI ? stdAng * FACE2_WEIGHT : stdAng
          observations.push({
            id: obsId++,
            type: 'angle',
            instCode: '',
            setId: '',
            at,
            from,
            to,
            obs: angRad,
            stdDev: faceWeight * SEC_TO_RAD,
          })
          observations.push({
            id: obsId++,
            type: 'dist',
            subtype: 'ts',
            instCode: '',
            setId: '',
            from: at,
            to,
            obs: dist * toMeters,
            stdDev: stdDist * toMeters,
            hi: hi != null ? hi * toMeters : undefined,
            ht: ht != null ? ht * toMeters : undefined,
            mode: state.deltaMode,
          })
          if (state.deltaMode === 'horiz' && vert) {
            const dh = parseFloat(vert) * toMeters
            observations.push({
              id: obsId++,
              type: 'lev',
              instCode: '',
              from: at,
              to,
              obs: dh,
              lenKm: 0,
              stdDev: (stdVert ?? 0.001) * toMeters,
            })
          } else if (vert) {
            const zenRad = vert.includes('-') ? dmsToRad(vert) : (parseFloat(vert) * Math.PI) / 180
            observations.push({
              id: obsId++,
              type: 'zenith',
              instCode: '',
              from: at,
              to,
              obs: zenRad,
              stdDev: ((stdVert ?? 5) || 5) * SEC_TO_RAD,
              hi: hi != null ? hi * toMeters : undefined,
              ht: ht != null ? ht * toMeters : undefined,
            })
          }
        }
      } else if (code === 'B') {
        const { from, to, nextIndex } = parseFromTo(parts, 1)
        const bearingToken = parts[nextIndex]
        const stdArc = parseFloat(parts[nextIndex + 1] || '5')
        const bearingRad = bearingToken.includes('-')
          ? dmsToRad(bearingToken)
          : (parseFloat(bearingToken) * Math.PI) / 180
        observations.push({
          id: obsId++,
          type: 'bearing',
          instCode: '',
          from,
          to,
          obs: bearingRad,
          stdDev: (stdArc || 5) * SEC_TO_RAD,
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
        const stdAng = parts[5] ? parseFloat(parts[5]) : 5
        const stdDist = parts[6] ? parseFloat(parts[6]) : 0.005
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1
        const angRad = dmsToRad(ang)
        const isFace2 = angRad >= Math.PI
        if (state.normalize === false) {
          const thisFace = isFace2 ? 'face2' : 'face1'
          if (faceMode === 'unknown') faceMode = thisFace
          if (faceMode !== thisFace) {
            logs.push(`Mixed face traverse angle rejected at line ${lineNum}`)
          } else {
            observations.push({
              id: obsId++,
              type: 'angle',
              instCode: '',
              setId: code,
              at: traverseCtx.occupy,
              from: traverseCtx.backsight,
              to,
              obs: angRad,
              stdDev: (stdAng || 5) * SEC_TO_RAD,
            })
          }
        } else {
          const angStd = (stdAng || 5) * (isFace2 ? FACE2_WEIGHT : 1)
          observations.push({
            id: obsId++,
            type: 'angle',
            instCode: '',
            setId: code,
            at: traverseCtx.occupy,
            from: traverseCtx.backsight,
            to,
            obs: angRad,
            stdDev: angStd * SEC_TO_RAD,
          })
        }
        if (dist > 0) {
          observations.push({
            id: obsId++,
            type: 'dist',
            subtype: 'ts',
            instCode: '',
            setId: code,
            from: traverseCtx.occupy,
            to,
            obs: dist * toMeters,
            stdDev: (stdDist || 0.005) * toMeters,
            mode: state.deltaMode,
          })
        }
        if (vert) {
          if (state.deltaMode === 'horiz') {
            const dh = parseFloat(vert) * toMeters
            observations.push({
              id: obsId++,
              type: 'lev',
              instCode: '',
              from: traverseCtx.occupy,
              to,
              obs: dh,
              lenKm: 0,
              stdDev: 0.001,
            })
          } else {
            const zenRad = vert.includes('-')
              ? dmsToRad(vert)
              : (parseFloat(vert) * Math.PI) / 180
            observations.push({
              id: obsId++,
              type: 'zenith',
              instCode: '',
              from: traverseCtx.occupy,
              to,
              obs: zenRad,
              stdDev: (stdAng || 5) * SEC_TO_RAD,
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
        const hasInst = parts[1] && instrumentLibrary[parts[1]]
        const instCode = hasInst ? parts[1] : ''
        const occupy = hasInst ? parts[2] : parts[1]
        const backsight = hasInst ? parts[3] : parts[2]

        traverseCtx.occupy = occupy
        traverseCtx.backsight = backsight
        traverseCtx.dirInstCode = instCode
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
          continue
        }

        const to = parts[1]
        const ang = parts[2]
        const angRad = dmsToRad(ang)

        const dist = code === 'DM' ? parseFloat(parts[3] || '0') : 0
        const vert = code === 'DM' ? parts[4] : undefined
        const stdAngRaw = code === 'DM' ? parseFloat(parts[5] || '') : parseFloat(parts[3] || '')
        const stdDist = code === 'DM' ? parseFloat(parts[6] || '0') : 0
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1

        let stdAng = Number.isNaN(stdAngRaw) ? 0 : stdAngRaw
        const inst = traverseCtx.dirInstCode ? instrumentLibrary[traverseCtx.dirInstCode] : undefined
        if (inst && inst.angleStd_sec > 0) {
          stdAng = stdAng > 0 ? Math.sqrt(stdAng * stdAng + inst.angleStd_sec * inst.angleStd_sec) : inst.angleStd_sec
        }
        if (!stdAng) stdAng = 5

        if (state.normalize === false) {
          const thisFace = angRad >= Math.PI ? 'face2' : 'face1'
          if (faceMode === 'unknown') faceMode = thisFace
          if (faceMode !== thisFace) {
            logs.push(`Mixed face direction rejected at line ${lineNum}`)
            continue
          }
        }

        const dirObs: DirectionObservation = {
          id: obsId++,
          type: 'direction',
          instCode: traverseCtx.dirInstCode ?? '',
          setId: traverseCtx.dirSetId,
          at: traverseCtx.occupy,
          to,
          obs: angRad,
          stdDev: stdAng * SEC_TO_RAD,
        }
        observations.push(dirObs)

        if (code === 'DM' && dist > 0) {
          observations.push({
            id: obsId++,
            type: 'dist',
            subtype: 'ts',
            instCode: traverseCtx.dirInstCode ?? '',
            setId: code,
            from: traverseCtx.occupy,
            to,
            obs: dist * toMeters,
            stdDev: (stdDist || 0.005) * toMeters,
            mode: state.deltaMode,
          })
          if (vert) {
            if (state.deltaMode === 'horiz') {
              const dh = parseFloat(vert) * toMeters
              observations.push({
                id: obsId++,
                type: 'lev',
                instCode: '',
                from: traverseCtx.occupy,
                to,
                obs: dh,
                lenKm: 0,
                stdDev: 0.001,
              })
            } else {
              const zenRad = vert.includes('-')
                ? dmsToRad(vert)
                : (parseFloat(vert) * Math.PI) / 180
              observations.push({
                id: obsId++,
                type: 'zenith',
                instCode: '',
                from: traverseCtx.occupy,
                to,
                obs: zenRad,
                stdDev: (stdAng || 5) * SEC_TO_RAD,
              })
            }
          }
        }
      } else if (code === 'DE') {
        traverseCtx.occupy = undefined
        traverseCtx.backsight = undefined
        traverseCtx.dirSetId = undefined
        traverseCtx.dirInstCode = undefined
        faceMode = 'unknown'
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
        const dist = parseFloat(parts[3] || '0')
        const vert = parts[4]
        const stdDist = parts[5] ? parseFloat(parts[5]) : 0
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1
        observations.push({
          id: obsId++,
          type: 'dist',
          subtype: 'ts',
          instCode: '',
          setId: 'SS',
          from,
          to,
          obs: dist * toMeters,
          stdDev: (stdDist || 0.01) * toMeters,
          mode: state.deltaMode,
          // mark sideshots to allow downstream exclusion if desired
          calc: { sideshot: true },
        })
        if (vert) {
          if (state.deltaMode === 'horiz') {
            const dh = parseFloat(vert) * toMeters
            observations.push({
              id: obsId++,
              type: 'lev',
              instCode: '',
              from,
              to,
              obs: dh,
              lenKm: 0,
              stdDev: 0.001,
              calc: { sideshot: true },
            })
          } else {
            const zenRad = vert.includes('-')
              ? dmsToRad(vert)
              : (parseFloat(vert) * Math.PI) / 180
            observations.push({
              id: obsId++,
              type: 'zenith',
              instCode: '',
              from,
              to,
              obs: zenRad,
              stdDev: 5 * SEC_TO_RAD,
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
        const stdXY = parseFloat(parts[6])

        const inst = instrumentLibrary[instCode]
        let sigma = stdXY
        if (inst && inst.gpsStd_xy > 0) {
          sigma = Math.sqrt(stdXY * stdXY + inst.gpsStd_xy * inst.gpsStd_xy)
        }

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
          stdDev: state.units === 'ft' ? sigma / FT_PER_M : sigma,
        }
        observations.push(obs)
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
        observations.push(obs)
      } else {
        logs.push(`Unrecognized code "${code}" at line ${lineNum}, skipping`)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logs.push(`Error on line ${lineNum}: ${msg}`)
    }
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
  logs.push(
    `Counts: ${Object.entries(typeSummary)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')}`,
  )
  logs.push(
    `Stations: ${Object.keys(stations).length} (unknown: ${unknowns.length}). Obs: ${observations.length}`,
  )

  return { stations, observations, instrumentLibrary, unknowns, parseState: { ...state }, logs }
}
