# Phase 20M.2 WAVES I+J — browser QA + robustness record

Predicate per flow (unchanged): OPEN line-only one-transition trp1, same
family, exact gL===gR, collinear 0, explicit W, TRANSITION_LINEAR_V1, fail
closed. No epsilon widened, no C1 claimed.

## WAVE I — production flows (real /cad shell, headless Chromium, 0 errors)

Spec: `tests-browser/cad-grading-transition-20m2.spec.ts` — 10/10 PASS,
zero page/console/unhandled errors per test (`expect(errors).toEqual([])`).
Seed: collinear flat feature lines (2-course straight, bent, 3-course)
with persisted `transitions` intents; Calculate dispatched through the real
worker; 1366x768.

| Flow | Verdict |
| ---- | ------- |
| A Distance valid | CURRENT (`a-distance-current.png`) |
| B RelativeElevation valid | CURRENT (`b-relative-current.png`) |
| C flat Elevation valid | CURRENT, mesh proof survived — no NARROWED (`c-elevation-current.png`) |
| D width exact max (40 = 2xmin) | CURRENT (`d-exact-max-current.png`) |
| E width too large (41) | FAILED, Extract/Bake disabled (`e-too-wide-failed.png`) |
| F non-collinear | FAILED (`f-noncollinear-failed.png`) |
| G second transition | Add absent while one staged; single intent solves CURRENT (`g-single-transition.png`) |
| H save/reopen | intent (joint:0, 8 m) survives round trip; recalc CURRENT (`h-save-reopen-current.png`) |
| I edits invalidate | removal → FAILED CORNER_NO_SOLUTION (legacy gap); width 4 re-add → CURRENT; grade 50→75% override → FAILED; reset → CURRENT (`i-*.png`) |
| J products | Extract +1 entity/undo, Bake +1 surface/undo, both gated pre-calc; Build Design Patch disabled for the open route (`j-products.png`, `j-patch-off.png`) |

### Production fix WAVE I exposed

The first run failed 8/10 with `CORNER_NO_SOLUTION`: the retained intent
never reached the worker — `requestGroupGrading`
(`src/workers/surfaceGradingService.ts`) built the request without
`transition`/`transitionMembers`/`transitionMemberKeys` (WAVES E/F built
the worker gate, resolve exposed intents, but the service never sent them).

Fix (no epsilon, no new files for the path itself):
- `selectGroupTransition` + `TransitionSelection` moved to
  `gradingTransitionPolicy.ts` (single cardinality gate); `gradingGroupCompute.ts`
  re-exports (existing importers green).
- Shared `transitionRejectGroupCode` in policy; compute uses it (mapping unchanged).
- New pure `planGroupTransitionRequest` in the service: selects the intent,
  verifies refs against live traversal keys, runs the frozen admission
  authority to pin endpoint evidence + recorded revision; absent = exact
  legacy request; any reject fails closed pre-dispatch with the bounded
  TRANSITION_* code. The worker agreement rechecks everything (defense in depth).

## WAVE J — robustness + perf

Test: `tests/cad_grading_transition_robust_20m2.test.ts` — 7/7 PASS.
Measured (pinned, never widened): translations 1e6/1e8 bit-identical up
to the shift (dev 0); mirror negates plan offsets exactly (dev 0, chirality
flips side — pre-existing side-relative semantics); reversal admits on the
mirrored roadside (pinned array); short members (5 m) oriented mesh;
width 40 admits / 40.000001 rejects / asymmetric 20 admits / 20.5 rejects;
scalars 1e-6/20/40 finite + oriented, 1e6 beyond maxSearch fails
MEMBER_NO_SOLUTION, NaN/Inf fail closed; 3x repeat bit-identical.

Perf (`scripts/measureTransition20m2.ts`, measurement only, n=200):
legacy median 0.125 ms / p95 0.276 ms; admitted transition median
0.137 ms / p95 0.298 ms; ratio 1.10x (machine-local, correctness first).

## Evidence

`docs/evidence/phase20m2/`: 13 PNGs (above) + `geometry.json` (viewport/
manager boxes per shot) + this file.
