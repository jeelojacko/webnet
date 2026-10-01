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
import { lineSide as sectorLineSide, samePlanNode } from './gradingGroupSectors';
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
        outS.push({ x: sa.x + (s.x - sa.x) * t, y: sa.y + (s.y - sa.y) * t, z: sa.z + (s.z - sa.z) * t });
        outD.push({ x: a.x + (p.x - a.x) * t, y: a.y + (p.y - a.y) * t, z: a.z + (p.z - a.z) * t });
        outT.push(station[i - 1]! + (station[i]! - station[i - 1]!) * t);
        outL.push(dist[i - 1]! + (dist[i]! - dist[i - 1]!) * t);
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
      joints.push({
        v, station,
        run: [{ ...inDay[inDay.length - 1]! }, { ...outDay[0]! }],
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
  const pushPair = (s: ChordSeamPoint, d: ChordSeamPoint, station: number, dist: number): void => {
    // Fully-tied nodes (daylight recomputed onto the source through a
    // different arithmetic path) canonicalize to the source plan value,
    // so the strip builder sees exact zero-width pairs and reports
    // ALREADY_TIED instead of slivering. Plan-quantum twins only.
    const dd = samePlanNode(d, s) ? { x: s.x, y: s.y, z: d.z } : { ...d };
    assembly.sourcePts.push({ ...s });
    assembly.daylightPts.push(dd);
    assembly.nodeStations.push(station);
    assembly.distances.push(dist);
  };
  /** Bitwise-consecutive-dupe guard: the corner run shares its endpoint
   *  VALUES with the adjacent run tips (same arithmetic), so re-emitting
   *  them would tile zero-area quads. Trimmed tips carry distinct sources
   *  and must be kept (no shortcut across the joint). */
  const dupePair = (s: ChordSeamPoint, d: ChordSeamPoint): boolean => {
    const n = assembly.sourcePts.length;
    if (n === 0) return false;
    const ps = assembly.sourcePts[n - 1]!;
    const pd = assembly.daylightPts[n - 1]!;
    return ps.x === s.x && ps.y === s.y && ps.z === s.z && pd.x === d.x && pd.y === d.y && pd.z === d.z;
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
