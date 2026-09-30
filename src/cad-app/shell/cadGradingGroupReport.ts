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
import { gradingBoundaryLabel } from '../../engine/cad/grading/gradingTypes';
import { buildCourseMemberRows } from './cadGradingGroupCourseCriteria';
import { groupMethodSummary, representativeGroupCriterion } from './cadGradingGroupMethodSummary';
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
  diagnostic: string | null = null,
): string => {
  const lines: string[] = [];
  const methods = groupMethodSummary(group);
  // Value-level rows describe the calculated result: the stored default
  // while it rides at least one course, else the first effective criterion.
  const representative = representativeGroupCriterion(group);
  lines.push(`Grading Group Inquiry — ${group.name}`);
  lines.push(`Source: ${sourceName} · ${group.closed === true ? 'closed' : 'open'} · side ${gradingSideText(group.side)}`);
  lines.push(`Courses: ${courseRefsText(group)}`);
  lines.push(
    `Termination: ${methods.label}${methods.mixedAnalytic || methods.hybrid ? ` · Methods: ${methods.methodList}` : ''}`,
  );
  lines.push(
    methods.hybrid
      ? `Target: ${targetName}`
      : methods.mixedAnalytic
        ? 'Target: Not applicable'
        : gradingTargetSummary(representative, targetName, lengthUnit),
  );
  // Stored default + sparse override count: a hybrid group never reads as
  // one singular criterion, and a fully-overridden default never poses.
  lines.push(
    `Default: ${formatGradingCriterion(group.criterion)} · Overrides: ${group.courseCriteria?.length ?? 0}`,
  );
  lines.push(`Status: ${gradingStatusText(status)} · accuracy ${gradingAccuracyText(accuracy)}`);
  if (status !== 'CURRENT' || result == null) {
    if (diagnostic) lines.push(`Failure: ${diagnostic}`);
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
  if (methods.requiresTarget) {
    lines.push(
      `Source lengths: cut ${result.cutSourceLength.toFixed(3)} · fill ${result.fillSourceLength.toFixed(3)} · tied ${result.tiedSourceLength.toFixed(3)} m`,
    );
  } else {
    lines.push('Source lengths: cut — · fill — · tied — (analytic termination has no target relation)');
  }
  const vertices = Math.floor(result.daylightPoints.length / 3);
  const triangles = Math.floor(result.gradingMesh.triangles.length / 3);
  // Hybrid members terminate differently per course: the shared line is the
  // grading boundary, never a singular Daylight/Limit claim.
  const boundary = methods.hybrid ? 'Grading Boundary' : gradingBoundaryLabel(group.criterion);
  lines.push(`${boundary} vertices: ${vertices} · mesh triangles: ${triangles}`);
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
  for (const row of buildCourseMemberRows(group, result, targetName)) {
    lines.push(
      `  ${row.course} ${row.from}→${row.to} · ${row.criterionSource} ${row.criterionType} · effective ${row.effective}` +
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
  targetName?: string,
): string => {
  const lines: string[] = [];
  const methods = groupMethodSummary(group);
  const representative = representativeGroupCriterion(group);
  const sharedTarget = targetName ?? group.targetSurfaceId ?? '—';
  // Analytic terminations have no target relation: never emit fake-precise
  // zeros (single-grading CSV uses the same '—' convention). Hybrid groups
  // still tie their surface courses, so they keep real lengths.
  const relation = methods.requiresTarget ? null : '—';
  const summary: Array<[string, string]> = [
    ['Group', group.name],
    ['Source', group.sourceFeatureLineId],
    ['Courses', courseRefsText(group)],
    ['Shape', group.closed === true ? 'closed' : 'open'],
    ['Side', gradingSideText(group.side)],
    ['Termination', methods.label],
    ['Methods', methods.detail],
    ['Target', methods.hybrid
      ? sharedTarget
      : methods.mixedAnalytic
        ? 'Not applicable'
        : gradingTargetSummary(representative, sharedTarget).replace(/^Target: /, '')],
    ['Default Criterion', formatGradingCriterion(group.criterion)],
    ['Overrides', String(group.courseCriteria?.length ?? 0)],
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
  // Phase 20F.1: 'Target Value' column after Fill Grade (target name for
  // surface members; '<d> m' distance / '<z> m' elevation for analytic
  // members). Phase 20J Wave C2: 'Effective' column after Criterion Type
  // (one honest value per course; a hybrid group has no singular criterion).
  lines.push('Course,From,To,Criterion Source,Criterion Type,Effective,Fixed Grade,Cut Grade,Fill Grade,Target Value,Classification,Source Length,Grading Area');
  for (const row of buildCourseMemberRows(group, result, sharedTarget)) {
    lines.push(
      [
        row.course,
        row.from,
        row.to,
        row.criterionSource,
        row.criterionType,
        row.effective,
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
  const stationAxis = methods.hybrid
    ? 'Grading Boundary'
    : gradingCriterionBoundaryShort(group.criterion);
  lines.push('Station,' + `${stationAxis} E,${stationAxis} N,${stationAxis} Z`);
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
