import type { ExternalInputImporter, ImportedDataset, OpusImportResult } from '../importers';
import {
  buildOpusImportedDataset,
  convertImportedDatasetToWebNetInput,
  deriveStationId,
  extractFirstLine,
  extractLineValue,
  parseCorrelationLine,
  parseHeightLine,
  parseLatitudeLine,
  parseLongitudeLine,
} from './shared';

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

export const convertOpusReportToWebNetInput = (opus: OpusImportResult): string =>
  convertImportedDatasetToWebNetInput(buildOpusImportedDataset(opus));

export const opusImporter: ExternalInputImporter = {
  id: 'opus-report',
  formatLabel: 'NGS OPUS solution report',
  detect: (input) => detectOpusReport(input),
  parse: (input, sourceName): ImportedDataset | null => {
    const opus = parseOpusReport(input, sourceName);
    return opus ? buildOpusImportedDataset(opus) : null;
  },
};
