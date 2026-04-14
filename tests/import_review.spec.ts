import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { enrichImportedDatasetDirectionFaces, importExternalInput } from '../src/engine/importers';
import {
  buildImportReviewComparisonSummary,
  buildImportReviewComparisonKeyForItem,
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
} from '../src/engine/importReview';
import type { ImportedDataset } from '../src/engine/importers';

const jobXmlTrimbleFixture = readFileSync(
  'tests/fixtures/jobxml_trimble_station_setup_sample.jxl',
  'utf-8',
);
const jobXmlTrimbleResectionFixture = readFileSync(
  'tests/fixtures/jobxml_trimble_resection_sample.jxl',
  'utf-8',
);
const jobXmlMeasurementFixture = readFileSync(
  'tests/fixtures/jobxml_measurement_sample.jxl',
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
    expect(
      reviewModel.items.filter((item) => item.sourceType.includes('MTA')).length,
    ).toBeGreaterThan(0);
    expect(
      reviewModel.items.filter((item) => item.sourceType.includes('Backsight')).length,
    ).toBeGreaterThan(0);

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
    expect(text).toContain('M 1-1000-1000 000-00-00.0 4.6921 090-00-36.0 1.6500/1.5500');
    expect(text).toContain('M 1-1000-1000 000-00-00.0 4.6921 090-00-54.0 1.6500/1.5500');
    expect(text).toContain('C 1000 0.9957 2.0628 0.0000');
    expect(text).toContain('M 1-1000-2 286-51-24.7 22.2230 089-57-23.8 1.6500/1.6920');
    expect(text).not.toContain('CHK1');
    expect(text).not.toContain('source line');
    expect(text).not.toContain('# Import Trace');
  });

  it('supports ts-direction-set preset and row-level overrides for true resection groups', () => {
    const imported = importExternalInput(
      jobXmlTrimbleResectionFixture,
      'jobxml_trimble_resection_sample.jxl',
    );
    const reviewModel = buildImportReviewModel(imported.dataset!);
    const includedItemIds = new Set(reviewModel.items.map((item) => item.id));
    const displayedRows = buildImportReviewDisplayTextMap(
      imported.dataset!,
      reviewModel,
      'ts-direction-set',
    );

    const targetItem = reviewModel.items.find(
      (item) => displayedRows[item.id] === 'DM 235 090-52-21.0 17.3978',
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
    expect(reviewModel.groups.map((group) => group.label)).toEqual([
      'Control',
      'Resection 1000 (BS 077)',
    ]);
    expect(text).toContain('# RESECTION');
    expect(text).toContain('DB 1000');
    expect(text).not.toContain('DN 077 000-00-00');
    expect(text).toContain('DM 077 000-00-00.0 3.8640');
    expect(text).toContain('DM 235 090-52-25.5 17.4323');
    expect(text).toContain('DE');
  });

  it('supports raw-vs-reduced angle import modes for JobXML measurement records', () => {
    const reduced = importExternalInput(jobXmlMeasurementFixture, 'jobxml_measurement_sample.jxl', {
      angleMode: 'reduced',
    });
    const raw = importExternalInput(jobXmlMeasurementFixture, 'jobxml_measurement_sample.jxl', {
      angleMode: 'raw',
    });
    const reducedMeasurement = reduced.dataset?.observations.find(
      (obs) => obs.kind === 'measurement',
    );
    const rawMeasurement = raw.dataset?.observations.find((obs) => obs.kind === 'measurement');

    expect(reducedMeasurement?.kind).toBe('measurement');
    expect(rawMeasurement?.kind).toBe('measurement');
    expect((reducedMeasurement as any).angleDeg).toBeCloseTo(45.1234, 6);
    expect((rawMeasurement as any).angleDeg).toBeCloseTo(55.1234, 6);
  });

  it('converts SD+zenith to HD with HI/HT stripping and 2D import text output', () => {
    const imported = importExternalInput(jobXmlMeasurementFixture, 'jobxml_measurement_sample.jxl');
    const datasetWithVertical: ImportedDataset = {
      ...imported.dataset!,
      observations: [
        ...imported.dataset!.observations,
        {
          kind: 'vertical',
          fromId: 'STN1',
          toId: 'VERT_ONLY',
          verticalMode: 'zenith',
          verticalValue: 95,
        },
      ],
    };
    const convertedDataset = convertImportedDatasetSlopeZenithToHd2D(datasetWithVertical);
    const reviewModel = buildImportReviewModel(convertedDataset);
    const text = buildImportReviewText(convertedDataset, reviewModel, {
      includedItemIds: new Set(reviewModel.items.map((item) => item.id)),
      preset: 'clean-webnet',
      coordMode: '2D',
      force2D: true,
    });

    const convertedMeasurement = convertedDataset.observations.find(
      (obs) => obs.kind === 'measurement',
    ) as any;
    expect(convertedMeasurement.verticalMode).toBeUndefined();
    expect(convertedMeasurement.verticalValue).toBeUndefined();
    expect(convertedMeasurement.hiM).toBeUndefined();
    expect(convertedMeasurement.htM).toBeUndefined();
    expect(convertedMeasurement.distanceM).toBeCloseTo(99.6194698, 6);
    expect(convertedDataset.observations.some((obs) => obs.kind === 'vertical')).toBe(false);

    expect(text).toContain('.2D');
    expect(text).toContain('C STN1 5000.0000 1000.0000');
    expect(text).toContain('C BS1 5100.0000 1200.0000');
    expect(text).toContain('M STN1-BS1-SHOT_1 045-07-24.2 99.6195');
    expect(text).not.toContain('095-00-00.0');
    expect(text).not.toContain('1.5000/1.8000');
    expect(text).not.toMatch(/^V\s+/m);
  });

  it('infers missing JobXML face metadata from zenith before SD+zenith to HD conversion', () => {
    const imported = importExternalInput(
      jobXmlTrimbleFixture,
      'jobxml_trimble_station_setup_sample.jxl',
    );
    const mtaObservation = imported.dataset?.observations.find(
      (obs) => obs.kind === 'measurement' && obs.sourceMeta?.method === 'MEANTURNEDANGLE',
    ) as any;
    expect(mtaObservation).toBeDefined();
    expect(mtaObservation.sourceMeta?.face).toBe('FACE1');
    expect(mtaObservation.sourceMeta?.faceSource).toBe('zenith');

    const convertedDataset = convertImportedDatasetSlopeZenithToHd2D(imported.dataset!);
    const convertedMtaObservation = convertedDataset.observations.find(
      (obs) => obs.kind === 'measurement' && (obs as any).sourceMeta?.method === 'MEANTURNEDANGLE',
    ) as any;
    expect(convertedMtaObservation).toBeDefined();
    expect(convertedMtaObservation.sourceMeta?.face).toBe('FACE1');
    expect(convertedMtaObservation.sourceMeta?.faceSource).toBe('zenith');
  });

  it('splits resection direction-set output by face when normalization mode is off', () => {
    const dataset: ImportedDataset = {
      importerId: 'jobxml',
      formatLabel: 'Synthetic face split',
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
          sourceMeta: {
            setupType: 'StandardResection',
            classification: 'BackSight',
            face: 'FACE1',
          },
        },
        {
          kind: 'measurement',
          atId: '9',
          fromId: '8',
          toId: '10',
          angleDeg: 94,
          distanceM: 8.1145,
          sourceMeta: { setupType: 'StandardResection', face: 'FACE1' },
        },
        {
          kind: 'measurement',
          atId: '9',
          fromId: '8',
          toId: '8',
          angleDeg: 264,
          distanceM: 7.4887,
          sourceMeta: {
            setupType: 'StandardResection',
            classification: 'BackSight',
            face: 'FACE2',
          },
        },
        {
          kind: 'measurement',
          atId: '9',
          fromId: '8',
          toId: '10',
          angleDeg: 274,
          distanceM: 8.1142,
          sourceMeta: { setupType: 'StandardResection', face: 'FACE2' },
        },
      ],
      trace: [],
    };

    const reviewModel = buildImportReviewModel(dataset);
    const text = buildImportReviewText(dataset, reviewModel, {
      includedItemIds: new Set(reviewModel.items.map((item) => item.id)),
      preset: 'ts-direction-set',
      faceNormalizationMode: 'off',
    });

    expect(text).toContain('# FACE 1');
    expect(text).toContain('# FACE 2');
    expect((text.match(/^DB 9$/gm) ?? []).length).toBe(2);
    expect(text).toContain('DM 8 084-00-00.0 7.4892');
    expect(text).toContain('DM 8 264-00-00.0 7.4887');
    expect(text).toContain('DM 10 094-00-00.0 8.1145');
    expect(text).toContain('DM 10 274-00-00.0 8.1142');
  });

  it('normalizes face-II direction-set rows into face-I convention when normalization mode is on', () => {
    const dataset: ImportedDataset = {
      importerId: 'jobxml',
      formatLabel: 'Synthetic face normalize',
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
          sourceMeta: {
            setupType: 'StandardResection',
            classification: 'BackSight',
            face: 'FACE1',
          },
        },
        {
          kind: 'measurement',
          atId: '9',
          fromId: '8',
          toId: '10',
          angleDeg: 94,
          distanceM: 8.1145,
          sourceMeta: { setupType: 'StandardResection', face: 'FACE1' },
        },
        {
          kind: 'measurement',
          atId: '9',
          fromId: '8',
          toId: '8',
          angleDeg: 264,
          distanceM: 7.4887,
          sourceMeta: {
            setupType: 'StandardResection',
            classification: 'BackSight',
            face: 'FACE2',
          },
        },
        {
          kind: 'measurement',
          atId: '9',
          fromId: '8',
          toId: '10',
          angleDeg: 274,
          distanceM: 8.1142,
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
    });

    expect(text).not.toContain('# FACE 1');
    expect(text).not.toContain('# FACE 2');
    expect((text.match(/^DB 9$/gm) ?? []).length).toBe(1);
    expect((text.match(/DM 8 084-00-00\.0/g) ?? []).length).toBe(2);
    expect((text.match(/DM 10 094-00-00\.0/g) ?? []).length).toBe(2);
    expect(text).not.toContain('DM 8 264-00-00.0');
    expect(text).not.toContain('DM 10 274-00-00.0');
  });

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

  it('emits family-appropriate fixed markers for control, TS, vertical, bearing, and GNSS import rows', () => {
    const dataset: ImportedDataset = {
      importerId: 'jobxml',
      formatLabel: 'Synthetic import',
      summary: 'synthetic',
      notice: { title: 'synthetic', detailLines: [] },
      comments: [],
      controlStations: [
        {
          kind: 'control-station',
          coordinateMode: 'local',
          stationId: 'C1',
          eastM: 100,
          northM: 200,
          heightM: 5,
        },
      ],
      observations: [
        {
          kind: 'measurement',
          atId: '1',
          fromId: '1000',
          toId: '2',
          angleDeg: 45,
          distanceM: 10,
          verticalMode: 'zenith',
          verticalValue: 90,
        },
        {
          kind: 'vertical',
          fromId: '1',
          toId: '2',
          verticalMode: 'zenith',
          verticalValue: 90,
        },
        {
          kind: 'bearing',
          fromId: '1',
          toId: '2',
          bearingDeg: 180,
        },
        {
          kind: 'gnss-vector',
          fromId: 'GPS1',
          toId: 'GPS2',
          deltaEastM: 1,
          deltaNorthM: 2,
        },
      ],
      trace: [],
    };

    const reviewModel = buildImportReviewModel(dataset);
    const text3d = buildImportReviewText(dataset, reviewModel, {
      includedItemIds: new Set(reviewModel.items.map((item) => item.id)),
      fixedItemIds: new Set(reviewModel.items.map((item) => item.id)),
      coordMode: '3D',
      preset: 'clean-webnet',
    });
    const text2d = buildImportReviewText(dataset, reviewModel, {
      includedItemIds: new Set(reviewModel.items.map((item) => item.id)),
      fixedItemIds: new Set(['control:0']),
      coordMode: '2D',
      preset: 'clean-webnet',
    });

    expect(text3d).toContain('C C1 100.0000 200.0000 5.0000 ! ! !');
    expect(text2d).toContain('C C1 100.0000 200.0000 5.0000 ! !');
    expect(text3d).toContain('M 1-1000-2 045-00-00.0 10.0000 090-00-00.0 ! ! !');
    expect(text3d).toContain('V 1-2 090-00-00.0 !');
    expect(text3d).toContain('B 1 2 180.0000 !');
    expect(text3d).toContain('G GPS GPS1 GPS2 1.0000 2.0000 0.0000 0.0000 0.0000 ! !');
  });

  it('supports vertical row overrides with hyphenated from-to formatting', () => {
    const imported = importExternalInput(
      jobXmlTrimbleFixture,
      'jobxml_trimble_station_setup_sample.jxl',
    );
    const reviewModel = buildImportReviewModel(imported.dataset!);
    const text = buildImportReviewText(imported.dataset!, reviewModel, {
      includedItemIds: new Set(['observation:4']),
      groupComments: {
        'setup:1:bs:1000': 'SETUP 1',
      },
      rowTypeOverrides: {
        'observation:4': 'vertical',
      },
      preset: 'clean-webnet',
    });

    expect(text).toContain('.DELTA OFF');
    expect(text).toContain('V 1-2 089-57-23.8');
    expect(text).not.toContain('V 1 2 089-57-23.8');
  });

  it('supports DN and DM row-type overrides for setup-aware JobXML groups', () => {
    const imported = importExternalInput(
      jobXmlTrimbleFixture,
      'jobxml_trimble_station_setup_sample.jxl',
    );
    const reviewModel = buildImportReviewModel(imported.dataset!);
    const text = buildImportReviewText(imported.dataset!, reviewModel, {
      includedItemIds: new Set(['observation:0', 'observation:4']),
      groupComments: {
        'setup:1:bs:1000': 'SETUP 1 DIRSET',
      },
      rowTypeOverrides: {
        'observation:0': 'direction-angle',
        'observation:4': 'direction-measurement',
      },
      preset: 'clean-webnet',
    });

    expect(text).toContain('# SETUP 1 DIRSET');
    expect(text).toContain('DB 1');
    expect(text).toContain('DN 1000 000-00-00');
    expect(text).toContain('DN 1000 000-00-00.0');
    expect(text).toContain('DM 2 286-51-24.7 22.2230 089-57-23.8');
    expect(text).toContain('DE');
  });

  it('builds comparison summaries with comparable counts excluding MTA rows', () => {
    const primary: ImportedDataset = {
      importerId: 'jobxml',
      formatLabel: 'JobXML',
      summary: 'primary',
      notice: { title: 'primary', detailLines: [] },
      comments: [],
      controlStations: [],
      observations: [
        {
          kind: 'measurement',
          atId: '1',
          fromId: '1000',
          toId: '2',
          angleDeg: 10,
          distanceM: 20,
          sourceMeta: { method: 'DIRECTREADING' },
        },
        {
          kind: 'measurement',
          atId: '1',
          fromId: '1000',
          toId: '2',
          angleDeg: 10,
          distanceM: 20,
          sourceMeta: { method: 'MEANTURNEDANGLE' },
        },
        {
          kind: 'vertical',
          fromId: '1',
          toId: '200',
          verticalMode: 'zenith',
          verticalValue: 90,
        },
      ],
      trace: [],
    };
    const comparison: ImportedDataset = {
      importerId: 'trimble-survey-report',
      formatLabel: 'Survey Report',
      summary: 'comparison',
      notice: { title: 'comparison', detailLines: [] },
      comments: [],
      controlStations: [],
      observations: [
        {
          kind: 'measurement',
          atId: '1',
          fromId: '1000',
          toId: '2',
          angleDeg: 10,
          distanceM: 20,
        },
        {
          kind: 'vertical',
          fromId: '1',
          toId: '200',
          verticalMode: 'zenith',
          verticalValue: 90,
        },
      ],
      trace: [],
    };

    const summary = buildImportReviewComparisonSummary(
      [
        {
          key: 'source:0',
          sourceName: 'sample.jxl',
          notice: primary.notice,
          dataset: primary,
          isPrimary: true,
        },
        {
          key: 'source:1',
          sourceName: 'sample.htm',
          notice: comparison.notice,
          dataset: comparison,
          isPrimary: false,
        },
      ],
    );

    expect(summary.mode).toBe('non-mta-only');
    expect(summary.sources).toHaveLength(2);
    expect(summary.sources[0]?.totals.observations).toBe(3);
    expect(summary.sources[0]?.totals.comparedObservations).toBe(2);
    expect(summary.sources[1]?.totals.comparedObservations).toBe(2);
    expect(summary.rows).toHaveLength(0);

    const allRawSummary = buildImportReviewComparisonSummary(
      [
        {
          key: 'source:0',
          sourceName: 'sample.jxl',
          notice: primary.notice,
          dataset: primary,
          isPrimary: true,
        },
        {
          key: 'source:1',
          sourceName: 'sample.htm',
          notice: comparison.notice,
          dataset: comparison,
          isPrimary: false,
        },
      ],
      'all-raw',
    );

    expect(allRawSummary.mode).toBe('all-raw');
    expect(allRawSummary.sources[0]?.totals.comparedObservations).toBe(3);
    expect(allRawSummary.sources[1]?.totals.comparedObservations).toBe(2);
    expect(allRawSummary.rows).toHaveLength(1);
    expect(allRawSummary.rows[0]).toMatchObject({
      key: '1|1000|2|M',
      countsBySource: [2, 1],
      spread: 1,
      sourcePresenceCount: 2,
    });
  });

  it('builds item-level comparison keys that respect the active compare mode', () => {
    const imported = importExternalInput(
      jobXmlTrimbleFixture,
      'jobxml_trimble_station_setup_sample.jxl',
    );
    const reviewModel = buildImportReviewModel(imported.dataset!);
    const rawItem = reviewModel.items.find(
      (item) => isImportReviewRawMeasurementItem(item) && item.targetId === '2',
    );
    const mtaItem = reviewModel.items.find(
      (item) => isImportReviewMtaItem(item) && item.targetId === '2',
    );

    expect(rawItem).toBeDefined();
    expect(mtaItem).toBeDefined();
    expect(buildImportReviewComparisonKeyForItem(rawItem!, 'non-mta-only')).toBe('1|1000|2|M');
    expect(buildImportReviewComparisonKeyForItem(mtaItem!, 'non-mta-only')).toBeNull();
    expect(buildImportReviewComparisonKeyForItem(mtaItem!, 'all-raw')).toBe('1|1000|2|M');
  });

  it('builds multi-source comparison spreads across more than two imported files', () => {
    const sourceA: ImportedDataset = {
      importerId: 'jobxml',
      formatLabel: 'JobXML',
      summary: 'A',
      notice: { title: 'A', detailLines: [] },
      comments: [],
      controlStations: [],
      observations: [
        { kind: 'distance', fromId: '1', toId: '2', distanceM: 10 },
        { kind: 'distance', fromId: '1', toId: '2', distanceM: 10.1 },
      ],
      trace: [],
    };
    const sourceB: ImportedDataset = {
      importerId: 'survey-report',
      formatLabel: 'Survey Report',
      summary: 'B',
      notice: { title: 'B', detailLines: [] },
      comments: [],
      controlStations: [],
      observations: [{ kind: 'distance', fromId: '1', toId: '2', distanceM: 10 }],
      trace: [],
    };
    const sourceC: ImportedDataset = {
      importerId: 'fieldgenius',
      formatLabel: 'Field',
      summary: 'C',
      notice: { title: 'C', detailLines: [] },
      comments: [],
      controlStations: [],
      observations: [],
      trace: [],
    };

    const summary = buildImportReviewComparisonSummary([
      {
        key: 'source:0',
        sourceName: 'a.jxl',
        notice: sourceA.notice,
        dataset: sourceA,
        isPrimary: true,
      },
      {
        key: 'source:1',
        sourceName: 'b.htm',
        notice: sourceB.notice,
        dataset: sourceB,
      },
      {
        key: 'source:2',
        sourceName: 'c.raw',
        notice: sourceC.notice,
        dataset: sourceC,
      },
    ]);

    expect(summary.sources).toHaveLength(3);
    expect(summary.rows[0]).toMatchObject({
      key: '1||2|D',
      countsBySource: [2, 1, 0],
      spread: 2,
      sourcePresenceCount: 2,
    });
  });
});
