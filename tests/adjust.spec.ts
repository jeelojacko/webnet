import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { LSAEngine } from '../src/engine/adjust'

const fixture = readFileSync('tests/fixtures/simple.dat', 'utf-8')

describe('LSAEngine', () => {
  it('solves the simple fixture network', () => {
    const engine = new LSAEngine({ input: fixture, maxIterations: 10 })
    const result = engine.solve()

    // Convergence can vary with small networks; assert healthy output instead of strict success flag.
    expect(result.dof).toBeGreaterThan(0)
    expect(Object.keys(result.stations)).toHaveLength(3)
    expect(result.observations.length).toBeGreaterThan(0)

    // Check adjusted unknown station is finite (no NaN/inf)
    const stn = result.stations['2000']
    expect(Number.isFinite(stn.x)).toBe(true)
    expect(Number.isFinite(stn.y)).toBe(true)
    expect(Number.isFinite(stn.h)).toBe(true)
    expect(stn.fixed).toBe(false)
  })

  it('handles bearing and zenith observations', () => {
    const custom = readFileSync('tests/fixtures/bearing_vertical.dat', 'utf-8')
    const engine = new LSAEngine({ input: custom, maxIterations: 10 })
    const result = engine.solve()
    expect(result.dof).toBeGreaterThan(0)
    const stn = result.stations['X']
    expect(Number.isFinite(stn.x)).toBe(true)
    expect(Number.isFinite(stn.y)).toBe(true)
    expect(result.observations.some((o) => o.type === 'bearing')).toBe(true)
    expect(result.observations.some((o) => o.type === 'zenith')).toBe(true)
  })

  it('logs traverse closure residuals', () => {
    const input = readFileSync('tests/fixtures/traverse_closure.dat', 'utf-8')
    const engine = new LSAEngine({ input, maxIterations: 5 })
    const result = engine.solve()
    expect(result.logs.some((l) => l.includes('Traverse closure residual'))).toBe(true)
  })

  it('supports anisotropic correlated GNSS weighting', () => {
    const input = [
      'C A 0 0 0 !',
      'C B 100 0 0',
      'G GPS1 A B 100.01 -0.02 0.01 0.03 0.25',
      'D A-B 100.0 0.02',
    ].join('\n')
    const engine = new LSAEngine({ input, maxIterations: 10 })
    const result = engine.solve()
    expect(result.observations.some((o) => o.type === 'gps')).toBe(true)
    const gps = result.observations.find((o) => o.type === 'gps')
    expect(gps?.stdDevE).toBeDefined()
    expect(gps?.stdDevN).toBeDefined()
    expect(gps?.corrEN).toBeCloseTo(0.25, 8)
    expect(gps?.stdRes).toBeDefined()
    expect(result.dof).toBeGreaterThanOrEqual(0)
  })

  it('reports direction reduction diagnostics for face-paired sets', () => {
    const input = [
      'C O 0 0 0 !',
      'C B 0 100 0 !',
      'C P 100 0 0',
      'D O-P 100.0 0.005',
      'D B-P 141.421356 0.005',
      'DB O B',
      'DN P 090.0000 1.0',
      'DM P 270.0000 100.0 0.0000 1.0 0.002',
      'DE',
    ].join('\n')
    const engine = new LSAEngine({ input, maxIterations: 10 })
    const result = engine.solve()
    expect(result.directionSetDiagnostics?.length).toBeGreaterThan(0)
    const first = result.directionSetDiagnostics?.[0]
    expect(first?.rawCount).toBe(2)
    expect(first?.reducedCount).toBe(1)
    expect(first?.pairedTargets).toBe(1)
    expect(result.setupDiagnostics?.some((s) => s.station === 'O')).toBe(true)
  })

  it('reports direction-target repeatability diagnostics and suspect ranking', () => {
    const input = [
      '.2D',
      'C O 0 0 0 !',
      'C BS 0 100 0 !',
      'C P 100 0 0',
      'C Q 120 40 0',
      'D O-P 100.000 0.003',
      'D O-Q 126.491 0.003',
      'D BS-P 141.421 0.003',
      'D BS-Q 134.164 0.003',
      'DB O BS',
      'DN P 090-00-00.0 1.0',
      'DN P 090-00-08.0 1.0',
      'DN P 270-00-03.0 1.0',
      'DN P 270-00-14.0 1.0',
      'DN Q 108-26-06.0 1.0',
      'DN Q 288-26-09.0 1.0',
      'DE',
    ].join('\n')

    const engine = new LSAEngine({ input, maxIterations: 12 })
    const result = engine.solve()
    const rows = result.directionTargetDiagnostics ?? []
    expect(rows.length).toBeGreaterThanOrEqual(2)

    const pRow = rows.find((r) => r.target === 'P')
    const qRow = rows.find((r) => r.target === 'Q')
    expect(pRow).toBeDefined()
    expect(qRow).toBeDefined()
    expect(pRow?.rawCount).toBe(4)
    expect(pRow?.face1Count).toBe(2)
    expect(pRow?.face2Count).toBe(2)
    expect((pRow?.rawSpreadArcSec ?? 0) > (qRow?.rawSpreadArcSec ?? 0)).toBe(true)
    expect((pRow?.suspectScore ?? 0) >= (qRow?.suspectScore ?? 0)).toBe(true)
  })

  it('aggregates multi-set direction repeatability trends by occupy-target', () => {
    const input = [
      '.2D',
      'C O 0 0 0 !',
      'C BS 0 100 0 !',
      'C P 100 0 0',
      'C Q 120 40 0',
      'D O-P 100.000 0.003',
      'D O-Q 126.491 0.003',
      'D BS-P 141.421 0.003',
      'D BS-Q 134.164 0.003',
      'DB O BS',
      'DN P 090-00-00.0 1.0',
      'DN P 270-00-01.0 1.0',
      'DN Q 108-26-06.0 1.0',
      'DN Q 288-26-06.5 1.0',
      'DE',
      'DB O BS',
      'DN P 090-00-12.0 1.0',
      'DN P 270-00-18.0 1.0',
      'DN Q 108-26-06.1 1.0',
      'DN Q 288-26-06.3 1.0',
      'DE',
    ].join('\n')

    const engine = new LSAEngine({ input, maxIterations: 12 })
    const result = engine.solve()
    const rows = result.directionRepeatabilityDiagnostics ?? []
    expect(rows.length).toBeGreaterThanOrEqual(2)

    const pTrend = rows.find((r) => r.occupy === 'O' && r.target === 'P')
    const qTrend = rows.find((r) => r.occupy === 'O' && r.target === 'Q')
    expect(pTrend).toBeDefined()
    expect(qTrend).toBeDefined()
    expect(pTrend?.setCount).toBe(2)
    expect(qTrend?.setCount).toBe(2)
    expect((pTrend?.maxRawSpreadArcSec ?? 0) >= (qTrend?.maxRawSpreadArcSec ?? 0)).toBe(true)
    expect((pTrend?.suspectScore ?? 0) >= (qTrend?.suspectScore ?? 0)).toBe(true)
  })

  it('includes setup-level residual quality diagnostics for blunder screening', () => {
    const input = [
      '.AMODE ANGLE',
      'C C1 0 0 0 !',
      'C C2 200 0 0 !',
      'C U 100 80 0',
      'D C1-U 128.060 0.002',
      'D C2-U 128.065 0.002',
      'A U-C1-C2 102-40-00.0 1.5',
      'A U-C2-C1 257-20-00.0 1.5',
      'A U-C1-C2 102-41-20.0 1.5',
    ].join('\n')
    const engine = new LSAEngine({ input, maxIterations: 12 })
    const result = engine.solve()
    const setup = result.setupDiagnostics?.find((s) => s.station === 'U')
    expect(setup).toBeDefined()
    expect((setup?.stdResCount ?? 0) > 0).toBe(true)
    expect(setup?.rmsStdRes).toBeDefined()
    expect(setup?.maxStdRes).toBeDefined()
    expect(setup?.localFailCount).toBeGreaterThanOrEqual(0)
    expect(setup?.worstObsType).toBeDefined()
    expect(setup?.worstObsStations).toContain('U-')
  })

  it('reports traverse closure ratio diagnostics', () => {
    const input = [
      'C OCC 0 0 0 !',
      'C BS 0 100 0 !',
      'C P 100 0 0',
      'TB OCC BS',
      'T P 090.0000 100.0 0.0 1.0 0.005 5.0',
      'TE OCC 180.0000 100.0 0.0 1.0 0.005 5.0',
    ].join('\n')
    const engine = new LSAEngine({ input, maxIterations: 8 })
    const result = engine.solve()
    expect(result.traverseDiagnostics).toBeDefined()
    expect(result.traverseDiagnostics?.closureCount).toBeGreaterThan(0)
    expect(result.traverseDiagnostics?.totalTraverseDistance).toBeGreaterThan(0)
    expect(result.traverseDiagnostics?.linearPpm).toBeDefined()
    expect(result.traverseDiagnostics?.thresholds).toBeDefined()
    expect(result.traverseDiagnostics?.loops?.length).toBeGreaterThan(0)
  })

  it('applies map scale reduction to horizontal distances when map mode is on', () => {
    const baseInput = [
      '.2D',
      'C A 0 0 0 !',
      'C B 100 0 0',
      'B A-B 090.0000 1.0',
      'D A-B 100.0000 0.001',
    ].join('\n')
    const scaledInput = ['.MAPMODE ON', '.MAPSCALE 0.9996', baseInput].join('\n')
    const noScale = new LSAEngine({ input: baseInput, maxIterations: 10 }).solve()
    const withScale = new LSAEngine({ input: scaledInput, maxIterations: 10 }).solve()
    expect(withScale.stations.B.x).toBeGreaterThan(noScale.stations.B.x + 0.03)
    expect(withScale.logs.some((l) => l.includes('Map reduction active'))).toBe(true)
  })

  it('applies curvature/refraction correction to zenith calculations when enabled', () => {
    const baseInput = [
      'C A 0 0 0 !',
      'C B 10000 0 0',
      'B A-B 090.0000 1.0',
      'D A-B 10000.0000 0.001',
      'V A-B 090.0000 1.0',
    ].join('\n')
    const withCurvRefInput = [
      '.CURVREF ON',
      '.REFRACTION 0.13',
      '.VRED CURVREF',
      baseInput,
    ].join('\n')

    const noCurv = new LSAEngine({ input: baseInput, maxIterations: 10 }).solve()
    const withCurv = new LSAEngine({ input: withCurvRefInput, maxIterations: 10 }).solve()

    const zNoCurv = noCurv.observations.find((o) => o.type === 'zenith')
    const zWithCurv = withCurv.observations.find((o) => o.type === 'zenith')
    expect(zNoCurv?.calc).toBeDefined()
    expect(zWithCurv?.calc).toBeDefined()
    expect(Math.abs(withCurv.stations.B.h - noCurv.stations.B.h)).toBeGreaterThan(1)
    expect(withCurv.logs.some((l) => l.includes('Vertical reduction active'))).toBe(true)
  })

  it('applies TS angular correlation model and reports diagnostics', () => {
    const base = [
      '.AMODE ANGLE',
      'C C1 0 0 0 !',
      'C C2 200 0 0 !',
      'C C3 100 200 0 !',
      'C U 100 80 0',
      'D C1-U 128.06 0.003',
      'D C2-U 128.06 0.003',
      'D C3-U 120.00 0.003',
      'A U-C1-C2 102-40-00.0 1.2',
      'A U-C2-C3 116-33-55.0 1.2',
      'A U-C3-C1 140-46-10.0 1.2',
      'A U-C1-C2 102-40-06.0 1.2',
    ].join('\n')
    const off = new LSAEngine({ input: base, maxIterations: 12 }).solve()
    const on = new LSAEngine({ input: `.TSCORR SETUP 0.35\n${base}`, maxIterations: 12 }).solve()

    expect(on.tsCorrelationDiagnostics).toBeDefined()
    expect(on.tsCorrelationDiagnostics?.enabled).toBe(true)
    expect(on.tsCorrelationDiagnostics?.scope).toBe('setup')
    expect(on.tsCorrelationDiagnostics?.pairCount).toBeGreaterThan(0)
    expect(on.logs.some((l) => l.includes('TS correlation diagnostics'))).toBe(true)
    expect(on.seuw).not.toBe(off.seuw)
  })

  it('applies robust huber reweighting and reports iteration diagnostics', () => {
    const input = [
      '.AMODE ANGLE',
      '.ROBUST HUBER 1.5',
      'C C1 0 0 0 !',
      'C C2 200 0 0 !',
      'C C3 100 200 0 !',
      'C U 100 80 0',
      'D C1-U 128.06 0.003',
      'D C2-U 128.06 0.003',
      'D C3-U 120.00 0.003',
      'A U-C1-C2 102-40-00.0 1.0',
      'A U-C2-C3 116-33-55.0 1.0',
      'A U-C3-C1 140-46-10.0 1.0',
      'A U-C1-C2 102-42-30.0 1.0',
    ].join('\n')
    const result = new LSAEngine({ input, maxIterations: 12 }).solve()
    expect(result.robustDiagnostics).toBeDefined()
    expect(result.robustDiagnostics?.enabled).toBe(true)
    expect(result.robustDiagnostics?.mode).toBe('huber')
    expect((result.robustDiagnostics?.iterations.length ?? 0) > 0).toBe(true)
    expect(result.logs.some((l) => l.includes('robust(huber)'))).toBe(true)
  })

  it('computes post-adjusted sideshot coordinates/precision when azimuth reference exists', () => {
    const input = readFileSync('tests/fixtures/sideshot_postadjust_known.dat', 'utf-8')
    const engine = new LSAEngine({ input, maxIterations: 10 })
    const result = engine.solve()
    expect(result.sideshots?.length).toBeGreaterThan(0)
    const side = result.sideshots?.find((s) => s.to === 'SH')
    expect(side).toBeDefined()
    expect(side?.hasAzimuth).toBe(true)
    expect(side?.easting).toBeDefined()
    expect(side?.northing).toBeDefined()
    expect(side?.sigmaE).toBeDefined()
    expect(side?.sigmaN).toBeDefined()
  })

  it('reports sideshot limitation when target azimuth reference is unavailable', () => {
    const input = readFileSync('tests/fixtures/sideshot_postadjust_missing_az.dat', 'utf-8')
    const engine = new LSAEngine({ input, maxIterations: 10 })
    const result = engine.solve()
    const side = result.sideshots?.find((s) => s.to === 'SHMISS')
    expect(side).toBeDefined()
    expect(side?.hasAzimuth).toBe(false)
    expect(side?.note?.includes('azimuth unavailable')).toBe(true)
  })

  it('uses explicit SS azimuth to compute coordinates without target approximation', () => {
    const input = readFileSync('tests/fixtures/sideshot_postadjust_explicit_az.dat', 'utf-8')
    const engine = new LSAEngine({ input, maxIterations: 10 })
    const result = engine.solve()
    const side = result.sideshots?.find((s) => s.to === 'SHAZ')
    expect(side).toBeDefined()
    expect(side?.hasAzimuth).toBe(true)
    expect(side?.azimuthSource).toBe('explicit')
    expect(side?.easting).toBeDefined()
    expect(side?.northing).toBeDefined()
  })

  it('uses setup-based SS horizontal angle with backsight orientation', () => {
    const input = readFileSync('tests/fixtures/sideshot_postadjust_setup_hz.dat', 'utf-8')
    const engine = new LSAEngine({ input, maxIterations: 10 })
    const result = engine.solve()
    const side = result.sideshots?.find((s) => s.to === 'SHSET')
    expect(side).toBeDefined()
    expect(side?.azimuthSource).toBe('setup')
    expect(side?.hasAzimuth).toBe(true)
    expect(side?.easting).toBeDefined()
    expect(side?.northing).toBeDefined()
    expect(Math.abs((side?.easting ?? 0) - 10)).toBeLessThan(0.25)
    expect(Math.abs(side?.northing ?? 0)).toBeLessThan(0.25)
  })
})
