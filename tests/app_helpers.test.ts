import { describe, expect, it } from 'vitest';

import {
  buildObservationModeFromGridFields,
  buildPendingRunSettingDiffs,
  parseInstrumentLibraryFromInput,
} from '../src/app/appHelpers';

describe('app helpers', () => {
  it('parses quoted instrument descriptions and extended numeric fields from input text', () => {
    const library = parseInstrumentLibraryFromInput(
      `I S9 "field gun" 0.001 1 0.5 0.6 0.01 0.02 0.03 4 0.7 0.8 0.04 0.05 0.06`,
    );

    expect(library.S9).toMatchObject({
      code: 'S9',
      desc: 'field gun',
      edm_const: 0.001,
      edm_ppm: 1,
      hzPrecision_sec: 0.5,
      vaPrecision_sec: 0.6,
      instCentr_m: 0.01,
      tgtCentr_m: 0.02,
      gpsStd_xy: 0.03,
      levStd_mmPerKm: 4,
      dirPrecision_sec: 0.7,
      azBearingPrecision_sec: 0.8,
      vertCentr_m: 0.04,
      elevDiff_const_m: 0.05,
      elevDiff_ppm: 0.06,
    });
  });

  it('formats pending run-setting diffs with stable TS correlation and robust labels', () => {
    const diffs = buildPendingRunSettingDiffs(
      {
        units: 'ft',
        runMode: 'data-check',
        solveProfile: 'industry-parity',
        coordMode: '2D',
        coordSystemMode: 'grid',
        crsId: 'EPSG:1234',
        maxIterations: 12,
        convergenceLimit: 0.0012,
        precisionReportingMode: 'industry-standard',
        directionSetMode: 'raw',
        mapMode: 'on',
        mapScaleFactor: 0.999999,
        verticalReduction: 'curvref',
        applyCurvatureRefraction: true,
        tsCorrelationEnabled: true,
        tsCorrelationScope: 'setup',
        tsCorrelationRho: 0.35,
        robustMode: 'huber',
        robustK: 1.7,
        clusterDetectionEnabled: true,
        autoSideshotEnabled: false,
        autoAdjustEnabled: true,
        autoAdjustMaxCycles: 4,
        autoAdjustMaxRemovalsPerCycle: 2,
        autoAdjustStdResThreshold: 3.5,
        suspectImpactMode: 'off',
        selectedInstrument: 'S9',
      },
      {
        units: 'm',
        runMode: 'adjustment',
        solveProfile: 'industry-parity',
        coordMode: '3D',
        coordSystemMode: 'local',
        crsId: '',
        maxIterations: 8,
        convergenceLimit: 0.002,
        precisionReportingMode: 'industry-standard',
        directionSetMode: 'reduced',
        mapMode: 'off',
        mapScaleFactor: 1,
        verticalReduction: 'none',
        applyCurvatureRefraction: false,
        tsCorrelationEnabled: false,
        tsCorrelationScope: 'set',
        tsCorrelationRho: 0,
        robustMode: 'none',
        robustK: 1.5,
        clusterDetectionEnabled: false,
        autoSideshotEnabled: true,
        autoAdjustEnabled: false,
        autoAdjustMaxCycles: 1,
        autoAdjustMaxRemovalsPerCycle: 1,
        autoAdjustStdResThreshold: 3,
        suspectImpactMode: 'auto',
        selectedInstrument: '',
      },
    );

    expect(diffs).toContain('Units: m -> ft');
    expect(diffs).toContain('TS Correlation: off -> setup @ 0.35');
    expect(diffs).toContain('Robust Model: off -> huber @ 1.70');
    expect(diffs).toContain('Instrument: none -> S9');
  });

  it('builds observation-mode state from grid field selections without remapping values', () => {
    expect(
      buildObservationModeFromGridFields({
        gridBearingMode: 'grid',
        gridDistanceMode: 'ellipsoidal',
        gridAngleMode: 'measured',
        gridDirectionMode: 'grid',
      }),
    ).toEqual({
      bearing: 'grid',
      distance: 'ellipsoidal',
      angle: 'measured',
      direction: 'grid',
    });
  });
});
