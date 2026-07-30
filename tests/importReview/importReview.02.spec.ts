import { describe, expect, it } from 'vitest';
import {
  enrichImportedDatasetDirectionFaces,
  importExternalInput,
  buildImportReviewDisplayTextMap,
  buildImportReviewModel,
  buildImportReviewText,
  convertImportedDatasetSlopeZenithToHd2D,
  createEmptyImportReviewGroup,
  createImportReviewGroupFromItem,
  duplicateImportReviewItem,
  insertImportReviewCommentRow,
  isImportReviewMtaItem,
  isImportReviewRawMeasurementItem,
  moveImportReviewItem,
  reorderImportReviewItemWithinGroup,
  jobXmlTrimbleFixture,
} from './importReviewTestSupport';
import type {
  ImportedDataset,
} from './importReviewTestSupport';

describe('import review workflow', () => {
  it('emits direction face hints when requested so imported face provenance survives final parsing', () => {
    const dataset: ImportedDataset = {
      importerId: 'jobxml',
      formatLabel: 'Synthetic face normalize with hints',
      summary: 'synthetic',
      notice: { title: 'synthetic', detailLines: [] },
      comments: [],
      controlStations: [],
      observations: [
        {
          kind: 'measurement',
          atId: '9',
          fromId: '8',
          toId: '8',
          angleDeg: 84,
          distanceM: 7.4892,
          sourceMeta: { setupType: 'StandardResection', face: 'FACE1' },
        },
        {
          kind: 'measurement',
          atId: '9',
          fromId: '8',
          toId: '8',
          angleDeg: 264,
          distanceM: 7.4887,
          sourceMeta: { setupType: 'StandardResection', face: 'FACE2' },
        },
      ],
      trace: [],
    };
    const reviewModel = buildImportReviewModel(dataset);
    const text = buildImportReviewText(dataset, reviewModel, {
      includedItemIds: new Set(reviewModel.items.map((item) => item.id)),
      preset: 'ts-direction-set',
      faceNormalizationMode: 'on',
      emitDirectionFaceHints: true,
    });

    expect(text).toContain('DM 8 084-00-00.0 7.4892 F1');
    expect((text.match(/F1/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(text).not.toContain('F2');
  });

  it('retains inferred face metadata through SD+zenith to HD conversion so split mode still works', () => {
    const rawDataset: ImportedDataset = {
      importerId: 'jobxml',
      formatLabel: 'Synthetic zenith face inference',
      summary: 'synthetic',
      notice: { title: 'synthetic', detailLines: [] },
      comments: [],
      controlStations: [],
      observations: [
        {
          kind: 'measurement',
          atId: '9',
          fromId: '8',
          toId: '8',
          angleDeg: 84,
          distanceM: 7.4892,
          verticalMode: 'zenith',
          verticalValue: 90,
          sourceMeta: { setupType: 'StandardResection', classification: 'BackSight' },
        },
        {
          kind: 'measurement',
          atId: '9',
          fromId: '8',
          toId: '10',
          angleDeg: 94,
          distanceM: 8.1145,
          verticalMode: 'zenith',
          verticalValue: 90,
          sourceMeta: { setupType: 'StandardResection' },
        },
        {
          kind: 'measurement',
          atId: '9',
          fromId: '8',
          toId: '8',
          angleDeg: 264,
          distanceM: 7.4887,
          verticalMode: 'zenith',
          verticalValue: 270,
          sourceMeta: { setupType: 'StandardResection', classification: 'BackSight' },
        },
        {
          kind: 'measurement',
          atId: '9',
          fromId: '8',
          toId: '10',
          angleDeg: 274,
          distanceM: 8.1142,
          verticalMode: 'zenith',
          verticalValue: 270,
          sourceMeta: { setupType: 'StandardResection' },
        },
      ],
      trace: [],
    };
    const enriched = enrichImportedDatasetDirectionFaces(rawDataset);
    expect((enriched.observations[0] as any).sourceMeta?.face).toBe('FACE1');
    expect((enriched.observations[2] as any).sourceMeta?.face).toBe('FACE2');

    const converted = convertImportedDatasetSlopeZenithToHd2D(enriched);
    expect((converted.observations[0] as any).verticalMode).toBeUndefined();
    expect((converted.observations[2] as any).verticalMode).toBeUndefined();
    expect((converted.observations[0] as any).sourceMeta?.face).toBe('FACE1');
    expect((converted.observations[2] as any).sourceMeta?.face).toBe('FACE2');

    const reviewModel = buildImportReviewModel(converted);
    const text = buildImportReviewText(converted, reviewModel, {
      includedItemIds: new Set(reviewModel.items.map((item) => item.id)),
      preset: 'ts-direction-set',
      faceNormalizationMode: 'off',
    });
    expect(text).toContain('# FACE 1');
    expect(text).toContain('# FACE 2');
  });

  it('supports bulk MTA/raw targeting, target-based field grouping, and staged row actions', () => {
    const imported = importExternalInput(
      jobXmlTrimbleFixture,
      'jobxml_trimble_station_setup_sample.jxl',
    );
    const baseModel = buildImportReviewModel(imported.dataset!);
    const mtaItems = baseModel.items.filter((item) => isImportReviewMtaItem(item));
    const rawItems = baseModel.items.filter((item) => isImportReviewRawMeasurementItem(item));

    expect(mtaItems.length).toBe(2);
    expect(rawItems.length).toBe(4);

    const duplicatedModel = duplicateImportReviewItem(baseModel, 'observation:4', 'synthetic:1');
    const withCommentModel = insertImportReviewCommentRow(
      duplicatedModel,
      'observation:4',
      'synthetic:2',
    );
    const movedModel = moveImportReviewItem(withCommentModel, 'synthetic:2', 'setup:1:bs:1000');
    const stagedModel = createImportReviewGroupFromItem(
      movedModel,
      'observation:4',
      'synthetic-group:1',
      'Custom Setup 1',
      'CUSTOM SETUP 1',
    );

    const text = buildImportReviewText(imported.dataset!, stagedModel, {
      includedItemIds: new Set(stagedModel.items.map((item) => item.id)),
      groupComments: {
        control: 'CONTROL',
        'setup:1:bs:1000': 'SETUP 1',
        'synthetic-group:1': 'CUSTOM SETUP 1',
      },
      rowOverrides: {
        'synthetic:2': '# AVERAGE SET',
      },
      preset: 'field-grouped',
    });

    expect(stagedModel.groups.map((group) => group.label)).toEqual([
      'Control',
      'Setup 1 (BS 1000)',
      'Custom Setup 1',
    ]);
    expect(text).toContain('# BACKSIGHT 1000');
    expect(text).toContain('# TARGET 2');
    expect(text).toContain('# TARGET CHK1');
    expect(text).toContain('# AVERAGE SET');
    expect(text).toContain('# CUSTOM SETUP 1');
    expect(text.match(/M 1-1000-2 286-51-24.7 22.2230 089-57-23.8 1.6500\/1.6920/g)).toHaveLength(
      2,
    );
  });

  it('supports empty setup-group staging before rows are moved into it', () => {
    const imported = importExternalInput(
      jobXmlTrimbleFixture,
      'jobxml_trimble_station_setup_sample.jxl',
    );
    const baseModel = buildImportReviewModel(imported.dataset!);
    const withEmptyGroup = createEmptyImportReviewGroup(
      baseModel,
      'synthetic-group:1',
      'Custom Setup 1',
      'CUSTOM SETUP 1',
      'setup:1:bs:1000',
    );
    const movedModel = moveImportReviewItem(withEmptyGroup, 'observation:4', 'synthetic-group:1');

    expect(withEmptyGroup.groups.map((group) => group.label)).toEqual([
      'Control',
      'Setup 1 (BS 1000)',
      'Custom Setup 1',
    ]);

    const text = buildImportReviewText(imported.dataset!, movedModel, {
      includedItemIds: new Set(movedModel.items.map((item) => item.id)),
      groupComments: {
        control: 'CONTROL',
        'setup:1:bs:1000': 'SETUP 1',
        'synthetic-group:1': 'CUSTOM SETUP 1',
      },
      preset: 'ts-direction-set',
    });

    expect(text).toContain('# CUSTOM SETUP 1');
    expect(text).toContain('DM 2 286-51-24.7 22.2230');
    expect(text).toContain('DM 1000 000-00-00.0 4.6921');
  });

  it('formats imported zenith values as DMS and supports manual row ordering within a setup group', () => {
    const imported = importExternalInput(
      jobXmlTrimbleFixture,
      'jobxml_trimble_station_setup_sample.jxl',
    );
    const baseModel = buildImportReviewModel(imported.dataset!);
    const displayedRows = buildImportReviewDisplayTextMap(
      imported.dataset!,
      baseModel,
      'clean-webnet',
    );

    expect(displayedRows['observation:0']).toContain('090-00-36.0');
    expect(displayedRows['observation:1']).toContain('090-00-54.0');

    const movedUpModel = reorderImportReviewItemWithinGroup(baseModel, 'observation:4', 'up');
    const text = buildImportReviewText(imported.dataset!, movedUpModel, {
      includedItemIds: new Set(movedUpModel.items.map((item) => item.id)),
      groupComments: {
        control: 'CONTROL',
        'setup:1:bs:1000': 'SETUP 1',
      },
      preset: 'ts-direction-set',
    });

    expect(text).toContain('DM 1000 000-00-00.0 4.6921');
    expect(text.indexOf('DM 2 286-51-24.7 22.2230')).toBeLessThan(
      text.indexOf('DM 2 106-51-21.9 22.2232'),
    );
  });

  it('supports fixed toggles plus D and DV type overrides during final import', () => {
    const imported = importExternalInput(
      jobXmlTrimbleFixture,
      'jobxml_trimble_station_setup_sample.jxl',
    );
    const reviewModel = buildImportReviewModel(imported.dataset!);
    const distanceText = buildImportReviewText(imported.dataset!, reviewModel, {
      includedItemIds: new Set(reviewModel.items.map((item) => item.id)),
      groupComments: {
        control: 'CONTROL',
        'setup:1:bs:1000': 'SETUP 1',
      },
      rowTypeOverrides: {
        'observation:4': 'distance',
      },
      fixedItemIds: new Set(['control:0', 'observation:4']),
      preset: 'ts-direction-set',
    });

    const distanceVerticalText = buildImportReviewText(imported.dataset!, reviewModel, {
      includedItemIds: new Set(reviewModel.items.map((item) => item.id)),
      groupComments: {
        control: 'CONTROL',
        'setup:1:bs:1000': 'SETUP 1',
      },
      rowTypeOverrides: {
        'observation:4': 'distance-vertical',
      },
      fixedItemIds: new Set(['control:0', 'observation:4']),
      preset: 'ts-direction-set',
    });

    expect(distanceText).toContain('C 1 2.3460 -2.4303 0.0000 ! !');
    expect(distanceText).toContain('D 1 2 22.2230 !');
    expect(distanceText).not.toContain('DV 1 2 22.2230');
    expect(distanceText).not.toContain('M 1-1000-2 286-51-24.7 22.2230');

    expect(distanceVerticalText).toContain('DV 1 2 22.2230 089-57-23.8 ! !');
  });

});
