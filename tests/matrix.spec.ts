import { describe, expect, it } from 'vitest'
import {
  choleskyDecompose,
  choleskyDecomposeWithDamping,
  inv,
  invertSymmetricLDLT,
  invertSymmetricLDLTWithInfo,
  invertSPDCholesky,
  ldltDecomposeSymmetric,
  multiply,
  solveSPDCholesky,
  solveSymmetricLDLT,
  solveSPDWithDamping,
  transpose,
  zeros,
} from '../src/engine/matrix'

describe('matrix helpers', () => {
  it('creates zeros of given size', () => {
    const m = zeros(2, 3)
    expect(m).toEqual([
      [0, 0, 0],
      [0, 0, 0],
    ])
  })

  it('multiplies matrices', () => {
    const a = [
      [1, 2],
      [3, 4],
    ]
    const b = [
      [5, 6],
      [7, 8],
    ]
    expect(multiply(a, b)).toEqual([
      [19, 22],
      [43, 50],
    ])
  })

  it('transposes matrices', () => {
    expect(
      transpose([
        [1, 2, 3],
        [4, 5, 6],
      ]),
    ).toEqual([
      [1, 4],
      [2, 5],
      [3, 6],
    ])
  })

  it('inverts a simple 2x2', () => {
    const invM = inv([
      [4, 7],
      [2, 6],
    ])
    expect(invM[0][0]).toBeCloseTo(0.6)
    expect(invM[0][1]).toBeCloseTo(-0.7)
    expect(invM[1][0]).toBeCloseTo(-0.2)
    expect(invM[1][1]).toBeCloseTo(0.4)
  })

  it('decomposes an SPD matrix with Cholesky', () => {
    const l = choleskyDecompose([
      [4, 2],
      [2, 3],
    ])
    expect(l[0][0]).toBeCloseTo(2)
    expect(l[1][0]).toBeCloseTo(1)
    expect(l[1][1]).toBeCloseTo(Math.sqrt(2))
  })

  it('solves an SPD system without explicit inversion', () => {
    const x = solveSPDCholesky(
      [
        [4, 2],
        [2, 3],
      ],
      [
        [6],
        [7],
      ],
    )
    expect(x[0][0]).toBeCloseTo(0.5)
    expect(x[1][0]).toBeCloseTo(2)
  })

  it('inverts an SPD matrix through Cholesky solves', () => {
    const invM = invertSPDCholesky([
      [4, 2],
      [2, 3],
    ])
    expect(invM[0][0]).toBeCloseTo(0.375)
    expect(invM[0][1]).toBeCloseTo(-0.25)
    expect(invM[1][0]).toBeCloseTo(-0.25)
    expect(invM[1][1]).toBeCloseTo(0.5)
  })

  it('adds diagonal damping when Cholesky sees a non-SPD matrix', () => {
    const result = choleskyDecomposeWithDamping([
      [1, 2],
      [2, 1],
    ])

    expect(result.damping).toBeGreaterThan(0)
    expect(result.attempts).toBeGreaterThan(0)
    expect(result.factor[0][0]).toBeGreaterThan(0)
  })

  it('solves a regularized system without explicit inversion', () => {
    const result = solveSPDWithDamping(
      [
        [1, 2],
        [2, 1],
      ],
      [
        [1],
        [0],
      ],
    )

    expect(result.damping).toBeGreaterThan(0)
    expect(Number.isFinite(result.solution[0][0])).toBe(true)
    expect(Number.isFinite(result.solution[1][0])).toBe(true)
  })

  it('solves a symmetric indefinite system with pivoted LDLT', () => {
    const factorization = ldltDecomposeSymmetric([
      [2, 3],
      [3, -1],
    ])
    const x = solveSymmetricLDLT(factorization, [
      [8],
      [1],
    ])

    expect(x[0][0]).toBeCloseTo(1)
    expect(x[1][0]).toBeCloseTo(2)
  })

  it('inverts a symmetric indefinite matrix with pivoted LDLT', () => {
    const invM = invertSymmetricLDLT([
      [2, 3],
      [3, -1],
    ])

    expect(invM[0][0]).toBeCloseTo(1 / 11)
    expect(invM[0][1]).toBeCloseTo(3 / 11)
    expect(invM[1][0]).toBeCloseTo(3 / 11)
    expect(invM[1][1]).toBeCloseTo(-2 / 11)
  })

  it('handles a zero-diagonal symmetric matrix through a 2x2 pivot block', () => {
    const invM = invertSymmetricLDLT([
      [0, 1],
      [1, 0],
    ])

    expect(invM[0][0]).toBeCloseTo(0)
    expect(invM[0][1]).toBeCloseTo(1)
    expect(invM[1][0]).toBeCloseTo(1)
    expect(invM[1][1]).toBeCloseTo(0)
  })

  it('reports 2x2 pivot-block usage for LDLT recovery info', () => {
    const result = invertSymmetricLDLTWithInfo([
      [0, 1],
      [1, 0],
    ])

    expect(result.twoByTwoPivotCount).toBe(1)
    expect(result.factorization.blockSizes).toEqual([2, -1])
  })
})
