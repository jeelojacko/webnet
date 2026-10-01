/**
 * Phase 20K.1 Wave C1 — analytic internal chord-seam assembly (pure).
 *
 * Per-chord analytic solves disagree at a shared linearization station V:
 * each chord offsets along its OWN frame normal, so the incoming daylight
 * Qin and the outgoing Qout differ. Every internal seam resolves through
 * the existing authorities — `classifyCorner` for the turn plus
 * `analyticTerminalLine`/`solveAnalyticCorner` with the same effective
 * criterion on both sides — preserving the maxSearchDistance + line/Z/side/
 * extent gates. GAP emits pairs (V,Qin),(V,T),(V,Qout) so the strip builder
 * tiles the planar fan exactly once (edge V–T shared both sides); OVERLAP
 * emits (V,Cin),(V,Cout) where C are the miter-line crossings of the two
 * adjacent daylight edges (exact run-level Sutherland clips, shared edge
 * V–C) and records the tie once for provenance. No endpoint averaging, no
 * straight bridge, no true-tangent substitution, no tolerance change, no
 * global weld. Both `arcSolve` and the curved-member path of
 * `gradingGroupCompute` consume this; Surface seams are Wave C2 (untouched).
 */
import { zeroDelta } from '../surfaces/volume/zero';
import type { PlanVector } from './gradingCourseFrame';
import { solveAnalyticCorner } from './gradingGroupAnalyticCorners';
import { classifyCorner } from './gradingCornerMath';
import type { GradingComputeSource, GradingTargetMeshSnapshot, TargetQuery } from './gradingComputeTypes';
import {
  crossGradeAtV,
  solveSurfaceCorner,
} from './gradingGroupSurfaceCorners';
import { lineSide as sectorLineSide, samePlanNode, elevationAgreementTol, AGREEMENT_FLOOR } from './gradingGroupSectors';
import { fanCoveredByFacets } from './gradingTargetFanCoverage';
import type { StraightChordSolve } from './solveStraightChord';
import type { GradingCriterion, GradingSide } from './gradingTypes';

export interface ChordSeamPoint {
  x: number;
  y: number;
  z: number;
}

/** One exact chord solve plus the frame/criterion that produced it. */
export interface ChordSeamChord {
  t: PlanVector;
  n: PlanVector;
  gs: number;
  criterion: GradingCriterion;
  /** Exact chord endpoints (authoritative samples, shared across joints). */
  source: [ChordSeamPoint, ChordSeamPoint];
  daylight: [ChordSeamPoint, ChordSeamPoint];
  nodeStations: [number, number];
  distances: [number, number];
}

export interface ChordSeamTie {
  /** Joint station index (1-based into the chord chain). */
  joint: number;
  kind: 'GAP' | 'OVERLAP';
  tie: ChordSeamPoint;
  ray: { mx: number; my: number };
  extent: number;
}

export interface ChordSeamAssembly {
  sourcePts: ChordSeamPoint[];
  daylightPts: ChordSeamPoint[];
  nodeStations: number[];
  distances: number[];
  ties: ChordSeamTie[];
}

export type ChordSeamOutcome =
  | { ok: true; value: ChordSeamAssembly }
  | { ok: false; detail: string };

const finitePt = (p: ChordSeamPoint): boolean =>
  Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

/** Signed side of p against the ray line through v along m. */
const lineSide = (
  vx: number, vy: number, mx: number, my: number, px: number, py: number,
): number => mx * (py - vy) - my * (px - vx);

/**
 * Crossing of segment a–b with the ray line through v along unit m.
 * Null when parallel or the crossing falls outside the segment.
 */
const segmentLineCrossing = (
  a: ChordSeamPoint,
  b: ChordSeamPoint,
  vx: number, vy: number, mx: number, my: number,
): ChordSeamPoint | null => {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  // u*(ex*my - ey*mx) = mx*ry - my*rx from (r + u*e) x m = 0.
  const det = ex * my - ey * mx;
  if (Math.abs(det) <= zeroDelta(det, 0)) return null;
  const u = (mx * (a.y - vy) - my * (a.x - vx)) / det;
  if (!(u >= 0) || !(u <= 1)) return null;
  return {
    x: a.x + ex * u,
    y: a.y + ey * u,
    // Straight-chord strips are planar: linear Z along the segment is exact.
    z: a.z + (b.z - a.z) * u,
  };
};

/**
 * Stitch exact chord solves into seam-resolved boundary runs. V is sourced
 * from the chord endpoints (exact linearized samples, bitwise shared both
 * sides); T is created once per seam. Fail-closed on any degenerate seam
 * (caller maps to NO_SOLUTION, never CURRENT).
 */
export const assembleSolvedGradingChain = (
  chords: ChordSeamChord[],
  maxSearchDistance: number,
  side: GradingSide,
): ChordSeamOutcome => {
  if (chords.length === 0) return { ok: false, detail: 'GRADING_SEAM_EMPTY' };
  if (!(maxSearchDistance > 0) || !Number.isFinite(maxSearchDistance)) {
    return { ok: false, detail: 'GRADING_BAD_SEARCH_DISTANCE' };
  }
  for (const c of chords) {
    if (!finitePt(c.source[0]) || !finitePt(c.source[1]) ||
      !finitePt(c.daylight[0]) || !finitePt(c.daylight[1])) {
      return { ok: false, detail: 'GRADING_SEAM_NON_FINITE' };
    }
  }
  const assembly: ChordSeamAssembly = {
    sourcePts: [{ ...chords[0]!.source[0] }],
    daylightPts: [{ ...chords[0]!.daylight[0] }],
    nodeStations: [chords[0]!.nodeStations[0]],
    distances: [chords[0]!.distances[0]],
    ties: [],
  };
  const pushPair = (s: ChordSeamPoint, d: ChordSeamPoint, station: number, dist: number): void => {
    assembly.sourcePts.push({ ...s });
    assembly.daylightPts.push({ ...d });
    assembly.nodeStations.push(station);
    assembly.distances.push(dist);
  };
  const planDist = (a: ChordSeamPoint, b: ChordSeamPoint): number =>
    Math.hypot(b.x - a.x, b.y - a.y);
  for (let j = 1; j < chords.length; j += 1) {
    const incoming = chords[j - 1]!;
    const outgoing = chords[j]!;
    const v = incoming.source[1];
    const w = outgoing.source[0];
    // Authoritative exact sample: both sides share the station bitwise.
    if (v.x !== w.x || v.y !== w.y || v.z !== w.z) {
      return { ok: false, detail: 'GRADING_SEAM_STATION_MISMATCH' };
    }
    const station = incoming.nodeStations[1];
    const turn = classifyCorner(incoming.t, outgoing.t, side);
    if (!turn) return { ok: false, detail: 'GRADING_ANALYTIC_SEAM' };
    const qIn = incoming.daylight[1];
    const qOut = outgoing.daylight[0];
    if (turn === 'TANGENT') {
      const same =
        Math.abs(qIn.x - qOut.x) <= zeroDelta(qIn.x, qOut.x) &&
        Math.abs(qIn.y - qOut.y) <= zeroDelta(qIn.y, qOut.y) &&
        Math.abs(qIn.z - qOut.z) <= zeroDelta(qIn.z, qOut.z);
      if (!same) return { ok: false, detail: 'GRADING_ANALYTIC_SEAM' };
      pushPair(v, qIn, station, incoming.distances[1]);
      continue;
    }
    const solved = solveAnalyticCorner({
      vx: v.x, vy: v.y, vz: v.z,
      inT: incoming.t, inN: incoming.n, inGs: incoming.gs,
      outT: outgoing.t, outN: outgoing.n, outGs: outgoing.gs,
      inCriterion: incoming.criterion, outCriterion: outgoing.criterion,
      maxSearchDistance,
    });
    if (!solved.ok || solved.kind !== 'miter') return { ok: false, detail: 'GRADING_ANALYTIC_SEAM' };
    const tie = { ...solved.tie };
    if (turn === 'GAP') {
      pushPair(v, qIn, station, incoming.distances[1]);
      pushPair(v, tie, station, solved.extent);
      pushPair(v, qOut, station, outgoing.distances[0]);
      assembly.ties.push({ joint: j, kind: 'GAP', tie: { ...tie }, ray: { ...solved.ray }, extent: solved.extent });
      continue;
    }
    // OVERLAP: exact run-level Sutherland clips. Each side's joint point
    // must lie strictly beyond its keep half-plane and the far point
    // inside-or-on, so exactly one miter crossing exists per edge.
    const { mx, my } = solved.ray;
    const keepIn = lineSide(v.x, v.y, mx, my, incoming.source[0].x, incoming.source[0].y);
    const keepOut = lineSide(v.x, v.y, mx, my, outgoing.source[1].x, outgoing.source[1].y);
    if (Math.abs(keepIn) <= zeroDelta(keepIn, 0) || Math.abs(keepOut) <= zeroDelta(keepOut, 0)) {
      return { ok: false, detail: 'GRADING_SEAM_TRIM' };
    }
    const wantIn = keepIn > 0;
    const wantOut = keepOut > 0;
    const outsideIn = (p: ChordSeamPoint): boolean => {
      const s = lineSide(v.x, v.y, mx, my, p.x, p.y);
      return wantIn ? s < -zeroDelta(s, 0) : s > zeroDelta(s, 0);
    };
    const outsideOut = (p: ChordSeamPoint): boolean => {
      const s = lineSide(v.x, v.y, mx, my, p.x, p.y);
      return wantOut ? s < -zeroDelta(s, 0) : s > zeroDelta(s, 0);
    };
    const prevD = assembly.daylightPts[assembly.daylightPts.length - 1]!;
    const nextD = outgoing.daylight[1];
    if (!outsideIn(qIn) || outsideIn(prevD) || !outsideOut(qOut) || outsideOut(nextD)) {
      return { ok: false, detail: 'GRADING_SEAM_TRIM' };
    }
    const clipIn = segmentLineCrossing(prevD, qIn, v.x, v.y, mx, my);
    const clipOut = segmentLineCrossing(qOut, nextD, v.x, v.y, mx, my);
    if (!clipIn || !clipOut) return { ok: false, detail: 'GRADING_SEAM_TRIM' };
    pushPair(v, clipIn, station, planDist(v, clipIn));
    pushPair(v, clipOut, station, planDist(v, clipOut));
    assembly.ties.push({ joint: j, kind: 'OVERLAP', tie, ray: { ...solved.ray }, extent: solved.extent });
  }
  const last = chords[chords.length - 1]!;
  pushPair(last.source[1], last.daylight[1], last.nodeStations[1], last.distances[1]);
  return { ok: true, value: assembly };
};

/** Deterministic FNV-1a digest over rounded mesh buffers (equivalence key). */
export const digestSeamMesh = (points: number[], triangles: number[]): string => {
  let hash = 0x811c9dc5;
  const text = `${points.map((v) => v.toPrecision(12)).join(',')}|${triangles.join(',')}`;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

// ---------------------------------------------------------------------------
// Phase 20K.1 Wave C2 — Surface (Fixed + Cut/Fill) internal chord seams.
// ---------------------------------------------------------------------------

/** One Surface chord solve plus the frame that produced it. */
export interface SurfaceSeamChord {
  t: PlanVector;
  n: PlanVector;
  gs: number;
  chord: GradingComputeSource;
  solve: StraightChordSolve;
}

export interface SurfaceSeamInput {
  side: GradingSide;
  /** Single effective criterion for the whole chain (one arc, one member). */
  criterion: GradingCriterion;
  maxSearchDistance: number;
  target: GradingTargetMeshSnapshot;
  candidates: number[];
  query: TargetQuery;
}

const sameSeamPt = (a: ChordSeamPoint, b: ChordSeamPoint): boolean =>
  Math.abs(a.x - b.x) <= zeroDelta(a.x, b.x) &&
  Math.abs(a.y - b.y) <= zeroDelta(a.y, b.y) &&
  Math.abs(a.z - b.z) <= zeroDelta(a.z, b.z);

/**
 * Phase 20K.2 — proven direct CUT/FILL transition fan.
 *
 * The cross-grade fallback may bridge a chord joint ONLY when the bridge is
 * proven to lie on the target: a genuine CUT/FILL criterion, V agreeing with
 * the target elevation under the shared anchored contract (a grade change
 * across an exact tied station), and the whole qIn→V→qOut fan covered by one
 * proven target plane. The plane is anchored at V and the fan's plan triangle
 * is walked against the actual target facets: every overlapping facet must be
 * coplanar under the shared anchored-elevation contract and the facets must
 * cover the fan. A void (uncovered area), an off-plane facet
 * (ridge/valley/branch/edge/vertex discontinuity), or a plan-degenerate
 * conditioning triangle fails closed. No averaging, projection, later-root
 * preference, fixed-point resampling, or tolerance relaxation.
 */
export const directFanOnTarget = (
  criterion: GradingCriterion,
  query: TargetQuery,
  v: ChordSeamPoint,
  qIn: ChordSeamPoint,
  qOut: ChordSeamPoint,
): boolean => {
  if (criterion.kind !== 'cut-fill') return false;
  const ztV = query.elevationAt(v.x, v.y);
  if (ztV === null) return false;
  // V must agree with the source elevation under the shared anchored contract
  // (design mismatch fails closed; representation noise ≤ the 1 nm floor is
  // absorbed). This is the "exact tied station" proof for the transition.
  if (Math.abs(ztV - v.z) > elevationAgreementTol(ztV, v.z, []) + AGREEMENT_FLOOR) return false;
  // A tied station collapses both daylight runs onto V: the wedge is a
  // single shared node, so there is no bridge to prove.
  if (samePlanNode(qIn, qOut)) return true;
  const e1x = qIn.x - v.x;
  const e1y = qIn.y - v.y;
  const e1z = qIn.z - v.z;
  const e2x = qOut.x - v.x;
  const e2y = qOut.y - v.y;
  const e2z = qOut.z - v.z;
  const nz = e1x * e2y - e1y * e2x;
  if (Math.abs(nz) <= zeroDelta(nz, 0)) return false;
  // Anchored fan plane z = vz + gx·(x−vx) + gy·(y−vy).
  const gx = (e1z * e2y - e1y * e2z) / nz;
  const gy = (e1x * e2z - e1z * e2x) / nz;
  const plane = { gx, gy, ax: v.x, ay: v.y };
  const elevation = (x: number, y: number): number =>
    v.z + gx * (x - v.x) + gy * (y - v.y);
  return fanCoveredByFacets(query, plane, [qIn.x, qIn.y, v.x, v.y, qOut.x, qOut.y], elevation);
};

/**
 * Paired-array clip of a (source, daylight) run to the closed half-plane on
 * the same side of `line` as `keep`. Daylight decisions reuse the exact
 * sector `lineSide` + zeroDelta gates (bitwise-identical daylight to the
 * unpaired clip); inserted crossings lerp the source mate under the strip
 * model's exact linearity — no projection, no relaxation.
 */
const clipPairedRunToHalfPlane = (
  source: ChordSeamPoint[],
  daylight: ChordSeamPoint[],
  station: number[],
  dist: number[],
  line: { vx: number; vy: number; mx: number; my: number },
  keep: { x: number; y: number },
): { source: ChordSeamPoint[]; daylight: ChordSeamPoint[]; station: number[]; dist: number[] } | null => {
  const keepSide = sectorLineSide(line, keep.x, keep.y);
  const wantPositive = keepSide >= 0;
  const inside = (p: ChordSeamPoint): boolean => {
    const s = sectorLineSide(line, p.x, p.y);
    return wantPositive ? s >= -zeroDelta(s, 0) : s <= zeroDelta(s, 0);
  };
  const outS: ChordSeamPoint[] = [];
  const outD: ChordSeamPoint[] = [];
  const outT: number[] = [];
  const outL: number[] = [];
  for (let i = 0; i < daylight.length; i += 1) {
    const p = daylight[i]!;
    const s = source[i]!;
    const pIn = inside(p);
    if (i > 0) {
      const a = daylight[i - 1]!;
      const sa = source[i - 1]!;
      if (inside(a) !== pIn) {
        const ea = sectorLineSide(line, a.x, a.y);
        const eb = sectorLineSide(line, p.x, p.y);
        const t = ea === eb ? 0 : ea / (ea - eb);
        // Crossing landing exactly on an existing endpoint reuses that
        // endpoint bit-exactly: `a` is kept when entering (t<=0), `p` when
        // leaving (t>=1), so no ULP twin of a kept sample is inserted. Only
        // genuine interior crossings interpolate the source mate.
        if (t > 0 && t < 1) {
          outS.push({ x: sa.x + (s.x - sa.x) * t, y: sa.y + (s.y - sa.y) * t, z: sa.z + (s.z - sa.z) * t });
          outD.push({ x: a.x + (p.x - a.x) * t, y: a.y + (p.y - a.y) * t, z: a.z + (p.z - a.z) * t });
          outT.push(station[i - 1]! + (station[i]! - station[i - 1]!) * t);
          outL.push(dist[i - 1]! + (dist[i]! - dist[i - 1]!) * t);
        }
      }
    }
    if (pIn) {
      outS.push({ ...s });
      outD.push({ ...p });
      outT.push(station[i]!);
      outL.push(dist[i]!);
    }
  }
  if (outD.length === 0) return null;
  return { source: outS, daylight: outD, station: outT, dist: outL };
};

/**
 * Stitch Surface chord solves into seam-resolved boundary runs. Each
 * internal station resolves through the shared Surface-corner authority
 * (`solveSurfaceCorner`: active-grade planes, miter seam, outward ray +
 * extent, nearest valid outward root, sector-path build/trim). GAP splices
 * the Q-to-tie sector paths between the chord runs; OVERLAP paired-trims
 * both runs to the miter line first. Corner wedges emit repeated-V pairs
 * so the strip builder tiles the fan exactly once. Fail-closed on any
 * degenerate seam (caller maps to NO_SOLUTION, never CURRENT).
 */
export const assembleSurfaceChain = (
  chords: SurfaceSeamChord[],
  input: SurfaceSeamInput,
): ChordSeamOutcome => {
  const { side, criterion, maxSearchDistance, target, candidates, query } = input;
  if (chords.length === 0) return { ok: false, detail: 'GRADING_SURFACE_SEAM_EMPTY' };
  if (!(maxSearchDistance > 0) || !Number.isFinite(maxSearchDistance)) {
    return { ok: false, detail: 'GRADING_BAD_SEARCH_DISTANCE' };
  }
  if (criterion.kind !== 'fixed' && criterion.kind !== 'cut-fill') {
    return { ok: false, detail: 'GRADING_SURFACE_SEAM_CRITERION' };
  }
  // Mutable daylight/source working runs per chord (OVERLAP trims the tips).
  const dayRuns: ChordSeamPoint[][] = [];
  const srcRuns: ChordSeamPoint[][] = [];
  const stnRuns: number[][] = [];
  const disRuns: number[][] = [];
  for (const c of chords) {
    const s = c.solve;
    if (s.sourcePts.length !== s.daylightPts.length || s.sourcePts.length < 2) {
      return { ok: false, detail: 'GRADING_SURFACE_SEAM_RUN' };
    }
    for (const p of [...s.sourcePts, ...s.daylightPts]) {
      if (!finitePt(p)) return { ok: false, detail: 'GRADING_SURFACE_SEAM_NON_FINITE' };
    }
    dayRuns.push(s.daylightPts.map((p) => ({ ...p })));
    srcRuns.push(s.sourcePts.map((p) => ({ ...p })));
    stnRuns.push([...s.nodeStations]);
    disRuns.push([...s.distances]);
  }
  // Resolve every internal joint, threading trimmed runs forward (each
  // chord is trimmed at most at its two tips by its two joints).
  interface JointRun { v: ChordSeamPoint; station: number; run: ChordSeamPoint[]; kind: 'GAP' | 'OVERLAP' | 'STITCH'; tie: ChordSeamPoint | null; ray: { mx: number; my: number } | null; extent: number | null }
  const joints: JointRun[] = [];
  for (let j = 1; j < chords.length; j += 1) {
    const incoming = chords[j - 1]!;
    const outgoing = chords[j]!;
    const cIn = incoming.chord;
    const v: ChordSeamPoint = { x: cIn.endX, y: cIn.endY, z: cIn.endZ };
    const w = outgoing.chord;
    if (v.x !== w.startX || v.y !== w.startY || v.z !== w.startZ) {
      return { ok: false, detail: 'GRADING_SURFACE_SEAM_STATION_MISMATCH' };
    }
    // Phase 20K.3 Wave C — one authoritative linearized seam sample.
    // Each chord solve emits its source tip as `start + t·length`, a ULP
    // twin of the exact linearized joint `v`. Overwrite both run tips with
    // that single exact sample (the corner fan below already shares `v`) so
    // the source boundary carries one vertex per seam. Exact bitwise share:
    // no tolerance weld, no averaging, no rounding. Daylight is untouched.
    srcRuns[j - 1]![srcRuns[j - 1]!.length - 1] = { ...v };
    srcRuns[j]![0] = { ...v };
    const station = incoming.solve.nodeStations[incoming.solve.nodeStations.length - 1]!;
    const turn = classifyCorner(incoming.t, outgoing.t, side);
    if (!turn) return { ok: false, detail: 'GRADING_SURFACE_SEAM' };
    // Per-side active grades: a CUT/FILL transition can land exactly on an
    // internal joint (tied V, CUT one side, FILL the other), so each
    // corner plane extends its own strip's end grade — sampled just off V
    // along each chord through the same active-grade authority. Uniform
    // zones reproduce the at-V grade exactly.
    const sideGrade = (chord: (typeof chords)[number]['chord'], fromStart: boolean): number | null => {
      const eps = Math.min(1e-3, chord.length / 4);
      const u = fromStart ? eps : chord.length - eps;
      const px = chord.startX + (chord.endX - chord.startX) * (u / chord.length);
      const py = chord.startY + (chord.endY - chord.startY) * (u / chord.length);
      const pz = chord.startZ + (chord.endZ - chord.startZ) * (u / chord.length);
      const zt = query.elevationAt(px, py);
      if (zt === null) return null;
      return crossGradeAtV(criterion, zt - pz);
    };
    const gIn = sideGrade(cIn, false);
    const gOut = sideGrade(w, true);
    if (gIn === null || gOut === null) return { ok: false, detail: 'GRADING_SURFACE_SEAM_V_COVERAGE' };
    const inDay = dayRuns[j - 1]!;
    const outDay = dayRuns[j]!;
    const solved = solveSurfaceCorner({
      vx: v.x, vy: v.y, vz: v.z, side,
      tIn: incoming.t, nIn: incoming.n, gsIn: incoming.gs, gIn,
      tOut: outgoing.t, nOut: outgoing.n, gsOut: outgoing.gs, gOut,
      classification: turn,
      target, candidates, query, maxSearchDistance,
      q1: { ...inDay[inDay.length - 1]! },
      q2: { ...outDay[0]! },
      midIn: { x: (cIn.startX + v.x) / 2, y: (cIn.startY + v.y) / 2 },
      midOut: { x: (v.x + w.endX) / 2, y: (v.y + w.endY) / 2 },
      inDaylight: inDay.map((p) => ({ ...p })),
      outDaylight: outDay.map((p) => ({ ...p })),
      inTris: [],
      outTris: [],
    });
    if (!solved.ok) {
      // Cross-grade transition joints (CUT one side, FILL the other) admit
      // no shared miter ray — the planes diverge vertically, not in plan.
      // The honest tiling is a direct fan across the wedge (exact on
      // planar targets); same-grade inversions still fail closed below.
      const crossGrade =
        solved.code === 'CORNER_INVERTED' &&
        solved.detail === 'GRADING_CORNER_RAY' &&
        gIn !== gOut;
      if (!crossGrade) return { ok: false, detail: `GRADING_SURFACE_SEAM:${solved.code}:${solved.detail}` };
      const qInFan = inDay[inDay.length - 1]!;
      const qOutFan = outDay[0]!;
      // Proven-target membership is mandatory: a direct fan that leaves the
      // target (ridge/valley/void/branch) fails closed with the existing
      // seam-transition code instead of bridging geometry.
      if (!directFanOnTarget(criterion, query, v, qInFan, qOutFan)) {
        return { ok: false, detail: 'GRADING_SURFACE_SEAM:GRADING_SURFACE_SEAM_TRANSITION_REQUIRED' };
      }
      joints.push({
        v, station,
        run: [{ ...qInFan }, { ...qOutFan }],
        kind: 'GAP', tie: null, ray: null, extent: null,
      });
      continue;
    }
    const corner = solved.value;
    if (corner.coincident || turn === 'TANGENT') {
      joints.push({ v, station, run: [{ ...inDay[inDay.length - 1]! }], kind: 'STITCH', tie: { ...corner.tie }, ray: { ...corner.ray }, extent: corner.extent });
      continue;
    }
    // Exact-endpoint corner run: tips are the authoritative (possibly
    // trimmed) run ends; interior keeps the snapped sector vertices.
    let inRun = inDay;
    let outRun = outDay;
    let inSrc = srcRuns[j - 1]!;
    let outSrc = srcRuns[j]!;
    if (turn === 'OVERLAP') {
      const line = { vx: v.x, vy: v.y, mx: corner.ray.mx, my: corner.ray.my };
      const keepIn = { x: (cIn.startX + v.x) / 2, y: (cIn.startY + v.y) / 2 };
      const keepOut = { x: (v.x + w.endX) / 2, y: (v.y + w.endY) / 2 };
      const trimmedIn = clipPairedRunToHalfPlane(inSrc, inDay, stnRuns[j - 1]!, disRuns[j - 1]!, line, keepIn);
      const trimmedOut = clipPairedRunToHalfPlane(outSrc, outDay, stnRuns[j]!, disRuns[j]!, line, keepOut);
      if (!trimmedIn || !trimmedOut) return { ok: false, detail: 'GRADING_SURFACE_SEAM:GRADING_CORNER_TRIM' };
      inRun = trimmedIn.daylight;
      outRun = trimmedOut.daylight;
      inSrc = trimmedIn.source;
      outSrc = trimmedOut.source;
      // Wedge-coincident tips canonicalize to the tie ahead of the
      // authority check (same rule as the helper).
      const preCanon = (p: ChordSeamPoint): ChordSeamPoint =>
        samePlanNode(p, corner.tie) ? { ...corner.tie } : p;
      inRun[inRun.length - 1] = preCanon(inRun[inRun.length - 1]!);
      outRun[0] = preCanon(outRun[0]!);
      // Authoritative daylight check: paired trim matches the helper trim.
      const authIn = corner.inDaylight;
      const authOut = corner.outDaylight;
      const matches =
        inRun.length === authIn.length &&
        outRun.length === authOut.length &&
        inRun.every((p, i) => sameSeamPt(p, authIn[i]!)) &&
        outRun.every((p, i) => sameSeamPt(p, authOut[i]!));
      if (!matches) return { ok: false, detail: 'GRADING_SURFACE_SEAM_TRIM_MISMATCH' };
      dayRuns[j - 1] = inRun.map((p) => ({ ...p }));
      dayRuns[j] = outRun.map((p) => ({ ...p }));
      srcRuns[j - 1] = inSrc.map((p) => ({ ...p }));
      srcRuns[j] = outSrc.map((p) => ({ ...p }));
      stnRuns[j - 1] = [...trimmedIn.station];
      stnRuns[j] = [...trimmedOut.station];
      disRuns[j - 1] = [...trimmedIn.dist];
      disRuns[j] = [...trimmedOut.dist];
    }
    // Wedge-coincident tips canonicalize to the tie (same rule as the
    // helper: quantum twins share one value, no T-junctions). GAP and
    // OVERLAP alike; far tips are untouched.
    const tieDist = Math.hypot(corner.tie.x - v.x, corner.tie.y - v.y);
    const canonTip = (p: ChordSeamPoint): ChordSeamPoint =>
      samePlanNode(p, corner.tie) ? { ...corner.tie } : p;
    const lastIn = dayRuns[j - 1]!.length - 1;
    dayRuns[j - 1]![lastIn] = canonTip(dayRuns[j - 1]![lastIn]!);
    dayRuns[j]![0] = canonTip(dayRuns[j]![0]!);
    if (samePlanNode(dayRuns[j - 1]![lastIn]!, corner.tie)) disRuns[j - 1]![lastIn] = tieDist;
    if (samePlanNode(dayRuns[j]![0]!, corner.tie)) disRuns[j]![0] = tieDist;
    inRun = dayRuns[j - 1]!;
    outRun = dayRuns[j]!;
    const inTip = inRun[inRun.length - 1]!;
    const outTip = outRun[0]!;
    // The helper corner run already carries exact shared endpoints
    // (authoritative tips + miter tie) around snapped interior locus
    // vertices. A single-point run is a true zero-width wedge (trimmed
    // tips + tie coincident): stitch one pair, tie still recorded.
    // Sanity-check the spline against the trimmed tips.
    const run: ChordSeamPoint[] = corner.cornerRun.map((p) => ({ ...p }));
    if (run.length === 0) return { ok: false, detail: 'GRADING_SURFACE_SEAM_DEGENERATE' };
    if (!samePlanNode(run[0]!, inTip) || !samePlanNode(run[run.length - 1]!, outTip)) {
      return { ok: false, detail: 'GRADING_SURFACE_SEAM_PATH' };
    }
    joints.push({ v, station, run, kind: turn, tie: { ...corner.tie }, ray: { ...corner.ray }, extent: corner.extent });
  }
  // Emit: chord runs in order, corner wedges as repeated-V pairs.
  const assembly: ChordSeamAssembly = {
    sourcePts: [],
    daylightPts: [],
    nodeStations: [],
    distances: [],
    ties: [],
  };
  const planDist = (a: ChordSeamPoint, b: ChordSeamPoint): number =>
    Math.hypot(b.x - a.x, b.y - a.y);
  /** Tied plan-quantum twins share the source plan value (z stays the
   *  daylight's); every other daylight is kept verbatim. */
  const canonDaylight = (s: ChordSeamPoint, d: ChordSeamPoint): ChordSeamPoint =>
    samePlanNode(d, s) ? { x: s.x, y: s.y, z: d.z } : { ...d };
  const pushPair = (s: ChordSeamPoint, d: ChordSeamPoint, station: number, dist: number): void => {
    // Fully-tied nodes (daylight recomputed onto the source through a
    // different arithmetic path) canonicalize to the source plan value,
    // so the strip builder sees exact zero-width pairs and reports
    // ALREADY_TIED instead of slivering. Plan-quantum twins only.
    assembly.sourcePts.push({ ...s });
    assembly.daylightPts.push(canonDaylight(s, d));
    assembly.nodeStations.push(station);
    assembly.distances.push(dist);
  };
  /** Bitwise-consecutive-dupe guard: the corner run shares its endpoint
   *  VALUES with the adjacent run tips (same arithmetic), so re-emitting
   *  them would tile zero-area quads. Trimmed tips carry distinct sources
   *  and must be kept (no shortcut across the joint). Compare the STORED
   *  (tie-canonicalized) daylight so a tieless CUT→TIED→FILL fan collapses
   *  to exactly one seam sample. */
  const dupePair = (s: ChordSeamPoint, d: ChordSeamPoint): boolean => {
    const n = assembly.sourcePts.length;
    if (n === 0) return false;
    const ps = assembly.sourcePts[n - 1]!;
    const pd = assembly.daylightPts[n - 1]!;
    const dd = canonDaylight(s, d);
    return ps.x === s.x && ps.y === s.y && ps.z === s.z && pd.x === dd.x && pd.y === dd.y && pd.z === dd.z;
  };
  const pushLive = (s: ChordSeamPoint, d: ChordSeamPoint, station: number, dist: number): void => {
    if (!dupePair(s, d)) pushPair(s, d, station, dist);
  };
  for (let i = 0; i < srcRuns[0]!.length; i += 1) {
    pushPair(srcRuns[0]![i]!, dayRuns[0]![i]!, stnRuns[0]![i]!, disRuns[0]![i]!);
  }
  for (let j = 1; j < chords.length; j += 1) {
    const joint = joints[j - 1]!;
    if (joint.kind === 'STITCH') {
      // Tips already agree; runs already share the endpoint bitwise.
      for (let i = 1; i < srcRuns[j]!.length; i += 1) {
        pushPair(srcRuns[j]![i]!, dayRuns[j]![i]!, stnRuns[j]![i]!, disRuns[j]![i]!);
      }
      continue;
    }
    // Corner fan: endpoint nodes already stand as run tips (same values),
    // so only interior locus vertices emit as repeated-V pairs — endpoint
    // dupes would tile zero-length daylight edges. Degenerate wedges
    // (run <= 2 points) force the tie pair so the joint sample V survives
    // in the source boundary. Tieless cross-grade fans force both V pairs
    // (the wedge tiles across them; the flat boundary dedups values).
    if (joint.tie === null) {
      for (const r of joint.run) {
        pushLive(joint.v, r, joint.station, planDist(joint.v, r));
      }
    } else if (joint.run.length <= 2) {
      pushLive(joint.v, joint.tie, joint.station, planDist(joint.v, joint.tie));
    } else {
      for (let k = 1; k + 1 < joint.run.length; k += 1) {
        const r = joint.run[k]!;
        pushLive(joint.v, r, joint.station, planDist(joint.v, r));
      }
    }
    if (joint.tie !== null && joint.ray !== null && joint.extent !== null) {
      assembly.ties.push({ joint: j, kind: joint.kind, tie: { ...joint.tie }, ray: { ...joint.ray }, extent: joint.extent });
    }
    for (let i = 0; i < srcRuns[j]!.length; i += 1) {
      pushLive(srcRuns[j]![i]!, dayRuns[j]![i]!, stnRuns[j]![i]!, disRuns[j]![i]!);
    }
  }
  return { ok: true, value: assembly };
};

/* ---------------------------------------------------------------------------
 * Phase 20K.3 Wave B — exact seam-mesh digest (bits, not decimals).
 *
 * `digestSeamMesh` (above) hashes `toPrecision(12)` text and collides below
 * the 12-significant-digit quantum. This exact variant hashes IEEE-754
 * Float64 bits + uint32 indices with SHA-256 and is the only seam digest
 * the gtop2 certificate path uses. The legacy export is untouched.
 * ------------------------------------------------------------------------- */

/** Exact seam-mesh digest (null on non-finite coords / bad indices). */
export const digestSeamMeshExact = (points: number[], triangles: number[]): string | null => {
  // Local bit-exact encoding (mirrors the gtop2 mesh section, seam tag).
  const out: number[] = [0x67, 0x74, 0x6f, 0x70, 0x32, 0x00, 0x73, 0x65, 0x61, 0x6d];
  const pushU32 = (value: number): boolean => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      return false;
    }
    out.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
    return true;
  };
  const pushF64 = (value: number): boolean => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    const buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, value === 0 ? 0 : value, true);
    for (const byte of new Uint8Array(buf)) out.push(byte);
    return true;
  };
  if (points.length % 3 !== 0 || triangles.length % 3 !== 0) return null;
  if (!pushU32(points.length / 3)) return null;
  for (const value of points) if (!pushF64(value)) return null;
  if (!pushU32(triangles.length / 3)) return null;
  for (const index of triangles) if (!pushU32(index)) return null;
  // Bounded pure SHA-256 over the byte buffer (same construction as gtop2).
  const data = Uint8Array.from(out);
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  let h0 = 0x6a09e667; let h1 = 0xbb67ae85; let h2 = 0x3c6ef372; let h3 = 0xa54ff53a;
  let h4 = 0x510e527f; let h5 = 0x9b05688c; let h6 = 0x1f83d9ab; let h7 = 0x5be0cd19;
  const bitLen = data.length * 8;
  const paddedLen = (((data.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(paddedLen - 4, bitLen >>> 0);
  const w = new Array<number>(64);
  const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = [h0, h1, h2, h3, h4, h5, h6, h7];
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i]! + w[i]!) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((v) => (v >>> 0).toString(16).padStart(8, '0'))
    .join('');
};
