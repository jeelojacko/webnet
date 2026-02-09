import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseInput } from '../src/engine/parse'
import type { LevelObservation } from '../src/types'

const fixture = readFileSync('tests/fixtures/simple.dat', 'utf-8')

describe('parseInput', () => {
  const parsed = parseInput(fixture)

  it('parses stations and unknowns', () => {
    expect(Object.keys(parsed.stations)).toHaveLength(3)
    expect(parsed.unknowns).toEqual(['2000'])
  })

  it('parses instrument library', () => {
    expect(Object.keys(parsed.instrumentLibrary)).toHaveLength(3)
    expect(parsed.instrumentLibrary.TS1.desc).toBe('TS Geodetic 1mm+1ppm')
  })

  it('parses observations', () => {
    expect(parsed.observations.length).toBeGreaterThan(0)
    const types = parsed.observations.reduce<Record<string, number>>((acc, o) => {
      acc[o.type] = (acc[o.type] ?? 0) + 1
      return acc
    }, {})
    expect(types).toMatchObject({ dist: 3, angle: 3, gps: 2, lev: 2 })
    expect(types.dir ?? 0).toBe(0)
  })

  it('applies .LWEIGHT fallback and converts ft leveling lengths', () => {
    const levelOnly = parseInput(
      [
        '.UNITS FT',
        '.LWEIGHT 0.7',
        'C A 0 0 0 *',
        'C B 0 0 0',
        'L LEV1 A B 1.0 328.084',
      ].join('\n'),
    )
    const lev = levelOnly.observations.find((o) => o.type === 'lev') as LevelObservation
    expect(lev).toBeDefined()
    expect(lev.lenKm).toBeCloseTo(0.1, 6) // 328.084 ft -> 0.1 km
    expect(lev.obs).toBeCloseTo(0.3048, 6) // 1 ft -> meters
    expect(lev.stdDev).toBeCloseTo(0.00007, 6) // 0.7 mm/km * 0.1 km
    expect(levelOnly.logs.some((l) => l.includes('.LWEIGHT applied'))).toBe(true)
  })

  it('parses bearings and zeniths', () => {
    const bearingFixture = readFileSync('tests/fixtures/bearing_vertical.dat', 'utf-8')
    const parsed = parseInput(bearingFixture)
    const types = parsed.observations.reduce<Record<string, number>>((acc, o) => {
      acc[o.type] = (acc[o.type] ?? 0) + 1
      return acc
    }, {})
    expect(types.bearing).toBe(1)
    expect(types.zenith).toBe(1)
    expect(types.dist).toBeGreaterThan(0)
  })

  it('parses traverse legs and direction sets', () => {
    const parsed = parseInput(readFileSync('tests/fixtures/traverse.dat', 'utf-8'))
    const types = parsed.observations.reduce<Record<string, number>>((acc, o) => {
      acc[o.type] = (acc[o.type] ?? 0) + 1
      return acc
    }, {})
    expect(types.angle).toBeGreaterThan(0)
    expect(types.dist).toBeGreaterThan(0)
    expect(parsed.logs.some((l) => l.includes('Traverse start'))).toBe(true)
  })

  it('logs traverse closure', () => {
    const parsed = parseInput(readFileSync('tests/fixtures/traverse_closure.dat', 'utf-8'))
    expect(parsed.logs.some((l) => l.includes('Traverse end'))).toBe(true)
  })

  it('rejects mixed-face directions when normalize off', () => {
    const parsed = parseInput(readFileSync('tests/fixtures/direction_face_mixed.dat', 'utf-8'), {}, { normalize: false })
    expect(parsed.logs.some((l) => l.includes('Mixed face direction rejected'))).toBe(true)
    expect(parsed.directionRejectDiagnostics?.some((d) => d.reason === 'mixed-face')).toBe(true)
  })

  it('accepts paired face directions when normalized', () => {
    const parsed = parseInput(readFileSync('tests/fixtures/direction_face_balanced.dat', 'utf-8'))
    const dirCount = parsed.observations.filter((o) => o.type === 'direction').length
    expect(dirCount).toBe(1)
    const dir = parsed.observations.find((o) => o.type === 'direction')
    expect(dir?.rawCount).toBe(2)
    expect(dir?.rawFace1Count).toBe(1)
    expect(dir?.rawFace2Count).toBe(1)
    if (dir?.type === 'direction') {
      expect(dir.rawMaxResidual).toBeDefined()
      expect(dir.facePairDelta).toBeDefined()
      expect(dir.face1Spread).toBeDefined()
      expect(dir.face2Spread).toBeDefined()
    }
    expect(parsed.logs.some((l) => l.includes('Direction set reduction'))).toBe(true)
    expect(parsed.logs.some((l) => l.includes('Mixed face'))).toBe(false)
  })

  it('reduces direction sets by target (unpaired targets remain separate)', () => {
    const parsed = parseInput(readFileSync('tests/fixtures/direction_faceset.dat', 'utf-8'))
    const dirs = parsed.observations.filter((o) => o.type === 'direction')
    expect(dirs).toHaveLength(2)
    expect(parsed.logs.some((l) => l.includes('paired targets=0'))).toBe(true)
  })

  it('rejects invalid sideshot occupy/backsight', () => {
    const parsed = parseInput(readFileSync('tests/fixtures/sideshot_invalid.dat', 'utf-8'))
    expect(parsed.observations.some((o) => o.setId === 'SS')).toBe(false)
    expect(parsed.logs.some((l) => l.includes('Invalid sideshot occupy/backsight'))).toBe(true)
  })

  it('parses DV slope mode into dist + zenith', () => {
    const parsed = parseInput(readFileSync('tests/fixtures/dv_slope.dat', 'utf-8'), {}, { deltaMode: 'slope' })
    const zen = parsed.observations.find((o) => o.type === 'zenith')
    const dist = parsed.observations.find((o) => o.type === 'dist')
    expect(zen).toBeDefined()
    expect(dist).toBeDefined()
  })

  it('parses BM with zenith in slope mode', () => {
    const parsed = parseInput(readFileSync('tests/fixtures/bm_slope.dat', 'utf-8'), {}, { deltaMode: 'slope' })
    const zen = parsed.observations.find((o) => o.type === 'zenith')
    expect(zen).toBeDefined()
  })

  it('parses GNSS component sigmas and correlation', () => {
    const parsed = parseInput(
      [
        'I GPS1 GNSS 0 0 0 0 0 0 0.002',
        'C A 0 0 0 !',
        'C B 100 0 0',
        'G GPS1 A B 100 0 0.010 0.020 0.3',
      ].join('\n'),
    )
    const g = parsed.observations.find((o) => o.type === 'gps')
    expect(g).toBeDefined()
    expect(g?.stdDevE).toBeCloseTo(Math.sqrt(0.01 * 0.01 + 0.002 * 0.002), 8)
    expect(g?.stdDevN).toBeCloseTo(Math.sqrt(0.02 * 0.02 + 0.002 * 0.002), 8)
    expect(g?.corrEN).toBeCloseTo(0.3, 8)
  })

  it('parses phase-3 reduction directives', () => {
    const parsed = parseInput(
      [
        '.MAPMODE ANGLECALC',
        '.MAPSCALE 0.9996',
        '.CURVREF ON',
        '.REFRACTION 0.14',
        '.VRED CURVREF',
        'C A 0 0 0 !',
        'C B 100 0 0',
        'D A-B 100 0.01',
      ].join('\n'),
    )
    expect(parsed.parseState.mapMode).toBe('anglecalc')
    expect(parsed.parseState.mapScaleFactor).toBeCloseTo(0.9996, 8)
    expect(parsed.parseState.applyCurvatureRefraction).toBe(true)
    expect(parsed.parseState.refractionCoefficient).toBeCloseTo(0.14, 8)
    expect(parsed.parseState.verticalReduction).toBe('curvref')
  })

  it('parses TS correlation directives', () => {
    const parsed = parseInput(
      [
        '.TSCORR SETUP 0.35',
        'C A 0 0 0 !',
        'C B 100 0 0',
        'D A-B 100 0.01',
      ].join('\n'),
    )
    expect(parsed.parseState.tsCorrelationEnabled).toBe(true)
    expect(parsed.parseState.tsCorrelationScope).toBe('setup')
    expect(parsed.parseState.tsCorrelationRho).toBeCloseTo(0.35, 8)

    const off = parseInput(
      [
        '.TSCORR OFF',
        'C A 0 0 0 !',
        'C B 100 0 0',
        'D A-B 100 0.01',
      ].join('\n'),
    )
    expect(off.parseState.tsCorrelationEnabled).toBe(false)
  })

  it('parses robust directives', () => {
    const parsed = parseInput(
      [
        '.ROBUST HUBER 1.8',
        'C A 0 0 0 !',
        'C B 100 0 0',
        'D A-B 100 0.01',
      ].join('\n'),
    )
    expect(parsed.parseState.robustMode).toBe('huber')
    expect(parsed.parseState.robustK).toBeCloseTo(1.8, 8)

    const off = parseInput(
      [
        '.ROBUST OFF',
        'C A 0 0 0 !',
        'C B 100 0 0',
        'D A-B 100 0.01',
      ].join('\n'),
    )
    expect(off.parseState.robustMode).toBe('none')
  })

  it('parses sideshot with explicit azimuth token', () => {
    const parsed = parseInput(
      [
        'C OCC 0 0 0 !',
        'C BS 0 100 0 !',
        'TB OCC BS',
        'SS OCC SH AZ=090-00-00.0 10.0 90.0 5.0 0.002',
      ].join('\n'),
    )
    const ssDist = parsed.observations.find((o) => o.type === 'dist' && o.setId === 'SS')
    expect(ssDist).toBeDefined()
    expect(typeof ssDist?.calc).toBe('object')
    expect((ssDist?.calc as { azimuthObs?: number })?.azimuthObs).toBeDefined()
  })

  it('parses sideshot with setup horizontal angle token', () => {
    const parsed = parseInput(
      [
        'C OCC 0 0 0 !',
        'C BS 0 100 0 !',
        'TB OCC BS',
        'SS OCC SH HZ=090-00-00.0 10.0 90.0 5.0 0.002',
      ].join('\n'),
    )
    const ssDist = parsed.observations.find((o) => o.type === 'dist' && o.setId === 'SS')
    expect(ssDist).toBeDefined()
    expect(typeof ssDist?.calc).toBe('object')
    expect((ssDist?.calc as { hzObs?: number })?.hzObs).toBeDefined()
    expect((ssDist?.calc as { backsightId?: string })?.backsightId).toBe('BS')
  })
})
