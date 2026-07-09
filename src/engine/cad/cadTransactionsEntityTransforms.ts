import { cadBuildParcelClosureSummary } from './cadCogo';
import {
  cadAngleDegFromCenter,
  cadArcMidpoint,
  cadNormalizeAngleDeg,
  cadPointOnCircle,
  cadProjectPointOntoCircle,
} from './cadGeometry';
import { replaceCadProjectEntities } from './cadProjectState';
import type { CadCommand } from './cadTransactions.types';
import type {
  CadEntity,
  CadGripHandle,
  CadGripHandleKind,
  CadParcelEntity,
  CadProject,
} from './cadTypes';
import { syncEditedEntityDependencies } from './cadTransactionsLinkedEntities';

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
    case 'arc':
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
  }
};

const cadCounterClockwiseDeltaDeg = (startAngleDeg: number, endAngleDeg: number): number =>
  cadNormalizeAngleDeg(endAngleDeg - startAngleDeg);

const rebuildParcelMetrics = (entity: CadParcelEntity): CadParcelEntity => {
  const metrics = cadBuildParcelClosureSummary(entity.vertices);
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
    case 'polyline':
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
    case 'polyline':
    case 'polygon':
    case 'parcel':
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
  const updatedEntity = updateEntityFromGrip(
    entity,
    command.gripKind,
    { x: command.x, y: command.y },
    command.vertexIndex,
  );
  if (!updatedEntity) return null;
  const nextProject = replaceCadProjectEntities(
    project,
    project.entities.map((candidate) => (candidate.id === entity.id ? updatedEntity : candidate)),
  );
  return syncEditedEntityDependencies(nextProject, entity, updatedEntity);
};
