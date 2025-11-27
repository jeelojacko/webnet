import { describe, expect, it } from 'vitest'
import { DEG_TO_RAD, RAD_TO_DEG, dmsToRad, radToDmsStr } from '../src/engine/angles'

describe('angles helpers', () => {
  it('converts dms to radians and back', () => {
    const rad = dmsToRad('045.3030')
    const deg = rad * RAD_TO_DEG
    expect(deg).toBeCloseTo(45.5083, 3)
    expect(radToDmsStr(rad)).toBe('045-30-30.0')
  })

  it('wraps radToDmsStr into 0-360', () => {
    expect(radToDmsStr(-DEG_TO_RAD * 10)).toBe('350-00-00.0')
    expect(radToDmsStr(DEG_TO_RAD * 370)).toBe('010-00-00.0')
  })
})
