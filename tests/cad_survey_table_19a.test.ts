// Phase 19A slice B — survey table entity, style, derivation, and rendering.
import { describe, expect, it } from 'vitest';
import {
  createBlankCadDrawingDocument,
  createBlankCadProject,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import {
  cadSurveyTableWorldBounds,
  deriveCadSurveyTable,
  findDuplicateSurveyTableCodes,
  renumberCadSurveyTableCodes,
} from '../src/engine/cad/cadSurveyTableDerive';
import { buildCadSurveyTablePrimitives } from '../src/engine/cad/cadSurveyTableRender';
import {
  DEFAULT_CAD_SURVEY_TABLE_STYLE_ID,
  createDefaultCadSurveyTableStyle,
} from '../src/engine/cad/cadSurveyTables';
import {
  buildCadSurveyTableStyleId,
  createCadSurveyTableStyle,
  deleteCadSurveyTableStyle,
  duplicateCadSurveyTableStyle,
  renameCadSurveyTableStyle,
  setCurrentCadSurveyTableStyle,
} from '../src/engine/cad/cadSurveyTableStyles';
import { buildParcelCourseIds } from '../src/engine/cad/cadParcelCourses';
import { translateEntity } from '../src/engine/cad/cadTransactionsEntityTransforms';
import {
  classifyTransform,
  compose,
  rotationAbout,
  translation,
} from '../src/engine/cad/cadTransform2D';
import { transformCadEntityGeometry } from '../src/engine/cad/cadTransformGeometry';
import type {
  CadEntity,
  CadLineEntity,
  CadParcelEntity,
  CadProject,
  CadSurveyTableEntity,
  CadSurveyTableRow,
  CadSurveyTableRowSource,
} from '../src/engine/cad/cadTypes';

let rowCounter = 0;
const row = (
  source: CadSurveyTableRowSource,
  extra: Partial<CadSurveyTableRow> = {},
): CadSurveyTableRow => ({
  id: `row-${(rowCounter += 1)}`,
  source,
  ...extra,
});

const line = (
  id: string,
  from: [number, number],
  to: [number, number],
): CadLineEntity => ({
  id,
  type: 'line',
  layerId: 'general',
  visible: true,
  locked: false,
  fromStationId: `${id}-A`,
  toStationId: `${id}-B`,
  fromX: from[0],
  fromY: from[1],
  toX: to[0],
  toY: to[1],
  sourceObservationIds: [],
});

const rectParcel = (id = 'parcel-19b'): CadParcelEntity => ({
  id,
  type: 'parcel',
  layerId: 'general',
  visible: true,
  locked: false,
  vertices: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
    { x: 0, y: 50 },
  ],
  vertexLabels: ['A', 'B', 'C', 'D'],
  parcelName: 'Parcel 1',
  courseIds: buildParcelCourseIds(id, 4),
});

const table = (overrides: Partial<CadSurveyTableEntity> = {}): CadSurveyTableEntity => ({
  id: 'table-1',
  type: 'survey-table',
  layerId: 'general',
  visible: true,
  locked: false,
  tableKind: 'line',
  x: 500,
  y: 400,
  rotationDeg: 0,
  tableStyleId: DEFAULT_CAD_SURVEY_TABLE_STYLE_ID,
  rows: [],
  ...overrides,
});

const projectWith = (
  entities: CadEntity[],
  patch: Partial<CadProject> = {},
): CadProject => {
  const base = createBlankCadProject({ name: 'table-19a', units: 'm' });
  return { ...base, entities, ...patch };
};

describe('19A survey table derivation', () => {
  it('auto codes are kind prefix + sequence and a reorder renumbers them', () => {
    const a = line('line-a', [0, 0], [100, 0]);
    const b = line('line-b', [0, 0], [0, 50]);
    const c = line('line-c', [0, 0], [0, 25]);
    const source = { kind: 'line' as const };
    const original = table({
      rows: [
        row({ ...source, entityId: a.id }),
        row({ ...source, entityId: b.id }),
        row({ ...source, entityId: c.id }),
      ],
    });
    const project = projectWith([a, b, c]);
    const before = deriveCadSurveyTable(original, project);
    expect(before.rows.map((entry) => entry.code)).toEqual(['L1', 'L2', 'L3']);
    expect(before.rows.map((entry) => entry.autoCode)).toEqual(['L1', 'L2', 'L3']);
    const reordered = table({ rows: [original.rows[2]!, original.rows[0]!, original.rows[1]!] });
    const after = deriveCadSurveyTable(reordered, project);
    expect(after.rows.map((entry) => entry.code)).toEqual(['L1', 'L2', 'L3']);
    // The row that was first now renders with L2.
    const moved = after.rows.find((entry) => entry.rowId === original.rows[0]!.id)!;
    expect(moved.code).toBe('L2');
  });

  it('manual codes survive, consume a slot, and block duplicate autos', () => {
    const sources: CadSurveyTableRowSource[] = [
      { kind: 'line', entityId: 'line-a' },
      { kind: 'line', entityId: 'line-b' },
      { kind: 'line', entityId: 'line-c' },
    ];
    const subject = table({
      rows: [
        row(sources[0]!),
        row(sources[1]!, { customCode: 'L2' }),
        row(sources[2]!),
      ],
    });
    const assignments = renumberCadSurveyTableCodes(subject);
    expect(assignments.map((entry) => entry.code)).toEqual(['L1', 'L2', 'L3']);
    expect(assignments[1]!.isAuto).toBe(false);
    expect(assignments[1]!.customCode).toBe('L2');
    expect(findDuplicateSurveyTableCodes(assignments)).toEqual([]);
    // Two identical manual codes surface as a blocked duplicate.
    const dup = table({
      rows: [row(sources[0]!, { customCode: 'X' }), row(sources[1]!, { customCode: 'X' })],
    });
    const dupProject = projectWith([
      line('line-a', [0, 0], [10, 0]),
      line('line-b', [0, 0], [0, 10]),
      line('line-c', [0, 0], [0, 10]),
    ]);
    expect(deriveCadSurveyTable(dup, dupProject).duplicateCodes).toEqual(['X']);
  });

  it('a source edit updates derived strings with no table mutation', () => {
    const beforeLine = line('line-a', [0, 0], [100, 0]);
    const subject = table({ rows: [row({ kind: 'line', entityId: 'line-a' })] });
    const snapshot = JSON.stringify(subject);
    const first = deriveCadSurveyTable(subject, projectWith([beforeLine]));
    expect(first.rows[0]!.cells).toEqual(['L1', 'line-a-A', 'line-a-B', 'N90-00-00.00E', '100.000']);
    const afterLine = { ...beforeLine, toX: 250 };
    const second = deriveCadSurveyTable(subject, projectWith([afterLine]));
    expect(second.rows[0]!.cells[4]).toBe('250.000');
    expect(JSON.stringify(subject)).toBe(snapshot);
  });

  it('broken refs persist visibly and never silently drop rows', () => {
    const subject = table({
      rows: [
        row({ kind: 'line', entityId: 'missing-line' }),
        row({ kind: 'line', entityId: 'line-a' }),
      ],
    });
    const derived = deriveCadSurveyTable(
      subject,
      projectWith([line('line-a', [0, 0], [100, 0])]),
    );
    expect(derived.status).toBe('PARTIAL_BROKEN_REFERENCE');
    expect(derived.rows).toHaveLength(2);
    expect(derived.rows[0]!.status).toBe('missing');
    expect(derived.rows[0]!.cells.slice(1)).toEqual(['—', '—', '—', '—']);
    expect(derived.rows[0]!.code).toBe('L1');
  });

  it('status is EMPTY / CURRENT / BROKEN_REFERENCE as expected', () => {
    const empty = table({ rows: [] });
    const project = projectWith([]);
    expect(deriveCadSurveyTable(empty, project).status).toBe('EMPTY');
    const current = table({ rows: [row({ kind: 'line', entityId: 'line-a' })] });
    expect(deriveCadSurveyTable(current, projectWith([line('line-a', [0, 0], [1, 1])])).status).toBe(
      'CURRENT',
    );
    const broken = table({ rows: [row({ kind: 'line', entityId: 'nope' })] });
    expect(deriveCadSurveyTable(broken, project).status).toBe('BROKEN_REFERENCE');
  });

  it('parcel-course rows resolve canonical course ids', () => {
    const parcel = rectParcel();
    const courseId = parcel.courseIds![0]!;
    const subject = table({
      tableKind: 'parcel-course',
      rows: [row({ kind: 'parcel-course', parcelId: parcel.id, courseId })],
    });
    const derived = deriveCadSurveyTable(subject, projectWith([parcel]));
    expect(derived.status).toBe('CURRENT');
    expect(derived.rows[0]!.cells[0]).toBe('PC1');
    expect(derived.rows[0]!.cells[1]).toBe('A');
    expect(derived.rows[0]!.cells[2]).toBe('B');
    expect(derived.rows[0]!.cells[4]).toBe('100.000');
    expect(derived.rows[0]!.anchor).toEqual({ x: 50, y: 0 });
  });

  it('column visibility toggles and heading overrides change the registry, not values', () => {
    const subject = table({
      rows: [row({ kind: 'line', entityId: 'line-a' })],
      columnOverrides: [
        { key: 'distance', visible: false },
        { key: 'bearing', heading: 'Brg' },
      ],
    });
    const derived = deriveCadSurveyTable(
      subject,
      projectWith([line('line-a', [0, 0], [100, 0])]),
    );
    expect(derived.columns.map((column) => column.key)).toEqual(['code', 'from', 'to', 'bearing']);
    expect(derived.columns.at(-1)!.label).toBe('Brg');
    expect(derived.rows[0]!.cells).toEqual(['L1', 'line-a-A', 'line-a-B', 'N90-00-00.00E']);
  });
});

describe('19A survey table geometry and style', () => {
  it('a style change alters geometry but never the string values', () => {
    const subject = table({ rows: [row({ kind: 'line', entityId: 'line-a' })] });
    const base = createBlankCadProject({ name: 's', units: 'm' });
    const project = { ...base, entities: [line('line-a', [0, 0], [100, 0])] };
    const first = deriveCadSurveyTable(subject, project);
    const taller = {
      ...project,
      surveyTableStyles: [
        { ...project.surveyTableStyles![0]!, rowHeight: 5 },
      ],
    };
    const second = deriveCadSurveyTable(subject, taller);
    expect(second.metrics.tableHeight).toBeGreaterThan(first.metrics.tableHeight);
    expect(second.rows.map((entry) => entry.cells)).toEqual(first.rows.map((entry) => entry.cells));
  });

  it('paper 1:500 -> 1:1000 doubles model geometry with identical strings', () => {
    const subject = table({
      rows: [row({ kind: 'line', entityId: 'line-a' })],
      tableStyleId: 'paper-style',
    });
    const paperStyle = {
      ...createDefaultCadSurveyTableStyle(),
      id: 'paper-style',
      rowHeight: 10,
      rowHeightMode: 'paper' as const,
      cellPadding: 2,
      cellPaddingMode: 'paper' as const,
    };
    const build = (denominator: number): CadProject => ({
      ...createBlankCadProject({ name: 'paper', units: 'm' }),
      entities: [line('line-a', [0, 0], [100, 0])],
      surveyTableStyles: [paperStyle],
      annotationSettings: { scaleDenominator: denominator },
    });
    const at500 = deriveCadSurveyTable(subject, build(500));
    const at1000 = deriveCadSurveyTable(subject, build(1000));
    expect(at1000.metrics.rowHeightModel).toBeCloseTo(at500.metrics.rowHeightModel * 2, 9);
    // Padding scales with the plot scale too; the strings must not move.
    expect(at1000.metrics.columnWidths[0]!).toBeGreaterThan(at500.metrics.columnWidths[0]!);
    expect(at1000.rows[0]!.cells).toEqual(at500.rows[0]!.cells);
  });

  it('MOVE changes x/y only and rotation composes under transform', () => {
    const subject = table({ rotationDeg: 30 });
    const moved = translateEntity(subject, 25, -15) as CadSurveyTableEntity;
    expect(moved.x).toBe(525);
    expect(moved.y).toBe(385);
    expect(moved.rotationDeg).toBe(30);
    expect(moved.rows).toEqual(subject.rows);
    const transform = compose(translation(100, 200), rotationAbout(0, 0, 90));
    const classification = classifyTransform(transform)!;
    const result = transformCadEntityGeometry(subject, transform, classification);
    expect(result.ok).toBe(true);
    if (result.ok && result.entity.type === 'survey-table') {
      expect(result.entity.x).toBeCloseTo(-300, 9);
      expect(result.entity.y).toBeCloseTo(700, 9);
      expect(result.entity.rotationDeg).toBeCloseTo(120, 9);
    } else {
      throw new Error('expected transformed survey table');
    }
  });

  it('tags derive near the line midpoint normal, honour manual offset and toggles', () => {
    const subject = table({ rows: [row({ kind: 'line', entityId: 'line-a' })] });
    const project = projectWith([line('line-a', [0, 0], [100, 0])]);
    const derived = deriveCadSurveyTable(subject, project);
    expect(derived.tags).toHaveLength(1);
    expect(derived.tags[0]!.code).toBe('L1');
    expect(derived.tags[0]!.anchorX).toBe(50);
    expect(derived.tags[0]!.anchorY).toBe(0);
    expect(derived.tags[0]!.y).toBeGreaterThan(0);
    expect(derived.tags[0]!.rotationDeg).toBe(0);
    const withOffset = deriveCadSurveyTable(
      table({ rows: [row({ kind: 'line', entityId: 'line-a' }, { tagOffset: { dx: 4, dy: -2 } })] }),
      project,
    );
    expect(withOffset.tags[0]!.x).toBe(54);
    expect(withOffset.tags[0]!.y).toBeCloseTo(derived.tags[0]!.y - 2, 9);
    const hidden = deriveCadSurveyTable(
      table({ rows: [row({ kind: 'line', entityId: 'line-a' })], tagSettings: { showTags: false } }),
      project,
    );
    expect(hidden.tags).toHaveLength(0);
    const prefixed = deriveCadSurveyTable(
      table({
        rows: [row({ kind: 'line', entityId: 'line-a' })],
        tagSettings: { showTags: true, tagPrefix: 'T-' },
      }),
      project,
    );
    expect(prefixed.tags[0]!.code).toBe('T-L1');
  });

  it('renders bounded primitives that all carry the entity id, and bounds stay finite', () => {
    const subject = table({
      rows: [
        row({ kind: 'line', entityId: 'line-a' }),
        row({ kind: 'line', entityId: 'line-b' }),
      ],
      title: 'Survey Table',
    });
    const project = projectWith([
      line('line-a', [0, 0], [100, 0]),
      line('line-b', [0, 0], [0, 50]),
    ]);
    const derived = deriveCadSurveyTable(subject, project);
    const primitives = buildCadSurveyTablePrimitives(subject, project, {
      stroke: '#fff',
      strokeWidthPx: 1,
      fontSize: 11,
      tagFontSize: 9,
    });
    expect(primitives.length).toBeLessThan(derived.grid.lines.length + 30);
    expect(primitives.every((entry) => entry.sourceEntityId === subject.id)).toBe(true);
    const bounds = cadSurveyTableWorldBounds(subject, project)!;
    expect(Number.isFinite(bounds.minX)).toBe(true);
    expect(bounds.maxX).toBeGreaterThan(bounds.minX);
    const large = {
      ...subject,
      x: 1_000_000,
      y: 5_000_000,
    };
    const largeBounds = cadSurveyTableWorldBounds(large, project)!;
    expect(Number.isFinite(largeBounds.minY)).toBe(true);
    expect(largeBounds.minX).toBeGreaterThan(999_000);
  });
});

describe('19A survey table persistence and styles', () => {
  it('broken rows and options survive a WNCAD save/reopen without derived data', () => {
    const document = createBlankCadDrawingDocument({ name: 'table-wncad', units: 'm' });
    const subject = table({
      rows: [
        row({ kind: 'line', entityId: 'missing-line' }),
        row({ kind: 'line', entityId: 'line-a' }, { customCode: 'CUSTOM', tagOffset: { dx: 3, dy: 4 } }),
      ],
      title: 'Persisted',
      prefix: 'L',
      startNumber: 3,
      tagSettings: { showTags: true, tagPrefix: 'T-' },
      columnOverrides: [{ key: 'bearing', heading: 'Brg' }],
    });
    const project: CadProject = {
      ...document.project,
      entities: [subject, line('line-a', [0, 0], [100, 0])],
      surveyTableStyles: [
        { ...createDefaultCadSurveyTableStyle(), id: 'custom-style', name: 'Custom' },
      ],
      currentSurveyTableStyleId: 'custom-style',
    };
    const bytes = serializeCadDrawingFile({ ...document, project });
    expect(bytes.includes('"cells"')).toBe(false);
    expect(bytes.includes('N90-00-00.00E')).toBe(false);
    const parsed = parseCadDrawingFile(bytes);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reopened = parsed.drawing.project.entities.find(
      (entity): entity is CadSurveyTableEntity => entity.type === 'survey-table',
    )!;
    expect(reopened.rows).toHaveLength(2);
    expect(reopened.rows[1]!.customCode).toBe('CUSTOM');
    expect(reopened.rows[1]!.tagOffset).toEqual({ dx: 3, dy: 4 });
    expect(reopened.title).toBe('Persisted');
    expect(reopened.startNumber).toBe(3);
    expect(reopened.tagSettings).toEqual({ showTags: true, tagPrefix: 'T-' });
    expect(reopened.columnOverrides).toEqual([{ key: 'bearing', heading: 'Brg' }]);
    expect(parsed.drawing.project.surveyTableStyles?.map((style) => style.id)).toContain(
      'custom-style',
    );
    expect(parsed.drawing.project.currentSurveyTableStyleId).toBe('custom-style');
    const derived = deriveCadSurveyTable(reopened, parsed.drawing.project);
    expect(derived.status).toBe('PARTIAL_BROKEN_REFERENCE');
    expect(derived.rows[0]!.status).toBe('missing');
    expect(derived.rows[1]!.code).toBe('CUSTOM');
  });

  it('seeds the Standard Survey Table style on a fresh drawing', () => {
    const project = createBlankCadProject({ name: 'fresh', units: 'm' });
    const style = project.surveyTableStyles?.find(
      (entry) => entry.id === DEFAULT_CAD_SURVEY_TABLE_STYLE_ID,
    );
    expect(style?.name).toBe('Standard');
  });

  it('style manager ops: new/duplicate/rename/delete-when-unused/set current', () => {
    const base = createBlankCadProject({ name: 'styles', units: 'm' });
    const withNew = createCadSurveyTableStyle(base, { name: 'Lot Table' });
    expect(withNew.surveyTableStyles).toHaveLength(2);
    const created = withNew.surveyTableStyles!.find((style) => style.name === 'Lot Table')!;
    expect(created.id).toBe(buildCadSurveyTableStyleId('Lot Table', base.surveyTableStyles!));

    const withDuplicate = duplicateCadSurveyTableStyle(withNew, created.id, { name: 'Lot Table 2' });
    expect(withDuplicate.surveyTableStyles).toHaveLength(3);

    const renamed = renameCadSurveyTableStyle(withDuplicate, created.id, 'Lot Table A');
    expect(renamed.surveyTableStyles!.find((style) => style.id === created.id)!.name).toBe(
      'Lot Table A',
    );

    const withTable: CadProject = {
      ...renamed,
      entities: [table({ tableStyleId: created.id })],
    };
    expect(deleteCadSurveyTableStyle(withTable, created.id)).toEqual({
      ok: false,
      reason: 'IN_USE',
    });

    const withoutTable = { ...renamed, entities: [] };
    const deleted = deleteCadSurveyTableStyle(withoutTable, created.id);
    expect(deleted.ok).toBe(true);
    if (deleted.ok) {
      expect(deleted.project.surveyTableStyles).toHaveLength(2);
    }

    const current = setCurrentCadSurveyTableStyle(withoutTable, created.id);
    expect(current.currentSurveyTableStyleId).toBe(created.id);

    const single = createCadSurveyTableStyle(
      { ...base, surveyTableStyles: [createDefaultCadSurveyTableStyle()] },
      { name: 'Only', id: 'only-style', seedStyleId: DEFAULT_CAD_SURVEY_TABLE_STYLE_ID },
    );
    const sole = { ...single, surveyTableStyles: [single.surveyTableStyles!.at(-1)!] };
    expect(deleteCadSurveyTableStyle(sole, sole.surveyTableStyles![0]!.id)).toEqual({
      ok: false,
      reason: 'LAST_STYLE',
    });
    expect(deleteCadSurveyTableStyle(withoutTable, 'does-not-exist')).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });
  });
});
