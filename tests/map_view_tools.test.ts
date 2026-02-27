import { describe, expect, it } from 'vitest';

import { computeInverse2D, computePivotAngles, normalizeAzimuthRad } from '../src/engine/mapTools';

describe('MapView geometry tools', () => {
  it('computes bidirectional azimuths and horizontal distance for inverse', () => {
    const inverse = computeInverse2D({ x: 0, y: 0 }, { x: 100, y: 100 });
    expect(inverse).toBeDefined();
    expect(inverse?.distance2d ?? 0).toBeCloseTo(Math.hypot(100, 100), 10);
    expect(inverse?.azimuthFromToRad ?? 0).toBeCloseTo(Math.PI / 4, 10);
    expect(inverse?.azimuthToFromRad ?? 0).toBeCloseTo((Math.PI * 5) / 4, 10);
  });

  it('computes inside and outside angles at a pivot', () => {
    const angles = computePivotAngles(
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 0 },
    );
    expect(angles).toBeDefined();
    expect(angles?.insideAngleRad ?? 0).toBeCloseTo(Math.PI / 2, 10);
    expect(angles?.outsideAngleRad ?? 0).toBeCloseTo((Math.PI * 3) / 2, 10);
  });

  it('normalizes negative azimuths into [0, 2pi)', () => {
    const normalized = normalizeAzimuthRad(-Math.PI / 2);
    expect(normalized).toBeCloseTo((Math.PI * 3) / 2, 10);
  });
});
