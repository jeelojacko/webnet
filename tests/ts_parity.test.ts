import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { LSAEngine } from '../src/engine/adjust'
import { parseInput } from '../src/engine/parse'

describe('TS parity harness (phase 1)', () => {
  it('keeps baseline TS-only network outputs stable', () => {
    const input = readFileSync('tests/fixtures/ts_phase1_baseline.dat', 'utf-8')
    const engine = new LSAEngine({ input, maxIterations: 15 })
    const result = engine.solve()

    expect(result.dof).toBeGreaterThan(0)
    expect(result.chiSquare).toBeDefined()
    expect(result.typeSummary?.dist?.count ?? 0).toBe(3)
    expect(result.typeSummary?.angle?.count ?? 0).toBe(3)
    expect(result.typeSummary?.dir?.count ?? 0).toBe(0)

    const st = result.stations['2000']
    expect(st).toBeDefined()
    expect(Number.isFinite(st.x)).toBe(true)
    expect(Number.isFinite(st.y)).toBe(true)
    expect(result.observations.every((o) => o.sourceLine != null)).toBe(true)
  })

  it('supports explicit A-record mode forcing (ANGLE vs DIR)', () => {
    const common = ['C A 0 0 0 !', 'C B 100 0 0', 'C X 50 50 0']
    const angleInput = ['.AMODE ANGLE', ...common, 'A X-A-B 135.0000 1.0'].join('\n')
    const dirInput = ['.AMODE DIR', ...common, 'A X-A-B 135.0000 1.0'].join('\n')

    const angleParsed = parseInput(angleInput)
    const dirParsed = parseInput(dirInput)

    expect(angleParsed.observations.some((o) => o.type === 'angle')).toBe(true)
    expect(angleParsed.observations.some((o) => o.type === 'dir')).toBe(false)
    expect(dirParsed.observations.some((o) => o.type === 'dir')).toBe(true)
    expect(dirParsed.observations.some((o) => o.type === 'angle')).toBe(false)
  })

  it('matches STAR-style parity metrics with raw directions and default instrument fallback', () => {
    const input = readFileSync('tests/fixtures/starnet_parity_phase2.dat', 'utf-8')
    const result = new LSAEngine({
      input,
      maxIterations: 10,
      instrumentLibrary: {
        __STAR_DEFAULT__: {
          code: '__STAR_DEFAULT__',
          desc: 'STAR*NET default instrument',
          edm_const: 0.001,
          edm_ppm: 1,
          hzPrecision_sec: 0.5,
          vaPrecision_sec: 0.5,
          instCentr_m: 0.00075,
          tgtCentr_m: 0,
          gpsStd_xy: 0,
          levStd_mmPerKm: 0,
        },
      },
      parseOptions: {
        currentInstrument: '__STAR_DEFAULT__',
        directionSetMode: 'raw',
        robustMode: 'none',
        tsCorrelationEnabled: false,
      },
    }).solve()

    expect(result.converged).toBe(true)
    expect(result.iterations).toBe(4)
    expect(result.dof).toBe(165)
    expect(result.typeSummary?.direction?.count ?? 0).toBe(18)
    expect(result.seuw).toBeCloseTo(0.9728, 3)

    const p1000 = result.stations['1000']
    const p1 = result.stations['1']
    const p9 = result.stations['9']
    expect(p1000.x).toBeCloseTo(0.9954, 4)
    expect(p1000.y).toBeCloseTo(2.0619, 4)
    expect(p1.x).toBeCloseTo(2.3561, 4)
    expect(p1.y).toBeCloseTo(-2.4644, 4)
    expect(p9.x).toBeCloseTo(101.4485, 4)
    expect(p9.y).toBeCloseTo(-1.4039, 4)
  })
})
