import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { Observation } from '../src/typesObservations';
import {
  formatObservationLinearResidualMm,
  formatObservationSigmaDisplay,
  getObservationStationDetails,
  getObservationStationDisplay,
} from '../src/components/report/observationReportDisplay';
import ObservationTableSection from '../src/components/report/ObservationTableSection';
import { getReportHeaderTooltip } from '../src/components/report/reportHeaderTooltips';

const baseProps = {
  title: 'Directions (DB/DN)',
  unitScale: 1,
  excludedIds: new Set<number>(),
  autoSideshotObsIds: new Set<number>(),
  selectedObservationId: null,
  onToggleExclude: () => {},
  rowSelectionClass: () => '',
  visibleRowsFor: <T,>(_key: string, rows: T[]) => rows,
  showMoreRows: () => {},
  showAllRows: () => {},
  renderSourceLineLink: (line: number | null | undefined) => (line == null ? '-' : `${line}`),
  isSectionCollapsed: () => false,
  isDetailSectionPinned: () => false,
  toggleDetailSection: () => {},
  togglePinnedDetailSection: () => {},
  formatMdb: () => '-',
  prismAnnotation: () => '',
};

const directionObs = {
  id: 1,
  type: 'direction',
  instCode: 'TS',
  setId: 'S1',
  at: '128',
  to: 'TIMS',
  obs: 1.0,
  stdDev: 0.00002,
  sigmaSource: 'explicit',
  rawCount: 4,
  rawFace1Count: 2,
  rawFace2Count: 2,
  residual: 0.00001,
  effectiveDistance: 100,
} as unknown as Observation;

describe('observationReportDisplay stations', () => {
  it('shows a concise direction pair with set/raw detail in the tooltip', () => {
    const display = getObservationStationDisplay(directionObs);
    expect(display.visible).toBe('128-TIMS');
    expect(display.visible).not.toContain('S1');
    expect(display.title).toContain('S1');
    expect(display.title).toContain('raw 4');
    expect(display.title).toContain('F1:2');
    expect(display.title).toContain('F2:2');
    expect(display.ariaLabel).toBe(display.title);
  });

  it('keeps all three angle stations visible', () => {
    const obs = {
      id: 2,
      type: 'angle',
      instCode: 'TS',
      at: 'A',
      from: 'B',
      to: 'C',
      obs: 1.0,
      stdDev: 0.00002,
    } as unknown as Observation;
    expect(getObservationStationDisplay(obs).visible).toBe('A-B-C');
  });

  it('shows pairs for dist/gps/lev and keeps AUTO-SS out of the visible label', () => {
    const dist = {
      id: 3,
      type: 'dist',
      instCode: 'TS',
      from: 'A',
      to: 'B',
      obs: 100,
      stdDev: 0.005,
    } as unknown as Observation;
    const shown = getObservationStationDisplay(dist, { autoSideshot: true });
    expect(shown.visible).toBe('A-B');
    expect(shown.title).toContain('AUTO-SS');
    const gps = {
      id: 4,
      type: 'gps',
      instCode: 'GPS',
      from: 'A',
      to: 'B',
      obs: { dE: 1, dN: 2 },
      stdDev: 0.01,
      gpsVectorLabel: 'G1',
    } as unknown as Observation;
    expect(getObservationStationDisplay(gps).visible).toBe('A-B');
    expect(getObservationStationDetails(gps)).toContain('G1');
  });
});

describe('formatObservationLinearResidualMm', () => {
  it('converts angular residual x distance to mm with browser sign', () => {
    const obs = {
      id: 5,
      type: 'direction',
      instCode: 'TS',
      at: 'A',
      to: 'B',
      obs: 1,
      stdDev: 0.00002,
      residual: 0.00001,
      effectiveDistance: 100,
    } as unknown as Observation;
    const out = formatObservationLinearResidualMm(obs);
    expect(out?.text).toBe((0.00001 * 100 * 1000).toFixed(1));
    expect(out?.title).toContain('Effective distance');
  });

  it('handles negative and zero residuals', () => {
    const neg = {
      id: 6,
      type: 'direction',
      instCode: 'TS',
      at: 'A',
      to: 'B',
      obs: 1,
      stdDev: 0.00002,
      residual: -0.00002,
      effectiveDistance: 50,
    } as unknown as Observation;
    expect(formatObservationLinearResidualMm(neg)?.text).toBe((-0.00002 * 50 * 1000).toFixed(1));
    const zero = { ...neg, residual: 0 } as unknown as Observation;
    expect(formatObservationLinearResidualMm(zero)?.text).toBe((0).toFixed(1));
  });

  it('converts dist/lev residuals from metres to mm', () => {
    const dist = {
      id: 7,
      type: 'dist',
      instCode: 'TS',
      from: 'A',
      to: 'B',
      obs: 100,
      stdDev: 0.005,
      residual: 0.003,
    } as unknown as Observation;
    expect(formatObservationLinearResidualMm(dist)?.text).toBe((3).toFixed(1));
    const lev = {
      id: 17,
      type: 'lev',
      instCode: 'TS',
      from: 'A',
      to: 'B',
      obs: 10,
      stdDev: 0.002,
      residual: 0.0025,
    } as unknown as Observation;
    expect(formatObservationLinearResidualMm(lev)?.text).toBe((2.5).toFixed(1));
  });

  it('returns - for missing/non-finite and null for GPS', () => {
    const missing = {
      id: 8,
      type: 'direction',
      instCode: 'TS',
      at: 'A',
      to: 'B',
      obs: 1,
      stdDev: 0.00002,
    } as unknown as Observation;
    expect(formatObservationLinearResidualMm(missing)?.text).toBe('-');
    const bad = { ...missing, residual: Number.NaN, effectiveDistance: 10 } as unknown as Observation;
    expect(formatObservationLinearResidualMm(bad)?.text).toBe('-');
    const gps = {
      id: 9,
      type: 'gps',
      instCode: 'GPS',
      from: 'A',
      to: 'B',
      obs: { dE: 1, dN: 2 },
      stdDev: 0.01,
    } as unknown as Observation;
    expect(formatObservationLinearResidualMm(gps)).toBeNull();
  });
});

describe('formatObservationSigmaDisplay', () => {
  it('shows explicit angular sigma in arcseconds', () => {
    const out = formatObservationSigmaDisplay(directionObs);
    expect(out.visible).toBe(`${(0.00002 * 206264.80624709636).toFixed(1)}"`);
    expect(out.title).toContain('explicit');
  });

  it('shows explicit linear sigma in mm', () => {
    const dist = {
      id: 10,
      type: 'dist',
      instCode: 'TS',
      from: 'A',
      to: 'B',
      obs: 100,
      stdDev: 0.005,
      sigmaSource: 'explicit',
    } as unknown as Observation;
    const out = formatObservationSigmaDisplay(dist);
    expect(out.visible).toBe('5.0 mm');
  });

  it('collapses default sigma to a dash with the value in the tooltip', () => {
    const obs = { ...directionObs, sigmaSource: 'default' } as unknown as Observation;
    const out = formatObservationSigmaDisplay(obs);
    expect(out.visible).toBe('-');
    expect(out.title).toContain('Default');
  });

  it('retains fixed/float provenance', () => {
    const fixed = { ...directionObs, sigmaSource: 'fixed' } as unknown as Observation;
    const out = formatObservationSigmaDisplay(fixed);
    expect(out.visible).not.toBe('-');
    expect(out.title).toContain('FIXED');
  });

  it('prefers weightingStdDev over stdDev and marks the input-sigma fallback', () => {
    const weighted = {
      ...directionObs,
      stdDev: 0.00002,
      weightingStdDev: 0.00003,
    } as unknown as Observation;
    const out = formatObservationSigmaDisplay(weighted);
    expect(out.visible).toBe(`${(0.00003 * 206264.80624709636).toFixed(1)}"`);
    expect(out.title).not.toContain('fallback');
    const fallback = formatObservationSigmaDisplay(directionObs);
    expect(fallback.visible).toBe(`${(0.00002 * 206264.80624709636).toFixed(1)}"`);
    expect(fallback.title).toContain('fallback');
  });

  it('passes GPS weighting through without inventing a scalar', () => {
    const gps = {
      id: 11,
      type: 'gps',
      instCode: 'GPS',
      from: 'A',
      to: 'B',
      obs: { dE: 1, dN: 2 },
      stdDev: 0.01,
      sigmaSourceE: 'explicit',
      sigmaSourceN: 'explicit',
    } as unknown as Observation;
    const out = formatObservationSigmaDisplay(gps);
    expect(out.visible).toBe('EXPLICIT');
  });

  it('labels mixed GNSS E/N provenance without a scalar', () => {
    const mixed = {
      id: 18,
      type: 'gps',
      instCode: 'GPS',
      from: 'A',
      to: 'B',
      obs: { dE: 1, dN: 2 },
      stdDev: 0.01,
      sigmaSourceE: 'fixed',
      sigmaSourceN: 'float',
    } as unknown as Observation;
    const mixedOut = formatObservationSigmaDisplay(mixed);
    expect(mixedOut.visible).toBe('E=FIXED N=FLOAT');
    expect(mixedOut.title).toContain('GNSS');
  });
});

describe('getReportHeaderTooltip', () => {
  it('uses browser-sign wording for RESIDUAL/LINRES and corrected statistics notes', () => {
    expect(getReportHeaderTooltip('Residual')).toContain('browser sign');
    expect(getReportHeaderTooltip('LinRes (mm)')).toContain('browser sign');
    const redund = getReportHeaderTooltip('REDUND');
    expect(redund).toContain('detectability');
    expect(redund).not.toContain('StdRes');
    expect(getReportHeaderTooltip('MDB')).toContain('critical value');
    expect(getReportHeaderTooltip('MDB')).not.toContain('power');
    expect(getReportHeaderTooltip('LOCAL')).toContain('2D GNSS');
    expect(getReportHeaderTooltip('σ')).toContain('GNSS');
  });
});

describe('ObservationTableSection headers', () => {
  it('drops Type/EffDist/Weight in favour of LinRes and sigma', () => {
    const html = renderToStaticMarkup(
      React.createElement(ObservationTableSection, { ...baseProps, obsList: [directionObs] }),
    );
    expect(html).not.toContain('>Type<');
    expect(html).not.toContain('EffDist');
    expect(html).not.toContain('>Weight<');
    expect(html).toContain('LinRes (mm)');
    expect(html).toContain('σ');
    expect(html).toContain('Stations');
    expect(html).toContain('Residual');
    expect(html).toContain('StdRes');
    expect(html).toContain('Redund');
    expect(html).toContain('MDB');
    expect(html).toContain('data-report-observation-row="1"');
    expect(html).toContain('128-TIMS');
  });

  it('exposes station detail via title, aria-label and keyboard focus', () => {
    const html = renderToStaticMarkup(
      React.createElement(ObservationTableSection, { ...baseProps, obsList: [directionObs] }),
    );
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('title="128-TIMS | Set S1');
    expect(html).toContain('aria-label="128-TIMS | Set S1');
  });

  it('shows prism detail once via the formatted annotation', () => {
    const dist = {
      id: 19,
      type: 'dist',
      instCode: 'TS',
      from: 'A',
      to: 'B',
      obs: 100,
      stdDev: 0.005,
      prismCorrectionM: 0.001,
      prismScope: 'global',
    } as unknown as Observation;
    const html = renderToStaticMarkup(
      React.createElement(ObservationTableSection, {
        ...baseProps,
        obsList: [dist],
        prismAnnotation: () => ' [PRISM global +0.0010m]',
      }),
    );
    expect(html).toContain('PRISM global +0.0010m');
    expect(html).not.toContain('prism global 0.001');
  });
});
