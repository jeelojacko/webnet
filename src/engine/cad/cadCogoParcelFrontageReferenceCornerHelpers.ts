import { cadDistance, type CadWorldPoint } from './cadGeometry';
import type { CadLineEntity, CadParcelLayoutSettings, CadParcelEntity } from './cadTypes';
import { parcelPointsMatch } from './cadCogoParcelGeometry';
import type { CadParcelLayoutFrontageReference } from './cadCogoParcelFrontage';
import type { CadParcelAutoLayoutDraft } from './cadCogoParcelLayoutTypes';
import {
  cadBuildFrontageLineFromCurrentParcelSegmentGeometry,
  cadBuildParcelEntityFromGeneratedDraft,
} from './cadCogoParcelLayoutDrafts';
import { cadResolveGeneratedParcelConflicts } from './cadCogoParcelLayoutConflicts';
import {
  cadBuildSharedFrontagePoint,
  cadBuildTaggedGeneratedLotDraft,
  cadBuildTrimmedFrontageLine,
} from './cadCogoParcelCornerGeometry';
import { cadBuildParcelAutoLayoutDraftForSupportedRemainderMode } from './cadCogoParcelAutoLayoutSequence';
import {
  cadBuildParcelFrontagePathAutoLayoutDraft,
  cadBuildParcelFrontageStripAutoLayoutDraft,
} from './cadCogoParcelFrontagePathAutoLayout';
import { cadBuildParcelAutoLayoutDraft } from './cadCogoParcelAutoLayoutSingle';
import type { CadCornerInfillDraft } from './cadCogoParcelFrontageReferenceAutoLayoutTypes';
export const cadBuildCornerJunctionReplacementLotCount = ({
  parcel,
  firstFrontageLine,
  secondFrontageLine,
  cornerDraft,
  firstSegmentTrimMeters,
  secondSegmentTrimMeters,
  settings,
  tool,
}: {
  parcel: CadParcelEntity;
  firstFrontageLine: CadLineEntity;
  secondFrontageLine: CadLineEntity;
  cornerDraft: CadParcelAutoLayoutDraft;
  firstSegmentTrimMeters: number;
  secondSegmentTrimMeters: number;
  settings: CadParcelLayoutSettings;
  tool: 'slide' | 'swing';
}): number => {
  const buildStraightStripDraft = (
    frontageLine: CadLineEntity,
    trimFromStartMeters: number,
    trimFromEndMeters: number,
    sourceSegmentIndex: number,
  ): CadParcelAutoLayoutDraft | null => {
    const trimmedFrontage =
      cadBuildTrimmedFrontageLine(frontageLine, trimFromStartMeters, trimFromEndMeters) ??
      frontageLine;
    const stripSettings: CadParcelLayoutSettings = {
      ...settings,
      remainderDistribution: 'create_parcel_from_remainder',
    };
    const stripDraft =
      (settings.useMaxDepth
        ? cadBuildParcelFrontageStripAutoLayoutDraft(
            parcel,
            trimmedFrontage,
            stripSettings,
            tool,
          )
        : null) ??
      cadBuildParcelAutoLayoutDraft(
        parcel,
        trimmedFrontage,
        stripSettings,
        tool,
      );
    if (!stripDraft.isValid || stripDraft.acceptedCandidates.length === 0) return null;
    return cadBuildTaggedGeneratedLotDraft({
      draft: stripDraft,
      sourceKind: 'segment',
      sourceSegmentIndex,
    });
  };

  const taggedCornerDraft = cadBuildTaggedGeneratedLotDraft({
    draft: cornerDraft,
    sourceKind: 'corner_prepass',
  });
  const firstStripDraft = buildStraightStripDraft(
    firstFrontageLine,
    0,
    firstSegmentTrimMeters,
    0,
  );
  const secondStripDraft = buildStraightStripDraft(
    secondFrontageLine,
    secondSegmentTrimMeters,
    0,
    1,
  );
  const mergedDraft = cadResolveGeneratedParcelConflicts({
    tool,
    generatedParcels: [
      ...taggedCornerDraft.generatedParcels,
      ...(firstStripDraft?.generatedParcels ?? []),
      ...(secondStripDraft?.generatedParcels ?? []),
    ],
    acceptedCandidates: [
      ...taggedCornerDraft.acceptedCandidates,
      ...(firstStripDraft?.acceptedCandidates ?? []),
      ...(secondStripDraft?.acceptedCandidates ?? []),
    ],
    isValid: true,
    statusMessage: 'Corner junction replacement estimate.',
  });
  return mergedDraft.acceptedCandidates.length;
};

export const cadBuildSequentialCornerStripDraft = ({
  cornerParcel,
  primaryFrontageLine,
  secondaryFrontageLine,
  settings,
  tool,
}: {
  cornerParcel: CadParcelEntity;
  primaryFrontageLine: CadLineEntity;
  secondaryFrontageLine: CadLineEntity;
  settings: CadParcelLayoutSettings;
  tool: 'slide' | 'swing';
}): CadParcelAutoLayoutDraft | null => {
  const primaryDraft = cadBuildParcelAutoLayoutDraftForSupportedRemainderMode(
    cornerParcel,
    primaryFrontageLine,
    {
      ...settings,
      remainderDistribution: 'create_parcel_from_remainder',
    },
    tool,
  );
  if (!primaryDraft.isValid || primaryDraft.acceptedCandidates.length === 0) return null;
  const primaryRemainder =
    primaryDraft.generatedParcels.find((generatedParcel) => generatedParcel.role === 'remainder') ?? null;
  if (!primaryRemainder) return null;
  const primaryRemainderParcel = cadBuildParcelEntityFromGeneratedDraft(
    cornerParcel,
    primaryRemainder,
    true,
  );
  const recoveredSecondaryFrontage = cadBuildFrontageLineFromCurrentParcelSegmentGeometry(
    primaryRemainderParcel,
    { x: secondaryFrontageLine.fromX, y: secondaryFrontageLine.fromY },
    { x: secondaryFrontageLine.toX, y: secondaryFrontageLine.toY },
  );
  if (!recoveredSecondaryFrontage) return null;
  const secondaryDraft = cadBuildParcelAutoLayoutDraftForSupportedRemainderMode(
    primaryRemainderParcel,
    recoveredSecondaryFrontage,
    {
      ...settings,
      remainderDistribution: 'create_parcel_from_remainder',
    },
    tool,
  );
  if (!secondaryDraft.isValid || secondaryDraft.acceptedCandidates.length === 0) return null;
  const mergedDraft = cadResolveGeneratedParcelConflicts({
    tool,
    generatedParcels: [
      ...primaryDraft.generatedParcels.filter((generatedParcel) => generatedParcel.role === 'lot'),
      ...secondaryDraft.generatedParcels,
    ],
    acceptedCandidates: [
      ...primaryDraft.acceptedCandidates,
      ...secondaryDraft.acceptedCandidates,
    ],
    isValid: true,
    statusMessage: 'Sequential corner strip draft.',
  });
  return mergedDraft.acceptedCandidates.length > 0 ? mergedDraft : null;
};

export const cadBuildLimitedCornerPathDraft = (
  cornerParcel: CadParcelEntity,
  firstFrontageLine: CadLineEntity,
  secondFrontageLine: CadLineEntity,
  settings: CadParcelLayoutSettings,
  tool: 'slide' | 'swing',
): CadParcelAutoLayoutDraft | null => {
  const sharedPoint = cadBuildSharedFrontagePoint(firstFrontageLine, secondFrontageLine);
  if (!sharedPoint) return null;
  const pointAwayFromShared = (
    frontageLine: CadLineEntity,
    maxDistanceMeters: number,
  ): CadWorldPoint | null => {
    const start = { x: frontageLine.fromX, y: frontageLine.fromY };
    const end = { x: frontageLine.toX, y: frontageLine.toY };
    const other = parcelPointsMatch(sharedPoint, start)
      ? end
      : parcelPointsMatch(sharedPoint, end)
        ? start
        : null;
    if (!other) return null;
    const lengthMeters = cadDistance(sharedPoint, other);
    if (lengthMeters <= 1e-9) return null;
    const distanceMeters = Math.min(lengthMeters, maxDistanceMeters);
    return {
      x: sharedPoint.x + ((other.x - sharedPoint.x) / lengthMeters) * distanceMeters,
      y: sharedPoint.y + ((other.y - sharedPoint.y) / lengthMeters) * distanceMeters,
    };
  };
  const cornerFrontageMeters = Math.max(
    settings.minFrontageMeters * 2,
    settings.minWidthMeters * 2,
    Math.sqrt(settings.minAreaSquareMeters) * 1.5,
  );
  const firstOuterPoint = pointAwayFromShared(firstFrontageLine, cornerFrontageMeters);
  const secondOuterPoint = pointAwayFromShared(secondFrontageLine, cornerFrontageMeters);
  if (!firstOuterPoint || !secondOuterPoint) return null;

  const cornerReference: CadParcelLayoutFrontageReference = {
    sourceEntityId: cornerParcel.id,
    displayLabel: `${firstFrontageLine.fromStationId}-${firstFrontageLine.toStationId}, ${secondFrontageLine.fromStationId}-${secondFrontageLine.toStationId}`,
    sourcePointIds: ['CORNER1', 'CORNER', 'CORNER2'],
    frontageLine: {
      ...firstFrontageLine,
      id: `${cornerParcel.id}:limited-corner-frontage`,
      fromStationId: 'CORNER1',
      fromX: firstOuterPoint.x,
      fromY: firstOuterPoint.y,
      toStationId: 'CORNER',
      toX: sharedPoint.x,
      toY: sharedPoint.y,
    },
    sourceGeometry: {
      kind: 'polyline',
      vertices: [
        { x: firstOuterPoint.x, y: firstOuterPoint.y },
        { x: sharedPoint.x, y: sharedPoint.y },
        { x: secondOuterPoint.x, y: secondOuterPoint.y },
      ],
      vertexLabels: ['CORNER1', 'CORNER', 'CORNER2'],
    },
  };
  const draft = cadBuildParcelFrontagePathAutoLayoutDraft(
    cornerParcel,
    cornerReference,
    {
      ...settings,
      remainderDistribution: 'create_parcel_from_remainder',
    },
    tool,
  );
  if (!draft?.isValid || draft.acceptedCandidates.length === 0) return null;
  return {
    ...draft,
    generatedParcels: draft.generatedParcels.filter((generatedParcel) => generatedParcel.role === 'lot'),
  };
};

export const cadBuildFrontageBridgeDraft = (
  parcel: CadParcelEntity,
  firstFrontageLine: CadLineEntity,
  secondFrontageLine: CadLineEntity,
  settings: CadParcelLayoutSettings,
  tool: 'slide' | 'swing',
): CadCornerInfillDraft | null => {
  const sharedPoint = cadBuildSharedFrontagePoint(firstFrontageLine, secondFrontageLine);
  if (!sharedPoint) return null;
  const firstStart = { x: firstFrontageLine.fromX, y: firstFrontageLine.fromY };
  const firstEnd = { x: firstFrontageLine.toX, y: firstFrontageLine.toY };
  const secondStart = { x: secondFrontageLine.fromX, y: secondFrontageLine.fromY };
  const secondEnd = { x: secondFrontageLine.toX, y: secondFrontageLine.toY };
  const firstOuterPoint = parcelPointsMatch(sharedPoint, firstStart)
    ? firstEnd
    : parcelPointsMatch(sharedPoint, firstEnd)
      ? firstStart
      : null;
  const secondOuterPoint = parcelPointsMatch(sharedPoint, secondStart)
    ? secondEnd
    : parcelPointsMatch(sharedPoint, secondEnd)
      ? secondStart
      : null;
  if (!firstOuterPoint || !secondOuterPoint) return null;
  const firstRemainderFrontageMeters = cadDistance(firstOuterPoint, sharedPoint);
  const secondAvailableFrontageMeters = cadDistance(sharedPoint, secondOuterPoint);
  if (
    firstRemainderFrontageMeters <= 1e-9 ||
    secondAvailableFrontageMeters <= 1e-9 ||
    firstRemainderFrontageMeters >= settings.minFrontageMeters - 1e-9
  ) {
    return null;
  }
  const minimumSecondFrontageMeters = Math.max(
    settings.minFrontageMeters - firstRemainderFrontageMeters,
    1,
  );
  const maximumSecondFrontageMeters = Math.min(
    secondAvailableFrontageMeters,
    Math.max(settings.minFrontageMeters * 2, settings.minWidthMeters * 2, minimumSecondFrontageMeters),
  );
  if (maximumSecondFrontageMeters + 1e-9 < minimumSecondFrontageMeters) return null;
  const secondLengthMeters = cadDistance(sharedPoint, secondOuterPoint);
  const buildSecondPoint = (distanceMeters: number): CadWorldPoint => ({
    x: sharedPoint.x + ((secondOuterPoint.x - sharedPoint.x) / secondLengthMeters) * distanceMeters,
    y: sharedPoint.y + ((secondOuterPoint.y - sharedPoint.y) / secondLengthMeters) * distanceMeters,
  });
  const candidateDrafts: CadCornerInfillDraft[] = [];
  const steps = 16;
  for (let index = 0; index <= steps; index += 1) {
    const ratio = index / steps;
    const secondFrontageMeters =
      minimumSecondFrontageMeters +
      (maximumSecondFrontageMeters - minimumSecondFrontageMeters) * ratio;
    const secondPoint = buildSecondPoint(secondFrontageMeters);
    const bridgeReference: CadParcelLayoutFrontageReference = {
      sourceEntityId: parcel.id,
      displayLabel: `${firstFrontageLine.fromStationId}-${firstFrontageLine.toStationId}, ${secondFrontageLine.fromStationId}-${secondFrontageLine.toStationId}`,
      sourcePointIds: ['BRIDGE1', 'BRIDGE', 'BRIDGE2'],
      frontageLine: {
        ...firstFrontageLine,
        id: `${parcel.id}:frontage-bridge`,
        fromStationId: 'BRIDGE1',
        fromX: firstOuterPoint.x,
        fromY: firstOuterPoint.y,
        toStationId: 'BRIDGE',
        toX: sharedPoint.x,
        toY: sharedPoint.y,
      },
      sourceGeometry: {
        kind: 'polyline',
        vertices: [
          { x: firstOuterPoint.x, y: firstOuterPoint.y },
          { x: sharedPoint.x, y: sharedPoint.y },
          secondPoint,
        ],
        vertexLabels: ['BRIDGE1', 'BRIDGE', 'BRIDGE2'],
      },
    };
    const bridgeDraft = cadBuildParcelFrontagePathAutoLayoutDraft(
      parcel,
      bridgeReference,
      {
        ...settings,
        remainderDistribution: 'create_parcel_from_remainder',
      },
      tool,
    );
    if (!bridgeDraft?.isValid || bridgeDraft.acceptedCandidates.length === 0) continue;
    const bridgeLots = bridgeDraft.generatedParcels.filter(
      (generatedParcel) => generatedParcel.role === 'lot',
    );
    if (bridgeLots.length === 0) continue;
    candidateDrafts.push({
      draft: {
        ...bridgeDraft,
        generatedParcels: bridgeLots,
      },
      remainderDraft:
        bridgeDraft.generatedParcels.find((generatedParcel) => generatedParcel.role === 'remainder') ?? null,
      firstSegmentTrimMeters: firstRemainderFrontageMeters,
      secondSegmentTrimMeters: secondFrontageMeters,
    });
  }
  return (
    candidateDrafts
      .sort((left, right) => {
        if (left.draft.acceptedCandidates.length !== right.draft.acceptedCandidates.length) {
          return right.draft.acceptedCandidates.length - left.draft.acceptedCandidates.length;
        }
        const leftArea = left.draft.acceptedCandidates[0]?.draft?.childAreaSquareMeters ?? Number.POSITIVE_INFINITY;
        const rightArea = right.draft.acceptedCandidates[0]?.draft?.childAreaSquareMeters ?? Number.POSITIVE_INFINITY;
        return leftArea - rightArea;
      })[0] ?? null
  );
};
