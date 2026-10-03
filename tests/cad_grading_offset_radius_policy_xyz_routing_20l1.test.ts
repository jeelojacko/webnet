/**
 * Phase 20L.1 Task C — FULL XYZ TIE CONTINUITY pins (study only, zero src/).
 *
 * §16 items pinned: (1) allProven truthfulness, (2) R-hook explicit,
 * (3) B flat-only rejection (sloped counterexample + 11 mm provenance),
 * (4) C flat-only rejection, (5) E flat-only rejection + 1e-13 regression,
 * (6) F rejection, (7) G rejection,
 * (8) H rejection, (9) local-vs-active distinction, (10) no splice built,
 * (11) XYZ mesh finite/connected/clean, (12) Z continuity, (13) curved-closed
 * scoping note, (14) 20L local stability, (15) E1 unchanged, (16) A/D controls
 * admit, (17) tie-at-join law + search-neighborhood restatement pins,
 * (18) source-joint step pins (0-vs-2 repro + fixture I).
 *
 * Flat-only law (Task H fix): the gate enforces startZ===endZ exactly (===,
 * no tolerance) ahead of every admission — 1e-13 slopes reject identically
 * to gross slopes (REJECT_SLOPED_SOURCE). The T−J check is structural
 * search-neighborhood locality, NOT numerical agreement.
 *
 * Route decisions belong to the parallel routing worker; these tests pin the
 * `xyzRunTieOk` gate and the fixture outcomes, never route fields.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { extentJVWithin } from '../scripts/phase20l1EffectiveCriterion';
import { buildCorpus, xyzFixtureTieInput, xyzRunTieOk, type XyzTieReason } from '../scripts/phase20l1XyzTies';

interface Corner {
  index: number; localP0: boolean; planReasonIn: string; planReasonOut: string;
  d: number | null; dIn: number | null; dOut: number | null;
  joinXY: { x: number; y: number } | null; tieXYZ: { x: number; y: number; z: number } | null;
  zIn: number | null; zOut: number | null; joinZ: number | null; tieJoinDist: number | null;
  tiePlanFinite: boolean; zAgree: boolean;
  reason: XyzTieReason; active: boolean; detail: string;
}
interface Mesh {
  built: boolean; exact: boolean; finite: boolean; components: number; edgeComponents: number;
  boundaryEdges: number; daylightContinuity: boolean; noInteriorOverlap: boolean;
  meshArea: number; sourceZContinuous: boolean; daylightZTieOk: boolean; detail: string;
}
interface Fixture {
  id: string; family: string; expected: string; expectedReason: string; corners: Corner[];
  gate: { ok: boolean; reason: XyzTieReason; activeCorners: number[] }; mesh: Mesh;
}
interface Corpus {
  contract: string; provenBehavior: string; reasonCodes: string[];
  rHook: { point: string; gate: string; routeDecision: string };
  scope: { curvedClosed: string }; noTransitionGeometry: boolean; extentRule: string;
  fixtures: Fixture[]; digest: string;
}

const artifact = (): Corpus => JSON.parse(readFileSync(
  join(dirname(new URL(import.meta.url).pathname), '..', 'docs', 'evidence', 'phase20l1', 'xyz-corpus.json'),
  'utf8',
));
const byId = (c: Corpus, id: string): Fixture => c.fixtures.find((f) => f.id === id)!;
const ADMITS = ['A', 'D'];

describe('20L.1 XYZ ties: §16.1 allProven truthfulness', () => {
  it('every admitted corner carries a proven plan law; no unproven admission', () => {
    const c = artifact();
    expect(c.provenBehavior).toContain('analytically-proven');
    const proven = new Set(['DISTANCE', 'RELATIVE_ELEVATION', 'ELEVATION_FLAT_SOURCE']);
    for (const f of c.fixtures) {
      for (const k of f.corners) {
        if (f.expected === 'ADMIT') {
          expect(proven.has(k.planReasonIn)).toBe(true);
          expect(proven.has(k.planReasonOut)).toBe(true);
        }
        // A rejected corner must never claim an active tie.
        if (k.reason !== 'Z_TIE_OK') expect(k.active).toBe(false);
      }
    }
  });
});

describe('20L.1 XYZ ties: §16.2 R-hook explicit', () => {
  it('documents the CornerBuild R-hook with the route decision owned downstream', () => {
    const c = artifact();
    expect(c.rHook.gate).toBe('xyzRunTieOk');
    expect(c.rHook.point).toContain('CornerBuild');
    expect(c.rHook.routeDecision).toContain('parallel routing worker');
    // Route fields are deliberately NOT part of this study's artifact.
    expect(Object.keys(c)).not.toContain('route');
    expect(Object.keys(c)).not.toContain('routing');
  });
});

describe('20L.1 XYZ ties: §16.3–5 B/C/E flat-only rejections (sloped counterexample)', () => {
  it('B sloped Distance rejects REJECT_SLOPED_SOURCE with 11 mm join-law provenance', () => {
    const b = byId(artifact(), 'B');
    expect(b.gate.ok).toBe(false);
    expect(b.gate.reason).toBe('REJECT_SLOPED_SOURCE');
    expect(b.corners.map((k) => k.reason)).toEqual(['REJECT_SLOPED_SOURCE', 'REJECT_SLOPED_SOURCE']);
    const k0 = b.corners[0]!;
    // The built node (admitted offset join) vs the analytic tie provenance.
    expect(k0.joinXY).toEqual({ x: -4.772255751, y: 5 });
    expect(k0.tieXYZ).toEqual({ x: -5, y: 5, z: 5.25 });
    expect(k0.tieJoinDist).toBeCloseTo(0.227744249, 9);
    // Join laws still reported: 11 mm disagreement the flat predicate refuses to bless.
    expect(k0.zIn).toBeCloseTo(5.238612788, 9);
    expect(k0.zOut).toBe(5.25);
    expect(k0.zAgree).toBe(false);
    expect(k0.joinZ).toBeNull();
    expect(k0.active).toBe(false);
    expect(k0.localP0).toBe(true); // plan still admits — the rejector is the flatness predicate
    expect(b.mesh.exact).toBe(false);
    const live = xyzRunTieOk(xyzFixtureTieInput('B', 0));
    expect(live.reason).toBe('REJECT_SLOPED_SOURCE');
  });
  it('C sloped Relative-elevation rejects identically (same predicate, same reason)', () => {
    const c = byId(artifact(), 'C');
    expect(c.gate.ok).toBe(false);
    expect(c.corners.map((k) => k.reason)).toEqual(['REJECT_SLOPED_SOURCE', 'REJECT_SLOPED_SOURCE']);
    expect(c.corners.map((k) => k.tieXYZ!.z)).toEqual([5.25, 8.676990817]);
    expect(c.corners.every((k) => !k.zAgree && !k.active)).toBe(true);
    expect(c.mesh.exact).toBe(false);
  });
  it('E mixed Distance↔RelEl on slope rejects: same d cannot substitute for flat members', () => {
    const e = byId(artifact(), 'E');
    expect(e.gate.ok).toBe(false);
    expect(e.corners.map((k) => [k.dIn, k.dOut])).toEqual([[5, 5], [5, 5]]);
    expect(e.corners.map((k) => [k.zIn, k.zOut])).toEqual([[5.238612788, 5.25], [8.676990817, 8.688378029]]);
    expect(e.corners.every((k) => k.reason === 'REJECT_SLOPED_SOURCE')).toBe(true);
    // Non-identical criterion objects across the mixed families.
    const live = xyzRunTieOk(xyzFixtureTieInput('E', 0));
    expect(live.ok).toBe(false);
    expect(xyzFixtureTieInput('E', 0).incoming.criterion.kind).toBe('distance');
    expect(xyzFixtureTieInput('E', 0).outgoing.criterion.kind).toBe('relative-elevation');
  });
  it('reviewer 1e-13-slope regression: micro slopes reject identically to gross slopes', () => {
    // Fixture-B variant with both nonzero slopes scaled 1e-13: the old gate
    // returned ok:true Z_TIE_OK (zeroDelta leniency); the flat predicate rejects.
    const base = xyzFixtureTieInput('B', 0);
    const live = xyzRunTieOk({
      ...base,
      incoming: { ...base.incoming, startZ: 2e-13, endZ: 0 },
      outgoing: { ...base.outgoing, startZ: 0, endZ: 3.927e-13 },
    });
    expect(live.ok).toBe(false);
    expect(live.reason).toBe('REJECT_SLOPED_SOURCE');
    // Gross-slope parity: identical reason, not just identical rejection.
    expect(xyzRunTieOk(base).reason).toBe('REJECT_SLOPED_SOURCE');
  });
});

describe('20L.1 XYZ ties: §16.6–8 F/G/H rejections', () => {
  it('F same plan d but different daylight Z rejects REJECT_XYZ_TIE_MISMATCH', () => {
    const f = byId(artifact(), 'F');
    expect(f.gate.ok).toBe(false);
    expect(f.gate.reason).toBe('REJECT_XYZ_TIE_MISMATCH');
    for (const k of f.corners) {
      expect(k.dIn).toBe(5);
      expect(k.dOut).toBe(5); // same required plan d …
      expect(k.reason).toBe('REJECT_XYZ_TIE_MISMATCH');
      expect(k.active).toBe(false);
      expect(k.zAgree).toBe(false);
    }
    expect([f.corners[0]!.zIn, f.corners[0]!.zOut]).toEqual([5, 10]); // … Z 5 vs 10
    expect([f.corners[1]!.zIn, f.corners[1]!.zOut]).toEqual([10, 5]);
    const live = xyzRunTieOk(xyzFixtureTieInput('F', 0));
    expect(live.reason).toBe('REJECT_XYZ_TIE_MISMATCH');
  });
  it('G different required plan d rejects REJECT_D_MISMATCH (pinned)', () => {
    const g = byId(artifact(), 'G');
    expect(g.corners.map((k) => k.reason)).toEqual(['REJECT_D_MISMATCH', 'REJECT_D_MISMATCH']);
    expect([g.corners[0]!.dIn, g.corners[0]!.dOut]).toEqual([5, 7]);
    expect(g.mesh.exact).toBe(false);
  });
  it('H unequal member flats retain REJECT_ELEVATION_MEMBER_MISMATCH', () => {
    const h = byId(artifact(), 'H');
    expect(h.corners[0]!.reason).toBe('REJECT_ELEVATION_MEMBER_MISMATCH');
    expect([h.corners[0]!.dIn, h.corners[0]!.dOut]).toEqual([5, 3]);
    expect(h.gate.reason).toBe('REJECT_ELEVATION_MEMBER_MISMATCH');
    expect(h.mesh.sourceZContinuous).toBe(false);
  });
});

describe('20L.1 XYZ ties: §16.9 local-vs-active distinction', () => {
  it('exposes plan-local candidacy separately from the active tie', () => {
    const c = artifact();
    for (const id of ['F', 'G', 'H', 'I']) {
      const f = byId(c, id);
      // Plan-local P0 exists at the (incoming) d even when the XYZ gate rejects.
      expect(f.corners.some((k) => k.localP0)).toBe(true);
      expect(f.gate.activeCorners).toEqual(id === 'H' || id === 'I' ? [1] : []);
    }
    // F: local plan P0 (same d) but inactive because Z ties disagree.
    const f = byId(c, 'F');
    expect(f.corners[0]!.localP0).toBe(true);
    expect(f.corners[0]!.dIn).toBe(f.corners[0]!.dOut);
    expect(f.corners[0]!.active).toBe(false);
    // Admitted fixtures expose the active flag only where the tie holds.
    for (const id of ADMITS) {
      const g = byId(c, id);
      expect(g.gate.activeCorners).toEqual([0, 1]);
      expect(g.corners.every((k) => k.active === k.localP0)).toBe(true);
    }
  });
});

describe('20L.1 XYZ ties: §16.10 no splice built', () => {
  it('builds no transition geometry: only offset nodes + production ties', () => {
    const c = artifact();
    expect(c.noTransitionGeometry).toBe(true);
    const flat = JSON.stringify(c).toLowerCase();
    for (const banned of ['splice', 'transitioncurve', 'verticalwall', 'averageweld']) {
      expect(flat).not.toContain(banned);
    }
    // Exact mesh exists only where every corner has an AGREED join Z (not merely a tie).
    for (const f of c.fixtures) {
      expect(f.mesh.exact).toBe(f.corners.every((k) => k.joinZ !== null));
    }
  });
});

describe('20L.1 XYZ ties: §16.11 mesh finite/connected/clean', () => {
  it('every fixture mesh is finite, single-component, edge-connected, overlap-free', () => {
    for (const f of artifact().fixtures) {
      expect(f.mesh.built).toBe(true);
      expect(f.mesh.finite).toBe(true);
      expect(f.mesh.components).toBe(1);
      expect(f.mesh.edgeComponents).toBe(1);
      expect(f.mesh.noInteriorOverlap).toBe(true);
      expect(f.mesh.daylightContinuity).toBe(true);
      expect(f.mesh.detail).toBe('AUDIT_OK');
    }
  });
});

describe('20L.1 XYZ ties: §16.12 Z continuity', () => {
  it('admitted fixtures are Z-continuous at active corners; rejected ones are not claimed', () => {
    const c = artifact();
    for (const id of ADMITS) {
      const f = byId(c, id);
      expect(f.mesh.daylightZTieOk).toBe(true);
      expect(f.corners.every((k) => k.zAgree && k.reason === 'Z_TIE_OK')).toBe(true);
    }
    expect(byId(c, 'F').mesh.daylightZTieOk).toBe(false);
    expect(byId(c, 'F').corners.every((k) => k.zAgree)).toBe(false);
  });
});

describe('20L.1 XYZ ties: §16.13 curved-closed scoping note', () => {
  it('scopes curved-closed groups out (whole-group chord fallback, no exact tie claimed)', () => {
    const c = artifact();
    expect(c.scope.curvedClosed).toContain('OUT_OF_SCOPE_CHORD_FALLBACK');
    expect(c.scope.curvedClosed).toContain('group-corpus.json');
  });
});

describe('20L.1 XYZ ties: §16.14 20L local stability', () => {
  it('policy corpus is unchanged (186 rows / 15 P0) and the xyz corpus is deterministic ×2', () => {
    const policy = JSON.parse(readFileSync(
      join(dirname(new URL(import.meta.url).pathname), '..', 'docs', 'evidence', 'phase20l1', 'policy-corpus.json'), 'utf8',
    ));
    expect(policy.counts.rows).toBe(186);
    expect(policy.counts.admittedP0).toBe(15);
    const a = buildCorpus();
    const b = buildCorpus();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.digest).toBe(b.digest);
    expect(a.digest).toBe(artifact().digest);
  });
});

describe('20L.1 XYZ ties: §16.17 tie-at-join law (search-neighborhood locality + join-Z agreement)', () => {
  it('states the locality rule: tie shares the join search neighborhood; coincidence NOT required, agreement NOT claimed', () => {
    const c = artifact();
    expect(c.contract).toContain('coincidence NOT required');
    expect(c.contract).toContain('NOT an E1 numerical-agreement claim');
    // Every accepted tie lies in the search neighborhood — including the 0.2277 m arc cases.
    for (const f of c.fixtures) {
      for (const k of f.corners) {
        if (k.tieXYZ !== null) {
          expect(k.tieJoinDist).not.toBeNull();
          expect(extentJVWithin(k.tieJoinDist!, 100, 50)).toBe(true);
        }
      }
    }
    // Flat admits show the structural offset openly (not hidden): tie ≠ join in plan.
    const a0 = byId(c, 'A').corners[0]!;
    expect(a0.tieJoinDist).toBeGreaterThan(0.22);
    expect(a0.joinZ).toBe(a0.zIn);
    expect(a0.joinZ).toBe(a0.zOut);
  });
  it('Z agreement is numerical agreement at the join (production zeroDelta, no wider band) with stated justification', () => {
    const c = artifact();
    expect(c.contract).toContain('zeroDelta');
    expect(c.reasonCodes).toContain('REJECT_JOIN_Z_MISMATCH');
    expect(c.reasonCodes).toContain('REJECT_TIE_OUTSIDE_SEARCH');
    expect(c.reasonCodes).toContain('REJECT_SLOPED_SOURCE');
    // Every tied corner carries one agreed join Z equal to both join laws.
    for (const f of c.fixtures) {
      for (const k of f.corners) {
        if (k.reason === 'Z_TIE_OK') {
          expect(k.zAgree).toBe(true);
          expect(k.joinZ).toBe(k.zIn);
          expect(k.joinZ).toBe(k.zOut);
        } else {
          expect(k.joinZ).toBeNull();
        }
      }
    }
  });
});
describe('20L.1 XYZ ties: §16.18 source-joint step (0-vs-2 repro + fixture I)', () => {
  it('reviewer flat 0-vs-2 repro rejects: incoming flat 0, outgoing flat 2, true limits 5 vs 7', () => {
    // Fixture A corner 0 with a stepped joint: both members exactly flat, so
    // flatness passes — the rejector is joint continuity, with true limits.
    const base = xyzFixtureTieInput('A', 0);
    const live = xyzRunTieOk({
      ...base,
      incoming: { ...base.incoming, startZ: 0, endZ: 0 },
      outgoing: { ...base.outgoing, startZ: 2, endZ: 2 },
    });
    expect(live.ok).toBe(false);
    expect(live.reason).toBe('REJECT_SOURCE_JOINT_STEP');
    expect(live.localP0).toBe(true);
    expect([live.zIn, live.zOut]).toEqual([5, 7]);
    expect(live.joinZ).toBeNull();
  });
  it('fixture I pins the step in corpus: stepped corner dead, continuous corner tied', () => {
    const i = byId(artifact(), 'I');
    expect(i.expected).toBe('REJECT');
    expect(i.expectedReason).toBe('REJECT_SOURCE_JOINT_STEP');
    expect(i.gate.ok).toBe(false);
    expect(i.gate.reason).toBe('REJECT_SOURCE_JOINT_STEP');
    expect(i.corners.map((k) => k.reason)).toEqual(['REJECT_SOURCE_JOINT_STEP', 'Z_TIE_OK']);
    expect([i.corners[0]!.zIn, i.corners[0]!.zOut]).toEqual([5, 7]);
    expect(i.corners[0]!.active).toBe(false);
    expect(i.corners[0]!.localP0).toBe(true);
    // Continuous corner at z=2 ties at limit 7 — tied-but-inactive under fallback.
    expect([i.corners[1]!.zIn, i.corners[1]!.zOut]).toEqual([7, 7]);
    expect(i.corners[1]!.joinZ).toBe(7);
    expect(i.gate.activeCorners).toEqual([1]);
    expect(i.mesh.exact).toBe(false);
    expect(i.mesh.sourceZContinuous).toBe(false);
    expect(i.mesh.daylightZTieOk).toBe(false);
  });
});
describe('20L.1 XYZ ties: §16.15 E1 unchanged (shared extent helper consumed as-is)', () => {
  it('does not edit the extent gate; the shared helper still behaves at the bound', () => {
    // E1 shared helper: at-bound inclusive, beyond-bound exclusive.
    expect(extentJVWithin(100, 100, 1)).toBe(true);
    expect(extentJVWithin(99.5, 100, 1)).toBe(true);
    expect(extentJVWithin(101, 100, 1)).toBe(false);
    const c = artifact();
    expect(c.extentRule).toContain('extentJVWithin');
    expect(c.extentRule).toContain('never re-derived');
  });
});

describe('20L.1 XYZ ties: §16.16 A/D flat controls admit', () => {
  it('flat Distance (A) and flat Elevation (D) controls admit exactly', () => {
    const c = artifact();
    for (const id of ['A', 'D']) {
      const f = byId(c, id);
      expect(f.gate.ok).toBe(true);
      expect(f.corners.map((k) => k.reason)).toEqual(['Z_TIE_OK', 'Z_TIE_OK']);
      expect(f.corners.map((k) => k.tieXYZ!.z)).toEqual([5, 5]);
      expect(f.mesh.exact).toBe(true);
      expect(f.mesh.daylightZTieOk).toBe(true);
    }
  });
});
