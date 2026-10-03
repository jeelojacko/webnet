# Phase 20M — Grading-Transition Feasibility Decision

- Baseline: `main` at `953e482964efee665f69a11fbf2ebbf611a6ca66`.
- Branch: `research/phase20m-grading-transition-feasibility`.
- Scope: STUDY/EVIDENCE ONLY. Zero `src/` changes. No widening of the 20L.2
  exact-offset route, no relaxation of 20J/20K.3 gates, no new persistence,
  worker, UI, or product behavior.
- Study core: `scripts/phase20mTransitionStudy.ts` (pure-math oracle; imports
  `zeroDelta`, `coordinateAgreementTol`, `elevationAgreementTol` as
  authorities, never copies them).
- Corpus: `docs/evidence/phase20m/corpus.json` (48 rows: 24 fixtures × T0/T1),
  `corpus.sha256`, pins in `tests/cad_grading_transition_feasibility_20m.test.ts`.
- Verdict: **POLICY_REQUIRED_TRANSITION** (defined in §10).

## 1. Proven mathematical facts

1. For any two finite terminal daylight points P1 ≠ P2, the segment P1→P2
   (candidate T0) always exists geometrically. Existence is trivial; it
   settles nothing about admissibility.
2. Every interior point of a T0 connector between disagreeing terminals
   violates at least one member's native criterion by construction (the two
   native laws disagree at the joint, so no single point past the endpoints
   satisfies both). A connector labeled "exact" while violating the declared
   criterion is a falsification, not a tie. Proven by the residual column:
   all 21 non-control T0 rows carry strictly positive inside residual.
3. Transition width is not a function of existing inputs. For every
   underdetermined fixture, probe widths wA ≠ wB (both satisfying plan, XYZ,
   and mesh-continuity in the study frame) yield materially different
   outcomes (3× plan area / Z-volume). No existing authority — source
   geometry, member criteria, maxSearchDistance, target geometry, curve
   radii, numerical bounds — selects between them. Measured, not assumed
   (§5, §9).
4. Exact-common-tie detection is already authoritative and must not be
   reimplemented: P1 ≈ P2 under the shared 20J1 agreement gates
   (`coordinateAgreementTol`, `elevationAgreementTol`, `zeroDelta` floor)
   means no transition is required. All 6 control rows (M07, M08 incl. a
   ULP-level twin) classify EXACT_COMMON_TIE_CONTROL through those imports.
5. Local-frame recomputation is translation-invariant by construction:
   transform deviation 0 across +1e6/+1e8 shifts for all 48 rows; mirror
   (x→−x) preserves every classification, including the M16/M17 reversal pair.

## 2. Forensics: current production paths (read-only inventory)

| Outcome | Location | Code / detail |
|---|---|---|
| Surface-seam transition block | `src/engine/cad/grading/gradingChordSeam.ts:478` | `GRADING_SURFACE_SEAM:GRADING_SURFACE_SEAM_TRANSITION_REQUIRED` |
| Hybrid-corner transition blocks (4 sites + root-policy site) | `src/engine/cad/grading/gradingGroupHybridCorners.ts:151,195,209,242,356` | `CORNER_NO_SOLUTION` + `GRADING_SURFACE_ANALYTIC_TRANSITION_REQUIRED`; `:354` root-policy variant `GRADING_SURFACE_ANALYTIC_ROOT_POLICY` |
| Chord-fallback marker (production, unchanged) | `src/engine/cad/grading/gradingGroupCompute.ts:518` | `CURVE_CORNER_APPROXIMATED` diagnostic |
| Hybrid-corner rejections | `gradingGroupHybridCorners.ts:140,147,157,185,188,192,199,216,219,226,233,238,254,292,321` | `GRADING_SURFACE_ANALYTIC_LINE / _ARC_PAIR_UNSUPPORTED / _SIDE / _MESH` |
| Analytic-corner rejections | `gradingGroupCompute.ts:540,601,631,658,690` | `CORNER_NO_SOLUTION` + `GRADING_SURFACE_ANALYTIC_LINE / GRADING_ANALYTIC_CORNER_DEGENERATE / _TRIM / GRADING_BAD_CRITERION` |
| Ambiguity gates | `gradingGroupSectors.ts:518-524`, `gradingGroupSurfaceCorners.ts:183` | `CORNER_AMBIGUOUS` (multi-forward, path-key overflow, ray) |
| Target-gap gates | `gradingGroupSectors.ts:356,437`, `gradingGroupSurfaceCorners.ts:201,242` | `CORNER_TARGET_GAP`, `GRADING_CORNER_SEAM_DISAGREE` |
| Topology / certificate gates | `gradingGroupCompute.ts:870`, `gradingGroupExactOffset.ts:363` | `GROUP_NON_MANIFOLD`, `FALLBACK_STRIP_FAIL` + `GRADING_TOPOLOGY_CERTIFICATE_MISSING` |
| 20L.2 exact-offset admission (NOT widened) | `gradingExactOffsetPolicy.ts` (whole file; route gate `:94`, same-`d` gate `:144`), `gradingGroupExactOffset.ts:146` (`tryExactOffsetGroup`), wired at `gradingGroupCompute.ts:292` | `EXACT_OFFSET_RADIUS` vs bounded `FALLBACK_*` reasons |
| Shared numerical authorities (reused, never copied) | `src/engine/cad/surfaces/volume/zero.ts:17` (`zeroDelta`); `gradingGroupSectors.ts:211` (`AGREEMENT_OPS=32`), `:221` (`AGREEMENT_FLOOR=1e-9`), `:253,270,287,304` (anchored/coordinate/seam/elevation agreement); 20L.2 reuse at `gradingExactOffsetGeometry.ts:86-109` (`OPS`, `extentJVWithin` — no new epsilon) | — |
| Worker agreement gates (would rightly reject interiors) | `src/workers/surfaceGradingCompute.ts:232` (`validateDaylightAgainstTarget`), `:236-:273` (`GRADING_AGREEMENT_MALFORMED_DAYLIGHT / _DAYLIGHT_OFF_TARGET / _DAYLIGHT_Z / _SOURCE_BOUNDARY`); engine side `solveStraightChord.ts:360,378` (`GRADING_DAYLIGHT_OFF_TARGET / _DISAGREE` via shared `anchoredElevationAgreementTol`) | — |
| Dead gate (do not cite as live) | `gradingGroupTermination.ts:36` — `validateGroupTerminationDomainCriteria` unconditionally returns `null` since 20J Wave C1; mixed-domain failures move to compute | — |
| Arc×arc double block | `gradingGroupHybridCorners.ts:147` (`GRADING_SURFACE_ANALYTIC_ARC_PAIR_UNSUPPORTED`) + exact-offset join layer (`gradingExactOffsetGeometry.ts` arc-pair refusal) — two independent layers | — |

## 3. The transition problem, precisely

A transition is an explicit object between TWO already-valid adjacent member
solutions, decomposed as: (a) source geometry (unchanged — falsifying it is
forbidden); (b) each member's native daylight/tie solution P1, P2; (c) an
optional transition source interval (required by T1, absent in T0); (d)
daylight transition geometry; (e) 3D elevation law; (f) target/surface
interaction; (g) mesh/topology/certificate consequences. "Draw a line between
ties" assumes (c) is empty and (e)–(g) are free; the study proves none of
that (§4–§7).

Coverage (fixture → class): M01/M03/M15/M20/M21/M22 analytic↔analytic
d-mismatch; M02/M03 Distance↔RelativeElevation↔Elevation; M04 same-d/diff-Z;
M05/M24 sloped disagreement; M06 joint Z step; M09/M10/M23 surface↔analytic
GAP/OVERLAP/extension; M11 surface↔surface; M12/M13/M14 no/one/multi root;
M16/M17 line↔arc + reversal; M18 arc↔arc control; M19 closed control;
M07/M08 exact-tie controls.

## 4. Candidate law families

- **T0 (direct connector).** Means: assert the segment P1→P2 as transition
  geometry with no source-interval change. Derived: endpoints only. Requires
  NEW policy: side/branch is inherited, but criterion priority (which
  member's law the interior "belongs" to for provenance/Extract/Bake) and
  extension permission are not in existing data. Preserves member laws only
  outside the connector; interior satisfies neither (measured §6). Plan
  continuous, XYZ continuous, slope discontinuous at both ends in general,
  mesh continuity predictable only for line-line cases. Reversible
  (M16/M17 agree). Deterministic under transforms (local frames). Self-
  intersection rejectable pre-mesh only for simple line-line spans.
  Provenance statement "connector, satisfies neither criterion" is truthful;
  any "exact" label would be false.
- **T1 (finite source-station blend of width w).** Means: reserve a source
  interval, blend grading law across it. Derived: nothing selects w or the
  blend function from existing inputs (§5). Necessarily modifies both member
  laws inside the interval. Continuity classes up to slope-continuous are
  achievable *for a chosen* w — which is exactly the problem: continuity is
  satisfiable by infinitely many (w, blend) pairs with materially different
  area/volume. Reversibility holds per fixed (w, blend); determinism holds
  per fixed (w, blend); neither fixes (w, blend). maxSearchDistance stays
  meaningful as a bound but not as a selector. Provenance would have to cite
  a blend law that does not exist in persistence.
- **T2 (transition strip/fan + explicit transition criterion).** Means: bound
  the region by the two native laws and legislate a new criterion inside.
  This is the only truthful framing of T0/T1 interiors — but the criterion,
  its persistence schema, its UI, and its Extract/Bake semantics do not
  exist. No better formulation emerged from the engine architecture: every
  construction routes through the same missing (width, blend/criterion,
  branch, extension) choices.
- **Verdict per family:** T0 is geometrically possible and provenance-
  honest only under a new-criterion label; T1 is underdetermined in width
  and blend; T2 is the honest name for what T0/T1 interiors require, and it
  is a product/policy artifact, not a derivation.

## 5. Transition width is NOT derivable (primary policy question)

Probes wA=narrow / wB=wide (study probes, not defaults) differ 3× in
area/volume on every underdetermined row while both satisfy continuity in
the study frame. Explicit tests:

- width→0: collapses T1 into T0; the criterion violation does not vanish —
  it concentrates (residual/width diverges). Zero width is not a tie.
- Width growth: area/volume scale linearly; no existing bound stops growth
  except member length (TOPOLOGY_NO_GO, exercised by construction rule).
- Crossing adjacent joints / overlapping transitions: two transitions whose
  intervals overlap compete for the same source stations; no priority law
  exists. Deferred to policy (no fixture can resolve it mathematically).
- Width exceeding member length: rejected geometrically (fold/overlap);
  the only hard geometric bound found.
- Curved source spans: width measured along chord vs along arc differs by
  sagitta; which measure is normative is a policy choice (20L.2 chose
  radius-exact for its bounded route; nothing extends that choice here).
- "Minimum safe width" is numerical only at the noise floor (M20 1mm span:
  still classifies as transition, not tie — agreement gates decide ties,
  not widths). Any larger minimum is design preference.

## 6. Criterion fidelity / error accounting

Per-row corpus columns: native residual outside transition = 0 by fixture
construction (inputs are already-valid solutions); residual inside =
Δplan/2, Δz/2 (midpoint of the only parameter-free connector — a lower
bound on what any blend must deviate, not a proposal); plan-offset
deviation = Δplan; elevation/slope deviation = Δz (+ slope kink at both
ends for T0); target-surface residual = unmeasured where roots≠1 (no root
to measure against — recorded as ROOT_POLICY_REQUIRED, not zero);
introduced area = probe areas (differ 3×); topology changes = none for
open line-line, unpredictable otherwise (§7). No construction may be called
exact: every non-control row sets `requiresNewCriterion: true`.

## 7. Topology / mesh / certificate

Existing authorities callable pre-mesh: expected-topology object
(`gradingTopologyExpectation.ts`), gtop2 exact certificate builder
(`gradingTopologyCertificate.ts`), positive-width station-run counter.
Findings: for open line-line transitions the strip topology is predictable
(standalone open strip 1/1) and certifiable *as a new strip* — but the strip
is a new model object, and certifying it certifies the invention, not its
admissibility. For arc-bearing, surface-bound, or closed transitions,
orientation/manifoldness/boundary-cycle expectations cannot be predicted
without the missing (branch, extension, closure) choices; weakening
expectations to pass would be the exact failure the 20K.3 gates exist to
prevent. Closed routes (M19) additionally change annulus topology.
Conclusion: topology machinery can *validate* a legislated transition; it
cannot *derive* one.

## 8. Worker / product / provenance

- Worker agreement (`anchoredElevationAgreementTol` chain + target
  settlement gate) would REJECT transition interiors against either member
  law — correctly, since interiors satisfy neither. A transition would need
  a new agreement basis citing the new criterion.
- `sourceBoundary`/daylight provenance would have to record: transition
  interval, blend/criterion id + version, width derivation, branch choice,
  extension permission, and the residuals introduced. None of these fields
  exist.
- Extract/Bake/Design-Patch semantics over transition geometry would either
  re-derive native laws (contradicting the built geometry) or bake the
  invention silently. Both are untruthful without a first-class transition
  model type — which is a product decision, not a study output.
- No product/UI implementation was attempted.

## 9. Corpus + verdict matrix

48 rows; classifications: TRANSITION_REQUIRES_NEW_CRITERION 17 (T0
non-controls), TRANSITION_WIDTH_UNDERDETERMINED 17 (T1 non-controls),
EXACT_COMMON_TIE_CONTROL 6, ROOT_POLICY_REQUIRED 2, ARC_PAIR_NO_GO 2,
CLOSED_ROUTE_POLICY_REQUIRED 2, EXTENSION_POLICY_REQUIRED 2.
Transform max deviation 0 on all rows; mirror stable on all rows; M16/M17
reversal agrees; regen byte-identical (sha pinned in `corpus.sha256`,
asserted by test). Study-only numeric probes (0.5 m width floor, 1e-9
sub-nanometre noise floor, 1e-12 area-compare quantum) are labeled probes
in `scripts/phase20mTransitionStudy.ts`, never imported authorities and
never proposed production values; all tie agreement goes through the
imported 20J1 gates.

## 10. Verdict: POLICY_REQUIRED_TRANSITION

A transition is geometrically constructible in the open line-line cases and
topologically describable once legislated — so this is NOT a NO_GO (no hard
contradiction found). But every construction path requires at least one
choice no existing authority makes. Production admission must wait for
explicit product/policy legislation. Unresolved choices, each with two
materially different valid outcomes demonstrated or constructed:

1. **Transition width.** Outcome A: narrow probe (area X). Outcome B: wide
   probe (area 3X). Both satisfy continuity; corpus rows prove the factor-3
   divergence. Needed: a derivation rule or a user parameter with bounds.
2. **Interior law (blend vs new criterion).** Outcome A: T0 segment labeled
   as new-criterion geometry. Outcome B: T1 blend with a named function
   (linear/smooth). Different residuals, different Bake semantics.
3. **Branch choice under multi-root (M14).** Outcome A: nearest root.
   Outcome B: far root. Different daylight points, different fill volumes.
4. **Extension permission (M23).** Outcome A: forbid (fail closed).
   Outcome B: allow with user override. Different target coverage.
5. **No-root behavior (M12).** Outcome A: fail closed. Outcome B: drape to
   maxSearch boundary. Different geometry, different honesty burden.
6. **Closed-route transitions (M19).** Outcome A: forbid (topology
   preserved). Outcome B: allow with annulus re-certification. Different
   topology contract.
7. **Arc-bearing transitions (M16/M17) and arc×arc (M18).** Outcome A: keep
   the 20K/20L.2 exclusions. Outcome B: legislate radial-sign + join rules
   per arc pair. M18 stays NO-GO under outcome A.
8. **Sloped/joint-step Z handling (M04/M05/M06/M24).** Outcome A: blend Z
   across the interval. Outcome B: step at the joint station. Different
   slope profiles, different machine-control output.

Smallest safe production follow-up (only after policy answers): a bounded
predicate mirroring the 20L.2 shape — open, line-only, single-root,
in-bounds, ULP-tied source joints, with an explicit persisted transition
criterion + width rule + provenance fields + worker agreement basis +
topology expectation — admitted one class at a time behind fail-closed
gates. This study does NOT implement it.

## 11. Unsupported ideas rejected

- "T0 connectors are exact ties": false (§1.2). Rejected.
- "Width = Δplan (or any function of Δ)": arbitrary; wA=Δ vs wB=3Δ both
  valid. Rejected as derivation; admissible only as legislated policy.
- "Borrow 20L.2 exact-offset law for transitions": the 20L.2 route requires
  SAME exact `d`, flat, joint-continuous, open, arc-bearing groups — the
  complement of transition inputs. Rejected; 20L.2 must not be broadened
  implicitly.
- "Widen agreement tolerances until ties meet": falsifies member criteria
  and breaks worker agreement. Rejected.
- "Certify the strip and call it admissible": certification validates a
  legislated object; it does not legislate it (§7). Rejected.

## 12. Non-change proofs + validation

- `git diff baseline...HEAD -- src` MUST be empty (asserted pre-commit).
- 20L.2 exact-offset suites, 20J/20J.1 common-tie suites, 20K.2/20K.3
  topology/certificate/worker suites, and the full `cad_grading` group run
  green (counts below); TRANSITION_REQUIRED production cases remain blocked
  (spot-checked gate sites unchanged — read-only, §2).
- 14 stashes intact (verified pre/post).
- Corpus regenerated twice byte-identical; test asserts committed bytes.
