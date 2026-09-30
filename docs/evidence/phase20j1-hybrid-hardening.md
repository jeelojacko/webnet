# Phase 20J1 — Hybrid Persistence Hardening + Tie-Tolerance Audit (evidence)

Scope: two bounded tracks, neither touching browser behavior.

- **Track 1 (worker-persist, §1–§5):** persistence sanitizer fix ONLY. No
  tolerance/numerics changes. No browser changes.
- **Track 2 (worker-tolerance, §6–§14):**
  `src/engine/cad/grading/gradingGroupSectors.ts` (anchored target-plane root
  form, agreement contracts), `src/engine/cad/grading/gradingGroupHybridCorners.ts`
  (agreement gates), `scripts/phase20jHybridGradingPerf.ts` (one report string),
  and `tests/cad_grading_tie_agreement_20j1.test.ts`. Persistence/sanitizer
  files are owned by Track 1 and are untouched by Track 2.

Baseline: `ffa89282` (Phase 20J — PR #139 merge).

---

# Track 1 — Persistence hardening

## 1. Pre-fix reproduction (RED on baseline `ffa89282`)

Scratch test (since removed; folded into
`tests/cad_grading_hybrid_persistence_20j1.test.ts` §8-A/§10): 4-course
closed group, stored default `{kind:'fixed',gradeRatio:-0.5}`, overrides
course1 Distance / course2 Elevation / course3 RelativeElevation /
course4 Distance, no `targetSurfaceId`.

Exact baseline output:

```text
 FAIL  tests/cad_grading_20j1_repro.test.ts > 20j1 pre-fix repro >
   surface-default fully overridden to analytic survives a save/reopen round-trip
 AssertionError: expected [] to have a length of 1 but got +0
 ❯ tests/cad_grading_20j1_repro.test.ts:91:58
 Test Files  1 failed (1)
      Tests  1 failed (1)
```

Every pre-parse assert passed on baseline (authoring succeeds, effective
analytic, resolve needs no target, compute succeeds, serialize writes no
target) — only the parse reopened 0 groups.

Matrix baseline check (fix stashed, post-fix tests run against baseline):
4 failed / 10 passed — §8-A, §8-G, §9 resolve-stability, §10 full
round-trip fail; the rest pass on baseline (documented in §4 table).

## 2. Sanitizer root cause

`sanitizeCadGradingGroupsDetailed`
(`src/engine/cad/grading/gradingGroupPersistence.ts`) called
`createGroupDefinition` WITHOUT `courseCriteria`, so the target gate
evaluated the stored default only. A surface default with no stored
target failed construction immediately; the override scrub and the
effective-target check below were never reached, and the group silently
dropped. `createGroupDefinition`
(`src/engine/cad/grading/gradingGroupAuthoring.ts`) always accepted
`CreateGroupInput.courseCriteria` — only the sanitizer omitted it.

## 3. Corrected pipeline

1. `validateGroupBaseShape` (new, pure, in `gradingGroupAuthoring.ts`):
   identity, courses, default criterion, side/search/tolerance/corner,
   closed/layer/style — NO target gate, NO overrides.
2. Scrub raw overrides via existing `scrubCourseCriteria` against the
   validated courses (orphan/duplicate/invalid drop with reasons).
3. ONE `createGroupDefinition` call with scrubbed `courseCriteria` +
   raw target id. Final target rule stays owned by
   `effectiveCriteriaForCourses` + `groupTerminationRequiresTarget`:
   strip dormant target on all-analytic; retain for surface/hybrid;
   canonical key order preserved; exact drop reasons reported; never
   invents a target; never materializes defaults. `ggrev1` unchanged.

## 4. Round-trip matrix (§8 cases → baseline / post-fix)

| Case | Shape | Baseline | Post-fix |
| ---- | ----- | -------- | -------- |
| A surface-default/all-Distance, no target | kept, analytic, no target | FAIL (dropped) | PASS |
| B mixed-analytic full override, no target | kept, analytic | PASS | PASS |
| C partial override, with target | kept, hybrid, target | PASS | PASS |
| C partial override, no target | dropped | PASS (dropped) | PASS (dropped) |
| D analytic-default/all-Surface, with target | kept, surface | PASS | PASS |
| D analytic-default/all-Surface, no target | dropped | PASS (dropped) | PASS (dropped) |
| E analytic-default/one-Surface | kept, hybrid, target | PASS | PASS |
| F dormant target strip + tgt:none revision + re-save stable | stripped | PASS | PASS |
| G invalid-override-reveals-default, no target | dropped + reason | FAIL (dropped, no reason) | PASS |
| G invalid-override-reveals-default, with target | kept, hybrid | PASS | PASS |
| H orphan/duplicate/invalid siblings | 1 kept + 3 reasons | PASS | PASS |
| I serialize/parse/reserialize byte-identical, v2, key order | identical | PASS | PASS |
| §9 reorder / moves-on-override / homogeneous pins | pinned | PASS | PASS |
| §9 resolve revision stable across reopen | stable | FAIL | PASS |
| §10 full WNCAD round-trip → CURRENT → reserialize identical | identical | FAIL | PASS |

Post-fix: new file 14/14 GREEN; existing
`cad_grading_hybrid_persistence_20j` + group + provenance suites GREEN
(see §5).

## 5. Validation log (Track 1)

- New `tests/cad_grading_hybrid_persistence_20j1.test.ts`: 14/14 PASS.
- Existing hybrid persistence (`20j`) + hybrid group (`20j`) + analytic
  (`20f`) + mixed-analytic (`20h`): 88/88 PASS across 5 files.
- Existing group model/compute/commands (`20c`): 49/49 PASS (3 files);
  hybrid provenance (`20j`): 11/11 PASS.
- `npm run lint -- --quiet`: clean. `npm run typecheck`: clean.

---

# Track 2 — Tie-tolerance audit + quantity-specific agreement contracts

## 6. Old contract (removed)

```ts
export const tieAgreementTol = (a, b, x, y) =>
  zeroDelta(a, b) * Math.max(1, Math.abs(x), Math.abs(y));   // 4·eps·max(1,|a|,|b|)·max(1,|x|,|y|)
```

`zeroDelta` (18I) is the *classification* floor (`4·eps·max(1,|zA|,|zB|)`).
Multiplying it by a second world magnitude gives a **double world scale**:
for a coordinate comparison it is `4·eps·|xy|²`. At the 20J E2M/N7M oracle
(x=2 000 040, y=6 999 980) that is `1.24e-2 m` (X) and `4.35e-2 m` (Y) — a
10 mm genuine mismatch passed the X gate. The gate no longer exists as an
export; there are no remaining importers (verified with `rg tieAgreementTol`).

## 7. Doc-claim discrepancy

`docs/evidence/phase20j-hybrid-grading-performance.md:97-98` states the
coordinate-aware bound "stays ~1e-13..1e-12 m". That is only true at local
coordinates. Recomputing the old formula at the projected offsets used by
this audit gives the values in §8 — up to `2.7e+1 m` at 100 M/300 M. The
claim is superseded by this section; the Phase 20J receiver's contract file
is owned by Track 1, so the correction is recorded here rather than edited
in place.

## 8. Recomputed bounds (old vs new), single world scale only

X/Y = `coordinateAgreementTol`; t = `seamParameterAgreementTol`; Z =
`elevationAgreementTol` with representative leverage
`0.5·x + 0.25·y + 0.5·x + 0.25·y`.

| scenario (x,y) | X old | X new | t old | t new | Z old | Z new |
|---|---:|---:|---:|---:|---:|---:|
| local (145, 24) | 1.87e-11 | 1.03e-12 | 5.76e-12 | 1.03e-12 | 1.16e-11 | 1.90e-12 |
| 500k / 5M | 2.22e-3 | 3.55e-8 | 1.99e-7 | 3.55e-8 | 4.00e-7 | 2.13e-8 |
| 2M / 7M | 1.24e-2 | 4.97e-8 | 2.78e-7 | 4.97e-8 | 5.60e-7 | 3.91e-8 |
| 20M / 70M | 1.24e+0 | 4.97e-7 | 2.78e-6 | 4.97e-7 | 5.60e-6 | 3.91e-7 |
| 100M / 300M | 2.67e+1 | 2.13e-6 | 1.19e-5 | 2.13e-6 | 2.40e-5 | 1.78e-6 |

Old t = `zeroDelta(sqrt(2000),sqrt(2000))·scale` = 3.9721e-14·scale; old Z =
`zeroDelta(90,90)·scale` = 7.9936e-14·scale (corrected 2026-09-30 per
independent review; prior draft under-reported both columns).

New X/Y/t bounds are `AGREEMENT_OPS·max(quantum)` with `AGREEMENT_OPS = 32`
and `quantum = eps·max(1,|coordinate|)`. New Z bounds add the single-axis
`|g|·|coordinate|` leverage the old Z-scale missed; the old Z bound was
larger than needed at projected (it multiplied by the wrong world factor) yet
still failed to bound the true residual, which is driven by the local
gradient leverage. Everything stays ≥6 orders below the 0.1 mm floor at
realistic coordinates.

## 9. Contracts and derivations

```ts
coordinateAgreementTol(a, b, coordinateScale)      = 32·eps·max(1,|a|,|b|,|coordinateScale|)
seamParameterAgreementTol(tS, tA, extent, scale)   = 32·max(eps·max(1,|tS|,|tA|,|extent|), eps·max(1,|scale|))
elevationAgreementTol(zA, zB, leverage)            = 32·eps·(max(1,|zA|,|zB|) + Σ|leverage|)
planeLeverage(plane, x, y)                         = [ |gx|·max(1,|x|,|ax|), |gy|·max(1,|y|,|ay|) ]
```

Derivation: each tie quantity is produced by a bounded forward chain (ray
interval clip → anchored plane fit → affine root solve → final world-space
add). `AGREEMENT_OPS = 32` is the accumulated flop/rounding budget of that
chain. The X/Y residual is a last-bit coordinate difference and scales with
the single coordinate magnitude; the seam parameter is a distance along a
unit ray, so a coordinate-quantum perturbation bounds `|Δt|` directly (the
seam-t bound is a single-quantum term, never a product of two world
magnitudes); the elevation residual is the anchored plane evaluation error,
whose scale is the anchor elevation plus one `|g|·|coordinate|` term per
axis. No contract multiplies two world magnitudes.

`zeroDelta` was not changed. The strict `zeroDelta` gates in
`solveSectorPath` / `liftDaylightToWorld` are preserved.

### Anchored target plane

`targetPlaneAt` now returns `{ax, ay, zAtAnchor, gx, gy}` (anchor = first
triangle vertex) and `targetPlaneZ(p, x, y) = zAtAnchor + gx·(x-ax) + gy·(y-ay)`.
The affine root equation along the ray and the sector-path delta both use this
form. The intercept form `z = a·x + b·y + c` was forbidden because `c ≈
-a·x0 - b·y0` cancels two ~1e6 terms per evaluation. Root counts, nearest
order, GAP/OVERLAP classification, alternate-triangulation results, and axis
digests are unchanged (perf matrix baseline vs new: every digest identical).

## 10. Measured rotated-twin residuals vs new bounds

Closed 100×100 hybrid square, members rotated in plan about (50,50), flat
cover z=0; measured `|sTie-aTie|` per axis and seam parameter:

| scenario | Δx | Δy | Δz | Δt | new floor |
|---|---:|---:|---:|---:|---:|
| local 10° | 5.7e-14 | 5.0e-14 | 8.9e-16 | 8.9e-14 | ≥9e-13 |
| local 30° | 2.8e-14 | 1.1e-14 | 5.3e-15 | 3.2e-14 | ≥9e-13 |
| 500k/5M 10° | 4.7e-10 | 0 | 1.0e-10 | 5.5e-10 | 3.6e-8 |
| 500k/5M 30° | 4.4e-9 | 9.3e-10 | 2.3e-10 | 4.6e-9 | 3.6e-8 |
| 2M/7M 10° | 4.7e-10 | 9.3e-10 | 9.6e-11 | 5.3e-10 | 5.0e-8 |
| 2M/7M 30° | 4.0e-9 | 9.3e-10 | 7.4e-11 | 4.2e-9 | 5.0e-8 |
| 20M/70M 10° | 0 | 0 | 6.6e-10 | 3.7e-9 | 5.0e-7 |
| 20M/70M 30° | 3.7e-9 | 0 | 3.7e-9 | 3.0e-9 | 5.0e-7 |
| 100M/300M 10° | 1.0e-7 | 6.0e-8 | 1.8e-9 | 1.3e-7 | 2.1e-6 |
| 100M/300M 30° | 2.1e-7 | 6.0e-8 | 5.9e-9 | 2.2e-7 | 2.1e-6 |

Every rotated twin solves (`ok`, 4 corners) and every residual is far below
its floor and below 0.1 mm.

## 11. Mismatch ladders (`cad_grading_tie_agreement_20j1.test.ts`)

| dimension | ladder | result |
|---|---|---|
| target elevation | 1 ulp … 1e-2 | 1 ulp passes; ≥1e-9 fails closed |
| analytic Distance | 1e-9 … 1e-2 | all fail closed |
| analytic RelElev | 1e-9 … 1e-2 | all fail closed |
| analytic source grade | 1e-9 … 1e-2 | all fail closed |
| hard 0.1/1/10 mm | 1e-4 / 1e-3 / 1e-2 at local + all projected offsets | fail closed (`CORNER_NO_SOLUTION` / `GRADING_SURFACE_ANALYTIC_*`) |
| exact | 0 offset | solves with the exact common tie (no average/snap/bridge) |

Translation invariance: the 0.1 mm mismatch fails at local and at
500k/5M, 2M/7M, 20M/70M, 100M/300M while the exact tie still solves and
translates within 1e-6.

## 12. Non-regression

| corpus | evidence |
|---|---|
| Surface Fixed axis tie | `(0,-20,90)` exact; due-east `(20,0,90)` exact |
| edge/vertex hit | edge-graze `x=0`; vertex `x≈4.14213562` |
| alternate diagonal + 10°-rotated target | match the axis tie within 1e-6 |
| large-coordinate surface tie | `(1e6, 1e6-20, 90)` within 1e-3 / 1e-6 |
| surface closed-square digest | `cf7db4bbe9ba2995` (Fixed) |
| hybrid closed-square digest | equals Surface / Distance / mixed-analytic controls |
| 20J perf matrix | baseline vs new: every digest identical (`7b2f…`, `9b81…`, `15cb…`, `f7ea…`, `0a02…`, `3c7f…`, `77cc…`, `a462…`) |
| hybrid oracle pins | `(40,-20,90)`, `√2000 = 44.721359549995796`, plan 4400, 3D gap 859.5241580617239 |

## 13. Perf note (measurement only, fixtures outside the timed region)

| scenario | hybrid closed-square | root-solve (`solveMiterTie`) | digest |
|---|---:|---:|---|
| local | 0.92 ms | 1.27 µs | `f7ea394f48c954d8` |
| 2M / 7M | 0.75 ms | 0.91 µs | `f7ea394f48c954d8` |

Dominant stage is the target index/grid build plus the member sweep; the
exact-common-tie corner is O(1) per joint. Anchoring the target plane adds
no measurable cost. Sanitize/parse is unchanged by this track and is owned by
Track 1; no persistence file or persistence test is touched here.

## 14. Verdict (Track 2)

- Generic double-scaling removed; the `tieAgreementTol` export is gone.
- X/Y/t/Z bounds are quantity-specific, single-world-scale, and justified by
  the forward-error chain; `zeroDelta` untouched; strict sector-path gates
  preserved.
- Exact local + projected classification invariance holds; rotated 10°/30°,
  alternate-diagonal, and jittered twins pass.
- 0.1/1/10 mm mismatches fail closed at local and projected coordinates.
- Legacy Surface and hybrid digests unchanged; root policy/nearest-root
  behaviour unchanged; arc×arc stays blocked, transitions stay fail-closed.
- `npm run lint`, `npm run typecheck`, and the focused grading suites pass.
