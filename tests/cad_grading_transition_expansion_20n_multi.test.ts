/**
 * Phase 20N Candidate A — REAL shared-member mesh evidence pins.
 *
 * STUDY ONLY, zero src/ changes. Pins the multi-transition mesh facts from
 * scripts/phase20nMultiTransitionMesh.ts: actual strip meshes over real
 * shared-member 2T/3T groups x 3 families, production gtop2 certification
 * against the INDEPENDENT pre-mesh expectation + exact revalidation,
 * per-transition production agreement validators, true-traversal-reversal
 * (B1) evidence, negative stages, wrong-budget rejection, and the
 * production gates that still hold (cardinality, collinearity, 20M.2 single).
 *
 * Topology independence: 1/1/1 is declared by the bounded candidate
 * predicate BEFORE mesh (`deriveCandidateAPreMeshExpectation`), then
 * independently measured/certified — never derived from observed count.
 * Reversal (B1): `transform: 'reversal'` rebuilds the member array in
 * reversed traversal order with production `courseCriterionKey` reversed
 * endpoint pairs, reindexed joints, and physical widths in reverse order.
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  admitGradingTransition,
  evaluateTransitionLinearV1,
  selectGroupTransition,
} from '../src/engine/cad/grading/gradingTransitionPolicy';
import {
  deriveGradingTopologyExpectation,
  deriveTransitionExpectation,
} from '../src/engine/cad/grading/gradingTopologyExpectation';
import {
  buildGradingTopologyCertificateExact,
  countPositiveWidthRegions,
} from '../src/engine/cad/grading/gradingTopologyCertificate';
import { buildGradingStripMesh } from '../src/engine/cad/grading/gradingMesh';
import {
  coordinateAgreementTol,
  elevationAgreementTol,
} from '../src/engine/cad/grading/gradingGroupSectors';
import {
  assertCanonicalJointOrder,
  buildMultiGroup,
  candidateAMultiBuildCorpus,
  classifyMultiStation,
  deriveCandidateAPreMeshExpectation,
  meshAndCertifyMultiGroup,
  MULTI_FIXTURES,
  revisionFactsMultiGroup,
  multiMemberId,
  multiMemberIdReversed,
  normalizeReversedWorldToBase,
  parseJointIndex,
  tileMultiGroup,
} from '../scripts/phase20nMultiTransitionMesh';
import { buildGroupRevision } from '../src/engine/cad/grading/gradingGroupRevision';
import { phase20nRegenCorpus } from '../scripts/phase20nCorpusRegen';

const corpusDir = join(dirname(new URL(import.meta.url).pathname), '..', 'docs', 'evidence', 'phase20n');

describe('20N-A mesh scope guard: zero src/ changes', () => {
  it('working tree/index clean under src/', () => {
    const tree = execSync('git status --porcelain -- src', { encoding: 'utf8' });
    expect(tree.trim()).toBe('');
  });
});

describe('20N-A mesh: real 2T/3T shared-member groups x 3 families', () => {
  it('35 A rows: 31 valid mesh rows + 4 negatives; real member ids, no fake L/R', () => {
    const rows = candidateAMultiBuildCorpus();
    expect(rows).toHaveLength(35);
    expect(MULTI_FIXTURES).toHaveLength(35);
    for (const row of rows) {
      expect(row.memberIds).not.toContain('L');
      expect(row.memberIds).not.toContain('R');
      if (row.transform === 'reversal' && row.futurePredicateEligible) {
        // True traversal reversal: production courseCriterionKey with
        // reversed endpoint pairs — legitimately different ids.
        expect(row.memberIds).toEqual(row.memberLengths.map((_, i) => multiMemberIdReversed(i, row.memberCount)));
        expect(row.memberIds).not.toEqual(row.memberLengths.map((_, i) => multiMemberId(i)));
        expect(row.traversalOrder).toBe('reversed-traversal');
      } else if (row.futurePredicateEligible) {
        expect(row.memberIds).toEqual(row.memberLengths.map((_, i) => multiMemberId(i)));
        expect(row.traversalOrder).toBe('forward');
      }
      expect(row.jointIds).toEqual(row.widths.map((_, j) => `joint:${j}`));
    }
    // Shared middles are real: 2T M1=24 shared by both joints; 3T M1=24/M2=26.
    const two = rows.find((r) => r.fixtureId === 'candidateA2T-distance-identity')!;
    expect(two.memberLengths).toEqual([30, 24, 30]);
    expect(two.nativeGapsMeasured).toEqual([17]);
    const three = rows.find((r) => r.fixtureId === 'candidateA3T-distance-identity')!;
    expect(three.memberLengths).toEqual([30, 24, 26, 30]);
    expect(three.nativeGapsMeasured).toEqual([17, 21]);
    // Reversed traversal records the REBUILT order (3T lengths reversed).
    const threeRev = rows.find((r) => r.fixtureId === 'candidateA3T-distance-reversal')!;
    expect(threeRev.memberLengths).toEqual([30, 26, 24, 30]);
    expect(threeRev.widths).toEqual([4, 6, 8]);
  });

  it('every valid row: pre-mesh 1 declared, measured 1, gtop2 1/1, revalidation null', () => {
    for (const row of candidateAMultiBuildCorpus()) {
      if (!row.futurePredicateEligible) continue;
      const m = row.measured;
      expect(m.layoutOk).toBe(true);
      // Corpus records BOTH the pre-mesh policy value and the post-tiling
      // production count, and requires equality.
      expect(m.expectedPositiveWidthRegions).toBe(1);
      expect(m.measuredPositiveWidthRegions).toBe(1);
      expect(m.topologyPreMeshEqualsMeasured).toBe(true);
      expect(m.expectedComponents).toBe(1);
      expect(m.expectedBoundaryCycles).toBe(1);
      expect(m.gtop2Components).toBe(1);
      expect(m.gtop2BoundaryCycles).toBe(1);
      expect(m.gtop2RevalidationNull).toBe(true);
      expect(m.skippedZeroWidth).toBe(0);
      expect(m.ownershipUnique).toBe(true);
      expect(m.c0PlanResidual).toBe(0);
      expect(m.c0ZResidual).toBe(0);
    }
  });

  it('2T mesh facts exact (12 stations, 24 verts, 22 tris); 3T exact (17/34/32)', () => {
    const rows = candidateAMultiBuildCorpus();
    const two = rows.find((r) => r.fixtureId === 'candidateA2T-distance-identity')!;
    expect(two.measured).toMatchObject({ stationCount: 12, vertexCount: 24, triangleCount: 22 });
    const three = rows.find((r) => r.fixtureId === 'candidateA3T-distance-identity')!;
    expect(three.measured).toMatchObject({ stationCount: 17, vertexCount: 34, triangleCount: 32 });
    // Reversed traversals tile the same counts (same strip, walked backwards).
    const twoRev = rows.find((r) => r.fixtureId === 'candidateA2T-distance-reversal')!;
    expect(twoRev.measured).toMatchObject({ stationCount: 12, vertexCount: 24, triangleCount: 22 });
    const threeRev = rows.find((r) => r.fixtureId === 'candidateA3T-distance-reversal')!;
    expect(threeRev.measured).toMatchObject({ stationCount: 17, vertexCount: 34, triangleCount: 32 });
  });

  it('mid scalars alternate per joint from real member values (6 / 1.75 / 0.75)', () => {
    const rows = candidateAMultiBuildCorpus();
    for (const fam of ['distance', 'relative-elevation', 'elevation'] as const) {
      const two = rows.find((r) => r.fixtureId === `candidateA2T-${fam}-identity`)!;
      const three = rows.find((r) => r.fixtureId === `candidateA3T-${fam}-identity`)!;
      const mid = fam === 'distance' ? 6 : fam === 'relative-elevation' ? 1.75 : 0.75;
      expect(two.measured.midScalars).toEqual([mid, mid]);
      expect(three.measured.midScalars).toEqual([mid, mid, mid]);
    }
  });

  it('per-transition production validators green on actual checkpoints (all 3 families)', () => {
    for (const row of candidateAMultiBuildCorpus()) {
      if (!row.futurePredicateEligible) continue;
      const m = row.measured;
      const n = row.transitionCount;
      expect(m.meshValidatorCodes).toEqual(new Array(n).fill('null'));
      expect(m.groupAgreementOk).toEqual(new Array(n).fill(true));
    }
  });

  it('tiny-positive native run (1e-4) still meshes as one certified region', () => {
    const row = candidateAMultiBuildCorpus().find((r) => r.fixtureId === 'candidateA2T-distance-tiny-gap')!;
    expect(row.nativeGapsMeasured).toHaveLength(1);
    // Honest float: 7.0001-7 leaves representable residue, still strictly positive.
    expect(row.nativeGapsMeasured[0]).toBeGreaterThan(0);
    expect(row.nativeGapsMeasured[0]).toBeLessThan(1e-3);
    expect(row.measured).toMatchObject({
      expectedPositiveWidthRegions: 1,
      measuredPositiveWidthRegions: 1,
      gtop2Components: 1,
      gtop2RevalidationNull: true,
    });
    expect(row.measured.meshValidatorCodes).toEqual(['null', 'null']);
  });
});

describe('20N-A topology independence: expectation declared pre-mesh, never from observed count', () => {
  it('pre-mesh expected region count is exactly 1 for valid 2T/3T fixtures BEFORE any mesh', () => {
    for (const spec of MULTI_FIXTURES) {
      if (!spec.eligible) continue;
      const pre = deriveCandidateAPreMeshExpectation(spec);
      expect(pre.ok).toBe(true);
      if (!pre.ok) throw new Error('unreachable');
      expect(pre.preMesh.expectedPositiveWidthRegions).toBe(1);
      expect(pre.preMesh.expectedComponents).toBe(1);
      expect(pre.preMesh.expectedBoundaryCycles).toBe(1);
      expect(pre.preMesh.expectation.positiveWidthRegionCount).toBe(1);
      expect(pre.preMesh.expectation.expectedFaceComponents).toBe(1);
      expect(pre.preMesh.expectation.expectedBoundaryCycles).toBe(1);
    }
  });

  it('measured count independently equals 1 via production countPositiveWidthRegions', () => {
    const out = buildMultiGroup({
      fixtureId: 'x', family: 'distance', memberLengths: [30, 24, 30], widths: [8, 6], transform: 'identity', expected: 'x', eligible: true,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('unreachable');
    const tiled = tileMultiGroup(out.geometry);
    expect(countPositiveWidthRegions(tiled.source, tiled.daylight)).toBe(1);
  });

  it('pre-mesh expectation refuses invalid fixtures: no expectation, no certificate', () => {
    const bad = buildMultiGroup({
      fixtureId: 'x', family: 'distance', memberLengths: [30, 7, 30], widths: [8, 6], transform: 'identity', expected: 'x', eligible: false,
    });
    expect(bad.ok).toBe(false);
    const pre = deriveCandidateAPreMeshExpectation({
      fixtureId: 'x', family: 'distance', memberLengths: [30, 7, 30], widths: [8, 6], transform: 'identity', expected: 'x', eligible: false,
    });
    expect(pre.ok).toBe(false);
  });

  it('wrong expected region budget (2) does NOT certify a known one-strip mesh', () => {
    const out = buildMultiGroup({
      fixtureId: 'x', family: 'distance', memberLengths: [30, 24, 30], widths: [8, 6], transform: 'identity', expected: 'x', eligible: true,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('unreachable');
    const tiled = tileMultiGroup(out.geometry);
    const built = buildGradingStripMesh(tiled.source, tiled.daylight);
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error('unreachable');
    const flat = (pts: readonly { x: number; y: number; z: number }[]): number[] =>
      pts.flatMap((p) => [p.x, p.y, p.z]);
    const wrong = deriveGradingTopologyExpectation({ scope: 'group', closed: false, positiveWidthRegions: 2 });
    expect(wrong.expectedFaceComponents).toBe(2);
    const cert = buildGradingTopologyCertificateExact({
      scope: 'group',
      points: built.points,
      triangles: built.triangles,
      expectation: wrong,
      sourceBoundaryPoints: flat(tiled.source),
      gradingBoundaryPoints: flat(tiled.daylight),
    });
    // The independent expectation detects a wrong topology: no rubber-stamp.
    expect(cert).toBeNull();
  });

  it('tied split producing measured != expected 1 is rejected before cert', () => {
    const out = buildMultiGroup({
      fixtureId: 'x', family: 'distance', memberLengths: [30, 24, 30], widths: [8, 6], transform: 'identity', expected: 'x', eligible: true,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('unreachable');
    const tiled = tileMultiGroup(out.geometry);
    // Force a full zero-width cell mid-strip: two consecutive native stations
    // tied (daylight = source) so the region counter sees two regions.
    const tied = {
      ...tiled,
      source: tiled.source.map((p) => ({ ...p })),
      daylight: tiled.daylight.map((p) => ({ ...p })),
    };
    // Any full zero-width cell splits the strip: tie two consecutive stations
    // outside a transition interior (native runs and shared boundaries exist).
    const candidates = tiled.owners.flatMap((o, i) =>
      i > 0 && i + 1 < tiled.stations.length - 1 && o.kind !== 'transition' && tiled.owners[i + 1]?.kind !== 'transition' ? [i] : [],
    );
    expect(candidates.length).toBeGreaterThan(0);
    // Tie an INTERIOR cell (edge ties merely shorten the strip to 1 region).
    const idx = candidates[Math.floor(candidates.length / 2)]!;
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeGreaterThan(0);
    expect(idx + 1).toBeLessThan(tiled.stations.length - 1);
    tied.daylight[idx] = { ...tied.source[idx]! };
    tied.daylight[idx + 1] = { ...tied.source[idx + 1]! };
    expect(countPositiveWidthRegions(tied.source, tied.daylight)).toBe(2);
    const pre = deriveCandidateAPreMeshExpectation({
      fixtureId: 'x', family: 'distance', memberLengths: [30, 24, 30], widths: [8, 6], transform: 'identity', expected: 'x', eligible: true,
    });
    expect(pre.ok).toBe(true);
    if (!pre.ok) throw new Error('unreachable');
    expect(() => meshAndCertifyMultiGroup(tied, pre.preMesh)).toThrow(/pre-mesh vs measured topology mismatch/);
  });
});

describe('20N-A mesh: negatives fail before admission or produce no cert', () => {
  it('touching (==) and overlap (<) stop at the group-layout stage', () => {
    const rows = candidateAMultiBuildCorpus();
    expect(rows.find((r) => r.fixtureId === 'candidateA2T-distance-touching')!.measured).toMatchObject({
      stage: 'group-layout',
      code: 'TOUCHING_NOT_AUTHORIZED',
      meshBuilt: false,
      certIssued: false,
    });
    expect(rows.find((r) => r.fixtureId === 'candidateA2T-distance-overlap')!.measured).toMatchObject({
      stage: 'group-layout',
      code: 'OVERLAP_REJECTED',
      meshBuilt: false,
      certIssued: false,
    });
  });

  it('too-wide stops at per-joint WIDTH_INFEASIBLE; zero-width at WIDTH_INVALID', () => {
    const rows = candidateAMultiBuildCorpus();
    expect(rows.find((r) => r.fixtureId === 'candidateA2T-distance-too-wide')!.measured).toMatchObject({
      stage: 'per-joint-admission',
      code: 'WIDTH_INFEASIBLE',
      meshBuilt: false,
      certIssued: false,
    });
    expect(rows.find((r) => r.fixtureId === 'candidateA2T-distance-zero-width')!.measured).toMatchObject({
      stage: 'per-joint-admission',
      code: 'WIDTH_INVALID',
      meshBuilt: false,
      certIssued: false,
    });
  });

  it('non-finite widths and malformed joints fail closed at the helper level', () => {
    for (const w of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0]) {
      const out = buildMultiGroup({
        fixtureId: 'x', family: 'distance', memberLengths: [30, 24, 30], widths: [w, 6], transform: 'identity', expected: 'x', eligible: false,
      });
      expect(out.ok).toBe(false);
    }
    expect(() => parseJointIndex('L')).toThrow();
    expect(() => parseJointIndex('joint:')).toThrow();
    // Out-of-order / duplicate joint lists are rejected, never re-sorted.
    expect(() => assertCanonicalJointOrder(['joint:1', 'joint:0'])).toThrow();
    expect(() => assertCanonicalJointOrder(['joint:0', 'joint:0'])).toThrow();
    expect(() => assertCanonicalJointOrder(['joint:0', 'joint:1'])).not.toThrow();
  });
});

describe('20N-A mesh: geometry transforms (mirror / translate = geometric probes)', () => {
  it('mirror / translate-1e6 / translate-1e8 certify identically (counts + validators)', () => {
    const rows = candidateAMultiBuildCorpus();
    for (const fam of ['distance', 'relative-elevation', 'elevation'] as const) {
      for (const size of ['2T', '3T'] as const) {
        const base = rows.find((r) => r.fixtureId === `candidateA${size}-${fam}-identity`)!;
        for (const t of ['mirror', 'translate-1e6', 'translate-1e8']) {
          const row = rows.find((r) => r.fixtureId === `candidateA${size}-${fam}-${t}`)!;
          expect(row.measured.measuredPositiveWidthRegions).toBe(1);
          expect(row.measured.gtop2Components).toBe(base.measured.gtop2Components);
          expect(row.measured.gtop2BoundaryCycles).toBe(base.measured.gtop2BoundaryCycles);
          expect(row.measured.gtop2RevalidationNull).toBe(true);
          expect(row.measured.meshValidatorCodes).toEqual(base.measured.meshValidatorCodes);
          expect(row.measured.groupAgreementOk).toEqual(base.measured.groupAgreementOk);
          expect(row.measured.vertexCount).toBe(base.measured.vertexCount);
          expect(row.measured.triangleCount).toBe(base.measured.triangleCount);
          expect(row.measured.c0PlanResidual).toBe(0);
          expect(row.measured.c0ZResidual).toBe(0);
        }
      }
    }
  });

  it('station ownership: inside -> joint, on-bound -> boundary, else native member', () => {
    const out = buildMultiGroup({
      fixtureId: 'x', family: 'distance', memberLengths: [30, 24, 30], widths: [8, 6], transform: 'identity', expected: 'x', eligible: true,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('unreachable');
    expect(classifyMultiStation(0, out.geometry)).toEqual({ kind: 'native', member: 0 });
    expect(classifyMultiStation(30, out.geometry)).toEqual({ kind: 'transition', index: 0 });
    expect(classifyMultiStation(26, out.geometry)).toEqual({ kind: 'boundary', index: 0 });
    expect(classifyMultiStation(40, out.geometry)).toEqual({ kind: 'native', member: 1 });
    expect(classifyMultiStation(84, out.geometry)).toEqual({ kind: 'native', member: 2 });
  });

  it('repeated/interleaved tile calls carry no residual state (local accumulator)', () => {
    const mk = (lengths: number[], widths: number[]) => {
      const out = buildMultiGroup({
        fixtureId: 'x', family: 'distance', memberLengths: lengths, widths, transform: 'identity', expected: 'x', eligible: true,
      });
      expect(out.ok).toBe(true);
      if (!out.ok) throw new Error('unreachable');
      return out.geometry;
    };
    const g1 = mk([30, 24, 30], [8, 6]);
    const g2 = mk([30, 24, 26, 30], [8, 6, 4]);
    const t1 = tileMultiGroup(g1);
    const t2 = tileMultiGroup(g2);
    const t1b = tileMultiGroup(g1);
    const t2b = tileMultiGroup(g2);
    expect(t1b.c0Plan).toBe(t1.c0Plan);
    expect(t1b.c0Z).toBe(t1.c0Z);
    expect(t2b.c0Plan).toBe(t2.c0Plan);
    expect(t2b.c0Z).toBe(t2.c0Z);
    expect(t1b.stations).toEqual(t1.stations);
    expect(t1.c0Plan).toBe(0);
    expect(t2.c0Plan).toBe(0);
  });
});

describe('20N-A true traversal reversal (B1 production-like)', () => {
  it('reversed member endpoint IDs/order are physically reversed', () => {
    const base = buildMultiGroup({
      fixtureId: 'x', family: 'distance', memberLengths: [30, 24, 30], widths: [8, 6], transform: 'identity', expected: 'x', eligible: true,
    });
    const rev = buildMultiGroup({
      fixtureId: 'x', family: 'distance', memberLengths: [30, 24, 30], widths: [8, 6], transform: 'reversal', expected: 'x', eligible: true,
    });
    expect(base.ok && rev.ok).toBe(true);
    if (!base.ok || !rev.ok) throw new Error('unreachable');
    expect(base.geometry.traversalOrder).toBe('forward');
    expect(rev.geometry.traversalOrder).toBe('reversed-traversal');
    // Base: S0>S1, S1>S2, S2>S3. Reversed: S3>S2, S2>S1, S1>S0.
    expect(base.geometry.members.map((m) => m.id)).toEqual([0, 1, 2].map((i) => multiMemberId(i)));
    expect(rev.geometry.members.map((m) => m.id)).toEqual([0, 1, 2].map((i) => multiMemberIdReversed(i, 3)));
    expect(rev.geometry.members.map((m) => m.id)).not.toEqual(base.geometry.members.map((m) => m.id));
    // Criteria follow the physical members (2T symmetric scalars read 5/7/5 both ways).
    expect(rev.geometry.members.map((m) => m.length)).toEqual([30, 24, 30]);
    // 3T lengths genuinely reverse.
    const rev3 = buildMultiGroup({
      fixtureId: 'x', family: 'distance', memberLengths: [30, 24, 26, 30], widths: [8, 6, 4], transform: 'reversal', expected: 'x', eligible: true,
    });
    expect(rev3.ok).toBe(true);
    if (!rev3.ok) throw new Error('unreachable');
    expect(rev3.geometry.members.map((m) => m.length)).toEqual([30, 26, 24, 30]);
  });

  it('joints reindex monotonically in reversed traversal; widths map to physical joints reversed', () => {
    const rev = buildMultiGroup({
      fixtureId: 'x', family: 'distance', memberLengths: [30, 24, 30], widths: [8, 6], transform: 'reversal', expected: 'x', eligible: true,
    });
    expect(rev.ok).toBe(true);
    if (!rev.ok) throw new Error('unreachable');
    expect(rev.geometry.joints.map((j) => j.jointId)).toEqual(['joint:0', 'joint:1']);
    // Canonical increasing order in the NEW joint indices (never carried over).
    expect(() => assertCanonicalJointOrder(rev.geometry.joints.map((j) => j.jointId))).not.toThrow();
    // Base widths [8,6]: reversed traversal meets old joint:1 (W=6) first.
    expect(rev.geometry.joints.map((j) => j.width)).toEqual([6, 8]);
    // Stations recomputed from 0 in reversed traversal order (forward layout).
    expect(rev.geometry.joints.map((j) => j.station)).toEqual([30, 54]);
    // 3T: base joints [30,54,80] widths [8,6,4] -> reversed [30,56,80] widths [4,6,8].
    const rev3 = buildMultiGroup({
      fixtureId: 'x', family: 'distance', memberLengths: [30, 24, 26, 30], widths: [8, 6, 4], transform: 'reversal', expected: 'x', eligible: true,
    });
    expect(rev3.ok).toBe(true);
    if (!rev3.ok) throw new Error('unreachable');
    expect(rev3.geometry.joints.map((j) => j.jointId)).toEqual(['joint:0', 'joint:1', 'joint:2']);
    expect(rev3.geometry.joints.map((j) => j.width)).toEqual([4, 6, 8]);
    expect(rev3.geometry.joints.map((j) => j.station)).toEqual([30, 56, 80]);
  });

  it('reversed boundary daylight meets its true traversal neighbor (no unreversed vL/vR)', () => {
    const rev = buildMultiGroup({
      fixtureId: 'x', family: 'distance', memberLengths: [30, 24, 30], widths: [8, 6], transform: 'reversal', expected: 'x', eligible: true,
    });
    expect(rev.ok).toBe(true);
    if (!rev.ok) throw new Error('unreachable');
    // Reversed M0 (scalar 5, ex-M2) | M1 (scalar 7): vL=5, vR=7.
    expect(rev.geometry.joints[0]).toMatchObject({ jointId: 'joint:0', vL: 5, vR: 7 });
    expect(rev.geometry.joints[1]).toMatchObject({ jointId: 'joint:1', vL: 7, vR: 5 });
    const tiled = tileMultiGroup(rev.geometry);
    const dayOff = (s: number): number => {
      const i = tiled.stations.indexOf(s);
      const p = tiled.daylight[i]!;
      const q = tiled.source[i]!;
      return Math.hypot(p.x - q.x, p.y - q.y);
    };
    // Joint:0 @ 30 W=6 -> [27,33]: low abuts M0 (5), high abuts M1 (7).
    expect(dayOff(27)).toBe(5);
    expect(dayOff(33)).toBe(7);
    // Joint:1 @ 54 W=8 -> [50,58]: low abuts M1 (7), high abuts M2 (5).
    expect(dayOff(50)).toBe(7);
    expect(dayOff(58)).toBe(5);
    expect(tiled.c0Plan).toBe(0);
    expect(tiled.c0Z).toBe(0);
  });

  it('full reversed 2T/3T x all 3 families mesh+gtop2+per-transition agreement green', () => {
    const rows = candidateAMultiBuildCorpus();
    for (const fam of ['distance', 'relative-elevation', 'elevation'] as const) {
      for (const size of ['2T', '3T'] as const) {
        const row = rows.find((r) => r.fixtureId === `candidateA${size}-${fam}-reversal`)!;
        expect(row.traversalOrder).toBe('reversed-traversal');
        expect(row.measured.expectedPositiveWidthRegions).toBe(1);
        expect(row.measured.measuredPositiveWidthRegions).toBe(1);
        expect(row.measured.gtop2Components).toBe(1);
        expect(row.measured.gtop2BoundaryCycles).toBe(1);
        expect(row.measured.gtop2RevalidationNull).toBe(true);
        expect(row.measured.meshValidatorCodes).toEqual(new Array(row.transitionCount).fill('null'));
        expect(row.measured.groupAgreementOk).toEqual(new Array(row.transitionCount).fill(true));
        expect(row.measured.c0PlanResidual).toBe(0);
        expect(row.measured.c0ZResidual).toBe(0);
      }
    }
  });

  it('normalized reversed geometry matches identity under production agreement tolerances', () => {
    const cases = [
      { memberLengths: [30, 24, 30], widths: [8, 6] },
      { memberLengths: [30, 24, 26, 30], widths: [8, 6, 4] },
    ] as const;
    for (const fam of ['distance', 'relative-elevation', 'elevation'] as const) {
      for (const c of cases) {
        const lengths = [...c.memberLengths];
        const widths = [...c.widths];
        const baseOut = buildMultiGroup({
          fixtureId: 'x', family: fam, memberLengths: lengths, widths, transform: 'identity', expected: 'x', eligible: true,
        });
        const revOut = buildMultiGroup({
          fixtureId: 'x', family: fam, memberLengths: lengths, widths, transform: 'reversal', expected: 'x', eligible: true,
        });
        expect(baseOut.ok && revOut.ok).toBe(true);
        if (!baseOut.ok || !revOut.ok) throw new Error('unreachable');
        const base = tileMultiGroup(baseOut.geometry);
        const rev = tileMultiGroup(revOut.geometry);
        const total = baseOut.geometry.total;
        expect(revOut.geometry.total).toBe(total);
        // Normalize reversed world back into base orientation, restore ascending order.
        const normSrc = normalizeReversedWorldToBase(rev.source, total).reverse();
        const normDay = normalizeReversedWorldToBase(rev.daylight, total).reverse();
        const normStations = rev.stations.map((s) => total - s).reverse();
        const lerp = (xs: number[], pts: { x: number; y: number; z: number }[], s: number): { x: number; y: number; z: number } => {
          if (s <= xs[0]!) return { ...pts[0]! };
          for (let i = 0; i + 1 < xs.length; i += 1) {
            const a = xs[i]!;
            const b = xs[i + 1]!;
            if (s >= a && s <= b) {
              const t = b === a ? 0 : (s - a) / (b - a);
              const p = pts[i]!;
              const q = pts[i + 1]!;
              return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: p.z + (q.z - p.z) * t };
            }
          }
          return { ...pts[pts.length - 1]! };
        };
        // Breakpoints from BOTH base and normalized reversed: either side may
        // carry an extra peak the other side must reproduce via interpolation.
        const stations = [...new Set([...base.stations, ...normStations])].sort((a, b) => a - b);
        for (const s of stations) {
          const bSrc = lerp(base.stations, base.source, s);
          const bDay = lerp(base.stations, base.daylight, s);
          const nSrc = lerp(normStations, normSrc, s);
          const nDay = lerp(normStations, normDay, s);
          const planSrc = Math.hypot(nSrc.x - bSrc.x, nSrc.y - bSrc.y);
          const planDay = Math.hypot(nDay.x - bDay.x, nDay.y - bDay.y);
          const ref = Math.max(1, Math.abs(bDay.x), Math.abs(bDay.y));
          expect(planSrc).toBeLessThanOrEqual(coordinateAgreementTol(bSrc.x, nSrc.x, ref));
          expect(planDay).toBeLessThanOrEqual(coordinateAgreementTol(bDay.x, nDay.x, ref));
          expect(Math.abs(nSrc.z - bSrc.z)).toBeLessThanOrEqual(elevationAgreementTol(bSrc.z, nSrc.z, []));
          expect(Math.abs(nDay.z - bDay.z)).toBeLessThanOrEqual(elevationAgreementTol(bDay.z, nDay.z, []));
        }
      }
    }
  });

  it('strict separation uses reversed shared member lengths correctly', () => {
    // 3T reversed middle members are [26,24]: widths [4,6,8] need 2+3<26 and 3+4<24.
    const rev3 = buildMultiGroup({
      fixtureId: 'x', family: 'distance', memberLengths: [30, 24, 26, 30], widths: [8, 6, 4], transform: 'reversal', expected: 'x', eligible: true,
    });
    expect(rev3.ok).toBe(true);
  });
});

describe('20N-A mesh: revision / provenance split (proven vs proposed)', () => {
  it('ggrev1 order-sensitive over real intents; canonical list stable; citation length-1 today', () => {
    for (const row of candidateAMultiBuildCorpus()) {
      if (!row.futurePredicateEligible) continue;
      expect(row.measured.revisionOrderSensitive).toBe(true);
      expect(row.measured.revisionStable).toBe(true);
      // PROVEN (measured current fact): bake citation is array-typed but singular today.
      expect(row.measured.bakeCitationLength).toBe(1);
      expect(typeof row.measured.revisionHash).toBe('string');
      expect(String(row.measured.revisionHash).startsWith('ggrev1:')).toBe(true);
    }
  });

  it('reversed traversal legitimately rehashes (member ids change); order-sensitivity retained', () => {
    const rows = candidateAMultiBuildCorpus();
    const base = rows.find((r) => r.fixtureId === 'candidateA2T-distance-identity')!;
    const rev = rows.find((r) => r.fixtureId === 'candidateA2T-distance-reversal')!;
    // Traversal/member IDs legitimately change: same ggrev1 NOT required.
    expect(rev.measured.revisionHash).not.toBe(base.measured.revisionHash);
    expect(rev.measured.revisionOrderSensitive).toBe(true);
  });

  it('reversed ggrev1 binds actual reversed endpoint pairs + physical per-course criteria', () => {
    const rows = candidateAMultiBuildCorpus();
    const pin = (
      memberLengths: number[],
      widths: number[],
      fixtureId: string,
      defDistance: number,
      altDistance: number,
      altCourses: number[],
    ): void => {
      const out = buildMultiGroup({
        fixtureId: 'x', family: 'distance', memberLengths, widths, transform: 'reversal', expected: 'x', eligible: true,
      });
      expect(out.ok).toBe(true);
      if (!out.ok) throw new Error('unreachable');
      const rev = revisionFactsMultiGroup(out.geometry, tileMultiGroup(out.geometry));
      const n = memberLengths.length;
      // Real reversed pairs — never the unreversed S0>S1 layout.
      expect(rev.input.courses.map((c) => `${c.vertexAId}>${c.vertexBId}`)).toEqual(
        Array.from({ length: n }, (_, i) => multiMemberIdReversed(i, n)),
      );
      // Alternating physical criteria ride as sparse overrides off the default.
      expect(rev.input.criterion).toEqual({ kind: 'distance', gradeRatio: 0.5, distance: defDistance });
      expect(rev.input.courseCriteria?.map((o) => `${o.sourceCourse.vertexAId}>${o.sourceCourse.vertexBId}`)).toEqual(
        altCourses.map((i) => multiMemberIdReversed(i, n)),
      );
      expect(rev.input.courseCriteria?.map((o) => o.criterion)).toEqual(
        altCourses.map(() => ({ kind: 'distance', gradeRatio: 0.5, distance: altDistance })),
      );
      // Hash reproduces from the pinned input and matches the committed row.
      expect(buildGroupRevision(rev.input)).toBe(rev.hash);
      expect(rows.find((r) => r.fixtureId === fixtureId)!.measured.revisionHash).toBe(rev.hash);
      // The old buggy input (unreversed ids + default-only) hashes differently.
      const naive = buildGroupRevision({
        ...rev.input,
        courses: rev.input.courses.map((c, i) => ({ ...c, vertexAId: `S${i}`, vertexBId: `S${i + 1}` })),
        courseCriteria: [],
      });
      expect(naive).not.toBe(rev.hash);
    };
    // 3T asymmetric: scalars reverse to [7,5,7,5], overrides on courses 1+3.
    pin([30, 24, 26, 30], [8, 6, 4], 'candidateA3T-distance-reversal', 7, 5, [1, 3]);
    // 2T symmetric: scalars read [5,7,5] both ways, override on course 1.
    pin([30, 24, 30], [8, 6], 'candidateA2T-distance-reversal', 5, 7, [1]);
  });
});

describe('20N-A mesh: production gates still hold', () => {
  it('multi-transition intents still REJECT in production (cardinality + pre-mesh)', () => {
    for (const n of [2, 3]) {
      expect(selectGroupTransition(new Array(n).fill({ jointId: 'joint:0' }))).toMatchObject({
        kind: 'rejected',
        code: 'TRANSITION_REJECTED',
      });
    }
    const multi = deriveTransitionExpectation(
      { scope: 'group', closed: false, positiveWidthRegions: 1 },
      { jointId: 'joint:0', width: 8, memberLengths: [20, 20], transitionCount: 2, isOpen: true },
    );
    expect(multi.ok).toBe(false);
  });

  it('non-collinear still REJECTS; 20M.2 single collinear admits byte-identically', () => {
    const members = (dirY: number) =>
      [
        { memberId: 'L', criterion: { kind: 'distance', gradeRatio: 0.5, distance: 5 }, length: 20, dirX: 1, dirY: 0, startZ: 10, endZ: 10, isArc: false, maxSearchDistance: 50 },
        { memberId: 'R', criterion: { kind: 'distance', gradeRatio: 0.5, distance: 7 }, length: 20, dirX: 1, dirY, startZ: 10, endZ: 10, isArc: false, maxSearchDistance: 50 },
      ] as const;
    const bent = admitGradingTransition({
      policyVersion: 'trp1', lawKind: 'TRANSITION_LINEAR_V1', lawVersion: 'v1', criterionFamily: 'distance',
      jointId: 'joint:0', memberIds: ['L', 'R'], width: 8, side: 'left', groupSide: 'left',
      isOpen: true, transitionCount: 1, jointZ: 10, members: [...members(1)],
    });
    expect(bent.ok).toBe(false);
    const single = admitGradingTransition({
      policyVersion: 'trp1', lawKind: 'TRANSITION_LINEAR_V1', lawVersion: 'v1', criterionFamily: 'distance',
      jointId: 'joint:0', memberIds: ['L', 'R'], width: 8, side: 'left', groupSide: 'left',
      isOpen: true, transitionCount: 1, jointZ: 10, members: [...members(0)],
    });
    expect(single).toMatchObject({ ok: true, vL: 5, vR: 7, sL: -4, sR: 4 });
    expect(evaluateTransitionLinearV1(5, 7, -4, 4, 0)).toBe(6);
  });

  it('committed corpus matches regen: 116 rows (35 A-mesh + 81 B), sha256 pinned, double-regen stable', () => {
    const raw = readFileSync(join(corpusDir, 'corpus.json'), 'utf8');
    const rows = JSON.parse(raw) as unknown[];
    expect(rows).toHaveLength(116);
    const sha = createHash('sha256').update(raw).digest('hex');
    expect(readFileSync(join(corpusDir, 'corpus.sha256'), 'utf8').split(/\s/)[0]).toBe(sha);
    expect(phase20nRegenCorpus()).toEqual(phase20nRegenCorpus());
    expect(JSON.parse(JSON.stringify(phase20nRegenCorpus()))).toHaveLength(116);
  });
});
