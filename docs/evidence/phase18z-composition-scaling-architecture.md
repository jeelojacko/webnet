# Phase 18Z — composition scaling architecture and strategy

- **Branch:** `perf/cad-surface-composition-scaling`
- **Companion profile:** `docs/evidence/phase18z-composition-stage-profile.md` (measured 1k/10k stage table)
- **Status:** analysis + strategy. No production behavior changed in this phase.
- **Scope:** exact two-surface composition (`composeSurfaceMeshes`, policy `overlay-coverage-wins`).

---

## 1. Current pipeline (12 steps)

The pipeline lives in `src/engine/cad/surfaceCompose.ts` `composeSurfaceMeshes`
(`:120-291`) and delegates the retriangulation to `src/engine/cad/tin/tinBuild.ts`
`buildConstrainedTin`.

| # | step | code |
| --- | --- | --- |
| 1 | create Base mesh view (uniform-grid bbox index + vertex hash) | `surfaceCompose.ts:131`, `surfaces/compose/coverage.ts:39` |
| 2 | create Overlay mesh view | `surfaceCompose.ts:132` |
| 3 | overlay boundary extraction (derived adjacency → boundary edges) | `surfaceCompose.ts:134-135`, `surfaces/compose/pslg.ts:49` |
| 4 | PSLG assembly: exact XY interning + every overlay edge as constraint + base-edge clipping against overlay coverage | `surfaceCompose.ts:136`, `surfaces/compose/pslg.ts:259-352` |
| 5 | constraint preparation: split segments at exact-interior collinear vertices, canonical sort + dedupe | `tin/tinBuild.ts:126-145` (`splitAtInteriorVertices` `:65-101`) |
| 6 | Delaunay base (delaunator, local-frame conditioning) | `tin/tinBuild.ts:149`, `tin/tinBase.ts:31-60` |
| 7 | constrained-edge recovery (Sloan flips) with bounded Steiner-restart rounds (`maxRounds = 6`) | `tin/tinBuild.ts:147-178`, `tin/tinConstraintRecovery.ts:58-125` |
| 8 | Lawson legalization (constrained edges never flipped) | `tin/tinBuild.ts:185`, `tin/tinLegalize.ts:10-64` |
| 9 | domain filter (compose passes empty outers/voids → retain all) + triangle canonical order + adjacency/edge-kind rebuild | `tin/tinBuild.ts:186-205`, `tin/tinDomainFilter.ts:28-51`, `tin/tinTopology.ts:34-61` |
| 10 | centroid ownership classification (`overlay` wins, else `base`, else `drop`) | `surfaceCompose.ts:151-158` |
| 11 | seam Z gate (3 probes per true seam edge, fail-closed) + owner-plane Z + base pinch check | `surfaceCompose.ts:163-240` |
| 12 | canonical output (`canonicalizeBakedTin`) + explicit payload validation + topology digest/provenance + area diagnostics | `surfaceCompose.ts:245-291` |

Ownership is the only disambiguator; the domain filter is intentionally a no-op for composition
(`outers`/`voids` are `[]`), so islands/holes/voids survive to the `drop` classification.

---

## 2. Where O(n²) comes from

Measured evidence (from the companion profile, 10k partial-seam): `findEdgeTriScans`
grows **99.9×** for a 10× input increase. Recovery is 79.2 % of the engine; legalize is 0.10 %.

### 2.1 Dominant — constrained-edge recovery (`tinConstraintRecovery.ts`)

For every segment, and again after every flip, the algorithm rescans the whole triangle list:

- `findEdge` — O(T) linear scan (`:21-25`), called once per segment and once per flip.
- crossing map — rebuilt from scratch over all triangles × all triangle edges, with exact
  `properlyCrosses` predicates (`:81-92`), once per flip iteration.
- flip application — two full-array `Array.filter` reallocations per flip (`:97-100` for the
  adjacent-pair lookup, `:118` for edge removal) plus a triangle push. Each is O(T).

With S segments and T triangles both ≈ linear in n, total work is Θ(S·T) = Θ(n²). At 10k:
2 529 flips × 10 082 triangles (crossing map) + 5 058 mesh filters + 168.1 M `findEdge` triangle
visits. This is the single largest cost in the engine and the first target.

### 2.2 Secondary — PSLG base-edge clipping (`surfaces/compose/pslg.ts`)

`clipBaseEdge` (`:171-249`) is called once per unique base edge (`:344`). Each call queries the
boundary uniform grid for candidates and, per kept piece, calls `covered()` → `locateInMesh`
(`:247`, `:267`). The candidate index is built only over the overlay *boundary* (`:313`), so its
cell size degenerates when the boundary is small relative to the base extent, increasing the
candidate fan-out. Measured 50× growth (10.1 → 504.4 ms); fit for an O(length) traversal instead
of a per-edge rescan.

### 2.3 Secondary — constraint preparation (`tinBuild.ts`)

`splitAtInteriorVertices` (`:65-101`) is a double loop: for each segment, scan **every** point
(`:74`) to find exact-interior collinear vertices. Θ(S·N) = Θ(n²). Measured 85× growth
(2.9 → 247.4 ms). `prepSegmentsAfterSplit == prepSegmentsBeforeSplit` at 10k here (the grid has no
collinear interior vertices), so the 247 ms is pure scanning. A per-segment bbox query against a
point grid would make it O(S·k).

### 2.4 Secondary — ownership and Z point location (`surfaceCompose.ts` + `coverage.ts`)

`locateInMesh` (`coverage.ts:120-136`) rebuilds a `${x},${y}` string key for every query. Ownership
calls it twice per built triangle (`surfaceCompose.ts:151-158`, 17 572 calls at 10k, 5.2 %), and Z
assignment calls it once or twice per point (`:204-230`, 12 887 calls, 2.6 %). String keys are a
constant-factor tax; the two passes also recompute what the other already knows. Also note the
overlay view is built **twice**: once at `surfaceCompose.ts:132`, again inside `buildComposePslg`
(`pslg.ts:266`).

### 2.5 Non-factors measured

- `legalizeTin` (`tinLegalize.ts`) — 1 pass, 0 flips, 6.0 ms (0.10 %). Although it rebuilds the
  edge map per pass and restarts after each flip (`:19-29`, `:59`), the Delaunay base already
  satisfies the empty-circle property on these inputs. Do not optimize first.
- `steinerRequests = 0`; the non-convex-quad fallback never fires on grid geometry.
- Boundary extraction, PSLG interning, canonicalization, digest — all ≤ 4 ms at 10k.

---

## 3. Strategy options (P0–P4)

These are the mission's five levers. Assessment is **preliminary and evidence-informed**, not
prototyped. Effort is relative; none is committed yet.

### P0 — Fast paths / cheap wins

- De-duplicate the overlay view: pass the already-built view (or the boundary index) from
  `composeSurfaceMeshes` into `buildComposePslg` instead of rebuilding (`pslg.ts:266`).
- Maintain an incrementally-updated mesh edge `Set` in recovery so the common case ("segment
  already present") is O(1) instead of O(T).
- Skip `splitAtInteriorVertices` when no point lies strictly inside any segment (bbox pre-check).
- Preserve existing behavior exactly; these are safe, independent, small diffs.
- **Effort:** low. **Payoff:** removes most of `findEdge`'s 168 M scans and the redundant view
  build; touches little logic. **Best first co-change with P2.**

### P1 — Component partition

- Split the PSLG into connected components, triangulate each independently, compose per island,
  stitch outputs (union of faces; no cross-component edges).
- Directly fixes the `disjoint` pathology (measured ~2.9× partial-seam at 1k) where the hull
  spans the empty corridor and every corridor cell is triangulated then dropped.
- Single-component cases (partial-seam, full-overlay) do not benefit; adds labeling + stitching
  complexity.
- **Effort:** medium. **Payoff:** high for multi-island inputs, zero for the dominant case.

### P2 — Indexed recovery

- Replace O(T) `findEdge` with an adjacency-indexed edge map (or a triangle walk from the segment
  midpoint) and process only the triangles actually crossed by the segment, using the current
  triangulation's connectivity.
- Replace the from-scratch crossing map with an incremental "triangles crossed by segment" walk;
  apply flips by local adjacency surgery, not two whole-array filters.
- This is the direct answer to §2.1 and the only option that attacks the 79 % cost.
- **Effort:** medium-high (must preserve exact determinism: sorted edge-key order and exact
  predicates at every decision). **Payoff:** highest — up to ~5 s of the 6 s 10k budget.

### P3 — Incremental legalization

- Replace full edge-map rebuild + break-restart with a flip-queue that updates edge adjacency in
  place.
- Measured cost is 6.0 ms of 6 141 ms (0.10 %); the input already satisfies Delaunay.
- **Effort:** medium. **Payoff:** negligible for composition. **Defer.**

### P4 — Seam-local processing

- Restrict retriangulation to the seam band: keep overlay-owned cells as authored and only
  rebuild the base-only region plus a band around the overlay boundary.
- Caveat: the PSLG constrains **every** overlay interior edge (plane-breaks), not just the
  boundary, so "seam-local" only works if the overlay's own triangulation is reused verbatim
  inside coverage. Then the genuinely new work is the base edges outside overlay plus the
  boundary split. This is the largest algorithmic change and the highest correctness risk
  (ownership, Z gate, digest must stay byte-identical).
- **Effort:** high. **Payoff:** potentially the largest asymptotic win (work ∝ seam length),
  but depends on P2 indexes for the base-only region. **Prototype after P2.**

### Preliminary order

1. **P2 indexed recovery** — removes 79 % of the dominant cost; the measured `findEdgeTriScans`
   counter is the direct success metric.
2. **P0 fast paths** — land alongside P2 (dedupe overlay view, O(1) segment-presence check,
   bbox-guarded split). Low risk, measurable.
3. **P1 component partition** — for `disjoint`/multi-island inputs.
4. **P4 seam-local** — only after P2 proves the indexed walk; reuse overlay coverage as authored.
5. **P3 incremental legalization** — only if a future corpus starts generating real legalize work.

---

## 4. Reference-oracle plan

The 18Y algorithm is the compatibility contract (exact owner-plane Z, exact canonical topology,
fail-closed seam gate, digest). Strategy changes must be checked against it, not against prose.

**Plan:**

1. **Preserve the 18Y engine verbatim as `composeSurfaceMeshesReference`.** Keep the current
   `composeSurfaceMeshes` body unchanged under the new name (same module or a sibling
   `surfaceComposeReference.ts`). The optimized `composeSurfaceMeshes` is added alongside; the
   public signature, result union, reason codes, provenance, and digest are preserved. No caller
   changes.
2. **Parity corpus (randomized).** Grids of varying side/cell/origin, random translations,
   reused vs flipped diagonals, voids, disjoint islands, L/intersecting seams, and non-identical
   planes (must fail closed with the same reason + coordinates). For each case assert exact
   equality of `canonical.vertices`, `canonical.faces`, `diagnostics`, and `digest` between the
   reference and the optimized path.
3. **Fixture-backed regression.** The existing 18Y suite and any compose fixtures run against
   both functions in the same run; the assert is byte equality. The reference is retained for as
   long as the optimized path exists.
4. **Tier classification.** A short randomized parity suite belongs in the agent tier; any
   repeated-real-WASM or long campaign belongs in `tests/evidence/` and must be registered in
   `scripts/testTiers.ts` (never silently added to an automatic tier).
5. **Perf harness.** Extend the existing evidence harness
   (`tests/evidence/phase18y_compose_perf.test.ts`) or add a sibling 18Z harness; the temporary
   stage probe used for this profile is not committed.

**Invariant:** the reference is the oracle for *correctness*; the profile is the oracle for
*where to optimize*. The optimized path replaces the reference only after the randomized corpus
and fixtures pass byte-for-byte.
