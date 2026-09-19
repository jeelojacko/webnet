import { describe, expect, it } from 'vitest';

import type { CadBlockChild } from '../../cadTypes';
import {
  ANNOTATION_ARROWHEAD_SEEDS,
  ARROWHEAD_DIRECTIONS,
  ARROWHEAD_SEED_PREFIX,
  arrowheadRotationDeg,
  arrowheadTransform,
} from '../cadAnnotationArrowheads';

interface Point {
  x: number;
  y: number;
}

/** Seed children are contractually line/polygon only. */
const pointsOf = (child: CadBlockChild): Point[] => {
  if (child.type === 'line') {
    return [
      { x: child.fromX, y: child.fromY },
      { x: child.toX, y: child.toY },
    ];
  }
  if (child.type === 'polygon') {
    return child.vertices.map(({ x, y }) => ({ x, y }));
  }
  throw new Error(`unexpected arrowhead child type: ${child.type}`);
};

const allPoints = (seedIndex: number): Point[] =>
  ANNOTATION_ARROWHEAD_SEEDS[seedIndex].entities.flatMap(pointsOf);

describe('ANNOTATION_ARROWHEAD_SEEDS', () => {
  it('exposes 4 CadBlockDefinition-compatible seeds with unique ids and names', () => {
    expect(ANNOTATION_ARROWHEAD_SEEDS).toHaveLength(4);

    const ids = ANNOTATION_ARROWHEAD_SEEDS.map((seed) => seed.id);
    const names = ANNOTATION_ARROWHEAD_SEEDS.map((seed) => seed.name);
    expect(new Set(ids).size).toBe(4);
    expect(new Set(names).size).toBe(4);
    expect(names).toEqual(['Closed Arrow', 'Open Arrow', 'Dot', 'Architectural Tick']);

    for (const seed of ANNOTATION_ARROWHEAD_SEEDS) {
      expect(seed.id.startsWith(ARROWHEAD_SEED_PREFIX)).toBe(true);
      expect(seed.basePoint).toEqual({ x: 0, y: 0 });
      expect(seed.entities.length).toBeGreaterThan(0);
    }
  });

  it('keeps block-local child ids unique within each definition', () => {
    for (const seed of ANNOTATION_ARROWHEAD_SEEDS) {
      const childIds = seed.entities.map((child) => child.id);
      expect(new Set(childIds).size).toBe(childIds.length);
    }
  });

  it('uses only text-free line/polygon children', () => {
    for (const seed of ANNOTATION_ARROWHEAD_SEEDS) {
      for (const child of seed.entities) {
        expect(child.type === 'line' || child.type === 'polygon').toBe(true);
      }
    }
  });

  it('pins the tip at the origin with the body extending -X for every seed', () => {
    ANNOTATION_ARROWHEAD_SEEDS.forEach((seed, index) => {
      const points = allPoints(index);
      expect(points.length).toBeGreaterThan(0);

      const touchesTip = points.some((p) => p.x === 0 && p.y === 0);
      expect(touchesTip, `${seed.name} must touch the tip at (0,0)`).toBe(true);

      for (const point of points) {
        expect(point.x, `${seed.name} must not extend past +X`).toBeLessThanOrEqual(1e-9);
      }
    });
  });

  it('authors the closed arrow as the +X triangle [(0,0),(-1,0.25),(-1,-0.25)]', () => {
    const closed = ANNOTATION_ARROWHEAD_SEEDS[0];
    const [body] = closed.entities;
    expect(body.type).toBe('polygon');
    if (body.type !== 'polygon') return;
    expect(body.vertices).toEqual([
      { x: 0, y: 0 },
      { x: -1, y: 0.25 },
      { x: -1, y: -0.25 },
    ]);
  });

  it('uses an octagon of radius 0.25 tangent to the tip for the dot', () => {
    const dot = ANNOTATION_ARROWHEAD_SEEDS[2];
    const [body] = dot.entities;
    expect(body.type).toBe('polygon');
    if (body.type !== 'polygon') return;
    expect(body.vertices).toHaveLength(8);
    for (const vertex of body.vertices) {
      const radius = Math.hypot(vertex.x + 0.25, vertex.y);
      expect(radius).toBeCloseTo(0.25, 5);
    }
  });
});

describe('arrowheadRotationDeg', () => {
  it('maps east/north/west/south/diagonal onto their bearings without 180 reversal', () => {
    for (const pin of ARROWHEAD_DIRECTIONS) {
      expect(arrowheadRotationDeg(pin.directionDeg)).toBe(pin.expectedRotationDeg);
    }
    expect(arrowheadRotationDeg(0)).toBe(0);
    expect(arrowheadRotationDeg(45)).toBe(45);
    expect(arrowheadRotationDeg(90)).toBe(90);
    expect(arrowheadRotationDeg(180)).toBe(180);
    expect(arrowheadRotationDeg(270)).toBe(270);
  });

  it('normalizes out-of-range directions into [0, 360)', () => {
    expect(arrowheadRotationDeg(-90)).toBe(270);
    expect(arrowheadRotationDeg(450)).toBe(90);
  });

  it('rejects non-finite directions', () => {
    expect(() => arrowheadRotationDeg(Number.NaN)).toThrow(RangeError);
  });
});

describe('arrowheadTransform', () => {
  it('passes direction through as rotationDeg and scales uniformly by size', () => {
    expect(arrowheadTransform({ x: 10, y: 20, directionDeg: 90, size: 2.5 })).toEqual({
      x: 10,
      y: 20,
      rotationDeg: 90,
      scaleX: 2.5,
      scaleY: 2.5,
    });
  });

  it('normalizes direction and rejects non-positive size', () => {
    expect(arrowheadTransform({ x: 0, y: 0, directionDeg: 180, size: 1 }).rotationDeg).toBe(180);
    expect(arrowheadTransform({ x: 0, y: 0, directionDeg: -90, size: 1 }).rotationDeg).toBe(270);
    expect(() => arrowheadTransform({ x: 0, y: 0, directionDeg: 0, size: 0 })).toThrow(RangeError);
  });
});
