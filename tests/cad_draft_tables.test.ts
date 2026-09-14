import { describe, expect, it } from 'vitest';
import { buildCadInverseSummary } from '../src/engine/cad/cadCogoSummaries';
import { cadBuildCurveMetricsSummaryFromRadiusDelta } from '../src/engine/cad/cadCogoCurveMetrics';
import {
  buildDraftCurveTable,
  buildDraftLineTable,
  buildDraftPointTable,
  checkDraftTableOverflow,
} from '../src/engine/cad/cadDraftTables';
import { deriveInverseAutoText } from '../src/engine/cad/cadLabelEngine';

describe('draft point table', () => {
  it('emits Point/Northing/Easting/Elevation/Description with deterministic pointId order', () => {
    const table = buildDraftPointTable(
      [
        { pointId: 'B', northing: 1, easting: 2, description: 'b' },
        { pointId: 'A', northing: 3, easting: 4, elevation: 5, description: 'a' },
      ],
      { order: 'pointId' },
    );
    expect(table.headers).toEqual(['Point', 'Northing', 'Easting', 'Elevation', 'Description']);
    expect(table.rows.map((row) => row[0])).toEqual(['A', 'B']);
    expect(table.rows[0]).toEqual(['A', '3.000', '4.000', '5.000', 'a']);
    expect(table.warnings).toEqual([]);
  });

  it('selection order preserves input ranking', () => {
    const table = buildDraftPointTable(
      [
        { pointId: 'A', northing: 0, easting: 0 },
        { pointId: 'B', northing: 1, easting: 1 },
      ],
      { order: 'selection', selectionOrder: ['B', 'A'] },
    );
    expect(table.rows.map((row) => row[0])).toEqual(['B', 'A']);
  });
});

describe('draft line table agrees with label engine derivation', () => {
  it('bearing/distance match deriveInverseAutoText', () => {
    const legs = [
      { lineId: 'L2', fromId: 'P2', toId: 'P3', from: { x: 0, y: 0 }, to: { x: 50, y: 0 } },
      { lineId: 'L1', fromId: 'P1', toId: 'P2', from: { x: 0, y: 0 }, to: { x: 100, y: 100 } },
    ];
    const table = buildDraftLineTable(legs, { order: 'entityId' });
    expect(table.headers).toEqual(['LineID', 'From', 'To', 'Bearing', 'Distance']);
    expect(table.rows.map((row) => row[0])).toEqual(['L1', 'L2']);
    for (const leg of legs) {
      const full = deriveInverseAutoText(leg.from, leg.to, 'bearing-distance');
      const row = table.rows.find((entry) => entry[0] === leg.lineId)!;
      expect(`${row[3]} ${row[4]}`).toBe(full);
      const summary = buildCadInverseSummary(leg.from, leg.to);
      expect(row[4]).toBe(`${summary.distance.toFixed(3)} m`);
    }
  });
});

describe('draft curve table agrees with authoritative curve summary', () => {
  it('radius/arc/chord match cadBuildCurveMetricsSummaryFromRadiusDelta', () => {
    const table = buildDraftCurveTable([{ curveId: 'C1', radius: 100, deltaDeg: 90 }]);
    expect(table.headers).toEqual(['CurveID', 'Radius', 'Arc', 'Chord', 'Delta']);
    const summary = cadBuildCurveMetricsSummaryFromRadiusDelta(100, 90)!;
    expect(table.rows[0]).toEqual([
      'C1',
      `${summary.radius.toFixed(3)} m`,
      `${summary.arcLength.toFixed(3)} m`,
      `${summary.chordLength.toFixed(3)} m`,
      '90°',
    ]);
  });
});

describe('overflow is explicit, never silent', () => {
  it('clips rows and returns OVERFLOW warning', () => {
    const entries = Array.from({ length: 5 }, (_, index) => ({
      pointId: `P${index}`,
      northing: index,
      easting: index,
    }));
    const table = buildDraftPointTable(entries, { maxRows: 3 });
    expect(table.rows).toHaveLength(3);
    expect(table.warnings).toEqual(['OVERFLOW']);
    expect(checkDraftTableOverflow(5, 3)).toEqual({ clipped: true, warning: 'OVERFLOW' });
    expect(checkDraftTableOverflow(2, 3)).toEqual({ clipped: false });
  });
});
