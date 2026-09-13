/**
 * Phase 12I.1 — free-network routing/failure/size-gate tests (agent tier).
 *
 * Extra-rank-defect cases, self-baseline audit preservation, native-route
 * rejection, certified size-cap boundaries, R2B isolation + worker
 * contract, and the 12I.0 rank-oracle cross-check. Synthetic only.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import type { StationMap } from '../../src/types';
import { runGnssBaselineAdjustment } from '../../src/engine/gnssBaselineAdjust';
import type {
  GnssBaselineAdjustInput,
  GnssBaselineNativeRuntime,
} from '../../src/engine/gnssBaselineAdjust';
import {
  GNSS_FREE_EXTRA_RANK_DEFECT,
  GNSS_FREE_NETWORK_MAX_STATIONS,
  GNSS_FREE_NETWORK_SIZE_LIMIT,
} from '../../src/engine/gnssFreeNetwork';
import {
  assembleFreeNetwork,
  rankOf,
} from '../../src/engine/gnssFreeNetworkDatum';
import {
  deriveGnssNativeR2BEligibility,
  runGnssBaselineWithNativeR2B,
  setGnssNativeR2BRouteEnabled,
} from '../../src/workers/gnssBaselineNativeR2BRoute';
import {
  buildBaselines,
  buildStations,
  isotropicCovariance,
  resetBaselineIds,
} from './gnssBaselineTestBuilder';
import { countingBlockSolver, countingCorrectionSolver } from '../helpers/sparseTestStubs';
import {
  asDense,
  fixFirst,
  makeNet,
  mesh4,
  ring5,
  triangle,
  twoFree,
  type SyntheticNet,
} from './gnssFreeNetworkTestSupport';

beforeEach(() => {
  setGnssNativeR2BRouteEnabled(false);
});
describe('failure modes', () => {
  it('isolated free stations raise the distinct extra-rank-defect error', () => {
    const net = triangle();
    const stations: StationMap = {
      ...net.stations,
      GHOST: { x: 3800000, y: 950000, h: 4990000, fixed: false },
    };
    expect(() =>
      runGnssBaselineAdjustment({ stations, baselines: net.baselines, datumMode: 'allow-free' }),
    ).toThrow(GNSS_FREE_EXTRA_RANK_DEFECT);
  });

  it('self-baselines keep their audit error (never mapped to extra-defect)', () => {
    resetBaselineIds();
    const stations = buildStations([
      { id: 'P01', x: 3760000, y: 900000, z: 4980000 },
      { id: 'P02', x: 3760100, y: 900050, z: 4980020 },
    ]);
    const baselines = buildBaselines([
      { from: 'P01', to: 'P02', dx: 100, dy: 50, dz: 20, covariance: isotropicCovariance(0.005) },
      { from: 'P01', to: 'P01', dx: 0, dy: 0, dz: 0, covariance: isotropicCovariance(0.005) },
    ]);
    expect(() =>
      runGnssBaselineAdjustment({ stations, baselines, datumMode: 'allow-free' }),
    ).toThrow(/self-baseline/);
  });

  it('partial XYZ control is rejected as extra rank defect', () => {
    const net = triangle();
    const stations: StationMap = Object.fromEntries(
      Object.entries(net.stations).map(([id, station]) => [id, { ...station }]),
    );
    const first = [...net.ids].sort()[0] as string;
    stations[first] = { ...(stations[first] as object), fixedX: true } as StationMap[string];
    expect(() =>
      runGnssBaselineAdjustment({ stations, baselines: net.baselines, datumMode: 'allow-free' }),
    ).toThrow(GNSS_FREE_EXTRA_RANK_DEFECT);
  });

  it('empty networks keep the legacy error', () => {
    const net = triangle();
    expect(() =>
      runGnssBaselineAdjustment({ stations: net.stations, baselines: [], datumMode: 'allow-free' }),
    ).toThrow(/at least one baseline/);
  });

  it('native providers are never admitted for free networks', () => {
    const net = triangle();
    expect(() =>
      runGnssBaselineAdjustment({
        stations: net.stations,
        baselines: net.baselines,
        datumMode: 'allow-free',
        nativeRuntime: {} as GnssBaselineNativeRuntime,
      }),
    ).toThrow(/never admitted/);
  });
});

describe('size cap boundaries', () => {
  const ring = (count: number): SyntheticNet => {
    const names = Array.from({ length: count }, (_, i) => `S${String(i).padStart(4, '0')}`);
    const edges = names.map((from, i) => [from, names[(i + 1) % count] as string] as [string, string]);
    return makeNet(names, edges);
  };

  it(`max-1 (${GNSS_FREE_NETWORK_MAX_STATIONS - 1}) and max (${GNSS_FREE_NETWORK_MAX_STATIONS}) solve`, () => {
    for (const count of [GNSS_FREE_NETWORK_MAX_STATIONS - 1, GNSS_FREE_NETWORK_MAX_STATIONS]) {
      const net = ring(count);
      const result = asDense({ stations: net.stations, baselines: net.baselines, datumMode: 'allow-free' });
      expect(result.dof).toBe(3);
      expect(result.datumSummary?.estimableRank).toBe(3 * count - 3);
    }
  }, 30000);

  it(`max+1 (${GNSS_FREE_NETWORK_MAX_STATIONS + 1}) throws the size limit without solving`, () => {
    const net = ring(GNSS_FREE_NETWORK_MAX_STATIONS + 1);
    expect(() =>
      runGnssBaselineAdjustment({ stations: net.stations, baselines: net.baselines, datumMode: 'allow-free' }),
    ).toThrow(GNSS_FREE_NETWORK_SIZE_LIMIT);
  });
});

describe('R2B isolation + worker contract', () => {
  it('free allow-free routes clean TypeScript even when R2B is armed', async () => {
    setGnssNativeR2BRouteEnabled(true);
    const net = ring5();
    const attempt = await runGnssBaselineWithNativeR2B(
      { stations: net.stations, baselines: net.baselines, datumMode: 'allow-free' },
      {
        isWorker: true,
        minParams: 1,
        correctionSolverOverride: countingCorrectionSolver(),
        blockSolverOverride: countingBlockSolver(),
      },
    );
    expect(attempt.route).toBe('typescript');
    expect(attempt.reasons.join(' ')).toMatch(/free-network/);
    expect(attempt.result.routeProvenance).toBe('typescript-dense');
    expect(attempt.result.datumSummary?.kind).toBe('free');
  });

  it('constrained small nets stay TS below the floor (no free reason), failures reject', async () => {
    const net = ring5();
    const attempt = await runGnssBaselineWithNativeR2B(
      { stations: fixFirst(net), baselines: net.baselines },
      { isWorker: true, minParams: 1 },
    );
    expect(attempt.route).toBe('typescript');
    expect(attempt.reasons.join(' ')).not.toMatch(/free-network/);
    // Failure contract: free net on the default datum rejects (worker maps this to gnss-failure).
    await expect(
      runGnssBaselineWithNativeR2B({ stations: net.stations, baselines: net.baselines }, { isWorker: true }),
    ).rejects.toThrow(/free-network adjustment is deferred/);
  });

  it('direct nativeRuntime injection into a free solve throws (never R1/R2B)', () => {
    const net = triangle();
    expect(() =>
      runGnssBaselineAdjustment({
        stations: net.stations,
        baselines: net.baselines,
        datumMode: 'allow-free',
        nativeRuntime: {
          sparseCorrectionSolver: countingCorrectionSolver(),
        } as unknown as GnssBaselineNativeRuntime,
      }),
    ).toThrow(/never admitted/);
  });

  it('eligibility ignores datum-free small nets the usual way (floor reason)', () => {
    setGnssNativeR2BRouteEnabled(true);
    const net = ring5();
    const eligibility = deriveGnssNativeR2BEligibility(
      { stations: fixFirst(net), baselines: net.baselines },
      { isWorker: true, minParams: 1 },
    );
    expect(eligibility.eligible).toBe(true);
  });

  it('worker protocol payload threads datumMode (type-level contract)', () => {
    const net = triangle();
    const payload: GnssBaselineAdjustInput = {
      stations: net.stations,
      baselines: net.baselines,
      datumMode: 'allow-free',
    };
    const message: { type: 'gnss-run'; runId: string; payload: GnssBaselineAdjustInput } = {
      type: 'gnss-run',
      runId: 'probe',
      payload,
    };
    expect(message.payload.datumMode).toBe('allow-free');
  });
});

describe('rank oracle cross-check (12I.0 evidence)', () => {
  it('assembled rank matches the reported estimable rank', () => {
    for (const make of [triangle, mesh4, twoFree]) {
      const net = make();
      const assembly = assembleFreeNetwork(net.stations, net.baselines);
      const rank = rankOf(assembly.A);
      const result = asDense({ stations: net.stations, baselines: net.baselines, datumMode: 'allow-free' });
      expect(rank).toBe(result.datumSummary?.estimableRank);
    }
  });
});
