import { describe, expect, it } from 'vitest';

import { buildExportBundleFiles } from '../src/engine/exportBundles';

describe('export bundle builder', () => {
  it('builds deterministic QA bundle file lists with optional comparison and LandXML', () => {
    const files = buildExportBundleFiles({
      preset: 'qa-standard-with-landxml',
      dateStamp: '2026-03-17',
      adjustedPointsExtension: 'csv',
      webnetText: 'webnet',
      industryListingText: 'industry',
      adjustedPointsText: 'points',
      comparisonText: 'compare',
      landXmlText: '<LandXML />',
    });

    expect(files.map((file) => file.name)).toEqual([
      'webnet-qa-bundle-2026-03-17-comparison-summary.txt',
      'webnet-qa-bundle-2026-03-17-webnet-report.txt',
      'webnet-qa-bundle-2026-03-17-industry-listing.txt',
      'webnet-qa-bundle-2026-03-17-adjusted-points.csv',
      'webnet-qa-bundle-2026-03-17-network.xml',
    ]);
  });
});
