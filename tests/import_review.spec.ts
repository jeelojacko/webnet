import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { importExternalInput } from '../src/engine/importers';
import {
  buildImportReviewDisplayTextMap,
  buildImportReviewModel,
  buildImportReviewText,
} from '../src/engine/importReview';

const jobXmlTrimbleFixture = readFileSync(
  'tests/fixtures/jobxml_trimble_station_setup_sample.jxl',
  'utf-8',
);
const jobXmlTrimbleResectionFixture = readFileSync(
  'tests/fixtures/jobxml_trimble_resection_sample.jxl',
  'utf-8',
);

describe('import review workflow', () => {
  it('builds grouped setup rows, preserves raw+MTA shots, and avoids false resection grouping', () => {
    const imported = importExternalInput(
      jobXmlTrimbleFixture,
      'jobxml_trimble_station_setup_sample.jxl',
    );
    expect(imported.dataset).toBeDefined();

    const reviewModel = buildImportReviewModel(imported.dataset!);
    const displayedRows = buildImportReviewDisplayTextMap(
      imported.dataset!,
      reviewModel,
      'clean-webnet',
    );

    expect(reviewModel.groups.map((group) => group.label)).toEqual([
      'Control',
      'Setup 1 (BS 1000)',
    ]);
    expect(reviewModel.items).toHaveLength(10);
    expect(reviewModel.warnings).toHaveLength(0);
    expect(reviewModel.errors).toHaveLength(0);
    expect(reviewModel.groups.some((group) => group.kind === 'resection')).toBe(false);
    expect(reviewModel.items.filter((item) => item.sourceType.includes('MTA')).length).toBeGreaterThan(0);
    expect(reviewModel.items.filter((item) => item.sourceType.includes('Backsight')).length).toBeGreaterThan(0);

    const includedItemIds = new Set(
      reviewModel.items
        .filter((item) => !displayedRows[item.id]?.includes('CHK1'))
        .map((item) => item.id),
    );

    const text = buildImportReviewText(imported.dataset!, reviewModel, {
      includedItemIds,
      groupComments: {
        control: 'CONTROL',
        'setup:1:bs:1000': 'SETUP 1',
      },
      preset: 'clean-webnet',
    });

    expect(text).toContain('.UNITS M');
    expect(text).toContain('.ORDER EN');
    expect(text).toContain('# CONTROL');
    expect(text).toContain('# SETUP 1');
    expect(text).toContain('M 1-1000-1000 000-00-00.0 4.7265 90.0100 1.6500/1.5500');
    expect(text).toContain('M 1-1000-1000 000-00-00.0 4.7265 90.0150 1.6500/1.5500');
    expect(text).toContain('C 1000 0.9957 2.0628 0.0000');
    expect(text).toContain('M 1-1000-2 286-51-24.7 22.2574 89.9566 1.6500/1.6920');
    expect(text).not.toContain('CHK1');
    expect(text).not.toContain('source line');
    expect(text).not.toContain('# Import Trace');
  });

  it('supports ts-direction-set preset and row-level overrides for true resection groups', () => {
    const imported = importExternalInput(jobXmlTrimbleResectionFixture, 'jobxml_trimble_resection_sample.jxl');
    const reviewModel = buildImportReviewModel(imported.dataset!);
    const includedItemIds = new Set(reviewModel.items.map((item) => item.id));
    const displayedRows = buildImportReviewDisplayTextMap(
      imported.dataset!,
      reviewModel,
      'ts-direction-set',
    );

    const targetItem = reviewModel.items.find(
      (item) => displayedRows[item.id] === 'DM 235 090-52-21.0 17.4322 89.9500 1.6500/1.5500',
    );
    expect(targetItem).toBeDefined();

    const text = buildImportReviewText(imported.dataset!, reviewModel, {
      includedItemIds,
      groupComments: {
        control: 'CONTROL',
        'resection:1000:bs:077': 'RESECTION',
      },
      rowOverrides: targetItem
        ? {
            [targetItem.id]: 'DM 235 090-52-25.5 17.4323',
          }
        : {},
      preset: 'ts-direction-set',
    });

    expect(text).toContain('.2D');
    expect(reviewModel.groups.map((group) => group.label)).toEqual(['Control', 'Resection 1000 (BS 077)']);
    expect(text).toContain('# RESECTION');
    expect(text).toContain('DB 1000');
    expect(text).toContain('DN 077 000-00-00');
    expect(text).toContain('DM 077 000-00-00.0 3.8984 90.0000 1.6500/1.5500');
    expect(text).toContain('DM 235 090-52-25.5 17.4323');
    expect(text).toContain('DE');
  });
});
