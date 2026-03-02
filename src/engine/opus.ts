export interface OpusCovarianceSummary {
  sigmaNorthM?: number;
  sigmaEastM?: number;
  sigmaHeightM?: number;
  corrEN?: number;
  source: 'report-diagonal' | 'unavailable';
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

export interface ImportedInputResult {
  detected: boolean;
  format: 'webnet' | 'opus-report';
  text: string;
  summary?: string;
  opus?: OpusImportResult;
}

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const extractLineValue = (input: string, label: string): string | undefined => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = input.match(new RegExp(`^\\s*${escaped}\\s*:\\s*(.+)$`, 'im'));
  return match?.[1] ? collapseWhitespace(match[1]) : undefined;
};

const extractFirstLine = (input: string, predicate: (_line: string) => boolean): string | undefined =>
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

const parseLongitudeLine = (line: string | undefined): { value: number; sigmaM?: number } | null => {
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

const sanitizeStationId = (value: string): string => {
  const sanitized = value
    .toUpperCase()
    .replace(/\.[A-Z0-9]+$/i, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return sanitized || 'OPUS_IMPORT';
};

const fileStem = (value: string): string => {
  const normalized = value.replace(/\\/g, '/');
  const leaf = normalized.split('/').pop() ?? normalized;
  return leaf.replace(/\.[^.]+$/, '');
};

const deriveStationId = (sourceFile: string | undefined, reportFileName: string | undefined): string => {
  const preferred = sourceFile ? fileStem(sourceFile) : reportFileName ? fileStem(reportFileName) : '';
  return sanitizeStationId(preferred);
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
      corrEN: 0,
      source: lat.sigmaM != null || lon.sigmaM != null ? 'report-diagonal' : 'unavailable',
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

const formatNumber = (value: number, decimals: number): string => value.toFixed(decimals);

export const convertOpusReportToWebNetInput = (opus: OpusImportResult): string => {
  const recordType = opus.ellipsoidHeightM != null ? 'PH' : 'P';
  const height = opus.ellipsoidHeightM ?? opus.orthometricHeightM ?? 0;
  const sigmaH = opus.sigmaEllipsoidHeightM ?? opus.sigmaOrthometricHeightM ?? 0;
  const comments = [
    `# Imported from NGS ${opus.metadata.solutionType.toUpperCase()} solution report`,
    opus.metadata.reportFileName ? `# Source report: ${opus.metadata.reportFileName}` : '',
    opus.metadata.sourceFile ? `# Source RINEX: ${opus.metadata.sourceFile}` : '',
    opus.metadata.referenceFrame ? `# Reference frame: ${opus.metadata.referenceFrame}` : '',
    opus.metadata.software ? `# Software: ${opus.metadata.software}` : '',
    opus.metadata.geoidModel ? `# Geoid model: ${opus.metadata.geoidModel}` : '',
    opus.orthometricHeightM != null && recordType === 'PH'
      ? `# Orthometric height (informational): ${formatNumber(opus.orthometricHeightM, 4)} m`
      : '',
    `# Covariance import: sigmaN=${formatNumber(opus.sigmaNorthM ?? 0, 4)}m sigmaE=${formatNumber(
      opus.sigmaEastM ?? 0,
      4,
    )}m sigmaH=${formatNumber(sigmaH, 4)}m corrEN=${formatNumber(
      opus.covariance.corrEN ?? 0,
      4,
    )} (${opus.covariance.source})`,
    '',
  ].filter(Boolean);

  const stationLine = [
    recordType,
    opus.stationId,
    formatNumber(opus.latitudeDeg, 9),
    formatNumber(opus.longitudeDeg, 9),
    formatNumber(height, 4),
    formatNumber(opus.sigmaNorthM ?? 0, 4),
    formatNumber(opus.sigmaEastM ?? 0, 4),
    formatNumber(sigmaH, 4),
  ].join(' ');

  return [...comments, stationLine, ''].join('\n');
};

export const importExternalInput = (
  input: string,
  reportFileName?: string,
): ImportedInputResult => {
  const opus = parseOpusReport(input, reportFileName);
  if (!opus) {
    return {
      detected: false,
      format: 'webnet',
      text: input,
    };
  }

  return {
    detected: true,
    format: 'opus-report',
    text: convertOpusReportToWebNetInput(opus),
    summary: `Imported ${opus.metadata.solutionType.toUpperCase()} report as ${opus.stationId}`,
    opus,
  };
};
