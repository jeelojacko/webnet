# Phase 20K.2 Worker C — curved Design Patch + CUT/FILL direct-fan closeout

Status: **GREEN for the scoped fixes; all-Surface Design Patch explicitly
restricted**. Branch `fix/phase20k2-curved-topology-product-closeout`, baseline
`fbac7c88` (PR #142 merge; Phase 20K.1 closeout). Worker C scope: curved
Design Patch and the Surface CUT/FILL direct-fan policy. The sibling
topology worker (`assembleSurfaceChain` shell numerics, `gradingTopology`
cycle core, topology certificate, Extract/Bake transaction policy) is out of
scope and untouched.

Tests added:

- `tests/cad_grading_curved_design_patch_20k2.test.ts` (12)
- `tests/cad_grading_cutfill_seam_target_20k2.test.ts` (14)

## 1. Source fixes

### 1a. Captured source-ring normalization (`designPatchRing.ts`)

`normalizeCapturedRing` already dropped a repeated closing vertex. The Phase
20K.1 closed rounded-square capture also repeats every internal source station
`V` three times: the GAP fan emits `(V,Qin)`, `(V,T)`, `(V,Qout)` and each
pair reuses the same source sample. Those are exact same-station duplicates,
so they are collapsed bit-identically (first wins), preserving order,
orientation, Z, and every distinct sample. No tolerance, no curve fit, no
averaging. The straight square has no duplicates, so its path is unchanged.

### 1b. Representation-station simplicity (`designPatchRing.ts`)

`validateSourceRing` now judges simplicity on the representation-collapsed
station list: two vertices are the same physical station when plan XY and Z
agree within the shared representation-agreement contract
(`coordinateAgreementTol` / `elevationAgreementTol` + the 1 nm
`AGREEMENT_FLOOR`). The Surface seam assembly recomputes a station sample as
`start + t·length`, so its twin can differ from the exact shared joint endpoint
by a few ulps (genuine stations are metres apart). This recognises twins in
the predicate only; no vertex is moved, averaged, or dropped, and genuine
macroscopic self-intersections still fail closed.

### 1c. CUT/FILL direct fan membership (`gradingChordSeam.ts`)

The pre-20K.2 fallback activated a direct fan whenever `solveSurfaceCorner`
returned `CORNER_INVERTED / GRADING_CORNER_RAY` and the two side grades
differed. It now additionally calls `directFanOnTarget`: a CUT/FILL criterion,
`V` agreeing with the target under the anchored elevation contract, and the
whole `qIn→V→qOut` fan covered by one target plane (anchored plane through the
three points, segment-walked against the target elevation). A void, ridge,
valley, step/branch, off-target `V`, or non-CUT/FILL criterion fails closed
with `GRADING_SURFACE_SEAM:GRADING_SURFACE_SEAM_TRANSITION_REQUIRED`. No
averaging, projection, later-root preference, or tolerance relaxation. The
global `zeroDelta` classification floor is untouched.

## 2. A3 — product-stage matrix (real closed feature-line group → DESIGNPATCH)

| Fixture | engine | pts/tris | ties | plan | Extract | Bake | Design Patch |
|---|---|---|---|---|---|---|---|
| all-Distance | CURRENT | 128/128 | 4 GAP | 9452.124826335 | pass | pass | **pass** |
| mixed-analytic | CURRENT | 128/128 | 4 GAP | 9452.124826335 | pass | pass | **pass** |
| all-Surface | CURRENT | 156/156 | 4 GAP | 9452.124826335 | pass | pass | **restricted** |

Design Patch detail (all-Surface): `DESIGN_PATCH_NON_SIMPLE_RING :
SURFACE_EDIT_NOT_APPLICABLE` (the interior ear-clip refuses the ulp-twin
source ring). The blocked command returns the identical history object (zero
mutation) and Bake is unaffected.

### 2a. Pre-fix Design Patch failure stages (RED recording)

- all-Distance / mixed-analytic: post-CURRENT, Design Patch failed at
  `resolveDesignPatchRing` → `validateSourceRing(ring)` →
  `DESIGN_PATCH_NON_SIMPLE_RING: self-intersection 0/2`. The captured ring held
  the exact `V` triples, and the self-intersection scan on the zero-length
  segment `2/3` fired before the `i=1` adjacent-duplicate check. Fixed by 1a.
- all-Surface: Design Patch failed at
  `resolveDesignPatchInterior` → `buildPadInterior` → `earClip`
  `EditHalt('SURFACE_EDIT_NOT_APPLICABLE')`, surfaced as
  `DESIGN_PATCH_NON_SIMPLE_RING: SURFACE_EDIT_NOT_APPLICABLE`. Remains
  restricted (section 3).

## 3. all-Surface restriction — root cause and next-phase fix

The Surface seam assembly in `assembleSurfaceChain` resamples each chord's
source as `start + t·length`; its last sample differs from the exact shared
joint endpoint `V` by ulps. The captured source ring therefore carries an
ulp-twin micro-edge at every seam (`156 pts / 156 tris` shell). The
representation validator (1b) accepts the ring, but `earClip` cannot build a
pad from the micro-edged ring, so the all-Surface Design Patch fails closed.

**Recommended next-phase fix** (out of scope per the orchestration decision):
canonicalize the Surface chord-run source endpoints to the exact joint
stations in `assembleSurfaceChain` (the analytic path already shares them
bitwise). Oracle: with that one change the all-Surface rounded square becomes
**128 pts / 128 tris, plan 9452.124826335** — bitwise-matching the all-Distance
analytic path for the same grading planes — and the captured ring collapses to
32 simple vertices, so Design Patch passes. This must be done by the topology
worker with the full oracle-by-oracle justification.

Nine frozen assertions across five suites move under that oracle change
(old → new). All are Surface-path tessellation counts, coincidence counts, or
digests; none is a plan-area or tie regression:

| Suite | Assertion | Old | New |
|---|---|---|---|
| `cad_grading_arc_surface_seam_20k1` | slope 10→10.5 strip | 39 pts / 37 tris | 32 pts / 30 tris |
| `cad_grading_arc_surface_seam_20k1` | slope 10→11 strip | 39 pts / 37 tris | 32 pts / 30 tris |
| `cad_grading_arc_surface_seam_20k1` | all-Surface square | 156 pts / 156 tris, 11 coincident sets | 128 pts / 128 tris, 0 coincident sets |
| `cad_grading_arc_surface_seam_20k1` | one-arc hybrid G | 43 pts / 41 tris | 36 pts |
| `cad_grading_arc_surface_seam_20k1` | surface-arc digest(0.1) | `b6bdc245` | `fa5c84cd` |
| `cad_grading_arc_internal_seam_20k1` | frozen matrix D / H / G | 39 / 156 / 43 pts | 32 / 128 / 36 pts |
| `cad_grading_curved_group_topology_20k1` | one-arc hybrid G | 43 pts | 36 pts |
| `cad_grading_hybrid_arc_pair_mesh_20k` | committed corpus | 80 pts | 46 pts |
| `cad_design_patch_20d` | (e) curved joint seam gate | seam-gated | outcome changes |

The hybrid corpus and seam-gate moves show why this is a topology-worker
change, not a mid-flight Worker C expansion.

## 4. A4 — CUT/FILL direct-fan evidence

Fixture: `roundedSquareMembers(10)[0]` arc over the 10 m-step tilted target
`z = 10 + 0.1·(x − 50)`, CUT/FILL `cut 0.5 / fill −2`, tol 0.1. Pre-fix
instrumentation recorded the fan branch (`solveSurfaceCorner` →
`CORNER_INVERTED / GRADING_CORNER_RAY`, `gIn = −2`, `gOut = 0.5`), i.e. the
transition lands exactly on a tied station: `qOut == V` and `qIn ≈ V` (the
direct segment is a single point, not a wedge). Post-fix the fan is admitted
because the tied station collapses; the fixture is CURRENT (181 pts / 177 tris,
CUT + FILL regions).

`directFanOnTarget` policy tests (see the suite):

- accept: flat planar, sloped planar, alternate triangulation of one plane,
  coplanar multi-triangle, tied-station collapse, translated.
- reject: non-CUT/FILL criterion, off-target `V`, ridge, valley, void,
  stepped/branched (multi-root) bridge.

## 5. Agreement floor (1 nm) — honest bound

`AGREEMENT_FLOOR = 1e-9` m (`gradingGroupSectors.ts`) is the explicit
representation-noise bound for anchored elevation agreement; genuine
mm-scale+ mismatches fail by orders of magnitude. The mismatch ladder
`0, 1e-12, 1e-9` is accepted and `1e-8, 1e-6, 1e-3` is rejected by the fan
gate. The global `zeroDelta` classification floor is unchanged.

## 6. Validation

Clean baseline worktree at `fbac7c88` with only the Worker C source/test
changes:

- focused + legacy + design-patch + hybrid + topology-audit suites:
  **195 passed** (15 files), including `arc_surface_seam_20k1`,
  `arc_internal_seam_20k1`, `analytic_seam_20k1`, `design_patch_20d`,
  `design_patch_apply_20d`, `design_patch_planar_20e`,
  `curved_products_20k1`, `curved_group_topology_20k1`, the four
  `hybrid_arc_pair_*_20k` suites, and `topology_audit_20k1`.
- `eslint` on the touched files: clean.
- `tsc --noEmit`: clean (pre-existing `study-desktop` `@tauri-apps/api`
  resolution errors only).

The shared worktree currently also carries in-progress sibling topology
changes (a stricter boundary-cycle gate). That gate rejects the Surface
meshes this scope consumes with `GRADING_ARC_SEAM_PINCH: boundary cycle 0
self-crosses`, which also fails the existing `arc_surface_seam_20k1`
`CUT→TIED→FILL` fixture — i.e. the conflict predates and is independent of
Worker C. Under the base-commit validator every Worker C test is green; the
fan/certificate boundary agreement with the new cycle gate is a topology
worker follow-up.
