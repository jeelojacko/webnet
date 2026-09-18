import { VolumeError } from './volumeTypes';
import { zeroDelta } from './zero';

export interface ZVertex {
  x: number;
  y: number;
  baseZ: number;
  cmpZ: number;
  d: number;
}

export interface CompSum {
  sum: number;
  c: number;
}

export const compAdd = (s: CompSum, v: number): void => {
  const t = s.sum + v;
  if (Math.abs(s.sum) >= Math.abs(v)) s.c += (s.sum - t) + v;
  else s.c += (v - t) + s.sum;
  s.sum = t;
};

export const compValue = (s: CompSum): number => s.sum + s.c;

export const newSum = (): CompSum => ({ sum: 0, c: 0 });

/** Neumaier-compensated cut/fill accumulators (deterministic pair order). */
export interface VolumeAccumulators {
  overlapArea: CompSum;
  cutArea: CompSum;
  fillArea: CompSum;
  cutVolume: CompSum;
  fillVolume: CompSum;
}

export const newAccumulators = (): VolumeAccumulators => ({
  overlapArea: newSum(),
  cutArea: newSum(),
  fillArea: newSum(),
  cutVolume: newSum(),
  fillVolume: newSum(),
});

interface Plane {
  p: number;
  q: number;
  r: number;
}

/** Plane z = p + q·x + r·y through three (local-frame) XYZ points. */
export const fitPlane = (tri: ArrayLike<number>): Plane => {
  const x0 = tri[0];
  const y0 = tri[1];
  const z0 = tri[2];
  const x1 = tri[3];
  const y1 = tri[4];
  const z1 = tri[5];
  const x2 = tri[6];
  const y2 = tri[7];
  const z2 = tri[8];
  const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (det === 0) throw new VolumeError('degenerate triangle (zero XY area)');
  const q = ((z1 - z0) * (y2 - y0) - (z2 - z0) * (y1 - y0)) / det;
  const r = ((x1 - x0) * (z2 - z0) - (x2 - x0) * (z1 - z0)) / det;
  return { p: z0 - q * x0 - r * y0, q, r };
};

/** Per-vertex Base/Comparison Z from the OWNING triangle planes only. */
export const buildVertices = (
  local: number[],
  basePlane: Plane,
  cmpPlane: Plane,
): ZVertex[] =>
  Array.from({ length: local.length / 2 }, (_, i) => {
    const x = local[i * 2];
    const y = local[i * 2 + 1];
    const baseZ = basePlane.p + basePlane.q * x + basePlane.r * y;
    const cmpZ = cmpPlane.p + cmpPlane.q * x + cmpPlane.r * y;
    const raw = cmpZ - baseZ;
    const d = Math.abs(raw) <= zeroDelta(baseZ, cmpZ) ? 0 : raw;
    return { x, y, baseZ, cmpZ, d };
  });

const lerpVertex = (a: ZVertex, b: ZVertex): ZVertex => {
  const t = a.d / (a.d - b.d);
  return {
    x: a.x + t * (b.x - a.x),
    y: a.y + t * (b.y - a.y),
    baseZ: a.baseZ + t * (b.baseZ - a.baseZ),
    cmpZ: a.cmpZ + t * (b.cmpZ - a.cmpZ),
    d: 0,
  };
};

/** Clip a 3-vertex fan triangle against one delta half-plane. */
type ZTri = [ZVertex, ZVertex, ZVertex];

const clipHalf = (tri: ZTri, keepPositive: boolean): ZVertex[] => {
  const want = (v: ZVertex): boolean => (keepPositive ? v.d >= 0 : v.d <= 0);
  const out: ZVertex[] = [];
  let s = tri[2];
  let sIn = want(s);
  for (const e of tri) {
    const eIn = want(e);
    if (eIn) {
      if (!sIn) out.push(lerpVertex(s, e));
      out.push(e);
    } else if (sIn) {
      out.push(lerpVertex(s, e));
    }
    s = e;
    sIn = eIn;
  }
  return out;
};

const subArea2 = (poly: ZVertex[]): number => {
  let s = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    s += p.x * q.y - q.x * p.y;
  }
  return s;
};

const addFanTri = (
  a: ZVertex,
  b: ZVertex,
  c: ZVertex,
  acc: VolumeAccumulators,
  out?: { cut: number[][]; fill: number[][] },
): void => {
  const area2 = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  if (area2 === 0) return;
  const area = Math.abs(area2) / 2;
  const tri: ZTri = [a, b, c];
  const pos = a.d > 0 || b.d > 0 || c.d > 0;
  const neg = a.d < 0 || b.d < 0 || c.d < 0;
  if (pos && !neg) {
    compAdd(acc.fillArea, area);
    compAdd(acc.fillVolume, (area * (a.d + b.d + c.d)) / 3);
    if (out) out.fill.push([a.x, a.y, b.x, b.y, c.x, c.y]);
  } else if (neg && !pos) {
    compAdd(acc.cutArea, area);
    compAdd(acc.cutVolume, (area * -(a.d + b.d + c.d)) / 3);
    if (out) out.cut.push([a.x, a.y, b.x, b.y, c.x, c.y]);
  } else if (pos && neg) {
    const fillPoly = clipHalf(tri, true);
    const cutPoly = clipHalf(tri, false);
    for (const [poly, isFill] of [
      [fillPoly, true],
      [cutPoly, false],
    ] as const) {
      if (poly.length < 3) continue;
      const sub = Math.abs(subArea2(poly)) / 2;
      if (sub === 0) continue;
      // Sub-polygons can have 4 vertices: fan-triangulate (exact for the
      // linear delta plane) rather than scaling the whole ring at once.
      let subVol = 0;
      for (let j = 1; j + 1 < poly.length; j += 1) {
        const u = poly[0];
        const v = poly[j];
        const w = poly[j + 1];
        const fanArea = Math.abs((v.x - u.x) * (w.y - u.y) - (w.x - u.x) * (v.y - u.y)) / 2;
        subVol += (fanArea * (u.d + v.d + w.d)) / 3;
      }
      if (isFill) {
        compAdd(acc.fillArea, sub);
        compAdd(acc.fillVolume, subVol);
      } else {
        compAdd(acc.cutArea, sub);
        compAdd(acc.cutVolume, -subVol);
      }
      if (out) {
        const ring: number[] = [];
        for (const v of poly) ring.push(v.x, v.y);
        (isFill ? out.fill : out.cut).push(ring);
      }
    }
  }
};

/**
 * Exact fan-triangulation integral of the linear delta plane over the overlap
 * polygon: per fan triangle Area·(d1+d2+d3)/3. Sign split: delta > 0 is FILL,
 * delta < 0 is CUT; mixed triangles clip by the delta half-planes with
 * t = dA/(dA−dB) interpolation of XY + both Zs. All-zero triangles contribute
 * to overlap area only (handled by the caller).
 */
export const integratePolygon = (
  verts: ZVertex[],
  acc: VolumeAccumulators,
  out?: { cut: number[][]; fill: number[][] },
): void => {
  for (let i = 1; i + 1 < verts.length; i += 1) {
    addFanTri(verts[0], verts[i], verts[i + 1], acc, out);
  }
};
