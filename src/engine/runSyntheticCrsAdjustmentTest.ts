import { LSAEngine } from './adjust';
import { CANADIAN_CRS_TEST_CATALOG, getCanadianCrsTestConfig } from './canadianCrsTestCatalog';
import {
  generateSyntheticCanadianNetwork,
  type SyntheticCanadianNetworkTemplate,
} from './generateSyntheticCanadianNetwork';
import {
  generateSyntheticObservations,
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
  input: string;
  metrics: SyntheticCrsAdjustmentMetrics;
  result: ReturnType<LSAEngine['solve']>;
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

const horizontalSigma = (sigmaE?: number, sigmaN?: number): number | undefined => {
  if (!Number.isFinite(sigmaE ?? Number.NaN) || !Number.isFinite(sigmaN ?? Number.NaN)) {
    return undefined;
  }
  return Math.hypot(sigmaE as number, sigmaN as number);
};

export const runSyntheticCrsAdjustmentTest = ({
  crsId,
  seed,
  template = 'braced-quadrilateral',
  mode = 'noise-free',
}: {
  crsId: string;
  seed: number;
  template?: SyntheticCanadianNetworkTemplate;
  mode?: SyntheticObservationNoiseMode;
}): SyntheticCrsAdjustmentRunResult => {
  const config = getCanadianCrsTestConfig(crsId);
  if (!config) {
    throw new Error(`Unknown synthetic CRS run config: ${crsId}`);
  }
  const network = generateSyntheticCanadianNetwork({ crsId, seed, template });
  const job = generateSyntheticObservations({ network, mode });
  const engine = new LSAEngine({
    input: job.input,
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
  const leafSigma = horizontalSigma(
    covarianceById.get('L')?.sigmaE ?? result.stations.L?.sE,
    covarianceById.get('L')?.sigmaN ?? result.stations.L?.sN,
  );
  const mainRows = ['C', 'D']
    .map((id) =>
      horizontalSigma(
        covarianceById.get(id)?.sigmaE ?? result.stations[id]?.sE,
        covarianceById.get(id)?.sigmaN ?? result.stations[id]?.sN,
      ),
    )
    .filter((value): value is number => value != null);
  const mainAverageHorizontalSigmaM =
    mainRows.length > 0 ? mainRows.reduce((sum, value) => sum + value, 0) / mainRows.length : undefined;
  return {
    crsId,
    seed,
    template,
    input: job.input,
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
