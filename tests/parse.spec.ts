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
})
