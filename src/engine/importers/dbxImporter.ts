import type {
  ExternalInputImporter,
  ImportedControlStationRecord,
  ImportedDataset,
  ImportedObservationRecord,
  ImportedTraceEntry,
} from '../importers';
import {
  appendImportedObservationBundle,
  buildLineNumberResolver,
  buildTraceDetailLine,
  choosePreferredStation,
  extractXmlAttribute,
  extractXmlNumber,
  extractXmlText,
  matchXmlBlocks,
  parseQuadrantBearingDegrees,
  plural,
  sanitizeStationId,
  sourceLeaf,
} from '../importers';

interface DbxSetupContext {
  occupyId?: string;
  backsightId?: string;
  hiM?: number;
}

export const detectDbxTextExport = (input: string, sourceName?: string): boolean => {
  const fileName = sourceName?.toLowerCase() ?? '';
  const hasDbxRoot =
    /<DBX(?:Survey|Export|FieldBook)?\b/i.test(input) ||
    /<LeicaDBX\b/i.test(input) ||
    /<SurveyDBX\b/i.test(input);
  const hasSurveyTags =
    /<(?:Point|Setup|StationSetup|Observation|Shot)\b/i.test(input) ||
    /<(?:Northing|Easting|Latitude|Longitude)\b/i.test(input);
  return (fileName.endsWith('.dbx') || hasDbxRoot) && hasSurveyTags;
};

export const parseDbxTextExport = (input: string, sourceName?: string): ImportedDataset | null => {
  if (!detectDbxTextExport(input, sourceName)) return null;

  const resolveSourceLine = buildLineNumberResolver(input);
  const trace: ImportedTraceEntry[] = [];
  const stationMap = new Map<string, ImportedControlStationRecord>();
  const setupContexts = new Map<string, DbxSetupContext>();
  const observations: ImportedObservationRecord[] = [];
  const fileLabel = sourceLeaf(sourceName);

  matchXmlBlocks(input, 'Point').forEach(({ block, index }) => {
    const sourceLine = resolveSourceLine(index);
    const rawName =
      extractXmlAttribute(block, ['name', 'pointName', 'id']) ??
      extractXmlText(block, ['Name', 'PointName', 'PointID', 'ID']);
    const stationId = rawName ? sanitizeStationId(rawName) : undefined;
    if (!stationId) {
      trace.push({ level: 'warning', sourceLine, sourceCode: 'Point', message: 'Skipped DBX point without a usable point name.' });
      return;
    }

    const northM = extractXmlNumber(block, ['Northing', 'North', 'GridNorth']);
    const eastM = extractXmlNumber(block, ['Easting', 'East', 'GridEast']);
    const elevationM = extractXmlNumber(block, ['Elevation', 'Height', 'OrthometricHeight']);
    const latitudeDeg = extractXmlNumber(block, ['Latitude', 'Lat']);
    const longitudeDeg = extractXmlNumber(block, ['Longitude', 'Lon', 'Long']);
    const ellipsoidHeightM = extractXmlNumber(block, ['EllipsoidHeight', 'EllHeight']);
    const sigmaNorthM = extractXmlNumber(block, ['SigmaNorth', 'StdDevNorth']);
    const sigmaEastM = extractXmlNumber(block, ['SigmaEast', 'StdDevEast']);
    const sigmaHeightM = extractXmlNumber(block, ['SigmaHeight', 'StdDevHeight']);
    const corrEN = extractXmlNumber(block, ['CorrelationEN', 'CorrEN']);
    const description = extractXmlText(block, ['Code', 'Description', 'FeatureCode']);

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
        sigmaNorthM,
        sigmaEastM,
        sigmaHeightM,
        corrEN,
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
        heightM: elevationM ?? 0,
        sigmaNorthM,
        sigmaEastM,
        sigmaHeightM,
        corrEN,
        description,
        sourceLine,
        sourceCode: 'Point',
      };
    }

    if (!candidate) {
      trace.push({
        level: 'warning',
        sourceLine,
        sourceCode: 'Point',
        message: `DBX point ${stationId} was skipped because no supported coordinate payload was found.`,
      });
      return;
    }

    const existing = stationMap.get(stationId);
    if (existing) {
      trace.push({
        level: 'warning',
        sourceLine,
        sourceCode: 'Point',
        message: `Duplicate DBX point ${stationId}; keeping the richer coordinate record.`,
      });
    }
    stationMap.set(stationId, choosePreferredStation(existing, candidate));
  });

  const setupBlocks = [...matchXmlBlocks(input, 'Setup'), ...matchXmlBlocks(input, 'StationSetup')];
  setupBlocks.forEach(({ block }) => {
    const xmlId = extractXmlAttribute(block, ['id', 'ID', 'setupId']);
    if (!xmlId) return;
    const occupyId = extractXmlText(block, ['OccupyPoint', 'OccupyPointID', 'SetupPoint', 'FromPoint']);
    const backsightId = extractXmlText(block, ['BacksightPoint', 'BacksightPointID', 'BackPoint']);
    const hiM = extractXmlNumber(block, ['InstrumentHeight', 'HI', 'InstHeight']);
    setupContexts.set(xmlId, {
      occupyId: occupyId ? sanitizeStationId(occupyId) : undefined,
      backsightId: backsightId ? sanitizeStationId(backsightId) : undefined,
      hiM,
    });
  });

  const observationBlocks = [
    ...matchXmlBlocks(input, 'Observation'),
    ...matchXmlBlocks(input, 'ObservationRecord'),
    ...matchXmlBlocks(input, 'Shot'),
  ];

  observationBlocks.forEach(({ block, index }) => {
    const sourceLine = resolveSourceLine(index);
    const setupRef =
      extractXmlAttribute(block, ['setupId', 'SetupID']) ?? extractXmlText(block, ['SetupID']);
    const setupContext = setupRef ? setupContexts.get(setupRef) : undefined;
    const occupyRaw =
      extractXmlText(block, ['OccupyPoint', 'SetupPoint', 'FromPoint', 'StationPoint']) ??
      setupContext?.occupyId;
    const targetRaw = extractXmlText(block, ['TargetPoint', 'ToPoint', 'PointName', 'PointID', 'TargetID']);
    const backsightRaw =
      extractXmlText(block, ['BacksightPoint', 'BackPoint', 'BacksightID']) ??
      setupContext?.backsightId;
    const occupyId = occupyRaw ? sanitizeStationId(occupyRaw) : undefined;
    const targetId = targetRaw ? sanitizeStationId(targetRaw) : undefined;
    const backsightId = backsightRaw ? sanitizeStationId(backsightRaw) : undefined;

    if (!occupyId || !targetId) {
      trace.push({
        level: 'warning',
        sourceLine,
        sourceCode: 'Observation',
        message: 'DBX observation was skipped because occupy or target point could not be resolved.',
      });
      return;
    }

    const hiM = extractXmlNumber(block, ['InstrumentHeight', 'HI', 'InstHeight']) ?? setupContext?.hiM;
    const htM = extractXmlNumber(block, ['TargetHeight', 'PrismHeight', 'HT', 'RodHeight']);
    const angleDeg = extractXmlNumber(block, ['HorizontalAngle', 'TurnAngle']);
    const bearingDeg =
      extractXmlNumber(block, ['Azimuth']) ??
      parseQuadrantBearingDegrees(extractXmlText(block, ['Bearing']) ?? '');
    const slopeDistanceM = extractXmlNumber(block, ['SlopeDistance', 'Distance']);
    const horizontalDistanceM = extractXmlNumber(block, ['HorizontalDistance']);
    const zenithDeg = extractXmlNumber(block, ['Zenith', 'ZenithAngle', 'VerticalCircle']);
    const verticalAngleDeg = extractXmlNumber(block, ['VerticalAngle']);
    const deltaHM = extractXmlNumber(block, ['DeltaHeight', 'VerticalDistance', 'DeltaH']);

    appendImportedObservationBundle({
      observations,
      trace,
      sourceLine,
      sourceCode: 'Observation',
      occupyId,
      targetId,
      backsightId,
      angleDeg,
      bearingDeg,
      distanceM: slopeDistanceM ?? horizontalDistanceM,
      distanceMode:
        slopeDistanceM != null ? 'slope' : horizontalDistanceM != null ? 'horizontal' : undefined,
      verticalMode:
        zenithDeg != null || verticalAngleDeg != null
          ? 'zenith'
          : deltaHM != null
            ? 'delta-h'
            : undefined,
      verticalValue:
        zenithDeg != null ? zenithDeg : verticalAngleDeg != null ? 90 - verticalAngleDeg : deltaHM,
      hiM,
      htM,
      tracePrefix: 'DBX observation',
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
    importerId: 'dbx-export',
    formatLabel: 'DBX text export',
    summary: `Imported DBX dataset with ${plural(controlStations.length, 'point')} and ${plural(observations.length, 'observation')}`,
    notice: {
      title: 'Imported DBX dataset',
      detailLines,
    },
    comments: [
      'Imported from DBX text/XML export',
      `Source file: ${fileLabel}`,
      `Imported points: ${controlStations.length}`,
      `Imported observations: ${observations.length}`,
    ],
    controlStations,
    observations,
    trace,
  };
};

export const dbxImporter: ExternalInputImporter = {
  id: 'dbx-export',
  formatLabel: 'DBX text export',
  detect: (input, sourceName) => detectDbxTextExport(input, sourceName),
  parse: (input, sourceName) => parseDbxTextExport(input, sourceName),
};
