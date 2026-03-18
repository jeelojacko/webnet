import {
  buildAdjustmentResultPayload,
  finalizeResultParseState,
} from '../src/engine/adjustmentResultBuilder';
import { describe, expect, it } from 'vitest';
import type { ParseOptions, ReductionUsageSummary } from '../src/types';

const usageSummary = (): ReductionUsageSummary => ({
  bearing: { grid: 0, measured: 0 },
  angle: { grid: 0, measured: 0 },
  direction: { grid: 0, measured: 0 },
  distance: { ground: 0, grid: 0, ellipsoidal: 0 },
  total: 0,
});

describe('adjustmentResultBuilder', () => {
  it('finalizes parse state with grid diagnostics and preserves existing parsed usage summary', () => {
    const existingParsedUsage = usageSummary();
    existingParsedUsage.total = 7;
    const parseState = {
      units: 'm',
      coordMode: '3D',
      order: 'EN',
      deltaMode: 'slope',
      mapMode: 'off',
      normalize: true,
      gridBearingMode: 'measured',
      gridDistanceMode: 'grid',
      gridAngleMode: 'grid',
      gridDirectionMode: 'measured',
      parsedUsageSummary: existingParsedUsage,
    } as ParseOptions;

    const finalized = finalizeResultParseState({
      parseState,
      coordSystemMode: 'grid',
      coordSystemDiagnostics: ['CRS_DATUM_FALLBACK', 'CRS_OUT_OF_AREA'],
      coordSystemWarningMessages: ['warn'],
      crsStatus: 'off',
      crsOffReason: 'disabledByProfile',
      crsDatumOpId: 'EPSG:1234',
      crsDatumFallbackUsed: false,
      crsAreaOfUseStatus: 'outside',
      crsOutOfAreaStationCount: 2,
      scaleOverrideActive: true,
      gnssFrameConfirmed: true,
      datumSufficiencyReport: { status: 'ok', reasons: [], suggestions: [] },
      parsedUsageSummary: usageSummary(),
      usedInSolveUsageSummary: { ...usageSummary(), total: 3 },
    });

    expect(finalized?.coordSystemDiagnostics).toEqual(['CRS_DATUM_FALLBACK', 'CRS_OUT_OF_AREA']);
    expect(finalized?.coordSystemWarningMessages).toEqual(['warn']);
    expect(finalized?.crsStatus).toBe('off');
    expect(finalized?.crsOffReason).toBe('disabledByProfile');
    expect(finalized?.crsDatumOpId).toBe('EPSG:1234');
    expect(finalized?.crsDatumFallbackUsed).toBe(true);
    expect(finalized?.observationMode).toEqual({
      bearing: 'measured',
      distance: 'grid',
      angle: 'grid',
      direction: 'measured',
    });
    expect(finalized?.reductionContext).toEqual({
      inputSpaceDefault: 'grid',
      distanceKind: 'grid',
      bearingKind: 'measured',
      explicitOverrideActive: true,
    });
    expect(finalized?.parsedUsageSummary).toBe(existingParsedUsage);
    expect(finalized?.usedInSolveUsageSummary?.total).toBe(3);
  });

  it('builds the outward-facing adjustment result payload from extracted state', () => {
    const result = buildAdjustmentResultPayload({
      success: true,
      converged: true,
      iterations: 2,
      stations: {},
      observations: [],
      logs: ['ok'],
      seuw: 1.2,
      dof: 5,
      parseState: {
        units: 'm',
        coordMode: '3D',
        order: 'EN',
        deltaMode: 'slope',
        mapMode: 'off',
        normalize: true,
      } as ParseOptions,
      statisticalSummary: {
        byGroup: [],
        totalCount: 0,
        totalSumSquares: 0,
        totalErrorFactorByCount: 0,
        totalErrorFactorByDof: 0,
      },
      residualDiagnostics: {
        criticalT: 3,
        observationCount: 0,
        withStdResCount: 0,
        over2SigmaCount: 0,
        over3SigmaCount: 0,
        over4SigmaCount: 0,
        localFailCount: 0,
        lowRedundancyCount: 0,
        veryLowRedundancyCount: 0,
        byType: [],
      },
      clusterDiagnostics: {
        enabled: false,
        passMode: 'single-pass',
        linkageMode: 'single',
        dimension: '2D',
        tolerance: 0.01,
        pairCount: 0,
        candidateCount: 0,
        candidates: [],
      },
    });

    expect(result.success).toBe(true);
    expect(result.converged).toBe(true);
    expect(result.iterations).toBe(2);
    expect(result.logs).toEqual(['ok']);
    expect(result.seuw).toBe(1.2);
    expect(result.residualDiagnostics?.criticalT).toBe(3);
    expect(result.clusterDiagnostics?.enabled).toBe(false);
  });
});
