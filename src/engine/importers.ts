import { RAD_TO_DEG, dmsToRad } from './angles';
import {
  serializeImportedControlStationRecord,
  serializeImportedObservationRecord,
} from './importedRecordSerialization';

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

export interface ImportedRecordBase {
  sourceLine?: number;
  sourceCode?: string;
  description?: string;
  note?: string;
  importSourceKey?: string;
  importSourceName?: string;
  sourceMeta?: ImportedSourceMetadata;
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

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const extractLineValue = (input: string, label: string): string | undefined => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = input.match(new RegExp(`^\\s*${escaped}\\s*:\\s*(.+)$`, 'im'));
  return match?.[1] ? collapseWhitespace(match[1]) : undefined;
};

const extractFirstLine = (
  input: string,
  predicate: (_line: string) => boolean,
): string | undefined =>
  input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && predicate(line));

const extractNumbers = (line: string): number[] =>
  [...line.matchAll(/[+-]?\d+(?:\.\d+)?/g)].map((match) => Number.parseFloat(match[0]));

const dmsToDecimal = (deg: number, min: number, sec: number, sign: number): number =>
  sign * (Math.abs(deg) + Math.abs(min) / 60 + Math.abs(sec) / 3600);

const parseLatitudeLine = (line: string | undefined): { value: number; sigmaM?: number } | null => {
  if (!line) return null;
  const numbers = extractNumbers(line);
  if (numbers.length < 3) return null;
  const sign = /\bS\s*LAT\b/i.test(line) ? -1 : 1;
  return {
    value: dmsToDecimal(numbers[0], numbers[1] ?? 0, numbers[2] ?? 0, sign),
    sigmaM: numbers[3],
  };
};

const parseLongitudeLine = (
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

const parseHeightLine = (line: string | undefined): { value: number; sigmaM?: number } | null => {
  if (!line) return null;
  const numbers = extractNumbers(line);
  if (numbers.length < 1) return null;
  return {
    value: numbers[0],
    sigmaM: numbers[1],
  };
};

const parseCorrelationLine = (line: string | undefined): number | undefined => {
  if (!line) return undefined;
  const numbers = [...line.matchAll(/[+-]?\d+(?:\.\d+)?/g)].map((match) =>
    Number.parseFloat(match[0]),
  );
  const value = numbers.find((entry) => Number.isFinite(entry) && Math.abs(entry) <= 1);
  if (!Number.isFinite(value as number)) return undefined;
  return Math.max(-0.999, Math.min(0.999, value as number));
};

const sanitizeStationId = (value: string): string => {
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

const deriveStationId = (
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

const formatNumber = (value: number, decimals: number): string => value.toFixed(decimals);

const decodeXmlEntities = (value: string): string =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

type LineNumberResolver = (_index: number) => number;

const buildLineNumberResolver = (input: string): LineNumberResolver => {
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

const takeLeadingLines = (input: string, maxLines: number): string[] => {
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

const plural = (count: number, label: string): string =>
  `${count} ${label}${count === 1 ? '' : 's'}`;

const buildTraceSummary = (trace: ImportedTraceEntry[]): { warnings: number; errors: number } => ({
  warnings: trace.filter((entry) => entry.level === 'warning').length,
  errors: trace.filter((entry) => entry.level === 'error').length,
});

const sourceLeaf = (sourceName?: string): string =>
  sourceName?.replace(/\\/g, '/').split('/').pop() ?? 'imported file';

const parseDmsAngleDegrees = (value: string): number | undefined => {
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

const parseQuadrantBearingDegrees = (value: string): number | undefined => {
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

const normalizeImportedFace = (value: string | undefined): 'FACE1' | 'FACE2' | undefined => {
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

export const detectOpusReport = (input: string): boolean => {
  const upper = input.toUpperCase();
  const hasOpusBanner = upper.includes('OPUS');
  const hasLat = /\bLAT\s*:/i.test(input);
  const hasLon = /\b[WE]\s*LON\s*:/i.test(input);
  const hasRefFrame = /\bREF FRAME\s*:/i.test(input);
  const hasRinex = /\bRINEX FILE\s*:/i.test(input);
  return hasOpusBanner && hasLat && hasLon && (hasRefFrame || hasRinex);
};

export const parseOpusReport = (
  input: string,
  reportFileName?: string,
): OpusImportResult | null => {
  if (!detectOpusReport(input)) return null;

  const latLine = extractFirstLine(input, (line) => /\bLAT\s*:/i.test(line));
  const lonLine = extractFirstLine(input, (line) => /\b[WE]\s*LON\s*:/i.test(line));
  const ellipsoidLine = extractFirstLine(
    input,
    (line) => /\bEL\s*HGT\s*:/i.test(line) || /\bELLIPSOID(?:AL)?\s*HGT\s*:/i.test(line),
  );
  const orthometricLine = extractFirstLine(
    input,
    (line) => /\bORTHO\s*HGT\s*:/i.test(line) || /\bORTHOMETRIC\s*HGT\s*:/i.test(line),
  );
  const corrLine = extractFirstLine(
    input,
    (line) =>
      /\bCORR(?:EL(?:ATION)?)?\b/i.test(line) &&
      /\bE(?:AST)?\b/i.test(line) &&
      /\bN(?:ORTH)?\b/i.test(line),
  );

  const lat = parseLatitudeLine(latLine);
  const lon = parseLongitudeLine(lonLine);
  if (!lat || !lon) return null;

  const ellipsoid = parseHeightLine(ellipsoidLine);
  const orthometric = parseHeightLine(orthometricLine);
  const sourceFile = extractLineValue(input, 'RINEX FILE');
  const referenceFrame = extractLineValue(input, 'REF FRAME');
  const software = extractLineValue(input, 'SOFTWARE');
  const geoidModel = extractLineValue(input, 'GEOID MODEL');
  const solutionType = /OPUS-RS/i.test(input) ? 'opus-rs' : 'opus';
  const epochMatch = referenceFrame?.match(/EPOCH\s*:?\s*([0-9.]+)/i);
  const stationId = deriveStationId(sourceFile, reportFileName);
  const parsedCorrEN = parseCorrelationLine(corrLine);
  const corrEN = parsedCorrEN ?? 0;
  const covarianceSource =
    parsedCorrEN != null
      ? 'report-correlation'
      : lat.sigmaM != null || lon.sigmaM != null
        ? 'report-diagonal'
        : 'unavailable';

  return {
    stationId,
    latitudeDeg: lat.value,
    longitudeDeg: lon.value,
    ellipsoidHeightM: ellipsoid?.value,
    orthometricHeightM: orthometric?.value,
    sigmaNorthM: lat.sigmaM,
    sigmaEastM: lon.sigmaM,
    sigmaEllipsoidHeightM: ellipsoid?.sigmaM,
    sigmaOrthometricHeightM: orthometric?.sigmaM,
    covariance: {
      sigmaNorthM: lat.sigmaM,
      sigmaEastM: lon.sigmaM,
      sigmaHeightM: ellipsoid?.sigmaM ?? orthometric?.sigmaM,
      corrEN,
      source: covarianceSource,
    },
    metadata: {
      sourceFile,
      reportFileName,
      software,
      solutionType,
      referenceFrame,
      referenceEpoch: epochMatch?.[1],
      geoidModel,
    },
  };
};

const opusSolutionLabel = (solutionType: OpusImportMetadata['solutionType']): string =>
  solutionType.toUpperCase();

const buildOpusImportedDataset = (opus: OpusImportResult): ImportedDataset => {
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

const matchXmlBlocks = (input: string, tagName: string): { block: string; index: number }[] => {
  const matches: { block: string; index: number }[] = [];
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    matches.push({ block: match[0], index: match.index });
  }
  return matches;
};

const extractXmlText = (input: string, tagNames: string[]): string | undefined => {
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

const extractXmlAttribute = (input: string, attributeNames: string[]): string | undefined => {
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

const extractXmlNumber = (input: string, tagNames: string[]): number | undefined => {
  const text = extractXmlText(input, tagNames);
  if (!text) return undefined;
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value : undefined;
};

const hasXmlTag = (input: string, tagNames: string[]): boolean =>
  tagNames.some((tagName) => new RegExp(`<${tagName}\\b`, 'i').test(input));

const extractXmlBlock = (input: string, tagNames: string[]): string | undefined => {
  for (const tagName of tagNames) {
    const match = input.match(new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, 'i'));
    if (match?.[0]) return match[0];
  }
  return undefined;
};

const stripHtmlTags = (value: string): string =>
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

const extractHtmlTables = (input: string): HtmlTableBlock[] => {
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

const tableRowPairsToMap = (cells: string[]): Record<string, string> => {
  const output: Record<string, string> = {};
  for (let index = 0; index + 1 < cells.length; index += 2) {
    const key = cells[index]?.trim();
    if (!key) continue;
    output[key] = cells[index + 1]?.trim() ?? '';
  }
  return output;
};

const parseSurveyReportLinear = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const match = value.replace(/,/g, '').match(/[+-]?\d+(?:\.\d+)?/);
  return match ? Number.parseFloat(match[0]) : undefined;
};

interface JobXmlSetupContext {
  occupyId?: string;
  backsightId?: string;
  backsightRecordRef?: string;
  hiM?: number;
  setupType?: string;
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

const choosePreferredStation = (
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

const buildTraceDetailLine = (trace: ImportedTraceEntry[]): string | null => {
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

const appendImportedObservationBundle = ({
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

const detectJobXml = (input: string, sourceName?: string): boolean => {
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

const parseJobXml = (
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
  const observations: ImportedObservationRecord[] = [];
  const pointBlocks = matchXmlBlocks(input, 'PointRecord');
  const reducedPointBlocks = matchXmlBlocks(input, 'Point');
  const measurementBlocks: { block: string; index: number }[] = [];
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
    const setupType = collapseWhitespace(extractXmlText(block, ['StationType']) ?? '');
    const backsightId = resolveJobXmlPointFromBlock(
      block,
      ['BackSightPointID', 'BacksightPointID', 'BackBearingPointID'],
      ['BacksightName', 'BackSightName', 'BackSight'],
      pointRefLookup,
      stationMap,
    );
    setupContexts.set(xmlId, { occupyId, backsightId, backsightRecordRef, hiM, setupType });
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
    targetContexts.set(xmlId, { stationId, htM });
    if (stationId) registerJobXmlPointReference(pointRefLookup, xmlId, stationId);
  });

  measurementBlocks.forEach(({ block, index }) => {
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

    const targetContext = targetRecordRef ? targetContexts.get(targetRecordRef) : undefined;
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

    const hiM =
      extractXmlNumber(block, ['InstrumentHeight', 'TheodoliteHeight', 'HI', 'IH', 'InstHeight']) ??
      setupContext?.hiM;
    const htM =
      extractXmlNumber(block, ['TargetHeight', 'PrismHeight', 'RodHeight', 'HT']) ??
      targetContext?.htM;
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
    const horizontalCircleDeg = extractXmlNumber(measurementDataBlock, ['HorizontalCircle', 'Hz']);
    const explicitAngleDeg =
      extractXmlNumber(block, ['HorizontalAngle', 'TurnedAngle']) ??
      (isMta ? horizontalCircleDeg : undefined);
    const explicitBearingDeg = extractXmlNumber(block, ['Azimuth', 'Bearing']);
    const distanceM = extractXmlNumber(measurementDataBlock, [
      'EDMDistance',
      'SlopeDistance',
      'Distance',
      'HorizontalDistance',
    ]);
    const zenithDeg = extractXmlNumber(measurementDataBlock, [
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

    const derivedAngleDeg =
      explicitAngleDeg != null
        ? normalizeAngleDeg(explicitAngleDeg)
        : horizontalCircleDeg != null
          ? angleMode === 'raw'
            ? normalizeAngleDeg(horizontalCircleDeg)
            : backsightCircleDeg != null
              ? normalizeAngleDeg(horizontalCircleDeg - backsightCircleDeg)
              : undefined
          : undefined;
    const derivedBearingDeg =
      explicitBearingDeg != null
        ? normalizeAngleDeg(explicitBearingDeg)
        : isMta && horizontalCircleDeg != null && backsightContext?.bearingDeg != null
          ? normalizeAngleDeg(backsightContext.bearingDeg + horizontalCircleDeg)
          : horizontalCircleDeg != null &&
              backsightCircleDeg != null &&
              backsightContext?.bearingDeg != null
            ? normalizeAngleDeg(
                backsightContext.bearingDeg - backsightCircleDeg + horizontalCircleDeg,
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
          sourceLine,
          sourceCode: 'PointRecord',
          note: 'converted to M',
          sourceMeta,
        });
      } else {
        observations.push({
          kind: 'angle',
          atId: occupyId,
          fromId: backsightId,
          toId: targetId,
          angleDeg: derivedAngleDeg,
          sourceLine,
          sourceCode: 'PointRecord',
          note: 'converted to A',
          sourceMeta,
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
            sourceLine,
            sourceCode: 'PointRecord',
            note: 'converted to V',
            sourceMeta,
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
        sourceLine,
        sourceCode: 'PointRecord',
        note: 'converted to B',
        sourceMeta,
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
          sourceLine,
          sourceCode: 'PointRecord',
          note: 'converted to DV',
          sourceMeta,
        });
      } else if (distanceM != null) {
        observations.push({
          kind: 'distance',
          fromId: occupyId,
          toId: targetId,
          distanceM,
          hiM,
          htM,
          sourceLine,
          sourceCode: 'PointRecord',
          note: 'converted to D',
          sourceMeta,
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
          sourceLine,
          sourceCode: 'PointRecord',
          note: 'converted to V',
          sourceMeta,
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
        sourceLine,
        sourceCode: 'PointRecord',
        note: zenithDeg != null || deltaHM != null ? 'converted to DV' : 'converted to D',
        sourceMeta,
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

const RW5_RECORD_CODES = new Set([
  'JB',
  'MO',
  'OC',
  'SP',
  'PT',
  'BK',
  'LS',
  'SS',
  'TR',
  'FR',
  'FS',
  'FD',
  'BD',
  'BR',
  'CL',
  'AB',
]);

const RW5_INLINE_FIELD_KEYS = [
  'TARGET',
  'POINT',
  'FROM',
  'DESC',
  'POS1',
  'POS2',
  'POS3',
  'OP',
  'PN',
  'FP',
  'BP',
  'BS',
  'BC',
  'HI',
  'HR',
  'HT',
  'IH',
  'AR',
  'AL',
  'AZ',
  'BR',
  'DR',
  'DL',
  'ZE',
  'VA',
  'CE',
  'DH',
  'SD',
  'HD',
  'EL',
  'NM',
  'DT',
  'UN',
  'SF',
  'AD',
  'FC',
  'N',
  'E',
].sort((a, b) => b.length - a.length);
const RW5_KEY_VALUE_PATTERN = /^([A-Za-z]{1,8})(.*)$/;

interface ParsedRw5Line {
  code: string;
  fields: Record<string, string>;
  raw: string;
}

interface Rw5Context {
  occupyId?: string;
  backsightId?: string;
  hiM?: number;
  htM?: number;
  backsightAzimuthDeg?: number;
  setCircleDeg?: number;
}

const looksLikeRw5Raw = (input: string): boolean => {
  const recognized = takeLeadingLines(input, 40)
    .map((line) => parseRw5Line(line))
    .filter((row): row is ParsedRw5Line => row != null && RW5_RECORD_CODES.has(row.code));
  if (recognized.length < 2) return false;
  return recognized.some((row) => !row.raw.includes('=') && !row.raw.includes(':'));
};

const parseRw5Line = (line: string): ParsedRw5Line | null => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#') || trimmed.startsWith('//')) {
    return null;
  }
  const tokens = trimmed
    .split(/\s*,\s*/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;
  const code = tokens[0].toUpperCase();
  const fields: Record<string, string> = {};
  const positional: string[] = [];

  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.startsWith('--')) {
      const description = token.slice(2).trim();
      if (description) fields.DESC = description;
      continue;
    }

    const eqIndex = token.indexOf('=');
    const colonIndex = token.indexOf(':');
    const sepIndex =
      eqIndex >= 0 && colonIndex >= 0
        ? Math.min(eqIndex, colonIndex)
        : Math.max(eqIndex, colonIndex);
    if (sepIndex > 0) {
      const key = normalizeFieldKey(token.slice(0, sepIndex));
      const value = token.slice(sepIndex + 1).trim();
      if (key) fields[key] = value;
      continue;
    }

    const inlineKey = RW5_INLINE_FIELD_KEYS.find(
      (candidate) => token.toUpperCase().startsWith(candidate) && token.length > candidate.length,
    );
    if (inlineKey) {
      fields[normalizeFieldKey(inlineKey)] = token.slice(inlineKey.length).trim();
      continue;
    }

    const keyValueMatch = token.match(RW5_KEY_VALUE_PATTERN);
    if (keyValueMatch) {
      const key = normalizeFieldKey(keyValueMatch[1]);
      const remainder = keyValueMatch[2].trim();
      if (remainder) {
        fields[key] = remainder;
        continue;
      }
      if (i + 1 < tokens.length) {
        fields[key] = tokens[i + 1].trim();
        i += 1;
        continue;
      }
    }

    positional.push(token);
  }

  positional.forEach((value, index) => {
    fields[`POS${index + 1}`] = value;
  });

  return { code, fields, raw: trimmed };
};

const detectCarlsonRw5 = (input: string, sourceName?: string): boolean => {
  const fileName = sourceName?.toLowerCase() ?? '';
  if (detectFieldGeniusRaw(input, sourceName)) return false;
  if (!looksLikeRw5Raw(input)) return false;
  return fileName.endsWith('.rw5') || fileName.endsWith('.cr5') || /CARLSON/i.test(input);
};

const detectTdsRaw = (input: string, sourceName?: string): boolean => {
  const fileName = sourceName?.toLowerCase() ?? '';
  if (detectFieldGeniusRaw(input, sourceName)) return false;
  if (!looksLikeRw5Raw(input)) return false;
  return fileName.endsWith('.raw') || /\bTDS\b/i.test(input);
};

const pickRw5Field = (fields: Record<string, string>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = fields[normalizeFieldKey(key)];
    if (value != null && value !== '') return value;
  }
  return undefined;
};

const pickRw5NumberField = (fields: Record<string, string>, keys: string[]): number | undefined => {
  const rawValue = pickRw5Field(fields, keys);
  if (rawValue == null) return undefined;
  const parsed = Number.parseFloat(rawValue.replace(/[^\d+\-.]/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseRw5AngleToken = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  return parseDmsAngleDegrees(value);
};

const parseRw5BearingToken = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  return parseQuadrantBearingDegrees(value);
};

const buildLocalStationFromRw5 = (
  code: string,
  fields: Record<string, string>,
  sourceLine: number,
): ImportedControlStationRecord | null => {
  const rawPointId =
    pickRw5Field(fields, ['PN', 'PT', 'POINT', 'POINTID', 'NAME']) ??
    (code === 'OC' ? pickRw5Field(fields, ['OP']) : undefined);
  if (!rawPointId) return null;
  const eastM = pickRw5NumberField(fields, ['E', 'EAST', 'EASTING', 'X']);
  const northM = pickRw5NumberField(fields, ['N', 'NORTH', 'NORTHING', 'Y']);
  const heightM = pickRw5NumberField(fields, ['EL', 'ELEV', 'ELEVATION', 'Z', 'H', 'HEIGHT']) ?? 0;
  if (eastM == null || northM == null) return null;
  return {
    kind: 'control-station',
    coordinateMode: 'local',
    stationId: sanitizeStationId(rawPointId),
    eastM,
    northM,
    heightM,
    description: pickRw5Field(fields, ['DESC', 'CODE', 'FC']),
    sourceLine,
    sourceCode: code,
  };
};

const resolveRw5ShotOrientation = (
  context: Rw5Context,
  fields: Record<string, string>,
): { angleDeg?: number; bearingDeg?: number } => {
  const azimuthDeg = parseRw5AngleToken(pickRw5Field(fields, ['AZ']));
  if (azimuthDeg != null) return { bearingDeg: azimuthDeg };

  const bearingDeg = parseRw5BearingToken(pickRw5Field(fields, ['BR']));
  if (bearingDeg != null) return { bearingDeg };

  const angleRightDeg = parseRw5AngleToken(pickRw5Field(fields, ['AR']));
  if (angleRightDeg != null) {
    if (context.backsightId) return { angleDeg: angleRightDeg };
    if (context.backsightAzimuthDeg != null) {
      return {
        bearingDeg: context.backsightAzimuthDeg - (context.setCircleDeg ?? 0) + angleRightDeg,
      };
    }
  }

  const angleLeftDeg = parseRw5AngleToken(pickRw5Field(fields, ['AL']));
  if (angleLeftDeg != null) {
    const rightEquivalent = 360 - angleLeftDeg;
    if (context.backsightId) return { angleDeg: rightEquivalent };
    if (context.backsightAzimuthDeg != null) {
      return {
        bearingDeg: context.backsightAzimuthDeg - (context.setCircleDeg ?? 0) + rightEquivalent,
      };
    }
  }

  const deflectRightDeg = parseRw5AngleToken(pickRw5Field(fields, ['DR']));
  if (deflectRightDeg != null) {
    const rightEquivalent = 180 - deflectRightDeg;
    if (context.backsightId) return { angleDeg: rightEquivalent };
    if (context.backsightAzimuthDeg != null) {
      return {
        bearingDeg: context.backsightAzimuthDeg - (context.setCircleDeg ?? 0) + rightEquivalent,
      };
    }
  }

  const deflectLeftDeg = parseRw5AngleToken(pickRw5Field(fields, ['DL']));
  if (deflectLeftDeg != null) {
    const rightEquivalent = 180 + deflectLeftDeg;
    if (context.backsightId) return { angleDeg: rightEquivalent };
    if (context.backsightAzimuthDeg != null) {
      return {
        bearingDeg: context.backsightAzimuthDeg - (context.setCircleDeg ?? 0) + rightEquivalent,
      };
    }
  }

  return {};
};

const resolveRw5VerticalPayload = (
  fields: Record<string, string>,
): { verticalMode?: 'zenith' | 'delta-h'; verticalValue?: number } => {
  const zenithDeg = parseRw5AngleToken(pickRw5Field(fields, ['ZE']));
  if (zenithDeg != null) return { verticalMode: 'zenith', verticalValue: zenithDeg };

  const verticalAngleDeg = parseRw5AngleToken(pickRw5Field(fields, ['VA']));
  if (verticalAngleDeg != null) {
    return { verticalMode: 'zenith', verticalValue: 90 - verticalAngleDeg };
  }

  const deltaHM = pickRw5NumberField(fields, ['CE', 'DH']);
  if (deltaHM != null) return { verticalMode: 'delta-h', verticalValue: deltaHM };

  return {};
};

const parseRw5Dataset = (
  input: string,
  sourceName: string | undefined,
  flavor: 'carlson' | 'tds',
): ImportedDataset | null => {
  const detect = flavor === 'carlson' ? detectCarlsonRw5 : detectTdsRaw;
  if (!detect(input, sourceName)) return null;

  const trace: ImportedTraceEntry[] = [];
  const controlStations = new Map<string, ImportedControlStationRecord>();
  const observations: ImportedObservationRecord[] = [];
  const fileLabel = sourceLeaf(sourceName);
  const context: Rw5Context = {};

  input.split(/\r?\n/).forEach((line, index) => {
    const sourceLine = index + 1;
    const parsed = parseRw5Line(line);
    if (!parsed) return;

    const { code, fields, raw } = parsed;
    if (!RW5_RECORD_CODES.has(code)) {
      trace.push({
        level: 'warning',
        sourceLine,
        sourceCode: code,
        message: 'Unsupported Carlson/TDS record type was not converted.',
        raw,
      });
      return;
    }

    const localStation = buildLocalStationFromRw5(code, fields, sourceLine);
    if (localStation) {
      const existing = controlStations.get(localStation.stationId);
      controlStations.set(localStation.stationId, choosePreferredStation(existing, localStation));
    }

    if (code === 'JB' || code === 'MO') return;

    if (code === 'OC') {
      const rawPointId = pickRw5Field(fields, ['OP', 'PN', 'POINT', 'NAME']);
      if (!rawPointId) {
        trace.push({
          level: 'error',
          sourceLine,
          sourceCode: code,
          message: 'Occupy record missing station identifier.',
          raw,
        });
        return;
      }
      context.occupyId = sanitizeStationId(rawPointId);
      context.hiM = pickRw5NumberField(fields, ['HI', 'IH']) ?? context.hiM;
      context.backsightId = undefined;
      context.backsightAzimuthDeg = undefined;
      context.setCircleDeg = undefined;
      return;
    }

    if (code === 'BK') {
      const backsightPoint = pickRw5Field(fields, ['BP', 'BSPOINT', 'PN']);
      const backsightAzimuth = parseRw5AngleToken(pickRw5Field(fields, ['BS', 'AZ']));
      context.backsightId = backsightPoint ? sanitizeStationId(backsightPoint) : undefined;
      context.backsightAzimuthDeg = backsightAzimuth;
      context.setCircleDeg = parseRw5AngleToken(pickRw5Field(fields, ['BC', 'SC'])) ?? 0;
      return;
    }

    if (code === 'LS') {
      context.hiM = pickRw5NumberField(fields, ['HI', 'IH']) ?? context.hiM;
      context.htM = pickRw5NumberField(fields, ['HR', 'HT', 'RH']) ?? context.htM;
      return;
    }

    if (code === 'SP' || code === 'PT') {
      if (!localStation) {
        trace.push({
          level: 'error',
          sourceLine,
          sourceCode: code,
          message: 'Point record missing East/North coordinates and was skipped.',
          raw,
        });
      }
      return;
    }

    if (
      code === 'SS' ||
      code === 'TR' ||
      code === 'FR' ||
      code === 'FS' ||
      code === 'FD' ||
      code === 'BD' ||
      code === 'BR' ||
      code === 'CL' ||
      code === 'AB'
    ) {
      const occupyId =
        context.occupyId ??
        (pickRw5Field(fields, ['OP', 'FROM', 'AT'])
          ? sanitizeStationId(pickRw5Field(fields, ['OP', 'FROM', 'AT'])!)
          : undefined);
      if (!occupyId) {
        trace.push({
          level: 'error',
          sourceLine,
          sourceCode: code,
          message: 'Shot record encountered before any occupy setup.',
          raw,
        });
        return;
      }

      const targetRaw = pickRw5Field(fields, ['FP', 'PN', 'POINT', 'TO', 'TARGET', 'POS1']);
      if (!targetRaw) {
        trace.push({
          level: 'error',
          sourceLine,
          sourceCode: code,
          message: 'Shot record missing target point identifier.',
          raw,
        });
        return;
      }

      const targetId = sanitizeStationId(targetRaw);
      const distanceM = pickRw5NumberField(fields, ['SD', 'DIST', 'DISTANCE', 'SLOPE', 'HD']);
      const distanceMode =
        pickRw5Field(fields, ['SD', 'DIST', 'DISTANCE', 'SLOPE']) != null
          ? 'slope'
          : pickRw5Field(fields, ['HD']) != null
            ? 'horizontal'
            : undefined;
      const htM = pickRw5NumberField(fields, ['HR', 'HT', 'RH']) ?? context.htM;
      const { angleDeg, bearingDeg } = resolveRw5ShotOrientation(context, fields);
      const { verticalMode, verticalValue } = resolveRw5VerticalPayload(fields);

      appendImportedObservationBundle({
        observations,
        trace,
        sourceLine,
        sourceCode: code,
        occupyId,
        targetId,
        backsightId: context.backsightId,
        angleDeg,
        bearingDeg,
        distanceM,
        distanceMode,
        verticalMode,
        verticalValue,
        hiM: context.hiM,
        htM,
        raw,
        tracePrefix: 'Shot',
      });
      return;
    }

    trace.push({
      level: 'warning',
      sourceLine,
      sourceCode: code,
      message: 'Supported Carlson/TDS record was recognized but not yet converted.',
      raw,
    });
  });

  const stations = [...controlStations.values()];
  if (stations.length === 0 && observations.length === 0) return null;

  const formatLabel = flavor === 'carlson' ? 'Carlson RW5 field data' : 'TDS raw field data';
  const title = flavor === 'carlson' ? 'Imported Carlson dataset' : 'Imported TDS dataset';
  const traceDetail = buildTraceDetailLine(trace);
  const detailLines = [
    `Imported ${plural(stations.length, 'point')} and ${plural(observations.length, 'observation')} from ${fileLabel} into normalized WebNet input.`,
  ];
  if (traceDetail) detailLines.push(traceDetail);

  return {
    importerId: flavor === 'carlson' ? 'carlson-rw5' : 'tds-raw',
    formatLabel,
    summary: `Imported ${flavor === 'carlson' ? 'Carlson' : 'TDS'} dataset with ${plural(stations.length, 'point')} and ${plural(observations.length, 'observation')}`,
    notice: {
      title,
      detailLines,
    },
    comments: [
      `Imported from ${flavor === 'carlson' ? 'Carlson RW5' : 'TDS raw'} data`,
      `Source file: ${fileLabel}`,
      `Imported points: ${stations.length}`,
      `Imported observations: ${observations.length}`,
    ],
    controlStations: stations,
    observations,
    trace,
  };
};

interface ParsedFieldGeniusLine {
  code: string;
  fields: Record<string, string>;
  raw: string;
}

const normalizedFieldKeyCache = new Map<string, string>();
const normalizeFieldKey = (value: string): string => {
  const cached = normalizedFieldKeyCache.get(value);
  if (cached != null) return cached;
  const normalized = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  normalizedFieldKeyCache.set(value, normalized);
  return normalized;
};
const FIELDGENIUS_BARE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

const parseFieldGeniusLine = (line: string): ParsedFieldGeniusLine | null => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#') || trimmed.startsWith('//')) {
    return null;
  }
  if (/^FIELDGENIUS\b/i.test(trimmed) && !trimmed.includes(',')) {
    return null;
  }
  const tokens = trimmed
    .split(/\s*,\s*/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;
  const code = tokens[0].toUpperCase();
  const fields: Record<string, string> = {};
  const positional: string[] = [];

  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    const eqIndex = token.indexOf('=');
    const colonIndex = token.indexOf(':');
    const sepIndex =
      eqIndex >= 0 && colonIndex >= 0
        ? Math.min(eqIndex, colonIndex)
        : Math.max(eqIndex, colonIndex);
    if (sepIndex > 0) {
      const key = normalizeFieldKey(token.slice(0, sepIndex));
      const value = token.slice(sepIndex + 1).trim();
      if (key) fields[key] = value;
      continue;
    }

    if (FIELDGENIUS_BARE_KEY_PATTERN.test(token) && i + 1 < tokens.length) {
      const next = tokens[i + 1];
      if (!next.includes('=') && !next.includes(':')) {
        fields[normalizeFieldKey(token)] = next.trim();
        i += 1;
        continue;
      }
    }

    positional.push(token);
  }

  positional.forEach((value, index) => {
    fields[`POS${index + 1}`] = value;
  });

  return { code, fields, raw: trimmed };
};

const detectFieldGeniusRaw = (input: string, sourceName?: string): boolean => {
  const fileName = sourceName?.toLowerCase() ?? '';
  const lines = takeLeadingLines(input, 20);
  const parsedRows = lines
    .map((line) => parseFieldGeniusLine(line))
    .filter(
      (row): row is ParsedFieldGeniusLine => row != null && FIELDGENIUS_RECORD_CODES.has(row.code),
    );
  const recognized = parsedRows.length;
  const hasExplicitAssignments = parsedRows.some(
    (row) => row.raw.includes('=') || row.raw.includes(':'),
  );
  return (
    /FIELDGENIUS/i.test(input) ||
    ((fileName.endsWith('.raw') || recognized >= 2) && hasExplicitAssignments)
  );
};

const pickField = (fields: Record<string, string>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = fields[normalizeFieldKey(key)];
    if (value != null && value !== '') return value;
  }
  return undefined;
};

const pickNumberField = (fields: Record<string, string>, keys: string[]): number | undefined => {
  const value = pickField(fields, keys);
  if (value == null) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const buildLocalStationFromFieldGenius = (
  code: string,
  fields: Record<string, string>,
  sourceLine: number,
): ImportedControlStationRecord | null => {
  const rawPointId = pickField(fields, ['PN', 'PT', 'POINT', 'POINTID', 'NAME', 'ID', 'POS1']);
  if (!rawPointId) return null;
  const eastM = pickNumberField(fields, ['E', 'EAST', 'EASTING', 'X']);
  const northM = pickNumberField(fields, ['N', 'NORTH', 'NORTHING', 'Y']);
  const heightM = pickNumberField(fields, ['Z', 'EL', 'ELEV', 'ELEVATION', 'H', 'HEIGHT']) ?? 0;
  if (eastM == null || northM == null) return null;
  return {
    kind: 'control-station',
    coordinateMode: 'local',
    stationId: sanitizeStationId(rawPointId),
    eastM,
    northM,
    heightM,
    description: pickField(fields, ['DESC', 'DESCRIPTION', 'CODE', 'FC']),
    sourceLine,
    sourceCode: code,
  };
};

const parseFieldGenius = (input: string, sourceName?: string): ImportedDataset | null => {
  if (!detectFieldGeniusRaw(input, sourceName)) return null;

  const trace: ImportedTraceEntry[] = [];
  const controlStations = new Map<string, ImportedControlStationRecord>();
  const observations: ImportedObservationRecord[] = [];
  const fileLabel = sourceLeaf(sourceName);
  let occupyId: string | undefined;
  let backsightId: string | undefined;
  let hiM: number | undefined;

  input.split(/\r?\n/).forEach((line, index) => {
    const sourceLine = index + 1;
    const parsed = parseFieldGeniusLine(line);
    if (!parsed) return;

    const { code, fields, raw } = parsed;
    if (!FIELDGENIUS_RECORD_CODES.has(code)) {
      trace.push({
        level: 'warning',
        sourceLine,
        sourceCode: code,
        message: 'Unsupported FieldGenius record type was not converted.',
        raw,
      });
      return;
    }

    const localStation = buildLocalStationFromFieldGenius(code, fields, sourceLine);
    if (localStation) {
      const existing = controlStations.get(localStation.stationId);
      controlStations.set(localStation.stationId, choosePreferredStation(existing, localStation));
    }

    if (code === 'OC' || code === 'LS' || code === 'STN') {
      const rawPointId = pickField(fields, ['PN', 'POINT', 'NAME', 'POS1']);
      if (!rawPointId) {
        trace.push({
          level: 'error',
          sourceLine,
          sourceCode: code,
          message: 'Setup record missing occupy point identifier.',
          raw,
        });
        return;
      }
      occupyId = sanitizeStationId(rawPointId);
      hiM = pickNumberField(fields, ['HI', 'IH', 'INSTHT']);
      if (hiM == null) hiM = pickNumberField(fields, ['POS2']);
      return;
    }

    if (code === 'BK' || code === 'BS') {
      const rawPointId = pickField(fields, ['PN', 'POINT', 'NAME', 'POS1']);
      if (!rawPointId) {
        trace.push({
          level: 'warning',
          sourceLine,
          sourceCode: code,
          message: 'Backsight record missing backsight point identifier.',
          raw,
        });
        return;
      }
      backsightId = sanitizeStationId(rawPointId);
      return;
    }

    if (code === 'SP' || code === 'PT' || code === 'GS' || code === 'CV') {
      if (!localStation) {
        trace.push({
          level: code === 'GS' || code === 'CV' ? 'warning' : 'error',
          sourceLine,
          sourceCode: code,
          message: 'Point record missing East/North coordinates and was skipped.',
          raw,
        });
      }
      return;
    }

    if (code === 'SS' || code === 'TR' || code === 'FR' || code === 'FS') {
      if (!occupyId) {
        trace.push({
          level: 'error',
          sourceLine,
          sourceCode: code,
          message: 'Shot record encountered before any occupy setup.',
          raw,
        });
        return;
      }

      const targetIdRaw = pickField(fields, ['PN', 'POINT', 'POINTID', 'NAME', 'TARGET', 'POS1']);
      if (!targetIdRaw) {
        trace.push({
          level: 'error',
          sourceLine,
          sourceCode: code,
          message: 'Shot record missing target point identifier.',
          raw,
        });
        return;
      }
      const targetId = sanitizeStationId(targetIdRaw);
      const htM = pickNumberField(fields, ['HT', 'RH', 'RODHT', 'TARGETHT']);
      const angleDeg = pickNumberField(fields, ['HA', 'HZ', 'HORANGLE', 'ANGLE', 'HR']);
      const azimuthDeg = pickNumberField(fields, ['AZ', 'AZI', 'AZIMUTH', 'BRG', 'BEARING']);
      const distanceM = pickNumberField(fields, ['SD', 'HD', 'DIST', 'DISTANCE', 'SLOPE']);
      const zenithDeg = pickNumberField(fields, ['VA', 'ZE', 'ZENITH', 'VZ']);
      const deltaHM = pickNumberField(fields, ['DH', 'DELTAH', 'VD']);

      if (angleDeg != null && backsightId && distanceM != null) {
        observations.push({
          kind: 'measurement',
          atId: occupyId,
          fromId: backsightId,
          toId: targetId,
          angleDeg,
          distanceM,
          verticalMode: zenithDeg != null ? 'zenith' : deltaHM != null ? 'delta-h' : undefined,
          verticalValue: zenithDeg ?? deltaHM,
          hiM,
          htM,
          sourceLine,
          sourceCode: code,
          note: 'converted to M',
        });
        return;
      }

      if (angleDeg != null && backsightId) {
        observations.push({
          kind: 'angle',
          atId: occupyId,
          fromId: backsightId,
          toId: targetId,
          angleDeg,
          sourceLine,
          sourceCode: code,
          note: 'converted to A',
        });
        return;
      }

      if (azimuthDeg != null) {
        observations.push({
          kind: 'bearing',
          fromId: occupyId,
          toId: targetId,
          bearingDeg: azimuthDeg,
          sourceLine,
          sourceCode: code,
          note: 'converted to B',
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
            sourceLine,
            sourceCode: code,
            note: 'converted to DV',
          });
        } else if (distanceM != null) {
          observations.push({
            kind: 'distance',
            fromId: occupyId,
            toId: targetId,
            distanceM,
            hiM,
            htM,
            sourceLine,
            sourceCode: code,
            note: 'converted to D',
          });
        }
        return;
      }

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
          sourceLine,
          sourceCode: code,
          note: 'converted to DV',
        });
        trace.push({
          level: 'warning',
          sourceLine,
          sourceCode: code,
          message: `Shot ${targetId} had no usable angle or azimuth; imported as distance/vertical only.`,
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
          sourceCode: code,
          note: 'converted to D',
        });
        trace.push({
          level: 'warning',
          sourceLine,
          sourceCode: code,
          message: `Shot ${targetId} had no usable angle or azimuth; imported as distance only.`,
        });
        return;
      }

      trace.push({
        level: 'warning',
        sourceLine,
        sourceCode: code,
        message: `Shot ${targetId} did not contain a supported observation payload.`,
        raw,
      });
      return;
    }

    trace.push({
      level: 'warning',
      sourceLine,
      sourceCode: code,
      message: 'Supported FieldGenius record was recognized but not yet converted.',
      raw,
    });
  });

  const stations = [...controlStations.values()];
  if (stations.length === 0 && observations.length === 0) return null;

  const detailLines = [
    `Imported ${plural(stations.length, 'point')} and ${plural(observations.length, 'observation')} from ${fileLabel} into normalized WebNet input.`,
  ];
  const traceDetail = buildTraceDetailLine(trace);
  if (traceDetail) detailLines.push(traceDetail);

  return {
    importerId: 'fieldgenius-raw',
    formatLabel: 'FieldGenius raw field data',
    summary: `Imported FieldGenius dataset with ${plural(stations.length, 'point')} and ${plural(observations.length, 'observation')}`,
    notice: {
      title: 'Imported FieldGenius dataset',
      detailLines,
    },
    comments: [
      'Imported from FieldGenius raw data',
      `Source file: ${fileLabel}`,
      `Imported points: ${stations.length}`,
      `Imported observations: ${observations.length}`,
    ],
    controlStations: stations,
    observations,
    trace,
  };
};

interface SurveyReportSetupContext {
  occupyId?: string;
  backsightId?: string;
  hiM?: number;
  setupType?: string;
}

const detectTrimbleSurveyReport = (input: string, sourceName?: string): boolean => {
  const fileName = sourceName?.toLowerCase() ?? '';
  const looksLikeHtml =
    fileName.endsWith('.htm') || fileName.endsWith('.html') || /<html\b/i.test(input);
  if (!looksLikeHtml) return false;
  return (
    /<title>\s*Survey Report\s*<\/title>/i.test(input) &&
    /Collected Field Data/i.test(input) &&
    /Station setup/i.test(input) &&
    /Orientation/i.test(input) &&
    /<th\b[^>]*>\s*HA\s*<\/th>/i.test(input) &&
    /<th\b[^>]*>\s*VA\s*<\/th>/i.test(input) &&
    /<th\b[^>]*>\s*SD\s*<\/th>/i.test(input)
  );
};

const parseTrimbleSurveyReport = (
  input: string,
  sourceName?: string,
  _options?: ExternalImportParseOptions,
): ImportedDataset | null => {
  if (!detectTrimbleSurveyReport(input, sourceName)) return null;

  const resolveSourceLine = buildLineNumberResolver(input);
  const trace: ImportedTraceEntry[] = [];
  const stationMap = new Map<string, ImportedControlStationRecord>();
  const observations: ImportedObservationRecord[] = [];
  const fileLabel = sourceLeaf(sourceName);
  const tables = extractHtmlTables(input);
  let currentSetup: SurveyReportSetupContext = {};

  tables.forEach((table) => {
    if (table.rows.length === 0) return;
    const sourceLine = resolveSourceLine(table.index);

    if (table.caption === 'Station setup') {
      const values = tableRowPairsToMap(table.rows[0] ?? []);
      const rawStation = values['Station'];
      if (rawStation) {
        currentSetup = {
          occupyId: sanitizeStationId(rawStation),
          hiM: parseSurveyReportLinear(values['Instrument height']),
          setupType: values['Station type'] || undefined,
          backsightId: currentSetup.backsightId,
        };
      }
      return;
    }

    if (table.caption === 'Orientation') {
      const values = tableRowPairsToMap(table.rows[0] ?? []);
      const rawStation = values['Station'];
      const rawBacksight = values['Backsight point'];
      if (rawStation) {
        currentSetup.occupyId = sanitizeStationId(rawStation);
      }
      currentSetup.backsightId = rawBacksight ? sanitizeStationId(rawBacksight) : undefined;
      return;
    }

    const firstRow = table.rows[0] ?? [];
    const firstRowMap = tableRowPairsToMap(firstRow);
    const firstLabels = new Set(firstRow.filter((_, index) => index % 2 === 0));

    if (firstLabels.has('Point') && firstLabels.has('North') && firstLabels.has('East')) {
      const stationId = sanitizeStationId(firstRowMap['Point']);
      const northM = parseSurveyReportLinear(firstRowMap['North']);
      const eastM = parseSurveyReportLinear(firstRowMap['East']);
      if (!stationId || northM == null || eastM == null) {
        trace.push({
          level: 'warning',
          sourceLine,
          sourceCode: 'Point',
          message:
            'Survey report point table was skipped because Point/North/East could not be resolved.',
        });
        return;
      }
      const candidate: ImportedControlStationRecord = {
        kind: 'control-station',
        coordinateMode: 'local',
        stationId,
        northM,
        eastM,
        heightM: parseSurveyReportLinear(firstRowMap['Elevation']) ?? 0,
        description: firstRowMap['Code'] || undefined,
        sourceLine,
        sourceCode: 'Point',
      };
      stationMap.set(stationId, choosePreferredStation(stationMap.get(stationId), candidate));
      return;
    }

    const pointLabel = firstRow.find((cell) => /^Point(?:\s*\(B\.S\.\))?$/i.test(cell));
    if (pointLabel && firstLabels.has('HA') && firstLabels.has('VA') && firstLabels.has('SD')) {
      const targetRaw = firstRow[1];
      if (!currentSetup.occupyId || !targetRaw) {
        trace.push({
          level: 'warning',
          sourceLine,
          sourceCode: 'Shot',
          message: 'Survey report shot was skipped because no active station setup was available.',
        });
        return;
      }

      const stdErrorRow = table.rows[1] ?? [];
      const thirdRow = table.rows[2] ?? [];
      const values = tableRowPairsToMap(firstRow);
      const thirdValues = tableRowPairsToMap(thirdRow);
      const targetId = sanitizeStationId(targetRaw);
      const angleDeg = parseDmsAngleDegrees(values['HA'] ?? '');
      const distanceM = parseSurveyReportLinear(values['SD']);
      const zenithDeg = parseDmsAngleDegrees(values['VA'] ?? '');
      const htM = parseSurveyReportLinear(thirdValues['Target height']);
      const classification =
        /B\.S\./i.test(pointLabel) || targetId === currentSetup.backsightId
          ? 'BackSight'
          : undefined;
      const raw = [firstRow.join(' | '), stdErrorRow.join(' | '), thirdRow.join(' | ')].join(
        ' || ',
      );

      appendImportedObservationBundle({
        observations,
        trace,
        sourceLine,
        sourceCode: 'Shot',
        occupyId: currentSetup.occupyId,
        targetId,
        backsightId: currentSetup.backsightId,
        angleDeg,
        distanceM,
        distanceMode: distanceM != null ? 'slope' : undefined,
        verticalMode: zenithDeg != null ? 'zenith' : undefined,
        verticalValue: zenithDeg,
        hiM: currentSetup.hiM,
        htM,
        raw,
        tracePrefix: 'Survey report shot',
        sourceMeta: {
          classification,
          setupType: currentSetup.setupType,
        },
      });
    }
  });

  const controlStations = [...stationMap.values()];
  if (controlStations.length === 0 && observations.length === 0) return null;

  const detailLines = [
    `Imported ${plural(controlStations.length, 'point')} and ${plural(observations.length, 'observation')} from ${fileLabel} into normalized WebNet input.`,
  ];
  const traceDetail = buildTraceDetailLine(trace);
  if (traceDetail) detailLines.push(traceDetail);

  return {
    importerId: 'trimble-survey-report',
    formatLabel: 'Trimble survey report',
    summary: `Imported survey report with ${plural(controlStations.length, 'point')} and ${plural(observations.length, 'observation')}`,
    notice: {
      title: 'Imported survey report dataset',
      detailLines,
    },
    comments: [
      'Imported from Trimble survey report HTML',
      `Source file: ${fileLabel}`,
      `Imported points: ${controlStations.length}`,
      `Imported observations: ${observations.length}`,
    ],
    controlStations,
    observations,
    trace,
  };
};

interface DbxSetupContext {
  occupyId?: string;
  backsightId?: string;
  hiM?: number;
}

const detectDbxTextExport = (input: string, sourceName?: string): boolean => {
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

const parseDbxTextExport = (input: string, sourceName?: string): ImportedDataset | null => {
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
      trace.push({
        level: 'warning',
        sourceLine,
        sourceCode: 'Point',
        message: 'Skipped DBX point without a usable point name.',
      });
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
    const occupyId = extractXmlText(block, [
      'OccupyPoint',
      'OccupyPointID',
      'SetupPoint',
      'FromPoint',
    ]);
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
    const targetRaw = extractXmlText(block, [
      'TargetPoint',
      'ToPoint',
      'PointName',
      'PointID',
      'TargetID',
    ]);
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
        message:
          'DBX observation was skipped because occupy or target point could not be resolved.',
      });
      return;
    }

    const hiM =
      extractXmlNumber(block, ['InstrumentHeight', 'HI', 'InstHeight']) ?? setupContext?.hiM;
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

export const convertOpusReportToWebNetInput = (opus: OpusImportResult): string =>
  convertImportedDatasetToWebNetInput(buildOpusImportedDataset(opus));

const dbxImporter: ExternalInputImporter = {
  id: 'dbx-export',
  formatLabel: 'DBX text export',
  detect: (input, sourceName) => detectDbxTextExport(input, sourceName),
  parse: (input, sourceName) => parseDbxTextExport(input, sourceName),
};

const jobXmlImporter: ExternalInputImporter = {
  id: 'jobxml',
  formatLabel: 'JobXML field data',
  detect: (input, sourceName) => detectJobXml(input, sourceName),
  parse: (input, sourceName, options) => parseJobXml(input, sourceName, options),
};

const trimbleSurveyReportImporter: ExternalInputImporter = {
  id: 'trimble-survey-report',
  formatLabel: 'Trimble survey report',
  detect: (input, sourceName) => detectTrimbleSurveyReport(input, sourceName),
  parse: (input, sourceName, options) => parseTrimbleSurveyReport(input, sourceName, options),
};

const carlsonImporter: ExternalInputImporter = {
  id: 'carlson-rw5',
  formatLabel: 'Carlson RW5 field data',
  detect: (input, sourceName) => detectCarlsonRw5(input, sourceName),
  parse: (input, sourceName) => parseRw5Dataset(input, sourceName, 'carlson'),
};

const tdsImporter: ExternalInputImporter = {
  id: 'tds-raw',
  formatLabel: 'TDS raw field data',
  detect: (input, sourceName) => detectTdsRaw(input, sourceName),
  parse: (input, sourceName) => parseRw5Dataset(input, sourceName, 'tds'),
};

const fieldGeniusImporter: ExternalInputImporter = {
  id: 'fieldgenius-raw',
  formatLabel: 'FieldGenius raw field data',
  detect: (input, sourceName) => detectFieldGeniusRaw(input, sourceName),
  parse: (input, sourceName) => parseFieldGenius(input, sourceName),
};

const opusImporter: ExternalInputImporter = {
  id: 'opus-report',
  formatLabel: 'NGS OPUS solution report',
  detect: (input) => detectOpusReport(input),
  parse: (input, sourceName) => {
    const opus = parseOpusReport(input, sourceName);
    return opus ? buildOpusImportedDataset(opus) : null;
  },
};

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
