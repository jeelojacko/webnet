import type { CadParcelLayoutFrontageReference } from './cadCogoParcelFrontage';
import type { CadLineEntity, CadParcelEntity, CadParcelLayoutSettings } from './cadTypes';
import {
  cadBuildCappedFallbackCornerTrimDistance,
  cadBuildReservedFrontageTrimDistance,
} from './cadCogoParcelCornerGeometry';
import { cadBuildFrontageLineForCurrentParcelSegment } from './cadCogoParcelLayoutDrafts';

type SegmentTrimResult = {
  trimFromStartMeters: number;
  trimFromEndMeters: number;
};

const reverseFrontageLine = (frontageLine: CadLineEntity): CadLineEntity => ({
  ...frontageLine,
  fromStationId: frontageLine.toStationId,
  fromX: frontageLine.toX,
  fromY: frontageLine.toY,
  toStationId: frontageLine.fromStationId,
  toX: frontageLine.fromX,
  toY: frontageLine.fromY,
});

export const cadBuildFrontageReferenceSegmentTrim = ({
  cornerDraftJunctionIndexes,
  cornerTrimFromEndMetersBySegment,
  cornerTrimFromStartMetersBySegment,
  frontageReference,
  parcel,
  segmentIndex,
  settings,
}: {
  parcel: CadParcelEntity;
  frontageReference: CadParcelLayoutFrontageReference;
  settings: CadParcelLayoutSettings;
  segmentIndex: number;
  cornerDraftJunctionIndexes: ReadonlySet<number>;
  cornerTrimFromStartMetersBySegment: ReadonlyMap<number, number>;
  cornerTrimFromEndMetersBySegment: ReadonlyMap<number, number>;
}): SegmentTrimResult => {
  let trimFromStartMeters = cornerTrimFromStartMetersBySegment.get(segmentIndex) ?? 0;
  let trimFromEndMeters = cornerTrimFromEndMetersBySegment.get(segmentIndex) ?? 0;
  if (!settings.useMaxDepth) return { trimFromStartMeters, trimFromEndMeters };

  const previousJunctionIndex = segmentIndex - 1;
  if (previousJunctionIndex < 0 || cornerDraftJunctionIndexes.has(previousJunctionIndex)) {
    return { trimFromStartMeters, trimFromEndMeters };
  }

  const previousFrontage = cadBuildFrontageLineForCurrentParcelSegment(
    parcel,
    frontageReference,
    previousJunctionIndex,
  );
  const originalCurrentFrontage = cadBuildFrontageLineForCurrentParcelSegment(
    parcel,
    frontageReference,
    segmentIndex,
  );
  if (!previousFrontage || !originalCurrentFrontage) {
    return { trimFromStartMeters, trimFromEndMeters };
  }

  if (previousFrontage.toStationId === originalCurrentFrontage.fromStationId) {
    trimFromStartMeters = Math.max(
      trimFromStartMeters,
      cadBuildCappedFallbackCornerTrimDistance(
        cadBuildReservedFrontageTrimDistance(
          originalCurrentFrontage,
          previousFrontage,
          'start',
          settings.maxDepthMeters,
        ),
        settings,
      ),
    );
  } else if (previousFrontage.toStationId === originalCurrentFrontage.toStationId) {
    trimFromEndMeters = Math.max(
      trimFromEndMeters,
      cadBuildCappedFallbackCornerTrimDistance(
        cadBuildReservedFrontageTrimDistance(
          originalCurrentFrontage,
          previousFrontage,
          'end',
          settings.maxDepthMeters,
        ),
        settings,
      ),
    );
  } else if (previousFrontage.fromStationId === originalCurrentFrontage.fromStationId) {
    trimFromStartMeters = Math.max(
      trimFromStartMeters,
      cadBuildCappedFallbackCornerTrimDistance(
        cadBuildReservedFrontageTrimDistance(
          originalCurrentFrontage,
          reverseFrontageLine(previousFrontage),
          'start',
          settings.maxDepthMeters,
        ),
        settings,
      ),
    );
  } else if (previousFrontage.fromStationId === originalCurrentFrontage.toStationId) {
    trimFromEndMeters = Math.max(
      trimFromEndMeters,
      cadBuildCappedFallbackCornerTrimDistance(
        cadBuildReservedFrontageTrimDistance(
          originalCurrentFrontage,
          reverseFrontageLine(previousFrontage),
          'end',
          settings.maxDepthMeters,
        ),
        settings,
      ),
    );
  }

  return { trimFromStartMeters, trimFromEndMeters };
};
