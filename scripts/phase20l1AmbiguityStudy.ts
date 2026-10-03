/**
 * Phase 20L.1 Task 3 — ambiguity / branch-policy STUDY (evidence only).
 *
 * Evaluates a candidate B1 "signed continuity" rule against every join
 * fixture (all 12 AMBIGUOUS + the rest) and purpose-built line→long-arc
 * crossing / near-tangent cases, then exercises the invariances the rule
 * would need (translation, rotation, scaling, member-order reversal).
 *
 * STUDY-ONLY vocabulary (never a production enum):
 *   OFFSET_POLICY_JOIN_CONTINUOUS  unique admissible branch, B1 claims it
 *   OFFSET_POLICY_JOIN_AMBIGUOUS   >=2 admissible branches, fail-closed
 *   OFFSET_POLICY_JOIN_EXTENSION   branches exist but none on the bodies
 *   OFFSET_POLICY_JOIN_UNRESOLVED  count unknowable (coincident/noise)
 *   OFFSET_POLICY_JOIN_NONE        no branch
 * Zero `src/` changes; nothing here is wired anywhere.
 */
import type { GradingSide } from '../src/engine/cad/grading/gradingTypes';
import type { MemberSpec } from './phase20lOffsetJoinCore';
import { classifyOffsetJoin, type JoinCandidate, type OffsetJoinResult } from './phase20lOffsetJoinCore';
import {
  JOIN_FIXTURES,
  arcMember,
  fixture,
  lineMember,
  transformInput,
  type JoinFixture,
} from './phase20lOffsetRadiusVariants';

const V = { vx: 0, vy: 0 } as const;
const X = { nx: 1, ny: 0 };
const Y = { nx: 0, ny: 1 };

type PolicyLabel =
  | 'OFFSET_POLICY_JOIN_CONTINUOUS'
  | 'OFFSET_POLICY_JOIN_AMBIGUOUS'
  | 'OFFSET_POLICY_JOIN_EXTENSION'
  | 'OFFSET_POLICY_JOIN_UNRESOLVED'
  | 'OFFSET_POLICY_JOIN_NONE';

/** Admissible = on both member bodies AND signed-branch consistent. */
const admissible = (c: JoinCandidate): boolean => c.inSpan && c.branchConsistent;

interface B1Outcome {
  label: PolicyLabel;
  selected: JoinCandidate | null;
  admissibleCount: number;
  /** traversal order (uIn ascending = forward along incoming travel). */
  order: number[];
}

/**
 * B1 — signed continuity. The join is the UNIQUE offset-curve intersection
 * that (a) lies on both member bodies (not an extension) and (b) matches the
 * signed branch of the corner (GAP: uIn>=0 & uOut<=0; OVERLAP: opposite).
 * With >=2 such branches there is no direction-independent continuation and
 * B1 must fail closed (nearest |J-V| is a heuristic; traversal-order tiebreak
 * is not member-order-reversal invariant).
 */
const b1Select = (r: OffsetJoinResult): B1Outcome => {
  const adm = r.candidates.filter(admissible);
  const order = r.candidates.map((c) => c.uIn).sort((a, b) => a - b);
  if (r.detail.includes('unresolved') || r.detail.includes('infinite')) {
    return { label: 'OFFSET_POLICY_JOIN_UNRESOLVED', selected: null, admissibleCount: 0, order };
  }
  if (adm.length === 1) return { label: 'OFFSET_POLICY_JOIN_CONTINUOUS', selected: adm[0]!, admissibleCount: 1, order };
  if (adm.length >= 2) return { label: 'OFFSET_POLICY_JOIN_AMBIGUOUS', selected: null, admissibleCount: adm.length, order };
  const localConsistent = r.candidates.filter((c) => c.local && c.branchConsistent);
  if (localConsistent.length > 0) return { label: 'OFFSET_POLICY_JOIN_EXTENSION', selected: null, admissibleCount: 0, order };
  return { label: 'OFFSET_POLICY_JOIN_NONE', selected: null, admissibleCount: 0, order };
};

const f6 = (v: number): string => (Number.isFinite(v) ? v.toFixed(6) : String(v));

const row = (id: string, r: OffsetJoinResult): string => {
  const b = b1Select(r);
  const loc = r.candidates.filter((c) => c.local).length;
  const con = r.candidates.filter((c) => c.branchConsistent).length;
  const insp = r.candidates.filter((c) => c.inSpan).length;
  return `${id.padEnd(24)} cls=${r.classification.replace('OFFSET_JOIN_', '').padEnd(17)} int=${r.intersections.length} local=${loc} cons=${con} inspan=${insp} admissible=${b.admissibleCount} B1=${b.label.replace('OFFSET_POLICY_JOIN_', '')}`;
};

// ── purpose-built synthetic cases ─────────────────────────────────────────

/** line→arc, long incoming body + large outgoing sweep: BOTH intersections on both bodies. */
const synthLongArc = (): JoinFixture =>
  fixture(
    'SYN_LA_CROSS_2INSPAN',
    'line→arc left, incoming L=300 + outgoing 180° sweep: both offset intersections land on both bodies',
    lineMember(V.vx, V.vy, X, 300, 'incoming'),
    arcMember(V.vx, V.vy, -50, 0, 50, 1, Math.PI, 'outgoing'),
    'left',
  );

/** near-tangent: R = 2d +/- eps around the constructed tangent. */
const synthNearTangent = (radius: number): JoinFixture =>
  fixture(
    `SYN_LA_NEAR_TANGENT_R${radius}`,
    'line→arc R≈2d: branch pair merges at tangency; no epsilon may be introduced',
    lineMember(V.vx, V.vy, X, 40, 'incoming'),
    arcMember(V.vx, V.vy, -radius, 0, radius, 1, Math.PI / 2, 'outgoing'),
    'left',
    5,
  );

// ── invariance helpers (study-local; not production) ──────────────────────

const scaleInput = (
  input: JoinFixture['input'],
  k: number,
): JoinFixture['input'] => {
  const m = (mem: MemberSpec): MemberSpec =>
    mem.kind === 'line'
      ? { ...mem, vx: mem.vx * k, vy: mem.vy * k, spanStart: mem.spanStart * k, spanEnd: mem.spanEnd * k }
      : { ...mem, vx: mem.vx * k, vy: mem.vy * k, cx: mem.cx * k, cy: mem.cy * k, radius: mem.radius * k, spanStart: mem.spanStart * k, spanEnd: mem.spanEnd * k };
  return { ...input, incoming: m(input.incoming), outgoing: m(input.outgoing), offset: input.offset * k, maxSearchDistance: input.maxSearchDistance * k };
};

/** Reverse the chain: swap roles, negate travel, flip side. */
const reverseInput = (input: JoinFixture['input']): JoinFixture['input'] => {
  const rev = (mem: MemberSpec, direction: 'incoming' | 'outgoing'): MemberSpec => {
    const a = Math.abs(mem.spanStart);
    const b = Math.abs(mem.spanEnd);
    const length = Math.max(a, b);
    const spanStart = direction === 'incoming' ? -length : 0;
    const spanEnd = direction === 'incoming' ? 0 : length;
    if (mem.kind === 'line') {
      return { ...mem, tx: -mem.tx, ty: -mem.ty, spanStart, spanEnd };
    }
    return { ...mem, dir: (mem.dir === 1 ? -1 : 1) as 1 | -1, spanStart, spanEnd };
  };
  return {
    ...input,
    incoming: rev(input.outgoing, 'incoming'),
    outgoing: rev(input.incoming, 'outgoing'),
    side: (input.side === 'left' ? 'right' : 'left') as GradingSide,
    incomingSide: input.incomingSide ? (input.incomingSide === 'left' ? 'right' : 'left') : undefined,
    outgoingSide: input.outgoingSide ? (input.outgoingSide === 'left' ? 'right' : 'left') : undefined,
  };
};

const main = (): void => {
  const fixtures = [...JOIN_FIXTURES, synthLongArc(), synthNearTangent(9.999999), synthNearTangent(10), synthNearTangent(10.000001)];
  console.log('## All fixtures — B1 signed-continuity evaluation\n');
  for (const f of fixtures) console.log(row(f.id, classifyOffsetJoin(f.input)));

  console.log('\n## Ambiguous fixture candidate detail\n');
  for (const f of JOIN_FIXTURES) {
    const r = classifyOffsetJoin(f.input);
    if (r.classification !== 'OFFSET_JOIN_AMBIGUOUS') continue;
    const b = b1Select(r);
    console.log(`${f.id}: B1=${b.label.replace('OFFSET_POLICY_JOIN_', '')} (adm=${b.admissibleCount})`);
    for (const c of r.candidates) {
      console.log(`    uIn=${f6(c.uIn)} uOut=${f6(c.uOut)} |J-V|=${f6(c.distV)} cons=${c.branchConsistent} inspan=${c.inSpan} adm=${admissible(c)}`);
    }
  }

  console.log('\n## Invariance on the two body-internal-branch cases\n');
  const crossing = [synthLongArc(), JOIN_FIXTURES.find((f) => f.id === 'AA_CCW_CCW_OVERLAP')!];
  for (const f of crossing) {
    const base = b1Select(classifyOffsetJoin(f.input));
    const rot = b1Select(classifyOffsetJoin(transformInput(f.input, 0.9, 123.4, -56.7)));
    const sca = b1Select(classifyOffsetJoin(scaleInput(f.input, 1e3)));
    const rev = b1Select(classifyOffsetJoin(reverseInput(f.input)));
    console.log(`${f.id}: base=${base.label.replace('OFFSET_POLICY_JOIN_', '')} adm=${base.admissibleCount}`);
    for (const r of [classifyOffsetJoin(f.input), classifyOffsetJoin(reverseInput(f.input))]) {
      const adm = r.candidates.filter(admissible);
      const near = adm.reduce((a, b) => (b.distV < a.distV ? b : a));
      const first = adm.reduce((a, b) => (b.uIn < a.uIn ? b : a)); // forward traversal order
      console.log(`    adm J=${adm.map((c) => `(${f6(c.x)},${f6(c.y)})`).join(' ')} | nearest=(${f6(near.x)},${f6(near.y)}) first=(${f6(first.x)},${f6(first.y)}) DISAGREE=${near.x !== first.x || near.y !== first.y}`);
    }
    console.log(`    rot=${rot.label.replace('OFFSET_POLICY_JOIN_', '')} adm=${rot.admissibleCount}`);
    console.log(`    scale=${sca.label.replace('OFFSET_POLICY_JOIN_', '')} adm=${sca.admissibleCount}`);
    console.log(`    reversed=${rev.label.replace('OFFSET_POLICY_JOIN_', '')} adm=${rev.admissibleCount}`);
  }

  console.log('\n## Near-tangent branch-count stability\n');
  for (const f of fixtures.filter((x) => x.id.startsWith('SYN_LA_NEAR_TANGENT') || x.id === 'LA_TANGENT_CONTACT')) {
    const r = classifyOffsetJoin(f.input);
    console.log(`${f.id.padEnd(34)} cls=${r.classification.replace('OFFSET_JOIN_', '').padEnd(17)} disc=${f6(r.conditioning.value)} illCond=${r.conditioning.illConditioned} detail=${r.detail}`);
  }

  // Self-check: these are the facts the B0 verdict rests on. If a future
  // classifier change alters them, the study must be re-evaluated.
  const assert = (cond: boolean, msg: string): void => {
    if (!cond) throw new Error(`20L.1 Task 3 study invariant broken: ${msg}`);
  };
  assert(b1Select(classifyOffsetJoin(synthLongArc().input)).admissibleCount === 2, 'SYN_LA_CROSS_2INSPAN no longer has 2 admissible branches');
  assert(b1Select(classifyOffsetJoin(JOIN_FIXTURES.find((f) => f.id === 'AA_CCW_CCW_OVERLAP')!.input)).admissibleCount === 2, 'AA_CCW_CCW_OVERLAP no longer has 2 admissible branches');
  assert(classifyOffsetJoin(synthNearTangent(9.999999).input).classification === 'OFFSET_JOIN_NONE', 'near-tangent below no longer NONE');
  assert(classifyOffsetJoin(synthNearTangent(10.000001).input).detail === '2-local-joins', 'near-tangent above no longer 2-local');
  console.log('\nSELF-CHECK OK: B0 evidence facts hold.');
};

main();
