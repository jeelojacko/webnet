/**
 * Phase 20L.1 Task C — EXTENT-BOUNDARY UNIFICATION pins (STUDY, zero src/).
 *
 * Phase 20L.1 had two semantics for one policy: the admission predicate used
 * exact `distV <= maxSearch`, while `auditCornerCandidacy` (and the
 * classifier's own `local` field) used
 * `distV <= maxSearch + seamParameterAgreementTol(...)`. This suite pins the
 * resolution — E1, the existing 20J1 quantity-correct agreement authority —
 * and proves the criterion-derived `d` gate stays an exact production
 * comparison that the |J-V| rule never relaxes.
 *
 * Boundary evidence: a line→line 90° offset join has analytic extent
 * `d·√2` exactly (classified at the base fixtures). One representable step
 * below that extent the exact gate rejects while the agreement gate and the
 * independent audit both accept — the divergence the unification removes.
 * The same holds under translation (E/N ~1e6, ~1e8), rotation, and uniform
 * scale up/down (classification invariant).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { seamParameterAgreementTol } from '../src/engine/cad/grading/gradingGroupSectors';
import {
  classifyOffsetJoin,
  type MemberSpec,
  type OffsetJoinInput,
} from '../scripts/phase20lOffsetJoinCore';
import { auditCornerCandidacy } from '../scripts/phase20l1PolicyCorpus';
import {
  extentJVWithin,
  joinWorldScale,
  resolveCornerEffective,
} from '../scripts/phase20l1EffectiveCriterion';
import {
  JOIN_FIXTURES,
  JOIN_FIXTURE_BY_ID,
  transformInput,
  type JoinFixture,
} from '../scripts/phase20lOffsetRadiusVariants';

/** One representable Float64 step (positive operands only). */
const ulpStep = (x: number, dir: 1 | -1): number => {
  const buf = new ArrayBuffer(8);
  const f = new Float64Array(buf);
  const u = new BigInt64Array(buf);
  f[0] = x;
  u[0] += BigInt(dir);
  return f[0];
};

const BASE = JOIN_FIXTURE_BY_ID.get('LL_LEFT_TURN_LEFT')!;
const D = 5;

const uniqueDistV = (input: OffsetJoinInput): number => {
  const r = classifyOffsetJoin(input);
  expect(r.classification).toBe('OFFSET_JOIN_UNIQUE');
  return r.candidates.find((c) => c.inSpan && c.branchConsistent)!.distV;
};

const scaleMembers = (input: OffsetJoinInput, k: number): OffsetJoinInput => {
  const scale = (m: MemberSpec): MemberSpec =>
    m.kind === 'line'
      ? { ...m, vx: m.vx * k, vy: m.vy * k, spanStart: m.spanStart * k, spanEnd: m.spanEnd * k }
      : { ...m, vx: m.vx * k, vy: m.vy * k, cx: m.cx * k, cy: m.cy * k, radius: m.radius * k, spanStart: m.spanStart * k, spanEnd: m.spanEnd * k };
  return {
    ...input,
    incoming: scale(input.incoming),
    outgoing: scale(input.outgoing),
    offset: input.offset * k,
    maxSearchDistance: input.maxSearchDistance * k,
  };
};

const baseInput = (): OffsetJoinInput => ({ ...BASE.input, offset: D, maxSearchDistance: 100 });

describe('20L.1 Task C: |J-V| extent gate is E1 (one shared agreement-aware comparison)', () => {
  it('analytic extent == maxSearch; ±1 ULP and inside/outside the agreement band classify as required', () => {
    const distV = uniqueDistV(baseInput());
    // 90° line→line corner: offset join sits at d·√2 from V, exactly.
    expect(distV).toBe(5 * Math.SQRT2);
    const ws = joinWorldScale(BASE.input.incoming.vx, BASE.input.incoming.vy);
    const tol = seamParameterAgreementTol(distV, distV, distV, ws);
    expect(extentJVWithin(distV, distV, ws)).toBe(true); // analytic == bound
    expect(extentJVWithin(distV, ulpStep(distV, -1), ws)).toBe(true); // 1 ULP below: absorbed
    expect(extentJVWithin(distV, ulpStep(distV, 1), ws)).toBe(true); // 1 ULP above
    expect(extentJVWithin(distV, distV - tol / 2, ws)).toBe(true); // inside the band
    expect(extentJVWithin(distV, distV - 2 * tol, ws)).toBe(false); // outside the band
    // Exact (E0) comparison agrees only at/above the bound.
    expect(distV <= distV).toBe(true);
    expect(distV <= ulpStep(distV, -1)).toBe(false);
  });

  it('the audit (already E1) and the unified admission now agree; both reject outside the band', () => {
    const distV = uniqueDistV(baseInput());
    const ws = joinWorldScale(BASE.input.incoming.vx, BASE.input.incoming.vy);
    const tol = seamParameterAgreementTol(distV, distV, distV, ws);
    const msDown = ulpStep(distV, -1);
    // Old exact admission would reject; the independent audit accepts, so the
    // two semantics disagreed. Unified E1 makes admission accept too.
    expect(distV <= msDown).toBe(false);
    expect(extentJVWithin(distV, msDown, ws)).toBe(true);
    expect(auditCornerCandidacy(BASE, D, msDown).pass).toBe(true);
    // Outside the agreement band both the helper and the audit reject.
    const msOut = distV - 2 * tol;
    expect(extentJVWithin(distV, msOut, ws)).toBe(false);
    const auditOut = auditCornerCandidacy(BASE, D, msOut);
    expect(auditOut.pass).toBe(false);
    expect(auditOut.detail).toBe('AUDIT_NO_PASSER');
  });

  it('boundary holds across origin 1e6/1e8, rotation, and scale up/down: classification invariant', () => {
    const cases: { name: string; input: OffsetJoinInput; d: number }[] = [
      { name: 'local', input: baseInput(), d: D },
      { name: 'origin_1e6', input: transformInput(baseInput(), 0, 1e6, -2e6), d: D },
      { name: 'origin_1e8', input: transformInput(baseInput(), 0, 1e8, 1e8), d: D },
      { name: 'rotation_0_9', input: transformInput(baseInput(), 0.9, 123.4, -56.7), d: D },
      { name: 'scale_up_1e3', input: scaleMembers(baseInput(), 1000), d: D * 1000 },
      { name: 'scale_down_1e3', input: scaleMembers(baseInput(), 0.001), d: D * 0.001 },
    ];
    for (const c of cases) {
      const distV = uniqueDistV(c.input);
      const ws = joinWorldScale(c.input.incoming.vx, c.input.incoming.vy);
      const msDown = ulpStep(distV, -1);
      // One ULP below the analytic extent: E1 + independent audit accept,
      // exact (E0) rejects — at every frame.
      expect(distV <= msDown).toBe(false);
      expect(extentJVWithin(distV, msDown, ws)).toBe(true);
      const audit = auditCornerCandidacy({ ...BASE, input: c.input }, c.d, msDown);
      expect(audit.pass).toBe(true);
      expect(audit.detail).toBe('CANDIDACY_OK');
    }
  });

  it('criterion-derived d gate stays exact production: d == maxSearch proves, 1 ULP below fails closed', () => {
    const legs: Parameters<typeof resolveCornerEffective>[1] = [
      { member: BASE.input.incoming, startZ: 0, endZ: 0 },
      { member: BASE.input.outgoing, startZ: 0, endZ: 0 },
    ];
    const crit = { kind: 'distance', gradeRatio: 1, distance: D } as const;
    expect(resolveCornerEffective(crit, legs, BASE.input.side, D).proven).toBe(true);
    expect(resolveCornerEffective(crit, legs, BASE.input.side, ulpStep(D, -1)).reason).toBe('INVALID_CRITERION');
    expect(resolveCornerEffective(crit, legs, BASE.input.side, ulpStep(D, 1)).proven).toBe(true);
  });
});

describe('20L.1 Task C: coverage split + classification stability', () => {
  interface Row { fixtureId: string; family: string; admit: boolean; reasonCode: string; roffClass: string }

  const corpus = (): { rows: Row[] } =>
    JSON.parse(
      readFileSync(
        join(dirname(new URL(import.meta.url).pathname), '..', 'docs', 'evidence', 'phase20l1', 'policy-corpus.json'),
        'utf8',
      ),
    );

  const hasArc = (f: JoinFixture): boolean =>
    f.input.incoming.kind === 'arc' || f.input.outgoing.kind === 'arc';

  it('honest coverage split: 15 admits = 6 arc-bearing (real Roff) + 9 line-line controls', () => {
    const admitted = corpus().rows.filter((r) => r.admit);
    const curved = admitted.filter((r) => hasArc(JOIN_FIXTURE_BY_ID.get(r.fixtureId)!));
    expect(admitted.length).toBe(15);
    expect(curved.length).toBe(6); // LA_CW_OVERLAP + AL_CW_OVERLAP × 3 families
    expect(admitted.length - curved.length).toBe(9); // line-line controls, kept
    for (const r of curved) {
      const f = JOIN_FIXTURE_BY_ID.get(r.fixtureId)!;
      const arcs = [f.input.incoming, f.input.outgoing].filter((m) => m.kind === 'arc');
      expect(arcs.length).toBeGreaterThanOrEqual(1);
      for (const a of arcs) expect(a.radius > 0 && Number.isFinite(a.radius)).toBe(true);
      expect(r.roffClass).toBe('OK_OR_NA'); // real Roff, finite positive
    }
  });

  it('reason histogram unchanged vs the f885d898/15-admit baseline (no classification drift)', () => {
    const hist: Record<string, number> = {};
    for (const r of corpus().rows) hist[r.reasonCode] = (hist[r.reasonCode] ?? 0) + 1;
    expect(hist).toEqual({
      ADMIT_P0: 15,
      REJECT_AMBIGUITY_B0: 18,
      REJECT_ARC_PAIR_NO_GO: 21,
      REJECT_CIRCULARITY_SLOPED: 31,
      REJECT_CIRCULARITY_SURFACE: 62,
      REJECT_NON_UNIQUE: 33,
      REJECT_ROFF: 6,
    });
  });

  it('20L classifier verdicts stable on all 31 fixtures (old 20L corner classifications)', () => {
    const pinned: Record<string, string> = {
      LL_LEFT_TURN_RIGHT: 'OFFSET_JOIN_NONLOCAL',
      LL_LEFT_TURN_LEFT: 'OFFSET_JOIN_UNIQUE',
      LL_RIGHT_TURN_LEFT: 'OFFSET_JOIN_NONLOCAL',
      LL_RIGHT_TURN_RIGHT: 'OFFSET_JOIN_UNIQUE',
      LL_SHALLOW_1DEG_RIGHT: 'OFFSET_JOIN_NONLOCAL',
      LL_SHALLOW_1DEG_LEFT: 'OFFSET_JOIN_UNIQUE',
      'LL_SHALLOW_0.001DEG_RIGHT': 'OFFSET_JOIN_NONLOCAL',
      LL_PARALLEL_TANGENT: 'OFFSET_JOIN_NONE',
      LL_HAIRPIN_NONLOCAL: 'OFFSET_JOIN_NONLOCAL',
      LL_SIDE_CONFLICT_WRONG: 'OFFSET_JOIN_WRONG_SIDE',
      LL_SIDE_CONFLICT_FOLD: 'OFFSET_JOIN_SELF_INTERSECTION',
      LA_CCW_GAP: 'OFFSET_JOIN_NONLOCAL',
      LA_CCW_OVERLAP: 'OFFSET_JOIN_AMBIGUOUS',
      LA_CW_GAP: 'OFFSET_JOIN_AMBIGUOUS',
      LA_CW_OVERLAP: 'OFFSET_JOIN_UNIQUE',
      LA_CCW_LEFT_COLLAPSE: 'OFFSET_JOIN_COLLAPSE',
      LA_CCW_LEFT_INVERSION: 'OFFSET_JOIN_INVERSION',
      LA_TANGENT_CONTACT: 'OFFSET_JOIN_AMBIGUOUS',
      LA_CLEAR_MISS: 'OFFSET_JOIN_NONE',
      LL_SPAN_MISMATCH: 'OFFSET_JOIN_NONLOCAL',
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
      AA_COINCIDENT_SAME_CENTER: 'OFFSET_JOIN_AMBIGUOUS',
    };
    expect(Object.keys(pinned).length).toBe(JOIN_FIXTURES.length);
    for (const f of JOIN_FIXTURES) {
      expect(classifyOffsetJoin(f.input).classification).toBe(pinned[f.id]);
    }
  });
});
