/** Phase B2 — Circle TTR / TTT tangent solvers (offsets + Apollonius). */
import { describe, expect, it } from 'vitest';

import {
  cadAngleDegFromCenter,
  cadDistance,
  type CadWorldPoint,
} from '../src/engine/cad/cadGeometry';
import { cadIsAngleOnArcSweep } from '../src/engine/cad/cadGeometryArcPrimitives';
import {
  resolveCadTangentSource,
  solveCadCircleTangentTangentRadius,
  solveCadCircleTangentTangentTangent,
  type CadTangentCircleCandidate,
  type CadTangentPrimitive,
  type CadTangentSource,
} from '../src/engine/cad/cadGeometryCircleTangentSolvers';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';

const point = (x: number, y: number): CadWorldPoint => ({ x, y });

const lineSource = (
  start: CadWorldPoint,
  end: CadWorldPoint,
  pickPoint: CadWorldPoint,
  entityId = 'line-1',
): CadTangentSource => ({
  primitive: { kind: 'line', entityId, segmentId: `${entityId}#0`, start, end },
  pickPoint,
});

const circleSource = (
  center: CadWorldPoint,
  radius: number,
  pickPoint: CadWorldPoint,
  entityId = 'circle-1',
): CadTangentSource => ({
  primitive: { kind: 'circle', entityId, center, radius },
  pickPoint,
});

const arcSource = (
  center: CadWorldPoint,
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
  pickPoint: CadWorldPoint,
  entityId = 'arc-1',
): CadTangentSource => ({
  primitive: { kind: 'arc', entityId, center, radius, startAngleDeg, endAngleDeg },
  pickPoint,
});

const distanceToInfiniteLine = (
  p: CadWorldPoint,
  primitive: Extract<CadTangentPrimitive, { kind: 'line' }>,
): number => {
  const dx = primitive.end.x - primitive.start.x;
  const dy = primitive.end.y - primitive.start.y;
  const length = Math.hypot(dx, dy);
  return Math.abs((-(dy) * (p.x - primitive.start.x) + dx * (p.y - primitive.start.y)) / length);
};

const sourceResidual = (
  source: CadTangentSource,
  candidate: CadTangentCircleCandidate,
): number => {
  const primitive = source.primitive;
  if (primitive.kind === 'line') {
    return Math.abs(distanceToInfiniteLine(candidate.center, primitive) - candidate.radius);
  }
  const centerDistance = cadDistance(candidate.center, primitive.center);
  return Math.min(
    Math.abs(centerDistance - (primitive.radius + candidate.radius)),
    Math.abs(centerDistance - Math.abs(primitive.radius - candidate.radius)),
  );
};

const expectCandidateResiduals = (
  sources: readonly CadTangentSource[],
  candidates: readonly CadTangentCircleCandidate[],
): void => {
  expect(candidates.length).toBeGreaterThan(0);
  for (const candidate of candidates) {
    expect(Number.isFinite(candidate.radius)).toBe(true);
    expect(candidate.radius).toBeGreaterThan(0);
    sources.forEach((source, index) => {
      expect(sourceResidual(source, candidate)).toBeLessThan(1e-9);
      const tangency = candidate.tangencyPoints[index]!;
      if (source.primitive.kind === 'arc') {
        expect(
          cadIsAngleOnArcSweep(
            cadAngleDegFromCenter(source.primitive.center, tangency),
            source.primitive.startAngleDeg,
            source.primitive.endAngleDeg,
          ),
        ).toBe(true);
      }
    });
  }
};

describe('TTR (Tan, Tan, Radius)', () => {
  it('picks the nearest of four line/line solutions by pick distance', () => {
    const first = lineSource(point(0, 0), point(100, 0), point(80, 0), 'a');
    const second = lineSource(point(0, 0), point(0, 100), point(0, 20), 'b');
    const result = solveCadCircleTangentTangentRadius(first, second, 10);
    expect(result.status).toBe('SOLVED');
    expect(result.center!.x).toBeCloseTo(10, 9);
    expect(result.center!.y).toBeCloseTo(10, 9);
    expect(result.radius).toBe(10);
    expectCandidateResiduals([first, second], result.candidates);
  });

  it('selects the same branch after a 1e12 world-coordinate translation', () => {
    const radius = 5;
    const sourceRadius = 10;
    const separation = 29.99;
    const offsetRadius = sourceRadius + radius;
    // Two nearly tangent offset circles: the ±branches are < 1 apart, so a
    // tolerance grown from absolute world coordinates would merge them.
    const branchOffset = Math.sqrt(offsetRadius ** 2 - (separation / 2) ** 2);
    const nearTangentPair = (
      offsetX: number,
    ): [CadTangentSource, CadTangentSource] => {
      const firstCenter = point(offsetX, 0);
      const secondCenter = point(offsetX + separation, 0);
      const selectedCenter = point(offsetX + separation / 2, -branchOffset);
      const ratio = sourceRadius / offsetRadius;
      const firstPick = point(
        firstCenter.x + (selectedCenter.x - firstCenter.x) * ratio,
        selectedCenter.y * ratio,
      );
      const secondPick = point(
        secondCenter.x + (selectedCenter.x - secondCenter.x) * ratio,
        selectedCenter.y * ratio,
      );
      return [
        circleSource(firstCenter, sourceRadius, firstPick, 'c1'),
        circleSource(secondCenter, sourceRadius, secondPick, 'c2'),
      ];
    };
    const [originFirst, originSecond] = nearTangentPair(0);
    const [offsetFirst, offsetSecond] = nearTangentPair(1e12);
    const originResult = solveCadCircleTangentTangentRadius(originFirst, originSecond, radius);
    const offsetResult = solveCadCircleTangentTangentRadius(offsetFirst, offsetSecond, radius);
    expect(originResult.status).toBe('SOLVED');
    expect(offsetResult.status).toBe('SOLVED');
    // Both branches survive selection in both frames...
    expect(originResult.candidates.length).toBe(2);
    expect(offsetResult.candidates.length).toBe(2);
    // ...and the pick-nearest (lower) branch is chosen in both.
    expect(originResult.center!.y).toBeLessThan(0);
    expect(offsetResult.center!.y).toBeLessThan(0);
    expect(offsetResult.center!.x - 1e12).toBeCloseTo(originResult.center!.x, 3);
    expect(offsetResult.center!.y).toBeCloseTo(originResult.center!.y, 3);
    expect(offsetResult.radius).toBeCloseTo(radius, 9);
  });

  it('line/circle: external tangency, radius fixed', () => {
    const line = lineSource(point(0, 0), point(100, 0), point(50, 0), 'l');
    const circle = circleSource(point(0, 12), 5, point(7, 5), 'c');
    const result = solveCadCircleTangentTangentRadius(line, circle, 5);
    expect(result.status).toBe('SOLVED');
    expect(result.center!.x).toBeCloseTo(Math.sqrt(51), 9);
    expect(result.center!.y).toBeCloseTo(5, 9);
    expectCandidateResiduals([line, circle], result.candidates);
  });

  it('circle/circle: external branch tangency', () => {
    const first = circleSource(point(0, 0), 10, point(-10, 0), 'c1');
    const second = circleSource(point(30, 0), 10, point(40, 0), 'c2');
    const result = solveCadCircleTangentTangentRadius(first, second, 5);
    expect(result.status).toBe('SOLVED');
    expect(result.center!.x).toBeCloseTo(15, 9);
    expect(result.center!.y).toBeCloseTo(0, 9);
    expect(result.radius).toBe(5);
    expectCandidateResiduals([first, second], result.candidates);
  });

  it('line/circle: internal branch (target inside the source circle)', () => {
    const line = lineSource(point(0, 0), point(100, 0), point(14, 0), 'l');
    const circle = circleSource(point(0, 0), 20, point(14, 5), 'c');
    const result = solveCadCircleTangentTangentRadius(line, circle, 5);
    expect(result.status).toBe('SOLVED');
    expect(result.center!.x).toBeCloseTo(Math.sqrt(200), 9);
    expect(result.center!.y).toBeCloseTo(5, 9);
    // Internal tangency: the target sits inside the source circle.
    expect(cadDistance(result.center!, point(0, 0))).toBeCloseTo(15, 9);
    expectCandidateResiduals([line, circle], result.candidates);
  });

  it('line tangency follows the FILLET/TANGENT_CURVE infinite-extension law', () => {
    // The tangency point (10,0) is beyond the finite segment end (5,0).
    const shortLine = lineSource(point(0, 0), point(5, 0), point(4, 0), 'a');
    const other = lineSource(point(0, 0), point(0, 100), point(0, 20), 'b');
    const result = solveCadCircleTangentTangentRadius(shortLine, other, 10);
    expect(result.status).toBe('SOLVED');
    expect(result.center!.x).toBeCloseTo(10, 9);
    expect(result.center!.y).toBeCloseTo(10, 9);
  });

  it('arc sweep membership filters off-sweep candidates (full circle -> arc)', () => {
    const line = lineSource(point(0, 0), point(100, 0), point(50, 0), 'l');
    const fullCircle = circleSource(point(0, 0), 10, point(14, 5), 'c');
    const arc = arcSource(point(0, 0), 10, 0, 90, point(14, 5), 'c');
    const circleResult = solveCadCircleTangentTangentRadius(line, fullCircle, 5);
    const arcResult = solveCadCircleTangentTangentRadius(line, arc, 5);
    expect(circleResult.status).toBe('SOLVED');
    expect(circleResult.candidates.length).toBeGreaterThan(arcResult.candidates.length);
    expect(arcResult.status).toBe('SOLVED');
    expectCandidateResiduals([line, arc], arcResult.candidates);
  });

  it('rejects zero, negative, and non-finite radius', () => {
    const first = lineSource(point(0, 0), point(100, 0), point(50, 0), 'a');
    const second = lineSource(point(0, 0), point(0, 100), point(0, 50), 'b');
    for (const radius of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(solveCadCircleTangentTangentRadius(first, second, radius).status).toBe('NO_SOLUTION');
    }
  });

  it('fails closed on duplicate sources and parallel lines', () => {
    const line = lineSource(point(0, 0), point(100, 0), point(50, 0), 'a');
    expect(solveCadCircleTangentTangentRadius(line, line, 10).status).toBe('NO_SOLUTION');
    const parallel = lineSource(point(0, 10), point(100, 10), point(50, 10), 'b');
    expect(solveCadCircleTangentTangentRadius(line, parallel, 5).status).toBe('NO_SOLUTION');
  });

  it('reports AMBIGUOUS on a symmetric score tie instead of guessing', () => {
    const line = lineSource(point(0, 0), point(100, 0), point(0, 0), 'l');
    const circle = circleSource(point(0, 12), 5, point(0, 5), 'c');
    const result = solveCadCircleTangentTangentRadius(line, circle, 5);
    expect(result.status).toBe('AMBIGUOUS');
    expect(result.center).toBeNull();
    expect(result.candidates.length).toBe(2);
    expect(result.candidates[0]!.score).toBeCloseTo(result.candidates[1]!.score, 9);
  });
});

describe('TTT (Tan, Tan, Tan)', () => {
  const triangleLines = (): [CadTangentSource, CadTangentSource, CadTangentSource] => [
    lineSource(point(0, 0), point(100, 0), point(80, 0), 'a'),
    lineSource(point(0, 0), point(0, 100), point(0, 80), 'b'),
    lineSource(point(100, 0), point(0, 100), point(60, 40), 'c'),
  ];

  it('all-line: returns incircle + three excircles and selects the incircle', () => {
    const [first, second, third] = triangleLines();
    const result = solveCadCircleTangentTangentTangent(first, second, third);
    expect(result.status).toBe('SOLVED');
    expect(result.candidates.length).toBe(4);
    const expectedRadius = (200 - 100 * Math.SQRT2) / 2;
    expect(result.radius).toBeCloseTo(expectedRadius, 6);
    expect(result.center!.x).toBeCloseTo(expectedRadius, 6);
    expect(result.center!.y).toBeCloseTo(expectedRadius, 6);
    expectCandidateResiduals([first, second, third], result.candidates);
  });

  it('all-line: candidate selection is permutation-invariant', () => {
    const [first, second, third] = triangleLines();
    const base = solveCadCircleTangentTangentTangent(first, second, third);
    const rotations = [
      solveCadCircleTangentTangentTangent(second, third, first),
      solveCadCircleTangentTangentTangent(third, first, second),
      solveCadCircleTangentTangentTangent(third, second, first),
    ];
    for (const rotated of rotations) {
      expect(rotated.status).toBe('SOLVED');
      expect(rotated.center!.x).toBeCloseTo(base.center!.x, 9);
      expect(rotated.center!.y).toBeCloseTo(base.center!.y, 9);
      expect(rotated.radius).toBeCloseTo(base.radius!, 9);
    }
  });

  it('line + two circles: selects the symmetric interstice circle', () => {
    const line = lineSource(point(0, 0), point(100, 0), point(0, 0), 'l');
    const first = circleSource(point(-15, 10), 10, point(-5.4, 7.2), 'c1');
    const second = circleSource(point(15, 10), 10, point(5.4, 7.2), 'c2');
    const result = solveCadCircleTangentTangentTangent(line, first, second);
    expect(result.status).toBe('SOLVED');
    expect(result.center!.x).toBeCloseTo(0, 9);
    expect(result.center!.y).toBeCloseTo(5.625, 9);
    expect(result.radius).toBeCloseTo(5.625, 9);
    expectCandidateResiduals([line, first, second], result.candidates);
  });

  it('two lines + one circle: selects the incircle between the axis lines', () => {
    const expectedRadius = (20 * Math.SQRT2 - 5) / (1 + Math.SQRT2);
    const center = point(expectedRadius, expectedRadius);
    const circleCenter = point(20, 20);
    const ratio = expectedRadius / (expectedRadius + 5);
    const lineH = lineSource(point(0, 0), point(100, 0), point(expectedRadius, 0), 'a');
    const lineV = lineSource(point(0, 0), point(0, 100), point(0, expectedRadius), 'b');
    const circle = circleSource(circleCenter, 5, {
      x: center.x + (circleCenter.x - center.x) * ratio,
      y: center.y + (circleCenter.y - center.y) * ratio,
    }, 'c');
    const result = solveCadCircleTangentTangentTangent(lineH, lineV, circle);
    expect(result.status).toBe('SOLVED');
    expect(result.center!.x).toBeCloseTo(expectedRadius, 6);
    expect(result.center!.y).toBeCloseTo(expectedRadius, 6);
    expect(result.radius).toBeCloseTo(expectedRadius, 6);
    expectCandidateResiduals([lineH, lineV, circle], result.candidates);
  });

  it('three circles: finds the Descartes incircle', () => {
    const expectedRadius = 1 / (0.3 + 0.2 * Math.sqrt(3));
    const expectedCenter = { x: 10, y: Math.sqrt((expectedRadius + 10) ** 2 - 100) };
    const ratio = expectedRadius / (expectedRadius + 10);
    const first = circleSource(point(0, 0), 10, {
      x: expectedCenter.x + (0 - expectedCenter.x) * ratio,
      y: expectedCenter.y + (0 - expectedCenter.y) * ratio,
    }, 'c1');
    const second = circleSource(point(20, 0), 10, {
      x: expectedCenter.x + (20 - expectedCenter.x) * ratio,
      y: expectedCenter.y + (0 - expectedCenter.y) * ratio,
    }, 'c2');
    const third = circleSource(point(10, 10 * Math.sqrt(3)), 10, {
      x: expectedCenter.x,
      y: expectedCenter.y + (10 * Math.sqrt(3) - expectedCenter.y) * ratio,
    }, 'c3');
    const result = solveCadCircleTangentTangentTangent(first, second, third);
    expect(result.status).toBe('SOLVED');
    expect(result.radius).toBeCloseTo(expectedRadius, 6);
    expect(result.center!.x).toBeCloseTo(expectedCenter.x, 6);
    expect(result.center!.y).toBeCloseTo(expectedCenter.y, 6);
    expectCandidateResiduals([first, second, third], result.candidates);
    // The same sign-triple quadratic also yields the enclosing Soddy circle
    // (R > r for every source). Both roots must survive the stable solver.
    const enclosingRadius = Math.abs(1 / (0.3 - 0.2 * Math.sqrt(3)));
    const enclosing = result.candidates.find(
      (candidate) => Math.abs(candidate.radius - enclosingRadius) < 1e-6,
    );
    expect(enclosing).toBeDefined();
    expect(enclosing!.center.x).toBeCloseTo(10, 6);
    expect(enclosing!.center.y).toBeCloseTo(expectedCenter.y, 6);
  });

  it('collinear circle centres: solves the rank-deficient Apollonius system', () => {
    // Radical axes of collinear centres only fix center-coordinate differences,
    // so the (x, y) determinant vanishes; the solver must parametrize in R/y
    // and close the system with the remaining circle equation.
    const expectedRadius = 5 / 6;
    const ratio = 10 / (10 + expectedRadius);
    const first = circleSource(point(-10, 0), 10, point(-10 + 10 * ratio, (25 / 6) * ratio), 'c1');
    const second = circleSource(point(0, 0), 5, point(0, 5), 'c2');
    const third = circleSource(point(10, 0), 10, point(10 - 10 * ratio, (25 / 6) * ratio), 'c3');
    const result = solveCadCircleTangentTangentTangent(first, second, third);
    expect(result.status).toBe('SOLVED');
    expect(result.radius).toBeCloseTo(expectedRadius, 9);
    expect(result.center!.x).toBeCloseTo(0, 9);
    expect(result.center!.y).toBeCloseTo(25 / 6, 9);
    expectCandidateResiduals([first, second, third], result.candidates);
  });

  it('reports NO_SOLUTION for degenerate/underdetermined triples', () => {
    const first = circleSource(point(0, 0), 10, point(10, 0), 'c1');
    const second = circleSource(point(0, 0), 20, point(20, 0), 'c2');
    const third = circleSource(point(0, 0), 30, point(30, 0), 'c3');
    expect(solveCadCircleTangentTangentTangent(first, second, third).status).toBe('NO_SOLUTION');
    const line = lineSource(point(0, 0), point(100, 0), point(50, 0), 'l');
    expect(solveCadCircleTangentTangentTangent(line, line, first).status).toBe('NO_SOLUTION');
  });

  it('three-parallel-lines has no finite Apollonius circle', () => {
    const first = lineSource(point(0, 0), point(100, 0), point(50, 0), 'a');
    const second = lineSource(point(0, 10), point(100, 10), point(50, 10), 'b');
    const third = lineSource(point(0, 20), point(100, 20), point(50, 20), 'c');
    const result = solveCadCircleTangentTangentTangent(first, second, third);
    // The only circle tangent to three parallel lines would have infinite
    // radius; the solver must not fabricate one.
    expect(result.status).toBe('NO_SOLUTION');
  });
});

describe('resolveCadTangentSource', () => {
  it('resolves lines, circles, arcs, and the picked polyline segment', () => {
    const project = createBlankCadProject({ name: 'tangent', units: 'm' });
    project.entities = [
      { id: 'l1', type: 'line', layerId: project.layers[0]!.id, visible: true, locked: false, fromStationId: 'A', toStationId: 'B', fromX: 0, fromY: 0, toX: 10, toY: 0, sourceObservationIds: [] },
      { id: 'c1', type: 'circle', layerId: project.layers[0]!.id, visible: true, locked: false, centerX: 4, centerY: 4, radius: 2 },
      { id: 'a1', type: 'arc', layerId: project.layers[0]!.id, visible: true, locked: false, centerX: 0, centerY: 0, radius: 5, startAngleDeg: 0, endAngleDeg: 90 },
      { id: 'p1', type: 'polyline', layerId: project.layers[0]!.id, visible: true, locked: false, vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], vertexLabels: ['', '', ''], closed: false },
    ] as never;
    expect(resolveCadTangentSource(project, 'l1', point(5, 0))!.primitive.kind).toBe('line');
    expect(resolveCadTangentSource(project, 'c1', point(6, 4))!.primitive.kind).toBe('circle');
    expect(resolveCadTangentSource(project, 'a1', point(3.5, 3.5))!.primitive.kind).toBe('arc');
    const polyline = resolveCadTangentSource(project, 'p1', point(10, 5), 'p1#1');
    expect(polyline!.primitive.kind).toBe('line');
    expect(polyline!.primitive).toMatchObject({ segmentId: 'p1#1', start: { x: 10, y: 0 }, end: { x: 10, y: 10 } });
    expect(resolveCadTangentSource(project, 'missing', point(0, 0))).toBeNull();
  });
});
