// Phase 20A — feature-line geometry integration (bounds / hit-box / snaps /
// inquiry / plan render). Pure engine paths only.
import { describe, expect, it } from 'vitest';

import { buildCadBounds, appendCadProjectEntities } from '../src/engine/cad/cadProjectState';
import { entityIntersectsBounds } from '../src/engine/cad/cadSpatialBounds';
import { buildCadSpatialIndex } from '../src/engine/cad/cadSpatialIndex';
import { buildCadDisplayScene } from '../src/engine/cad/cadRenderer';
import { describeParcelArcCourse } from '../src/engine/cad/cadParcelArcGeometry';
import { resolveCadFeatureLine } from '../src/engine/cad/cadFeatureLines';
import { buildFeatureLineInquiry } from '../src/engine/cad/cadFeatureLineInquiry';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import type { CadFeatureLineEntity, CadProject } from '../src/engine/cad/cadTypes';

let seq = 0;
const featureLine = (
  vertices: Array<{ x: number; y: number; z: number }>,
  segmentGeometry?: CadFeatureLineEntity['segmentGeometry'],
  closed = false,
): CadFeatureLineEntity => {
  seq += 1;
  const id = `fl-geom-${seq}`;
  return {
    id,
    type: 'feature-line',
    layerId: 'general',
    visible: true,
    locked: false,
    name: `Feature Line ${seq}`,
    vertices: vertices.map((vertex, index) => ({ id: `${id}-v${index}`, ...vertex })),
    ...(segmentGeometry ? { segmentGeometry: segmentGeometry.map((entry) => ({ ...entry })) } : {}),
    ...(closed ? { closed } : {}),
  };
};

const projectWith = (entities: CadFeatureLineEntity[]): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'FL Geometry', units: 'm' });
  return appendCadProjectEntities(drawing.project, entities);
};

const QUARTER = Math.tan(Math.PI / 8);

describe('phase 20A feature-line geometry', () => {
  it('plan bounds include arc-course extrema outside the chord box', () => {
    const entity = featureLine(
      [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
      ],
      [{ kind: 'arc', bulge: QUARTER }],
    );
    const resolved = resolveCadFeatureLine(entity)!;
    const course = resolved.courses[0]!;
    const bounds = buildCadBounds([entity], undefined)!;
    const metrics = describeParcelArcCourse(course.from, course.to, QUARTER)!;
    // The true arc midpoint is an extremum outside the chord box (y != 0).
    expect(bounds.maxX - bounds.minX).toBeGreaterThan(10 - 1e-9);
    expect(Math.abs(metrics.midpoint.y)).toBeGreaterThan(1);
    const reaches = entityIntersectsBounds(
      projectWith([entity]),
      entity,
      {
        minX: metrics.midpoint.x - 0.5,
        minY: metrics.midpoint.y - 0.5,
        maxX: metrics.midpoint.x + 0.5,
        maxY: metrics.midpoint.y + 0.5,
      },
    );
    expect(reaches).toBe(true);
    const misses = entityIntersectsBounds(
      projectWith([entity]),
      entity,
      {
        minX: 100,
        minY: 100,
        maxX: 110,
        maxY: 110,
      },
    );
    expect(misses).toBe(false);
  });

  it('snaps resolve endpoint/midpoint/nearest on line courses', () => {
    const entity = featureLine([
      { x: 0, y: 0, z: 0 },
      { x: 100, y: 0, z: 0 },
      { x: 100, y: 100, z: 0 },
    ]);
    const index = buildCadSpatialIndex(projectWith([entity]));
    expect(index.queryNearestSnap({ x: 0.2, y: 0.2 }, 2, ['endpoint'])?.kind).toBe('endpoint');
    const mid = index.queryNearestSnap({ x: 50.1, y: 0.2 }, 2, ['midpoint']);
    expect(mid?.kind).toBe('midpoint');
    expect(mid?.x).toBeCloseTo(50, 9);
    const near = index.queryNearestSnap({ x: 51, y: 1.2 }, 3, ['nearest']);
    expect(near?.kind).toBe('nearest');
    expect(near?.y).toBeCloseTo(0, 9);
  });

  it('snaps resolve center/arc-midpoint/quadrant on arc courses', () => {
    const entity = featureLine(
      [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
      ],
      [{ kind: 'arc', bulge: QUARTER }],
    );
    const course = resolveCadFeatureLine(entity)!.courses[0]!;
    const index = buildCadSpatialIndex(projectWith([entity]));
    const center = index.queryNearestSnap(
      { x: course.center!.x + 0.1, y: course.center!.y },
      2,
      ['center'],
    );
    expect(center?.kind).toBe('center');
    const arcMid = index.queryNearestSnap(
      { x: course.midpoint!.x + 0.1, y: course.midpoint!.y },
      2,
      ['arc-midpoint'],
    );
    expect(arcMid?.kind).toBe('arc-midpoint');
  });

  it('plan intersections between feature lines participate in snapping', () => {
    const horizontal = featureLine([
      { x: 0, y: 5, z: 0 },
      { x: 10, y: 5, z: 0 },
    ]);
    const vertical = featureLine([
      { x: 5, y: 0, z: 0 },
      { x: 5, y: 10, z: 0 },
    ]);
    const index = buildCadSpatialIndex(projectWith([horizontal, vertical]));
    const hit = index.queryNearestSnap({ x: 5.1, y: 5.1 }, 2, ['intersection']);
    expect(hit?.kind).toBe('intersection');
    expect(hit?.x).toBeCloseTo(5, 9);
    expect(hit?.y).toBeCloseTo(5, 9);
  });

  it('renders plan courses as native line/arc primitives', () => {
    const entity = featureLine([
      { x: 0, y: 0, z: 10 },
      { x: 10, y: 0, z: 12 },
    ]);
    const arcEntity = featureLine(
      [
        { x: 0, y: 0, z: 10 },
        { x: 10, y: 0, z: 12 },
      ],
      [{ kind: 'arc', bulge: QUARTER }],
    );
    const scene = buildCadDisplayScene(projectWith([entity, arcEntity]));
    const linePrimitives = scene.primitives.filter((primitive) => primitive.sourceEntityId === entity.id);
    expect(linePrimitives.every((primitive) => primitive.kind === 'line')).toBe(true);
    const arcPrimitives = scene.primitives.filter((primitive) => primitive.sourceEntityId === arcEntity.id);
    expect(arcPrimitives).toHaveLength(1);
    expect(arcPrimitives[0]!.kind).toBe('arc');
  });

  it('inquiry reuses the resolver for length/grade/slope/bearing and curve metrics', () => {
    const straight = featureLine([
      { x: 0, y: 0, z: 100 },
      { x: 100, y: 0, z: 102 },
    ]);
    const straightInquiry = buildFeatureLineInquiry(straight)!;
    expect(straightInquiry.planLength).toBeCloseTo(100, 9);
    expect(straightInquiry.length3D).toBeCloseTo(Math.sqrt(10004), 9);
    expect(straightInquiry.gradePercent).toBeCloseTo(2, 9);
    expect(straightInquiry.slopeAngleDeg).toBeCloseTo((Math.atan(0.02) * 180) / Math.PI, 9);
    expect(straightInquiry.bearingText.startsWith('N')).toBe(true);
    expect(straightInquiry.curve).toBeNull();

    const curved = featureLine(
      [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 10 },
      ],
      [{ kind: 'arc', bulge: QUARTER }],
    );
    const curvedInquiry = buildFeatureLineInquiry(curved)!;
    expect(curvedInquiry.curve).not.toBeNull();
    expect(curvedInquiry.curve!.arcLength).toBeGreaterThan(10);
    expect(curvedInquiry.curve!.chordLength).toBeCloseTo(10, 9);
  });
});
