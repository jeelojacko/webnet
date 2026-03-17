import type { ParseOptions } from '../types';

export type IncludeFaceMode = 'unknown' | 'face1' | 'face2';

export interface IncludeTraverseContextSnapshot<TRawDirectionShot> {
  occupy?: string;
  backsight?: string;
  backsightRefAngle?: number;
  dirSetId?: string;
  dirInstCode?: string;
  dirRawShots?: TRawDirectionShot[];
}

export interface IncludeScopeSnapshot<
  TGpsObservation,
  TStationId extends string,
  TAliasRule,
  TRawDirectionShot,
> {
  state: Partial<ParseOptions>;
  traverseCtx: IncludeTraverseContextSnapshot<TRawDirectionShot>;
  faceMode: IncludeFaceMode;
  directionSetCount: number;
  lastGpsObservation?: TGpsObservation;
  explicitAliases: Map<TStationId, TStationId>;
  explicitAliasLines: Map<TStationId, number>;
  aliasRules: TAliasRule[];
  lostStationIds: Set<TStationId>;
}

const cloneScopedParseState = (state: ParseOptions): Partial<ParseOptions> => ({
  units: state.units,
  coordMode: state.coordMode,
  coordSystemMode: state.coordSystemMode,
  crsId: state.crsId,
  localDatumScheme: state.localDatumScheme,
  averageScaleFactor: state.averageScaleFactor,
  scaleOverrideActive: state.scaleOverrideActive,
  commonElevation: state.commonElevation,
  averageGeoidHeight: state.averageGeoidHeight,
  reductionContext: state.reductionContext ? { ...state.reductionContext } : undefined,
  observationMode: state.observationMode ? { ...state.observationMode } : undefined,
  gridBearingMode: state.gridBearingMode,
  gridDistanceMode: state.gridDistanceMode,
  gridAngleMode: state.gridAngleMode,
  gridDirectionMode: state.gridDirectionMode,
  preanalysisMode: state.preanalysisMode,
  order: state.order,
  angleUnits: state.angleUnits,
  angleStationOrder: state.angleStationOrder,
  deltaMode: state.deltaMode,
  mapMode: state.mapMode,
  normalize: state.normalize,
  faceNormalizationMode: state.faceNormalizationMode,
  directionFaceReliabilityFromCluster: state.directionFaceReliabilityFromCluster,
  directionFaceZenithWindowDeg: state.directionFaceZenithWindowDeg,
  directionFaceClusterSeparationDeg: state.directionFaceClusterSeparationDeg,
  directionFaceClusterSeparationToleranceDeg: state.directionFaceClusterSeparationToleranceDeg,
  directionFaceClusterConfidenceMin: state.directionFaceClusterConfidenceMin,
  mapScaleFactor: state.mapScaleFactor,
  applyCurvatureRefraction: state.applyCurvatureRefraction,
  refractionCoefficient: state.refractionCoefficient,
  verticalReduction: state.verticalReduction,
  levelWeight: state.levelWeight,
  originLatDeg: state.originLatDeg,
  originLonDeg: state.originLonDeg,
  crsTransformEnabled: state.crsTransformEnabled,
  crsProjectionModel: state.crsProjectionModel,
  crsLabel: state.crsLabel,
  crsGridScaleEnabled: state.crsGridScaleEnabled,
  crsGridScaleFactor: state.crsGridScaleFactor,
  crsConvergenceEnabled: state.crsConvergenceEnabled,
  crsConvergenceAngleRad: state.crsConvergenceAngleRad,
  geoidModelEnabled: state.geoidModelEnabled,
  geoidModelId: state.geoidModelId,
  geoidSourceFormat: state.geoidSourceFormat,
  geoidSourcePath: state.geoidSourcePath,
  geoidInterpolation: state.geoidInterpolation,
  geoidHeightConversionEnabled: state.geoidHeightConversionEnabled,
  geoidOutputHeightDatum: state.geoidOutputHeightDatum,
  gpsVectorMode: state.gpsVectorMode,
  gnssVectorFrameDefault: state.gnssVectorFrameDefault,
  gnssFrameConfirmed: state.gnssFrameConfirmed,
  gpsAddHiHtEnabled: state.gpsAddHiHtEnabled,
  gpsAddHiHtHiM: state.gpsAddHiHtHiM,
  gpsAddHiHtHtM: state.gpsAddHiHtHtM,
  gpsLoopCheckEnabled: state.gpsLoopCheckEnabled,
  levelLoopToleranceBaseMm: state.levelLoopToleranceBaseMm,
  levelLoopTolerancePerSqrtKmMm: state.levelLoopTolerancePerSqrtKmMm,
  lonSign: state.lonSign,
  currentInstrument: state.currentInstrument,
  edmMode: state.edmMode,
  applyCentering: state.applyCentering,
  addCenteringToExplicit: state.addCenteringToExplicit,
  debug: state.debug,
  angleMode: state.angleMode,
  tsCorrelationEnabled: state.tsCorrelationEnabled,
  tsCorrelationRho: state.tsCorrelationRho,
  tsCorrelationScope: state.tsCorrelationScope,
  robustMode: state.robustMode,
  robustK: state.robustK,
  qFixLinearSigmaM: state.qFixLinearSigmaM,
  qFixAngularSigmaSec: state.qFixAngularSigmaSec,
  prismEnabled: state.prismEnabled,
  prismOffset: state.prismOffset,
  prismScope: state.prismScope,
  rotationAngleRad: state.rotationAngleRad,
  autoAdjustEnabled: state.autoAdjustEnabled,
  autoAdjustMaxCycles: state.autoAdjustMaxCycles,
  autoAdjustMaxRemovalsPerCycle: state.autoAdjustMaxRemovalsPerCycle,
  autoAdjustStdResThreshold: state.autoAdjustStdResThreshold,
  autoSideshotEnabled: state.autoSideshotEnabled,
  directionSetMode: state.directionSetMode,
  descriptionReconcileMode: state.descriptionReconcileMode,
  descriptionAppendDelimiter: state.descriptionAppendDelimiter,
  stationSeparator: state.stationSeparator,
  dataInputEnabled: state.dataInputEnabled,
  threeReduceMode: state.threeReduceMode,
  linearMultiplier: state.linearMultiplier,
  elevationInputMode: state.elevationInputMode,
  projectElevationMeters: state.projectElevationMeters,
  vLevelMode: state.vLevelMode,
  vLevelNoneStdErrMeters: state.vLevelNoneStdErrMeters,
  clusterDetectionEnabled: state.clusterDetectionEnabled,
  clusterLinkageMode: state.clusterLinkageMode,
  clusterTolerance2D: state.clusterTolerance2D,
  clusterTolerance3D: state.clusterTolerance3D,
});

interface CreateIncludeScopeSnapshotArgs<
  TGpsObservation,
  TStationId extends string,
  TAliasRule,
  TRawDirectionShot,
> {
  state: ParseOptions;
  traverseCtx: IncludeTraverseContextSnapshot<TRawDirectionShot>;
  faceMode: IncludeFaceMode;
  directionSetCount: number;
  lastGpsObservation?: TGpsObservation;
  explicitAliases: Map<TStationId, TStationId>;
  explicitAliasLines: Map<TStationId, number>;
  aliasRules: TAliasRule[];
  lostStationIds: Set<TStationId>;
  cloneAliasRule: (_rule: TAliasRule) => TAliasRule;
  cloneRawDirectionShot: (_shot: TRawDirectionShot) => TRawDirectionShot;
}

export const createIncludeScopeSnapshot = <
  TGpsObservation,
  TStationId extends string,
  TAliasRule,
  TRawDirectionShot,
>({
  state,
  traverseCtx,
  faceMode,
  directionSetCount,
  lastGpsObservation,
  explicitAliases,
  explicitAliasLines,
  aliasRules,
  lostStationIds,
  cloneAliasRule,
  cloneRawDirectionShot,
}: CreateIncludeScopeSnapshotArgs<TGpsObservation, TStationId, TAliasRule, TRawDirectionShot>): IncludeScopeSnapshot<
  TGpsObservation,
  TStationId,
  TAliasRule,
  TRawDirectionShot
> => ({
  state: cloneScopedParseState(state),
  traverseCtx: {
    occupy: traverseCtx.occupy,
    backsight: traverseCtx.backsight,
    backsightRefAngle: traverseCtx.backsightRefAngle,
    dirSetId: traverseCtx.dirSetId,
    dirInstCode: traverseCtx.dirInstCode,
    dirRawShots: traverseCtx.dirRawShots?.map(cloneRawDirectionShot),
  },
  faceMode,
  directionSetCount,
  lastGpsObservation,
  explicitAliases: new Map(explicitAliases),
  explicitAliasLines: new Map(explicitAliasLines),
  aliasRules: aliasRules.map(cloneAliasRule),
  lostStationIds: new Set(lostStationIds),
});

interface RestoreIncludeScopeSnapshotArgs<
  TGpsObservation,
  TStationId extends string,
  TAliasRule,
  TRawDirectionShot,
> {
  stateTarget: ParseOptions;
  traverseCtxTarget: IncludeTraverseContextSnapshot<TRawDirectionShot>;
  snapshot: IncludeScopeSnapshot<TGpsObservation, TStationId, TAliasRule, TRawDirectionShot>;
  normalizeObservationModeState: (_state: ParseOptions) => void;
  cloneAliasRule: (_rule: TAliasRule) => TAliasRule;
  cloneRawDirectionShot: (_shot: TRawDirectionShot) => TRawDirectionShot;
}

export const restoreIncludeScopeSnapshot = <
  TGpsObservation,
  TStationId extends string,
  TAliasRule,
  TRawDirectionShot,
>({
  stateTarget,
  traverseCtxTarget,
  snapshot,
  normalizeObservationModeState,
  cloneAliasRule,
  cloneRawDirectionShot,
}: RestoreIncludeScopeSnapshotArgs<TGpsObservation, TStationId, TAliasRule, TRawDirectionShot>) => {
  Object.assign(stateTarget, {
    ...snapshot.state,
    reductionContext: snapshot.state.reductionContext
      ? { ...snapshot.state.reductionContext }
      : undefined,
    observationMode: snapshot.state.observationMode
      ? { ...snapshot.state.observationMode }
      : undefined,
  });
  normalizeObservationModeState(stateTarget);
  traverseCtxTarget.occupy = snapshot.traverseCtx.occupy;
  traverseCtxTarget.backsight = snapshot.traverseCtx.backsight;
  traverseCtxTarget.backsightRefAngle = snapshot.traverseCtx.backsightRefAngle;
  traverseCtxTarget.dirSetId = snapshot.traverseCtx.dirSetId;
  traverseCtxTarget.dirInstCode = snapshot.traverseCtx.dirInstCode;
  traverseCtxTarget.dirRawShots = snapshot.traverseCtx.dirRawShots?.map(cloneRawDirectionShot);
  return {
    faceMode: snapshot.faceMode,
    directionSetCount: snapshot.directionSetCount,
    lastGpsObservation: snapshot.lastGpsObservation,
    explicitAliases: new Map(snapshot.explicitAliases),
    explicitAliasLines: new Map(snapshot.explicitAliasLines),
    aliasRules: snapshot.aliasRules.map(cloneAliasRule),
    lostStationIds: new Set(snapshot.lostStationIds),
  };
};
