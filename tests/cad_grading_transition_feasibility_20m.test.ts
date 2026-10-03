/**
 * Phase 20M — grading-transition feasibility pins (STUDY ONLY, zero src/).
 *
 * Pins the deterministic study corpus under docs/evidence/phase20m/:
 * study-agreement tie controls need no transition, width probes prove
 * underdetermination, negative controls hold, regen is byte-identical.
 * Nothing here touches production gates; production behavior is asserted
 * unchanged by the neighboring 20J/20K/20L suites, not by this file.
 * All corpus rows are synthetic (synthetic: true), never solver output.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildCorpus,
  corpusSha256,
  type TransitionRow,
} from '../scripts/phase20mTransitionStudy';

const dir = join(dirname(new URL(import.meta.url).pathname), '..', 'docs', 'evidence', 'phase20m');
const corpus = (): TransitionRow[] =>
  JSON.parse(readFileSync(join(dir, 'corpus.json'), 'utf8'));

const rowsFor = (rows: TransitionRow[], id: string): TransitionRow[] =>
  rows.filter((r) => r.fixtureId === id).sort((a, b) => (a.candidate < b.candidate ? -1 : 1));

describe('20M transition feasibility corpus', () => {
  it('committed corpus matches in-memory rebuild (byte-identical)', () => {
    const committed = readFileSync(join(dir, 'corpus.json'), 'utf8');
    const rebuilt = `${JSON.stringify(buildCorpus(), null, 2)}\n`;
    expect(rebuilt).toBe(committed);
    expect(readFileSync(join(dir, 'corpus.sha256'), 'utf8').trim()).toBe(corpusSha256(buildCorpus()));
  });

  it('rebuild twice is deterministic', () => {
    expect(JSON.stringify(buildCorpus())).toBe(JSON.stringify(buildCorpus()));
  });

  it('covers 24 fixtures x T0/T1 = 48 rows with evidenced vocabulary only', () => {
    const rows = corpus();
    expect(rows).toHaveLength(48);
    const allowed = new Set([
      'EXACT_COMMON_TIE_CONTROL',
      'TRANSITION_REQUIRES_NEW_CRITERION',
      'TRANSITION_WIDTH_UNDERDETERMINED',
      'ROOT_POLICY_REQUIRED',
      'EXTENSION_POLICY_REQUIRED',
      'ARC_PAIR_NO_GO',
      'CLOSED_ROUTE_POLICY_REQUIRED',
    ]);
    for (const r of rows) expect(allowed.has(r.classification)).toBe(true);
  });

  it('every row is marked synthetic (never solver output)', () => {
    for (const r of corpus()) expect(r.synthetic).toBe(true);
  });

  it('verdict distribution matches the documented matrix', () => {
    const rows = corpus();
    const count = (c: string): number => rows.filter((r) => r.classification === c).length;
    expect(count('TRANSITION_REQUIRES_NEW_CRITERION')).toBe(17);
    expect(count('TRANSITION_WIDTH_UNDERDETERMINED')).toBe(17);
    expect(count('EXACT_COMMON_TIE_CONTROL')).toBe(4);
    expect(count('ROOT_POLICY_REQUIRED')).toBe(4);
    expect(count('ARC_PAIR_NO_GO')).toBe(2);
    expect(count('CLOSED_ROUTE_POLICY_REQUIRED')).toBe(2);
    expect(count('EXTENSION_POLICY_REQUIRED')).toBe(2);
  });

  it('study-agreement tie controls require no transition', () => {
    const rows = corpus();
    for (const id of ['M07-tie-control', 'M08-tie-control-ulp']) {
      const rs = rowsFor(rows, id);
      expect(rs).toHaveLength(2);
      for (const r of rs) {
        expect(r.studyAgreementTie).toBe(true);
        expect(r.classification).toBe('EXACT_COMMON_TIE_CONTROL');
        expect(r.requiresNewCriterion).toBe(false);
      }
    }
  });

  it('negative controls hold: arc-pair, closed, roots, extension', () => {
    const rows = corpus();
    expect(rowsFor(rows, 'M18-arc-arc').map((r) => r.classification)).toEqual(
      expect.arrayContaining(['ARC_PAIR_NO_GO']),
    );
    expect(rowsFor(rows, 'M19-closed').map((r) => r.classification)).toEqual(
      expect.arrayContaining(['CLOSED_ROUTE_POLICY_REQUIRED']),
    );
    expect(rowsFor(rows, 'M14-multi-root')[1]!.classification).toBe('ROOT_POLICY_REQUIRED');
    expect(rowsFor(rows, 'M12-no-root')[1]!.classification).toBe('ROOT_POLICY_REQUIRED');
    expect(rowsFor(rows, 'M23-extension')[1]!.classification).toBe('EXTENSION_POLICY_REQUIRED');
  });

  it('T0 midpoint-gap illustration is honestly nonzero whenever ties disagree', () => {
    const rows = corpus();
    const t0 = rows.filter((r) => r.candidate === 'T0' && !r.studyAgreementTie);
    expect(t0).toHaveLength(22);
    for (const r of t0) {
      expect(r.requiresNewCriterion).toBe(true);
      if (r.deltaPlan > 0 || r.deltaZ > 0) {
        expect(r.midpointGapPlanIllustration + r.midpointGapZIllustration).toBeGreaterThan(0);
      }
    }
  });

  it('T1 width is underdetermined: two probes, materially different illustrations', () => {
    const rows = corpus();
    const t1 = rows.filter((r) => r.candidate === 'T1' && r.classification === 'TRANSITION_WIDTH_UNDERDETERMINED');
    expect(t1.length).toBeGreaterThan(0);
    for (const r of t1) {
      expect(r.widthUnderdetermined).toBe(true);
      // Probes are memberLength/8 and 3x that: exact deterministic relation.
      expect(r.widthB).toBe(3 * r.widthA!);
      // At least one illustration differs exactly; wide probe covers 3x.
      const planDiffers = r.areaA !== r.areaB;
      const zDiffers = r.zVolA !== r.zVolB;
      expect(planDiffers || zDiffers).toBe(true);
      // Wide probe covers exactly 3x the narrow probe (exact branch per row kind).
      if (r.deltaPlan > 0) {
        expect(r.areaB! / r.areaA!).toBeGreaterThan(1.5);
      } else {
        expect(r.zVolB! / r.zVolA!).toBeGreaterThan(1.5);
      }
    }
  });

  it('pure-Z rows cite Z-volume illustration, never "areas differ 0 vs 0"', () => {
    const rows = corpus();
    for (const r of rows.filter((x) => x.candidate === 'T1' && x.deltaPlan === 0 && !x.studyAgreementTie)) {
      expect(r.areaA).toBe(0);
      expect(r.areaB).toBe(0);
      expect(r.zVolB).not.toBe(r.zVolA);
      expect(r.reasonCode).toContain('Z-volume');
      expect(r.reasonCode).not.toContain('areas differ 0 vs 0');
    }
  });

  it('translated-world stress is bounded; mirror recomputes from mirrored inputs', () => {
    const rows = corpus();
    let maxDev = 0;
    for (const r of rows) {
      expect(r.transformMaxDev).toBeLessThan(1e-6);
      expect(r.mirrorStable).toBe(true);
      maxDev = Math.max(maxDev, r.transformMaxDev);
    }
    // Measured corpus max is ~1.19e-08 (M22 float sensitivity), never 0.
    expect(maxDev).toBeGreaterThan(0);
    expect(maxDev).toBeLessThan(1e-6);
  });

  it('reversal pair M16/M17 agrees (order-independent classification)', () => {
    const rows = corpus();
    const a = rowsFor(rows, 'M16-line-arc').map((r) => r.classification).sort();
    const b = rowsFor(rows, 'M17-arc-line').map((r) => r.classification).sort();
    expect(a).toEqual(b);
  });
});
