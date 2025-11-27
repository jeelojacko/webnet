import { describe, expect, it } from 'vitest'
import { inv, multiply, transpose, zeros } from '../src/engine/matrix'

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
})
