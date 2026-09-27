// Phase 19D Wave 1 — Parcel Schedule (pure derive, live values).
//
// Rows are keyed by `parcelId` and never bake display text: every call
// re-reads the project and recomputes areas/perimeters through the canonical
// closure math, so a grip move or course conversion is reflected on the next
// derive with no cache to invalidate. Totals are an arithmetic sum of row
// values — there is NO polygon dissolve/union, so overlapping parcels are
// counted once per row (documented caveat, not a hidden union).
//
// Deferred integration (Wave 2, NOT done here): register a
// `'parcel-schedule'` table kind in `CAD_SURVEY_TABLE_KIND_LABELS` /
// `COLUMNS_BY_KIND` (`cadSurveyTables.ts`) and dispatch it from
// `deriveCadSurveyTableFromSource` (`cadSurveyExportTables.ts`). The
// persisted row order is then just the survey table's existing
// `{ kind: 'parcel'; parcelId }` row list — no new project field, no new
// persistence code. Order helpers return plain `string[]` so that wiring is
// a direct assignment.

import { cadBuildParcelClosureSummary } from './cadCogoParcelGeometrySummaries';
import { cadConvertAreaSquareMeters } from './cadCogoParcelGeometry';
import { resolveCadParcelCourses } from './cadParcelCourses';
import {
  cadParcelPlanDesignation,
  cadParcelPlanInfo,
  cadParcelPlanRole,
  type CadParcelPlanRole,
} from './cadParcelPlanInfo';
import type { CadProject } from './cadTypes';

export const CAD_PARCEL_SCHEDULE_ROLE_ORDER: readonly CadParcelPlanRole[] = [
  'lot',
  'remainder',
  'road',
  'right-of-way',
  'easement',
  'other',
];

export interface CadParcelScheduleRow {
  parcelId: string;
  designation: string;
  role: CadParcelPlanRole;
  parcelName: string;
  description?: string;
  status: 'OK' | 'MISSING';
  areaSquareMeters: number;
  areaHectares: number;
  areaAcres: number;
  perimeterMeters: number;
  lineCount: number;
  arcCount: number;
  courseCount: number;
}

export interface CadParcelScheduleTotals {
  parcelCount: number;
  areaSquareMeters: number;
  areaHectares: number;
  areaAcres: number;
  perimeterMeters: number;
  /**
   * Always true: totals are an arithmetic sum of row values. Overlapping or
   * duplicated parcels are each counted once — this is NOT a union area.
   */
  arithmetic: true;
}

export interface CadParcelSchedule {
  parcelIds: string[];
  rows: CadParcelScheduleRow[];
  totals: CadParcelScheduleTotals;
}

export interface CadParcelScheduleRoleGroup {
  role: CadParcelPlanRole;
  parcelIds: string[];
  areaSquareMeters: number;
}

const emptyRow = (parcelId: string): CadParcelScheduleRow => ({
  parcelId,
  designation: parcelId,
  role: 'other',
  parcelName: parcelId,
  status: 'MISSING',
  areaSquareMeters: 0,
  areaHectares: 0,
  areaAcres: 0,
  perimeterMeters: 0,
  lineCount: 0,
  arcCount: 0,
  courseCount: 0,
});

export const buildCadParcelScheduleRow = (
  project: CadProject,
  parcelId: string,
): CadParcelScheduleRow => {
  const parcel = project.entities.find(
    (entity) => entity.id === parcelId && entity.type === 'parcel',
  );
  if (!parcel || parcel.type !== 'parcel') return emptyRow(parcelId);

  const closure = cadBuildParcelClosureSummary(parcel.vertices, {
    courseGeometry: parcel.courseGeometry,
  });
  const courses = resolveCadParcelCourses(parcel);
  const arcCount = courses.filter((course) => course.kind === 'arc').length;
  const areaSquareMeters = closure?.areaSquareMeters ?? 0;
  const areaUnits = cadConvertAreaSquareMeters(areaSquareMeters);
  const description = cadParcelPlanInfo(parcel)?.description;

  return {
    parcelId: parcel.id,
    designation: cadParcelPlanDesignation(parcel),
    role: cadParcelPlanRole(parcel),
    parcelName: parcel.parcelName,
    ...(description != null ? { description } : {}),
    status: closure ? 'OK' : 'MISSING',
    areaSquareMeters,
    areaHectares: areaUnits.hectares,
    areaAcres: areaUnits.acres,
    perimeterMeters: closure?.perimeterMeters ?? 0,
    lineCount: courses.length - arcCount,
    arcCount,
    courseCount: courses.length,
  };
};

export const buildCadParcelSchedule = (
  project: CadProject,
  parcelIds: readonly string[],
): CadParcelSchedule => {
  const rows = parcelIds.map((parcelId) => buildCadParcelScheduleRow(project, parcelId));
  const totalArea = rows.reduce((total, row) => total + row.areaSquareMeters, 0);
  const areaUnits = cadConvertAreaSquareMeters(totalArea);
  return {
    parcelIds: [...parcelIds],
    rows,
    totals: {
      parcelCount: rows.length,
      areaSquareMeters: totalArea,
      areaHectares: areaUnits.hectares,
      areaAcres: areaUnits.acres,
      perimeterMeters: rows.reduce((total, row) => total + row.perimeterMeters, 0),
      arithmetic: true,
    },
  };
};

/** Move a row by `delta` slots; out-of-range moves return the order unchanged. */
export const moveCadParcelScheduleRow = (
  order: readonly string[],
  parcelId: string,
  delta: number,
): string[] => {
  const next = [...order];
  const index = next.indexOf(parcelId);
  if (index < 0) return next;
  const target = index + delta;
  if (target < 0 || target >= next.length || delta === 0) return next;
  next.splice(index, 1);
  next.splice(target, 0, parcelId);
  return next;
};

export const moveCadParcelScheduleRowUp = (
  order: readonly string[],
  parcelId: string,
): string[] => moveCadParcelScheduleRow(order, parcelId, -1);

export const moveCadParcelScheduleRowDown = (
  order: readonly string[],
  parcelId: string,
): string[] => moveCadParcelScheduleRow(order, parcelId, 1);

/** Move a row to an absolute index; clamps to range, missing id is a no-op. */
export const setCadParcelScheduleRowOrder = (
  order: readonly string[],
  parcelId: string,
  targetIndex: number,
): string[] => {
  const next = [...order];
  const index = next.indexOf(parcelId);
  if (index < 0) return next;
  const clamped = Math.max(0, Math.min(next.length - 1, Math.trunc(targetIndex)));
  next.splice(index, 1);
  next.splice(clamped, 0, parcelId);
  return next;
};

/** Presentation-only grouping in canonical role order (does not reorder rows). */
export const groupCadParcelScheduleRowsByRole = (
  rows: readonly CadParcelScheduleRow[],
): CadParcelScheduleRoleGroup[] =>
  CAD_PARCEL_SCHEDULE_ROLE_ORDER.map((role) => {
    const selected = rows.filter((row) => row.role === role);
    return {
      role,
      parcelIds: selected.map((row) => row.parcelId),
      areaSquareMeters: selected.reduce((total, row) => total + row.areaSquareMeters, 0),
    };
  }).filter((group) => group.parcelIds.length > 0);
