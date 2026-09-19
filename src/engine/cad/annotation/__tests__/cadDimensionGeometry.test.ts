import { describe, expect, it } from 'vitest';

import {
  deriveCadDimensionGeometry,
  type CadDimensionGeometry,
  type CadDimensionGeometryInput,
} from '../cadDimensionGeometry';

interface Point {
  x: number;
  y: number;
}

const baseInput = (
  overrides: Partial<CadDimensionGeometryInput> = {},
): CadDimensionGeometryInput => ({
  kind: 'linear-horizontal',
  p1: { x: 0, y: 0 },
  p2: { x: 3, y: 4 },
  dimLinePoint: { x: 0, y: 6 },
  textGap: 0.25,
  arrowSize: 0.25,
  extensionOffset: 0.1,
  extensionOvershoot: 0.2,
  textHeight: 0.5,
  decimalPrecision: 2,
  ...overrides,
});

const expectPointClose = (actual: Point, expected: Point, precision = 6): void => {
  expect(actual.x).toBeCloseTo(expected.x, precision);
  expect(actual.y).toBeCloseTo(expected.y, precision);
};

/** Every emitted numeric field must be finite (no NaN leaks into render/export). */
const expectFinite = (geometry: CadDimensionGeometry): void => {
  const numbers = [
    geometry.measurement,
    geometry.textPosition.x,
    geometry.textPosition.y,
    geometry.bounds.minX,
    geometry.bounds.minY,
    geometry.bounds.maxX,
    geometry.bounds.maxY,
    ...geometry.extensionSegments.flatMap((segment) => [segment.from.x, segment.from.y, segment.to.x, segment.to.y]),
    ...geometry.dimensionSegments.flatMap((segment) => [segment.from.x, segment.from.y, segment.to.x, segment.to.y]),
    ...geometry.arrowTransforms.flatMap((arrow) => [arrow.x, arrow.y, arrow.rotationDeg, arrow.size]),
  ];
  for (const value of numbers) expect(Number.isFinite(value)).toBe(true);
};

describe('deriveCadDimensionGeometry — linear measurement kinds', () => {
  it('measures |dx| for linear-horizontal and lays the dimension line at dimLinePoint.y', () => {
    const geometry = deriveCadDimensionGeometry(baseInput({ kind: 'linear-horizontal' }));

    expect(geometry.measurement).toBe(3);
    expect(geometry.formattedText).toBe('3.00');
    expect(geometry.status).toBe('ok');
    expect(geometry.dimensionSegments).toEqual([
      { from: { x: 0, y: 6 }, to: { x: 3, y: 6 } },
    ]);
    expect(geometry.extensionSegments).toHaveLength(2);
    expectPointClose(geometry.extensionSegments[0].from, { x: 0, y: 0.1 });
    expectPointClose(geometry.extensionSegments[0].to, { x: 0, y: 6.2 });
    expectPointClose(geometry.extensionSegments[1].from, { x: 3, y: 4.1 });
    expectFinite(geometry);
  });

  it('measures |dy| for linear-vertical', () => {
    const geometry = deriveCadDimensionGeometry(baseInput({ kind: 'linear-vertical' }));

    expect(geometry.measurement).toBe(4);
    expect(geometry.formattedText).toBe('4.00');
    expectPointClose(geometry.dimensionSegments[0].from, { x: 0, y: 0 });
    expectPointClose(geometry.dimensionSegments[0].to, { x: 0, y: 4 });
    expectFinite(geometry);
  });

  it('measures euclidean distance for aligned', () => {
    const geometry = deriveCadDimensionGeometry(baseInput({ kind: 'aligned' }));

    expect(geometry.measurement).toBeCloseTo(5, 9);
    expect(geometry.formattedText).toBe('5.00');
    expectFinite(geometry);
  });

  it('keeps measurement finite and deterministic for coincident points', () => {
    const input = baseInput({ kind: 'aligned', p2: { x: 0, y: 0 } });
    const geometry = deriveCadDimensionGeometry(input);

    expect(geometry.measurement).toBe(0);
    expect(geometry.textSide).toBe('outside');
    expectFinite(geometry);
    expect(deriveCadDimensionGeometry(input)).toEqual(geometry);
  });
});

describe('deriveCadDimensionGeometry — readable text rotation', () => {
  const rotateInput = (directionDeg: number): CadDimensionGeometryInput => {
    const rad = (directionDeg * Math.PI) / 180;
    return baseInput({
      kind: 'aligned',
      p1: { x: 0, y: 0 },
      p2: { x: Math.cos(rad) * 10, y: Math.sin(rad) * 10 },
      dimLinePoint: { x: 0, y: 0 },
    });
  };

  it('keeps text upright in all four quadrants (no upside-down text)', () => {
    const expected: Array<[number, number]> = [
      [0, 0],
      [45, 45],
      [90, 90],
      [135, -45],
      [180, 0],
      [225, 45],
      [270, 90],
      [315, -45],
    ];

    for (const [directionDeg, expectedRotation] of expected) {
      const geometry = deriveCadDimensionGeometry(rotateInput(directionDeg));
      expect(geometry.textRotationDeg).toBeCloseTo(expectedRotation, 6);
      expect(geometry.textRotationDeg).toBeGreaterThan(-90);
      expect(geometry.textRotationDeg).toBeLessThanOrEqual(90);
    }
  });
});

describe('deriveCadDimensionGeometry — angular interior angle', () => {
  const angularInput = (
    ray2Deg: number,
    overrides: Partial<CadDimensionGeometryInput> = {},
  ): CadDimensionGeometryInput => {
    const rad = (ray2Deg * Math.PI) / 180;
    return baseInput({
      kind: 'angular',
      vertex: { x: 0, y: 0 },
      ray1Point: { x: 10, y: 0 },
      ray2Point: { x: Math.cos(rad) * 10, y: Math.sin(rad) * 10 },
      dimLinePoint: { x: 5, y: 5 },
      ...overrides,
    });
  };

  it('measures east + north as 90 degrees, never reflex', () => {
    const geometry = deriveCadDimensionGeometry(
      angularInput(90, { ray2Point: { x: 0, y: 10 }, dimLinePoint: { x: 5, y: 5 } }),
    );

    expect(geometry.measurement).toBeCloseTo(90, 9);
    expect(geometry.formattedText).toBe('90.00°');
    expect(geometry.dimensionSegments).toHaveLength(12);
    expect(geometry.arrowTransforms).toHaveLength(2);
    expect(geometry.extensionSegments).toHaveLength(2);
    expect(geometry.textRotationDeg).toBeCloseTo(45, 6);
    expectFinite(geometry);
  });

  it('measures 30 degrees and 100 degrees as interior angles', () => {
    expect(deriveCadDimensionGeometry(angularInput(30)).measurement).toBeCloseTo(30, 9);
    expect(deriveCadDimensionGeometry(angularInput(100)).measurement).toBeCloseTo(100, 9);
  });

  it('folds a reflex sweep to the interior angle (260 -> 100)', () => {
    expect(deriveCadDimensionGeometry(angularInput(260)).measurement).toBeCloseTo(100, 9);
    expect(deriveCadDimensionGeometry(angularInput(260)).formattedText).toBe('100.00°');
  });
});

describe('deriveCadDimensionGeometry — radius and diameter', () => {
  const radialInput = (kind: 'radius' | 'diameter'): CadDimensionGeometryInput =>
    baseInput({
      kind,
      center: { x: 0, y: 0 },
      radius: 25,
      arcPoint: { x: 25, y: 0 },
      p1: { x: 0, y: 0 },
      p2: { x: 25, y: 0 },
      dimLinePoint: { x: 30, y: 30 },
      prefix: kind === 'radius' ? 'R' : 'Ø',
    });

  it('reports radius 25 with a single outward arrowhead at the arc', () => {
    const geometry = deriveCadDimensionGeometry(radialInput('radius'));

    expect(geometry.measurement).toBe(25);
    expect(geometry.formattedText).toBe('R25.00');
    expect(geometry.arrowTransforms).toHaveLength(1);
    expect(geometry.arrowTransforms[0]).toEqual({ x: 25, y: 0, rotationDeg: 0, size: 0.25 });
    expectPointClose(geometry.dimensionSegments[0].from, { x: 0, y: 0 });
    expectPointClose(geometry.dimensionSegments[0].to, { x: 25, y: 0 });
    expect(geometry.extensionSegments).toEqual([]);
    expectFinite(geometry);
  });

  it('reports diameter 50 with two outward arrowheads', () => {
    const geometry = deriveCadDimensionGeometry(radialInput('diameter'));

    expect(geometry.measurement).toBe(50);
    expect(geometry.formattedText).toBe('Ø50.00');
    expect(geometry.arrowTransforms).toHaveLength(2);
    expect(geometry.arrowTransforms[0].rotationDeg).toBe(180);
    expect(geometry.arrowTransforms[1].rotationDeg).toBe(0);
    expectPointClose(geometry.dimensionSegments[0].from, { x: -25, y: 0 });
    expectPointClose(geometry.dimensionSegments[0].to, { x: 25, y: 0 });
    expectFinite(geometry);
  });
});

describe('deriveCadDimensionGeometry — large coordinate invariance', () => {
  it('is invariant when p1/p2/dimLinePoint are shifted by (+2e6, +7e6)', () => {
    const small = deriveCadDimensionGeometry(baseInput({ kind: 'aligned' }));
    const offset = { x: 2000000, y: 7000000 };
    const shifted = deriveCadDimensionGeometry(
      baseInput({
        kind: 'aligned',
        p1: { x: 0 + offset.x, y: 0 + offset.y },
        p2: { x: 3 + offset.x, y: 4 + offset.y },
        dimLinePoint: { x: 0 + offset.x, y: 6 + offset.y },
      }),
    );

    expect(shifted.measurement).toBeCloseTo(small.measurement, 9);
    expect(shifted.formattedText).toBe(small.formattedText);
    expect(shifted.textRotationDeg).toBeCloseTo(small.textRotationDeg, 9);
    expect(shifted.textSide).toBe(small.textSide);
    expect(shifted.bounds.minX).toBeCloseTo(small.bounds.minX + offset.x, 6);
    expect(shifted.bounds.minY).toBeCloseTo(small.bounds.minY + offset.y, 6);
    expect(shifted.bounds.maxX).toBeCloseTo(small.bounds.maxX + offset.x, 6);
    expect(shifted.bounds.maxY).toBeCloseTo(small.bounds.maxY + offset.y, 6);
    expectFinite(shifted);
  });
});

describe('deriveCadDimensionGeometry — deterministic inside/outside fit', () => {
  const span = 3;

  it('places text and inward arrows inside when text plus arrows fit', () => {
    const geometry = deriveCadDimensionGeometry(baseInput({ textHeight: 0.5 }));

    expect(geometry.textSide).toBe('inside');
    expect(geometry.arrowTransforms.map((arrow) => arrow.rotationDeg)).toEqual([0, 180]);
    expectPointClose(geometry.textPosition, { x: 1.5, y: 6.25 });
  });

  it('places text and outward arrows outside when the span is too small', () => {
    const geometry = deriveCadDimensionGeometry(baseInput({ textHeight: 2 }));

    expect(geometry.textSide).toBe('outside');
    expect(geometry.arrowTransforms.map((arrow) => arrow.rotationDeg)).toEqual([180, 0]);
    expect(geometry.textPosition.x).toBeGreaterThan(span);
    expect(geometry.textPosition.y).toBeCloseTo(6.25, 6);
  });

  it('uses the documented chars * 0.6 * textHeight width estimate', () => {
    const narrow = deriveCadDimensionGeometry(baseInput({ textHeight: 0.5, textGap: 0 }));
    const wide = deriveCadDimensionGeometry(baseInput({ textHeight: 2, textGap: 0 }));

    expect(narrow.textSide).toBe('inside');
    expect(wide.textSide).toBe('outside');
    expect(narrow.formattedText).toBe('3.00');
  });

  it('is byte-for-byte deterministic for repeated calls', () => {
    const input = baseInput({ kind: 'angular', vertex: { x: 0, y: 0 }, ray1Point: { x: 10, y: 0 }, ray2Point: { x: 0, y: 10 }, dimLinePoint: { x: 5, y: 5 } });
    expect(deriveCadDimensionGeometry(input)).toEqual(deriveCadDimensionGeometry(input));
  });
});
