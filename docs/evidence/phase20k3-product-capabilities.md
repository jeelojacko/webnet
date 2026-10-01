# Phase 20K.3 — independent product capabilities (Wave E1)

Status: **IMPLEMENTATION COMPLETE on branch
`fix/phase20k3-surface-curve-authority-certificate`, baseline `884b36e8` =
PR #143 merge.**

## 1. The problem

The 20K.2 snapshots exposed one `exportable` boolean shared by Extract, Bake,
and Design Patch. The three products have **different** representability rules,
so a single flag was either too strict for Bake or too loose for Extract; the
standalone `GRADING*` availability that tested `status === 'CURRENT'` even
enabled a multi-region Extract that returned null (an enabled-null).

## 2. The authority

`deriveGradingProductCapabilities`
(`src/engine/cad/grading/gradingProductCapabilities.ts`) derives the three
capabilities from one CURRENT (or absent) result and revalidates the `gtop2`
certificate **once**, shared by both snapshots and the product command
wrappers. Availability and execution read the same derivation, so an enabled
control always executes.

- `extractable` — one continuous boundary Feature Line.
- `bakeable` — one explicit-TIN surface (`materializeExplicitTin` rebuilds
  arbitrary validated face sets 1:1).
- `designPatchable` — one closed connected annular shell (group scope only), with a simple captured source ring, flat/planar interior, matching mesh, and mergeable pad. UI and command share the pure preflight; missing or stale `gtop2` blocks execution.

## 3. Capability table

Measured by `tests/cad_grading_surface_products_20k3.test.ts` (18 tests) and `tests/cad_design_patch_preflight.test.ts`:

| result | extractable | bakeable | designPatchable |
|---|---|---|---|
| single-region closed group (CURRENT) | yes | yes | yes |
| multi-region tied group (CURRENT, certified) | **no** (`GRADING_PRODUCT_EXTRACT_MULTI_REGION`) | **yes** | no (`GRADING_PRODUCT_DESIGN_PATCH_NON_ANNULUS`) |
| standalone multi-region (CURRENT, certified) | no (`GRADING_PRODUCT_EXTRACT_MULTI_REGION`) | yes | n/a (null) |
| stale / not CURRENT | no (`GRADING_PRODUCT_NOT_CURRENT`) | no (`GRADING_PRODUCT_NOT_CURRENT`) | no |
| missing certificate | no | no | no |
| certificate mismatch (forged digest) | no | no (stable code) | no |
| fully-tied empty mesh | — | no (`GRADING_PRODUCT_BAKE_EMPTY`) | — |
| closed group, `closed === false` | — | — | no (`GRADING_PRODUCT_DESIGN_PATCH_NOT_CLOSED`) |

Command-vs-flag agreement is asserted: multi-region Extract adds 0 undo
entries and mutates zero project bytes, while multi-region Bake adds exactly
1 undo entry and writes one surface with truthful
`webnet-grading-group-bake` provenance. A missing-certificate Bake likewise
adds 0 undo entries (an unavailable command never nulls silently).

`bakeCode` additionally distinguishes `GRADING_PRODUCT_BAKE_MODEL_LIMIT`
(explicit-TIN model rejects the topology) from
`GRADING_PRODUCT_BAKE_CERTIFICATE` (certificate rejected the result).

## 4. Target-fan hardening

`directFanOnTarget` still requires a genuine CUT/FILL criterion, `V` on the
target under the shared anchored contract, and a planned `qIn→V→qOut` wedge.
The clipped-facet area sum is now a **two-sided** union bound:

- **under** the wedge area ⇒ void / island;
- **over** the wedge area ⇒ duplicate sheets compensating for a void;
- plus an **exact pairwise convex-polygon-intersection disjointness proof**
  (convex facet vs convex facet only — no general boolean engine).

Off-plane facets (ridge/valley) fail closed. Suite rows covering this:
accept one exact coplanar facet, accept two disjoint coplanar facets tiling
exactly once, reject duplicate sheets, reject overcoverage, reject a genuine
void, reject an off-plane facet.

## 5. Shell / UI

The shell (`gradingShellAvailable` / `gradingGroupShellAvailable`), both
managers, the ribbon, and the Design Workflow panel gate each transaction on
its own flag and surface the matching bounded notice. The stale standalone
`GRADING*` `status === 'CURRENT'` availability is removed. `exportable`
survives only as the deprecated Extract alias.

## 6. Carried restrictions

- arc×arc hybrid joints stay blocked (`GRADING_SURFACE_ANALYTIC_ARC_PAIR_UNSUPPORTED`).
- transition-less surface+analytic mixing stays blocked (`GRADING_SURFACE_ANALYTIC_TRANSITION_REQUIRED`).
- Design Patch requires a closed 2-cycle annulus with a valid planar interior and mergeable source ring.
- No curved surface/refinement/welding/persistence/auto-calc behavior is added.

## 7. Provenance

- `src/engine/cad/grading/gradingProductCapabilities.ts`.
- `src/engine/cad/grading/gradingTargetFanCoverage.ts`.
- `tests/cad_grading_surface_products_20k3.test.ts` (18),
  `tests/cad_design_patch_preflight.test.ts` (availability/execution agreement),
  `tests/cad_grading_tied_products_20k2.test.ts` (updated).
