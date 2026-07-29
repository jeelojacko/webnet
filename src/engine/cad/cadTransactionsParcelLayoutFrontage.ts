import {
  cadBuildParcelLayoutFrontageReference,
  cadBuildParcelLayoutFrontageReferenceFromParcelSegments,
} from './cadCogo';
import type { CadWorkspaceSnapshot } from './cadTransactions.types';
import type {
  CadArcEntity,
  CadEntityId,
  CadLineEntity,
  CadParcelEntity,
  CadPolylineEntity,
} from './cadTypes';

export const resolveParcelLayoutFrontageSource = (
  snapshot: CadWorkspaceSnapshot,
  parcelEntity: CadParcelEntity,
  frontageEntityId?: CadEntityId | null,
  frontageParcelSegmentIds?: readonly string[] | null,
) => {
  const frontageEntity =
    frontageEntityId == null
      ? null
      : snapshot.project.entities.find(
          (entity): entity is CadLineEntity | CadPolylineEntity | CadArcEntity =>
            entity.id === frontageEntityId &&
            (entity.type === 'line' || entity.type === 'polyline' || entity.type === 'arc'),
        ) ?? null;
  if (frontageEntity) {
    const frontageReference = cadBuildParcelLayoutFrontageReference(frontageEntity);
    return frontageReference
      ? {
          frontageEntity,
          frontageReference,
          sourceEntityIds: [parcelEntity.id, frontageEntity.id],
        }
      : null;
  }
  if (frontageParcelSegmentIds?.length) {
    const frontageReference = cadBuildParcelLayoutFrontageReferenceFromParcelSegments(
      parcelEntity,
      frontageParcelSegmentIds,
    );
    return frontageReference
      ? {
          frontageEntity: null,
          frontageReference,
          sourceEntityIds: [parcelEntity.id],
        }
      : null;
  }
  return null;
};
