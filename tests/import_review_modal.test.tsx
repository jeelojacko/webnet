import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import ImportReviewModal from '../src/components/ImportReviewModal';
import type { ImportReviewModel } from '../src/engine/importReview';

describe('ImportReviewModal', () => {
  it('renders grouped imported rows and diagnostics sections', () => {
    const reviewModel: ImportReviewModel = {
      groups: [
        {
          key: 'control',
          label: 'Control',
          defaultComment: 'CONTROL',
          itemIds: ['control:0'],
        },
        {
          key: 'setup:STN1',
          label: 'Setup STN1',
          defaultComment: 'SETUP STN1',
          itemIds: ['observation:0'],
        },
      ],
      items: [
        {
          id: 'control:0',
          kind: 'control',
          index: 0,
          groupKey: 'control',
          importedData: 'C STN1 5000.0000 1000.0000 100.0000',
          sourceType: 'Control Point',
          sourceLine: 12,
          sourceCode: 'PointRecord',
        },
        {
          id: 'observation:0',
          kind: 'observation',
          index: 0,
          groupKey: 'setup:STN1',
          importedData: 'M STN1-BS1-P1 045-07-24.2 100.0000 95.0000 1.5000/1.8000',
          sourceType: 'Measurement',
          sourceLine: 44,
          sourceCode: 'PointRecord',
        },
      ],
      warnings: [
        {
          level: 'warning',
          sourceLine: 88,
          sourceCode: 'PointRecord',
          message: 'Unsupported measurement skipped.',
        },
      ],
      errors: [],
    };

    const html = renderToStaticMarkup(
      <ImportReviewModal
        sourceName="sample.jxl"
        title="Imported JobXML dataset"
        detailLines={['Imported 2 points and 1 observation from sample.jxl into normalized WebNet input.']}
        reviewModel={reviewModel}
        excludedItemIds={new Set(['observation:0'])}
        groupComments={{ control: 'CONTROL', 'setup:STN1': 'SETUP STN1' }}
        onToggleExclude={() => {}}
        onCommentChange={() => {}}
        onCancel={() => {}}
        onImport={() => {}}
      />,
    );

    expect(html).toContain('Import Review');
    expect(html).toContain('Imported Data');
    expect(html).toContain('Source Type');
    expect(html).toContain('Source Line');
    expect(html).toContain('Exclude');
    expect(html).toContain('Control');
    expect(html).toContain('Setup STN1');
    expect(html).toContain('Import Diagnostics');
    expect(html).toContain('Unsupported measurement skipped.');
  });
});
