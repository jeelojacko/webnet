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

/**
 * Phase 19C Round 2 frontage policy for slide/swing:
 *  - curved PARENT boundaries are supported (analytic split kernels);
 *  - a curved frontage SOURCE (arc entity → chord) is NOT admitted, because
 *    the slide/swing kernels station along the frontage chord. It fails
 *    closed with CURVED_FRONTAGE_UNSUPPORTED — never chord-as-frontage.
 * Auto-layout keeps the path-based resolver (it stations along the true
 * boundary path via cadBuildParcelLayoutFrontagePath).
 */
export type CadParcelSplitFrontageResolution =
  | {
      ok: true;
      frontageEntity: CadLineEntity | CadPolylineEntity | null;
      frontageReference: NonNullable<ReturnType<typeof resolveParcelLayoutFrontageSource>>['frontageReference'];
      sourceEntityIds: CadEntityId[];
    }
  | { ok: false; code: 'CURVED_FRONTAGE_UNSUPPORTED'; message: string }
  | { ok: false; code: 'FRONTAGE_NOT_FOUND'; message: string };

export const resolveParcelSplitFrontageSource = (
  snapshot: CadWorkspaceSnapshot,
  parcelEntity: CadParcelEntity,
  frontageEntityId?: CadEntityId | null,
  frontageParcelSegmentIds?: readonly string[] | null,
): CadParcelSplitFrontageResolution => {
  const resolved = resolveParcelLayoutFrontageSource(
    snapshot,
    parcelEntity,
    frontageEntityId,
    frontageParcelSegmentIds,
  );
  if (!resolved) {
    return { ok: false, code: 'FRONTAGE_NOT_FOUND', message: 'No frontage source resolved.' };
  }
  if (resolved.frontageEntity?.type === 'arc') {
    return {
      ok: false,
      code: 'CURVED_FRONTAGE_UNSUPPORTED',
      message:
        'Curved frontage source is not supported for slide/swing (chord substitution blocked).',
    };
  }
  return {
    ok: true,
    frontageEntity: resolved.frontageEntity,
    frontageReference: resolved.frontageReference,
    sourceEntityIds: resolved.sourceEntityIds,
  };
};
