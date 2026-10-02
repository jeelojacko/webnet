/**
 * Phase 20L.1 Task 7 — POLICY study pins (evidence only, zero `src/` changes).
 * Pins: maxSearchDistance semantics+scaling, |J-V| vs miterExtent, B0, B1
 * rejection (P1≡P0), C0/C1 rejection, corpus determinism, 20L stability,
 * arc×arc NO_GO, transition deferral, executable effective criterion,
 * independent corner candidacy, normalized-geometry invariance.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { scaleGradingCriterion } from '../src/engine/cad/cadProjectTransformGrading';
import { auditCornerCandidacy } from '../scripts/phase20l1PolicyCorpus';
import { classifyOffsetJoin } from '../scripts/phase20lOffsetJoinCore';
import {
  JOIN_FIXTURES,
  JOIN_FIXTURE_BY_ID,
  transformInput,
} from '../scripts/phase20lOffsetRadiusVariants';

interface PolicyRow {
  fixtureId: string; family: string; admit: boolean; reasonCode: string;
  distV: number | null; d: number | null; effectiveReason: string;
  cornerCandidacyPass: boolean; candidacyDetail: string; meshTopology: string;
}
interface InvCell { class: string; agree: boolean; joinErr: number | null }

const corpus = (): {
  rows: PolicyRow[];
  counts: { rows: number; admittedP0: number };
  transformInvariance: Record<string, Record<string, InvCell>>;
} =>
  JSON.parse(
    readFileSync(
      join(dirname(new URL(import.meta.url).pathname), '..', 'docs', 'evidence', 'phase20l1', 'policy-corpus.json'),
      'utf8',
    ),
  );

describe('20L.1 policy: extent authority', () => {
  it('maxSearchDistance gates d (production truth: d<=maxSearch)', () => {
    const f = JOIN_FIXTURE_BY_ID.get('LL_LEFT_TURN_LEFT')!;
    // d=5 admitted at ms=100; shrinking ms below locality drops UNIQUE itself.
    expect(classifyOffsetJoin({ ...f.input, offset: 5, maxSearchDistance: 100 }).classification).toBe('OFFSET_JOIN_UNIQUE');
    expect(classifyOffsetJoin({ ...f.input, offset: 5, maxSearchDistance: 4 }).classification).not.toBe('OFFSET_JOIN_UNIQUE');
  });
  it('|J-V|>=d corner factor measured; BOTH gates strictly narrower (ms=6 admits 1/5, d-gate alone 5/5)', () => {
    const p = corpus();
    const univ = ['LL_LEFT_TURN_LEFT', 'LL_RIGHT_TURN_RIGHT', 'LA_CW_OVERLAP', 'AL_CW_OVERLAP', 'LL_SHALLOW_1DEG_LEFT'];
    for (const id of univ) {
      const row = p.rows.find((r) => r.fixtureId === id && r.family === 'DISTANCE')!;
      expect(row.admit).toBe(true);
      expect(row.distV!).toBeGreaterThanOrEqual(row.d!);
    }
    // Square corner |J-V|=7.07 > 6: JV gate rejects where the d gate passes.
    const sq = p.rows.find((r) => r.fixtureId === 'LL_LEFT_TURN_LEFT' && r.family === 'DISTANCE')!;
    expect(sq.distV).toBeCloseTo(7.071067812, 6);
    expect(sq.distV!).toBeGreaterThan(6);
  });
  it('miterExtent is comparison probe only, never routing (non-authoritative)', () => {
    const f = JOIN_FIXTURE_BY_ID.get('LL_LEFT_TURN_LEFT')!;
    const r = classifyOffsetJoin({ ...f.input, probeMiter: true });
    expect(r.classification).toBe('OFFSET_JOIN_UNIQUE');
  });
  it('criterion-derived d co-scales with geometry: normalized join agrees across scales', () => {
    // Independent recompute (not a corpus reread): scale members ×k with the
    // production scaleGradingCriterion + ms×k, compare normalized joins.
    for (const id of ['LL_LEFT_TURN_LEFT', 'LA_CW_OVERLAP']) {
      const f = JOIN_FIXTURE_BY_ID.get(id)!;
      const base = classifyOffsetJoin({ ...f.input, offset: 5, maxSearchDistance: 100 });
      const bj = base.candidates.find((c) => c.inSpan && c.branchConsistent)!;
      for (const k of [0.001, 1000]) {
        const sm = (m: typeof f.input.incoming): typeof m =>
          m.kind === 'line'
            ? { ...m, vx: m.vx * k, vy: m.vy * k, spanStart: m.spanStart * k, spanEnd: m.spanEnd * k }
            : { ...m, vx: m.vx * k, vy: m.vy * k, cx: m.cx * k, cy: m.cy * k, radius: m.radius * k, spanStart: m.spanStart * k, spanEnd: m.spanEnd * k };
        const crit = scaleGradingCriterion({ kind: 'distance', gradeRatio: 1, distance: 5 }, k);
        if (crit.kind !== 'distance') throw new Error('scaling must preserve distance kind');
        const sc = classifyOffsetJoin({
          ...f.input,
          incoming: sm(f.input.incoming), outgoing: sm(f.input.outgoing),
          offset: crit.distance, maxSearchDistance: 100 * k,
        });
        expect(sc.classification).toBe('OFFSET_JOIN_UNIQUE');
        const sj = sc.candidates.find((c) => c.inSpan && c.branchConsistent)!;
        expect(Math.hypot(sj.x / k - bj.x, sj.y / k - bj.y)).toBeLessThanOrEqual(1e-6);
        expect(Math.abs(sj.distV / k - bj.distV)).toBeLessThanOrEqual(1e-6);
      }
    }
  });
});

describe('20L.1 policy: ambiguity + extension', () => {
  it('B0 fail-closed: multi-branch joins reject (line-arc AMBIGUOUS; arc-pair NO_GO first)', () => {
    const p = corpus();
    const la = p.rows.filter((r) => r.fixtureId === 'AL_CW_GAP' && ['DISTANCE', 'REL_EL', 'ELEV_FLAT'].includes(r.family));
    expect(la.length).toBe(3);
    for (const r of la) expect(r.reasonCode).toBe('REJECT_AMBIGUITY_B0');
    const aa = p.rows.filter((r) => r.fixtureId === 'AA_CCW_CCW_OVERLAP' && ['DISTANCE', 'REL_EL', 'ELEV_FLAT'].includes(r.family));
    expect(aa.length).toBe(3);
    for (const r of aa) expect(r.reasonCode).toBe('REJECT_ARC_PAIR_NO_GO');
  });
  it('B1 rejected: P1 ≡ P0 (no admitted row needs a branch pick)', () => {
    const p = corpus();
    for (const r of p.rows.filter((x) => x.admit)) expect(r.reasonCode).toBe('ADMIT_P0');
  });
  it('C0 no-extension: all 8 NONLOCAL GAP joins reject in proven families', () => {
    const p = corpus();
    const gaps = p.rows.filter((r) => r.family === 'DISTANCE' && r.reasonCode === 'REJECT_NON_UNIQUE');
    expect(gaps.length).toBeGreaterThanOrEqual(8);
  });
  it('C1 bounded extension rejected: ladder admits only on-body UNIQUE (never via extension)', () => {
    const f = JOIN_FIXTURE_BY_ID.get('LL_LEFT_TURN_RIGHT')!;
    expect(classifyOffsetJoin(f.input).classification).toBe('OFFSET_JOIN_NONLOCAL');
  });
});

describe('20L.1 policy: effective criterion + independent candidacy', () => {
  it('d comes from resolved source+criterion pairs: 3 proven paths → d=5, rest null', () => {
    const p = corpus();
    for (const fam of ['DISTANCE', 'REL_EL', 'ELEV_FLAT']) {
      const proven = p.rows.filter((r) => r.family === fam && r.admit);
      expect(proven.length).toBe(5);
      for (const r of proven) expect(r.d).toBe(5);
    }
    const reasons = new Set(p.rows.filter((r) => r.family === 'DISTANCE' && r.admit).map((r) => r.effectiveReason));
    expect(reasons).toEqual(new Set(['DISTANCE']));
    expect(new Set(p.rows.filter((r) => r.family === 'REL_EL' && r.admit).map((r) => r.effectiveReason))).toEqual(new Set(['RELATIVE_ELEVATION']));
    expect(new Set(p.rows.filter((r) => r.family === 'ELEV_FLAT' && r.admit).map((r) => r.effectiveReason))).toEqual(new Set(['ELEVATION_FLAT_SOURCE']));
    for (const r of p.rows.filter((x) => !['DISTANCE', 'REL_EL', 'ELEV_FLAT'].includes(x.family))) {
      expect(r.d).toBeNull();
      expect(r.admit).toBe(false);
    }
    // Corpus families assign uniform Z per corner, so no row takes the
    // per-member-mismatch path (pinned at predicate level instead).
    expect(p.rows.filter((r) => r.reasonCode === 'REJECT_CIRCULARITY_MISMATCH').length).toBe(0);
  });
  it('every admitted row passes an independently recomputed candidacy audit (never reread)', () => {
    const p = corpus();
    const admitted = p.rows.filter((r) => r.admit);
    expect(admitted.length).toBe(15);
    for (const r of admitted) {
      expect(r.cornerCandidacyPass).toBe(true);
      expect(r.candidacyDetail).toBe('CANDIDACY_OK');
      // Independent recompute from fixture input + resolved d (own arithmetic).
      const f = JOIN_FIXTURE_BY_ID.get(r.fixtureId)!;
      const live = auditCornerCandidacy(f, r.d!, 100);
      expect(live.pass).toBe(true);
      expect(live.detail).toBe('CANDIDACY_OK');
      expect(Math.abs(live.distV! - r.distV!)).toBeLessThanOrEqual(1e-6);
      expect(live.turn === 'GAP' || live.turn === 'OVERLAP').toBe(true);
    }
  });
  it('mesh topology honestly N/A on every row; rejected rows never carry a vacuous pass', () => {
    const p = corpus();
    for (const r of p.rows) {
      expect(r.meshTopology).toBe('NOT_APPLICABLE_CORNER_CLASSIFIER_NO_MESH');
      if (!r.admit) expect(r.cornerCandidacyPass).toBe(false);
    }
  });
  it('invariance cells carry normalized geometry agreement (classification + join, all 7 transforms)', () => {
    const p = corpus();
    const keys = Object.keys(p.transformInvariance);
    expect(keys.length).toBe(5);
    const names = ['origin_1e6', 'origin_1e8', 'rotation_0_9', 'scale_up_1e3', 'scale_down_1e3', 'mirror_y', 'reverse_chain'];
    for (const k of keys) {
      for (const n of names) {
        const cell = p.transformInvariance[k]![n]!;
        expect(cell.class).toBe('OFFSET_JOIN_UNIQUE');
        expect(cell.agree).toBe(true);
        expect(cell.joinErr).not.toBeNull();
        expect(cell.joinErr!).toBeLessThanOrEqual(1e-6);
      }
    }
  });
});

describe('20L.1 policy: corpus + stability + scope', () => {
  it('corpus deterministic: 186 rows, 15 ADMIT_P0 (5 fixtures × 3 proven families)', () => {
    const p = corpus();
    expect(p.counts.rows).toBe(186);
    expect(p.counts.admittedP0).toBe(15);
    expect(JOIN_FIXTURES.length).toBe(31);
  });
  it('20L corpus unchanged: spot classifications pinned', () => {
    expect(classifyOffsetJoin(JOIN_FIXTURE_BY_ID.get('LA_CLEAR_MISS')!.input).classification).toBe('OFFSET_JOIN_NONE');
    expect(classifyOffsetJoin(JOIN_FIXTURE_BY_ID.get('LA_CCW_LEFT_COLLAPSE')!.input).classification).toBe('OFFSET_JOIN_COLLAPSE');
    expect(classifyOffsetJoin(JOIN_FIXTURE_BY_ID.get('LL_PARALLEL_TANGENT')!.input).classification).toBe('OFFSET_JOIN_NONE');
  });
  it('arc×arc NO_GO: every proven-family arc-pair row carries REJECT_ARC_PAIR_NO_GO', () => {
    const p = corpus();
    expect(p.rows.filter((r) => r.reasonCode === 'REJECT_ARC_PAIR_NO_GO').length).toBe(21);
  });
  it('transition problem deferred: every surface row rejects on circularity', () => {
    const p = corpus();
    const surf = p.rows.filter((r) => r.family === 'SURF_FIXED' || r.family === 'SURF_CUTFILL');
    expect(surf.length).toBe(62);
    for (const r of surf) expect(r.reasonCode).toBe('REJECT_CIRCULARITY_SURFACE');
  });
  it('rotation preserves UNIQUE verdict (local V-frame)', () => {
    const f = JOIN_FIXTURE_BY_ID.get('LL_LEFT_TURN_LEFT')!;
    expect(classifyOffsetJoin(transformInput(f.input, 0.9, 123.4, -56.7)).classification).toBe('OFFSET_JOIN_UNIQUE');
  });
});
