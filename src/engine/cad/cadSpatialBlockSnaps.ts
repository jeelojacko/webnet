import {
  cadArcMidpoint,
  cadClosestPointOnSegment,
  cadMidpoint,
  type CadWorldPoint,
} from './cadGeometry';
import { getCadEntityDisplayLabel } from './cadEntityNames';
import { expandBlockReference, findBlockDefinition } from './cadBlocks';
import { arcRefFromEntity, entitySegments } from './cadSpatialEntityRefs';
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
        const ring = child.type === 'polyline'
          ? child.vertices
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
          const centroid = {
            x: ring.reduce((sum, vertex) => sum + vertex.x, 0) / ring.length,
            y: ring.reduce((sum, vertex) => sum + vertex.y, 0) / ring.length,
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

