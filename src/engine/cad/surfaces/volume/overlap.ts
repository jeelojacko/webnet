import { orient2d } from 'robust-predicates';

export interface ClippedPolygon {
  /** Flat [x,y,...] in the local frame (integer-truncated min origin). */
  local: number[];
  originX: number;
  originY: number;
}

interface Pt {
  x: number;
  y: number;
}

/**
 * Inside test for a math-CCW clip edge a→b. robust-predicates orient2d
 * returns positive for math-clockwise triples (see tinPredicates), so the
 * left/interior side is orient2d <= 0; boundary counts as inside.
 */
const inside = (a: Pt, b: Pt, p: Pt): boolean =>
  orient2d(a.x, a.y, b.x, b.y, p.x, p.y) <= 0;

const segLineCross = (s: Pt, e: Pt, a: Pt, b: Pt): Pt => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const denom = (e.x - s.x) * dy - (e.y - s.y) * dx;
  const t = ((a.x - s.x) * dy - (a.y - s.y) * dx) / denom;
  return { x: s.x + t * (e.x - s.x), y: s.y + t * (e.y - s.y) };
};

const clipAgainstEdge = (subject: Pt[], a: Pt, b: Pt): Pt[] => {
  const out: Pt[] = [];
  if (subject.length === 0) return out;
  let s = subject[subject.length - 1];
  let sIn = inside(a, b, s);
  for (const e of subject) {
    const eIn = inside(a, b, e);
    if (eIn) {
      if (!sIn) out.push(segLineCross(s, e, a, b));
      out.push(e);
    } else if (sIn) {
      out.push(segLineCross(s, e, a, b));
    }
    s = e;
    sIn = eIn;
  }
  return out;
};

const signedArea2 = (pts: Pt[]): number => {
  let s = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    s += p.x * q.y - q.x * p.y;
  }
  return s;
};

/**
 * Sutherland–Hodgman convex clip of the base triangle against the comparison
 * triangle, in a local frame with the integer-truncated pair minimum
 * subtracted (18F tinBase conditioning). Returns null for disjoint pairs and
 * for contact-only results (fewer than 3 unique vertices or numerical-zero
 * area); slivers with real area are preserved.
 */
export const clipTrianglePair = (
  baseXY: ArrayLike<number>,
  cmpXY: ArrayLike<number>,
): ClippedPolygon | null => {
  const minX = Math.min(baseXY[0], baseXY[2], baseXY[4], cmpXY[0], cmpXY[2], cmpXY[4]);
  const minY = Math.min(baseXY[1], baseXY[3], baseXY[5], cmpXY[1], cmpXY[3], cmpXY[5]);
  const originX = Math.floor(minX);
  const originY = Math.floor(minY);
  let subject: Pt[] = [0, 1, 2].map((i) => ({
    x: baseXY[i * 2] - originX,
    y: baseXY[i * 2 + 1] - originY,
  }));
  let clip: Pt[] = [0, 1, 2].map((i) => ({
    x: cmpXY[i * 2] - originX,
    y: cmpXY[i * 2 + 1] - originY,
  }));
  if (signedArea2(clip) < 0) clip = [clip[0], clip[2], clip[1]];
  if (signedArea2(clip) === 0) return null;
  for (let e = 0; e < 3; e += 1) {
    subject = clipAgainstEdge(subject, clip[e], clip[(e + 1) % 3]);
    if (subject.length === 0) return null;
  }
  const cleaned: Pt[] = [];
  for (const p of subject) {
    const prev = cleaned[cleaned.length - 1];
    if (!prev || prev.x !== p.x || prev.y !== p.y) cleaned.push(p);
  }
  if (cleaned.length > 1) {
    const first = cleaned[0];
    const last = cleaned[cleaned.length - 1];
    if (first.x === last.x && first.y === last.y) cleaned.pop();
  }
  if (cleaned.length < 3) return null;
  let maxAbs = 0;
  for (const p of cleaned) maxAbs = Math.max(maxAbs, Math.abs(p.x), Math.abs(p.y));
  const area = Math.abs(signedArea2(cleaned)) / 2;
  if (area <= 32 * Number.EPSILON * Math.max(1, maxAbs * maxAbs)) return null;
  const local: number[] = [];
  for (const p of cleaned) local.push(p.x, p.y);
  return { local, originX, originY };
};
