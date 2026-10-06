import {
  cadAngleDegFromCenter,
  cadInfiniteLineIntersection,
  cadIntersectArcArc,
  cadIntersectCircleCircle,
  cadIntersectInfiniteLineArc,
  cadIntersectSegmentArc,
  cadIntersectSegmentCircle,
  cadIsAngleOnArcSweep,
  cadSegmentIntersection,
  type CadWorldPoint,
} from './cadGeometry';
import type { CadArcRef, CadCircleRef, CadSegmentRef } from './cadSpatialIndexTypes';
import { buildCandidate } from './cadSpatialSnapCandidates';
import {
  nearestArcEndpointToPoint,
  nearestSegmentEndpointToPoint,
  scopeAllowsSegment,
  segmentPathObstructed,
} from './cadSpatialConstruction';
import type { CadSnapCandidate } from './cadTypes';

const pointsMatch = (left: CadWorldPoint, right: CadWorldPoint): boolean =>
  Math.abs(left.x - right.x) <= 1e-9 && Math.abs(left.y - right.y) <= 1e-9;

export const buildExactIntersectionCandidates = ({
  arcs,
  circles = [],
  segments,
  worldPoint,
}: {
  segments: CadSegmentRef[];
  arcs: CadArcRef[];
  circles?: CadCircleRef[];
  worldPoint: CadWorldPoint;
}): CadSnapCandidate[] => {
  const candidates: CadSnapCandidate[] = [];

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

  segments.forEach((segment) => {
    circles.forEach((circle) => {
      cadIntersectSegmentCircle(segment.start, segment.end, circle.center, circle.radius).forEach((intersection) => {
        candidates.push(
          buildCandidate(
            'intersection',
            `${segment.sourceEntityId}|${circle.sourceEntityId}`,
            intersection,
            worldPoint,
            `${segment.label} x ${circle.label}`,
          ),
        );
      });
    });
  });

  for (let leftIndex = 0; leftIndex < circles.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < circles.length; rightIndex += 1) {
      const left = circles[leftIndex];
      const right = circles[rightIndex];
      cadIntersectCircleCircle(left.center, left.radius, right.center, right.radius).forEach((intersection) => {
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

  arcs.forEach((arc) => {
    circles.forEach((circle) => {
      cadIntersectCircleCircle(arc.center, arc.radius, circle.center, circle.radius)
        .filter((intersection) =>
          cadIsAngleOnArcSweep(
            cadAngleDegFromCenter(arc.center, intersection),
            arc.startAngleDeg,
            arc.endAngleDeg,
          ),
        )
        .forEach((intersection) => {
          candidates.push(
            buildCandidate(
              'intersection',
              `${arc.sourceEntityId}|${circle.sourceEntityId}`,
              intersection,
              worldPoint,
              `${arc.label} x ${circle.label}`,
            ),
          );
        });
    });
  });

  return candidates;
};

export const buildApparentIntersectionCandidates = ({
  apparentScope,
  arcs,
  requireExplicitScope,
  segments,
  worldPoint,
}: {
  segments: CadSegmentRef[];
  arcs: CadArcRef[];
  apparentScope: Set<string> | null;
  requireExplicitScope: boolean;
  worldPoint: CadWorldPoint;
}): CadSnapCandidate[] => [
  ...buildApparentSegmentSegmentCandidates({
    apparentScope,
    requireExplicitScope,
    segments,
    worldPoint,
  }),
  ...buildApparentSegmentArcCandidates({
    apparentScope,
    requireExplicitScope,
    segments,
    arcs,
    worldPoint,
  }),
  ...buildApparentArcArcCandidates({ arcs, worldPoint }),
];

const buildApparentSegmentSegmentCandidates = ({
  apparentScope,
  requireExplicitScope,
  segments,
  worldPoint,
}: {
  apparentScope: Set<string> | null;
  requireExplicitScope: boolean;
  segments: CadSegmentRef[];
  worldPoint: CadWorldPoint;
}): CadSnapCandidate[] => {
  const candidates: CadSnapCandidate[] = [];
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
  return candidates;
};

const buildApparentSegmentArcCandidates = ({
  apparentScope,
  arcs,
  requireExplicitScope,
  segments,
  worldPoint,
}: {
  apparentScope: Set<string> | null;
  requireExplicitScope: boolean;
  segments: CadSegmentRef[];
  arcs: CadArcRef[];
  worldPoint: CadWorldPoint;
}): CadSnapCandidate[] => {
  const candidates: CadSnapCandidate[] = [];
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
        .filter((intersection) => !exactIntersections.some((exact) => pointsMatch(exact, intersection)))
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
  return candidates;
};

const buildApparentArcArcCandidates = ({
  arcs,
  worldPoint,
}: {
  arcs: CadArcRef[];
  worldPoint: CadWorldPoint;
}): CadSnapCandidate[] => {
  const candidates: CadSnapCandidate[] = [];
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
        .filter((intersection) => !exactIntersections.some((exact) => pointsMatch(exact, intersection)))
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
  return candidates;
};
