import { DATA_CHECK_PROVISIONAL_DIRECTION_TRUST_MAX_RAD } from './adjustConstants';
import type { GpsCovariance, GpsSolveVector } from './adjustTypes';
import type {
  AdjustmentResult,
  DistanceObservation,
  GpsObservation,
  Observation,
  ObservationOverride,
  ParseOptions,
  StationId,
  StationMap,
  InstrumentLibrary,
} from '../types';

type DataCheckProvisionalApproximation = {
  attempted: boolean;
  updatedStationCount: number;
  iterations: number;
  converged: boolean;
  directionCalcByObsId: Map<number, number>;
};

type CorrectedDistanceModelResult = {
  calcDistance: number;
  mapScale: number;
  prismCorrection: number;
  horizontalDerivativeFactor?: number;
  verticalDerivativeFactor?: number;
  useReducedSlopeDerivatives?: boolean;
};

type LineGeometry = { horiz: number; slope: number; elev: number };
type AzimuthDistance = { az: number; dist: number };
type ModeledZenith = { z: number; dist: number; horiz: number; dh: number; crCorr: number; horizontalScale: number };

type DataCheckContext = {
  input: string;
  stations: StationMap;
  observations: Observation[];
  unknowns: StationId[];
  maxIterations: number;
  convergenceThreshold: number;
  instrumentLibrary: InstrumentLibrary;
  excludeIds?: Set<number>;
  overrides?: Record<number, ObservationOverride>;
  parseOptions?: Partial<ParseOptions>;
  geoidSourceData?: Uint8Array;
  is2D: boolean;
  coordSystemMode: ParseOptions['coordSystemMode'];
  runMode: ParseOptions['runMode'];
  iterations: number;
  dof: number;
  seuw: number;
  converged: boolean;
  log: (_message: string) => void;
  buildResult: () => AdjustmentResult;
  centeringLineGeometry: (_fromId: StationId, _toId: StationId, _hi?: number, _ht?: number) => LineGeometry;
  correctedDistanceModel: (_obs: Observation & { type: 'dist' }, _calcDistRaw: number) => CorrectedDistanceModelResult;
  getObservedHorizontalDistanceIn2D: (_obs: DistanceObservation) => { observedDistance: number; sigmaDistance: number; usedZenith: boolean };
  getAzimuth: (_fromId: StationId, _toId: StationId) => AzimuthDistance;
  getModeledZenith: (_obs: Observation & { type: 'zenith' }) => ModeledZenith;
  gpsObservedVector: (_obs: GpsObservation) => GpsSolveVector;
  gpsModeledVector: (_obs: GpsObservation) => GpsSolveVector;
  gpsCovariance: (_obs: Observation) => GpsCovariance;
  modeledAzimuth: (_rawAz: number, _atStationId?: StationId, _applyConvergence?: boolean) => number;
  stationGeodetic: (_stationId: StationId) => { latDeg: number; lonDeg: number } | null;
  stationFactorSnapshot: (_stationId: StationId) => unknown;
  wrapToPi: (_value: number) => number;
  solveProvisional: (_maxIterations: number, _parseOptions: ParseOptions) => AdjustmentResult;
};

export const applyDataCheckProvisionalApproximation = (
  ctx: DataCheckContext,
): DataCheckProvisionalApproximation => {
    if (ctx.unknowns.length === 0) {
      return {
        attempted: false,
        updatedStationCount: 0,
        iterations: 0,
        converged: false,
        directionCalcByObsId: new Map<number, number>(),
      };
    }

    const provisionalIterations = Math.max(2, Math.min(ctx.maxIterations, 4));
    ctx.log(
      `Data Check provisional approximation: running bounded coordinate fit (maxIterations=${provisionalIterations}) to refine approximate geometry before inverse comparisons.`,
    );

    const provisionalParseOptions = {
      ...(ctx.parseOptions ?? {}),
      runMode: 'adjustment',
      preanalysisMode: false,
      robustMode: 'none',
      autoAdjustEnabled: false,
      autoSideshotEnabled: false,
      clusterDetectionEnabled: false,
    } as ParseOptions;

    const provisionalResult = ctx.solveProvisional(provisionalIterations, provisionalParseOptions);
    const directionCalcByObsId = new Map<number, number>();
    provisionalResult.observations.forEach((obs) => {
      if (
        obs.type !== 'direction' ||
        !Number.isFinite(obs.calc ?? Number.NaN) ||
        !Number.isFinite(obs.residual ?? Number.NaN) ||
        Math.abs(obs.residual ?? 0) > DATA_CHECK_PROVISIONAL_DIRECTION_TRUST_MAX_RAD
      ) {
        return;
      }
      directionCalcByObsId.set(obs.id, obs.calc as number);
    });

    let updatedStationCount = 0;
    Object.entries(ctx.stations).forEach(([stationId, station]) => {
      const provisionalStation = provisionalResult.stations[stationId];
      if (!provisionalStation) return;
      const nextX = provisionalStation.x;
      const nextY = provisionalStation.y;
      const nextH = provisionalStation.h;
      if (
        !Number.isFinite(nextX) ||
        !Number.isFinite(nextY) ||
        (!ctx.is2D && !Number.isFinite(nextH))
      ) {
        return;
      }
      const changed =
        Math.abs(station.x - nextX) > 1e-9 ||
        Math.abs(station.y - nextY) > 1e-9 ||
        Math.abs((station.h ?? 0) - (nextH ?? 0)) > 1e-9 ||
        station.bootstrapApprox === true;
      if (!changed) return;
      station.x = nextX;
      station.y = nextY;
      station.h = nextH;
      station.bootstrapApprox = false;
      if (ctx.coordSystemMode === 'grid') {
        ctx.stationGeodetic(stationId as StationId);
        ctx.stationFactorSnapshot(stationId as StationId);
      }
      updatedStationCount += 1;
    });

    ctx.log(
      `Data Check provisional approximation: updated ${updatedStationCount} station(s); provisionalIterations=${provisionalResult.iterations}, converged=${provisionalResult.converged ? 'YES' : 'NO'}.`,
    );

    return {
      attempted: true,
      updatedStationCount,
      iterations: provisionalResult.iterations,
      converged: provisionalResult.converged,
      directionCalcByObsId,
    };
};

export const runDataCheckOnly = (ctx: DataCheckContext, activeObservations: Observation[]): AdjustmentResult => {
    ctx.runMode = 'data-check';
    ctx.iterations = 0;
    ctx.dof = 0;
    ctx.seuw = 0;
    ctx.converged = true;
    ctx.log(
      'Data Check Only mode: reporting approximate-geometry differences from observations (no least-squares adjustment).',
    );

    const provisionalApproximation = applyDataCheckProvisionalApproximation(ctx);

    const dataCheckDirectionOrientations = new Map<string, number>();
    const directionOrientationSums = new Map<string, { sumSin: number; sumCos: number }>();
    activeObservations.forEach((obs) => {
      if (obs.type !== 'direction' || typeof obs.setId !== 'string' || obs.setId.trim() === '') return;
      if (!ctx.stations[obs.at] || !ctx.stations[obs.to]) return;
      const az = ctx.modeledAzimuth(
        ctx.getAzimuth(obs.at, obs.to).az,
        obs.at,
        obs.gridObsMode !== 'grid',
      );
      const diff = ctx.wrapToPi(obs.obs - az);
      const entry = directionOrientationSums.get(obs.setId) ?? { sumSin: 0, sumCos: 0 };
      entry.sumSin += Math.sin(diff);
      entry.sumCos += Math.cos(diff);
      directionOrientationSums.set(obs.setId, entry);
    });
    directionOrientationSums.forEach((entry, setId) => {
      dataCheckDirectionOrientations.set(setId, Math.atan2(entry.sumSin, entry.sumCos));
    });

    const ranked: Array<{ obsId: number; type: Observation['type']; diff: number }> = [];
    activeObservations.forEach((obs) => {
      if (obs.type === 'dist') {
        const s1 = ctx.stations[obs.from];
        const s2 = ctx.stations[obs.to];
        if (!s1 || !s2) return;
        const geom = ctx.centeringLineGeometry(obs.from, obs.to, obs.hi ?? 0, obs.ht ?? 0);
        const rawCalc = ctx.is2D ? geom.horiz : obs.mode === 'slope' ? geom.slope : geom.horiz;
        const corrected = ctx.correctedDistanceModel(obs, rawCalc);
        const observed = ctx.getObservedHorizontalDistanceIn2D(obs);
        const residual = observed.observedDistance - corrected.calcDistance;
        obs.calc = corrected.calcDistance;
        obs.residual = residual;
        obs.stdRes = observed.sigmaDistance > 0 ? residual / observed.sigmaDistance : 0;
        ranked.push({ obsId: obs.id, type: obs.type, diff: Math.abs(residual) });
        return;
      }
      if (obs.type === 'angle') {
        const azFrom = ctx.getAzimuth(obs.at, obs.from);
        const azTo = ctx.getAzimuth(obs.at, obs.to);
        let calc = azTo.az - azFrom.az;
        if (calc < 0) calc += 2 * Math.PI;
        const residual = ((obs.obs - calc + Math.PI) % (2 * Math.PI)) - Math.PI;
        obs.calc = calc;
        obs.residual = residual;
        obs.stdRes = obs.stdDev > 0 ? residual / obs.stdDev : 0;
        ranked.push({ obsId: obs.id, type: obs.type, diff: Math.abs(residual) });
        return;
      }
      if (obs.type === 'bearing' || obs.type === 'dir') {
        const from = obs.type === 'bearing' ? obs.from : obs.from;
        const to = obs.type === 'bearing' ? obs.to : obs.to;
        const calc = ctx.getAzimuth(from, to).az;
        const residual = ((obs.obs - calc + Math.PI) % (2 * Math.PI)) - Math.PI;
        obs.calc = calc;
        obs.residual = residual;
        obs.stdRes = obs.stdDev > 0 ? residual / obs.stdDev : 0;
        ranked.push({ obsId: obs.id, type: obs.type, diff: Math.abs(residual) });
        return;
      }
      if (obs.type === 'direction') {
        const provisionalCalc = provisionalApproximation.directionCalcByObsId.get(obs.id);
        if (Number.isFinite(provisionalCalc ?? Number.NaN)) {
          const calc = provisionalCalc as number;
          const residual = ctx.wrapToPi(obs.obs - calc);
          obs.calc = calc;
          obs.residual = residual;
          obs.stdRes = obs.stdDev > 0 ? residual / obs.stdDev : 0;
          ranked.push({ obsId: obs.id, type: obs.type, diff: Math.abs(residual) });
          return;
        }
        const occupyStation = ctx.stations[obs.at];
        const targetStation = ctx.stations[obs.to];
        const weakApprox =
          occupyStation?.bootstrapApprox === true || targetStation?.bootstrapApprox === true;
        const internalResidualCandidates = [
          obs.rawMaxResidual,
          obs.rawSpread,
          obs.facePairDelta,
        ].filter((value): value is number => Number.isFinite(value));
        if (
          internalResidualCandidates.length > 0 &&
          (weakApprox || provisionalApproximation.attempted)
        ) {
          const residual = internalResidualCandidates.reduce(
            (max, value) => (Math.abs(value) > Math.abs(max) ? value : max),
            0,
          );
          obs.calc = obs.obs;
          obs.residual = residual;
          obs.stdRes = undefined;
          ranked.push({ obsId: obs.id, type: obs.type, diff: Math.abs(residual) });
          return;
        }
        const az = ctx.modeledAzimuth(
          ctx.getAzimuth(obs.at, obs.to).az,
          obs.at,
          obs.gridObsMode !== 'grid',
        );
        const orientation =
          typeof obs.setId === 'string' && obs.setId.trim() !== ''
            ? (dataCheckDirectionOrientations.get(obs.setId) ?? 0)
            : 0;
        let calc = az + orientation;
        calc %= 2 * Math.PI;
        if (calc < 0) calc += 2 * Math.PI;
        const residual = ctx.wrapToPi(obs.obs - calc);
        obs.calc = calc;
        obs.residual = residual;
        obs.stdRes = obs.stdDev > 0 ? residual / obs.stdDev : 0;
        ranked.push({ obsId: obs.id, type: obs.type, diff: Math.abs(residual) });
        return;
      }
      if (obs.type === 'lev') {
        const s1 = ctx.stations[obs.from];
        const s2 = ctx.stations[obs.to];
        if (!s1 || !s2) return;
        const calc = s2.h - s1.h;
        const residual = obs.obs - calc;
        obs.calc = calc;
        obs.residual = residual;
        obs.stdRes = obs.stdDev > 0 ? residual / obs.stdDev : 0;
        ranked.push({ obsId: obs.id, type: obs.type, diff: Math.abs(residual) });
        return;
      }
      if (obs.type === 'zenith') {
        const geom = ctx.getModeledZenith(obs);
        const calc = geom.z;
        const residual = ((obs.obs - calc + Math.PI) % (2 * Math.PI)) - Math.PI;
        obs.calc = calc;
        obs.residual = residual;
        obs.stdRes = obs.stdDev > 0 ? residual / obs.stdDev : 0;
        ranked.push({ obsId: obs.id, type: obs.type, diff: Math.abs(residual) });
        return;
      }
      if (obs.type === 'gps') {
        const corrected = ctx.gpsObservedVector(obs);
        const calc = ctx.gpsModeledVector(obs);
        const residual = {
          vE: corrected.dE - calc.dE,
          vN: corrected.dN - calc.dN,
          vU:
            !ctx.is2D &&
            Number.isFinite(corrected.dU ?? Number.NaN) &&
            Number.isFinite(calc.dU ?? Number.NaN)
              ? (corrected.dU as number) - (calc.dU as number)
              : undefined,
        };
        obs.calc = calc;
        obs.residual = residual;
        const cov = ctx.gpsCovariance(obs);
        const sigmaE = Math.sqrt(Math.max(cov.cEE, 1e-12));
        const sigmaN = Math.sqrt(Math.max(cov.cNN, 1e-12));
        const sigmaU = Math.sqrt(Math.max(cov.cUU ?? 1e-12, 1e-12));
        obs.stdRes = Math.sqrt(
          (residual.vE / sigmaE) ** 2 +
            (residual.vN / sigmaN) ** 2 +
            ((residual.vU ?? 0) / sigmaU) ** 2,
        );
        ranked.push({
          obsId: obs.id,
          type: obs.type,
          diff: Math.sqrt(
            residual.vE * residual.vE +
              residual.vN * residual.vN +
              (residual.vU ?? 0) * (residual.vU ?? 0),
          ),
        });
      }
    });

    ranked
      .sort((a, b) => b.diff - a.diff)
      .slice(0, 25)
      .forEach((row, idx) => {
        ctx.log(
          `  Difference #${idx + 1}: obs ${row.obsId} [${row.type}] |diff|=${row.diff.toExponential(6)}`,
        );
      });
    ctx.log('Data Check Only complete.');
    return ctx.buildResult();
};

