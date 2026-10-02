/**
 * Phase 20L — offset-radius safety study (EVIDENCE ONLY, no `src/` change).
 *
 * A curved source course graded on side L/R by a constant plan distance `d`
 * has an EXACT parallel offset: a concentric arc of signed radius
 * `Roff = R + radialSign·d`. Production does not model that arc — it
 * linearizes the source into chords (`linearizeGradingArc`) and offsets each
 * chord along its OWN frame normal (`analyticTerminalLine`), so the daylight
 * is a chord-parallel polyline, not the exact offset arc. This module studies
 * the exact-vs-chord residual, the `d/R → 1` collapse/inversion boundary, the
 * variable-distance case (`d` not constant along the source), and an
 * independent topology audit of the exact offset strip.
 *
 * Vocabulary (shared study vocabulary, no tolerance-derived sign): every
 * classification is `OFFSET_RADIUS_*`; `Roff` sign is pure exact arithmetic
 * (`radialSignOf`). No production route is added, no gate is wired, no
 * tolerance is redefined. `coordinateAgreementTol` is reused (not changed)
 * only to label when a residual is inside the existing agreement bound.
 *
 * Usage:
 *   npx tsx scripts/phase20lOffsetRadiusAudit.ts   # writes corpus.json
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { linearizeGradingArc } from '../src/engine/cad/grading/gradingCurve';
import { gradingSideNormal } from '../src/engine/cad/grading/gradingCourseFrame';
import { coordinateAgreementTol } from '../src/engine/cad/grading/gradingGroupSectors';
import type { MergePoint, MergedGroupMesh } from '../src/engine/cad/grading/gradingGroupMerge';
import { mesh3dArea, meshPlanArea } from '../src/engine/cad/grading/gradingMesh';
import { validateGradingMeshTopology } from '../src/engine/cad/grading/gradingTopology';
import type { GradingCriterion, GradingSide } from '../src/engine/cad/grading/gradingTypes';
import { auditMesh, geometricDiagnostic, type TopologyAudit } from './phase20kHybridArcPairAudit';

export const OFFSET_RADIUS_CLASSES = [
  'OFFSET_RADIUS_OK',
  'OFFSET_RADIUS_COLLAPSE',
  'OFFSET_RADIUS_INVERTED',
  'OFFSET_RADIUS_NONFINITE',
] as const;

export type OffsetRadiusClass = (typeof OFFSET_RADIUS_CLASSES)[number];

export type VariableDistanceClass =
  | 'OFFSET_SAMPLED_CONSTANT_DISTANCE'
  | 'OFFSET_VARIABLE_DISTANCE_NOT_CIRCULAR';

export interface Pt {
  x: number;
  y: number;
  z: number;
}

/** Circular source course in A→B traversal. Sweep is positive radians. */
export interface StudyArc {
  centerX: number;
  centerY: number;
  radius: number;
  startAngle: number;
  sweepRad: number;
  sweepCCW: boolean;
  startZ: number;
  endZ: number;
}

const DEG = Math.PI / 180;

/**
 * True when the side offset moves AWAY from the circle centre (+1) or toward
 * it (−1). A CCW arc curves left (centre on the left); a CW arc curves right.
 * This is exact geometry — never derived from a tolerance.
 */
export const radialSignOf = (sweepCCW: boolean, side: GradingSide): 1 | -1 =>
  side === (sweepCCW ? 'left' : 'right') ? -1 : 1;

/** Signed parallel offset radius `Roff = R + radialSign·d`. */
export const offsetRadiusOf = (arc: StudyArc, side: GradingSide, distance: number): number =>
  arc.radius + radialSignOf(arc.sweepCCW, side) * distance;

/** Exact sign classification — `roff === 0` is the collapse, not a tolerance. */
export const classifyOffsetRadius = (roff: number): OffsetRadiusClass => {
  if (!Number.isFinite(roff)) return 'OFFSET_RADIUS_NONFINITE';
  if (roff > 0) return 'OFFSET_RADIUS_OK';
  if (roff === 0) return 'OFFSET_RADIUS_COLLAPSE';
  return 'OFFSET_RADIUS_INVERTED';
};

/** Exact point on the concentric curve at arc fraction, offset in Z. */
export const arcPointAt = (arc: StudyArc, frac: number, radius: number, zOffset = 0): Pt => {
  const sign = arc.sweepCCW ? 1 : -1;
  const angle = arc.startAngle + sign * arc.sweepRad * frac;
  return {
    x: arc.centerX + radius * Math.cos(angle),
    y: arc.centerY + radius * Math.sin(angle),
    z: arc.startZ + (arc.endZ - arc.startZ) * frac + zOffset,
  };
};

export const arcEndAngle = (arc: StudyArc): number =>
  arc.startAngle + (arc.sweepCCW ? 1 : -1) * arc.sweepRad;

// ---------------------------------------------------------------------------
// Plan linearization cache (chord samples + unit chord tangents).

interface PlanShape {
  points: Array<{ x: number; y: number }>;
  tangents: Array<{ tx: number; ty: number }>;
  subdivisions: number;
}

const planShapeCache = new Map<string, PlanShape | null>();

const shapeKey = (arc: StudyArc, tolerance: number): string =>
  `${arc.centerX}|${arc.centerY}|${arc.radius}|${arc.startAngle}|${arc.sweepRad}|${arc.sweepCCW}|${tolerance}`;

export const getPlanShape = (arc: StudyArc, tolerance: number): PlanShape | null => {
  const key = shapeKey(arc, tolerance);
  const cached = planShapeCache.get(key);
  if (cached !== undefined) return cached;
  const lin = linearizeGradingArc(
    arc.centerX, arc.centerY, arc.radius, arc.startAngle, arcEndAngle(arc),
    arc.sweepCCW, 0, 0, tolerance,
  );
  if (!lin || lin.points.length < 2) {
    planShapeCache.set(key, null);
    return null;
  }
  const points = lin.points.map((p) => ({ x: p.x, y: p.y }));
  const tangents: Array<{ tx: number; ty: number }> = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    tangents.push({ tx: b.x - a.x, ty: b.y - a.y });
  }
  const shape: PlanShape = { points, tangents, subdivisions: tangents.length };
  planShapeCache.set(key, shape);
  return shape;
};

const residualCache = new Map<string, number | null>();

/**
 * Station-sampled plan distance between the PRODUCTION chord-normal offset
 * polyline and the exact parallel offset curve, evaluated at every
 * linearization station (each interior station contributes both adjacent chord
 * offsets — the seam kink production stitches along its own frame normal).
 * Mid-chord maxima are NOT sampled, so this is a LOWER BOUND on the full-
 * daylight residual, not the full daylight itself. `arguments` order is fixed
 * so the cache key is unambiguous.
 */
export const chordOffsetResidual = (
  arc: StudyArc,
  side: GradingSide,
  distance: number,
  grade: number,
  tolerance: number,
): number | null => {
  const key = `${shapeKey(arc, tolerance)}|${side}|${distance}|${grade}`;
  const cached = residualCache.get(key);
  if (cached !== undefined) return cached;
  const shape = getPlanShape(arc, tolerance);
  if (!shape) {
    residualCache.set(key, null);
    return null;
  }
  const roff = offsetRadiusOf(arc, side, distance);
  let maxResidual = 0;
  const n = shape.subdivisions;
  for (let i = 0; i <= n; i += 1) {
    const exact = arcPointAt(arc, i / n, roff, grade * distance);
    const candidates: Array<{ x: number; y: number; z: number }> = [];
    const add = (chord: number): void => {
      const p = shape.points[i]!;
      const t = shape.tangents[chord]!;
      const norm = gradingSideNormal(t.tx, t.ty, side);
      if (!norm) return;
      candidates.push({ x: p.x + norm.nx * distance, y: p.y + norm.ny * distance, z: exact.z });
    };
    if (i > 0) add(i - 1);
    if (i < n) add(i);
    for (const c of candidates) {
      maxResidual = Math.max(maxResidual, Math.hypot(c.x - exact.x, c.y - exact.y, c.z - exact.z));
    }
  }
  residualCache.set(key, maxResidual);
  return maxResidual;
};

// ---------------------------------------------------------------------------
// §1 parameter matrix.

export const OFFSET_RADII = [1e-3, 10, 60, 100, 252.5, 500, 1e6] as const;
export const OFFSET_SWEEPS_DEG = [1, 5, 45, 90, 135, 179.9] as const;
export const OFFSET_RATIOS = [0, 1e-6, 0.01, 0.1, 0.5, 0.9, 0.999999, 1, 1.000001, 1.1, 2.0] as const;
export const OFFSET_COORDS = [
  { name: 'origin', dx: 0, dy: 0 },
  { name: 'e6', dx: 1e6, dy: 1e6 },
  { name: 'e8', dx: 1e8, dy: 1e8 },
] as const;
export const OFFSET_Z_MODES = [
  { name: 'flat', grade: 0 },
  { name: 'graded', grade: -0.05 },
] as const;

export const MATRIX_CHORD_TOLERANCE = 1;

export interface OffsetRadiusCell {
  id: string;
  radius: number;
  sweepDeg: number;
  sweepCCW: boolean;
  side: GradingSide;
  ratio: number;
  distance: number;
  radialSign: 1 | -1;
  offsetRadius: number;
  classification: OffsetRadiusClass;
  coordinate: string;
  zMode: string;
  start: Pt | null;
  end: Pt | null;
  subdivisions: number;
  residual: number | null;
  finite: boolean;
  detail: string;
}

export const offsetRadiusMatrix = (tolerance = MATRIX_CHORD_TOLERANCE): OffsetRadiusCell[] => {
  const cells: OffsetRadiusCell[] = [];
  for (const radius of OFFSET_RADII) {
    for (const sweepDeg of OFFSET_SWEEPS_DEG) {
      for (const sweepCCW of [true, false]) {
        for (const side of ['left', 'right'] as const) {
          for (const ratio of OFFSET_RATIOS) {
            for (const grade of [0, -0.05]) {
              const distance = ratio * radius;
              const radialSign = radialSignOf(sweepCCW, side);
              const roff = radius + radialSign * distance;
              const classification = classifyOffsetRadius(roff);
              // Every coordinate frame is recomputed NATIVELY (translated
              // centre through the real linearizer + residual), never copied
              // from the origin frame — translation-equivalence is a measured
              // agreement bound (see robust suite), not a construction.
              for (const coord of OFFSET_COORDS) {
                const arc: StudyArc = {
                  centerX: coord.dx, centerY: coord.dy, radius, startAngle: 0.3,
                  sweepRad: sweepDeg * DEG, sweepCCW, startZ: 100,
                  endZ: 100 + grade * radius * sweepDeg * DEG,
                };
                const shape = getPlanShape(arc, tolerance);
                const residual = shape ? chordOffsetResidual(arc, side, distance, grade, tolerance) : null;
                const start = arcPointAt(arc, 0, roff, grade * distance);
                const end = arcPointAt(arc, 1, roff, grade * distance);
                const finite = [start.x, start.y, start.z, end.x, end.y, end.z, roff]
                  .every(Number.isFinite);
                const sweepLabel = sweepCCW ? 'ccw' : 'cw';
                const zLabel = grade === 0 ? 'flat' : 'graded';
                const id = `R${radius}.s${sweepDeg}.${sweepLabel}.${side}.d${ratio}.${coord.name}.${zLabel}`;
                cells.push({
                  id, radius, sweepDeg, sweepCCW, side, ratio, distance, radialSign,
                  offsetRadius: roff, classification, coordinate: coord.name, zMode: zLabel,
                  start: finite ? start : null, end: finite ? end : null,
                  subdivisions: shape?.subdivisions ?? 0,
                  residual, finite, detail: classification,
                });
              }
            }
          }
        }
      }
    }
  }
  return cells;
};

// ---------------------------------------------------------------------------
// §2 variable-distance classification.

export interface TargetSurface {
  kind: 'flat' | 'sloped' | 'ridge';
  z0: number;
  gx: number;
  gy: number;
  k: number;
}

export const targetElevationAt = (surface: TargetSurface, x: number, y: number): number => {
  if (surface.kind === 'flat') return surface.z0;
  if (surface.kind === 'sloped') return surface.z0 + surface.gx * x + surface.gy * y;
  return surface.z0 - surface.k * Math.abs(x) + surface.gy * y;
};

export const VARIABLE_TARGETS: TargetSurface[] = [
  { kind: 'flat', z0: 90, gx: 0, gy: 0, k: 0 },
  { kind: 'sloped', z0: 90, gx: 0.02, gy: 0.01, k: 0 },
  { kind: 'ridge', z0: 90, gx: 0, gy: 0.005, k: 0.05 },
];

const fixedPointDistance = (
  surface: TargetSurface,
  srcZ: number,
  sx: number,
  sy: number,
  nx: number,
  ny: number,
  pickGrade: (_targetZ: number) => number,
): { distance: number; grade: number } => {
  let d = (targetElevationAt(surface, sx, sy) - srcZ) / pickGrade(targetElevationAt(surface, sx, sy));
  let grade = pickGrade(targetElevationAt(surface, sx + nx * d, sy + ny * d));
  for (let it = 0; it < 8 && Number.isFinite(d); it += 1) {
    const targetZ = targetElevationAt(surface, sx + nx * d, sy + ny * d);
    grade = pickGrade(targetZ);
    if (!Number.isFinite(grade) || grade === 0) break;
    d = (targetZ - srcZ) / grade;
  }
  return { distance: Number.isFinite(d) ? d : Number.NaN, grade };
};


export const VARIABLE_CRITERIA: GradingCriterion[] = [
  { kind: 'fixed', gradeRatio: -0.5 },
  { kind: 'distance', gradeRatio: -0.5, distance: 20 },
  { kind: 'elevation', gradeRatio: -0.5, targetElevation: 90 },
  { kind: 'relative-elevation', gradeRatio: -0.5, relativeElevation: -10 },
  { kind: 'cut-fill', cutGradeRatio: -0.5, fillGradeRatio: -0.3 },
];

export interface VariableDistanceRow {
  id: string;
  criterion: string;
  target: string;
  sourceZ: 'flat' | 'graded';
  dMin: number;
  dMax: number;
  dRange: number;
  sideChange: boolean;
  classification: VariableDistanceClass;
  stations: number[];
}

export const variableDistanceStudy = (
  stations = 9,
  radius = 100,
  sweepDeg = 90,
): VariableDistanceRow[] => {
  const rows: VariableDistanceRow[] = [];
  for (const sourceZ of ['flat', 'graded'] as const) {
    const grade = sourceZ === 'graded' ? -0.08 : 0;
    const arc: StudyArc = {
      centerX: 0, centerY: 0, radius, startAngle: 0.3, sweepRad: sweepDeg * DEG,
      sweepCCW: true, startZ: 100, endZ: 100 + grade * radius * sweepDeg * DEG,
    };
    for (const target of VARIABLE_TARGETS) {
      for (const criterion of VARIABLE_CRITERIA) {
        const ds: number[] = [];
        let rowSawAbove = false;
        let rowSawBelow = false;
        for (let i = 0; i <= stations; i += 1) {
          const frac = i / stations;
          const p = arcPointAt(arc, frac, radius, 0);
          const next = arcPointAt(arc, Math.min(1, frac + 0.01), radius, 0);
          const norm = gradingSideNormal(next.x - p.x, next.y - p.y, 'right');
          const n = norm ?? { nx: 0, ny: 1 };
          let d: number;
          if (criterion.kind === 'distance') {
            d = criterion.distance;
          } else if (criterion.kind === 'relative-elevation') {
            d = criterion.relativeElevation / criterion.gradeRatio;
          } else if (criterion.kind === 'elevation') {
            d = (criterion.targetElevation - p.z) / criterion.gradeRatio;
          } else if (criterion.kind === 'fixed') {
            d = fixedPointDistance(target, p.z, p.x, p.y, n.nx, n.ny, () => criterion.gradeRatio).distance;
          } else {
            const solved = fixedPointDistance(target, p.z, p.x, p.y, n.nx, n.ny, (tz) => {
              if (tz >= p.z) { rowSawAbove = true; return criterion.cutGradeRatio; }
              rowSawBelow = true;
              return criterion.fillGradeRatio;
            });
            d = solved.distance;
          }
          ds.push(d);
        }
        const sideChange = rowSawAbove && rowSawBelow;
        const dMin = Math.min(...ds);
        const dMax = Math.max(...ds);
        const range = dMax - dMin;
        // Sampled-only constancy: d is evaluated at `stations + 1` discrete
        // stations, so equality here proves nothing about the BETWEEN-station
        // gaps (a fixed/distance-law d is constant by construction; anything
        // else varying between samples escapes detection). Exact `range === 0`
        // — no tolerance band certifies circularity.
        const constant = Number.isFinite(range) && range === 0;
        rows.push({
          id: `${sourceZ}.${target.kind}.${criterion.kind}`,
          criterion: criterion.kind,
          target: target.kind,
          sourceZ,
          dMin, dMax, dRange: range,
          sideChange,
          classification: constant
            ? 'OFFSET_SAMPLED_CONSTANT_DISTANCE'
            : 'OFFSET_VARIABLE_DISTANCE_NOT_CIRCULAR',
          stations: ds,
        });
      }
    }
  }
  return rows;
};

// ---------------------------------------------------------------------------
// §3 production comparison (observe only).

export interface ConvergenceRow {
  tolerance: number;
  subdivisions: number;
  residual: number;
}

export const productionConvergence = (
  tolerances: readonly number[] = [25, 10, 1, 0.1, 0.01, 0.001],
): ConvergenceRow[] => {
  const arc: StudyArc = {
    centerX: 0, centerY: 0, radius: 252.5, startAngle: 0.3, sweepRad: 90 * DEG,
    sweepCCW: true, startZ: 10, endZ: 10,
  };
  return tolerances.map((tolerance) => {
    const shape = getPlanShape(arc, tolerance);
    const residual = chordOffsetResidual(arc, 'right', 20, 0, tolerance);
    return { tolerance, subdivisions: shape?.subdivisions ?? 0, residual: residual ?? Number.NaN };
  });
};

export interface CollapseApproachRow {
  ratio: number;
  distance: number;
  offsetRadius: number;
  classification: OffsetRadiusClass;
  curvature: number | null;
  residual: number | null;
}

export const collapseApproach = (
  ratios: readonly number[] = [0.5, 0.9, 0.99, 0.999, 0.9999, 0.999999],
  radius = 60,
): CollapseApproachRow[] => {
  const arc: StudyArc = {
    centerX: 0, centerY: 0, radius, startAngle: 0.3, sweepRad: 90 * DEG,
    sweepCCW: true, startZ: 10, endZ: 10,
  };
  return ratios.map((ratio) => {
    const distance = ratio * radius;
    const roff = offsetRadiusOf(arc, 'left', distance);
    return {
      ratio, distance, offsetRadius: roff,
      classification: classifyOffsetRadius(roff),
      curvature: roff !== 0 ? 1 / roff : null,
      residual: chordOffsetResidual(arc, 'left', distance, 0, 0.1),
    };
  });
};

// ---------------------------------------------------------------------------
// §5 tolerance audit: exact zero vs agreement vs conditioning vs policy.

export interface ToleranceAuditRow {
  id: string;
  radius: number;
  sweepDeg: number;
  ratio: number;
  distance: number;
  offsetRadius: number;
  classification: OffsetRadiusClass;
  curvature: number | null;
  exactZero: boolean;
  conditioning: boolean;
  agreement: boolean;
  policyGate: string;
  residual: number | null;
  offsetSubdivisions: number | null;
  note: string;
}

export const toleranceAudit = (tolerance = 0.1): ToleranceAuditRow[] => {
  const cases: Array<{ id: string; radius: number; sweepDeg: number; ratio: number; coord: number }> = [
    { id: 'near-collapse-0.9', radius: 60, sweepDeg: 90, ratio: 0.9, coord: 0 },
    { id: 'near-collapse-0.99', radius: 60, sweepDeg: 90, ratio: 0.99, coord: 0 },
    { id: 'near-collapse-0.999', radius: 60, sweepDeg: 90, ratio: 0.999, coord: 0 },
    { id: 'near-collapse-0.9999', radius: 60, sweepDeg: 90, ratio: 0.9999, coord: 0 },
    { id: 'exact-collapse-1', radius: 60, sweepDeg: 90, ratio: 1, coord: 0 },
    { id: 'inverted-1p000001', radius: 60, sweepDeg: 90, ratio: 1.000001, coord: 0 },
    { id: 'inverted-1.1', radius: 60, sweepDeg: 90, ratio: 1.1, coord: 0 },
    { id: 'near-tangent-179.9', radius: 60, sweepDeg: 179.9, ratio: 0.5, coord: 0 },
    { id: 'large-coord-e8', radius: 252.5, sweepDeg: 90, ratio: 0.5, coord: 1e8 },
  ];
  return cases.map(({ id, radius, sweepDeg, ratio, coord }) => {
    const arc: StudyArc = {
      centerX: coord, centerY: coord, radius, startAngle: 0.3, sweepRad: sweepDeg * DEG,
      sweepCCW: true, startZ: 100, endZ: 100,
    };
    const distance = ratio * radius;
    const roff = offsetRadiusOf(arc, 'left', distance);
    const classification = classifyOffsetRadius(roff);
    const residual = chordOffsetResidual(arc, 'left', distance, 0, tolerance);
    const exactZero = roff === 0;
    const conditioning = roff > 0 && roff < tolerance;
    const worldScale = Math.max(1, Math.abs(arc.centerX), Math.abs(arc.centerY));
    // Exact-vs-exact agreement: the same offset point built from the circle
    // radius (`arcPointAt`) and from the TRUE source normal at the first
    // station (`S + d·N`) must agree inside the shared coordinate bound. The
    // chord tangent is deliberately NOT used (its half-step rotation is the
    // discretization residual, not a numerical agreement).
    const dir = arc.sweepCCW ? 1 : -1;
    const trueTangent = { tx: -dir * Math.sin(arc.startAngle), ty: dir * Math.cos(arc.startAngle) };
    const norm = gradingSideNormal(trueTangent.tx, trueTangent.ty, 'left');
    let agreement = false;
    if (norm) {
      const sourceStart = arcPointAt(arc, 0, arc.radius, 0);
      const exactStart = arcPointAt(arc, 0, roff, 0);
      const normalStart = {
        x: sourceStart.x + norm.nx * distance,
        y: sourceStart.y + norm.ny * distance,
      };
      const gap = Math.hypot(exactStart.x - normalStart.x, exactStart.y - normalStart.y);
      agreement = gap <= coordinateAgreementTol(gap, 0, worldScale);
    }
    const policyGate = exactZero
      ? 'OFFSET_RADIUS_COLLAPSE_GATE'
      : roff < 0
        ? 'OFFSET_RADIUS_ORIENTATION_GATE'
        : conditioning
          ? 'OFFSET_RADIUS_CONDITIONING_REVIEW'
          : 'NONE_STUDY_RECOMMENDATION';
    return {
      id, radius, sweepDeg, ratio, distance, offsetRadius: roff, classification,
      curvature: roff !== 0 ? 1 / roff : null,
      exactZero, conditioning, agreement, policyGate, residual,
      offsetSubdivisions: roff > 0 ? subdivisionsFor(Math.abs(roff), arc.sweepRad, tolerance) : null,
      note: exactZero
        ? 'exact point collapse (Roff=0)'
        : conditioning
          ? 'sub-tolerance offset radius: offset arc under-resolved by the source chord budget'
          : agreement
            ? 'residual inside the shared coordinate agreement bound'
            : 'residual outside the agreement bound',
    };
  });
};

const subdivisionsFor = (radius: number, sweepRad: number, tolerance: number): number => {
  if (!(radius > 0) || !(tolerance > 0)) return 1;
  if (tolerance >= 2 * radius) return 1;
  const halfStep = Math.acos(Math.min(1, Math.max(-1, 1 - tolerance / radius)));
  if (!(halfStep > 0)) return 1;
  return Math.max(1, Math.ceil(sweepRad / (2 * halfStep)));
};

// ---------------------------------------------------------------------------
// §4 independent topology audit on the exact offset strip.

export interface OffsetBand {
  arc: StudyArc;
  side: GradingSide;
  distance: number;
  offsetRadius: number;
  mesh: MergedGroupMesh;
  daylight: MergePoint[];
  vertices: number;
  triangles: number;
  planArea: number;
  analyticPlanArea: number;
  planAreaRelError: number;
  area3d: number;
  audit: TopologyAudit;
  topology: ReturnType<typeof validateGradingMeshTopology>;
  diagnostic: string;
}

export type OffsetBandResult =
  | ({ ok: true } & OffsetBand)
  | { ok: false; code: OffsetRadiusClass; detail: string };

const emitCcw = (
  points: number[],
  triangles: number[],
  a: number,
  b: number,
  c: number,
): void => {
  const area2 =
    (points[b * 3]! - points[a * 3]!) * (points[c * 3 + 1]! - points[a * 3 + 1]!) -
    (points[c * 3]! - points[a * 3]!) * (points[b * 3 + 1]! - points[a * 3 + 1]!);
  if (Math.abs(area2) === 0) return;
  if (area2 > 0) triangles.push(a, b, c);
  else triangles.push(a, c, b);
};

/**
 * Build the exact offset strip between the source course and its exact
 * parallel offset curve, then audit it independently (`auditMesh`) and with
 * the production topology validator (`validateGradingMeshTopology`). The
 * band is only built when `Roff > 0`; a collapse/inversion claims nothing.
 */
export const buildOffsetBand = (
  arc: StudyArc,
  side: GradingSide,
  distance: number,
  tolerance: number,
  grade = 0,
): OffsetBandResult => {
  const arcFields = [arc.centerX, arc.centerY, arc.radius, arc.startAngle, arc.sweepRad, arc.startZ, arc.endZ];
  if (!arcFields.every(Number.isFinite) || !(arc.radius > 0) || !(arc.sweepRad > 0)) {
    return { ok: false, code: 'OFFSET_RADIUS_NONFINITE', detail: 'nonfinite-or-invalid-arc' };
  }
  if (!Number.isFinite(tolerance) || !(tolerance > 0) || !Number.isFinite(grade)) {
    return { ok: false, code: 'OFFSET_RADIUS_NONFINITE', detail: `nonfinite-input tol=${tolerance} grade=${grade}` };
  }
  if (!Number.isFinite(distance) || distance < 0) {
    return { ok: false, code: 'OFFSET_RADIUS_NONFINITE', detail: `negative-or-nonfinite-distance d=${distance}` };
  }
  const shape = getPlanShape(arc, tolerance);
  if (!shape) return { ok: false, code: 'OFFSET_RADIUS_NONFINITE', detail: 'linearize-null' };
  const roff = offsetRadiusOf(arc, side, distance);
  // EXACT sign gating: tolerances govern agreement only, never physical sign.
  // Distance was prevalidated finite and non-negative above, so only Roff
  // (finite-input arithmetic overflow) is re-checked here; a d = 0 band is
  // zero area and claims nothing below.
  if (!Number.isFinite(roff)) {
    return { ok: false, code: 'OFFSET_RADIUS_NONFINITE', detail: `nonfinite-input d=${distance} Roff=${roff}` };
  }
  if (distance === 0) {
    return { ok: false, code: 'OFFSET_RADIUS_OK', detail: 'zero-distance-zero-area' };
  }
  if (roff <= 0) {
    return { ok: false, code: classifyOffsetRadius(roff), detail: `Roff=${roff}` };
  }
  const n = shape.subdivisions;
  const source: Pt[] = [];
  const offset: Pt[] = [];
  for (let i = 0; i <= n; i += 1) {
    const frac = i / n;
    source.push(arcPointAt(arc, frac, arc.radius, 0));
    offset.push(arcPointAt(arc, frac, roff, grade * distance));
  }
  const points: number[] = [];
  for (const p of source) points.push(p.x, p.y, p.z);
  for (const p of offset) points.push(p.x, p.y, p.z);
  const triangles: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const s0 = i;
    const s1 = i + 1;
    const o0 = n + 1 + i;
    const o1 = n + 1 + i + 1;
    emitCcw(points, triangles, s0, s1, o1);
    emitCcw(points, triangles, s0, o1, o0);
  }
  const mesh: MergedGroupMesh = { points, triangles };
  const daylight: MergePoint[] = offset.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  if (!points.every(Number.isFinite) || !daylight.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))) {
    return { ok: false, code: 'OFFSET_RADIUS_NONFINITE', detail: 'nonfinite-generated-geometry' };
  }
  const planArea = meshPlanArea(points, triangles);
  const analyticPlanArea = 0.5 * arc.sweepRad * Math.abs(roff * roff - arc.radius * arc.radius);
  const area3dEarly = mesh3dArea(points, triangles);
  if (![planArea, analyticPlanArea, area3dEarly].every(Number.isFinite) || !(planArea > 0)) {
    return { ok: false, code: 'OFFSET_RADIUS_NONFINITE', detail: `invalid-area plan=${planArea}` };
  }
  const planAreaRelError = analyticPlanArea > 0
    ? Math.abs(planArea - analyticPlanArea) / analyticPlanArea
    : 0;
  const audit = auditMesh(mesh, daylight, false, planArea);
  const topology = validateGradingMeshTopology(points, triangles);
  // A strip that fails either audit claims nothing: failed-topology returns
  // ok:false, never ok:true — a PASS must be earned, not constructed.
  if (!audit.pass || !topology.ok) {
    return { ok: false, code: 'OFFSET_RADIUS_OK', detail: `topology-fail(${audit.issues.join(';')})` };
  }
  return {
    ok: true, arc, side, distance, offsetRadius: roff, mesh, daylight,
    vertices: points.length / 3, triangles: triangles.length / 3,
    planArea, analyticPlanArea, planAreaRelError,
    area3d: mesh3dArea(points, triangles),
    audit, topology,
    diagnostic: geometricDiagnostic(mesh).summary,
  };
};

// ---------------------------------------------------------------------------
// §6 corpus (bounded rows, byte-identical across runs).

export const DEFAULT_CORPUS_OUT = join(
  dirname(process.argv[1] ?? '.'),
  '..',
  'docs',
  'evidence',
  'phase20l',
  'offset-radius-corpus.json',
);

export const sha16 = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

export interface CorpusRow20L {
  id: string;
  category: string;
  radius: number;
  sweepDeg: number;
  sweepCCW: boolean;
  side: GradingSide;
  distance: number;
  ratio: number;
  offsetRadius: number;
  classification: OffsetRadiusClass | VariableDistanceClass;
  endpoints: { start: Pt; end: Pt } | null;
  residual: number | null;
  joinClass: string;
  extent: number | null;
  topology: string | null;
  counts: { vertices: number; triangles: number } | null;
  areas: { plan: number; analyticPlan: number; threeD: number } | null;
  detail: string | null;
  digest: string;
}

// No adjacent join is solved in this track: join class stays deferred (or
// not-applicable off the buildable strip) and extent stays null. The arc
// length |Roff|·sweep is a single-member property, never a join extent.
const joinClassOf = (classification: OffsetRadiusClass): string =>
  classification === 'OFFSET_RADIUS_OK' ? 'OFFSET_JOIN_DEFERRED' : 'OFFSET_JOIN_NOT_APPLICABLE';

interface CorpusArcFixture {
  id: string;
  category: string;
  arc: StudyArc;
  side: GradingSide;
  ratio: number;
  grade: number;
  tolerance: number;
  build: boolean;
}

const corpusFixture = (
  id: string,
  category: string,
  radius: number,
  sweepDeg: number,
  sweepCCW: boolean,
  side: GradingSide,
  ratio: number,
  grade = 0,
  tolerance = 0.1,
  build = false,
): CorpusArcFixture => ({
  id, category,
  arc: {
    centerX: 0, centerY: 0, radius, startAngle: 0.3, sweepRad: sweepDeg * DEG,
    sweepCCW, startZ: 100, endZ: 100 + grade * radius * sweepDeg * DEG,
  },
  side, ratio, grade, tolerance, build,
});

export const buildPhase20lCorpus = (): { generated: string; rows: CorpusRow20L[]; summary: Record<string, unknown> } => {
  const fixtures: CorpusArcFixture[] = [
    corpusFixture('origin.R252.5.s90.ccw.right.d20', 'matrix', 252.5, 90, true, 'right', 20 / 252.5, 0, 0.1, true),
    corpusFixture('origin.R60.s12.ccw.right.d6', 'matrix', 60, 12, true, 'right', 0.1, 0, 0.5, true),
    corpusFixture('origin.R60.s179.9.ccw.left.d30', 'matrix', 60, 179.9, true, 'left', 0.5, -0.05, 0.5, true),
    corpusFixture('e6.R100.s45.cw.right.d50', 'matrix-large-coord', 100, 45, false, 'right', 0.5, 0, 0.5, false),
    corpusFixture('e8.R500.s90.ccw.right.d100', 'matrix-large-coord', 500, 90, true, 'right', 0.2, 0, 0.5, false),
    corpusFixture('collapse.R60.s90.ccw.left.d60', 'boundary', 60, 90, true, 'left', 1, 0, 0.1, false),
    corpusFixture('inverted.R60.s90.ccw.left.d66', 'boundary', 60, 90, true, 'left', 1.1, 0, 0.1, false),
    corpusFixture('tiny.R0.001.s5.ccw.right.d0.0005', 'boundary', 1e-3, 5, true, 'right', 0.5, 0, 0.5, false),
    corpusFixture('large.R1e6.s90.ccw.right.d1e5', 'boundary', 1e6, 90, true, 'right', 0.1, 0, 1, false),
  ];
  const rows: CorpusRow20L[] = [];
  for (const fx of fixtures) {
    const distance = fx.ratio * fx.arc.radius;
    const roff = offsetRadiusOf(fx.arc, fx.side, distance);
    const classification = classifyOffsetRadius(roff);
    const start = arcPointAt(fx.arc, 0, roff, fx.grade * distance);
    const end = arcPointAt(fx.arc, 1, roff, fx.grade * distance);
    const residual = chordOffsetResidual(fx.arc, fx.side, distance, fx.grade, fx.tolerance);
    let topology: string | null = classification;
    let counts: { vertices: number; triangles: number } | null = null;
    let areas: { plan: number; analyticPlan: number; threeD: number } | null = null;
    let detail: string | null = classification;
    if (fx.build && classification === 'OFFSET_RADIUS_OK') {
      const band = buildOffsetBand(fx.arc, fx.side, distance, fx.tolerance, fx.grade);
      if (band.ok) {
        topology = band.audit.pass ? 'PASS' : `FAIL(${band.audit.issues.join(';')})`;
        counts = { vertices: band.vertices, triangles: band.triangles };
        areas = { plan: band.planArea, analyticPlan: band.analyticPlanArea, threeD: band.area3d };
        detail = `subdiv=${fx.arc.radius > 0 ? getPlanShape(fx.arc, fx.tolerance)?.subdivisions ?? 0 : 0} ` +
          `areaRelError=${band.planAreaRelError.toExponential(3)} ${band.diagnostic}`;
      } else {
        topology = `NOT_BUILT(${band.code})`;
        detail = band.detail;
      }
    }
    const row: Omit<CorpusRow20L, 'digest'> = {
      id: fx.id, category: fx.category,
      radius: fx.arc.radius, sweepDeg: (fx.arc.sweepRad / DEG), sweepCCW: fx.arc.sweepCCW, side: fx.side,
      distance, ratio: fx.ratio, offsetRadius: roff, classification,
      endpoints: { start, end }, residual,
      joinClass: joinClassOf(classification),
      extent: null,
      topology, counts, areas, detail,
    };
    rows.push({ ...row, digest: sha16(row) });
  }
  // Variable-distance rows (not circular, never forced into Roff).
  for (const v of variableDistanceStudy()) {
    const row: Omit<CorpusRow20L, 'digest'> = {
      id: `variable.${v.id}`.replace(/\.fixed$/, ''),
      category: `variable-${v.target}`,
      radius: 100, sweepDeg: 90, sweepCCW: true, side: 'right',
      distance: v.dMin, ratio: v.dMin / 100, offsetRadius: Number.NaN,
      classification: v.classification,
      endpoints: null, residual: null,
      joinClass: 'NON_CIRCULAR',
      extent: null, topology: v.classification,
      counts: null, areas: null,
      detail: `samples=${v.stations.length} dRange=${v.dRange.toExponential(3)} sideChange=${v.sideChange}`,
    };
    rows.push({ ...row, digest: sha16(row) });
  }
  // Tolerance-audit rows.
  for (const t of toleranceAudit()) {
    const roff = t.offsetRadius;
    const arc: StudyArc = {
      centerX: 0, centerY: 0, radius: t.radius, startAngle: 0.3, sweepRad: t.sweepDeg * DEG,
      sweepCCW: true, startZ: 100, endZ: 100,
    };
    const row: Omit<CorpusRow20L, 'digest'> = {
      id: `tolerance.${t.id}`,
      category: 'tolerance',
      radius: t.radius, sweepDeg: t.sweepDeg, sweepCCW: true, side: 'left',
      distance: t.distance, ratio: t.ratio, offsetRadius: roff, classification: t.classification,
      endpoints: {
        start: arcPointAt(arc, 0, roff, 0),
        end: arcPointAt(arc, 1, roff, 0),
      },
      residual: t.residual,
      joinClass: joinClassOf(t.classification),
      extent: null,
      topology: t.classification,
      counts: null, areas: null,
      detail: `${t.policyGate}: ${t.note}`,
    };
    rows.push({ ...row, digest: sha16(row) });
  }
  const classificationCounts: Record<string, number> = {};
  for (const r of rows) classificationCounts[r.classification] = (classificationCounts[r.classification] ?? 0) + 1;
  return {
    generated: 'phase20l-offset-radius',
    rows,
    summary: {
      total: rows.length,
      classifications: classificationCounts,
      buildable: rows.filter((r) => r.topology === 'PASS').length,
      categories: [...new Set(rows.map((r) => r.category))],
    },
  };
};

export const writePhase20lCorpus = (out = process.env.PHASE20L_CORPUS_OUT ?? DEFAULT_CORPUS_OUT): void => {
  const payload = buildPhase20lCorpus();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`phase20l corpus: ${payload.rows.length} rows → ${out}`);
};

const invokedDirectly = process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].split('/').pop()!);
if (invokedDirectly) {
  const matrix = offsetRadiusMatrix();
  const variable = variableDistanceStudy();
  const convergence = productionConvergence();
  writePhase20lCorpus();
  console.log(`  matrix: ${matrix.length} cells, ${matrix.filter((c) => c.finite).length} finite`);
  console.log(`  variable: ${variable.filter((v) => v.classification !== 'OFFSET_SAMPLED_CONSTANT_DISTANCE').length}/${variable.length} non-circular`);
  console.log(`  convergence: ${convergence.map((r) => `${r.tolerance}:${r.residual?.toExponential(2)}`).join(' ')}`);
}
