/**
 * Phase 20B — grading Toolspace/manager/Properties snapshot.
 *
 * Dumb-renderer support: every row derives from drawing definitions + the
 * session result cache once per publish. Results are session-only; a stale
 * retained result NEVER reads CURRENT (status text + explicit `stale` flag).
 * Mutations travel as real grading commands through `runGradingCommand`.
 *
 * Transform semantics (Phase 20B §7): grading refs stay vertex-id based, so
 * MOVE/ROTATE/MIRROR/SCALE of the source change the resolved source geometry
 * and therefore `grev1`, deriving NEEDS_RECALC — cached results are NEVER
 * transformed. MIRROR reflects A->B, so mathematical left/right stays correct
 * with no enum flip. DERIVATION GAP (documented, not guessed): Grid/Ground and
 * Project Transform scale distance-like inputs (`maxSearchDistance`,
 * `curveChordTolerance`) by |k| in the engine contract; this UI does NOT
 * auto-scale them, so a scaled drawing requires editing those two values
 * before Calculate. Translation/rotation change nothing else.
 *
 * Forward-compatible seam: `gradings` is read structurally so this module
 * compiles before/after the persistence slice appends the CadProject key.
 */
import type { CadFeatureLineEntity, CadProject, CadSurface } from '../../engine/cad/cadTypes';
import type {
  CadGrading,
  CadGradingResult,
  GradingAccuracy,
  GradingStatus,
  GradingTerminationKind,
  ResolvedGradingSource,
} from '../../engine/cad/grading/gradingTypes';
import {
  resolveGradingSourceCourse,
  type GradingCourseLike,
} from '../../engine/cad/grading/gradingCourseFrame';
import { resolveCadFeatureLine } from '../../engine/cad/cadFeatureLines';
import { buildGradingRevision } from '../../engine/cad/grading/gradingRevision';
import { deriveFailedEffectiveStatus, deriveGradingStatus } from '../../engine/cad/grading/gradingStatus';
import {
  gradingBoundaryLabel,
  gradingTerminationKind,
  isTargetFreeCriterion,
} from '../../engine/cad/grading/gradingTypes';
import type { CadSurfaceCache } from '../../engine/cad/cadSurfaceCache';
import { surfaceContentRevision } from '../../engine/cad/cadSurfaceView';
import { gradingCriterionText, gradingSideText } from './cadGradingShell';
import { gradingTopologyCertificateProductError } from '../../engine/cad/grading/gradingTopologyCertificate';

/** Session grading result cache surface (the integration slice owns the impl). */
export interface CadGradingResultCache {
  get: (_gradingId: string, _revision: string) => CadGradingResult | undefined;
  retained: (_gradingId: string) => CadGradingResult[];
}

interface CadProjectWithGradings extends CadProject {
  gradings?: CadGrading[];
}

/** Structural accessor (the persistence slice appends the key). */
export const projectGradings = (project: CadProject): CadGrading[] => {
  const value = (project as CadProjectWithGradings).gradings;
  return Array.isArray(value) ? value : [];
};

export const gradingStatusText = (status: GradingStatus): string => {
  switch (status) {
    case 'CURRENT': return 'Current';
    case 'NEEDS_RECALC': return 'Needs Recalc';
    case 'BUILDING': return 'Building';
    case 'FAILED': return 'Failed';
    case 'BROKEN_REFERENCE': return 'Broken Reference';
    case 'SOURCE_NOT_CURRENT': return 'Source Not Current';
    case 'UNBUILT': return 'Unbuilt';
  }
};

export const gradingAccuracyText = (accuracy: GradingAccuracy | null): string =>
  accuracy == null ? '--' : accuracy === 'CURVE_APPROXIMATED' ? 'Curve Approximated' : 'Exact';

/**
 * Compact stable failure code (first ALL_CAPS token), else null. Manager rows
 * use this to keep a bounded reason in a table cell; detail panels show the
 * full bounded diagnostic text.
 */
export const gradingDiagnosticCode = (error: string | null): string | null =>
  error == null ? null : /[A-Z][A-Z0-9_]{3,}/.exec(error)?.[0] ?? null;

/** Current-revision metrics shown only for a CURRENT row. */
export interface CadGradingMetrics {
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
  candidateTriangleCount: number;
  intersectionSegmentCount: number;
  cutSourceLength: number;
  fillSourceLength: number;
  tiedSourceLength: number;
  diagnostics: string[];
}

export interface CadGradingRow {
  id: string;
  name: string;
  /** Full persisted definition (export/inquiry/properties authority). */
  definition: CadGrading;
  /** Resolved A->B source geometry, null when the course is unresolvable. */
  source: ResolvedGradingSource | null;
  sourceFeatureLineId: string;
  sourceName: string;
  /** Display layer (export layer id); undefined = default grading layer. */
  layerId?: string;
  /** Termination method: surface (target tie) vs distance/elevation (analytic). */
  method: GradingTerminationKind;
  /** True for distance/elevation: no target surface, boundary is a grading limit. */
  analytic: boolean;
  /** Target surface id; empty string for analytic termination. */
  targetSurfaceId: string;
  /** Target name; em dash for analytic termination (never a fake surface). */
  targetName: string;
  /** Extract/boundary label: 'Daylight' (surface) or 'Grading Limit' (analytic). */
  boundaryLabel: string;
  /** Drawing length unit label (m/ft) for distance-like values. */
  lengthUnit: string;
  /** Drawing area unit label (m²/ft²). */
  areaUnit: string;
  /** True when cut/fill/tied source-length metrics apply (surface only). */
  cutFillApplicable: boolean;
  side: string;
  criterionText: string;
  status: GradingStatus;
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
  metrics: CadGradingMetrics | null;
  /** Result held by the cache at the CURRENT revision (calculate gate). */
  currentResult: CadGradingResult | null;
  /** True when Calculate is allowed (resolvable + CURRENT target). */
  calculable: boolean;
  /** True when Extract Daylight / Bake can run (CURRENT + result). */
  exportable: boolean;
  /** Source station span [start, end] when the course resolves. */
  stationSpan: [number, number] | null;
}

export interface CadGradingSnapshot {
  gradings: CadGradingRow[];
  selectedGradingId: string | null;
}

const metricsOf = (result: CadGradingResult): CadGradingMetrics => ({
  minProjectionDistance: result.minProjectionDistance,
  maxProjectionDistance: result.maxProjectionDistance,
  meanProjectionDistance: result.meanProjectionDistance,
  gradingPlanArea: result.gradingPlanArea,
  grading3dArea: result.grading3dArea,
  triangleCount: result.gradingMesh.triangles.length / 3,
  multipleSolutionCount: result.multipleSolutionCount,
  sourceLength: result.sourceLength,
  vertexCount: Math.floor(result.daylightPoints.length / 3),
  candidateTriangleCount: result.candidateTriangleCount,
  intersectionSegmentCount: result.intersectionSegmentCount,
  cutSourceLength: result.cutSourceLength,
  fillSourceLength: result.fillSourceLength,
  tiedSourceLength: result.tiedSourceLength,
  diagnostics: result.diagnostics.map((entry) => entry.code),
});

const courseLikes = (entity: CadFeatureLineEntity): GradingCourseLike[] => {
  const resolved = resolveCadFeatureLine(entity);
  if (!resolved) return [];
  return resolved.courses.map((course) => ({
    fromVertexId: course.fromVertexId,
    toVertexId: course.toVertexId,
    startX: course.from.x,
    startY: course.from.y,
    endX: course.to.x,
    endY: course.to.y,
    startZ: course.from.z,
    endZ: course.to.z,
    planLength: course.planLength,
    isArc: course.kind === 'arc',
    ...(course.kind === 'arc' &&
    course.center != null &&
    course.radius != null &&
    course.startAngleDeg != null &&
    course.signedSweepDeg != null
      ? {
          arc: {
            centerX: course.center.x,
            centerY: course.center.y,
            radius: course.radius,
            startAngleDeg: course.startAngleDeg,
            signedSweepDeg: course.signedSweepDeg,
          },
        }
      : {}),
  }));
};

const surfaceOf = (surfaces: readonly CadSurface[], id: string): CadSurface | null =>
  surfaces.find((entry) => entry.id === id) ?? null;

/** Drawing units → grading length/area labels (m/ft, m²/ft²). */
export const gradingLengthUnit = (units: string): string => (units === 'ft' ? 'ft' : 'm');
export const gradingAreaUnit = (units: string): string => (units === 'ft' ? 'ft²' : 'm²');

export const buildCadGradingSnapshot = (
  project: CadProject,
  surfaceCache: CadSurfaceCache | null,
  gradingCache: CadGradingResultCache | null,
  selectedGradingId: string | null,
  options?: {
    buildingGradingIds?: ReadonlySet<string>;
    sessionDiagnostics?: ReadonlyMap<string, { revision: string; error: string }>;
  },
): CadGradingSnapshot => {
  const gradings = projectGradings(project);
  const surfaces = project.surfaces ?? [];
  const lengthUnit = gradingLengthUnit(project.metadata?.units ?? 'm');
  const areaUnit = gradingAreaUnit(project.metadata?.units ?? 'm');
  const featureLines = project.entities.filter(
    (entity): entity is CadFeatureLineEntity => entity.type === 'feature-line',
  );
  const rows: CadGradingRow[] = gradings.map((grading) => {
    const entity = featureLines.find((entry) => entry.id === grading.sourceFeatureLineId) ?? null;
    const sourceExists = entity != null;
    const resolvedSource = entity
      ? resolveGradingSourceCourse(
          courseLikes(entity),
          grading.sourceCourse.vertexAId,
          grading.sourceCourse.vertexBId,
        )
      : null;
    // Phase 20F: analytic criteria resolve without a target surface.
    const analytic = isTargetFreeCriterion(grading.criterion);
    const target = analytic ? null : surfaceOf(surfaces, grading.targetSurfaceId ?? '');
    const targetExists = analytic || target != null;
    const targetRevision = target ? surfaceContentRevision(project, target) : '';
    const targetCurrent =
      analytic || (target != null && surfaceCache?.get(target.id, targetRevision) != null);
    const revision =
      resolvedSource != null && (analytic || target != null)
        ? buildGradingRevision({
            sourceFeatureLineId: grading.sourceFeatureLineId,
            vertexAId: grading.sourceCourse.vertexAId,
            vertexBId: grading.sourceCourse.vertexBId,
            resolvedSource,
            ...(target ? { targetSurfaceId: grading.targetSurfaceId, targetRevision } : {}),
            side: grading.side,
            criterion: grading.criterion,
            maxSearchDistance: grading.maxSearchDistance,
            curveChordTolerance: grading.curveChordTolerance,
          })
        : '';
    const currentResult = revision.length > 0
      ? gradingCache?.get(grading.id, revision) ?? null
      : null;
    const retained = gradingCache?.retained(grading.id) ?? [];
    const stale = currentResult == null && retained.length > 0;
    const building = options?.buildingGradingIds?.has(grading.id) === true;
    const resultRevision = currentResult?.revision ?? (retained.length > 0 ? (retained[retained.length - 1]?.revision ?? null) : null);
    const status = deriveGradingStatus({
      courseResolved: resolvedSource != null,
      targetCurrent,
      targetExists,
      sourceExists,
      hasResult: currentResult != null || retained.length > 0,
      resultRevision,
      currentRevision: revision,
      building,
    });
    const failure = options?.sessionDiagnostics?.get(grading.id) ?? null;
    const effectiveStatus = deriveFailedEffectiveStatus(status, failure, revision);
    const diagnostic = effectiveStatus === 'FAILED' ? (failure?.error ?? null) : null;
    const currentMetrics =
      status === 'CURRENT' && currentResult != null ? metricsOf(currentResult) : null;
    const staleMetrics = stale ? (retained[retained.length - 1] ?? null) : null;
    return {
      id: grading.id,
      name: grading.name,
      definition: grading,
      source: resolvedSource,
      sourceFeatureLineId: grading.sourceFeatureLineId,
      sourceName: entity?.name ?? grading.sourceFeatureLineId,
      ...(grading.layerId !== undefined ? { layerId: grading.layerId } : {}),
      method: gradingTerminationKind(grading.criterion),
      analytic,
      targetSurfaceId: grading.targetSurfaceId ?? '',
      targetName: analytic ? '—' : target?.name ?? grading.targetSurfaceId ?? '',
      boundaryLabel: gradingBoundaryLabel(grading.criterion),
      lengthUnit,
      areaUnit,
      cutFillApplicable: !analytic,
      side: gradingSideText(grading.side),
      criterionText: gradingCriterionText(grading),
      status: effectiveStatus,
      statusText: gradingStatusText(effectiveStatus),
      diagnostic,
      stale,
      revision,
      maxSearchDistance: grading.maxSearchDistance,
      curveChordTolerance: grading.curveChordTolerance,
      accuracy: currentResult?.accuracy ?? staleMetrics?.accuracy ?? null,
      accuracyText: gradingAccuracyText(currentResult?.accuracy ?? staleMetrics?.accuracy ?? null),
      metrics: currentMetrics ?? (staleMetrics ? metricsOf(staleMetrics) : null),
      currentResult,
      calculable:
        status !== 'BUILDING' && status !== 'BROKEN_REFERENCE' && resolvedSource != null && targetCurrent,
      exportable:
        status === 'CURRENT' &&
        currentResult != null &&
        gradingTopologyCertificateProductError(
          currentResult.topologyCertificate,
          'standalone',
          currentResult.gradingMesh,
        ) == null,
      stationSpan:
        resolvedSource != null
          ? [0, resolvedSource.length]
          : null,
    };
  });
  return {
    gradings: rows,
    selectedGradingId:
      selectedGradingId != null && rows.some((entry) => entry.id === selectedGradingId)
        ? selectedGradingId
        : null,
  };
};
