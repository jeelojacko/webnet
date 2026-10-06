/** Circle v1 geometry: Center/Radius + Center/Diameter fixed-center laws. */
import { describe, expect, it } from 'vitest';
import {
  buildCircleCenterDiameter,
  buildCircleCenterDiameterScalar,
  buildCircleCenterRadius,
  buildCircleCenterRadiusScalar,
  CAD_XY_DEGENERATE_FLOOR,
} from '../src/engine/cad/cadGeometryShapeBuilders';

describe('circle center/radius law', () => {
  it('fixes the center and derives radius from the picked point', () => {
    const built = buildCircleCenterRadius({ x: 10, y: 20 }, { x: 40, y: 20 });
    expect(built).toEqual({ center: { x: 10, y: 20 }, radius: 30 });
  });
  it('accepts a positive numeric radius scalar', () => {
    expect(buildCircleCenterRadiusScalar({ x: 1, y: 2 }, 5)).toEqual({ center: { x: 1, y: 2 }, radius: 5 });
  });
  it('rejects zero/negative/non-finite radius on the CAD floor', () => {
    expect(buildCircleCenterRadiusScalar({ x: 0, y: 0 }, 0)).toBeNull();
    expect(buildCircleCenterRadiusScalar({ x: 0, y: 0 }, -3)).toBeNull();
    expect(buildCircleCenterRadiusScalar({ x: 0, y: 0 }, NaN)).toBeNull();
    expect(buildCircleCenterRadiusScalar({ x: 0, y: 0 }, CAD_XY_DEGENERATE_FLOOR / 2)).toBeNull();
    expect(buildCircleCenterRadius({ x: 0, y: 0 }, { x: 0, y: 0 })).toBeNull();
    expect(buildCircleCenterRadius({ x: NaN, y: 0 }, { x: 1, y: 0 })).toBeNull();
  });
});

describe('circle center/diameter law (B0.1 corrected)', () => {
  it('preserves the supplied center exactly; radius is half the diameter', () => {
    const built = buildCircleCenterDiameter({ x: 10, y: 20 }, { x: 40, y: 20 });
    expect(built).toEqual({ center: { x: 10, y: 20 }, radius: 15 });
  });
  it('accepts a positive numeric diameter scalar', () => {
    expect(buildCircleCenterDiameterScalar({ x: 1, y: 2 }, 10)).toEqual({ center: { x: 1, y: 2 }, radius: 5 });
  });
  it('rejects zero/non-finite diameter', () => {
    expect(buildCircleCenterDiameter({ x: 10, y: 20 }, { x: 10, y: 20 })).toBeNull();
    expect(buildCircleCenterDiameter({ x: 10, y: 20 }, { x: NaN, y: 20 })).toBeNull();
    expect(buildCircleCenterDiameterScalar({ x: 0, y: 0 }, 0)).toBeNull();
  });
  it('is deterministic across repeats', () => {
    const first = buildCircleCenterDiameter({ x: 3, y: -7 }, { x: 11, y: 9 });
    const second = buildCircleCenterDiameter({ x: 3, y: -7 }, { x: 11, y: 9 });
    expect(second).toEqual(first);
  });
});
