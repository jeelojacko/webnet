import { dbxImporter } from './importers/dbxImporter';
import { fieldGeniusImporter } from './importers/fieldGeniusImporter';
import { jobXmlImporter } from './importers/jobXmlImporter';
import { opusImporter } from './importers/opusImporter';
import { carlsonImporter, tdsImporter } from './importers/rw5Importer';
import { trimbleSurveyReportImporter } from './importers/surveyReportImporter';
import { convertImportedDatasetToWebNetInput, enrichImportedDatasetDirectionFaces } from './importers/shared';

export interface OpusCovarianceSummary {
  sigmaNorthM?: number;
  sigmaEastM?: number;
  sigmaHeightM?: number;
  corrEN?: number;
  source: 'report-diagonal' | 'report-correlation' | 'unavailable';
}

export interface OpusImportMetadata {
  sourceFile?: string;
  reportFileName?: string;
  software?: string;
  solutionType: 'opus' | 'opus-rs';
  referenceFrame?: string;
  referenceEpoch?: string;
  geoidModel?: string;
}

export interface OpusImportResult {
  stationId: string;
  latitudeDeg: number;
  longitudeDeg: number;
  ellipsoidHeightM?: number;
  orthometricHeightM?: number;
  sigmaNorthM?: number;
  sigmaEastM?: number;
  sigmaEllipsoidHeightM?: number;
  sigmaOrthometricHeightM?: number;
  covariance: OpusCovarianceSummary;
  metadata: OpusImportMetadata;
}

export interface ImportedInputNotice {
  title: string;
  detailLines: string[];
}

export interface ImportedTraceEntry {
  level: 'info' | 'warning' | 'error';
  message: string;
  sourceLine?: number;
  sourceCode?: string;
  raw?: string;
}

export interface ImportedSourceMetadata {
  method?: string;
  classification?: string;
  face?: string;
  faceSource?: 'metadata' | 'zenith';
  setupType?: string;
}

export interface ImportedJobXmlExtras {
  stationRecordRef?: string;
  backBearingRecordRef?: string;
  targetRecordRef?: string;
  atmosphereRecordRef?: string;
  round?: number;
  observationOrder?: number;
  directionSetId?: string;
  isDirectReading?: boolean;
  isMta?: boolean;
  isBacksight?: boolean;
  rawHorizontalCircleDeg?: number;
  reducedAngleDeg?: number;
  backsightCircleDeg?: number;
  backsightFace1CircleDeg?: number;
  backsightFace2CircleDeg?: number;
  rawVerticalCircleDeg?: number;
  rawEdmDistanceM?: number;
  correctedSlopeDistanceM?: number;
  prismConstantM?: number;
  ppm?: number;
  pointCode?: string;
  targetCode?: string;
  observationHiM?: number;
  setupHiM?: number;
  effectiveHiM?: number;
  hiSource?: 'observation' | 'setup';
  observationHtM?: number;
  targetHtM?: number;
  effectiveHtM?: number;
  htSource?: 'observation' | 'target';
}

export interface ImportedRecordBase {
  sourceLine?: number;
  sourceCode?: string;
  description?: string;
  note?: string;
  importSourceKey?: string;
  importSourceName?: string;
  sourceMeta?: ImportedSourceMetadata;
  jobXml?: ImportedJobXmlExtras;
}

export interface ImportedControlStationRecord extends ImportedRecordBase {
  kind: 'control-station';
  stationId: string;
  coordinateMode: 'geodetic' | 'local';
  northM?: number;
  eastM?: number;
  latitudeDeg?: number;
  longitudeDeg?: number;
  heightDatum?: 'ellipsoid' | 'orthometric';
  heightM?: number;
  sigmaNorthM?: number;
  sigmaEastM?: number;
  sigmaHeightM?: number;
  corrEN?: number;
}

export interface ImportedGnssVectorRecord extends ImportedRecordBase {
  kind: 'gnss-vector';
  fromId: string;
  toId: string;
  deltaEastM: number;
  deltaNorthM: number;
  deltaHeightM?: number;
  sigmaEastM?: number;
  sigmaNorthM?: number;
  sigmaHeightM?: number;
  corrEN?: number;
  gpsMode?: 'network' | 'sideshot';
}

export interface ImportedDistanceObservationRecord extends ImportedRecordBase {
  kind: 'distance';
  fromId: string;
  toId: string;
  distanceM: number;
  hiM?: number;
  htM?: number;
}

export interface ImportedDistanceVerticalObservationRecord extends ImportedRecordBase {
  kind: 'distance-vertical';
  fromId: string;
  toId: string;
  distanceM: number;
  verticalMode: 'zenith' | 'delta-h';
  verticalValue: number;
  hiM?: number;
  htM?: number;
}

export interface ImportedVerticalObservationRecord extends ImportedRecordBase {
  kind: 'vertical';
  fromId: string;
  toId: string;
  verticalMode: 'zenith' | 'delta-h';
  verticalValue: number;
  hiM?: number;
  htM?: number;
}

export interface ImportedBearingObservationRecord extends ImportedRecordBase {
  kind: 'bearing';
  fromId: string;
  toId: string;
  bearingDeg: number;
}

export interface ImportedAngleObservationRecord extends ImportedRecordBase {
  kind: 'angle';
  atId: string;
  fromId: string;
  toId: string;
  angleDeg: number;
}

export interface ImportedMeasurementObservationRecord extends ImportedRecordBase {
  kind: 'measurement';
  atId: string;
  fromId: string;
  toId: string;
  angleDeg: number;
  distanceM: number;
  verticalMode?: 'zenith' | 'delta-h';
  verticalValue?: number;
  hiM?: number;
  htM?: number;
}

export type ImportedObservationRecord =
  | ImportedGnssVectorRecord
  | ImportedDistanceObservationRecord
  | ImportedDistanceVerticalObservationRecord
  | ImportedVerticalObservationRecord
  | ImportedBearingObservationRecord
  | ImportedAngleObservationRecord
  | ImportedMeasurementObservationRecord;

export interface ImportedDataset {
  importerId: string;
  formatLabel: string;
  summary: string;
  notice: ImportedInputNotice;
  comments: string[];
  controlStations: ImportedControlStationRecord[];
  observations: ImportedObservationRecord[];
  trace: ImportedTraceEntry[];
  legacy?: {
    opus?: OpusImportResult;
  };
}

export interface ImportedInputResult {
  detected: boolean;
  format: 'webnet' | 'external-import';
  importerId?: string;
  text: string;
  summary?: string;
  notice?: ImportedInputNotice;
  dataset?: ImportedDataset;
  opus?: OpusImportResult;
}

export type ExternalImportAngleMode = 'raw' | 'reduced';

export interface ExternalImportParseOptions {
  angleMode?: ExternalImportAngleMode;
}

export interface ExternalInputImporter {
  id: string;
  formatLabel: string;
  detect: (_input: string, _sourceName?: string) => boolean;
  parse: (
    _input: string,
    _sourceName?: string,
    _options?: ExternalImportParseOptions,
  ) => ImportedDataset | null;
}

const FIELDGENIUS_RECORD_CODES = new Set([
  'OC',
  'LS',
  'STN',
  'BK',
  'BS',
  'SS',
  'TR',
  'FR',
  'FS',
  'SP',
  'PT',
  'GS',
  'CV',
]);

export {
  appendImportedObservationBundle,
  buildLineNumberResolver,
  buildOpusImportedDataset,
  buildTraceDetailLine,
  collapseWhitespace,
  convertImportedDatasetToWebNetInput,
  decodeXmlEntities,
  deriveStationId,
  enrichImportedDatasetDirectionFaces,
  extractFirstLine,
  extractHtmlTables,
  extractLineValue,
  extractNumbers,
  extractXmlAttribute,
  extractXmlBlock,
  extractXmlNumber,
  extractXmlText,
  formatNumber,
  hasXmlTag,
  matchXmlBlocks,
  normalizeImportedFace,
  parseCorrelationLine,
  parseDmsAngleDegrees,
  parseHeightLine,
  parseLatitudeLine,
  parseLongitudeLine,
  parseQuadrantBearingDegrees,
  plural,
  sanitizeStationId,
  sourceLeaf,
  stripHtmlTags,
  tableRowPairsToMap,
  takeLeadingLines,
  choosePreferredStation,
} from './importers/shared';

export { convertOpusReportToWebNetInput, detectOpusReport, opusImporter, parseOpusReport } from './importers/opusImporter';
export { detectJobXml, jobXmlImporter, parseJobXml } from './importers/jobXmlImporter';
export { detectCarlsonRw5, detectTdsRaw, parseRw5Dataset } from './importers/rw5Importer';
export { detectFieldGeniusRaw, fieldGeniusImporter, parseFieldGenius } from './importers/fieldGeniusImporter';
export { detectTrimbleSurveyReport, parseTrimbleSurveyReport, trimbleSurveyReportImporter } from './importers/surveyReportImporter';
export { dbxImporter, detectDbxTextExport, parseDbxTextExport } from './importers/dbxImporter';

const REGISTERED_IMPORTERS: ExternalInputImporter[] = [
  dbxImporter,
  jobXmlImporter,
  trimbleSurveyReportImporter,
  carlsonImporter,
  tdsImporter,
  fieldGeniusImporter,
  opusImporter,
];

export const getExternalImporters = (): ExternalInputImporter[] => [...REGISTERED_IMPORTERS];

export const importExternalInput = (
  input: string,
  sourceName?: string,
  options: ExternalImportParseOptions = {},
): ImportedInputResult => {
  const importer = REGISTERED_IMPORTERS.find((candidate) => candidate.detect(input, sourceName));
  if (!importer) {
    return {
      detected: false,
      format: 'webnet',
      text: input,
    };
  }

  const parsedDataset = importer.parse(input, sourceName, options);
  if (!parsedDataset) {
    return {
      detected: false,
      format: 'webnet',
      text: input,
    };
  }
  const dataset =
    parsedDataset.importerId === 'jobxml' || parsedDataset.importerId === 'trimble-survey-report'
      ? enrichImportedDatasetDirectionFaces(parsedDataset)
      : parsedDataset;

  return {
    detected: true,
    format: 'external-import',
    importerId: dataset.importerId,
    text: convertImportedDatasetToWebNetInput(dataset),
    summary: dataset.summary,
    notice: dataset.notice,
    dataset,
    opus: dataset.legacy?.opus,
  };
};
