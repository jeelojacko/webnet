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
