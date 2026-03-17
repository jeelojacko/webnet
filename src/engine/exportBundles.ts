export type ExportBundlePreset = 'qa-standard' | 'qa-standard-with-landxml';

export interface ExportBundleFile {
  name: string;
  mimeType: string;
  text: string;
}

export interface BuildExportBundleFilesOptions {
  preset: ExportBundlePreset;
  dateStamp: string;
  adjustedPointsExtension: 'txt' | 'csv';
  webnetText: string;
  industryListingText: string;
  adjustedPointsText: string;
  comparisonText?: string | null;
  landXmlText?: string | null;
}

export const buildExportBundleFiles = (
  options: BuildExportBundleFilesOptions,
): ExportBundleFile[] => {
  const prefix = `webnet-qa-bundle-${options.dateStamp}`;
  const files: ExportBundleFile[] = [
    {
      name: `${prefix}-webnet-report.txt`,
      mimeType: 'text/plain',
      text: options.webnetText,
    },
    {
      name: `${prefix}-industry-listing.txt`,
      mimeType: 'text/plain',
      text: options.industryListingText,
    },
    {
      name: `${prefix}-adjusted-points.${options.adjustedPointsExtension}`,
      mimeType: options.adjustedPointsExtension === 'csv' ? 'text/csv' : 'text/plain',
      text: options.adjustedPointsText,
    },
  ];
  if (options.comparisonText) {
    files.unshift({
      name: `${prefix}-comparison-summary.txt`,
      mimeType: 'text/plain',
      text: options.comparisonText,
    });
  }
  if (options.preset === 'qa-standard-with-landxml' && options.landXmlText) {
    files.push({
      name: `${prefix}-network.xml`,
      mimeType: 'application/xml',
      text: options.landXmlText,
    });
  }
  return files;
};
