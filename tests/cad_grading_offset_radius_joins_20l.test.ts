/**
 * Phase 20L Worker-JOINS — adjacent-member OFFSET-JOIN study pins (§8-9).
 *
 * EVIDENCE ONLY: every case routes through `scripts/phase20lOffsetJoinCore.ts`
 * (honest parallel offsets + analytic line/circle intersections) via the
 * fixtures in `scripts/phase20lOffsetRadiusVariants.ts`. Labels are
 * `OFFSET_JOIN_*` study outcomes; production has no offset-join authority and
 * arc×arc stays NO_GO_TERMINAL_CHORD_ARC_PAIR. Zero `src/` changes.
 */
import { describe, expect, it } from 'vitest';

import { classifyOffsetJoin, type OffsetJoinClass } from '../scripts/phase20lOffsetJoinCore';
import {
  JOIN_FIXTURES,
  JOIN_FIXTURE_BY_ID,
  runJoinFixture,
  summarizeFixtures,
  toRad,
  transformedJoin,
} from '../scripts/phase20lOffsetRadiusVariants';

const CLASSIFICATION: Record<string, OffsetJoinClass> = {
  // OVERLAP (inside-corner) joins land on the member bodies: UNIQUE.
  LL_LEFT_TURN_LEFT: 'OFFSET_JOIN_UNIQUE',
  LL_RIGHT_TURN_RIGHT: 'OFFSET_JOIN_UNIQUE',
  'LL_SHALLOW_1DEG_LEFT': 'OFFSET_JOIN_UNIQUE',
  // GAP (outside-corner) joins need extension past the member ends (uIn > 0
  // / uOut < 0 structurally): NONLOCAL under strict span accounting.
  LL_LEFT_TURN_RIGHT: 'OFFSET_JOIN_NONLOCAL',
  LL_RIGHT_TURN_LEFT: 'OFFSET_JOIN_NONLOCAL',
  LL_SHALLOW_1DEG_RIGHT: 'OFFSET_JOIN_NONLOCAL',
  'LL_SHALLOW_0.001DEG_RIGHT': 'OFFSET_JOIN_NONLOCAL',
  LL_PARALLEL_TANGENT: 'OFFSET_JOIN_NONE',
  LL_HAIRPIN_NONLOCAL: 'OFFSET_JOIN_NONLOCAL',
  LL_SPAN_MISMATCH: 'OFFSET_JOIN_NONLOCAL',
  LL_SIDE_CONFLICT_WRONG: 'OFFSET_JOIN_WRONG_SIDE',
  LL_SIDE_CONFLICT_FOLD: 'OFFSET_JOIN_SELF_INTERSECTION',
  LA_CCW_GAP: 'OFFSET_JOIN_NONLOCAL',
  LA_CCW_OVERLAP: 'OFFSET_JOIN_AMBIGUOUS',
  LA_CW_GAP: 'OFFSET_JOIN_AMBIGUOUS',
  LA_CW_OVERLAP: 'OFFSET_JOIN_UNIQUE',
  LA_CCW_LEFT_COLLAPSE: 'OFFSET_JOIN_COLLAPSE',
  LA_CCW_LEFT_INVERSION: 'OFFSET_JOIN_INVERSION',
  // Constructed tangent lands inside conditioning noise: unresolved.
  LA_TANGENT_CONTACT: 'OFFSET_JOIN_AMBIGUOUS',
  LA_CLEAR_MISS: 'OFFSET_JOIN_NONE',
  AL_CW_GAP: 'OFFSET_JOIN_AMBIGUOUS',
  AL_CW_OVERLAP: 'OFFSET_JOIN_UNIQUE',
  AL_CCW_GAP: 'OFFSET_JOIN_NONLOCAL',
  AL_CCW_OVERLAP: 'OFFSET_JOIN_AMBIGUOUS',
  AA_CCW_CCW_GAP: 'OFFSET_JOIN_AMBIGUOUS',
  AA_CCW_CCW_OVERLAP: 'OFFSET_JOIN_AMBIGUOUS',
  AA_CW_CW_GAP: 'OFFSET_JOIN_AMBIGUOUS',
  AA_CCW_CW_GAP: 'OFFSET_JOIN_AMBIGUOUS',
  AA_UNEQUAL_GAP: 'OFFSET_JOIN_AMBIGUOUS',
  AA_UNEQUAL_OVERLAP: 'OFFSET_JOIN_AMBIGUOUS',
  // Coincident offset circles: infinite intersections, never NONE.
  AA_COINCIDENT_SAME_CENTER: 'OFFSET_JOIN_AMBIGUOUS',
};

const join = (id: string) => runJoinFixture(JOIN_FIXTURE_BY_ID.get(id)!);

describe('phase20l offset-join classification table', () => {
  it('pins a classification for every fixture, with no unconsumed fixture', () => {
    expect(Object.keys(CLASSIFICATION).sort()).toEqual(JOIN_FIXTURES.map((f) => f.id).sort());
    for (const f of JOIN_FIXTURES) {
      const r = runJoinFixture(f);
      expect(r.classification, f.id).toBe(CLASSIFICATION[f.id]);
      expect(r.classification.startsWith('OFFSET_JOIN_')).toBe(true);
    }
  });

  it('emits a deterministic evidence row per fixture', () => {
    const rows = summarizeFixtures();
    expect(rows.map((r) => r.id)).toEqual(JOIN_FIXTURES.map((f) => f.id));
    expect(JSON.stringify(summarizeFixtures())).toBe(JSON.stringify(rows));
  });
});

describe('phase20l line→line joins', () => {
  it('inside-corner (OVERLAP) joins land on the bodies: single offset miter, never through V', () => {
    for (const id of ['LL_LEFT_TURN_LEFT', 'LL_RIGHT_TURN_RIGHT']) {
      const r = join(id);
      expect(r.intersectionKind, id).toBe('line-line');
      expect(r.intersections.length, id).toBe(1);
      expect(r.candidates.length, id).toBe(1);
      expect(r.policyRequired, id).toBe(false);
      // |J-V| = d*sqrt(2) for a right-angle corner; the join is not at V.
      expect(r.extent!, id).toBeCloseTo(5 * Math.SQRT2, 12);
      expect(r.extent!, id).toBeGreaterThan(5);
    }
  });

  it('outside-corner (GAP) joins need extension past the member ends: NONLOCAL, not usable', () => {
    for (const id of ['LL_LEFT_TURN_RIGHT', 'LL_RIGHT_TURN_LEFT']) {
      const r = join(id);
      expect(r.intersectionKind, id).toBe('line-line');
      expect(r.intersections.length, id).toBe(1);
      expect(r.detail, id).toBe('join-outside-member-span');
      // The geometric join still exists at d*sqrt(2) — locality holds, span fails.
      expect(r.candidates.filter((c) => c.local), id).toHaveLength(1);
      expect(r.candidates[0]!.distV, id).toBeCloseTo(5 * Math.SQRT2, 12);
      expect(r.extent, id).toBeNull();
    }
  });

  it('encodes the outside/inbound sign pattern per turn classification', () => {
    const gap = join('LL_LEFT_TURN_RIGHT');
    expect(gap.turn).toBe('GAP');
    expect(gap.candidates[0]!.uIn).toBeCloseTo(5, 12);
    expect(gap.candidates[0]!.uOut).toBeCloseTo(-5, 12);
    const overlap = join('LL_LEFT_TURN_LEFT');
    expect(overlap.turn).toBe('OVERLAP');
    expect(overlap.candidates[0]!.uIn).toBeCloseTo(-5, 12);
    expect(overlap.candidates[0]!.uOut).toBeCloseTo(5, 12);
  });

  it('shallow inside corner keeps the join near V on-body; outside needs extension', () => {
    const one = join('LL_SHALLOW_1DEG_LEFT');
    expect(one.classification).toBe('OFFSET_JOIN_UNIQUE');
    expect(one.extent!).toBeGreaterThan(5);
    expect(one.extent!).toBeLessThan(5.001);
    expect(one.conditioning.value).toBeCloseTo(Math.sin(toRad(1)), 12);
    const tiny = join('LL_SHALLOW_0.001DEG_RIGHT');
    expect(tiny.classification).toBe('OFFSET_JOIN_NONLOCAL');
    expect(tiny.detail).toBe('join-outside-member-span');
    expect(tiny.conditioning.value).toBeCloseTo(Math.sin(toRad(0.001)), 12);
    expect(tiny.conditioning.value).toBeLessThan(1e-4);
  });
});

describe('phase20l nonlocal / absent / wrong-side / self-intersection rejection', () => {
  it('parallel tangent members have no offset intersection', () => {
    const r = join('LL_PARALLEL_TANGENT');
    expect(r.classification).toBe('OFFSET_JOIN_NONE');
    expect(r.intersections).toEqual([]);
    expect(r.extent).toBeNull();
    expect(r.conditioning.illConditioned).toBe(true);
  });

  it('a hairpin miter is rejected as NONLOCAL beyond the search distance', () => {
    const r = join('LL_HAIRPIN_NONLOCAL');
    expect(r.classification).toBe('OFFSET_JOIN_NONLOCAL');
    expect(r.candidates.filter((c) => c.local)).toEqual([]);
    expect(r.extent!).toBeGreaterThan(100);
    // The far intersection is still branch-consistent: locality is the sole gate.
    expect(r.candidates[0]!.branchConsistent).toBe(true);
  });

  it('an orientation conflict on the wrong branch is rejected, not resolved', () => {
    const r = join('LL_SIDE_CONFLICT_WRONG');
    expect(r.classification).toBe('OFFSET_JOIN_WRONG_SIDE');
    expect(r.candidates.some((c) => c.local)).toBe(true);
    expect(r.candidates.every((c) => !c.branchConsistent)).toBe(true);
    expect(r.extent).toBeNull();
  });

  it('a folded side conflict self-intersects rather than yielding a join', () => {
    const r = join('LL_SIDE_CONFLICT_FOLD');
    expect(r.classification).toBe('OFFSET_JOIN_SELF_INTERSECTION');
    expect(r.candidates.every((c) => Math.sign(c.uIn) === Math.sign(c.uOut))).toBe(true);
    expect(r.extent).toBeNull();
  });
});

describe('phase20l offset-radius collapse and inversion', () => {
  it('d = R collapses the inner arc offset to a point', () => {
    const r = join('LA_CCW_LEFT_COLLAPSE');
    expect(r.classification).toBe('OFFSET_JOIN_COLLAPSE');
    expect(r.offsetRadii.outgoing).toBe(0);
    expect(r.intersections).toEqual([]);
  });

  it('d > R inverts the inner arc offset (signed radius goes negative)', () => {
    const r = join('LA_CCW_LEFT_INVERSION');
    expect(r.classification).toBe('OFFSET_JOIN_INVERSION');
    expect(r.offsetRadii.outgoing).toBe(-3);
    expect(r.intersections).toEqual([]);
  });

  it('outer arc offsets grow by exactly d and preserve unequal radii', () => {
    expect(join('LA_CCW_GAP').offsetRadii.outgoing).toBe(55);
    expect(join('LA_CCW_OVERLAP').offsetRadii.outgoing).toBe(45);
    const unequal = join('AA_UNEQUAL_GAP');
    expect(unequal.offsetRadii).toEqual({ incoming: 35, outgoing: 85 });
  });
});

describe('phase20l unique vs ambiguous (never pick without policy)', () => {
  it('line→arc outside join needs extension past the member ends: NONLOCAL + POLICY_REQUIRED', () => {
    for (const id of ['LA_CCW_GAP', 'AL_CCW_GAP']) {
      const r = join(id);
      expect(r.intersections.length, id).toBe(2);
      expect(r.candidates.filter((c) => c.local).length, id).toBe(1);
      expect(r.classification, id).toBe('OFFSET_JOIN_NONLOCAL');
      expect(r.detail, id).toBe('join-outside-member-span');
      expect(r.policyRequired, id).toBe(true);
    }
  });

  it('two local branches are AMBIGUOUS and no join is chosen', () => {
    for (const id of ['LA_CCW_OVERLAP', 'LA_CW_GAP', 'AL_CW_GAP', 'AL_CCW_OVERLAP']) {
      const r = join(id);
      expect(r.classification, id).toBe('OFFSET_JOIN_AMBIGUOUS');
      expect(r.candidates.filter((c) => c.local).length, id).toBeGreaterThanOrEqual(2);
      expect(r.policyRequired, id).toBe(true);
      expect(r.detail, id).toContain('local-joins');
    }
  });

  it('arc×arc is geometric-reference only: every fixture is AMBIGUOUS', () => {
    const aa = JOIN_FIXTURES.filter((f) => f.id.startsWith('AA_'));
    expect(aa.length).toBeGreaterThan(0);
    for (const f of aa) {
      expect(f.note.toLowerCase(), f.id).toContain('reference');
      expect(runJoinFixture(f).classification, f.id).toBe('OFFSET_JOIN_AMBIGUOUS');
    }
  });
});

describe('phase20l join degeneracies (never fabricated, never NONE)', () => {
  it('coincident offset circles are AMBIGUOUS (infinite intersections), never NONE', () => {
    const r = join('AA_COINCIDENT_SAME_CENTER');
    expect(r.classification).toBe('OFFSET_JOIN_AMBIGUOUS');
    expect(r.intersections).toEqual([]);
    expect(r.detail).toContain('coincident');
    expect(r.policyRequired).toBe(true);
  });

  it('a constructed tangent inside conditioning noise is unresolved AMBIGUOUS, never a snapped tangent', () => {
    const r = join('LA_TANGENT_CONTACT');
    expect(r.classification).toBe('OFFSET_JOIN_AMBIGUOUS');
    expect(r.intersections).toEqual([]);
    expect(r.detail).toContain('unresolved');
    expect(r.conditioning.kind).toBe('line-circle-disc');
    expect(r.conditioning.illConditioned).toBe(true);
    expect(r.policyRequired).toBe(true);
  });

  it('a clean line/circle miss is explicit NONE', () => {
    const r = join('LA_CLEAR_MISS');
    expect(r.classification).toBe('OFFSET_JOIN_NONE');
    expect(r.intersections).toEqual([]);
    expect(r.policyRequired).toBe(false);
  });

  it('a geometric join past short member bodies is NONLOCAL (span mismatch), not usable', () => {
    const r = join('LL_SPAN_MISMATCH');
    expect(r.classification).toBe('OFFSET_JOIN_NONLOCAL');
    expect(r.detail).toBe('join-outside-member-span');
    // The geometry still exists at d*sqrt(2) ≈ 7.07, past the 1 m bodies.
    expect(r.candidates[0]!.distV).toBeCloseTo(5 * Math.SQRT2, 12);
    expect(r.extent).toBeNull();
  });
});

describe('phase20l locality / extent authority', () => {
  it('the existing miterExtent is NOT a truthful offset-join gate', () => {
    const right = classifyOffsetJoin({ ...JOIN_FIXTURE_BY_ID.get('LL_LEFT_TURN_RIGHT')!.input, probeMiter: true });
    // Perpendicular corner: miter bound = maxSearch*sqrt(2) = 141.42, while the
    // honest offset join is only 7.07 m away — 20x looser, never rejecting.
    expect(right.miter.failClosed).toBeNull();
    expect(right.miter.extent).toBeCloseTo(100 * Math.SQRT2, 9);
    expect(right.miter.joinDistance).toBeCloseTo(5 * Math.SQRT2, 12);
    expect(right.miter.boundWouldRejectJoin).toBe(false);

    const hairpin = classifyOffsetJoin({ ...JOIN_FIXTURE_BY_ID.get('LL_HAIRPIN_NONLOCAL')!.input, probeMiter: true });
    // The offset join is correctly NONLOCAL (573 m > maxSearch 100) yet the
    // miter bound is 11459 m: the two authorities measure different things.
    expect(hairpin.classification).toBe('OFFSET_JOIN_NONLOCAL');
    expect(hairpin.extent!).toBeGreaterThan(500);
    expect(hairpin.miter.extent!).toBeGreaterThan(10000);
    expect(hairpin.miter.boundWouldRejectJoin).toBe(false);
  });

  it('locality is bounded exactly by maxSearchDistance on |J-V|', () => {
    const f = JOIN_FIXTURE_BY_ID.get('LA_CW_OVERLAP')!;
    const inside = classifyOffsetJoin({ ...f.input, maxSearchDistance: 100 });
    const outside = classifyOffsetJoin({ ...f.input, maxSearchDistance: 1 });
    expect(inside.classification).toBe('OFFSET_JOIN_UNIQUE');
    expect(outside.classification).toBe('OFFSET_JOIN_NONLOCAL');
    expect(inside.extent!).toBeGreaterThan(1);
  });
});

describe('phase20l translated / rotated invariance and determinism', () => {
  it('rotation + translation preserves class, extent, conditioning and offset radii', () => {
    for (const f of JOIN_FIXTURES) {
      const a = runJoinFixture(f);
      const b = transformedJoin(f, toRad(37), 123.4, -56.7);
      expect(b.classification, f.id).toBe(a.classification);
      expect(b.intersections.length, f.id).toBe(a.intersections.length);
      expect(b.candidates.length, f.id).toBe(a.candidates.length);
      expect(b.offsetRadii, f.id).toEqual(a.offsetRadii);
      if (a.extent === null) expect(b.extent, f.id).toBeNull();
      else expect(b.extent!, f.id).toBeCloseTo(a.extent, 9);
      expect(b.conditioning.value, f.id).toBeCloseTo(a.conditioning.value, 9);
    }
  });

  it('large coordinates (E/N ~ 1e6) preserve class with extent agreement', () => {
    for (const f of JOIN_FIXTURES) {
      const a = runJoinFixture(f);
      const b = transformedJoin(f, 0, 1e6, 1e6);
      expect(b.classification, f.id).toBe(a.classification);
      expect(b.intersections.length, f.id).toBe(a.intersections.length);
      if (a.extent === null) expect(b.extent, f.id).toBeNull();
      else expect(Math.abs(b.extent! - a.extent) / a.extent, f.id).toBeLessThan(1e-9);
    }
  });

  it('is byte-deterministic across repeated runs', () => {
    for (const f of JOIN_FIXTURES) {
      const a = runJoinFixture(f);
      const b = runJoinFixture(f);
      expect(JSON.stringify(b), f.id).toBe(JSON.stringify(a));
    }
  });
});
