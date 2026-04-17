import proj4 from 'proj4';
import { describe, expect, it } from 'vitest';

import {
  CANADIAN_CRS_TEST_CATALOG,
  formatCanadianCrsCatalogReport,
} from '../src/engine/canadianCrsTestCatalog';
import { inverseENToGeodetic, projectGeodeticToEN } from '../src/engine/geodesy';
import { getCrsDefinition } from '../src/engine/crsCatalog';
import {
  buildSyntheticCrsGroupedSummary,
  formatSyntheticCrsMarkdownSummary,
  runRepresentativeCanadianSyntheticCrsBatch,
  runSyntheticCrsAdjustmentTest,
  runSyntheticCrsEdgeJobs,
  runSyntheticCrsMonteCarlo,
} from '../src/engine/runSyntheticCrsAdjustmentTest';

describe('Canadian CRS synthetic harness catalog', () => {
  it('keeps required metadata and deterministic ordering for every Canadian test CRS', () => {
    expect(CANADIAN_CRS_TEST_CATALOG.length).toBeGreaterThan(24);
    expect(CANADIAN_CRS_TEST_CATALOG[0]?.family).toBe('UTM');
    const ids = new Set<string>();
    CANADIAN_CRS_TEST_CATALOG.forEach((row) => {
      expect(ids.has(row.id)).toBe(false);
      ids.add(row.id);
      expect(row.name.length).toBeGreaterThan(0);
      expect(row.projectionMethod.length).toBeGreaterThan(0);
      expect(row.sourceProvenance.length).toBeGreaterThan(0);
      expect(row.axisOrder).toBe('EN');
      expect(row.units).toBe('metre');
      expect(row.areaOfUse.westLon).toBeLessThan(row.areaOfUse.eastLon);
      expect(row.areaOfUse.southLat).toBeLessThan(row.areaOfUse.northLat);
    });
    expect(CANADIAN_CRS_TEST_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_AB_3TM_111W')).toBe(
      true,
    );
    expect(CANADIAN_CRS_TEST_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_QC_LAMBERT')).toBe(
      true,
    );
    expect(
      CANADIAN_CRS_TEST_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_NS_MTM_2010_4'),
    ).toBe(true);
    expect(
      CANADIAN_CRS_TEST_CATALOG.some((row) => row.id === 'CA_NAD83_CSRS_NS_MTM_2010_5'),
    ).toBe(true);
    expect(
      CANADIAN_CRS_TEST_CATALOG.filter((row) => row.family === 'UTM').every(
        (row) => row.status === 'current' && String(row.code ?? '').startsWith('228'),
      ),
    ).toBe(true);
    const qcLambert = CANADIAN_CRS_TEST_CATALOG.find((row) => row.id === 'CA_NAD83_CSRS_QC_LAMBERT');
    expect(qcLambert?.code).toBe(3799);
    expect(
      qcLambert?.sourceProvenance.some((source) => source.reference.includes('EPSG:3799')),
    ).toBe(true);
  });

  it('formats a report with provenance and projection metadata', () => {
    const report = formatCanadianCrsCatalogReport();
    expect(report).toContain('Canadian CRS synthetic harness catalog');
    expect(report).toContain('CA_NAD83_CSRS_NB_STEREO_DOUBLE');
    expect(report).toContain('sources:');
    expect(report).toContain('projection:');
  });
});

describe('Canadian CRS transform validation', () => {
  it('round-trips representative area-of-use centers against direct proj4 projection', () => {
    CANADIAN_CRS_TEST_CATALOG.forEach((row, index) => {
      const def = getCrsDefinition(row.webnetCrsId);
      expect(def).toBeDefined();
      if (!def?.areaOfUseBounds) return;
      const latDeg = def.areaOfUseBounds.minLatDeg + (def.areaOfUseBounds.maxLatDeg - def.areaOfUseBounds.minLatDeg) * 0.5;
      const lonDeg = def.areaOfUseBounds.minLonDeg + (def.areaOfUseBounds.maxLonDeg - def.areaOfUseBounds.minLonDeg) * 0.5;

      const direct = proj4('WGS84', def.proj4, [lonDeg, latDeg]);
      const projected = projectGeodeticToEN({
        latDeg,
        lonDeg,
        originLatDeg: latDeg,
        originLonDeg: lonDeg,
        model: 'local-enu',
        coordSystemMode: 'grid',
        crsId: row.webnetCrsId,
      });

      expect(projected.east, `${row.id} east mismatch at case ${index}`).toBeCloseTo(direct[0], 6);
      expect(projected.north, `${row.id} north mismatch at case ${index}`).toBeCloseTo(direct[1], 6);

      const inverse = inverseENToGeodetic({
        east: projected.east,
        north: projected.north,
        originLatDeg: latDeg,
        originLonDeg: lonDeg,
        model: 'local-enu',
        coordSystemMode: 'grid',
        crsId: row.webnetCrsId,
      });
      expect('failureReason' in inverse, `${row.id} inverse failed`).toBe(false);
      if ('failureReason' in inverse) return;
      expect(inverse.latDeg, `${row.id} lat round-trip mismatch`).toBeCloseTo(latDeg, 7);
      expect(inverse.lonDeg, `${row.id} lon round-trip mismatch`).toBeCloseTo(lonDeg, 7);
    });
  });
});

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
