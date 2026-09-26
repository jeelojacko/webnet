// Phase 19A slice A — stable parcel course identity oracles.
import { describe, expect, it } from 'vitest';
import {
  buildParcelCourseIds,
  buildParcelCourseReportSummary,
  ensureParcelCourseIds,
  insertParcelCourseVertex,
  resolveCadParcelCourses,
} from '../src/engine/cad/cadParcelCourses';
import { cadBuildParcelReportSummary } from '../src/engine/cad/cadCogo';
import { cadBuildParcelClosureSummary } from '../src/engine/cad/cadCogoParcelGeometrySummaries';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { createCadSelectionState } from '../src/engine/cad/cadSelection';
import { executeCadCommand } from '../src/engine/cad/cadTransactions';
import type { CadLineEntity, CadParcelEntity } from '../src/engine/cad/cadTypes';

const PARCEL_ID = 'parcel-19a-rect';

const buildRectParcel = (id = PARCEL_ID): CadParcelEntity => {
  const vertices = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
    { x: 0, y: 50 },
  ];
  // Creation-path convention: metrics computed on the explicitly closed ring.
  const metrics = cadBuildParcelClosureSummary([...vertices, vertices[0]!])!;
  return {
    id,
    type: 'parcel',
    layerId: 'general',
    visible: true,
    locked: false,
    vertices: vertices.map((vertex) => ({ ...vertex })),
    vertexLabels: ['A', 'B', 'C', 'D'],
    parcelName: 'Parcel 1',
    courseIds: buildParcelCourseIds(id, vertices.length),
    areaSquareMeters: metrics.areaSquareMeters,
    perimeterMeters: metrics.perimeterMeters,
    closureDeltaX: metrics.closureDeltaX,
    closureDeltaY: metrics.closureDeltaY,
    closureDistanceMeters: metrics.closureDistanceMeters,
  };
};

const snapshotWithParcel = (parcel: CadParcelEntity) => {
  const base = createBlankCadProject({ name: 'course-19a', units: 'm' });
  const project = { ...base, entities: [parcel] };
  return {
    project,
    selection: createCadSelectionState(project, [parcel.id]),
  };
};

const parcelOf = (snapshot: { project: { entities: unknown[] } }): CadParcelEntity => {
  const found = snapshot.project.entities.find(
    (entity): entity is CadParcelEntity =>
      typeof entity === 'object' && entity !== null &&
      (entity as CadParcelEntity).type === 'parcel',
  );
  if (!found) throw new Error('parcel missing');
  return found;
};

describe('parcel course identity 19A', () => {
  it('rectangle 100x50 oracle: 4 stable ids, bearings, distances, area, perimeter', () => {
    const parcel = buildRectParcel();
    expect(parcel.courseIds).toHaveLength(parcel.vertices.length);
    const courses = resolveCadParcelCourses(parcel);
    expect(courses).toHaveLength(4);
    expect(courses.map((course) => course.courseId)).toEqual([
      `parcel-course:${PARCEL_ID}:0`,
      `parcel-course:${PARCEL_ID}:1`,
      `parcel-course:${PARCEL_ID}:2`,
      `parcel-course:${PARCEL_ID}:3`,
    ]);
    // Ring order preserved: east, north, west, south.
    expect(courses.map((course) => course.distanceMeters)).toEqual([100, 50, 100, 50]);
    expect(courses.map((course) => course.bearing)).toEqual([
      'N90-00-00.00E',
      'N00-00-00.00E',
      'S90-00-00.00W',
      'S00-00-00.00E',
    ]);
    expect(courses.map((course) => `${course.fromLabel}-${course.toLabel}`)).toEqual([
      'A-B',
      'B-C',
      'C-D',
      'D-A',
    ]);
    const report = buildParcelCourseReportSummary(parcel)!;
    expect(report.areaSquareMeters).toBeCloseTo(5000, 9);
    expect(report.perimeterMeters).toBeCloseTo(300, 9);
    // Open-ring convention (existing behavior): closure spans last->first.
    expect(report.closureDistanceMeters).toBeCloseTo(50, 9);
    expect(report.courseCount).toBe(4);
  });

  it('live course report matches the legacy parcel report values leg for leg', () => {
    const parcel = buildRectParcel();
    const live = buildParcelCourseReportSummary(parcel)!;
    const legacy = cadBuildParcelReportSummary({
      parcelName: parcel.parcelName,
      vertices: parcel.vertices,
      vertexLabels: parcel.vertexLabels,
    })!;
    expect(live.areaSquareMeters).toBe(legacy.areaSquareMeters);
    expect(live.perimeterMeters).toBe(legacy.perimeterMeters);
    expect(live.closureDistanceMeters).toBe(legacy.closureDistanceMeters);
    expect(live.courses).toEqual(legacy.courses);
  });

  it('save/reopen round-trip keeps the same course ids', () => {
    const parcel = buildRectParcel();
    const document = createBlankCadDrawingDocument({ name: 'course-19a', units: 'm' });
    document.project.entities.push(parcel);
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(document));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reopened = parcelOf({ project: parsed.drawing.project });
    expect(reopened.courseIds).toEqual(parcel.courseIds);
  });

  it('MOVE keeps ids, shifts vertices, preserves bearings/distances', () => {
    const parcel = buildRectParcel();
    const result = executeCadCommand(snapshotWithParcel(parcel), {
      key: 'MOVE',
      deltaX: 10,
      deltaY: -5,
    });
    if (!result) throw new Error('MOVE failed');
    const moved = parcelOf(result.nextSnapshot);
    expect(moved.courseIds).toEqual(parcel.courseIds);
    expect(moved.vertices[0]).toEqual({ x: 10, y: -5 });
    const courses = resolveCadParcelCourses(moved);
    expect(courses.map((course) => course.distanceMeters)).toEqual([100, 50, 100, 50]);
    expect(courses.map((course) => course.bearing)).toEqual(
      resolveCadParcelCourses(parcel).map((course) => course.bearing),
    );
  });

  it('ROTATE 90 keeps ids and updates bearings', () => {
    const parcel = buildRectParcel();
    const result = executeCadCommand(snapshotWithParcel(parcel), {
      key: 'ROTATE',
      baseX: 0,
      baseY: 0,
      angleDeg: 90,
    });
    if (!result) throw new Error('ROTATE failed');
    const rotated = parcelOf(result.nextSnapshot);
    expect(rotated.courseIds).toEqual(parcel.courseIds);
    const courses = resolveCadParcelCourses(rotated);
    expect(courses.map((course) => course.distanceMeters)).toEqual([100, 50, 100, 50]);
    // East leg becomes north, north becomes west, etc.
    expect(courses.map((course) => course.bearing)).toEqual([
      'N00-00-00.00E',
      'S90-00-00.00W',
      'S00-00-00.00E',
      'N90-00-00.00E',
    ]);
  });

  it('SCALE 2 keeps ids and doubles distances/area', () => {
    const parcel = buildRectParcel();
    const result = executeCadCommand(snapshotWithParcel(parcel), {
      key: 'SCALE',
      baseX: 0,
      baseY: 0,
      factor: 2,
    });
    if (!result) throw new Error('SCALE failed');
    const scaled = parcelOf(result.nextSnapshot);
    expect(scaled.courseIds).toEqual(parcel.courseIds);
    const courses = resolveCadParcelCourses(scaled);
    expect(courses.map((course) => course.distanceMeters)).toEqual([200, 100, 200, 100]);
    expect(scaled.areaSquareMeters).toBeCloseTo(20000, 6);
    expect(scaled.perimeterMeters).toBeCloseTo(600, 6);
  });

  it('vertex insert retires the old id and mints two new ids', () => {
    const parcel = buildRectParcel();
    const retired = parcel.courseIds![0]!;
    const inserted = insertParcelCourseVertex({
      parcel,
      courseIndex: 0,
      point: { x: 50, y: 0 },
      label: 'E',
    });
    if (!inserted) throw new Error('insert failed');
    expect(inserted.vertices).toHaveLength(5);
    expect(inserted.courseIds).toHaveLength(5);
    expect(inserted.courseIds).not.toContain(retired);
    expect(inserted.vertices[1]).toEqual({ x: 50, y: 0 });
    expect(inserted.vertexLabels[1]).toBe('E');
    // Untouched courses keep their ids.
    expect(inserted.courseIds![2]).toBe(parcel.courseIds![1]);
    expect(inserted.courseIds![3]).toBe(parcel.courseIds![2]);
    expect(inserted.courseIds![4]).toBe(parcel.courseIds![3]);
    const courses = resolveCadParcelCourses(inserted);
    expect(courses).toHaveLength(5);
    expect(courses[0]!.distanceMeters).toBeCloseTo(50, 9);
    expect(courses[1]!.distanceMeters).toBeCloseTo(50, 9);
  });

  it('legacy parcels gain deterministic ids on load (no random per load)', () => {
    const legacy = buildRectParcel('parcel-legacy');
    const { courseIds: _dropped, ...withoutIds } = legacy;
    void _dropped;
    const legacyParcel = withoutIds as CadParcelEntity;
    expect(legacyParcel.courseIds).toBeUndefined();
    const first = ensureParcelCourseIds(legacyParcel);
    const second = ensureParcelCourseIds(legacyParcel);
    expect(first.courseIds).toEqual(second.courseIds);
    expect(first.courseIds).toHaveLength(legacyParcel.vertices.length);
    // Full file round-trip agrees as well.
    const loadIds = () => {
      const document = createBlankCadDrawingDocument({ name: 'legacy-19a', units: 'm' });
      document.project.entities.push(structuredClone(legacyParcel));
      const parsed = parseCadDrawingFile(serializeCadDrawingFile(document));
      if (!parsed.ok) throw new Error('parse failed');
      return parcelOf({ project: parsed.drawing.project }).courseIds;
    };
    expect(loadIds()).toEqual(loadIds());
    expect(loadIds()).toEqual(first.courseIds);
  });

  it('PARCEL_SPLIT children get fresh course ids', () => {
    const parcel = buildRectParcel('parcel-parent');
    const splitLine: CadLineEntity = {
      id: 'split-line',
      type: 'line',
      layerId: 'general',
      visible: true,
      locked: false,
      fromStationId: 'S1',
      toStationId: 'S2',
      fromX: 50,
      fromY: -10,
      toX: 50,
      toY: 60,
      sourceObservationIds: [],
    };
    const base = createBlankCadProject({ name: 'split-19a', units: 'm' });
    const project = { ...base, entities: [parcel, splitLine] };
    const result = executeCadCommand(
      { project, selection: createCadSelectionState(project, [parcel.id]) },
      { key: 'PARCEL_SPLIT', parcelEntityId: parcel.id, splitLineEntityId: splitLine.id },
    );
    if (!result) throw new Error('PARCEL_SPLIT failed');
    const children = result.nextSnapshot.project.entities.filter(
      (entity): entity is CadParcelEntity => entity.type === 'parcel',
    );
    expect(children).toHaveLength(2);
    for (const child of children) {
      expect(child.courseIds).toHaveLength(child.vertices.length);
      expect(child.courseIds!.every((id) => id.startsWith(`parcel-course:${child.id}:`))).toBe(true);
      // Fresh identity: no id shared with the parent.
      expect(child.courseIds!.some((id) => parcel.courseIds!.includes(id))).toBe(false);
    }
  });
});
