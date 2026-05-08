import { RAD_TO_DEG } from '../angles';
import type {
  ExternalImportParseOptions,
  ExternalInputImporter,
  ImportedControlStationRecord,
  ImportedDataset,
  ImportedDistanceObservationRecord,
  ImportedDistanceVerticalObservationRecord,
  ImportedJobXmlExtras,
  ImportedObservationRecord,
  ImportedSourceMetadata,
  ImportedTraceEntry,
} from '../importers';
import {
  buildTraceDetailLine,
  buildLineNumberResolver,
  choosePreferredStation,
  collapseWhitespace,
  decodeXmlEntities,
  extractXmlAttribute,
  extractXmlBlock,
  extractXmlNumber,
  extractXmlText,
  hasXmlTag,
  matchXmlBlocks,
  plural,
  sanitizeStationId,
  sourceLeaf,
} from './shared';

interface JobXmlSetupContext {
  occupyId?: string;
  backsightId?: string;
  backsightRecordRef?: string;
  hiM?: number;
  setupType?: string;
  atmosphereRef?: string;
}

interface JobXmlBacksightContext {
  stationId?: string;
  horizontalCircleDeg?: number;
  face1HorizontalCircleDeg?: number;
  face2HorizontalCircleDeg?: number;
  bearingDeg?: number;
}

interface JobXmlTargetContext {
  stationId?: string;
  htM?: number;
  prismConstantM?: number;
  code?: string;
}

interface JobXmlAtmosphereContext {
  ppm?: number;
}

const registerJobXmlPointReference = (
  lookup: Map<string, string>,
  rawRef: string | undefined,
  stationId: string,
): void => {
  if (!rawRef) return;
  const normalized = collapseWhitespace(decodeXmlEntities(rawRef));
  if (!normalized) return;
  if (!lookup.has(normalized)) lookup.set(normalized, stationId);
  const sanitized = sanitizeStationId(normalized);
  if (sanitized && !lookup.has(sanitized)) lookup.set(sanitized, stationId);
};

const resolveJobXmlPointReference = (
  rawRef: string | undefined,
  lookup: Map<string, string>,
  knownStations: Map<string, ImportedControlStationRecord>,
  allowSanitizedFallback: boolean,
): string | undefined => {
  if (!rawRef) return undefined;
  const normalized = collapseWhitespace(decodeXmlEntities(rawRef));
  if (!normalized) return undefined;
  const direct = lookup.get(normalized) ?? lookup.get(sanitizeStationId(normalized));
  if (direct) return direct;
  const sanitized = sanitizeStationId(normalized);
  if (knownStations.has(sanitized) || allowSanitizedFallback) return sanitized;
  return undefined;
};

const resolveJobXmlPointFromBlock = (
  block: string,
  refTagNames: string[],
  nameTagNames: string[],
  lookup: Map<string, string>,
  knownStations: Map<string, ImportedControlStationRecord>,
): string | undefined => {
  for (const tagName of refTagNames) {
    const resolved = resolveJobXmlPointReference(
      extractXmlText(block, [tagName]),
      lookup,
      knownStations,
      false,
    );
    if (resolved) return resolved;
  }
  for (const tagName of nameTagNames) {
    const resolved = resolveJobXmlPointReference(
      extractXmlText(block, [tagName]),
      lookup,
      knownStations,
      true,
    );
    if (resolved) return resolved;
  }
  return undefined;
};

const normalizeAngleDeg = (value: number): number => {
  const wrapped = ((value % 360) + 360) % 360;
  return wrapped === 360 ? 0 : wrapped;
};

type JobXmlRoundEvent = {
  index: number;
  kind: 'start' | 'end' | 'reset';
  round?: number;
};

const collectJobXmlRoundEvents = (input: string): JobXmlRoundEvent[] =>
  [
    ...matchXmlBlocks(input, 'StartRoundRecord').map(({ block, index }) => ({
      index,
      kind: 'start' as const,
      round: extractXmlNumber(block, ['Round']),
    })),
    ...matchXmlBlocks(input, 'EndRoundRecord').map(({ index }) => ({
      index,
      kind: 'end' as const,
    })),
    ...matchXmlBlocks(input, 'StationRecord').map(({ index }) => ({
      index,
      kind: 'reset' as const,
    })),
  ].sort((left, right) => left.index - right.index);

const correctJobXmlSlopeDistance = (
  rawDistanceM: number | undefined,
  ppm: number | undefined,
  prismConstantM: number | undefined,
): number | undefined => {
  if (rawDistanceM == null) return undefined;
  return rawDistanceM * (1 + (ppm ?? 0) / 1_000_000) + (prismConstantM ?? 0);
};

const computeLocalAzimuthDeg = (
  fromStation: ImportedControlStationRecord | undefined,
  toStation: ImportedControlStationRecord | undefined,
): number | undefined => {
  if (
    !fromStation ||
    !toStation ||
    fromStation.coordinateMode !== 'local' ||
    toStation.coordinateMode !== 'local' ||
    fromStation.eastM == null ||
    fromStation.northM == null ||
    toStation.eastM == null ||
    toStation.northM == null
  ) {
    return undefined;
  }
  const deltaEast = toStation.eastM - fromStation.eastM;
  const deltaNorth = toStation.northM - fromStation.northM;
  if (Math.abs(deltaEast) < 1e-12 && Math.abs(deltaNorth) < 1e-12) return undefined;
  return normalizeAngleDeg(Math.atan2(deltaEast, deltaNorth) * RAD_TO_DEG);
};

const pickJobXmlBacksightCircleDeg = (
  backsightContext: JobXmlBacksightContext | undefined,
  faceText: string | undefined,
): number | undefined => {
  if (!backsightContext) return undefined;
  const face = collapseWhitespace(faceText ?? '').toUpperCase();
  if (face === 'FACE1') {
    return backsightContext.face1HorizontalCircleDeg ?? backsightContext.horizontalCircleDeg;
  }
  if (face === 'FACE2') {
    return backsightContext.face2HorizontalCircleDeg ?? backsightContext.horizontalCircleDeg;
  }
  return backsightContext.horizontalCircleDeg;
};

export const detectJobXml = (input: string, sourceName?: string): boolean => {
  const fileName = sourceName?.toLowerCase() ?? '';
  const looksXml = /^\s*<\?xml\b|^\s*<\w+/i.test(input);
  const hasJobTags =
    /<JOBFile\b/i.test(input) ||
    /<FieldBook\b/i.test(input) ||
    /<Reductions\b/i.test(input) ||
    /<PointRecord\b/i.test(input);
  return (
    (fileName.endsWith('.jxl') ||
      fileName.endsWith('.jobxml') ||
      fileName.endsWith('.xml') ||
      looksXml) &&
    hasJobTags
  );
};

export const parseJobXml = (
  input: string,
  sourceName?: string,
  options?: ExternalImportParseOptions,
): ImportedDataset | null => {
  if (!detectJobXml(input, sourceName)) return null;

  const angleMode = options?.angleMode ?? 'reduced';
  const resolveSourceLine = buildLineNumberResolver(input);
  const trace: ImportedTraceEntry[] = [];
  const stationMap = new Map<string, ImportedControlStationRecord>();
  const pointRefLookup = new Map<string, string>();
  const setupContexts = new Map<string, JobXmlSetupContext>();
  const backsightContexts = new Map<string, JobXmlBacksightContext>();
  const targetContexts = new Map<string, JobXmlTargetContext>();
  const atmosphereContexts = new Map<string, JobXmlAtmosphereContext>();
  const observations: ImportedObservationRecord[] = [];
  const pointBlocks = matchXmlBlocks(input, 'PointRecord');
  const reducedPointBlocks = matchXmlBlocks(input, 'Point');
  const measurementBlocks: { block: string; index: number }[] = [];
  const roundEvents = collectJobXmlRoundEvents(input);
  const fileLabel = sourceLeaf(sourceName);

  pointBlocks.forEach(({ block }) => {
    const rawName = extractXmlText(block, ['Name', 'PointName', 'PointNumber', 'PointID']);
    const stationId = rawName ? sanitizeStationId(rawName) : undefined;
    const xmlId = extractXmlAttribute(block, ['ID', 'Id']);
    if (stationId) {
      registerJobXmlPointReference(pointRefLookup, rawName, stationId);
      registerJobXmlPointReference(pointRefLookup, xmlId, stationId);
    }
  });

  reducedPointBlocks.forEach(({ block }) => {
    const rawName = extractXmlText(block, ['Name', 'PointName', 'PointNumber', 'PointID']);
    const stationId = rawName ? sanitizeStationId(rawName) : undefined;
    const xmlId = extractXmlAttribute(block, ['ID', 'Id']);
    if (stationId) {
      registerJobXmlPointReference(pointRefLookup, rawName, stationId);
      registerJobXmlPointReference(pointRefLookup, xmlId, stationId);
    }
  });

  matchXmlBlocks(input, 'AtmosphereRecord').forEach(({ block }) => {
    const xmlId = extractXmlAttribute(block, ['ID', 'Id']);
    if (!xmlId) return;
    atmosphereContexts.set(xmlId, {
      ppm: extractXmlNumber(block, ['PPM']),
    });
  });

  pointBlocks.forEach(({ block, index }) => {
    const sourceLine = resolveSourceLine(index);
    const rawName = extractXmlText(block, ['Name', 'PointName', 'PointNumber', 'PointID']);
    const stationId = rawName ? sanitizeStationId(rawName) : undefined;
    const xmlId = extractXmlAttribute(block, ['ID', 'Id']);
    const northM = extractXmlNumber(block, ['North', 'Northing', 'GridNorth']);
    const eastM = extractXmlNumber(block, ['East', 'Easting', 'GridEast']);
    const elevationM = extractXmlNumber(block, [
      'Elevation',
      'OrthometricHeight',
      'ReducedLevel',
      'Height',
    ]);
    const latitudeDeg = extractXmlNumber(block, ['Latitude', 'Lat']);
    const longitudeDeg = extractXmlNumber(block, ['Longitude', 'Lon', 'Long']);
    const ellipsoidHeightM = extractXmlNumber(block, ['EllipsoidHeight', 'EllHeight']);
    const sigmaNorthM = extractXmlNumber(block, ['SigmaNorth', 'StdDevNorth', 'StdevNorth']);
    const sigmaEastM = extractXmlNumber(block, ['SigmaEast', 'StdDevEast', 'StdevEast']);
    const sigmaHeightM = extractXmlNumber(block, ['SigmaHeight', 'StdDevHeight', 'StdevHeight']);
    const corrEN = extractXmlNumber(block, ['CorrelationEN', 'CorrEN']);
    const description = extractXmlText(block, ['Code', 'Description', 'Descriptor', 'FeatureCode']);
    const looksLikeMeasurement = hasXmlTag(block, [
      'Circle',
      'StationID',
      'StationRecordID',
      'BackBearingID',
      'BackBearingRecordID',
      'TargetID',
      'TargetRecordID',
      'EDMDistance',
      'HorizontalCircle',
      'VerticalCircle',
      'Azimuth',
      'Bearing',
      'MTA',
      'ComputedGrid',
      'ObservationPolarDeltas',
    ]);

    if (looksLikeMeasurement) {
      measurementBlocks.push({ block, index });
      return;
    }

    if (latitudeDeg != null && longitudeDeg != null) {
      if (!stationId) {
        trace.push({
          level: 'warning',
          sourceLine,
          sourceCode: 'PointRecord',
          message: 'Skipped geodetic point record without a usable point name.',
        });
        return;
      }
      const candidate: ImportedControlStationRecord = {
        kind: 'control-station',
        coordinateMode: 'geodetic',
        stationId,
        latitudeDeg,
        longitudeDeg,
        heightDatum: ellipsoidHeightM != null ? 'ellipsoid' : 'orthometric',
        heightM: ellipsoidHeightM ?? elevationM ?? 0,
        sigmaNorthM,
        sigmaEastM,
        sigmaHeightM,
        corrEN,
        description,
        sourceLine,
        sourceCode: 'PointRecord',
      };
      const existing = stationMap.get(stationId);
      if (existing) {
        trace.push({
          level: 'warning',
          sourceLine,
          sourceCode: 'PointRecord',
          message: `Duplicate JobXML point ${stationId}; keeping the richer coordinate record.`,
        });
      }
      stationMap.set(stationId, choosePreferredStation(existing, candidate));
      registerJobXmlPointReference(pointRefLookup, xmlId, stationId);
      return;
    }

    if (northM != null && eastM != null) {
      if (!stationId) {
        trace.push({
          level: 'warning',
          sourceLine,
          sourceCode: 'PointRecord',
          message: 'Skipped local point record without a usable point name.',
        });
        return;
      }
      const candidate: ImportedControlStationRecord = {
        kind: 'control-station',
        coordinateMode: 'local',
        stationId,
        northM,
        eastM,
        heightM: elevationM ?? 0,
        sigmaNorthM,
        sigmaEastM,
        sigmaHeightM,
        corrEN,
        description,
        sourceLine,
        sourceCode: 'PointRecord',
      };
      const existing = stationMap.get(stationId);
      if (existing) {
        trace.push({
          level: 'warning',
          sourceLine,
          sourceCode: 'PointRecord',
          message: `Duplicate JobXML point ${stationId}; keeping the richer coordinate record.`,
        });
      }
      stationMap.set(stationId, choosePreferredStation(existing, candidate));
      registerJobXmlPointReference(pointRefLookup, xmlId, stationId);
      return;
    }

    if (!stationId) {
      trace.push({
        level: 'warning',
        sourceLine,
        sourceCode: 'PointRecord',
        message: 'Skipped point record without a usable point name.',
      });
      return;
    }

    trace.push({
      level: 'warning',
      sourceLine,
      sourceCode: 'PointRecord',
      message: `JobXML point ${stationId} was skipped because no supported coordinate payload was found.`,
    });
  });

  reducedPointBlocks.forEach(({ block, index }) => {
    const sourceLine = resolveSourceLine(index);
    const rawName = extractXmlText(block, ['Name', 'PointName', 'PointNumber', 'PointID']);
    const stationId = rawName ? sanitizeStationId(rawName) : undefined;
    const xmlId = extractXmlAttribute(block, ['ID', 'Id']);
    const gridBlock = extractXmlBlock(block, ['Grid']) ?? block;
    const northM = extractXmlNumber(gridBlock, ['North', 'Northing', 'GridNorth']);
    const eastM = extractXmlNumber(gridBlock, ['East', 'Easting', 'GridEast']);
    const elevationM = extractXmlNumber(gridBlock, [
      'Elevation',
      'OrthometricHeight',
      'ReducedLevel',
      'Height',
    ]);
    const latitudeDeg = extractXmlNumber(gridBlock, ['Latitude', 'Lat']);
    const longitudeDeg = extractXmlNumber(gridBlock, ['Longitude', 'Lon', 'Long']);
    const ellipsoidHeightM = extractXmlNumber(gridBlock, ['EllipsoidHeight', 'EllHeight']);
    const description = extractXmlText(block, ['Code', 'Description', 'Descriptor', 'FeatureCode']);

    if (!stationId) return;

    let candidate: ImportedControlStationRecord | null = null;
    if (latitudeDeg != null && longitudeDeg != null) {
      candidate = {
        kind: 'control-station',
        coordinateMode: 'geodetic',
        stationId,
        latitudeDeg,
        longitudeDeg,
        heightDatum: ellipsoidHeightM != null ? 'ellipsoid' : 'orthometric',
        heightM: ellipsoidHeightM ?? elevationM ?? 0,
        description,
        sourceLine,
        sourceCode: 'Point',
      };
    } else if (northM != null && eastM != null) {
      candidate = {
        kind: 'control-station',
        coordinateMode: 'local',
        stationId,
        northM,
        eastM,
        heightM: elevationM,
        description,
        sourceLine,
        sourceCode: 'Point',
      };
    }

    if (!candidate) return;

    const existing = stationMap.get(stationId);
    if (existing) {
      trace.push({
        level: 'warning',
        sourceLine,
        sourceCode: 'Point',
        message: `Duplicate JobXML point ${stationId}; keeping the richer coordinate record.`,
      });
    }
    stationMap.set(stationId, choosePreferredStation(existing, candidate));
    registerJobXmlPointReference(pointRefLookup, xmlId, stationId);
  });

  matchXmlBlocks(input, 'StationRecord').forEach(({ block }) => {
    const xmlId = extractXmlAttribute(block, ['ID', 'Id']);
    if (!xmlId) return;
    const occupyId = resolveJobXmlPointFromBlock(
      block,
      ['PointID', 'PointRecordID', 'StationPointID', 'OccupyPointID', 'SetupPointID', 'StationID'],
      ['Name', 'PointName', 'PointNumber', 'StationName', 'OccupyName'],
      pointRefLookup,
      stationMap,
    );
    const hiM = extractXmlNumber(block, [
      'InstrumentHeight',
      'TheodoliteHeight',
      'HI',
      'IH',
      'InstHeight',
    ]);
    const backsightRecordRef = extractXmlText(block, ['BackBearingID', 'BackBearingRecordID']);
    const atmosphereRef = extractXmlText(block, ['AtmosphereID']);
    const setupType = collapseWhitespace(extractXmlText(block, ['StationType']) ?? '');
    const backsightId = resolveJobXmlPointFromBlock(
      block,
      ['BackSightPointID', 'BacksightPointID', 'BackBearingPointID'],
      ['BacksightName', 'BackSightName', 'BackSight'],
      pointRefLookup,
      stationMap,
    );
    setupContexts.set(xmlId, {
      occupyId,
      backsightId,
      backsightRecordRef,
      hiM,
      setupType,
      atmosphereRef,
    });
  });

  matchXmlBlocks(input, 'BackBearingRecord').forEach(({ block }) => {
    const xmlId = extractXmlAttribute(block, ['ID', 'Id']);
    if (!xmlId) return;
    const stationRecordRef = extractXmlText(block, ['StationRecordID']);
    const setupContext = stationRecordRef ? setupContexts.get(stationRecordRef) : undefined;
    const occupyId =
      setupContext?.occupyId ??
      resolveJobXmlPointFromBlock(
        block,
        ['StationRecordID'],
        ['Station'],
        pointRefLookup,
        stationMap,
      );
    const stationId = resolveJobXmlPointFromBlock(
      block,
      ['PointID', 'PointRecordID', 'BackSightPointID', 'BacksightPointID', 'TargetPointID'],
      ['Name', 'PointName', 'PointNumber', 'BacksightName', 'BackSightName', 'BackSight'],
      pointRefLookup,
      stationMap,
    );
    const face1HorizontalCircleDeg = extractXmlNumber(block, ['Face1HorizontalCircle']);
    const face2HorizontalCircleDeg = extractXmlNumber(block, ['Face2HorizontalCircle']);
    const horizontalCircleDeg =
      extractXmlNumber(block, ['HorizontalCircle', 'Hz']) ?? face1HorizontalCircleDeg;
    const orientationCorrectionDeg = extractXmlNumber(block, ['OrientationCorrection']);
    const explicitBearingDeg = extractXmlNumber(block, ['Azimuth', 'Bearing', 'BackBearing']);
    const bearingFromCoords = computeLocalAzimuthDeg(
      occupyId ? stationMap.get(occupyId) : undefined,
      stationId ? stationMap.get(stationId) : undefined,
    );
    const derivedBearingDeg =
      explicitBearingDeg ??
      bearingFromCoords ??
      (orientationCorrectionDeg != null && face1HorizontalCircleDeg != null
        ? normalizeAngleDeg(face1HorizontalCircleDeg + orientationCorrectionDeg)
        : orientationCorrectionDeg != null && face2HorizontalCircleDeg != null
          ? normalizeAngleDeg(face2HorizontalCircleDeg + orientationCorrectionDeg + 180)
          : orientationCorrectionDeg != null && horizontalCircleDeg != null
            ? normalizeAngleDeg(horizontalCircleDeg + orientationCorrectionDeg)
            : undefined);
    backsightContexts.set(xmlId, {
      stationId,
      horizontalCircleDeg,
      face1HorizontalCircleDeg,
      face2HorizontalCircleDeg,
      bearingDeg: derivedBearingDeg,
    });
  });

  matchXmlBlocks(input, 'TargetRecord').forEach(({ block }) => {
    const xmlId = extractXmlAttribute(block, ['ID', 'Id']);
    if (!xmlId) return;
    const stationId = resolveJobXmlPointFromBlock(
      block,
      ['PointID', 'PointRecordID', 'TargetPointID'],
      ['Name', 'PointName', 'PointNumber', 'TargetName'],
      pointRefLookup,
      stationMap,
    );
    const htM = extractXmlNumber(block, ['TargetHeight', 'PrismHeight', 'RodHeight', 'HT']);
    const prismConstantM = extractXmlNumber(block, ['PrismConstant']);
    const code = stationId ? stationMap.get(stationId)?.description : undefined;
    targetContexts.set(xmlId, { stationId, htM, prismConstantM, code });
    if (stationId) registerJobXmlPointReference(pointRefLookup, xmlId, stationId);
  });

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
        ? normalizeAngleDeg(rawHorizontalCircleDeg - backsightCircleDeg)
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
        ? normalizeAngleDeg(explicitAngleDeg)
        : rawHorizontalCircleDeg != null
          ? angleMode === 'raw'
            ? normalizeAngleDeg(rawHorizontalCircleDeg)
            : backsightCircleDeg != null
              ? normalizeAngleDeg(rawHorizontalCircleDeg - backsightCircleDeg)
              : undefined
          : undefined;
    const derivedBearingDeg =
      explicitBearingDeg != null
        ? normalizeAngleDeg(explicitBearingDeg)
        : isMta && rawHorizontalCircleDeg != null && backsightContext?.bearingDeg != null
          ? normalizeAngleDeg(backsightContext.bearingDeg + rawHorizontalCircleDeg)
          : rawHorizontalCircleDeg != null &&
              backsightCircleDeg != null &&
              backsightContext?.bearingDeg != null
            ? normalizeAngleDeg(
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

    if (occupyId && backsightId && targetId && derivedAngleDeg != null) {
      if (distanceM != null) {
        observations.push({
          kind: 'measurement',
          atId: occupyId,
          fromId: backsightId,
          toId: targetId,
          angleDeg: derivedAngleDeg,
          distanceM,
          verticalMode: zenithDeg != null ? 'zenith' : deltaHM != null ? 'delta-h' : undefined,
          verticalValue: zenithDeg ?? deltaHM,
          hiM,
          htM,
          description: descriptionCode || targetContext?.code,
          sourceLine,
          sourceCode: 'PointRecord',
          note: 'converted to M',
          sourceMeta,
          jobXml,
        });
      } else {
        observations.push({
          kind: 'angle',
          atId: occupyId,
          fromId: backsightId,
          toId: targetId,
          angleDeg: derivedAngleDeg,
          description: descriptionCode || targetContext?.code,
          sourceLine,
          sourceCode: 'PointRecord',
          note: 'converted to A',
          sourceMeta,
          jobXml,
        });
        if (zenithDeg != null || deltaHM != null) {
          observations.push({
            kind: 'vertical',
            fromId: occupyId,
            toId: targetId,
            verticalMode: zenithDeg != null ? 'zenith' : 'delta-h',
            verticalValue: zenithDeg ?? deltaHM ?? 0,
            hiM,
            htM,
            description: descriptionCode || targetContext?.code,
            sourceLine,
            sourceCode: 'PointRecord',
            note: 'converted to V',
            sourceMeta,
            jobXml,
          });
        }
      }
      return;
    }

    if (occupyId && targetId && derivedBearingDeg != null) {
      observations.push({
        kind: 'bearing',
        fromId: occupyId,
        toId: targetId,
        bearingDeg: derivedBearingDeg,
        description: descriptionCode || targetContext?.code,
        sourceLine,
        sourceCode: 'PointRecord',
        note: 'converted to B',
        sourceMeta,
        jobXml,
      });
      if (distanceM != null && (zenithDeg != null || deltaHM != null)) {
        observations.push({
          kind: 'distance-vertical',
          fromId: occupyId,
          toId: targetId,
          distanceM,
          verticalMode: zenithDeg != null ? 'zenith' : 'delta-h',
          verticalValue: zenithDeg ?? deltaHM ?? 0,
          hiM,
          htM,
          description: descriptionCode || targetContext?.code,
          sourceLine,
          sourceCode: 'PointRecord',
          note: 'converted to DV',
          sourceMeta,
          jobXml,
        });
      } else if (distanceM != null) {
        observations.push({
          kind: 'distance',
          fromId: occupyId,
          toId: targetId,
          distanceM,
          hiM,
          htM,
          description: descriptionCode || targetContext?.code,
          sourceLine,
          sourceCode: 'PointRecord',
          note: 'converted to D',
          sourceMeta,
          jobXml,
        });
      } else if (zenithDeg != null || deltaHM != null) {
        observations.push({
          kind: 'vertical',
          fromId: occupyId,
          toId: targetId,
          verticalMode: zenithDeg != null ? 'zenith' : 'delta-h',
          verticalValue: zenithDeg ?? deltaHM ?? 0,
          hiM,
          htM,
          description: descriptionCode || targetContext?.code,
          sourceLine,
          sourceCode: 'PointRecord',
          note: 'converted to V',
          sourceMeta,
          jobXml,
        });
      }
      return;
    }

    if (occupyId && targetId && distanceM != null) {
      observations.push({
        kind: zenithDeg != null || deltaHM != null ? 'distance-vertical' : 'distance',
        fromId: occupyId,
        toId: targetId,
        distanceM,
        ...(zenithDeg != null || deltaHM != null
          ? {
              verticalMode: zenithDeg != null ? 'zenith' : 'delta-h',
              verticalValue: zenithDeg ?? deltaHM ?? 0,
            }
          : {}),
        hiM,
        htM,
        description: descriptionCode || targetContext?.code,
        sourceLine,
        sourceCode: 'PointRecord',
        note: zenithDeg != null || deltaHM != null ? 'converted to DV' : 'converted to D',
        sourceMeta,
        jobXml,
      } as ImportedDistanceObservationRecord | ImportedDistanceVerticalObservationRecord);
      trace.push({
        level: 'warning',
        sourceLine,
        sourceCode: 'PointRecord',
        message: `JobXML measurement-style point ${targetId} had no usable angle or azimuth; imported as distance${zenithDeg != null || deltaHM != null ? '/vertical' : ''} only.`,
      });
      return;
    }

    trace.push({
      level: 'warning',
      sourceLine,
      sourceCode: 'PointRecord',
      message: `JobXML measurement-style point ${targetId ?? fallbackTargetId ?? 'UNKNOWN'} was not converted because the station, target, or direction context could not be resolved.`,
    });
  });

  const controlStations = [...stationMap.values()];
  if (controlStations.length === 0 && observations.length === 0) return null;

  const detailLines = [
    `Imported ${plural(controlStations.length, 'point')} and ${plural(observations.length, 'observation')} from ${fileLabel} into normalized WebNet input.`,
  ];
  const traceDetail = buildTraceDetailLine(trace);
  if (traceDetail) detailLines.push(traceDetail);

  return {
    importerId: 'jobxml',
    formatLabel: 'JobXML field data',
    summary: `Imported JobXML dataset with ${plural(controlStations.length, 'point')} and ${plural(observations.length, 'observation')}`,
    notice: {
      title: 'Imported JobXML dataset',
      detailLines,
    },
    comments: [
      'Imported from JobXML dataset',
      `Source file: ${fileLabel}`,
      `Imported points: ${controlStations.length}`,
      `Imported observations: ${observations.length}`,
    ],
    controlStations,
    observations,
    trace,
  };
};

export const jobXmlImporter: ExternalInputImporter = {
  id: 'jobxml',
  formatLabel: 'JobXML field data',
  detect: (input, sourceName) => detectJobXml(input, sourceName),
  parse: (input, sourceName, options) => parseJobXml(input, sourceName, options),
};
