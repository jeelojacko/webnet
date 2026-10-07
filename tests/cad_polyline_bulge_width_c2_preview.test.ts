import { describe, expect, it } from 'vitest';
import { cadBuildArcFromThreePoints } from '../src/engine/cad/cadGeometry';
import { cadDistance } from '../src/engine/cad/cadGeometry';
import { buildCommandPreview } from '../src/hooks/surveyCad/useSurveyCadCommandPreview';
import type { CadDisplayPrimitive } from '../src/engine/cad/cadTypes';
import type { PlineCommandSession } from '../src/hooks/surveyCad/useSurveyCadPlineSession';

const session = (over: Partial<PlineCommandSession> = {}): PlineCommandSession => ({
  key: 'PLINE',
  inputValue: '',
  points: [],
  plineDrawMode: 'line',
  plineArcThrough: null,
  plineWidthPhase: false,
  plineDefaultWidth: { startWidth: 0, endWidth: 0 },
  ...over,
});

const A = { x: 0, y: 0, label: 'A' };
const B = { x: 10, y: 0, label: 'B' };
const cursor = { x: 10, y: 10, label: 'CUR' };

const preview = (
  live: PlineCommandSession,
  point: { x: number; y: number; label: string } = cursor,
) => buildCommandPreview({ session: live, previewPoint: point, reverseDirectionModifier: false });

const primitivesOf = (
  live: PlineCommandSession,
  point: { x: number; y: number; label: string } = cursor,
) => {
  const state = preview(live, point);
  expect(state?.kind).toBe('primitives');
  if (state?.kind !== 'primitives') throw new Error('expected primitives preview');
  return state.primitives;
};

const arcsOf = (primitives: CadDisplayPrimitive[]) =>
  primitives.filter((primitive): primitive is Extract<CadDisplayPrimitive, { kind: 'arc' }> => primitive.kind === 'arc');

describe('C2 preview: arc legs render true 3-point arcs, never fabricated chords', () => {
  it('arc mode before the through-point shows courses plus the cursor point only', () => {
    const primitives = primitivesOf(session({ points: [A], plineDrawMode: 'arc' }));
    expect(arcsOf(primitives)).toHaveLength(0);
    const cursorPoint = primitives.find(
      (primitive) => primitive.kind === 'point' && primitive.id === 'preview:pline:cursor',
    );
    expect(cursorPoint).toBeDefined();
    // No leg from the arc start toward the cursor (that chord is not the arc).
    const strayLeg = primitives.find(
      (primitive) =>
        primitive.kind === 'line' &&
        primitive.points.some((end) => end.x === cursor.x && end.y === cursor.y),
    );
    expect(strayLeg).toBeUndefined();
  });

  it('arc mode after the through-point previews the TRUE circular arc to the cursor', () => {
    const through = { x: 5, y: -2, label: 'T' };
    const primitives = primitivesOf(
      session({ points: [A], plineDrawMode: 'arc', plineArcThrough: through }),
    );
    const arcs = arcsOf(primitives);
    expect(arcs).toHaveLength(1);
    const expected = cadBuildArcFromThreePoints(A, through, cursor)!;
    expect(expected).not.toBeNull();
    expect(arcs[0]!.center.x).toBeCloseTo(expected.center.x, 9);
    expect(arcs[0]!.center.y).toBeCloseTo(expected.center.y, 9);
    expect(arcs[0]!.radius).toBeCloseTo(expected.radius, 9);
    // The previewed circle passes through all three defining points.
    for (const point of [A, through, cursor]) {
      expect(cadDistance(arcs[0]!.center, point)).toBeCloseTo(arcs[0]!.radius, 6);
    }
  });

  it('a degenerate (collinear) pending triple fails closed to the cursor point', () => {
    const through = { x: 5, y: 5, label: 'T' };
    const collinearCursor = { x: 10, y: 10, label: 'CUR' };
    expect(cadBuildArcFromThreePoints(A, through, collinearCursor)).toBeNull();
    const retry = buildCommandPreview({
      session: session({ points: [A], plineDrawMode: 'arc', plineArcThrough: through }),
      previewPoint: collinearCursor,
      reverseDirectionModifier: false,
    });
    expect(retry?.kind).toBe('primitives');
    if (retry?.kind !== 'primitives') throw new Error('expected primitives preview');
    expect(arcsOf(retry.primitives)).toHaveLength(0);
    expect(
      retry.primitives.some(
        (primitive) => primitive.kind === 'point' && primitive.id === 'preview:pline:cursor',
      ),
    ).toBe(true);
  });

  it('completed arc courses render natively from their stored bulges', () => {
    const primitives = primitivesOf(
      session({
        points: [A, B],
        plineDrawMode: 'arc',
        plineSegmentGeometry: [{ kind: 'arc', bulge: 1 }],
        plineSegmentWidths: [{ startWidth: 0, endWidth: 0 }],
      }),
    );
    const arcs = arcsOf(primitives);
    expect(arcs.length).toBeGreaterThanOrEqual(1);
    const stored = arcs[0]!;
    expect(stored.radius).toBeCloseTo(5, 9);
    expect(stored.center.x).toBeCloseTo(5, 9);
    expect(stored.center.y).toBeCloseTo(0, 9);
  });

  it('emits no implied closure segment back to the first vertex', () => {
    const live = session({ points: [A, B], plineDrawMode: 'line' });
    const state = preview(live);
    expect(state?.kind).toBe('polyline');
    if (state?.kind !== 'polyline') throw new Error('expected polyline preview');
    expect(state.points[state.points.length - 1]).toEqual({ x: cursor.x, y: cursor.y });
  });
});

describe('C2 preview: widths render as model-space edge guides with taper', () => {
  it('a constant default width offsets both edges of the live line leg by half width', () => {
    const primitives = primitivesOf(
      session({ points: [A], plineDefaultWidth: { startWidth: 2, endWidth: 2 } }),
    );
    const edges = primitives.filter(
      (primitive) => primitive.kind === 'line' && primitive.id.startsWith('preview:pline:pending:edge'),
    );
    expect(edges).toHaveLength(2);
    const ys = edges.flatMap((primitive) =>
      primitive.kind === 'line' ? primitive.points.map((end) => end.y) : [],
    );
    // Leg A(0,0)->cursor(10,10) has normal (-1,1)/√2; half width 1 shifts
    // the start vertex to ±(0.7071). Assert symmetry instead of direction.
    expect(ys).toHaveLength(4);
    const startYs = [ys[0]!, ys[2]!].sort((a, b) => a - b);
    expect(startYs[0]).toBeCloseTo(-Math.SQRT1_2, 6);
    expect(startYs[1]).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('a tapered default width converges along the leg (model-space taper proof)', () => {
    const primitives = primitivesOf(
      session({ points: [A], plineDefaultWidth: { startWidth: 0, endWidth: 4 } }),
    );
    const edges = primitives.filter(
      (primitive) => primitive.kind === 'line' && primitive.id.startsWith('preview:pline:pending:edge'),
    );
    expect(edges).toHaveLength(2);
    for (const edge of edges) {
      if (edge.kind !== 'line') throw new Error('expected line edge');
      // Zero start width: both edges leave the start vertex exactly.
      expect(edge.points[0]!.x).toBeCloseTo(0, 9);
      expect(edge.points[0]!.y).toBeCloseTo(0, 9);
      // End width 4: each edge ends 2 m off the cursor along the normal.
      const off = Math.hypot(edge.points[1]!.x - cursor.x, edge.points[1]!.y - cursor.y);
      expect(off).toBeCloseTo(2, 9);
    }
  });

  it('completed line courses carry their stored widths, not the live default', () => {
    const primitives = primitivesOf(
      session({
        points: [A, B],
        plineSegmentGeometry: [{ kind: 'line' }],
        plineSegmentWidths: [{ startWidth: 1, endWidth: 3 }],
        plineDefaultWidth: { startWidth: 0, endWidth: 0 },
      }),
    );
    const edges = primitives.filter(
      (primitive) => primitive.kind === 'line' && primitive.id.startsWith('preview:pline:1:edge'),
    );
    expect(edges).toHaveLength(2);
    for (const edge of edges) {
      if (edge.kind !== 'line') throw new Error('expected line edge');
      const startOff = Math.hypot(edge.points[0]!.x - A.x, edge.points[0]!.y - A.y);
      const endOff = Math.hypot(edge.points[1]!.x - B.x, edge.points[1]!.y - B.y);
      expect(startOff).toBeCloseTo(0.5, 9);
      expect(endOff).toBeCloseTo(1.5, 9);
    }
    // The live leg has a zero default: no pending edges.
    expect(
      primitives.some(
        (primitive) => primitive.kind === 'line' && primitive.id.startsWith('preview:pline:pending:edge'),
      ),
    ).toBe(false);
  });

  it('keeps taper ownership in draft order for a CW arc leg', () => {
    // The three-point builder reverses this CW leg (cursor becomes the
    // builder start). The draft start A owns startWidth=0 and the cursor
    // owns endWidth=4, so the guides must follow draft start→end order.
    const through = { x: 5, y: 2, label: 'T' };
    const end = { x: 10, y: 0, label: 'CW' };
    const pendingArc = cadBuildArcFromThreePoints(A, through, end)!;
    expect(Math.hypot(pendingArc.startPoint.x - A.x, pendingArc.startPoint.y - A.y)).toBeGreaterThan(1e-6);
    const primitives = primitivesOf(
      session({
        points: [A],
        plineDrawMode: 'arc',
        plineArcThrough: through,
        plineDefaultWidth: { startWidth: 0, endWidth: 4 },
      }),
      end,
    );
    const edgePoints = primitives
      .filter((primitive) => primitive.kind === 'line' && primitive.id.startsWith('preview:pline:pending:edge'))
      .flatMap((primitive) => (primitive.kind === 'line' ? primitive.points : []));
    expect(edgePoints.length).toBeGreaterThan(0);
    const edgePrimitives = primitives.filter(
      (primitive): primitive is Extract<CadDisplayPrimitive, { kind: 'line' }> =>
        primitive.kind === 'line' && primitive.id.startsWith('preview:pline:pending:edge'),
    );
    // Fraction 0 lives on each side's first tessellation segment, fraction 1
    // on each side's last.
    const startPoints = edgePrimitives
      .filter((primitive) => primitive.id.endsWith(':1'))
      .map((primitive) => primitive.points[0]!);
    const endPoints = edgePrimitives
      .filter((primitive) => primitive.id.endsWith(':24'))
      .map((primitive) => primitive.points[1]!);
    expect(startPoints).toHaveLength(2);
    expect(endPoints).toHaveLength(2);
    // startWidth=0 → both edges leave A exactly; endWidth=4 → the cursor
    // ends sit 2 m off. Reversed ownership would land startWidth at the end.
    for (const point of startPoints) expect(cadDistance(point, A)).toBeCloseTo(0, 9);
    for (const point of endPoints) expect(cadDistance(point, end)).toBeCloseTo(2, 9);
  });
});
