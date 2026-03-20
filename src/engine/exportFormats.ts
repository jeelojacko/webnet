import type { ProjectExportFormat } from '../types';

export interface ExportFormatMetadata {
  value: ProjectExportFormat;
  optionLabel: string;
  label: string;
  extension: string;
  tooltip: string;
}

export const EXPORT_FORMAT_OPTIONS: ExportFormatMetadata[] = [
  {
    value: 'points',
    optionLabel: 'Adjusted points (configured)',
    label: 'Adjusted points',
    extension: 'configured (.csv or .txt)',
    tooltip: 'Adjusted points using the current adjusted-points export settings.',
  },
  {
    value: 'points-csv',
    optionLabel: 'Adjusted points CSV',
    label: 'Adjusted points CSV',
    extension: '.csv',
    tooltip:
      'Adjusted points as a fixed comma-delimited CSV using the current adjusted-points columns, lost-station filter, and transform settings.',
  },
  {
    value: 'observations-csv',
    optionLabel: 'Observations & residuals CSV',
    label: 'Observations & residuals CSV',
    extension: '.csv',
    tooltip:
      'Observation-by-observation CSV with source metadata, observed/calculated values, residuals, standardized residuals, redundancy, and local-test fields.',
  },
  {
    value: 'geojson',
    optionLabel: 'GeoJSON network',
    label: 'GeoJSON network',
    extension: '.geojson',
    tooltip:
      'GeoJSON FeatureCollection of adjusted stations and network connections with precision metadata for browser-first GIS review.',
  },
  {
    value: 'webnet',
    optionLabel: 'WebNet',
    label: 'WebNet text report',
    extension: '.txt',
    tooltip: 'Full WebNet text report.',
  },
  {
    value: 'industry-style',
    optionLabel: 'Industry-style listing',
    label: 'Industry-style listing',
    extension: '.txt',
    tooltip: 'Industry-style listing output.',
  },
  {
    value: 'landxml',
    optionLabel: 'LandXML',
    label: 'LandXML 1.2',
    extension: '.xml',
    tooltip: 'LandXML 1.2 export.',
  },
  {
    value: 'bundle-qa-standard',
    optionLabel: 'QA bundle',
    label: 'QA bundle',
    extension: 'multiple files',
    tooltip:
      'QA bundle containing WebNet report, industry listing, adjusted points, and comparison summary when available.',
  },
  {
    value: 'bundle-qa-standard-with-landxml',
    optionLabel: 'QA bundle + LandXML',
    label: 'QA bundle + LandXML',
    extension: 'multiple files',
    tooltip:
      'QA bundle containing WebNet report, industry listing, adjusted points, comparison summary when available, and LandXML.',
  },
];

export const getExportFormatMetadata = (format: ProjectExportFormat): ExportFormatMetadata =>
  EXPORT_FORMAT_OPTIONS.find((option) => option.value === format) ?? EXPORT_FORMAT_OPTIONS[0];
