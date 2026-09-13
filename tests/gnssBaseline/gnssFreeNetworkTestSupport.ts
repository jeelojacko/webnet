/**
 * Phase 12I.1 shared synthetic free-network fixtures (agent tier).
 *
 * Deterministic ECEF nets with per-edge varying mm noise (uniform-per-edge
 * noise is translation-mode and unobservable). ECEF magnitudes ~5e6 m
 * quantize stored coords at ~1e-9 m: keep test tolerances ulp-aware.
 */
import type { StationMap } from '../../src/types';
import type { GnssBaselineObservation } from '../../src/engine/gnssBaselineTypes';
import {
  runGnssBaselineAdjustment,
  type GnssBaselineAdjustInput,
  type GnssBaselineDenseAdjustResult,
} from '../../src/engine/gnssBaselineAdjust';
import { setStationFixed } from '../../src/engine/gnssWorkspaceSession';
import {
  buildBaselines,
  buildStations,
  isotropicCovariance,
  resetBaselineIds,
} from './gnssBaselineTestBuilder';

export const BASE: [number, number, number] = [3760000, 900000, 4980000];
export const STEP: [number, number, number] = [137.5, -89.3, 53.1];
export const OFFSET: [number, number, number] = [0.02, -0.015, 0.01];

/** Per-edge varying mm noise (uniform-per-edge noise is translation-mode). */
export const noiseOf = (id: number): [number, number, number] => [
  (((id * 37) % 7) - 3) * 0.001,
  (((id * 53) % 5) - 2) * 0.001,
  (((id * 29) % 9) - 4) * 0.001,
];

export interface SyntheticNet {
  stations: StationMap;
  baselines: GnssBaselineObservation[];
  ids: string[];
}

export const makeNet = (names: string[], edges: [string, string][]): SyntheticNet => {
  resetBaselineIds();
  const truth = new Map(names.map((id, i) => [id, [
    BASE[0] + i * STEP[0],
    BASE[1] + i * STEP[1],
    BASE[2] + i * STEP[2],
  ] as [number, number, number]]));
  const stations = buildStations(
    names.map((id) => {
      const t = truth.get(id) as [number, number, number];
      return { id, x: t[0] + OFFSET[0], y: t[1] + OFFSET[1], z: t[2] + OFFSET[2] };
    }),
  );
  const baselines = buildBaselines(
    edges.map(([from, to]) => {
      const f = truth.get(from) as [number, number, number];
      const o = truth.get(to) as [number, number, number];
      return {
        from, to,
        dx: o[0] - f[0], dy: o[1] - f[1], dz: o[2] - f[2],
        covariance: isotropicCovariance(0.005),
      };
    }),
  );
  const noisy = baselines.map((baseline) => {
    const [nx, ny, nz] = noiseOf(baseline.id);
    return {
      ...baseline,
      vector: { x: baseline.vector.x + nx, y: baseline.vector.y + ny, z: baseline.vector.z + nz },
    };
  });
  return { stations, baselines: noisy, ids: names };
};

export const triangle = (): SyntheticNet =>
  makeNet(['P01', 'P02', 'P03'], [['P01', 'P02'], ['P02', 'P03'], ['P03', 'P01']]);
export const ring5 = (): SyntheticNet =>
  makeNet(
    ['R01', 'R02', 'R03', 'R04', 'R05'],
    [['R01', 'R02'], ['R02', 'R03'], ['R03', 'R04'], ['R04', 'R05'], ['R05', 'R01']],
  );
export const mesh4 = (): SyntheticNet =>
  makeNet(
    ['M01', 'M02', 'M03', 'M04'],
    [['M01', 'M02'], ['M01', 'M03'], ['M01', 'M04'], ['M02', 'M03'], ['M02', 'M04'], ['M03', 'M04']],
  );
export const repeated = (): SyntheticNet =>
  makeNet(['D01', 'D02', 'D03'], [['D01', 'D02'], ['D02', 'D03'], ['D03', 'D01'], ['D01', 'D02']]);
export const twoFree = (): SyntheticNet =>
  makeNet(
    ['A01', 'A02', 'A03', 'B01', 'B02', 'B03'],
    [['A01', 'A02'], ['A02', 'A03'], ['A03', 'A01'], ['B01', 'B02'], ['B02', 'B03'], ['B03', 'B01']],
  );
export const treeClosure = (): SyntheticNet =>
  makeNet(
    ['T01', 'T02', 'T03', 'T04', 'T05'],
    [['T01', 'T02'], ['T02', 'T03'], ['T03', 'T04'], ['T04', 'T05'], ['T01', 'T05']],
  );

export const asDense = (input: GnssBaselineAdjustInput) => {
  const result = runGnssBaselineAdjustment(input);
  if (result.routeProvenance !== 'typescript-dense' || !('qxx' in result)) {
    throw new Error('expected dense result');
  }
  return result as GnssBaselineDenseAdjustResult;
};

export const fixFirst = (net: SyntheticNet): StationMap => {
  const anchor = [...net.ids].sort()[0] as string;
  return setStationFixed(
    Object.fromEntries(Object.entries(net.stations).map(([id, station]) => [id, { ...station }])),
    anchor,
    true,
  );
};

