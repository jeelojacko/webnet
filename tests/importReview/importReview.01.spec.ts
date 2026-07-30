import { describe, expect, it } from 'vitest';
import {
  importExternalInput,
  buildImportReviewDisplayTextMap,
  buildImportReviewModel,
  buildImportReviewText,
  convertImportedDatasetSlopeZenithToHd2D,
  jobXmlTrimbleFixture,
  jobXmlTrimbleResectionFixture,
  jobXmlMeasurementFixture,
} from './importReviewTestSupport';
import type {
  ImportedDataset,
} from './importReviewTestSupport';

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

});
