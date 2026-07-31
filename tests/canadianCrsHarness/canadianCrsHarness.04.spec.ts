import { describe, expect, it } from 'vitest';
import {
  buildSyntheticCrsGroupedSummary,
  formatSyntheticCrsMarkdownSummary,
  runSyntheticCrsAdjustmentTest,
} from './canadianCrsHarnessTestSupport';

describe('Canadian CRS synthetic adjustment smoke harness', () => {
  it('supports perfect precision mode for Priority 4 CRS rows', () => {
    const runs = [
      runSyntheticCrsAdjustmentTest({
        crsId: 'CA_NAD83_CSRS_AB_10TM_FOREST',
        seed: 9231,
        template: 'short-traverse',
        mode: 'noise-free',
        observationOptions: { precisionMode: 'perfect' },
      }),
      runSyntheticCrsAdjustmentTest({
        crsId: 'CA_NAD83_CSRS_YT_ALBERS',
        seed: 9232,
        template: 'loop',
        mode: 'noise-free',
        observationOptions: { precisionMode: 'perfect' },
      }),
      runSyntheticCrsAdjustmentTest({
        crsId: 'CA_NAD83_CSRS_NT_LAMBERT',
        seed: 9233,
        template: 'loop',
        mode: 'noise-free',
        observationOptions: { precisionMode: 'perfect' },
      }),
      runSyntheticCrsAdjustmentTest({
        crsId: 'CA_NAD83_CSRS_CA_ATLAS_LAMBERT',
        seed: 9234,
        template: 'short-traverse',
        mode: 'noise-free',
        observationOptions: { precisionMode: 'perfect' },
      }),
      runSyntheticCrsAdjustmentTest({
        crsId: 'CA_NAD83_CSRS_ON_TERANET_LAMBERT',
        seed: 9235,
        template: 'short-traverse',
        mode: 'noise-free',
        observationOptions: { precisionMode: 'perfect' },
      }),
      runSyntheticCrsAdjustmentTest({
        crsId: 'CA_NAD83_CSRS_ARCTIC_LCC_3_29',
        seed: 9236,
        template: 'short-traverse',
        mode: 'noise-free',
        observationOptions: { precisionMode: 'perfect' },
      }),
    ];
    runs.forEach((run) => {
      expect(run.result.success, `${run.crsId} perfect mode failed`).toBe(true);
      expect(run.metrics.maxHorizontalErrorM, `${run.crsId} perfect horizontal drift`).toBeLessThan(
        1e-8,
      );
      expect(run.metrics.rmsHorizontalErrorM, `${run.crsId} perfect RMS horizontal drift`).toBeLessThan(
        1e-8,
      );
      expect(run.metrics.residualRms, `${run.crsId} perfect residual RMS`).toBeLessThan(1e-8);
      expect(run.metrics.seuw, `${run.crsId} perfect SEUW`).toBeLessThan(1e-2);
    });
  });

  it('keeps grouped summary artifacts deterministic for Priority 1 rows', () => {
    const runs = [
      runSyntheticCrsAdjustmentTest({
        crsId: 'CA_NAD83_CSRS_QC_LAMBERT',
        seed: 9301,
        template: 'short-traverse',
      }),
      runSyntheticCrsAdjustmentTest({
        crsId: 'CA_NAD83_CSRS_NS_MTM_2010_4',
        seed: 9302,
        template: 'loop',
      }),
      runSyntheticCrsAdjustmentTest({
        crsId: 'CA_NAD83_CSRS_NS_MTM_2010_5',
        seed: 9303,
        template: 'loop',
      }),
    ];
    const summary = buildSyntheticCrsGroupedSummary(runs);
    const markdown = formatSyntheticCrsMarkdownSummary(runs);

    const provincialRows =
      summary.groups.find((group) => group.family === 'PROVINCIAL')?.rows.map((row) => row.crsId) ?? [];
    expect(provincialRows).toEqual([
      'CA_NAD83_CSRS_NS_MTM_2010_4',
      'CA_NAD83_CSRS_NS_MTM_2010_5',
      'CA_NAD83_CSRS_QC_LAMBERT',
    ]);
    expect(markdown).toContain('CA_NAD83_CSRS_QC_LAMBERT');
    expect(markdown).toContain('CA_NAD83_CSRS_NS_MTM_2010_4');
    expect(markdown).toContain('CA_NAD83_CSRS_NS_MTM_2010_5');
  });
});
