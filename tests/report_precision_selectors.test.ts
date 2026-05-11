import { describe, expect, it } from 'vitest';

import { buildReportPrecisionSelectorModel } from '../src/components/report/reportPrecisionSelectors';

describe('reportPrecisionSelectors', () => {
  it('builds filtered preanalysis precision rows and weak-geometry flags from one selector pass', () => {
    const model = buildReportPrecisionSelectorModel({
      result: {
        stations: {
          A: { x: 0, y: 0, h: 0, fixed: true, sN: 0.2, sE: 0.3, sH: 0.4 },
          P: { x: 10, y: 20, h: 5, fixed: false, sN: 0.5, sE: 0.6, sH: 0.7 },
        },
        observations: [
          {
            id: 1,
            type: 'dist',
            subtype: 'ts',
            from: 'A',
            to: 'P',
            obs: 10,
            instCode: 'TS',
            stdDev: 0.003,
          },
          {
            id: 2,
            type: 'bearing',
            from: 'A',
            to: 'P',
            obs: 0.25,
            instCode: 'TS',
            stdDev: 1,
            planned: true,
            sigmaSource: 'fixed',
          },
        ],
        relativePrecision: [{ from: 'A', to: 'P', sigmaN: 0.11, sigmaE: 0.12, sigmaDist: 0.13 }],
        weakGeometryDiagnostics: {
          enabled: true,
          stationMedianHorizontal: 0.02,
          relativeMedianDistance: 0.03,
          stationCues: [
            {
              stationId: 'P',
              severity: 'weak',
              horizontalMetric: 0.5,
              note: 'weak station',
            },
          ],
          relativeCues: [
            {
              from: 'A',
              to: 'P',
              severity: 'watch',
              note: 'watch pair',
            },
          ],
        },
      },
      reconciledDescriptions: { A: 'Control', P: 'Traverse' },
      matchesReportQuery: (...parts) => parts.join(' ').includes('P'),
      stationCovariances: [
        {
          stationId: 'P',
          cEE: 1,
          cEN: 0,
          cNN: 1,
          sigmaE: 0.01,
          sigmaN: 0.02,
          sigmaH: 0.03,
          ellipse: { semiMajor: 0.04, semiMinor: 0.02, theta: 25 },
        },
      ],
      relativeCovariances: [
        {
          from: 'A',
          to: 'P',
          connected: true,
          connectionTypes: ['dist'],
          cEE: 1,
          cEN: 0,
          cNN: 1,
          sigmaE: 0.1,
          sigmaN: 0.2,
          sigmaDist: 0.3,
        },
      ],
      relativePrecisionRows: [{ from: 'A', to: 'P', sigmaN: 0.11, sigmaE: 0.12, sigmaDist: 0.13 }],
      isPreanalysis: true,
    });

    expect(model.filteredStationRows).toHaveLength(1);
    expect(model.filteredStationRows[0][0]).toBe('P');
    expect(model.filteredStationRows[0][1].sN).toBe(0.02);
    expect(model.filteredStationCovariances).toHaveLength(1);
    expect(model.filteredRelativeCovariances).toHaveLength(1);
    expect(model.filteredRelativePrecision).toHaveLength(1);
    expect(model.lockedPreanalysisObservations.map((obs) => obs.id)).toEqual([2]);
    expect(model.flaggedStationCues).toHaveLength(1);
    expect(model.flaggedRelativeCues).toHaveLength(1);
  });
});
