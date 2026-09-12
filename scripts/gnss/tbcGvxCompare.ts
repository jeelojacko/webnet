/**
 * Phase 12E.2 dataset B — pure pre-vs-post GVX comparison helpers (no I/O).
 *
 * Compares two parsed GVX networks vector-by-vector (keyed by solutionId)
 * plus station initial coordinates. Classification: component/covariance
 * drift at or below 1e-6 m (m^2) is serialization rounding, anything larger
 * is substantive. Threshold matches the NAME-identity tolerance.
 */

export interface GvxVectorPoint {
  readonly solutionId: string;
  readonly from: string;
  readonly to: string;
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  readonly cov: readonly [number, number, number, number, number, number];
}

export interface GvxVectorComparison {
  readonly preCount: number;
  readonly postCount: number;
  readonly matched: number;
  readonly preOnly: string[];
  readonly postOnly: string[];
  readonly bitwiseEqual: number;
  readonly maxAbsDX: number;
  readonly maxAbsDY: number;
  readonly maxAbsDZ: number;
  readonly maxAbsCov: number;
}

/** Drift at/below this (m, m^2) counts as serialization, not substance. */
export const SERIALIZATION_TOL = 1e-6;

export const classifyGvxDrift = (maxAbs: number): 'serialization' | 'substantive' =>
  maxAbs <= SERIALIZATION_TOL ? 'serialization' : 'substantive';

export const compareGvxVectors = (pre: GvxVectorPoint[], post: GvxVectorPoint[]): GvxVectorComparison => {
  const postById = new Map(post.map((v) => [v.solutionId, v]));
  const preIds = new Set(pre.map((v) => v.solutionId));
  const preOnly = pre.filter((v) => !postById.has(v.solutionId)).map((v) => v.solutionId).sort();
  const postOnly = post.filter((v) => !preIds.has(v.solutionId)).map((v) => v.solutionId).sort();
  let bitwiseEqual = 0;
  let maxAbsDX = 0;
  let maxAbsDY = 0;
  let maxAbsDZ = 0;
  let maxAbsCov = 0;
  let matched = 0;
  for (const a of pre) {
    const b = postById.get(a.solutionId);
    if (!b) continue;
    matched += 1;
    maxAbsDX = Math.max(maxAbsDX, Math.abs(a.dx - b.dx));
    maxAbsDY = Math.max(maxAbsDY, Math.abs(a.dy - b.dy));
    maxAbsDZ = Math.max(maxAbsDZ, Math.abs(a.dz - b.dz));
    for (let i = 0; i < 6; i += 1) maxAbsCov = Math.max(maxAbsCov, Math.abs((a.cov[i] ?? 0) - (b.cov[i] ?? 0)));
    if (a.from === b.from && a.to === b.to && a.dx === b.dx && a.dy === b.dy && a.dz === b.dz
      && a.cov.every((c, i) => c === b.cov[i])) bitwiseEqual += 1;
  }
  return { preCount: pre.length, postCount: post.length, matched, preOnly, postOnly, bitwiseEqual, maxAbsDX, maxAbsDY, maxAbsDZ, maxAbsCov };
};

export interface GvxMarkComparison {
  readonly preCount: number;
  readonly postCount: number;
  readonly maxAbsCoord: number;
  readonly perNameMax: Record<string, number>;
}

export const compareGvxMarks = (
  pre: { id: string; name: string; x: number; y: number; z: number }[],
  post: { id: string; name: string; x: number; y: number; z: number }[],
): GvxMarkComparison => {
  const postById = new Map(post.map((m) => [m.id, m]));
  let maxAbsCoord = 0;
  const perNameMax: Record<string, number> = {};
  for (const m of pre) {
    const q = postById.get(m.id);
    if (!q) continue;
    const drift = Math.max(Math.abs(m.x - q.x), Math.abs(m.y - q.y), Math.abs(m.z - q.z));
    maxAbsCoord = Math.max(maxAbsCoord, drift);
    perNameMax[m.name] = Math.max(perNameMax[m.name] ?? 0, drift);
  }
  return { preCount: pre.length, postCount: post.length, maxAbsCoord, perNameMax };
};
