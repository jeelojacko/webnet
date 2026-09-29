/**
 * Phase 20B — grading inquiry report + per-station CSV.
 *
 * Pure formatters over a CURRENT `CadGradingResult` + resolved source. No
 * raw arrays, no internal UUIDs as primary columns; deterministic ordering.
 */
import type {
  CadGrading,
  CadGradingResult,
  GradingRegionClassification,
  ResolvedGradingSource,
} from '../../engine/cad/grading/gradingTypes';
import { gradingSideText, gradingTargetSummary, gradingCriterionBoundaryShort } from './cadGradingShell';
import { isTargetFreeCriterion } from '../../engine/cad/grading/gradingTypes';
import { gradingAccuracyText, gradingStatusText, type CadGradingRow } from './cadGradingSnapshot';

export type GradingCsvClassification = GradingRegionClassification | 'TIED';

const sourceAtStation = (
  source: ResolvedGradingSource,
  station: number,
): { x: number; y: number; z: number } => {
  const t = source.length > 0 ? station / source.length : 0;
  return {
    x: source.startX + (source.endX - source.startX) * t,
    y: source.startY + (source.endY - source.startY) * t,
    z: source.startZ + (source.endZ - source.startZ) * t,
  };
};

const classificationAt = (
  result: CadGradingResult,
  station: number,
  tieDistance: number,
): GradingCsvClassification => {
  if (tieDistance <= 1e-9) return 'TIED';
  const region = result.regions.find(
    (entry) => station >= entry.stationSpan[0] && station <= entry.stationSpan[1],
  );
  return region?.classification ?? 'FIXED';
};

export interface GradingCsvRow {
  station: number;
  sourceE: number;
  sourceN: number;
  sourceZ: number;
  side: string;
  classification: GradingCsvClassification;
  tieDistance: number;
  daylightE: number;
  daylightN: number;
  daylightZ: number;
}

/** One CSV row per daylight vertex, station-ordered. */
export const buildGradingCsvRows = (
  grading: CadGrading,
  source: ResolvedGradingSource,
  result: CadGradingResult,
): GradingCsvRow[] => {
  const count = Math.floor(result.daylightPoints.length / 3);
  const side = gradingSideText(grading.side);
  const rows: GradingCsvRow[] = [];
  for (let index = 0; index < count; index += 1) {
    const dx = result.daylightPoints[index * 3] ?? 0;
    const dy = result.daylightPoints[index * 3 + 1] ?? 0;
    const dz = result.daylightPoints[index * 3 + 2] ?? 0;
    const station = count > 1 ? (source.length * index) / (count - 1) : 0;
    const s = sourceAtStation(source, station);
    const tieDistance = Math.hypot(dx - s.x, dy - s.y);
    rows.push({
      station,
      sourceE: s.x,
      sourceN: s.y,
      sourceZ: s.z,
      side,
      classification: classificationAt(result, station, tieDistance),
      tieDistance,
      daylightE: dx,
      daylightN: dy,
      daylightZ: dz,
    });
  }
  return rows;
};

const escapeCsv = (value: string): string =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

export const buildGradingCsvFilename = (gradingName: string): string => {
  const slug = gradingName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'grading';
  return `grading-${slug}.csv`;
};

/** CSV: Station, Source E/N/Z, Side, Classification, Tie Distance, Daylight E/N/Z. */
export const buildGradingCsv = (
  grading: CadGrading,
  source: ResolvedGradingSource,
  result: CadGradingResult,
): string => {
  const header = [
    'Station',
    'Source E',
    'Source N',
    'Source Z',
    'Side',
    'Classification',
    'Tie Distance',
    `${gradingCriterionBoundaryShort(grading.criterion)} E`,
    `${gradingCriterionBoundaryShort(grading.criterion)} N`,
    `${gradingCriterionBoundaryShort(grading.criterion)} Z`,
  ];
  const lines = [header.join(',')];
  for (const row of buildGradingCsvRows(grading, source, result)) {
    lines.push(
      [
        row.station.toFixed(3),
        row.sourceE.toFixed(3),
        row.sourceN.toFixed(3),
        row.sourceZ.toFixed(3),
        row.side,
        row.classification,
        row.tieDistance.toFixed(3),
        row.daylightE.toFixed(3),
        row.daylightN.toFixed(3),
        row.daylightZ.toFixed(3),
      ].map(escapeCsv).join(','),
    );
  }
  return lines.join('\n');
};

/**
 * Human inquiry report. Requires a CURRENT result; a stale/other status
 * answers with an explicit reason instead of stale numbers. No arrays.
 */
export const buildGradingInquiryReport = (
  grading: CadGrading,
  source: ResolvedGradingSource | null,
  row: CadGradingRow,
  result: CadGradingResult | null,
): string => {
  const lines: string[] = [];
  lines.push(`Grading Inquiry — ${grading.name}`);
  lines.push(`Source: ${row.sourceName} · side ${gradingSideText(grading.side)}`);
  lines.push(
    `Course: ${grading.sourceCourse.vertexAId} → ${grading.sourceCourse.vertexBId}` +
      (row.stationSpan ? ` · stations ${row.stationSpan[0].toFixed(3)}–${row.stationSpan[1].toFixed(3)} m` : ''),
  );
  lines.push(gradingTargetSummary(grading.criterion, row.targetName, row.lengthUnit));
  lines.push(`Status: ${gradingStatusText(row.status)} · accuracy ${gradingAccuracyText(row.accuracy)}`);
  if (row.status !== 'CURRENT' || result == null || source == null) {
    lines.push('No CURRENT result — calculate this grading before inquiry.');
    return lines.join('\n');
  }
  lines.push(
    `Source length: ${result.sourceLength.toFixed(3)} m (plan ${source.length.toFixed(3)} m${source.isArc ? ', curve' : ''})`,
  );
  lines.push(
    `Tie distance: min ${result.minProjectionDistance.toFixed(3)} / max ${result.maxProjectionDistance.toFixed(3)} / mean ${result.meanProjectionDistance.toFixed(3)} m`,
  );
  lines.push(
    `Areas: plan ${result.gradingPlanArea.toFixed(3)} / 3D ${result.grading3dArea.toFixed(3)}`,
  );
  if (isTargetFreeCriterion(grading.criterion)) {
    lines.push('Source lengths: cut — · fill — · tied — (analytic termination has no target relation)');
  } else {
    lines.push(
      `Source lengths: cut ${result.cutSourceLength.toFixed(3)} · fill ${result.fillSourceLength.toFixed(3)} · tied ${result.tiedSourceLength.toFixed(3)} m`,
    );
  }
  const vertices = Math.floor(result.daylightPoints.length / 3);
  const triangles = Math.floor(result.gradingMesh.triangles.length / 3);
  lines.push(`${row.boundaryLabel} vertices: ${vertices} · mesh triangles: ${triangles}`);
  lines.push(
    `Multiple-root events: ${result.multipleSolutionCount} · candidate triangles: ${result.candidateTriangleCount} · tie segments: ${result.intersectionSegmentCount}`,
  );
  if (result.regions.length > 0) {
    lines.push(
      'Regions: ' +
        result.regions
          .map(
            (region) =>
              `${region.classification} ${region.stationSpan[0].toFixed(2)}–${region.stationSpan[1].toFixed(2)}`,
          )
          .join(' · '),
    );
  }
  if (result.diagnostics.length > 0) {
    lines.push(
      'Diagnostics: ' +
        result.diagnostics
          .map((entry) =>
            entry.stationSpan
              ? `${entry.code} (${entry.stationSpan[0].toFixed(2)}–${entry.stationSpan[1].toFixed(2)})`
              : entry.code,
          )
          .join(' · '),
    );
  } else {
    lines.push('Diagnostics: none');
  }
  return lines.join('\n');
};
