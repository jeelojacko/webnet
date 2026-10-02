/**
 * Phase 20L.1 Task B — GROUP/MEMBER BUILDABILITY pins (study only, zero src/).
 * Pins: 2-member exact strips, 3-member single-offset-curve service, mixed +
 * reverse member-fallback (no invented transitions), granularity gate,
 * daylight continuity + independent topology, closed-group proof/fixtures,
 * curved-vs-line-line split, 20L/20L.1 local stability.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { classifyOffsetJoin } from '../scripts/phase20lOffsetJoinCore';
import { JOIN_FIXTURE_BY_ID } from '../scripts/phase20lOffsetRadiusVariants';
import { buildExactStrip, chainB, solveChainCorner, specAt } from '../scripts/phase20l1GroupBuild';

interface ChainResult {
  id: string; side: string; family: string; members: number; closed: boolean;
  corners: { index: number; admit: boolean; reason: string; d: number | null; jx: number | null; jy: number | null; distV: number | null }[];
  exactRun: number[] | null; fallbackMembers: number[] | null;
  strip: { ok: boolean; detail: string; planArea: number; areaRelErr: number | null; components: number; edgeComponents: number; daylightContinuity: boolean; noInteriorOverlap: boolean; sourceClosedSimple?: boolean; daylightClosedSimple?: boolean } | null;
  gate: string;
}

const artifact = (): { chains: ChainResult[]; granularityGate: string; criterionContinuity: { sameD_Jagree: boolean; diffD_rejectsOrMoves: boolean | string; flatZ: { sameFlat: string; diffFlat: string } } } =>
  JSON.parse(readFileSync(join(dirname(new URL(import.meta.url).pathname), '..', 'docs', 'evidence', 'phase20l1', 'group-corpus.json'), 'utf8'));

const DIST = { kind: 'distance', gradeRatio: 1, distance: 5 } as const;

describe('20L.1 groups: two-member exact builds (A)', () => {
  it.each(['DISTANCE', 'REL_EL', 'ELEV_FLAT'])('line→arc and arc→line admit P0 with clean strips (%s)', (family) => {
    const p = artifact();
    for (const id of [`A1-line-arc-${family}`, `A2-arc-line-${family}`]) {
      const c = p.chains.find((x) => x.id === id)!;
      expect(c.corners).toHaveLength(1);
      expect(c.corners[0]!.admit).toBe(true);
      expect(c.corners[0]!.reason).toBe('ADMIT_P0');
      expect(c.gate).toBe('WHOLE_RUN_EXACT');
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
    expect(c.corners.map((k) => k.reason)).toEqual(['ADMIT_P0', 'ADMIT_P0']);
    const [j0, j1] = c.corners;
    // Middle arc centre (50,0), Roff = 55: both joins land on it, no discontinuity.
    for (const j of [j0!, j1!]) {
      expect(Math.hypot(j.jx! - 50, j.jy! - 0)).toBeCloseTo(55, 9);
    }
    expect(c.strip!.ok).toBe(true);
    expect(c.strip!.edgeComponents).toBe(1);
  });
  it('live rebuild agrees with the artifact (deterministic strip)', () => {
    const p = artifact();
    const c = p.chains.find((x) => x.id === 'B-3member-DISTANCE')!;
    const joins = c.corners.map((k) => ({ x: k.jx!, y: k.jy! }));
    const st = buildExactStrip(chainB, 'left', 5, joins, 5, 25, false);
    expect(st.ok).toBe(true);
    expect(st.audit.meshArea).toBeCloseTo(c.strip!.planArea, 6);
  });
});

describe('20L.1 groups: mixed + reverse-mixed (C/D)', () => {
  it('exact@P0 + arc-pair NO_GO coexist with NO transition: curved member falls back whole', () => {
    const p = artifact();
    const m = p.chains.find((x) => x.id === 'C-mixed-DISTANCE')!;
    expect(m.corners.map((k) => k.reason)).toEqual(['ADMIT_P0', 'REJECT_ARC_PAIR_NO_GO']);
    expect(m.exactRun).toBeNull();
    expect(m.strip).toBeNull();
    expect(m.gate).toBe('MEMBER_FALLBACK_PARTIAL_RUN');
    expect(m.fallbackMembers).toContain(1);
  });
  it('reverse mixed mirrors: fallback corner first, P0 second, same gate', () => {
    const p = artifact();
    const m = p.chains.find((x) => x.id === 'D-reverse-mixed-DISTANCE')!;
    expect(m.corners.map((k) => k.reason)).toEqual(['REJECT_ARC_PAIR_NO_GO', 'ADMIT_P0']);
    expect(m.exactRun).toBeNull();
    expect(m.strip).toBeNull();
    expect(m.gate).toBe('MEMBER_FALLBACK_PARTIAL_RUN');
    // Both curved members touch the rejected corner (0 incident to 0 and 1).
    expect(m.fallbackMembers!.length).toBeGreaterThanOrEqual(1);
  });
  it('arc×arc NO_GO is never weakened anywhere in the group corpus', () => {
    const p = artifact();
    const noGo = p.chains.flatMap((c) => c.corners).filter((k) => k.reason === 'REJECT_ARC_PAIR_NO_GO');
    expect(noGo.length).toBe(2);
    for (const k of noGo) expect(k.admit).toBe(false);
  });
});

describe('20L.1 groups: granularity + continuity (E)', () => {
  it('routing granularity is member-fallback with per-corner reasons', () => {
    const p = artifact();
    expect(p.granularityGate).toMatch('MEMBER_FALLBACK_CORNER_REASONS');
    // All-exact chains fall back nothing; mixed chains fall back the curved member(s).
    for (const c of p.chains) {
      if (c.gate === 'WHOLE_RUN_EXACT' || c.gate === 'WHOLE_GROUP_EXACT') expect(c.fallbackMembers).toEqual([]);
      if (c.gate === 'MEMBER_FALLBACK_PARTIAL_RUN') expect(c.fallbackMembers!.length).toBeGreaterThanOrEqual(1);
    }
  });
  it('same proven d across families stays continuous; different d / flats do not mix', () => {
    const p = artifact();
    expect(p.criterionContinuity.sameD_Jagree).toBe(true);
    expect(p.criterionContinuity.diffD_rejectsOrMoves).toBe(true);
    expect(p.criterionContinuity.flatZ.sameFlat).toBe('PROVEN d=5');
    expect(p.criterionContinuity.flatZ.diffFlat).toBe('NOT_PROVEN ELEVATION_MEMBER_MISMATCH');
  });
});

describe('20L.1 groups: closed chains (F)', () => {
  it('line-only square admits whole-group exact, CCW/left and CW/right, rings simple', () => {
    const p = artifact();
    for (const id of ['F1-square-left', 'F1-square-right-cw']) {
      const c = p.chains.find((x) => x.id === id)!;
      expect(c.corners.every((k) => k.reason === 'ADMIT_P0')).toBe(true);
      expect(c.gate).toBe('WHOLE_GROUP_EXACT');
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
      expect(c.gate).toBe('WHOLE_GROUP_CHORD_FALLBACK');
      expect(c.strip).toBeNull();
    }
  });
  it('curved-vs-line-line split: 8/8 line corners P0, 0/8 curved-stadium corners P0', () => {
    const p = artifact();
    const lineP0 = ['F1-square-left', 'F1-square-right-cw'].flatMap((id) => p.chains.find((x) => x.id === id)!.corners);
    const curvedP0 = ['F2-stadium-left', 'F2-stadium-right'].flatMap((id) => p.chains.find((x) => x.id === id)!.corners);
    expect(lineP0.filter((k) => k.admit).length).toBe(8);
    expect(curvedP0.filter((k) => k.admit).length).toBe(0);
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
    expect(live.distV).toBeCloseTo(row.distV, 6);
  });
});
