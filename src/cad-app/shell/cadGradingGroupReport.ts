/**
 * Phase 20C Wave-3 — grading-group inquiry report + CSV variant.
 *
 * Pure formatters over a CURRENT `CadGradingGroupResult` + definition. No
 * raw arrays, no internal UUIDs as primary columns; deterministic ordering.
 */
import type {
  CadGradingGroup,
  CadGradingGroupResult,
  GroupCornerResult,
  GroupStatus,
} from '../../engine/cad/grading/gradingGroupTypes';
import type { GradingAccuracy } from '../../engine/cad/grading/gradingTypes';
import { gradingBoundaryLabel, isTargetFreeCriterion } from '../../engine/cad/grading/gradingTypes';
import { buildCourseMemberRows } from './cadGradingGroupCourseCriteria';
import {
  formatGradingCriterion,
  gradingCriterionBoundaryShort,
  gradingSideText,
  gradingTargetSummary,
} from './cadGradingShell';
import {
  gradingAccuracyText,
  gradingStatusText,
} from './cadGradingSnapshot';

const cornerMiterText = (corner: GroupCornerResult): string =>
  corner.miterExtent != null ? corner.miterExtent.toFixed(3) : '—';

const cornerTieText = (corner: GroupCornerResult): string =>
  corner.tiePointXyz != null
    ? `${corner.tiePointXyz[0].toFixed(3)}, ${corner.tiePointXyz[1].toFixed(3)}, ${corner.tiePointXyz[2].toFixed(3)}`
    : '—';

const cornerDiagnosticsText = (corner: GroupCornerResult): string =>
  corner.diagnostics.length > 0 ? corner.diagnostics.join(' · ') : 'none';

const courseRefsText = (group: CadGradingGroup): string =>
  group.sourceCourses.map((course) => `${course.vertexAId}→${course.vertexBId}`).join(' · ');

/**
 * Human inquiry report. Requires a CURRENT result; a stale/other status
 * answers with an explicit reason instead of stale numbers. No arrays.
 */
export const buildGroupInquiryReport = (
  group: CadGradingGroup,
  sourceName: string,
  targetName: string,
  status: GroupStatus,
  accuracy: GradingAccuracy | null,
  result: CadGradingGroupResult | null,
  lengthUnit = 'm',
): string => {
  const lines: string[] = [];
  lines.push(`Grading Group Inquiry — ${group.name}`);
  lines.push(`Source: ${sourceName} · ${group.closed === true ? 'closed' : 'open'} · side ${gradingSideText(group.side)}`);
  lines.push(`Courses: ${courseRefsText(group)}`);
  lines.push(gradingTargetSummary(group.criterion, targetName, lengthUnit));
  lines.push(`Status: ${gradingStatusText(status)} · accuracy ${gradingAccuracyText(accuracy)}`);
  if (status !== 'CURRENT' || result == null) {
    lines.push('No CURRENT result — calculate this grading group before inquiry.');
    return lines.join('\n');
  }
  lines.push(
    `Members: ${result.memberCount} · corners: ${result.cornerCount}`,
  );
  lines.push(
    `Tie distance: min ${result.minProjectionDistance.toFixed(3)} / max ${result.maxProjectionDistance.toFixed(3)} / mean ${result.meanProjectionDistance.toFixed(3)} m`,
  );
  lines.push(
    `Areas: plan ${result.gradingPlanArea.toFixed(3)} / 3D ${result.grading3dArea.toFixed(3)}`,
  );
  if (isTargetFreeCriterion(group.criterion)) {
    lines.push('Source lengths: cut — · fill — · tied — (analytic termination has no target relation)');
  } else {
    lines.push(
      `Source lengths: cut ${result.cutSourceLength.toFixed(3)} · fill ${result.fillSourceLength.toFixed(3)} · tied ${result.tiedSourceLength.toFixed(3)} m`,
    );
  }
  const vertices = Math.floor(result.daylightPoints.length / 3);
  const triangles = Math.floor(result.gradingMesh.triangles.length / 3);
  lines.push(`${gradingBoundaryLabel(group.criterion)} vertices: ${vertices} · mesh triangles: ${triangles}`);
  lines.push(
    `Multiple-root events: ${result.multipleSolutionCount} · candidate triangles: ${result.candidateTriangleCount} · tie segments: ${result.intersectionSegmentCount}`,
  );
  if (result.corners.length > 0) {
    lines.push('Corners:');
    for (const corner of result.corners) {
      lines.push(
        `  #${corner.cornerIndex} ${corner.classification} · miter ${cornerMiterText(corner)} m` +
          ` · tie ${cornerTieText(corner)} · diagnostics ${cornerDiagnosticsText(corner)}`,
      );
    }
  } else {
    lines.push('Corners: none');
  }
  lines.push('Members:');
  for (const row of buildCourseMemberRows(group, result)) {
    lines.push(
      `  ${row.course} ${row.from}→${row.to} · ${row.criterionSource} ${row.criterionType}` +
        ` · fixed ${row.fixedGrade} · cut ${row.cutGrade} · fill ${row.fillGrade}` +
        ` · target ${row.targetValue}` +
        ` · ${row.classification} · source ${row.sourceLength} m · area ${row.gradingArea}`,
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

const escapeCsv = (value: string): string =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

export const buildGroupCsvFilename = (groupName: string): string => {
  const slug = groupName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'grading-group';
  return `grading-group-${slug}.csv`;
};

/**
 * Group CSV: summary block (`Metric,Value`), corner table
 * (`Corner,Classification,Miter Distance,Tie E,Tie N,Tie Z,Diagnostics`),
 * then daylight stations (`Station,Daylight E,Daylight N,Daylight Z`).
 * Station payloads interpolate along the merged daylight boundary.
 */
export const buildGroupCsv = (
  group: CadGradingGroup,
  status: GroupStatus,
  accuracy: GradingAccuracy | null,
  result: CadGradingGroupResult,
): string => {
  const lines: string[] = [];
  // Analytic terminations have no target relation: never emit fake-precise
  // zeros (single-grading CSV uses the same '—' convention).
  const relation = isTargetFreeCriterion(group.criterion) ? '—' : null;
  const summary: Array<[string, string]> = [
    ['Group', group.name],
    ['Source', group.sourceFeatureLineId],
    ['Courses', courseRefsText(group)],
    ['Shape', group.closed === true ? 'closed' : 'open'],
    ['Side', gradingSideText(group.side)],
    ['Target', gradingTargetSummary(group.criterion, group.targetSurfaceId ?? '—').replace(/^Target: /, '')],
    ['Criterion', formatGradingCriterion(group.criterion)],
    ['Status', gradingStatusText(status)],
    ['Accuracy', gradingAccuracyText(accuracy)],
    ['Members', String(result.memberCount)],
    ['Corners', String(result.cornerCount)],
    ['Tie Min', result.minProjectionDistance.toFixed(3)],
    ['Tie Max', result.maxProjectionDistance.toFixed(3)],
    ['Tie Mean', result.meanProjectionDistance.toFixed(3)],
    ['Plan Area', result.gradingPlanArea.toFixed(3)],
    ['3D Area', result.grading3dArea.toFixed(3)],
    ['Cut Length', relation ?? result.cutSourceLength.toFixed(3)],
    ['Fill Length', relation ?? result.fillSourceLength.toFixed(3)],
    ['Tied Length', relation ?? result.tiedSourceLength.toFixed(3)],
  ];
  lines.push('Metric,Value');
  for (const [metric, value] of summary) {
    lines.push([metric, value].map(escapeCsv).join(','));
  }
  lines.push('');
  lines.push('Corner,Classification,Miter Distance,Tie E,Tie N,Tie Z,Diagnostics');
  for (const corner of result.corners) {
    lines.push(
      [
        String(corner.cornerIndex),
        corner.classification,
        corner.miterExtent != null ? corner.miterExtent.toFixed(3) : '',
        corner.tiePointXyz != null ? corner.tiePointXyz[0].toFixed(3) : '',
        corner.tiePointXyz != null ? corner.tiePointXyz[1].toFixed(3) : '',
        corner.tiePointXyz != null ? corner.tiePointXyz[2].toFixed(3) : '',
        cornerDiagnosticsText(corner),
      ].map(escapeCsv).join(','),
    );
  }
  lines.push('');
  // Phase 20F.1: 'Target Value' column added after Fill Grade ('—' for
  // surface members; '<d> m' distance / '<z> m' target elevation for
  // analytic members). Documented here + docs/evidence/phase20f1-grading-ui-audit.md.
  lines.push('Course,From,To,Criterion Source,Criterion Type,Fixed Grade,Cut Grade,Fill Grade,Target Value,Classification,Source Length,Grading Area');
  for (const row of buildCourseMemberRows(group, result)) {
    lines.push(
      [
        row.course,
        row.from,
        row.to,
        row.criterionSource,
        row.criterionType,
        row.fixedGrade,
        row.cutGrade,
        row.fillGrade,
        row.targetValue,
        row.classification,
        row.sourceLength,
        row.gradingArea,
      ].map(escapeCsv).join(','),
    );
  }
  lines.push('');
  lines.push('Station,' + `${gradingCriterionBoundaryShort(group.criterion)} E,${gradingCriterionBoundaryShort(group.criterion)} N,${gradingCriterionBoundaryShort(group.criterion)} Z`);
  const count = Math.floor(result.daylightPoints.length / 3);
  for (let index = 0; index < count; index += 1) {
    lines.push(
      [
        String(index),
        (result.daylightPoints[index * 3] ?? 0).toFixed(3),
        (result.daylightPoints[index * 3 + 1] ?? 0).toFixed(3),
        (result.daylightPoints[index * 3 + 2] ?? 0).toFixed(3),
      ].map(escapeCsv).join(','),
    );
  }
  return lines.join('\n');
};
