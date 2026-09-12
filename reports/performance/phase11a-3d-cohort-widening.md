# Phase 11A native 3D full-Qxx cohort widening certification

Evidence-only widening certification of the Phase 10M verified native full-Qxx route.
EVIDENCE ONLY: no production cap/routing/eligibility/tolerance change; 10M ON at 384,
correction OFF throughout. Production constant `NATIVE_FULL_QXX_MAX_PARAMS` stays 384.

## Provenance

- Baseline SHA: `43d5a525` (perf/3d-native-cohort-widening-certification branch point).
- Branch: `perf/3d-native-cohort-widening-certification` (uncommitted, no PR per mission).
- Environment: node v26.8.1, linux/x64; Chromium 148.0.7778.96; Firefox 150.0.2 (Playwright).
- Diagnostic seam: trailing `maxParams` (default 384) on `deriveNativeFullQxxEligibility`,
  `verifyNativeFullQxxSystems`, `finalizeNativeFullQxxVerification`,
  `NativeFullQxxCaptureSolver`, `runWithNativeFullQxxAutoRoute`. Every production call
  site omits it, so ordinary requests above 384 still route to clean TypeScript
  (proven: 480-param request takes the TS path with no bundle load).

## 1. Node wall — widening ladder 384..768 (real WASM, 1 warm-up + 3 measured runs/arm)

Arm A = pure TypeScript session; arm B = verified route (production route at 384,
diagnostic maxParams=768 above). Full-result parity exact (maxDiff 0) on all 8 rungs;
C1/C2/C3 accepted with empty reasons; no damping / fallbacks / truncation.

| params (unknowns) | TS ms | native ms | ratio | class | delta ms | Qxx MB |
|---|---|---|---|---|---|---|
| 384 (128u) | 220.7 | 175.8 | 0.80 | native-faster | -44.9 | 1.12 |
| 432 (144u) | 288.4 | 215.2 | 0.75 | native-faster | -73.2 | 1.42 |
| 480 (160u) | 382.4 | 260.9 | 0.68 | native-faster | -121.5 | 1.76 |
| 513 (171u) | 486.5 | 305.5 | 0.63 | native-faster | -181.0 | 2.01 |
| 576 (192u) | 638.3 | 394.6 | 0.62 | native-faster | -243.7 | 2.53 |
| 639 (213u) | 878.0 | 510.3 | 0.58 | native-faster | -367.7 | 3.12 |
| 705 (235u) | 1173.6 | 633.0 | 0.54 | native-faster | -540.6 | 3.79 |
| 768 (256u) | 1437.5 | 761.2 | 0.53 | native-faster | -676.3 | 4.50 |

Win grows monotonically with size; no crossover above 384 — the native kernel scales
better than the TS dense path on every rung.

## 2. Browser / worker proof (REQUIRED — Chromium + Firefox, real workers)

Method: fresh `dist/` build; TS arm = unmodified built worker chunk; native arm =
esbuild bundle of the unmodified production route + kill-switch flip + diagnostic 768
threaded in-worker only. Fresh worker per fixture+arm (fresh WASM init), 1 warm-up +
5 measured runs, page round-trip wall medians. Driver: `scripts/phase11aBrowserEvidence.mjs`.

| browser | fixture | TS | native | ratio | parity |
|---|---|---|---|---|---|
| Chromium | m128 (384) | 182.0 | 182.6 | 1.00 | 0 |
| Chromium | m171 (513) | 469.2 | 326.8 | 0.70 | 0 |
| Chromium | m213 (639) | 834.7 | 521.9 | 0.63 | 0 |
| Chromium | m256 (768) | 1305.4 | 798.1 | 0.61 | 0 |
| Firefox | m128 (384) | 334.0 | 351.0 | 1.05 | 0 |
| Firefox | m171 (513) | 1062.0 | 681.0 | 0.64 | 0 |
| Firefox | m213 (639) | 1939.0 | 1250.0 | 0.64 | 0 |
| Firefox | m256 (768) | 3260.0 | 2009.0 | 0.62 | 0 |

Route proven `native-full-qxx` with C1/C2/C3 accepted on every native run. Noise:
ACCEPTABLE (max CV 19.7%, chromium m171 TS); medians corroborate Node, raw spreads retained.
UI smoke: post-campaign main-thread probe 1 ms (Chromium) / 2 ms (Firefox),
`readyState complete` on both — tab stays interactive with 768-param results in flight.
Transfer split (native arm medians): worker-messaging over engine 6-15 ms,
main-thread accept over worker 14-70 ms across fixtures (43.9 ms Chromium / 70 ms Firefox at 768) — small vs engine walls (740/1919 ms).

## 3. Boundaries — nearest-achievable disclosure

3D coord-only params = 3xunknowns (+CTRLA/B fixed), so exact 511/512/640/641/767/769
and 383/385 are unreachable. Nearest achievable proven (single verified-route run,
parity 0, C1/C2/C3 accepted): 510 (170u), 513 (171u), 639 (213u), 642 (214u),
765 (255u), 768 (256u); 384 exact at 128u.

## 4. Multi-family breadth

128u on the production route: mixed-full, gps-dist, terrestrial-only, weak-chain,
low-redundancy, uneven, compact all PASS (ratios 0.65-0.75, parity 0).
Distance-heavy-128 EXCLUDED with reason: TS baseline converges, but the WASM solver
applies damping=1e-15 on the azimuth-unconstrained geometry, so verification rejects
fail-closed and the attempt lands clean TS — the gate working as designed, not a
parity violation. 213u diagnostic subset: mixed-full, gps-dist, terrestrial-only PASS
(ratios 0.54-0.56); distance-heavy-213 excluded (TS baseline itself non-convergent,
parity untestable — same azimuth-unconstrained cause as 10M's 32u exclusion).

## 5. C1/C2/C3 scaling + per-part timing (same coverage/tolerance throughout)

16 complete columns verified at every size; tolerances unchanged. Per-run verify cost
(ms): 384: 33 (C1 0.6 / C2 7.3 / C3 4.6 / probe 16.4); 513: 56; 639: 90; 768: 139
(C1 1.0 / C2 26.7 / C3 10.1 / probe 92.2). Verification is ~18% of the 768 native wall
(139 of 761 ms) against a 676 ms absolute saving — the proof pays for itself 5x over.
C3 stays ~10 ms at 768 (10L packed-index fast path); the TS oracle probe dominates,
as designed (bounded 16 columns, never n^2).

## 6. Memory + repeated-run pressure

Qxx bytes = n^2 x 8 (1.12 MB at 384 .. 4.50 MB at 768) — trivial vs compute; memory is
not the cap constraint. Test-process RSS peaks ~839 MB at 768 (includes the TS oracle's
second dense normal + probe columns; the production native path holds less).
Repeated sequential runs, all accepted, no truncation: 25x @384 (+14.6 MB heap),
10x @513 (+113.9 MB), 10x @639 (-103.6 MB) — GC-timing noise with no monotonic trend.
Leak verdict: NO.

## 7. Fallback matrix via diagnostic routing @639 — 12/12 clean TS, no escape

init-fail, run-throw, kill-switch, non-converge, non-finite, damped-solver,
nonfinite-solver all land clean TS with reason strings; finalizer unit rejects on
truncation / count-mismatch / malformed inline evidence; verifier rejects empty
capture. Plus §1 default-routing proof: ordinary 480-param request TS-routes with no
bundle load. Correction verified OFF throughout.

## 8. <=384 regression — unregressed

32u + 128u production route parity 0, native-faster sustained; >384 default still TS;
production constant 384 intact; correction OFF.

## 9. Scorecards (512 / 640 / 768)

- 512 (nearest 513): numerical PASS / verification ACCEPTED / browser 0.70+0.64 /
  memory 2.01 MB / fallback covered / CLEAR WIN (note: a production cap of 512 would admit the tested 510 rung and reject 513; the 513 rung + 510 boundary bracket the 512 candidate).
- 640 (nearest 639): numerical PASS / verification ACCEPTED / browser 0.63+0.64 /
  memory 3.12 MB / fallback 12/12 AT size / CLEAR WIN.
- 768: numerical PASS / verification ACCEPTED / browser 0.61+0.62 / memory 4.50 MB,
  verify 139 ms / fallback class-covered / CLEAR WIN.

## 10. Cap recommendation — ONE: 768

768 is the only widened candidate with a station-exact simple boundary (256 unknown
stations x 3; 512/640 are not divisible by 3, so no exact station count exists), and
it carries the largest measured margin (<=0.62 on all three platforms) with exact
parity, same verification coverage/tolerance, 12/12 fallback, no leaks, and 4.5 MB
Qxx. Real-world math: 768 params = 256 free 3D stations (+2 fixed controls); a
200-station 3D control network (~600 params) fits with headroom.
EVIDENCE ONLY — the production constant is NOT changed in this batch.

## 11. Test wiring added (evidence-only)

- `tests/evidence/phase11a_cohort_widening.test.ts` (8 tests) + `phase11a` suite in
  `scripts/runEvidence.mjs` + `EVIDENCE_TESTS` entry in `scripts/testTiers.ts` +
  `phase11a` in `docs/TEST_TIERS.md`.
- `scripts/phase11aBrowserEvidence.mjs` (4 fixtures, diagnostic 768 in-worker only,
  UI probe + transfer split).
- Production-code delta: trailing `maxParams` defaults only in
  `src/workers/adjustmentNativeFullQxxAutoRoute.ts`; all production call sites omit
  them (behavior bit-identical).

## 12. Verdict — GO (evidence verdict; production change NONE)

Widening certification to 768 is supported on numerical, verification, browser,
memory, fallback, and performance grounds. No production change in this batch.
