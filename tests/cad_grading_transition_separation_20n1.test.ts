/**
 * Phase 20N.1 WAVE A (RED) — strict separation, intent order, legacy and
 * non-authorized pins.
 *
 * NO src/ changes (tests only). RED tests assert the authorized future
 * predicate (decision.md §3.2–§3.3: strict `<` separation, canonical
 * joint-index order) through CURRENT production authorities — they FAIL
 * today, proving the gap. GREEN pins (legacy single-transition behavior,
 * exclusions, study-level order/separation gates) pass now and after.
 *
 * Production authorities reused by import: deriveTransitionExpectation,
 * selectGroupTransition, admitGradingTransition, study buildMultiGroup /
 * assertCanonicalJointOrder / parseJointIndex. No new epsilon.
 */
import { describe, expect, it } from 'vitest';
import {
  admitGradingTransition,
  checkGroupTransitionSeparation,
  deriveGroupTransitionExpectation,
  selectGroupTransition,
  selectGroupTransitions,
} from '../src/engine/cad/grading/gradingTransitionPolicy';
import { deriveTransitionExpectation } from '../src/engine/cad/grading/gradingTopologyExpectation';
import {
  assertCanonicalJointOrder,
  buildMultiGroup,
  parseJointIndex,
} from '../scripts/phase20nMultiTransitionMesh';

const member = (memberId: string, distance: number, length: number, dirY = 0, isArc = false) => ({
  memberId,
  criterion: { kind: 'distance', gradeRatio: 0.5, distance } as const,
  length,
  dirX: 1,
  dirY,
  startZ: 10,
  endZ: 10,
  isArc,
  maxSearchDistance: 50,
});

describe('20N.1 separation: strict Wi/2+W(i+1)/2 < gap via real group layout', () => {
  it('GREEN pin: positive native gap (17) builds at study level; touching/overlap fail closed', () => {
    const ok = buildMultiGroup({
      fixtureId: 'x', family: 'distance', memberLengths: [30, 24, 30], widths: [8, 6],
      transform: 'identity', expected: 'x', eligible: true,
    });
    expect(ok.ok).toBe(true);
    const touching = buildMultiGroup({
      fixtureId: 'x', family: 'distance', memberLengths: [30, 7, 30], widths: [8, 6],
      transform: 'identity', expected: 'x', eligible: false,
    });
    expect(touching.ok).toBe(false);
    if (!touching.ok) expect(touching.code).toBe('TOUCHING_NOT_AUTHORIZED');
    const overlap = buildMultiGroup({
      fixtureId: 'x', family: 'distance', memberLengths: [30, 5, 30], widths: [8, 6],
      transform: 'identity', expected: 'x', eligible: false,
    });
    expect(overlap.ok).toBe(false);
    if (!overlap.ok) expect(overlap.code).toBe('OVERLAP_REJECTED');
  });

  it('GREEN pin: tiny positive representable gap builds as one strip at study level', () => {
    const tiny = buildMultiGroup({
      fixtureId: 'x', family: 'distance', memberLengths: [30, 7.0001, 30], widths: [8, 6],
      transform: 'identity', expected: 'x', eligible: true,
    });
    expect(tiny.ok).toBe(true);
  });

  it('RED: future production predicate admits the strictly-separated pair', () => {
    // 4+3=7 < 24: separation holds on the real shared middle member.
    const pre = deriveGroupTransitionExpectation([
      { jointId: 'joint:0', width: 8, memberLengths: [30, 24], isOpen: true },
      { jointId: 'joint:1', width: 6, memberLengths: [24, 30], isOpen: true },
    ]);
    expect(pre.ok).toBe(true);
  });

  it('RED: future production predicate admits the tiny-positive-gap pair', () => {
    const pre = deriveGroupTransitionExpectation([
      { jointId: 'joint:0', width: 8, memberLengths: [30, 7.0001], isOpen: true },
      { jointId: 'joint:1', width: 6, memberLengths: [7.0001, 30], isOpen: true },
    ]);
    expect(pre.ok).toBe(true);
  });
});

describe('20N.1 intent order: canonical increasing, never silently sorted', () => {
  it('GREEN pins: duplicate / out-of-order / malformed joint lists reject; canonical passes', () => {
    expect(() => assertCanonicalJointOrder(['joint:0', 'joint:0'])).toThrow();
    expect(() => assertCanonicalJointOrder(['joint:1', 'joint:0'])).toThrow();
    expect(() => parseJointIndex('bogus')).toThrow();
    expect(() => parseJointIndex('joint:')).toThrow();
    expect(() => assertCanonicalJointOrder(['joint:0', 'joint:1', 'joint:2'])).not.toThrow();
  });

  it('GREEN pin: multi-intent group never silently sorts — still rejected wholesale', () => {
    // Out-of-order persisted list must reject, never re-sort into admission.
    const sel = selectGroupTransition([{ jointId: 'joint:1' }, { jointId: 'joint:0' }]);
    expect(sel).toMatchObject({ kind: 'rejected', code: 'TRANSITION_REJECTED' });
  });

  it('RED: authoring-generated canonical list is admitted as a group', () => {
    const canonical = ['joint:0', 'joint:1'].map((jointId) => ({ jointId }));
    expect(() => assertCanonicalJointOrder(canonical.map((c) => c.jointId))).not.toThrow();
    const sel = selectGroupTransitions(canonical);
    expect(sel.kind).toBe('group');
  });
});

describe('20N.1 legacy controls (GREEN: unchanged now and after)', () => {
  it('no-transition path unchanged (absent legacy)', () => {
    expect(selectGroupTransition(undefined)).toEqual({ kind: 'absent' });
    expect(selectGroupTransition([])).toEqual({ kind: 'absent' });
  });

  it('one Phase 20M.2 transition unchanged (byte-identical admission)', () => {
    const single = admitGradingTransition({
      policyVersion: 'trp1', lawKind: 'TRANSITION_LINEAR_V1', lawVersion: 'v1',
      criterionFamily: 'distance', jointId: 'joint:0', memberIds: ['L', 'R'], width: 8,
      side: 'left', groupSide: 'left', isOpen: true, transitionCount: 1, jointZ: 10,
      members: [member('L', 5, 20), member('R', 7, 20)],
    });
    expect(single).toMatchObject({ ok: true, vL: 5, vR: 7, sL: -4, sR: 4 });
    const pre = deriveTransitionExpectation(
      { scope: 'group', closed: false, positiveWidthRegions: 1 },
      { jointId: 'joint:0', width: 8, memberLengths: [20, 20], transitionCount: 1, isOpen: true },
    );
    expect(pre.ok).toBe(true);
  });
});

describe('20N.1 non-authorized exclusions (GREEN: fail closed now and after)', () => {
  it('non-collinear still NON_COLLINEAR; arc / closed / sloped / mixed-family rejected', () => {
    const bent = admitGradingTransition({
      policyVersion: 'trp1', lawKind: 'TRANSITION_LINEAR_V1', lawVersion: 'v1',
      criterionFamily: 'distance', jointId: 'joint:0', memberIds: ['L', 'R'], width: 8,
      side: 'left', groupSide: 'left', isOpen: true, transitionCount: 1, jointZ: 10,
      members: [member('L', 5, 20), member('R', 7, 20, 1)],
    });
    expect(bent.ok).toBe(false);
    if (!bent.ok) expect(bent.code).toBe('NON_COLLINEAR');
    const arc = admitGradingTransition({
      policyVersion: 'trp1', lawKind: 'TRANSITION_LINEAR_V1', lawVersion: 'v1',
      criterionFamily: 'distance', jointId: 'joint:0', memberIds: ['L', 'R'], width: 8,
      side: 'left', groupSide: 'left', isOpen: true, transitionCount: 1, jointZ: 10,
      members: [member('L', 5, 20), { ...member('R', 7, 20), isArc: true }],
    });
    expect(arc.ok).toBe(false);
    if (!arc.ok) expect(arc.code).toBe('NON_LINE');
    const closed = admitGradingTransition({
      policyVersion: 'trp1', lawKind: 'TRANSITION_LINEAR_V1', lawVersion: 'v1',
      criterionFamily: 'distance', jointId: 'joint:0', memberIds: ['L', 'R'], width: 8,
      side: 'left', groupSide: 'left', isOpen: false, transitionCount: 1, jointZ: 10,
      members: [member('L', 5, 20), member('R', 7, 20)],
    });
    expect(closed.ok).toBe(false);
    if (!closed.ok) expect(closed.code).toBe('CLOSED');
    const sloped = admitGradingTransition({
      policyVersion: 'trp1', lawKind: 'TRANSITION_LINEAR_V1', lawVersion: 'v1',
      criterionFamily: 'distance', jointId: 'joint:0', memberIds: ['L', 'R'], width: 8,
      side: 'left', groupSide: 'left', isOpen: true, transitionCount: 1, jointZ: 10,
      members: [{ ...member('L', 5, 20), endZ: 11 }, member('R', 7, 20)],
    });
    expect(sloped.ok).toBe(false);
    if (!sloped.ok) expect(sloped.code).toBe('NON_FLAT');
    const mixed = admitGradingTransition({
      policyVersion: 'trp1', lawKind: 'TRANSITION_LINEAR_V1', lawVersion: 'v1',
      criterionFamily: 'distance', jointId: 'joint:0', memberIds: ['L', 'R'], width: 8,
      side: 'left', groupSide: 'left', isOpen: true, transitionCount: 1, jointZ: 10,
      members: [
        member('L', 5, 20),
        { ...member('R', 7, 20), criterion: { kind: 'relative-elevation', gradeRatio: 0.5, relativeElevation: 2 } as const },
      ],
    });
    expect(mixed.ok).toBe(false);
    if (!mixed.ok) expect(mixed.code).toBe('FAMILY_MISMATCH');
  });

  it('touching stays rejected at study layout (exclusion, never authorized)', () => {
    const touching = buildMultiGroup({
      fixtureId: 'x', family: 'distance', memberLengths: [30, 7, 30], widths: [8, 6],
      transform: 'identity', expected: 'x', eligible: false,
    });
    expect(touching.ok).toBe(false);
    if (!touching.ok) {
      expect(touching.stage).toBe('group-layout');
      expect(touching.code).toBe('TOUCHING_NOT_AUTHORIZED');
    }
  });
});

describe('20N.1 Wave B: group authority fail-closed (policy + pre-mesh)', () => {
  const pair = (gap: number) => [
    { jointId: 'joint:0', width: 8, memberLengths: [30, gap] as [number, number], isOpen: true },
    { jointId: 'joint:1', width: 6, memberLengths: [gap, 30] as [number, number], isOpen: true },
  ];

  it('strict separation is exact: gap holds, touching/overlap reject, no epsilon', () => {
    expect(checkGroupTransitionSeparation([8, 6], [24])).toBe(true);
    expect(checkGroupTransitionSeparation([8, 6], [7.0001])).toBe(true);
    expect(checkGroupTransitionSeparation([8, 6], [7])).toBe(false);
    expect(checkGroupTransitionSeparation([8, 6], [5])).toBe(false);
    expect(checkGroupTransitionSeparation([8], [])).toBe(true);
    expect(checkGroupTransitionSeparation([], [])).toBe(false);
    expect(checkGroupTransitionSeparation([8, 6], [24, 24])).toBe(false);
    expect(checkGroupTransitionSeparation([8, -6], [24])).toBe(false);
    expect(checkGroupTransitionSeparation([8, 6], [Number.NaN])).toBe(false);
  });

  it('plural selection: canonical strictly-increasing admits (sparse authorized 20P.1); dupe/reorder/malformed reject, never sorted', () => {
    expect(selectGroupTransitions([{ jointId: 'joint:0' }, { jointId: 'joint:1' }]).kind).toBe('group');
    expect(selectGroupTransitions([{ jointId: 'joint:3' }, { jointId: 'joint:4' }, { jointId: 'joint:5' }]).kind).toBe('group');
    // 20P.1 LANDED: sparse [0,2] admits as a group; separation is checked
    // downstream on the true station gap (24+26=50 here), not the immediate member.
    expect(selectGroupTransitions([{ jointId: 'joint:0' }, { jointId: 'joint:2' }]).kind).toBe('group');
    expect(checkGroupTransitionSeparation([8, 6], [50])).toBe(true);
    for (const bad of [
      [{ jointId: 'joint:0' }, { jointId: 'joint:0' }],
      [{ jointId: 'joint:1' }, { jointId: 'joint:0' }],
      [{ jointId: 'bogus' }, { jointId: 'joint:1' }],
      [{ jointId: 'joint:01' }, { jointId: 'joint:2' }],
      [{ jointId: 'joint:0' }, {}],
    ]) {
      expect(selectGroupTransitions(bad)).toMatchObject({ kind: 'rejected', code: 'TRANSITION_REJECTED' });
    }
    // N = 1 and absent paths are byte-identical to the singular wrapper.
    expect(selectGroupTransitions([{ jointId: 'joint:7' }])).toMatchObject({ kind: 'single' });
    expect(selectGroupTransitions(undefined)).toEqual({ kind: 'absent' });
    expect(selectGroupTransitions([])).toEqual({ kind: 'absent' });
  });

  it('group pre-mesh: touching/overlap/sparse/reorder/shared-length-mismatch reject, no partial set', () => {
    expect(deriveGroupTransitionExpectation(pair(7)).ok).toBe(false);
    expect(deriveGroupTransitionExpectation(pair(5)).ok).toBe(false);
    const sparse = deriveGroupTransitionExpectation([pair(24)[0]!, { ...pair(24)[1]!, jointId: 'joint:2' }]);
    expect(sparse.ok).toBe(false);
    const reorder = deriveGroupTransitionExpectation([pair(24)[1]!, pair(24)[0]!]);
    expect(reorder.ok).toBe(false);
    const mismatch = deriveGroupTransitionExpectation([
      pair(24)[0]!,
      { ...pair(24)[1]!, memberLengths: [25, 30] as [number, number] },
    ]);
    expect(mismatch.ok).toBe(false);
    const closed = deriveGroupTransitionExpectation([
      pair(24)[0]!,
      { ...pair(24)[1]!, isOpen: false },
    ]);
    expect(closed.ok).toBe(false);
    expect(deriveGroupTransitionExpectation([]).ok).toBe(false);
  });
});
