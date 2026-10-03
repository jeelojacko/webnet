# Phase 20M.1 — Bounded Transition Policy Resolution Decision

- Baseline: `main` at `3fe69f22103b1d242538a0a205a0774e145afde5`.
- Branch: `research/phase20m1-transition-policy-resolution`.
- Scope: POLICY / EVIDENCE / DESIGN ONLY. Zero `src/` changes. No transition
  geometry in production, no 20L.2 widening, no 20J/20K.3 relaxation, no
  persistence/schema/UI/worker/product change. All 14 stashes preserved.
- Predecessor: Phase 20M merged and closed, verdict
  `POLICY_REQUIRED_TRANSITION` (`docs/evidence/phase20m/decision.md`): eight
  unanswered choices (width, interior law, branch, extension, no-root, closed,
  arcs, sloped/joint-step Z). This phase answers the minimum contract for ONE
  narrow candidate or proves NO-GO.
- Study core: `scripts/phase20m1TransitionPolicyStudy.ts` (pure-math oracle;
  imports `zeroDelta`, `coordinateAgreementTol`, `elevationAgreementTol`,
  `resolveAnalyticCriterionAt` read-only, never copies).
- Corpus: `docs/evidence/phase20m1/corpus.json` (47 rows, every row
  `synthetic: true`), `corpus.sha256`
  (`ab79e5ba8027e12a37e4378e8957b9e36687940719aca304c1b46ff72b1ce067`,
  regen twice cross-process byte-identical), pins in
  `tests/cad_grading_transition_policy_20m1.test.ts` (14/14).
- Specs: `forensics.md` (authorities), `persisted-model.md` (persisted object
  spec), `worker-topology-product.md` (worker/topology/product spec).
- Verdict: **PARTIAL_GO_COLLINEAR_SAME_FAMILY_TRANSITION** (defined in §9).

## 1. What was tested

The candidate is a deliberately narrow same-family analytic transition:
OPEN group, line-source members, joint-continuous XYZ, flat members, same
grading side, same target-free analytic family on both sides with EXACTLY
EQUAL gradeRatio (`gL===gR`; grade-mismatch rows reject — scalar C0 alone
cannot preserve plan/Z, see §3),
(Distance↔Distance scalar `d`; RelativeElevation↔RelativeElevation scalar
`Δz`; flat Elevation↔flat Elevation scalar `E`), natives authoritative
outside the interval, a NEW versioned transition law inside (linear scalar
interpolation over source station), explicit persisted total width `W`
symmetric about the joint (`sL=-W/2`, `sR=+W/2`, meters of source-line
distance), no Surface/hybrid target, no roots ambiguity, no extension, no
closed route, no arcs, no sloped/joint-step Z. Corpus: 21 angle rows (3
families × 0/5/15/45/90/135/179°), 3 controls, 3 grade-mismatch, 3 width-bound, 4
width-invalid, touch/overlap pair, 4 transforms, 7 excluded-class controls.

## 2. Width ownership — W2 selected, W1 rejected (Q1)

- **W1 automatic derivation: REJECTED.** No existing authority (geometry,
  delta, member length, tolerance, maxSearch) selects width; 20M proved 3×
  divergence between bare probes. Nothing in 20M.1 revives derivation.
- **W2 explicit persisted user width: SELECTED** with this exact contract:
  - `W` is the TOTAL interval length in meters of source-line distance
    (line-only phase; chord-vs-arc measure moot, no sagitta).
  - Checks: `Number.isFinite(W) && W > 0` (zero/negative/NaN/Infinity
    reject — corpus `width-zero/neg/nan/inf` all reject).
  - Bound: `W <= 2·min(LL,LR)` — each side needs `W/2` of available source
    length. Exact, no epsilon: `width-max` (`W==max`) admits,
    `width-max-eps` (`max+0.002`) rejects, `width-too-long` rejects.
  - Symmetric about the joint; separately persisted left/right extents are
    NOT admitted in the first candidate (unneeded expressiveness, doubles
    the invalidation surface).
  - Overlap law: the FIRST 20M.2 production predicate authorizes EXACTLY ONE
    transition per group (cardinality <= 1 for policyVersion `trp1`), so
    interval separation is vacuous in production — there is no sibling
    interval to separate from. The pair-interval math below is synthetic
    future-multiple policy evidence only and does NOT authorize
    multi-transition production; strict separation alone is NOT sufficient
    for production multiples. Touching is scalar interval occupancy only
    (corpus `touch-pair`: shares `s=4`, occupancy admits, production
    rejects); overlap rejects with shared-interior bounds.
  - Boundary equality is exact (`<=` admits equality, `>` rejects); no
    epsilon is invented or needed.

## 3. Interior law — linear scalar interpolation AS LEGISLATED POLICY (Q2)

- Same-family scalar law per family: Distance `d(s)`, RelativeElevation
  `Δz(s)`, flat Elevation `E(s)` (flat-only; sloped/stepped excluded):
  `v(s) = vL + (vR−vL)·t`, `t=(s−sL)/(sR−sL)`, under the EXACT equal-grade
  gate `gL===gR` (no grade interpolation, ever). Corpus grade-mismatch rows
  (one per family, 0.5 vs 0.75) reject with nonzero mid-interval plan/Z
  grade gaps: Distance Z gap 1.5, RelEl/Elevation plan gap 2 — the evidenced
  obstruction that forces the gate. All admitted collinear rows show zero
  plan/Z grade gap in all 3 families.
- The law equals the left native at `sL` and the right native at `sR`
  (scalar C0 exact by construction, corpus `c0Gap==0` all admitted rows).
- It is a NEW first-class transition criterion
  (proposed id `TRANSITION_LINEAR_V1`, see `persisted-model.md`), never an
  "exact tie": interiors satisfy neither native law whenever `vL≠vR`.
- Linear vs smoothstep differ materially: max `|linear−smoothstep| ≈
  0.096·|vR−vL|` (0.192 for `d=5vs7`, corpus `maxLinSmooth`). No authority
  selects linear — it is a **product legislation choice**, versioned so a
  future smooth law can coexist. The phase does not pretend linear is
  derived.
- Criterion honesty: flat Elevation↔flat Elevation stays truthful because
  the interior cites the transition law, never either native `E`; mixed
  families (Distance↔RelEl, Distance↔Elevation) are excluded
  (`ex-hybrid`, `ex-mixed-elev` reject).
- Exact equal gradeRatio (`gL===gR`, no interpolation): scalar `v(s)` is
  single-valued but plan/Z derivation needs each side's grade — differing
  grades leave the interior underdetermined, so grade mismatch rejects in
  all 3 families with evidenced nonzero gaps (`grade-dist` Z gap,
  `grade-relel`/`grade-elev` plan gaps). The worker re-checks equality from
  re-resolved criteria, never from a snapshot.

## 4. Geometric / continuity sufficiency — COLLINEAR ONLY (Q3/Q4-angle)

- Scalar C0 holds at all angles, but daylight direction breaks by exactly
  the source deflection: corpus `kinkDeg == angleDeg` within 1e-9 on all 21
  angle rows, recorded honestly, never masked.
- `foldover=true` past perpendicular only (135/179°; exactly 90° is
  perpendicular, not doubling back). A
  continuous scalar cannot repair a discontinuous frame: the obstruction is
  the source direction change itself, not the law.
- Per §C.3 the candidate is therefore **narrowed to collinear line-line
  only** (`angleDeg==0`, `kinkDeg==0`, no foldover) for the first production
  contract. Shallow angles (5/15°) are NOT smuggled in: their kink is real
  (5/15°) and mesh-level consequences are unproven here.
- Oracle limits (honest): continuity is proven at scalar level only
  (by-construction endpoint equality of the legislated scalar, plus zero
  mid-interval plan/Z grade gap under exact equal grade). Even collinear
  daylight POSITION continuity is a study-oracle derivation, not a measured
  mesh sweep. No C1 is claimed anywhere. `transformDev` for 1e6/1e8 shifts is
  an analytic ε-scaled illustration (`|shift|·EPSILON`, ~2e-8 at 1e8), not a
  measured float sweep; mirror/reversal stability is exact
  classification-symmetry. Reversal coverage is symmetry-only (the harness
  evaluates the same deflection), flagged as weak, not as mesh proof.

## 5. Multiple transitions (Q5) — FIRST PRODUCTION IS ONE-TRANSITION-ONLY

- Strict no-overlap predicate over real adjacent intervals
  (`I1=[-W/2,+W/2]`, `I2=[gap-W/2,gap+W/2]`, reject on positive shared
  interior) governs scalar occupancy evidence. `touch-pair` (gap 8, shares
  station `s=4` only) is occupancy-only, `overlap-pair` (gap 7, shares
  interior `(3,4)`) rejects — both rows are SYNTHETIC future-multiple
  policy evidence only and do NOT authorize multi-transition production.
  No multi-transition mesh, certificate, or worker interaction is measured
  or implemented in 20M.1; strict separation alone is NOT sufficient for
  production multiples.
- FIRST 20M.2 production predicate: EXACTLY ONE transition per group
  (cardinality <= 1 for policyVersion `trp1`; a second transition object
  rejects). Any overlap (or touching, for production) fails closed.

## 6. Remaining 20M choices — resolved by explicit exclusion (Q5-second)

For the first production candidate: multi-root excluded, extension
excluded, no-root excluded, closed excluded, arcs/arc-pair excluded, sloped
or joint-step Z excluded, mixed criterion families excluded, non-collinear
source excluded. All 7 excluded controls reject with `REJECT excluded
class`; existing production behavior (TRANSITION_REQUIRED and sibling
fail-closed gates) is unchanged. These exclusions are bounded policy
answers, not general solutions.

## 7. Persisted model / worker / topology / product (Q6/Q7/Q8)

- Persisted (spec, `persisted-model.md`): additive optional transition
  object — policy/version tag (`TRANSITION_LINEAR_V1`), stable
  `joint:${j}` + `courseCriterionKey` identity, explicit symmetric `W`
  (meters source-line) with the §2 invariants, law kind/version +
  criterion family, endpoint scalar REFERENCES to authoritative member
  criteria (resolved values pinned at revision for reproducibility),
  grading side, provenance refs. No silent defaults; old files without the
  object behave exactly as today; malformed/stale metadata fails closed;
  member/source edits invalidate and recompute.
- Worker (spec, `worker-topology-product.md`): outside interval, the worker
  ADDS an independent native-law re-resolution per vertex (proposed for
  20M.2 — today only the engine solve plus the endpoint source-boundary
  gate covers outside vertices; §1.1 states this honestly); inside, evaluate the NEW transition criterion
  at station `s`, re-resolved from request/snapshot-carried refs (pinned
  scalars are evidence/cross-check only, never geometric input) + law + width.
  Interior vertices are target-free analytic (no target-mesh query):
  independent law re-evaluation, plan under `coordinateAgreementTol`, Z
  under the shared elevation agreement, with NO widening; six bounded failure
  codes proposed (not added). Station mapping: joint-local `s` (`s=0` at the
  joint, source-line meters, interval `[-W/2,+W/2]`), per-vertex `s` carried
  from snapshot persisted stations — the worker never infers a law.
- Topology (spec): pre-mesh expectation is group-scoped (`scope:
  'group'`, transitioned open route contributing 1/1 — never a standalone
  certificate); existing group-scoped gtop2 machinery is the INTENDED
  unchanged validator in 20M.2 (proposed — no production transition mesh
  or measured certificate exists in 20M.1); component/cycle/
  positive-width-run pins plus foldover/overlap/zero/touching/short failure
  cases. Certification validates, never admits — and certification is NOT
  evidence of policy admission. 20M.2 must implement the transition
  expectation + mesh and prove the declared expectation/certificate with
  RED/green tests before production enablement.
- Product (spec): provenance cites law/version + explicit width + source
  interval + member identities/criteria + residual/decision metadata;
  Extract exports the transitioned boundary with transition stations marked;
  Bake materializes the explicit TIN only with that provenance; Design Patch
  stays unavailable for the open transition route (no closed-annulus
  widening); Current/Failed/revision-after-edit semantics defined. Minimum
  editor control sketched (explicit width field + law picker), not built.

## 8. Corpus distribution (47 rows)

- Angle ladder 21: collinear 3 admit clean (kink 0, no foldover,
  `productionAdmitted=true`); 18 non-collinear admit the SCALAR law only
  (`admitted=true`, `productionAdmitted=false`, reason labeled SCALAR-ONLY /
  NOT production, kink==deflection, foldover past 90° only) — the production
  predicate narrows to the 3 collinear rows.
- Controls 3: 2 equal-value NO-TRANSITION, 1 study-only near-agreement
  NO-TRANSITION (explicitly not the production gate).
- Grade-mismatch 3: same family but `gL!=gR` rejects in all 3 families with
  evidenced nonzero plan/Z grade gaps.
- Width 7: `W==max` admits; `max+ε`/over-long/zero/negative/NaN/Inf reject.
- Pairs 2: touching is occupancy-only (production rejects — strict gap
  required); overlap rejects.
- Transforms 4: 1e6/1e8 shift (honest nonzero dev), mirror, reversal — all
  stable.
- Excluded 7: surface, mixed ×2, arc, closed, sloped, joint-step — all
  reject.
- Regen twice byte-identical (sha above); 20M.1 suite 14/14.

## 9. Verdict: PARTIAL_GO_COLLINEAR_SAME_FAMILY_TRANSITION

The smallest candidate survives ONLY in its narrowed form. The exact
production predicate authorized for Phase 20M.2 implementation:

```
OPEN group AND all members line-source AND exactly the transition joint's
two adjacent members flat (startZ===endZ exact per member) AND
joint-continuous (endZ===startZ exact) AND same grading side AND same
target-free analytic family on both sides (Distance|RelativeElevation|
flat-Elevation) AND EXACT equal gradeRatio (gL===gR, no interpolation) AND
source deflection == 0 (collinear, kink 0) AND
explicit persisted total width W with 0 < W <= 2·min(LL,LR) AND
EXACTLY ONE transition object per group (cardinality <= 1 for policyVersion
trp1; touch/overlap pair rows are future-multiple policy evidence only, NOT
production authorization) AND
both adjacent native analytic criteria resolve successfully (ok) at the
authoritative source Z with finite admissible scalar/grade data, satisfying
existing maxSearch/in-bounds rules where applicable, with no
extension/target-root machinery entered.
All else (grade-mismatch/multi-root/extension/no-root/closed/arcs/sloped/joint-step/
mixed-family/non-collinear/second-transition) fails closed with existing behavior.
```

Phase 20M.2 is authorized to implement ONLY this predicate with the §7
persisted model, worker basis, gtop2 expectation/certificate (proposed;
transition-specific topology/certificate proof required during implementation
via RED/green tests before production enablement), and provenance —
behind fail-closed gates, one class, no widening.

## 10. The ten answers

1. Width: W2 explicit persisted total symmetric `W`, meters source-line,
   `0<W<=2·min(LL,LR)`, exact boundary equality, strict-gap production /
   occupancy-only touching / overlap-rejects.
2. Interior law: same-family linear scalar interpolation, legislated as
   `TRANSITION_LINEAR_V1`, never an exact tie; smoothstep kept as the
   rejected-alternative proof.
3. Families: Distance, RelativeElevation, flat Elevation (flat-only), each
   under exact equal gradeRatio (grade-mismatch evidenced as NO-GO).
4. Angles: collinear only; all else excluded for the first class.
5. One-transition-only: REQUIRED for the first 20M.2 implementation — exactly
   one transition per group (cardinality <= 1 for trp1). Pair rows are synthetic
   future-multiple policy evidence only and do NOT authorize multi-transition
   production; strict separation alone is NOT sufficient for production multiples.
6. Topology: PROPOSED, not proven — existing group-scoped gtop2 machinery is the
   intended unchanged validator in 20M.2 (1/1 scope kept), but the transition
   expectation + mesh must be implemented and then proven; no production transition
   mesh or measured certificate exists in 20M.1. Certification is NOT evidence of
   policy admission. 20M.2 must include RED/green tests proving the declared
   expectation/certificate before production enablement.
7. Worker: yes, new station-indexed basis, no tolerance changes.
8. Persisted/provenanced fields: §7 list (tag, identities, W, law+family,
   endpoint refs, side, provenance).
9. Excluded: §6 list, behavior unchanged.
10. 20M.2: authorized under the §9 predicate only.

## 11. Non-change proofs + validation

- `git diff 3fe69f2...HEAD -- src` empty (test-pinned; full range proof
  runs where the baseline object exists locally — shallow CI checkouts
  lack it and enforce working tree/index plus PR changed-file review).
- 20M.1 suite 14/14; corpus regen twice cross-process byte-identical.
- Regression + typecheck/lint/portable-paths recorded in the PR body.
- 14 stashes intact (verified pre/post).
- Corpus/test wording: every row `synthetic:true`; study-only controls
  disclaimed; no study constant acts as authority (`EPS_W=0.002` is a
  labeled probe epsilon; `transformDev` shift term is a labeled analytic
  illustration).

## 12. Reviewer history

- Independent reviewer challenged hidden defaults, linear selection,
  honesty, continuity/topology overclaims, angle sufficiency, width/overlap,
  persistence invalidation, worker reproducibility, widening, magic
  constants, synthetic wording. Findings and fixes recorded here before
  PR.
- Phase 20M.1 review round (this edit): (1) equal-grade gate added with
  plan/Z gap evidence in all 3 families; (2) corpus `productionAdmitted`
  split — non-collinear rows labeled SCALAR-ONLY/NOT production, angle-90
  foldover corrected to false; (3) pair flag replaced by real interval
  inequalities with station ownership; (4) worker interior agreement
  corrected to target-free re-evaluation with carried data/station mapping;
  (5) src-diff pin covers working tree/index, regen is two cross-process
  runs; (6) geometric-C0/gtop2/revision claims hedged as unevidenced
  proposals. Verdict stands (PARTIAL_GO, narrowed, not widened).
- Round 3 (final): production predicate restricted to STRICTLY separated
  intervals — touching is scalar occupancy only (shared-station endpoint
  equality unevidenced), never production; revision-hash inputs fixed as
  law/width/refs + canonical criteria/geometry, never the revision string
  or evidence snapshots.
- Round 4 (parent closeout): reviewer verdict was NOT APPROVED with 1 MAJOR
  (group-scoped certificate) + 2 MINOR (touching occupancy-only wording,
  outside-interval worker summary). Parent verified every reviewer-made
  study/test/decision edit on merit (grade gate, `productionAdmitted`
  split, real interval inequalities, target-free re-evaluation, pins),
  then fixed the two stale spec passages itself (§2.1 group scope, §2.4
  touching row) and the two stale decision bullets (§7 worker/topology).
  Full validation re-run green; verdict stands.
- Round 5 (final, independent): reviewer verdict REQUEST_CHANGES with exactly
  3 blockers, docs-only fixes sufficient, core PARTIAL_GO survives if
  narrowed: (1) MULTIPLE TRANSITIONS OVER-AUTHORIZED — evidence proves only
  scalar interval occupancy/touch-overlap classification, no multi-transition
  mesh/certificate/worker interaction measured or implemented; fix narrows the
  first 20M.2 predicate to EXACTLY ONE transition per group, keeps pair rows
  as future-multiple evidence only, removes strict-separation-suffices claims,
  and pins persisted-model cardinality <= 1 for `trp1`; (2) STALE SINGLE-ROOT
  GATE — admitted families are target-free analytic (closed-form resolution,
  not target root selection); fix replaces single-root wording with the actual
  bounded native resolution contract (both adjacent native analytic criteria
  resolve ok/finite at authoritative source Z, finite admissible scalar/grade
  data, existing maxSearch/in-bounds rules where applicable, no
  extension/target-root machinery), keeping Surface/hybrid/root-based classes
  excluded; (3) GTOP2 PRESENT-TENSE PROOF OVERCLAIM — no production transition
  mesh or measured certificate exists in 20M.1; fix restates gtop2 as the
  intended unchanged validator (proposal/compatibility), certification NOT
  evidence of admission, 20M.2 must prove expectation/certificate with RED/green
  tests before production enablement. Fixes applied in this round across
  decision §§2/5/7/9/10/12, persisted-model §§1/2/6, worker-topology-product
  §§2.2/2.4, TODO predicate, test/script header comments (comments only,
  corpus bytes unchanged), and PR #150 body. APPROVE not yet claimed; verdict
  stays PARTIAL_GO_COLLINEAR_SAME_FAMILY_TRANSITION with the narrowed
  one-transition predicate.
