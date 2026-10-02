# Phase 20K.3 — post-merge audit and closeout record

Status: **Phase 20K.2 MERGED (PR #143); Phase 20K.3 MERGED and CLOSED via PR #144
(base `884b36e8996ac3319f5691e519f0dd94746848b0`, head `95c3195a2d99803f40d2d37f98bbb8071b0f167c`,
merge `84fbe019c372d3d381e8f76784b832596de2b173`, merged 2026-10-01T20:48:02Z).**
Historical note (preserved): this audit was drafted pre-merge when Phase 20K.3 was
IMPLEMENTATION COMPLETE, open as PR #144 for review (draft head `0f2f5139`, baseline `884b36e8` = PR #143
merge; not merged at capture time). This audit records the merged-state
facts for Phase 20K.2 and Phase 20K.3, states the Phase 20K.3 scope and honest bounds, and
indexes the 20K.3 evidence. Phase 20K.2 history is preserved in
`docs/evidence/phase20k2-post-merge-audit.md` with a dated addendum.

## 1. Phase 20K.2 merge facts (PR #143)

| Fact | Value |
|---|---|
| Base | `fbac7c88b3fadd6cce4043d2d2f7dfaa9d82a12d` (PR #142 merge) |
| Head | `41d64879` (reviewer fix round: component pin, facet-walk fan, boundary binding, doc caveat) |
| Merge | `884b36e8996ac3319f5691e519f0dd94746848b0` |
| Final-head CI | run `36851560496` — success |
| Merge-push CI | run `36853019440` — success |
| Drift | zero — the merged tree equals the reviewed head content |

Phase 20K.2 delivered the curved grading topology contract (real boundary-cycle
trace, distinct `components` / `boundaryCycles` / deprecated `loops`, per-face
positive-plan-area gate, tied component attribution), the session-only `gtop1`
certificate consumed by Extract/Bake, the `directFanOnTarget` CUT/FILL proof,
and the curved Design Patch ring collapse. It is MERGED and CLOSED.

## 2. Corrections Phase 20K.3 makes to the 20K.2 record

These are corrections of the 20K.2 *implementation* (not of its history, which
is preserved). Each was reproduced RED first, then fixed:

### 2a. Self-certification (the certificate re-checked the mesh against itself)

`buildGradingTopologyCertificate` defaulted `expectedComponents` to the
**measured** count and `validateGradingMeshTopology` enforced
`expectedBoundaryLoops` only when supplied, so a certificate could not reject
an undeclared cycle. 20K.3 declares topology **before** meshing
(`deriveGradingTopologyExpectation`, policyVersion `20k3.1`) and both the
validator call and the certificate construction use that declaration. An
undeclared 2nd (or 3rd) cycle now fails closed. See
`docs/evidence/phase20k3-topology-expectation.md`.

### 2b. `gtop1` is not exact (false-accept)

`gtop1` hashed `toPrecision(12)` text, so a sub-quantum coordinate change
produced the same digest and a product false-accept. Measured: at `1e8` a
`+1e-4` shift keeps the FNV digest. 20K.3 emits `gtop2` — exact IEEE-754
Float64 bits (little-endian, `-0` canonicalized) + validated `uint32` indices
in length-prefixed tagged sections, hashed with SHA-256 — and the exact digest
diverges where `gtop1` collided. A stale `gtop1` certificate is rejected with
no migration. See `docs/evidence/phase20k3-exact-certificate.md`.

### 2c. Straight-group seam-gate bypass

`computeGradingGroupFromSnapshots` ran `validateMergedGroupTopology` only when
`curved`, so straight-only groups kept the generic explicit-TIN check and a
2-component straight shell self-certified. 20K.3 removes the `if (curved)`
bypass: every group (straight/curved/hybrid) runs the same seam gate against
the same declared budget. Straight-only closed squares now certify the
explicit 1-component / 2-cycle annulus. See §2a doc.

### 2d. Worker agreement authority and the source reconstruction

The worker settlement gate re-checked the same daylight against the same
target with the bare `zeroDelta` floor, and the standalone source boundary
reconstructed the endpoint as `start + chordDir·arcLength`. Both are replaced
by one shared authority `anchoredElevationAgreementTol`
(`elevationAgreementTol` leverage + `AGREEMENT_OPS` share + the 1 nm
`AGREEMENT_FLOOR`): the worker gate and the engine chord solve share it, and
the source boundary now compares the result's own captured
`sourceBoundaryPoints` against the persisted endpoints. The measured genuine
curved residual is `3.48e-13 m` against a local bound of `1.000e-9 m`, and the
deleted reconstruction overshoots a real arc endpoint by `0.665339 m`
(chord 100 / R 252.5). `zeroDelta` and `AGREEMENT_FLOOR` are untouched. See
`docs/evidence/phase20k3-worker-agreement.md`.

### 2e. Boundary counts

The 20K.2 three-count contract (`components` / `boundaryCycles` / deprecated
`loops`) stands and is now enforced against a declared budget rather than an
observed one. Valid annulus meshes stay `1 / 2`; tied splits stay `2 / 2`; the
extra-cycle and doubly-punctured fixtures that 20K.2 could not reject are now
fail-closed.

### 2f. Design Patch restriction removed by exact canonicalization

The all-Surface Design Patch was restricted in 20K.2
(`DESIGN_PATCH_NON_SIMPLE_RING:SURFACE_EDIT_NOT_APPLICABLE`) because
`atSource(u)=start+t·length` produced ULP-twin micro-edges. 20K.3 shares the
single exact linearized joint `v` bit-exactly across the incoming/outgoing
runs and the corner fan (no weld/average/rounding), so the all-Surface
rounded square ear-clips the canonical 32-station ring into a 128-vertex /
158-triangle patch, and the 20D curved outward ring also applies. Counts
moved: standalone Surface `39/37 → 32/30`, all-Surface `156/156 → 128/128`,
one-arc hybrid `43/41 → 36/34`. See
`docs/evidence/phase20k3-surface-station-authority.md`.

### 2g. Product capabilities

The single `exportable` boolean is replaced by independent
`extractable` / `bakeable` / `designPatchable` capabilities with bounded
codes and notices. A certified multi-region mesh is Extract-unavailable but
Bake-available (one surface, one Undo); Design Patch is the closed 2-cycle
annulus only. Availability and command execution share the derivation, so an
enabled control never nulls silently. See
`docs/evidence/phase20k3-product-capabilities.md`.

## 3. Phase 20K.3 evidence index

- `docs/evidence/phase20k3-topology-expectation.md`
- `docs/evidence/phase20k3-exact-certificate.md`
- `docs/evidence/phase20k3-surface-station-authority.md`
- `docs/evidence/phase20k3-worker-agreement.md`
- `docs/evidence/phase20k3-product-capabilities.md`
- `docs/evidence/phase20k3-validation.md`
- `docs/evidence/phase20k3-surface-authority-performance.md` (perf wave)
- `scripts/phase20k3SurfaceAuthorityPerf.ts`
- Dated 20K.2 addendum: `docs/evidence/phase20k2-post-merge-audit.md` §7

## 4. Honest bounds retained

- arc×arc hybrid joints: blocked
  (`GRADING_SURFACE_ANALYTIC_ARC_PAIR_UNSUPPORTED`).
- transition-less surface+analytic mixing: blocked
  (`GRADING_SURFACE_ANALYTIC_TRANSITION_REQUIRED`).
- offset-radius behavior: unchanged.
- root-UX / nearest-outward root policy: unchanged.
- No curved-surface, refinement, welding, persistence, or auto-calculation
  behavior is added; `gtop2` is session-only and never persisted.
- The `O(F^2)` non-adjacent face-overlap audit remains test-only.
- The 1 nm `AGREEMENT_FLOOR` is an explicit agreement bound, not a geometry
  tolerance; `zeroDelta` is unchanged.

## 5. Verdict

The 20K.2 topology/product contract is MERGED and CLOSED. Phase 20K.3 closes
the four correctness gaps that contract left open (pre-mesh declaration, exact
digest, worker agreement authority, independent product capabilities) and
removes the all-Surface Design Patch restriction by exact canonicalization.
All hard bounds are explicit and fail closed. Phase 20K.3 was IMPLEMENTATION
COMPLETE pre-merge (open as PR #144 for review at capture time); it is now MERGED and CLOSED
via PR #144 (see §6). No new grading phase is started here.

## 6. Final merge closeout (PR #144 merged state)

| Fact | Value |
|---|---|
| PR | #144 — Phase 20K.3: close surface-curve and certificate authority contracts (`https://github.com/jeelojacko/webnet/pull/144`) |
| Base | `884b36e8996ac3319f5691e519f0dd94746848b0` (PR #143 merge) |
| Head | `95c3195a2d99803f40d2d37f98bbb8071b0f167c` |
| Merge | `84fbe019c372d3d381e8f76784b832596de2b173` |
| Merged at | 2026-10-01T20:48:02Z |
| PR commits / changed files | 3 / 80 |

Historical pre-merge observations above (draft head `0f2f5139`, open/not-merged wording)
describe branch state at capture time and are preserved as history; the table above
is the final merged-state authority. No implementation behavior is changed by this
closeout record.
