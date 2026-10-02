/**
 * Phase 20L Worker-CORE — offset-radius safety core (STUDY, measurement only).
 *
 * No production route, no `src/` change, no new tolerance or threshold. The
 * parallel-offset question for a circular source arc is answered here with
 * exact concentric-circle geometry; the offset-joint/miter solve belongs to
 * the joins track and is represented here by stub classification only.
 *
 * Preserved 20K symbolic control: Roffset = R + radialSign·d with
 * radialSign = +1 (right) / −1 (left), ratios [0.1, 0.5, 0.9, 1.0, 1.1],
 * R = 60 left-side d/R < 1 ok, = 1 collapse, > 1 inversion, every row
 * resolver-null and symbolic-only. That control is kept verbatim under the
 * new explicit vocabulary; it is NOT rewritten.
 *
 * Exact parallel offset arc (constant distance d toward `side`):
 * same center C, Roff = R + s·d where the sign s comes from the production
 * side-normal authority (`gradingSideNormal` on the traversal tangent,
 * dotted with the radial direction). Endpoints are source endpoints shifted
 * by the signed normal through `fromLocalFrame`; the offset arc does NOT
 * pass through the source joint V. Variable distance is flagged
 * OFFSET_VARIABLE_DISTANCE_NOT_CIRCULAR and never solved here.
 *
 * Usage:
 *   npx tsx scripts/phase20lOffsetRadiusCore.ts
 *   PHASE20L_CORE_OUT=/tmp/core.json npx tsx scripts/phase20lOffsetRadiusCore.ts
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  fromLocalFrame,
  gradingSideNormal,
  type PlanVector,
} from '../src/engine/cad/grading/gradingCourseFrame';
import { linearizeGradingArc } from '../src/engine/cad/grading/gradingCurve';
import type { GradingSide, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';
import { coordinateAgreementTol } from '../src/engine/cad/grading/gradingGroupSectors';
import { zeroDelta } from '../src/engine/cad/surfaces/volume/zero';

/* ════════════════ §2 — geometry objects ════════════════ */

/** Circular source arc: center C, radius R, sweep from startAngle. */
export interface SourceArc {
  centerX: number;
  centerY: number;
  radius: number;
  startAngle: number;
  /** Sweep magnitude in degrees (> 0). */
  sweepDeg: number;
  sweepCCW: boolean;
  startZ: number;
  endZ: number;
}

/** Exact constant-distance parallel of a source arc (Roff > 0 only). */
export interface OffsetArc {
  centerX: number;
  centerY: number;
  radiusOffset: number;
  startAngle: number;
  endAngle: number;
  sweepCCW: boolean;
  /** Signed radial delta s·d with s from the side-normal authority. */
  signedDelta: number;
  /** +1 when the side normal points radially outward along traversal. */
  radialSign: 1 | -1;
}

/* ════════════════ §4 — bounded classifications ════════════════ */

export type OffsetRadiusClass =
  | 'OFFSET_RADIUS_OK'
  | 'OFFSET_RADIUS_COLLAPSE'
  | 'OFFSET_RADIUS_INVERTED'
  | 'OFFSET_RADIUS_NONFINITE';

/** Join-solve ownership stays with the joins track: stub only, never solved here. */
export type OffsetJoinClass = 'OFFSET_JOIN_DEFERRED' | 'OFFSET_JOIN_NOT_APPLICABLE';

export type OffsetPolicy = 'OFFSET_POLICY_NONE' | 'OFFSET_POLICY_REQUIRED';

export const OFFSET_VARIABLE_DISTANCE_NOT_CIRCULAR = 'OFFSET_VARIABLE_DISTANCE_NOT_CIRCULAR' as const;

const finiteAll = (values: number[]): boolean => values.every((v) => Number.isFinite(v));

const classifyRadius = (radiusOffset: number): OffsetRadiusClass => {
  // Fail closed on finite-input arithmetic overflow: R + s·d can round
  // to ±Infinity for huge finite inputs, and +Infinity must never read OK.
  if (!Number.isFinite(radiusOffset)) return 'OFFSET_RADIUS_NONFINITE';
  return radiusOffset > 0
    ? 'OFFSET_RADIUS_OK'
    : radiusOffset === 0 ? 'OFFSET_RADIUS_COLLAPSE' : 'OFFSET_RADIUS_INVERTED';
};

/**
 * 20K symbolic control, preserved verbatim: radialSign = +1 right / −1 left,
 * Roffset = R + radialSign·d. No geometry, no resolver, symbolic-only.
 */
export const symbolicOffsetRadius = (
  radius: number,
  side: GradingSide,
  offsetDistance: number,
): { radiusOffset: number; classification: OffsetRadiusClass } => {
  if (!finiteAll([radius, offsetDistance]) || !(radius > 0) || !(offsetDistance >= 0)) {
    return { radiusOffset: NaN, classification: 'OFFSET_RADIUS_NONFINITE' };
  }
  const radialSign: 1 | -1 = side === 'right' ? 1 : -1;
  const radiusOffset = radius + radialSign * offsetDistance;
  return { radiusOffset, classification: classifyRadius(radiusOffset) };
};

export interface SymbolicOffsetRow {
  side: GradingSide;
  ratio: number;
  radialSign: 1 | -1;
  offsetDistance: number;
  radiusOffset: number;
  classification: OffsetRadiusClass;
  outcome: null;
  detail: string;
}

/** Preserved 20K control rows: R = 60, ratios, resolver-null, symbolic-only. */
export const symbolicOffsetRows = (
  radius = 60,
  ratios: readonly number[] = [0.1, 0.5, 0.9, 1.0, 1.1],
): SymbolicOffsetRow[] => {
  const rows: SymbolicOffsetRow[] = [];
  for (const side of ['right', 'left'] as const) {
    for (const ratio of ratios) {
      const offsetDistance = ratio * radius;
      const { radiusOffset, classification } = symbolicOffsetRadius(radius, side, offsetDistance);
      rows.push({
        side, ratio,
        radialSign: side === 'right' ? 1 : -1,
        offsetDistance, radiusOffset, classification,
        outcome: null,
        detail: 'symbolic-only: resolver not run (offset arc joint leaves V)',
      });
    }
  }
  return rows;
};

/* ════════════════ exact parallel offset (constant distance) ════════════════ */

const TAU = Math.PI * 2;

/** Independent traversal unit tangent at `angle` (CCW (−sin,cos), CW negated). */
export const traversalTangentAt = (sweepCCW: boolean, angle: number): PlanVector => {
  const dir = sweepCCW ? 1 : -1;
  return { nx: -dir * Math.sin(angle), ny: dir * Math.cos(angle) };
};

/** Independent point on the source circle at `angle`. */
export const sourcePointAt = (arc: SourceArc, angle: number): { x: number; y: number } => ({
  x: arc.centerX + arc.radius * Math.cos(angle),
  y: arc.centerY + arc.radius * Math.sin(angle),
});

const sweepRadOf = (arc: SourceArc): number | null => {
  if (!finiteAll([arc.centerX, arc.centerY, arc.radius, arc.startAngle, arc.sweepDeg, arc.startZ, arc.endZ])) {
    return null;
  }
  if (!(arc.radius > 0) || !(arc.sweepDeg > 0) || arc.sweepDeg > 360) return null;
  return (arc.sweepDeg * Math.PI) / 180;
};

export const endAngleOf = (arc: SourceArc): number | null => {
  const sweep = sweepRadOf(arc);
  if (sweep === null) return null;
  return arc.startAngle + (arc.sweepCCW ? 1 : -1) * sweep;
};

export type ExactOffsetResult =
  | { ok: true; arc: OffsetArc; classification: 'OFFSET_RADIUS_OK' }
  | { ok: false; classification: Exclude<OffsetRadiusClass, 'OFFSET_RADIUS_OK'>; radiusOffset: number };

/**
 * Exact constant-distance parallel of a circular source arc. The radial
 * sign is measured, not hardcoded: N = gradingSideNormal(T, side) dotted
 * with the radial direction (CCW right → +1 outward; CW right → −1
 * inward). Endpoints shift by the signed normal through `fromLocalFrame`
 * on a unit tangent source, so the shift itself routes via production.
 * Roff = 0 collapses to the center; Roff < 0 is unrepresentable in the
 * same orientation (it would need a sweep-sense flip + π shift).
 */
export const exactParallelOffset = (
  source: SourceArc,
  side: GradingSide,
  offsetDistance: number,
): ExactOffsetResult => {
  const sweep = sweepRadOf(source);
  const endAngle = endAngleOf(source);
  if (sweep === null || endAngle === null || !Number.isFinite(offsetDistance) || !(offsetDistance >= 0)) {
    return { ok: false, classification: 'OFFSET_RADIUS_NONFINITE', radiusOffset: NaN };
  }
  const t = traversalTangentAt(source.sweepCCW, source.startAngle);
  const n = gradingSideNormal(t.nx, t.ny, side);
  if (!n) return { ok: false, classification: 'OFFSET_RADIUS_NONFINITE', radiusOffset: NaN };
  const rx = Math.cos(source.startAngle);
  const ry = Math.sin(source.startAngle);
  const dot = n.nx * rx + n.ny * ry;
  if (!Number.isFinite(dot) || Math.abs(Math.abs(dot) - 1) > 1e-9) {
    return { ok: false, classification: 'OFFSET_RADIUS_NONFINITE', radiusOffset: NaN };
  }
  const radialSign: 1 | -1 = dot > 0 ? 1 : -1;
  const signedDelta = radialSign * offsetDistance;
  const radiusOffset = source.radius + signedDelta;
  const classification = classifyRadius(radiusOffset);
  if (classification !== 'OFFSET_RADIUS_OK') {
    return { ok: false, classification, radiusOffset };
  }
  return {
    ok: true,
    classification,
    arc: {
      centerX: source.centerX, centerY: source.centerY, radiusOffset,
      startAngle: source.startAngle, endAngle, sweepCCW: source.sweepCCW,
      signedDelta, radialSign,
    },
  };
};

/** Source endpoint shifted by the signed side normal via `fromLocalFrame`. */
export const shiftedEndpoint = (
  source: SourceArc,
  atEnd: boolean,
  side: GradingSide,
  offsetDistance: number,
): { x: number; y: number } | null => {
  const endAngle = endAngleOf(source);
  if (endAngle === null || !Number.isFinite(offsetDistance)) return null;
  const angle = atEnd ? endAngle : source.startAngle;
  const p = sourcePointAt(source, angle);
  const t = traversalTangentAt(source.sweepCCW, angle);
  const n = gradingSideNormal(t.nx, t.ny, side);
  if (!n) return null;
  const tangentSource: ResolvedGradingSource = {
    startX: p.x, startY: p.y, endX: p.x + t.nx, endY: p.y + t.ny,
    startZ: 0, endZ: 0, length: 1, reoriented: false, isArc: false,
  };
  return fromLocalFrame(0, offsetDistance, tangentSource, n);
};

/** Stub: the joint/miter solve belongs to the joins track. Never solved here. */
export const classifyOffsetJoin = (
  classification: OffsetRadiusClass,
): { join: OffsetJoinClass; detail: string } =>
  classification === 'OFFSET_RADIUS_OK'
    ? { join: 'OFFSET_JOIN_DEFERRED', detail: 'joins-track owns joint/miter solve' }
    : { join: 'OFFSET_JOIN_NOT_APPLICABLE', detail: 'no joint on a collapsed/inverted/nonfinite offset' };

/** Collapse/inversion/nonfinite rows need a production gate that does not exist yet. */
export const offsetPolicyFor = (classification: OffsetRadiusClass): OffsetPolicy =>
  classification === 'OFFSET_RADIUS_OK' ? 'OFFSET_POLICY_NONE' : 'OFFSET_POLICY_REQUIRED';

/* ════════════════ §5 — corpus (constant-distance oracles) ════════════════ */

export const CORPUS_RADII = [10, 60, 100, 252.5, 500] as const;
export const CORPUS_SWEEPS_DEG = [5, 45, 90, 135] as const;

export interface OffsetCorpusRow {
  radius: number;
  sweepDeg: number;
  sweepCCW: boolean;
  side: GradingSide;
  ratio: number;
  offsetDistance: number;
  radiusOffset: number;
  classification: OffsetRadiusClass;
  radialSign: 1 | -1 | 0;
  signedDelta: number;
  endpointAgreement: boolean;
  sourceChordsOnCircle: boolean;
  join: OffsetJoinClass;
  policy: OffsetPolicy;
}

export const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

export const canonicalTriangles = (points: number[], triangles: number[]): string[] => {
  const key = (i: number): string =>
    `${points[i * 3]!.toPrecision(12)},${points[i * 3 + 1]!.toPrecision(12)},${points[i * 3 + 2]!.toPrecision(12)}`;
  const faces: string[] = [];
  for (let f = 0; f + 2 < triangles.length; f += 3) {
    faces.push([key(triangles[f]!), key(triangles[f + 1]!), key(triangles[f + 2]!)].sort().join('|'));
  }
  return faces.sort();
};

/** Corpus over radii × sweeps × CCW/CW × sides at the 20K ratios. */
export const buildCorpus = (): { generated: string; rows: OffsetCorpusRow[]; digest: string } => {
  const rows: OffsetCorpusRow[] = [];
  const ratios = [0.1, 0.5, 0.9, 1.0, 1.1];
  for (const radius of CORPUS_RADII) {
    for (const sweepDeg of CORPUS_SWEEPS_DEG) {
      for (const sweepCCW of [true, false]) {
        for (const side of ['right', 'left'] as const) {
          const source: SourceArc = {
            centerX: 1000, centerY: -500, radius,
            startAngle: 0.7, sweepDeg, sweepCCW, startZ: 100, endZ: 102,
          };
          const linearized = linearizeGradingArc(
            source.centerX, source.centerY, source.radius,
            source.startAngle, endAngleOf(source)!, source.sweepCCW,
            source.startZ, source.endZ, Math.min(0.5, radius / 20),
          );
          const scale = Math.max(Math.abs(source.centerX), Math.abs(source.centerY));
          const sourceChordsOnCircle = linearized !== null && linearized.points.every((p) => {
            const r = Math.hypot(p.x - source.centerX, p.y - source.centerY);
            return Math.abs(r - radius) <= coordinateAgreementTol(r, radius, scale);
          });
          for (const ratio of ratios) {
            const offsetDistance = ratio * radius;
            const got = exactParallelOffset(source, side, offsetDistance);
            const radiusOffset = got.ok ? got.arc.radiusOffset : got.radiusOffset;
            const radialSign = got.ok ? got.arc.radialSign : 0;
            // Endpoints: shifted point sits on the offset circle within agreement.
            let endpointAgreement = false;
            if (got.ok) {
              const qs = shiftedEndpoint(source, false, side, offsetDistance);
              const qe = shiftedEndpoint(source, true, side, offsetDistance);
              endpointAgreement = qs !== null && qe !== null && [qs, qe].every((q) => {
                const r = Math.hypot(q.x - got.arc.centerX, q.y - got.arc.centerY);
                return Math.abs(r - got.arc.radiusOffset)
                  <= coordinateAgreementTol(r, got.arc.radiusOffset, scale) + zeroDelta(r, got.arc.radiusOffset);
              });
            } else {
              endpointAgreement = true; // no arc to agree on; join/policy carry the gate
            }
            rows.push({
              radius, sweepDeg, sweepCCW, side, ratio, offsetDistance, radiusOffset,
              classification: got.classification, radialSign,
              signedDelta: got.ok ? got.arc.signedDelta : NaN,
              endpointAgreement, sourceChordsOnCircle,
              join: classifyOffsetJoin(got.classification).join,
              policy: offsetPolicyFor(got.classification),
            });
          }
        }
      }
    }
  }
  return { generated: 'phase20l-offset-radius-core', rows, digest: digest(rows) };
};

export const OUT = join(dirname(process.argv[1] ?? '.'), '..', 'docs', 'evidence', 'phase20l', 'corpus-core.json');
const OUT_OVERRIDE = process.env.PHASE20L_CORE_OUT;

export const writeCorpus = (): { rows: number; digest: string; out: string } => {
  const payload = buildCorpus();
  const out = OUT_OVERRIDE ?? OUT;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`phase20l core corpus: ${payload.rows.length} rows → ${out} (${payload.digest})`);
  return { rows: payload.rows.length, digest: payload.digest, out };
};

const invokedDirectly = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split('/').pop()!);
if (invokedDirectly) writeCorpus();
