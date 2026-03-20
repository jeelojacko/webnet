import {
  buildAdjustedPointsExportText,
  cloneAdjustedPointsExportSettings,
} from './adjustedPointsExport';
import { buildNetworkGeoJsonText, buildObservationsResidualsCsvText } from './browserExports';
import { buildExportBundleFiles } from './exportBundles';
import { createRunOutputBuilders } from './runOutputBuilders';
import { createRunResultsTextBuilder } from './runResultsTextBuilder';
import type { ParseSettings, RunDiagnostics, SettingsState } from '../appStateTypes';
import type {
  AdjustmentResult,
  AdjustedPointsExportSettings,
  CustomLevelLoopTolerancePreset,
  ProjectExportFormat,
} from '../types';

export interface ExportArtifactFile {
  name: string;
  mimeType: string;
  text: string;
}

export interface BuildExportArtifactsRequest {
  exportFormat: ProjectExportFormat;
  dateStamp: string;
  result: AdjustmentResult;
  units: 'm' | 'ft';
  settings: SettingsState;
  parseSettings: ParseSettings;
  runDiagnostics: RunDiagnostics;
  adjustedPointsExportSettings: AdjustedPointsExportSettings;
  levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
  currentComparisonText: string;
}

export interface BuildExportArtifactsResult {
  files: ExportArtifactFile[];
  noticeTitle?: string;
  noticeLines?: string[];
}

const neverCalledRunDiagnosticsBuilder = (
  _base: ParseSettings,
  _solved?: AdjustmentResult,
): RunDiagnostics => {
  throw new Error('buildRunDiagnostics fallback should not be called during artifact export.');
};

export const buildExportArtifacts = (
  request: BuildExportArtifactsRequest,
): BuildExportArtifactsResult => {
  const {
    adjustedPointsExportSettings,
    currentComparisonText,
    dateStamp,
    exportFormat,
    levelLoopCustomPresets,
    parseSettings,
    result,
    runDiagnostics,
    settings,
    units,
  } = request;
  const { buildResultsText } = createRunResultsTextBuilder({
    settings,
    parseSettings,
    runDiagnostics,
    levelLoopCustomPresets,
    buildRunDiagnostics: neverCalledRunDiagnosticsBuilder,
  });
  const { buildIndustryListingText, buildLandXmlExportText } = createRunOutputBuilders({
    settings,
    parseSettings,
    runDiagnostics,
    buildRunDiagnostics: neverCalledRunDiagnosticsBuilder,
  });
  const buildSingleFile = (file: ExportArtifactFile): BuildExportArtifactsResult => ({
    files: [file],
  });

  if (exportFormat === 'points' || exportFormat === 'points-csv') {
    const effectiveSettings =
      exportFormat === 'points-csv'
        ? {
            ...cloneAdjustedPointsExportSettings(adjustedPointsExportSettings),
            format: 'csv' as const,
            delimiter: 'comma' as const,
          }
        : adjustedPointsExportSettings;
    const extension = effectiveSettings.format === 'csv' ? 'csv' : 'txt';
    return buildSingleFile({
      name: `webnet-adjusted-points-${dateStamp}.${extension}`,
      mimeType: effectiveSettings.format === 'csv' ? 'text/csv' : 'text/plain',
      text: buildAdjustedPointsExportText({
        result,
        units,
        settings: effectiveSettings,
      }),
    });
  }

  if (exportFormat === 'observations-csv') {
    return buildSingleFile({
      name: `webnet-observations-residuals-${dateStamp}.csv`,
      mimeType: 'text/csv',
      text: buildObservationsResidualsCsvText({
        result,
        units,
      }),
    });
  }

  if (exportFormat === 'geojson') {
    return buildSingleFile({
      name: `webnet-network-${dateStamp}.geojson`,
      mimeType: 'application/geo+json',
      text: buildNetworkGeoJsonText({
        result,
        units,
        includeLostStations: adjustedPointsExportSettings.includeLostStations,
      }),
    });
  }

  if (exportFormat === 'webnet') {
    return buildSingleFile({
      name: `webnet-results-${dateStamp}.txt`,
      mimeType: 'text/plain',
      text: buildResultsText(result),
    });
  }

  if (exportFormat === 'industry-style') {
    return buildSingleFile({
      name: `industry-style-listing-${dateStamp}.txt`,
      mimeType: 'text/plain',
      text: buildIndustryListingText(result),
    });
  }

  if (exportFormat === 'landxml') {
    return buildSingleFile({
      name: `webnet-landxml-${dateStamp}.xml`,
      mimeType: 'application/xml',
      text: buildLandXmlExportText(result),
    });
  }

  const adjustedPointsText = buildAdjustedPointsExportText({
    result,
    units,
    settings: adjustedPointsExportSettings,
  });
  const files = buildExportBundleFiles({
    preset: exportFormat === 'bundle-qa-standard' ? 'qa-standard' : 'qa-standard-with-landxml',
    dateStamp,
    adjustedPointsExtension: adjustedPointsExportSettings.format === 'csv' ? 'csv' : 'txt',
    webnetText: buildResultsText(result),
    industryListingText: buildIndustryListingText(result),
    adjustedPointsText,
    comparisonText: currentComparisonText || null,
    landXmlText:
      exportFormat === 'bundle-qa-standard-with-landxml' ? buildLandXmlExportText(result) : null,
  });
  return {
    files,
    noticeTitle: 'QA bundle exported',
    noticeLines: files.map((file) => `Downloaded ${file.name}`),
  };
};
