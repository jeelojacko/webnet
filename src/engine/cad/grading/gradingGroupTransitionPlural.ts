/**
 * Phase 20N.1 Wave E — plural transition group tiling (Candidate A ONLY:
 * strictly-separated collinear same-family joints).
 *
 * Validates ALL intents against immutable solves first, then rebuilds each
 * affected member atomically once (never sequential mutating single-joint
 * plans). Shared tile kernel comes from `./gradingGroupTransitionTile`.
 */
import { solveGradingChord } from './solveAnalyticGradingChord';
import {
  admitGradingTransition,
  checkGroupTransitionSeparation,
  checkSlopedPluralUnstudied,
  computeJointStations,
  deriveGroupTransitionExpectation,
  evaluateTransitionLinearV1,
  parseCanonicalJointIndex,
  selectGroupTransitions,
  transitionRejectGroupCode as transitionPolicyToGroupCode,
  transitionSetStationGaps,
} from './gradingTransitionPolicy';
import type { StraightChordSolve } from './solveStraightChord';
import type { GradingCriterion, GradingSide, ResolvedGradingSource } from './gradingTypes';
import type { CadGradingTransition, GroupDiagnosticCode } from './gradingGroupTypes';
import type { GradingTopologyExpectation } from './gradingTopologyExpectation';
import { transitionEvidenceMatchesIntent } from './gradingTransitionProvenance';
import {
  transitionDaylightAt,
  transitionFail,
  type MemberSolve,
  type PlannedTransition,
  type TransitionTileFailure,
  type TransitionTileInput,
} from './gradingGroupTransitionTile';
/**
 * Phase 20N.1 Wave E — multi-transition group tiling (Candidate A ONLY:
 * strictly-separated collinear same-family joints, decision.md §3).
 *
 * Two phases, strictly ordered:
 * 1. VALIDATE (immutable): every intent admitted per joint with
 *    `transitionCount: 1` against the ORIGINAL member geometry/criteria,
 *    canonical consecutive order via the ONE group authority
 *    (`selectGroupTransitions`), strict separation via
 *    `checkGroupTransitionSeparation` (exact `<`), and the independent
 *    pre-mesh declaration via `deriveGroupTransitionExpectation`. One bad
 *    intent fails the whole group; `solved` is never touched here.
 * 2. STITCH (atomic): each affected member rebuilt EXACTLY ONCE from the
 *    member transition-claim table (at most a START-claim from joint m-1
 *    as R plus an END-claim from joint m as L). A doubly-claimed shared
 *    middle keeps ONE native analytic subsolve over [Wprev/2, Lm-Wnext/2]
 *    (positive length guaranteed by the strict predicate); singly-claimed
 *    ends reuse the legacy outer-native shape (zero-length natives reuse
 *    full-solve endpoint refs). Per-joint vertex/daylight refs are created
 *    once and shared by both incident members, so natives meet the
 *    legislated TRANSITION_LINEAR_V1 law exactly (C0 by construction).
 *    No C1.
 */
export interface GroupTransitionTile extends PlannedTransition {
  /** Persisted intent this tile was admitted from (canonical order). */
  intent: CadGradingTransition;
  /** Explicit total symmetric width W, source-line meters. */
  width: number;
  /** Joint vertex V (shared ref: both incident members tile to it). */
  vPt: { x: number; y: number; z: number };
  /** Legislated law midpoint daylight q0 (shared ref, C0 by construction). */
  q0pt: { x: number; y: number; z: number };
  /** Projection distance at q0 (result-leg checkpoint evidence). */
  d0save: number;
}

type PlanTransitionGroupOutcome =
  | { ok: true; plans: GroupTransitionTile[]; expectation: GradingTopologyExpectation }
  | TransitionTileFailure;

/** Rebuild ONE claimed member from its transition claims (pure: never touches `solved`). */
const stitchGroupMember = (
  side: GradingSide,
  maxSearchDistance: number,
  member: ResolvedGradingSource,
  criterion: GradingCriterion,
  full: StraightChordSolve,
  start: GroupTransitionTile | null,
  end: GroupTransitionTile | null,
): { ok: true; stitched: StraightChordSolve; nodeStations: number[] } | TransitionTileFailure => {
  const Lm = member.length;
  const flatOf = (pts: Array<{ x: number; y: number; z: number }>): number[] => {
    const flat: number[] = [];
    for (const p of pts) flat.push(p.x, p.y, p.z);
    return flat;
  };
  // Doubly-claimed shared middle: ONE native analytic subsolve between the
  // two cuts (positive length guaranteed by strict separation), transition-
  // owned head [0, Wp/2] + tail [Lm-Wn/2, Lm] around it.
  if (start !== null && end !== null) {
    const Wp = start.width;
    const Wn = end.width;
    const headCut = Wp / 2;
    const tailCut = Lm - Wn / 2;
    const midLen = tailCut - headCut;
    if (!(midLen > 0) || !Number.isFinite(midLen)) {
      return transitionFail(
        'TRANSITION_REJECTED',
        end.joint,
        'GRADING_AGREEMENT_TRANSITION_OVERLAP: shared member has no surviving native run',
      );
    }
    const Z = member.startZ;
    const tx = start.tx;
    const ty = start.ty;
    const Vx = member.startX;
    const Vy = member.startY;
    const Wx = member.endX;
    const Wy = member.endY;
    const sub = solveGradingChord({
      source: {
        startX: Vx + tx * headCut,
        startY: Vy + ty * headCut,
        endX: Wx - end.tx * (Wn / 2),
        endY: Wy - end.ty * (Wn / 2),
        startZ: Z,
        endZ: Z,
        length: midLen,
        reoriented: member.reoriented,
        isArc: false,
      },
      side,
      criterion,
      maxSearchDistance,
      stationBase: headCut,
      stationScale: 1,
    });
    if (!sub.ok) {
      return transitionFail(
        'TRANSITION_STALE',
        end.joint,
        `GRADING_AGREEMENT_TRANSITION_OFF_LAW: ${sub.detail ?? 'middle native failed'}`,
      );
    }
    const mid = sub.solve;
    const stitched: StraightChordSolve = {
      regions: [
        { classification: 'FIXED', stationSpan: [0, headCut] },
        ...mid.regions,
        { classification: 'FIXED', stationSpan: [tailCut, Lm] },
      ],
      diagnostics: [...mid.diagnostics],
      nodeStations: [0, ...mid.nodeStations, Lm],
      sourcePts: [start.vPt, ...mid.sourcePts, end.vPt],
      daylightPts: [start.q0pt, ...mid.daylightPts, end.q0pt],
      daylightFlat: [],
      distances: [start.d0save, ...mid.distances, end.d0save],
      candidateTriangleCount: mid.candidateTriangleCount,
      intersectionSegmentCount: mid.intersectionSegmentCount,
      multipleSolutionCount: mid.multipleSolutionCount,
    };
    stitched.daylightFlat = flatOf(stitched.daylightPts);
    return { ok: true, stitched, nodeStations: stitched.nodeStations };
  }
  // Singly-claimed end: the legacy outer-native shape (zero-length natives
  // reuse full-solve endpoint refs, exactly like the single-joint path).
  const tile = (end ?? start)!;
  const W = tile.width;
  if (end !== null) {
    const cutLStation = Lm - W / 2;
    let outerL: StraightChordSolve | null = null;
    if (cutLStation !== 0) {
      const sub = solveGradingChord({
        source: {
          startX: member.startX,
          startY: member.startY,
          endX: member.endX - tile.tx * (W / 2),
          endY: member.endY - tile.ty * (W / 2),
          startZ: member.startZ,
          endZ: member.startZ,
          length: cutLStation,
          reoriented: member.reoriented,
          isArc: false,
        },
        side,
        criterion,
        maxSearchDistance,
        stationBase: 0,
        stationScale: 1,
      });
      if (!sub.ok) {
        return transitionFail(
          'TRANSITION_STALE',
          tile.joint,
          `GRADING_AGREEMENT_TRANSITION_OFF_LAW: ${sub.detail ?? 'outer native failed'}`,
        );
      }
      outerL = sub.solve;
    }
    const pCutL = outerL !== null ? outerL.sourcePts[outerL.sourcePts.length - 1]! : full.sourcePts[0]!;
    const qCutL = outerL !== null ? outerL.daylightPts[outerL.daylightPts.length - 1]! : full.daylightPts[0]!;
    const stitched: StraightChordSolve = {
      regions: [
        ...(outerL !== null ? outerL.regions : []),
        { classification: 'FIXED', stationSpan: [cutLStation, Lm] },
      ],
      diagnostics: [...(outerL !== null ? outerL.diagnostics : [])],
      nodeStations: outerL !== null ? [...outerL.nodeStations.slice(0, -1), cutLStation, Lm] : [0, Lm],
      sourcePts: outerL !== null ? [...outerL.sourcePts.slice(0, -1), pCutL, tile.vPt] : [pCutL, tile.vPt],
      daylightPts: outerL !== null ? [...outerL.daylightPts.slice(0, -1), qCutL, tile.q0pt] : [qCutL, tile.q0pt],
      daylightFlat: [],
      distances: outerL !== null
        ? [...outerL.distances.slice(0, -1), outerL.distances[outerL.distances.length - 1]!, tile.d0save]
        : [full.distances[0]!, tile.d0save],
      candidateTriangleCount: outerL !== null ? outerL.candidateTriangleCount : 0,
      intersectionSegmentCount: outerL !== null ? outerL.intersectionSegmentCount : 0,
      multipleSolutionCount: outerL !== null ? outerL.multipleSolutionCount : 0,
    };
    stitched.daylightFlat = flatOf(stitched.daylightPts);
    return { ok: true, stitched, nodeStations: stitched.nodeStations };
  }
  const cutRStation = W / 2;
  let outerR: StraightChordSolve | null = null;
  if (Lm - W / 2 !== 0) {
    const sub = solveGradingChord({
      source: {
        startX: member.startX + tile.tx * (W / 2),
        startY: member.startY + tile.ty * (W / 2),
        endX: member.endX,
        endY: member.endY,
        startZ: member.startZ,
        endZ: member.startZ,
        length: Lm - W / 2,
        reoriented: member.reoriented,
        isArc: false,
      },
      side,
      criterion,
      maxSearchDistance,
      stationBase: cutRStation,
      stationScale: 1,
    });
    if (!sub.ok) {
      return transitionFail(
        'TRANSITION_STALE',
        tile.joint,
        `GRADING_AGREEMENT_TRANSITION_OFF_LAW: ${sub.detail ?? 'outer native failed'}`,
      );
    }
    outerR = sub.solve;
  }
  const pCutR = outerR !== null ? outerR.sourcePts[0]! : full.sourcePts[full.sourcePts.length - 1]!;
  const qCutR = outerR !== null ? outerR.daylightPts[0]! : full.daylightPts[full.daylightPts.length - 1]!;
  const stitched: StraightChordSolve = {
    regions: [
      { classification: 'FIXED', stationSpan: [0, cutRStation] },
      ...(outerR !== null ? outerR.regions : []),
    ],
    diagnostics: [...(outerR !== null ? outerR.diagnostics : [])],
    nodeStations: outerR !== null ? [0, cutRStation, ...outerR.nodeStations.slice(1)] : [0, cutRStation],
    sourcePts: outerR !== null ? [tile.vPt, pCutR, ...outerR.sourcePts.slice(1)] : [tile.vPt, pCutR],
    daylightPts: outerR !== null ? [tile.q0pt, qCutR, ...outerR.daylightPts.slice(1)] : [tile.q0pt, qCutR],
    daylightFlat: [],
    distances: outerR !== null
      ? [tile.d0save, outerR.distances[0]!, ...outerR.distances.slice(1)]
      : [tile.d0save, full.distances[full.distances.length - 1]!],
    candidateTriangleCount: outerR !== null ? outerR.candidateTriangleCount : 0,
    intersectionSegmentCount: outerR !== null ? outerR.intersectionSegmentCount : 0,
    multipleSolutionCount: outerR !== null ? outerR.multipleSolutionCount : 0,
  };
  stitched.daylightFlat = flatOf(stitched.daylightPts);
  return { ok: true, stitched, nodeStations: stitched.nodeStations };
};

/**
 * Validate ALL intents against the immutable original solves, then rebuild
 * each affected member atomically once (publish to `solved` only after
 * every member succeeds — one bad intent means no partial solve).
 */
export const planTransitionGroup = (
  input: TransitionTileInput,
  intents: CadGradingTransition[],
  members: ResolvedGradingSource[],
  criterionAt: (_memberIndex: number) => GradingCriterion,
  solved: MemberSolve[],
  jointCount: number,
): PlanTransitionGroupOutcome => {
  // Canonical consecutive order via the ONE group authority (never
  // re-sorted, never merged silently).
  const selection = selectGroupTransitions(intents);
  if (selection.kind !== 'group') {
    if (selection.kind === 'rejected') return transitionFail(selection.code, undefined, selection.detail);
    return transitionFail(
      'TRANSITION_MALFORMED',
      undefined,
      'GRADING_AGREEMENT_TRANSITION_MALFORMED: group path requires N >= 2 intents',
    );
  }
  if (input.closed === true) {
    const first = parseCanonicalJointIndex(intents[0]?.jointId);
    return transitionFail(
      'TRANSITION_REJECTED',
      first ?? undefined,
      'GRADING_AGREEMENT_TRANSITION_CLOSED: closed routes excluded',
    );
  }
  const keys = input.transitionMemberKeys;
  interface AdmittedJoint {
    joint: number;
    intent: CadGradingTransition;
    vL: number;
    vR: number;
    sL: number;
    sR: number;
    width: number;
    family: 'distance' | 'relative-elevation' | 'elevation';
    g: number;
  }
  // Phase 20Q.1 singular scope: a plural set with ANY non-flat transitioned
  // joint rejects whole-group BEFORE per-joint admission (never a faked
  // per-joint transitionCount — trp1 still sees transitionCount: 1 below).
  const slopedPlural = checkSlopedPluralUnstudied(
    selection.transitions.length,
    selection.transitions.map((intent) => {
      const joint = parseCanonicalJointIndex(intent.jointId);
      // Unresolvable here fails closed in Phase 1; never the sloped gate.
      if (joint === null || !Array.isArray(keys)) return true;
      const mL = members[joint];
      const mR = members[joint + 1];
      if (!mL || !mR) return true;
      return mL.startZ === mL.endZ && mR.startZ === mR.endZ;
    }),
  );
  if (slopedPlural !== null) {
    const first = parseCanonicalJointIndex(selection.transitions[0]?.jointId);
    return transitionFail(
      'TRANSITION_REJECTED',
      first ?? undefined,
      `GRADING_AGREEMENT_TRANSITION_NON_FLAT: ${slopedPlural}`,
    );
  }
  // Phase 1: admit EVERY joint (per-joint trp1, transitionCount: 1) before
  // touching `solved`.
  const admitted: AdmittedJoint[] = [];
  for (const intent of selection.transitions) {
    const joint = parseCanonicalJointIndex(intent.jointId);
    if (joint === null || !(joint >= 0) || !(joint < jointCount)) {
      return transitionFail(
        'TRANSITION_MALFORMED',
        joint ?? undefined,
        'GRADING_AGREEMENT_TRANSITION_MALFORMED: jointId must be joint:<joint index>',
      );
    }
    const L = joint;
    const R = joint + 1;
    const refL = Array.isArray(intent.memberIds) ? intent.memberIds[0] : undefined;
    const refR = Array.isArray(intent.memberIds) ? intent.memberIds[1] : undefined;
    if (!Array.isArray(keys) || keys.length < R + 1 || keys[L] !== refL || keys[R] !== refR) {
      return transitionFail(
        'TRANSITION_STALE',
        joint,
        'GRADING_AGREEMENT_TRANSITION_STALE: memberIds do not resolve to adjacent members',
      );
    }
    const mL = members[L]!;
    const mR = members[R]!;
    const cL = criterionAt(L);
    const cR = criterionAt(R);
    const ok = admitGradingTransition({
      policyVersion: intent.policyVersion,
      lawKind: intent.lawKind,
      lawVersion: intent.lawVersion,
      criterionFamily: intent.criterionFamily,
      jointId: intent.jointId,
      memberIds: [keys[L]!, keys[R]!],
      width: intent.width,
      side: intent.side,
      groupSide: input.side,
      isOpen: true,
      transitionCount: 1,
      jointZ: mL.endZ,
      members: [
        {
          memberId: keys[L]!,
          criterion: cL,
          length: mL.length,
          dirX: mL.endX - mL.startX,
          dirY: mL.endY - mL.startY,
          startZ: mL.startZ,
          endZ: mL.endZ,
          isArc: mL.isArc,
          maxSearchDistance: input.maxSearchDistance,
        },
        {
          memberId: keys[R]!,
          criterion: cR,
          length: mR.length,
          dirX: mR.endX - mR.startX,
          dirY: mR.endY - mR.startY,
          startZ: mR.startZ,
          endZ: mR.endZ,
          isArc: mR.isArc,
          maxSearchDistance: input.maxSearchDistance,
        },
      ],
    });
    if (!ok.ok) {
      return transitionFail(
        transitionPolicyToGroupCode(ok.code),
        joint,
        `GRADING_AGREEMENT_TRANSITION_${ok.code}: ${ok.detail}`,
      );
    }
    if (!transitionEvidenceMatchesIntent(intent, input.revision)) {
      return transitionFail('TRANSITION_STALE', joint, 'GRADING_AGREEMENT_TRANSITION_STALE: provenance malformed');
    }
    if (intent.endpoints !== undefined && (intent.endpoints === null || typeof intent.endpoints !== 'object' || Array.isArray(intent.endpoints))) {
      return transitionFail(
        'TRANSITION_STALE',
        joint,
        'GRADING_AGREEMENT_TRANSITION_STALE: endpoint evidence malformed',
      );
    }
    if (intent.endpoints !== undefined) {
      const refs = intent.endpoints.refs;
      const values = intent.endpoints.values;
      if (
        !Array.isArray(refs) ||
        !Array.isArray(values) ||
        refs.length !== 2 ||
        values.length !== 2 ||
        refs[0] !== keys[L] ||
        refs[1] !== keys[R] ||
        values[0] !== ok.vL ||
        values[1] !== ok.vR
      ) {
        return transitionFail(
          'TRANSITION_STALE',
          joint,
          'GRADING_AGREEMENT_TRANSITION_STALE: endpoint evidence mismatch',
        );
      }
    }
    admitted.push({
      joint,
      intent,
      vL: ok.vL,
      vR: ok.vR,
      sL: ok.sL,
      sR: ok.sR,
      width: ok.width,
      family: ok.family,
      g: (cL as { gradeRatio: number }).gradeRatio,
    });
  }
  // Strict separation on every set gap (exact `<`; touching == and
  // overlap both fail the whole group). One stations pass over the full
  // member run; gaps are station differences, never repeated prefix sums.
  const widths = admitted.map((a) => a.width);
  const stations = computeJointStations(members.map((m) => m.length));
  const gaps = transitionSetStationGaps(
    stations,
    admitted.map((a) => a.joint),
  );
  if (!checkGroupTransitionSeparation(widths, gaps)) {
    let at = admitted[0]!.joint;
    for (let k = 0; k < gaps.length; k += 1) {
      if (!(widths[k]! / 2 + widths[k + 1]! / 2 < gaps[k]!)) {
        at = admitted[k]!.joint;
        break;
      }
    }
    return transitionFail(
      'TRANSITION_REJECTED',
      at,
      'GRADING_AGREEMENT_TRANSITION_OVERLAP: strict separation W_i/2+W_{i+1}/2 < gap violated (touching/overlap rejected)',
    );
  }
  // Independent pre-mesh declaration of the single merged strip (never
  // from a measured mesh count).
  const declared = deriveGroupTransitionExpectation(admitted.map((a) => ({
    jointId: a.intent.jointId,
    width: a.width,
    memberLengths: [members[a.joint]!.length, members[a.joint + 1]!.length] as [number, number],
    isOpen: true,
  })), gaps);
  if (!declared.ok) return transitionFail(declared.code, admitted[0]!.joint, declared.detail);
  // Immutable per-joint tiles: frames + checkpoints from the ORIGINAL
  // solves (created once, shared by both incident members below).
  const tiles: GroupTransitionTile[] = [];
  for (const a of admitted) {
    const frameL = solved[a.joint]!;
    const mL = members[a.joint]!;
    const tx = frameL.tOut.nx;
    const ty = frameL.tOut.ny;
    const nx = frameL.nOut.nx;
    const ny = frameL.nOut.ny;
    const Z = mL.endZ;
    const v0 = evaluateTransitionLinearV1(a.vL, a.vR, a.sL, a.sR, 0);
    const q0raw = transitionDaylightAt(a.family, v0, a.g, Z, mL.endX, mL.endY, nx, ny);
    if (![q0raw.x, q0raw.y, q0raw.z, q0raw.d].every(Number.isFinite)) {
      return transitionFail(
        'TRANSITION_REJECTED',
        a.joint,
        'GRADING_AGREEMENT_TRANSITION_MESH: non-finite joint daylight',
      );
    }
    // Per-joint vertex/daylight refs are created ONCE here and embedded by
    // reference into both incident members below (C0 by shared refs).
    const vPt = { x: mL.endX, y: mL.endY, z: mL.endZ };
    const q0pt = { x: q0raw.x, y: q0raw.y, z: q0raw.z };
    tiles.push({
      joint: a.joint,
      tx,
      ty,
      d0: q0raw.d,
      tieXyz: [q0raw.x, q0raw.y, q0raw.z],
      runFlat: [],
      law: { sL: a.sL, sR: a.sR, vL: a.vL, vR: a.vR, family: a.family },
      srcFlat: [],
      jointStation: stations[a.joint]!,
      intent: a.intent,
      width: a.width,
      vPt,
      q0pt,
      d0save: q0raw.d,
    });
  }
  // Phase 2: rebuild each affected member EXACTLY ONCE (full-solve
  // endpoint refs snapshotted before any publish; publish only when every
  // member succeeds).
  const fullStitched = solved.map((s) => s.stitched);
  const byJoint = new Map<number, GroupTransitionTile>();
  for (const t of tiles) byJoint.set(t.joint, t);
  const rebuilt = new Map<number, { stitched: StraightChordSolve; nodeStations: number[] }>();
  for (let m = 0; m < members.length; m += 1) {
    const start = byJoint.get(m - 1) ?? null;
    const end = byJoint.get(m) ?? null;
    if (start === null && end === null) continue;
    const built = stitchGroupMember(
      input.side,
      input.maxSearchDistance,
      members[m]!,
      criterionAt(m),
      fullStitched[m]!,
      start,
      end,
    );
    if (!built.ok) return built;
    rebuilt.set(m, { stitched: built.stitched, nodeStations: built.nodeStations });
  }
  // Fill per-tile checkpoint runs from the rebuilt members (cut refs owned
  // by the native subsolves, joint refs shared) — still before publish.
  for (const t of tiles) {
    const left = rebuilt.get(t.joint);
    const right = rebuilt.get(t.joint + 1);
    if (!left || !right) {
      return transitionFail(
        'TRANSITION_REJECTED',
        t.joint,
        'GRADING_AGREEMENT_TRANSITION_MESH: claim table left a joint side unbuilt',
      );
    }
    const lSrc = left.stitched.sourcePts;
    const lDl = left.stitched.daylightPts;
    const rSrc = right.stitched.sourcePts;
    const rDl = right.stitched.daylightPts;
    const pCutL = lSrc[lSrc.length - 2]!;
    const qCutL = lDl[lDl.length - 2]!;
    const pCutR = rSrc[1]!;
    const qCutR = rDl[1]!;
    t.runFlat = [qCutL.x, qCutL.y, qCutL.z, t.q0pt.x, t.q0pt.y, t.q0pt.z, qCutR.x, qCutR.y, qCutR.z];
    t.srcFlat = [pCutL.x, pCutL.y, pCutL.z, t.vPt.x, t.vPt.y, t.vPt.z, pCutR.x, pCutR.y, pCutR.z];
  }
  for (const [m, r] of rebuilt) {
    solved[m] = { ...solved[m]!, stitched: r.stitched, nodeStations: r.nodeStations };
  }
  return { ok: true, plans: tiles, expectation: declared.expectation };
};
