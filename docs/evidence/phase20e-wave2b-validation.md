# Phase 20E Wave-2B — evidence + regression validation

Branch `feat/cad-grading-per-course-planar-pads`, baseline `500928c2` (mission SHA, no
advance). Scope: planar volume oracle + integration oracles, performance evidence,
regression runs, browser QA, and the R-notch/R-dense truthful status. **No `src/`
production file was modified by this wave** (reads only); the engine Wave-1A/1B
working-tree changes were exercised as-is.

## 1. Planar volume oracle + integration oracles (§§62-66)

`tests/cad_grading_planar_integration_20e.test.ts` — **9/9 pass**.

Hand derivation documented in the test header: pad footprint `0..100`,
`z(x,y) = 10 + 0.02x`, flat EG `z = 0`:

```
∫₀¹⁰⁰∫₀¹⁰⁰ (10 + 0.02x) dy dx = 100 · [10x + 0.01x²]₀¹⁰⁰ = 100 · 1100 = 110000 m³
```

| §  | oracle | result |
|---|---|---|
| 62 | plane derivation + planar pad interior volume | `a=0.02, b=0, c=10`; 10000 m²; **110000 m³** |
| 62 | baked Design Patch → ordinary 18I volume | merged 19600 m²; **fill 110000**, cut 0, net = fill |
| 62 | pure `resolveDesignPatch` seam | `planar-source`, `padZ null`, ring exact |
| 62 | non-planar ring | `DESIGN_PATCH_NON_PLANAR_INTERIOR_UNDEFINED` before mesh read |
| 63 | interior inquiry | every sample `10 + 0.02x` exact (≤5e-10) |
| 64 | 18U slope/aspect | 2 %, ratio 0.02, downslope **270° (west)**, constant face |
| 65 | 18J profile across `y=50` | linear `10 + 0.02·s`, no second difference |
| 66 | 18K section at `x=50` | constant 11 across the full width |

## 2. Performance evidence

`scripts/phase20eGradingPerf.ts` + `docs/evidence/phase20e-performance.md`
(full run wall 29.9 s, max RSS 651 MB, exit 0, **no timing gate**). Headline:

- Override resolution **~0.26–0.72 µs/course** from 20→1000 courses (0.01 ms @20,
  0.41 ms @1000) — one map build + linear walk, **no O(n²) lookup**.
- Patch build ≤82 ms at 1000 ring vertices; plane derivation ≤0.22 ms.
- WNCAD grows a flat **~330 bytes/override** (32 455 → 363 887 bytes at 1000).
- Recorded honestly: full-100k override group fails the pre-existing 20B corner gate
  (`CORNER_BRANCH_DISCONTINUITY`); the 100k-design apply is blocked by the 18Y compose
  seam floor; the coarse reference composes `EXACT` and applies in 2.45 ms.

## 3. Regression runs

| suite | result |
|---|---|
| `npm run lint` | **0 errors**, 2 pre-existing warnings |
| `npm run typecheck` | **clean** |
| `npm run test:agent` | **6497 passed**, 1 skipped, **3 failed** (pre-existing study-desktop calibration: `study_ai_unit_calibration`, `..._v5`, `..._preflight`) |
| focused 20A–20E + volume/18I + 18J/18K + 18U | **49 files / 555 tests pass** |
| focused Parcel 19A–D + transforms + exports + WNCAD + LandXML | **63 files / 555 tests pass** |
| `npm run parity:industry-reference` | **25/25 pass** |
| browser QA `tests-browser/cad-grading-advanced-20e.spec.ts` | **20/20 pass**, zero page/console errors |

The 3 study-desktop failures are the carried pre-existing real-data calibration
failures (unrelated to grading/planar work).

## 4. Browser QA (§102 A–R)

`tests-browser/cad-grading-advanced-20e.spec.ts` — letter map in the header.

| letter | coverage | status |
|---|---|---|
| A | default legacy identical to explicit all-default member list | pass |
| B | single override recalcs its member, flips revision (area 9600→8200) | pass |
| C | reset removes record, restores legacy `ggrev1` hash | pass |
| D | mixed fixed + cut/fill members, per-member regions | pass |
| E | unequal-slope miter tie on both corner planes | pass |
| F | closed unequal-criteria daylight manifold (seam ≤2 faces) | pass |
| G | save/reopen sparse overrides exact | pass |
| H | reverse physical-course keeps the override | pass |
| I | span-edit drops orphan override + history label | pass |
| J | planar DESIGNPATCH accepted (`planar-source`, `padZ null`) | pass |
| K | non-planar ring blocked | pass |
| L | curved-flat canonical capture consumed verbatim | pass |
| M | DESIGNAPPLY in place (EXACT compose) | pass |
| N | 18I volume 110000 fill on the planar pad footprint | pass |
| O | 18U slope/aspect | pass |
| P | 18J profile linear + 18K section constant | pass |
| Q | WNCAD sparse overrides field-exact, canonical stable | pass |
| R | LandXML final-design export/reimport | pass |
| smoke | `/cad` boots with zero page/console errors | pass |
| smoke | criteria editor renders 4 rows / `Overrides: 1` | pass |

**Blocked/recorded items (marked in-spec, never faked):**

- **M carried finding:** a **planar** patch bakes but the 18Y compose apply fail-closes
  on a **1.33e-15** seam floor (`SURFACE_COMPOSE_SEAM_Z_MISMATCH` at `y=-20`). The
  proven-EXACT apply is therefore pinned on the canonical flat design copy; the planar
  apply BLOCKED disposition is asserted separately in the same test so the limitation
  is recorded, not hidden.
- **Not claimed:** full live-worker calc-through (same limitation the 20C/20D specs
  record); letters are engine-seam pins plus the two real browser smoke tests.

## 5. R-notch / R-dense truthful status (§§82-83)

Re-ran the exact fixtures.

| fixture | outcome | disposition |
|---|---|---|
| **R-notch** — concave reflex L closed group | compute CURRENT EXACT; DESIGNPATCH → **`DESIGN_PATCH_MERGE_FAILED`** (reflex GAP wedge pinches the shell, daylight touches source) | **carried** — pre-existing 20C shell pinch, unchanged by 20E capture |
| **R-dense 100** — square pad, each side split into 25 courses (100 collinear courses) | compute ok (area 9600); captured ring → **`DESIGN_PATCH_NON_SIMPLE_RING`** (collinear subdivision closing vertex) | **carried** — dense straight-edge subdivision is rejected as a non-simple ring |
| **R-dense 1000** — each side split into 250 courses (1000 courses) | compute ok (area 9600); ring validates, but **`DESIGN_PATCH_RING_MESH_MISMATCH`** | **carried** — pre-existing 20C shell/source-edge agreement limit |

Resolved by 20E: the ordinary **4-course** closed flat pad and the **planar** captured
pad both build (`planar-source` for the latter), and the curved-flat canonical capture
no longer drifts (below).

### §81 curved planarity decision — confirmed

- A **curved-flat** ring (16-gon at z=10, and the arc-FL capture) is accepted as
  `flat-source`; the captured boundary is consumed verbatim (closing vertex
  normalized) — `tests/cad_design_patch_planar_20e.test.ts` + browser letter L.
- A curved ring whose Z rides a **helix** (Z linear in the sample index) is
  **BLOCKED** `DESIGN_PATCH_NON_PLANAR_INTERIOR_UNDEFINED` — no averaging, no
  least-squares, no tolerance-based "planar enough".
- The 20D curved fixture (four inward semicircles crossing at the centre) now blocks
  as **`DESIGN_PATCH_NON_SIMPLE_RING`** rather than the old re-linearization
  `RING_MESH_MISMATCH`; the Phase 20E capture removed the drift and exposed the
  fixture's real geometry.

## 6. Files

New (all uncommitted):

- `tests/cad_grading_planar_integration_20e.test.ts`
- `scripts/phase20eGradingPerf.ts`
- `docs/evidence/phase20e-performance.md`
- `tests-browser/cad-grading-advanced-20e.spec.ts`
- `docs/evidence/phase20e-wave2b-validation.md` (this file)

No `src/` file was created or modified by this wave.
