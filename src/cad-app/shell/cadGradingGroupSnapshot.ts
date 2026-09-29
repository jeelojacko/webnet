/**
 * Phase 20C Wave-4A — grading-group Toolspace/manager/Properties snapshot.
 *
 * Dumb-renderer support: every row derives from drawing definitions + the
 * session group-result cache once per publish. Results are session-only; a
 * stale retained result NEVER reads CURRENT (status text + explicit `stale`
 * flag). Mutations travel as real group commands through
 * `runGradingGroupCommand`; Calculate is explicit and never auto-started.
 *
 * Rows carry name / course count / side / target / status + CURRENT metrics
 * with an expandable corner + result summary (counts + per-corner one-liners,
 * never a per-daylight-point tree).
 */
import type { CadFeatureLineEntity, CadProject, CadSurface } from '../../engine/cad/cadTypes';
import type { CadSurfaceCache } from '../../engine/cad/cadSurfaceCache';
import { surfaceContentRevision } from '../../engine/cad/cadSurfaceView';
import type {
  CadGradingGroupResult,
  GradingCornerMode,
  GroupStatus,
} from '../../engine/cad/grading/gradingGroupTypes';
import { deriveGroupStatus } from '../../engine/cad/grading/gradingGroupStatus';
import { deriveFailedEffectiveStatus } from '../../engine/cad/grading/gradingStatus';
import type {
  GradingAccuracy,
  GradingTerminationKind,
  ResolvedGradingSource,
} from '../../engine/cad/grading/gradingTypes';
import {
  gradingBoundaryLabel,
  gradingTerminationKind,
  isTargetFreeCriterion,
} from '../../engine/cad/grading/gradingTypes';
import { resolveGroupInputs } from '../../engine/cad/grading/gradingGroupResolve';
import {
  formatGradingCriterion,
  gradingSideText,
} from './cadGradingShell';
import {
  gradingAccuracyText,
  gradingAreaUnit,
  gradingLengthUnit,
  gradingStatusText,
} from './cadGradingSnapshot';

/** Session group-result cache surface (the grading service owns the impl). */
export interface CadGradingGroupResultCache {
  get: (_groupId: string, _revision: string) => CadGradingGroupResult | undefined;
  retained: (_groupId: string) => CadGradingGroupResult[];
}

export interface CadGradingGroupMetrics {
  memberCount: number;
  cornerCount: number;
  minProjectionDistance: number;
  maxProjectionDistance: number;
  meanProjectionDistance: number;
  gradingPlanArea: number;
  grading3dArea: number;
  triangleCount: number;
  multipleSolutionCount: number;
  /** Phase 20F: full metric set for Properties/Toolspace/Inquiry. */
  sourceLength: number;
  vertexCount: number;
  cutSourceLength: number;
  fillSourceLength: number;
  tiedSourceLength: number;
  diagnostics: string[];
}

export interface CadGradingGroupRow {
  id: string;
  name: string;
  /** Full persisted definition (manager/inquiry authority). */
  definition: import('../../engine/cad/grading/gradingGroupTypes').CadGradingGroup;
  /** One resolved A->B source per group course, null when unresolvable. */
  memberSources: ResolvedGradingSource[] | null;
  sourceFeatureLineId: string;
  sourceName: string;
  courseCount: number;
  courseRefs: string;
  closed: boolean;
  cornerMode: GradingCornerMode;
  /** Display layer; undefined = default grading layer. */
  layerId?: string;
  /** Termination method across the group family (surface/distance/elevation). */
  method: GradingTerminationKind;
  /** True for distance/elevation families: no target surface. */
  analytic: boolean;
  /** Target surface id; empty string for analytic families. */
  targetSurfaceId: string;
  /** Target name; em dash for analytic families (never a fake surface). */
  targetName: string;
  /** Boundary label: 'Daylight' (surface) or 'Grading Limit' (analytic). */
  boundaryLabel: string;
  lengthUnit: string;
  areaUnit: string;
  cutFillApplicable: boolean;
  side: string;
  criterionText: string;
  /** Phase 20E: sparse per-course override count (0 = every course rides the default). */
  overrideCount: number;
  status: GroupStatus;
  statusText: string;
  /** Bounded session failure reason, set only while status is FAILED. */
  diagnostic: string | null;
  /** True when a retained result exists but is not the current revision. */
  stale: boolean;
  revision: string;
  maxSearchDistance: number;
  curveChordTolerance: number;
  accuracy: GradingAccuracy | null;
  accuracyText: string;
  curveCornerApproximated: boolean;
  metrics: CadGradingGroupMetrics | null;
  /** One-line corner + result summary (expandable, no point tree). */
  cornerSummary: string[];
  /** Result held by the cache at the CURRENT revision (calculate gate). */
  currentResult: CadGradingGroupResult | null;
  /** True when Calculate is allowed (resolvable + CURRENT target). */
  calculable: boolean;
  /** True when Extract Daylight / Bake can run (CURRENT + result). */
  exportable: boolean;
}

export interface CadGradingGroupSnapshot {
  groups: CadGradingGroupRow[];
  selectedGroupId: string | null;
}

const groupsOf = (project: CadProject): CadGradingGroupRow['definition'][] =>
  (project as CadProject & { gradingGroups?: CadGradingGroupRow['definition'][] }).gradingGroups ?? [];

const metricsOf = (result: CadGradingGroupResult): CadGradingGroupMetrics => ({
  memberCount: result.memberCount,
  cornerCount: result.cornerCount,
  minProjectionDistance: result.minProjectionDistance,
  maxProjectionDistance: result.maxProjectionDistance,
  meanProjectionDistance: result.meanProjectionDistance,
  gradingPlanArea: result.gradingPlanArea,
  grading3dArea: result.grading3dArea,
  triangleCount: result.gradingMesh.triangles.length / 3,
  multipleSolutionCount: result.multipleSolutionCount,
  sourceLength: result.sourceLength,
  vertexCount: Math.floor(result.daylightPoints.length / 3),
  cutSourceLength: result.cutSourceLength,
  fillSourceLength: result.fillSourceLength,
  tiedSourceLength: result.tiedSourceLength,
  diagnostics: result.diagnostics.map((entry) => entry.code),
});

const cornerSummaryOf = (result: CadGradingGroupResult, lengthUnit: string): string[] => {
  const lines: string[] = [];
  lines.push(
    `${result.memberCount} members · ${result.cornerCount} corners · ` +
      `${result.gradingPlanArea.toFixed(1)} m² plan · ` +
      `${Math.floor(result.gradingMesh.triangles.length / 3)} tri`,
  );
  for (const corner of result.corners) {
    const tie = corner.tiePointXyz != null
      ? `tie ${corner.tiePointXyz[0].toFixed(2)},${corner.tiePointXyz[1].toFixed(2)},${corner.tiePointXyz[2].toFixed(2)}`
      : 'tie —';
    const miter = corner.miterExtent != null ? `miter ${corner.miterExtent.toFixed(3)} ${lengthUnit}` : 'miter —';
    const diag = corner.diagnostics.length > 0 ? ` · ${corner.diagnostics.join('/')}` : '';
    lines.push(`#${corner.cornerIndex} ${corner.classification} · ${miter} · ${tie}${diag}`);
  }
  return lines;
};

export const buildCadGradingGroupSnapshot = (
  project: CadProject,
  surfaceCache: CadSurfaceCache | null,
  groupCache: CadGradingGroupResultCache | null,
  selectedGroupId: string | null,
  options?: {
    buildingGroupIds?: ReadonlySet<string>;
    sessionDiagnostics?: ReadonlyMap<string, { revision: string; error: string }>;
  },
): CadGradingGroupSnapshot => {
  const groups = groupsOf(project);
  const surfaces = project.surfaces ?? [];
  const lengthUnit = gradingLengthUnit(project.metadata?.units ?? 'm');
  const areaUnit = gradingAreaUnit(project.metadata?.units ?? 'm');
  const featureLines = project.entities.filter(
    (entity): entity is CadFeatureLineEntity => entity.type === 'feature-line',
  );
  const rows: CadGradingGroupRow[] = groups.map((group) => {
    const entity = featureLines.find((entry) => entry.id === group.sourceFeatureLineId) ?? null;
    const analytic = isTargetFreeCriterion(group.criterion);
    const target: CadSurface | null = analytic
      ? null
      : surfaces.find((entry) => entry.id === group.targetSurfaceId) ?? null;
    const inputs = resolveGroupInputs(project, group.id);
    const targetRevision = target ? surfaceContentRevision(project, target) : '';
    const targetCurrent =
      analytic || (target != null && surfaceCache?.get(target.id, targetRevision) != null);
    const revision = inputs?.revision ?? '';
    const currentResult = revision.length > 0
      ? groupCache?.get(group.id, revision) ?? null
      : null;
    const retained = groupCache?.retained(group.id) ?? [];
    const stale = currentResult == null && retained.length > 0;
    const building = options?.buildingGroupIds?.has(group.id) === true;
    const lastRetained = retained.length > 0 ? retained[retained.length - 1]! : null;
    const effective = currentResult ?? lastRetained;
    const status = deriveGroupStatus({
      brokenRef: inputs == null,
      building,
      hasResult: effective != null,
      sourceCurrent: targetCurrent,
      needsRecalc: effective != null && effective.revision !== revision,
    });
    const failure = options?.sessionDiagnostics?.get(group.id) ?? null;
    const effectiveStatus = deriveFailedEffectiveStatus(status, failure, revision);
    const diagnostic = effectiveStatus === 'FAILED' ? (failure?.error ?? null) : null;
    const staleMetrics = stale && lastRetained ? metricsOf(lastRetained) : null;
    const currentMetrics =
      effectiveStatus === 'CURRENT' && currentResult != null ? metricsOf(currentResult) : null;
    const summaryResult = currentResult ?? (stale ? lastRetained : null);
    const accuracy = currentResult?.accuracy ?? lastRetained?.accuracy ?? null;
    return {
      id: group.id,
      name: group.name,
      definition: group,
      memberSources: inputs?.memberSources ?? null,
      sourceFeatureLineId: group.sourceFeatureLineId,
      sourceName: entity?.name ?? group.sourceFeatureLineId,
      courseCount: group.sourceCourses.length,
      courseRefs: group.sourceCourses
        .map((course) => `${course.vertexAId}→${course.vertexBId}`)
        .join(' · '),
      closed: group.closed === true,
      cornerMode: group.cornerMode,
      ...(group.layerId !== undefined ? { layerId: group.layerId } : {}),
      method: gradingTerminationKind(group.criterion),
      analytic,
      targetSurfaceId: group.targetSurfaceId ?? '',
      targetName: analytic ? '—' : target?.name ?? group.targetSurfaceId ?? '',
      boundaryLabel: gradingBoundaryLabel(group.criterion),
      lengthUnit,
      areaUnit,
      cutFillApplicable: !analytic,
      side: gradingSideText(group.side),
      criterionText: formatGradingCriterion(group.criterion),
      overrideCount: group.courseCriteria?.length ?? 0,
      status: effectiveStatus,
      statusText: gradingStatusText(effectiveStatus),
      diagnostic,
      stale,
      revision,
      maxSearchDistance: group.maxSearchDistance,
      curveChordTolerance: group.curveChordTolerance,
      accuracy,
      accuracyText: gradingAccuracyText(accuracy),
      curveCornerApproximated:
        (currentResult?.diagnostics.some((entry) => entry.code === 'CURVE_CORNER_APPROXIMATED') === true) ||
        (stale && (lastRetained?.diagnostics.some((entry) => entry.code === 'CURVE_CORNER_APPROXIMATED') === true)),
      metrics: currentMetrics ?? staleMetrics,
      cornerSummary: summaryResult ? cornerSummaryOf(summaryResult, lengthUnit) : [],
      currentResult,
      calculable:
        effectiveStatus !== 'BUILDING' &&
        effectiveStatus !== 'BROKEN_REFERENCE' &&
        inputs != null &&
        targetCurrent,
      exportable: effectiveStatus === 'CURRENT' && currentResult != null,
    };
  });
  return {
    groups: rows,
    selectedGroupId:
      selectedGroupId != null && rows.some((entry) => entry.id === selectedGroupId)
        ? selectedGroupId
        : null,
  };
};

/** Selected group row, if any (manager/properties share this lookup). */
export const selectedGradingGroupRow = (
  snapshot: { gradingGroups?: CadGradingGroupSnapshot | null } | null | undefined,
): CadGradingGroupRow | null => {
  const id = snapshot?.gradingGroups?.selectedGroupId ?? null;
  if (id == null) return null;
  return snapshot?.gradingGroups?.groups.find((entry) => entry.id === id) ?? null;
};
