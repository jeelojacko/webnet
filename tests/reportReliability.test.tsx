import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { solveEngine } from '../src/engine/solveEngine';
import { RAD_TO_DEG } from '../src/engine/angles';
import type { ReliabilityPolicy } from '../src/engine/reliabilityPolicy';
import {
  activeMdbComponentsOf,
  activeMdbOf,
  buildCoordEffCellTooltip,
  buildMdbCellTooltip,
  buildMdbHeaderTooltip,
  buildReliabilitySummaryLine,
  formatCoordEffCell,
  primaryExternalOf,
} from '../src/engine/reliabilityDisplay';
import type { AdjustmentResult, Observation } from '../src/types';
import ObservationTableSection from '../src/components/report/ObservationTableSection';
import { ReliabilitySummarySection } from '../src/components/report/ReportRunSummarySections';
import { buildObservationsResidualsCsvText } from '../src/engine/browserObservationResidualsCsv';

/** Two fixed controls, one free point, plus a redundant outlier distance. */
const OUTLIER_INPUT = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C P 50 40 0',
  'D A-P 64.031 0.01',
  'D B-P 64.031 0.01',
  'A P-A-B 102-40-00.0 1.0',
  'D A-P 64.071 0.01',
].join('\n');

const run = (input: string, reliabilityPolicy?: ReliabilityPolicy, extra?: Record<string, unknown>) =>
  solveEngine({
    input,
    maxIterations: 8,
    parseOptions: {
      coordMode: '2D',
      units: 'm',
      ...(reliabilityPolicy ? { reliabilityPolicy } : {}),
      ...(extra ?? {}),
    },
  });

const tableProps = {
  title: 'Distances (TS)',
  unitScale: 1,
  excludedIds: new Set<number>(),
  autoSideshotObsIds: new Set<number>(),
  selectedObservationId: null,
  onToggleExclude: () => {},
  rowSelectionClass: () => '',
  visibleRowsFor: ((_key: string, rows: unknown[]) => rows) as <T>(
    _key: string,
    _rows: T[],
    _defaultSize?: number,
  ) => T[],
  showMoreRows: () => {},
  showAllRows: () => {},
  renderSourceLineLink: (line: number | null | undefined) => String(line ?? '-'),
  isSectionCollapsed: () => false,
  isDetailSectionPinned: () => false,
  toggleDetailSection: () => {},
  togglePinnedDetailSection: () => {},
  formatMdb: (value: number) => (Number.isFinite(value) ? value.toFixed(3) : '-'),
  prismAnnotation: () => '',
};

describe('reliability cell rendering', () => {
  it('renders a compact CoordEff column with millimetre values', () => {
    const result = run(OUTLIER_INPUT);
    const html = renderToStaticMarkup(
      <ObservationTableSection
        {...tableProps}
        obsList={result.observations}
        reliabilitySummary={result.reliabilitySummary}
      />,
    );
    expect(html).toContain('CoordEff');
    const tested = result.observations.find(
      (o) => primaryExternalOf(o)?.available === true,
    ) as Observation;
    expect(tested).toBeDefined();
    expect(html).toContain(formatCoordEffCell(tested));
    expect(formatCoordEffCell({} as Observation)).toBe('-');
  });

  it('keeps the MDB primary column with a run-model header tooltip', () => {
    const result = run(OUTLIER_INPUT, { model: 'statistical', alpha: 0.001, power: 0.8 });
    const html = renderToStaticMarkup(
      <ObservationTableSection
        {...tableProps}
        obsList={result.observations}
        reliabilitySummary={result.reliabilitySummary}
      />,
    );
    expect(html).toContain('MDB');
    expect(html).toContain('Statistical MDB');
    expect(buildMdbHeaderTooltip(result.reliabilitySummary)).toContain('alpha 0.001');
    expect(buildMdbHeaderTooltip(result.reliabilitySummary)).toContain('δ0 4.132');
  });

  it('describes coordinate influence with station, shift vector, and power', () => {
    const result = run(OUTLIER_INPUT);
    const obs = result.observations.find(
      (o) => primaryExternalOf(o)?.available === true,
    ) as Observation;
    const tip = buildCoordEffCellTooltip(obs, result.reliabilitySummary);
    expect(tip).toContain('max');
    expect(tip).toContain('mm at');
    expect(tip).toContain('ΔE=');
    expect(tip).toContain('ΔN=');
    expect(tip).toContain('Legacy MDB (3.29)');
  });

  it('shows the SELECTED component MDB in the CoordEff tooltip, not the aggregate min', () => {
    const gps = {
      id: 7,
      type: 'gps',
      mdbComponents: { mE: 0.001, mN: 0.005 },
      reliability: {
        mdb: 0.001,
        externalComponents: {
          E: { available: true, mdbUsed: 0.001, primaryMm: 1.0, primaryKind: 'horizontal' },
          N: { available: true, mdbUsed: 0.005, primaryMm: 9.0, primaryKind: 'horizontal' },
        },
      },
    } as unknown as Observation;
    // N wins (max effect) but the aggregate min-MDB belongs to E.
    expect(primaryExternalOf(gps)).toBe(
      (gps.reliability as unknown as { externalComponents: { N: unknown } }).externalComponents.N,
    );
    const tip = buildCoordEffCellTooltip(gps, null);
    expect(tip).toContain('5.0mm');
    expect(tip).not.toContain('1.0mm');
  });

  it('discloses the statistical model, alpha/power, and linear equivalent in the MDB tooltip', () => {
    const result = run(OUTLIER_INPUT, { model: 'statistical', alpha: 0.001, power: 0.9 });
    const angular = result.observations.find((o) => o.type === 'angle') as Observation;
    const tip = buildMdbCellTooltip(angular, result.reliabilitySummary);
    expect(tip).toContain('Statistical MDB');
    expect(tip).toContain('alpha 0.001');
    expect(tip).toContain('power 0.9');
    expect(tip).toContain('Linear equivalent');
  });

  it('selects the active statistical value in the table cell, tooltip, and summary line', () => {
    const statistical = run(OUTLIER_INPUT, { model: 'statistical', alpha: 0.001, power: 0.8 });
    const legacy = run(OUTLIER_INPUT);
    const summary = statistical.reliabilitySummary!;
    const angular = (statistical.observations as Observation[]).find(
      (o) => o.type === 'angle',
    ) as Observation;
    const legacyAngular = (legacy.observations as Observation[]).find(
      (o) => o.id === angular.id,
    ) as Observation;
    const statArcSec = ((angular.reliability?.mdbStatistical as number) * RAD_TO_DEG * 3600).toFixed(2);
    const legacyArcSec = ((legacyAngular.mdb as number) * RAD_TO_DEG * 3600).toFixed(2);
    expect(statArcSec).not.toBe(legacyArcSec);
    // Tooltip shows the active statistical MDB, not the legacy value.
    const tip = buildMdbCellTooltip(angular, summary);
    expect(tip).toContain(`MDB ${statArcSec}"`);
    expect(tip).not.toContain(`MDB ${legacyArcSec}"`);
    // Table cell shows the active statistical MDB, not the legacy value.
    const html = renderToStaticMarkup(
      <ObservationTableSection
        {...tableProps}
        obsList={statistical.observations}
        reliabilitySummary={summary}
      />,
    );
    expect(html).toContain(
      `MDB ${(angular.reliability?.mdbStatistical as number).toFixed(3)}`,
    );
    // Worst-internal summary ranks the active statistical values.
    const line = buildReliabilitySummaryLine(
      summary,
      statistical.observations as Observation[],
    );
    const worstLinear = (statistical.observations as Observation[])
      .filter((o) => o.type !== 'angle')
      .reduce((best, o) => Math.max(best, activeMdbOf(o, summary)), Number.NEGATIVE_INFINITY);
    expect(line).toContain(`worst internal (linear)`);
    expect(line).toContain(`${(worstLinear * 1000).toFixed(1)}mm`);
  });
});

describe('reliability summary section', () => {
  it('renders a concise strip with model, delta0, and worst rows', () => {
    const result = run(OUTLIER_INPUT, { model: 'statistical', alpha: 0.001, power: 0.8 });
    const html = renderToStaticMarkup(
      <ReliabilitySummarySection
        isDataCheck={false}
        isPreanalysis={false}
        isSpecialRunMode={false}
        result={result}
      />,
    );
    expect(html).toContain('Reliability');
    expect(html).toContain('Statistical MDB');
    expect(html).toContain('4.132');
    expect(html).toContain('worst internal');
    expect(html).toContain('coordinate influence');
  });

  it('ranks worst-internal within compatible groups, never raw cross-unit', () => {
    const result = run(OUTLIER_INPUT, { model: 'statistical', alpha: 0.001, power: 0.8 });
    const line = buildReliabilitySummaryLine(
      result.reliabilitySummary!,
      result.observations as Observation[],
    );
    expect(line).toContain('worst internal (linear)');
    expect(line).toContain('worst internal (angular)');
    expect(line).toContain('worst coordinate influence');
    expect(line).toContain('(horizontal)');
  });

  it('is suppressed for preanalysis and data-check runs', () => {
    const pre = run(OUTLIER_INPUT, undefined, { preanalysisMode: true });
    const preHtml = renderToStaticMarkup(
      <ReliabilitySummarySection
        isDataCheck={false}
        isPreanalysis={true}
        isSpecialRunMode={false}
        result={pre as unknown as AdjustmentResult}
      />,
    );
    expect(preHtml).toBe('');
  });
});

describe('fail-closed statistical display', () => {
  it('never substitutes legacy MDB under a Statistical label when statistical storage is missing/nonfinite', () => {
    const statistical = run(OUTLIER_INPUT, { model: 'statistical', alpha: 0.001, power: 0.8 });
    const summary = statistical.reliabilitySummary!;
    const target = (statistical.observations as Observation[])[0] as Observation;
    expect(target.reliability?.mdbStatistical).toBeDefined();
    // Missing statistical storage (unavailable/untestable row): legacy stays
    // in storage but must never surface under the statistical model.
    const { mdbStatistical: _dropped, ...reliabilityRest } = target.reliability as Record<
      string,
      unknown
    >;
    void _dropped;
    const missing = {
      ...target,
      reliability: { ...(reliabilityRest as Observation['reliability']) },
    } as Observation;
    expect(Number.isNaN(activeMdbOf(missing, summary))).toBe(true);
    expect(activeMdbComponentsOf(missing, summary)).toBeUndefined();
    // Legacy/default selection is untouched (bit-identical default path).
    expect(activeMdbOf(missing, undefined)).toBe(missing.mdb);
    // Components never fall back to legacy storage in statistical mode.
    const legacyComps = {
      mdbComponents: { mE: 0.01, mN: 0.02 },
      reliability: { mdb: 0.01, mdbStatistical: 0.005, method: 'exact-normal' },
    } as unknown as Observation;
    expect(activeMdbComponentsOf(legacyComps, summary)).toBeUndefined();
    // Tooltip labels Statistical MDB with an untestable value, not legacy.
    const tip = buildMdbCellTooltip(missing, summary);
    expect(tip).toContain('Statistical MDB');
    expect(tip).toContain('untestable');
    // Table cell is blank, not the legacy value.
    const html = renderToStaticMarkup(
      <ObservationTableSection
        {...tableProps}
        obsList={[missing]}
        reliabilitySummary={summary}
      />,
    );
    expect(html).toContain('MDB -');
    expect(html).not.toContain(`MDB ${(missing.mdb as number).toFixed(3)}`);
    // CSV active column is blank while the legacy compatibility column stays.
    const patched = {
      ...(statistical as unknown as AdjustmentResult),
      observations: (statistical.observations as Observation[]).map((o) =>
        o.id === missing.id ? missing : o,
      ),
    } as unknown as AdjustmentResult;
    const text = buildObservationsResidualsCsvText({ result: patched, units: 'm' });
    const lines = text.split('\n');
    const header = lines[0].split(',');
    const row = lines.find((l) => l.startsWith(`${missing.id},`))!.split(',');
    expect(row[header.indexOf('reliabilityMdb')]).toBe('');
    expect(row[header.indexOf('mdb')]).toBe((missing.mdb as number).toFixed(4));
    // +Inf statistical storage likewise never resolves to legacy.
    const infObs = {
      ...target,
      reliability: { ...target.reliability, mdbStatistical: Number.POSITIVE_INFINITY },
    } as Observation;
    expect(activeMdbOf(infObs, summary)).toBe(Number.POSITIVE_INFINITY);
    expect(buildMdbCellTooltip(infObs, summary)).toContain('untestable');
    const patchedInf = {
      ...(statistical as unknown as AdjustmentResult),
      observations: (statistical.observations as Observation[]).map((o) =>
        o.id === target.id ? infObs : o,
      ),
    } as unknown as AdjustmentResult;
    const infText = buildObservationsResidualsCsvText({ result: patchedInf, units: 'm' });
    const infRow = infText
      .split('\n')
      .find((l) => l.startsWith(`${target.id},`))!
      .split(',');
    expect(infRow[header.indexOf('reliabilityMdb')]).toBe('');
  });
});

describe('reliability CSV fields', () => {
  it('appends run policy and per-observation reliability at the absolute end', () => {
    const result = run(OUTLIER_INPUT, { model: 'statistical', alpha: 0.001, power: 0.8 });
    const text = buildObservationsResidualsCsvText({
      result: result as unknown as AdjustmentResult,
      units: 'm',
    });
    const lines = text.split('\n');
    const header = lines[0].split(',');
    expect(header.slice(-13)).toEqual([
      'localTestStatistic',
      'localTestStatisticFamily',
      'reliabilityModel',
      'reliabilityAlpha',
      'reliabilityPower',
      'reliabilityDelta0',
      'reliabilityMdb',
      'reliabilityMdbLinearMm',
      'reliabilityExternalPrimaryMm',
      'reliabilityExternalAffectedStation',
      'reliabilityExternalDEmm',
      'reliabilityExternalDNmm',
      'reliabilityExternalDHmm',
    ]);
    // Every CSV header is unique; legacy compatibility MDB columns stay
    // separate from the active-model reliability MDB columns.
    expect(new Set(header).size).toBe(header.length);
    expect(header.indexOf('mdb')).toBeLessThan(header.indexOf('reliabilityMdb'));
    const idx = (name: string): number => header.indexOf(name);
    expect(lines[1].split(',').length).toBe(header.length);
    const dataRow = lines[1].split(',');
    expect(dataRow[idx('reliabilityModel')]).toBe('statistical');
    expect(dataRow[idx('reliabilityAlpha')]).toBe('0.001');
    expect(dataRow[idx('reliabilityPower')]).toBe('0.8');
    expect(dataRow[idx('reliabilityDelta0')]).toBe('4.132');
    expect(dataRow[idx('reliabilityMdb')]).not.toBe('');
    expect(dataRow[idx('reliabilityExternalPrimaryMm')]).not.toBe('');
    expect(dataRow[idx('reliabilityExternalAffectedStation')]).not.toBe('');
  });

  it('reports the active statistical MDB in reliabilityMdb while legacy mdb stays historical', () => {
    const statistical = run(OUTLIER_INPUT, { model: 'statistical', alpha: 0.001, power: 0.8 });
    const legacy = run(OUTLIER_INPUT);
    const text = buildObservationsResidualsCsvText({
      result: statistical as unknown as AdjustmentResult,
      units: 'm',
    });
    const lines = text.split('\n');
    const header = lines[0].split(',');
    const idx = (name: string): number => header.indexOf(name);
    // First data row is the first distance observation in both runs.
    const statObs = (statistical.observations as Observation[])[0] as Observation;
    const legacyObs = (legacy.observations as Observation[]).find(
      (o) => o.id === statObs.id,
    ) as Observation;
    const expectedActive =
      statObs.reliability?.mdbStatistical ?? statObs.reliability?.mdb ?? statObs.mdb;
    const row = lines[1].split(',');
    // Active reliability column carries the statistical value, formatted
    // with the same linear formatter as the legacy column.
    expect(row[idx('reliabilityMdb')]).toBe(
      (expectedActive as number).toFixed(4),
    );
    // Legacy compatibility column keeps the historical 3.29-scaled value.
    expect(row[idx('mdb')]).toBe((legacyObs.mdb as number).toFixed(4));
    expect(row[idx('reliabilityMdb')]).not.toBe(row[idx('mdb')]);
    // Angular linear equivalent follows the active (statistical) model.
    const angular = (statistical.observations as Observation[]).find(
      (o) => o.type === 'angle',
    ) as Observation;
    expect(angular.reliability?.mdbLinearMm).toBeDefined();
    const legacyAngular = (legacy.observations as Observation[]).find(
      (o) => o.type === 'angle',
    ) as Observation;
    const expectedRatio =
      (angular.reliability?.mdbStatistical as number) / (angular.mdb as number);
    expect(angular.reliability?.mdbLinearMm).toBeCloseTo(
      (legacyAngular.reliability?.mdbLinearMm as number) * expectedRatio,
      9,
    );
  });
});
