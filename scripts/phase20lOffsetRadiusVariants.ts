/**
 * Phase 20L Worker-JOINS — adjacent-member offset-join FIXTURES (STUDY,
 * evidence only). Builds honest line/arc member terminals around a shared
 * joint V and hands them to `scripts/phase20lOffsetJoinCore.ts`.
 *
 * The offset curves are the members' true parallel offsets at distance `d`
 * along the grading side; the join is wherever those offsets meet, never a
 * point forced through V. Arc×arc fixtures are GEOMETRIC REFERENCE ONLY —
 * production arc×arc stays NO_GO_TERMINAL_CHORD_ARC_PAIR and this module
 * never routes a corner.
 *
 * Coverage: GAP/OVERLAP (convex/concave), left/right, CW/CCW, unequal radii,
 * shallow/near-tangent, translated and rotated copies of every family.
 */
import { type PlanVector } from '../src/engine/cad/grading/gradingCourseFrame';
import type { GradingSide } from '../src/engine/cad/grading/gradingTypes';
import {
  classifyOffsetJoin,
  type ArcMember,
  type LineMember,
  type MemberSpec,
  type OffsetJoinInput,
  type OffsetJoinResult,
} from './phase20lOffsetJoinCore';

export const toRad = (deg: number): number => (deg * Math.PI) / 180;

const unit = (x: number, y: number): PlanVector => {
  const len = Math.hypot(x, y);
  return { nx: x / len, ny: y / len };
};

/** Line terminal at V with span on the correct side of the joint. */
export const lineMember = (
  vx: number,
  vy: number,
  tangent: PlanVector,
  length: number,
  direction: 'incoming' | 'outgoing',
): LineMember => {
  const t = unit(tangent.nx, tangent.ny);
  return {
    kind: 'line', vx, vy, tx: t.nx, ty: t.ny,
    spanStart: direction === 'incoming' ? -length : 0,
    spanEnd: direction === 'incoming' ? 0 : length,
  };
};

/** Arc terminal at V. `dir` is the travel sweep (+1 CCW, -1 CW), `sweep` the body arc angle. */
export const arcMember = (
  vx: number,
  vy: number,
  cx: number,
  cy: number,
  radius: number,
  dir: 1 | -1,
  sweep: number,
  direction: 'incoming' | 'outgoing',
): ArcMember => {
  const len = radius * sweep;
  return {
    kind: 'arc', vx, vy, cx, cy, radius, dir,
    spanStart: direction === 'incoming' ? -len : 0,
    spanEnd: direction === 'incoming' ? 0 : len,
  };
};

export interface JoinFixture {
  id: string;
  note: string;
  input: OffsetJoinInput;
}

export const fixture = (
  id: string,
  note: string,
  incoming: MemberSpec,
  outgoing: MemberSpec,
  side: GradingSide,
  offset = 5,
  maxSearchDistance = 100,
  probeMiter = false,
): JoinFixture => ({
  id,
  note,
  input: { incoming, outgoing, side, offset, maxSearchDistance, probeMiter },
});

/** Rotate (about V) + translate every member of a join input. */
export const transformInput = (
  input: OffsetJoinInput,
  angle: number,
  dx: number,
  dy: number,
): OffsetJoinInput => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rot = (px: number, py: number): [number, number] => [cos * px - sin * py, sin * px + cos * py];
  const mapPoint = (px: number, py: number): [number, number] => {
    const [rx, ry] = rot(px, py);
    return [rx + dx, ry + dy];
  };
  const mapMember = (m: MemberSpec): MemberSpec => {
    const [vx, vy] = mapPoint(m.vx, m.vy);
    if (m.kind === 'line') {
      const [tx, ty] = rot(m.tx, m.ty);
      return { ...m, vx, vy, tx, ty };
    }
    const [cx, cy] = mapPoint(m.cx, m.cy);
    return { ...m, vx, vy, cx, cy };
  };
  return { ...input, incoming: mapMember(input.incoming), outgoing: mapMember(input.outgoing) };
};

// ── line → line ────────────────────────────────────────────────────────────

const V = { vx: 0, vy: 0 } as const;
const X: PlanVector = { nx: 1, ny: 0 };
const Y: PlanVector = { nx: 0, ny: 1 };
const L = 40;

/** Left turn (+X → +Y): right side outside (GAP), left side inside (OVERLAP). */
const lineLineLeftTurn = (side: GradingSide): JoinFixture =>
  fixture(
    `LL_LEFT_TURN_${side.toUpperCase()}`,
    'line→line, 90° left turn, perpendicular offsets meet at a single miter',
    lineMember(V.vx, V.vy, X, L, 'incoming'),
    lineMember(V.vx, V.vy, Y, L, 'outgoing'),
    side,
  );

/** Right turn (+X → −Y). */
const lineLineRightTurn = (side: GradingSide): JoinFixture =>
  fixture(
    `LL_RIGHT_TURN_${side.toUpperCase()}`,
    'line→line, 90° right turn, mirror of the left-turn join',
    lineMember(V.vx, V.vy, X, L, 'incoming'),
    lineMember(V.vx, V.vy, { nx: 0, ny: -1 }, L, 'outgoing'),
    side,
  );

/** Shallow corner: offset join stays near V, tangent determinant → 0. */
const lineLineShallow = (deg: number, side: GradingSide): JoinFixture =>
  fixture(
    `LL_SHALLOW_${deg}DEG_${side.toUpperCase()}`,
    `line→line, ${deg}° turn: near-parallel offset lines, weakly conditioned miter`,
    lineMember(V.vx, V.vy, X, L, 'incoming'),
    lineMember(V.vx, V.vy, unit(Math.cos(toRad(deg)), Math.sin(toRad(deg))), L, 'outgoing'),
    side,
  );

// ── line → arc ─────────────────────────────────────────────────────────────
// Outgoing arc leaves V along +Y. CCW ⇒ centre at (−R, 0); CW ⇒ centre (R, 0).

const lineArc = (
  id: string,
  note: string,
  radius: number,
  dir: 1 | -1,
  side: GradingSide,
  offset = 5,
): JoinFixture => {
  const cx = dir === 1 ? -radius : radius;
  return fixture(
    id,
    note,
    lineMember(V.vx, V.vy, X, L, 'incoming'),
    arcMember(V.vx, V.vy, cx, 0, radius, dir, Math.PI / 2, 'outgoing'),
    side,
    offset,
  );
};

// ── arc → line ─────────────────────────────────────────────────────────────
// Incoming arc arrives at V along +X. CW (dir −1) ⇒ centre (0, −R).

const arcLine = (
  id: string,
  note: string,
  radius: number,
  dir: 1 | -1,
  side: GradingSide,
  offset = 5,
): JoinFixture => {
  const cy = dir === 1 ? radius : -radius;
  return fixture(
    id,
    note,
    arcMember(V.vx, V.vy, 0, cy, radius, dir, Math.PI / 2, 'incoming'),
    lineMember(V.vx, V.vy, Y, L, 'outgoing'),
    side,
    offset,
  );
};

// ── arc → arc (geometric reference only) ───────────────────────────────────
// Incoming arrives along +X, outgoing leaves along +Y. CCW/CW centres:
// incoming CCW ⇒ (0, +R); incoming CW ⇒ (0, −R); outgoing CCW ⇒ (−R, 0);
// outgoing CW ⇒ (+R, 0).

const arcArc = (
  id: string,
  note: string,
  inRadius: number,
  inDir: 1 | -1,
  outRadius: number,
  outDir: 1 | -1,
  side: GradingSide,
  offset = 5,
): JoinFixture =>
  fixture(
    id,
    note,
    arcMember(V.vx, V.vy, 0, inDir === 1 ? inRadius : -inRadius, inRadius, inDir, Math.PI / 2, 'incoming'),
    arcMember(V.vx, V.vy, outDir === 1 ? -outRadius : outRadius, 0, outRadius, outDir, Math.PI / 2, 'outgoing'),
    side,
    offset,
  );

export const JOIN_FIXTURES: JoinFixture[] = [
  lineLineLeftTurn('right'),
  lineLineLeftTurn('left'),
  lineLineRightTurn('left'),
  lineLineRightTurn('right'),
  lineLineShallow(1, 'right'),
  lineLineShallow(1, 'left'),
  lineLineShallow(0.001, 'right'),
  fixture(
    'LL_PARALLEL_TANGENT',
    'line→line straight-ahead: identical tangent, parallel offsets never meet',
    lineMember(V.vx, V.vy, X, L, 'incoming'),
    lineMember(V.vx, V.vy, X, L, 'outgoing'),
    'right',
  ),
  fixture(
    'LL_HAIRPIN_NONLOCAL',
    'line→line hairpin (≈180° turn): offset miter lands far beyond V',
    lineMember(V.vx, V.vy, X, L, 'incoming'),
    lineMember(V.vx, V.vy, unit(-Math.cos(toRad(1)), Math.sin(toRad(1))), L, 'outgoing'),
    'right',
  ),
  {
    id: 'LL_SIDE_CONFLICT_WRONG',
    note: 'ORIENTATION CONFLICT (stress): both members offset on the left of a left turn while the chain side is right — the only local join is the opposite branch',
    input: {
      incoming: lineMember(V.vx, V.vy, X, L, 'incoming'),
      outgoing: lineMember(V.vx, V.vy, Y, L, 'outgoing'),
      side: 'right',
      incomingSide: 'left',
      outgoingSide: 'left',
      offset: 5,
      maxSearchDistance: 100,
    },
  },
  {
    id: 'LL_SIDE_CONFLICT_FOLD',
    note: 'ORIENTATION CONFLICT (stress): offsets on opposite physical sides fold onto the same front — the local join self-crosses',
    input: {
      incoming: lineMember(V.vx, V.vy, X, L, 'incoming'),
      outgoing: lineMember(V.vx, V.vy, Y, L, 'outgoing'),
      side: 'right',
      incomingSide: 'right',
      outgoingSide: 'left',
      offset: 5,
      maxSearchDistance: 100,
    },
  },
  lineArc('LA_CCW_GAP', 'line→arc CCW, right side (outside): outward offset radius R+d', 50, 1, 'right'),
  lineArc('LA_CCW_OVERLAP', 'line→arc CCW, left side (inside): inward offset radius R−d', 50, 1, 'left'),
  lineArc('LA_CW_GAP', 'line→arc CW, right side: inward offset radius R−d', 50, -1, 'right'),
  lineArc('LA_CW_OVERLAP', 'line→arc CW, left side: outward offset radius R+d', 50, -1, 'left'),
  lineArc('LA_CCW_LEFT_COLLAPSE', 'line→arc CCW left with d = R: offset radius collapses to a point', 5, 1, 'left', 5),
  lineArc('LA_CCW_LEFT_INVERSION', 'line→arc CCW left with d > R: offset radius inverts', 5, 1, 'left', 8),
  lineArc('LA_TANGENT_CONTACT', 'line→arc CCW left with R = 2d: constructed tangent, but the computed discriminant lands inside conditioning noise — unresolved, never a fabricated tangent point', 10, 1, 'left', 5),
  fixture(
    'LA_CLEAR_MISS',
    'line→arc CCW left with d = 6 > R/2: offset line cleanly misses the offset circle — explicit NONE',
    lineMember(V.vx, V.vy, X, L, 'incoming'),
    arcMember(V.vx, V.vy, -10, 0, 10, 1, Math.PI / 2, 'outgoing'),
    'left',
    6,
  ),
  fixture(
    'LL_SPAN_MISMATCH',
    'line→line 90° corner on 1 m member bodies: the geometric offset join at |J−V| ≈ 7.07 lies past both bodies — NONLOCAL, not a usable join',
    lineMember(V.vx, V.vy, X, 1, 'incoming'),
    lineMember(V.vx, V.vy, Y, 1, 'outgoing'),
    'right',
  ),
  arcLine('AL_CW_GAP', 'arc→line CW incoming, right side (outside)', 50, -1, 'right'),
  arcLine('AL_CW_OVERLAP', 'arc→line CW incoming, left side (inside)', 50, -1, 'left'),
  arcLine('AL_CCW_GAP', 'arc→line CCW incoming, right side', 50, 1, 'right'),
  arcLine('AL_CCW_OVERLAP', 'arc→line CCW incoming, left side', 50, 1, 'left'),
  arcArc('AA_CCW_CCW_GAP', 'arc→arc reference: CCW/CCW, right side, equal radii', 50, 1, 50, 1, 'right'),
  arcArc('AA_CCW_CCW_OVERLAP', 'arc→arc reference: CCW/CCW, left side, equal radii', 50, 1, 50, 1, 'left'),
  arcArc('AA_CW_CW_GAP', 'arc→arc reference: CW/CW, right side, equal radii', 50, -1, 50, -1, 'right'),
  arcArc('AA_CCW_CW_GAP', 'arc→arc reference: CCW in / CW out, right side', 50, 1, 50, -1, 'right'),
  arcArc('AA_UNEQUAL_GAP', 'arc→arc reference: unequal radii 30 / 80', 30, 1, 80, 1, 'right'),
  arcArc('AA_UNEQUAL_OVERLAP', 'arc→arc reference: unequal radii 30 / 80, left side', 30, 1, 80, 1, 'left'),
  fixture(
    'AA_COINCIDENT_SAME_CENTER',
    'arc→arc reference on one circle (same centre, same radius, same side): the two offset circles COINCIDE — infinite intersections, explicit AMBIGUOUS, never NONE',
    arcMember(V.vx, V.vy, 0, 50, 50, 1, Math.PI / 2, 'incoming'),
    arcMember(V.vx, V.vy, 0, 50, 50, 1, Math.PI / 2, 'outgoing'),
    'right',
  ),
];

export const JOIN_FIXTURE_BY_ID: ReadonlyMap<string, JoinFixture> = new Map(
  JOIN_FIXTURES.map((f) => [f.id, f]),
);

export const runJoinFixture = (f: JoinFixture): OffsetJoinResult => classifyOffsetJoin(f.input);

/** Translate + rotate copy invariants for one fixture (join, extents, conditioning). */
export const transformedJoin = (
  f: JoinFixture,
  angle: number,
  dx: number,
  dy: number,
): OffsetJoinResult => classifyOffsetJoin(transformInput(f.input, angle, dx, dy));

export interface JoinEvidenceRow {
  id: string;
  classification: string;
  turn: string | null;
  intersections: number;
  candidates: number;
  localCandidates: number;
  extent: number | null;
  conditioning: number;
  illConditioned: boolean;
  policyRequired: boolean;
  detail: string;
}

/** Deterministic evidence dump over every fixture (for docs + tests). */
export const summarizeFixtures = (): JoinEvidenceRow[] =>
  JOIN_FIXTURES.map((f) => {
    const r = runJoinFixture(f);
    return {
      id: f.id,
      classification: r.classification,
      turn: r.turn,
      intersections: r.intersections.length,
      candidates: r.candidates.length,
      localCandidates: r.candidates.filter((c) => c.local).length,
      extent: r.extent,
      conditioning: r.conditioning.value,
      illConditioned: r.conditioning.illConditioned,
      policyRequired: r.policyRequired,
      detail: r.detail,
    };
  });
