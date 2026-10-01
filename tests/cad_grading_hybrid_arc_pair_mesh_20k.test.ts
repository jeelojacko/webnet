/**
 * Phase 20K — hybrid arc×arc group mesh evidence checks (EVIDENCE/TEST ONLY).
 *
 * Loads the committed corpus (`docs/evidence/phase20k/corpus.json`), rebuilds
 * it in-process twice, and asserts:
 *   - deterministic byte/content equality between runs and against the file;
 *   - zero expected/actual mismatches and one digest per identical success;
 *   - the rounded-square hybrid has 4 exact ties but is NOT buildable:
 *     independent topology audit FAILS (edgeComponents=8 vertex pinch),
 *     while tie points still match the production all-distance control
 *     (triangle-set delta documented; 20K.1 Wave C1 solved the production
 *     control, so plan areas now honestly differ);
 *   - the mismatch ladder fails closed (the spec-literal concave control
 *     now solves via the C1 seam, audited valid);
 *   - the independent audit itself rejects a synthetic overlap.
 *
 * No production routing is touched. `src/` is unmodified.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  auditMesh,
  buildCorpus,
  compareHybridToControl,
  flatTin,
  primaryArcPair,
  roundedSquareMembers,
  assembleHybridArcGroup,
  DIST,
  FIXED,
  REL,
  type CorpusPayload,
} from '../scripts/phase20kHybridArcPairGroups';

const corpusUrl = new URL('../docs/evidence/phase20k/corpus.json', import.meta.url);

const readCorpus = (): CorpusPayload => JSON.parse(readFileSync(corpusUrl, 'utf8')) as CorpusPayload;

describe('phase20k hybrid arc-pair corpus', () => {
  it('is deterministic: two in-process builds and the committed file agree', () => {
    const a = buildCorpus();
    const b = buildCorpus();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.parse(readFileSync(corpusUrl, 'utf8'))).toEqual(a);
  });

  it('has zero mismatches and one digest per identical success', () => {
    const payload = readCorpus();
    expect(payload.rows.length).toBeGreaterThanOrEqual(30);
    expect(payload.summary.mismatched).toEqual([]);
    expect(payload.summary.matched).toBe(payload.rows.length);
    expect(payload.summary.digests).toBeGreaterThan(0);
    // Every successful exact row carries a mesh digest and a passing audit.
    // No EXACT_TIE-buildable rows remain: every exact-tie group is classified
    // EXACT_TIE_NOT_BUILDABLE (open daylight discontinuity and/or vertex pinch).
    for (const row of payload.rows.filter((r) => r.expected === 'EXACT_TIE')) {
      expect(row.actual).toBe('EXACT_TIE');
      expect(row.auditPass).toBe(true);
      expect(row.meshDigest).toBeTruthy();
      expect(row.tieCount).toBeGreaterThan(0);
    }
    // The closed square keeps its exact tie but is explicitly non-buildable.
    const square = payload.rows.find((r) => r.id === 'closed.square.hybrid')!;
    expect(square.expected).toBe('EXACT_TIE_NOT_BUILDABLE');
    expect(square.actual).toBe('EXACT_TIE');
    expect(square.match).toBe(true);
    expect(square.auditPass).toBe(false);
    expect(square.tieCount).toBe(4);
  });

  it('rejects a synthetic interior overlap (independent audit self-check)', () => {
    // Two identical CCW triangles tile the same plan area → overlap.
    const mesh = {
      points: [0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 0.001, 10, 0, 0.001, 0, 10, 0.001],
      triangles: [0, 1, 2, 3, 4, 5],
    };
    const audit = auditMesh(mesh, [], false);
    expect(audit.checks.noInteriorOverlap).toBe(false);
    expect(audit.pass).toBe(false);
  });
});

describe('phase20k rounded-square hybrid (§27)', () => {
  it('has four exact ties but FAILS the audit (vertex pinch, not buildable)', () => {
    const members = roundedSquareMembers(10);
    const out = assembleHybridArcGroup({
      members,
      criteria: [FIXED(-0.5), DIST(-0.5, 20), FIXED(-0.5), REL(-0.5, -10)],
      models: ['chord', 'chord', 'chord', 'chord'],
      side: 'right', maxSearchDistance: 100, curveChordTolerance: 0.1,
      closed: true, target: flatTin(0),
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.corners).toHaveLength(4);
    expect(out.corners.every((c) => c.classification === 'GAP')).toBe(true);
    const audit = auditMesh(out.mesh, out.daylight, true, out.planArea);
    // Regression: vertex-pinched mesh is not a 2-manifold usable surface —
    // edge-connected components > 1 fails buildability for closed too.
    expect(audit.edgeComponents).toBe(8);
    expect(audit.checks.edgeConnected).toBe(false);
    expect(audit.pass, audit.issues.join('; ')).toBe(false);
    expect(audit.issues.join('; ')).toContain('vertex pinch');
  });

  it('records the production all-distance control solved via the C1 seam', () => {
    // 20K.1 Wave C1: the production curved control reaches CURRENT, so the
    // hybrid-vs-control comparison is available. Corner ties agree to
    // <1e-12 (same analytic authority); meshes honestly differ (study
    // overlap tiling 114 tris vs production exact seam 128 tris).
    const payload = readCorpus();
    const comparison = payload.summary.comparison;
    expect(comparison?.available).toBe(true);
    expect(comparison?.tiePointsEqual).toBe(true);
    expect(comparison?.maxTieDelta).toBeLessThan(1e-12);
    expect(comparison?.hybridTriangles).toBe(114);
    expect(comparison?.controlTriangles).toBe(128);
  });

  it('keeps control comparators available', () => {
    const members = roundedSquareMembers(10);
    const out = assembleHybridArcGroup({
      members,
      criteria: [FIXED(-0.5), DIST(-0.5, 20), FIXED(-0.5), REL(-0.5, -10)],
      models: ['chord', 'chord', 'chord', 'chord'],
      side: 'right', maxSearchDistance: 100, curveChordTolerance: 0.1,
      closed: true, target: flatTin(0),
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // compareHybridToControl must reject an unavailable control rather than throw.
    const unavailable = compareHybridToControl(out, { ok: false, code: 'X' });
    expect(unavailable.available).toBe(false);
  });
});

describe('phase20k fail-closed controls (§28)', () => {
  it('exact tie but non-buildable open pair (arc seam discontinuity)', () => {
    const [bottom, right] = primaryArcPair(10);
    const out = assembleHybridArcGroup({
      members: [bottom, right],
      criteria: [FIXED(-0.5), DIST(-0.5, 20)],
      models: ['chord', 'chord'],
      side: 'right', maxSearchDistance: 100, curveChordTolerance: 0.1,
      closed: false, target: flatTin(0),
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.corners).toHaveLength(1);
    const audit = auditMesh(out.mesh, out.daylight, false, out.planArea);
    expect(audit.pass).toBe(false); // exact tie without a buildable group ≠ GO
  });

  it('spec-literal concave geometry self-intersects (production all-distance too)', () => {
    const payload = readCorpus();
    const literal = payload.rows.find((r) => r.id === 'closed.square.literal-concave');
    expect(literal?.actual).toContain('GROUP_SELF_INTERSECTION');
    expect(literal?.match).toBe(true);
  });

  it('mismatch ladder fails closed without partial geometry', () => {
    const payload = readCorpus();
    const mismatch = payload.rows.filter((r) => r.category === 'rounded-square-mismatch');
    expect(mismatch.length).toBeGreaterThanOrEqual(2);
    for (const row of mismatch) {
      expect(row.actual).toContain('TRANSITION_REQUIRED');
      expect(row.meshValid).toBe(false);
      expect(row.tieCount).toBe(0);
    }
  });
});
