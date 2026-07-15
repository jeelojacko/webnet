import type {
  DistanceObservation,
  GpsObservation,
  Observation,
  ParseOptions,
  StationId,
} from '../types';

export const buildDataCheckContextForEngine = (engine: any) => {
  return {
      input: engine.input,
      stations: engine.stations,
      observations: engine.observations,
      unknowns: engine.unknowns,
      maxIterations: engine.maxIterations,
      convergenceThreshold: engine.convergenceThreshold,
      instrumentLibrary: engine.instrumentLibrary,
      excludeIds: engine.excludeIds,
      overrides: engine.overrides,
      parseOptions: engine.parseOptions,
      geoidSourceData: engine.geoidSourceData,
      is2D: engine.is2D,
      coordSystemMode: engine.coordSystemMode,
      runMode: engine.runMode,
      iterations: engine.iterations,
      dof: engine.dof,
      seuw: engine.seuw,
      converged: engine.converged,
      log: (message: string) => engine.log(message),
      buildResult: () => engine.buildResult(),
      centeringLineGeometry: (fromId: StationId, toId: StationId, hi?: number, ht?: number) =>
        engine.centeringLineGeometry(fromId, toId, hi, ht),
      correctedDistanceModel: (obs: Observation & { type: 'dist' }, calcDistRaw: number) =>
        engine.correctedDistanceModel(obs, calcDistRaw),
      getObservedHorizontalDistanceIn2D: (obs: DistanceObservation) =>
        engine.getObservedHorizontalDistanceIn2D(obs),
      getAzimuth: (fromId: StationId, toId: StationId) => engine.getAzimuth(fromId, toId),
      getModeledZenith: (obs: Observation & { type: 'zenith' }) => engine.getModeledZenith(obs),
      gpsObservedVector: (obs: GpsObservation) => engine.gpsObservedVector(obs),
      gpsModeledVector: (obs: GpsObservation) => engine.gpsModeledVector(obs),
      gpsCovariance: (obs: Observation) => engine.gpsCovariance(obs),
      modeledAzimuth: (rawAz: number, atStationId?: StationId, applyConvergence?: boolean) =>
        engine.modeledAzimuth(rawAz, atStationId, applyConvergence),
      stationGeodetic: (stationId: StationId) => engine.stationGeodetic(stationId),
      stationFactorSnapshot: (stationId: StationId) => engine.stationFactorSnapshot(stationId),
      wrapToPi: (value: number) => engine.wrapToPi(value),
      solveProvisional: (maxIterations: number, parseOptions: ParseOptions) =>
        new engine.constructor({
          input: engine.input,
          maxIterations,
          convergenceThreshold: engine.convergenceThreshold,
          instrumentLibrary: engine.instrumentLibrary,
          excludeIds: engine.excludeIds,
          overrides: engine.overrides,
          parseOptions,
          geoidSourceData: engine.geoidSourceData,
        }).solve(),
  };
};

export const syncDataCheckContextForEngine = (engine: any, ctx: any): void => {
  engine.runMode = ctx.runMode ?? engine.runMode;
  engine.iterations = ctx.iterations;
  engine.dof = ctx.dof;
  engine.seuw = ctx.seuw;
  engine.converged = ctx.converged;
};
