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
import { getCadEntitySubpartDisplayLabel } from './cadEntityNames';
import type {
  CadArcEntity,
  CadEntity,
  CadLineEntity,
  CadParcelEntity,
  CadPolygonEntity,
  CadPolylineEntity,
  CadProject,
  CadSnapCandidate,
  CadSnapConstructionContext,
  CadSnapKind,
} from './cadTypes';
import { arcRefFromEntity, entitySegments } from './cadSpatialEntityRefs';
import type { CadArcRef, CadSegmentRef } from './cadSpatialIndexTypes';
import { buildCandidate } from './cadSpatialSnapCandidates';
import {
  buildExtensionCandidate,
  buildParallelCandidate,
  nearestSegmentEndpointToPoint,
  scopeAllowsSegment,
  segmentPathObstructed,
} from './cadSpatialConstruction';

interface CadSpatialEntityCandidateContext {
  project: CadProject;
  visibleEntities: CadEntity[];
  segments: CadSegmentRef[];
  worldPoint: CadWorldPoint;
  allowed: Set<CadSnapKind>;
  constructionContext: CadSnapConstructionContext;
  basePoint: CadWorldPoint | null;
  hasPerpendicularStartSeed: boolean;
  parallelScope: Set<string> | null;
  extensionScope: Set<string> | null;
  requireExplicitScope: boolean;
}

const buildSegmentEntitySnapCandidates = (
  context: CadSpatialEntityCandidateContext,
  entity: CadLineEntity | CadPolylineEntity | CadPolygonEntity | CadParcelEntity,
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

const buildArcEntitySnapCandidates = (
  context: CadSpatialEntityCandidateContext,
  entity: CadArcEntity,
  arc: CadArcRef,
): CadSnapCandidate[] => {
  const { allowed, basePoint, constructionContext, hasPerpendicularStartSeed, project, worldPoint } =
    context;
  const candidates: CadSnapCandidate[] = [];

  if (allowed.has('endpoint')) {
    candidates.push(
      buildCandidate(
        'endpoint',
        entity.id,
        arc.startPoint,
        worldPoint,
        getCadEntitySubpartDisplayLabel(project, entity.id, 'arc-start'),
      ),
      buildCandidate(
        'endpoint',
        entity.id,
        arc.endPoint,
        worldPoint,
        getCadEntitySubpartDisplayLabel(project, entity.id, 'arc-end'),
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
      case 'polyline':
      case 'polygon':
      case 'parcel':
        candidates.push(...buildSegmentEntitySnapCandidates(context, entity));
        break;
      case 'arc':
        candidates.push(...buildArcEntitySnapCandidates(context, entity, arcRefFromEntity(context.project, entity)));
        break;
      default:
        break;
    }
  });

  return candidates;
};
