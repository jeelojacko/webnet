/** Phase 12D test-only INDEPENDENT golden reference for GNSS statistics. Own dense math only (adjugate 3x3, Gauss-Jordan Qxx). Zero imports (not even type imports); local structural types keep agreement with production as genuine cross-implementation parity. Conventions: unknowns sorted by station id (x/y/h, fixed excluded when fixedX&&fixedY&&fixedH), baselines by id, triplet x=X y=Y h=Z (ECEF m), covariance flat m^2. */
interface GoldenStation { x: number; y: number; h: number; fixedX?: boolean; fixedY?: boolean; fixedH?: boolean }
type GoldenStationMap = Record<string, GoldenStation>;
interface GoldenVector { x: number; y: number; z: number }
interface GoldenCovariance { xx: number; xy: number; xz: number; yy: number; yz: number; zz: number }
interface GoldenBaseline { id: number; from: string; to: string; vector: GoldenVector; covariance: GoldenCovariance }
export interface GoldenQvvBlockEntry { baselineId: number; qvv: GoldenCovariance; redundancy: { x: number; y: number; z: number; trace: number }; qObs: number; blockT: number; residuals: { vX: number; vY: number; vZ: number } }
export interface GoldenQvvBlocks { qxx: number[][]; blocks: GoldenQvvBlockEntry[]; dof: number }
export interface GoldenLoopClosure { s: GoldenVector; cov: GoldenCovariance; tLoop: number }
type Mat3 = [[number, number, number], [number, number, number], [number, number, number]];
const toDense = (c: GoldenCovariance): Mat3 => [[c.xx, c.xy, c.xz], [c.xy, c.yy, c.yz], [c.xz, c.yz, c.zz]];
const toFlat = (m: Mat3): GoldenCovariance => ({ xx: m[0][0], xy: (m[0][1] + m[1][0]) / 2, xz: (m[0][2] + m[2][0]) / 2, yy: m[1][1], yz: (m[1][2] + m[2][1]) / 2, zz: m[2][2] });
const quad = (m: Mat3, v: number[]): number => v[0]! * (m[0][0] * v[0]! + m[0][1] * v[1]! + m[0][2] * v[2]!) + v[1]! * (m[1][0] * v[0]! + m[1][1] * v[1]! + m[1][2] * v[2]!) + v[2]! * (m[2][0] * v[0]! + m[2][1] * v[1]! + m[2][2] * v[2]!);
/** Own 3x3 inverse via adjugate/determinant; throws on singular. */
const invert3 = (m: Mat3): Mat3 => {
  const a = m[0][0]; const b = m[0][1]; const c = m[0][2];
  const d = m[1][0]; const e = m[1][1]; const f = m[1][2];
  const g = m[2][0]; const h = m[2][1]; const i = m[2][2];
  const A = e * i - f * h; const B = -(d * i - f * g); const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-300) throw new Error('Golden stats: singular 3x3.');
  return [[A / det, (c * h - b * i) / det, (b * f - c * e) / det], [B / det, (a * i - c * g) / det, (c * d - a * f) / det], [C / det, (b * g - a * h) / det, (a * e - b * d) / det]];
};
/** Own Gauss-Jordan inverse with partial pivoting; throws on singular. */
const invertGeneral = (m: number[][]): number[][] => {
  const n = m.length;
  const aug: number[][] = m.map((row, r) => [...row, ...Array.from({ length: n }, (_, c) => (r === c ? 1 : 0))]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) if (Math.abs(aug[row]![col]!) > Math.abs(aug[pivot]![col]!)) pivot = row;
    if (!Number.isFinite(aug[pivot]![col]!) || Math.abs(aug[pivot]![col]!) < 1e-300) throw new Error('Golden stats: singular normal matrix.');
    const tmp = aug[col]!;
    aug[col] = aug[pivot]!;
    aug[pivot] = tmp;
    const scale = aug[col]![col]!;
    for (let j = 0; j < 2 * n; j += 1) aug[col]![j]! /= scale;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = aug[row]![col]!;
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j += 1) aug[row]![j]! -= factor * aug[col]![j]!;
    }
  }
  return aug.map((row) => row.slice(n));
};
const sortedBaselines = (baselines: GoldenBaseline[]): GoldenBaseline[] => [...baselines].sort((a, b) => a.id - b.id);
const unknownStations = (stations: GoldenStationMap): string[] =>
  Object.entries(stations).filter(([, s]) => !(s.fixedX && s.fixedY && s.fixedH)).map(([id]) => id).sort();
interface SolvedNetwork { colOf: Map<string, number>; qxx: number[][]; residuals: { baselineId: number; vX: number; vY: number; vZ: number }[]; dof: number }
/** Dense normal-equation assembly: [-I +I] rows, P = C^-1 (adjugate). */
const solveNetwork = (stations: GoldenStationMap, baselines: GoldenBaseline[]): SolvedNetwork => {
  const ordered = sortedBaselines(baselines);
  const colOf = new Map(unknownStations(stations).map((id, idx) => [id, 3 * idx] as [string, number]));
  const n = 3 * colOf.size;
  const normal: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const rhs: number[] = new Array<number>(n).fill(0);
  ordered.forEach((b) => {
    const from = stations[b.from];
    const to = stations[b.to];
    if (!from || !to) throw new Error(`Golden stats: unknown station on baseline ${b.id}.`);
    const l = [b.vector.x - (to.x - from.x), b.vector.y - (to.y - from.y), b.vector.z - (to.h - from.h)];
    const p = invert3(toDense(b.covariance));
    const fc = colOf.get(b.from);
    const tc = colOf.get(b.to);
    for (let r = 0; r < 3; r += 1) {
      for (let s = 0; s < 3; s += 1) {
        const w = p[r]![s]!;
        if (fc != null) {
          if (tc != null) { normal[fc + r]![tc + s]! -= w; normal[tc + r]![fc + s]! -= w; }
          normal[fc + r]![fc + s]! += w;
        }
        if (tc != null) normal[tc + r]![tc + s]! += w;
      }
      const pl = p[r]![0]! * l[0]! + p[r]![1]! * l[1]! + p[r]![2]! * l[2]!;
      if (fc != null) rhs[fc + r]! -= pl;
      if (tc != null) rhs[tc + r]! += pl;
    }
  });
  const qxx = n === 0 ? [] : invertGeneral(normal);
  const dx = n === 0 ? [] : qxx.map((row) => row.reduce((sum, q, j) => sum + q * rhs[j]!, 0));
  const at = (id: string, comp: number): number => {
    const col = colOf.get(id);
    return col == null ? 0 : dx[col + comp]!;
  };
  const residuals = ordered.map((b) => {
    const from = stations[b.from]!;
    const to = stations[b.to]!;
    const fx = from.x + at(b.from, 0); const fy = from.y + at(b.from, 1); const fz = from.h + at(b.from, 2);
    const tx = to.x + at(b.to, 0); const ty = to.y + at(b.to, 1); const tz = to.h + at(b.to, 2);
    return { baselineId: b.id, vX: b.vector.x - (tx - fx), vY: b.vector.y - (ty - fy), vZ: b.vector.z - (tz - fz) };
  });
  return { colOf, qxx, residuals, dof: 3 * ordered.length - n };
};
const subBlock = (qxx: number[][], colOf: Map<string, number>, rowId: string, colId: string): Mat3 => {
  const r = colOf.get(rowId);
  const c = colOf.get(colId);
  const atIdx = (rr: number, cc: number): number => (r == null || c == null ? 0 : qxx[r + rr]![c + cc]!);
  return [[atIdx(0, 0), atIdx(0, 1), atIdx(0, 2)], [atIdx(1, 0), atIdx(1, 1), atIdx(1, 2)], [atIdx(2, 0), atIdx(2, 1), atIdx(2, 2)]];
};
export const goldenQxx = (stations: GoldenStationMap, baselines: GoldenBaseline[]): number[][] => solveNetwork(stations, baselines).qxx;
export const goldenQvvBlocks = (stations: GoldenStationMap, baselines: GoldenBaseline[]): GoldenQvvBlocks => {
  const { colOf, qxx, residuals, dof } = solveNetwork(stations, baselines);
  const resById = new Map(residuals.map((r) => [r.baselineId, r]));
  const blocks = sortedBaselines(baselines).map((b): GoldenQvvBlockEntry => {
    const cll = toDense(b.covariance);
    const qff = subBlock(qxx, colOf, b.from, b.from);
    const qtt = subBlock(qxx, colOf, b.to, b.to);
    const qft = subBlock(qxx, colOf, b.from, b.to);
    const qvv: Mat3 = [0, 1, 2].map((r) => [0, 1, 2].map((s) => cll[r]![s]! - (qff[r]![s]! + qtt[r]![s]! - qft[r]![s]! - qft[s]![r]!))) as Mat3;
    const p = invert3(toDense(b.covariance));
    const red: Mat3 = [0, 1, 2].map((r) => [0, 1, 2].map((s) => qvv[r]![0]! * p[0]![s]! + qvv[r]![1]! * p[1]![s]! + qvv[r]![2]! * p[2]![s]!)) as Mat3;
    const res = resById.get(b.id);
    if (!res) throw new Error(`Golden stats: residual missing for baseline ${b.id}.`);
    const v = [res.vX, res.vY, res.vZ];
    return { baselineId: b.id, qvv: toFlat(qvv), redundancy: { x: red[0]![0]!, y: red[1]![1]!, z: red[2]![2]!, trace: red[0]![0]! + red[1]![1]! + red[2]![2]! }, qObs: quad(p, v), blockT: quad(invert3(qvv), v), residuals: { vX: res.vX, vY: res.vY, vZ: res.vZ } };
  });
  return { qxx, blocks, dof };
};
export const goldenLoopClosure = (baselines: GoldenBaseline[], members: { baselineId: number; sign: 1 | -1 }[]): GoldenLoopClosure => {
  const byId = new Map(baselines.map((b) => [b.id, b]));
  let sx = 0; let sy = 0; let sz = 0;
  const covSum: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  members.forEach(({ baselineId, sign }) => {
    const b = byId.get(baselineId);
    if (!b) throw new Error(`Golden stats: loop member baseline ${baselineId} missing.`);
    sx += sign * b.vector.x; sy += sign * b.vector.y; sz += sign * b.vector.z;
    const c = toDense(b.covariance);
    for (let r = 0; r < 3; r += 1) for (let s = 0; s < 3; s += 1) covSum[r]![s]! += c[r]![s]!;
  });
  const s: GoldenVector = { x: sx, y: sy, z: sz };
  return { s, cov: toFlat(covSum), tLoop: quad(invert3(covSum), [sx, sy, sz]) };
};
