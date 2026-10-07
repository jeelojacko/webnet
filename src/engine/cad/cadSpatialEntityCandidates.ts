import {
  cadArcMidpoint,
  cadClosestPointOnArc,
  cadClosestPointOnSegment,
  cadDistance,
  cadIsAngleOnArcSweep,
  cadMidpoint,
  cadPointOnCircle,
  cadProjectPointOntoInfiniteLine,
  cadTangentPointsFromExternalPointToArc,
  type CadWorldPoint,
} from './cadGeometry';
import {
  cadTangentPointsFromExternalPointToCircle,
} from './cadGeometryCurveIntersections';
import { CAD_XY_DEGENERATE_FLOOR } from './cadGeometryShapeBuilders';
import { getCadEntityDisplayLabel, getCadEntitySubpartDisplayLabel } from './cadEntityNames';
import { resolveCadFeatureLine } from './cadFeatureLines';
import type {
  CadArcEntity,
  CadCircleEntity,
  CadFeatureLineEntity,
  CadLineEntity,
  CadParcelEntity,
  CadPolygonEntity,
  CadPolylineEntity,
  CadSnapCandidate,
} from './cadTypes';
import { arcRefFromEntity, entitySegments } from './cadSpatialEntityRefs';
import { resolveCadPolylineCourses } from './cadPolylineCourses';
import {
  describeParcelArcCourse,
  parcelCourseCanonicalKind,
  validateParcelCourseGeometry,
} from './cadParcelArcGeometry';
import { buildBlockReferenceSnapCandidates, type CadSpatialEntityCandidateContext } from './cadSpatialBlockSnaps';
import type { CadArcRef } from './cadSpatialIndexTypes';
import { buildCandidate } from './cadSpatialSnapCandidates';
import {
  buildExtensionCandidate,
  buildParallelCandidate,
  nearestSegmentEndpointToPoint,
  scopeAllowsSegment,
  segmentPathObstructed,
} from './cadSpatialConstruction';

export type { CadSpatialEntityCandidateContext } from './cadSpatialBlockSnaps';

const buildSegmentEntitySnapCandidates = (
  context: CadSpatialEntityCandidateContext,
  entity: CadLineEntity | CadPolylineEntity | CadPolygonEntity | CadParcelEntity | CadFeatureLineEntity,
  restrictSegmentIds?: ReadonlySet<string>,
): CadSnapCandidate[] => {
  const {
    allowed,
    basePoint,
    constructionContext,
    extensionScope,
    hasPerpendicularStartSeed,
    parallelScope,
    requireExplicitScope,
    segments,
    worldPoint,
  } = context;
  const candidates: CadSnapCandidate[] = [];

  entitySegments(entity).forEach((segment) => {
    if (restrictSegmentIds && !restrictSegmentIds.has(segment.segmentId)) return;
    if (allowed.has('endpoint')) {
      candidates.push(
        buildCandidate(
          'endpoint',
          entity.id,
          segment.start,
          worldPoint,
          segment.startLabel,
          undefined,
          segment.segmentId,
        ),
        buildCandidate(
          'endpoint',
          entity.id,
          segment.end,
          worldPoint,
          segment.endLabel,
          undefined,
          segment.segmentId,
        ),
      );
    }
    if (allowed.has('midpoint')) {
      candidates.push(
        buildCandidate(
          'midpoint',
          entity.id,
          cadMidpoint(segment.start, segment.end),
          worldPoint,
          segment.label,
          undefined,
          segment.segmentId,
        ),
      );
    }
    if (allowed.has('nearest')) {
      candidates.push(
        buildCandidate(
          'nearest',
          entity.id,
          cadClosestPointOnSegment(worldPoint, segment.start, segment.end),
          worldPoint,
          segment.label,
          undefined,
          segment.segmentId,
        ),
      );
    }
    if (constructionContext.active && allowed.has('extension')) {
      if (!scopeAllowsSegment(extensionScope, segment.segmentId, requireExplicitScope)) {
        return;
      }
      const extensionPoint = buildExtensionCandidate(segment, worldPoint);
      if (extensionPoint) {
        const extensionAnchor = nearestSegmentEndpointToPoint(segment, extensionPoint);
        if (segmentPathObstructed(extensionAnchor, extensionPoint, segments, new Set([segment.segmentId]))) {
          return;
        }
        candidates.push(
          buildCandidate(
            'extension',
            entity.id,
            extensionPoint,
            worldPoint,
            `${segment.label} ext`,
            [[extensionAnchor, extensionPoint]],
            segment.segmentId,
          ),
        );
      }
    }
    if (
      constructionContext.active &&
      basePoint &&
      allowed.has('perpendicular') &&
      !hasPerpendicularStartSeed
    ) {
      const perpendicularPoint = cadProjectPointOntoInfiniteLine(basePoint, segment.start, segment.end).point;
      candidates.push(
        buildCandidate(
          'perpendicular',
          entity.id,
          perpendicularPoint,
          worldPoint,
          `${segment.label} perp`,
          [[basePoint, perpendicularPoint]],
          segment.segmentId,
          undefined,
          perpendicularPoint,
        ),
      );
    }
    if (constructionContext.active && basePoint && allowed.has('parallel')) {
      if (!scopeAllowsSegment(parallelScope, segment.segmentId, true)) {
        return;
      }
      const parallelPoint = buildParallelCandidate(segment, basePoint, worldPoint);
      if (parallelPoint) {
        candidates.push(
          buildCandidate(
            'parallel',
            entity.id,
            parallelPoint,
            worldPoint,
            `${segment.label} parallel`,
            [
              [basePoint, parallelPoint],
              [segment.start, segment.end],
            ],
            segment.segmentId,
          ),
        );
      }
    }
  });

  return candidates;
};

/**
 * Phase 19C parcel routing: line courses keep the exact chord-segment path
 * above; arc courses expose the existing arc snap types (endpoint /
 * arc-midpoint / center / quadrant / nearest) through the existing arc
 * engine — no parcel-only snap math. Invalid or all-line geometry keeps
 * the legacy chord path verbatim.
 */
const buildParcelSnapCandidates = (
  context: CadSpatialEntityCandidateContext,
  entity: CadParcelEntity,
): CadSnapCandidate[] => {
  const geometry = entity.courseGeometry;
  if (geometry == null || geometry.length !== entity.vertices.length) {
    return buildSegmentEntitySnapCandidates(context, entity);
  }
  if (!validateParcelCourseGeometry(entity.vertices, geometry).ok) {
    return buildSegmentEntitySnapCandidates(context, entity);
  }
  const arcCourseIndexes = new Set<number>();
  geometry.forEach((entry, index) => {
    if (parcelCourseCanonicalKind(entry) === 'arc') arcCourseIndexes.add(index);
  });
  if (arcCourseIndexes.size === 0) return buildSegmentEntitySnapCandidates(context, entity);
  const candidates: CadSnapCandidate[] = [];
  const lineSegmentIds = new Set<string>();
  entity.vertices.forEach((_, index) => {
    if (!arcCourseIndexes.has(index)) lineSegmentIds.add(`${entity.id}#${index}`);
  });
  candidates.push(...buildSegmentEntitySnapCandidates(context, entity, lineSegmentIds));
  arcCourseIndexes.forEach((index) => {
    const entry = geometry[index];
    if (entry?.kind !== 'arc') return;
    const from = entity.vertices[index]!;
    const to = entity.vertices[(index + 1) % entity.vertices.length]!;
    const metrics = describeParcelArcCourse(from, to, entry.bulge);
    if (!metrics) return;
    // Pseudo arc entity: the arc candidate builder only reads entity.id
    // for subpart labels; sweep/containment come from the ref below.
    const pseudo: CadArcEntity = {
      id: entity.id,
      type: 'arc',
      layerId: entity.layerId,
      visible: true,
      locked: false,
      centerX: metrics.center.x,
      centerY: metrics.center.y,
      radius: metrics.radius,
      startAngleDeg: metrics.startAngleDeg,
      endAngleDeg: metrics.endAngleDeg,
    };
    candidates.push(
      ...buildArcEntitySnapCandidates(context, pseudo, {
        sourceEntityId: entity.id,
        segmentId: `${entity.id}#${index}`,
        center: { ...metrics.center },
        radius: metrics.radius,
        startAngleDeg: metrics.startAngleDeg,
        endAngleDeg: metrics.endAngleDeg,
        startPoint: { ...from },
        endPoint: { ...to },
        label: `${entity.parcelName}#${index}`,
      }),
    );
  });
  return candidates;
};

/**
 * Phase 20A feature-line routing: line courses use the exact chord-segment
 * path (endpoint/midpoint/nearest); arc courses expose the existing arc snap
 * types (endpoint/arc-midpoint/center/quadrant/nearest) through the same
 * engine — no feature-line-only snap math. Plan-only: Z is ambiguous at a
 * plan intersection and is documented as such.
 */
const buildFeatureLineSnapCandidates = (
  context: CadSpatialEntityCandidateContext,
  entity: CadFeatureLineEntity,
): CadSnapCandidate[] => {
  const resolved = resolveCadFeatureLine(entity);
  if (!resolved) return [];
  const arcCourses = resolved.courses.filter(
    (course) =>
      course.kind === 'arc' &&
      course.center != null &&
      course.radius != null &&
      course.startAngleDeg != null &&
      course.signedSweepDeg != null,
  );
  if (arcCourses.length === 0) return buildSegmentEntitySnapCandidates(context, entity);
  const candidates: CadSnapCandidate[] = [];
  const arcIndexes = new Set(arcCourses.map((course) => course.index));
  const lineSegmentIds = new Set(
    resolved.courses
      .filter((course) => !arcIndexes.has(course.index))
      .map((course) => `${entity.id}#${course.index}`),
  );
  candidates.push(...buildSegmentEntitySnapCandidates(context, entity, lineSegmentIds));
  arcCourses.forEach((course) => {
    const startAngleDeg = course.startAngleDeg!;
    const endAngleDeg = startAngleDeg + course.signedSweepDeg!;
    const pseudo: CadArcEntity = {
      id: entity.id,
      type: 'arc',
      layerId: entity.layerId,
      visible: true,
      locked: false,
      centerX: course.center!.x,
      centerY: course.center!.y,
      radius: course.radius!,
      startAngleDeg,
      endAngleDeg,
    };
    candidates.push(
      ...buildArcEntitySnapCandidates(context, pseudo, {
        sourceEntityId: entity.id,
        segmentId: `${entity.id}#${course.index}`,
        center: { ...course.center! },
        radius: course.radius!,
        startAngleDeg,
        endAngleDeg,
        startPoint: { x: course.from.x, y: course.from.y },
        endPoint: { x: course.to.x, y: course.to.y },
        label: `${entity.name ?? entity.id}#${course.index}`,
      }),
    );
  });
  return candidates;
};

/**
 * Phase C2 polyline routing: line courses keep the exact chord-segment
 * path (endpoint/midpoint/nearest/perp/parallel); arc courses expose the
 * existing arc snap types (endpoint/arc-midpoint/center/quadrant/nearest/
 * tangent/perpendicular) through the one arc engine — never chord math.
 * `entitySegments` already excludes arc courses, so the segment pass never
 * emits a bulged chord.
 */
const buildPolylineSnapCandidates = (
  context: CadSpatialEntityCandidateContext,
  entity: CadPolylineEntity,
): CadSnapCandidate[] => {
  const courses = resolveCadPolylineCourses(entity);
  if (!courses) return [];
  const arcCourses = courses.filter((course) => course.kind === 'arc' && course.metrics != null);
  if (arcCourses.length === 0) return buildSegmentEntitySnapCandidates(context, entity);
  const candidates: CadSnapCandidate[] = [];
  candidates.push(...buildSegmentEntitySnapCandidates(context, entity));
  arcCourses.forEach((course) => {
    const metrics = course.metrics!;
    const pseudo: CadArcEntity = {
      id: entity.id,
      type: 'arc',
      layerId: entity.layerId,
      visible: true,
      locked: false,
      centerX: metrics.center.x,
      centerY: metrics.center.y,
      radius: metrics.radius,
      startAngleDeg: metrics.startAngleDeg,
      endAngleDeg: metrics.startAngleDeg + metrics.signedSweepDeg,
    };
    candidates.push(
      ...buildArcEntitySnapCandidates(context, pseudo, {
        sourceEntityId: entity.id,
        segmentId: `${entity.id}#${course.index}`,
        center: { ...metrics.center },
        radius: metrics.radius,
        startAngleDeg: metrics.startAngleDeg,
        endAngleDeg: metrics.startAngleDeg + metrics.signedSweepDeg,
        startPoint: { x: course.from.x, y: course.from.y },
        endPoint: { x: course.to.x, y: course.to.y },
        label: `${getCadEntityDisplayLabel(entity)}#${course.index}`,
      }),
    );
  });
  return candidates;
};

export const buildArcEntitySnapCandidates = (
  context: CadSpatialEntityCandidateContext,
  entity: CadArcEntity,
  arc: CadArcRef,
): CadSnapCandidate[] => {
  const { allowed, basePoint, constructionContext, hasPerpendicularStartSeed, project, worldPoint } =
    context;
  const candidates: CadSnapCandidate[] = [];
  // Phase C2: arc-course identity rides on every arc candidate so a locked
  // tangent/perp, Circle TTR/TTT, or Line L1 source selection can resolve the
  // exact course of a multi-arc polyline/feature-line. Standalone arc refs
  // leave `segmentId` absent and keep the legacy entity-only attribution.
  const sourceSegmentId = arc.segmentId;

  if (allowed.has('endpoint')) {
    candidates.push(
      buildCandidate(
        'endpoint',
        entity.id,
        arc.startPoint,
        worldPoint,
        getCadEntitySubpartDisplayLabel(project, entity.id, 'arc-start'),
        undefined,
        sourceSegmentId,
      ),
      buildCandidate(
        'endpoint',
        entity.id,
        arc.endPoint,
        worldPoint,
        getCadEntitySubpartDisplayLabel(project, entity.id, 'arc-end'),
        undefined,
        sourceSegmentId,
      ),
    );
  }
  if (allowed.has('center')) {
    candidates.push(
      buildCandidate(
        'center',
        entity.id,
        arc.center,
        worldPoint,
        getCadEntitySubpartDisplayLabel(project, entity.id, 'center'),
        undefined,
        sourceSegmentId,
      ),
    );
  }
  if (allowed.has('arc-midpoint')) {
    candidates.push(
      buildCandidate(
        'arc-midpoint',
        entity.id,
        cadArcMidpoint(arc.center, arc.radius, arc.startAngleDeg, arc.endAngleDeg),
        worldPoint,
        getCadEntitySubpartDisplayLabel(project, entity.id, 'arc-midpoint'),
        undefined,
        sourceSegmentId,
      ),
    );
  }
  if (allowed.has('quadrant')) {
    [0, 90, 180, 270].forEach((angleDeg) => {
      if (!cadIsAngleOnArcSweep(angleDeg, arc.startAngleDeg, arc.endAngleDeg)) return;
      candidates.push(
        buildCandidate(
          'quadrant',
          entity.id,
          cadPointOnCircle(arc.center, arc.radius, angleDeg),
          worldPoint,
          getCadEntitySubpartDisplayLabel(project, entity.id, 'quadrant', { quadrantAngleDeg: angleDeg }),
          undefined,
          sourceSegmentId,
        ),
      );
    });
  }
  if (allowed.has('nearest')) {
    candidates.push(
      buildCandidate(
        'nearest',
        entity.id,
        cadClosestPointOnArc(worldPoint, arc.center, arc.radius, arc.startAngleDeg, arc.endAngleDeg),
        worldPoint,
        arc.label,
        undefined,
        sourceSegmentId,
      ),
    );
  }
  if (
    constructionContext.active &&
    basePoint &&
    allowed.has('perpendicular') &&
    !hasPerpendicularStartSeed
  ) {
    const perpendicularPoint = cadClosestPointOnArc(
      basePoint,
      arc.center,
      arc.radius,
      arc.startAngleDeg,
      arc.endAngleDeg,
    );
    candidates.push(
      buildCandidate(
        'perpendicular',
        entity.id,
        perpendicularPoint,
        worldPoint,
        `${arc.label} perp`,
        [
          [basePoint, perpendicularPoint],
          [arc.center, perpendicularPoint],
        ],
        sourceSegmentId,
      ),
    );
  }
  if (constructionContext.active && basePoint && allowed.has('tangent')) {
    cadTangentPointsFromExternalPointToArc(
      basePoint,
      arc.center,
      arc.radius,
      arc.startAngleDeg,
      arc.endAngleDeg,
    ).forEach((tangentPoint) => {
      const tangentLineDistance = cadDistance(
        worldPoint,
        cadProjectPointOntoInfiniteLine(worldPoint, basePoint, tangentPoint).point,
      );
      candidates.push(
        buildCandidate(
          'tangent',
          entity.id,
          tangentPoint,
          worldPoint,
          `${arc.label} tangent`,
          [
            [basePoint, tangentPoint],
            [arc.center, tangentPoint],
          ],
          sourceSegmentId,
          tangentLineDistance,
          tangentPoint,
        ),
      );
    });
  }

  return candidates;
};

const radialRimPoint = (
  center: CadWorldPoint,
  radius: number,
  point: CadWorldPoint,
): CadWorldPoint => {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const length = Math.hypot(dx, dy);
  if (length <= CAD_XY_DEGENERATE_FLOOR) return cadPointOnCircle(center, radius, 0);
  return { x: center.x + (dx / length) * radius, y: center.y + (dy / length) * radius };
};

export const buildCircleEntitySnapCandidates = (
  context: CadSpatialEntityCandidateContext,
  entity: CadCircleEntity,
): CadSnapCandidate[] => {
  const { allowed, basePoint, constructionContext, project, worldPoint } = context;
  const center = { x: entity.centerX, y: entity.centerY };
  const candidates: CadSnapCandidate[] = [];
  // A circle has no endpoints or midpoints: only center, quadrant,
  // nearest, tangent, perpendicular, and intersection kinds are emitted.
  if (allowed.has('center')) {
    candidates.push(
      buildCandidate(
        'center',
        entity.id,
        center,
        worldPoint,
        getCadEntitySubpartDisplayLabel(project, entity.id, 'center'),
      ),
    );
  }
  if (allowed.has('quadrant')) {
    [0, 90, 180, 270].forEach((angleDeg) => {
      candidates.push(
        buildCandidate(
          'quadrant',
          entity.id,
          cadPointOnCircle(center, entity.radius, angleDeg),
          worldPoint,
          getCadEntitySubpartDisplayLabel(project, entity.id, 'quadrant', { quadrantAngleDeg: angleDeg }),
        ),
      );
    });
  }
  if (allowed.has('nearest')) {
    candidates.push(
      buildCandidate(
        'nearest',
        entity.id,
        radialRimPoint(center, entity.radius, worldPoint),
        worldPoint,
        getCadEntityDisplayLabel(entity),
      ),
    );
  }
  if (constructionContext.active && basePoint && allowed.has('perpendicular')) {
    const perpendicularPoint = radialRimPoint(center, entity.radius, basePoint);
    candidates.push(
      buildCandidate(
        'perpendicular',
        entity.id,
        perpendicularPoint,
        worldPoint,
        `${getCadEntityDisplayLabel(entity)} perp`,
        [
          [basePoint, perpendicularPoint],
          [center, perpendicularPoint],
        ],
      ),
    );
  }
  if (constructionContext.active && basePoint && allowed.has('tangent')) {
    cadTangentPointsFromExternalPointToCircle(basePoint, center, entity.radius).forEach((tangentPoint) => {
      const tangentLineDistance = cadDistance(
        worldPoint,
        cadProjectPointOntoInfiniteLine(worldPoint, basePoint, tangentPoint).point,
      );
      candidates.push(
        buildCandidate(
          'tangent',
          entity.id,
          tangentPoint,
          worldPoint,
          `${getCadEntityDisplayLabel(entity)} tangent`,
          [
            [basePoint, tangentPoint],
            [center, tangentPoint],
          ],
          undefined,
          tangentLineDistance,
          tangentPoint,
        ),
      );
    });
  }
  return candidates;
};

export const buildCadSpatialEntitySnapCandidates = (
  context: CadSpatialEntityCandidateContext,
): CadSnapCandidate[] => {
  const candidates: CadSnapCandidate[] = [];

  context.visibleEntities.forEach((entity) => {
    switch (entity.type) {
      case 'block-reference':
        candidates.push(...buildBlockReferenceSnapCandidates(context, entity));
        break;
      case 'survey-point':
        if (context.allowed.has('point-node')) {
          candidates.push(
            buildCandidate(
              'point-node',
              entity.id,
              { x: entity.x, y: entity.y },
              context.worldPoint,
              entity.stationId,
            ),
          );
        }
        break;
      case 'line':
      case 'polygon':
        candidates.push(...buildSegmentEntitySnapCandidates(context, entity));
        break;
      case 'polyline':
        candidates.push(...buildPolylineSnapCandidates(context, entity));
        break;
      case 'parcel':
        candidates.push(...buildParcelSnapCandidates(context, entity));
        break;
      case 'feature-line':
        candidates.push(...buildFeatureLineSnapCandidates(context, entity));
        break;
      case 'arc':
        candidates.push(...buildArcEntitySnapCandidates(context, entity, arcRefFromEntity(context.project, entity)));
        break;
      case 'circle':
        candidates.push(...buildCircleEntitySnapCandidates(context, entity));
        break;
      default:
        break;
    }
  });

  return candidates;
};
