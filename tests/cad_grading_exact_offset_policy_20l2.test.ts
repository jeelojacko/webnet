/**
 * Phase 20L.2 — exact-offset route preflight pins (production modules only).
 * Member law, Roff collapse/inversion, scope gates, determinism, plus a
 * cross-check that the merged 20L/20L.1 oracle corpus still reports the
 * 15-row P0 admitted set this preflight preserves. The test may READ the
 * oracle JSON; `src/` never imports it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  preflightExactOffsetRoute,
  type ExactOffsetPolicyMember,
} from '../src/engine/cad/grading/gradingExactOffsetPolicy';
import type { GradingCriterion } from '../src/engine/cad/grading/gradingTypes';

const DIST: GradingCriterion = { kind: 'distance', gradeRatio: 1, distance: 5 };
const REL_EL: GradingCriterion = { kind: 'relative-elevation', gradeRatio: 1, relativeElevation: 5 };
const ELEV_FLAT: GradingCriterion = { kind: 'elevation', gradeRatio: 1, targetElevation: 5 };
const FIXED: GradingCriterion = { kind: 'fixed', gradeRatio: 1 };

const line = (criterion: GradingCriterion, z = 0): ExactOffsetPolicyMember => ({
  criterion, isArc: false, radius: 0, startZ: z, endZ: z,
  tx: 1, ty: 0, vx: 0, vy: 0, cx: 0, cy: 0,
});

/** Outgoing arc leaving V=(0,0) along +Y. CW ⇒ centre (R,0); CCW ⇒ (−R,0). */
const arcOutY = (criterion: GradingCriterion, radius: number, dir: 1 | -1, z = 0): ExactOffsetPolicyMember => ({
  criterion, isArc: true, radius, startZ: z, endZ: z,
  tx: 0, ty: 1, vx: 0, vy: 0, cx: dir === 1 ? -radius : radius, cy: 0,
});

const corpusRows = (): Array<{ fixtureId: string; family: string; admit: boolean; reasonCode: string }> =>
  JSON.parse(
    readFileSync(join(dirname(new URL(import.meta.url).pathname), '..', 'docs', 'evidence', 'phase20l1', 'policy-corpus.json'), 'utf8'),
  ).rows;

describe('20L.2 policy: member law admits', () => {
  it('distance / rel-el / flat-elevation resolve to the same proven d=5', () => {
    for (const c of [DIST, REL_EL, ELEV_FLAT]) {
      const r = preflightExactOffsetRoute({
        members: [line(c), arcOutY(c, 50, -1)],
        closed: false, side: 'left', maxSearchDistance: 100,
      });
      expect(r).toEqual({ admitted: true, d: 5 });
    }
  });
  it('R0: every member shares one d across the whole route', () => {
    const r = preflightExactOffsetRoute({
      members: [line(DIST), arcOutY(DIST, 50, -1), line(DIST)],
      closed: false, side: 'left', maxSearchDistance: 100,
    });
    expect(r).toEqual({ admitted: true, d: 5 });
  });
});

describe('20L.2 policy: member law rejects', () => {
  it('sloped source rejects identically from 1e-13 to gross', () => {
    for (const dz of [1e-13, 11e-3, 10]) {
      const sloped: ExactOffsetPolicyMember = { ...line(DIST, 0), startZ: 2e-13, endZ: 2e-13 + dz };
      const r = preflightExactOffsetRoute({
        members: [sloped, arcOutY(DIST, 50, -1)],
        closed: false, side: 'left', maxSearchDistance: 100,
      });
      expect(r).toEqual({ admitted: false, reason: 'FALLBACK_SLOPED_SOURCE', detail: expect.any(String) });
    }
  });
  it('elevation on differing member flats is a d-mismatch, never first-member-only', () => {
    const r = preflightExactOffsetRoute({
      members: [{ ...line(ELEV_FLAT, 0) }, { ...arcOutY(ELEV_FLAT, 50, -1, 2) }],
      closed: false, side: 'left', maxSearchDistance: 100,
    });
    expect(r.admitted).toBe(false);
    if (!r.admitted) expect(r.reason).toBe('FALLBACK_D_MISMATCH');
  });
  it('differing distances reject', () => {
    const d6: GradingCriterion = { kind: 'distance', gradeRatio: 1, distance: 6 };
    const r = preflightExactOffsetRoute({
      members: [line(DIST), arcOutY(d6, 50, -1)],
      closed: false, side: 'left', maxSearchDistance: 100,
    });
    expect(r.admitted).toBe(false);
    if (!r.admitted) expect(r.reason).toBe('FALLBACK_D_MISMATCH');
  });
  it('surface criteria are excluded', () => {
    const r = preflightExactOffsetRoute({
      members: [line(FIXED), arcOutY(FIXED, 50, -1)],
      closed: false, side: 'left', maxSearchDistance: 100,
    });
    expect(r.admitted).toBe(false);
    if (!r.admitted) expect(r.reason).toBe('FALLBACK_SURFACE_TARGET');
  });
  it('source-joint step rejects with no tolerance', () => {
    const r = preflightExactOffsetRoute({
      members: [line(DIST, 0), arcOutY(DIST, 50, -1, 2)],
      closed: false, side: 'left', maxSearchDistance: 100,
    });
    expect(r.admitted).toBe(false);
    if (!r.admitted) expect(r.reason).toBe('FALLBACK_SOURCE_JOINT_STEP');
  });
  it('over-search d rejects exactly', () => {
    const r = preflightExactOffsetRoute({
      members: [line(DIST), arcOutY(DIST, 50, -1)],
      closed: false, side: 'left', maxSearchDistance: 4,
    });
    expect(r.admitted).toBe(false);
    if (!r.admitted) expect(r.reason).toBe('FALLBACK_INVALID_CRITERION');
  });
});

describe('20L.2 policy: scope + Roff', () => {
  it('closed-with-arc routes chord fallback', () => {
    const r = preflightExactOffsetRoute({
      members: [line(DIST), arcOutY(DIST, 50, -1)],
      closed: true, side: 'left', maxSearchDistance: 100,
    });
    expect(r.admitted).toBe(false);
    if (!r.admitted) expect(r.reason).toBe('FALLBACK_CLOSED_WITH_ARC');
  });
  it('line-only groups are not admitted, open or closed', () => {
    for (const closed of [false, true]) {
      const r = preflightExactOffsetRoute({
        members: [line(DIST), line(DIST)],
        closed, side: 'left', maxSearchDistance: 100,
      });
      expect(r.admitted).toBe(false);
      if (!r.admitted) expect(r.reason).toBe('FALLBACK_NOT_CURVED');
    }
  });
  it('Roff collapse (R=d inward) and inversion (d>R inward) fail closed', () => {
    // CCW-out on the left is the inward (R−d) law.
    const collapse = preflightExactOffsetRoute({
      members: [line(DIST), arcOutY(DIST, 5, 1)],
      closed: false, side: 'left', maxSearchDistance: 100,
    });
    expect(collapse.admitted).toBe(false);
    if (!collapse.admitted) expect(collapse.reason).toBe('FALLBACK_ROFF_COLLAPSE');
    const d8: GradingCriterion = { kind: 'distance', gradeRatio: 1, distance: 8 };
    const inversion = preflightExactOffsetRoute({
      members: [line(d8), arcOutY(d8, 5, 1)],
      closed: false, side: 'left', maxSearchDistance: 100,
    });
    expect(inversion.admitted).toBe(false);
    if (!inversion.admitted) expect(inversion.reason).toBe('FALLBACK_ROFF_INVERSION');
  });
  it('deterministic: repeated preflight is byte-identical', () => {
    const input = {
      members: [line(DIST), arcOutY(DIST, 50, -1)],
      closed: false as const, side: 'left' as const, maxSearchDistance: 100,
    };
    expect(preflightExactOffsetRoute(input)).toEqual(preflightExactOffsetRoute(input));
  });
});

describe('20L.2 policy: oracle cross-check', () => {
  it('merged corpus still reports the 15-row P0 admitted set this preflight preserves', () => {
    const rows = corpusRows();
    expect(rows).toHaveLength(186);
    const admitted = rows.filter((r) => r.admit);
    expect(admitted).toHaveLength(15);
    const ids = new Set(admitted.map((r) => `${r.fixtureId}|${r.family}`));
    for (const f of ['LL_LEFT_TURN_LEFT', 'LL_RIGHT_TURN_RIGHT', 'LL_SHALLOW_1DEG_LEFT', 'LA_CW_OVERLAP', 'AL_CW_OVERLAP']) {
      for (const fam of ['DISTANCE', 'REL_EL', 'ELEV_FLAT']) expect(ids.has(`${f}|${fam}`)).toBe(true);
    }
    // Study admits are line-line or line-arc UNIQUE — never arc-pair, never
    // sloped/variable families — matching the preflight scope gates above.
    for (const r of admitted) expect(r.fixtureId.startsWith('AA_')).toBe(false);
  });
});
