// Phase 20A CORE — 3D feature-line oracles (§§85-95).
import { describe, expect, it } from 'vitest';
import {
  copyFeatureLineEntity,
  deleteFeatureLineVertex,
  insertFeatureLineVertex,
  interpolateFeatureLineSpan,
  raiseLowerFeatureLine,
  reverseFeatureLine,
  setFeatureLineGradeSpan,
} from '../src/engine/cad/cadFeatureLineEdits';
import {
  getFeatureLineElevationAtStation,
  getFeatureLinePointAtStation,
  resolveCadFeatureLine,
  sanitizeFeatureLine,
} from '../src/engine/cad/cadFeatureLines';
import {
  classifyTransform,
  reflectionAboutLine,
  rotationAbout,
  translation,
  uniformScaleAbout,
} from '../src/engine/cad/cadTransform2D';
import { transformCadEntityGeometry } from '../src/engine/cad/cadTransformGeometry';
import type { CadFeatureLineEntity } from '../src/engine/cad/cadTypes';

let seq = 0;
const makeLine = (
  vertices: Array<{ x: number; y: number; z: number }>,
  segmentGeometry?: CadFeatureLineEntity['segmentGeometry'],
  closed = false,
): CadFeatureLineEntity => {
  seq += 1;
  const id = `fl-20a-t${seq}`;
  return {
    id,
    type: 'feature-line',
    layerId: 'general',
    visible: true,
    locked: false,
    vertices: vertices.map((vertex, index) => ({
      id: `feature-vertex:${id}:v${index + 1}`,
      ...vertex,
    })),
    ...(segmentGeometry != null ? { segmentGeometry: segmentGeometry.map((entry) => ({ ...entry })) } : {}),
    ...(closed ? { closed } : {}),
  };
};

const QUARTER_BULGE = Math.tan(Math.PI / 8); // 90° CCW
const MAJOR_BULGE = Math.tan((3 * Math.PI) / 8); // 270° CCW

describe('phase 20A feature-line oracles', () => {
  it('straight grade: 100m 100->102, +2%, 3D=sqrt(10004), mid 50/101', () => {
    const entity = makeLine([
      { x: 0, y: 0, z: 100 },
      { x: 100, y: 0, z: 102 },
    ]);
    const resolved = resolveCadFeatureLine(entity)!;
    expect(resolved).not.toBeNull();
    expect(resolved.courses).toHaveLength(1);
    const course = resolved.courses[0]!;
    expect(course.kind).toBe('line');
    expect(course.planLength).toBeCloseTo(100, 9);
    expect(course.gradeRatio).toBeCloseTo(0.02, 12);
    expect(course.gradePercent).toBeCloseTo(2, 12);
    expect(course.length3D).toBeCloseTo(Math.sqrt(10004), 9);
    expect(resolved.planLength).toBeCloseTo(100, 9);
    expect(resolved.length3D).toBeCloseTo(Math.sqrt(10004), 9);
    expect(getFeatureLineElevationAtStation(entity, 50)).toBeCloseTo(101, 9);
    const mid = getFeatureLinePointAtStation(entity, 50)!;
    expect(mid.x).toBeCloseTo(50, 9);
    expect(mid.y).toBeCloseTo(0, 9);
    expect(mid.z).toBeCloseTo(101, 9);
    expect(mid.courseIndex).toBe(0);
    expect(mid.localFraction).toBeCloseTo(0.5, 12);
    expect(mid.gradeRatio).toBeCloseTo(0.02, 12);
  });

  it('negative grade + reverse flips stations and grades', () => {
    const entity = makeLine([
      { x: 0, y: 0, z: 102 },
      { x: 100, y: 0, z: 100 },
    ]);
    const resolved = resolveCadFeatureLine(entity)!;
    expect(resolved.courses[0]!.gradeRatio).toBeCloseTo(-0.02, 12);
    const reversed = reverseFeatureLine(entity);
    const reversedResolved = resolveCadFeatureLine(reversed)!;
    expect(reversedResolved.courses[0]!.gradeRatio).toBeCloseTo(0.02, 12);
    expect(reversed.vertices[0]!.z).toBe(100);
    expect(reversed.vertices[1]!.z).toBe(102);
    // Same path: reversed station s == original station (total - s).
    const a = getFeatureLinePointAtStation(reversed, 25)!;
    const b = getFeatureLinePointAtStation(entity, 75)!;
    expect(a.x).toBeCloseTo(b.x, 9);
    expect(a.y).toBeCloseTo(b.y, 9);
    expect(a.z).toBeCloseTo(b.z, 9);
  });

  it('quarter-arc R100 90deg: plan=50pi, mid-arc true circle', () => {
    const entity = makeLine(
      [
        { x: 100, y: 0, z: 100 },
        { x: 0, y: 100, z: 102 },
      ],
      [{ kind: 'arc', bulge: QUARTER_BULGE }],
    );
    const resolved = resolveCadFeatureLine(entity)!;
    expect(resolved.courses[0]!.kind).toBe('arc');
    expect(resolved.planLength).toBeCloseTo(50 * Math.PI, 6);
    expect(resolved.courses[0]!.radius).toBeCloseTo(100, 6);
    expect(resolved.courses[0]!.signedSweepDeg).toBeCloseTo(90, 9);
    expect(resolved.courses[0]!.center!.x).toBeCloseTo(0, 6);
    expect(resolved.courses[0]!.center!.y).toBeCloseTo(0, 6);
    const midStation = 25 * Math.PI;
    const mid = getFeatureLinePointAtStation(entity, midStation)!;
    expect(mid.x).toBeCloseTo(100 * Math.SQRT1_2, 6);
    expect(mid.y).toBeCloseTo(100 * Math.SQRT1_2, 6);
    expect(mid.z).toBeCloseTo(101, 9);
    // Midpoint rides the circle at radius 100 from the center.
    expect(Math.hypot(mid.x, mid.y)).toBeCloseTo(100, 6);
    expect(resolved.courses[0]!.midpoint!.z).toBeCloseTo(101, 9);
  });

  it('major 270deg arc carries |b|>1 with exact arc length', () => {
    const entity = makeLine(
      [
        { x: 100, y: 0, z: 100 },
        { x: 0, y: 100, z: 100 },
      ],
      [{ kind: 'arc', bulge: MAJOR_BULGE }],
    );
    const resolved = resolveCadFeatureLine(entity)!;
    expect(resolved.courses[0]!.signedSweepDeg).toBeCloseTo(270, 9);
    expect(resolved.planLength).toBeCloseTo(150 * Math.PI, 6);
    expect(resolved.courses[0]!.radius).toBeCloseTo(100, 6);
  });

  it('setGradeSpan: stations 0/30/70/100 -> 100/100.6/101.4/102', () => {
    const entity = makeLine([
      { x: 0, y: 0, z: 100 },
      { x: 30, y: 0, z: 55 },
      { x: 70, y: 0, z: 55 },
      { x: 100, y: 0, z: 55 },
    ]);
    const result = setFeatureLineGradeSpan(entity, { fromStation: 0, toStation: 100, gradeRatio: 0.02 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const z = result.entity.vertices.map((vertex) => vertex.z);
    expect(z[0]).toBeCloseTo(100, 9);
    expect(z[1]).toBeCloseTo(100.6, 9);
    expect(z[2]).toBeCloseTo(101.4, 9);
    expect(z[3]).toBeCloseTo(102, 9);
  });

  it('interpolateSpan weights by station, not vertex index (mixed line/arc)', () => {
    // Line leg 100m + quarter-arc leg 50pi: middle vertex sits at station 100
    // of total 100+50pi, so index-naive 50% would read 101, honest reads higher.
    const entity = makeLine(
      [
        { x: 0, y: 0, z: 100 },
        { x: 100, y: 0, z: 50 },
        { x: 0, y: 100, z: 50 },
      ],
      [{ kind: 'line' }, { kind: 'arc', bulge: QUARTER_BULGE }],
    );
    const total = resolveCadFeatureLine(entity)!.planLength;
    const result = interpolateFeatureLineSpan(entity, 0, total);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Middle vertex sits at station 100 of total: honest station weighting
    // z = 100 + (50 - 100) * 100/total (index-naive midpoint would read 75).
    expect(result.entity.vertices[1]!.z).toBeCloseTo(100 - (50 * 100) / total, 9);
    expect(result.entity.vertices[0]!.z).toBeCloseTo(100, 9);
    expect(result.entity.vertices[2]!.z).toBeCloseTo(50, 9);
  });

  it('insert on a line at 25m: Z 100.5, lengths sum exactly', () => {
    const entity = makeLine([
      { x: 0, y: 0, z: 100 },
      { x: 100, y: 0, z: 102 },
    ]);
    const before = resolveCadFeatureLine(entity)!;
    const result = insertFeatureLineVertex(entity, 0, 25);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entity.vertices).toHaveLength(3);
    expect(result.entity.vertices[1]!.z).toBeCloseTo(100.5, 9);
    expect(result.entity.vertices[1]!.x).toBeCloseTo(25, 9);
    const after = resolveCadFeatureLine(result.entity)!;
    expect(after.planLength).toBeCloseTo(before.planLength, 9);
    expect(after.length3D).toBeCloseTo(before.length3D, 9);
    expect(getFeatureLineElevationAtStation(after, 25)).toBeCloseTo(100.5, 9);
  });

  it('insert on an arc at 25% station splits exact sub-arcs', () => {
    const entity = makeLine(
      [
        { x: 100, y: 0, z: 100 },
        { x: 0, y: 100, z: 102 },
      ],
      [{ kind: 'arc', bulge: QUARTER_BULGE }],
    );
    const before = resolveCadFeatureLine(entity)!;
    const station = before.planLength * 0.25;
    const result = insertFeatureLineVertex(entity, 0, station);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entity.vertices).toHaveLength(3);
    const after = resolveCadFeatureLine(result.entity)!;
    expect(after.courses).toHaveLength(2);
    expect(after.courses[0]!.kind).toBe('arc');
    expect(after.courses[1]!.kind).toBe('arc');
    expect(after.planLength).toBeCloseTo(before.planLength, 9);
    expect(after.length3D).toBeCloseTo(before.length3D, 9);
    const inserted = result.entity.vertices[1]!;
    expect(Math.hypot(inserted.x, inserted.y)).toBeCloseTo(100, 6);
    expect(inserted.z).toBeCloseTo(100.5, 9);
  });

  it('reverse keeps path, flips stations/grades/bulges', () => {
    const entity = makeLine(
      [
        { x: 0, y: 0, z: 100 },
        { x: 100, y: 0, z: 101 },
        { x: 100, y: 100, z: 103 },
      ],
      [{ kind: 'line' }, { kind: 'arc', bulge: QUARTER_BULGE }],
    );
    const before = resolveCadFeatureLine(entity)!;
    const reversed = reverseFeatureLine(entity);
    const after = resolveCadFeatureLine(reversed)!;
    expect(after.planLength).toBeCloseTo(before.planLength, 9);
    expect(after.length3D).toBeCloseTo(before.length3D, 9);
    expect(reversed.segmentGeometry).toEqual([
      { kind: 'arc', bulge: -QUARTER_BULGE },
      { kind: 'line' },
    ]);
    // Grades flip sign per course (reversed course 0 == old course 1 flipped).
    expect(after.courses[0]!.gradeRatio).toBeCloseTo(-before.courses[1]!.gradeRatio, 12);
    expect(after.courses[1]!.gradeRatio).toBeCloseTo(-before.courses[0]!.gradeRatio, 12);
    // Same path at mirrored stations.
    const a = getFeatureLinePointAtStation(after, 10)!;
    const b = getFeatureLinePointAtStation(before, before.planLength - 10)!;
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.y).toBeCloseTo(b.y, 6);
    expect(a.z).toBeCloseTo(b.z, 9);
  });

  it('delete policy: line+line merges, line+arc blocks, arc+arc same-circle merges', () => {
    const straight = makeLine([
      { x: 0, y: 0, z: 100 },
      { x: 50, y: 0, z: 101 },
      { x: 100, y: 0, z: 102 },
    ]);
    const merged = deleteFeatureLineVertex(straight, 1);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.entity.vertices).toHaveLength(2);
    expect(resolveCadFeatureLine(merged.entity)!.planLength).toBeCloseTo(100, 9);

    const mixed = makeLine(
      [
        { x: 0, y: 0, z: 100 },
        { x: 100, y: 0, z: 101 },
        { x: 0, y: 100, z: 102 },
      ],
      [{ kind: 'line' }, { kind: 'arc', bulge: QUARTER_BULGE }],
    );
    expect(deleteFeatureLineVertex(mixed, 1).ok).toBe(false);
  });

  it('transform oracle: translate/rotate keep grades; x2 halves grade; mirror keeps grade, flips bulge', () => {
    const entity = makeLine(
      [
        { x: 0, y: 0, z: 100 },
        { x: 100, y: 0, z: 102 },
      ],
      [{ kind: 'line' }],
    );
    const moved = transformCadEntityGeometry(
      entity,
      translation(1000, 2000),
      classifyTransform(translation(1000, 2000))!,
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok || moved.entity.type !== 'feature-line') return;
    expect(moved.entity.vertices[0]!.z).toBe(100);
    expect(resolveCadFeatureLine(moved.entity)!.courses[0]!.gradeRatio).toBeCloseTo(0.02, 12);

    const rotation = rotationAbout(0, 0, 90);
    const rotated = transformCadEntityGeometry(entity, rotation, classifyTransform(rotation)!);
    expect(rotated.ok).toBe(true);
    if (!rotated.ok || rotated.entity.type !== 'feature-line') return;
    expect(resolveCadFeatureLine(rotated.entity)!.courses[0]!.gradeRatio).toBeCloseTo(0.02, 12);

    const scale = uniformScaleAbout(0, 0, 2);
    const scaled = transformCadEntityGeometry(entity, scale, classifyTransform(scale)!);
    expect(scaled.ok).toBe(true);
    if (!scaled.ok || scaled.entity.type !== 'feature-line') return;
    expect(scaled.entity.vertices[0]!.z).toBe(100);
    expect(scaled.entity.vertices[1]!.z).toBe(102);
    // Horizontal doubles, Z unchanged: grade halves honestly.
    expect(resolveCadFeatureLine(scaled.entity)!.planLength).toBeCloseTo(200, 9);
    expect(resolveCadFeatureLine(scaled.entity)!.courses[0]!.gradeRatio).toBeCloseTo(0.01, 12);

    const curved = makeLine(
      [
        { x: 100, y: 0, z: 100 },
        { x: 0, y: 100, z: 102 },
      ],
      [{ kind: 'arc', bulge: QUARTER_BULGE }],
    );
    const mirror = reflectionAboutLine({ x: 0, y: 0 }, { x: 1, y: 0 })!;
    const mirrored = transformCadEntityGeometry(curved, mirror, classifyTransform(mirror)!);
    expect(mirrored.ok).toBe(true);
    if (!mirrored.ok || mirrored.entity.type !== 'feature-line') return;
    expect(mirrored.entity.segmentGeometry).toEqual([{ kind: 'arc', bulge: -QUARTER_BULGE }]);
    expect(resolveCadFeatureLine(mirrored.entity)!.courses[0]!.gradeRatio).toBeCloseTo(
      resolveCadFeatureLine(curved)!.courses[0]!.gradeRatio,
      12,
    );
  });

  it('large coordinates (E~2e6 N~7e6) match small-coordinate parity', () => {
    const big = makeLine([
      { x: 2000000, y: 7000000, z: 100 },
      { x: 2000100, y: 7000000, z: 102 },
    ]);
    const small = makeLine([
      { x: 0, y: 0, z: 100 },
      { x: 100, y: 0, z: 102 },
    ]);
    const bigResolved = resolveCadFeatureLine(big)!;
    const smallResolved = resolveCadFeatureLine(small)!;
    expect(bigResolved.planLength).toBeCloseTo(smallResolved.planLength, 6);
    expect(bigResolved.length3D).toBeCloseTo(smallResolved.length3D, 6);
    expect(bigResolved.courses[0]!.gradeRatio).toBeCloseTo(0.02, 9);
    expect(getFeatureLineElevationAtStation(big, 50)).toBeCloseTo(101, 6);
  });

  it('COPY mints a new entity id with fresh vertex ids and equal geometry', () => {
    const entity = makeLine(
      [
        { x: 0, y: 0, z: 100 },
        { x: 100, y: 0, z: 102 },
      ],
      [{ kind: 'line' }],
    );
    const copy = copyFeatureLineEntity(entity, 10, 20);
    expect(copy.id).not.toBe(entity.id);
    expect(copy.vertices.map((vertex) => vertex.id)).not.toEqual(
      entity.vertices.map((vertex) => vertex.id),
    );
    expect(copy.vertices[0]!.x).toBe(10);
    expect(copy.vertices[0]!.z).toBe(100);
    expect(copy.segmentGeometry).toEqual(entity.segmentGeometry);
    expect(copy.segmentGeometry).not.toBe(entity.segmentGeometry);
    expect(resolveCadFeatureLine(copy)!.planLength).toBeCloseTo(100, 9);
  });

  it('sanitize fails closed: few verts, dup ids, bad Z, geometry mismatch, zero bulge', () => {
    expect(sanitizeFeatureLine(makeLine([{ x: 0, y: 0, z: 100 }])).ok).toBe(false);
    const dup = makeLine([
      { x: 0, y: 0, z: 100 },
      { x: 1, y: 0, z: 100 },
    ]);
    dup.vertices[1]!.id = dup.vertices[0]!.id;
    expect(sanitizeFeatureLine(dup).ok).toBe(false);
    // Z never defaults to 0: NaN elevation is invalid, not ground.
    const badZ = makeLine([
      { x: 0, y: 0, z: 100 },
      { x: 1, y: 0, z: Number.NaN },
    ]);
    expect(sanitizeFeatureLine(badZ).ok).toBe(false);
    expect(resolveCadFeatureLine(badZ)).toBeNull();
    const mismatch = makeLine(
      [
        { x: 0, y: 0, z: 100 },
        { x: 1, y: 0, z: 100 },
      ],
      [],
    );
    expect(sanitizeFeatureLine(mismatch).ok).toBe(false);
    const zeroBulge = makeLine(
      [
        { x: 0, y: 0, z: 100 },
        { x: 1, y: 0, z: 100 },
      ],
      [{ kind: 'arc', bulge: 0 }],
    );
    expect(sanitizeFeatureLine(zeroBulge).ok).toBe(false);
    // Stations outside [0, total] never extrapolate.
    const line = makeLine([
      { x: 0, y: 0, z: 100 },
      { x: 100, y: 0, z: 102 },
    ]);
    expect(getFeatureLineElevationAtStation(line, -1)).toBeNull();
    expect(getFeatureLineElevationAtStation(line, 101)).toBeNull();
    expect(getFeatureLinePointAtStation(line, 101)).toBeNull();
  });

  it('raiseLower shifts Z only, plan untouched', () => {
    const entity = makeLine([
      { x: 0, y: 0, z: 100 },
      { x: 100, y: 0, z: 102 },
    ]);
    const result = raiseLowerFeatureLine(entity, 5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entity.vertices[0]!.z).toBe(105);
    expect(result.entity.vertices[0]!.x).toBe(0);
    expect(resolveCadFeatureLine(result.entity)!.courses[0]!.gradeRatio).toBeCloseTo(0.02, 12);
  });
});
