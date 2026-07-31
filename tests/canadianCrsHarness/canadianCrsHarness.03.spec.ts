import { describe, expect, it } from 'vitest';
import {
  buildSyntheticCrsGroupedSummary,
  formatSyntheticCrsMarkdownSummary,
  runSyntheticCrsAdjustmentTest,
  runSyntheticCrsEdgeJobs,
} from './canadianCrsHarnessTestSupport';

describe('Canadian CRS synthetic adjustment smoke harness', () => {
  it('solves representative edge-of-area jobs near CRS bounds', () => {
    const edgeRuns = [
      ...runSyntheticCrsEdgeJobs({
        crsId: 'CA_NAD83_CSRS_UTM_10N',
        template: 'short-traverse',
        seed: 7301,
      }),
      ...runSyntheticCrsEdgeJobs({
        crsId: 'CA_NAD83_CSRS_NB_STEREO_DOUBLE',
        template: 'mixed-3d',
        seed: 7302,
      }),
    ];

    expect(edgeRuns.length).toBeGreaterThanOrEqual(6);
    edgeRuns.forEach((run) => {
      expect(run.result.success, `${run.crsId} ${run.placement} edge run failed`).toBe(true);
      expect(run.metrics.maxHorizontalErrorM, `${run.crsId} ${run.placement} horizontal drift`).toBeLessThan(
        0.05,
      );
      if (run.template === 'mixed-3d') {
        expect(run.metrics.maxVerticalErrorM, `${run.crsId} ${run.placement} vertical drift`).toBeLessThan(
          0.08,
        );
      }
    });
  });

  it('solves Priority 1 edge-of-area jobs near CRS bounds', () => {
    const edgeRuns = [
      ...runSyntheticCrsEdgeJobs({
        crsId: 'CA_NAD83_CSRS_QC_LAMBERT',
        template: 'short-traverse',
        seed: 7351,
      }),
      ...runSyntheticCrsEdgeJobs({
        crsId: 'CA_NAD83_CSRS_NS_MTM_2010_4',
        template: 'loop',
        seed: 7352,
      }),
      ...runSyntheticCrsEdgeJobs({
        crsId: 'CA_NAD83_CSRS_NS_MTM_2010_5',
        template: 'loop',
        seed: 7353,
      }),
    ];
    expect(edgeRuns.length).toBe(12);
    edgeRuns.forEach((run) => {
      expect(run.result.success, `${run.crsId} ${run.placement} edge run failed`).toBe(true);
      expect(run.metrics.maxHorizontalErrorM, `${run.crsId} ${run.placement} horizontal drift`).toBeLessThan(
        0.05,
      );
    });
  });

  it('solves Priority 2 edge-of-area jobs near CRS bounds', () => {
    const edgeRuns = [
      ...runSyntheticCrsEdgeJobs({
        crsId: 'CA_NAD83_CSRS_SK_ATS',
        template: 'short-traverse',
        seed: 7361,
      }),
      ...runSyntheticCrsEdgeJobs({
        crsId: 'CA_NAD83_CSRS_MB_3TM',
        template: 'loop',
        seed: 7362,
      }),
    ];
    expect(edgeRuns.length).toBe(8);
    edgeRuns.forEach((run) => {
      expect(run.result.success, `${run.crsId} ${run.placement} edge run failed`).toBe(true);
      expect(run.metrics.maxHorizontalErrorM, `${run.crsId} ${run.placement} horizontal drift`).toBeLessThan(
        0.05,
      );
    });
  });

  it('solves Priority 3 edge-of-area jobs near CRS bounds', () => {
    const edgeRuns = [
      ...runSyntheticCrsEdgeJobs({
        crsId: 'CA_NAD83_CSRS_NU_STEREOGRAPHIC',
        template: 'short-traverse',
        seed: 7371,
      }),
      ...runSyntheticCrsEdgeJobs({
        crsId: 'CA_NAD83_CSRS_YT_TM',
        template: 'loop',
        seed: 7372,
      }),
      ...runSyntheticCrsEdgeJobs({
        crsId: 'CA_NAD83_CSRS_NT_TM',
        template: 'loop',
        seed: 7373,
      }),
      ...runSyntheticCrsEdgeJobs({
        crsId: 'CA_NAD83_CSRS_QC_MUNICIPAL_LCC',
        template: 'short-traverse',
        seed: 7374,
      }),
    ];
    expect(edgeRuns.length).toBe(16);
    edgeRuns.forEach((run) => {
      expect(run.result.success, `${run.crsId} ${run.placement} edge run failed`).toBe(true);
      expect(run.metrics.maxHorizontalErrorM, `${run.crsId} ${run.placement} horizontal drift`).toBeLessThan(
        0.05,
      );
    });
  });

  it('solves Priority 4 edge-of-area jobs near CRS bounds', () => {
    const edgeRuns = [
      ...runSyntheticCrsEdgeJobs({
        crsId: 'CA_NAD83_CSRS_AB_10TM_FOREST',
        template: 'short-traverse',
        seed: 7381,
      }),
      ...runSyntheticCrsEdgeJobs({
        crsId: 'CA_NAD83_CSRS_YT_ALBERS',
        template: 'loop',
        seed: 7382,
      }),
      ...runSyntheticCrsEdgeJobs({
        crsId: 'CA_NAD83_CSRS_NT_LAMBERT',
        template: 'loop',
        seed: 7383,
      }),
      ...runSyntheticCrsEdgeJobs({
        crsId: 'CA_NAD83_CSRS_CA_ATLAS_LAMBERT',
        template: 'short-traverse',
        seed: 7384,
      }),
      ...runSyntheticCrsEdgeJobs({
        crsId: 'CA_NAD83_CSRS_ON_TERANET_LAMBERT',
        template: 'short-traverse',
        seed: 7385,
      }),
      ...runSyntheticCrsEdgeJobs({
        crsId: 'CA_NAD83_CSRS_ARCTIC_LCC_3_29',
        template: 'short-traverse',
        seed: 7386,
      }),
    ];
    expect(edgeRuns.length).toBe(24);
    edgeRuns.forEach((run) => {
      expect(run.result.success, `${run.crsId} ${run.placement} edge run failed`).toBe(true);
      expect(run.metrics.maxHorizontalErrorM, `${run.crsId} ${run.placement} horizontal drift`).toBeLessThan(
        0.05,
      );
    });
  });

  it('builds grouped markdown and machine summaries for synthetic CRS runs', () => {
    const runs = [
      runSyntheticCrsAdjustmentTest({
        crsId: 'CA_NAD83_CSRS_UTM_10N',
        seed: 7401,
        template: 'short-traverse',
      }),
      runSyntheticCrsAdjustmentTest({
        crsId: 'CA_NAD83_CSRS_MTM_08',
        seed: 7402,
        template: 'loop',
        observationOptions: { includeDirections: true },
      }),
      runSyntheticCrsAdjustmentTest({
        crsId: 'CA_NAD83_CSRS_AB_3TM_117W',
        seed: 7403,
        template: 'mixed-3d',
      }),
    ];

    const summary = buildSyntheticCrsGroupedSummary(runs);
    const markdown = formatSyntheticCrsMarkdownSummary(runs);

    expect(summary.groups.map((group) => group.family)).toEqual(['UTM', 'MTM', 'PROVINCIAL']);
    expect(summary.groups[0]?.rows[0]?.crsId).toBe('CA_NAD83_CSRS_UTM_10N');
    expect(markdown).toContain('# Canadian Synthetic CRS Summary');
    expect(markdown).toContain('## UTM');
    expect(markdown).toContain('## MTM');
    expect(markdown).toContain('## PROVINCIAL');
    expect(markdown).toContain('CA_NAD83_CSRS_AB_3TM_117W');
  });

  it('supports perfect precision mode for near-zero noise-free residual and coordinate drift', () => {
    const run = runSyntheticCrsAdjustmentTest({
      crsId: 'CA_NAD83_CSRS_UTM_10N',
      seed: 9101,
      template: 'short-traverse',
      mode: 'noise-free',
      observationOptions: {
        precisionMode: 'perfect',
      },
    });
    expect(run.result.success).toBe(true);
    expect(run.metrics.maxHorizontalErrorM).toBeLessThan(1e-8);
    expect(run.metrics.rmsHorizontalErrorM).toBeLessThan(1e-8);
    expect(run.metrics.residualRms).toBeLessThan(1e-8);
    expect(run.metrics.seuw).toBeLessThan(1e-2);
  });

  it('supports perfect precision mode for Priority 1 CRS rows', () => {
    const runs = [
      runSyntheticCrsAdjustmentTest({
        crsId: 'CA_NAD83_CSRS_QC_LAMBERT',
        seed: 9201,
        template: 'short-traverse',
        mode: 'noise-free',
        observationOptions: { precisionMode: 'perfect' },
      }),
      runSyntheticCrsAdjustmentTest({
        crsId: 'CA_NAD83_CSRS_NS_MTM_2010_4',
        seed: 9202,
        template: 'loop',
        mode: 'noise-free',
        observationOptions: { precisionMode: 'perfect' },
      }),
      runSyntheticCrsAdjustmentTest({
        crsId: 'CA_NAD83_CSRS_NS_MTM_2010_5',
        seed: 9203,
        template: 'loop',
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

  it('supports perfect precision mode for Priority 2 CRS rows', () => {
    const runs = [
      runSyntheticCrsAdjustmentTest({
        crsId: 'CA_NAD83_CSRS_SK_ATS',
        seed: 9211,
        template: 'short-traverse',
        mode: 'noise-free',
        observationOptions: { precisionMode: 'perfect' },
      }),
      runSyntheticCrsAdjustmentTest({
        crsId: 'CA_NAD83_CSRS_MB_3TM',
        seed: 9212,
        template: 'loop',
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

  it('supports perfect precision mode for Priority 3 CRS rows', () => {
    const runs = [
      runSyntheticCrsAdjustmentTest({
        crsId: 'CA_NAD83_CSRS_NU_STEREOGRAPHIC',
        seed: 9221,
        template: 'short-traverse',
        mode: 'noise-free',
        observationOptions: { precisionMode: 'perfect' },
      }),
      runSyntheticCrsAdjustmentTest({
        crsId: 'CA_NAD83_CSRS_YT_TM',
        seed: 9222,
        template: 'loop',
        mode: 'noise-free',
        observationOptions: { precisionMode: 'perfect' },
      }),
      runSyntheticCrsAdjustmentTest({
        crsId: 'CA_NAD83_CSRS_NT_TM',
        seed: 9223,
        template: 'loop',
        mode: 'noise-free',
        observationOptions: { precisionMode: 'perfect' },
      }),
      runSyntheticCrsAdjustmentTest({
        crsId: 'CA_NAD83_CSRS_QC_MUNICIPAL_LCC',
        seed: 9224,
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

});
