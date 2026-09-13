/**
 * Phase 12E.2 — pure evidence-side GNSS parity model helpers (no I/O).
 *
 * - groupMarksByName: POINT-ID-keyed GVX marks into station-NAME groups,
 *   fail-closed when one NAME carries two distinct coordinates (>1e-6 m).
 * - ecefToGeodetic: closed-form Bowring iteration (WGS84; evidence-only).
 * - setupCovarianceEcef: endpoint setup-error hypothesis (centering 0.005 m
 *   horizontal + antenna-height 0.002 m vertical, rotated ENU->ECEF at each
 *   endpoint, summed). HYPOTHESIS — not TBC's formula.
 */
import type { GvxRawMark } from '../../src/engine/gnssGvxSyntax';

export interface NameGroup {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly pointIds: string[];
}

export interface NameGrouping {
  readonly groups: Map<string, NameGroup>;
  readonly mismatch: string | null;
}

/** 1e-6 m identity tolerance for same-NAME coordinates. */
export const NAME_IDENTITY_TOL_M = 1e-6;

export const groupMarksByName = (marks: GvxRawMark[]): NameGrouping => {
  const groups = new Map<string, NameGroup>();
  for (const mark of marks) {
    const existing = groups.get(mark.name);
    if (!existing) {
      groups.set(mark.name, { name: mark.name, x: mark.x, y: mark.y, z: mark.z, pointIds: [mark.id] });
      continue;
    }
    const drift = Math.max(Math.abs(existing.x - mark.x), Math.abs(existing.y - mark.y), Math.abs(existing.z - mark.z));
    if (drift > NAME_IDENTITY_TOL_M) {
      return {
        groups,
        mismatch:
          `NAME '${mark.name}': ${existing.pointIds[0] ?? '?'} vs ${mark.id} drift ${drift.toExponential(3)} m exceeds 1e-6 m.`,
      };
    }
    groups.set(mark.name, { ...existing, pointIds: [...existing.pointIds, mark.id] });
  }
  return { groups, mismatch: null };
};

const WGS84_A = 6378137;
const WGS84_F = 1 / 298.257223563;

export const ecefToGeodetic = (x: number, y: number, z: number): { lat: number; lon: number } => {
  const e2 = 2 * WGS84_F - WGS84_F * WGS84_F;
  const lon = Math.atan2(y, x);
  const p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - e2));
  for (let i = 0; i < 5; i += 1) {
    const sin = Math.sin(lat);
    const n = WGS84_A / Math.sqrt(1 - e2 * sin * sin);
    lat = Math.atan2(z + e2 * n * sin, p);
  }
  return { lat, lon };
};

/** ENU->ECEF rotation at (lat, lon); rows are E/N/U expressed in X/Y/Z. */
export const enuToEcef = (lat: number, lon: number): number[][] => {
  const sLat = Math.sin(lat);
  const cLat = Math.cos(lat);
  const sLon = Math.sin(lon);
  const cLon = Math.cos(lon);
  return [
    [-sLon, cLon, 0],
    [-sLat * cLon, -sLat * sLon, cLat],
    [cLat * cLon, cLat * sLon, sLat],
  ];
};

/**
 * Setup-error covariance hypothesis for one baseline (m^2, ECEF): each
 * endpoint contributes R . diag(c^2, c^2, a^2) . R^T.
 */
export const setupCovarianceEcef = (
  fromXyz: readonly [number, number, number],
  toXyz: readonly [number, number, number],
  centeringM = 0.005,
  antennaM = 0.002,
): { xx: number; yy: number; zz: number; xy: number; xz: number; yz: number } => {
  const acc = { xx: 0, yy: 0, zz: 0, xy: 0, xz: 0, yz: 0 };
  const vars = [centeringM * centeringM, centeringM * centeringM, antennaM * antennaM];
  for (const [x, y, z] of [fromXyz, toXyz]) {
    const { lat, lon } = ecefToGeodetic(x, y, z);
    const r = enuToEcef(lat, lon);
    // C_ecef[i][j] = sum_k R[k][i] v_k R[k][j] (R rows are ENU axes).
    const keys = ['xx', 'yy', 'zz', 'xy', 'xz', 'yz'] as const;
    const block = [0, 0, 0, 0, 0, 0];
    const pairs: [number, number][] = [
      [0, 0],
      [1, 1],
      [2, 2],
      [0, 1],
      [0, 2],
      [1, 2],
    ];
    pairs.forEach(([i, j], slot) => {
      let sum = 0;
      for (let k = 0; k < 3; k += 1) sum += (r[k]?.[i] ?? 0) * (vars[k] ?? 0) * (r[k]?.[j] ?? 0);
      block[slot] = sum;
    });
    keys.forEach((key, slot) => {
      acc[key] += block[slot] ?? 0;
    });
  }
  return acc;
};
