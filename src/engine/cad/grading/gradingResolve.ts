import { computeCadSurfaceSourceRevision } from '../cadSurfaceRevision';
import { resolveCadFeatureLine } from '../cadFeatureLines';
import type { CadProject, CadSurface } from '../cadTypes';
import { resolveGradingSourceCourse } from './gradingCourseFrame';
import { buildGradingRevision } from './gradingRevision';
import type { CadGrading, ResolvedGradingSource } from './gradingTypes';

/**
 * Phase 20B — engine-side grading input resolution (no worker dependency).
 *
 * Resolves a grading definition to its calculation inputs: source course in
 * persisted A->B direction, target surface + current source revision, and
 * the `grev1:` content revision. Null = BROKEN_REFERENCE (fail-closed).
 * Shared by the worker service and the extract/bake command gates so both
 * prove CURRENT against the same revision.
 */

export interface ResolvedGradingInputs {
  grading: CadGrading;
  resolvedSource: ResolvedGradingSource;
  target: CadSurface;
  targetRevision: string;
  revision: string;
}

const findGrading = (project: CadProject, gradingId: string): CadGrading | undefined =>
  (project.gradings ?? []).find((entry) => entry.id === gradingId);

const findSurface = (project: CadProject, surfaceId: string): CadSurface | undefined =>
  (project.surfaces ?? []).find((entry) => entry.id === surfaceId);

export const resolveGradingInputs = (
  project: CadProject,
  gradingId: string,
): ResolvedGradingInputs | null => {
  const grading = findGrading(project, gradingId);
  if (!grading) return null;
  const entity = project.entities.find(
    (entry) => entry.type === 'feature-line' && entry.id === grading.sourceFeatureLineId,
  );
  if (!entity || entity.type !== 'feature-line') return null;
  const resolvedFeatureLine = resolveCadFeatureLine(entity);
  if (!resolvedFeatureLine) return null;
  const resolvedSource = resolveGradingSourceCourse(
    resolvedFeatureLine.courses.map((course) => ({
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
    })),
    grading.sourceCourse.vertexAId,
    grading.sourceCourse.vertexBId,
  );
  if (!resolvedSource) return null;
  const target = findSurface(project, grading.targetSurfaceId);
  if (!target) return null;
  const targetRevision = computeCadSurfaceSourceRevision(project, target);
  const revision = buildGradingRevision({
    sourceFeatureLineId: grading.sourceFeatureLineId,
    vertexAId: grading.sourceCourse.vertexAId,
    vertexBId: grading.sourceCourse.vertexBId,
    resolvedSource,
    targetSurfaceId: target.id,
    targetRevision,
    side: grading.side,
    criterion: grading.criterion,
    maxSearchDistance: grading.maxSearchDistance,
    curveChordTolerance: grading.curveChordTolerance,
  });
  return { grading, resolvedSource, target, targetRevision, revision };
};
