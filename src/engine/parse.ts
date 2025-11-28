import { dmsToRad, RAD_TO_DEG, SEC_TO_RAD } from './angles'
import type {
  AngleObservation,
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

  const lines = input.split('\n')
  let lineNum = 0
  let obsId = 0

  for (const raw of lines) {
    lineNum += 1
    const line = raw.trim()
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
        const distA = parseFloat(parts[3])
        const distB = parseFloat(parts[4])
        const angStd = parseFloat(parts[5])
        const gpsStd = parseFloat(parts[6])
        const levStd = parseFloat(parts[7])
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
        const numeric = parts.slice(2).map((p) => parseFloat(p)).filter((v) => !Number.isNaN(v))
        const is3D = state.coordMode === '3D' || numeric.length >= 3
        const nIdx = state.order === 'NE' ? 0 : 1
        const eIdx = state.order === 'NE' ? 1 : 0
        const hIdx = is3D ? 2 : -1
        const north = numeric[nIdx] ?? 0
        const east = numeric[eIdx] ?? 0
        const h = hIdx >= 0 ? numeric[hIdx] : 0
        const seStart = is3D ? 3 : 2
        const sx = numeric[seStart]
        const sy = numeric[seStart + 1]
        const sh = numeric[seStart + 2]
        const fixed = parts.includes('!') || parts.includes('*')
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1
        stations[id] = { x: east * toMeters, y: north * toMeters, h: h * toMeters, fixed }
        if (!fixed) {
          if (sx) (stations[id] as any).sx = sx * toMeters
          if (sy) (stations[id] as any).sy = sy * toMeters
          if (is3D && sh) (stations[id] as any).sh = sh * toMeters
        }
      } else if (code === 'P' || code === 'PH') {
        // Geodetic position (lat/long [+H]) projected to local EN using first P as origin (equirectangular)
        const id = parts[1]
        const latDeg = toDegrees(parts[2])
        let lonDeg = toDegrees(parts[3])
        if (state.lonSign === 'west-positive') {
          lonDeg = -lonDeg
        }
        const elev = parts[4] ? parseFloat(parts[4]) : 0
        const seN = parts[5] ? parseFloat(parts[5]) : 0
        const seE = parts[6] ? parseFloat(parts[6]) : 0
        const fixed = parts.includes('!') || parts.includes('*')
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
        const st: any = stations[id] || { x: 0, y: 0, h: 0, fixed: false }
        st.x = east
        st.y = north
        st.h = elev * toMeters
        st.latDeg = latDeg
        st.lonDeg = lonDeg
        st.fixed = fixed || st.fixed
        st.heightType = code === 'PH' ? 'ellipsoid' : 'orthometric'
        if (!st.fixed) {
          if (seN) st.sy = seN * toMeters
          if (seE) st.sx = seE * toMeters
        }
        stations[id] = st
        logs.push(`P record projected to local EN (meters) for ${id}`)
      } else if (code === 'CH' || code === 'EH') {
        // Coordinate or elevation with ellipsoid height
        const id = parts[1]
        const numeric = parts.slice(2).map((p) => parseFloat(p)).filter((v) => !Number.isNaN(v))
        const is3D = state.coordMode === '3D' || numeric.length >= 3
        const nIdx = state.order === 'NE' ? 0 : 1
        const eIdx = state.order === 'NE' ? 1 : 0
        const hIdx = is3D ? 2 : -1
        const north = numeric[nIdx] ?? 0
        const east = numeric[eIdx] ?? 0
        const h = hIdx >= 0 ? numeric[hIdx] : numeric[0] ?? 0
        const seStart = is3D ? 3 : 2
        const sx = numeric[seStart]
        const sy = numeric[seStart + 1]
        const sh = numeric[seStart + 2]
        const fixed = parts.includes('!') || parts.includes('*')
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1
        stations[id] = {
          x: east * toMeters,
          y: north * toMeters,
          h: h * toMeters,
          fixed,
          heightType: 'ellipsoid',
        }
        if (!fixed) {
          if (sx) (stations[id] as any).sx = sx * toMeters
          if (sy) (stations[id] as any).sy = sy * toMeters
          if (is3D && sh) (stations[id] as any).sh = sh * toMeters
        }
      } else if (code === 'E') {
        // Elevation only: E Station Elev [StdErr] [fixity]
        const id = parts[1]
        const elev = parseFloat(parts[2])
        const stdErr = parseFloat(parts[3] || '0')
        const fixed = parts.includes('!') || parts.includes('*')
        const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1
        const st = stations[id] || { x: 0, y: 0, h: 0, fixed: false }
        st.h = elev * toMeters
        st.fixed = fixed || st.fixed
        if (!fixed && stdErr) (st as any).sh = stdErr * toMeters
        stations[id] = st
      } else if (code === 'D') {
        const hasInst = parts.length > 5 && /[A-Za-z]/.test(parts[1]) && /[A-Za-z]/.test(parts[2])
        const instCode = hasInst ? parts[1] : ''
        const setId = hasInst ? parts[2] : ''
        const from = hasInst ? parts[3] : parts[1]
        const to = hasInst ? parts[4] : parts[2]
        const dist = parseFloat(hasInst ? parts[5] : parts[3])
        const sigmaToken = hasInst ? parts[6] : parts[4]
        let hi: number | undefined
        let ht: number | undefined
        let stdRaw = 0
        if (sigmaToken && sigmaToken.includes('/')) {
          const [hiStr, htStr] = sigmaToken.split('/')
          hi = parseFloat(hiStr)
          ht = parseFloat(htStr)
        } else {
          stdRaw = parseFloat(sigmaToken || '0')
        }

        const inst = instCode ? instrumentLibrary[instCode] : undefined
        let sigma = stdRaw
        if (inst) {
          const a = inst.distA_ppm * 1e-6 * dist
          const b = inst.distB_const
          sigma = Math.sqrt(a * a + b * b + stdRaw * stdRaw)
        }

        const obs: DistanceObservation = {
          id: obsId++,
          type: 'dist',
          subtype: 'ts',
          instCode,
          setId,
          from,
          to,
          obs: state.units === 'ft' ? dist / FT_PER_M : dist,
          stdDev: state.units === 'ft' ? sigma / FT_PER_M : sigma,
          hi,
          ht,
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
        let sigmaSec = stdRawArcsec
        if (inst && inst.angleStd_sec > 0) {
          sigmaSec = Math.sqrt(stdRawArcsec * stdRawArcsec + inst.angleStd_sec * inst.angleStd_sec)
        }

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
        const from = parts[1]
        const to = parts[2]
        const valToken = parts[3]
        const stdToken = parts[4]
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
        // Distance + vertical: in delta mode, HD + deltaH; in slope mode not yet supported
        if (state.deltaMode === 'horiz') {
          const from = parts[1]
          const to = parts[2]
          const dist = parseFloat(parts[3])
          const dh = parseFloat(parts[4])
          const stdDist = parts[5] ? parseFloat(parts[5]) : 0
          const stdDh = parts[6] ? parseFloat(parts[6]) : 0
          const hiHt = parts.find((p) => p.includes('/'))
          let hi: number | undefined
          let ht: number | undefined
          if (hiHt) {
            const [hiStr, htStr] = hiHt.split('/')
            hi = parseFloat(hiStr)
            ht = parseFloat(htStr)
          }
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
            hi,
            ht,
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
          logs.push(`DV slope/zenith not yet supported at line ${lineNum}, skipping`)
        }
      } else if (code === 'BM') {
        // Bearing + measurements. Bearing stored/logged; dist parsed; zenith or deltaH captured based on mode
        const from = parts[1]
        const to = parts[2]
        const bearing = parts[3]
        const dist = parseFloat(parts[4])
        const vert = parts[5]
        const stdDist = parts[6] ? parseFloat(parts[6]) : 0
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
          const stdAng = parts[5] ? parseFloat(parts[5]) : 0
          const stdDist = parts[6] ? parseFloat(parts[6]) : 0
          const toMeters = state.units === 'ft' ? 1 / FT_PER_M : 1
          observations.push({
            id: obsId++,
            type: 'angle',
            instCode: '',
            setId: '',
            at,
            from,
            to,
            obs: dmsToRad(ang),
            stdDev: stdAng * SEC_TO_RAD,
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
              stdDev: 0.001,
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
              stdDev: (stdAng || 5) * SEC_TO_RAD,
            })
          }
        }
      } else if (code === 'B') {
        const from = parts[1]
        const to = parts[2]
        const bearingToken = parts[3]
        const stdArc = parseFloat(parts[4] || '5')
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
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logs.push(`Error on line ${lineNum}: ${msg}`)
    }
  }

  const unknowns = Object.keys(stations).filter((id) => !stations[id]?.fixed)
  logs.push(
    `Stations: ${Object.keys(stations).length} (unknown: ${unknowns.length}). Obs: ${observations.length}`,
  )

  return { stations, observations, instrumentLibrary, unknowns, logs }
}
