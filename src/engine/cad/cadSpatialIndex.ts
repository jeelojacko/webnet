import {
  cadInfiniteLineIntersection,
  cadIntersectArcArc,
  cadIntersectCircleCircle,
  cadIntersectInfiniteLineArc,
  cadIntersectSegmentArc,
  cadProjectPointOntoInfiniteLine,
  cadSegmentIntersection,
  type CadWorldPoint,
} from './cadGeometry';
import { getCadEntityDisplayLabel } from './cadEntityNames';
import type {
  CadArcEntity,
  CadBounds,
  CadLineEntity,
  CadParcelEntity,
  CadPolygonEntity,
  CadPolylineEntity,
  CadProject,
  CadSnapCandidate,
  CadSnapConstructionContext,
  CadSnapKind,
} from './cadTypes';
import { entityIntersectsBounds, expandBounds } from './cadSpatialBounds';
import { buildCadSpatialEntitySnapCandidates } from './cadSpatialEntityCandidates';
import { arcRefFromEntity, entitySegments } from './cadSpatialEntityRefs';
import type { CadArcRef, CadSegmentRef, CadSpatialIndex } from './cadSpatialIndexTypes';
import {
  CONSTRUCTION_LOCK_KINDS,
  DIRECTION_SNAPS,
  SNAP_RANGE_MULTIPLIER,
} from './cadSpatialSnapConstants';
import {
  buildCandidate,
  buildCompoundConstructionCandidate,
  candidateSort,
  compoundCandidateSort,
  dedupeCandidates,
  pointOnCandidateLine,
} from './cadSpatialSnapCandidates';

import {
  buildDirectionCandidate,
  buildLockedConstructionPoint,
  buildLockedLineIntersectionCandidates,
  buildPerpendicularThroughBaseCandidate,
  buildPerpendicularThroughTangentSeedCandidate,
  buildScopedSegmentIds,
  buildTangentThroughArcPointCandidate,
  candidateMatchesLockedSnap,
  nearestArcEndpointToPoint,
  nearestSegmentEndpointToPoint,
  scopeAllowsSegment,
  segmentPathObstructed,
} from './cadSpatialConstruction';
export const buildCadSpatialIndex = (project: CadProject): CadSpatialIndex => {
  const querySnapCandidates = (
    worldPoint: CadWorldPoint,
    toleranceWorld: number,
    allowedKinds: readonly CadSnapKind[] = [
      'point-node',
      'endpoint',
      'midpoint',
      'center',
      'arc-midpoint',
      'quadrant',
      'intersection',
      'apparent-intersection',
      'extension',
      'perpendicular',
      'parallel',
      'tangent',
      'nearest',
    ],
    constructionContext: CadSnapConstructionContext = { active: false, basePoint: null },
    visibleBounds: CadBounds | null = null,
  ): CadSnapCandidate[] => {
    const allowed = new Set(allowedKinds);
    const candidates: CadSnapCandidate[] = [];
    const visibleQueryBounds = visibleBounds ? expandBounds(visibleBounds, toleranceWorld * 1.5) : null;
    const visibleEntities = visibleQueryBounds
      ? project.entities.filter(
          (entity) => entity.visible && entityIntersectsBounds(project, entity, visibleQueryBounds),
        )
      : project.entities.filter((entity) => entity.visible);
    const segments = visibleEntities
      .filter((entity): entity is CadLineEntity | CadPolylineEntity | CadPolygonEntity | CadParcelEntity =>
        entity.type === 'line' ||
          entity.type === 'polyline' ||
          entity.type === 'polygon' ||
          entity.type === 'parcel',
      )
      .flatMap((entity) => entitySegments(entity));
    const arcs = visibleEntities
      .filter((entity): entity is CadArcEntity => entity.type === 'arc')
      .map((entity) => arcRefFromEntity(project, entity));
    const basePoint = constructionContext.active ? constructionContext.basePoint : null;
    const scopeSeedSegmentId = constructionContext.scopeSeedSegmentId ?? null;
    const scopeSeedSegment = scopeSeedSegmentId
      ? segments.find((segment) => segment.segmentId === scopeSeedSegmentId) ?? null
      : null;
    const tangentSeedArcEntityId = constructionContext.tangentSeedArcEntityId ?? null;
    const tangentSeedPoint = constructionContext.tangentSeedPoint ?? basePoint;
    const tangentSeedArc = tangentSeedArcEntityId
      ? arcs.find((arc) => arc.sourceEntityId === tangentSeedArcEntityId) ?? null
      : null;
    const hasPerpendicularStartSeed = scopeSeedSegment != null || tangentSeedArc != null;
    const parallelScope = constructionContext.active ? buildScopedSegmentIds(segments, basePoint, scopeSeedSegmentId, 1) : null;
    const extensionScope = constructionContext.active ? buildScopedSegmentIds(segments, basePoint, scopeSeedSegmentId, 2) : null;
    const apparentScope = constructionContext.active ? buildScopedSegmentIds(segments, basePoint, scopeSeedSegmentId, 2) : null;
    const requireExplicitScope = constructionContext.active && scopeSeedSegmentId != null;

    candidates.push(
      ...buildCadSpatialEntitySnapCandidates({
        project,
        visibleEntities,
        segments,
        worldPoint,
        allowed,
        constructionContext,
        basePoint,
        hasPerpendicularStartSeed,
        parallelScope,
        extensionScope,
        requireExplicitScope,
      }),
    );

    if (constructionContext.active && basePoint && scopeSeedSegment && allowed.has('perpendicular')) {
      const startPerpendicularPoint = buildPerpendicularThroughBaseCandidate(scopeSeedSegment, basePoint, worldPoint);
      if (startPerpendicularPoint) {
        candidates.push(
          buildCandidate(
            'perpendicular',
            scopeSeedSegment.sourceEntityId,
            startPerpendicularPoint,
            worldPoint,
            `${scopeSeedSegment.label} start perp`,
            [
              [basePoint, startPerpendicularPoint],
              [scopeSeedSegment.start, scopeSeedSegment.end],
            ],
            scopeSeedSegment.segmentId,
            undefined,
            cadProjectPointOntoInfiniteLine(basePoint, scopeSeedSegment.start, scopeSeedSegment.end).point,
          ),
        );
      }
    }

    if (constructionContext.active && tangentSeedArc && tangentSeedPoint && allowed.has('perpendicular')) {
      const curveStartPerpendicularPoint = buildPerpendicularThroughTangentSeedCandidate(
        tangentSeedArc,
        tangentSeedPoint,
        worldPoint,
      );
      if (curveStartPerpendicularPoint) {
        candidates.push(
          buildCandidate(
            'perpendicular',
            tangentSeedArc.sourceEntityId,
            curveStartPerpendicularPoint,
            worldPoint,
            `${tangentSeedArc.label} start perp`,
            [
              [tangentSeedPoint, curveStartPerpendicularPoint],
              [tangentSeedArc.center, tangentSeedPoint],
            ],
            undefined,
            undefined,
            tangentSeedArc.center,
          ),
        );
      }
    }

    if (constructionContext.active && basePoint && tangentSeedArc && allowed.has('tangent')) {
      const tangentPoint = buildTangentThroughArcPointCandidate(tangentSeedArc, basePoint, worldPoint);
      if (tangentPoint) {
        candidates.push(
          buildCandidate(
            'tangent',
            tangentSeedArc.sourceEntityId,
            tangentPoint,
            worldPoint,
            `${tangentSeedArc.label} tangent`,
            [
              [basePoint, tangentPoint],
              [tangentSeedArc.center, basePoint],
            ],
            undefined,
            undefined,
            tangentPoint,
          ),
        );
      }
    }

    if (constructionContext.active && basePoint && allowed.has('direction')) {
      const directionSnap = buildDirectionCandidate(basePoint, worldPoint);
      if (directionSnap) {
        candidates.push(
          buildCandidate(
            'direction',
            'direction-guide',
            directionSnap.point,
            worldPoint,
            `${directionSnap.label} ${directionSnap.azimuthDeg.toString().padStart(3, '0')}°`,
            [[basePoint, directionSnap.point]],
          ),
        );
      }
    }

    if (allowed.has('intersection')) {
      for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < segments.length; rightIndex += 1) {
          const left = segments[leftIndex];
          const right = segments[rightIndex];
          const intersection = cadSegmentIntersection(left.start, left.end, right.start, right.end);
          if (!intersection) continue;
          candidates.push(
            buildCandidate(
              'intersection',
              `${left.sourceEntityId}|${right.sourceEntityId}`,
              intersection,
              worldPoint,
              `${left.label} x ${right.label}`,
            ),
          );
        }
      }
      segments.forEach((segment) => {
        arcs.forEach((arc) => {
          cadIntersectSegmentArc(
            segment.start,
            segment.end,
            arc.center,
            arc.radius,
            arc.startAngleDeg,
            arc.endAngleDeg,
          ).forEach((intersection) => {
            candidates.push(
              buildCandidate(
                'intersection',
                `${segment.sourceEntityId}|${arc.sourceEntityId}`,
                intersection,
                worldPoint,
                `${segment.label} x ${arc.label}`,
              ),
            );
          });
        });
      });
      for (let leftIndex = 0; leftIndex < arcs.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < arcs.length; rightIndex += 1) {
          const left = arcs[leftIndex];
          const right = arcs[rightIndex];
          cadIntersectArcArc(
            left.center,
            left.radius,
            left.startAngleDeg,
            left.endAngleDeg,
            right.center,
            right.radius,
            right.startAngleDeg,
            right.endAngleDeg,
          ).forEach((intersection) => {
            candidates.push(
              buildCandidate(
                'intersection',
                `${left.sourceEntityId}|${right.sourceEntityId}`,
                intersection,
                worldPoint,
                `${left.label} x ${right.label}`,
              ),
            );
          });
        }
      }
    }
    if (constructionContext.active && allowed.has('apparent-intersection')) {
      for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < segments.length; rightIndex += 1) {
          const left = segments[leftIndex];
          const right = segments[rightIndex];
          if (
            !scopeAllowsSegment(apparentScope, left.segmentId, requireExplicitScope) ||
            !scopeAllowsSegment(apparentScope, right.segmentId, requireExplicitScope)
          ) {
            continue;
          }
          if (cadSegmentIntersection(left.start, left.end, right.start, right.end)) continue;
          const intersection = cadInfiniteLineIntersection(left.start, left.end, right.start, right.end);
          if (!intersection) continue;
          const leftAnchor = nearestSegmentEndpointToPoint(left, intersection);
          const rightAnchor = nearestSegmentEndpointToPoint(right, intersection);
          if (
            segmentPathObstructed(leftAnchor, intersection, segments, new Set([left.segmentId, right.segmentId])) ||
            segmentPathObstructed(rightAnchor, intersection, segments, new Set([left.segmentId, right.segmentId]))
          ) {
            continue;
          }
          candidates.push(
            buildCandidate(
              'apparent-intersection',
              `${left.sourceEntityId}|${right.sourceEntityId}`,
              intersection,
              worldPoint,
              `${left.label} x ${right.label} apparent`,
              [
                [leftAnchor, intersection],
                [rightAnchor, intersection],
              ],
            ),
          );
        }
      }
      segments.forEach((segment) => {
        if (!scopeAllowsSegment(apparentScope, segment.segmentId, requireExplicitScope)) {
          return;
        }
        arcs.forEach((arc) => {
          const exactIntersections = cadIntersectSegmentArc(
            segment.start,
            segment.end,
            arc.center,
            arc.radius,
            arc.startAngleDeg,
            arc.endAngleDeg,
          );
          cadIntersectInfiniteLineArc(
            segment.start,
            segment.end,
            arc.center,
            arc.radius,
            arc.startAngleDeg,
            arc.endAngleDeg,
          )
            .filter((intersection) => !exactIntersections.some(
              (exact) =>
                Math.abs(exact.x - intersection.x) <= 1e-9 &&
                Math.abs(exact.y - intersection.y) <= 1e-9,
            ))
            .forEach((intersection) => {
              const segmentAnchor = nearestSegmentEndpointToPoint(segment, intersection);
              if (
                segmentPathObstructed(
                  segmentAnchor,
                  intersection,
                  segments,
                  new Set([segment.segmentId]),
                )
              ) {
                return;
              }
              candidates.push(
                buildCandidate(
                  'apparent-intersection',
                  `${segment.sourceEntityId}|${arc.sourceEntityId}`,
                  intersection,
                  worldPoint,
                  `${segment.label} x ${arc.label} apparent`,
                  [
                    [segmentAnchor, intersection],
                    [nearestArcEndpointToPoint(arc, intersection), intersection],
                  ],
                ),
              );
            });
        });
      });
      for (let leftIndex = 0; leftIndex < arcs.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < arcs.length; rightIndex += 1) {
          const left = arcs[leftIndex];
          const right = arcs[rightIndex];
          const exactIntersections = cadIntersectArcArc(
            left.center,
            left.radius,
            left.startAngleDeg,
            left.endAngleDeg,
            right.center,
            right.radius,
            right.startAngleDeg,
            right.endAngleDeg,
          );
          cadIntersectCircleCircle(left.center, left.radius, right.center, right.radius)
            .filter((intersection) => !exactIntersections.some(
              (exact) =>
                Math.abs(exact.x - intersection.x) <= 1e-9 &&
                Math.abs(exact.y - intersection.y) <= 1e-9,
            ))
            .forEach((intersection) => {
              candidates.push(
                buildCandidate(
                  'apparent-intersection',
                  `${left.sourceEntityId}|${right.sourceEntityId}`,
                  intersection,
                  worldPoint,
                  `${left.label} x ${right.label} apparent`,
                  [
                    [nearestArcEndpointToPoint(left, intersection), intersection],
                    [nearestArcEndpointToPoint(right, intersection), intersection],
                  ],
                ),
              );
            });
        }
      }
    }

    if (constructionContext.lockedSnap && basePoint) {
      const lockedSegment = segments.find(
        (segment) =>
          (constructionContext.lockedSnap?.sourceSegmentId != null &&
            segment.segmentId === constructionContext.lockedSnap.sourceSegmentId) ||
          segment.sourceEntityId === constructionContext.lockedSnap?.sourceEntityId,
      );
      const lockedArc =
        constructionContext.lockedSnap.kind === 'tangent' ||
        constructionContext.lockedSnap.kind === 'perpendicular'
          ? arcs.find((arc) => arc.sourceEntityId === constructionContext.lockedSnap?.sourceEntityId) ?? null
          : null;
      const tangentGuidePoint = constructionContext.lockedSnap.guidePoint ?? null;
      const lockedPoint =
        lockedArc && tangentGuidePoint
          ? cadProjectPointOntoInfiniteLine(worldPoint, basePoint, tangentGuidePoint).point
          : lockedSegment && constructionContext.lockedSnap.kind !== 'tangent'
            ? buildLockedConstructionPoint(
                constructionContext.lockedSnap.kind,
                lockedSegment,
                basePoint,
                worldPoint,
              )
            : null;
      if (lockedPoint) {
        const lockedSourceEntityId =
          constructionContext.lockedSnap.kind === 'tangent'
            ? lockedArc?.sourceEntityId ?? constructionContext.lockedSnap.sourceEntityId
            : lockedSegment?.sourceEntityId ?? constructionContext.lockedSnap.sourceEntityId;
        const lockedSourceEntity =
          project.entities.find((entity) => entity.id === lockedSourceEntityId) ?? null;
        const lockedSourceLabel = lockedArc?.label ?? (lockedSourceEntity ? getCadEntityDisplayLabel(lockedSourceEntity) : lockedSourceEntityId);
        const explicitLockedConstructionCandidate = buildCandidate(
          constructionContext.lockedSnap.kind,
          lockedSourceEntityId,
          lockedPoint,
          worldPoint,
          constructionContext.lockedSnap.kind === 'tangent'
            ? `${lockedSourceLabel} tangent`
            : `${lockedSegment?.label ?? lockedSourceLabel} ${
                constructionContext.lockedSnap.kind === 'extension'
                  ? 'ext'
                  : constructionContext.lockedSnap.kind === 'parallel'
                    ? 'parallel'
                    : 'perp'
              }`,
          constructionContext.lockedSnap.kind === 'tangent'
            ? [
                [basePoint, lockedPoint],
                ...(lockedArc ? [[lockedArc.center, tangentGuidePoint ?? lockedPoint] as [CadWorldPoint, CadWorldPoint]] : []),
              ]
            : lockedArc
              ? [
                  [basePoint, lockedPoint],
                  [lockedArc.center, basePoint],
                ]
            : [
                [basePoint, lockedPoint],
                [lockedSegment!.start, lockedSegment!.end],
              ],
          constructionContext.lockedSnap.sourceSegmentId,
          undefined,
          tangentGuidePoint ?? undefined,
        );
        candidates.push(explicitLockedConstructionCandidate);
        if (constructionContext.lockedSnap.kind !== 'extension') {
          candidates.push(
            ...buildLockedLineIntersectionCandidates(
              basePoint,
              lockedPoint,
              worldPoint,
              segments,
              arcs,
              constructionContext.lockedSnap.kind,
              lockedSourceEntityId,
            ),
          );
        }
      }
    }

    return dedupeCandidates(candidates)
      .filter(
        (candidate) =>
          candidate.distance <= toleranceWorld * SNAP_RANGE_MULTIPLIER[candidate.kind] ||
          candidateMatchesLockedSnap(candidate, constructionContext.lockedSnap),
      )
      .sort(candidateSort);
  };

  return {
    querySnapCandidates,
    queryNearestSnap: (
    worldPoint: CadWorldPoint,
    toleranceWorld: number,
    allowedKinds: readonly CadSnapKind[] = [
      'point-node',
      'endpoint',
      'midpoint',
      'center',
      'arc-midpoint',
      'quadrant',
      'intersection',
      'apparent-intersection',
      'extension',
      'perpendicular',
      'parallel',
      'tangent',
      'nearest',
    ],
    constructionContext: CadSnapConstructionContext = { active: false, basePoint: null },
    visibleBounds: CadBounds | null = null,
  ) => {
    const viable = querySnapCandidates(
      worldPoint,
      toleranceWorld,
      allowedKinds,
      constructionContext,
      visibleBounds,
    );
    const lockedConstructionCandidate =
      ((constructionContext.lockedSnap
        ? viable.find(
            (candidate) =>
              candidate.kind === constructionContext.lockedSnap?.kind &&
              candidateMatchesLockedSnap(candidate, constructionContext.lockedSnap),
          ) ?? null
        : null) ??
      viable.find((candidate) =>
        CONSTRUCTION_LOCK_KINDS.includes(candidate.kind),
      ) ??
      null);
    if (lockedConstructionCandidate) {
      const compoundCandidate = viable
        .filter((candidate) =>
          candidate.id !== lockedConstructionCandidate.id &&
          candidate.kind !== 'nearest' &&
          !CONSTRUCTION_LOCK_KINDS.includes(candidate.kind) &&
          pointOnCandidateLine(candidate, lockedConstructionCandidate, toleranceWorld),
        )
        .sort(compoundCandidateSort)[0];
      if (compoundCandidate) {
        return buildCompoundConstructionCandidate(lockedConstructionCandidate, compoundCandidate);
      }
    }
    return viable[0] ?? null;
  },
  };
};
