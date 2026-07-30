import { describe, expect, it } from 'vitest';
import {
  importExternalInput,
  buildImportReviewComparisonSummary,
  buildImportReviewComparisonKeyForItem,
  buildImportReviewModel,
  buildImportReviewText,
  isImportReviewMtaItem,
  isImportReviewRawMeasurementItem,
  jobXmlTrimbleFixture,
} from './importReviewTestSupport';
import type {
  ImportedDataset,
} from './importReviewTestSupport';

describe('import review workflow', () => {
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
