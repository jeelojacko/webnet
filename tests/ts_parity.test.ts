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
})
