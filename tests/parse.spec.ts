import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseInput } from '../src/engine/parse'

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
})
