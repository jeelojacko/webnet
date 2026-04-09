import { describe, expect, it } from 'vitest';

import {
  createIncludeScopeSnapshot,
  restoreIncludeScopeSnapshot,
} from '../src/engine/parseIncludeScope';
import type { ParseOptions } from '../src/types';

type RawShot = {
  to: string;
  obs: number;
};

type AliasRule = {
  kind: 'prefix';
  from: string;
  to: string;
};

const baseState: ParseOptions = {
  runMode: 'adjustment',
  units: 'm',
  coordMode: '3D',
  coordSystemMode: 'local',
  crsId: 'EPSG:26920',
  localDatumScheme: 'average-scale',
  averageScaleFactor: 1,
  scaleOverrideActive: false,
  commonElevation: 0,
  averageGeoidHeight: 0,
  reductionContext: {
    inputSpaceDefault: 'measured',
    distanceKind: 'ground',
    bearingKind: 'grid',
    explicitOverrideActive: false,
  },
  observationMode: {
    bearing: 'grid',
    distance: 'measured',
    angle: 'measured',
    direction: 'measured',
  },
  gridBearingMode: 'grid',
  gridDistanceMode: 'measured',
  gridAngleMode: 'measured',
  gridDirectionMode: 'measured',
  preanalysisMode: false,
  order: 'EN',
  angleUnits: 'dms',
  angleStationOrder: 'atfromto',
  deltaMode: 'slope',
  mapMode: 'off',
  normalize: true,
  faceNormalizationMode: 'on',
  directionFaceReliabilityFromCluster: false,
  directionFaceZenithWindowDeg: 45,
  directionFaceClusterSeparationDeg: 180,
  directionFaceClusterSeparationToleranceDeg: 20,
  directionFaceClusterConfidenceMin: 0.35,
  mapScaleFactor: 1,
  applyCurvatureRefraction: false,
  refractionCoefficient: 0.13,
  verticalReduction: 'none',
  crsTransformEnabled: false,
  crsProjectionModel: 'legacy-equirectangular',
  crsLabel: '',
  crsGridScaleEnabled: false,
  crsGridScaleFactor: 1,
  crsConvergenceEnabled: false,
  crsConvergenceAngleRad: 0,
  geoidModelEnabled: false,
  geoidModelId: 'NGS-DEMO',
  geoidSourceFormat: 'builtin',
  geoidSourcePath: '',
  geoidSourceResolvedFormat: 'builtin',
  geoidSourceFallbackUsed: false,
  geoidInterpolation: 'bilinear',
  geoidHeightConversionEnabled: false,
  geoidOutputHeightDatum: 'orthometric',
  geoidModelLoaded: false,
  geoidModelMetadata: '',
  geoidConvertedStationCount: 0,
  geoidSkippedStationCount: 0,
  gpsVectorMode: 'network',
  gnssVectorFrameDefault: 'gridNEU',
  gnssFrameConfirmed: false,
  gpsTopoShots: [],
  gpsAddHiHtEnabled: false,
  gpsAddHiHtHiM: 0,
  gpsAddHiHtHtM: 0,
  gpsLoopCheckEnabled: false,
  levelLoopToleranceBaseMm: 0,
  levelLoopTolerancePerSqrtKmMm: 4,
  lonSign: 'west-negative',
  edmMode: 'additive',
  applyCentering: true,
  addCenteringToExplicit: false,
  debug: false,
  angleMode: 'auto',
  tsCorrelationEnabled: false,
  tsCorrelationRho: 0.25,
  tsCorrelationScope: 'set',
  robustMode: 'none',
  robustK: 1.5,
  descriptionReconcileMode: 'first',
  descriptionAppendDelimiter: ' | ',
  qFixLinearSigmaM: 1e-7,
  qFixAngularSigmaSec: 1.0001e-3,
  prismEnabled: false,
  prismOffset: 0,
  prismScope: 'global',
  rotationAngleRad: 0,
  lostStationIds: [],
  autoAdjustEnabled: false,
  autoAdjustMaxCycles: 3,
  autoAdjustMaxRemovalsPerCycle: 1,
  autoAdjustStdResThreshold: 4,
  autoSideshotEnabled: true,
  directionSetMode: 'reduced',
  parseCompatibilityMode: 'legacy',
  parseCompatibilityDiagnostics: [],
  ambiguousCount: 0,
  legacyFallbackCount: 0,
  strictRejectCount: 0,
  rewriteSuggestionCount: 0,
  parseModeMigrated: false,
  sourceFile: '<input>',
  includeFiles: {},
  includeMaxDepth: 16,
  includeStack: [],
  includeTrace: [],
  includeErrors: [],
  compatibilityAcceptedNoOpDirectives: [],
  stationSeparator: '-',
  dataInputEnabled: true,
  threeReduceMode: false,
  linearMultiplier: 1,
  elevationInputMode: 'orthometric',
  projectElevationMeters: 0,
  clusterDetectionEnabled: true,
  clusterLinkageMode: 'single',
  clusterTolerance2D: 0.03,
  clusterTolerance3D: 0.05,
  clusterApprovedMerges: [],
  clusterPassLabel: 'single',
  clusterDualPassRan: false,
  clusterApprovedMergeCount: 0,
  preferExternalInstruments: false,
  directiveTransitions: [],
  directiveNoEffectWarnings: [],
};

describe('parseIncludeScope helpers', () => {
  it('round-trips scoped state, traverse context, and alias metadata', () => {
    const snapshot = createIncludeScopeSnapshot({
      state: baseState,
      traverseCtx: {
        occupy: 'A',
        backsight: 'B',
        backsightRefAngle: 1.23,
        dirSetId: 'SET1',
        dirInstCode: 'S9',
        dirRawShots: [{ to: 'P1', obs: 2.5 }],
      },
      faceMode: 'face1',
      directionSetCount: 7,
      lastGpsObservation: { from: 'G1', to: 'G2' },
      explicitAliases: new Map([['OLD', 'NEW']]),
      explicitAliasLines: new Map([['OLD', 44]]),
      aliasRules: [{ kind: 'prefix', from: 'A', to: 'B' }],
      lostStationIds: new Set(['LS1']),
      cloneAliasRule: (rule) => ({ ...rule }),
      cloneRawDirectionShot: (shot) => ({ ...shot }),
    });

    const mutatedState: ParseOptions = {
      ...baseState,
      units: 'ft',
      reductionContext: {
        inputSpaceDefault: 'grid',
        distanceKind: 'grid',
        bearingKind: 'measured',
        explicitOverrideActive: true,
      },
      observationMode: {
        bearing: 'measured',
        distance: 'grid',
        angle: 'grid',
        direction: 'grid',
      },
    };
    const traverseCtx = {
      occupy: undefined as string | undefined,
      backsight: undefined as string | undefined,
      backsightRefAngle: undefined as number | undefined,
      dirSetId: undefined as string | undefined,
      dirInstCode: undefined as string | undefined,
      dirRawShots: undefined as RawShot[] | undefined,
    };

    const restored = restoreIncludeScopeSnapshot({
      stateTarget: mutatedState,
      traverseCtxTarget: traverseCtx,
      snapshot,
      normalizeObservationModeState: () => {},
      cloneAliasRule: (rule) => ({ ...rule }),
      cloneRawDirectionShot: (shot) => ({ ...shot }),
    });

    expect(mutatedState.units).toBe('m');
    expect(mutatedState.reductionContext?.distanceKind).toBe('ground');
    expect(mutatedState.observationMode?.bearing).toBe('grid');
    expect(traverseCtx).toEqual({
      occupy: 'A',
      backsight: 'B',
      backsightRefAngle: 1.23,
      dirSetId: 'SET1',
      dirInstCode: 'S9',
      dirRawShots: [{ to: 'P1', obs: 2.5 }],
    });
    expect(restored.faceMode).toBe('face1');
    expect(restored.directionSetCount).toBe(7);
    expect(restored.explicitAliases.get('OLD')).toBe('NEW');
    expect(restored.explicitAliasLines.get('OLD')).toBe(44);
    expect(restored.aliasRules).toEqual([{ kind: 'prefix', from: 'A', to: 'B' }]);
    expect([...restored.lostStationIds]).toEqual(['LS1']);
  });
});
