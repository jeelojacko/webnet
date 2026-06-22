import type { CadEntity, CadEntityId, CadProject } from './cadTypes';

const readMetadataEntityName = (entity: CadEntity): string | null => {
  const raw =
    entity.metadata && typeof entity.metadata === 'object' && typeof entity.metadata.entityName === 'string'
      ? entity.metadata.entityName
      : null;
  const trimmed = raw?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
};

const readNonOpaqueEntityId = (entity: CadEntity): string | null => {
  const trimmed = entity.id.trim();
  if (trimmed.length === 0) return null;
  return /^cad-[a-z]+/i.test(trimmed) ? null : trimmed;
};

const findEntityById = (project: CadProject, entityId: CadEntityId): CadEntity | null =>
  project.entities.find((entity) => entity.id === entityId) ?? null;

const findArcControlPointLabel = (
  project: CadProject,
  arcEntityId: CadEntityId,
  role: 'begin' | 'mid' | 'end' | 'radius',
): string | null => {
  const point = project.entities.find(
    (entity) =>
      entity.type === 'survey-point' &&
      entity.metadata &&
      typeof entity.metadata === 'object' &&
      entity.metadata.anchorCurveEntityId === arcEntityId &&
      entity.metadata.curvePointRole === role,
  );
  return point?.type === 'survey-point' ? point.stationId : null;
};

export type CadEntitySubpartLabelKind =
  | 'line-start'
  | 'line-end'
  | 'vertex'
  | 'arc-start'
  | 'arc-end'
  | 'arc-radius'
  | 'center'
  | 'arc-midpoint'
  | 'quadrant';

interface CadEntitySubpartLabelOptions {
  vertexIndex?: number;
  quadrantAngleDeg?: number;
}

const readVertexLabel = (labels: readonly string[], index: number): string | null => {
  const trimmed = labels[index]?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
};

export const getCadEntityEditableName = (entity: CadEntity): string => {
  switch (entity.type) {
    case 'survey-point':
      return entity.stationId;
    case 'alignment':
      return entity.name;
    case 'parcel':
      return entity.parcelName;
    default:
      return readMetadataEntityName(entity) ?? '';
  }
};

export const getCadEntityDisplayLabel = (entity: CadEntity): string => {
  const metadataName = readMetadataEntityName(entity);
  if (metadataName) return metadataName;
  switch (entity.type) {
    case 'survey-point':
      return entity.stationId;
    case 'line':
      return `${entity.fromStationId}-${entity.toStationId}`;
    case 'polyline': {
      const startLabel = entity.vertexLabels[0];
      const endLabel = entity.vertexLabels.at(-1);
      if (startLabel && endLabel) return `${startLabel}-${endLabel}`;
      return readNonOpaqueEntityId(entity) ?? 'Polyline';
    }
    case 'polygon': {
      const startLabel = entity.vertexLabels[0];
      const endLabel = entity.vertexLabels.at(-1);
      if (startLabel && endLabel) return `${startLabel}-${endLabel}`;
      return readNonOpaqueEntityId(entity) ?? 'Polygon';
    }
    case 'parcel':
      return entity.parcelName;
    case 'arc':
      return readNonOpaqueEntityId(entity) ?? 'Arc';
    case 'alignment':
      return entity.name;
    case 'error-ellipse':
      return entity.stationId;
    case 'text':
      return entity.text;
  }
};

export const getCadEntitySubpartDisplayLabel = (
  project: CadProject,
  entityId: CadEntityId,
  kind: CadEntitySubpartLabelKind,
  options?: CadEntitySubpartLabelOptions,
): string => {
  const entity = findEntityById(project, entityId);
  if (!entity) return entityId;
  const entityLabel = getCadEntityDisplayLabel(entity);

  switch (kind) {
    case 'line-start':
      return entity.type === 'line' ? entity.fromStationId || `${entityLabel} start` : `${entityLabel} start`;
    case 'line-end':
      return entity.type === 'line' ? entity.toStationId || `${entityLabel} end` : `${entityLabel} end`;
    case 'vertex':
      if (entity.type === 'polyline' || entity.type === 'polygon' || entity.type === 'parcel') {
        const vertexIndex = options?.vertexIndex ?? 0;
        return readVertexLabel(entity.vertexLabels, vertexIndex) ?? `${entityLabel} V${vertexIndex + 1}`;
      }
      return `${entityLabel} vertex`;
    case 'arc-start':
      return findArcControlPointLabel(project, entity.id, 'begin') ?? `${entityLabel} start`;
    case 'arc-end':
      return findArcControlPointLabel(project, entity.id, 'end') ?? `${entityLabel} end`;
    case 'arc-radius':
      return findArcControlPointLabel(project, entity.id, 'radius') ?? `${entityLabel} radius`;
    case 'center':
      return `${entityLabel} center`;
    case 'arc-midpoint':
      return findArcControlPointLabel(project, entity.id, 'mid') ?? `${entityLabel} mid`;
    case 'quadrant':
      return `${entityLabel} q${options?.quadrantAngleDeg ?? 0}`;
  }
};
