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
      coordMode: '2D',
      coordSystemMode: 'grid',
      crsId: config.webnetCrsId,
      gridDistanceMode: 'grid',
      gridBearingMode: 'grid',
    },
  });
  const result = engine.solve();
  const errors = network.stations
    .filter((station) => station.role !== 'fixed')
    .map((station) => {
      const adjusted = result.stations[station.id];
      if (!adjusted) {
        throw new Error(`Adjusted station missing for ${config.id}: ${station.id}`);
      }
      return Math.hypot(adjusted.x - station.easting, adjusted.y - station.northing);
    });
  const maxHorizontalErrorM = errors.length > 0 ? Math.max(...errors) : 0;
  const rmsHorizontalErrorM =
    errors.length > 0
      ? Math.sqrt(errors.reduce((sum, value) => sum + value * value, 0) / errors.length)
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
      mode,
    }),
  );
