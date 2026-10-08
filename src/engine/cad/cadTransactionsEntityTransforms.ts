import { cadBuildParcelClosureSummary } from './cadCogo';
import { validateBoundaryEntityVertexEdit } from './cadBoundaryCandidateValidation';
import {
  cadAngleDegFromCenter,
  cadArcMidpoint,
  cadNormalizeAngleDeg,
  cadPointOnCircle,
  cadProjectPointOntoCircle,
} from './cadGeometry';
import { replaceCadProjectEntities } from './cadProjectState';
import { CAD_XY_DEGENERATE_FLOOR } from './cadGeometryShapeBuilders';
import { sanitizeFeatureLine } from './cadFeatureLines';
import {
  cadPolylinePointsMatch,
  countDistinctPlinePositions,
  revalidateCadPolylineVertexMove,
} from './cadPolylineGeometry';
import { resolveCadPolylineCourses } from './cadPolylineCourses';
import type { CadCommand } from './cadTransactions.types';
import type {
  CadEntity,
  CadFeatureLineEntity,
  CadGripHandle,
  CadGripHandleKind,
  CadParcelEntity,
  CadProject,
} from './cadTypes';
import { syncEditedEntityDependencies } from './cadTransactionsLinkedEntities';
import { parcelGripEditBlockReason } from './cadParcelSharedEdit';

export const translateEntity = (entity: CadEntity, deltaX: number, deltaY: number): CadEntity => {
  switch (entity.type) {
    case 'survey-point':
      return {
        ...entity,
        x: entity.x + deltaX,
        y: entity.y + deltaY,
      };
    case 'line':
      return {
        ...entity,
        fromX: entity.fromX + deltaX,
        fromY: entity.fromY + deltaY,
        toX: entity.toX + deltaX,
        toY: entity.toY + deltaY,
      };
    case 'polyline':
    case 'polygon':
    case 'parcel':
      return {
        ...entity,
        vertices: entity.vertices.map((vertex) => ({
          x: vertex.x + deltaX,
          y: vertex.y + deltaY,
        })),
      };
    case 'feature-line':
      // Phase 20A: plan MOVE is XY-only — Z rides verbatim.
      return {
        ...entity,
        vertices: entity.vertices.map((vertex) => ({
          ...vertex,
          x: vertex.x + deltaX,
          y: vertex.y + deltaY,
        })),
      };
    case 'arc':
      return {
        ...entity,
        centerX: entity.centerX + deltaX,
        centerY: entity.centerY + deltaY,
      };
    case 'circle':
      return {
        ...entity,
        centerX: entity.centerX + deltaX,
        centerY: entity.centerY + deltaY,
      };
    case 'alignment':
      return {
        ...entity,
        elements: entity.elements.map((element) =>
          element.kind === 'line'
            ? {
                ...element,
                start: { x: element.start.x + deltaX, y: element.start.y + deltaY },
                end: { x: element.end.x + deltaX, y: element.end.y + deltaY },
              }
            : {
                ...element,
                center: { x: element.center.x + deltaX, y: element.center.y + deltaY },
              },
        ),
      };
    case 'text':
      return {
        ...entity,
        x: entity.x + deltaX,
        y: entity.y + deltaY,
      };
    case 'error-ellipse':
      return {
        ...entity,
        centerX: entity.centerX + deltaX,
        centerY: entity.centerY + deltaY,
      };
    case 'parabola':
      // MOVE translates the vertex; axis/focal/range are rigid-invariant.
      return {
        ...entity,
        vertexX: entity.vertexX + deltaX,
        vertexY: entity.vertexY + deltaY,
      };
    case 'mtext':
    case 'block-reference':
      return {
        ...entity,
        x: entity.x + deltaX,
        y: entity.y + deltaY,
      };
    case 'survey-table':
      // Phase 19A: table MOVE is insertion x/y only (columns stay orthogonal
      // to rotationDeg; refs/ids untouched).
      return {
        ...entity,
        x: entity.x + deltaX,
        y: entity.y + deltaY,
      };
    case 'leader':
      // Vertices move; the arrow anchor stays bound to the source entity.
      return {
        ...entity,
        vertices: entity.vertices.map((vertex) => ({
          x: vertex.x + deltaX,
          y: vertex.y + deltaY,
        })),
      };
    case 'dimension':
      // Dim-line/text points move; source anchors stay bound to the model.
      return {
        ...entity,
        dimLinePoint: { x: entity.dimLinePoint.x + deltaX, y: entity.dimLinePoint.y + deltaY },
        ...(entity.textPoint != null
          ? { textPoint: { x: entity.textPoint.x + deltaX, y: entity.textPoint.y + deltaY } }
          : {}),
      };
    case 'bearing-label':
    case 'curve-label':
      // Offset is relative to the source entity, so a move is a no-op.
      return entity;
  }
};

const cadCounterClockwiseDeltaDeg = (startAngleDeg: number, endAngleDeg: number): number =>
  cadNormalizeAngleDeg(endAngleDeg - startAngleDeg);

// Phase 19C grip contract: endpoint grips move VERTICES only; the stored
// endpoint-relative bulge is untouched, so sweep stays constant and
// radius/center re-derive from the moved endpoints (no radius-preserving
// silent behavior — the arc visibly re-curves through the dragged vertex).
// Metrics recompute through the exact curved closure, never chord fallback.
const rebuildParcelMetrics = (entity: CadParcelEntity): CadParcelEntity => {
  const metrics = cadBuildParcelClosureSummary(entity.vertices, {
    courseGeometry: entity.courseGeometry,
  });
  if (!metrics) {
    return {
      ...entity,
      areaSquareMeters: undefined,
      perimeterMeters: undefined,
      closureDeltaX: undefined,
      closureDeltaY: undefined,
      closureDistanceMeters: undefined,
    };
  }
  return {
    ...entity,
    areaSquareMeters: metrics.areaSquareMeters,
    perimeterMeters: metrics.perimeterMeters,
    closureDeltaX: metrics.closureDeltaX,
    closureDeltaY: metrics.closureDeltaY,
    closureDistanceMeters: metrics.closureDistanceMeters,
  };
};

const updateArcEndpointFromGrip = (
  entity: Extract<CadEntity, { type: 'arc' }>,
  gripKind: 'arc-start' | 'arc-end',
  point: { x: number; y: number },
): Extract<CadEntity, { type: 'arc' }> | null => {
  const projectedPoint = cadProjectPointOntoCircle(
    point,
    { x: entity.centerX, y: entity.centerY },
    entity.radius,
  );
  const movedAngleNorm = cadAngleDegFromCenter(
    { x: entity.centerX, y: entity.centerY },
    projectedPoint,
  );
  const currentSweep = entity.endAngleDeg - entity.startAngleDeg;
  if (gripKind === 'arc-start') {
    if (currentSweep >= 0) {
      const magnitude = cadCounterClockwiseDeltaDeg(movedAngleNorm, cadNormalizeAngleDeg(entity.endAngleDeg));
      if (magnitude <= 1e-6) {
        return {
          ...entity,
          startAngleDeg: entity.endAngleDeg - 360,
        };
      }
      return {
        ...entity,
        startAngleDeg: entity.endAngleDeg - magnitude,
      };
    }
    const magnitude = cadCounterClockwiseDeltaDeg(cadNormalizeAngleDeg(entity.endAngleDeg), movedAngleNorm);
    if (magnitude <= 1e-6) {
      return {
        ...entity,
        startAngleDeg: entity.endAngleDeg + 360,
      };
    }
    return {
      ...entity,
      startAngleDeg: entity.endAngleDeg + magnitude,
    };
  }
  if (currentSweep >= 0) {
    const magnitude = cadCounterClockwiseDeltaDeg(cadNormalizeAngleDeg(entity.startAngleDeg), movedAngleNorm);
    if (magnitude <= 1e-6) {
      return {
        ...entity,
        endAngleDeg: entity.startAngleDeg + 360,
      };
    }
    return {
      ...entity,
      endAngleDeg: entity.startAngleDeg + magnitude,
    };
  }
  const magnitude = cadCounterClockwiseDeltaDeg(movedAngleNorm, cadNormalizeAngleDeg(entity.startAngleDeg));
  if (magnitude <= 1e-6) {
    return {
      ...entity,
      endAngleDeg: entity.startAngleDeg - 360,
    };
  }
  return {
    ...entity,
    endAngleDeg: entity.startAngleDeg - magnitude,
  };
};

const updateEntityFromGrip = (
  entity: CadEntity,
  gripKind: CadGripHandleKind,
  point: { x: number; y: number },
  vertexIndex?: number,
): CadEntity | null => {
  switch (entity.type) {
    case 'line':
      if (gripKind === 'line-start') {
        return {
          ...entity,
          fromX: point.x,
          fromY: point.y,
        };
      }
      if (gripKind === 'line-end') {
        return {
          ...entity,
          toX: point.x,
          toY: point.y,
        };
      }
      return null;
    case 'polyline': {
      if (gripKind !== 'vertex' || vertexIndex == null || vertexIndex < 0 || vertexIndex >= entity.vertices.length) {
        return null;
      }
      const vertices = entity.vertices.map((vertex, index) =>
        index === vertexIndex ? { x: point.x, y: point.y } : vertex,
      );
      // Stored bulge/width values ride verbatim through a vertex move; only
      // the moved endpoints change, so metrics re-derive from them. Degenerate
      // results (coincident arc chord, collapsed adjacent edge, closed ring
      // below 3 distinct vertices) fail closed instead of silently shifting or
      // straightening metadata.
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
      for (let index = 1; index < vertices.length; index += 1) {
        if (cadPolylinePointsMatch(vertices[index - 1]!, vertices[index]!)) return null;
      }
      if (entity.closed) {
        if (
          vertices.length >= 2 &&
          cadPolylinePointsMatch(vertices[0]!, vertices[vertices.length - 1]!)
        ) {
          return null;
        }
        if (countDistinctPlinePositions(vertices) < 3) return null;
      }
      if (
        revalidateCadPolylineVertexMove(
          vertices,
          entity.closed,
          entity.segmentGeometry,
          entity.segmentWidths,
        ).length > 0
      ) {
        return null;
      }
      return { ...entity, vertices };
    }
    case 'polygon':
      if (gripKind !== 'vertex' || vertexIndex == null || vertexIndex < 0 || vertexIndex >= entity.vertices.length) {
        return null;
      }
      return {
        ...entity,
        vertices: entity.vertices.map((vertex, index) =>
          index === vertexIndex ? { x: point.x, y: point.y } : vertex,
        ),
      };
    case 'feature-line': {
      // Phase 20A: XY vertex grip only — Z rides verbatim and the stored
      // endpoint-relative bulge is untouched (arc re-curves through the
      // moved vertex, Phase 19C contract). Invalid geometry fails closed.
      if (gripKind !== 'vertex' || vertexIndex == null || vertexIndex < 0 || vertexIndex >= entity.vertices.length) {
        return null;
      }
      const moved: CadFeatureLineEntity = {
        ...entity,
        vertices: entity.vertices.map((vertex, index) =>
          index === vertexIndex ? { ...vertex, x: point.x, y: point.y } : vertex,
        ),
      };
      return sanitizeFeatureLine(moved).ok ? moved : null;
    }
    case 'parcel':
      if (gripKind !== 'vertex' || vertexIndex == null || vertexIndex < 0 || vertexIndex >= entity.vertices.length) {
        return null;
      }
      return rebuildParcelMetrics({
        ...entity,
        vertices: entity.vertices.map((vertex, index) =>
          index === vertexIndex ? { x: point.x, y: point.y } : vertex,
        ),
      });
    case 'arc':
      if (gripKind === 'arc-radius') {
        const radius = Math.hypot(point.x - entity.centerX, point.y - entity.centerY);
        if (!Number.isFinite(radius) || radius <= 1e-6) return null;
        return {
          ...entity,
          radius,
        };
      }
      if (gripKind === 'arc-start' || gripKind === 'arc-end') {
        return updateArcEndpointFromGrip(entity, gripKind, point);
      }
      return null;
    case 'circle':
      if (gripKind === 'circle-center') {
        if (!Number.isFinite(point.x + point.y)) return null;
        return { ...entity, centerX: point.x, centerY: point.y };
      }
      if (gripKind === 'circle-radius') {
        const radius = Math.hypot(point.x - entity.centerX, point.y - entity.centerY);
        if (!Number.isFinite(radius) || radius <= CAD_XY_DEGENERATE_FLOOR) return null;
        return { ...entity, radius };
      }
      return null;
    case 'block-reference':
      // Phase 18N UI slice: the insertion grip drags the whole reference.
      // Rotation/scale stay Properties-only (no grip affordance).
      if (gripKind !== 'insertion') return null;
      return { ...entity, x: point.x, y: point.y };
    default:
      return null;
  }
};

export const buildCadGripHandles = (entity: CadEntity): CadGripHandle[] => {
  switch (entity.type) {
    case 'line':
      return [
        {
          id: `${entity.id}:line-start`,
          entityId: entity.id,
          kind: 'line-start',
          x: entity.fromX,
          y: entity.fromY,
        },
        {
          id: `${entity.id}:line-end`,
          entityId: entity.id,
          kind: 'line-end',
          x: entity.toX,
          y: entity.toY,
        },
      ];
    case 'polyline': {
      // Phase C3 — every vertex grip stays a plain `vertex` move, plus one
      // secondary hollow insert grip per resolved course. The grip rides the
      // TRUE course midpoint: a line's finite midpoint, or the signed-sweep
      // arc midpoint (never the chord midpoint). Open N-1 / closed N, so a
      // closed ring never grows a duplicate closure grip.
      const vertexGrips: CadGripHandle[] = entity.vertices.map((vertex, index) => ({
        id: `${entity.id}:vertex:${index}`,
        entityId: entity.id,
        kind: 'vertex',
        x: vertex.x,
        y: vertex.y,
        vertexIndex: index,
      }));
      const courses = resolveCadPolylineCourses(entity);
      if (!courses) return vertexGrips;
      const insertGrips: CadGripHandle[] = courses.map((course) => {
        const midpoint =
          course.kind === 'arc' && course.metrics != null
            ? cadArcMidpoint(
                course.metrics.center,
                course.metrics.radius,
                course.metrics.startAngleDeg,
                course.metrics.endAngleDeg,
              )
            : { x: (course.from.x + course.to.x) / 2, y: (course.from.y + course.to.y) / 2 };
        return {
          id: `${entity.id}:insert:${course.index}`,
          entityId: entity.id,
          kind: 'polyline-insert',
          x: midpoint.x,
          y: midpoint.y,
          courseIndex: course.index,
        };
      });
      return [...vertexGrips, ...insertGrips];
    }
    case 'polygon':
    case 'parcel':
    case 'feature-line':
      return entity.vertices.map((vertex, index) => ({
        id: `${entity.id}:vertex:${index}`,
        entityId: entity.id,
        kind: 'vertex',
        x: vertex.x,
        y: vertex.y,
        vertexIndex: index,
      }));
    case 'arc': {
      const startPoint = cadPointOnCircle(
        { x: entity.centerX, y: entity.centerY },
        entity.radius,
        entity.startAngleDeg,
      );
      const endPoint = cadPointOnCircle(
        { x: entity.centerX, y: entity.centerY },
        entity.radius,
        entity.endAngleDeg,
      );
      const radiusPoint = cadArcMidpoint(
        { x: entity.centerX, y: entity.centerY },
        entity.radius,
        entity.startAngleDeg,
        entity.endAngleDeg,
      );
      return [
        {
          id: `${entity.id}:arc-start`,
          entityId: entity.id,
          kind: 'arc-start',
          x: startPoint.x,
          y: startPoint.y,
        },
        {
          id: `${entity.id}:arc-end`,
          entityId: entity.id,
          kind: 'arc-end',
          x: endPoint.x,
          y: endPoint.y,
        },
        {
          id: `${entity.id}:arc-radius`,
          entityId: entity.id,
          kind: 'arc-radius',
          x: radiusPoint.x,
          y: radiusPoint.y,
        },
      ];
    }
    case 'circle':
      return [
        {
          id: `${entity.id}:circle-center`,
          entityId: entity.id,
          kind: 'circle-center',
          x: entity.centerX,
          y: entity.centerY,
        },
        {
          id: `${entity.id}:circle-radius`,
          entityId: entity.id,
          kind: 'circle-radius',
          x: entity.centerX + entity.radius,
          y: entity.centerY,
        },
      ];
    case 'block-reference':
      return [
        {
          id: `${entity.id}:insertion`,
          entityId: entity.id,
          kind: 'insertion',
          x: entity.x,
          y: entity.y,
        },
      ];
    default:
      return [];
  }
};

export const applyCadGripEdit = (
  project: CadProject,
  command: Extract<CadCommand, { key: 'GRIP_EDIT' }>,
): CadProject | null => {
  const entity = project.entities.find((candidate) => candidate.id === command.entityId && !candidate.locked);
  if (!entity) return null;
  // Phase 19D: a vertex grip on either side of a Shared Boundary must go
  // through PARCELSHAREDEDIT; block with zero mutation/history.
  if (entity.type === 'parcel' && parcelGripEditBlockReason(project, entity, command.vertexIndex)) {
    return null;
  }
  const updatedEntity = updateEntityFromGrip(
    entity,
    command.gripKind,
    { x: command.x, y: command.y },
    command.vertexIndex,
  );
  if (!updatedEntity) return null;
  // Phase 18W: vertex grips on a boundary source must keep a valid ring.
  if (
    command.gripKind === 'vertex' &&
    (updatedEntity.type === 'polyline' || updatedEntity.type === 'polygon') &&
    validateBoundaryEntityVertexEdit(project, entity.id, updatedEntity.vertices)
  ) {
    return null;
  }
  const nextProject = replaceCadProjectEntities(
    project,
    project.entities.map((candidate) => (candidate.id === entity.id ? updatedEntity : candidate)),
  );
  return syncEditedEntityDependencies(nextProject, entity, updatedEntity);
};
