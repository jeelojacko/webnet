import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { importExternalInput } from '../src/engine/importers';
import { buildImportReviewModel, buildImportReviewText } from '../src/engine/importReview';

const jobXmlTrimbleFixture = readFileSync(
  'tests/fixtures/jobxml_trimble_station_setup_sample.jxl',
  'utf-8',
);

describe('import review workflow', () => {
  it('builds grouped review rows and clean import text without source trace comments', () => {
    const imported = importExternalInput(
      jobXmlTrimbleFixture,
      'jobxml_trimble_station_setup_sample.jxl',
    );
    expect(imported.dataset).toBeDefined();

    const reviewModel = buildImportReviewModel(imported.dataset!);
    expect(reviewModel.groups.map((group) => group.label)).toEqual(['Control', 'Setup 1']);
    expect(reviewModel.items).toHaveLength(6);
    expect(reviewModel.warnings).toHaveLength(0);
    expect(reviewModel.errors).toHaveLength(0);

    const includedItemIds = new Set(
      reviewModel.items
        .filter((item) => !item.importedData.includes('CHK1'))
        .map((item) => item.id),
    );

    const text = buildImportReviewText(imported.dataset!, reviewModel, {
      includedItemIds,
      groupComments: {
        control: 'CONTROL',
        'setup:1': 'SETUP 1',
      },
    });

    expect(text).toContain('.UNITS M');
    expect(text).toContain('.ORDER EN');
    expect(text).toContain('# CONTROL');
    expect(text).toContain('# SETUP 1');
    expect(text).toContain('C 1000 0.9957 2.0628 0.0000');
    expect(text).toContain('M 1-1000-2 286-51-24.7 22.2574 89.9566 1.6500/1.6920');
    expect(text).not.toContain('CHK1');
    expect(text).not.toContain('source line');
    expect(text).not.toContain('# Import Trace');
  });
});
