import type {
  ExternalImportParseOptions,
  ExternalInputImporter,
  ImportedControlStationRecord,
  ImportedDataset,
  ImportedObservationRecord,
  ImportedTraceEntry,
} from '../importers';
import {
  buildTraceDetailLine,
  buildLineNumberResolver,
  collapseWhitespace,
  extractXmlAttribute,
  extractXmlNumber,
  extractXmlText,
  matchXmlBlocks,
  plural,
  sanitizeStationId,
  sourceLeaf,
} from './shared';
import {
  collectJobXmlRoundEvents,
  computeLocalAzimuthDeg,
  normalizeJobXmlAngleDeg,
  registerJobXmlPointReference,
  resolveJobXmlPointFromBlock,
} from './jobXmlImporter.helpers';
import { convertJobXmlMeasurements } from './jobXmlImporter.measurements';
import { collectJobXmlPointRecords } from './jobXmlImporter.points';
import type {
  JobXmlAtmosphereContext,
  JobXmlBacksightContext,
  JobXmlSetupContext,
  JobXmlTargetContext,
} from './jobXmlImporter.types';

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

  collectJobXmlPointRecords({
    measurementBlocks,
    pointBlocks,
    pointRefLookup,
    reducedPointBlocks,
    resolveSourceLine,
    stationMap,
    trace,
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
        ? normalizeJobXmlAngleDeg(face1HorizontalCircleDeg + orientationCorrectionDeg)
        : orientationCorrectionDeg != null && face2HorizontalCircleDeg != null
          ? normalizeJobXmlAngleDeg(face2HorizontalCircleDeg + orientationCorrectionDeg + 180)
          : orientationCorrectionDeg != null && horizontalCircleDeg != null
            ? normalizeJobXmlAngleDeg(horizontalCircleDeg + orientationCorrectionDeg)
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

  convertJobXmlMeasurements({
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
