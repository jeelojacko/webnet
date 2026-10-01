# Phase 20K.3 — shared worker agreement authority (Wave D)

Status: **IMPLEMENTATION COMPLETE on branch
`fix/phase20k3-surface-curve-authority-certificate`, baseline `884b36e8` =
PR #143 merge.**

## 1. The defect

Before Wave D the worker settlement gate re-checked the **same** daylight
vertices against the **same** target as the engine, but with the bare
classification floor `zeroDelta` — orders of magnitude tighter than the
accumulated curved-arc rounding. A genuine curved seam could therefore be
CURRENT in the engine yet rejected by the worker. Separately, the standalone
source-boundary check reconstructed the endpoint as
`start + chordDir·arcLength`, which is wrong for an arc: the true endpoint is
the arc endpoint, and the reconstruction overshoots it by `arcLength − chord`.

## 2. The single shared authority

`anchoredElevationAgreementTol` (`src/engine/cad/grading/gradingGroupSectors.ts`)
is the one pure anchored bound, composed of:

- `elevationAgreementTol` evaluated on the grading plane leverage (one
  `|g|·|coordinate|` term per axis), plus
- the `AGREEMENT_OPS` (32) world-coordinate representation share, plus
  `(0.2 + 0.1) · 32 · eps · scale`,
- the unchanged 1 nm `AGREEMENT_FLOOR`.

It is reused by:

- the engine chord solve (`solveStraightChord.liftDaylightToWorld`), and
- the worker settlement gate `validateDaylightAgainstTarget`
  (`src/workers/surfaceGradingCompute.ts`), which evaluates the anchored target
  triangle plane through the bounded `GradingTargetQuery.planeAt` query,
  applies the quantity-specific leverage, fails closed on non-finite daylight,
  and returns a distinct `GRADING_AGREEMENT_DAYLIGHT_OFF_TARGET` for a target
  void.

The global `zeroDelta` classification floor is untouched, as is
`AGREEMENT_FLOOR` (= 1e-9). Standalone and group settlement share the authority.

## 3. Source boundary: captured endpoints, not a reconstruction

The standalone source-boundary half now compares the result's **own** captured
`sourceBoundaryPoints` endpoints against the persisted resolved endpoints under
the shared coordinate authority (arc centre/radius scale covers the arc
linearization ULP). The wrong `start + chordDir·arcLength` reconstruction is
deleted.

Measured on the real arc fixture (chord 100 / R 252.5):

| quantity | value |
|---|---|
| chord | 100 (to 12 dp) |
| arc length | 100.66533901607366 |
| **overshoot** `arcLength − chord` | **0.6653390160736592 m** |
| reconstructed-last error vs true endpoint | 0.6653390160736592 m |
| captured endpoints vs persisted | `null` (agree) |
| reconstructed endpoint vs persisted | `GRADING_AGREEMENT_SOURCE_BOUNDARY` |
| tampered captured endpoint (+1 m) | `GRADING_AGREEMENT_SOURCE_BOUNDARY` |

The anchored bound accepts the genuine arc-evaluation rounding and rejects the
chord-length overshoot by orders of magnitude.

## 4. Curved residual vs the bound

The Wave A measured genuine curved seam residual is **3.48e-13 m**. Against
the local leverageless bound:
`elevationAgreementTol(0,0,[]) + AGREEMENT_FLOOR = 1.000e-9 m`. The residual
passes with ~4 orders of headroom.

Mismatch ladder (2000 daylight vertices per case, perf doc §8):

| coords | agreement bound | dz 1e-8 | dz 1e-3 |
|---|---|---|---|
| local (0,0) | 1.000e-9 | `GRADING_AGREEMENT_DAYLIGHT_Z` | `GRADING_AGREEMENT_DAYLIGHT_Z` |
| projected (5e6,5e6) | 2.232e-8 | ok | `GRADING_AGREEMENT_DAYLIGHT_Z` |
| stress (1e8,1e8) | 4.273e-7 | ok | `GRADING_AGREEMENT_DAYLIGHT_Z` |

A millimetre fails everywhere; the plane leverage justifies >1 nm at projected
and stress coordinates. Agreement is one linear pass over the daylight
polyline (~0.2 µs/vertex).

## 5. Codes

| condition | code |
|---|---|
| daylight length not a multiple of 3 / non-finite members | `GRADING_AGREEMENT_MALFORMED_DAYLIGHT` |
| daylight point off the target mesh | `GRADING_AGREEMENT_DAYLIGHT_OFF_TARGET` |
| daylight elevation disagrees with the anchored target plane | `GRADING_AGREEMENT_DAYLIGHT_Z` |
| source endpoint disagrees with the persisted resolved endpoint | `GRADING_AGREEMENT_SOURCE_BOUNDARY` |

## 6. Test coverage

`tests/cad_grading_worker_agreement_20k3.test.ts` (16 tests) pins:

- straight/arc/tied-split/CUT+FILL/all-Surface-rounded-square CURRENT
  settlement through the real `SurfaceGradingService`;
- the source-boundary captured-endpoint path and the deleted reconstruction's
  `GRADING_AGREEMENT_SOURCE_BOUNDARY` rejection;
- the local + projected mismatch ladder and the untouched `AGREEMENT_FLOOR`;
- tampered / off-target / non-finite fail-closed;
- a non-planar ridge fan is not a direct cut/fill transition;
- arc×arc stays `CORNER_NO_SOLUTION` / `GRADING_SURFACE_ANALYTIC_ARC_PAIR_UNSUPPORTED`.

## 7. Provenance

- `src/engine/cad/grading/gradingGroupSectors.ts` (`anchoredElevationAgreementTol`).
- `src/workers/surfaceGradingCompute.ts` (`validateDaylightAgainstTarget`,
  `validateGradingSourceBoundary`), `src/worker` service settlement.
- `scripts/phase20k3SurfaceAuthorityPerf.ts` §6, §8.
