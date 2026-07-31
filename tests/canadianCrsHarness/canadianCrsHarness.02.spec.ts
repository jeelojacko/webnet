import { describe, expect, it } from 'vitest';
import {
  CANADIAN_CRS_TEST_CATALOG,
  runRepresentativeCanadianSyntheticCrsBatch,
  runSyntheticCrsAdjustmentTest,
  runSyntheticCrsMonteCarlo,
} from './canadianCrsHarnessTestSupport';

describe('Canadian CRS synthetic adjustment smoke harness', () => {
  it('recovers projected truth across the current Canada-first CRS support surface', () => {
    runRepresentativeCanadianSyntheticCrsBatch().forEach((synthetic) => {
      const row = CANADIAN_CRS_TEST_CATALOG.find((entry) => entry.webnetCrsId === synthetic.crsId);
      expect(row).toBeDefined();
      if (!row) {
        throw new Error(`Missing Canadian CRS test row for ${synthetic.crsId}`);
      }
      expect(synthetic.result.success, `${row.id} failed solve\n${synthetic.result.logs.join('\n')}`).toBe(true);
      expect(
        synthetic.metrics.maxHorizontalErrorM,
        `${row.id} max horizontal error too large for seed ${synthetic.seed}`,
      ).toBeLessThan(0.02);
      expect(
        synthetic.metrics.rmsHorizontalErrorM,
        `${row.id} RMS horizontal error too large for seed ${synthetic.seed}`,
      ).toBeLessThan(0.01);
      expect(
        synthetic.metrics.maxVerticalErrorM,
        `${row.id} max vertical error too large for seed ${synthetic.seed}`,
      ).toBeLessThan(synthetic.template === 'mixed-3d' ? 0.03 : 1e-9);
      expect(
        synthetic.metrics.residualRms,
        `${row.id} residual RMS too large for seed ${synthetic.seed}`,
      ).toBeLessThan(0.01);
      if (
        synthetic.template !== 'mixed-3d' &&
        synthetic.metrics.leafHorizontalSigmaM != null &&
        synthetic.metrics.mainAverageHorizontalSigmaM != null
      ) {
        expect(
          synthetic.metrics.leafHorizontalSigmaM,
          `${row.id} weak leaf precision did not stay weaker than tied main points`,
        ).toBeGreaterThanOrEqual(synthetic.metrics.mainAverageHorizontalSigmaM);
      }
    });
  });

  it('recovers mixed 3D truth with slope and zenith observations on representative CRS families', () => {
    const cases = [
      { crsId: 'CA_NAD83_CSRS_UTM_10N', seed: 5201 },
      { crsId: 'CA_NAD83_CSRS_MTM_08', seed: 5202 },
      { crsId: 'CA_NAD83_CSRS_NB_STEREO_DOUBLE', seed: 5203 },
      { crsId: 'CA_NAD83_CSRS_AB_3TM_117W', seed: 5204 },
    ];
    cases.forEach((testCase) => {
      const run = runSyntheticCrsAdjustmentTest({
        crsId: testCase.crsId,
        seed: testCase.seed,
        template: 'mixed-3d',
      });
      expect(run.result.success, `${testCase.crsId} mixed-3d failed`).toBe(true);
      expect(run.metrics.maxHorizontalErrorM, `${testCase.crsId} 3D horizontal drift`).toBeLessThan(
        0.03,
      );
      expect(run.metrics.maxVerticalErrorM, `${testCase.crsId} 3D vertical drift`).toBeLessThan(0.05);
      expect(run.result.observations.some((obs) => obs.type === 'zenith')).toBe(true);
    });
  });

  it('keeps noisy Monte Carlo results statistically centered on truth for representative families', () => {
    const summaries = [
      runSyntheticCrsMonteCarlo({
        crsId: 'CA_NAD83_CSRS_UTM_10N',
        template: 'short-traverse',
        seeds: [6101, 6102, 6103, 6104, 6105],
      }),
      runSyntheticCrsMonteCarlo({
        crsId: 'CA_NAD83_CSRS_MTM_08',
        template: 'loop',
        seeds: [6201, 6202, 6203, 6204, 6205],
      }),
      runSyntheticCrsMonteCarlo({
        crsId: 'CA_NAD83_CSRS_NB_STEREO_DOUBLE',
        template: 'mixed-3d',
        seeds: [6301, 6302, 6303, 6304, 6305],
      }),
      runSyntheticCrsMonteCarlo({
        crsId: 'CA_NAD83_CSRS_AB_3TM_117W',
        template: 'mixed-3d',
        seeds: [6401, 6402, 6403, 6404, 6405],
      }),
    ];
    summaries.forEach((summary) => {
      expect(summary.meanRmsHorizontalErrorM, `${summary.crsId} mean noisy horizontal RMS`).toBeLessThan(
        0.05,
      );
      expect(summary.maxHorizontalErrorM, `${summary.crsId} worst noisy horizontal error`).toBeLessThan(
        0.12,
      );
      expect(summary.meanResidualRms, `${summary.crsId} mean residual RMS`).toBeLessThan(0.05);
      expect(summary.meanSeuw, `${summary.crsId} mean SEUW unrealistic`).toBeGreaterThan(0.05);
      expect(summary.meanSeuw, `${summary.crsId} mean SEUW unrealistic`).toBeLessThan(10);
      if (summary.template === 'mixed-3d') {
        expect(summary.meanRmsVerticalErrorM, `${summary.crsId} mean noisy vertical RMS`).toBeLessThan(
          0.08,
        );
        expect(summary.maxVerticalErrorM, `${summary.crsId} worst noisy vertical error`).toBeLessThan(
          0.15,
        );
      }
    });
  });

  it('keeps noisy Monte Carlo results bounded for Priority 1 CRS rows', () => {
    const summaries = [
      runSyntheticCrsMonteCarlo({
        crsId: 'CA_NAD83_CSRS_QC_LAMBERT',
        template: 'short-traverse',
        seeds: [6501, 6502, 6503, 6504, 6505],
      }),
      runSyntheticCrsMonteCarlo({
        crsId: 'CA_NAD83_CSRS_NS_MTM_2010_4',
        template: 'loop',
        seeds: [6601, 6602, 6603, 6604, 6605],
      }),
      runSyntheticCrsMonteCarlo({
        crsId: 'CA_NAD83_CSRS_NS_MTM_2010_5',
        template: 'loop',
        seeds: [6701, 6702, 6703, 6704, 6705],
      }),
    ];
    summaries.forEach((summary) => {
      expect(summary.meanRmsHorizontalErrorM, `${summary.crsId} mean noisy horizontal RMS`).toBeLessThan(
        0.05,
      );
      expect(summary.maxHorizontalErrorM, `${summary.crsId} worst noisy horizontal error`).toBeLessThan(
        0.12,
      );
      expect(summary.meanResidualRms, `${summary.crsId} mean residual RMS`).toBeLessThan(0.05);
      expect(summary.meanSeuw, `${summary.crsId} mean SEUW unrealistic`).toBeGreaterThan(0.05);
      expect(summary.meanSeuw, `${summary.crsId} mean SEUW unrealistic`).toBeLessThan(10);
    });
  });

  it('keeps noisy Monte Carlo results bounded for Priority 2 CRS rows', () => {
    const summaries = [
      runSyntheticCrsMonteCarlo({
        crsId: 'CA_NAD83_CSRS_SK_ATS',
        template: 'short-traverse',
        seeds: [6801, 6802, 6803, 6804, 6805],
      }),
      runSyntheticCrsMonteCarlo({
        crsId: 'CA_NAD83_CSRS_MB_3TM',
        template: 'loop',
        seeds: [6901, 6902, 6903, 6904, 6905],
      }),
    ];
    summaries.forEach((summary) => {
      expect(summary.meanRmsHorizontalErrorM, `${summary.crsId} mean noisy horizontal RMS`).toBeLessThan(
        0.05,
      );
      expect(summary.maxHorizontalErrorM, `${summary.crsId} worst noisy horizontal error`).toBeLessThan(
        0.12,
      );
      expect(summary.meanResidualRms, `${summary.crsId} mean residual RMS`).toBeLessThan(0.05);
      expect(summary.meanSeuw, `${summary.crsId} mean SEUW unrealistic`).toBeGreaterThan(0.05);
      expect(summary.meanSeuw, `${summary.crsId} mean SEUW unrealistic`).toBeLessThan(10);
    });
  });

  it('keeps noisy Monte Carlo results bounded for Priority 3 CRS rows', () => {
    const summaries = [
      runSyntheticCrsMonteCarlo({
        crsId: 'CA_NAD83_CSRS_NU_STEREOGRAPHIC',
        template: 'short-traverse',
        seeds: [6951, 6952, 6953, 6954, 6955],
      }),
      runSyntheticCrsMonteCarlo({
        crsId: 'CA_NAD83_CSRS_YT_TM',
        template: 'loop',
        seeds: [6961, 6962, 6963, 6964, 6965],
      }),
      runSyntheticCrsMonteCarlo({
        crsId: 'CA_NAD83_CSRS_NT_TM',
        template: 'loop',
        seeds: [6971, 6972, 6973, 6974, 6975],
      }),
      runSyntheticCrsMonteCarlo({
        crsId: 'CA_NAD83_CSRS_QC_MUNICIPAL_LCC',
        template: 'short-traverse',
        seeds: [6981, 6982, 6983, 6984, 6985],
      }),
    ];
    summaries.forEach((summary) => {
      expect(summary.meanRmsHorizontalErrorM, `${summary.crsId} mean noisy horizontal RMS`).toBeLessThan(
        0.05,
      );
      expect(summary.maxHorizontalErrorM, `${summary.crsId} worst noisy horizontal error`).toBeLessThan(
        0.12,
      );
      expect(summary.meanResidualRms, `${summary.crsId} mean residual RMS`).toBeLessThan(0.05);
      expect(summary.meanSeuw, `${summary.crsId} mean SEUW unrealistic`).toBeGreaterThan(0.05);
      expect(summary.meanSeuw, `${summary.crsId} mean SEUW unrealistic`).toBeLessThan(10);
    });
  });

  it('keeps noisy Monte Carlo results bounded for Priority 4 CRS rows', () => {
    const summaries = [
      runSyntheticCrsMonteCarlo({
        crsId: 'CA_NAD83_CSRS_AB_10TM_FOREST',
        template: 'short-traverse',
        seeds: [6991, 6992, 6993, 6994, 6995],
      }),
      runSyntheticCrsMonteCarlo({
        crsId: 'CA_NAD83_CSRS_YT_ALBERS',
        template: 'loop',
        seeds: [7001, 7002, 7003, 7004, 7005],
      }),
      runSyntheticCrsMonteCarlo({
        crsId: 'CA_NAD83_CSRS_NT_LAMBERT',
        template: 'loop',
        seeds: [7011, 7012, 7013, 7014, 7015],
      }),
      runSyntheticCrsMonteCarlo({
        crsId: 'CA_NAD83_CSRS_CA_ATLAS_LAMBERT',
        template: 'short-traverse',
        seeds: [7021, 7022, 7023, 7024, 7025],
      }),
      runSyntheticCrsMonteCarlo({
        crsId: 'CA_NAD83_CSRS_ON_TERANET_LAMBERT',
        template: 'short-traverse',
        seeds: [7031, 7032, 7033, 7034, 7035],
      }),
      runSyntheticCrsMonteCarlo({
        crsId: 'CA_NAD83_CSRS_ARCTIC_LCC_3_29',
        template: 'short-traverse',
        seeds: [7041, 7042, 7043, 7044, 7045],
      }),
    ];
    summaries.forEach((summary) => {
      expect(summary.meanRmsHorizontalErrorM, `${summary.crsId} mean noisy horizontal RMS`).toBeLessThan(
        0.05,
      );
      expect(summary.maxHorizontalErrorM, `${summary.crsId} worst noisy horizontal error`).toBeLessThan(
        0.12,
      );
      expect(summary.meanResidualRms, `${summary.crsId} mean residual RMS`).toBeLessThan(0.05);
      expect(summary.meanSeuw, `${summary.crsId} mean SEUW unrealistic`).toBeGreaterThan(0.05);
      expect(summary.meanSeuw, `${summary.crsId} mean SEUW unrealistic`).toBeLessThan(10);
    });
  });

  it('recovers truth when synthetic jobs include angle and direction-set observations', () => {
    const angleRun = runSyntheticCrsAdjustmentTest({
      crsId: 'CA_NAD83_CSRS_UTM_10N',
      seed: 7101,
      template: 'short-traverse',
      observationOptions: {
        includeAngles: true,
      },
    });
    expect(angleRun.result.success, 'angle-backed synthetic run failed').toBe(true);
    expect(angleRun.result.observations.some((obs) => obs.type === 'angle')).toBe(true);
    expect(angleRun.metrics.maxHorizontalErrorM).toBeLessThan(0.03);

    const directionRun = runSyntheticCrsAdjustmentTest({
      crsId: 'CA_NAD83_CSRS_MTM_08',
      seed: 7102,
      template: 'loop',
      observationOptions: {
        includeDirections: true,
      },
    });
    expect(directionRun.result.success, 'direction-backed synthetic run failed').toBe(true);
    expect(directionRun.result.observations.some((obs) => obs.type === 'direction')).toBe(true);
    expect(directionRun.metrics.maxHorizontalErrorM).toBeLessThan(0.03);
  });

  it('keeps equivalent solutions under observation reorder, setup reorder, and point renaming variants', () => {
    const baseline = runSyntheticCrsAdjustmentTest({
      crsId: 'CA_NAD83_CSRS_MTM_08',
      seed: 7201,
      template: 'loop',
      observationOptions: {
        includeAngles: true,
        includeDirections: true,
      },
    });
    const reorderedObservations = runSyntheticCrsAdjustmentTest({
      crsId: 'CA_NAD83_CSRS_MTM_08',
      seed: 7201,
      template: 'loop',
      observationOptions: {
        includeAngles: true,
        includeDirections: true,
      },
      inputVariant: {
        observationOrder: 'reverse',
      },
    });
    const reorderedSetups = runSyntheticCrsAdjustmentTest({
      crsId: 'CA_NAD83_CSRS_MTM_08',
      seed: 7201,
      template: 'loop',
      observationOptions: {
        includeAngles: true,
        includeDirections: true,
      },
      inputVariant: {
        directionSetupOrder: 'reverse',
      },
    });
    const renamed = runSyntheticCrsAdjustmentTest({
      crsId: 'CA_NAD83_CSRS_MTM_08',
      seed: 7201,
      template: 'loop',
      observationOptions: {
        includeAngles: true,
        includeDirections: true,
      },
      inputVariant: {
        renamePrefix: 'R',
      },
    });

    [baseline, reorderedObservations, reorderedSetups, renamed].forEach((run) => {
      expect(run.result.success, `${run.crsId} invariance variant failed`).toBe(true);
    });

    expect(reorderedObservations.metrics.maxHorizontalErrorM).toBeCloseTo(
      baseline.metrics.maxHorizontalErrorM,
      6,
    );
    expect(reorderedSetups.metrics.maxHorizontalErrorM).toBeCloseTo(
      baseline.metrics.maxHorizontalErrorM,
      6,
    );
    expect(renamed.metrics.maxHorizontalErrorM).toBeCloseTo(baseline.metrics.maxHorizontalErrorM, 6);
    expect(reorderedObservations.metrics.residualRms).toBeCloseTo(baseline.metrics.residualRms, 6);
    expect(reorderedSetups.metrics.residualRms).toBeCloseTo(baseline.metrics.residualRms, 6);
    expect(renamed.metrics.residualRms).toBeCloseTo(baseline.metrics.residualRms, 6);
  });

});
