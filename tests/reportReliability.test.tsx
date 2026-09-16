import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { solveEngine } from '../src/engine/solveEngine';
import type { ReliabilityPolicy } from '../src/engine/reliabilityPolicy';
import {
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

  it('discloses the statistical model, alpha/power, and linear equivalent in the MDB tooltip', () => {
    const result = run(OUTLIER_INPUT, { model: 'statistical', alpha: 0.001, power: 0.9 });
    const angular = result.observations.find((o) => o.type === 'angle') as Observation;
    const tip = buildMdbCellTooltip(angular, result.reliabilitySummary);
    expect(tip).toContain('Statistical MDB');
    expect(tip).toContain('alpha 0.001');
    expect(tip).toContain('power 0.9');
    expect(tip).toContain('Linear equivalent');
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
      'mdb',
      'mdbLinearMm',
      'externalPrimaryMm',
      'externalAffectedStation',
      'externalDEmm',
      'externalDNmm',
      'externalDHmm',
    ]);
    const idx = (name: string): number => header.indexOf(name);
    expect(lines[1].split(',').length).toBe(header.length);
    const dataRow = lines[1].split(',');
    expect(dataRow[idx('reliabilityModel')]).toBe('statistical');
    expect(dataRow[idx('reliabilityAlpha')]).toBe('0.001');
    expect(dataRow[idx('reliabilityPower')]).toBe('0.8');
    expect(dataRow[idx('reliabilityDelta0')]).toBe('4.132');
    expect(dataRow[idx('mdb')]).not.toBe('');
    expect(dataRow[idx('externalPrimaryMm')]).not.toBe('');
    expect(dataRow[idx('externalAffectedStation')]).not.toBe('');
  });
});
