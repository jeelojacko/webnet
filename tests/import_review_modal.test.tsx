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
        comparisonSummary={{
          mode: 'non-mta-only',
          sources: [
            {
              key: 'source:0',
              sourceName: 'sample.jxl',
              notice: { title: 'primary', detailLines: [] },
              importerId: 'jobxml',
              formatLabel: 'JobXML',
              isPrimary: true,
              totals: {
                controlStations: 2,
                observations: 5,
                comparedObservations: 4,
                warnings: 0,
                errors: 0,
              },
            },
            {
              key: 'source:1',
              sourceName: 'sample.htm',
              notice: { title: 'comparison', detailLines: [] },
              importerId: 'trimble-survey-report',
              formatLabel: 'Survey Report',
              isPrimary: false,
              totals: {
                controlStations: 2,
                observations: 4,
                comparedObservations: 4,
                warnings: 0,
                errors: 0,
              },
            },
          ],
          rows: [
            {
              key: 'STN1|BS1|P1|M',
              setupLabel: 'Setup STN1 (BS BS1)',
              targetLabel: 'P1',
              family: 'M',
              countsBySource: [2, 1],
              minCount: 1,
              maxCount: 2,
              spread: 1,
              sourcePresenceCount: 2,
            },
          ],
        }}
        comparisonMode="non-mta-only"
        displayedRows={{
          'control:0': 'C STN1 5000.0000 1000.0000 100.0000',
          'observation:0': 'DM P1 045-07-24.2 100.0000',
        }}
        excludedItemIds={new Set(['observation:0'])}
        fixedItemIds={new Set(['control:0'])}
        groupLabels={{ control: 'Control', 'setup:STN1:bs:BS1': 'Setup STN1 (BS BS1)' }}
        groupComments={{ control: 'CONTROL', 'setup:STN1:bs:BS1': 'SETUP STN1' }}
        rowTypeOverrides={{ 'observation:0': 'distance' }}
        preset="ts-direction-set"
        conflicts={[
          {
            id: 'coordinate-conflict:STN1:0',
            type: 'coordinate-conflict',
            resolutionKey: 'control:0',
            title: 'Coordinate values differ for the same station',
            targetLabel: 'STN1',
            existingSummary: 'ID STN1; E=5000.0000; N=1000.0000; H=100.0000',
            incomingSummary: 'ID STN1; E=5001.0000; N=1002.0000; H=100.5000',
            sourceLine: 12,
            existingSourceLines: [3],
            incomingSourceName: 'sample.jxl',
            relatedItems: [{ kind: 'control', index: 0 }],
          },
        ]}
        conflictResolutions={{ 'control:0': 'rename-incoming' }}
        conflictRenameValues={{ 'control:0': 'STN1_IMPORT' }}
        resolutionValidationMessage="Enter a replacement station ID for every conflict set to Rename Incoming before importing."
        moveTargetGroups={[{ key: 'setup:STN1:bs:BS1', label: 'Setup STN1 (BS BS1)' }]}
        onCompareFile={() => {}}
        onClearComparison={() => {}}
        onComparisonModeChange={() => {}}
        onPresetChange={() => {}}
        onSetBulkExcludeMta={() => {}}
        onSetBulkExcludeRaw={() => {}}
        onConvertSlopeZenithToHd2D={() => {}}
        onSetGroupExcluded={() => {}}
        onConflictResolutionChange={() => {}}
        onConflictRenameValueChange={() => {}}
        onToggleExclude={() => {}}
        onToggleFixed={() => {}}
        onCreateEmptySetupGroup={() => {}}
        onGroupLabelChange={() => {}}
        onCommentChange={() => {}}
        onRowTextChange={() => {}}
        onRowTypeChange={() => {}}
        onDuplicateRow={() => {}}
        onInsertCommentBelow={() => {}}
        onCreateSetupGroup={() => {}}
        onMoveRow={() => {}}
        onReorderRow={() => {}}
        onRemoveGroup={() => {}}
        onRemoveRow={() => {}}
        onCancel={() => {}}
        onImport={() => {}}
      />,
    );

    expect(html).toContain('Import Review');
    expect(html).toContain('Imported Data');
    expect(html).toContain('Source File');
    expect(html).toContain('Source Type');
    expect(html).toContain('Source Line');
    expect(html).toContain('Type');
    expect(html).toContain('Fixed');
    expect(html).toContain('Exclude');
    expect(html).toContain('Actions');
    expect(html).toContain('Output Style');
    expect(html).toContain('TS Direction Set');
    expect(html).toContain('Add Empty Setup');
    expect(html).toContain('Setup Label');
    expect(html).toContain('Exclude Setup');
    expect(html).toContain('Exclude MTA Obs (1)');
    expect(html).toContain('Convert SD+Zenith to HD (2D)');
    expect(html).toContain('Duplicate');
    expect(html).toContain('Comment Below');
    expect(html).toContain('Move Up');
    expect(html).toContain('Move Down');
    expect(html).toContain('New Setup');
    expect(html).toContain('Control');
    expect(html).toContain('Setup STN1');
    expect(html).toContain('Import Diagnostics');
    expect(html).toContain('Unsupported measurement skipped.');
    expect(html).toContain('Multi-Source Reconcile');
    expect(html).toContain('Reconciliation Conflicts');
    expect(html).toContain('Coordinate values differ for the same station');
    expect(html).toContain('Replace With Incoming');
    expect(html).toContain('Rename Incoming');
    expect(html).toContain('New Station ID');
    expect(html).toContain('STN1_IMPORT');
    expect(html).toContain('Existing: 3');
    expect(html).toContain('Reconcile Preset');
    expect(html).toContain('Non-MTA Only');
    expect(html).toContain('All Raw Rows');
    expect(html).toContain('sample.htm');
    expect(html).toContain('Compared Obs');
    expect(html).toContain('Source mismatch buckets');
    expect(html).toContain('Highlight');
    expect(html).toContain('Clear Added Sources');
    expect(html).toContain('Add Source File');
    expect(html).toContain('Present In');
    expect(html).toContain('Spread');
    expect(html).toContain('>DV<');
    expect(html).toContain('>DN<');
    expect(html).toContain('>DM<');
  });
});
