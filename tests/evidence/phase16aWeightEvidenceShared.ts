/**
 * Phase 16A evidence shared helpers (EVIDENCE ONLY — no production imports beyond
 * existing engine entry points; no production behavior changes).
 *
 * Synthetic networks assembled through the real production row-appenders
 * (assembleAdjustmentEquations + real GPS/TS-correlation/constraint writers)
 * with stub station geometry. Row counts (m) are exact by construction; the
 * weight-matrix structure (diagonal / 2x2 GPS / 3x3 GPS / TS groups /
 * constraint rows) comes from production writers, not hand-built matrices.
 */
import { assembleAdjustmentEquations } from '../../src/engine/adjustmentEquationAssembly';
import type { AdjustmentEquationAssemblyDependencies } from '../../src/engine/adjustmentEquationAssemblyTypes';
import type { CoordinateConstraintEquation, EquationRowInfo } from '../../src/engine/adjustmentSolveTypes';
import { buildCoordinateConstraints } from '../../src/engine/adjustmentConstraints';
import { zeros } from '../../src/engine/matrixBasic';
import type { SparseMatrixRows } from '../../src/engine/matrix';
import {
  applyTsCorrelationToWeightMatrix as applyTsMatrix,
  applyTsCorrelationToWeightWriter as applyTsWriter,
  tsCorrelationGroup,
} from '../../src/engine/adjustTsCorrelationWeights';
import type { Observation, StationId, StationMap } from '../../src/types';

export interface BuiltNetwork {
  id: string;
  kind: string;
  deps: AdjustmentEquationAssemblyDependencies;
  observations: Observation[];
  constraints: CoordinateConstraintEquation[];
  numObsEquations: number;
  numParams: number;
  /** Expected TS group count (0 when TS correlation is off). */
  expectedTsGroups: number;
  orientationParams: number;
  /** TS correlation scope used by this network (default 'set'). */
  tsScope: 'set' | 'setup';
}

interface DepsOptions {
  paramIndex: AdjustmentEquationAssemblyDependencies['paramIndex'];
  dirParamMap: Record<string, number>;
  stations: StationMap;
  is2D: boolean;
  sigma: number;
  tsRho: number;
  tsScope?: 'set' | 'setup';
  gpsCorrelated: boolean;
}

export const makeDeps = (options: DepsOptions): AdjustmentEquationAssemblyDependencies => {
  const effectiveStdDev = () => options.sigma;
  const scope = options.tsScope ?? 'set';
  const groupFor = (obs: Observation) =>
    tsCorrelationGroup({ enabled: options.tsRho > 0, obs, scope });
  return {
    stations: options.stations,
    paramIndex: options.paramIndex,
    is2D: options.is2D,
    debug: false,
    directionOrientations: {},
    dirParamMap: options.dirParamMap,
    effectiveStdDev,
    correctedDistanceModel: (_obs, calcDistRaw) => ({
      calcDistance: calcDistRaw,
      mapScale: 1,
      prismCorrection: 0,
    }),
    getObservedHorizontalDistanceIn2D: () => ({
      observedDistance: 12,
      sigmaDistance: options.sigma,
      usedZenith: false,
    }),
    getAzimuth: () => ({ az: 0.3, dist: 10 }),
    measuredAngleCorrection: () => 0,
    modeledAzimuth: (rawAz) => rawAz,
    wrapToPi: (value) => value,
    gpsObservedVector: () => ({ dE: 1, dN: 2, dU: 3, scale: 1 }),
    gpsModeledVector: () => ({ dE: 0.9, dN: 1.9, dU: 2.9, scale: 1 }),
    gpsModeledVectorDerivatives: () => ({ from: {}, to: {} }),
    gpsWeight: () =>
      options.gpsCorrelated
        ? { wEE: 4, wNN: 9, wEN: 1.5, wUU: 16, wEU: 0.75, wNU: -0.5 }
        : { wEE: 4, wNN: 9, wEN: 0, wUU: 16, wEU: 0, wNU: 0 },
    getModeledZenith: () => ({ z: 0, dist: 1, horiz: 1, dh: 0, crCorr: 0, horizontalScale: 1 }),
    curvatureRefractionAngle: () => 0,
    applyTsCorrelationToWeightMatrix: (matrix, rowInfo) => {
      applyTsMatrix({
        captureDiagnostics: false,
        effectiveStdDev,
        enabled: options.tsRho > 0,
        matrix,
        rho: options.tsRho,
        rowInfo,
        scope,
        tsCorrelationGroup: groupFor,
      });
    },
    applyTsCorrelationToWeightWriter: (weights, rowInfo) => {
      applyTsWriter({
        captureDiagnostics: false,
        effectiveStdDev,
        enabled: options.tsRho > 0,
        weights,
        rho: options.tsRho,
        rowInfo,
        scope,
        tsCorrelationGroup: groupFor,
      });
    },
  };
};

const chainStations = (unknowns: number, threeD: boolean): { stations: StationMap; ids: string[] } => {
  const stations: StationMap = {
    C0: { x: 0, y: 0, h: 0, fixed: true, fixedX: true, fixedY: true, fixedH: true },
  };
  const ids: string[] = ['C0'];
  for (let i = 1; i <= unknowns; i += 1) {
    const id = `U${i}`;
    ids.push(id);
    stations[id] = {
      x: i * 10,
      y: i * 2,
      h: threeD ? i : 0,
      fixed: false,
      fixedX: false,
      fixedY: false,
      fixedH: false,
    };
  }
  return { stations, ids };
};

let obsId = 1;
const nextId = (): number => {
  obsId += 1;
  return obsId;
};

/** 2D chain: dist + bearing per unknown link (2 rows per unknown, all scalar). */
export const buildChain2D = (id: string, unknowns: number): BuiltNetwork => {
  const { stations, ids } = chainStations(unknowns, false);
  const paramIndex: AdjustmentEquationAssemblyDependencies['paramIndex'] = {};
  let p = 0;
  for (let i = 1; i <= unknowns; i += 1) {
    paramIndex[`U${i}` as StationId] = { x: p, y: p + 1 };
    p += 2;
  }
  const observations: Observation[] = [];
  for (let i = 1; i <= unknowns; i += 1) {
    const from = ids[i - 1] as string;
    const to = ids[i] as string;
    observations.push({
      id: nextId(), type: 'dist', subtype: 'ts', from, to, obs: 12, mode: 'horiz', instCode: 'S9', stdDev: 0.005,
    } as Observation);
    observations.push({ id: nextId(), type: 'bearing', from, to, obs: 0.3, instCode: 'S9', stdDev: 0.001 } as Observation);
  }
  return {
    id, kind: 'chain-2d/scalar', deps: makeDeps({ paramIndex, dirParamMap: {}, stations, is2D: true, sigma: 0.005, tsRho: 0, gpsCorrelated: false }),
    observations, constraints: [], numObsEquations: observations.length, numParams: p, expectedTsGroups: 0, orientationParams: 0, tsScope: 'set',
  };
};

/** GPS 2D: one 2-row baseline per unknown with EN correlation (2x2 blocks). */
export const buildGps2D = (id: string, unknowns: number): BuiltNetwork => {
  const { stations, ids } = chainStations(unknowns, false);
  const paramIndex: AdjustmentEquationAssemblyDependencies['paramIndex'] = {};
  let p = 0;
  for (let i = 1; i <= unknowns; i += 1) {
    paramIndex[`U${i}` as StationId] = { x: p, y: p + 1 };
    p += 2;
  }
  const observations: Observation[] = [];
  for (let i = 1; i <= unknowns; i += 1) {
    observations.push({
      id: nextId(), type: 'gps', from: 'C0', to: ids[i] as string,
      obs: { dE: 10 * i, dN: 2 * i }, instCode: 'GPS', stdDev: 0.01,
    } as Observation);
  }
  return {
    id, kind: 'gps-2d/2x2', deps: makeDeps({ paramIndex, dirParamMap: {}, stations, is2D: true, sigma: 0.01, tsRho: 0, gpsCorrelated: true }),
    observations, constraints: [], numObsEquations: unknowns * 2, numParams: p, expectedTsGroups: 0, orientationParams: 0, tsScope: 'set',
  };
};

/** GPS 3D: one 3-row baseline per unknown with full EU/NU/EN correlation (3x3 blocks). */
export const buildGps3D = (id: string, unknowns: number): BuiltNetwork => {
  const { stations, ids } = chainStations(unknowns, true);
  const paramIndex: AdjustmentEquationAssemblyDependencies['paramIndex'] = {};
  let p = 0;
  for (let i = 1; i <= unknowns; i += 1) {
    paramIndex[`U${i}` as StationId] = { x: p, y: p + 1, h: p + 2 };
    p += 3;
  }
  const observations: Observation[] = [];
  for (let i = 1; i <= unknowns; i += 1) {
    observations.push({
      id: nextId(), type: 'gps', from: 'C0', to: ids[i] as string,
      obs: { dE: 10 * i, dN: 2 * i, dU: i }, instCode: 'GPS', stdDev: 0.01,
    } as Observation);
  }
  return {
    id, kind: 'gps-3d/3x3', deps: makeDeps({ paramIndex, dirParamMap: {}, stations, is2D: false, sigma: 0.01, tsRho: 0, gpsCorrelated: true }),
    observations, constraints: [], numObsEquations: unknowns * 3, numParams: p, expectedTsGroups: 0, orientationParams: 0, tsScope: 'set',
  };
};

/** TS-correlated direction sets: setsCount sets x perSet directions, rho 0.5, scope set. */
export const buildTsDirections = (id: string, setsCount: number, perSet: number): BuiltNetwork => {
  const stations: StationMap = {
    AT: { x: 0, y: 0, h: 0, fixed: true, fixedX: true, fixedY: true, fixedH: true },
  };
  const paramIndex: AdjustmentEquationAssemblyDependencies['paramIndex'] = {};
  const dirParamMap: Record<string, number> = {};
  let p = 0;
  const targets: string[] = [];
  for (let s = 0; s < setsCount; s += 1) {
    for (let k = 0; k < perSet; k += 1) {
      const target = `T${s}_${k}`;
      targets.push(target);
      stations[target] = { x: 10 + k, y: 5 * s + k, h: 0, fixed: false, fixedX: false, fixedY: false, fixedH: true };
      paramIndex[target as StationId] = { x: p, y: p + 1 };
      p += 2;
    }
    dirParamMap[`SET${s}`] = p;
    p += 1;
  }
  const observations: Observation[] = [];
  targets.forEach((target, index) => {
    const set = Math.floor(index / perSet);
    observations.push({
      id: nextId(), type: 'direction', setId: `SET${set}`, at: 'AT', to: target,
      obs: 0.1 + 0.01 * index, instCode: 'S9', stdDev: 0.001,
    } as Observation);
  });
  return {
    id, kind: 'ts-directions/correlated', deps: makeDeps({ paramIndex, dirParamMap, stations, is2D: true, sigma: 0.001, tsRho: 0.5, gpsCorrelated: false }),
    observations, constraints: [], numObsEquations: observations.length, numParams: p,
    expectedTsGroups: setsCount, orientationParams: setsCount, tsScope: 'set',
  };
};

/** Weighted controls: chain-2D plus tight x/y constraints on every 4th unknown. */
export const buildWeightedControls = (id: string, unknowns: number): BuiltNetwork => {
  const base = buildChain2D(id, unknowns);
  const constraints: CoordinateConstraintEquation[] = [];
  const paramIndex = base.deps.paramIndex;
  for (let i = 4; i <= unknowns; i += 4) {
    const stationId = `U${i}`;
    const entry = paramIndex[stationId as StationId];
    if (entry?.x != null) {
      constraints.push({ stationId: stationId as StationId, component: 'x', index: entry.x, target: i * 10, sigma: 0.002 });
    }
    if (entry?.y != null) {
      constraints.push({ stationId: stationId as StationId, component: 'y', index: entry.y, target: i * 2, sigma: 0.002 });
    }
  }
  return {
    ...base, id, kind: 'chain-2d/weighted-controls', constraints,
    numObsEquations: base.observations.length + constraints.length,
  };
};

/** Mixed: dist + GPS-2D + TS directions + constraints in one system. */
export const buildMixed = (id: string): BuiltNetwork => {
  const chain = buildChain2D('x', 8);
  const gps = buildGps2D('x', 4);
  const ts = buildTsDirections('x', 2, 4);
  const stations: StationMap = { ...chain.deps.stations };
  Object.assign(stations, { G0: { x: 0, y: 0, h: 0, fixed: true, fixedX: true, fixedY: true, fixedH: true } });
  let p = chain.numParams;
  const paramIndex: AdjustmentEquationAssemblyDependencies['paramIndex'] = { ...chain.deps.paramIndex };
  const gpsRemap = new Map<string, string>();
  for (let i = 1; i <= 4; i += 1) {
    const alias = `G${i}`;
    gpsRemap.set(`U${i}`, alias);
    stations[alias] = { x: 50 + i * 10, y: i, h: 0, fixed: false, fixedX: false, fixedY: false, fixedH: true };
    paramIndex[alias as StationId] = { x: p, y: p + 1 };
    p += 2;
  }
  const dirRemap = new Map<string, string>();
  const dirParamMap: Record<string, number> = {};
  const tsTargets = new Set<string>();
  ts.observations.forEach((obs) => {
    if (obs.type === 'direction') tsTargets.add(obs.to);
  });
  tsTargets.forEach((target) => {
    const alias = `M_${target}`;
    dirRemap.set(target, alias);
    const source = ts.deps.stations[target];
    if (source) stations[alias] = { ...source };
    const entry = ts.deps.paramIndex[target as StationId];
    if (entry?.x != null && entry?.y != null) {
      paramIndex[alias as StationId] = { x: p, y: p + 1 };
      p += 2;
    }
  });
  Object.keys(ts.deps.dirParamMap).forEach((setId) => {
    dirParamMap[`M_${setId}`] = p;
    p += 1;
  });
  Object.assign(stations, { MAT: { x: 0, y: 0, h: 0, fixed: true, fixedX: true, fixedY: true, fixedH: true } });
  const observations: Observation[] = [...chain.observations];
  gps.observations.forEach((obs) => {
    if (obs.type !== 'gps') return;
    const to = gpsRemap.get(obs.to) ?? obs.to;
    observations.push({ ...obs, id: nextId(), to } as Observation);
  });
  ts.observations.forEach((obs) => {
    if (obs.type !== 'direction') return;
    observations.push({
      ...obs, id: nextId(), setId: `M_${obs.setId}`, at: 'MAT', to: dirRemap.get(obs.to) ?? obs.to,
    } as Observation);
  });
  const constraints: CoordinateConstraintEquation[] = [
    { stationId: 'U4' as StationId, component: 'x', index: paramIndex['U4' as StationId]?.x ?? 0, target: 40, sigma: 0.002 },
  ];
  const deps = makeDeps({ paramIndex, dirParamMap, stations, is2D: true, sigma: 0.005, tsRho: 0.5, gpsCorrelated: true });
  return {
    id, kind: 'mixed/scalar+2x2+ts+control', deps, observations, constraints,
    numObsEquations: chain.observations.length + 2 * gps.observations.length + ts.observations.length + constraints.length,
    numParams: p,
    expectedTsGroups: 2, orientationParams: 2, tsScope: 'set',
  };
};

/** GNSS baselines: one 3-row observation with a full correlated 3x3 block (P = C^-1). */
export const buildGnssBaseline = (id: string, count: number): BuiltNetwork => {
  const stations: StationMap = {
    C0: { x: 0, y: 0, h: 0, fixed: true, fixedX: true, fixedY: true, fixedH: true },
  };
  const paramIndex: AdjustmentEquationAssemblyDependencies['paramIndex'] = {};
  let p = 0;
  for (let i = 1; i <= count; i += 1) {
    stations[`U${i}`] = { x: 1000 * i, y: 200 * i, h: 10 * i, fixed: false, fixedX: false, fixedY: false, fixedH: false };
    paramIndex[`U${i}` as StationId] = { x: p, y: p + 1, h: p + 2 };
    p += 3;
  }
  const observations: Observation[] = [];
  for (let i = 1; i <= count; i += 1) {
    observations.push({
      id: nextId(), type: 'gnssBaseline', from: 'C0', to: `U${i}`,
      vector: { x: 1000 * i + 1, y: 200 * i + 2, z: 10 * i + 0.5 },
      covariance: { xx: 4e-6, xy: 1e-6, xz: 0.5e-6, yy: 5e-6, yz: -1e-6, zz: 9e-6 },
      frame: 'ecef',
    } as unknown as Observation);
  }
  return {
    id, kind: 'gnss-baseline/3x3', deps: makeDeps({ paramIndex, dirParamMap: {}, stations, is2D: false, sigma: 0.002, tsRho: 0, gpsCorrelated: false }),
    observations, constraints: [], numObsEquations: count * 3, numParams: p, expectedTsGroups: 0, orientationParams: 0, tsScope: 'set',
  };
};

/** Correlated XY controls: production buildCoordinateConstraints with corrXY (2x2 control blocks). */
export const buildCorrelatedControls = (id: string, unknowns: number): BuiltNetwork => {
  const chain = buildChain2D('x', unknowns);
  const stations: StationMap = { ...chain.deps.stations };
  for (let i = 4; i <= unknowns; i += 4) {
    const stationId = `U${i}`;
    const current = stations[stationId];
    if (current) {
      stations[stationId] = {
        ...current, sx: 0.002, sy: 0.003, constraintX: i * 10, constraintY: i * 2, constraintCorrXY: 0.5,
      };
    }
  }
  const constraints = buildCoordinateConstraints(stations, chain.deps.paramIndex, true);
  const deps = makeDeps({
    paramIndex: chain.deps.paramIndex, dirParamMap: {}, stations,
    is2D: true, sigma: 0.005, tsRho: 0, gpsCorrelated: false,
  });
  return {
    id, kind: 'chain-2d/correlated-controls', deps,
    observations: chain.observations, constraints,
    numObsEquations: chain.observations.length + constraints.length, numParams: chain.numParams,
    expectedTsGroups: 0, orientationParams: 0, tsScope: 'set',
  };
};

/** Setup-scope TS: distinct direction sets at one station merge into a single group. */
export const buildTsSetupScope = (id: string, setsCount: number, perSet: number): BuiltNetwork => {
  const base = buildTsDirections('x', setsCount, perSet);
  const fixedStations: StationMap = { ...base.deps.stations };
  Object.keys(fixedStations).forEach((stationId) => {
    if (stationId !== 'AT') {
      const current = fixedStations[stationId];
      if (current) fixedStations[stationId] = { ...current, fixed: true, fixedX: true, fixedY: true, fixedH: true };
    }
  });
  const dirParamMap: Record<string, number> = {};
  for (let s = 0; s < setsCount; s += 1) dirParamMap[`SET${s}`] = s;
  const deps = makeDeps({
    paramIndex: {}, dirParamMap, stations: fixedStations,
    is2D: true, sigma: 0.001, tsRho: 0.5, tsScope: 'setup', gpsCorrelated: false,
  });
  return {
    id, kind: 'ts-directions/setup-scope', deps,
    observations: base.observations, constraints: [],
    numObsEquations: base.observations.length, numParams: setsCount,
    expectedTsGroups: 1, orientationParams: setsCount, tsScope: 'setup',
  };
};

/** Angle TS case (setup scope): 8 angles at one station share one group. */
export const buildTsAnglesBearings = (id: string): BuiltNetwork => {
  const stations: StationMap = {
    AT: { x: 0, y: 0, h: 0, fixed: true, fixedX: true, fixedY: true, fixedH: true },
  };
  const paramIndex: AdjustmentEquationAssemblyDependencies['paramIndex'] = {};
  let p = 0;
  for (let i = 1; i <= 3; i += 1) {
    stations[`T${i}`] = { x: 10 * i, y: 5 * i, h: 0, fixed: false, fixedX: false, fixedY: false, fixedH: true };
    paramIndex[`T${i}` as StationId] = { x: p, y: p + 1 };
    p += 2;
  }
  const observations: Observation[] = [];
  const triples: Array<[string, string]> = [['T1', 'T2'], ['T2', 'T3'], ['T1', 'T3'], ['T2', 'T1']];
  triples.forEach(([from, to], index) => {
    observations.push({
      id: nextId(), type: 'angle', at: 'AT', from, to, obs: 0.5 + 0.1 * index, instCode: 'S9', stdDev: 0.001,
    } as Observation);
    observations.push({
      id: nextId(), type: 'angle', at: 'AT', from: to, to: from, obs: 0.6 + 0.1 * index, instCode: 'S9', stdDev: 0.001,
    } as Observation);
  });
  return {
    id, kind: 'ts-angles/setup-scope', deps: makeDeps({
      paramIndex, dirParamMap: {}, stations, is2D: true, sigma: 0.001, tsRho: 0.5, tsScope: 'setup', gpsCorrelated: false,
    }),
    observations, constraints: [], numObsEquations: observations.length, numParams: p,
    expectedTsGroups: 1, orientationParams: 0, tsScope: 'setup',
  };
};

/** Set-scope TS with fixed targets: overdetermined (m = sets*perSet, n = sets). */
export const buildTsDirectionsFixedTargets = (id: string, setsCount: number, perSet: number): BuiltNetwork => {
  const base = buildTsSetupScope('x', setsCount, perSet);
  const dirParamMap: Record<string, number> = {};
  for (let s = 0; s < setsCount; s += 1) dirParamMap[`SET${s}`] = s;
  const deps = makeDeps({
    paramIndex: {}, dirParamMap, stations: base.deps.stations,
    is2D: true, sigma: 0.001, tsRho: 0.5, tsScope: 'set', gpsCorrelated: false,
  });
  return {
    id, kind: 'ts-directions/fixed-targets', deps,
    observations: base.observations, constraints: [],
    numObsEquations: base.observations.length, numParams: setsCount,
    expectedTsGroups: setsCount, orientationParams: setsCount, tsScope: 'set',
  };
};

/** Overdetermined mixed system: chain-8 + GPS-4 + fixed-target TS + full controls. */
export const buildMixedOverdetermined = (id: string): BuiltNetwork => {
  const stations: StationMap = {
    C0: { x: 0, y: 0, h: 0, fixed: true, fixedX: true, fixedY: true, fixedH: true },
    G0: { x: 0, y: 0, h: 0, fixed: true, fixedX: true, fixedY: true, fixedH: true },
    MAT: { x: 0, y: 0, h: 0, fixed: true, fixedX: true, fixedY: true, fixedH: true },
  };
  const paramIndex: AdjustmentEquationAssemblyDependencies['paramIndex'] = {};
  let p = 0;
  for (let i = 1; i <= 8; i += 1) {
    stations[`U${i}`] = { x: 10 * i, y: 2 * i, h: 0, fixed: false, fixedX: false, fixedY: false, fixedH: true };
    paramIndex[`U${i}` as StationId] = { x: p, y: p + 1 };
    p += 2;
  }
  for (let i = 1; i <= 4; i += 1) {
    stations[`G${i}`] = { x: 50 + 10 * i, y: i, h: 0, fixed: false, fixedX: false, fixedY: false, fixedH: true };
    paramIndex[`G${i}` as StationId] = { x: p, y: p + 1 };
    p += 2;
  }
  const dirParamMap: Record<string, number> = {};
  for (let s = 0; s < 2; s += 1) {
    for (let k = 0; k < 4; k += 1) {
      stations[`FT${s}_${k}`] = { x: 10 + k, y: 5 * s + k, h: 0, fixed: true, fixedX: true, fixedY: true, fixedH: true };
    }
    dirParamMap[`MSET${s}`] = p;
    p += 1;
  }
  const observations: Observation[] = [];
  for (let i = 1; i <= 8; i += 1) {
    const from = i === 1 ? 'C0' : `U${i - 1}`;
    observations.push({
      id: nextId(), type: 'dist', subtype: 'ts', from, to: `U${i}`, obs: 12, mode: 'horiz', instCode: 'S9', stdDev: 0.005,
    } as Observation);
    observations.push({ id: nextId(), type: 'bearing', from, to: `U${i}`, obs: 0.3, instCode: 'S9', stdDev: 0.001 } as Observation);
  }
  for (let i = 1; i <= 4; i += 1) {
    observations.push({
      id: nextId(), type: 'gps', from: 'G0', to: `G${i}`,
      obs: { dE: 10 * i, dN: 2 * i }, instCode: 'GPS', stdDev: 0.01,
    } as Observation);
  }
  for (let s = 0; s < 2; s += 1) {
    for (let k = 0; k < 4; k += 1) {
      observations.push({
        id: nextId(), type: 'direction', setId: `MSET${s}`, at: 'MAT', to: `FT${s}_${k}`,
        obs: 0.1 + 0.01 * (s * 4 + k), instCode: 'S9', stdDev: 0.001,
      } as Observation);
    }
  }
  const constraints: CoordinateConstraintEquation[] = [];
  for (let i = 1; i <= 8; i += 1) {
    const entry = paramIndex[`U${i}` as StationId];
    if (entry?.x != null) constraints.push({ stationId: `U${i}` as StationId, component: 'x', index: entry.x, target: 10 * i, sigma: 0.002 });
    if (entry?.y != null) constraints.push({ stationId: `U${i}` as StationId, component: 'y', index: entry.y, target: 2 * i, sigma: 0.002 });
  }
  for (let i = 1; i <= 4; i += 1) {
    const entry = paramIndex[`G${i}` as StationId];
    if (entry?.x != null) constraints.push({ stationId: `G${i}` as StationId, component: 'x', index: entry.x, target: 50 + 10 * i, sigma: 0.002 });
    if (entry?.y != null) constraints.push({ stationId: `G${i}` as StationId, component: 'y', index: entry.y, target: i, sigma: 0.002 });
  }
  const deps = makeDeps({ paramIndex, dirParamMap, stations, is2D: true, sigma: 0.005, tsRho: 0.5, gpsCorrelated: true });
  return {
    id, kind: 'mixed/overdetermined', deps, observations, constraints,
    numObsEquations: 16 + 8 + 8 + constraints.length, numParams: p,
    expectedTsGroups: 2, orientationParams: 2, tsScope: 'set',
  };
};

export interface WeightStats {
  m: number;
  nonzero: number;
  density: number;
  scalarRows: number;
  blocks2: number;
  blocks3: number;
  bigGroups: number;
  bigGroupSizes: number[];
  constraintRows: number;
  offPairs: number;
}

/** Connected components of the off-diagonal adjacency graph (exact-nonzero). */
export const summarizeWeights = (P: number[][], rowInfo: EquationRowInfo[]): WeightStats => {
  const m = P.length;
  const adjacent: Set<number>[] = Array.from({ length: m }, () => new Set<number>());
  let nonzero = 0;
  let offPairs = 0;
  for (let i = 0; i < m; i += 1) {
    for (let j = 0; j < m; j += 1) {
      if ((P[i]?.[j] ?? 0) !== 0) nonzero += 1;
    }
    for (let j = i + 1; j < m; j += 1) {
      if ((P[i]?.[j] ?? 0) !== 0) {
        offPairs += 1;
        adjacent[i]?.add(j);
        adjacent[j]?.add(i);
      }
    }
  }
  const seen = new Array<boolean>(m).fill(false);
  let scalarRows = 0;
  let blocks2 = 0;
  let blocks3 = 0;
  let bigGroups = 0;
  const bigGroupSizes: number[] = [];
  for (let i = 0; i < m; i += 1) {
    if (seen[i]) continue;
    const stack = [i];
    seen[i] = true;
    let size = 0;
    while (stack.length > 0) {
      const current = stack.pop() as number;
      size += 1;
      adjacent[current]?.forEach((next) => {
        if (!seen[next]) {
          seen[next] = true;
          stack.push(next);
        }
      });
    }
    if (size === 1) scalarRows += 1;
    else if (size === 2) blocks2 += 1;
    else if (size === 3) blocks3 += 1;
    else {
      bigGroups += 1;
      bigGroupSizes.push(size);
    }
  }
  return {
    m, nonzero, density: m === 0 ? 0 : nonzero / (m * m),
    scalarRows, blocks2, blocks3, bigGroups, bigGroupSizes,
    constraintRows: rowInfo.filter((info) => info == null).length, offPairs,
  };
};

export const assembleBoth = (network: BuiltNetwork) => {
  const dense = assembleAdjustmentEquations(
    network.deps, network.observations, network.constraints,
    network.numObsEquations, network.numParams,
  );
  const sparse = assembleAdjustmentEquations(
    network.deps, network.observations, network.constraints,
    network.numObsEquations, network.numParams, undefined,
    { weightRepresentation: 'sparse' },
  );
  if (!dense.P) throw new Error(`Dense assembly produced no P for ${network.id}.`);
  if (!sparse.structuredWeights) throw new Error(`Sparse assembly produced no structured weights for ${network.id}.`);
  return { dense, sparse };
};

const sorted = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);

export const median = (xs: number[]): number => sorted(xs)[Math.floor(xs.length / 2)] ?? 0;

/** 1 warm-up + `runs` measured invocations; returns the median wall time in ms. */
export const medianWallMs = (runs: number, fn: () => void): number => {
  fn();
  const walls: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    fn();
    walls.push(performance.now() - started);
  }
  return median(walls);
};

export const round4 = (value: number): number => Math.round(value * 10000) / 10000;

export const heapDeltaMb = (fn: () => void): number => {
  if (typeof globalThis.gc === 'function') (globalThis.gc as () => void)();
  const before = process.memoryUsage().heapUsed;
  fn();
  if (typeof globalThis.gc === 'function') (globalThis.gc as () => void)();
  return (process.memoryUsage().heapUsed - before) / 1048576;
};

/**
 * Structured accumulation prototype (shared so sparsity timing and parity use
 * one implementation): scalar N += w_i a_i'a_i, then per-triplet block
 * N += w_ij (a_i'a_j + a_j'a_i); rhs b analogously.
 */
export const protoAccumulate = (
  rows: SparseMatrixRows,
  L: number[][],
  weights: { size: number; diagonal: ArrayLike<number>; offRows: ArrayLike<number>; offColumns: ArrayLike<number>; offValues: ArrayLike<number> },
  numParams: number,
): { normal: number[][]; rhs: number[][] } => {
  const normal = zeros(numParams, numParams);
  const rhs = zeros(numParams, 1);
  const m = weights.size;
  for (let i = 0; i < m; i += 1) {
    const w = weights.diagonal[i] ?? 0;
    if (w === 0) continue;
    const entries = rows[i] ?? [];
    const li = L[i]?.[0] ?? 0;
    for (let a = 0; a < entries.length; a += 1) {
      const left = entries[a]!;
      rhs[left.index]![0] += left.value * w * li;
      for (let b = a; b < entries.length; b += 1) {
        const right = entries[b]!;
        const contribution = left.value * w * right.value;
        normal[left.index]![right.index]! += contribution;
        if (left.index !== right.index) normal[right.index]![left.index]! += contribution;
      }
    }
  }
  for (let k = 0; k < weights.offValues.length; k += 1) {
    const i = weights.offRows[k] as number;
    const j = weights.offColumns[k] as number;
    const w = weights.offValues[k] as number;
    const entriesI = rows[i] ?? [];
    const entriesJ = rows[j] ?? [];
    const li = L[i]?.[0] ?? 0;
    const lj = L[j]?.[0] ?? 0;
    for (const left of entriesI) {
      rhs[left.index]![0] += left.value * w * lj;
      for (const right of entriesJ) {
        const contribution = left.value * w * right.value;
        normal[left.index]![right.index]! += contribution;
        normal[right.index]![left.index]! += contribution;
      }
    }
    for (const right of entriesJ) {
      rhs[right.index]![0] += right.value * w * li;
    }
  }
  return { normal, rhs };
};

/** Independent in-test v'Pv from structured triplets. */
export const protoQuadraticForm = (
  weights: { size: number; diagonal: ArrayLike<number>; offRows: ArrayLike<number>; offColumns: ArrayLike<number>; offValues: ArrayLike<number> },
  v: number[][],
): number => {
  let sum = 0;
  for (let i = 0; i < weights.size; i += 1) {
    const vi = v[i]?.[0] ?? 0;
    sum += (weights.diagonal[i] ?? 0) * vi * vi;
  }
  for (let k = 0; k < weights.offValues.length; k += 1) {
    const i = weights.offRows[k] as number;
    const j = weights.offColumns[k] as number;
    sum += 2 * (weights.offValues[k] ?? 0) * (v[i]?.[0] ?? 0) * (v[j]?.[0] ?? 0);
  }
  return sum;
};

export const maxDiff = (actual: number[][], expected: number[][]): { maxAbs: number; maxRel: number } => {
  let maxAbs = 0;
  let refMax = 0;
  for (let i = 0; i < expected.length; i += 1) {
    for (let j = 0; j < (expected[i]?.length ?? 0); j += 1) {
      const ref = expected[i]?.[j] ?? 0;
      const diff = Math.abs((actual[i]?.[j] ?? 0) - ref);
      if (diff > maxAbs) maxAbs = diff;
      if (Math.abs(ref) > refMax) refMax = Math.abs(ref);
    }
  }
  return { maxAbs, maxRel: refMax === 0 ? maxAbs : maxAbs / refMax };
};
