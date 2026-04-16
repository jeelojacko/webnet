import { LSAEngine } from './adjust';
import { CANADIAN_CRS_TEST_CATALOG, getCanadianCrsTestConfig } from './canadianCrsTestCatalog';
import {
  generateSyntheticCanadianNetwork,
  type SyntheticCanadianNetwork,
  type SyntheticCanadianNetworkPlacement,
  type SyntheticCanadianNetworkTemplate,
} from './generateSyntheticCanadianNetwork';
import {
  generateSyntheticObservations,
  renameSyntheticObservationJob,
  renderSyntheticObservationJob,
  type SyntheticObservationGenerationOptions,
  type SyntheticObservationInputRenderOptions,
  type SyntheticObservationNoiseMode,
} from './generateSyntheticObservations';

export interface SyntheticCrsAdjustmentMetrics {
  maxHorizontalErrorM: number;
  rmsHorizontalErrorM: number;
  maxVerticalErrorM: number;
  rmsVerticalErrorM: number;
  residualRms: number;
  seuw: number;
  leafHorizontalSigmaM?: number;
  mainAverageHorizontalSigmaM?: number;
}

export interface SyntheticCrsAdjustmentRunResult {
  crsId: string;
  seed: number;
  template: SyntheticCanadianNetworkTemplate;
  placement: SyntheticCanadianNetworkPlacement;
  input: string;
  metrics: SyntheticCrsAdjustmentMetrics;
  result: ReturnType<LSAEngine['solve']>;
}

export interface SyntheticCrsInputVariant extends SyntheticObservationInputRenderOptions {
  renamePrefix?: string;
}

export interface SyntheticCrsMonteCarloSummary {
  crsId: string;
  template: SyntheticCanadianNetworkTemplate;
  runCount: number;
  meanRmsHorizontalErrorM: number;
  maxHorizontalErrorM: number;
  meanRmsVerticalErrorM: number;
  maxVerticalErrorM: number;
  meanResidualRms: number;
  meanSeuw: number;
}

export interface SyntheticCrsSummaryRow {
  family: 'UTM' | 'MTM' | 'PROVINCIAL';
  crsId: string;
  name: string;
  template: SyntheticCanadianNetworkTemplate;
  placement: SyntheticCanadianNetworkPlacement;
  seed: number;
  success: boolean;
  maxHorizontalErrorM: number;
  rmsHorizontalErrorM: number;
  maxVerticalErrorM: number;
  rmsVerticalErrorM: number;
  residualRms: number;
  seuw: number;
}

export interface SyntheticCrsGroupedSummary {
  totalRuns: number;
  totalFailures: number;
  groups: Array<{
    family: SyntheticCrsSummaryRow['family'];
    rows: SyntheticCrsSummaryRow[];
  }>;
}

const horizontalSigma = (sigmaE?: number, sigmaN?: number): number | undefined => {
  if (!Number.isFinite(sigmaE ?? Number.NaN) || !Number.isFinite(sigmaN ?? Number.NaN)) {
    return undefined;
  }
  return Math.hypot(sigmaE as number, sigmaN as number);
};

const renameStationId = (id: string, prefix: string): string => `${prefix}_${id}`;

const buildStationRenameMapping = (
  network: SyntheticCanadianNetwork,
  prefix?: string,
): Record<string, string> =>
  !prefix
    ? {}
    : Object.fromEntries(network.stations.map((station) => [station.id, renameStationId(station.id, prefix)]));

const renameSyntheticNetworkForTruth = (
  network: SyntheticCanadianNetwork,
  mapping: Record<string, string>,
): SyntheticCanadianNetwork => ({
  ...network,
  stations: network.stations.map((station) => ({
    ...station,
    id: mapping[station.id] ?? station.id,
  })),
});

const FAMILY_ORDER: SyntheticCrsSummaryRow['family'][] = ['UTM', 'MTM', 'PROVINCIAL'];

export const runSyntheticCrsAdjustmentTest = ({
  crsId,
  seed,
  template = 'braced-quadrilateral',
  mode = 'noise-free',
  placement = 'interior',
  observationOptions,
  inputVariant,
}: {
  crsId: string;
  seed: number;
  template?: SyntheticCanadianNetworkTemplate;
  mode?: SyntheticObservationNoiseMode;
  placement?: SyntheticCanadianNetworkPlacement;
  observationOptions?: SyntheticObservationGenerationOptions;
  inputVariant?: SyntheticCrsInputVariant;
}): SyntheticCrsAdjustmentRunResult => {
  const config = getCanadianCrsTestConfig(crsId);
  if (!config) {
    throw new Error(`Unknown synthetic CRS run config: ${crsId}`);
  }
  const canonicalNetwork = generateSyntheticCanadianNetwork({ crsId, seed, template, placement });
  const renameMapping = buildStationRenameMapping(canonicalNetwork, inputVariant?.renamePrefix);
  const generatedJob = generateSyntheticObservations({
    network: canonicalNetwork,
    mode,
    ...observationOptions,
  });
  const job =
    Object.keys(renameMapping).length === 0
      ? generatedJob
      : renameSyntheticObservationJob(generatedJob, renameMapping);
  const network = renameSyntheticNetworkForTruth(canonicalNetwork, renameMapping);
  const input = renderSyntheticObservationJob(job, {
    observationOrder: inputVariant?.observationOrder,
    directionSetupOrder: inputVariant?.directionSetupOrder,
  });
  const engine = new LSAEngine({
    input,
    maxIterations: 15,
    parseOptions: {
      coordMode: network.coordMode,
      coordSystemMode: 'grid',
      crsId: config.webnetCrsId,
      gridDistanceMode: 'grid',
      gridBearingMode: 'grid',
    },
  });
  const result = engine.solve();
  const horizontalErrors = network.stations
    .filter((station) => station.role !== 'fixed')
    .map((station) => {
      const adjusted = result.stations[station.id];
      if (!adjusted) {
        throw new Error(`Adjusted station missing for ${config.id}: ${station.id}`);
      }
      return Math.hypot(adjusted.x - station.easting, adjusted.y - station.northing);
    });
  const verticalErrors =
    network.coordMode === '3D'
      ? network.stations
          .filter((station) => station.role !== 'fixed')
          .map((station) => {
            const adjusted = result.stations[station.id];
            if (!adjusted) {
              throw new Error(`Adjusted station missing for ${config.id}: ${station.id}`);
            }
            return Math.abs(adjusted.h - station.elevation);
          })
      : [];
  const maxHorizontalErrorM = horizontalErrors.length > 0 ? Math.max(...horizontalErrors) : 0;
  const rmsHorizontalErrorM =
    horizontalErrors.length > 0
      ? Math.sqrt(
          horizontalErrors.reduce((sum, value) => sum + value * value, 0) / horizontalErrors.length,
        )
      : 0;
  const maxVerticalErrorM = verticalErrors.length > 0 ? Math.max(...verticalErrors) : 0;
  const rmsVerticalErrorM =
    verticalErrors.length > 0
      ? Math.sqrt(verticalErrors.reduce((sum, value) => sum + value * value, 0) / verticalErrors.length)
      : 0;
  const residualValues = result.observations
    .map((obs) => (typeof obs.residual === 'number' ? obs.residual : undefined))
    .filter((value): value is number => Number.isFinite(value));
  const residualRms =
    residualValues.length > 0
      ? Math.sqrt(residualValues.reduce((sum, value) => sum + value * value, 0) / residualValues.length)
      : 0;
  const covarianceById = new Map((result.stationCovariances ?? []).map((row) => [row.stationId, row]));
  const leafStation = network.stations.find((station) => station.role === 'leaf');
  const leafSigma =
    leafStation == null
      ? undefined
      : horizontalSigma(
          covarianceById.get(leafStation.id)?.sigmaE ?? result.stations[leafStation.id]?.sE,
          covarianceById.get(leafStation.id)?.sigmaN ?? result.stations[leafStation.id]?.sN,
        );
  const mainRows = network.stations
    .filter((station) => station.role === 'main')
    .map((station) =>
      horizontalSigma(
        covarianceById.get(station.id)?.sigmaE ?? result.stations[station.id]?.sE,
        covarianceById.get(station.id)?.sigmaN ?? result.stations[station.id]?.sN,
      ),
    )
    .filter((value): value is number => value != null);
  const mainAverageHorizontalSigmaM =
    mainRows.length > 0 ? mainRows.reduce((sum, value) => sum + value, 0) / mainRows.length : undefined;
  return {
    crsId,
    seed,
    template,
    placement,
    input,
    metrics: {
      maxHorizontalErrorM,
      rmsHorizontalErrorM,
      maxVerticalErrorM,
      rmsVerticalErrorM,
      residualRms,
      seuw: result.seuw,
      leafHorizontalSigmaM: leafSigma,
      mainAverageHorizontalSigmaM,
    },
    result,
  };
};

export const runRepresentativeCanadianSyntheticCrsBatch = (
  mode: SyntheticObservationNoiseMode = 'noise-free',
): SyntheticCrsAdjustmentRunResult[] =>
  CANADIAN_CRS_TEST_CATALOG.map((row, index) =>
    runSyntheticCrsAdjustmentTest({
      crsId: row.webnetCrsId,
      seed: 1000 + index,
      template:
        row.id.startsWith('CA_NAD83_CSRS_AB_3TM_')
          ? 'mixed-3d'
          : row.family === 'UTM'
            ? index % 2 === 0
              ? 'short-traverse'
              : 'braced-quadrilateral'
            : row.family === 'MTM'
              ? 'loop'
              : row.id === 'CA_NAD83_CSRS_NB_STEREO_DOUBLE'
                ? 'mixed-3d'
                : 'braced-quadrilateral',
      mode,
    }),
  );

export const runSyntheticCrsEdgeJobs = ({
  crsId,
  seed,
  template = 'braced-quadrilateral',
  mode = 'noise-free',
  observationOptions,
}: {
  crsId: string;
  seed: number;
  template?: SyntheticCanadianNetworkTemplate;
  mode?: SyntheticObservationNoiseMode;
  observationOptions?: SyntheticObservationGenerationOptions;
}): SyntheticCrsAdjustmentRunResult[] =>
  (['west-edge', 'east-edge', 'north-edge', 'south-edge'] as SyntheticCanadianNetworkPlacement[]).map(
    (placement, index) =>
      runSyntheticCrsAdjustmentTest({
        crsId,
        seed: seed + index,
        template,
        mode,
        placement,
        observationOptions,
      }),
  );

export const runSyntheticCrsMonteCarlo = ({
  crsId,
  template,
  seeds,
}: {
  crsId: string;
  template: SyntheticCanadianNetworkTemplate;
  seeds: number[];
}): SyntheticCrsMonteCarloSummary => {
  const runs = seeds.map((seed) =>
    runSyntheticCrsAdjustmentTest({
      crsId,
      seed,
      template,
      mode: 'noisy',
    }),
  );
  return {
    crsId,
    template,
    runCount: runs.length,
    meanRmsHorizontalErrorM:
      runs.reduce((sum, run) => sum + run.metrics.rmsHorizontalErrorM, 0) / runs.length,
    maxHorizontalErrorM: Math.max(...runs.map((run) => run.metrics.maxHorizontalErrorM)),
    meanRmsVerticalErrorM:
      runs.reduce((sum, run) => sum + run.metrics.rmsVerticalErrorM, 0) / runs.length,
    maxVerticalErrorM: Math.max(...runs.map((run) => run.metrics.maxVerticalErrorM)),
    meanResidualRms: runs.reduce((sum, run) => sum + run.metrics.residualRms, 0) / runs.length,
    meanSeuw: runs.reduce((sum, run) => sum + run.metrics.seuw, 0) / runs.length,
  };
};

export const buildSyntheticCrsSummaryRows = (
  runs: SyntheticCrsAdjustmentRunResult[],
): SyntheticCrsSummaryRow[] =>
  runs
    .map((run) => {
      const config = getCanadianCrsTestConfig(run.crsId);
      if (!config) {
        throw new Error(`Synthetic summary is missing CRS config for ${run.crsId}`);
      }
      return {
        family: config.family,
        crsId: run.crsId,
        name: config.name,
        template: run.template,
        placement: run.placement,
        seed: run.seed,
        success: run.result.success,
        maxHorizontalErrorM: run.metrics.maxHorizontalErrorM,
        rmsHorizontalErrorM: run.metrics.rmsHorizontalErrorM,
        maxVerticalErrorM: run.metrics.maxVerticalErrorM,
        rmsVerticalErrorM: run.metrics.rmsVerticalErrorM,
        residualRms: run.metrics.residualRms,
        seuw: run.metrics.seuw,
      };
    })
    .sort((left, right) => {
      const familyDelta = FAMILY_ORDER.indexOf(left.family) - FAMILY_ORDER.indexOf(right.family);
      if (familyDelta !== 0) return familyDelta;
      const crsDelta = left.crsId.localeCompare(right.crsId);
      if (crsDelta !== 0) return crsDelta;
      if (left.template !== right.template) return left.template.localeCompare(right.template);
      if (left.placement !== right.placement) return left.placement.localeCompare(right.placement);
      return left.seed - right.seed;
    });

export const buildSyntheticCrsGroupedSummary = (
  runs: SyntheticCrsAdjustmentRunResult[],
): SyntheticCrsGroupedSummary => {
  const rows = buildSyntheticCrsSummaryRows(runs);
  return {
    totalRuns: rows.length,
    totalFailures: rows.filter((row) => !row.success).length,
    groups: FAMILY_ORDER.map((family) => ({
      family,
      rows: rows.filter((row) => row.family === family),
    })).filter((group) => group.rows.length > 0),
  };
};

export const formatSyntheticCrsMarkdownSummary = (
  runs: SyntheticCrsAdjustmentRunResult[],
): string => {
  const summary = buildSyntheticCrsGroupedSummary(runs);
  const lines = [
    '# Canadian Synthetic CRS Summary',
    '',
    `Runs: ${summary.totalRuns}`,
    `Failures: ${summary.totalFailures}`,
    '',
  ];
  summary.groups.forEach((group) => {
    lines.push(`## ${group.family}`);
    lines.push('');
    lines.push('| CRS | Template | Placement | Seed | Pass | Max H (m) | Max V (m) | Residual RMS | SEUW |');
    lines.push('| --- | --- | --- | ---: | :--: | ---: | ---: | ---: | ---: |');
    group.rows.forEach((row) => {
      lines.push(
        `| ${row.crsId} | ${row.template} | ${row.placement} | ${row.seed} | ${row.success ? 'PASS' : 'FAIL'} | ${row.maxHorizontalErrorM.toFixed(4)} | ${row.maxVerticalErrorM.toFixed(4)} | ${row.residualRms.toFixed(4)} | ${row.seuw.toFixed(3)} |`,
      );
    });
    lines.push('');
  });
  return lines.join('\n').trimEnd();
};
