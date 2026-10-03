/**
 * Phase 20L.1 Task D — GROUP ROUTING with wired XYZ gate (study only, zero src/).
 * R0 whole-chain all-or-fallback: local P0 candidacy per corner + production
 * XYZ tie per corner + final route decision at the whole-chain/group unit.
 * Mixed chains carry local>0 BUT active=0, route CHORD_FALLBACK, no exact
 * strip — via the plan gate (C/D) or via the XYZ gate (G: same-d/diff-Z).
 * Pins: all-exact builds fully tied, G-mirror XYZ rejection, H-mirror XYZ
 * admission, closed line-only control vs curved support, 20L/20L.1 local
 * stability.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { classifyOffsetJoin } from '../scripts/phase20lOffsetJoinCore';
import { JOIN_FIXTURE_BY_ID } from '../scripts/phase20lOffsetRadiusVariants';
import { buildExactStrip, chainB, solveChainCorner, specAt } from '../scripts/phase20l1GroupBuild';

interface ChainResult {
  id: string; side: string; family: string; members: number; closed: boolean;
  corners: { index: number; admit: boolean; reason: string; localP0: boolean; activeExact: boolean; xyzTie: string; tieOk: boolean; d: number | null; jx: number | null; jy: number | null; distV: number | null; zIn: number | null; zOut: number | null; tieZ: number | null; joinZ: number | null }[];
  localP0Count: number; activeExactCorners: number[]; memberRepresentation: string[];
  routeUnit: string; route: string; stripPresent: boolean; fallbackRef: string;
  topology: string; continuity: string; routeReason: string;
  strip: { ok: boolean; detail: string; planArea: number; areaRelErr: number | null; components: number; edgeComponents: number; daylightContinuity: boolean; noInteriorOverlap: boolean; sourceClosedSimple?: boolean; daylightClosedSimple?: boolean } | null;
}

const artifact = (): { chains: ChainResult[]; routingPolicy: string; granularityGate: string; criterionContinuity: { sameD_sameJoin: boolean; diffD_rejectsOrMoves: boolean | string; flatZ: { sameFlat: string; diffFlat: string } } } =>
  JSON.parse(readFileSync(join(dirname(new URL(import.meta.url).pathname), '..', 'docs', 'evidence', 'phase20l1', 'group-corpus.json'), 'utf8'));

const DIST = { kind: 'distance', gradeRatio: 1, distance: 5 } as const;

describe('20L.1 groups: R0 routing policy', () => {
  it('declares whole-chain all-or-fallback with local-vs-active vocabulary', () => {
    const p = artifact();
    expect(p.routingPolicy).toBe('R0_WHOLE_CHAIN_ALL_OR_FALLBACK');
    expect(p.granularityGate).toMatch('LOCAL_P0_CANDIDATE');
    expect(p.granularityGate).toMatch('INACTIVE_DUE_TO_GROUP_FALLBACK');
    expect(p.granularityGate).not.toMatch('MEMBER_FALLBACK');
  });
  it('declares the enforced flat-only predicate and the restated search-neighborhood rule', () => {
    const p = artifact();
    expect(p.granularityGate).toMatch('FLAT-ONLY');
    expect(p.granularityGate).toMatch('startZ===endZ');
    expect(p.granularityGate).toMatch('REJECT_SLOPED_SOURCE');
    expect(p.granularityGate).toMatch('NOT numerical agreement');
  });
  it('every corner carries a decided XYZ tie (no PENDING hook remains)', () => {
    const p = artifact();
    for (const c of p.chains) for (const k of c.corners) expect(k.xyzTie).not.toBe('XYZ_TIE_PENDING');
  });
  it('plan-admitted corners are XYZ-tied; plan-rejected corners skip the tie', () => {
    const p = artifact();
    for (const c of p.chains) {
      for (const k of c.corners) {
        if (k.localP0) {
          expect(k.tieOk).toBe(k.admit);
          expect(k.admit ? k.xyzTie === 'Z_TIE_OK' : ['REJECT_XYZ_TIE_MISMATCH', 'REJECT_SOURCE_JOINT_STEP'].includes(k.xyzTie)).toBe(true);
        } else {
          expect(k.xyzTie).toBe('XYZ_TIE_NOT_EVALUATED');
          expect(k.tieOk).toBe(false);
        }
      }
    }
  });
  it('every EXACT-routed chain is fully tied + topology-clean (verdict basis)', () => {
    const p = artifact();
    const exact = p.chains.filter((c) => c.route === 'EXACT_OFFSET');
    expect(exact.length).toBe(12);
    for (const c of exact) {
      expect(c.corners.every((k) => k.admit && k.tieOk && k.xyzTie === 'Z_TIE_OK')).toBe(true);
      expect(c.corners.every((k) => k.joinZ !== null && k.joinZ === k.zIn && k.joinZ === k.zOut)).toBe(true);
      expect(c.activeExactCorners).toEqual(c.corners.map((k) => k.index));
      expect(c.strip!.ok).toBe(true);
      expect(c.strip!.edgeComponents).toBe(1);
      expect(c.strip!.daylightContinuity).toBe(true);
      expect(c.strip!.noInteriorOverlap).toBe(true);
    }
  });
});

describe('20L.1 groups: two-member exact builds (A)', () => {
  it.each(['DISTANCE', 'REL_EL', 'ELEV_FLAT'])('line→arc and arc→line route whole-chain EXACT (%s)', (family) => {
    const p = artifact();
    for (const id of [`A1-line-arc-${family}`, `A2-arc-line-${family}`]) {
      const c = p.chains.find((x) => x.id === id)!;
      expect(c.corners).toHaveLength(1);
      expect(c.corners[0]!.reason).toBe('LOCAL_P0_CANDIDATE');
      expect(c.localP0Count).toBe(1);
      expect(c.activeExactCorners).toEqual([0]);
      expect(c.routeUnit).toBe('OPEN_CHAIN');
      expect(c.route).toBe('EXACT_OFFSET');
      expect(c.memberRepresentation).toEqual(['EXACT_OFFSET', 'EXACT_OFFSET']);
      expect(c.stripPresent).toBe(true);
      expect(c.strip!.ok).toBe(true);
      expect(c.strip!.components).toBe(1);
      expect(c.strip!.edgeComponents).toBe(1);
      expect(c.strip!.daylightContinuity).toBe(true);
      expect(c.strip!.noInteriorOverlap).toBe(true);
      expect(c.strip!.areaRelErr).toBe(0);
    }
  });
});

describe('20L.1 groups: three-member all-exact (B)', () => {
  it('ONE exact offset curve serves both ends (both joins on the middle-arc Roff circle)', () => {
    const p = artifact();
    const c = p.chains.find((x) => x.id === 'B-3member-DISTANCE')!;
    expect(c.corners.map((k) => k.reason)).toEqual(['LOCAL_P0_CANDIDATE', 'LOCAL_P0_CANDIDATE']);
    const [j0, j1] = c.corners;
    // Middle arc centre (50,0), Roff = 55: both joins land on it, no discontinuity.
    for (const j of [j0!, j1!]) {
      expect(Math.hypot(j.jx! - 50, j.jy! - 0)).toBeCloseTo(55, 9);
    }
    expect(c.route).toBe('EXACT_OFFSET');
    expect(c.strip!.ok).toBe(true);
    expect(c.strip!.edgeComponents).toBe(1);
  });
  it('live rebuild agrees with the artifact (deterministic strip)', () => {
    const p = artifact();
    const c = p.chains.find((x) => x.id === 'B-3member-DISTANCE')!;
    const joins = c.corners.map((k) => ({ x: k.jx!, y: k.jy!, z: k.joinZ! }));
    const st = buildExactStrip(chainB, 'left', 5, joins, { memberCriteria: [DIST, DIST, DIST], memberZ: [0, 0, 0], ms: 100 }, 25, false);
    expect(st.ok).toBe(true);
    expect(st.audit.meshArea).toBeCloseTo(c.strip!.planArea, 6);
  });
  it('strip Z comes from the production limit law per vertex, corners carry the agreed join Z', () => {
    const p = artifact();
    const h = p.chains.find((x) => x.id === 'H-mixed-sameD-sameZ')!;
    const joins = h.corners.map((k) => ({ x: k.jx!, y: k.jy!, z: k.joinZ! }));
    const st = buildExactStrip(chainB, 'left', 5, joins, {
      memberCriteria: [DIST, { kind: 'relative-elevation', gradeRatio: 1, relativeElevation: 5 } as const, DIST],
      memberZ: [0, 0, 0], ms: 100,
    }, 25, false);
    expect(st.ok).toBe(true);
    // No `z = d` assumption: every daylight vertex resolved through the member law (5 here).
    for (const v of st.daylight) expect(v.z).toBe(5);
    for (const v of st.source) expect(v.z).toBe(0);
    // Corner nodes are the verified single agreed join Z.
    expect(h.corners.map((k) => k.joinZ)).toEqual([5, 5]);
    expect(h.corners.every((k) => k.joinZ === k.tieZ && k.joinZ === k.zIn && k.joinZ === k.zOut)).toBe(true);
  });
});

describe('20L.1 groups: mixed + reverse-mixed (C/D) — R0 fallback honesty', () => {
  it('local P0 candidate present BUT active=0, route CHORD_FALLBACK, no strip, no partial-exact phrasing', () => {
    const p = artifact();
    const m = p.chains.find((x) => x.id === 'C-mixed-DISTANCE')!;
    expect(m.corners.map((k) => k.reason)).toEqual(['LOCAL_P0_CANDIDATE', 'REJECT_ARC_PAIR_NO_GO']);
    expect(m.localP0Count).toBe(1);
    expect(m.activeExactCorners).toEqual([]);
    expect(m.corners[0]!.admit).toBe(true);
    expect(m.corners[0]!.activeExact).toBe(false);
    expect(m.route).toBe('CHORD_FALLBACK');
    expect(m.stripPresent).toBe(false);
    expect(m.strip).toBeNull();
    expect(m.memberRepresentation).toEqual(['CHORD_FALLBACK', 'CHORD_FALLBACK', 'CHORD_FALLBACK']);
    expect(m.routeReason).toBe('CHAIN_FALLBACK_MIXED_CANDIDACY');
    expect(m.continuity).toMatch('CONTINUITY_UNPROVEN');
  });
  it('reverse mixed mirrors: fallback corner first, candidate second, same whole-chain route', () => {
    const p = artifact();
    const m = p.chains.find((x) => x.id === 'D-reverse-mixed-DISTANCE')!;
    expect(m.corners.map((k) => k.reason)).toEqual(['REJECT_ARC_PAIR_NO_GO', 'LOCAL_P0_CANDIDATE']);
    expect(m.localP0Count).toBe(1);
    expect(m.activeExactCorners).toEqual([]);
    expect(m.route).toBe('CHORD_FALLBACK');
    expect(m.strip).toBeNull();
  });
  it('arc×arc NO_GO is never weakened anywhere in the group corpus', () => {
    const p = artifact();
    const noGo = p.chains.flatMap((c) => c.corners).filter((k) => k.reason === 'REJECT_ARC_PAIR_NO_GO');
    expect(noGo.length).toBe(2);
    for (const k of noGo) expect(k.admit).toBe(false);
  });
});

describe('20L.1 groups: XYZ-gated mixed chains (G/H)', () => {
  it('G same-d/diff-Z: local=2 BUT active=0 via the XYZ gate (not plan rejection)', () => {
    const p = artifact();
    const g = p.chains.find((x) => x.id === 'G-mixed-sameD-diffZ')!;
    expect(g.family).toBe('MIXED_SAME_D_DIFF_Z');
    // Plan admits both corners at d=5 (UNIQUE, in-extent) — the plan gate is not the rejector.
    expect(g.corners.map((k) => k.d)).toEqual([5, 5]);
    expect(g.localP0Count).toBe(2);
    expect(g.corners.every((k) => k.localP0 && k.jx !== null)).toBe(true);
    // The XYZ gate ties both INACTIVE: Distance daylight Z=5 vs RelEl daylight Z=10.
    expect(g.corners.map((k) => k.reason)).toEqual(['REJECT_XYZ_TIE_MISMATCH', 'REJECT_XYZ_TIE_MISMATCH']);
    expect(g.corners.map((k) => k.xyzTie)).toEqual(['REJECT_XYZ_TIE_MISMATCH', 'REJECT_XYZ_TIE_MISMATCH']);
    expect(g.corners.every((k) => !k.admit && !k.tieOk && !k.activeExact)).toBe(true);
    expect(g.corners[0]!.zIn).toBe(5);
    expect(g.corners[0]!.zOut).toBe(10);
    expect(g.corners[1]!.zIn).toBe(10);
    expect(g.corners[1]!.zOut).toBe(5);
    expect(g.corners.every((k) => k.joinZ === null)).toBe(true); // no agreed join Z
    expect(g.activeExactCorners).toEqual([]);
    expect(g.route).toBe('CHORD_FALLBACK');
    expect(g.routeReason).toBe('CHAIN_FALLBACK_XYZ_TIE_MISMATCH');
    expect(g.stripPresent).toBe(false);
    expect(g.strip).toBeNull();
    expect(g.continuity).toMatch('CONTINUITY_UNPROVEN');
  });
  it('H same-d/same-Z: admitted through the wired gate (daylight 5 vs 5)', () => {
    const p = artifact();
    const h = p.chains.find((x) => x.id === 'H-mixed-sameD-sameZ')!;
    expect(h.family).toBe('MIXED_SAME_D_SAME_Z');
    expect(h.localP0Count).toBe(2);
    expect(h.corners.map((k) => k.xyzTie)).toEqual(['Z_TIE_OK', 'Z_TIE_OK']);
    expect(h.corners.every((k) => k.admit && k.tieOk && k.zIn === 5 && k.zOut === 5 && k.tieZ === 5)).toBe(true);
    expect(h.activeExactCorners).toEqual([0, 1]);
    expect(h.route).toBe('EXACT_OFFSET');
    expect(h.routeReason).toBe('CHAIN_EXACT_WHOLE_CHAIN');
    expect(h.stripPresent).toBe(true);
    expect(h.strip!.ok).toBe(true);
    expect(h.strip!.edgeComponents).toBe(1);
  });
  it('whole-fallback open count is 4 (C + D plan-gated, G XYZ-gated, I joint-stepped)', () => {
    const p = artifact();
    const fell = p.chains.filter((c) => !c.closed && c.route === 'CHORD_FALLBACK');
    expect(fell.map((c) => c.id).sort()).toEqual(['C-mixed-DISTANCE', 'D-reverse-mixed-DISTANCE', 'G-mixed-sameD-diffZ', 'I-source-step-0-vs-2']);
  });
});

describe('20L.1 groups: source-joint step chain (I)', () => {
  it('0-vs-2 step: local=2 BUT active=0 via the joint gate (true limits 5 vs 7)', () => {
    const p = artifact();
    const s = p.chains.find((x) => x.id === 'I-source-step-0-vs-2')!;
    expect(s.family).toBe('STEP_0_VS_2');
    expect(s.corners.map((k) => k.d)).toEqual([5, 5]);
    expect(s.localP0Count).toBe(2);
    expect(s.corners.map((k) => k.reason)).toEqual(['REJECT_SOURCE_JOINT_STEP', 'LOCAL_P0_CANDIDATE']);
    expect(s.corners[0]!.admit).toBe(false);
    expect(s.corners[0]!.localP0).toBe(true);
    expect([s.corners[0]!.zIn, s.corners[0]!.zOut]).toEqual([5, 7]);
    expect(s.corners[0]!.joinZ).toBeNull();
    // Corner 1 (continuous at z=2) ties at limit 7 — tied-but-inactive under fallback.
    expect(s.corners[1]!.admit).toBe(true);
    expect(s.corners[1]!.activeExact).toBe(false);
    expect([s.corners[1]!.zIn, s.corners[1]!.zOut]).toEqual([7, 7]);
    expect(s.corners[1]!.joinZ).toBe(7);
    expect(s.activeExactCorners).toEqual([]);
    expect(s.route).toBe('CHORD_FALLBACK');
    expect(s.routeReason).toBe('CHAIN_FALLBACK_SOURCE_JOINT_STEP');
    expect(s.strip).toBeNull();
    expect(s.continuity).toMatch('CONTINUITY_UNPROVEN');
  });
});

describe('20L.1 groups: strip-fail revokes the route (defense in depth)', () => {
  it('invariant over all corpus chains: a failed strip never rides an EXACT route', () => {
    const p = artifact();
    for (const c of p.chains) {
      if (c.strip !== null && !c.strip.ok) {
        expect(c.route).toBe('CHORD_FALLBACK');
        expect(c.activeExactCorners).toEqual([]);
        expect(c.corners.every((k) => !k.activeExact)).toBe(true);
        expect(c.routeReason).toMatch('ROUTE_REVOKED_STRIP_FAIL');
      }
      if (c.route === 'EXACT_OFFSET') {
        expect(c.stripPresent).toBe(true);
        expect(c.strip!.ok).toBe(true);
      }
    }
  });
  it('adversarial construction failure revokes: poisoned corner Z fails the strip', () => {
    const p = artifact();
    const h = p.chains.find((x) => x.id === 'H-mixed-sameD-sameZ')!;
    // Same plan joins, but a corner Z inconsistent with both member limits.
    const joins = h.corners.map((k) => ({ x: k.jx!, y: k.jy!, z: 999 }));
    const st = buildExactStrip(chainB, 'left', 5, joins, {
      memberCriteria: [DIST, DIST, DIST], memberZ: [0, 0, 0], ms: 100,
    }, 25, false);
    expect(st.ok).toBe(false);
    expect(st.detail).toMatch('corner-z-mismatch');
  });
  it('both layers hold on 0-vs-2: gate rejects AND strip-fail would revoke', () => {
    const p = artifact();
    const s = p.chains.find((x) => x.id === 'I-source-step-0-vs-2')!;
    // Layer 1 (gate): stepped corner dead → fallback before any construction.
    expect(s.corners[0]!.reason).toBe('REJECT_SOURCE_JOINT_STEP');
    expect(s.route).toBe('CHORD_FALLBACK');
    // Layer 2 (construction): no single corner Z satisfies both stepped
    // member limits (5 and 7) — forcing z=5 fails against member 1's limit 7.
    const joins = s.corners.map((k) => ({ x: k.jx!, y: k.jy!, z: 5 }));
    const st = buildExactStrip(chainB, 'left', 5, joins, {
      memberCriteria: [DIST, DIST, DIST], memberZ: [0, 2, 2], ms: 100,
    }, 25, false);
    expect(st.ok).toBe(false);
    expect(st.detail).toMatch('corner-z-mismatch');
  });
});

describe('20L.1 groups: closed chains (F) — line-only control vs curved support', () => {
  it('line-only square admits whole-group exact, CCW/left and CW/right, rings simple', () => {
    const p = artifact();
    for (const id of ['F1-square-left', 'F1-square-right-cw']) {
      const c = p.chains.find((x) => x.id === id)!;
      expect(c.corners.every((k) => k.reason === 'LOCAL_P0_CANDIDATE')).toBe(true);
      expect(c.routeUnit).toBe('CLOSED_GROUP');
      expect(c.route).toBe('EXACT_OFFSET');
      expect(c.strip!.ok).toBe(true);
      expect(c.strip!.sourceClosedSimple).toBe(true);
      expect(c.strip!.daylightClosedSimple).toBe(true);
      expect(c.strip!.edgeComponents).toBe(1);
    }
  });
  it('curved stadium admits nothing either side: honest all-chord fallback (B0 at every curved corner)', () => {
    const p = artifact();
    for (const id of ['F2-stadium-left', 'F2-stadium-right']) {
      const c = p.chains.find((x) => x.id === id)!;
      expect(c.corners.map((k) => k.reason)).toEqual([
        'REJECT_AMBIGUITY_B0', 'REJECT_AMBIGUITY_B0', 'REJECT_AMBIGUITY_B0', 'REJECT_AMBIGUITY_B0',
      ]);
      expect(c.route).toBe('CHORD_FALLBACK');
      expect(c.strip).toBeNull();
      expect(c.continuity).toMatch('CONTINUITY_UNPROVEN');
    }
  });
  it('curved-vs-line-line split: 8/8 line corners local-P0, 0/8 curved-stadium corners admitted', () => {
    const p = artifact();
    const lineP0 = ['F1-square-left', 'F1-square-right-cw'].flatMap((id) => p.chains.find((x) => x.id === id)!.corners);
    const curvedP0 = ['F2-stadium-left', 'F2-stadium-right'].flatMap((id) => p.chains.find((x) => x.id === id)!.corners);
    expect(lineP0.filter((k) => k.admit).length).toBe(8);
    expect(curvedP0.filter((k) => k.admit).length).toBe(0);
  });
});

describe('20L.1 groups: granularity + continuity (E)', () => {
  it('route is uniform per chain: all members share one representation', () => {
    const p = artifact();
    for (const c of p.chains) {
      const want = c.route === 'EXACT_OFFSET' ? 'EXACT_OFFSET' : 'CHORD_FALLBACK';
      expect(c.memberRepresentation.every((m) => m === want)).toBe(true);
    }
  });
  it('same proven d across families stays continuous; different d / flats do not mix', () => {
    const p = artifact();
    expect(p.criterionContinuity.sameD_sameJoin).toBe(true);
    expect(p.criterionContinuity.diffD_rejectsOrMoves).toBe(true);
    expect(p.criterionContinuity.flatZ.sameFlat).toBe('PROVEN d=5');
    expect(p.criterionContinuity.flatZ.diffFlat).toBe('NOT_PROVEN ELEVATION_MEMBER_MISMATCH');
  });
});

describe('20L.1 groups: local stability', () => {
  it('policy corpus still 186 rows / 15 P0; spot classifications pinned live', () => {
    const rows = JSON.parse(readFileSync(join(dirname(new URL(import.meta.url).pathname), '..', 'docs', 'evidence', 'phase20l1', 'policy-corpus.json'), 'utf8'));
    expect(rows.counts.rows).toBe(186);
    expect(rows.counts.admittedP0).toBe(15);
    expect(classifyOffsetJoin(JOIN_FIXTURE_BY_ID.get('LA_CLEAR_MISS')!.input).classification).toBe('OFFSET_JOIN_NONE');
    expect(classifyOffsetJoin(JOIN_FIXTURE_BY_ID.get('LA_CCW_LEFT_COLLAPSE')!.input).classification).toBe('OFFSET_JOIN_COLLAPSE');
    expect(classifyOffsetJoin(JOIN_FIXTURE_BY_ID.get('LL_PARALLEL_TANGENT')!.input).classification).toBe('OFFSET_JOIN_NONE');
  });
  it('chain corners reuse the corpus admission (B corner0 matches LA_CW_OVERLAP/DISTANCE)', () => {
    const rows = JSON.parse(readFileSync(join(dirname(new URL(import.meta.url).pathname), '..', 'docs', 'evidence', 'phase20l1', 'policy-corpus.json'), 'utf8'));
    const row = rows.rows.find((r: { fixtureId: string; family: string }) => r.fixtureId === 'LA_CW_OVERLAP' && r.family === 'DISTANCE');
    expect(row.admit).toBe(true);
    expect(row.distV).toBeCloseTo(6.911904582, 6);
    const live = solveChainCorner(0, specAt(chainB[0]!, 'end'), specAt(chainB[1]!, 'start'), 'left', DIST, 0, 100);
    expect(live.admit).toBe(true);
    expect(live.localP0).toBe(true);
    expect(live.xyzTie).toBe('Z_TIE_OK');
    expect(live.tieOk).toBe(true);
    expect(live.zIn).toBe(5);
    expect(live.zOut).toBe(5);
    expect(live.distV).toBeCloseTo(row.distV, 6);
  });
});
