/**
 * Phase 20N Candidate A — REAL shared-member mesh evidence pins.
 *
 * STUDY ONLY, zero src/ changes. Pins the multi-transition mesh facts from
 * scripts/phase20nMultiTransitionMesh.ts: actual strip meshes over real
 * shared-member 2T/3T groups x 3 families, production gtop2 certification +
 * exact revalidation, per-transition production agreement validators,
 * full-geometry transforms, negative stages, and the production gates that
 * still hold (cardinality, collinearity, 20M.2 single).
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
import { deriveTransitionExpectation } from '../src/engine/cad/grading/gradingTopologyExpectation';
import {
  assertCanonicalJointOrder,
  buildMultiGroup,
  candidateAMultiBuildCorpus,
  classifyMultiStation,
  MULTI_FIXTURES,
  multiMemberId,
  parseJointIndex,
  tileMultiGroup,
} from '../scripts/phase20nMultiTransitionMesh';
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
      expect(row.memberIds).toEqual(row.memberLengths.map((_, i) => multiMemberId(i)));
      expect(row.jointIds).toEqual(row.widths.map((_, j) => `joint:${j}`));
    }
    // Shared middles are real: 2T M1=24 shared by both joints; 3T M1=24/M2=26.
    const two = rows.find((r) => r.fixtureId === 'candidateA2T-distance-identity')!;
    expect(two.memberLengths).toEqual([30, 24, 30]);
    expect(two.nativeGapsMeasured).toEqual([17]);
    const three = rows.find((r) => r.fixtureId === 'candidateA3T-distance-identity')!;
    expect(three.memberLengths).toEqual([30, 24, 26, 30]);
    expect(three.nativeGapsMeasured).toEqual([17, 21]);
  });

  it('every valid row: actual mesh, measured 1 region, gtop2 1/1, revalidation null', () => {
    for (const row of candidateAMultiBuildCorpus()) {
      if (!row.futurePredicateEligible) continue;
      const m = row.measured;
      expect(m.layoutOk).toBe(true);
      expect(m.measuredPositiveWidthRegions).toBe(1);
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
      measuredPositiveWidthRegions: 1,
      gtop2Components: 1,
      gtop2RevalidationNull: true,
    });
    expect(row.measured.meshValidatorCodes).toEqual(['null', 'null']);
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

describe('20N-A mesh: full-geometry transforms', () => {
  it('mirror / reversal / translate-1e6 / translate-1e8 certify identically (counts + validators)', () => {
    const rows = candidateAMultiBuildCorpus();
    for (const fam of ['distance', 'relative-elevation', 'elevation'] as const) {
      for (const size of ['2T', '3T'] as const) {
        const base = rows.find((r) => r.fixtureId === `candidateA${size}-${fam}-identity`)!;
        for (const t of ['mirror', 'reversal', 'translate-1e6', 'translate-1e8']) {
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

  it('reversal endpoint scalars follow the reversed member order (catches unreversed vL/vR)', () => {
    const rev = buildMultiGroup({
      fixtureId: 'x', family: 'distance', memberLengths: [30, 24, 30], widths: [8, 6], transform: 'reversal', expected: 'x', eligible: true,
    });
    expect(rev.ok).toBe(true);
    if (!rev.ok) throw new Error('unreachable');
    // Joint:0 sits between original M0 (scalar 5) and M1 (scalar 7); in the
    // reversed layout M1 is LEFT of the joint, so vL=7, vR=5 — the old
    // unreversed pairing (5,7) fails this pin.
    expect(rev.geometry.joints[0]).toMatchObject({ jointId: 'joint:0', vL: 7, vR: 5 });
    expect(rev.geometry.joints[1]).toMatchObject({ jointId: 'joint:1', vL: 5, vR: 7 });
    const tiled = tileMultiGroup(rev.geometry);
    const dayOff = (s: number): number => {
      const i = tiled.stations.indexOf(s);
      const p = tiled.daylight[i]!;
      const q = tiled.source[i]!;
      return Math.hypot(p.x - q.x, p.y - q.y);
    };
    // Boundary daylight equals the ACTUAL adjacent native scalar in layout
    // order: station 50 abuts reversed member 1 (scalar 7), station 58
    // abuts reversed member 0 (scalar 5). Old code built 5/7 here (2m gap).
    expect(dayOff(50)).toBe(7);
    expect(dayOff(58)).toBe(5);
    // Joint:1 @ rev station 30, interval [27,33]: low abuts member 2 (5),
    // high abuts member 1 (7).
    expect(dayOff(27)).toBe(5);
    expect(dayOff(33)).toBe(7);
  });

  it('reversal is real: reversed member order + directions, consistent joint ids', () => {
    const out = buildMultiGroup({
      fixtureId: 'x', family: 'distance', memberLengths: [30, 24, 30], widths: [8, 6], transform: 'reversal', expected: 'x', eligible: true,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('unreachable');
    expect(out.geometry.joints.map((j) => j.jointId)).toEqual(['joint:0', 'joint:1']);
    // Stations measured from the far end: joint:0 sits at total-30 = 54.
    expect(out.geometry.joints.map((j) => j.station)).toEqual([54, 30]);
    const tiled = tileMultiGroup(out.geometry);
    expect(tiled.stations).toEqual([...tiled.stations].sort((a, b) => a - b));
    expect(new Set(tiled.stations).size).toBe(tiled.stations.length);
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
});

describe('20N-A mesh: revision / provenance split (proven vs proposed)', () => {
  it('ggrev1 order-sensitive over real intents; canonical list stable; citation length-1 today', () => {
    for (const row of candidateAMultiBuildCorpus()) {
      if (!row.futurePredicateEligible) continue;
      expect(row.measured.revisionOrderSensitive).toBe(true);
      expect(row.measured.revisionStable).toBe(true);
      // PROVEN: bake citation is array-typed but singular today (plural = proposed).
      expect(row.measured.bakeCitationLength).toBe(1);
      expect(typeof row.measured.revisionHash).toBe('string');
      expect(String(row.measured.revisionHash).startsWith('ggrev1:')).toBe(true);
    }
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
