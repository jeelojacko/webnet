// Phase 18Q foundation: pure 2D affine transform kernel + classifier.
// x' = a*x + c*y + tx, y' = b*x + d*y + ty. Full float64, no rounding.

export interface CadTransform2D {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

export interface CadPoint2D {
  x: number;
  y: number;
}

export type CadTransformKind =
  | 'RIGID_ORIENTATION_PRESERVING'
  | 'RIGID_REFLECTION'
  | 'SIMILARITY'
  | 'SIMILARITY_REFLECTION'
  | 'GENERAL_AFFINE';

export interface CadTransformClassification {
  kind: CadTransformKind;
  scale: number;
  rotationDeg: number;
  determinantSign: 1 | -1;
}

export const SINGULAR_DET_TOLERANCE = 1e-12;
const ORTHONORMAL_REL_TOLERANCE = 1e-9;

export const identity = (): CadTransform2D => ({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });

export const translation = (dx: number, dy: number): CadTransform2D => ({
  a: 1, b: 0, c: 0, d: 1, tx: dx, ty: dy,
});

export const rotationAbout = (cx: number, cy: number, angleDegCcw: number): CadTransform2D => {
  const radians = (angleDegCcw * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  // Centred form R*(p-c)+c avoids catastrophic cancellation at large coordinates.
  return {
    a: cos,
    b: sin,
    c: -sin,
    d: cos,
    tx: cx - cos * cx + sin * cy,
    ty: cy - sin * cx - cos * cy,
  };
};

export const uniformScaleAbout = (cx: number, cy: number, s: number): CadTransform2D => ({
  a: s, b: 0, c: 0, d: s, tx: cx - s * cx, ty: cy - s * cy,
});

export const reflectionAboutLine = (
  p1: CadPoint2D,
  p2: CadPoint2D,
): CadTransform2D | null => {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!(lengthSquared > 0)) return null;
  const length = Math.sqrt(lengthSquared);
  const ux = dx / length;
  const uy = dy / length;
  // R = 2*u*u' - I, then t = p1 - R*p1.
  const a = 2 * ux * ux - 1;
  const b = 2 * ux * uy;
  const c = 2 * ux * uy;
  const d = 2 * uy * uy - 1;
  return { a, b, c, d, tx: p1.x - a * p1.x - c * p1.y, ty: p1.y - b * p1.x - d * p1.y };
};

/** compose(tOuter, tInner): apply inner first, then outer. */
export const compose = (tOuter: CadTransform2D, tInner: CadTransform2D): CadTransform2D => ({
  a: tOuter.a * tInner.a + tOuter.c * tInner.b,
  b: tOuter.b * tInner.a + tOuter.d * tInner.b,
  c: tOuter.a * tInner.c + tOuter.c * tInner.d,
  d: tOuter.b * tInner.c + tOuter.d * tInner.d,
  tx: tOuter.a * tInner.tx + tOuter.c * tInner.ty + tOuter.tx,
  ty: tOuter.b * tInner.tx + tOuter.d * tInner.ty + tOuter.ty,
});

export const determinant = (t: CadTransform2D): number => t.a * t.d - t.b * t.c;

export const inverse = (t: CadTransform2D): CadTransform2D | null => {
  const det = determinant(t);
  if (Math.abs(det) < SINGULAR_DET_TOLERANCE) return null;
  const invDet = 1 / det;
  const a = t.d * invDet;
  const b = -t.b * invDet;
  const c = -t.c * invDet;
  const d = t.a * invDet;
  return { a, b, c, d, tx: -(a * t.tx + c * t.ty), ty: -(b * t.tx + d * t.ty) };
};

export const applyPoint = (t: CadTransform2D, p: CadPoint2D): CadPoint2D => ({
  x: t.a * p.x + t.c * p.y + t.tx,
  y: t.b * p.x + t.d * p.y + t.ty,
});

export const applyVector = (t: CadTransform2D, v: CadPoint2D): CadPoint2D => ({
  x: t.a * v.x + t.c * v.y,
  y: t.b * v.x + t.d * v.y,
});

const closeRelative = (actual: number, expected: number): boolean => {
  const denom = Math.max(Math.abs(actual), Math.abs(expected), 1);
  return Math.abs(actual - expected) <= ORTHONORMAL_REL_TOLERANCE * denom;
};

export const classifyTransform = (t: CadTransform2D): CadTransformClassification | null => {
  const det = determinant(t);
  if (Math.abs(det) < SINGULAR_DET_TOLERANCE) return null;
  const determinantSign: 1 | -1 = det > 0 ? 1 : -1;
  const scale = Math.sqrt(Math.abs(det));
  const rotationDeg = (Math.atan2(t.b, t.a) * 180) / Math.PI;

  const s1 = Math.hypot(t.a, t.b);
  const s2 = Math.hypot(t.c, t.d);
  const uniform = closeRelative(s1, s2);
  const dot = t.a * t.c + t.b * t.d;
  const orthogonal = Math.abs(dot) <= ORTHONORMAL_REL_TOLERANCE * s1 * s2;
  const rigid = Math.abs(scale - 1) <= ORTHONORMAL_REL_TOLERANCE * Math.max(1, scale);

  if (uniform && orthogonal) {
    if (determinantSign > 0) {
      return { kind: rigid ? 'RIGID_ORIENTATION_PRESERVING' : 'SIMILARITY', scale, rotationDeg, determinantSign };
    }
    return { kind: rigid ? 'RIGID_REFLECTION' : 'SIMILARITY_REFLECTION', scale, rotationDeg, determinantSign };
  }
  return { kind: 'GENERAL_AFFINE', scale, rotationDeg, determinantSign };
};
