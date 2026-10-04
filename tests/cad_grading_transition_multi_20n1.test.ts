/**
 * Phase 20N.1 WAVE A (RED) — multiple collinear same-family transitions.
 *
 * NO src/ changes (tests only). RED tests assert the AUTHORIZED future
 * predicate (decision.md §3: per-joint trp1 with transitionCount:1 +
 * strict separation + canonical order + whole-group fail-closed) through
 * CURRENT production authorities — they FAIL today on cardinality, proving
 * the gap. GREEN pins characterize the gap (per-joint math already valid;
 * group path rejects ONLY on cardinality) and must pass now and after.
 *
 * Production authorities reused by import: admitGradingTransition,
 * selectGroupTransition, deriveTransitionExpectation, buildMultiGroup
 * (study geometry over REAL shared members). No new epsilon.
 */
import { describe, expect, it } from 'vitest';
import {
  admitGradingTransition,
  selectGroupTransition,
  selectGroupTransitions,
} from '../src/engine/cad/grading/gradingTransitionPolicy';
import { deriveTransitionExpectation } from '../src/engine/cad/grading/gradingTopologyExpectation';
import {
  buildMultiGroup,
  type MultiFamily,
  type MultiGeometry,
} from '../scripts/phase20nMultiTransitionMesh';

const FAMILIES: MultiFamily[] = ['distance', 'relative-elevation', 'elevation'];
const jointZ = (family: MultiFamily): number => (family === 'elevation' ? 0 : 10);
const maxSearch = (family: MultiFamily): number => (family === 'elevation' ? 100 : 50);

/** Live per-joint admission input from study geometry (real shared members). */
const admitAtJoint = (geometry: MultiGeometry, joint: number, transitionCount: number) => {
  const jt = geometry.joints[joint]!;
  const family = geometry.spec.family;
  const member = (k: number) => {
    const m = geometry.members[k]!;
    return {
      memberId: m.id,
      criterion: m.criterion,
      length: m.length,
      dirX: 1,
      dirY: 0,
      startZ: jointZ(family),
      endZ: jointZ(family),
      isArc: false,
      maxSearchDistance: maxSearch(family),
    };
  };
  return admitGradingTransition({
    policyVersion: 'trp1',
    lawKind: 'TRANSITION_LINEAR_V1',
    lawVersion: 'v1',
    criterionFamily: family,
    jointId: jt.jointId,
    memberIds: [geometry.members[jt.memberL]!.id, geometry.members[jt.memberR]!.id],
    width: jt.width,
    side: 'left',
    groupSide: 'left',
    isOpen: true,
    transitionCount,
    jointZ: jointZ(family),
    members: [member(jt.memberL), member(jt.memberR)],
  });
};

const geometry2T = (family: MultiFamily): MultiGeometry => {
  const out = buildMultiGroup({
    fixtureId: 'x', family, memberLengths: [30, 24, 30], widths: [8, 6],
    transform: 'identity', expected: 'x', eligible: true,
  });
  expect(out.ok).toBe(true);
  if (!out.ok) throw new Error('2T fixture must build');
  return out.geometry;
};

const geometry3T = (family: MultiFamily): MultiGeometry => {
  const out = buildMultiGroup({
    fixtureId: 'x', family, memberLengths: [30, 24, 26, 30], widths: [8, 6, 4],
    transform: 'identity', expected: 'x', eligible: true,
  });
  expect(out.ok).toBe(true);
  if (!out.ok) throw new Error('3T fixture must build');
  return out.geometry;
};

describe('20N.1 RED: 2T/3-collinear-members per family, widths 8/6, shared middle 24', () => {
  it.each(FAMILIES)('GREEN pin: both joints independently valid via count:1 (%s)', (family) => {
    const g = geometry2T(family);
    for (let j = 0; j < 2; j += 1) {
      const admitted = admitAtJoint(g, j, 1);
      expect(admitted.ok).toBe(true);
    }
  });

  it.each(FAMILIES)('GREEN pin: group path rejects ONLY on cardinality (%s)', (family) => {
    const g = geometry2T(family);
    // Same live math, group count 2 → CARDINALITY (not per-joint math).
    for (let j = 0; j < 2; j += 1) {
      const counted = admitAtJoint(g, j, 2);
      expect(counted.ok).toBe(false);
      if (!counted.ok) expect(counted.code).toBe('CARDINALITY');
    }
    const sel = selectGroupTransition([{ jointId: 'joint:0' }, { jointId: 'joint:1' }]);
    expect(sel).toMatchObject({ kind: 'rejected', code: 'TRANSITION_REJECTED' });
    const pre = deriveTransitionExpectation(
      { scope: 'group', closed: false, positiveWidthRegions: 1 },
      { jointId: 'joint:0', width: 8, memberLengths: [30, 24], transitionCount: 2, isOpen: true },
    );
    expect(pre.ok).toBe(false);
  });

  it.each(FAMILIES)('RED: future predicate admits the 2T pair (%s)', (family) => {
    const g = geometry2T(family);
    // Authorized §3.1: each joint evaluated with transitionCount:1; the
    // canonical consecutive pair admits as one group (Wave B authority).
    const sel = selectGroupTransitions([{ jointId: 'joint:0' }, { jointId: 'joint:1' }]);
    expect(sel.kind).toBe('group');
    if (sel.kind === 'group') {
      expect(sel.transitions.map((t) => t.jointId)).toEqual(['joint:0', 'joint:1']);
    }
    expect(g.joints).toHaveLength(2);
  });
});

describe('20N.1 RED: 3T/4-members per family, widths 8/6/4, lengths [30,24,26,30]', () => {
  it.each(FAMILIES)('GREEN pin: all three joints independently valid via count:1 (%s)', (family) => {
    const g = geometry3T(family);
    for (let j = 0; j < 3; j += 1) {
      expect(admitAtJoint(g, j, 1).ok).toBe(true);
    }
  });

  it.each(FAMILIES)('GREEN pin: group path rejects ONLY on cardinality (%s)', (family) => {
    const g = geometry3T(family);
    for (let j = 0; j < 3; j += 1) {
      const counted = admitAtJoint(g, j, 3);
      expect(counted.ok).toBe(false);
      if (!counted.ok) expect(counted.code).toBe('CARDINALITY');
    }
    const sel = selectGroupTransition([{ jointId: 'joint:0' }, { jointId: 'joint:1' }, { jointId: 'joint:2' }]);
    expect(sel).toMatchObject({ kind: 'rejected', code: 'TRANSITION_REJECTED' });
  });

  it.each(FAMILIES)('RED: future predicate admits the 3T triple (%s)', (family) => {
    const g = geometry3T(family);
    const sel = selectGroupTransitions([{ jointId: 'joint:0' }, { jointId: 'joint:1' }, { jointId: 'joint:2' }]);
    expect(sel.kind).toBe('group');
    if (sel.kind === 'group') {
      expect(sel.transitions.map((t) => t.jointId)).toEqual(['joint:0', 'joint:1', 'joint:2']);
    }
    expect(g.joints).toHaveLength(3);
  });
});

describe('20N.1 RED: whole-group fail-closed (one bad joint, no partial solve)', () => {
  it('GREEN pin: stale endpoint fails per-joint admission (no partial solve possible)', () => {
    const g = geometry2T('distance');
    const jt = g.joints[0]!;
    const stale = admitGradingTransition({
      policyVersion: 'trp1', lawKind: 'TRANSITION_LINEAR_V1', lawVersion: 'v1',
      criterionFamily: 'distance', jointId: jt.jointId,
      memberIds: ['STALE-A', 'STALE-B'], width: jt.width,
      side: 'left', groupSide: 'left', isOpen: true, transitionCount: 1, jointZ: 10,
      members: [
        { memberId: g.members[0]!.id, criterion: g.members[0]!.criterion, length: 30, dirX: 1, dirY: 0, startZ: 10, endZ: 10, isArc: false, maxSearchDistance: 50 },
        { memberId: g.members[1]!.id, criterion: g.members[1]!.criterion, length: 24, dirX: 1, dirY: 0, startZ: 10, endZ: 10, isArc: false, maxSearchDistance: 50 },
      ],
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.code).toBe('MEMBER_REF_STALE');
    // Group gate stays shut for the pair regardless.
    expect(selectGroupTransition([{ jointId: 'joint:0' }, { jointId: 'joint:1' }]).kind).toBe('rejected');
  });

  it('GREEN pins: bent / grade-mismatch / too-wide joints fail per-joint admission', () => {
    const g = geometry2T('distance');
    const good = admitAtJoint(g, 0, 1);
    expect(good.ok).toBe(true);
    // Bent (deflection): NON_COLLINEAR.
    const bent = admitGradingTransition({
      policyVersion: 'trp1', lawKind: 'TRANSITION_LINEAR_V1', lawVersion: 'v1',
      criterionFamily: 'distance', jointId: 'joint:0',
      memberIds: [g.members[0]!.id, g.members[1]!.id], width: 8,
      side: 'left', groupSide: 'left', isOpen: true, transitionCount: 1, jointZ: 10,
      members: [
        { memberId: g.members[0]!.id, criterion: g.members[0]!.criterion, length: 30, dirX: 1, dirY: 0, startZ: 10, endZ: 10, isArc: false, maxSearchDistance: 50 },
        { memberId: g.members[1]!.id, criterion: g.members[1]!.criterion, length: 24, dirX: 1, dirY: 1, startZ: 10, endZ: 10, isArc: false, maxSearchDistance: 50 },
      ],
    });
    expect(bent.ok).toBe(false);
    if (!bent.ok) expect(bent.code).toBe('NON_COLLINEAR');
    // Grade mismatch.
    const graded = admitGradingTransition({
      policyVersion: 'trp1', lawKind: 'TRANSITION_LINEAR_V1', lawVersion: 'v1',
      criterionFamily: 'distance', jointId: 'joint:0',
      memberIds: [g.members[0]!.id, g.members[1]!.id], width: 8,
      side: 'left', groupSide: 'left', isOpen: true, transitionCount: 1, jointZ: 10,
      members: [
        { memberId: g.members[0]!.id, criterion: { kind: 'distance', gradeRatio: 0.5, distance: 5 }, length: 30, dirX: 1, dirY: 0, startZ: 10, endZ: 10, isArc: false, maxSearchDistance: 50 },
        { memberId: g.members[1]!.id, criterion: { kind: 'distance', gradeRatio: 0.9, distance: 7 }, length: 24, dirX: 1, dirY: 0, startZ: 10, endZ: 10, isArc: false, maxSearchDistance: 50 },
      ],
    });
    expect(graded.ok).toBe(false);
    if (!graded.ok) expect(graded.code).toBe('GRADE_MISMATCH');
    // Too wide for the shared middle (W=70 > 2*24).
    const wide = admitAtJoint({ ...g, joints: [{ ...g.joints[0]!, width: 70 }] }, 0, 1);
    expect(wide.ok).toBe(false);
    if (!wide.ok) expect(wide.code).toBe('WIDTH_INFEASIBLE');
  });

  it('RED: all-valid 2T group solves as a group (no cardinality block)', () => {
    const g = geometry2T('distance');
    expect(admitAtJoint(g, 0, 1).ok).toBe(true);
    expect(admitAtJoint(g, 1, 1).ok).toBe(true);
    const sel = selectGroupTransitions([{ jointId: 'joint:0' }, { jointId: 'joint:1' }]);
    expect(sel.kind).toBe('group');
  });
});
