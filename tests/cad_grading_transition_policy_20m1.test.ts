/**
 * Phase 20M.1 — bounded same-family analytic transition policy pins (STUDY ONLY, zero src/).
 *
 * Pins the deterministic study corpus under docs/evidence/phase20m1/:
 * same-family flat joint-continuous line-line admits with explicit width W,
 * equal/near-agreement controls need no transition, grade-mismatched same
 * family rejects (scalar C0 cannot preserve plan/Z), width/overlap/excluded
 * classes reject, linear-vs-smoothstep proves policy choice, angle ladder
 * records kink honestly with scalar-only (non-production) admission off the
 * collinear axis. All rows synthetic, never solver output.
 * Pair rows are synthetic future-multiple policy evidence only; they do NOT
 * authorize multi-transition production (first 20M.2 predicate: exactly one
 * transition per group).
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildCorpus, corpusSha256, type PolicyRow } from '../scripts/phase20m1TransitionPolicyStudy';

const dir = join(dirname(new URL(import.meta.url).pathname), '..', 'docs', 'evidence', 'phase20m1');
const corpus = (): PolicyRow[] => JSON.parse(readFileSync(join(dir, 'corpus.json'), 'utf8'));
const row = (rows: PolicyRow[], id: string): PolicyRow => {
  const r = rows.find((x) => x.fixtureId === id);
  if (!r) throw new Error(`missing row ${id}`);
  return r;
};

describe('20M.1 transition policy corpus', () => {
  it('committed corpus matches two independent cross-process regens (byte-identical)', { timeout: 120_000 }, () => {
    const committed = readFileSync(join(dir, 'corpus.json'), 'utf8');
    const env = { ...process.env, PHASE20M1_STDOUT: '1' };
    const run = (): string => `${execSync('npx tsx scripts/phase20m1TransitionPolicyStudy.ts', { encoding: 'utf8', env }).trim()}\n`;
    const first = run();
    const second = run();
    expect(first).toBe(second);
    expect(first).toBe(committed);
    expect(JSON.parse(first)).toEqual(buildCorpus());
    expect(readFileSync(join(dir, 'corpus.sha256'), 'utf8').trim()).toBe(corpusSha256(buildCorpus()));
  });

  it('47 rows, all synthetic', () => {
    const rows = corpus();
    expect(rows).toHaveLength(47);
    expect(rows.every((r) => r.synthetic === true)).toBe(true);
  });

  it('equal-value controls need no transition', () => {
    const rows = corpus();
    for (const id of ['ctl-equal-dist', 'ctl-equal-relel']) {
      expect(row(rows, id).admitted).toBe(false);
      expect(row(rows, id).reasonCode).toMatch(/NO-TRANSITION equal-value/);
    }
  });

  it('near-agreement control takes the study-only path (not the production gate)', () => {
    const r = row(corpus(), 'ctl-near-agree');
    expect(r.admitted).toBe(false);
    expect(r.reasonCode).toMatch(/study-only agreement control.*NOT production gate/);
  });

  it('grade-ratio mismatch rejects: scalar C0 cannot preserve plan/Z', () => {
    const rows = corpus();
    expect(row(rows, 'grade-dist').admitted).toBe(false);
    expect(row(rows, 'grade-dist').reasonCode).toMatch(/grade-ratio mismatch/);
    expect(row(rows, 'grade-dist').zGradeGap).toBeGreaterThan(0);
    expect(row(rows, 'grade-relel').admitted).toBe(false);
    expect(row(rows, 'grade-relel').planGradeGap).toBeGreaterThan(0);
    expect(row(rows, 'grade-elev').admitted).toBe(false);
    expect(row(rows, 'grade-elev').planGradeGap).toBeGreaterThan(0);
    for (const id of ['grade-dist', 'grade-relel', 'grade-elev'])
      expect(row(rows, id).productionAdmitted).toBe(false);
  });

  it('collinear equal-grade rows show zero plan/Z grade gap in all 3 families', () => {
    const rows = corpus();
    for (const fam of ['dist', 'relel', 'elev']) {
      const r = row(rows, `${fam}-a0`);
      expect(r.productionAdmitted).toBe(true);
      expect(r.planGradeGap).toBe(0);
      expect(r.zGradeGap).toBe(0);
      expect(r.c0Gap).toBe(0);
    }
  });

  it('width boundary: W==max admits, W==max+eps and over-long reject', () => {
    const rows = corpus();
    expect(row(rows, 'width-max').admitted).toBe(true);
    expect(row(rows, 'width-max-eps').admitted).toBe(false);
    expect(row(rows, 'width-too-long').admitted).toBe(false);
  });

  it('zero/negative/NaN/Inf widths reject', () => {
    const rows = corpus();
    for (const id of ['width-zero', 'width-neg', 'width-nan', 'width-inf'])
      expect(row(rows, id).admitted).toBe(false);
  });

  it('overlap rejects with interior bounds; touching is occupancy-only, never production', () => {
    const rows = corpus();
    expect(row(rows, 'overlap-pair').admitted).toBe(false);
    expect(row(rows, 'overlap-pair').productionAdmitted).toBe(false);
    expect(row(rows, 'overlap-pair').reasonCode).toMatch(/share interior \(3,4\)/);
    const t = row(rows, 'touch-pair');
    expect(t.admitted).toBe(true);
    expect(t.productionAdmitted).toBe(false); // strict gap required: shared-station C0 unevidenced
    expect(t.reasonCode).toMatch(/OCCUPANCY-ONLY.*NOT production/);
    expect(t.reasonCode).toMatch(/share station s=4 only/);
  });

  it('linear vs smoothstep differ materially: linear is policy, not derivation', () => {
    const rows = corpus();
    const d = row(rows, 'dist-a0');
    expect(d.maxLinSmooth).toBeGreaterThan(0.19); // ~0.0962*|7-5|
    expect(row(rows, 'ctl-equal-dist').maxLinSmooth).toBe(0);
  });

  it('angle ladder: collinear production admits, non-collinear is scalar-only with kink recorded', () => {
    const rows = corpus();
    for (const fam of ['dist', 'relel', 'elev']) {
      const c0 = row(rows, `${fam}-a0`);
      expect(c0.admitted).toBe(true);
      expect(c0.productionAdmitted).toBe(true);
      expect(c0.c0Gap).toBe(0);
      expect(c0.kinkDeg).toBe(0);
      expect(c0.foldover).toBe(false);
      for (const a of [5, 15, 45, 90, 135, 179]) {
        const r = row(rows, `${fam}-a${a}`);
        expect(r.admitted).toBe(true); // scalar law continuous; kink recorded not masked
        expect(r.productionAdmitted).toBe(false); // never a production ADMIT
        expect(r.reasonCode).toMatch(/SCALAR-ONLY.*NOT production/);
        expect(Math.abs(r.kinkDeg - a)).toBeLessThan(1e-9);
      }
      expect(row(rows, `${fam}-a45`).foldover).toBe(false);
      expect(row(rows, `${fam}-a90`).foldover).toBe(false); // perpendicular, not doubling back
      expect(row(rows, `${fam}-a135`).foldover).toBe(true);
      expect(row(rows, `${fam}-a179`).foldover).toBe(true);
    }
  });

  it('transforms/mirror/reversal stable with honest nonzero shift deviations', () => {
    const rows = corpus();
    for (const id of ['x-shift-1e6', 'x-shift-1e8', 'x-mirror', 'x-reverse']) {
      const r = row(rows, id);
      expect(r.admitted).toBe(true);
      expect(r.mirrorStable).toBe(true);
    }
    expect(row(rows, 'x-shift-1e8').transformDev).toBeGreaterThan(0);
  });

  it('excluded classes all reject', () => {
    const rows = corpus();
    for (const id of ['ex-surface', 'ex-hybrid', 'ex-arc', 'ex-closed', 'ex-sloped', 'ex-joint-step', 'ex-mixed-elev']) {
      const r = row(rows, id);
      expect(r.admitted).toBe(false);
      expect(r.reasonCode).toMatch(/REJECT excluded class/);
    }
  });

  it('no src/ changes in the committed 20M.1 range', () => {
    // The committed-range proof is anchored to the Phase 20M.1 scope
    // (baseline 3fe69f22 through the PR #150 merge bd4bdd45), NOT floating
    // HEAD: a floating end would fail on any later branch that legitimately
    // touches src/ (e.g. toolchain maintenance), even though 20M.1 itself
    // stayed zero-src. Shallow CI checkouts may lack either object, so
    // detect non-throwing and only then assert the range; the range proof
    // there is independently enforced by PR changed-path classification /
    // GitHub changed-file review, not by this unit test. The floating
    // working-tree assertion was removed in Phase 20N.1, whose authorized
    // production delta legitimately edits src/.
    let rangeProvable = true;
    try {
      execSync('git cat-file -e 3fe69f22103b1d242538a0a205a0774e145afde5^{commit}', { stdio: 'ignore' });
      execSync('git cat-file -e bd4bdd4599006a82308bafc25e73341f46866013^{commit}', { stdio: 'ignore' });
    } catch {
      rangeProvable = false;
    }
    if (rangeProvable) {
      const range = execSync('git diff --name-only 3fe69f22103b1d242538a0a205a0774e145afde5...bd4bdd4599006a82308bafc25e73341f46866013 -- src', { encoding: 'utf8' });
      expect(range.trim()).toBe('');
    }
  });
});
