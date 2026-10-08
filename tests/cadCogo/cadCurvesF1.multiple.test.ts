import { describe, expect, it } from 'vitest';
import {
  buildCadCurveChain,
  cadDistance,
  cadEqualChordDistance,
  cadEqualChordStepDeg,
  cadNormalizeAngleDeg,
  cadSignedSweepDeg,
  resolveTwoTangentRays,
  type CadArcDefinition,
  type CadCurveChainSegmentInput,
  type CadWorldPoint,
} from '../../src/engine/cad/cadGeometry';

const eastLine = { entityId: 'a', start: { x: -300, y: 0 }, end: { x: 300, y: 0 } };
const northLine = { entityId: 'b', start: { x: 0, y: -300 }, end: { x: 0, y: 300 } };

const rightAngle = () =>
  resolveTwoTangentRays(eastLine, northLine, { x: 80, y: 0 }, { x: 0, y: 80 })!;

const arcTangentAzimuth = (arc: CadArcDefinition, atEnd: boolean): number => {
  const point = atEnd ? arc.endPoint : arc.startPoint;
  const radial = { x: point.x - arc.center.x, y: point.y - arc.center.y };
  const sweep = cadSignedSweepDeg(arc.startAngleDeg, arc.endAngleDeg);
  const tangent = sweep >= 0 ? { x: -radial.y, y: radial.x } : { x: radial.y, y: -radial.x };
  return cadNormalizeAngleDeg((Math.atan2(tangent.x, tangent.y) * 180) / Math.PI);
};

const angleBetween = (a: number, b: number): number => {
  const diff = Math.abs(cadNormalizeAngleDeg(a) - cadNormalizeAngleDeg(b));
  return Math.min(diff, 360 - diff);
};

const pointOnRay = (origin: CadWorldPoint, direction: CadWorldPoint, point: CadWorldPoint): number =>
  (point.x - origin.x) * direction.x + (point.y - origin.y) * direction.y;

describe('CAD Curves F1 multiple-curve chain', () => {
  const cases: Array<{ label: string; specs: CadCurveChainSegmentInput[] }> = [
    {
      label: 'two arcs floating last',
      specs: [
        { radius: 40, length: 20 },
        { radius: 70, length: 0, floating: true },
      ],
    },
    {
      label: 'three arcs floating middle',
      specs: [
        { radius: 40, length: 20 },
        { radius: 70, length: 0, floating: true },
        { radius: 90, length: 10 },
      ],
    },
    {
      label: 'three arcs floating first',
      specs: [
        { radius: 40, length: 0, floating: true },
        { radius: 70, length: 20 },
        { radius: 90, length: 10 },
      ],
    },
    {
      label: 'ten arcs floating middle',
      specs: Array.from({ length: 10 }, (_, index) =>
        index === 4
          ? { radius: 80, length: 0, floating: true }
          : { radius: 60, length: 5 },
      ),
    },
  ];

  it.each(cases)('solves $label with exact sweeps and G1 joins', ({ specs }) => {
    const rays = rightAngle();
    const outcome = buildCadCurveChain(rays, specs);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const { arcs, rows } = outcome.result;
    expect(arcs).toHaveLength(specs.length);
    expect(rows).toHaveLength(specs.length);

    const deltaSum = rows.reduce((sum, row) => sum + row.deltaDeg, 0);
    expect(deltaSum).toBeCloseTo(rays.deltaDeg, 6);
    expect(rows.filter((row) => row.floating)).toHaveLength(1);

    for (let index = 0; index < arcs.length; index += 1) {
      const row = rows[index]!;
      const radius = specs[index]!.radius;
      const deltaRad = (row.deltaDeg * Math.PI) / 180;
      expect(row.arcLength).toBeCloseTo(radius * deltaRad, 6);
      expect(row.radius).toBeCloseTo(radius, 9);
      expect(arcs[index]!.deltaDeg).toBeCloseTo(row.deltaDeg, 9);
      if (index > 0) {
        expect(cadDistance(arcs[index - 1]!.endPoint, arcs[index]!.startPoint)).toBeLessThan(1e-9);
        expect(
          angleBetween(arcTangentAzimuth(arcs[index - 1]!, true), arcTangentAzimuth(arcs[index]!, false)),
        ).toBeLessThan(1e-6);
      }
    }

    const floatingRow = rows.find((row) => row.floating)!;
    const floatingSpec = specs[floatingRow.index]!;
    expect(floatingRow.arcLength).toBeCloseTo(
      floatingSpec.radius * ((floatingRow.deltaDeg * Math.PI) / 180),
      6,
    );

    // Terminal tangent is exactly the second ray; PC/PT sit on the selected rays.
    const last = arcs[arcs.length - 1]!;
    expect(angleBetween(arcTangentAzimuth(last, true), 0)).toBeLessThan(1e-6);
    expect(pointOnRay(rays.pi, rays.ray1.direction, outcome.result.pc)).toBeGreaterThan(0);
    expect(pointOnRay(rays.pi, rays.ray2.direction, outcome.result.pt)).toBeGreaterThan(0);
  });

  it('rejects structurally invalid chains', () => {
    const rays = rightAngle();
    const failureCode = (outcome: ReturnType<typeof buildCadCurveChain>): string | null =>
      outcome.ok ? null : outcome.code;
    expect(buildCadCurveChain(rays, [{ radius: 10, length: 5 }]).ok).toBe(false);
    expect(
      buildCadCurveChain(
        rays,
        Array.from({ length: 11 }, () => ({ radius: 10, length: 1 })),
      ).ok,
    ).toBe(false);
    expect(
      failureCode(
        buildCadCurveChain(rays, [
          { radius: 10, length: 1 },
          { radius: 10, length: 1 },
        ]),
      ),
    ).toBe('INVALID_CHAIN');
    expect(
      failureCode(
        buildCadCurveChain(rays, [
          { radius: 10, length: 1, floating: true },
          { radius: 10, length: 1, floating: true },
        ]),
      ),
    ).toBe('INVALID_CHAIN');
    expect(
      failureCode(
        buildCadCurveChain(rays, [
          { radius: 0, length: 1 },
          { radius: 10, length: 0, floating: true },
        ]),
      ),
    ).toBe('INVALID_CHAIN');
    expect(
      failureCode(
        buildCadCurveChain(rays, [
          { radius: 10, length: -5 },
          { radius: 10, length: 0, floating: true },
        ]),
      ),
    ).toBe('INVALID_CHAIN');
  });

  it('rejects an impossible residual that cannot fit below the delta cap', () => {
    const rays = rightAngle();
    const ninetyDegLength = 10 * ((150 * Math.PI) / 180);
    const outcome = buildCadCurveChain(rays, [
      { radius: 10, length: ninetyDegLength },
      { radius: 10, length: ninetyDegLength },
      { radius: 60, length: 0, floating: true },
    ]);
    expect(outcome).toEqual({ ok: false, code: 'CURVES_CANNOT_FIT' });
  });

  it('pins the equal-chord spacing law (SUBDIVIDE oracle)', () => {
    const radius = 100;
    const chord = 20;
    const expectedStep = (2 * Math.asin(chord / (2 * radius)) * 180) / Math.PI;
    expect(cadEqualChordStepDeg(radius, chord)).toBeCloseTo(expectedStep, 12);

    const startAngleDeg = 15;
    const points = Array.from({ length: 5 }, (_, index) => {
      const angle = ((startAngleDeg + expectedStep * index) * Math.PI) / 180;
      return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    });
    for (let index = 0; index < points.length - 1; index += 1) {
      expect(cadDistance(points[index]!, points[index + 1]!)).toBeCloseTo(chord, 9);
    }
    expect(cadEqualChordDistance(radius, { x: 0, y: 0 }, startAngleDeg, chord, 4)).toBeCloseTo(
      chord,
      9,
    );
    // A larger chord than the diameter is rejected (no coercion).
    expect(cadEqualChordStepDeg(radius, 200)).toBeNull();
  });
});
