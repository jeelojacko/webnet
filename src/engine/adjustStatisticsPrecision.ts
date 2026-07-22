import { makePairKey } from './adjustMath';
import { buildWeakGeometryDiagnostics } from './adjustmentWeakGeometry';
import {
  buildDistanceAzimuthPrecision,
  buildHorizontalErrorEllipse,
  buildRelativeCovarianceFromEndpoints,
  sqrtPrecisionComponent,
} from './precisionPropagation';
import { scaleRelativeCovarianceRows, scaleStationCovarianceRows } from './resultPrecision';
import type { AdjustmentStatisticsContext } from './adjustStatisticsTypes';
import type { AdjustmentResult, Observation, StationId } from '../types';

type StationParamIndex = Record<StationId, { x?: number; y?: number; h?: number }>;

export const propagateAdjustmentPrecision = (
  ctx: AdjustmentStatisticsContext,
  paramIndex: StationParamIndex,
  activeObservations: Observation[],
): void => {

  const precisionPropagationStartedAt = Date.now();
  const posteriorScaleSq =
    ctx.dof > 0 && Number.isFinite(ctx.seuw) && ctx.seuw > 0 ? ctx.seuw * ctx.seuw : 1;
  if (ctx.dof <= 0) {
    ctx.log('DOF <= 0: using a-priori variance factor 1.0 for point precision scaling.');
  }
  const connectedPairTypes = new Map<string, Set<string>>();
  const addConnectedPair = (a: StationId, b: StationId, label: string): void => {
    if (!a || !b || a === b) return;
    const key = makePairKey(a, b);
    const types = connectedPairTypes.get(key) ?? new Set<string>();
    types.add(label);
    connectedPairTypes.set(key, types);
  };
  activeObservations.forEach((obs) => {
    if (obs.type === 'angle') {
      addConnectedPair(obs.at, obs.from, 'angle');
      addConnectedPair(obs.at, obs.to, 'angle');
      return;
    }
    if (obs.type === 'direction') {
      addConnectedPair(obs.at, obs.to, 'direction');
      return;
    }
    if ('from' in obs && 'to' in obs) {
      addConnectedPair(obs.from, obs.to, obs.type);
    }
  });

  const buildCovariance = (scaleSq: number) => (a?: number | null, b?: number | null): number => {
    if (a == null || b == null) return 0;
    if (!ctx.Qxx?.[a] || ctx.Qxx?.[a][b] == null) return 0;
    return ctx.Qxx[a][b] * scaleSq;
  };
  const sortRelativeCovariances = (
    rows: NonNullable<AdjustmentResult['relativeCovariances']>,
  ) => {
    rows.sort((a, b) => {
      const cmpFrom = a.from.localeCompare(b.from, undefined, { numeric: true });
      if (cmpFrom !== 0) return cmpFrom;
      return a.to.localeCompare(b.to, undefined, { numeric: true });
    });
    return rows;
  };
  const requestedRelativePairs = new Map<
    string,
    {
      from: StationId;
      to: StationId;
      rel: boolean;
      ptol: boolean;
    }
  >();
  const requestedPairKey = (from: StationId, to: StationId): string => {
    const canonical = makePairKey(from, to);
    const [first, second] = canonical.split('|') as [StationId, StationId];
    return `${first}::${second}`;
  };
  const registerRequestedPairs = (
    pairs: Array<{ from: StationId; to: StationId }> | undefined,
    kind: 'rel' | 'ptol',
  ) => {
    pairs?.forEach((pair) => {
      if (!pair?.from || !pair?.to || pair.from === pair.to) return;
      const key = requestedPairKey(pair.from, pair.to);
      const existing = requestedRelativePairs.get(key);
      if (existing) {
        existing.rel ||= kind === 'rel';
        existing.ptol ||= kind === 'ptol';
        return;
      }
      requestedRelativePairs.set(key, {
        from: pair.from,
        to: pair.to,
        rel: kind === 'rel',
        ptol: kind === 'ptol',
      });
    });
  };
  registerRequestedPairs(ctx.parseState?.relativeLinePairs, 'rel');
  registerRequestedPairs(ctx.parseState?.positionalTolerancePairs, 'ptol');
  const buildPrecisionModel = (scaleSq: number): NonNullable<AdjustmentResult['precisionModels']>[keyof NonNullable<AdjustmentResult['precisionModels']>] => {
    const cov = buildCovariance(scaleSq);
    const stationCovariances: NonNullable<AdjustmentResult['stationCovariances']> = [];
    ctx.unknowns.forEach((id) => {
      const idx = paramIndex[id];
      if (!idx) return;
      const hasHorizontal = idx.x != null && idx.y != null;
      const varE = hasHorizontal ? cov(idx.x, idx.x) : 0;
      const varN = hasHorizontal ? cov(idx.y, idx.y) : 0;
      const covEN = hasHorizontal ? cov(idx.x, idx.y) : 0;
      const ellipseSummary = hasHorizontal
        ? buildHorizontalErrorEllipse(varE, varN, covEN)
        : { ellipse: undefined };
      const stationBlock: NonNullable<AdjustmentResult['stationCovariances']>[number] = {
        stationId: id,
        cEE: varE,
        cEN: covEN,
        cNN: varN,
        sigmaE: sqrtPrecisionComponent(varE, Math.abs(varE)),
        sigmaN: sqrtPrecisionComponent(varN, Math.abs(varN)),
        ellipse: ellipseSummary.ellipse,
      };
      if (!ctx.is2D && idx.h != null) {
        const varH = cov(idx.h, idx.h);
        stationBlock.cEH = idx.x != null ? cov(idx.x, idx.h) : 0;
        stationBlock.cNH = idx.y != null ? cov(idx.y, idx.h) : 0;
        stationBlock.cHH = varH;
        stationBlock.sigmaH = sqrtPrecisionComponent(varH, Math.abs(varH));
      }
      stationCovariances.push(stationBlock);
    });

    const buildRelativeCovarianceRow = (
      from: StationId,
      to: StationId,
      relativeCovariance: ReturnType<typeof buildRelativeCovarianceFromEndpoints>,
      connected: boolean,
      connectionTypes: string[],
      selectedByRelativeDirective: boolean,
      selectedByPositionalToleranceDirective: boolean,
    ): NonNullable<AdjustmentResult['relativeCovariances']>[number] => {
      const fromStation = ctx.stations[from];
      const toStation = ctx.stations[to];
      const dE = (toStation?.x ?? 0) - (fromStation?.x ?? 0);
      const dN = (toStation?.y ?? 0) - (fromStation?.y ?? 0);
      const ellipseSummary = buildHorizontalErrorEllipse(
        relativeCovariance.cEE,
        relativeCovariance.cNN,
        relativeCovariance.cEN,
      );
      const { sigmaDist, sigmaAz } = buildDistanceAzimuthPrecision(dE, dN, relativeCovariance);

      const row: NonNullable<AdjustmentResult['relativeCovariances']>[number] = {
        from,
        to,
        connected,
        connectionTypes,
        selectedByRelativeDirective,
        selectedByPositionalToleranceDirective,
        cEE: relativeCovariance.cEE,
        cEN: relativeCovariance.cEN,
        cNN: relativeCovariance.cNN,
        sigmaE: sqrtPrecisionComponent(relativeCovariance.cEE, Math.abs(relativeCovariance.cEE)),
        sigmaN: sqrtPrecisionComponent(relativeCovariance.cNN, Math.abs(relativeCovariance.cNN)),
        sigmaDist,
        sigmaAz,
        ellipse: ellipseSummary.ellipse,
      };

      if (!ctx.is2D) {
        row.cEH = relativeCovariance.cEH;
        row.cNH = relativeCovariance.cNH;
        row.cHH = relativeCovariance.cHH;
        row.sigmaH = sqrtPrecisionComponent(
          relativeCovariance.cHH ?? 0,
          Math.abs(relativeCovariance.cHH ?? 0),
        );
      }

      return row;
    };

    const relativePrecision: NonNullable<AdjustmentResult['relativePrecision']> = [];
    for (let i = 0; i < ctx.unknowns.length; i += 1) {
      for (let j = i + 1; j < ctx.unknowns.length; j += 1) {
        const from = ctx.unknowns[i];
        const to = ctx.unknowns[j];
        const fromStation = ctx.stations[from];
        const toStation = ctx.stations[to];
        const idxFrom = paramIndex[from];
        const idxTo = paramIndex[to];
        if (!fromStation || !toStation || (!idxFrom && !idxTo)) continue;

        const dE = toStation.x - fromStation.x;
        const dN = toStation.y - fromStation.y;
        const horizontalCovariance = buildRelativeCovarianceFromEndpoints(cov, idxFrom, idxTo);
        const ellipseSummary = buildHorizontalErrorEllipse(
          horizontalCovariance.cEE,
          horizontalCovariance.cNN,
          horizontalCovariance.cEN,
        );
        const { sigmaDist, sigmaAz } = buildDistanceAzimuthPrecision(dE, dN, horizontalCovariance);

        relativePrecision.push({
          from,
          to,
          sigmaN: sqrtPrecisionComponent(horizontalCovariance.cNN, Math.abs(horizontalCovariance.cNN)),
          sigmaE: sqrtPrecisionComponent(horizontalCovariance.cEE, Math.abs(horizontalCovariance.cEE)),
          sigmaDist,
          sigmaAz,
          ellipse: ellipseSummary.ellipse,
        });
      }
    }

    const relativeCovariances: NonNullable<AdjustmentResult['relativeCovariances']> = [];
    connectedPairTypes.forEach((types, key) => {
      const [from, to] = key.split('|') as [StationId, StationId];
      const idxFrom = paramIndex[from];
      const idxTo = paramIndex[to];
      if ((!ctx.stations[from] || !ctx.stations[to]) || (!idxFrom && !idxTo)) return;

      const requested = requestedRelativePairs.get(requestedPairKey(from, to));
      const relativeCovariance = buildRelativeCovarianceFromEndpoints(cov, idxFrom, idxTo, !ctx.is2D);
      relativeCovariances.push(
        buildRelativeCovarianceRow(
          from,
          to,
          relativeCovariance,
          true,
          Array.from(types).sort(),
          requested?.rel ?? false,
          requested?.ptol ?? false,
        ),
      );
    });

    requestedRelativePairs.forEach((requested, key) => {
      if (connectedPairTypes.has(key.replace('::', '|'))) return;
      const fromStation = ctx.stations[requested.from];
      const toStation = ctx.stations[requested.to];
      const idxFrom = paramIndex[requested.from];
      const idxTo = paramIndex[requested.to];
      if (!fromStation || !toStation || (!idxFrom && !idxTo)) return;
      const relativeCovariance = buildRelativeCovarianceFromEndpoints(
        cov,
        idxFrom,
        idxTo,
        !ctx.is2D,
      );
      relativeCovariances.push(
        buildRelativeCovarianceRow(
          requested.from,
          requested.to,
          relativeCovariance,
          false,
          [],
          requested.rel,
          requested.ptol,
        ),
      );
    });

    return {
      stationCovariances,
      relativePrecision,
      relativeCovariances: sortRelativeCovariances(relativeCovariances),
    };
  };

  const industryStandardModel = buildPrecisionModel(1);
  const posteriorScaledModel = {
    stationCovariances: scaleStationCovarianceRows(
      industryStandardModel.stationCovariances,
      posteriorScaleSq,
    ),
    relativeCovariances: scaleRelativeCovarianceRows(
      industryStandardModel.relativeCovariances,
      posteriorScaleSq,
    ),
  };
  ctx.precisionModels = {
    'industry-standard': industryStandardModel,
    'posterior-scaled': posteriorScaledModel,
  };
  ctx.stationCovariances = industryStandardModel.stationCovariances;
  ctx.relativePrecision = industryStandardModel.relativePrecision;
  ctx.relativeCovariances = industryStandardModel.relativeCovariances;
  ctx.unknowns.forEach((id) => {
    const station = ctx.stations[id];
    if (!station) return;
    station.errorEllipse = undefined;
    station.sN = undefined;
    station.sE = undefined;
    station.sH = undefined;
  });
  industryStandardModel.stationCovariances?.forEach((row) => {
    const station = ctx.stations[row.stationId];
    if (!station) return;
    station.errorEllipse = row.ellipse;
    station.sE = row.sigmaE;
    station.sN = row.sigmaN;
    station.sH = row.sigmaH;
  });

  if (ctx.preanalysisMode) {
    ctx.weakGeometryDiagnostics = buildWeakGeometryDiagnostics(
      industryStandardModel.stationCovariances ?? [],
      industryStandardModel.relativeCovariances ?? [],
    );
    const flaggedStations = ctx.weakGeometryDiagnostics.stationCues.filter(
      (cue) => cue.severity !== 'ok',
    );
    const flaggedPairs = ctx.weakGeometryDiagnostics.relativeCues.filter(
      (cue) => cue.severity !== 'ok',
    );
    ctx.log(
      `Preanalysis covariance blocks: stations=${industryStandardModel.stationCovariances?.length ?? 0}, connectedPairs=${industryStandardModel.relativeCovariances?.length ?? 0}`,
    );
    ctx.log(
      `Preanalysis weak geometry cues: stations=${flaggedStations.length}, connectedPairs=${flaggedPairs.length}`,
    );
    flaggedStations.slice(0, 5).forEach((cue) => {
      ctx.log(`  station ${cue.stationId}: ${cue.severity.toUpperCase()} ${cue.note}`);
    });
    flaggedPairs.slice(0, 5).forEach((cue) => {
      ctx.log(`  pair ${cue.from}-${cue.to}: ${cue.severity.toUpperCase()} ${cue.note}`);
    });
  }
  ctx.solveTiming.precisionPropagationMs += Date.now() - precisionPropagationStartedAt;};
