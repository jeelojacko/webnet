import { transformSymmetricCovariance3 } from './adjustGpsMath';
import {
  LEGACY_LOCAL_TEST_CRITICAL,
  deriveLocalTestCritical,
  isTestableEquation,
  normalizeLocalTestPolicy,
} from './localTestPolicy';
import {
  deriveReliability,
  mdbLinearMm,
  normalizeReliabilityPolicy,
  statisticalMdb,
} from './reliabilityPolicy';
import { tryQueryStandardizedResidualRowProducts } from './adjustStatisticsRowProducts';
import { detailedNow } from './adjustDetailedSolveProfile';
import { copyMatrix } from './qxxReuseEvidence';
import { decideStatisticsQxxReuse } from './statisticsQxxReuse';
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
  // Phase 14B: provisional run-level reliability summary. The adjustment
  // path below overwrites it with the true local-test statistic family;
  // the preanalysis / no-model paths keep this guarded value.
  const reliabilityPolicy = normalizeReliabilityPolicy(ctx.reliabilityPolicy);
  const provisionalFamily =
    normalizeLocalTestPolicy(ctx.localTestPolicy).mode === 'baarda-w' ? 'w' : 'tau';
  ctx.reliabilitySummary = deriveReliability({
    policy: reliabilityPolicy,
    statisticFamily: provisionalFamily,
    robustMode: ctx.robustMode,
  });
  if (ctx.preanalysisMode) {
    ctx.reliabilitySummary = {
      ...ctx.reliabilitySummary,
      reason: [ctx.reliabilitySummary.reason, 'preanalysis-a-priori-seuw-1-no-per-observation-mdb']
        .filter(Boolean)
        .join(';'),
    };
  }
  if (!hasQxx) {
    ctx.reliabilitySummary = {
      ...ctx.reliabilitySummary,
      available: false,
      reason: 'no-adjustment-model',
    };
  }
  const profiler = ctx.detailedSolveProfiler;
  let statisticsEquationAssemblyMs = 0;
  let robustWeightPreparationMs = 0;
  let statisticsNormalAccumulationMs = 0;
  let statisticsQxxInversionMs = 0;
  let rowProductConstructionMs = 0;
  let perEquationStatisticsMs = 0;
  let gpsCrossProductTransformMs = 0;
  let summaryConstructionMs = 0;
  const flushStandardizedResidualStages = (): void => {
    profiler?.recordStandardizedResidualStage({
      statisticsEquationAssemblyMs,
      robustWeightPreparationMs,
      statisticsNormalAccumulationMs,
      statisticsQxxInversionMs,
      rowProductConstructionMs,
      perEquationStatisticsMs,
      gpsCrossProductTransformMs,
      summaryConstructionMs,
    });
  };
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
      const initialAssemblyStartedAt = profiler ? detailedNow() : 0;
      let assembled = assembleStatsEquations(sparseStatsSupported);
      if (profiler) statisticsEquationAssemblyMs += detailedNow() - initialAssemblyStartedAt;
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
          const huberFallbackAssemblyStartedAt = profiler ? detailedNow() : 0;
          assembled = assembleStatsEquations(false);
          if (profiler) {
            statisticsEquationAssemblyMs += detailedNow() - huberFallbackAssemblyStartedAt;
          }
          useSparseRowProductWeights = false;
          applyStatsHuberWeights();
        }
      };
      const huberAssemblyBefore = statisticsEquationAssemblyMs;
      const robustPrepStartedAt = profiler ? detailedNow() : 0;
      applyStatsHuberWeights();
      if (profiler) {
        robustWeightPreparationMs += Math.max(
          0,
          detailedNow() - robustPrepStartedAt -
            (statisticsEquationAssemblyMs - huberAssemblyBefore),
        );
      }

      if (!ctx.preanalysisMode) {
        try {
          const rowProductInitialStartedAt = profiler ? detailedNow() : 0;
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
          if (profiler) rowProductConstructionMs += detailedNow() - rowProductInitialStartedAt;
          if (!rowProducts && useSparseRowProductWeights) {
            const retryAssemblyStartedAt = profiler ? detailedNow() : 0;
            assembled = assembleStatsEquations(false);
            if (profiler) {
              statisticsEquationAssemblyMs += detailedNow() - retryAssemblyStartedAt;
            }
            useSparseRowProductWeights = false;
            const retryHuberAssemblyBefore = statisticsEquationAssemblyMs;
            const retryRobustPrepStartedAt = profiler ? detailedNow() : 0;
            applyStatsHuberWeights();
            if (profiler) {
              robustWeightPreparationMs += Math.max(
                0,
                detailedNow() - retryRobustPrepStartedAt -
                  (statisticsEquationAssemblyMs - retryHuberAssemblyBefore),
              );
            }
            const rowProductRetryStartedAt = profiler ? detailedNow() : 0;
            rowProducts = tryQueryStandardizedResidualRowProducts(ctx, {
              sparseRows: assembled.sparseRows,
              weights: assembled.P,
              rowInfo: assembled.rowInfo,
              activeObservations,
              observationEquationCount: numObsEquations,
              parameterCount: numParams,
            });
            if (profiler) rowProductConstructionMs += detailedNow() - rowProductRetryStartedAt;
          }
          const { L, rowInfo, sparseRows } = assembled;
          let B: number[][] = [];
          if (rowProducts) {
            if (ctx.qxxReuseProbe) {
              ctx.qxxReuseProbe({
                stage: 'statistics',
                reused: false,
                reason: 'sparse-row-products-active',
                normalDimension: null,
                qxxDimension: null,
                normalAccumulations: 0,
                inversions: 0,
              });
            }
          }
          if (!rowProducts) {
            const denseP = assembled.P;
            if (!denseP?.length) {
              throw new Error(
                'Dense fallback statistics require dense weights; disable the experimental sparse row-product path.',
              );
            }
            const reuseDecision = decideStatisticsQxxReuse({
              forceLegacy: ctx.forceLegacyStatisticsQxx === true,
              converged: ctx.solveConverged === true,
              is2D: ctx.is2D,
              preanalysisMode: ctx.preanalysisMode,
              robustMode: ctx.robustMode,
              finalQxx: hasQxx ? ctx.Qxx : null,
              hasSelectedStore: ctx.experimentalSelectedCovarianceStore != null,
              hasSparseSelectedCovarianceSolver:
                ctx.sparseSelectedCovarianceSolverActive === true,
              allowEvidenceNativeDenseQxxReuse: ctx.allowEvidenceNativeDenseQxxReuse,
              allowVerifiedNativeDenseQxxReuse: ctx.allowVerifiedNativeDenseQxxReuse,
              sparseRowProductsAvailable: false,
              numParams,
              augmentedRowCount: ctx.finalCovarianceAugmentedRows ?? 0,
              finalCovarianceDamping: ctx.finalCovarianceDamping ?? 0,
            });
            // Production seam: equations are still assembled above (L,
            // rowInfo, weights); only the statistics normal accumulation
            // and inversion are skipped when the final dense Qxx is reused.
            // multiplySparseRowsByDenseMatrix never mutates Qxx.
            if (reuseDecision.eligible && ctx.Qxx != null) {
              const reusedQxx = ctx.Qxx;
              if (ctx.qxxReuseProbe) {
                ctx.qxxReuseProbe({
                  stage: 'statistics',
                  reused: true,
                  reason: reuseDecision.reason,
                  normalDimension: null,
                  qxxDimension: numParams,
                  normalAccumulations: 0,
                  inversions: 0,
                  qxx: copyMatrix(reusedQxx),
                });
              }
              const rowProductDenseStartedAt = profiler ? detailedNow() : 0;
              B = multiplySparseRowsByDenseMatrix(sparseRows, reusedQxx);
              if (profiler) rowProductConstructionMs += detailedNow() - rowProductDenseStartedAt;
            } else {
            const statsAccumulateStartedAt = profiler ? detailedNow() : 0;
            const { normal: N } = accumulateNormalEquationsFromSparseRows(
              sparseRows,
              zeros(numObsEquations, 1),
              denseP,
              numParams,
            );
            if (profiler) {
              statisticsNormalAccumulationMs += detailedNow() - statsAccumulateStartedAt;
            }
            const statsInvertStartedAt = profiler ? detailedNow() : 0;
            const QxxStats = ctx.invertNormalMatrixForStats(N);
            if (profiler) statisticsQxxInversionMs += detailedNow() - statsInvertStartedAt;
            if (ctx.qxxReuseProbe) {
              ctx.qxxReuseProbe({
                stage: 'statistics',
                reused: false,
                reason: reuseDecision.reason,
                normalDimension: numParams,
                qxxDimension: numParams,
                normalAccumulations: 1,
                inversions: 1,
                normal: copyMatrix(N),
                qxx: copyMatrix(QxxStats),
              });
            }
            const rowProductDenseStartedAt = profiler ? detailedNow() : 0;
            B = multiplySparseRowsByDenseMatrix(sparseRows, QxxStats);
            if (profiler) rowProductConstructionMs += detailedNow() - rowProductDenseStartedAt;
            }
          }
          const rowStats = new Map<
            number,
            {
              t: number[];
              r: number[];
              mdb: number[];
              mdbStat: number[];
              pass: (boolean | null)[];
              stat: number[];
              testable: boolean[];
              comps: ('E' | 'N' | 'U' | 'X' | 'Y' | 'Z' | undefined)[];
              rows: number[];
            }
          >();
          // Legacy parity: SEUW 0 falls back to 1 exactly as before. Formal
          // pope-tau with non-positive SEUW is gated unavailable at derivation,
          // so this fallback can never produce a formal verdict.
          const s0 = ctx.seuw || 1;
          const perEquationStartedAt = profiler ? detailedNow() : 0;
          // Phase one: per-equation variance components (no thresholds yet).
          const pendingEquations: {
            obsId: number;
            component: 'E' | 'N' | 'U' | 'X' | 'Y' | 'Z' | undefined;
            row: number;
            qll: number;
            qvv: number;
            r: number;
            /** Pre-clamp redundancy driving testability (clamped qvv hides r ~= 0). */
            rUnclamped: number;
            w: number;
            tau: number;
          }[] = [];
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
            const qvvUnclamped = qll - diag;
            const qvv = Math.max(qvvUnclamped, 1e-20);
            const residual = L[i][0];
            const r = qll > 0 ? qvv / qll : 0;
            const rUnclamped = qll > 0 ? qvvUnclamped / qll : 0;
            pendingEquations.push({
              obsId: info.obs.id,
              component: info.component,
              row: i,
              qll,
              qvv,
              r,
              rUnclamped,
              w: residual / Math.sqrt(qvv),
              tau: residual / (s0 * Math.sqrt(qvv)),
            });
          }
          // Phase 14A: derive the run-level detection threshold ONCE per run.
          // Test count m = testable scalar equations (GPS counts per component).
          const policy = normalizeLocalTestPolicy(ctx.localTestPolicy);
          const testCount = pendingEquations.filter((eq) =>
            isTestableEquation(eq.rUnclamped, eq.qll),
          ).length;
          const derivation = deriveLocalTestCritical({
            mode: policy.mode,
            alpha: policy.alpha,
            correction: policy.correction,
            testCount,
            dof: ctx.dof,
            legacyCritical: policy.critical,
            seuw: ctx.seuw,
          });
          const robustApproximation =
            ctx.robustMode === 'huber' && policy.mode !== 'legacy-fixed';
          ctx.localTestSummary = {
            ...derivation,
            mode: policy.mode,
            legacyCritical: policy.critical,
            robustApproximation,
            ...(robustApproximation
              ? {
                robustApproximationReason:
                  'Huber reweighting active; classical w/tau significance is approximate.',
              }
              : {}),
          };
          // Phase 14B: true run-level reliability (statistic family now known).
          // The legacy model keeps the historical MDB computation below untouched.
          const statisticalActive = reliabilityPolicy.model === 'statistical';
          ctx.reliabilitySummary = deriveReliability({
            policy: reliabilityPolicy,
            statisticFamily: derivation.statisticFamily,
            robustMode: ctx.robustMode,
          });
          const reliabilityDelta0 = statisticalActive
            ? ctx.reliabilitySummary.delta0
            : Number.NaN;
          const reliabilityAvailable =
            statisticalActive && ctx.reliabilitySummary.available;
          const useW = derivation.statisticFamily === 'w';
          const localCritical = derivation.criticalValue;
          const localAvailable = derivation.available;
          // Phase two: verdicts against the run-level threshold.
          // MDB keeps the legacy 3.29 detection scaling in every mode (~50%
          // power limitation acknowledged; beta-aware MDB deferred to Phase 14B).
          for (const eq of pendingEquations) {
            const stat = useW ? eq.w : eq.tau;
            // Zero-redundancy equations carry no outlier signal: statistic is
            // still reported, but the verdict stays null and m excludes them.
            const rowTestable = isTestableEquation(eq.rUnclamped, eq.qll);
            const pass =
              localAvailable && rowTestable ? Math.abs(stat) <= localCritical : null;
            const sigmaQll = Math.sqrt(Math.max(eq.qll, 0));
            const mdb =
              eq.r > 1e-12
                ? (LEGACY_LOCAL_TEST_CRITICAL * s0 * sigmaQll) / Math.sqrt(eq.r)
                : Number.POSITIVE_INFINITY;
            // Phase 14B: statistical MDB only when requested; the legacy
            // mdb above is untouched (bit-identical default path).
            const mdbStat = reliabilityAvailable
              ? statisticalMdb(eq.qll, eq.r, reliabilityDelta0)
              : Number.POSITIVE_INFINITY;
            const entry = rowStats.get(eq.obsId) ?? {
              t: [],
              r: [],
              mdb: [],
              mdbStat: [],
              pass: [],
              stat: [],
              testable: [],
              comps: [],
              rows: [],
            };
            entry.t.push(eq.tau);
            entry.r.push(eq.r);
            entry.mdb.push(mdb);
            entry.mdbStat.push(mdbStat);
            entry.pass.push(pass);
            entry.stat.push(stat);
            entry.testable.push(rowTestable);
            entry.comps.push(eq.component);
            entry.rows.push(eq.row);
            rowStats.set(eq.obsId, entry);
          }
          if (profiler) perEquationStatisticsMs += detailedNow() - perEquationStartedAt;

          const gpsBeforeSummary = gpsCrossProductTransformMs;
          const summaryStartedAt = profiler ? detailedNow() : 0;
          const summaryFamily = ctx.localTestSummary?.statisticFamily ?? 'tau';
          const summaryCritical = ctx.localTestSummary?.criticalValue ?? ctx.localTestCritical;
          const summaryAvailable = ctx.localTestSummary?.available ?? true;
          const andPass = (
            a: boolean | null,
            b: boolean | null,
          ): boolean | null =>
            a === false || b === false ? false : a == null || b == null ? null : true;
          activeObservations.forEach((obs) => {
            const gpsBranchStartedAt = profiler ? detailedNow() : 0;
            const entry = rowStats.get(obs.id);
            if (!entry) return;
            const rowAvailable = summaryAvailable && entry.testable.every(Boolean);
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
              if (profiler) gpsCrossProductTransformMs += detailedNow() - gpsBranchStartedAt;
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
              const statE = entry.stat[idxE];
              const statN = entry.stat[idxN];
              obs.stdResComponents = { tE, tN };
              obs.stdRes = Math.max(Math.abs(tE), Math.abs(tN));
              obs.redundancy = { rE, rN };
              obs.localTest = {
                critical: summaryCritical,
                pass: andPass(passE ?? null, passN ?? null),
                statistic: Math.max(Math.abs(statE), Math.abs(statN)),
                statisticFamily: summaryFamily,
                available: rowAvailable,
              };
              obs.localTestComponents = { passE: passE ?? null, passN: passN ?? null };
              obs.mdbComponents = { mE, mN };
              obs.reliability = {
                mdb: Math.min(mE, mN),
                method: ctx.reliabilitySummary?.method ?? 'legacy-3.29',
                ...(reliabilityAvailable
                  ? {
                    mdbStatistical: Math.min(entry.mdbStat[idxE], entry.mdbStat[idxN]),
                    mdbStatisticalComponents: {
                      mE: entry.mdbStat[idxE],
                      mN: entry.mdbStat[idxN],
                    },
                  }
                  : {}),
              };
            } else if (obs.type === 'gps' && entry.t.length > 2) {
              obs.stdRes = Math.max(...entry.t.map((value) => Math.abs(value)));
              obs.redundancy = Math.min(...entry.r);
              obs.localTest = {
                critical: summaryCritical,
                pass: entry.pass.some((value) => value === false)
                  ? false
                  : entry.pass.some((value) => value == null)
                    ? null
                    : true,
                statistic: Math.max(...entry.stat.map((value) => Math.abs(value))),
                statisticFamily: summaryFamily,
                available: rowAvailable,
              };
              obs.mdb = Math.min(...entry.mdb.filter((value) => Number.isFinite(value)));
              obs.reliability = {
                mdb: obs.mdb,
                method: ctx.reliabilitySummary?.method ?? 'legacy-3.29',
                ...(reliabilityAvailable
                  ? {
                    mdbStatistical: Math.min(
                      ...entry.mdbStat.filter((value) => Number.isFinite(value)),
                    ),
                  }
                  : {}),
              };
            } else {
              obs.stdRes = Math.abs(entry.t[0]);
              obs.redundancy = entry.r[0];
              obs.localTest = {
                critical: summaryCritical,
                pass: entry.pass[0] ?? null,
                statistic: entry.stat[0],
                statisticFamily: summaryFamily,
                available: rowAvailable,
              };
              obs.mdb = entry.mdb[0];
              const linearMm = mdbLinearMm(
                entry.mdb[0],
                ctx.effectiveDistanceForAngularObservation(obs),
              );
              obs.reliability = {
                mdb: entry.mdb[0],
                method: ctx.reliabilitySummary?.method ?? 'legacy-3.29',
                ...(reliabilityAvailable
                  ? { mdbStatistical: entry.mdbStat[0] }
                  : {}),
                ...(linearMm !== undefined ? { mdbLinearMm: linearMm } : {}),
              };
            }
          });
          if (profiler) {
            summaryConstructionMs += Math.max(
              0,
              detailedNow() - summaryStartedAt -
                (gpsCrossProductTransformMs - gpsBeforeSummary),
            );
          }
        } catch (error) {
          const detail = error instanceof Error ? ` ${error.message}` : '';
          ctx.log(
            `Warning: standardized residuals not computed (normal matrix factorization failed).${detail}`,
          );
        }
        flushStandardizedResidualStages();
      }
    }
  }

};
