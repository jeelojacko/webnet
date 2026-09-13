/**
 * Phase 12I.0 Worker B — free-network performance evidence (§38).
 *
 * Times constrained (production dense normal-equations) vs gauge+S-transform
 * (free candidate) stage by stage — solve+covariance+Phase12D-stats,
 * S-transform, loop QC — on synthetic ring/chord meshes. There is no
 * separate KKT/GINV route in the codebase (production TS solves the dense
 * normal equations; the free method is gauge-fix + S-transform), so KKT-vs-
 * GINV is recorded NOT-APPLICABLE and gauge+S is timed instead.
 *
 * Usage: npx tsx scripts/gnss/gnssFreeNetworkPerfEvidence.ts
 */
import { performance } from 'node:perf_hooks';
import { runGnssBaselineAdjustment } from '../../src/engine/gnssBaselineAdjust';
import { computeGnssLoopClosures } from '../../src/engine/gnssBaselineLoops';
import type { GnssBaselineObservation } from '../../src/engine/gnssBaselineTypes';
import type { StationMap } from '../../src/types';

const BASE = { x: -1280000, y: -4720000, h: 4080000 };
const RADIUS_M = 1000;
const SIGMA_M = 0.003;

/** Ring + i→i+2 + i→i+5 chords: 3n vectors, well-redundant mesh. */
const buildMesh = (n: number): { stations: StationMap; baselines: GnssBaselineObservation[] } => {
  const stations: StationMap = {};
  for (let i = 0; i < n; i += 1) {
    const angle = (2 * Math.PI * i) / n;
    const held = i === 0;
    stations[`P${i}`] = {
      x: BASE.x + RADIUS_M * Math.cos(angle),
      y: BASE.y + RADIUS_M * Math.sin(angle),
      h: BASE.h + 50 * Math.sin(3 * angle),
      fixed: held,
      fixedX: held,
      fixedY: held,
      fixedH: held,
    };
  }
  const iso = {
    xx: SIGMA_M * SIGMA_M, xy: 0, xz: 0,
    yy: SIGMA_M * SIGMA_M, yz: 0, zz: SIGMA_M * SIGMA_M,
  };
  const baselines: GnssBaselineObservation[] = [];
  let id = 1;
  const addEdge = (from: number, to: number): void => {
    const f = stations[`P${from}`];
    const t = stations[`P${to}`];
    if (!f || !t) return;
    baselines.push({
      type: 'gnssBaseline',
      id: id++,
      from: `P${from}`,
      to: `P${to}`,
      vector: { x: t.x - f.x, y: t.y - f.y, z: t.h - f.h },
      covariance: { ...iso },
      frame: 'ecef',
    });
  };
  for (let i = 0; i < n; i += 1) {
    addEdge(i, (i + 1) % n);
    addEdge(i, (i + 2) % n);
    addEdge(i, (i + 5) % n);
  }
  return { stations, baselines };
};

const freeWithAnchor = (stations: StationMap, anchor: string): StationMap =>
  Object.fromEntries(
    Object.entries(stations).map(([stationId, station]) => {
      const held = stationId === anchor;
      return [stationId, { ...station, fixed: held, fixedX: held, fixedY: held, fixedH: held }];
    }),
  );

/** Inner-datum translation (mean-shift removal) timed as the transform stage. */
const sTransformMs = (adjusted: StationMap, apriori: StationMap): { ms: number; shifted: StationMap } => {
  const start = performance.now();
  const names = Object.keys(apriori);
  let mx = 0;
  let my = 0;
  let mh = 0;
  names.forEach((name) => {
    mx += (adjusted[name]?.x ?? 0) - (apriori[name]?.x ?? 0);
    my += (adjusted[name]?.y ?? 0) - (apriori[name]?.y ?? 0);
    mh += (adjusted[name]?.h ?? 0) - (apriori[name]?.h ?? 0);
  });
  mx /= names.length;
  my /= names.length;
  mh /= names.length;
  const shifted: StationMap = {};
  names.forEach((name) => {
    const station = adjusted[name];
    if (station) shifted[name] = { ...station, x: station.x - mx, y: station.y - my, h: station.h - mh };
  });
  return { ms: performance.now() - start, shifted };
};

interface LegRow {
  readonly size: number;
  readonly vectors: number;
  readonly params: number;
  readonly solveConstrainedMs: number;
  readonly solveGaugeMs: number;
  readonly transformMs: number;
  readonly loopMs: number;
  readonly residualParity: number;
  readonly vtPvParity: number;
}

const runLeg = (n: number): LegRow => {
  const { stations, baselines } = buildMesh(n);
  const anchor = `P${n - 1}`;

  const t0 = performance.now();
  const constrained = runGnssBaselineAdjustment({ stations, baselines });
  const solveConstrainedMs = performance.now() - t0;

  const t1 = performance.now();
  const gauge = runGnssBaselineAdjustment({
    stations: freeWithAnchor(stations, anchor),
    baselines,
  });
  const solveGaugeMs = performance.now() - t1;

  const { ms: transformMs } = sTransformMs(gauge.stations, stations);

  const t2 = performance.now();
  computeGnssLoopClosures(baselines);
  const loopMs = performance.now() - t2;

  if (!('qxx' in constrained) || !('qxx' in gauge)) throw new Error('Expected dense qxx.');
  let residualParity = 0;
  constrained.residuals.forEach((residual, index) => {
    const other = gauge.residuals[index];
    if (!other) throw new Error('Residual count mismatch.');
    residualParity = Math.max(
      residualParity,
      Math.abs(residual.vX - other.vX),
      Math.abs(residual.vY - other.vY),
      Math.abs(residual.vZ - other.vZ),
    );
  });
  const vtPvParity =
    Math.abs(constrained.weightedResidualSum - gauge.weightedResidualSum)
    / Math.max(1, Math.abs(constrained.weightedResidualSum));
  if (residualParity > 1e-9 || vtPvParity > 1e-9) {
    throw new Error(
      `Free-vs-constrained parity failed at n=${n}: ` +
        `residual=${residualParity.toExponential(2)} vTPv=${vtPvParity.toExponential(2)}.`,
    );
  }
  return {
    size: n,
    vectors: baselines.length,
    params: constrained.numParams,
    solveConstrainedMs,
    solveGaugeMs,
    transformMs,
    loopMs,
    residualParity,
    vtPvParity,
  };
};

const main = (): void => {
  const rows: LegRow[] = [];
  const skipped: string[] = [];
  const sizes = [10, 50, 100, 250];
  const wallStart = performance.now();
  sizes.forEach((n) => {
    rows.push(runLeg(n));
  });
  const elapsed250 = performance.now() - wallStart;
  if (elapsed250 < 10000 && performance.now() - wallStart < 50000) {
    rows.push(runLeg(500));
  } else {
    skipped.push(`500 NOT-RUN (250-station leg already took ${(elapsed250 / 1000).toFixed(1)}s)`);
  }
  console.log('| stations | vectors | params | solve-constrained ms | solve-gauge ms | S-transform ms | loop-QC ms | max|dv| m | vTPv rel |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  rows.forEach((row) => {
    console.log(
      `| ${row.size} | ${row.vectors} | ${row.params} | ${row.solveConstrainedMs.toFixed(1)} | ` +
        `${row.solveGaugeMs.toFixed(1)} | ${row.transformMs.toFixed(2)} | ${row.loopMs.toFixed(1)} | ` +
        `${row.residualParity.toExponential(2)} | ${row.vtPvParity.toExponential(2)} |`,
    );
  });
  console.log('KKT-vs-GINV: NOT-APPLICABLE (no separate KKT/GINV route; production TS = dense normal equations, free = gauge-fix + S-transform).');
  skipped.forEach((note) => console.log(note));
};

main();
