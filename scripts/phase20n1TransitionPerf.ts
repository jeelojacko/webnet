/**
 * Phase 20N.1 Wave K — multi-transition production performance (measurement only).
 *
 * No thresholds, no validation changes. Fixtures are built ONCE outside every
 * timed region. Each row times the ACTUAL production entry points on admitted
 * straight collinear flat groups with 0/1/2/3/8 transitions:
 * `selectGroupTransitions` + `deriveGroupTransitionExpectation` (group policy),
 * `computeGradingGroupFromSnapshots` (planning/retile + mesh + certificate —
 * internal to that call and not separately instrumented, same convention as
 * the 20L.2 perf script), and the plural worker validators
 * `checkGroupTransitionPlansAgreement` + `validateGroupTransitionLegsMesh`
 * over result-owned legs. Per-engine-stage splits inside the solve call are
 * not separately instrumented.
 *
 * Scaling watch: accidental O(vertices x transitions) or repeated
 * full-member solves would show superlinear solveMs per added transition;
 * O(N transitions + member vertices) shows a roughly flat incremental cost
 * with vertices growing linearly in members.
 *
 * Usage: npx tsx scripts/phase20n1TransitionPerf.ts [--quick] \
 *   | tee docs/evidence/phase20n1/perf-output.txt
 */
import { performance } from 'node:perf_hooks';

import {
  computeGradingGroupFromSnapshots,
  type GroupSolveInput,
} from '../src/engine/cad/grading/gradingGroupCompute';
import type { CadGradingTransition } from '../src/engine/cad/grading/gradingGroupTypes';
import {
  deriveGroupTransitionExpectation,
  selectGroupTransitions,
  type GroupTransitionExpectationJoint,
} from '../src/engine/cad/grading/gradingTransitionPolicy';
import type {
  GradingCriterion,
  ResolvedGradingSource,
} from '../src/engine/cad/grading/gradingTypes';
import {
  checkGroupTransitionPlansAgreement,
  validateGroupTransitionLegsMesh,
  type GroupTransitionMemberView,
  type GroupTransitionPlan,
} from '../src/workers/surfaceGradingCompute';

const QUICK = process.argv.includes('--quick');
const REPS = QUICK ? 1 : 5;
// Inner batch per sample: solves are sub-ms, so each sample averages INNER
// runs to keep timer noise below the per-transition signal.
const INNER_SOLVE = 50;
const INNER_POLICY = 500;
const GRADE = 0.5;
const JOINT_Z = 10;
const MAX_SEARCH = 50;

const DIST = (d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: GRADE, distance: d });

interface RowDef {
  id: string;
  lengths: number[];
  widths: number[];
}

const ROWS: RowDef[] = [
  // T0 is a single member (zero joints): a collinear multi-member chain with
  // no transition intents correctly fails closed (CORNER_NO_SOLUTION on the
  // parallel joint), so it cannot serve as the 0-transition baseline.
  { id: 'T0', lengths: [60], widths: [] },
  { id: 'T1', lengths: [30, 30], widths: [8] },
  { id: 'T2', lengths: [30, 24, 30], widths: [8, 6] },
  { id: 'T3', lengths: [30, 24, 26, 30], widths: [8, 6, 4] },
  { id: 'T8', lengths: [30, 24, 24, 24, 24, 24, 24, 24, 30], widths: [8, 6, 4, 6, 8, 6, 4, 6] },
];

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};
const fmt = (v: number): string => (v >= 100 ? v.toFixed(1) : v.toFixed(3));

interface Fixture {
  def: RowDef;
  members: ResolvedGradingSource[];
  criteria: GradingCriterion[];
  keys: string[];
  intents: CadGradingTransition[];
  joints: GroupTransitionExpectationJoint[];
  input: GroupSolveInput;
}

const buildFixture = (def: RowDef): Fixture => {
  let x = 0;
  const members = def.lengths.map((length) => {
    const startX = x;
    x += length;
    return {
      startX, startY: 0, endX: x, endY: 0,
      startZ: JOINT_Z, endZ: JOINT_Z, length,
      reoriented: false, isArc: false,
    };
  });
  // Alternating native scalars so EVERY transition changes value (study convention).
  const criteria = members.map((_, i) => DIST(i % 2 === 0 ? 5 : 7));
  const keys = members.map((_, i) => `M${i}>M${i + 1}`);
  const intents: CadGradingTransition[] = def.widths.map((width, joint) => ({
    policyVersion: 'trp1',
    jointId: `joint:${joint}`,
    memberIds: [keys[joint]!, keys[joint + 1]!],
    width,
    lawKind: 'TRANSITION_LINEAR_V1',
    lawVersion: 'v1',
    criterionFamily: 'distance',
    side: 'left',
  }));
  const joints: GroupTransitionExpectationJoint[] = def.widths.map((width, joint) => ({
    jointId: `joint:${joint}`,
    width,
    memberLengths: [def.lengths[joint]!, def.lengths[joint + 1]!] as [number, number],
    isOpen: true,
  }));
  const input: GroupSolveInput = {
    groupId: `perf-${def.id}`,
    revision: 'ggrev1:perf',
    members,
    side: 'left',
    criterion: criteria[0]!,
    memberCriteria: criteria,
    maxSearchDistance: MAX_SEARCH,
    curveChordTolerance: 0.01,
    closed: false,
    // T0 omits the transition fields entirely: pure legacy path. T>=1 carries
    // the plural array (length-1 routes the exact legacy single path).
    ...(intents.length > 0 ? { transitions: intents, transitionMemberKeys: keys } : {}),
  };
  return { def, members, criteria, keys, intents, joints, input };
};

const timePolicy = (fx: Fixture): number => {
  const samples: number[] = [];
  for (let r = 0; r < REPS; r += 1) {
    const t0 = performance.now();
    for (let k = 0; k < INNER_POLICY; k += 1) {
      const sel = selectGroupTransitions(fx.intents);
      if (sel.kind === 'group') {
        const exp = deriveGroupTransitionExpectation(fx.joints);
        if (!exp.ok) throw new Error(`${fx.def.id}: policy must admit (got ${exp.code})`);
      } else if (sel.kind === 'rejected') {
        throw new Error(`${fx.def.id}: selection must not reject`);
      }
    }
    samples.push((performance.now() - t0) / INNER_POLICY);
  }
  return median(samples);
};

const timeSolve = (fx: Fixture): { ms: number; verts: number; tris: number; digest: string } => {
  const samples: number[] = [];
  let verts = 0;
  let tris = 0;
  let digest = '';
  const digests = new Set<string>();
  for (let r = 0; r < REPS; r += 1) {
    const t0 = performance.now();
    for (let k = 0; k < INNER_SOLVE; k += 1) {
      const out = computeGradingGroupFromSnapshots(fx.input);
      if (!out.ok) {
        const fail = out as { ok: false; code: string; detail?: string };
        throw new Error(`${fx.def.id}: solve must admit (got ${fail.code} ${fail.detail ?? ''})`);
      }
      verts = out.result.gradingMesh.points.length / 3;
      tris = out.result.gradingMesh.triangles.length / 3;
      digest = JSON.stringify([out.result.daylightPoints, out.result.gradingMesh.triangles]);
      digests.add(digest);
    }
    samples.push((performance.now() - t0) / INNER_SOLVE);
  }
  if (digests.size !== 1) throw new Error(`${fx.def.id}: solve not deterministic`);
  return { ms: median(samples), verts, tris, digest };
};

const timeWorker = (fx: Fixture): number => {
  if (fx.intents.length === 0) return 0;
  const out = computeGradingGroupFromSnapshots(fx.input);
  if (!out.ok) throw new Error(`${fx.def.id}: worker input requires ok solve`);
  const legs = out.result.transitions ?? (out.result.transition ? [out.result.transition] : []);
  if (legs.length !== fx.intents.length) {
    throw new Error(`${fx.def.id}: leg count ${legs.length} != intent count ${fx.intents.length}`);
  }
  const plans: GroupTransitionPlan[] = legs.map((leg, i) => ({
    ...fx.intents[i]!,
    groupSide: 'left' as const,
    isOpen: true,
    transitionCount: 1,
    jointZ: JOINT_Z,
    endpointEvidence: {
      vL: leg.endpointScalars.vL, vR: leg.endpointScalars.vR,
      gL: leg.endpointScalars.gL, gR: leg.endpointScalars.gR,
    },
    jointStation: leg.jointStation,
    recordedRevision: leg.recordedRevision,
  }));
  const views: GroupTransitionMemberView[][] = legs.map((leg) => {
    const j = Number(/^joint:(\d+)$/.exec(leg.jointId)?.[1] ?? -1);
    return [0, 1].map((k) => {
      const m = j + k;
      return {
        memberId: fx.keys[m]!,
        criterion: fx.criteria[m]!,
        length: fx.def.lengths[m]!,
        dirX: 1, dirY: 0, startZ: JOINT_Z, endZ: JOINT_Z,
        isArc: false, maxSearchDistance: MAX_SEARCH,
      };
    });
  });
  const jointZs = legs.map(() => JOINT_Z);
  const samples: number[] = [];
  for (let r = 0; r < REPS; r += 1) {
    const t0 = performance.now();
    for (let k = 0; k < INNER_SOLVE; k += 1) {
      const agree = checkGroupTransitionPlansAgreement({ plans, views, liveRevision: out.result.revision });
      if (!agree.ok) throw new Error(`${fx.def.id}: worker agreement must hold (got ${agree.code})`);
      const meshReject = validateGroupTransitionLegsMesh({
        plans, legs, views, jointZs,
        liveRevision: out.result.revision,
        maxSearchDistance: MAX_SEARCH,
        daylightPoints: out.result.daylightPoints,
        sourceBoundaryPoints: out.result.sourceBoundaryPoints ?? [],
        side: 'left',
      });
      if (meshReject !== null) throw new Error(`${fx.def.id}: worker mesh gate must hold (got ${meshReject})`);
    }
    samples.push((performance.now() - t0) / INNER_SOLVE);
  }
  return median(samples);
};

const fixtures = ROWS.map(buildFixture);
const solveRows: Array<{ id: string; n: number; members: number; policy: number; solve: number; worker: number; verts: number; tris: number }> = [];
for (const fx of fixtures) {
  const policy = timePolicy(fx);
  const solved = timeSolve(fx);
  const worker = timeWorker(fx);
  solveRows.push({
    id: fx.def.id, n: fx.def.widths.length, members: fx.def.lengths.length,
    policy, solve: solved.ms, worker, verts: solved.verts, tris: solved.tris,
  });
}

for (const r of solveRows) {
  console.log(
    `${r.id} transitions=${r.n} members=${r.members} ` +
    `policyMs=${fmt(r.policy)} solveMs=${fmt(r.solve)} workerMs=${fmt(r.worker)} ` +
    `totalMs=${fmt(r.policy + r.solve + r.worker)} verts=${r.verts} tris=${r.tris}`,
  );
}

// Scaling verdict: incremental solve cost per added transition + vertex growth.
const byId = new Map(solveRows.map((r) => [r.id, r]));
const pairs: Array<[string, string]> = [['T0', 'T1'], ['T1', 'T2'], ['T2', 'T3'], ['T3', 'T8']];
for (const [a, b] of pairs) {
  const ra = byId.get(a)!;
  const rb = byId.get(b)!;
  const dn = rb.n - ra.n;
  const dSolve = rb.solve - ra.solve;
  console.log(
    `scale ${a}->${b}: +${dn} transitions solveDeltaMs=${fmt(dSolve)} ` +
    `perTransitionMs=${dn > 0 ? fmt(dSolve / dn) : 'n/a'} verts ${ra.verts}->${rb.verts} tris ${ra.tris}->${rb.tris}`,
  );
}
