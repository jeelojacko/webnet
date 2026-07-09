import { isTrimmableEntity } from './cadTransactionsTrimCommon';
import {
  buildCadGeneralFillet,
  type CadFilletEntity,
} from './cadTransactionsFillet';
import type { CadEntity, CadEntityId, CadProject } from './cadTypes';
export interface CadFilletPreview {
  firstEntityId: CadEntityId;
  secondEntityId: CadEntityId;
  previewEntities: CadEntity[];
}

export const buildCadFilletPreview = (
  project: CadProject,
  radius: number,
  firstEntityId: CadEntityId,
  firstPickPoint: { x: number; y: number },
  firstSegmentId: string | undefined,
  secondEntityId: CadEntityId,
  secondPickPoint: { x: number; y: number },
  secondSegmentId?: string,
): CadFilletPreview | null => {
  if (firstEntityId === secondEntityId && firstSegmentId === secondSegmentId) return null;
  const firstEntity = project.entities.find(
    (entity): entity is CadFilletEntity =>
      entity.id === firstEntityId && isTrimmableEntity(entity) && !entity.locked,
  );
  const secondEntity = project.entities.find(
    (entity): entity is CadFilletEntity =>
      entity.id === secondEntityId && isTrimmableEntity(entity) && !entity.locked,
  );
  if (!firstEntity || !secondEntity) return null;
  const fillet = buildCadGeneralFillet(
    firstEntity,
    firstPickPoint,
    secondEntity,
    secondPickPoint,
    radius,
    firstSegmentId,
    secondSegmentId,
  );
  if (!fillet) return null;
  return {
    firstEntityId,
    secondEntityId,
    previewEntities: [
      {
        ...fillet.firstEntity,
        id: `${firstEntityId}:fillet-preview`,
      },
      {
        ...fillet.secondEntity,
        id: `${secondEntityId}:fillet-preview`,
      },
      ...(fillet.arcDefinition
        ? [{
            id: 'fillet-preview:arc',
            type: 'arc' as const,
            layerId: 'preview',
            styleId: 'style-observation-line',
            visible: true,
            locked: false,
            centerX: fillet.arcDefinition.center.x,
            centerY: fillet.arcDefinition.center.y,
            radius: fillet.arcDefinition.radius,
            startAngleDeg: fillet.arcDefinition.startAngleDeg,
            endAngleDeg: fillet.arcDefinition.endAngleDeg,
            metadata: {
              createdBy: 'FILLET_PREVIEW',
            },
          }]
        : []),
    ],
  };
};

