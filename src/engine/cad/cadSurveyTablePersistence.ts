/**
 * Phase 19A slice B — survey table load-path helpers (backfill + sanitize).
 *
 * Schema stays 2 (all tables additive + trailing). Rules mirror the Phase 18O
 * annotation slice:
 *  - Missing style table backfills with the seed "Standard Survey Table".
 *  - Existing styles sanitize in place: finite positive numerics, bounded
 *    enums, unique ids. Ids are never invented.
 *  - `survey-table` entities sanitize placement/rows shape-only: dangling
 *    source refs stay dangling and resolve to a visible BROKEN row — never
 *    re-bound, never dropped.
 */
import type {
  CadEntity,
  CadProject,
  CadSurveyTableEntity,
  CadSurveyTableRow,
  CadSurveyTableRowSource,
  CadSurveyTableStyle,
} from './cadTypes';
import {
  createDefaultCadSurveyTableStyle,
  ensureCadSurveyTableStyles,
} from './cadSurveyTables';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const positiveOr = (value: unknown, fallback: number): number =>
  isFiniteNumber(value) && value > 0 ? value : fallback;

const nonNegativeOr = (value: unknown, fallback: number): number =>
  isFiniteNumber(value) && value >= 0 ? value : fallback;

const stringOr = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.length > 0 ? value : fallback;

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const ALIGNMENTS = ['left', 'center', 'right'] as const;
const DIMENSION_MODES = ['model', 'paper'] as const;

const alignmentOr = (
  value: unknown,
  fallback: CadSurveyTableStyle['headerAlignment'],
): CadSurveyTableStyle['headerAlignment'] =>
  typeof value === 'string' && (ALIGNMENTS as readonly string[]).includes(value)
    ? (value as CadSurveyTableStyle['headerAlignment'])
    : fallback;

const dimensionModeOr = (value: unknown): 'model' | 'paper' | undefined =>
  typeof value === 'string' && (DIMENSION_MODES as readonly string[]).includes(value)
    ? (value as 'model' | 'paper')
    : undefined;

/** Seed the table when absent/empty; never touches a present table. */
export function backfillCadSurveyTableStyles(
  styles: readonly CadSurveyTableStyle[] | undefined,
): CadSurveyTableStyle[] {
  return styles == null || styles.length === 0
    ? [createDefaultCadSurveyTableStyle()]
    : styles.map((style) => ({ ...style }));
}

export function cloneCadSurveyTableStyles(
  styles: readonly CadSurveyTableStyle[] | undefined,
): CadSurveyTableStyle[] {
  return (styles ?? []).map((style) => ({ ...style }));
}

export function sanitizeCadSurveyTableStyle(value: unknown): CadSurveyTableStyle | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.length === 0) return undefined;
  const seed = createDefaultCadSurveyTableStyle();
  const rowHeightMode = dimensionModeOr(value.rowHeightMode);
  const cellPaddingMode = dimensionModeOr(value.cellPaddingMode);
  return {
    id: value.id,
    name: stringOr(value.name, value.id),
    textStyleId: stringOr(value.textStyleId, seed.textStyleId),
    ...(optionalString(value.headerTextStyleId) != null
      ? { headerTextStyleId: optionalString(value.headerTextStyleId) }
      : {}),
    rowHeight: positiveOr(value.rowHeight, seed.rowHeight),
    rowHeightMode: rowHeightMode ?? seed.rowHeightMode,
    cellPadding: positiveOr(value.cellPadding, seed.cellPadding),
    cellPaddingMode: cellPaddingMode ?? seed.cellPaddingMode,
    borderWidth: nonNegativeOr(value.borderWidth, seed.borderWidth),
    showOuterBorder: value.showOuterBorder !== false,
    showInnerGrid: value.showInnerGrid !== false,
    headerAlignment: alignmentOr(value.headerAlignment, seed.headerAlignment),
    bodyAlignment: alignmentOr(value.bodyAlignment, seed.bodyAlignment),
    titleGap: nonNegativeOr(value.titleGap, seed.titleGap),
    ...(optionalString(value.description) != null
      ? { description: optionalString(value.description) }
      : {}),
  };
}

const uniqueById = <T extends { id: string }>(entries: readonly T[]): T[] => {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    result.push(entry);
  }
  return result;
};

const sanitizeRowSource = (value: unknown): CadSurveyTableRowSource | undefined => {
  if (!isRecord(value)) return undefined;
  switch (value.kind) {
    case 'line':
    case 'arc':
    case 'survey-point':
      return typeof value.entityId === 'string' && value.entityId.length > 0
        ? { kind: value.kind, entityId: value.entityId }
        : undefined;
    case 'parcel':
      return typeof value.parcelId === 'string' && value.parcelId.length > 0
        ? { kind: 'parcel', parcelId: value.parcelId }
        : undefined;
    case 'parcel-course':
      return typeof value.parcelId === 'string' &&
        value.parcelId.length > 0 &&
        typeof value.courseId === 'string' &&
        value.courseId.length > 0
        ? { kind: 'parcel-course', parcelId: value.parcelId, courseId: value.courseId }
        : undefined;
    default:
      return undefined;
  }
};

const pointOrUndefined = (value: unknown): { dx: number; dy: number } | undefined => {
  if (!isRecord(value)) return undefined;
  return isFiniteNumber(value.dx) && isFiniteNumber(value.dy)
    ? { dx: value.dx, dy: value.dy }
    : undefined;
};

const sanitizeRow = (value: unknown, index: number): CadSurveyTableRow | undefined => {
  if (!isRecord(value)) return undefined;
  const source = sanitizeRowSource(value.source);
  if (!source) return undefined;
  return {
    id: stringOr(value.id, `row-${index + 1}`),
    source,
    ...(optionalString(value.customCode) != null ? { customCode: optionalString(value.customCode) } : {}),
    ...(pointOrUndefined(value.tagOffset) != null ? { tagOffset: pointOrUndefined(value.tagOffset) } : {}),
    ...(typeof value.showTag === 'boolean' ? { showTag: value.showTag } : {}),
  };
};

export function sanitizeCadSurveyTableEntity(
  entity: CadSurveyTableEntity,
): CadSurveyTableEntity | undefined {
  if (typeof entity.id !== 'string' || entity.id.length === 0) return undefined;
  const tableKind =
    entity.tableKind === 'line' ||
    entity.tableKind === 'curve' ||
    entity.tableKind === 'parcel-course' ||
    entity.tableKind === 'parcel-summary' ||
    entity.tableKind === 'point'
      ? entity.tableKind
      : 'line';
  const rows = Array.isArray(entity.rows)
    ? entity.rows
        .map((row, index) => sanitizeRow(row, index))
        .filter((row): row is CadSurveyTableRow => row != null)
    : [];
  const tagSettings = isRecord(entity.tagSettings)
    ? {
        ...(typeof entity.tagSettings.showTags === 'boolean'
          ? { showTags: entity.tagSettings.showTags }
          : {}),
        ...(optionalString(entity.tagSettings.tagPrefix) != null
          ? { tagPrefix: optionalString(entity.tagSettings.tagPrefix) }
          : {}),
        ...(optionalString(entity.tagSettings.tagTextStyleId) != null
          ? { tagTextStyleId: optionalString(entity.tagSettings.tagTextStyleId) }
          : {}),
        ...(pointOrUndefined(entity.tagSettings.tagOffset) != null
          ? { tagOffset: pointOrUndefined(entity.tagSettings.tagOffset) }
          : {}),
      }
    : undefined;
  const columnOverrides = Array.isArray(entity.columnOverrides)
    ? entity.columnOverrides.filter(
        (override): override is NonNullable<typeof override> =>
          override != null && typeof override.key === 'string' && override.key.length > 0,
      )
    : undefined;
  return {
    ...entity,
    tableKind,
    x: isFiniteNumber(entity.x) ? entity.x : 0,
    y: isFiniteNumber(entity.y) ? entity.y : 0,
    rotationDeg: isFiniteNumber(entity.rotationDeg) ? entity.rotationDeg : 0,
    tableStyleId: stringOr(entity.tableStyleId, createDefaultCadSurveyTableStyle().id),
    rows,
    ...(optionalString(entity.title) != null ? { title: entity.title } : {}),
    ...(optionalString(entity.prefix) != null ? { prefix: entity.prefix } : {}),
    ...(isFiniteNumber(entity.startNumber) ? { startNumber: Math.max(1, Math.trunc(entity.startNumber)) } : {}),
    ...(typeof entity.showHeader === 'boolean' ? { showHeader: entity.showHeader } : {}),
    ...(typeof entity.showTitle === 'boolean' ? { showTitle: entity.showTitle } : {}),
    ...(tagSettings != null ? { tagSettings } : {}),
    ...(columnOverrides != null && columnOverrides.length > 0 ? { columnOverrides } : {}),
  };
}

const sanitizeEntity = (entity: CadEntity): CadEntity => {
  if (entity.type !== 'survey-table') return entity;
  return sanitizeCadSurveyTableEntity(entity) ?? entity;
};

/**
 * Load-path sanitize + backfill for the survey table slice. Trailing tables
 * keep position (clone/migrate agree). Idempotent; never fails the open.
 */
export function sanitizeCadSurveyTables(project: CadProject): CadProject {
  const styles = uniqueById(
    ensureCadSurveyTableStyles(project).map(sanitizeCadSurveyTableStyle).filter(
      (style): style is CadSurveyTableStyle => style != null,
    ),
  );
  const entities = project.entities.map(sanitizeEntity);
  const currentStyleId =
    project.currentSurveyTableStyleId != null &&
    styles.some((style) => style.id === project.currentSurveyTableStyleId)
      ? project.currentSurveyTableStyleId
      : styles[0]?.id;
  return {
    ...project,
    entities,
    surveyTableStyles: styles,
    ...(currentStyleId != null ? { currentSurveyTableStyleId: currentStyleId } : {}),
  };
}
