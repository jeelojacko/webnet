import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import ImportReviewModal from '../src/components/ImportReviewModal';
import type { ImportReviewModel } from '../src/engine/importReview';

describe('ImportReviewModal', () => {
  it('renders grouped imported rows, preset selector, and diagnostics sections', () => {
    const reviewModel: ImportReviewModel = {
      groups: [
        {
          key: 'control',
          kind: 'control',
          label: 'Control',
          defaultComment: 'CONTROL',
          itemIds: ['control:0'],
        },
        {
          key: 'setup:STN1:bs:BS1',
          kind: 'setup',
          label: 'Setup STN1 (BS BS1)',
          defaultComment: 'SETUP STN1',
          setupId: 'STN1',
          backsightId: 'BS1',
          itemIds: ['observation:0'],
        },
      ],
      items: [
        {
          id: 'control:0',
          kind: 'control',
          index: 0,
          groupKey: 'control',
          sourceType: 'Control Point',
          sourceLine: 12,
          sourceCode: 'PointRecord',
          stationId: 'STN1',
        },
        {
          id: 'observation:0',
          kind: 'observation',
          index: 0,
          groupKey: 'setup:STN1:bs:BS1',
          sourceType: 'Measurement',
          sourceLine: 44,
          sourceCode: 'PointRecord',
          sourceMethod: 'MEANTURNEDANGLE',
          sourceClassification: 'MTA',
          sourceObservationKind: 'measurement',
          setupId: 'STN1',
          backsightId: 'BS1',
          targetId: 'P1',
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
        detailLines={[
          'Imported 2 points and 1 observation from sample.jxl into normalized WebNet input.',
        ]}
        reviewModel={reviewModel}
        displayedRows={{
          'control:0': 'C STN1 5000.0000 1000.0000 100.0000',
          'observation:0': 'DM P1 045-07-24.2 100.0000',
        }}
        excludedItemIds={new Set(['observation:0'])}
        groupComments={{ control: 'CONTROL', 'setup:STN1:bs:BS1': 'SETUP STN1' }}
        preset="ts-direction-set"
        moveTargetGroups={[{ key: 'setup:STN1:bs:BS1', label: 'Setup STN1 (BS BS1)' }]}
        onPresetChange={() => {}}
        onSetBulkExcludeMta={() => {}}
        onSetBulkExcludeRaw={() => {}}
        onToggleExclude={() => {}}
        onCommentChange={() => {}}
        onRowTextChange={() => {}}
        onDuplicateRow={() => {}}
        onInsertCommentBelow={() => {}}
        onMoveRow={() => {}}
        onRemoveRow={() => {}}
        onCancel={() => {}}
        onImport={() => {}}
      />,
    );

    expect(html).toContain('Import Review');
    expect(html).toContain('Imported Data');
    expect(html).toContain('Source Type');
    expect(html).toContain('Source Line');
    expect(html).toContain('Exclude');
    expect(html).toContain('Actions');
    expect(html).toContain('Output Style');
    expect(html).toContain('TS Direction Set');
    expect(html).toContain('Exclude MTA Obs (1)');
    expect(html).toContain('Duplicate');
    expect(html).toContain('Comment Below');
    expect(html).toContain('Control');
    expect(html).toContain('Setup STN1');
    expect(html).toContain('Import Diagnostics');
    expect(html).toContain('Unsupported measurement skipped.');
  });
});
