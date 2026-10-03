/**
 * Phase 20L.2 — exact-offset join geometry pins (production modules only).
 * Admits on line-line / line-arc / arc-line pairs, arc×arc block, B0/C0 and
 * E1 fallbacks, Roff boundaries, determinism, plus an oracle cross-check
 * that the old 31 join fixtures retain their study classifications.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  solveExactOffsetJoin,
  type ExactMember,
} from '../src/engine/cad/grading/gradingExactOffsetGeometry';
import type { GradingSide } from '../src/engine/cad/grading/gradingTypes';

const line = (
  vx: number, vy: number, tx: number, ty: number,
  span: number, dir: 'in' | 'out',
): ExactMember => ({
  kind: 'line', vx, vy, tx, ty,
  spanStart: dir === 'in' ? -span : 0,
  spanEnd: dir === 'in' ? 0 : span,
});

const arc = (
  vx: number, vy: number, cx: number, cy: number, radius: number,
  arcDir: 1 | -1, sweep: number, dir: 'in' | 'out',
): ExactMember => {
  const len = radius * sweep;
  return {
    kind: 'arc', vx, vy, cx, cy, radius, dir: arcDir,
    spanStart: dir === 'in' ? -len : 0,
    spanEnd: dir === 'in' ? 0 : len,
  };
};

const L = 40;
/** +X → +Y left-turn square, side left (inside OVERLAP). */
const squareLeft = (side: GradingSide, ms = 100) => ({
  incoming: line(0, 0, 1, 0, L, 'in'),
  outgoing: line(0, 0, 0, 1, L, 'out'),
  side, d: 5, maxSearchDistance: ms,
});
/** line→arc CW overlap: outward R+d law (study LA_CW_OVERLAP mirror). */
const laOverlap = () => ({
  incoming: line(0, 0, 1, 0, L, 'in'),
  outgoing: arc(0, 0, 50, 0, 50, -1, Math.PI / 2, 'out'),
  side: 'left' as GradingSide, d: 5, maxSearchDistance: 100,
});
/** arc→line CW overlap (study AL_CW_OVERLAP mirror). */
const alOverlap = () => ({
  incoming: arc(0, 0, 0, -50, 50, -1, Math.PI / 2, 'in'),
  outgoing: line(0, 0, 0, 1, L, 'out'),
  side: 'left' as GradingSide, d: 5, maxSearchDistance: 100,
});

describe('20L.2 geometry: admits', () => {
  it('line-line square admits the UNIQUE on-body join', () => {
    const r = solveExactOffsetJoin(squareLeft('left'));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.kind).toBe('line-line');
      expect(r.join.x).toBeCloseTo(-5, 9);
      expect(r.join.y).toBeCloseTo(5, 9);
      expect(r.join.distV).toBeCloseTo(7.071067812, 6);
    }
  });
  it('line-line shallow (1°) admits near V', () => {
    const a = (1 * Math.PI) / 180;
    const r = solveExactOffsetJoin({
      incoming: line(0, 0, 1, 0, L, 'in'),
      outgoing: line(0, 0, Math.cos(a), Math.sin(a), L, 'out'),
      side: 'left', d: 5, maxSearchDistance: 100,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.join.distV).toBeCloseTo(5.000190392, 6);
  });
  it('line-arc and arc-line overlap admit on the offset circle', () => {
    for (const input of [laOverlap(), alOverlap()]) {
      const r = solveExactOffsetJoin(input);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.kind).toBe('line-circle');
        expect(r.join.distV).toBeCloseTo(6.911904582, 6);
      }
    }
  });
});

describe('20L.2 geometry: fail-closed gates', () => {
  it('arc×arc never solves', () => {
    const r = solveExactOffsetJoin({
      incoming: arc(0, 0, 0, 50, 50, 1, Math.PI / 2, 'in'),
      outgoing: arc(0, 0, -50, 0, 50, 1, Math.PI / 2, 'out'),
      side: 'right', d: 5, maxSearchDistance: 100,
    });
    expect(r).toEqual({ ok: false, reason: 'FALLBACK_ARC_PAIR_NO_GO', detail: expect.any(String) });
  });
  it('Roff collapse (R=d) and inversion (d>R) fail before any solve', () => {
    // CCW-out on the left is the inward (R−d) law.
    for (const [d, reason] of [[5, 'FALLBACK_ROFF_COLLAPSE'], [8, 'FALLBACK_ROFF_INVERSION']] as const) {
      const r = solveExactOffsetJoin({
        incoming: line(0, 0, 1, 0, L, 'in'),
        outgoing: arc(0, 0, -5, 0, 5, 1, Math.PI / 2, 'out'),
        side: 'left', d, maxSearchDistance: 100,
      });
      expect(r).toEqual({ ok: false, reason, detail: expect.any(String) });
    }
  });
  it('B0: two admissible branches are never auto-picked', () => {
    // Arc→line CW on the outside: both circle intersections land on-body.
    const r = solveExactOffsetJoin({
      incoming: arc(0, 0, 0, -50, 50, -1, Math.PI / 2, 'in'),
      outgoing: line(0, 0, 0, 1, L, 'out'),
      side: 'right', d: 5, maxSearchDistance: 100,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('FALLBACK_AMBIGUITY_B0');
  });
  it('C0: consistent join past the member body is not built', () => {
    const r = solveExactOffsetJoin({
      incoming: line(0, 0, 1, 0, 1, 'in'),
      outgoing: line(0, 0, 0, 1, 1, 'out'),
      side: 'right', d: 5, maxSearchDistance: 100,
    });
    expect(r).toEqual({ ok: false, reason: 'FALLBACK_OFF_BODY_C0', detail: expect.any(String) });
  });
  it('E1: square join at |J-V|=7.07 rejects under ms=6, admits at ms=100', () => {
    expect(solveExactOffsetJoin(squareLeft('left', 6)).ok).toBe(false);
    const tight = solveExactOffsetJoin(squareLeft('left', 6));
    if (!tight.ok) expect(tight.reason).toBe('FALLBACK_EXTENT_E1');
    expect(solveExactOffsetJoin(squareLeft('left')).ok).toBe(true);
  });
  it('deterministic and frame-invariant: translation preserves distV and u', () => {
    const base = solveExactOffsetJoin(laOverlap());
    const dx = 1e6;
    const shift = (m: ExactMember): ExactMember =>
      m.kind === 'line' ? { ...m, vx: m.vx + dx } : { ...m, vx: m.vx + dx, cx: m.cx + dx };
    const moved = solveExactOffsetJoin({ ...laOverlap(), incoming: shift(laOverlap().incoming), outgoing: shift(laOverlap().outgoing) });
    expect(base.ok && moved.ok).toBe(true);
    if (base.ok && moved.ok) {
      expect(Math.abs(moved.join.distV - base.join.distV)).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(moved.join.uIn - base.join.uIn)).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(moved.join.uOut - base.join.uOut)).toBeLessThanOrEqual(1e-6);
    }
  });
});

describe('20L.2 geometry: source-radius arc u', () => {
  it('refuses off-body inward join near the arc end (C0)', () => {
    // CCW-out on the left is the inward (R-d) law: R=50, Roff=45. The join
    // angular delta (~0.111 rad) gives source u ~5.57 but Roff u ~5.01, so
    // span 5.3 is past the body in source length yet inside Roff length.
    const r = solveExactOffsetJoin({
      incoming: line(0, 0, 1, 0, L, 'in'),
      outgoing: arc(0, 0, -50, 0, 50, 1, 5.3 / 50, 'out'),
      side: 'left', d: 5, maxSearchDistance: 50,
    });
    expect(r).toEqual({ ok: false, reason: 'FALLBACK_OFF_BODY_C0', detail: expect.any(String) });
  });
  it('admits on-body outward join near the arc end', () => {
    // CW-out on the left is the outward (R+d) law: R=50, Roff=55. The join
    // angular delta (~0.091 rad) gives source u ~4.55 but Roff u ~5.01, so
    // span 4.8 is on the body in source length yet past it in Roff length.
    const r = solveExactOffsetJoin({
      incoming: line(0, 0, 1, 0, L, 'in'),
      outgoing: arc(0, 0, 50, 0, 50, -1, 4.8 / 50, 'out'),
      side: 'left', d: 5, maxSearchDistance: 100,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.kind).toBe('line-circle');
  });
});

describe('20L.2 geometry: oracle cross-check', () => {
  it('old 31 join fixtures retain study classifications in the merged corpus', () => {
    const corpus = JSON.parse(
      readFileSync(join(dirname(new URL(import.meta.url).pathname), '..', 'docs', 'evidence', 'phase20l1', 'policy-corpus.json'), 'utf8'),
    );
    const rows: Array<{ fixtureId: string; family: string; reasonCode: string }> = corpus.rows;
    const fixtures = new Set(rows.map((r) => r.fixtureId));
    expect(fixtures.size).toBe(31);
    // Arc-pair fixtures never admit in proven families (other families
    // reject earlier on circularity — predicate order, not a weaker gate).
    const proven = ['DISTANCE', 'REL_EL', 'ELEV_FLAT'];
    for (const r of rows.filter((x) => x.fixtureId.startsWith('AA_') && proven.includes(x.family))) {
      expect(r.reasonCode).toBe('REJECT_ARC_PAIR_NO_GO');
    }
    // Collapse/inversion fixtures reject on Roff in proven families.
    for (const id of ['LA_CCW_LEFT_COLLAPSE', 'LA_CCW_LEFT_INVERSION']) {
      for (const r of rows.filter((x) => x.fixtureId === id && ['DISTANCE', 'REL_EL', 'ELEV_FLAT'].includes(x.family))) {
        expect(r.reasonCode).toBe('REJECT_ROFF');
      }
    }
  });
});
