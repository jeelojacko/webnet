import { transformSymmetricCovariance3 } from './adjustGpsMath';
import { tryQueryStandardizedResidualRowProducts } from './adjustStatisticsRowProducts';
import { accumulateNormalEquationsFromSparseRows, multiplySparseRowsByDenseMatrix, zeros } from './matrix';
import { assembleAdjustmentEquations } from './adjustmentEquationAssembly';
import { getObservationSetId } from './observationMetadata';
import type { AdjustmentStatisticsContext } from './adjustStatisticsTypes';
import type { GpsObservation, Observation, StationId } from '../types';

type StationParamIndex = Record<StationId, { x?: number; y?: number; h?: number }>;
type CoordinateConstraint = Parameters<typeof assembleAdjustmentEquations>[2][number];

export const computeStandardizedResidualStatistics = (
  ctx: AdjustmentStatisticsContext,
  paramIndex: StationParamIndex,
  hasQxx: boolean,
  activeObservations: Observation[],
  constraints: CoordinateConstraint[],
): void => {
  if (hasQxx) {
    const stationParamCount =
      Object.values(paramIndex).reduce((max, idx) => {
        const vals = [idx.x ?? -1, idx.y ?? -1, idx.h ?? -1];
        return Math.max(max, ...vals);
      }, -1) + 1;
    const directionSetIds = Array.from(
      new Set(
        activeObservations
          .filter((o) => o.type === 'direction')
          .map((o) => getObservationSetId(o))
          .filter((setId): setId is string => typeof setId === 'string'),
      ),
    );
    const dirParamMap: Record<string, number> = {};
    directionSetIds.forEach((id, idx) => {
      dirParamMap[id] = stationParamCount + idx;
    });
    const numParams = stationParamCount + directionSetIds.length;
    const numObsEquations =
      activeObservations.reduce(
        (acc, o) =>
          acc +
          (o.type === 'gps' && !ctx.is2D && Number.isFinite(o.obs.dU ?? Number.NaN)
            ? 3
            : o.type === 'gps'
              ? 2
              : 1),
        0,
      ) +
      constraints.length;

    if (numParams > 0 && numObsEquations > 0) {
      const sparseStatsSupported =
        ctx.sparseRowProductsSolver != null &&
        ctx.applyTsCorrelationToWeightWriter != null;
      const assembleStatsEquations = (sparse: boolean) => assembleAdjustmentEquations(
        {
          stations: ctx.stations,
          paramIndex: ctx.paramIndex,
          is2D: ctx.is2D,
          debug: false,
          directionOrientations: ctx.directionOrientations,
          dirParamMap,
          effectiveStdDev: ctx.effectiveStdDev.bind(this),
          correctedDistanceModel: ctx.correctedDistanceModel.bind(this),
          getObservedHorizontalDistanceIn2D: ctx.getObservedHorizontalDistanceIn2D.bind(this),
          getAzimuth: ctx.getAzimuth.bind(this),
          measuredAngleCorrection: ctx.measuredAngleCorrection.bind(this),
          modeledAzimuth: ctx.modeledAzimuth.bind(this),
          wrapToPi: ctx.wrapToPi.bind(this),
          gpsObservedVector: ctx.gpsObservedVector.bind(this),
          gpsModeledVector: ctx.gpsModeledVector.bind(this),
          gpsModeledVectorDerivatives: ctx.gpsModeledVectorDerivatives.bind(this),
          gpsWeight: ctx.gpsWeight.bind(this),
          getModeledZenith: ctx.getModeledZenith.bind(this),
          curvatureRefractionAngle: ctx.curvatureRefractionAngle.bind(this),
          applyTsCorrelationToWeightMatrix: (weightMatrix, weightRowInfo) =>
            ctx.applyTsCorrelationToWeightMatrix(weightMatrix, weightRowInfo, true),
          applyTsCorrelationToWeightWriter: sparse
            ? (weights, weightRowInfo) =>
              ctx.applyTsCorrelationToWeightWriter?.(weights, weightRowInfo, true)
            : undefined,
        },
        activeObservations,
        constraints,
        numObsEquations,
        numParams,
        undefined,
        sparse
          ? { includeDenseA: false, weightRepresentation: 'sparse', omitDenseP: true }
          : { includeDenseA: false },
      );
      let assembled = assembleStatsEquations(sparseStatsSupported);
      let useSparseRowProductWeights = sparseStatsSupported;

      const applyStatsHuberWeights = (): void => {
        if (ctx.preanalysisMode || ctx.robustMode !== 'huber') return;
        // Explicit length: omitDenseP yields undefined, never a truthy empty matrix.
        if (assembled.P?.length) {
          const baseWeights = ctx.captureRobustWeightBase(assembled.P, assembled.rowInfo);
          const residuals = assembled.L.map((row) => -row[0]);
          const summary = ctx.computeRobustWeightSummary(residuals, assembled.rowInfo);
          ctx.applyRobustWeightFactors(assembled.P, baseWeights, summary.factors);
        } else if (
          assembled.structuredWeights != null &&
          ctx.captureRobustWeightBaseFromStructured != null &&
          ctx.applyRobustWeightFactorsToStructured != null
        ) {
          const baseWeights = ctx.captureRobustWeightBaseFromStructured(
            assembled.structuredWeights,
            assembled.rowInfo,
          );
          const residuals = assembled.L.map((row) => -row[0]);
          const summary = ctx.computeRobustWeightSummary(residuals, assembled.rowInfo);
          ctx.applyRobustWeightFactorsToStructured(
            assembled.structuredWeights,
            baseWeights,
            summary.factors,
          );
        } else {
          ctx.log(
            'Warning: sparse Huber statistics lack structured robust support; using dense weights.',
          );
          assembled = assembleStatsEquations(false);
          useSparseRowProductWeights = false;
          applyStatsHuberWeights();
        }
      };
      applyStatsHuberWeights();

      if (!ctx.preanalysisMode) {
        try {
          let rowProducts = tryQueryStandardizedResidualRowProducts(ctx, {
            sparseRows: assembled.sparseRows,
            weights: assembled.P,
            structuredWeights: useSparseRowProductWeights
              ? assembled.structuredWeights
              : undefined,
            rowInfo: assembled.rowInfo,
            activeObservations,
            observationEquationCount: numObsEquations,
            parameterCount: numParams,
          });
          if (!rowProducts && useSparseRowProductWeights) {
            assembled = assembleStatsEquations(false);
            useSparseRowProductWeights = false;
            applyStatsHuberWeights();
            rowProducts = tryQueryStandardizedResidualRowProducts(ctx, {
              sparseRows: assembled.sparseRows,
              weights: assembled.P,
              rowInfo: assembled.rowInfo,
              activeObservations,
              observationEquationCount: numObsEquations,
              parameterCount: numParams,
            });
          }
          const { L, rowInfo, sparseRows } = assembled;
          let B: number[][] = [];
          if (!rowProducts) {
            const denseP = assembled.P;
            if (!denseP?.length) {
              throw new Error(
                'Dense fallback statistics require dense weights; disable the experimental sparse row-product path.',
              );
            }
            const { normal: N } = accumulateNormalEquationsFromSparseRows(
              sparseRows,
              zeros(numObsEquations, 1),
              denseP,
              numParams,
            );
            const QxxStats = ctx.invertNormalMatrixForStats(N);
            B = multiplySparseRowsByDenseMatrix(sparseRows, QxxStats);
          }
          const rowStats = new Map<
            number,
            {
              t: number[];
              r: number[];
              mdb: number[];
              pass: boolean[];
              comps: ('E' | 'N' | 'U' | undefined)[];
              rows: number[];
            }
          >();
          const s0 = ctx.seuw || 1;
          for (let i = 0; i < numObsEquations; i += 1) {
            const info = rowInfo[i];
            if (!info) continue;
            const sigma = ctx.effectiveStdDev(info.obs);
            let qll = sigma > 0 ? sigma * sigma : 0;
            if (info.obs.type === 'gps') {
              const cov = ctx.gpsCovariance(info.obs);
              qll =
                info.component === 'N'
                  ? cov.cNN
                  : info.component === 'U'
                    ? (cov.cUU ?? cov.cNN)
                    : cov.cEE;
            }
            let diag = 0;
            if (rowProducts) {
              diag = rowProducts.quadratic[i] ?? 0;
            } else {
              const sparseRow = sparseRows[i] ?? [];
              for (let j = 0; j < sparseRow.length; j += 1) {
                const entry = sparseRow[j];
                diag += B[i][entry.index] * entry.value;
              }
            }
            const qvv = Math.max(qll - diag, 1e-20);
            const t = L[i][0] / (s0 * Math.sqrt(qvv));
            const r = qll > 0 ? qvv / qll : 0;
            const pass = Math.abs(t) <= ctx.localTestCritical;
            const sigmaQll = Math.sqrt(Math.max(qll, 0));
            const mdb =
              r > 1e-12
                ? (ctx.localTestCritical * s0 * sigmaQll) / Math.sqrt(r)
                : Number.POSITIVE_INFINITY;
            const entry = rowStats.get(info.obs.id) ?? {
              t: [],
              r: [],
              mdb: [],
              pass: [],
              comps: [],
              rows: [],
            };
            entry.t.push(t);
            entry.r.push(r);
            entry.mdb.push(mdb);
            entry.pass.push(pass);
            entry.comps.push(info.component);
            entry.rows.push(i);
            rowStats.set(info.obs.id, entry);
          }

          activeObservations.forEach((obs) => {
            const entry = rowStats.get(obs.id);
            if (!entry) return;
            if (obs.type === 'gps') {
              const gpsObs = obs as GpsObservation;
              const componentOrder = entry.comps.filter(
                (component): component is 'E' | 'N' | 'U' => component != null,
              );
              const componentIndex = new Map(componentOrder.map((component, index) => [component, index]));
              const cov = ctx.gpsCovariance(gpsObs);
              const solveQll = componentOrder.map((rowComponent) =>
                componentOrder.map((colComponent) => {
                  if (rowComponent === 'E' && colComponent === 'E') return cov.cEE;
                  if (rowComponent === 'N' && colComponent === 'N') return cov.cNN;
                  if (rowComponent === 'U' && colComponent === 'U') return cov.cUU ?? cov.cNN;
                  if (
                    (rowComponent === 'E' && colComponent === 'N') ||
                    (rowComponent === 'N' && colComponent === 'E')
                  ) {
                    return cov.cEN;
                  }
                  if (
                    (rowComponent === 'E' && colComponent === 'U') ||
                    (rowComponent === 'U' && colComponent === 'E')
                  ) {
                    return cov.cEU ?? 0;
                  }
                  return cov.cNU ?? 0;
                }),
              );
              const solveQvv = solveQll.map((solveRow, rowIndex) =>
                solveRow.map((qllValue, colIndex) => {
                  let aqxxat = 0;
                  if (rowProducts) {
                    const cross = rowProducts.crossFor(
                      entry.rows[rowIndex] ?? -1,
                      entry.rows[colIndex] ?? -1,
                    );
                    if (cross == null) {
                      throw new Error('Sparse row products are missing a GPS cross pair.');
                    }
                    aqxxat = cross;
                  } else {
                    const sparseColRow = sparseRows[entry.rows[colIndex]] ?? [];
                    for (let paramEntryIndex = 0; paramEntryIndex < sparseColRow.length; paramEntryIndex += 1) {
                      const paramEntry = sparseColRow[paramEntryIndex];
                      aqxxat +=
                        B[entry.rows[rowIndex]][paramEntry.index] * paramEntry.value;
                    }
                  }
                  return Math.max(qllValue - aqxxat, 0);
                }),
              );
              const solveResidualVector = componentOrder.map((component) =>
                component === 'N'
                  ? (gpsObs.residual?.vN ?? 0)
                  : component === 'U'
                    ? (gpsObs.residual?.vU ?? 0)
                    : (gpsObs.residual?.vE ?? 0),
              );
              const displayTransform = ctx.gpsDisplayResidualTransform(
                gpsObs,
                ctx.stations[gpsObs.from],
              );
              const toDisplayVector = (values: number[]) => {
                if (!displayTransform || values.length !== 3) return values;
                return displayTransform.map(
                  (transformRow) =>
                    transformRow[0] * values[0] + transformRow[1] * values[1] + transformRow[2] * values[2],
                );
              };
              const toDisplayCovariance = (covariance: number[][]) => {
                if (!displayTransform || covariance.length !== 3) return covariance;
                return transformSymmetricCovariance3(displayTransform, covariance);
              };
              const displayResidualVector = toDisplayVector(solveResidualVector);
              const displayQvv = toDisplayCovariance(solveQvv);
              const residualStdErr = (component: 'E' | 'N' | 'U'): number | undefined => {
                const index = componentIndex.get(component);
                if (index == null) return undefined;
                return ctx.seuw * Math.sqrt(Math.max(displayQvv[index]?.[index] ?? 0, 0));
              };
              const componentStdRes = (component: 'E' | 'N' | 'U'): number | undefined => {
                const index = componentIndex.get(component);
                if (index == null) return undefined;
                const sigma = residualStdErr(component);
                if (!Number.isFinite(sigma) || (sigma ?? 0) <= 0) return undefined;
                return Math.abs(displayResidualVector[index] ?? 0) / (sigma as number);
              };
              gpsObs.componentResidualStdErr = {
                sE: residualStdErr('E'),
                sN: residualStdErr('N'),
                sU: residualStdErr('U'),
              };
              gpsObs.componentStdRes = {
                tE: componentStdRes('E'),
                tN: componentStdRes('N'),
                tU: componentStdRes('U'),
              };
            }
            if (entry.t.length === 2 && entry.comps.includes('E') && entry.comps.includes('N')) {
              const idxE = entry.comps.indexOf('E');
              const idxN = entry.comps.indexOf('N');
              const tE = entry.t[idxE];
              const tN = entry.t[idxN];
              const rE = entry.r[idxE];
              const rN = entry.r[idxN];
              const mE = entry.mdb[idxE];
              const mN = entry.mdb[idxN];
              const passE = entry.pass[idxE];
              const passN = entry.pass[idxN];
              obs.stdResComponents = { tE, tN };
              obs.stdRes = Math.max(Math.abs(tE), Math.abs(tN));
              obs.redundancy = { rE, rN };
              obs.localTest = { critical: ctx.localTestCritical, pass: passE && passN };
              obs.localTestComponents = { passE, passN };
              obs.mdbComponents = { mE, mN };
            } else if (obs.type === 'gps' && entry.t.length > 2) {
              obs.stdRes = Math.max(...entry.t.map((value) => Math.abs(value)));
              obs.redundancy = Math.min(...entry.r);
              obs.localTest = {
                critical: ctx.localTestCritical,
                pass: entry.pass.every(Boolean),
              };
              obs.mdb = Math.min(...entry.mdb.filter((value) => Number.isFinite(value)));
            } else {
              obs.stdRes = Math.abs(entry.t[0]);
              obs.redundancy = entry.r[0];
              obs.localTest = { critical: ctx.localTestCritical, pass: entry.pass[0] };
              obs.mdb = entry.mdb[0];
            }
          });
        } catch (error) {
          const detail = error instanceof Error ? ` ${error.message}` : '';
          ctx.log(
            `Warning: standardized residuals not computed (normal matrix factorization failed).${detail}`,
          );
        }
      }
    }
  }

};
