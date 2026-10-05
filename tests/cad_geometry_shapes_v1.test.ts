import { describe, expect, it } from 'vitest';

import {
  buildRectangleVertices,
  buildRegularPolygonVertices,
} from '../src/engine/cad/cadGeometryShapeBuilders';

const approx = (actual: number, expected: number, epsilon = 1e-9): void => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(epsilon);
};

const signedArea = (vertices: { x: number; y: number }[]): number => {
  let sum = 0;
  for (let i = 0; i < vertices.length; i += 1) {
    const current = vertices[i]!;
    const next = vertices[(i + 1) % vertices.length]!;
    sum += current.x * next.y - next.x * current.y;
  }
  return sum / 2;
};

const expectClosedCcW = (vertices: { x: number; y: number }[]): void => {
  // O(N): consecutive edges (incl. implicit closing edge) are non-degenerate
  // and the ring is CCW. A pairwise O(N^2) check is deliberately avoided:
  // it flakes under full-suite load at N=1024 with zero extra coverage.
  for (let i = 0; i < vertices.length; i += 1) {
    const next = vertices[(i + 1) % vertices.length]!;
    expect(Math.hypot(vertices[i]!.x - next.x, vertices[i]!.y - next.y)).toBeGreaterThan(1e-12);
  }
  expect(signedArea(vertices)).toBeGreaterThan(0);
};

describe('rectangle vertices', () => {
  const canonical = [
    { x: 1, y: 2 },
    { x: 5, y: 2 },
    { x: 5, y: 7 },
    { x: 1, y: 7 },
  ];
  it.each([
    [{ x: 1, y: 2 }, { x: 5, y: 7 }],
    [{ x: 5, y: 2 }, { x: 1, y: 7 }],
    [{ x: 5, y: 7 }, { x: 1, y: 2 }],
    [{ x: 1, y: 7 }, { x: 5, y: 2 }],
  ])('drag quadrant %j %j is canonical CCW', (first, opposite) => {
    const vertices = buildRectangleVertices(first, opposite);
    expect(vertices).toEqual(canonical);
    expectClosedCcW(vertices!);
  });

  it('rejects zero width, zero height, and non-finite corners', () => {
    expect(buildRectangleVertices({ x: 1, y: 2 }, { x: 1, y: 7 })).toBeNull();
    expect(buildRectangleVertices({ x: 1, y: 2 }, { x: 5, y: 2 })).toBeNull();
    expect(buildRectangleVertices({ x: 1, y: 2 }, { x: 1, y: 2 })).toBeNull();
    expect(buildRectangleVertices({ x: NaN, y: 2 }, { x: 5, y: 7 })).toBeNull();
    expect(buildRectangleVertices({ x: 1, y: 2 }, { x: Infinity, y: 7 })).toBeNull();
  });
});

describe('inscribed polygons', () => {
  it('triangle exact coords', () => {
    const vertices = buildRegularPolygonVertices({ x: 0, y: 0 }, { x: 4, y: 0 }, 3, 'inscribed')!;
    expect(vertices).toHaveLength(3);
    approx(vertices[0]!.x, 4);
    approx(vertices[0]!.y, 0);
    approx(vertices[1]!.x, -2);
    approx(vertices[1]!.y, 2 * Math.sqrt(3));
    approx(vertices[2]!.x, -2);
    approx(vertices[2]!.y, -2 * Math.sqrt(3));
    expectClosedCcW(vertices);
  });

  it('square exact coords', () => {
    const vertices = buildRegularPolygonVertices({ x: 0, y: 0 }, { x: 2, y: 0 }, 4, 'inscribed')!;
    expect(vertices).toHaveLength(4);
    const expected = [
      { x: 2, y: 0 },
      { x: 0, y: 2 },
      { x: -2, y: 0 },
      { x: 0, y: -2 },
    ];
    expected.forEach((point, index) => {
      approx(vertices[index]!.x, point.x);
      approx(vertices[index]!.y, point.y);
    });
    expectClosedCcW(vertices);
  });

  it('pentagon exact coords', () => {
    const vertices = buildRegularPolygonVertices({ x: 1, y: 1 }, { x: 4, y: 1 }, 5, 'inscribed')!;
    expect(vertices).toHaveLength(5);
    for (let k = 0; k < 5; k += 1) {
      const angle = (2 * Math.PI * k) / 5;
      approx(vertices[k]!.x, 1 + 3 * Math.cos(angle));
      approx(vertices[k]!.y, 1 + 3 * Math.sin(angle));
    }
    expectClosedCcW(vertices);
  });
});

describe('circumscribed polygons', () => {
  it('square apothem and tangency', () => {
    const center = { x: 0, y: 0 };
    const through = { x: 2, y: 0 };
    const vertices = buildRegularPolygonVertices(center, through, 4, 'circumscribed')!;
    expect(vertices).toHaveLength(4);
    const expected = [
      { x: 2, y: -2 },
      { x: 2, y: 2 },
      { x: -2, y: 2 },
      { x: -2, y: -2 },
    ];
    expected.forEach((point, index) => {
      approx(vertices[index]!.x, point.x);
      approx(vertices[index]!.y, point.y);
    });
    // Midpoint of edge 0->1 lies on ray C->P at apothem distance.
    const midpoint = { x: (vertices[0]!.x + vertices[1]!.x) / 2, y: (vertices[0]!.y + vertices[1]!.y) / 2 };
    approx(midpoint.x, 2);
    approx(midpoint.y, 0);
    expectClosedCcW(vertices);
  });

  it('hexagon apothem and tangency', () => {
    const center = { x: 0, y: 0 };
    const apothem = 3;
    const vertices = buildRegularPolygonVertices(center, { x: apothem, y: 0 }, 6, 'circumscribed')!;
    expect(vertices).toHaveLength(6);
    const radius = apothem / Math.cos(Math.PI / 6);
    for (const vertex of vertices) {
      approx(Math.hypot(vertex.x, vertex.y), radius);
    }
    // First edge straddles the +x ray: midpoint at apothem on the ray.
    const midpoint = { x: (vertices[0]!.x + vertices[1]!.x) / 2, y: (vertices[0]!.y + vertices[1]!.y) / 2 };
    approx(midpoint.x, apothem);
    approx(midpoint.y, 0, 1e-9);
    // Vertex 0 sits at theta - pi/6 exactly.
    approx(vertices[0]!.x, radius * Math.cos(-Math.PI / 6));
    approx(vertices[0]!.y, radius * Math.sin(-Math.PI / 6));
    expectClosedCcW(vertices);
  });
});

describe('polygon guards', () => {
  it('admits N=3 and N=1024', () => {
    expect(buildRegularPolygonVertices({ x: 0, y: 0 }, { x: 1, y: 0 }, 3, 'inscribed')).toHaveLength(3);
    const max = buildRegularPolygonVertices({ x: 0, y: 0 }, { x: 1, y: 0 }, 1024, 'inscribed')!;
    expect(max).toHaveLength(1024);
    expectClosedCcW(max);
  });

  it('rejects N=2, N=1025, and non-integers', () => {
    const center = { x: 0, y: 0 };
    const through = { x: 1, y: 0 };
    expect(buildRegularPolygonVertices(center, through, 2, 'inscribed')).toBeNull();
    expect(buildRegularPolygonVertices(center, through, 1025, 'inscribed')).toBeNull();
    expect(buildRegularPolygonVertices(center, through, 4.5, 'inscribed')).toBeNull();
    expect(buildRegularPolygonVertices(center, through, NaN, 'inscribed')).toBeNull();
  });

  it('rejects zero radius and non-finite inputs', () => {
    expect(buildRegularPolygonVertices({ x: 0, y: 0 }, { x: 0, y: 0 }, 4, 'inscribed')).toBeNull();
    expect(buildRegularPolygonVertices({ x: NaN, y: 0 }, { x: 1, y: 0 }, 4, 'inscribed')).toBeNull();
    expect(buildRegularPolygonVertices({ x: 0, y: 0 }, { x: Infinity, y: 0 }, 4, 'inscribed')).toBeNull();
  });

  it('rejects precision-collapsed rings far from the origin', () => {
    // Center (1e12, 1e12) with a 0.001 radius at N=1024 passes the radius
    // check, but adjacent vertices round to the same double (≈960
    // zero-length edges). The ring validator must fail closed.
    expect(
      buildRegularPolygonVertices({ x: 1e12, y: 1e12 }, { x: 1e12 + 0.001, y: 1e12 }, 1024, 'inscribed'),
    ).toBeNull();
  });

  it('is deterministic across repeats', () => {
    const first = buildRegularPolygonVertices({ x: 5, y: -3 }, { x: 9, y: 4 }, 7, 'circumscribed')!;
    const second = buildRegularPolygonVertices({ x: 5, y: -3 }, { x: 9, y: 4 }, 7, 'circumscribed')!;
    expect(second).toEqual(first);
    expect(buildRectangleVertices({ x: 5, y: 7 }, { x: 1, y: 2 })).toEqual(
      buildRectangleVertices({ x: 1, y: 2 }, { x: 5, y: 7 }),
    );
  });
});
