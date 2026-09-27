// Phase 19C Round 2C — parcel course table / report / description / tags.
import { describe, expect, it } from 'vitest';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { cadBuildParcelClosureSummary } from '../src/engine/cad/cadCogoParcelGeometrySummaries';
import {
  buildParcelCourseIds,
  resolveCadParcelCourses as resolveCanonicalParcelCourses,
} from '../src/engine/cad/cadParcelCourses';
import {
  buildCadParcelLegalDescription,
  reverseCadParcelCourses,
} from '../src/engine/cad/cadParcelLegalDescription';
import {
  DEFAULT_CAD_SURVEY_TABLE_STYLE_ID,
  resolveCadSurveyTableRow,
} from '../src/engine/cad/cadSurveyTables';
import { deriveCadSurveyTable } from '../src/engine/cad/cadSurveyTableDerive';
import {
  deriveCadSurveyTableFromSource,
  formatCadSurveyTableCsv,
  resolveCadParcelCourses,
} from '../src/engine/cad/cadSurveyExportTables';
import type {
  CadEntity,
  CadParcelCourseGeometry,
  CadParcelEntity,
  CadProject,
  CadSurveyTableEntity,
} from '../src/engine/cad/cadTypes';

const LAYER = '19c-layer';
const line: CadParcelCourseGeometry = { kind: 'line' };
const arc = (bulge: number): CadParcelCourseGeometry => ({ kind: 'arc', bulge });

let parcelSeq = 0;
const makeParcel = (
  vertices: Array<{ x: number; y: number }>,
  courseGeometry?: CadParcelCourseGeometry[],
): CadParcelEntity => {
  const id = `parcel-19c-out-${(parcelSeq += 1)}`;
  const parcel: CadParcelEntity = {
    id,
    type: 'parcel',
    layerId: LAYER,
    visible: true,
    locked: false,
    vertices: vertices.map((vertex) => ({ ...vertex })),
    vertexLabels: vertices.map((_, index) => `P${index + 1}`),
    parcelName: `Parcel ${parcelSeq}`,
    courseIds: buildParcelCourseIds(id, vertices.length),
    ...(courseGeometry != null ? { courseGeometry: courseGeometry.map((entry) => ({ ...entry })) } : {}),
  };
  const metrics = cadBuildParcelClosureSummary(parcel.vertices, { courseGeometry });
  if (metrics) {
    parcel.areaSquareMeters = metrics.areaSquareMeters;
    parcel.perimeterMeters = metrics.perimeterMeters;
  }
  return parcel;
};

const projectWith = (...entities: CadEntity[]): CadProject => {
  const project = createBlankCadProject({ name: '19c outputs', units: 'm' });
  return {
    ...project,
    layers: [{ id: LAYER, name: 'Survey', color: '#112233', visible: true, locked: false, role: 'planning' }],
    entities,
  };
};

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];
/** L1 line / L2 arc (right, minor) / L3 line / L4 arc (right, minor). */
const mixedSquare = () =>
  makeParcel(square, [line, arc(-0.5), line, arc(-0.5)]);

const makeCourseTable = (parcel: CadParcelEntity): CadSurveyTableEntity => ({
  id: `table-${parcel.id}`,
  type: 'survey-table',
  layerId: LAYER,
  visible: true,
  locked: false,
  tableKind: 'parcel-course',
  x: 500,
  y: 400,
  rotationDeg: 0,
  tableStyleId: DEFAULT_CAD_SURVEY_TABLE_STYLE_ID,
  rows: resolveCadParcelCourses(parcel).map((course) => ({
    id: `row-${course.courseId}`,
    source: { kind: 'parcel-course', parcelId: parcel.id, courseId: course.courseId },
  })),
});

describe('19C parcel course table (source-driven)', () => {
  it('mixed rows: arc carries Type/Radius/Delta/Arc/Chord/Chord Bearing/Direction; line keeps Bearing/Distance', () => {
    const parcel = mixedSquare();
    const table = deriveCadSurveyTableFromSource({ kind: 'parcel-course', parcel }, projectWith(parcel));
    expect(table.columns).toEqual([
      'Course',
      'From',
      'To',
      'Bearing',
      'Distance (m)',
      'Type',
      'Radius (m)',
      'Delta',
      'Arc (m)',
      'Chord (m)',
      'Chord Bearing',
      'Direction',
    ]);
    expect(table.rows).toHaveLength(4);
    const lineRow = table.rows[0]!.cells;
    const arcRow = table.rows[1]!.cells;
    const canonical = resolveCanonicalParcelCourses(parcel);
    const arcCourse = canonical[1]!;
    if (arcCourse.kind !== 'arc') throw new Error('expected arc course');
    // Line row: line truth under line headings, no arc values.
    expect(lineRow[3]).toBe(canonical[0]!.kind === 'line' ? canonical[0]!.bearing : '');
    expect(lineRow[4]).toBe('10.000');
    expect(lineRow[5]).toBe('LINE');
    expect(lineRow.slice(6)).toEqual(['', '', '', '', '', '']);
    // Arc row: line headings stay blank (never chord-as-distance), chord
    // truth lives under its own headings.
    expect(arcRow[3]).toBe('');
    expect(arcRow[4]).toBe('');
    expect(arcRow[5]).toBe('ARC');
    expect(arcRow[6]).toBe('6.250');
    expect(arcRow[7]).toBe('106°15\'37"');
    expect(arcRow[8]).toBe(arcCourse.arcLength.toFixed(3));
    expect(arcRow[9]).toBe(arcCourse.chordLength.toFixed(3));
    expect(arcRow[10]).toBe(arcCourse.chordBearing);
    expect(arcRow[11]).toBe('right');
    // Arc tag anchors sit at the TRUE arc midpoint with kind=curve.
    const anchor = table.tagAnchors[1]!;
    expect(anchor.kind).toBe('curve');
    expect(anchor.point.x).toBeCloseTo(arcCourse.midpoint.x, 9);
    expect(anchor.point.y).toBeCloseTo(arcCourse.midpoint.y, 9);
  });

  it('all-straight parcel keeps the exact 19A headings/rows (byte-compatible CSV)', () => {
    const parcel = makeParcel(square);
    const table = deriveCadSurveyTableFromSource({ kind: 'parcel-course', parcel }, projectWith(parcel));
    expect(table.columns).toEqual(['Course', 'From', 'To', 'Bearing', 'Distance (m)']);
    const csv = formatCadSurveyTableCsv(table);
    expect(csv).toContain('Course,From,To,Bearing,Distance (m)');
    expect(csv).not.toContain('Type');
    expect(table.rows[0]!.cells).toEqual(['C1', 'P1', 'P2', 'N90-00-00.00E', '10.000']);
  });

  it('entity-driven table grows arc columns and reads the shared resolver', () => {
    const parcel = mixedSquare();
    const entity = makeCourseTable(parcel);
    const derivation = deriveCadSurveyTable(entity, projectWith(parcel, entity));
    expect(derivation.columns.map((column) => column.label)).toEqual([
      'Code',
      'From',
      'To',
      'Bearing',
      'Distance',
      'Type',
      'Radius (m)',
      'Delta',
      'Arc (m)',
      'Chord (m)',
      'Chord Bearing',
      'Direction',
    ]);
    const arcRow = derivation.rows[1]!;
    const byKey = new Map(arcRow.cells.map((cell, index) => [derivation.columns[index]!.key, cell]));
    expect(byKey.get('bearing')).toBe('');
    expect(byKey.get('distance')).toBe('');
    expect(byKey.get('type')).toBe('ARC');
    expect(byKey.get('direction')).toBe('right');
    const canonicalArc = resolveCanonicalParcelCourses(parcel)[1]!;
    if (canonicalArc.kind !== 'arc') throw new Error('expected arc');
    expect(byKey.get('chordBearing')).toBe(canonicalArc.chordBearing);
    // Arc tag anchor = true arc midpoint; a manual offset is relative to it.
    const tag = derivation.tags.find((entry) => entry.rowIndex === 1)!;
    expect(tag.anchorX).toBeCloseTo(canonicalArc.midpoint.x, 9);
    expect(tag.anchorY).toBeCloseTo(canonicalArc.midpoint.y, 9);
    const moved: CadSurveyTableEntity = {
      ...entity,
      rows: entity.rows.map((row, index) =>
        index === 1 ? { ...row, tagOffset: { dx: 5, dy: 0 } } : row,
      ),
    };
    const movedTag = deriveCadSurveyTable(moved, projectWith(parcel, moved)).tags.find(
      (entry) => entry.rowIndex === 1,
    )!;
    expect(movedTag.x - tag.x).toBeCloseTo(5, 9);
    expect(movedTag.y - tag.y).toBeCloseTo(0, 9);
  });

  it('convert line C2 -> arc keeps the course id/endpoints and updates values without a table transaction', () => {
    const before = makeParcel(square);
    const entity = makeCourseTable(before);
    const beforeRow = resolveCadSurveyTableRow(
      projectWith(before, entity),
      entity,
      entity.rows[1]!,
      1,
    );
    expect(beforeRow.status).toBe('ok');
    expect(beforeRow.values.find((value) => value.key === 'type')?.value).toBe('LINE');

    const converted: CadParcelEntity = {
      ...before,
      courseGeometry: [line, arc(-0.5), line, line],
    };
    const convertedEntity = makeCourseTable(converted);
    // Same bound courseId + same row id => the row stays valid (read-time derive).
    expect(convertedEntity.rows[1]!.id).toBe(entity.rows[1]!.id);
    const afterRow = resolveCadSurveyTableRow(
      projectWith(converted, convertedEntity),
      convertedEntity,
      convertedEntity.rows[1]!,
      1,
    );
    expect(afterRow.status).toBe('ok');
    expect(afterRow.values.find((value) => value.key === 'type')?.value).toBe('ARC');
    const canonicalBefore = resolveCanonicalParcelCourses(before)[1]!;
    const canonicalAfter = resolveCanonicalParcelCourses(converted)[1]!;
    expect(canonicalAfter.courseId).toBe(canonicalBefore.courseId);
    expect(canonicalAfter.fromVertex).toEqual(canonicalBefore.fromVertex);
    expect(canonicalAfter.toVertex).toEqual(canonicalBefore.toVertex);
    expect(canonicalAfter.kind).toBe('arc');
    // Source parcel is untouched; undo (restore geometry) is exact.
    expect(resolveCanonicalParcelCourses(before)[1]!.kind).toBe('line');
    const undone = resolveCanonicalParcelCourses({ ...converted, courseGeometry: undefined });
    expect(JSON.stringify(undone)).toBe(JSON.stringify(resolveCanonicalParcelCourses(before)));
  });

  it('a retired course id surfaces BROKEN_REFERENCE, never a rebind', () => {
    const parcel = mixedSquare();
    const entity: CadSurveyTableEntity = {
      ...makeCourseTable(parcel),
      rows: [
        ...makeCourseTable(parcel).rows,
        { id: 'retired', source: { kind: 'parcel-course', parcelId: parcel.id, courseId: 'parcel-course:gone:7' } },
      ],
    };
    const derivation = deriveCadSurveyTable(entity, projectWith(parcel, entity));
    expect(derivation.status).toBe('PARTIAL_BROKEN_REFERENCE');
    expect(derivation.rows[4]!.status).toBe('missing');
    // Leading code cell is the visible row code; every value cell is '—'.
    expect(derivation.rows[4]!.cells.slice(1).every((cell) => cell === '—')).toBe(true);
  });
});

describe('19C curved legal description', () => {
  it('is deterministic and reads arc metrics from the shared resolver', () => {
    const parcel = mixedSquare();
    const first = buildCadParcelLegalDescription(parcel);
    const second = buildCadParcelLegalDescription(parcel);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.description.text).toBe(second.description.text);
    const arcCourse = resolveCadParcelCourses(parcel)[1]!;
    if (arcCourse.curve == null) throw new Error('expected curve');
    expect(first.description.text).toContain(arcCourse.curve.chordBearing);
    expect(first.description.text).toContain(arcCourse.curve.radius.toFixed(3));
    expect(first.description.text).toContain(arcCourse.curve.arcLength.toFixed(3));
    expect(first.description.text).toContain(`to the ${arcCourse.curve.direction}`);
  });

  it('reverse swaps endpoints/hand and keeps radius/|delta|/length, chord bearing +180', () => {
    const parcel = mixedSquare();
    const forward = resolveCadParcelCourses(parcel);
    const reversed = reverseCadParcelCourses(forward);
    const forwardArc = forward[1]!;
    const reversedArc = reversed[reversed.length - 2]!;
    if (forwardArc.curve == null || reversedArc.curve == null) throw new Error('expected curves');
    expect(reversedArc.fromVertex).toEqual(forwardArc.toVertex);
    expect(reversedArc.toVertex).toEqual(forwardArc.fromVertex);
    expect(reversedArc.curve.radius).toBeCloseTo(forwardArc.curve.radius, 12);
    expect(reversedArc.curve.deltaDeg).toBeCloseTo(forwardArc.curve.deltaDeg, 12);
    expect(reversedArc.curve.arcLength).toBeCloseTo(forwardArc.curve.arcLength, 12);
    expect(reversedArc.curve.direction).toBe(forwardArc.curve.direction === 'left' ? 'right' : 'left');
    const expected = (forwardArc.azimuth + 180) % 360;
    expect(reversedArc.azimuth).toBeCloseTo(expected, 9);
    // Description reverse reads the same authoritative values.
    const reversedDraft = buildCadParcelLegalDescription(parcel, { reverse: true });
    const backwardDraft = buildCadParcelLegalDescription(parcel);
    expect(reversedDraft.ok && backwardDraft.ok).toBe(true);
    if (!reversedDraft.ok || !backwardDraft.ok) return;
    expect(reversedDraft.description.text).not.toBe(backwardDraft.description.text);
    expect(reversedDraft.description.startLabel).toBe(forward[forward.length - 1]!.toLabel);
  });

  it('omits tangent claims by default; proven tangency is reported only on opt-in', () => {
    const kinked = mixedSquare();
    const kinkedDefault = buildCadParcelLegalDescription(kinked);
    expect(kinkedDefault.ok).toBe(true);
    if (!kinkedDefault.ok) return;
    expect(kinkedDefault.description.text.toLowerCase()).not.toContain('tangent');
    const kinkedOptIn = buildCadParcelLegalDescription(kinked, { includeTangency: true });
    expect(kinkedOptIn.ok).toBe(true);
    if (!kinkedOptIn.ok) return;
    expect(kinkedOptIn.description.text).toContain('NON_TANGENT');

    // Exact tangent construction (line -> b=1 arc) reports TANGENT.
    const tangent = makeParcel(square, [line, arc(1), line, line]);
    const tangentOptIn = buildCadParcelLegalDescription(tangent, { includeTangency: true });
    expect(tangentOptIn.ok).toBe(true);
    if (!tangentOptIn.ok) return;
    expect(tangentOptIn.description.text).toContain('(TANGENT)');
  });
});
