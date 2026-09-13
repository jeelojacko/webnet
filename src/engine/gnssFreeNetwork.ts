/**
 * Phase 12I.1 — production TS-only temporary-gauge + inner-constraint
 * S-transform for free-network static GNSS.
 *
 * Explicit opt-in only: `GnssBaselineAdjustInput.datumMode = 'allow-free'`
 * with at least one connected component lacking real fixed XYZ control.
 * Default `'constrained'` behavior is untouched (see gnssBaselineAdjust).
 *
 * Method (12I.0 evidence oracles, productionized):
 * - classify each baseline-connected component AFTER source composition +
 *   project control overrides: >= 1 fully fixed XYZ station = constrained,
 *   else free. No partial XYZ is representable.
 * - per free component a deterministic computational gauge anchor (first
 *   station ID in canonical exact-ID sort, independent of manifest order)
 *   is held at its a-priori in a working copy; the existing dense
 *   constrained solve runs unmodified on that copy (setup uncertainty
 *   already folded into the effective covariances BEFORE gauging).
 * - the gauge solution is S-transformed to the inner datum per free
 *   component: final coords = a-priori + (gauge correction - per-axis
 *   component mean), so the anchor moves and the correction sums are
 *   zero-mean. Covariance: anchor zero-embedded, then
 *   Q_free = S Q_gauge S' with S = I - (1/m) 11' (x) I3 applied blockwise
 *   O(p^2) — no dense S is ever formed, no extra O(p^3).
 *
 * The anchor is internal working state only: it is never marked
 * FIXED/CONTROL, never leaks into provenance, and is labelled only in
 * optional debug log lines as a computational gauge.
 */
import type { StationMap } from '../types';
import type { GnssBaselineObservation } from './gnssBaselineTypes';
import type { SolveParameterIndex } from './adjustmentSolveTypes';
import { buildSolveParameterIndex } from './adjustmentPreprocessing';
import { gnssBaselineComponents } from './gnssBaselinePreflight';

/** Explicit datum opt-in. Absent input means 'constrained'. */
export type GnssDatumMode = 'constrained' | 'allow-free';

/** Distinct production error when the gauged system is still rank-deficient. */
export const GNSS_FREE_EXTRA_RANK_DEFECT = 'GNSS_FREE_EXTRA_RANK_DEFECT';

/** Distinct production error when the network exceeds the certified free size. */
export const GNSS_FREE_NETWORK_SIZE_LIMIT = 'FREE_NETWORK_SIZE_LIMIT';

/**
 * Certified free-network size cap (total stations). Conservative bound for
 * the TS-dense inner-constraint path (500-station rings cost ~8 s in the
 * dense Cholesky, so the cap stays at 250 for agent-tier viability);
 * over-cap throws fail-closed, never silently falls back. Benchmark table
 * lives in the 12I.1 batch report.
 */
export const GNSS_FREE_NETWORK_MAX_STATIONS = 250;

export interface GnssDatumComponentInfo {
  readonly stations: string[];
  readonly kind: 'constrained' | 'free';
  /** Computational gauge anchor (free components only; never control). */
  readonly anchor?: string;
  /** Estimable rank contributed by this component. */
  readonly rank: number;
  /** Full parameter count contributed (3 per estimated station). */
  readonly paramCount: number;
  /** Datum defect contributed (3 per free component, else 0). */
  readonly defect: number;
}

export interface GnssDatumSummary {
  readonly modeRequested: 'constrained' | 'allow-free';
  readonly kind: 'constrained' | 'free' | 'mixed';
  readonly fullParameterCount: number;
  readonly estimableRank: number;
  readonly totalDatumDefect: number;
  readonly components: GnssDatumComponentInfo[];
}

export interface GnssDatumClassification {
  readonly components: string[][];
  readonly freeComponents: string[][];
  readonly constrainedComponents: string[][];
}

export const isFullyFixedStation = (stations: StationMap, stationId: string): boolean => {
  const station = stations[stationId];
  return !!station && !!station.fixedX && !!station.fixedY && !!station.fixedH;
};

/** Per-component datum classification over baseline edges (deterministic). */
export const classifyGnssDatumComponents = (
  stations: StationMap,
  baselines: GnssBaselineObservation[],
): GnssDatumClassification => {
  const components = gnssBaselineComponents([...baselines].sort((a, b) => a.id - b.id));
  const freeComponents = components.filter(
    (component) => !component.some((stationId) => isFullyFixedStation(stations, stationId)),
  );
  const freeSet = new Set(freeComponents.flat());
  const constrainedComponents = components.filter(
    (component) => !freeSet.has(component[0] as string),
  );
  return { components, freeComponents, constrainedComponents };
};

/**
 * Deterministic computational gauge anchors: first station ID in canonical
 * exact-ID sort per free component (components arrive pre-sorted, so index
 * 0 is the anchor regardless of manifest/file order).
 */
export const pickGnssFreeAnchors = (freeComponents: string[][]): string[] =>
  freeComponents.map((component) => {
    const anchor = component[0];
    if (!anchor) throw new Error(`${GNSS_FREE_EXTRA_RANK_DEFECT}: empty free component.`);
    return anchor;
  });

/** Working copy with gauge anchors held at a-priori (input never mutated). */
export const buildGnssFreeGaugeStations = (
  stations: StationMap,
  anchors: readonly string[],
): StationMap => {
  const anchorSet = new Set(anchors);
  return Object.fromEntries(
    Object.entries(stations).map(([stationId, station]) => {
      if (!anchorSet.has(stationId)) return [stationId, { ...station }];
      return [stationId, { ...station, fixed: true, fixedX: true, fixedY: true, fixedH: true }];
    }),
  );
};

const AXES = ['x', 'y', 'h'] as const;

export interface GnssFreeGaugeTransformInput {
  /** Original a-priori stations (control flags, never mutated). */
  readonly aprioriStations: StationMap;
  /** Solved gauge stations (anchors held at a-priori by construction). */
  readonly gaugeStations: StationMap;
  /** Gauge covariance over the gauge unknowns (anchors have no columns). */
  readonly gaugeQxx: number[][];
  /** Gauge unknowns (excludes anchors), sorted. */
  readonly gaugeUnknowns: string[];
  readonly freeComponents: string[][];
  readonly constrainedComponents: string[][];
}

export interface GnssFreeGaugeTransform {
  readonly stations: StationMap;
  readonly unknowns: string[];
  readonly paramIndex: SolveParameterIndex;
  readonly qxx: number[][];
  readonly datumSummary: GnssDatumSummary;
  /** Max |free correction| per component (diagnostic; gauge convergence stands). */
  readonly maxFreeCorrectionM: number;
}

/**
 * Inner-constraint S-transform of a solved computational gauge.
 * Constrained components pass through untouched; free components are
 * zero-meaned per axis and their covariance is S Q S' blockwise.
 * Cross-component covariance is exactly zero.
 */
export const transformGnssFreeGaugeToInner = (
  input: GnssFreeGaugeTransformInput,
): GnssFreeGaugeTransform => {
  const { aprioriStations, gaugeStations, gaugeQxx, gaugeUnknowns, freeComponents, constrainedComponents } = input;
  const { paramIndex: gaugeIndex } = buildSolveParameterIndex(gaugeStations, gaugeUnknowns, false);
  const gaugeColOf = (stationId: string, axis: 'x' | 'y' | 'h'): number | undefined =>
    gaugeIndex[stationId]?.[axis];

  // Final unknowns: every estimated station incl. gauge anchors (original
  // control flags preserved — anchors are NOT fixed in the output).
  const anchorSet = new Set(freeComponents.map((component) => component[0] as string));
  const estimated = new Set([...gaugeUnknowns, ...anchorSet]);
  const unknowns = [...estimated].sort();
  const stations: StationMap = Object.fromEntries(
    Object.entries(aprioriStations).map(([stationId, station]) => [stationId, { ...station }]),
  );
  const { paramIndex } = buildSolveParameterIndex(stations, unknowns, false);

  // Gauge corrections per station (anchors are exactly 0).
  const gaugeCorrection = new Map<string, [number, number, number]>();
  unknowns.forEach((stationId) => {
    const prior = aprioriStations[stationId];
    const solved = gaugeStations[stationId];
    if (!prior || !solved) {
      throw new Error(`${GNSS_FREE_EXTRA_RANK_DEFECT}: station '${stationId}' missing from gauge solve.`);
    }
    gaugeCorrection.set(stationId, [solved.x - prior.x, solved.y - prior.y, solved.h - prior.h]);
  });

  let maxFreeCorrectionM = 0;
  // Free components: subtract the per-axis component mean (anchor moves).
  freeComponents.forEach((component) => {
    const mean: [number, number, number] = [0, 0, 0];
    component.forEach((stationId) => {
      const correction = gaugeCorrection.get(stationId) ?? [0, 0, 0];
      mean[0] += correction[0] / component.length;
      mean[1] += correction[1] / component.length;
      mean[2] += correction[2] / component.length;
    });
    component.forEach((stationId) => {
      const prior = aprioriStations[stationId];
      const correction = gaugeCorrection.get(stationId) ?? [0, 0, 0];
      const free: [number, number, number] = [
        correction[0] - mean[0],
        correction[1] - mean[1],
        correction[2] - mean[2],
      ];
      maxFreeCorrectionM = Math.max(maxFreeCorrectionM, Math.abs(free[0]), Math.abs(free[1]), Math.abs(free[2]));
      const target = stations[stationId];
      if (!prior || !target) return;
      target.x = prior.x + free[0];
      target.y = prior.y + free[1];
      target.h = prior.h + free[2];
    });
  });
  // Constrained components: gauge coords stand.
  constrainedComponents.forEach((component) => {
    component.forEach((stationId) => {
      const solved = gaugeStations[stationId];
      const target = stations[stationId];
      if (!solved || !target) return;
      target.x = solved.x;
      target.y = solved.y;
      target.h = solved.h;
      const correction = gaugeCorrection.get(stationId) ?? [0, 0, 0];
      maxFreeCorrectionM = Math.max(maxFreeCorrectionM, Math.abs(correction[0]), Math.abs(correction[1]), Math.abs(correction[2]));
    });
  });

  // Full inner-constrained covariance, blockwise O(p^2), cross-component 0.
  const numParams = 3 * unknowns.length;
  const qxx: number[][] = Array.from({ length: numParams }, () => new Array(numParams).fill(0));
  const colOf = (stationId: string, axis: 'x' | 'y' | 'h'): number => {
    const col = paramIndex[stationId]?.[axis];
    if (col == null) {
      throw new Error(`${GNSS_FREE_EXTRA_RANK_DEFECT}: station '${stationId}' missing from free parameter index.`);
    }
    return col;
  };
  constrainedComponents.forEach((component) => {
    component.forEach((stationId) => {
      if (!estimated.has(stationId)) return;
      AXES.forEach((axisA) => {
        const target = colOf(stationId, axisA);
        const source = gaugeColOf(stationId, axisA);
        component.forEach((otherId) => {
          if (!estimated.has(otherId)) return;
          AXES.forEach((axisB) => {
            const targetB = colOf(otherId, axisB);
            const sourceB = gaugeColOf(otherId, axisB);
            // Fixed control endpoints have no columns on either side.
            if (source == null || sourceB == null) return;
            qxx[target]![targetB] = gaugeQxx[source]?.[sourceB] ?? 0;
          });
        });
      });
    });
  });
  freeComponents.forEach((component) => {
    const m = component.length;
    AXES.forEach((axisA) => {
      AXES.forEach((axisB) => {
        // G over component stations (anchor gauge entries are 0).
        const valueOf = (rowId: string, colId: string): number => {
          const row = gaugeColOf(rowId, axisA);
          const col = gaugeColOf(colId, axisB);
          if (row == null || col == null) return 0;
          return gaugeQxx[row]?.[col] ?? 0;
        };
        const rowMean = new Map<string, number>();
        let grand = 0;
        component.forEach((rowId) => {
          let sum = 0;
          component.forEach((colId) => {
            sum += valueOf(rowId, colId);
          });
          rowMean.set(rowId, sum / m);
          grand += sum;
        });
        grand /= m * m;
        const colMean = new Map<string, number>();
        component.forEach((colId) => {
          let sum = 0;
          component.forEach((rowId) => {
            sum += valueOf(rowId, colId);
          });
          colMean.set(colId, sum / m);
        });
        component.forEach((rowId) => {
          if (!estimated.has(rowId)) return;
          component.forEach((colId) => {
            if (!estimated.has(colId)) return;
            qxx[colOf(rowId, axisA)]![colOf(colId, axisB)] =
              valueOf(rowId, colId) - (rowMean.get(rowId) ?? 0) - (colMean.get(colId) ?? 0) + grand;
          });
        });
      });
    });
  });
  // Exact symmetry (removes ~1e-20 S-transform asymmetry).
  for (let i = 0; i < numParams; i += 1) {
    for (let j = i + 1; j < numParams; j += 1) {
      const symmetric = ((qxx[i]?.[j] ?? 0) + (qxx[j]?.[i] ?? 0)) / 2;
      qxx[i]![j] = symmetric;
      qxx[j]![i] = symmetric;
    }
  }

  const componentInfos: GnssDatumComponentInfo[] = [];
  let estimableRank = 0;
  constrainedComponents.forEach((component) => {
    const estimatedCount = component.filter((stationId) => estimated.has(stationId)).length;
    const paramCount = 3 * estimatedCount;
    estimableRank += paramCount;
    componentInfos.push({ stations: [...component], kind: 'constrained', rank: paramCount, paramCount, defect: 0 });
  });
  freeComponents.forEach((component) => {
    const paramCount = 3 * component.length;
    const rank = paramCount - 3;
    estimableRank += rank;
    componentInfos.push({
      stations: [...component],
      kind: 'free',
      anchor: component[0],
      rank,
      paramCount,
      defect: 3,
    });
  });
  componentInfos.sort((left, right) => (left.stations[0] ?? '').localeCompare(right.stations[0] ?? ''));
  const datumSummary: GnssDatumSummary = {
    modeRequested: 'allow-free',
    kind: freeComponents.length > 0 && constrainedComponents.length > 0 ? 'mixed' : 'free',
    fullParameterCount: numParams,
    estimableRank,
    totalDatumDefect: 3 * freeComponents.length,
    components: componentInfos,
  };
  return { stations, unknowns, paramIndex, qxx, datumSummary, maxFreeCorrectionM };
};

/**
 * Relative covariance Q_(Xi - Xj) = Qii + Qjj - Qij - Qji on demand from a
 * solved covariance (never precomputed). Gauge-invariant: identical on any
 * gauge anchor choice.
 */
export const relativeGnssCovariance = (
  qxx: number[][],
  paramIndex: SolveParameterIndex,
  fromId: string,
  toId: string,
): [[number, number, number], [number, number, number], [number, number, number]] => {
  const colsOf = (stationId: string): [number, number, number] => {
    const entry = paramIndex[stationId];
    if (entry?.x == null || entry?.y == null || entry?.h == null) {
      throw new Error(`Relative covariance: station '${stationId}' has no estimated XYZ block.`);
    }
    return [entry.x, entry.y, entry.h];
  };
  const from = colsOf(fromId);
  const to = colsOf(toId);
  const at = (row: number, col: number): number => qxx[row]?.[col] ?? 0;
  return [0, 1, 2].map((r) => [0, 1, 2].map((s) =>
    at(from[r] as number, from[s] as number) +
    at(to[r] as number, to[s] as number) -
    at(from[r] as number, to[s] as number) -
    at(to[r] as number, from[s] as number),
  )) as [[number, number, number], [number, number, number], [number, number, number]];
};
