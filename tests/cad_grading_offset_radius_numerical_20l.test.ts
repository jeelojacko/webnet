/**
 * Phase 20L numerical-authority pins (study-only, zero `src/` changes).
 *
 * Every bound exercised here is derived from the shared 20J1 authorities
 * (`AGREEMENT_OPS`, `coordinateAgreementTol`, `seamParameterAgreementTol`
 * in `gradingGroupSectors.ts`, imported by `phase20lOffsetJoinCore.ts` —
 * never copied). Perturbations land on BOTH sides of each derived bound;
 * unresolved contact is always AMBIGUOUS/fail-closed, never a snapped root.
 */
import { describe, expect, it } from 'vitest';

import { AGREEMENT_OPS, seamParameterAgreementTol } from '../src/engine/cad/grading/gradingGroupSectors';
import { classifyOffsetJoin } from '../scripts/phase20lOffsetJoinCore';
import {
  JOIN_FIXTURES,
  JOIN_FIXTURE_BY_ID,
  arcMember,
  lineMember,
  runJoinFixture,
  toRad,
  transformInput,
} from '../scripts/phase20lOffsetRadiusVariants';

const X = { nx: 1, ny: 0 };
const unit = (x: number, y: number) => {
  const l = Math.hypot(x, y);
  return { nx: x / l, ny: y / l };
};
const tinyTurn = (deg: number) =>
  classifyOffsetJoin({
    incoming: lineMember(0, 0, X, 40, 'incoming'),
    outgoing: lineMember(0, 0, unit(Math.cos(toRad(deg)), Math.sin(toRad(deg))), 40, 'outgoing'),
    side: 'left',
    offset: 5,
    maxSearchDistance: 100,
  });

describe('phase20l line-line sensitivity across the derived det band', () => {
  it('resolves comfortably above OPS·EPS, goes AMBIGUOUS inside, NONE when exact', () => {
    const band = AGREEMENT_OPS * Number.EPSILON;
    for (const deg of [90, 1, 0.001, 1e-9, 1e-12]) {
      const r = tinyTurn(deg);
      expect(Math.abs(r.conditioning.value), `${deg}`).toBeGreaterThan(band);
      expect(r.intersections.length, `${deg}`).toBe(1);
    }
    // 1e-13°: det ≈ 1.7e-15 < band — unresolvable contact, zero roots fabricated.
    const inside = tinyTurn(1e-13);
    expect(Math.abs(inside.conditioning.value)).toBeLessThanOrEqual(band);
    expect(inside.classification).toBe('OFFSET_JOIN_AMBIGUOUS');
    expect(inside.intersections).toEqual([]);
    expect(inside.policyRequired).toBe(true);
    // Exact parallel (det === 0): a true NONE, never AMBIGUOUS.
    const exact = tinyTurn(0);
    expect(exact.conditioning.value).toBe(0);
    expect(exact.classification).toBe('OFFSET_JOIN_NONE');
    expect(exact.policyRequired).toBe(false);
  });
});

describe('phase20l line-circle sensitivity across the derived disc band', () => {
  it('clear secant is stable; tangent noise is AMBIGUOUS with no roots; miss is NONE', () => {
    const clear = JOIN_FIXTURE_BY_ID.get('LA_CW_OVERLAP')!;
    for (const d of [-0.5, 0, 0.5]) {
      const r = classifyOffsetJoin({ ...clear.input, offset: 5 + d });
      expect(r.classification, `d=${d}`).toBe('OFFSET_JOIN_UNIQUE');
      expect(r.intersections.length, `d=${d}`).toBe(2);
    }
    const tangent = JOIN_FIXTURE_BY_ID.get('LA_TANGENT_CONTACT')!;
    // ±1e-14 lands inside OPS·EPS·max(1,R²,|f|²): unresolved, no tangent snapped.
    for (const d of [-1e-14, 0, 1e-14]) {
      const r = classifyOffsetJoin({ ...tangent.input, offset: 5 + d });
      expect(r.classification, `d=${d}`).toBe('OFFSET_JOIN_AMBIGUOUS');
      expect(r.intersections, `d=${d}`).toEqual([]);
      expect(r.conditioning.illConditioned, `d=${d}`).toBe(true);
    }
    // Just outside the band: secant side resolves (2 local → AMBIGUOUS by
    // branch policy), miss side is an explicit NONE.
    const secant = classifyOffsetJoin({ ...tangent.input, offset: 5 - 1e-12 });
    expect(secant.intersections.length).toBe(2);
    expect(secant.candidates.filter((c) => c.local).length).toBe(2);
    const miss = classifyOffsetJoin({ ...tangent.input, offset: 5 + 1e-12 });
    expect(miss.classification).toBe('OFFSET_JOIN_NONE');
    expect(miss.intersections).toEqual([]);
  });
});

describe('phase20l circle-circle sensitivity across the derived centre/radius bands', () => {
  it('coincident is AMBIGUOUS; radius separation past OPS·EPS·R is concentric NONE', () => {
    const coin = JOIN_FIXTURE_BY_ID.get('AA_COINCIDENT_SAME_CENTER')!;
    const exact = runJoinFixture(coin);
    expect(exact.classification).toBe('OFFSET_JOIN_AMBIGUOUS');
    expect(exact.intersections).toEqual([]);
    // 1e-15 < OPS·EPS·50 ≈ 3.6e-14: still the same curve.
    const near = classifyOffsetJoin({
      ...coin.input,
      outgoing: { ...coin.input.outgoing, kind: 'arc', radius: 50 + 1e-15 } as typeof coin.input.outgoing,
    });
    expect(near.classification).toBe('OFFSET_JOIN_AMBIGUOUS');
    // 1e-12 > band: concentric with clearly different radii never meets.
    for (const dR of [1e-12, 1e-9, 0.01]) {
      const r = classifyOffsetJoin({
        ...coin.input,
        outgoing: { ...coin.input.outgoing, kind: 'arc', radius: 50 + dR } as typeof coin.input.outgoing,
      });
      expect(r.classification, `dR=${dR}`).toBe('OFFSET_JOIN_NONE');
      expect(r.intersections, `dR=${dR}`).toEqual([]);
    }
  });

  it('clear 2-root, separate and contained pairs classify deterministically', () => {
    // Clear 2-root reference: both branches local → AMBIGUOUS, never picked.
    const ref = runJoinFixture(JOIN_FIXTURE_BY_ID.get('AA_UNEQUAL_GAP')!);
    expect(ref.intersections.length).toBe(2);
    expect(ref.candidates.filter((c) => c.local).length).toBe(2);
    // Separate: centres ~206 m apart, radii 55/55 — explicit NONE.
    const separate = classifyOffsetJoin({
      incoming: arcMember(0, 0, 0, 50, 50, 1, Math.PI / 2, 'incoming'),
      outgoing: arcMember(0, 0, 200, 0, 50, 1, Math.PI / 2, 'outgoing'),
      side: 'right',
      offset: 5,
      maxSearchDistance: 100,
    });
    expect(separate.classification).toBe('OFFSET_JOIN_NONE');
    // Contained unequal: same centre, 55 vs 15 — concentric NONE.
    const contained = classifyOffsetJoin({
      incoming: arcMember(0, 0, 0, 50, 50, 1, Math.PI / 2, 'incoming'),
      outgoing: arcMember(0, 0, 0, 50, 50, 1, Math.PI / 2, 'outgoing'),
      side: 'left',
      offset: 5,
      maxSearchDistance: 100,
    });
    expect(contained.offsetRadii).toEqual({ incoming: 45, outgoing: 45 });
    expect(contained.classification).toBe('OFFSET_JOIN_AMBIGUOUS');
  });
});

describe('phase20l join invariance at 1e6 / 1e8 / 1e8-rotated', () => {
  it.each(['LL_LEFT_TURN_LEFT', 'LA_CCW_OVERLAP', 'LL_PARALLEL_TANGENT', 'LL_LEFT_TURN_RIGHT'])(
    'fixture %s keeps class/branch/span with extent inside the derived authority',
    (id) => {
      const f = JOIN_FIXTURE_BY_ID.get(id)!;
      const a = runJoinFixture(f);
      for (const [angle, dx, dy] of [[0, 1e6, 1e6], [0, 1e8, 1e8], [toRad(37), 1e8, -1e8]] as const) {
        const b = classifyOffsetJoin(transformInput(f.input, angle, dx, dy));
        expect(b.classification, `${id}@${dx}`).toBe(a.classification);
        expect(b.intersections.length, `${id}@${dx}`).toBe(a.intersections.length);
        expect(b.candidates.length, `${id}@${dx}`).toBe(a.candidates.length);
        expect(b.candidates.map((c) => c.branchConsistent), `${id}@${dx}`).toEqual(
          a.candidates.map((c) => c.branchConsistent),
        );
        expect(b.candidates.map((c) => c.inSpan), `${id}@${dx}`).toEqual(a.candidates.map((c) => c.inSpan));
        expect(b.offsetRadii, `${id}@${dx}`).toEqual(a.offsetRadii);
        if (a.extent !== null) {
          const tol = seamParameterAgreementTol(a.extent, b.extent!, Math.abs(a.extent), Math.max(dx, dy));
          expect(Math.abs(b.extent! - a.extent), `${id}@${dx}`).toBeLessThanOrEqual(tol);
        } else {
          expect(b.extent, `${id}@${dx}`).toBeNull();
        }
      }
    },
  );

  it('all 31 fixtures keep their class at 1e6 / 1e8 / 1e8-rotated; ill-conditioned stays fail-closed', () => {
    for (const f of JOIN_FIXTURES) {
      const a = runJoinFixture(f);
      for (const [angle, dx, dy] of [[0, 1e6, 1e6], [0, 1e8, 1e8], [toRad(37), 1e8, -1e8]] as const) {
        const b = classifyOffsetJoin(transformInput(f.input, angle, dx, dy));
        expect(b.classification, `${f.id}@${dx}`).toBe(a.classification);
      }
    }
    // LA_TANGENT_CONTACT under 1e8+rotation resolves 2 arithmetic branches
    // (trig rounding, fixture-level — never classifier rotation), but stays
    // AMBIGUOUS: fail-closed preserved, no bitwise extent demanded.
    const t = JOIN_FIXTURE_BY_ID.get('LA_TANGENT_CONTACT')!;
    const moved = classifyOffsetJoin(transformInput(t.input, toRad(37), 1e8, -1e8));
    expect(moved.classification).toBe('OFFSET_JOIN_AMBIGUOUS');
    expect(moved.policyRequired).toBe(true);
  });
});

describe('phase20l span zero-crossings use the quantity-correct bound', () => {
  it('endpoint-exact and ±1ulp stay endpoint-consistent; past-band flips; Roff untouched', () => {
    const f = JOIN_FIXTURE_BY_ID.get('LL_LEFT_TURN_LEFT')!;
    expect(runJoinFixture(f).candidates[0]!.uIn).toBe(-5);
    const ulp = Number.EPSILON * 5;
    // Span endpoint exactly at / within 1ulp of the join: still the join.
    for (const dSpan of [0, ulp, -ulp, 1e-15, -1e-15]) {
      const inp = structuredClone(f.input);
      if (inp.incoming.kind !== 'line') throw new Error('fixture shape');
      inp.incoming.spanStart = -5 + dSpan;
      const r = classifyOffsetJoin(inp);
      expect(r.classification, `dSpan=${dSpan}`).toBe('OFFSET_JOIN_UNIQUE');
      expect(r.extent, `dSpan=${dSpan}`).toBeCloseTo(5 * Math.SQRT2, 12);
    }
    // 1e-9 past the derived band (~OPS·EPS·40 ≈ 1.4e-13 here): outside the body.
    const past = structuredClone(f.input);
    if (past.incoming.kind !== 'line') throw new Error('fixture shape');
    past.incoming.spanStart = -5 + 1e-9;
    expect(classifyOffsetJoin(past).classification).toBe('OFFSET_JOIN_NONLOCAL');
    // Collapse/inversion still use exact radius sign, never the span band.
    expect(runJoinFixture(JOIN_FIXTURE_BY_ID.get('LA_CCW_LEFT_COLLAPSE')!).offsetRadii.outgoing).toBe(0);
    expect(runJoinFixture(JOIN_FIXTURE_BY_ID.get('LA_CCW_LEFT_INVERSION')!).offsetRadii.outgoing).toBe(-3);
  });

  it('no translation flip at 1e8: sub-quantum span shifts stay inside the widened band', () => {
    const f = JOIN_FIXTURE_BY_ID.get('LL_LEFT_TURN_LEFT')!;
    const at1e8 = transformInput(f.input, 0, 1e8, 1e8);
    // Derived band at 1e8 is ~7e-7; a 1e-9 shift stays endpoint-consistent.
    const inp = structuredClone(at1e8);
    if (inp.incoming.kind !== 'line') throw new Error('fixture shape');
    inp.incoming.spanStart = inp.incoming.spanStart + 1e-9;
    const r = classifyOffsetJoin(inp);
    expect(r.classification).toBe('OFFSET_JOIN_UNIQUE');
    const plain = classifyOffsetJoin(at1e8);
    const tol = seamParameterAgreementTol(r.extent!, plain.extent!, Math.abs(plain.extent!), 1e8);
    expect(Math.abs(r.extent! - plain.extent!)).toBeLessThanOrEqual(tol);
  });
});
