/**
 * B0 study-side construction-mode formulas (deterministic, closed-form).
 * Center/Radius, Center/Diameter, 2-Point, 3-Point + TTR/TTT analysis.
 * Recommends the smallest B1 slice. STUDY-ONLY.
 */
import { cadDistance, type CadWorldPoint } from '../src/engine/cad/cadGeometry';
import { cadTangentPointsFromExternalPointToCircle } from '../src/engine/cad/cadGeometryCurveIntersections';

export interface ModeResult { mode: string; center: CadWorldPoint | null; radius: number | null; degenerate: string | null }

const P = (x: number, y: number): CadWorldPoint => ({ x, y });

/** Center/Radius: trivially exact; degenerates on r<=0 or non-finite. */
export const fromCenterRadius = (cx: number, cy: number, r: number): ModeResult =>
  !Number.isFinite(cx + cy + r) || r <= 0
    ? { mode: 'center-radius', center: null, radius: null, degenerate: r <= 0 ? 'ZERO_OR_NEGATIVE_RADIUS' : 'NON_FINITE_INPUT' }
    : { mode: 'center-radius', center: P(cx, cy), radius: r, degenerate: null };

/** Center/Diameter: CENTER IS FIXED. Diameter D is a positive finite scalar;
 * if the UI supplies a diameter-magnitude point P from the fixed center C,
 * D = distance(C,P) and radius = D/2. The second point is NOT the opposite
 * endpoint of a diameter (that is 2-Point). Center is returned exactly as
 * supplied, never recomputed.
 * Degeneracy floor: study-only 1e-12 literal mirroring production
 * CAD_XY_DEGENERATE_FLOOR (src/engine/cad/cadGeometryShapeBuilders.ts:7,
 * module-private, NOT exported) — B1 MUST reuse that authority, not this
 * literal; the literal here is non-authoritative. */
export const fromCenterDiameter = (center: CadWorldPoint, diameterPoint: CadWorldPoint): ModeResult => {
  if (!Number.isFinite(center.x + center.y + diameterPoint.x + diameterPoint.y)) {
    return { mode: 'center-diameter', center: null, radius: null, degenerate: 'NON_FINITE_INPUT' };
  }
  const diameter = cadDistance(center, diameterPoint);
  if (diameter <= 1e-12) return { mode: 'center-diameter', center: null, radius: null, degenerate: 'ZERO_DIAMETER' };
  return { mode: 'center-diameter', center: P(center.x, center.y), radius: diameter / 2, degenerate: null };
};

/** 2-Point (diametral): A and B are OPPOSITE ENDPOINTS of a diameter —
 * center = midpoint(A,B), radius = distance(A,B)/2. Deliberately
 * independent from fromCenterDiameter: the half-distance arithmetic is
 * shared mathematics, but the interaction semantics differ (fixed center
 * vs solved center). Degenerate on coincident points. */
export const from2Point = (a: CadWorldPoint, b: CadWorldPoint): ModeResult => {
  if (!Number.isFinite(a.x + a.y + b.x + b.y)) {
    return { mode: '2-point', center: null, radius: null, degenerate: 'NON_FINITE_INPUT' };
  }
  const d = cadDistance(a, b);
  if (d <= 1e-12) return { mode: '2-point', center: null, radius: null, degenerate: 'COINCIDENT_ENDPOINTS' };
  return { mode: '2-point', center: P((a.x + b.x) / 2, (a.y + b.y) / 2), radius: d / 2, degenerate: null };
};

/** 3-Point: circumcenter via perpendicular-bisector determinant; null on collinear. */
export const from3Point = (a: CadWorldPoint, b: CadWorldPoint, d: CadWorldPoint): ModeResult => {
  const det = 2 * (a.x * (b.y - d.y) + b.x * (d.y - a.y) + d.x * (a.y - b.y));
  if (Math.abs(det) <= 1e-12) return { mode: '3-point', center: null, radius: null, degenerate: 'COLLINEAR_OR_COINCIDENT' };
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, d2 = d.x * d.x + d.y * d.y;
  const center = P(
    (a2 * (b.y - d.y) + b2 * (d.y - a.y) + d2 * (a.y - b.y)) / det,
    (a2 * (d.x - b.x) + b2 * (a.x - d.x) + d2 * (b.x - a.x)) / det,
  );
  if (!Number.isFinite(center.x + center.y)) return { mode: '3-point', center: null, radius: null, degenerate: 'NON_FINITE_CENTER' };
  return { mode: '3-point', center, radius: cadDistance(center, a), degenerate: null };
};

export interface TtrAnalysis {
  construction: 'TTR' | 'TTT';
  formula: string; solutions: string; infrastructure: string; verdict: string;
}

/**
 * TTR/TTT are NOT closed-form-single-solution: Apollonius-type systems with
 * 0..8 solutions, needing tangent/offset-curve infrastructure that does not
 * exist as persisted kernels (only point-to-circle tangents exist:
 * cadTangentPointsFromExternalPointToCircle). Deferred past B1.
 */
export const analyzeTtrTtt = (): TtrAnalysis[] => [
  {
    construction: 'TTR',
    formula: 'Centers lie at distance r from both tangents AND |center-P|=r: intersect offset-lines x circle; up to 4 solutions.',
    solutions: 'MULTI (0..4 by tangency side x radius side); radius is an INPUT, disambiguation needs UI pick.',
    infrastructure: 'Needs line-offset + line/circle intersection (exists) composed per side; no persisted tangent-line entity to snap to.',
    verdict: 'DEFER past B1: needs tangent-line derivation + solution picker, not a formula.',
  },
  {
    construction: 'TTT',
    formula: 'Apollonius circle-tangent problem (Soddy circles): 0..8 solutions via Descartes/inversion.',
    solutions: 'MULTI (up to 8); degenerate when inputs concentric/parallel.',
    infrastructure: 'No circle-circle-tangent or offset-curve kernels exist; only point-to-circle tangents (leveraged, insufficient).',
    verdict: 'DEFER past B1: new solver infrastructure, out of smallest-slice scope.',
  },
];

export const recommendB1Slice = (): { slice: string; reason: string } => ({
  slice: 'Center/Radius + Center/Diameter only',
  reason: 'Both are single-solution closed forms with a FIXED center reusing cadPointOnCircle/cadDistance; 2-point is a distinct deferred interaction mode (solved center) that shares only the half-distance primitive; 3-point adds one collinear guard; TTR/TTT need unsolved multi-solution infrastructure.',
});

export const runModesStudy = (): Record<string, unknown> => ({
  centerRadius: fromCenterRadius(100, 200, 50),
  centerRadiusZero: fromCenterRadius(100, 200, 0),
  centerRadiusNegative: fromCenterRadius(100, 200, -5),
  centerDiameter: fromCenterDiameter(P(10, 20), P(40, 20)),
  centerDiameterCoincident: fromCenterDiameter(P(10, 20), P(10, 20)),
  centerDiameterVsTwoPoint: {
    cd: fromCenterDiameter(P(10, 20), P(40, 20)),
    twoPoint: from2Point(P(10, 20), P(40, 20)),
  },
  twoPoint: from2Point(P(10, 20), P(40, 20)),
  threePoint: from3Point(P(150, 200), P(100, 250), P(50, 200)),
  threePointCollinear: from3Point(P(0, 0), P(50, 0), P(100, 0)),
  tangentLeverageProbe: cadTangentPointsFromExternalPointToCircle({ x: 190, y: 200 }, { x: 100, y: 200 }, 50).length,
  ttrTtt: analyzeTtrTtt(),
  recommendation: recommendB1Slice(),
});
