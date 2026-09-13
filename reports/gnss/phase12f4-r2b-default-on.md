# Phase 12F.4 — Certified Native Static-GNSS R2B Route DEFAULT ON

Branch `perf/gnss-native-r2b-default-on`. Baseline `origin/main a47dc9fb`
(PR #44 merge). Enabling phase only: the 12F.3-certified cohort becomes the
normal production route. No GNSS math, Phase12D math, setup-covariance,
eligibility, F-BRIDGE, tolerance, UI, GVX, file-format, or C++ changes.
R1 stays default OFF. No Takahashi. No vendor files committed.

## §1 — Enablement point (audit)

The R2B production route is the standalone worker-only wrapper
`runGnssBaselineWithNativeR2B` (`src/workers/gnssBaselineNativeR2BRoute.ts`);
no other dispatcher calls it, so no dispatcher refactor was needed. The
entire enablement is the kill-switch default plus its comments:

- `let gnssNativeR2BEnabled = false` → **`true`**
- module header rewritten: DEFAULT ON for the certified cohort
- kill-switch reason string `(default OFF)` → `(default ON)`
- `isGnssNativeR2BRouteEnabled` doc `(default OFF)` → `(default ON)`

Classifier, bounds, gate order, fill gate, fallback, provenance, and
verification are byte-untouched. The kill switch remains functional:
explicit `setGnssNativeR2BRouteEnabled(false)` forces clean TypeScript.

## Certified cohort (frozen 12F.3 classifier)

- min free params 225, max free params 2250
- max total stations 750, max selected blocks 4000
- max factor nnz 1,500,000 (two-stage: cheap TS eligibility → native
  correction/factor metadata → fill gate → selected covariance only)
- F-BRIDGE: bridged graphs rejected pre-load, TS-dense unchanged
- frame ECEF, family `gnssBaseline` only, worker-only, robust OFF
- setup uncertainty allowed TS-side; multi-component allowed under the
  existing TS control rule
- fallback R2B → TypeScript dense, never R2B → R1; R1 stays default OFF

## WASM load policy (§4, preserved)

Eligibility is derived BEFORE any bundle load, in fixed gate order
(kill switch → worker → WASM/block-API → baselines/frames/covariance →
bridges → params → stations → block plan). Cheap rejects and kill-OFF
issue zero bundle loads (proven below).

## Evidence

### Agent contract (stubs, no WASM)

- `tests/gnssBaseline/gnssBaselineNativeR2B.test.ts`: `default-OFF
  production proof` describe reworked to `default-ON production + kill
  switch` — pristine import defaults ON and routes ring-76 (p=225)
  native with no explicit enable; explicit OFF forces TS with zero
  solver touches and zero bundle load; re-enable restores R2B (no stale
  bypass); below-floor stays bit-identical TS. All 12F.3 boundary,
  parity, tripwire, and isolation tests unchanged.
- `tests/gnssBaseline/` full dir: **29 files, 328 tests pass**.
- R2B RealWasm (wasm tier): **5/5 pass**.

### Default-ON proof (NEW `scripts/gnss/gnssR2BDefaultOnProof.ts`, real Worker + real bundle, production dispatch, no bound overrides)

**8/8 pass**: pristine default ON; default ring-100 (p=297) → R2B bitwise
vs TS (76 ms); default mesh-150 + setup → R2B bitwise, identity 4.5e-13;
default ring-25 → TS zero-load (perf floor); default chain-25 rejected
pre-load (cut-edge, zero loads); kill OFF → TS zero-load bitwise;
re-enable → R2B; forced fill cap → TS fallback bitwise. No `qxx` field
on any native leg.

### Worker-thread proof (existing 12F.3 harness, explicit-enable legs still valid)

**11/11 pass** post-flip (kill-OFF reason now reads `default ON`).

### Browser default-ON smoke (Chromium, fresh `dist/`)

Page load with full request interception: **0 `webnet_core`/`.wasm`
requests. PASS.** R2B is worker-only and loads only for eligible jobs.

### Datasets (existing harness rerun; small nets use the diagnostic seam as secondary regression evidence)

**8/8 PASS**, SEUW pins reproduce, explicit-native legs bitwise
(`seuwRel` 0, station-cov abs ≤5.1e-20, identity ≤5.7e-14):

| Leg | TS SEUW | Pin | R2B route |
| --- | --- | --- | --- |
| DatasetA-A0 | 2.100053 | match | native-sparse-selected-qxx |
| DatasetA-AC | 1.297104 | match | native-sparse-selected-qxx |
| DatasetA-AH | 1.988831 | match | native-sparse-selected-qxx |
| DatasetA-A | 1.102511 | match | native-sparse-selected-qxx |
| DatasetB-B0 | 1.965038 | match | native-sparse-selected-qxx |

Normal production routing for these below-floor nets stays TS
(perf-floor reason; proven by the below-min worker leg and the
default-ON ring-25 leg). No thresholds lowered.

### Performance regression gate (§18, full 60-leg ladder rerun, TOTAL wall)

55 ok + 5 ts-proof chain/survey skips (expected F-BRIDGE TS-throw,
identical to 12F.3). R2B medians reproduce 12F.3 to the millisecond on
small legs (ring@75 35/35 ms, mesh@75 107/107 ms): **default-on
plumbing causes zero regression**. No dense Qxx; max factorNnz 669414,
max blocks 3733 (both within caps, identical to 12F.3).

| Cohort | 12F.3 R2B | 12F.4 R2B | Speedup 12F.4 |
| --- | --- | --- | --- |
| ring@100 / 150 / 250 | 61 / 96 / 359 ms | 56 / 98 / 350 ms | 1.39x / 2.39x / 2.97x |
| ring@500 / 750 | 1751 / 4714 ms | 1697 / 4689 ms | 6.14x / 9.51x |
| mesh@250 / 500 / 750 | 1436 / 8238 / 23418 ms | 1509 / 8336 / 23712 ms | 1.20x / 1.50x / 2.69x |
| repeated-edge@750 | 5184 ms | 5136 ms | 6.23x |
| hub-spoke@500 | 1921 ms | 1900 ms | 5.51x |

Known cohort property (carried forward from 12F.3, unchanged):
small dense-mesh legs below/at the mesh crossover run slower under R2B
(mesh@75 0.75x, mesh@100 0.78x, mesh@150 0.80x — bitwise-identical,
`correct but slower` per the floor reason). 12F.3 kept MIN 225 with
these exact numbers and decided GO-ENABLE-R2B; this phase requires no
bound change.

### Memory (§19)

Heap profile unchanged from 12F.3 (mesh@750 ~1.3 GB child-heap median
including TS oracle scaffolding; ring legs far lower). No dense Qxx, no
boxed p² covariance, no new OOM, selected-buffer shape unchanged
(uniqueColumns == numParams asserted in-suite).

### Existing routes (§20)

Agent suite without foreign debris: **3246 pass + 3 pre-existing
study-desktop env failures** (identical to the 12F.3 baseline
fingerprint). WASM tier 54/54. Parity 25/25. Small-TS GNSS, legacy
G/GPS, mixed, 2D/3D native, preanalysis, data-check, blunder,
restarts, and the R1 test route are untouched (no shared code paths
modified).

## Validation summary

- lint: 0 errors (2 pre-existing warnings in untouched files)
- typecheck: clean (foreign untracked phase9l debris excluded; it
  breaks the tree-wide check at baseline too and is not part of this diff)
- tests/gnssBaseline 328/328, R2B RealWasm 5/5, wasm 54/54, parity 25/25
- agent 3246 + 3 pre-existing study-desktop env failures (debris-aside
  rerun; with foreign untracked phase9l debris present the tree shows
  its 8 failures + tier-manifest asymmetry, none from this diff)
- build clean; browser zero-WASM smoke PASS

## Kill-switch rollback contract (§23)

One step: `setGnssNativeR2BRouteEnabled(false)` (or never enable).
Result: all static-GNSS jobs immediately return to pre-12F TypeScript
routing. No data migration, project-format change, cache invalidation,
or user-file changes. Proven by the kill-OFF legs above.

## Acceptance A–Q

A default-ON only for certified cohort — PASS (pristine-import test +
production-bound legs). B classifier unchanged — PASS (diff touches no
gate). C kill switch works — PASS (OFF→TS zero-load, re-enable→R2B).
D excluded jobs zero-load — PASS (below-floor, bridge, non-worker).
E successful route is R2B — PASS. F fallback clean — PASS (fill cap,
forced failure, init failure; whole-struct bitwise). G no R1 chaining
— PASS (isolation test + source: no R1 reference on the path). H no
dense Qxx — PASS (canary + source guards + no `qxx` field). I selected
safety unchanged — PASS (S3 + identity + PSD gates untouched). J
Phase12D complete — PASS (loops/what-if/statistics parity in dataset
legs; full output shape unchanged). K browser/worker — PASS (11/11 +
8/8 + zero-WASM smoke). L performance retained — PASS (table above,
zero plumbing regression). M memory retained — PASS. N datasets
unchanged — PASS (pins + bitwise). O legacy routes unchanged — PASS
(suites). P rollback immediate — PASS. Q no math/tolerance changes —
PASS (4-line semantic diff: one boolean + comments).

## Decision

**GO-PRODUCTION.** The default-on certified cohort behaves exactly as
proven in 12F.3, with zero measured plumbing regression.

Recommended next phase: none for R2B widening (explicitly out of
scope). Candidate follow-ups belong to separate evidence phases: mesh
crossover tuning (separate bound proposal, never in an enabling
phase), Takahashi research, R1 disposition.
