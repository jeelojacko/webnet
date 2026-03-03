import { DEG_TO_RAD, radToDmsStr } from './angles';

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

export interface ImportedRecordBase {
  sourceLine?: number;
  sourceCode?: string;
  description?: string;
  note?: string;
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

export interface ExternalInputImporter {
  id: string;
  formatLabel: string;
  detect: (_input: string, _sourceName?: string) => boolean;
  parse: (_input: string, _sourceName?: string) => ImportedDataset | null;
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

const toDmsString = (valueDeg: number): string => radToDmsStr(valueDeg * DEG_TO_RAD);

const decodeXmlEntities = (value: string): string =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const lineNumberAtIndex = (input: string, index: number): number =>
  input.slice(0, Math.max(0, index)).split(/\r?\n/).length;

const plural = (count: number, label: string): string => `${count} ${label}${count === 1 ? '' : 's'}`;

const buildTraceSummary = (trace: ImportedTraceEntry[]): { warnings: number; errors: number } => ({
  warnings: trace.filter((entry) => entry.level === 'warning').length,
  errors: trace.filter((entry) => entry.level === 'error').length,
});

const sourceLeaf = (sourceName?: string): string =>
  sourceName?.replace(/\\/g, '/').split('/').pop() ?? 'imported file';

const appendDescription = (line: string, description?: string): string =>
  description ? `${line} '${description.replace(/'/g, '')}` : line;

const formatHiHt = (hiM?: number, htM?: number): string | undefined =>
  hiM != null || htM != null
    ? `${formatNumber(hiM ?? 0, 4)}/${formatNumber(htM ?? 0, 4)}`
    : undefined;

const buildRecordComment = (record: ImportedRecordBase): string | null => {
  if (record.sourceLine == null && !record.sourceCode && !record.note) return null;
  const parts: string[] = ['Imported source'];
  if (record.sourceLine != null) parts.push(`line ${record.sourceLine}`);
  if (record.sourceCode) parts.push(`[${record.sourceCode}]`);
  if (record.note) parts.push(record.note);
  return `# ${parts.join(' ')}`;
};

const serializeControlStationRecord = (station: ImportedControlStationRecord): string => {
  if (station.coordinateMode === 'geodetic') {
    const recordType = station.heightDatum === 'ellipsoid' ? 'PH' : 'P';
    const tokens = [
      recordType,
      station.stationId,
      formatNumber(station.latitudeDeg ?? 0, 9),
      formatNumber(station.longitudeDeg ?? 0, 9),
      formatNumber(station.heightM ?? 0, 4),
    ];
    if (
      station.sigmaNorthM != null ||
      station.sigmaEastM != null ||
      station.sigmaHeightM != null ||
      station.corrEN != null
    ) {
      tokens.push(
        formatNumber(station.sigmaNorthM ?? 0, 4),
        formatNumber(station.sigmaEastM ?? 0, 4),
        formatNumber(station.sigmaHeightM ?? 0, 4),
        formatNumber(station.corrEN ?? 0, 4),
      );
    }
    return appendDescription(tokens.join(' '), station.description);
  }

  const tokens = [
    'C',
    station.stationId,
    formatNumber(station.eastM ?? 0, 4),
    formatNumber(station.northM ?? 0, 4),
    formatNumber(station.heightM ?? 0, 4),
  ];
  if (
    station.sigmaEastM != null ||
    station.sigmaNorthM != null ||
    station.sigmaHeightM != null ||
    station.corrEN != null
  ) {
    tokens.push(
      formatNumber(station.sigmaEastM ?? 0, 4),
      formatNumber(station.sigmaNorthM ?? 0, 4),
      formatNumber(station.sigmaHeightM ?? 0, 4),
      formatNumber(station.corrEN ?? 0, 4),
    );
  }
  return appendDescription(tokens.join(' '), station.description);
};

const serializeObservationRecord = (observation: ImportedObservationRecord): string[] => {
  if (observation.kind === 'gnss-vector') {
    const tokens = [
      'G',
      observation.fromId,
      observation.toId,
      formatNumber(observation.deltaEastM, 4),
      formatNumber(observation.deltaNorthM, 4),
    ];
    if (observation.deltaHeightM != null) {
      tokens.push(
        formatNumber(observation.deltaHeightM, 4),
        formatNumber(observation.sigmaEastM ?? 0, 4),
        formatNumber(observation.sigmaNorthM ?? 0, 4),
        formatNumber(observation.sigmaHeightM ?? 0, 4),
        formatNumber(observation.corrEN ?? 0, 4),
      );
    } else {
      tokens.push(formatNumber(observation.sigmaEastM ?? observation.sigmaNorthM ?? 0, 4));
    }
    return [tokens.join(' ')];
  }

  if (observation.kind === 'distance') {
    const tokens = [
      'D',
      observation.fromId,
      observation.toId,
      formatNumber(observation.distanceM, 4),
    ];
    const hiHt = formatHiHt(observation.hiM, observation.htM);
    if (hiHt) tokens.push(hiHt);
    return [tokens.join(' ')];
  }

  if (observation.kind === 'distance-vertical') {
    const tokens = [
      'DV',
      observation.fromId,
      observation.toId,
      formatNumber(observation.distanceM, 4),
      formatNumber(observation.verticalValue, 4),
    ];
    const hiHt = formatHiHt(observation.hiM, observation.htM);
    if (hiHt) tokens.push(hiHt);
    return [observation.verticalMode === 'delta-h' ? '.DELTA ON' : '.DELTA OFF', tokens.join(' ')];
  }

  if (observation.kind === 'bearing') {
    return [
      ['B', observation.fromId, observation.toId, formatNumber(observation.bearingDeg, 4)].join(' '),
    ];
  }

  if (observation.kind === 'angle') {
    return [
      ['A', `${observation.atId}-${observation.fromId}-${observation.toId}`, toDmsString(observation.angleDeg)].join(
        ' ',
      ),
    ];
  }

  if (observation.kind === 'measurement') {
    const tokens = [
      'M',
      `${observation.atId}-${observation.fromId}-${observation.toId}`,
      toDmsString(observation.angleDeg),
      formatNumber(observation.distanceM, 4),
    ];
    if (observation.verticalMode && observation.verticalValue != null) {
      tokens.push(formatNumber(observation.verticalValue, 4));
    }
    const hiHt = formatHiHt(observation.hiM, observation.htM);
    if (hiHt) tokens.push(hiHt);
    return [
      observation.verticalMode === 'delta-h' ? '.DELTA ON' : '.DELTA OFF',
      tokens.join(' '),
    ];
  }

  return [];
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
    lines.push(serializeControlStationRecord(station));
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

    serializeObservationRecord(observation).forEach((line) => {
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

const matchXmlBlocks = (
  input: string,
  tagName: string,
): { block: string; index: number }[] => {
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

interface JobXmlSetupContext {
  occupyId?: string;
  backsightId?: string;
  backsightRecordRef?: string;
  hiM?: number;
}

interface JobXmlBacksightContext {
  stationId?: string;
  horizontalCircleDeg?: number;
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

const detectJobXml = (input: string, sourceName?: string): boolean => {
  const fileName = sourceName?.toLowerCase() ?? '';
  const looksXml = /^\s*<\?xml\b|^\s*<\w+/i.test(input);
  const hasJobTags =
    /<JOBFile\b/i.test(input) ||
    /<FieldBook\b/i.test(input) ||
    /<Reductions\b/i.test(input) ||
    /<PointRecord\b/i.test(input);
  return (
    (fileName.endsWith('.jxl') || fileName.endsWith('.jobxml') || fileName.endsWith('.xml') || looksXml) &&
    hasJobTags
  );
};

const parseJobXml = (input: string, sourceName?: string): ImportedDataset | null => {
  if (!detectJobXml(input, sourceName)) return null;

  const trace: ImportedTraceEntry[] = [];
  const stationMap = new Map<string, ImportedControlStationRecord>();
  const pointRefLookup = new Map<string, string>();
  const setupContexts = new Map<string, JobXmlSetupContext>();
  const backsightContexts = new Map<string, JobXmlBacksightContext>();
  const targetContexts = new Map<string, JobXmlTargetContext>();
  const observations: ImportedObservationRecord[] = [];
  const pointBlocks = matchXmlBlocks(input, 'PointRecord');
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

  pointBlocks.forEach(({ block, index }) => {
    const sourceLine = lineNumberAtIndex(input, index);
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
    ]);

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

    if (looksLikeMeasurement) {
      measurementBlocks.push({ block, index });
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
    const hiM = extractXmlNumber(block, ['InstrumentHeight', 'HI', 'IH', 'InstHeight']);
    const backsightRecordRef = extractXmlText(block, ['BackBearingID', 'BackBearingRecordID']);
    const backsightId = resolveJobXmlPointFromBlock(
      block,
      ['BackSightPointID', 'BacksightPointID', 'BackBearingPointID'],
      ['BacksightName', 'BackSightName'],
      pointRefLookup,
      stationMap,
    );
    setupContexts.set(xmlId, { occupyId, backsightId, backsightRecordRef, hiM });
  });

  matchXmlBlocks(input, 'BackBearingRecord').forEach(({ block }) => {
    const xmlId = extractXmlAttribute(block, ['ID', 'Id']);
    if (!xmlId) return;
    const stationId = resolveJobXmlPointFromBlock(
      block,
      ['PointID', 'PointRecordID', 'BackSightPointID', 'BacksightPointID', 'TargetPointID'],
      ['Name', 'PointName', 'PointNumber', 'BacksightName', 'BackSightName'],
      pointRefLookup,
      stationMap,
    );
    const horizontalCircleDeg = extractXmlNumber(block, ['HorizontalCircle', 'Hz']);
    const bearingDeg = extractXmlNumber(block, ['Azimuth', 'Bearing', 'BackBearing']);
    backsightContexts.set(xmlId, { stationId, horizontalCircleDeg, bearingDeg });
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
    const sourceLine = lineNumberAtIndex(input, index);
    const rawName = extractXmlText(block, ['Name', 'PointName', 'PointNumber', 'PointID']);
    const fallbackTargetId = rawName ? sanitizeStationId(rawName) : undefined;
    const stationRecordRef = extractXmlText(block, ['StationRecordID', 'StationID']);
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

    const targetRecordRef = extractXmlText(block, ['TargetID', 'TargetRecordID']);
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

    const backBearingRef =
      extractXmlText(block, ['BackBearingID', 'BackBearingRecordID']) ??
      setupContext?.backsightRecordRef;
    const backsightContext = backBearingRef ? backsightContexts.get(backBearingRef) : undefined;
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
      extractXmlNumber(block, ['InstrumentHeight', 'HI', 'IH', 'InstHeight']) ?? setupContext?.hiM;
    const htM =
      extractXmlNumber(block, ['TargetHeight', 'PrismHeight', 'RodHeight', 'HT']) ?? targetContext?.htM;
    const horizontalCircleDeg = extractXmlNumber(block, ['HorizontalCircle', 'Hz']);
    const explicitAngleDeg = extractXmlNumber(block, ['HorizontalAngle', 'TurnedAngle']);
    const explicitBearingDeg = extractXmlNumber(block, ['Azimuth', 'Bearing']);
    const distanceM = extractXmlNumber(block, [
      'EDMDistance',
      'SlopeDistance',
      'Distance',
      'HorizontalDistance',
    ]);
    const zenithDeg = extractXmlNumber(block, ['VerticalCircle', 'ZenithAngle', 'Zenith']);
    const deltaHM = extractXmlNumber(block, ['DeltaHeight', 'VerticalDistance', 'DeltaH']);

    const derivedAngleDeg =
      explicitAngleDeg != null
        ? normalizeAngleDeg(explicitAngleDeg)
        : horizontalCircleDeg != null && backsightContext?.horizontalCircleDeg != null
          ? normalizeAngleDeg(horizontalCircleDeg - backsightContext.horizontalCircleDeg)
          : undefined;
    const derivedBearingDeg =
      explicitBearingDeg != null
        ? normalizeAngleDeg(explicitBearingDeg)
        : horizontalCircleDeg != null &&
            backsightContext?.horizontalCircleDeg != null &&
            backsightContext.bearingDeg != null
          ? normalizeAngleDeg(
              backsightContext.bearingDeg -
                backsightContext.horizontalCircleDeg +
                horizontalCircleDeg,
            )
          : undefined;

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
        });
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
      message: `JobXML measurement-style point ${targetId ?? fallbackTargetId ?? 'UNKNOWN'} was not converted because no reduced coordinates were present.`,
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

interface ParsedFieldGeniusLine {
  code: string;
  fields: Record<string, string>;
  raw: string;
}

const normalizeFieldKey = (value: string): string => value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

const parseFieldGeniusLine = (line: string): ParsedFieldGeniusLine | null => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#') || trimmed.startsWith('//')) {
    return null;
  }
  if (/^FIELDGENIUS\b/i.test(trimmed) && !trimmed.includes(',')) {
    return null;
  }
  const tokens = trimmed.split(/\s*,\s*/).map((token) => token.trim()).filter(Boolean);
  if (tokens.length === 0) return null;
  const code = tokens[0].toUpperCase();
  const fields: Record<string, string> = {};
  const positional: string[] = [];

  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    const eqIndex = token.indexOf('=');
    const colonIndex = token.indexOf(':');
    const sepIndex =
      eqIndex >= 0 && colonIndex >= 0 ? Math.min(eqIndex, colonIndex) : Math.max(eqIndex, colonIndex);
    if (sepIndex > 0) {
      const key = normalizeFieldKey(token.slice(0, sepIndex));
      const value = token.slice(sepIndex + 1).trim();
      if (key) fields[key] = value;
      continue;
    }

    if (/^[A-Za-z][A-Za-z0-9_]*$/.test(token) && i + 1 < tokens.length) {
      const next = tokens[i + 1];
      if (!/[=:]/.test(next)) {
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
  const lines = input.split(/\r?\n/).slice(0, 20);
  const recognized = lines
    .map((line) => parseFieldGeniusLine(line))
    .filter((row): row is ParsedFieldGeniusLine => row != null && FIELDGENIUS_RECORD_CODES.has(row.code))
    .length;
  return fileName.endsWith('.raw') || /FIELDGENIUS/i.test(input) || recognized >= 2;
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
  const heightM =
    pickNumberField(fields, ['Z', 'EL', 'ELEV', 'ELEVATION', 'H', 'HEIGHT']) ?? 0;
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

export const convertOpusReportToWebNetInput = (opus: OpusImportResult): string =>
  convertImportedDatasetToWebNetInput(buildOpusImportedDataset(opus));

const jobXmlImporter: ExternalInputImporter = {
  id: 'jobxml',
  formatLabel: 'JobXML field data',
  detect: (input, sourceName) => detectJobXml(input, sourceName),
  parse: (input, sourceName) => parseJobXml(input, sourceName),
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

const REGISTERED_IMPORTERS: ExternalInputImporter[] = [jobXmlImporter, fieldGeniusImporter, opusImporter];

export const getExternalImporters = (): ExternalInputImporter[] => [...REGISTERED_IMPORTERS];

export const importExternalInput = (input: string, sourceName?: string): ImportedInputResult => {
  const importer = REGISTERED_IMPORTERS.find((candidate) => candidate.detect(input, sourceName));
  if (!importer) {
    return {
      detected: false,
      format: 'webnet',
      text: input,
    };
  }

  const dataset = importer.parse(input, sourceName);
  if (!dataset) {
    return {
      detected: false,
      format: 'webnet',
      text: input,
    };
  }

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
