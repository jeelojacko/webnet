/**
 * Phase 20L.2 — baseline fallback projection capture (production chord path).
 *
 * BEFORE any 20L.2 exact-offset dispatcher lands, this pins what the CURRENT
 * merged-main group solver (`computeGradingGroupFromSnapshots`) already
 * produces for every future fallback case. Later production work must keep
 * each of these fixtures byte-for-byte identical on the untouched chord path:
 * the only admitted exact route is the flat open curved analytic group; every
 * other case (sloped, stepped, diff-d, arc-pair, ambiguous, off-body, Roff
 * collapse/inversion, closed-curved, surface, hybrid, over-search, line-only)
 * falls back to this captured output.
 *
 * The test builds each fixture as real production inputs, runs the production
 * kernel directly, and pins result/digests against
 * `docs/evidence/phase20l2/baseline-fallback.json`. Regenerate with
 * `WEBNET_UPDATE_BASELINE_FALLBACK=1 npx vitest run <this file>`.
 *
 * This is NOT a second implementation of the old algorithm: it calls the one
 * production entry point and hashes what it returns.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  computeGradingGroupFromSnapshots,
  type GroupSolveInput,
} from '../src/engine/cad/grading/gradingGroupCompute';
import {
  digestTopologyCoordinatesExact,
  digestTopologyMeshExact,
} from '../src/engine/cad/grading/gradingTopologyCertificate';
import type { GradingTargetMeshSnapshot } from '../src/engine/cad/grading/gradingComputeTypes';
import type {
  CadGradingGroupResult,
} from '../src/engine/cad/grading/gradingGroupTypes';
import type {
  GradingCriterion,
  GradingSide,
  ResolvedGradingSource,
} from '../src/engine/cad/grading/gradingTypes';

export const EVIDENCE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'docs',
  'evidence',
  'phase20l2',
  'baseline-fallback.json',
);

const sha16 = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

// ── criterion factories ─────────────────────────────────────────────────────

const DIST = (d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: 1, distance: d });
const REL = (g: number, dz: number): GradingCriterion =>
  ({ kind: 'relative-elevation', gradeRatio: g, relativeElevation: dz });
const FIXED = (g: number): GradingCriterion => ({ kind: 'fixed', gradeRatio: g });
const CUTFILL = (g: number): GradingCriterion =>
  ({ kind: 'cut-fill', cutGradeRatio: g, fillGradeRatio: g });

// ── production member construction (exact shared joints) ────────────────────

interface Node { x: number; y: number }

interface Spec {
  p0: Node;
  p1: Node;
  z0: number;
  z1: number;
  arc?: { cx: number; cy: number; ccw: boolean };
}

const N = (x: number, y: number): Node => ({ x, y });

/** Mirror the production resolver: arcs carry centre + derived sweep angles. */
const toSource = (s: Spec): ResolvedGradingSource => {
  if (!s.arc) {
    return {
      startX: s.p0.x, startY: s.p0.y, endX: s.p1.x, endY: s.p1.y,
      startZ: s.z0, endZ: s.z1, length: Math.hypot(s.p1.x - s.p0.x, s.p1.y - s.p0.y),
      reoriented: false, isArc: false,
    };
  }
  const radius = Math.hypot(s.p0.x - s.arc.cx, s.p0.y - s.arc.cy);
  const a0 = Math.atan2(s.p0.y - s.arc.cy, s.p0.x - s.arc.cx);
  let a1 = Math.atan2(s.p1.y - s.arc.cy, s.p1.x - s.arc.cx);
  if (s.arc.ccw) { while (a1 <= a0) a1 += 2 * Math.PI; } else { while (a1 >= a0) a1 -= 2 * Math.PI; }
  return {
    startX: s.p0.x, startY: s.p0.y, endX: s.p1.x, endY: s.p1.y,
    startZ: s.z0, endZ: s.z1, length: radius * Math.abs(a1 - a0),
    reoriented: false, isArc: true,
    arc: {
      centerX: s.arc.cx, centerY: s.arc.cy, radius,
      startAngle: a0, endAngle: a1, sweepCCW: s.arc.ccw,
    },
  };
};

const line = (p0: Node, p1: Node, z0 = 0, z1 = 0): Spec => ({ p0, p1, z0, z1 });
const arc = (
  p0: Node, p1: Node, cx: number, cy: number, ccw: boolean, z0 = 0, z1 = 0,
): Spec => ({ p0, p1, z0, z1, arc: { cx, cy, ccw } });

// ── target snapshot (surface fixtures only) ─────────────────────────────────

const gridTarget = (
  fn: (_x: number, _y: number) => number, xs: number[], ys: number[],
): GradingTargetMeshSnapshot => {
  const points: number[] = [];
  const idx = (ix: number, iy: number): number => iy * xs.length + ix;
  for (const y of ys) for (const x of xs) points.push(x, y, fn(x, y));
  const triangles: number[] = [];
  for (let ix = 0; ix + 1 < xs.length; ix += 1) {
    for (let iy = 0; iy + 1 < ys.length; iy += 1) {
      const a = idx(ix, iy);
      const b = idx(ix + 1, iy);
      const c = idx(ix + 1, iy + 1);
      const d = idx(ix, iy + 1);
      triangles.push(a, b, c, a, c, d);
    }
  }
  return { points, triangles };
};

const range = (a: number, b: number, step: number): number[] => {
  const out: number[] = [];
  for (let v = a; v <= b + 1e-9; v += step) out.push(v);
  return out;
};

const FLAT90 = gridTarget(() => 90, range(-100, 100, 20), range(-100, 100, 20));

// ── fixture registry (the 16 future fallback cases) ─────────────────────────

interface FixtureSpec {
  id: string;
  case: string;
  source: Spec[];
  side: GradingSide;
  criterion: GradingCriterion;
  memberCriteria?: GradingCriterion[];
  closed?: boolean;
  maxSearchDistance?: number;
  target?: GradingTargetMeshSnapshot;
}

const fixtures: FixtureSpec[] = [
  {
    id: '01-open-curved-sloped-distance',
    case: 'open curved sloped Distance',
    side: 'left', criterion: DIST(5),
    source: [line(N(-40, 0), N(0, 0), 0, 1), arc(N(0, 0), N(50, 50), 50, 0, false, 1, 2)],
  },
  {
    id: '02-sloped-relative-elevation',
    case: 'sloped Relative Elevation',
    side: 'left', criterion: REL(1, 5),
    source: [line(N(-40, 0), N(0, 0), 0, 1), arc(N(0, 0), N(50, 50), 50, 0, false, 1, 2)],
  },
  {
    id: '03-same-d-different-z-mixed',
    case: 'same-d / different-Z mixed analytic',
    side: 'left', criterion: DIST(5),
    memberCriteria: [DIST(5), REL(2, 10), DIST(5)],
    source: [
      line(N(-40, 0), N(0, 0)),
      arc(N(0, 0), N(50, 50), 50, 0, false),
      line(N(50, 50), N(50, 90)),
    ],
  },
  {
    id: '04-different-d-mixed',
    case: 'different-d mixed analytic',
    side: 'left', criterion: DIST(5),
    memberCriteria: [DIST(5), REL(1, 10), DIST(5)],
    source: [
      line(N(-40, 0), N(0, 0)),
      arc(N(0, 0), N(50, 50), 50, 0, false),
      line(N(50, 50), N(50, 90)),
    ],
  },
  {
    id: '05-source-joint-z-step',
    case: 'source-joint Z step (0 vs 2)',
    side: 'left', criterion: DIST(5),
    source: [
      line(N(-40, 0), N(0, 0), 0, 0),
      arc(N(0, 0), N(50, 50), 50, 0, false, 2, 2),
      line(N(50, 50), N(50, 90), 2, 2),
    ],
  },
  {
    id: '06-arc-arc-corner',
    case: 'arc×arc corner',
    side: 'left', criterion: DIST(5),
    source: [
      line(N(-40, 0), N(0, 0)),
      arc(N(0, 0), N(50, 50), 50, 0, false),
      arc(N(50, 50), N(10, 90), 10, 50, true),
    ],
  },
  {
    id: '07-ambiguous-multi-branch',
    case: 'ambiguous multi-branch corner (B0)',
    side: 'right', criterion: DIST(5),
    source: [arc(N(-50, -50), N(0, 0), 0, -50, false), line(N(0, 0), N(0, 40))],
  },
  {
    id: '08-nonlocal-outside-extension',
    case: 'NONLOCAL / outside extension (C0, 1 m bodies)',
    side: 'right', criterion: DIST(5),
    source: [line(N(-1, 0), N(0, 0)), line(N(0, 0), N(0, 1))],
  },
  {
    id: '09-roff-collapse',
    case: 'Roff collapse (R = d = 5)',
    side: 'left', criterion: DIST(5),
    source: [line(N(-40, 0), N(0, 0)), arc(N(0, 0), N(-5, 5), -5, 0, true)],
  },
  {
    id: '10-roff-inversion',
    case: 'Roff inversion (d = 8 > R = 5)',
    side: 'left', criterion: DIST(8),
    source: [line(N(-40, 0), N(0, 0)), arc(N(0, 0), N(-5, 5), -5, 0, true)],
  },
  {
    id: '11-curved-closed-group',
    case: 'curved closed group (stadium)',
    side: 'left', criterion: DIST(5), closed: true,
    source: [
      line(N(0, 0), N(60, 0)),
      arc(N(60, 0), N(60, 40), 60, 20, true),
      line(N(60, 40), N(0, 40)),
      arc(N(0, 40), N(0, 0), 0, 20, true),
    ],
  },
  {
    id: '12-surface-fixed',
    case: 'Surface Fixed',
    side: 'right', criterion: FIXED(-0.5), target: FLAT90,
    source: [
      line(N(-60, 0), N(0, 0), 100, 100),
      line(N(0, 0), N(0, 60), 100, 100),
    ],
  },
  {
    id: '13-surface-cut-fill',
    case: 'Surface Cut/Fill',
    side: 'right', criterion: CUTFILL(-0.5), target: FLAT90,
    source: [
      line(N(-60, 0), N(0, 0), 100, 100),
      line(N(0, 0), N(0, 60), 100, 100),
    ],
  },
  {
    id: '14-surface-analytic-hybrid',
    case: 'surface↔analytic hybrid',
    side: 'right', criterion: FIXED(-0.5), target: FLAT90,
    memberCriteria: [FIXED(-0.5), REL(-0.25, -10)],
    source: [
      line(N(-60, 0), N(0, 0), 100, 100),
      line(N(0, 0), N(0, 60), 100, 100),
    ],
  },
  {
    id: '15-max-search-rejection',
    case: 'maxSearch rejection (d = 5 > ms = 4)',
    side: 'left', criterion: DIST(5), maxSearchDistance: 4,
    source: [line(N(-40, 0), N(0, 0)), arc(N(0, 0), N(50, 50), 50, 0, false)],
  },
  {
    id: '16-line-only-control',
    case: 'line-only group control',
    side: 'left', criterion: DIST(5),
    source: [line(N(-40, 0), N(0, 0)), line(N(0, 0), N(0, 40))],
  },
];

// ── projection + digests ────────────────────────────────────────────────────

const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const projectSuccess = (id: string, r: CadGradingGroupResult): Record<string, unknown> => {
  const points = r.gradingMesh.points;
  const triangles = r.gradingMesh.triangles;
  const daylight = r.daylightPoints ?? [];
  const source = r.sourceBoundaryPoints ?? [];
  const certificate = r.topologyCertificate ?? null;
  return {
    ok: true,
    accuracy: r.accuracy,
    revision: r.revision,
    memberCount: r.memberCount,
    cornerCount: r.cornerCount,
    memberRegions: roundTrip(r.memberRegions),
    corners: roundTrip(r.corners),
    daylightPoints: [...daylight],
    sourceBoundaryPoints: [...source],
    gradingMesh: {
      pointCount: points.length / 3,
      triangleCount: triangles.length / 3,
      meshDigest: digestTopologyMeshExact(points, triangles),
      pointsDigest: digestTopologyCoordinatesExact(points),
      trianglesDigest: digestTopologyCoordinatesExact(triangles),
    },
    stats: {
      sourceLength: r.sourceLength,
      gradingPlanArea: r.gradingPlanArea,
      grading3dArea: r.grading3dArea,
      minProjectionDistance: r.minProjectionDistance,
      maxProjectionDistance: r.maxProjectionDistance,
      meanProjectionDistance: r.meanProjectionDistance,
      cutSourceLength: r.cutSourceLength,
      fillSourceLength: r.fillSourceLength,
      tiedSourceLength: r.tiedSourceLength,
      candidateTriangleCount: r.candidateTriangleCount,
      intersectionSegmentCount: r.intersectionSegmentCount,
      multipleSolutionCount: r.multipleSolutionCount,
    },
    diagnostics: roundTrip(r.diagnostics),
    topologyCertificate: roundTrip(certificate),
    certificateDigest: sha16(certificate),
    fixtureDigest: sha16([id, r.gradingMesh, daylight, source, r.corners, certificate]),
  };
};

const buildInput = (f: FixtureSpec): GroupSolveInput => ({
  groupId: f.id,
  revision: `baseline-20l2/${f.id}`,
  members: f.source.map(toSource),
  side: f.side,
  criterion: f.criterion,
  maxSearchDistance: f.maxSearchDistance ?? 100,
  curveChordTolerance: 0.01,
  closed: f.closed ?? false,
  ...(f.memberCriteria ? { memberCriteria: f.memberCriteria } : {}),
  ...(f.target ? { target: f.target } : {}),
});

export const captureBaseline = (): Record<string, unknown> => {
  const entries: Array<Record<string, unknown>> = fixtures.map((f) => {
    const out = computeGradingGroupFromSnapshots(buildInput(f));
    const header = {
      id: f.id,
      case: f.case,
      side: f.side,
      closed: f.closed ?? false,
      memberCount: f.source.length,
      maxSearchDistance: f.maxSearchDistance ?? 100,
      criterionKind: f.criterion.kind,
      memberCriterionKinds: (f.memberCriteria ?? [f.criterion]).map((c) => c.kind),
      target: f.target !== undefined,
    };
    if (!out.ok) {
      return {
        ...header,
        ok: false,
        code: out.code,
        cornerIndex: out.cornerIndex ?? null,
        detail: out.detail ?? null,
        fixtureDigest: sha16([f.id, out.code, out.cornerIndex ?? null, out.detail ?? null]),
      };
    }
    return { ...header, ...projectSuccess(f.id, out.result) };
  });
  const digests: Record<string, string> = {};
  for (const e of entries) digests[e.id as string] = e.fixtureDigest as string;
  const payload = {
    generator: 'tests/cad_grading_exact_offset_baseline_20l2.test.ts',
    phase: '20L.2',
    baseline: 'main @ 606790c (PR #147 merge)',
    contract:
      'Fallback-parity baseline: these are the pre-dispatcher production chord-path projections. Future 20L.2 exact-offset work must keep every fixture identical on the untouched chord path.',
    fixtureCount: entries.length,
    digests,
    fixtures: entries,
  };
  return { ...payload, digest: sha16(payload) };
};

// ── the pin ─────────────────────────────────────────────────────────────────

const generated = captureBaseline();

if (process.env.WEBNET_UPDATE_BASELINE_FALLBACK === '1') {
  mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
  writeFileSync(EVIDENCE_PATH, `${JSON.stringify(generated, null, 2)}\n`);
}

const committed: Record<string, unknown> = JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8'));

describe('phase20l.2 baseline fallback projections', () => {
  it('committed evidence matches the live production chord-path output', () => {
    expect(generated).toEqual(committed);
    expect(generated.digest).toBe(committed.digest);
  });

  it('covers all 16 future fallback cases with a stable digest table', () => {
    const rows = generated.fixtures as Array<{ id: string; fixtureDigest: string }>;
    expect(rows).toHaveLength(16);
    expect(Object.keys(generated.digests as object)).toHaveLength(16);
    expect(rows.map((r) => r.fixtureDigest).every((d) => /^[0-9a-f]{16}$/.test(d))).toBe(true);
  });

  it('line-only control and surface fixtures preserve a real merged mesh', () => {
    const rows = generated.fixtures as Array<{ id: string; ok: boolean; gradingMesh?: { triangleCount: number } }>;
    for (const id of ['16-line-only-control', '12-surface-fixed', '13-surface-cut-fill', '14-surface-analytic-hybrid']) {
      const row = rows.find((r) => r.id === id)!;
      expect(row.ok).toBe(true);
      expect(row.gradingMesh!.triangleCount).toBeGreaterThan(0);
    }
  });

  it('over-search criterion fails closed with no mesh', () => {
    const row = (generated.fixtures as Array<Record<string, unknown>>)
      .find((r) => r.id === '15-max-search-rejection')!;
    expect(row.ok).toBe(false);
    expect(row.code).toBe('MEMBER_NO_SOLUTION');
  });

  it('source-joint Z step fails closed before any mesh', () => {
    const row = (generated.fixtures as Array<Record<string, unknown>>)
      .find((r) => r.id === '05-source-joint-z-step')!;
    expect(row.ok).toBe(false);
    expect(row.code).toBe('CORNER_INVERTED');
    expect(row.detail).toBe('GRADING_GROUP_CORNER_MISMATCH');
  });
});
