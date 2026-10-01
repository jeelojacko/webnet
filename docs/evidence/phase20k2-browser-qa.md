# Phase 20K.2 curved-topology browser QA (Chromium)

Status: **RUN — 6/6 spec flows green, 0 page / 0 console / 0 unhandled errors
per flow.** Branch `fix/phase20k2-curved-topology-product-closeout`,
baseline `fbac7c88` (PR #142; Phase 20K.1 closeout) plus the uncommitted 20K.2
worktree. Spec: `tests-browser/cad-grading-curved-20k2.spec.ts`. Command:
`npx playwright test tests-browser/cad-grading-curved-20k2.spec.ts --reporter=list`.
Real production Chromium (`Google Chrome for Testing 148.0.7778.96`,
Playwright 1.60.0 bundled `chromium-1223`), headless, bounded
**1366×768**. Repeated runs: 6 passed, 24.0–24.2 s each (cold boot adds
~8 s to the first flow). No screenshots: no UI text changed in this wave
(product-validation only), so no pixel inspection was required. The repo
browser-test script is `npm run test:map-browser` (`playwright test
tests-browser`); this wave ran the single spec directly.

## What was validated

| flow | fixture | observed | result |
|---|---|---|---|
| A partially tied curved Surface | single arc course (`bulge 0.1`), Cut/Fill, tilted planar target | offline engine replay: **components 2, certified** (a genuine two-region tied mesh); browser worker: `Failed — GRADING_AGREEMENT_DAYLIGHT_Z`, never Current, Extract/Bake disabled, zero mutation | **RESTRICTED — recorded honestly** |
| A2 multi-region availability | single straight course, Cut/Fill, tilted target | offline replay: multi-region, **certificate null**; browser: **Current**, Extract/Bake disabled, zero mutation | **PASS** |
| B valid curved Design Patch | closed four-arc all-Distance group | Current → Build Design Patch enabled → one `CurvedPad - Design Patch [PATCH]` surface with truthful provenance → one Undo removes → Redo restores | **PASS** |
| C non-planar Cut/Fill | single arc course, Cut/Fill, ridge target | stable `Failed — GROUP_NON_MANIFOLD`, never Current, products disabled, zero mutation | **PASS** |
| D planar Cut/Fill control | single straight course, Cut/Fill, flat target | offline replay: **components 1, certified**, plan `500.000` m², 20 triangles; browser: Current, topology-certified, Extract +1/−1 Undo, Bake +1/−1 Undo | **PASS** |
| E arc×arc freeze | closed four-arc hybrid group (Surface override on course 0) | stable `CORNER_NO_SOLUTION (corner 0): GRADING_SURFACE_ANALYTIC_ARC_PAIR_UNSUPPORTED`, never Current | **PASS** |

Availability is not guessed: each flow replays the same persisted project
offline through `resolveGroupInputs` + `computeGradingGroupFromSnapshots` and
compares the UI enablement to the engine's certificate product gate
(`exportable`). In the browser, `Current` ⇒ products match the gate; not
`Current` ⇒ products disabled with zero mutation.

## Error counts

| viewport | page errors | console errors | unhandled rejections |
|---|---|---|---|
| 1366×768 | 0 | 0 | 0 |

Every flow asserts its own zero ledger at teardown (`pageerror`,
`console.error`, `unhandledrejection`). No `src/` behavior was changed by this
QA wave; only the spec and this document were added.

## Honest findings (browser path vs engine)

The 20K.2 closeout fixtures are all Surface-terminated. On this worktree the
**Surface-terminated curved path does not reach `CURRENT` through the browser
worker**, for two independent, pre-existing reasons. Both were reproduced
offline against the shipped code; the QA spec records the resulting terminal
state rather than forcing a green.

1. **Curve-seam daylight agreement is tighter than the seam residual.**
   `validateDaylightAgainstTarget` compares every daylight vertex to the
   target with `zeroDelta(a,b) = 4·ε·max(1,|a|,|b|) ≈ 8.9e-16`. A curved
   source's chord seam leaves a ~4–5e-13 Z residual at some daylight
   vertices, so the same project that the engine `computeGradingGroupFromSnapshots`
   returns as a certified **two-region** mesh is rejected by the worker as
   `GRADING_AGREEMENT_DAYLIGHT_Z`. A straight source of the same fixture has
   an exact 0 residual and passes. Flow A records this; Flow D uses the
   straight planar control that the gate admits. This is a worker-gate
   tightness for curve seams, not a 20K.2 regression, and is left unchanged
   (out of scope: no `src/` edits this wave).

2. **Genuinely multi-region surface meshes do not certify.**
   `buildGradingTopologyCertificate` returns `null` when the stricter
   boundary-cycle validation rejects the merged mesh, so the result carries
   no certificate and the product gate reports
   `GRADING_TOPOLOGY_CERTIFICATE_MISSING` — not
   `GRADING_TOPOLOGY_MULTI_REGION_NOT_EXPORTABLE`. The `MULTI_REGION` bound
   itself is implemented and unit-verified
   (`tests/cad_grading_tied_products_20k2.test.ts`,
   `tests/cad_grading_topology_certificate_20k2.test.ts`) but is unreachable
   through the browser worker on this worktree. This matches the sibling
   conflict already recorded in
   `docs/evidence/phase20k2-curved-design-patch-cutfill.md` §3 ("the shared
   worktree currently also carries in-progress sibling topology changes (a
   stricter boundary-cycle gate)").

Per-flow terminal codes captured in-browser: A `GRADING_AGREEMENT_DAYLIGHT_Z`;
C `GROUP_NON_MANIFOLD`; E `CORNER_NO_SOLUTION /
GRADING_SURFACE_ANALYTIC_ARC_PAIR_UNSUPPORTED`. Codes are byte-stable across
recalculation (C and E assert the second run equals the first).

### Additional offline note — standalone arc + Surface grading

Standalone (non-group) arc gradings against a Surface additionally fail the
source-boundary half of the worker gate,
`GRADING_AGREEMENT_SOURCE_BOUNDARY`: `agreementReject` rebuilds the expected
boundary via `atSource(u) = start + (chordDir/|chord|)·u` while passing the
*arc* length as `u`, overshooting the arc end by 0.665 m for the 100 m chord /
R 252.5 fixture (`arc length 100.665` vs chord `100`). Straight sources are
unaffected (`u` = length). This is why the browser flows use groups (whose
gate is the daylight-only `groupAgreementReject`); it is reported here as an
offline code-level finding, not a browser-driven verdict.

## Reproduction / run evidence

- Spec: `tests-browser/cad-grading-curved-20k2.spec.ts` and its shared
  fixtures/helpers module `tests-browser/cad-grading-curved-20k2-helpers.ts`
  (both untracked, added by this wave).
- `npx eslint tests-browser/cad-grading-curved-20k2.spec.ts tests-browser/cad-grading-curved-20k2-helpers.ts`
  → clean.
- `npx playwright test tests-browser/cad-grading-curved-20k2.spec.ts --reporter=list`
  → `6 passed` in 24.0–24.2 s; repeated four times with a fresh Vite dev
  server, identical verdicts.
- Offline replays used the same persisted projects through
  `resolveGroupInputs` + `computeGradingGroupFromSnapshots` and a target TIN
  snapshot identical to the written `importedTin`.
