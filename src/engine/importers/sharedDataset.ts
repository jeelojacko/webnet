import {
  serializeImportedControlStationRecord,
  serializeImportedObservationRecord,
} from '../importedRecordSerialization';
import type {
  ImportedDataset,
  ImportedRecordBase,
  OpusImportMetadata,
  OpusImportResult,
} from '../importers';
import { formatNumber } from './sharedText';

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

const buildRecordComment = (record: ImportedRecordBase): string | null => {
  if (record.sourceLine == null && !record.sourceCode && !record.note) return null;
  const parts: string[] = ['Imported source'];
  if (record.sourceLine != null) parts.push(`line ${record.sourceLine}`);
  if (record.sourceCode) parts.push(`[${record.sourceCode}]`);
  if (record.note) parts.push(record.note);
  return `# ${parts.join(' ')}`;
};

const opusSolutionLabel = (solutionType: OpusImportMetadata['solutionType']): string =>
  solutionType.toUpperCase();
