/**
 * Phase 20Q.1 Wave K — singular sloped-source production performance
 * (MEASUREMENT ONLY; no thresholds, no optimization, no src/ changes).
 *
 * Fixtures are built ONCE outside every timed region. Each row times the
 * ACTUAL production entry points on an admitted singular transition:
 *   - policyMs: `admitGradingTransition` (trp1 admission, exact slope law),
 *   - solveMs:  `computeGradingGroupFromSnapshots` (member solves + tiler +
 *               merged mesh + gtop2 certificate — one call, stages not
 *               separately instrumented, same convention as 20N.1),
 *   - workerMs: `validateTransitionResultMeshAgainst` (post-solve worker
 *               mesh agreement) + `checkGroupTransitionAgreement`
 *               (worker plan re-admission) over the result-owned leg.
 * The flat row is the control; sloped rows must not show superlinear
 * per-row cost (the tiler is O(member vertices), not O(iterations)).
 * Determinism is asserted: every repeated solve must produce the identical
 * mesh/daylight digest and pass the worker gates.
 *
 * Usage: npx tsx scripts/phase20q1TransitionPerf.ts [--quick] \
 *   | tee docs/evidence/phase20q1/perf-output.txt
 */
import { performance } from 'node:perf_hooks';

import {
  computeGradingGroupFromSnapshots,
} from '../src/engine/cad/grading/gradingGroupCompute';
import {
  admitGradingTransition,
  TRANSITION_LAW_KIND,
  TRANSITION_LAW_VERSION,
  TRANSITION_POLICY_VERSION,
  type AdmitTransitionInput,
  type TransitionMemberGeometry,
} from '../src/engine/cad/grading/gradingTransitionPolicy';
import {
  toGroupSolveInput,
  validateTransitionResultMeshAgainst,
  type GradingGroupComputeRequest,
} from '../src/workers/surfaceWorkerHandler';
import {
  checkGroupTransitionAgreement,
  type GroupTransitionMemberView,
  type GroupTransitionPlan,
} from '../src/workers/surfaceGradingCompute';
import type { GradingCriterion, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';

const QUICK = process.argv.includes('--quick');
const REPS = QUICK ? 1 : 5;
// Sub-ms work: average INNER runs so timer noise stays below the signal.
const INNER_POLICY = 500;
const INNER_SOLVE = 50;
const GRADE = 0.5;
const JOINT_Z = 10;
const LEN = 30;
const WIDTH = 8;
const MAX_SEARCH = 50;
const REV = 'ggrev1:20q1-perf';
const KEYS = ['L', 'R'];

const DIST = (d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: GRADE, distance: d });

const link = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): ResolvedGradingSource => ({
  startX: ax, startY: ay, endX: bx, endY: by, startZ: az, endZ: bz,
  length: Math.hypot(bx - ax, by - ay), reoriented: false, isArc: false,
});

interface RowDef {
  id: string;
  /** Signed member grade as a fraction of member length. */
  slope: number;
}

const ROWS: RowDef[] = [
  { id: 'flat', slope: 0 },
  { id: 'tiny', slope: 1e-9 },
  { id: 'p1', slope: 0.01 },
  { id: 'p5', slope: 0.05 },
  { id: 'p15', slope: 0.15 },
  { id: 'p50', slope: 0.5 },
  { id: 'CREST', slope: 2 / LEN },
  { id: 'SAG', slope: -2 / LEN },
];

interface Fixture {
  def: RowDef;
  members: ResolvedGradingSource[];
  criteria: GradingCriterion[];
  keys: string[];
  admitInput: AdmitTransitionInput;
  plan: GroupTransitionPlan;
  views: GroupTransitionMemberView[];
  request: GradingGroupComputeRequest;
}

const geom = (members: ResolvedGradingSource[], criteria: GradingCriterion[]): [TransitionMemberGeometry, TransitionMemberGeometry] =>
  members.map((m, i) => ({
    memberId: KEYS[i]!, criterion: criteria[i]!, length: m.length,
    dirX: m.endX - m.startX, dirY: m.endY - m.startY,
    startZ: m.startZ, endZ: m.endZ, isArc: false, maxSearchDistance: MAX_SEARCH,
  })) as [TransitionMemberGeometry, TransitionMemberGeometry];

const buildFixture = (def: RowDef): Fixture => {
  const z0 = def.id === 'CREST' ? JOINT_Z - 2 : def.id === 'SAG' ? JOINT_Z + 2 : JOINT_Z - def.slope * LEN;
  const z2 = def.id === 'CREST' ? JOINT_Z - 2 : def.id === 'SAG' ? JOINT_Z + 2 : JOINT_Z + def.slope * LEN;
  const members = [link(-LEN, 0, z0, 0, 0, JOINT_Z), link(0, 0, JOINT_Z, LEN, 0, z2)];
  const criteria = [DIST(5), DIST(7)];
  const admitInput: AdmitTransitionInput = {
    policyVersion: TRANSITION_POLICY_VERSION, lawKind: TRANSITION_LAW_KIND, lawVersion: TRANSITION_LAW_VERSION,
    criterionFamily: 'distance', jointId: 'joint:0', memberIds: [...KEYS], width: WIDTH,
    side: 'left', groupSide: 'left', isOpen: true, transitionCount: 1, jointZ: JOINT_Z,
    members: geom(members, criteria),
  };
  const admitted = admitGradingTransition(admitInput);
  if (!admitted.ok) throw new Error(`${def.id}: admission must hold (got ${admitted.code})`);
  const plan: GroupTransitionPlan = {
    policyVersion: TRANSITION_POLICY_VERSION, jointId: 'joint:0', memberIds: [...KEYS], width: WIDTH,
    lawKind: TRANSITION_LAW_KIND, lawVersion: TRANSITION_LAW_VERSION, criterionFamily: 'distance',
    side: 'left', groupSide: 'left', isOpen: true, transitionCount: 1, jointZ: JOINT_Z,
    endpointEvidence: { vL: admitted.vL, vR: admitted.vR, gL: GRADE, gR: GRADE },
    jointStation: LEN, recordedRevision: REV,
  };
  const views: GroupTransitionMemberView[] = geom(members, criteria).map((m) => ({
    memberId: m.memberId, criterion: m.criterion, length: m.length, dirX: m.dirX, dirY: m.dirY,
    startZ: m.startZ, endZ: m.endZ, isArc: m.isArc, maxSearchDistance: m.maxSearchDistance,
  }));
  const request: GradingGroupComputeRequest = {
    groupId: `perf-${def.id}`, revision: REV, memberSources: members, side: 'left',
    criterion: criteria[0]!, memberCriteria: criteria, maxSearchDistance: MAX_SEARCH,
    curveChordTolerance: 0.01, closed: false, transition: plan, transitionMemberKeys: [...KEYS],
  };
  return { def, members, criteria, keys: [...KEYS], admitInput, plan, views, request };
};

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};
const fmt = (v: number): string => (v >= 100 ? v.toFixed(1) : v.toFixed(3));

const timePolicy = (fx: Fixture): number => {
  const samples: number[] = [];
  for (let r = 0; r < REPS; r += 1) {
    const t0 = performance.now();
    for (let k = 0; k < INNER_POLICY; k += 1) {
      const out = admitGradingTransition(fx.admitInput);
      if (!out.ok) throw new Error(`${fx.def.id}: policy must admit`);
    }
    samples.push((performance.now() - t0) / INNER_POLICY);
  }
  return median(samples);
};

const timeSolve = (fx: Fixture): { ms: number; verts: number; tris: number } => {
  const samples: number[] = [];
  const digests = new Set<string>();
  let verts = 0;
  let tris = 0;
  for (let r = 0; r < REPS; r += 1) {
    const t0 = performance.now();
    for (let k = 0; k < INNER_SOLVE; k += 1) {
      const out = computeGradingGroupFromSnapshots(toGroupSolveInput(fx.request));
      if (!out.ok) throw new Error(`${fx.def.id}: solve must admit (got ${out.code} ${out.detail ?? ''})`);
      verts = out.result.gradingMesh.points.length / 3;
      tris = out.result.gradingMesh.triangles.length / 3;
      digests.add(JSON.stringify([out.result.daylightPoints, out.result.gradingMesh.triangles, out.result.topologyCertificate?.components]));
    }
    samples.push((performance.now() - t0) / INNER_SOLVE);
  }
  if (digests.size !== 1) throw new Error(`${fx.def.id}: solve not deterministic`);
  return { ms: median(samples), verts, tris };
};

const timeWorker = (fx: Fixture): number => {
  const out = computeGradingGroupFromSnapshots(toGroupSolveInput(fx.request));
  if (!out.ok) throw new Error(`${fx.def.id}: worker input requires ok solve`);
  const samples: number[] = [];
  for (let r = 0; r < REPS; r += 1) {
    const t0 = performance.now();
    for (let k = 0; k < INNER_SOLVE; k += 1) {
      const meshReject = validateTransitionResultMeshAgainst(out.result, fx.request);
      if (meshReject !== null) throw new Error(`${fx.def.id}: worker mesh gate must hold (got ${meshReject})`);
      const agree = checkGroupTransitionAgreement(fx.plan, fx.views, out.result.revision);
      if (!agree.ok) throw new Error(`${fx.def.id}: worker agreement must hold (got ${agree.code})`);
    }
    samples.push((performance.now() - t0) / INNER_SOLVE);
  }
  return median(samples);
};

const rows = ROWS.map((def) => {
  const fx = buildFixture(def);
  return { id: def.id, slope: def.slope, policy: timePolicy(fx), solve: timeSolve(fx), worker: timeWorker(fx) };
});

console.log(`phase20q1 singular transition perf ${QUICK ? '(quick)' : `(reps=${REPS})`}`);
console.log('id slope policyMs solveMs workerMs totalMs verts tris');
for (const r of rows) {
  console.log(
    `${r.id} ${r.slope} ${fmt(r.policy)} ${fmt(r.solve.ms)} ${fmt(r.worker)} ` +
    `${fmt(r.policy + r.solve.ms + r.worker)} ${r.solve.verts} ${r.solve.tris}`,
  );
}
const flat = rows.find((r) => r.id === 'flat')!;
for (const r of rows) {
  if (r.id === 'flat') continue;
  console.log(`ratio ${r.id}/flat solve=${fmt(r.solve.ms / flat.solve.ms)} total=${fmt((r.policy + r.solve.ms + r.worker) / (flat.policy + flat.solve.ms + flat.worker))}`);
}
console.log('determinism: all rows repeated-solve digests identical; worker gates hold.');
