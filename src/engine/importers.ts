import { RAD_TO_DEG, dmsToRad } from './angles';
import {
  serializeImportedControlStationRecord,
  serializeImportedObservationRecord,
} from './importedRecordSerialization';
import { dbxImporter } from './importers/dbxImporter';
import { fieldGeniusImporter } from './importers/fieldGeniusImporter';
import { jobXmlImporter } from './importers/jobXmlImporter';
import { opusImporter } from './importers/opusImporter';
import { carlsonImporter, tdsImporter } from './importers/rw5Importer';
import { trimbleSurveyReportImporter } from './importers/surveyReportImporter';

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

export const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

export const extractLineValue = (input: string, label: string): string | undefined => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = input.match(new RegExp(`^\\s*${escaped}\\s*:\\s*(.+)$`, 'im'));
  return match?.[1] ? collapseWhitespace(match[1]) : undefined;
};

export const extractFirstLine = (
  input: string,
  predicate: (_line: string) => boolean,
): string | undefined =>
  input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && predicate(line));

export const extractNumbers = (line: string): number[] =>
  [...line.matchAll(/[+-]?\d+(?:\.\d+)?/g)].map((match) => Number.parseFloat(match[0]));

const dmsToDecimal = (deg: number, min: number, sec: number, sign: number): number =>
  sign * (Math.abs(deg) + Math.abs(min) / 60 + Math.abs(sec) / 3600);

export const parseLatitudeLine = (line: string | undefined): { value: number; sigmaM?: number } | null => {
  if (!line) return null;
  const numbers = extractNumbers(line);
  if (numbers.length < 3) return null;
  const sign = /\bS\s*LAT\b/i.test(line) ? -1 : 1;
  return {
    value: dmsToDecimal(numbers[0], numbers[1] ?? 0, numbers[2] ?? 0, sign),
    sigmaM: numbers[3],
  };
};

export const parseLongitudeLine = (
  line: string | undefined,
): { value: number; sigmaM?: number } | null => {
  if (!line) return null;
  const numbers = extractNumbers(line);
  if (numbers.length < 3) return null;
  const sign = /\bW\s*LON\b/i.test(line) ? -1 : 1;
  return {
    value: dmsToDecimal(numbers[0], numbers[1] ?? 0, numbers[2] ?? 0, sign),
    sigmaM: numbers[3],
  };
};

export const parseHeightLine = (line: string | undefined): { value: number; sigmaM?: number } | null => {
  if (!line) return null;
  const numbers = extractNumbers(line);
  if (numbers.length < 1) return null;
  return {
    value: numbers[0],
    sigmaM: numbers[1],
  };
};

export const parseCorrelationLine = (line: string | undefined): number | undefined => {
  if (!line) return undefined;
  const numbers = [...line.matchAll(/[+-]?\d+(?:\.\d+)?/g)].map((match) =>
    Number.parseFloat(match[0]),
  );
  const value = numbers.find((entry) => Number.isFinite(entry) && Math.abs(entry) <= 1);
  if (!Number.isFinite(value as number)) return undefined;
  return Math.max(-0.999, Math.min(0.999, value as number));
};

export const sanitizeStationId = (value: string): string => {
  const sanitized = value
    .toUpperCase()
    .replace(/\.[A-Z0-9]+$/i, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return sanitized || 'IMPORT_STATION';
};

const fileStem = (value: string): string => {
  const normalized = value.replace(/\\/g, '/');
  const leaf = normalized.split('/').pop() ?? normalized;
  return leaf.replace(/\.[^.]+$/, '');
};

export const deriveStationId = (
  sourceFile: string | undefined,
  reportFileName: string | undefined,
): string => {
  const preferred = sourceFile
    ? fileStem(sourceFile)
    : reportFileName
      ? fileStem(reportFileName)
      : '';
  return sanitizeStationId(preferred);
};

export const formatNumber = (value: number, decimals: number): string => value.toFixed(decimals);

export const decodeXmlEntities = (value: string): string =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

type LineNumberResolver = (_index: number) => number;

export const buildLineNumberResolver = (input: string): LineNumberResolver => {
  const newlineIndices: number[] = [];
  for (let idx = input.indexOf('\n'); idx !== -1; idx = input.indexOf('\n', idx + 1)) {
    newlineIndices.push(idx);
  }
  return (index: number): number => {
    const clamped = Math.max(0, Math.min(index, input.length));
    let lo = 0;
    let hi = newlineIndices.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (newlineIndices[mid] < clamped) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };
};

export const takeLeadingLines = (input: string, maxLines: number): string[] => {
  if (maxLines <= 0) return [];
  const lines: string[] = [];
  let start = 0;
  while (start <= input.length && lines.length < maxLines) {
    let end = input.indexOf('\n', start);
    if (end === -1) end = input.length;
    let line = input.slice(start, end);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    lines.push(line);
    if (end === input.length) break;
    start = end + 1;
  }
  return lines;
};

export const plural = (count: number, label: string): string =>
  `${count} ${label}${count === 1 ? '' : 's'}`;

const buildTraceSummary = (trace: ImportedTraceEntry[]): { warnings: number; errors: number } => ({
  warnings: trace.filter((entry) => entry.level === 'warning').length,
  errors: trace.filter((entry) => entry.level === 'error').length,
});

export const sourceLeaf = (sourceName?: string): string =>
  sourceName?.replace(/\\/g, '/').split('/').pop() ?? 'imported file';

export const parseDmsAngleDegrees = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const normalized = trimmed
    .replace(/[°º]/g, '-')
    .replace(/'/g, '-')
    .replace(/"/g, '')
    .replace(/\s+/g, '');
  const parsed = dmsToRad(normalized) * RAD_TO_DEG;
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const parseQuadrantBearingDegrees = (value: string): number | undefined => {
  const trimmed = value.trim().toUpperCase().replace(/\s+/g, '');
  const quadrantMatch = trimmed.match(/^([NS])(.+)([EW])$/);
  if (!quadrantMatch) return parseDmsAngleDegrees(trimmed);
  const angleDeg = parseDmsAngleDegrees(quadrantMatch[2]);
  if (angleDeg == null) return undefined;
  if (quadrantMatch[1] === 'N' && quadrantMatch[3] === 'E') return angleDeg;
  if (quadrantMatch[1] === 'S' && quadrantMatch[3] === 'E') return 180 - angleDeg;
  if (quadrantMatch[1] === 'S' && quadrantMatch[3] === 'W') return 180 + angleDeg;
  if (quadrantMatch[1] === 'N' && quadrantMatch[3] === 'W') return 360 - angleDeg;
  return undefined;
};

export const normalizeImportedFace = (value: string | undefined): 'FACE1' | 'FACE2' | undefined => {
  if (!value) return undefined;
  const normalized = collapseWhitespace(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (normalized === 'FACE1' || normalized === 'F1' || normalized === '1') return 'FACE1';
  if (normalized === 'FACE2' || normalized === 'F2' || normalized === '2') return 'FACE2';
  return undefined;
};

const inferImportedFaceFromZenith = (
  zenithDeg: number | undefined,
  windowDeg = 45,
): 'FACE1' | 'FACE2' | undefined => {
  if (!Number.isFinite(zenithDeg as number)) return undefined;
  const wrapped = (((zenithDeg as number) % 360) + 360) % 360;
  const distanceTo = (center: number): number => {
    let delta = Math.abs(wrapped - center) % 360;
    if (delta > 180) delta = 360 - delta;
    return delta;
  };
  const f1Distance = distanceTo(90);
  const f2Distance = distanceTo(270);
  if (f1Distance <= windowDeg && f2Distance > windowDeg) return 'FACE1';
  if (f2Distance <= windowDeg && f1Distance > windowDeg) return 'FACE2';
  return undefined;
};

export const enrichImportedDatasetDirectionFaces = (
  dataset: ImportedDataset,
  options: { zenithWindowDeg?: number } = {},
): ImportedDataset => {
  const windowDeg = Math.max(1, options.zenithWindowDeg ?? 45);
  let changed = false;
  const observations = dataset.observations.map((observation) => {
    if (observation.kind !== 'measurement' && observation.kind !== 'angle') {
      return observation;
    }

    const existingFace = normalizeImportedFace(observation.sourceMeta?.face);
    if (existingFace) {
      if (
        observation.sourceMeta?.face === existingFace &&
        observation.sourceMeta?.faceSource === 'metadata'
      ) {
        return observation;
      }
      changed = true;
      return {
        ...observation,
        sourceMeta: {
          ...(observation.sourceMeta ?? {}),
          face: existingFace,
          faceSource: observation.sourceMeta?.faceSource ?? 'metadata',
        },
      } as ImportedObservationRecord;
    }

    const zenithDeg =
      observation.kind === 'measurement' &&
      observation.verticalMode === 'zenith' &&
      Number.isFinite(observation.verticalValue)
        ? observation.verticalValue
        : undefined;
    const inferredFace = inferImportedFaceFromZenith(zenithDeg, windowDeg);
    if (!inferredFace) return observation;

    changed = true;
    return {
      ...observation,
      sourceMeta: {
        ...(observation.sourceMeta ?? {}),
        face: inferredFace,
        faceSource: 'zenith',
      },
    } as ImportedObservationRecord;
  });

  if (!changed) return dataset;
  return {
    ...dataset,
    observations,
  };
};

const buildRecordComment = (record: ImportedRecordBase): string | null => {
  if (record.sourceLine == null && !record.sourceCode && !record.note) return null;
  const parts: string[] = ['Imported source'];
  if (record.sourceLine != null) parts.push(`line ${record.sourceLine}`);
  if (record.sourceCode) parts.push(`[${record.sourceCode}]`);
  if (record.note) parts.push(record.note);
  return `# ${parts.join(' ')}`;
};

export const convertImportedDatasetToWebNetInput = (dataset: ImportedDataset): string => {
  const lines: string[] = [];
  let currentDeltaMode: 'delta-h' | 'zenith' | null = null;
  let currentGpsMode: 'network' | 'sideshot' | null = null;

  dataset.comments.forEach((comment) => {
    lines.push(comment.startsWith('#') ? comment : `# ${comment}`);
  });
  lines.push('.UNITS M');
  if (dataset.controlStations.some((station) => station.coordinateMode === 'local')) {
    lines.push('.ORDER EN');
  }

  dataset.controlStations.forEach((station) => {
    const comment = buildRecordComment(station);
    if (comment) lines.push(comment);
    lines.push(serializeImportedControlStationRecord(station));
  });

  dataset.observations.forEach((observation) => {
    if (observation.kind === 'gnss-vector') {
      const desiredGpsMode = observation.gpsMode ?? 'network';
      if (currentGpsMode !== desiredGpsMode) {
        lines.push(`.GPS ${desiredGpsMode.toUpperCase()}`);
        currentGpsMode = desiredGpsMode;
      }
    }

    const comment = buildRecordComment(observation);
    if (comment) lines.push(comment);

    serializeImportedObservationRecord(observation).forEach((line) => {
      if (line === '.DELTA ON') {
        if (currentDeltaMode !== 'delta-h') {
          lines.push(line);
          currentDeltaMode = 'delta-h';
        }
        return;
      }
      if (line === '.DELTA OFF') {
        if (currentDeltaMode !== 'zenith') {
          lines.push(line);
          currentDeltaMode = 'zenith';
        }
        return;
      }
      lines.push(line);
    });
  });

  if (dataset.trace.length > 0) {
    lines.push('');
    lines.push('# Import Trace');
    dataset.trace.forEach((entry) => {
      const parts = [entry.level.toUpperCase()];
      if (entry.sourceLine != null) parts.push(`line ${entry.sourceLine}`);
      if (entry.sourceCode) parts.push(`[${entry.sourceCode}]`);
      parts.push(entry.message);
      if (entry.raw) parts.push(`raw=${entry.raw}`);
      lines.push(`# ${parts.join(' ')}`);
    });
  }

  lines.push('');
  return lines.join('\n');
};

const opusSolutionLabel = (solutionType: OpusImportMetadata['solutionType']): string =>
  solutionType.toUpperCase();

export const buildOpusImportedDataset = (opus: OpusImportResult): ImportedDataset => {
  const sigmaHeightM = opus.sigmaEllipsoidHeightM ?? opus.sigmaOrthometricHeightM ?? 0;
  const heightDatum = opus.ellipsoidHeightM != null ? 'ellipsoid' : 'orthometric';
  const heightM = opus.ellipsoidHeightM ?? opus.orthometricHeightM ?? 0;
  const recordType = heightDatum === 'ellipsoid' ? 'PH' : 'P';
  const covarianceLabel =
    opus.covariance.source === 'report-correlation'
      ? `corrEN=${formatNumber(opus.covariance.corrEN ?? 0, 4)}`
      : 'diagonal-only';

  return {
    importerId: 'opus-report',
    formatLabel: `NGS ${opusSolutionLabel(opus.metadata.solutionType)} solution report`,
    summary: `Imported ${opusSolutionLabel(opus.metadata.solutionType)} report as ${opus.stationId}`,
    notice: {
      title: `Imported ${opusSolutionLabel(opus.metadata.solutionType)} report`,
      detailLines: [
        `Station ${opus.stationId} converted to ${recordType} control input from ${opus.metadata.reportFileName ?? 'imported report'}.`,
        `Reference frame: ${opus.metadata.referenceFrame ?? 'n/a'}. Covariance: ${covarianceLabel}.`,
      ],
    },
    comments: [
      `Imported from NGS ${opusSolutionLabel(opus.metadata.solutionType)} solution report`,
      opus.metadata.reportFileName ? `Source report: ${opus.metadata.reportFileName}` : '',
      opus.metadata.sourceFile ? `Source RINEX: ${opus.metadata.sourceFile}` : '',
      opus.metadata.referenceFrame ? `Reference frame: ${opus.metadata.referenceFrame}` : '',
      opus.metadata.software ? `Software: ${opus.metadata.software}` : '',
      opus.metadata.geoidModel ? `Geoid model: ${opus.metadata.geoidModel}` : '',
      opus.orthometricHeightM != null && heightDatum === 'ellipsoid'
        ? `Orthometric height (informational): ${formatNumber(opus.orthometricHeightM, 4)} m`
        : '',
      `Covariance import: sigmaN=${formatNumber(opus.sigmaNorthM ?? 0, 4)}m sigmaE=${formatNumber(
        opus.sigmaEastM ?? 0,
        4,
      )}m sigmaH=${formatNumber(sigmaHeightM, 4)}m corrEN=${formatNumber(
        opus.covariance.corrEN ?? 0,
        4,
      )} (${opus.covariance.source})`,
    ].filter(Boolean),
    controlStations: [
      {
        kind: 'control-station',
        stationId: opus.stationId,
        coordinateMode: 'geodetic',
        latitudeDeg: opus.latitudeDeg,
        longitudeDeg: opus.longitudeDeg,
        heightDatum,
        heightM,
        sigmaNorthM: opus.sigmaNorthM,
        sigmaEastM: opus.sigmaEastM,
        sigmaHeightM,
        corrEN: opus.covariance.corrEN,
      },
    ],
    observations: [],
    trace: [],
    legacy: {
      opus,
    },
  };
};

export const matchXmlBlocks = (input: string, tagName: string): { block: string; index: number }[] => {
  const matches: { block: string; index: number }[] = [];
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    matches.push({ block: match[0], index: match.index });
  }
  return matches;
};

export const extractXmlText = (input: string, tagNames: string[]): string | undefined => {
  for (const tagName of tagNames) {
    const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
    const match = input.match(pattern);
    if (match?.[1]) {
      const text = collapseWhitespace(decodeXmlEntities(match[1]));
      if (text) return text;
    }
  }
  return undefined;
};

export const extractXmlAttribute = (input: string, attributeNames: string[]): string | undefined => {
  const openingTagMatch = input.match(/^<\w+\b([^>]*)>/i);
  if (!openingTagMatch?.[1]) return undefined;
  for (const attributeName of attributeNames) {
    const escaped = attributeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`${escaped}\\s*=\\s*(['"])(.*?)\\1`, 'i');
    const match = openingTagMatch[1].match(pattern);
    if (match?.[2]) {
      const text = collapseWhitespace(decodeXmlEntities(match[2]));
      if (text) return text;
    }
  }
  return undefined;
};

export const extractXmlNumber = (input: string, tagNames: string[]): number | undefined => {
  const text = extractXmlText(input, tagNames);
  if (!text) return undefined;
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value : undefined;
};

export const hasXmlTag = (input: string, tagNames: string[]): boolean =>
  tagNames.some((tagName) => new RegExp(`<${tagName}\\b`, 'i').test(input));

export const extractXmlBlock = (input: string, tagNames: string[]): string | undefined => {
  for (const tagName of tagNames) {
    const match = input.match(new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, 'i'));
    if (match?.[0]) return match[0];
  }
  return undefined;
};

export const stripHtmlTags = (value: string): string =>
  collapseWhitespace(
    decodeXmlEntities(
      value
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/<[^>]+>/g, ' '),
    ),
  );

interface HtmlTableBlock {
  html: string;
  index: number;
  caption?: string;
  rows: string[][];
}

export const extractHtmlTables = (input: string): HtmlTableBlock[] => {
  const matches: HtmlTableBlock[] = [];
  const pattern = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    const html = match[0];
    const captionMatch = html.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i);
    const caption = captionMatch?.[1] ? stripHtmlTags(captionMatch[1]) : undefined;
    const rows: string[][] = [];
    const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowPattern.exec(html)) !== null) {
      const rowHtml = rowMatch[1];
      const cells = [...rowHtml.matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)]
        .map((cellMatch) => stripHtmlTags(cellMatch[1]))
        .filter((cell) => cell.length > 0 || rowHtml.includes('&nbsp;'));
      if (cells.length > 0) rows.push(cells);
    }
    matches.push({
      html,
      index: match.index,
      caption,
      rows,
    });
  }
  return matches;
};

export const tableRowPairsToMap = (cells: string[]): Record<string, string> => {
  const output: Record<string, string> = {};
  for (let index = 0; index + 1 < cells.length; index += 2) {
    const key = cells[index]?.trim();
    if (!key) continue;
    output[key] = cells[index + 1]?.trim() ?? '';
  }
  return output;
};

const normalizeAngleDeg = (value: number): number => {
  const wrapped = ((value % 360) + 360) % 360;
  return wrapped === 360 ? 0 : wrapped;
};

export const choosePreferredStation = (
  existing: ImportedControlStationRecord | undefined,
  candidate: ImportedControlStationRecord,
): ImportedControlStationRecord => {
  if (!existing) return candidate;
  if (existing.coordinateMode !== candidate.coordinateMode) {
    return candidate.coordinateMode === 'geodetic' ? candidate : existing;
  }
  const existingScore =
    Number(existing.heightM != null) +
    Number(existing.sigmaEastM != null || existing.sigmaNorthM != null) +
    Number(existing.description != null);
  const candidateScore =
    Number(candidate.heightM != null) +
    Number(candidate.sigmaEastM != null || candidate.sigmaNorthM != null) +
    Number(candidate.description != null);
  return candidateScore >= existingScore ? candidate : existing;
};

export const buildTraceDetailLine = (trace: ImportedTraceEntry[]): string | null => {
  const { warnings, errors } = buildTraceSummary(trace);
  if (warnings === 0 && errors === 0) return null;
  const parts: string[] = [];
  if (warnings > 0) parts.push(`Warnings: ${warnings}`);
  if (errors > 0) parts.push(`Errors: ${errors}`);
  parts.push('unsupported content left in comment form for traceability.');
  return parts.join('. ');
};

interface ImportedObservationBundleOptions {
  observations: ImportedObservationRecord[];
  trace: ImportedTraceEntry[];
  sourceLine: number;
  sourceCode: string;
  occupyId: string;
  targetId: string;
  backsightId?: string;
  angleDeg?: number;
  bearingDeg?: number;
  distanceM?: number;
  distanceMode?: 'slope' | 'horizontal';
  verticalMode?: 'zenith' | 'delta-h';
  verticalValue?: number;
  hiM?: number;
  htM?: number;
  raw?: string;
  tracePrefix?: string;
  sourceMeta?: ImportedSourceMetadata;
}

export const appendImportedObservationBundle = ({
  observations,
  trace,
  sourceLine,
  sourceCode,
  occupyId,
  targetId,
  backsightId,
  angleDeg,
  bearingDeg,
  distanceM,
  distanceMode,
  verticalMode,
  verticalValue,
  hiM,
  htM,
  raw,
  tracePrefix = 'Observation',
  sourceMeta,
}: ImportedObservationBundleOptions): void => {
  const hasVertical = verticalMode != null && verticalValue != null;
  const useMeasurementRecord =
    backsightId != null && angleDeg != null && distanceMode !== 'horizontal';
  const useDistanceVerticalRecord =
    distanceM != null && distanceMode !== 'horizontal' && hasVertical;

  if (backsightId && angleDeg != null) {
    if (useMeasurementRecord && distanceM != null) {
      observations.push({
        kind: 'measurement',
        atId: occupyId,
        fromId: backsightId,
        toId: targetId,
        angleDeg: normalizeAngleDeg(angleDeg),
        distanceM,
        verticalMode,
        verticalValue,
        hiM,
        htM,
        sourceLine,
        sourceCode,
        note: 'converted to M',
        sourceMeta,
      });
      return;
    }

    observations.push({
      kind: 'angle',
      atId: occupyId,
      fromId: backsightId,
      toId: targetId,
      angleDeg: normalizeAngleDeg(angleDeg),
      sourceLine,
      sourceCode,
      note: 'converted to A',
      sourceMeta,
    });
  } else if (bearingDeg != null) {
    observations.push({
      kind: 'bearing',
      fromId: occupyId,
      toId: targetId,
      bearingDeg: normalizeAngleDeg(bearingDeg),
      sourceLine,
      sourceCode,
      note: 'converted to B',
      sourceMeta,
    });
  }

  if (useDistanceVerticalRecord && distanceM != null) {
    observations.push({
      kind: 'distance-vertical',
      fromId: occupyId,
      toId: targetId,
      distanceM,
      verticalMode: verticalMode!,
      verticalValue: verticalValue!,
      hiM,
      htM,
      sourceLine,
      sourceCode,
      note: 'converted to DV',
      sourceMeta,
    });
    return;
  }

  if (distanceM != null) {
    observations.push({
      kind: 'distance',
      fromId: occupyId,
      toId: targetId,
      distanceM,
      hiM,
      htM,
      sourceLine,
      sourceCode,
      note: 'converted to D',
      sourceMeta,
    });
  }

  if (hasVertical) {
    observations.push({
      kind: 'vertical',
      fromId: occupyId,
      toId: targetId,
      verticalMode: verticalMode!,
      verticalValue: verticalValue!,
      hiM,
      htM,
      sourceLine,
      sourceCode,
      note: 'converted to V',
      sourceMeta,
    });
  }

  if (angleDeg == null && bearingDeg == null && distanceM != null) {
    trace.push({
      level: 'warning',
      sourceLine,
      sourceCode,
      message: `${tracePrefix} ${targetId} had no usable angle or azimuth; imported as ${hasVertical ? 'distance/vertical' : 'distance'} only.`,
      raw,
    });
    return;
  }

  if (angleDeg == null && bearingDeg == null && hasVertical) {
    trace.push({
      level: 'warning',
      sourceLine,
      sourceCode,
      message: `${tracePrefix} ${targetId} had no usable angle, azimuth, or distance; imported as vertical only.`,
      raw,
    });
  }
};

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
