import type {
  ImportedControlStationRecord,
  ImportedJobXmlExtras,
  ImportedObservationRecord,
  ImportedSourceMetadata,
  ImportedTraceEntry,
} from '../importers';
import {
  choosePreferredStation,
  collapseWhitespace,
  extractXmlBlock,
  extractXmlNumber,
  extractXmlText,
  hasXmlTag,
  sanitizeStationId,
} from './shared';
import {
  correctJobXmlSlopeDistance,
  normalizeJobXmlAngleDeg,
  pickJobXmlBacksightCircleDeg,
  resolveJobXmlPointFromBlock,
} from './jobXmlImporter.helpers';
import { emitJobXmlMeasurementObservation } from './jobXmlImporter.measurementEmitters';
import type {
  JobXmlAtmosphereContext,
  JobXmlBacksightContext,
  JobXmlSetupContext,
  JobXmlTargetContext,
  JobXmlRoundEvent,
} from './jobXmlImporter.types';

interface ConvertJobXmlMeasurementsArgs {
  angleMode: 'raw' | 'reduced';
  atmosphereContexts: Map<string, JobXmlAtmosphereContext>;
  backsightContexts: Map<string, JobXmlBacksightContext>;
  measurementBlocks: { block: string; index: number }[];
  observations: ImportedObservationRecord[];
  pointRefLookup: Map<string, string>;
  resolveSourceLine: (_index: number) => number;
  roundEvents: JobXmlRoundEvent[];
  setupContexts: Map<string, JobXmlSetupContext>;
  stationMap: Map<string, ImportedControlStationRecord>;
  targetContexts: Map<string, JobXmlTargetContext>;
  trace: ImportedTraceEntry[];
}

export const convertJobXmlMeasurements = ({
  angleMode,
  atmosphereContexts,
  backsightContexts,
  measurementBlocks,
  observations,
  pointRefLookup,
  resolveSourceLine,
  roundEvents,
  setupContexts,
  stationMap,
  targetContexts,
  trace,
}: ConvertJobXmlMeasurementsArgs): void => {
  let currentRound: number | undefined;
  let roundEventCursor = 0;
  let runningObservationOrder = 0;

  measurementBlocks.forEach(({ block, index }) => {
    while (roundEventCursor < roundEvents.length && roundEvents[roundEventCursor]!.index < index) {
      const event = roundEvents[roundEventCursor]!;
      if (event.kind === 'start') currentRound = event.round ?? currentRound;
      else currentRound = undefined;
      roundEventCursor += 1;
    }

    const sourceLine = resolveSourceLine(index);
    const isDeleted = /<Deleted>\s*true\s*<\/Deleted>/i.test(block);
    if (isDeleted) return;

    const rawName = extractXmlText(block, ['Name', 'PointName', 'PointNumber', 'PointID']);
    const fallbackTargetId = rawName ? sanitizeStationId(rawName) : undefined;
    const stationRecordRef = extractXmlText(block, ['StationRecordID', 'StationID']);
    const backBearingRef = extractXmlText(block, ['BackBearingID', 'BackBearingRecordID']);
    const targetRecordRef = extractXmlText(block, ['TargetID', 'TargetRecordID']);
    const method = collapseWhitespace(extractXmlText(block, ['Method']) ?? '').toUpperCase();
    const classification = collapseWhitespace(extractXmlText(block, ['Classification']) ?? '');
    const description = extractXmlText(block, ['Code', 'Description', 'Descriptor', 'FeatureCode']);
    const isDirectReading = method === 'DIRECTREADING';
    const isMta = method === 'MEANTURNEDANGLE' || hasXmlTag(block, ['MTA']);

    const setupContext = stationRecordRef ? setupContexts.get(stationRecordRef) : undefined;
    const occupyId =
      setupContext?.occupyId ??
      resolveJobXmlPointFromBlock(
        block,
        ['OccupyPointID', 'SetupPointID', 'StationID'],
        ['StationName'],
        pointRefLookup,
        stationMap,
      );

    const descriptionCode = description?.trim() || undefined;
    const existingTargetContext = targetRecordRef ? targetContexts.get(targetRecordRef) : undefined;
    const targetContext =
      targetRecordRef && descriptionCode
        ? {
            ...existingTargetContext,
            code: descriptionCode,
          }
        : existingTargetContext;
    if (targetRecordRef && targetContext) {
      targetContexts.set(targetRecordRef, targetContext);
    }
    const targetId =
      targetContext?.stationId ??
      resolveJobXmlPointFromBlock(
        block,
        ['TargetID', 'TargetPointID', 'PointID', 'PointRecordID'],
        ['TargetName', 'Name', 'PointName', 'PointNumber'],
        pointRefLookup,
        stationMap,
      ) ??
      fallbackTargetId;

    const resolvedBackBearingRef = backBearingRef ?? setupContext?.backsightRecordRef;
    const backsightContext = resolvedBackBearingRef
      ? backsightContexts.get(resolvedBackBearingRef)
      : undefined;
    const backsightId =
      backsightContext?.stationId ??
      setupContext?.backsightId ??
      resolveJobXmlPointFromBlock(
        block,
        ['BackSightPointID', 'BacksightPointID', 'BackBearingPointID'],
        ['BacksightName', 'BackSightName'],
        pointRefLookup,
        stationMap,
      );

    const observationHiM = extractXmlNumber(block, [
      'InstrumentHeight',
      'TheodoliteHeight',
      'HI',
      'IH',
      'InstHeight',
    ]);
    const observationHtM = extractXmlNumber(block, [
      'TargetHeight',
      'PrismHeight',
      'RodHeight',
      'HT',
    ]);
    const hiM = observationHiM ?? setupContext?.hiM;
    const htM = observationHtM ?? targetContext?.htM;
    const circleBlock = extractXmlBlock(block, ['Circle']);
    const mtaBlock = extractXmlBlock(block, ['MTA']);
    const measurementDataBlock = mtaBlock ?? circleBlock ?? block;
    const faceText = extractXmlText(block, ['Face']);
    const normalizedFace = collapseWhitespace(faceText ?? '');
    const sourceMeta: ImportedSourceMetadata = {
      method: method || undefined,
      classification: classification || undefined,
      face: normalizedFace || undefined,
      setupType: setupContext?.setupType || undefined,
    };
    const rawHorizontalCircleDeg = extractXmlNumber(measurementDataBlock, [
      'HorizontalCircle',
      'Hz',
    ]);
    const explicitAngleDeg =
      extractXmlNumber(block, ['HorizontalAngle', 'TurnedAngle']) ??
      (isMta ? rawHorizontalCircleDeg : undefined);
    const explicitBearingDeg = extractXmlNumber(block, ['Azimuth', 'Bearing']);
    const rawEdmDistanceM = extractXmlNumber(measurementDataBlock, [
      'EDMDistance',
      'SlopeDistance',
      'Distance',
      'HorizontalDistance',
    ]);
    const rawVerticalCircleDeg = extractXmlNumber(measurementDataBlock, [
      'VerticalCircle',
      'ZenithAngle',
      'Zenith',
    ]);
    const deltaHM = extractXmlNumber(measurementDataBlock, [
      'DeltaHeight',
      'VerticalDistance',
      'DeltaH',
    ]);
    const backsightCircleDeg = pickJobXmlBacksightCircleDeg(backsightContext, faceText);
    const reducedAngleDeg =
      rawHorizontalCircleDeg != null && backsightCircleDeg != null
        ? normalizeJobXmlAngleDeg(rawHorizontalCircleDeg - backsightCircleDeg)
        : undefined;
    const ppm = setupContext?.atmosphereRef
      ? atmosphereContexts.get(setupContext.atmosphereRef)?.ppm
      : undefined;
    const prismConstantM = targetContext?.prismConstantM;
    const correctedSlopeDistanceM = correctJobXmlSlopeDistance(rawEdmDistanceM, ppm, prismConstantM);
    const distanceM = correctedSlopeDistanceM ?? rawEdmDistanceM;
    const zenithDeg = rawVerticalCircleDeg;
    const observationOrder = isDirectReading ? runningObservationOrder++ : undefined;
    const hiSource: ImportedJobXmlExtras['hiSource'] =
      observationHiM != null ? 'observation' : setupContext?.hiM != null ? 'setup' : undefined;
    const htSource: ImportedJobXmlExtras['htSource'] =
      observationHtM != null ? 'observation' : targetContext?.htM != null ? 'target' : undefined;
    const jobXml: ImportedJobXmlExtras = {
      stationRecordRef,
      backBearingRecordRef: resolvedBackBearingRef,
      targetRecordRef,
      atmosphereRecordRef: setupContext?.atmosphereRef,
      round: currentRound,
      observationOrder,
      directionSetId:
        observationOrder != null
          ? `${stationRecordRef ?? occupyId ?? 'UNKNOWN'}::${resolvedBackBearingRef ?? backsightId ?? ''}::${currentRound ?? 0}`
          : undefined,
      isDirectReading,
      isMta,
      isBacksight: classification.toUpperCase() === 'BACKSIGHT',
      rawHorizontalCircleDeg,
      reducedAngleDeg,
      backsightCircleDeg,
      backsightFace1CircleDeg: backsightContext?.face1HorizontalCircleDeg,
      backsightFace2CircleDeg: backsightContext?.face2HorizontalCircleDeg,
      rawVerticalCircleDeg,
      rawEdmDistanceM,
      correctedSlopeDistanceM,
      prismConstantM,
      ppm,
      pointCode: descriptionCode,
      targetCode: targetContext?.code,
      observationHiM,
      setupHiM: setupContext?.hiM,
      effectiveHiM: hiM,
      hiSource,
      observationHtM,
      targetHtM: targetContext?.htM,
      effectiveHtM: htM,
      htSource,
    };

    const derivedAngleDeg =
      explicitAngleDeg != null
        ? normalizeJobXmlAngleDeg(explicitAngleDeg)
        : rawHorizontalCircleDeg != null
          ? angleMode === 'raw'
            ? normalizeJobXmlAngleDeg(rawHorizontalCircleDeg)
            : backsightCircleDeg != null
              ? normalizeJobXmlAngleDeg(rawHorizontalCircleDeg - backsightCircleDeg)
              : undefined
          : undefined;
    const derivedBearingDeg =
      explicitBearingDeg != null
        ? normalizeJobXmlAngleDeg(explicitBearingDeg)
        : isMta && rawHorizontalCircleDeg != null && backsightContext?.bearingDeg != null
          ? normalizeJobXmlAngleDeg(backsightContext.bearingDeg + rawHorizontalCircleDeg)
          : rawHorizontalCircleDeg != null &&
              backsightCircleDeg != null &&
              backsightContext?.bearingDeg != null
            ? normalizeJobXmlAngleDeg(
                backsightContext.bearingDeg - backsightCircleDeg + rawHorizontalCircleDeg,
              )
            : undefined;

    if (targetId) {
      const computedGridBlock = extractXmlBlock(block, ['ComputedGrid']);
      const computedNorthM = computedGridBlock
        ? extractXmlNumber(computedGridBlock, ['North', 'Northing', 'GridNorth'])
        : undefined;
      const computedEastM = computedGridBlock
        ? extractXmlNumber(computedGridBlock, ['East', 'Easting', 'GridEast'])
        : undefined;
      const computedElevationM = computedGridBlock
        ? extractXmlNumber(computedGridBlock, [
            'Elevation',
            'OrthometricHeight',
            'ReducedLevel',
            'Height',
          ])
        : undefined;
      if (computedNorthM != null && computedEastM != null) {
        const candidate: ImportedControlStationRecord = {
          kind: 'control-station',
          coordinateMode: 'local',
          stationId: targetId,
          northM: computedNorthM,
          eastM: computedEastM,
          heightM: computedElevationM,
          sourceLine,
          sourceCode: 'PointRecord',
        };
        const existing = stationMap.get(targetId);
        stationMap.set(targetId, choosePreferredStation(existing, candidate));
      }
    }

    emitJobXmlMeasurementObservation({
      backsightId,
      deltaHM,
      derivedAngleDeg,
      derivedBearingDeg,
      distanceM,
      fallbackTargetId,
      hiM,
      htM,
      jobXml,
      observations,
      observationDescription: descriptionCode || targetContext?.code,
      occupyId,
      sourceLine,
      sourceMeta,
      targetId,
      trace,
      zenithDeg,
    });
  });
};
