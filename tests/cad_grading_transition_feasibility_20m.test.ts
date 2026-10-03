/**
 * Phase 20M — grading-transition feasibility pins (STUDY ONLY, zero src/).
 *
 * Pins the deterministic study corpus under docs/evidence/phase20m/:
 * exact-common-tie controls need no transition, width probes prove
 * underdetermination, negative controls hold, regen is byte-identical.
 * Nothing here touches production gates; production behavior is asserted
 * unchanged by the neighboring 20J/20K/20L suites, not by this file.
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

  it('covers 24 fixtures x T0/T1 = 48 rows with bounded vocabulary', () => {
    const rows = corpus();
    expect(rows).toHaveLength(48);
    const allowed = new Set([
      'EXACT_COMMON_TIE_CONTROL',
      'TRANSITION_GEOMETRICALLY_POSSIBLE',
      'TRANSITION_REQUIRES_NEW_CRITERION',
      'TRANSITION_WIDTH_UNDERDETERMINED',
      'ROOT_POLICY_REQUIRED',
      'EXTENSION_POLICY_REQUIRED',
      'TOPOLOGY_NO_GO',
      'ARC_PAIR_NO_GO',
      'CLOSED_ROUTE_POLICY_REQUIRED',
      'NUMERICAL_NO_GO',
    ]);
    for (const r of rows) expect(allowed.has(r.classification)).toBe(true);
  });

  it('exact-common-tie controls require no transition', () => {
    const rows = corpus();
    for (const id of ['M07-tie-control', 'M08-tie-control-ulp']) {
      const rs = rowsFor(rows, id);
      expect(rs).toHaveLength(2);
      for (const r of rs) {
        expect(r.exactTie).toBe(true);
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

  it('T0 interior honestly violates member law whenever ties disagree', () => {
    const rows = corpus();
    const t0 = rows.filter((r) => r.candidate === 'T0' && !r.exactTie);
    expect(t0.length).toBeGreaterThan(0);
    for (const r of t0) {
      expect(r.requiresNewCriterion).toBe(true);
      if (r.deltaPlan > 1e-9 || r.deltaZ > 1e-9) {
        expect(r.residualInsidePlan + r.residualInsideZ).toBeGreaterThan(0);
      }
    }
  });

  it('T1 width is underdetermined: two probes, materially different areas', () => {
    const rows = corpus();
    const t1 = rows.filter((r) => r.candidate === 'T1' && r.classification === 'TRANSITION_WIDTH_UNDERDETERMINED');
    expect(t1.length).toBeGreaterThan(0);
    for (const r of t1) {
      expect(r.widthUnderdetermined).toBe(true);
      expect(r.widthA).not.toBe(r.widthB);
      // Materially different: wide probe covers 3x plan area (or 3x Z-volume
      // for pure-Z disagreements where plan area is zero by construction).
      const areaRatio = r.areaB! / Math.max(r.areaA!, 1e-12);
      const volRatio = (0.5 * r.deltaZ * r.widthB!) / Math.max(0.5 * r.deltaZ * r.widthA!, 1e-12);
      expect(Math.max(areaRatio, volRatio)).toBeGreaterThan(1.5);
    }
  });

  it('transform/mirror stable: local frames, no 1e6/1e8 artifacts', () => {
    const rows = corpus();
    for (const r of rows) {
      expect(r.transformMaxDev).toBeLessThan(1e-6);
      expect(r.mirrorStable).toBe(true);
    }
  });

  it('reversal pair M16/M17 agrees (order-independent classification)', () => {
    const rows = corpus();
    const a = rowsFor(rows, 'M16-line-arc').map((r) => r.classification).sort();
    const b = rowsFor(rows, 'M17-arc-line').map((r) => r.classification).sort();
    expect(a).toEqual(b);
  });
});
