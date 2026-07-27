import type {
  ImportedControlStationRecord,
  ImportedTraceEntry,
} from '../importers';
import {
  choosePreferredStation,
  extractXmlAttribute,
  extractXmlBlock,
  extractXmlNumber,
  extractXmlText,
  hasXmlTag,
  sanitizeStationId,
} from './shared';
import { registerJobXmlPointReference } from './jobXmlImporter.helpers';

interface CollectJobXmlPointRecordsArgs {
  measurementBlocks: { block: string; index: number }[];
  pointBlocks: { block: string; index: number }[];
  pointRefLookup: Map<string, string>;
  reducedPointBlocks: { block: string; index: number }[];
  resolveSourceLine: (_index: number) => number;
  stationMap: Map<string, ImportedControlStationRecord>;
  trace: ImportedTraceEntry[];
}

export const collectJobXmlPointRecords = ({
  measurementBlocks,
  pointBlocks,
  pointRefLookup,
  reducedPointBlocks,
  resolveSourceLine,
  stationMap,
  trace,
}: CollectJobXmlPointRecordsArgs): void => {
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
};
