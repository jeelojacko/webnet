/**
 * Phase 19A survey table helpers. A `survey-table` entity stores placement,
 * style, and an ordered list of SOURCE REFERENCES; every displayed value is
 * derived here at read time (parity with the associative annotation pattern).
 * No geometry or text is baked into the entity.
 */
import { cadBuildCurveMetricsSummaryFromRadiusDelta } from './cadCogoCurveMetrics';
import {
  cadBuildParcelReportSummary,
} from './cadCogoParcelGeometrySummaries';
import { resolveCadParcelCourses } from './cadParcelCourses';
import { formatCadBearing } from './cadCogoSummaries';
import { cadDistance, cadSignedSweepDeg } from './cadGeometry';
import type {
  CadEntity,
  CadEntityId,
  CadParcelEntity,
  CadProject,
  CadSurveyTableEntity,
  CadSurveyTableKind,
  CadSurveyTableRow,
  CadSurveyTableRowSource,
  CadSurveyTableStyle,
  CadSurveyTableTagSettings,
} from './cadTypes';

export interface CadSurveyTableCreatePayload {
  /** Insertion point (world/drawing units). */
  insertX: number;
  insertY: number;
  /** Selected source entities in selection order (parcel id for parcel kinds). */
  sourceEntityIds: CadEntityId[];
  title?: string;
  prefix?: string;
  startNumber?: number;
  styleId?: string;
  rotationDeg?: number;
}

export interface CadParcelTableCreatePayload {
  parcelEntityId: CadEntityId;
  insertX: number;
  insertY: number;
  title?: string;
  styleId?: string;
  rotationDeg?: number;
}

export interface CadSurveyTableOptionsPatch {
  title?: string;
  prefix?: string;
  startNumber?: number;
  showHeader?: boolean;
  showTitle?: boolean;
  tableStyleId?: string;
  rotationDeg?: number;
  x?: number;
  y?: number;
  tagSettings?: CadSurveyTableTagSettings;
}

export type CadSurveyTableEdit =
  | { kind: 'add-row'; source: CadSurveyTableRowSource }
  | { kind: 'remove-row'; rowId: string }
  | { kind: 'reorder-row'; rowId: string; direction: 'up' | 'down' }
  | { kind: 'replace-source'; rowId: string; source: CadSurveyTableRowSource }
  | { kind: 'set-custom-code'; rowId: string; customCode: string }
  | { kind: 'move-tag'; rowId: string; dx: number; dy: number }
  | { kind: 'set-options'; patch: CadSurveyTableOptionsPatch }
  | { kind: 'delete' };

export interface CadSurveyTableStyleCommandPayload {
  action: 'create' | 'duplicate' | 'rename' | 'update' | 'delete';
  styleId?: string;
  name?: string;
  patch?: Partial<CadSurveyTableStyle>;
}

export interface CadSurveyTableResolvedColumn {
  key: string;
  label: string;
}

export interface CadSurveyTableResolvedValue {
  key: string;
  label: string;
  value: string;
}

export interface CadSurveyTableResolvedRow {
  rowId: string;
  index: number;
  /** Prefix + running number, or the explicit custom code. */
  code: string;
  sourceLabel: string;
  status: 'ok' | 'missing';
  values: CadSurveyTableResolvedValue[];
  showTag: boolean;
  tagOffset: { dx: number; dy: number };
}

export const DEFAULT_CAD_SURVEY_TABLE_STYLE_ID = 'survey-table-style-standard';

export const createDefaultCadSurveyTableStyle = (): CadSurveyTableStyle => ({
  id: DEFAULT_CAD_SURVEY_TABLE_STYLE_ID,
  name: 'Standard',
  textStyleId: 'standard',
  headerTextStyleId: 'standard',
  rowHeight: 2.5,
  rowHeightMode: 'paper',
  cellPadding: 0.6,
  cellPaddingMode: 'paper',
  borderWidth: 0.25,
  showOuterBorder: true,
  showInnerGrid: true,
  headerAlignment: 'center',
  bodyAlignment: 'left',
  titleGap: 1.2,
  description: 'Default survey table style.',
});

export const CAD_SURVEY_TABLE_KIND_LABELS: Record<CadSurveyTableKind, string> = {
  line: 'Line',
  curve: 'Curve',
  'parcel-course': 'Parcel Course',
  'parcel-summary': 'Parcel Summary',
  point: 'Point',
};

const COLUMNS_BY_KIND: Record<CadSurveyTableKind, CadSurveyTableResolvedColumn[]> = {
  line: [
    { key: 'from', label: 'From' },
    { key: 'to', label: 'To' },
    { key: 'bearing', label: 'Bearing' },
    { key: 'distance', label: 'Distance' },
  ],
  curve: [
    { key: 'radius', label: 'Radius' },
    { key: 'delta', label: 'Delta' },
    { key: 'arc', label: 'Arc' },
    { key: 'chord', label: 'Chord' },
  ],
  'parcel-course': [
    { key: 'from', label: 'From' },
    { key: 'to', label: 'To' },
    { key: 'bearing', label: 'Bearing' },
    { key: 'distance', label: 'Distance' },
  ],
  'parcel-summary': [
    { key: 'parcel', label: 'Parcel' },
    { key: 'area', label: 'Area' },
    { key: 'perimeter', label: 'Perimeter' },
    { key: 'closure', label: 'Closure' },
  ],
  point: [
    { key: 'easting', label: 'Easting' },
    { key: 'northing', label: 'Northing' },
    { key: 'elevation', label: 'Elevation' },
    { key: 'description', label: 'Description' },
  ],
};

export const cadSurveyTableColumns = (
  kind: CadSurveyTableKind,
): readonly CadSurveyTableResolvedColumn[] => COLUMNS_BY_KIND[kind];

export const cadSurveyTableKindLabel = (kind: CadSurveyTableKind): string =>
  CAD_SURVEY_TABLE_KIND_LABELS[kind];

export const resolveCadSurveyTableStyle = (
  project: CadProject,
  styleId: string,
): CadSurveyTableStyle =>
  project.surveyTableStyles?.find((style) => style.id === styleId) ??
  createDefaultCadSurveyTableStyle();

export const ensureCadSurveyTableStyles = (project: CadProject): CadSurveyTableStyle[] =>
  project.surveyTableStyles && project.surveyTableStyles.length > 0
    ? project.surveyTableStyles
    : [createDefaultCadSurveyTableStyle()];

export const cadSurveyTableRowSourceKey = (source: CadSurveyTableRowSource): string => {
  switch (source.kind) {
    case 'parcel-course':
      return `${source.kind}:${source.parcelId}:${source.courseId}`;
    case 'parcel':
      return `${source.kind}:${source.parcelId}`;
    default:
      return `${source.kind}:${source.entityId}`;
  }
};

export const nextCadSurveyTableRowId = (
  rows: readonly CadSurveyTableRow[],
  source: CadSurveyTableRowSource,
): string => {
  const base = cadSurveyTableRowSourceKey(source);
  const existing = new Set(rows.map((row) => row.id));
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}#${suffix}`)) suffix += 1;
  return `${base}#${suffix}`;
};

export const createCadSurveyTableRow = (source: CadSurveyTableRowSource): CadSurveyTableRow => ({
  id: cadSurveyTableRowSourceKey(source),
  source,
});

const pushUniqueRow = (
  rows: CadSurveyTableRow[],
  source: CadSurveyTableRowSource,
): void => {
  const key = cadSurveyTableRowSourceKey(source);
  if (rows.some((row) => cadSurveyTableRowSourceKey(row.source) === key)) return;
  rows.push(createCadSurveyTableRow(source));
};

/** Rows for a line/curve/point table from selected (or all) source entities. */
export const buildCadSurveyTableRowsForSelection = (
  project: CadProject,
  kind: CadSurveyTableKind,
  sourceEntityIds: readonly CadEntityId[],
): CadSurveyTableRow[] => {
  const rows: CadSurveyTableRow[] = [];
  if (kind === 'line' || kind === 'curve') {
    const expected = kind === 'line' ? 'line' : 'arc';
    for (const entityId of sourceEntityIds) {
      const entity = project.entities.find((entry) => entry.id === entityId);
      if (entity?.type === expected) pushUniqueRow(rows, { kind: expected, entityId });
    }
    return rows;
  }
  if (kind === 'point') {
    for (const entityId of sourceEntityIds) {
      const entity = project.entities.find((entry) => entry.id === entityId);
      if (entity?.type === 'survey-point') pushUniqueRow(rows, { kind: 'survey-point', entityId });
    }
    return rows;
  }
  // Parcel kinds resolve from the selected parcel id in `sourceEntityIds`.
  const parcelId = sourceEntityIds.find((entityId) =>
    project.entities.some((entry) => entry.id === entityId && entry.type === 'parcel'),
  );
  return parcelId ? buildCadSurveyTableRowsForParcel(project, kind, parcelId) : [];
};

export const buildCadSurveyTableRowsForParcel = (
  project: CadProject,
  kind: CadSurveyTableKind,
  parcelId: CadEntityId,
): CadSurveyTableRow[] => {
  const parcel = project.entities.find(
    (entity): entity is CadParcelEntity => entity.id === parcelId && entity.type === 'parcel',
  );
  if (!parcel) return [];
  if (kind === 'parcel-summary') return [createCadSurveyTableRow({ kind: 'parcel', parcelId })];
  if (kind !== 'parcel-course') return [];
  // Stable course identity: rows bind parcelId + courseId, never raw index (§130).
  return resolveCadParcelCourses(parcel).map((course) =>
    createCadSurveyTableRow({ kind: 'parcel-course', parcelId, courseId: course.courseId }),
  );
};

/** Default prefix per kind (industry table style); callers may override. */
export const defaultCadSurveyTablePrefix = (kind: CadSurveyTableKind): string => {
  switch (kind) {
    case 'line':
      return 'L';
    case 'curve':
      return 'C';
    case 'parcel-course':
      return 'PC';
    case 'parcel-summary':
      return 'P';
    case 'point':
      return 'PT';
  }
};

export const resolveCadSurveyTableRowCode = (
  entity: CadSurveyTableEntity,
  index: number,
): string => {
  const row = entity.rows[index];
  if (row?.customCode != null && row.customCode.length > 0) return row.customCode;
  const start = entity.startNumber ?? 1;
  const prefix = entity.prefix ?? '';
  return `${prefix}${start + index}`;
};

const missingRow = (
  entity: CadSurveyTableEntity,
  row: CadSurveyTableRow,
  index: number,
  sourceLabel: string,
): CadSurveyTableResolvedRow => ({
  rowId: row.id,
  index,
  code: resolveCadSurveyTableRowCode(entity, index),
  sourceLabel,
  status: 'missing',
  values: cadSurveyTableColumns(entity.tableKind).map((column) => ({
    key: column.key,
    label: column.label,
    value: '—',
  })),
  showTag: row.showTag ?? entity.tagSettings?.showTags ?? false,
  tagOffset: row.tagOffset ?? entity.tagSettings?.tagOffset ?? { dx: 0, dy: 0 },
});

const resolvedRow = (
  entity: CadSurveyTableEntity,
  row: CadSurveyTableRow,
  index: number,
  sourceLabel: string,
  values: CadSurveyTableResolvedValue[],
): CadSurveyTableResolvedRow => ({
  rowId: row.id,
  index,
  code: resolveCadSurveyTableRowCode(entity, index),
  sourceLabel,
  status: 'ok',
  values,
  showTag: row.showTag ?? entity.tagSettings?.showTags ?? false,
  tagOffset: row.tagOffset ?? entity.tagSettings?.tagOffset ?? { dx: 0, dy: 0 },
});

const findEntity = (project: CadProject, entityId: CadEntityId): CadEntity | null =>
  project.entities.find((entity) => entity.id === entityId) ?? null;

const formatDistance = (value: number): string => value.toFixed(3);

const resolveLineRow = (
  project: CadProject,
  entity: CadSurveyTableEntity,
  row: CadSurveyTableRow,
  index: number,
  entityId: CadEntityId,
): CadSurveyTableResolvedRow => {
  const line = findEntity(project, entityId);
  if (!line || line.type !== 'line') {
    return missingRow(entity, row, index, `Line ${entityId}`);
  }
  const bearing = formatCadBearing(
    (Math.atan2(line.toX - line.fromX, line.toY - line.fromY) * 180) / Math.PI,
  );
  const distance = cadDistance(
    { x: line.fromX, y: line.fromY },
    { x: line.toX, y: line.toY },
  );
  return resolvedRow(entity, row, index, `${line.fromStationId}–${line.toStationId}`, [
    { key: 'from', label: 'From', value: line.fromStationId },
    { key: 'to', label: 'To', value: line.toStationId },
    { key: 'bearing', label: 'Bearing', value: bearing },
    { key: 'distance', label: 'Distance', value: formatDistance(distance) },
  ]);
};

const resolveArcRow = (
  project: CadProject,
  entity: CadSurveyTableEntity,
  row: CadSurveyTableRow,
  index: number,
  entityId: CadEntityId,
): CadSurveyTableResolvedRow => {
  const arc = findEntity(project, entityId);
  if (!arc || arc.type !== 'arc') return missingRow(entity, row, index, `Curve ${entityId}`);
  const deltaDeg = Math.abs(cadSignedSweepDeg(arc.startAngleDeg, arc.endAngleDeg));
  const metrics = cadBuildCurveMetricsSummaryFromRadiusDelta(arc.radius, deltaDeg);
  if (!metrics) return missingRow(entity, row, index, `Curve ${entityId}`);
  return resolvedRow(entity, row, index, arc.id, [
    { key: 'radius', label: 'Radius', value: formatDistance(metrics.radius) },
    { key: 'delta', label: 'Delta', value: `${metrics.deltaDeg.toFixed(2)}°` },
    { key: 'arc', label: 'Arc', value: formatDistance(metrics.arcLength) },
    { key: 'chord', label: 'Chord', value: formatDistance(metrics.chordLength) },
  ]);
};

const resolvePointRow = (
  project: CadProject,
  entity: CadSurveyTableEntity,
  row: CadSurveyTableRow,
  index: number,
  entityId: CadEntityId,
): CadSurveyTableResolvedRow => {
  const point = findEntity(project, entityId);
  if (!point || point.type !== 'survey-point') {
    return missingRow(entity, row, index, `Point ${entityId}`);
  }
  return resolvedRow(entity, row, index, point.stationId, [
    { key: 'easting', label: 'Easting', value: point.x.toFixed(3) },
    { key: 'northing', label: 'Northing', value: point.y.toFixed(3) },
    {
      key: 'elevation',
      label: 'Elevation',
      value: point.z == null ? '—' : point.z.toFixed(3),
    },
    { key: 'description', label: 'Description', value: point.description ?? '' },
  ]);
};

const resolveParcelSummaryRow = (
  project: CadProject,
  entity: CadSurveyTableEntity,
  row: CadSurveyTableRow,
  index: number,
  parcelId: CadEntityId,
): CadSurveyTableResolvedRow => {
  const parcel = findEntity(project, parcelId);
  if (!parcel || parcel.type !== 'parcel') {
    return missingRow(entity, row, index, `Parcel ${parcelId}`);
  }
  const report = cadBuildParcelReportSummary({
    parcelName: parcel.parcelName,
    vertices: parcel.vertices,
    vertexLabels: parcel.vertexLabels,
  });
  if (!report) return missingRow(entity, row, index, parcel.parcelName);
  return resolvedRow(entity, row, index, report.parcelName, [
    { key: 'parcel', label: 'Parcel', value: report.parcelName },
    { key: 'area', label: 'Area', value: report.areaSquareMeters.toFixed(3) },
    { key: 'perimeter', label: 'Perimeter', value: report.perimeterMeters.toFixed(3) },
    { key: 'closure', label: 'Closure', value: report.closureDistanceMeters.toFixed(3) },
  ]);
};

const resolveParcelCourseRow = (
  project: CadProject,
  entity: CadSurveyTableEntity,
  row: CadSurveyTableRow,
  index: number,
  parcelId: CadEntityId,
  courseId: string,
): CadSurveyTableResolvedRow => {
  const parcel = findEntity(project, parcelId);
  if (!parcel || parcel.type !== 'parcel') {
    return missingRow(entity, row, index, `Parcel ${parcelId}`);
  }
  const courses = resolveCadParcelCourses(parcel);
  // Exact stable-ID match only. No raw-index fallback: after a topology change
  // an old courseId must surface BROKEN_REFERENCE, never silently rebind (§130).
  const course = courses.find((entry) => entry.courseId === courseId);
  if (!course) return missingRow(entity, row, index, parcel.parcelName);
  return resolvedRow(entity, row, index, `${course.fromLabel}–${course.toLabel}`, [
    { key: 'from', label: 'From', value: course.fromLabel },
    { key: 'to', label: 'To', value: course.toLabel },
    { key: 'bearing', label: 'Bearing', value: course.bearing },
    { key: 'distance', label: 'Distance', value: formatDistance(course.distanceMeters) },
  ]);
};

export const resolveCadSurveyTableRow = (
  project: CadProject,
  entity: CadSurveyTableEntity,
  row: CadSurveyTableRow,
  index: number,
): CadSurveyTableResolvedRow => {
  const source = row.source;
  switch (source.kind) {
    case 'line':
      return resolveLineRow(project, entity, row, index, source.entityId);
    case 'arc':
      return resolveArcRow(project, entity, row, index, source.entityId);
    case 'survey-point':
      return resolvePointRow(project, entity, row, index, source.entityId);
    case 'parcel':
      return resolveParcelSummaryRow(project, entity, row, index, source.parcelId);
    case 'parcel-course':
      return resolveParcelCourseRow(
        project,
        entity,
        row,
        index,
        source.parcelId,
        source.courseId,
      );
  }
};

export const resolveCadSurveyTableRows = (
  project: CadProject,
  entity: CadSurveyTableEntity,
): CadSurveyTableResolvedRow[] =>
  entity.rows.map((row, index) => resolveCadSurveyTableRow(project, entity, row, index));

/** True when the table's own layer (or the entity) is locked. */
export const isCadSurveyTableLocked = (project: CadProject, entity: CadSurveyTableEntity): boolean => {
  if (entity.locked) return true;
  return project.layers.find((layer) => layer.id === entity.layerId)?.locked === true;
};
