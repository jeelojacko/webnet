import {
  cadArcMidpoint,
  cadPointOnCircle,
} from './cadGeometry';
import {
  appendCadProjectEntities,
  replaceCadProjectEntities,
} from './cadProjectState';
import type {
  CadEntity,
  CadEntityId,
  CadProject,
  CadSurveyPointEntity,
  CadTextEntity,
} from './cadTypes';
import {
  buildAlignmentStakeoutLabelText,
  buildAnchoredPointLabelEntityName,
  buildCurveLabels,
  compactManualPointEntities,
  createManualPointEntities,
  nextCurveSequence,
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

export const createArcSupportEntities = (
  project: CadProject,
  arcEntityId: CadEntityId,
  sequence: number,
  definition: {
    center: { x: number; y: number };
    radius: number;
    startAngleDeg: number;
    endAngleDeg: number;
  },
  createdBy: string,
): Array<CadSurveyPointEntity | CadTextEntity> => {
  const curveLabels = buildCurveLabels(sequence);
  const supportPoints = [
    {
      label: curveLabels.beginLabel,
      point: cadPointOnCircle(definition.center, definition.radius, definition.startAngleDeg),
    },
    {
      label: curveLabels.midLabel,
      point: cadArcMidpoint(
        definition.center,
        definition.radius,
        definition.startAngleDeg,
        definition.endAngleDeg,
      ),
    },
    {
      label: curveLabels.endLabel,
      point: cadPointOnCircle(definition.center, definition.radius, definition.endAngleDeg),
    },
    {
      label: curveLabels.radiusLabel,
      point: definition.center,
    },
  ];
  let workingProject = project;
  const entities: Array<CadSurveyPointEntity | CadTextEntity> = [];
  supportPoints.forEach((supportPoint) => {
    const bundle = createManualPointEntities(
      workingProject,
      supportPoint.point.x,
      supportPoint.point.y,
      supportPoint.label,
      { createdBy },
    );
    const pointEntity: CadSurveyPointEntity = {
      ...bundle.point,
      metadata: {
        ...cloneEntityMetadata(bundle.point),
        anchorCurveEntityId: arcEntityId,
        curvePointRole:
          supportPoint.label.startsWith('BC')
            ? 'begin'
            : supportPoint.label.startsWith('MP')
              ? 'mid'
              : supportPoint.label.startsWith('EC')
                ? 'end'
                : 'radius',
      },
    };
    const labelEntity: CadTextEntity | null = bundle.label
      ? {
          ...bundle.label,
          metadata: {
            ...cloneEntityMetadata(bundle.label),
            anchorCurveEntityId: arcEntityId,
          },
        }
      : null;
    workingProject = appendCadProjectEntities(workingProject, compactManualPointEntities([pointEntity, labelEntity]));
    entities.push(pointEntity);
    if (labelEntity) entities.push(labelEntity);
  });
  return entities;
};

export const syncArcSupportEntities = (
  project: CadProject,
  arcEntity: Extract<CadEntity, { type: 'arc' }>,
): CadProject => {
  const supportTargets = new Map<
    'begin' | 'mid' | 'end' | 'radius',
    { x: number; y: number }
  >([
    [
      'begin',
      cadPointOnCircle(
        { x: arcEntity.centerX, y: arcEntity.centerY },
        arcEntity.radius,
        arcEntity.startAngleDeg,
      ),
    ],
    [
      'mid',
      cadArcMidpoint(
        { x: arcEntity.centerX, y: arcEntity.centerY },
        arcEntity.radius,
        arcEntity.startAngleDeg,
        arcEntity.endAngleDeg,
      ),
    ],
    [
      'end',
      cadPointOnCircle(
        { x: arcEntity.centerX, y: arcEntity.centerY },
        arcEntity.radius,
        arcEntity.endAngleDeg,
      ),
    ],
    ['radius', { x: arcEntity.centerX, y: arcEntity.centerY }],
  ]);
  const anchoredSupportPoints = project.entities.filter(
    (entity): entity is CadSurveyPointEntity =>
      entity.type === 'survey-point' &&
      entity.metadata != null &&
      typeof entity.metadata === 'object' &&
      entity.metadata.anchorCurveEntityId === arcEntity.id &&
      (entity.metadata.curvePointRole === 'begin' ||
        entity.metadata.curvePointRole === 'mid' ||
        entity.metadata.curvePointRole === 'end' ||
        entity.metadata.curvePointRole === 'radius'),
  );
  return anchoredSupportPoints.reduce((currentProject, pointEntity) => {
    const role = pointEntity.metadata?.curvePointRole;
    if (
      role !== 'begin' &&
      role !== 'mid' &&
      role !== 'end' &&
      role !== 'radius'
    ) {
      return currentProject;
    }
    const target = supportTargets.get(role);
    if (!target) return currentProject;
    return replaceCadProjectEntities(
      currentProject,
      currentProject.entities.map((entity) =>
        movePointReferences(
          entity,
          pointEntity.id,
          pointEntity.stationId,
          target.x,
          target.y,
          pointEntity.z,
        ),
      ),
    );
  }, project);
};

export const syncEditedEntityDependencies = (
  project: CadProject,
  previousEntity: CadEntity,
  updatedEntity: CadEntity,
  options?: { syncLinePoints?: boolean },
): CadProject => {
  if (
    (options?.syncLinePoints ?? true) &&
    previousEntity.type === 'line' &&
    updatedEntity.type === 'line'
  ) {
    let nextProject = syncLinkedSurveyPointPosition(
      project,
      previousEntity.fromStationId,
      { x: previousEntity.fromX, y: previousEntity.fromY },
      { x: updatedEntity.fromX, y: updatedEntity.fromY },
    );
    nextProject = syncLinkedSurveyPointPosition(
      nextProject,
      previousEntity.toStationId,
      { x: previousEntity.toX, y: previousEntity.toY },
      { x: updatedEntity.toX, y: updatedEntity.toY },
    );
    return nextProject;
  }
  if (
    (previousEntity.type === 'polyline' && updatedEntity.type === 'polyline') ||
    (previousEntity.type === 'polygon' && updatedEntity.type === 'polygon') ||
    (previousEntity.type === 'parcel' && updatedEntity.type === 'parcel')
  ) {
    return previousEntity.vertices.reduce((currentProject, previousVertex, index) => {
      const nextVertex = updatedEntity.vertices[index];
      if (!nextVertex) return currentProject;
      return syncLinkedSurveyPointPosition(
        currentProject,
        previousEntity.vertexLabels[index],
        previousVertex,
        nextVertex,
      );
    }, project);
  }
  if (previousEntity.type === 'arc' && updatedEntity.type === 'arc') {
    return syncArcSupportEntities(project, updatedEntity);
  }
  return project;
};

export const buildCopiedDependentPointEntities = (
  project: CadProject,
  selectedEntities: readonly CadEntity[],
  deltaX: number,
  deltaY: number,
): {
  workingProject: CadProject;
  copiedEntities: CadEntity[];
  copiedPointByStationId: Map<string, { stationId: string; x: number; y: number }>;
  copiedArcSupportBySourceId: Map<
    CadEntityId,
    { sequence: number; arcSupportEntities: Array<CadSurveyPointEntity | CadTextEntity> }
  >;
} => {
  const copiedEntities: CadEntity[] = [];
  const copiedPointByStationId = new Map<string, { stationId: string; x: number; y: number }>();
  const copiedArcSupportBySourceId = new Map<
    CadEntityId,
    { sequence: number; arcSupportEntities: Array<CadSurveyPointEntity | CadTextEntity> }
  >();
  let workingProject = project;
  const copiedSourcePointIds = new Set<CadEntityId>();

  const copyPointEntity = (
    sourcePoint: CadSurveyPointEntity,
    requestedLabel?: string,
  ): { point: CadSurveyPointEntity; label: CadTextEntity | null } => {
    const pointBundle = createManualPointEntities(
      workingProject,
      sourcePoint.x + deltaX,
      sourcePoint.y + deltaY,
      requestedLabel,
      {
        includeTextLabel: sourcePoint.metadata?.hiddenLabel === true ? false : undefined,
        createdBy: 'COPY',
      },
    );
    const appendedEntities = compactManualPointEntities([pointBundle.point, pointBundle.label]);
    workingProject = appendCadProjectEntities(workingProject, appendedEntities);
    copiedEntities.push(...appendedEntities);
    copiedPointByStationId.set(sourcePoint.stationId, {
      stationId: pointBundle.point.stationId,
      x: pointBundle.point.x,
      y: pointBundle.point.y,
    });
    copiedSourcePointIds.add(sourcePoint.id);
    return pointBundle;
  };

  selectedEntities.forEach((entity) => {
    if (entity.type === 'survey-point') {
      copyPointEntity(entity);
      return;
    }

    if (
      entity.type === 'polyline' ||
      entity.type === 'polygon' ||
      entity.type === 'parcel'
    ) {
      entity.vertexLabels.forEach((label, index) => {
        if (!label || copiedPointByStationId.has(label)) return;
        const linkedPoint = resolveLinkedSurveyPoint(project, label, entity.vertices[index]);
        if (!linkedPoint || copiedSourcePointIds.has(linkedPoint.id)) return;
        copyPointEntity(linkedPoint);
      });
      return;
    }

    if (entity.type !== 'arc') return;
    const sequence = nextCurveSequence(workingProject);
    const curveLabels = buildCurveLabels(sequence);
    const supportPointByRole = new Map<'begin' | 'mid' | 'end' | 'radius', CadSurveyPointEntity>();
    project.entities.forEach((candidate) => {
      if (
        candidate.type !== 'survey-point' ||
        candidate.metadata == null ||
        typeof candidate.metadata !== 'object' ||
        candidate.metadata.anchorCurveEntityId !== entity.id ||
        (candidate.metadata.curvePointRole !== 'begin' &&
          candidate.metadata.curvePointRole !== 'mid' &&
          candidate.metadata.curvePointRole !== 'end' &&
          candidate.metadata.curvePointRole !== 'radius')
      ) {
        return;
      }
      supportPointByRole.set(candidate.metadata.curvePointRole, candidate);
    });
    const requestedLabels: Record<'begin' | 'mid' | 'end' | 'radius', string> = {
      begin: curveLabels.beginLabel,
      mid: curveLabels.midLabel,
      end: curveLabels.endLabel,
      radius: curveLabels.radiusLabel,
    };
    const arcSupportEntities: Array<CadSurveyPointEntity | CadTextEntity> = [];
    (['begin', 'mid', 'end', 'radius'] as const).forEach((role) => {
      const sourcePoint = supportPointByRole.get(role);
      if (!sourcePoint || copiedSourcePointIds.has(sourcePoint.id)) return;
      const pointBundle = copyPointEntity(sourcePoint, requestedLabels[role]);
      const copiedPoint: CadSurveyPointEntity = {
        ...pointBundle.point,
        metadata: {
          ...cloneEntityMetadata(pointBundle.point),
          curvePointRole: role,
        },
      };
      const copiedLabel: CadTextEntity | null = pointBundle.label
        ? {
            ...pointBundle.label,
            metadata: cloneEntityMetadata(pointBundle.label),
          }
        : null;
      workingProject = replaceCadProjectEntities(
        workingProject,
        workingProject.entities.map((candidate) => {
          if (candidate.id === pointBundle.point.id) return copiedPoint;
          if (copiedLabel && candidate.id === copiedLabel.id) return copiedLabel;
          return candidate;
        }),
      );
      arcSupportEntities.push(copiedPoint);
      if (copiedLabel) arcSupportEntities.push(copiedLabel);
    });
    copiedArcSupportBySourceId.set(entity.id, { sequence, arcSupportEntities });
  });

  return {
    workingProject,
    copiedEntities,
    copiedPointByStationId,
    copiedArcSupportBySourceId,
  };
};
