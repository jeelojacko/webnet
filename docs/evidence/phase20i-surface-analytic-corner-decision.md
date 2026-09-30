# Phase 20I — surface↔analytic grading corner: decision record

Status: FILLED — verdict **GO_EXACT_COMMON_TIE_ONLY +
NO_GO_GENERAL_WITHOUT_TRANSITION**. EVIDENCE-ONLY study. Branch
`research/phase20i-surface-analytic-corner-feasibility`, baseline
`9dd28c94715daa3583c907224a04652d3ae99cc3` (= PR #137 merge), HEAD
`e3225546` (PR #138).

Nothing in this study is implemented. The current production contract remains:
a grading group is exactly one termination domain, and a surface+analytic mix
fails closed at authoring, resolve, and compute
(`MEMBER_NO_SOLUTION` / `GRADING_GROUP_MIXED_TERMINATION_DOMAIN`).

## Decision inputs

- Architecture: `phase20i-surface-analytic-corner-architecture.md`
- Validation: `phase20i-surface-analytic-corner-validation.md` (filled)
- Performance: `phase20i-surface-analytic-corner-performance.md` (filled)
- Harness: `scripts/phase20iSurfaceAnalyticCornerPerf.ts`
- Core study: `scripts/phase20iSurfaceAnalyticCornerCore.ts`,
  `scripts/phase20iSurfaceAnalyticCornerStudy.ts`
- Corpus: `docs/evidence/phase20i/corpus.json` (114 rows, 0 mismatches,
  deterministic sha256 `b8de58b…73cf9`)

## GO / NO-GO gates

| gate | question | threshold | verdict |
|---|---|---|---|
| G1 exactness | does `T* = M ∩ La` exist with target residual ≤ `zeroDelta` on exact fixtures? | shared 18I `zeroDelta` | **PASS** — (40,−20,90), gaps 0, across Distance/Elevation/Relative, reverse order, sloped target both triangulations, sloped source, large coords |
| G2 fail-closed | do mismatch / void / parallel / no-root / branch / joint-Z cases fail closed with no averaging, bridging, or wall? | 100% fail-closed, zero fabricated geometry | **PASS** — every failure row has `mesh=null`; mismatch → `TRANSITION_REQUIRED`, void → `SURFACE_TARGET_GAP`, parallel → `ANALYTIC_SEAM_PARALLEL`, joint-Z split → `SOURCE_JOINT_MISMATCH` (evidence-only), no-root/branch/degenerate guards |
| G3 no regression | are Surface↔Surface and Analytic↔Analytic controls unchanged? | identical behavior | **PASS (structural)** — zero `src/` diff; controls `ok` with matching ties; freeze stays `MEMBER_NO_SOLUTION`/`GRADING_GROUP_MIXED_TERMINATION_DOMAIN`; 43-file/604-test grading suite green |
| G4 determinism | repeated solves → one unique digest per case? | 1 unique digest | **PASS** — corpus re-run byte-identical; 15/15 → 1 digest; mesh digest stable |
| G5 no-fabrication | does the candidate ever emit a tie not on both the surface daylight and the analytic limit? | zero occurrences | **PASS (bounded)** — mesh emitted only on `EXACT_COMMON_TIE`; fan vertices proven on both planes; failures never mesh. Limits (validation §P–§Q): the claim holds only with the joint-Z gate — pre-gate ties on Z-discontinuous joints were fabricated and are now `SOURCE_JOINT_MISMATCH`; and an unmeshed `EXACT_COMMON_TIE` (Qs unreachable, disconnected V/tie patches) is a recorded classification, not a buildable corner — the mesh verdict requires the mesh prototype (`MESH_PROTOTYPE_FAILED` when Qs is null) |
| G6 design patch | is the closed hybrid ring bit-flat / exactly coplanar, or blocked? | existing flat/planar gate only | **PASS (bounded)** — no new interior policy; warped/transition/wall stays BLOCKED; study does not implement a Design Patch |
| G7 seams | buildable with no schema bump, one shared target snapshot, no worker-protocol change? | yes/no per §5 audit | **YES (proposal only)** — optional `targetSurfaceId`, derived hybrid domain, per-joint dispatch, protocol unchanged |
| G8 scope | evidence-only with zero routing change? | already true | **PASS (structural)** — no `src/` diff |
| G9 performance | no super-linear regression vs controls? | report only, no timing threshold | **PASS (bounded)** — 0.14–4.78 ms/joint quick; fine TIN ≈5.7× coarse target; corpus 3149 cases/sec; below the controls |

No G1–G6 failure. G7 is answered by the §5 audit (all seam items remain
proposals and are NOT implemented).

## Rejected policies (pre-committed)

- **Policy B — two independent ties + bridging wall/interpolation.** Rejected
  in architecture §4: fabricates geometry off both limit surfaces,
  Z-discontinuous, contradicts the no-wall/no-bridge invariant.
- **Policy C — half-target substitution.** Rejected in architecture §4:
  replaces the real TIN with the analytic plane on the surface side, silently
  changes Surface↔Surface semantics if it leaks.

Only **policy A′ (exact common tie)** proceeds to the gates.

## Production-seam impact (full audit in architecture §5)

- Authoring: extend the single gate (`gradingGroupTermination.ts:40-48`); no
  parallel validator.
- Persistence: optional `targetSurfaceId` is sufficient; hybrid domain stays
  derived → no schema bump implied.
- Revision: additive surface-leg branch, `ggrev1:` prefix preserved, legacy
  bytes frozen.
- Resolve/worker: one shared target snapshot; protocol unchanged.
- Compute: per-joint dispatch (S↔S / A↔A unchanged; mixed joint → A′); one
  new failure code proposed.
- Status/commands: `deriveGroupStatus` unchanged; failure still collapses to
  `null` at the revision gate.
- Provenance: new `targetKind` proposed, legacy read rules preserved.
- Design Patch: no new interior policy; warped/transition/wall results stay
  BLOCKED.

**All seam items are proposals and are NOT implemented.**

## Verdict

- **Overall: GO_EXACT_COMMON_TIE_ONLY + NO_GO_GENERAL_WITHOUT_TRANSITION.**
  - GO: an exact-common-tie hybrid (policy A′) is feasible using existing
    helpers — exact tie via existing `miterSeam` / `solveMiterTie` /
    `analyticTerminalLine`, all analytic-kind variants, reverse order, GAP and
    OVERLAP prototypes (OVERLAP recorded as **valid**, not NO-GO), CUT/FILL
    branch, sloped target under both triangulations, sloped source, large
    coordinates, two mixed + two analytic-analytic square tie-checks matching
    the production controls (tie coordinates only — no assembled closed-ring
    mesh, validation §J), deterministic
    repeats, no new tolerance, no bridge/wall/average, bounded performance,
    seams understood.
  - NO-GO (general): a general surface↔analytic mix cannot ship without an
    explicit transition policy — the mismatch family
    (`TRANSITION_REQUIRED`, proposed `CORNER_HYBRID_TARGET_DISAGREE`) is
    common (38/114 study rows) and must fail closed, not be averaged.
- **Bounded production risk:** arc/mixed alignment. The validated arc case is
  the bounded arc-adjacent configuration (arc chord on one side, straight
  member on the other; monotone, no branch jump). The arc×arc stress harness
  (both adjacent members arc chords) is only ~29% exact and otherwise fails
  closed. Any productization must carry an explicit chord/tangent restriction
  (rely on `curveChordTolerance` linearization and the existing
  `CURVE_APPROXIMATED` handling) and re-run the arc harness before routing
  touches.
- **Incidental, not fixed:** `rayTriangleInterval` axis-parallel `denom=0`
  sign-slip and the 20B `GRADING_DAYLIGHT_DISAGREE` sloped-target / flat
  grade `−0.499` normal-ray-tie fallback are recorded in validation
  "Incidental findings"; `src/` is untouched.
- If productized, the implementation must be a separate, routing-touching
  phase with its own reviewer gate; this branch never merges production
  behavior.
- PR: this branch is evidence-only and is not to be merged until the
  orchestrator says otherwise. **Do not merge.**
