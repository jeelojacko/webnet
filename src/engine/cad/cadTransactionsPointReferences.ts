import { replaceCadProjectEntities } from './cadProjectState';
import type {
  CadEntity,
  CadEntityId,
  CadProject,
  CadSurveyPointEntity,
} from './cadTypes';
import {
  buildAlignmentStakeoutLabelText,
  buildAnchoredPointLabelEntityName,
} from './cadTransactionsEntityFactories';
import { cloneEntityMetadata } from './cadTransactionsMetadata';

export const renamePointReferences = (
  entity: CadEntity,
  pointEntityId: CadEntityId,
  previousStationId: string,
  nextStationId: string,
): CadEntity => {
  if (entity.type === 'survey-point' && entity.id === pointEntityId) {
    return {
      ...entity,
      stationId: nextStationId,
    };
  }
  if (entity.type === 'text') {
    const metadata = cloneEntityMetadata(entity);
    if (entity.anchorEntityId === pointEntityId) {
      if (typeof metadata.stationId === 'string') {
        metadata.stationId = nextStationId;
      }
      if (typeof metadata.entityName === 'string') {
        metadata.entityName = buildAnchoredPointLabelEntityName(nextStationId);
      }
      const alignmentStation =
        typeof metadata.alignmentStation === 'string' ? metadata.alignmentStation : null;
      const alignmentOffset =
        typeof metadata.alignmentOffset === 'number' && Number.isFinite(metadata.alignmentOffset)
          ? metadata.alignmentOffset
          : null;
      return {
        ...entity,
        text:
          alignmentStation != null
            ? buildAlignmentStakeoutLabelText(nextStationId, alignmentStation, alignmentOffset)
            : entity.text === previousStationId
              ? nextStationId
              : entity.text,
        metadata,
      };
    }
    if (typeof metadata.stationId === 'string' && metadata.stationId === previousStationId) {
      metadata.stationId = nextStationId;
      return {
        ...entity,
        metadata,
      };
    }
    return entity;
  }
  if (entity.type === 'line') {
    return {
      ...entity,
      fromStationId: entity.fromStationId === previousStationId ? nextStationId : entity.fromStationId,
      toStationId: entity.toStationId === previousStationId ? nextStationId : entity.toStationId,
    };
  }
  if (entity.type === 'polyline' || entity.type === 'polygon' || entity.type === 'parcel') {
    return {
      ...entity,
      vertexLabels: entity.vertexLabels.map((label) => (label === previousStationId ? nextStationId : label)),
    };
  }
  if (entity.type === 'error-ellipse' && entity.stationId === previousStationId) {
    return {
      ...entity,
      stationId: nextStationId,
    };
  }
  return entity;
};

export const movePointReferences = (
  entity: CadEntity,
  pointEntityId: CadEntityId,
  stationId: string,
  nextX: number,
  nextY: number,
  nextZ: number | undefined,
): CadEntity => {
  if (entity.type === 'survey-point' && entity.id === pointEntityId) {
    return {
      ...entity,
      x: nextX,
      y: nextY,
      z: nextZ,
    };
  }
  if (entity.type === 'text' && entity.anchorEntityId === pointEntityId) {
    return {
      ...entity,
      x: nextX,
      y: nextY,
    };
  }
  if (entity.type === 'line') {
    return {
      ...entity,
      fromX: entity.fromStationId === stationId ? nextX : entity.fromX,
      fromY: entity.fromStationId === stationId ? nextY : entity.fromY,
      toX: entity.toStationId === stationId ? nextX : entity.toX,
      toY: entity.toStationId === stationId ? nextY : entity.toY,
    };
  }
  if (entity.type === 'polyline' || entity.type === 'polygon' || entity.type === 'parcel') {
    return {
      ...entity,
      vertices: entity.vertices.map((vertex, index) =>
        entity.vertexLabels[index] === stationId ? { x: nextX, y: nextY } : vertex,
      ),
    };
  }
  if (entity.type === 'error-ellipse' && entity.stationId === stationId) {
    return {
      ...entity,
      centerX: nextX,
      centerY: nextY,
    };
  }
  return entity;
};

export const syncLinkedSurveyPointPosition = (
  project: CadProject,
  stationId: string | undefined,
  previousPoint: { x: number; y: number },
  nextPoint: { x: number; y: number },
): CadProject => {
  if (!stationId) return project;
  if (
    Math.abs(previousPoint.x - nextPoint.x) <= 1e-9 &&
    Math.abs(previousPoint.y - nextPoint.y) <= 1e-9
  ) {
    return project;
  }
  const linkedPoint = project.entities.find(
    (entity): entity is CadSurveyPointEntity =>
      entity.type === 'survey-point' &&
      entity.stationId === stationId &&
      Math.abs(entity.x - previousPoint.x) <= 1e-9 &&
      Math.abs(entity.y - previousPoint.y) <= 1e-9,
  );
  if (!linkedPoint) return project;
  return replaceCadProjectEntities(
    project,
    project.entities.map((entity) =>
      movePointReferences(
        entity,
        linkedPoint.id,
        linkedPoint.stationId,
        nextPoint.x,
        nextPoint.y,
        linkedPoint.z,
      ),
    ),
  );
};

export const resolveLinkedSurveyPoint = (
  project: CadProject,
  stationId: string | undefined,
  expectedPoint?: { x: number; y: number },
): CadSurveyPointEntity | null => {
  if (!stationId) return null;
  return (
    project.entities.find(
      (entity): entity is CadSurveyPointEntity =>
        entity.type === 'survey-point' &&
        entity.stationId === stationId &&
        (expectedPoint == null ||
          (Math.abs(entity.x - expectedPoint.x) <= 1e-9 &&
            Math.abs(entity.y - expectedPoint.y) <= 1e-9)),
    ) ?? null
  );
};
