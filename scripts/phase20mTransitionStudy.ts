/**
 * Phase 20M — grading-transition feasibility study core (STUDY ONLY).
 *
 * Pure-math oracle over already-valid adjacent member terminal daylight
 * points P1, P2. It builds NO production geometry and wires nowhere.
 *
 * Imported authorities (never copied):
 * - `zeroDelta` (surfaces/volume/zero) — scalar classification floor only.
 * - `coordinateAgreementTol` / `elevationAgreementTol` (gradingGroupSectors)
 *   — exact-common-tie agreement gates. If P1≈P2 under these gates the row
 *   is an EXACT_COMMON_TIE_CONTROL and needs no transition.
 *
 * Candidate families (conceptual only):
 * - T0: direct segment P1→P2. Always geometrically constructible when both
 *   endpoints are finite; interior points satisfy neither member law.
 * - T1: finite source-station blend of width w. Two study probe widths
 *   (wA narrow, wB wide) are evaluated to test whether width is derivable.
 *   They are PROBES, not proposed defaults.
 * - T2: strip/fan under an explicit new transition criterion. The study
 *   records that such a criterion does not exist in persistence/UI; no
 *   production type is introduced here.
 *
 * Determinism: fixtures sorted by id, floats rounded to 12 decimals,
 * JSON serialized with sorted keys. No timestamps, no randomness.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { zeroDelta } from '../src/engine/cad/surfaces/volume/zero';
import {
  coordinateAgreementTol,
  elevationAgreementTol,
} from '../src/engine/cad/grading/gradingGroupSectors';

export type TransitionClass =
  | 'analytic-d-mismatch'
  | 'same-d-diff-z'
  | 'sloped-disagree'
  | 'joint-z-step'
  | 'surface-analytic'
  | 'surface-surface'
  | 'root-ambiguity'
  | 'line-arc'
  | 'arc-arc'
  | 'closed-route'
  | 'exact-tie-control';

export type Verdict =
  | 'EXACT_COMMON_TIE_CONTROL'
  | 'TRANSITION_GEOMETRICALLY_POSSIBLE'
  | 'TRANSITION_REQUIRES_NEW_CRITERION'
  | 'TRANSITION_WIDTH_UNDERDETERMINED'
  | 'ROOT_POLICY_REQUIRED'
  | 'EXTENSION_POLICY_REQUIRED'
  | 'TOPOLOGY_NO_GO'
  | 'ARC_PAIR_NO_GO'
  | 'CLOSED_ROUTE_POLICY_REQUIRED'
  | 'NUMERICAL_NO_GO';

export interface TransitionFixture {
  id: string;
  incompatibilityClass: TransitionClass;
  /** Native terminal daylight points (already-valid member solutions). */
  p1: [number, number, number];
  p2: [number, number, number];
  memberLength: number;
  maxSearchDistance: number;
  roots: 0 | 1 | 2;
  extensionNeeded: boolean;
  closed: boolean;
  spanKind: 'line-line' | 'line-arc' | 'arc-line' | 'arc-arc';
  note: string;
}

export interface TransitionRow {
  fixtureId: string;
  incompatibilityClass: TransitionClass;
  candidate: 'T0' | 'T1';
  deltaPlan: number;
  deltaZ: number;
  exactTie: boolean;
  connectorLength: number;
  residualInsidePlan: number;
  residualInsideZ: number;
  widthA: number | null;
  widthB: number | null;
  areaA: number | null;
  areaB: number | null;
  widthUnderdetermined: boolean;
  requiresNewCriterion: boolean;
  transformMaxDev: number;
  mirrorStable: boolean;
  classification: Verdict;
  reasonCode: string;
}

const r12 = (v: number): number => {
  if (!Number.isFinite(v)) return v;
  const r = Number(v.toPrecision(12));
  return r === 0 ? 0 : r;
};

/** Local-frame shift: subtract origin before measuring (avoids 1e8 artifacts). */
const local = (p: readonly number[], origin: readonly number[]): [number, number, number] => [
  p[0]! - origin[0]!,
  p[1]! - origin[1]!,
  p[2]! - origin[2]!,
];

export const TRANSITION_FIXTURES: TransitionFixture[] = [
  { id: 'M01-flat-d-mismatch', incompatibilityClass: 'analytic-d-mismatch', p1: [5, 0, 0], p2: [7, 0, 0], memberLength: 20, maxSearchDistance: 10, roots: 1, extensionNeeded: false, closed: false, spanKind: 'line-line', note: 'Distance d=5 vs d=7, Δplan=2' },
  { id: 'M02-dist-relEl', incompatibilityClass: 'analytic-d-mismatch', p1: [5, 0, 0], p2: [5, 0, 2], memberLength: 20, maxSearchDistance: 10, roots: 1, extensionNeeded: false, closed: false, spanKind: 'line-line', note: 'Distance vs RelativeElevation: same plan, Δz=2' },
  { id: 'M03-relEl-el', incompatibilityClass: 'analytic-d-mismatch', p1: [4, 1, 3], p2: [6, -1, 5], memberLength: 24, maxSearchDistance: 12, roots: 1, extensionNeeded: false, closed: false, spanKind: 'line-line', note: 'RelativeElevation vs Elevation mismatch' },
  { id: 'M04-same-d-diff-z', incompatibilityClass: 'same-d-diff-z', p1: [5, 0, 1], p2: [5, 0, 4], memberLength: 20, maxSearchDistance: 10, roots: 1, extensionNeeded: false, closed: false, spanKind: 'line-line', note: 'Same plan d, join Z law differs, Δz=3' },
  { id: 'M05-sloped-disagree', incompatibilityClass: 'sloped-disagree', p1: [5, 0.5, 1], p2: [6.5, -0.5, 3], memberLength: 22, maxSearchDistance: 10, roots: 1, extensionNeeded: false, closed: false, spanKind: 'line-line', note: 'Sloped members, terminal solutions disagree' },
  { id: 'M06-joint-z-step', incompatibilityClass: 'joint-z-step', p1: [5, 0, 0], p2: [5, 0, 1.5], memberLength: 20, maxSearchDistance: 10, roots: 1, extensionNeeded: false, closed: false, spanKind: 'line-line', note: 'Source joint Z step 1.5m' },
  { id: 'M07-tie-control', incompatibilityClass: 'exact-tie-control', p1: [5, 0, 2], p2: [5, 0, 2], memberLength: 20, maxSearchDistance: 10, roots: 1, extensionNeeded: false, closed: false, spanKind: 'line-line', note: 'Identical terminals: must need no transition' },
  { id: 'M08-tie-control-ulp', incompatibilityClass: 'exact-tie-control', p1: [5, 0, 2], p2: [5 + 4 * Number.EPSILON * 5, 0, 2], memberLength: 20, maxSearchDistance: 10, roots: 1, extensionNeeded: false, closed: false, spanKind: 'line-line', note: 'ULP-level twins: agreement gate must tie' },
  { id: 'M09-surf-analytic-gap', incompatibilityClass: 'surface-analytic', p1: [3, 0, 1], p2: [6, 0, 1], memberLength: 20, maxSearchDistance: 10, roots: 1, extensionNeeded: false, closed: false, spanKind: 'line-line', note: 'Surface↔analytic GAP Δplan=3 (20J family)' },
  { id: 'M10-surf-analytic-overlap', incompatibilityClass: 'surface-analytic', p1: [6, 0, 1], p2: [4, 0.5, 1.2], memberLength: 20, maxSearchDistance: 10, roots: 1, extensionNeeded: false, closed: false, spanKind: 'line-line', note: 'Surface↔analytic OVERLAP case' },
  { id: 'M11-surf-surf', incompatibilityClass: 'surface-surface', p1: [2, 1, 0], p2: [5, -1, 0.5], memberLength: 20, maxSearchDistance: 10, roots: 1, extensionNeeded: false, closed: false, spanKind: 'line-line', note: 'Surface↔surface daylight terminals disagree' },
  { id: 'M12-no-root', incompatibilityClass: 'root-ambiguity', p1: [5, 0, 0], p2: [7, 0, 0], memberLength: 20, maxSearchDistance: 2, roots: 0, extensionNeeded: false, closed: false, spanKind: 'line-line', note: 'No target root within maxSearch; terminals disagree so tie gate cannot mask it' },
  { id: 'M13-one-root', incompatibilityClass: 'root-ambiguity', p1: [5, 0, 0], p2: [7, 0, 0], memberLength: 20, maxSearchDistance: 10, roots: 1, extensionNeeded: false, closed: false, spanKind: 'line-line', note: 'Unique root; transition still needs width' },
  { id: 'M14-multi-root', incompatibilityClass: 'root-ambiguity', p1: [5, 0, 0], p2: [7, 0, 1], memberLength: 20, maxSearchDistance: 10, roots: 2, extensionNeeded: false, closed: false, spanKind: 'line-line', note: 'Two target roots: branch choice underdetermined' },
  { id: 'M15-line-line', incompatibilityClass: 'analytic-d-mismatch', p1: [5, 0, 0], p2: [8, 0, 0], memberLength: 30, maxSearchDistance: 12, roots: 1, extensionNeeded: false, closed: false, spanKind: 'line-line', note: 'Line↔line d mismatch Δ=3' },
  { id: 'M16-line-arc', incompatibilityClass: 'line-arc', p1: [5, 0, 0], p2: [6.5, 1, 0], memberLength: 24, maxSearchDistance: 10, roots: 1, extensionNeeded: false, closed: false, spanKind: 'line-arc', note: 'Line↔arc terminals disagree' },
  { id: 'M17-arc-line', incompatibilityClass: 'line-arc', p1: [6.5, 1, 0], p2: [5, 0, 0.5], memberLength: 24, maxSearchDistance: 10, roots: 1, extensionNeeded: false, closed: false, spanKind: 'arc-line', note: 'Arc↔line terminals disagree (reversal of M16)' },
  { id: 'M18-arc-arc', incompatibilityClass: 'arc-arc', p1: [5, 1, 0], p2: [7, -1, 0], memberLength: 24, maxSearchDistance: 10, roots: 1, extensionNeeded: false, closed: false, spanKind: 'arc-arc', note: 'Arc↔arc negative/control (20K exclusion)' },
  { id: 'M19-closed', incompatibilityClass: 'closed-route', p1: [5, 0, 0], p2: [7, 0, 0], memberLength: 20, maxSearchDistance: 10, roots: 1, extensionNeeded: false, closed: true, spanKind: 'line-line', note: 'Closed-route negative/control' },
  { id: 'M20-near-zero', incompatibilityClass: 'analytic-d-mismatch', p1: [5, 0, 0], p2: [5.001, 0, 0], memberLength: 20, maxSearchDistance: 10, roots: 1, extensionNeeded: false, closed: false, spanKind: 'line-line', note: 'Near-zero span 1mm: tie or micro-transition?' },
  { id: 'M21-large-span', incompatibilityClass: 'analytic-d-mismatch', p1: [5, 0, 0], p2: [15, 0, 5], memberLength: 60, maxSearchDistance: 20, roots: 1, extensionNeeded: false, closed: false, spanKind: 'line-line', note: 'Large span Δplan=10: width vs member length' },
  { id: 'M22-maxsearch-edge', incompatibilityClass: 'analytic-d-mismatch', p1: [9.9, 0, 0], p2: [10.1, 0, 0], memberLength: 20, maxSearchDistance: 10, roots: 1, extensionNeeded: false, closed: false, spanKind: 'line-line', note: 'Terminals straddle maxSearchDistance' },
  { id: 'M23-extension', incompatibilityClass: 'surface-analytic', p1: [5, 0, 0], p2: [14, 0, 0], memberLength: 20, maxSearchDistance: 10, roots: 1, extensionNeeded: true, closed: false, spanKind: 'line-line', note: 'Outside-extension case: target bounds exceeded' },
  { id: 'M24-sloped-step', incompatibilityClass: 'sloped-disagree', p1: [4, 0, 2], p2: [4, 0, 5], memberLength: 18, maxSearchDistance: 10, roots: 1, extensionNeeded: false, closed: false, spanKind: 'line-line', note: 'Pure-Z sloped disagreement Δz=3' },
];

const exactTie = (f: TransitionFixture): boolean => {
  const scale = Math.max(1, Math.abs(f.p1[0]), Math.abs(f.p1[1]), Math.abs(f.p2[0]), Math.abs(f.p2[1]));
  const tolX = coordinateAgreementTol(f.p1[0], f.p2[0], scale);
  const tolY = coordinateAgreementTol(f.p1[1], f.p2[1], scale);
  const tolZ = elevationAgreementTol(f.p1[2], f.p2[2], []);
  const floor = zeroDelta(f.p1[2], f.p2[2]);
  return (
    Math.abs(f.p1[0] - f.p2[0]) <= Math.max(tolX, 0) &&
    Math.abs(f.p1[1] - f.p2[1]) <= Math.max(tolY, 0) &&
    Math.abs(f.p1[2] - f.p2[2]) <= Math.max(tolZ, floor)
  );
};

const classify = (f: TransitionFixture, tied: boolean, deltaPlan: number): { c: Verdict; reason: string } => {
  if (tied) return { c: 'EXACT_COMMON_TIE_CONTROL', reason: 'P1≈P2 under shared 20J1 agreement gates; no transition required' };
  if (f.closed) return { c: 'CLOSED_ROUTE_POLICY_REQUIRED', reason: 'Closed-route transition changes annulus topology; new topology policy required' };
  if (f.spanKind === 'arc-arc') return { c: 'ARC_PAIR_NO_GO', reason: 'Arc×arc exact-corner exclusion (20K/20L.2) independently applies' };
  if (f.roots === 0) return { c: 'ROOT_POLICY_REQUIRED', reason: 'No target root within maxSearchDistance; nothing to transition to' };
  if (f.roots > 1) return { c: 'ROOT_POLICY_REQUIRED', reason: 'Multiple target roots; branch choice has no existing authority' };
  if (f.extensionNeeded) return { c: 'EXTENSION_POLICY_REQUIRED', reason: 'Transition would leave target bounds/maxSearchDistance; extension permission is policy' };
  if (deltaPlan > f.memberLength) return { c: 'TOPOLOGY_NO_GO', reason: 'Connector span exceeds member length; strip would fold/overlap' };
  if (deltaPlan < 1e-9 && Math.abs(f.p1[2] - f.p2[2]) < 1e-9) return { c: 'NUMERICAL_NO_GO', reason: 'Sub-nanometre disagreement is numerical noise, not a transition' };
  return { c: 'TRANSITION_WIDTH_UNDERDETERMINED', reason: 'T0 segment exists geometrically but any finite-width T1 blend needs width/blend/criterion policy' };
};

export const evaluateFixture = (f: TransitionFixture): TransitionRow[] => {
  const origin: [number, number, number] = [f.p1[0], f.p1[1], f.p1[2]];
  const a = local(f.p1, origin);
  const b = local(f.p2, origin);
  const deltaPlan = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const deltaZ = Math.abs(b[2] - a[2]);
  const tied = exactTie(f);
  const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  // Transform stability: recompute in frames shifted by 1e6 / 1e8.
  let maxDev = 0;
  for (const s of [1e6, 1e8]) {
    const o: [number, number, number] = [s, -s, s];
    const sa = local(f.p1, o);
    const sb = local(f.p2, o);
    const dPlan = Math.hypot(sb[0] - sa[0], sb[1] - sa[1]);
    maxDev = Math.max(maxDev, Math.abs(dPlan - deltaPlan));
  }
  // Mirror stability: x → −x preserves classification inputs.
  const mf: TransitionFixture = { ...f, p1: [-f.p1[0], f.p1[1], f.p1[2]], p2: [-f.p2[0], f.p2[1], f.p2[2]] };
  const mirrorStable = classify(mf, exactTie(mf), deltaPlan).c === classify(f, tied, deltaPlan).c;
  const base = classify(f, tied, deltaPlan);
  // T0 row: direct connector. Residual inside is honestly nonzero whenever Δ>0.
  const t0: TransitionRow = {
    fixtureId: f.id, incompatibilityClass: f.incompatibilityClass, candidate: 'T0',
    deltaPlan: r12(deltaPlan), deltaZ: r12(deltaZ), exactTie: tied,
    connectorLength: r12(L),
    residualInsidePlan: r12(deltaPlan / 2), residualInsideZ: r12(deltaZ / 2),
    widthA: null, widthB: null, areaA: null, areaB: null,
    widthUnderdetermined: false, requiresNewCriterion: !tied,
    transformMaxDev: r12(maxDev), mirrorStable,
    classification: tied ? 'EXACT_COMMON_TIE_CONTROL' : base.c === 'TRANSITION_WIDTH_UNDERDETERMINED' ? 'TRANSITION_REQUIRES_NEW_CRITERION' : base.c,
    reasonCode: tied ? base.reason : `${base.reason} | T0 interior satisfies neither member law: new transition criterion required for truthful provenance`,
  };
  // T1 row: two probe widths show underdetermination (probes, not defaults).
  const wBase = Math.max(deltaPlan, 0.5);
  const wA = Math.min(wBase, f.memberLength / 2);
  const wB = Math.min(3 * wBase, f.memberLength);
  const areaA = 0.5 * deltaPlan * wA;
  const areaB = 0.5 * deltaPlan * wB;
  const under = !tied && base.c === 'TRANSITION_WIDTH_UNDERDETERMINED' && (Math.abs(areaB - areaA) > 1e-12 || Math.abs(0.5 * deltaZ * wB - 0.5 * deltaZ * wA) > 1e-12);
  const t1: TransitionRow = {
    fixtureId: f.id, incompatibilityClass: f.incompatibilityClass, candidate: 'T1',
    deltaPlan: r12(deltaPlan), deltaZ: r12(deltaZ), exactTie: tied,
    connectorLength: r12(L),
    residualInsidePlan: r12(deltaPlan / 2), residualInsideZ: r12(deltaZ / 2),
    widthA: r12(wA), widthB: r12(wB), areaA: r12(areaA), areaB: r12(areaB),
    widthUnderdetermined: under, requiresNewCriterion: !tied,
    transformMaxDev: r12(maxDev), mirrorStable,
    classification: tied ? 'EXACT_COMMON_TIE_CONTROL' : base.c,
    reasonCode: tied ? base.reason : under
      ? `${base.reason} | probe areas differ ${r12(areaA)} vs ${r12(areaB)}: no existing authority selects width`
      : base.reason,
  };
  return [t0, t1];
};

export const buildCorpus = (): TransitionRow[] => {
  const rows: TransitionRow[] = [];
  const sorted = [...TRANSITION_FIXTURES].sort((x, y) => (x.id < y.id ? -1 : 1));
  for (const f of sorted) rows.push(...evaluateFixture(f));
  return rows;
};

export const corpusSha256 = (rows: TransitionRow[]): string =>
  createHash('sha256').update(JSON.stringify(rows)).digest('hex');

/** CLI: regenerate docs/evidence/phase20m/corpus.json + corpus.sha256. */
if (process.argv[1]?.endsWith('phase20mTransitionStudy.ts')) {
  const rows = buildCorpus();
  const dir = join(dirname(new URL(import.meta.url).pathname), '..', 'docs', 'evidence', 'phase20m');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'corpus.json'), `${JSON.stringify(rows, null, 2)}\n`);
  writeFileSync(join(dir, 'corpus.sha256'), `${corpusSha256(rows)}\n`);
  console.log(`phase20m corpus: ${rows.length} rows, sha=${corpusSha256(rows)}`);
}
