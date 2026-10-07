import {
  cadArcMidpoint,
  cadClosestPointOnSegment,
  cadMidpoint,
  cadPointOnCircle,
  type CadWorldPoint,
} from './cadGeometry';
import { CAD_XY_DEGENERATE_FLOOR } from './cadGeometryShapeBuilders';
import { getCadEntityDisplayLabel } from './cadEntityNames';
import { expandBlockReference, findBlockDefinition } from './cadBlocks';
import { cadPolylineVerticesWrapToFirst } from './cadPolylineGeometry';
import { arcRefFromEntity, entitySegments } from './cadSpatialEntityRefs';
import { resolveCadPolylineCourses } from './cadPolylineCourses';
import { buildCandidate } from './cadSpatialSnapCandidates';
import type {
  CadBlockReferenceEntity,
  CadEntity,
  CadProject,
  CadSnapCandidate,
  CadSnapConstructionContext,
  CadSnapKind,
} from './cadTypes';
import type { CadSegmentRef } from './cadSpatialIndexTypes';

export interface CadSpatialEntityCandidateContext {
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

/**
 * Phase 18N block snaps: insertion-point candidate plus transformed
 * endpoints/midpoints/centers of the expanded children. All points are
 * world-space (bounds-first cull already applied by the index); local
 * coordinates never leak into candidates. sourceEntityId is the reference
 * id, so downstream selection resolves to the reference.
 */
export const buildBlockReferenceSnapCandidates = (
  context: CadSpatialEntityCandidateContext,
  entity: CadBlockReferenceEntity,
): CadSnapCandidate[] => {
  const { allowed, worldPoint } = context;
  const definition = findBlockDefinition(context.project.blockDefinitions, entity.blockDefinitionId);
  if (!definition) return [];
  let children;
  try {
    children = expandBlockReference(definition, entity);
  } catch {
    return [];
  }
  const label = getCadEntityDisplayLabel(entity);
  const candidates: CadSnapCandidate[] = [];
  if (allowed.has('endpoint')) {
    candidates.push(
      buildCandidate('endpoint', entity.id, { x: entity.x, y: entity.y }, worldPoint, `${label} insertion`),
    );
  }
  children.forEach((child, childIndex) => {
    const scope = `${entity.id}#${childIndex}`;
    switch (child.type) {
      case 'line':
        if (allowed.has('endpoint')) {
          candidates.push(
            buildCandidate('endpoint', entity.id, { x: child.fromX, y: child.fromY }, worldPoint, `${label} end`, undefined, scope),
            buildCandidate('endpoint', entity.id, { x: child.toX, y: child.toY }, worldPoint, `${label} end`, undefined, scope),
          );
        }
        if (allowed.has('midpoint')) {
          candidates.push(
            buildCandidate('midpoint', entity.id, cadMidpoint({ x: child.fromX, y: child.fromY }, { x: child.toX, y: child.toY }), worldPoint, `${label} mid`, undefined, scope),
          );
        }
        break;
      case 'polyline':
      case 'polygon': {
        if (
          child.type === 'polyline' &&
          (child.segmentGeometry != null || child.segmentWidths != null)
        ) {
          const courses = resolveCadPolylineCourses(child);
          if (courses) {
            courses.forEach((course) => {
              if (course.kind === 'arc' && course.metrics != null) {
                const metrics = course.metrics;
                if (allowed.has('endpoint')) {
                  candidates.push(
                    buildCandidate('endpoint', entity.id, course.from, worldPoint, `${label} arc start`, undefined, scope),
                    buildCandidate('endpoint', entity.id, course.to, worldPoint, `${label} arc end`, undefined, scope),
                  );
                }
                if (allowed.has('midpoint')) {
                  candidates.push(
                    buildCandidate('midpoint', entity.id, cadArcMidpoint(metrics.center, metrics.radius, metrics.startAngleDeg, metrics.startAngleDeg + metrics.signedSweepDeg), worldPoint, `${label} arc mid`, undefined, scope),
                  );
                }
                if (allowed.has('center')) {
                  candidates.push(
                    buildCandidate('center', entity.id, { x: metrics.center.x, y: metrics.center.y }, worldPoint, `${label} center`, undefined, scope),
                  );
                }
                return;
              }
              if (allowed.has('endpoint')) {
                candidates.push(buildCandidate('endpoint', entity.id, course.from, worldPoint, `${label} vertex`, undefined, scope));
              }
              if (allowed.has('midpoint')) {
                candidates.push(buildCandidate('midpoint', entity.id, cadMidpoint(course.from, course.to), worldPoint, `${label} mid`, undefined, scope));
              }
            });
            if (allowed.has('center') && child.vertices.length > 0) {
              const centroid = {
                x: child.vertices.reduce((sum, vertex) => sum + vertex.x, 0) / child.vertices.length,
                y: child.vertices.reduce((sum, vertex) => sum + vertex.y, 0) / child.vertices.length,
              };
              candidates.push(
                buildCandidate('center', entity.id, centroid, worldPoint, `${label} center`, undefined, scope),
              );
            }
          }
          // Present-but-unresolvable metadata fails closed with no snap
          // candidates for this polyline, never the chord fallback below.
          break;
        }
        const ring = child.type === 'polyline'
          ? cadPolylineVerticesWrapToFirst(child.vertices, child.closed)
            ? [...child.vertices, child.vertices[0]].filter(
                (point): point is CadWorldPoint => point != null,
              )
            : child.vertices
          : [...child.vertices, child.vertices[0]].filter((point): point is CadWorldPoint => point != null);
        ring.slice(0, -1).forEach((vertex, vertexIndex) => {
          const next = ring[vertexIndex + 1]!;
          if (allowed.has('endpoint')) {
            candidates.push(
              buildCandidate('endpoint', entity.id, vertex, worldPoint, `${label} vertex`, undefined, scope),
            );
          }
          if (allowed.has('midpoint')) {
            candidates.push(
              buildCandidate('midpoint', entity.id, cadMidpoint(vertex, next), worldPoint, `${label} mid`, undefined, scope),
            );
          }
        });
        if (allowed.has('center') && ring.length > 1) {
          // C1: the duplicated ring closure is only for segment candidates;
          // the center is the centroid of the N stored vertices (averaging
          // the appended closure vertex would double-weight vertex 0).
          const centroid = {
            x: child.vertices.reduce((sum, vertex) => sum + vertex.x, 0) / child.vertices.length,
            y: child.vertices.reduce((sum, vertex) => sum + vertex.y, 0) / child.vertices.length,
          };
          candidates.push(
            buildCandidate('center', entity.id, centroid, worldPoint, `${label} center`, undefined, scope),
          );
        }
        break;
      }
      case 'arc': {
        const ref = arcRefFromEntity(context.project, { ...child, id: entity.id });
        if (allowed.has('endpoint')) {
          candidates.push(
            buildCandidate('endpoint', entity.id, ref.startPoint, worldPoint, `${label} start`, undefined, scope),
            buildCandidate('endpoint', entity.id, ref.endPoint, worldPoint, `${label} end`, undefined, scope),
          );
        }
        if (allowed.has('center')) {
          candidates.push(
            buildCandidate('center', entity.id, ref.center, worldPoint, `${label} center`, undefined, scope),
          );
        }
        if (allowed.has('arc-midpoint')) {
          candidates.push(
            buildCandidate(
              'arc-midpoint',
              entity.id,
              cadArcMidpoint(ref.center, ref.radius, ref.startAngleDeg, ref.endAngleDeg),
              worldPoint,
              `${label} arc mid`,
              undefined,
              scope,
            ),
          );
        }
        break;
      }
      case 'circle': {
        const center = { x: child.centerX, y: child.centerY };
        if (allowed.has('center')) {
          candidates.push(
            buildCandidate('center', entity.id, center, worldPoint, `${label} center`, undefined, scope),
          );
        }
        if (allowed.has('quadrant')) {
          for (const angleDeg of [0, 90, 180, 270]) {
            candidates.push(
              buildCandidate('quadrant', entity.id, cadPointOnCircle(center, child.radius, angleDeg), worldPoint, `${label} quadrant`, undefined, scope),
            );
          }
        }
        if (allowed.has('nearest')) {
          const dx = worldPoint.x - center.x;
          const dy = worldPoint.y - center.y;
          const length = Math.hypot(dx, dy);
          const rim = length > CAD_XY_DEGENERATE_FLOOR
            ? { x: center.x + (dx / length) * child.radius, y: center.y + (dy / length) * child.radius }
            : cadPointOnCircle(center, child.radius, 0);
          candidates.push(
            buildCandidate('nearest', entity.id, rim, worldPoint, `${label} near`, undefined, scope),
          );
        }
        break;
      }
      case 'text':
        if (allowed.has('endpoint')) {
          candidates.push(
            buildCandidate('endpoint', entity.id, { x: child.x, y: child.y }, worldPoint, `${label} anchor`, undefined, scope),
          );
        }
        break;
    }
  });
  if (allowed.has('nearest')) {
    children.forEach((child, childIndex) => {
      if (child.type !== 'line' && child.type !== 'polyline' && child.type !== 'polygon') return;
      const scope = `${entity.id}#${childIndex}`;
      entitySegments({ ...child, id: entity.id }).forEach((segment) => {
        candidates.push(
          buildCandidate(
            'nearest',
            entity.id,
            cadClosestPointOnSegment(worldPoint, segment.start, segment.end),
            worldPoint,
            `${label} near`,
            undefined,
            scope,
          ),
        );
      });
    });
  }
  return candidates;
};

