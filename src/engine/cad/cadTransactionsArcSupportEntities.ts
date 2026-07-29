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
  buildCurveLabels,
  compactManualPointEntities,
  createManualPointEntities,
} from './cadTransactionsEntityFactories';
import { cloneEntityMetadata } from './cadTransactionsMetadata';
import { movePointReferences } from './cadTransactionsPointReferences';

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
