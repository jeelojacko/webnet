# Phase 20J — exact common-tie hybrid grading groups: architecture

Status: waves A/B/C1/C2 LANDED on branch
`feat/cad-grading-hybrid-exact-common-tie` (on main `6842723c` = PR #138
merge); Wave C3 (evidence + browser QA) in progress. Production hybrid
groups exist ONLY through the gated exact-common-tie path proven by the
20I evidence-only study (verdict GO_EXACT_COMMON_TIE_ONLY /
NO_GO_GENERAL_WITHOUT_TRANSITION, PR #138 merged). General
surface+analytic mixing without a transition stays NO-GO and fails closed.

## 1. Ray defect + fix (Wave A, `86425166`)

The 20I study exposed a real defect in the surface corner path: a seam ray
exactly parallel to (or grazing) a target-TIN edge could mistie in
`src/engine/cad/grading/gradingGroupSectors.ts`. The fix keeps the
nearest-outward root policy and pins axis-aligned + grazing geometry in
`tests/cad_grading_surface_ray_interval_20j.test.ts` (14 tests). No new
tolerance or formula: agreement still uses the shared 18I `zeroDelta`
floor. The Wave C3 perf harness re-exercises this path with an
axis-aligned hybrid square (§D of the performance doc).

## 2. Domain vs mode

- **Domain** (`gradingTerminationDomain`) is per-criterion and unchanged:
  `surface` (fixed/cut-fill, TIN tie) or `analytic`
  (distance/elevation/relative-elevation, closed-form limit). Derived,
  never persisted.
- **Mode** (`groupTerminationMode`, Wave B) is per-group and new: derived
  from the EFFECTIVE criteria (group default + per-course entries), never
  persisted: `surface` (all surface), `analytic` (all analytic), or
  `hybrid` (mixed). Single engine authority; the UI summary reads the same
  effective set so the two cannot drift.
- `groupTerminationRequiresTarget` is `mode !== 'analytic'`: surface and
  hybrid groups query one shared target snapshot; all-analytic groups
  never do (dormant ids stay dormant).

## 3. Exact-tie semantics (`gradingGroupHybridCorners.ts`)

`solveHybridCorner` joins one surface member with one analytic member at a
shared joint. It takes the surface nearest-outward `solveMiterTie` root
and the existing `analyticTerminalLine`, and requires BOTH to meet the
SAME seam ray: exact X/Y/Z plus seam-parameter agreement under shared
`zeroDelta`, target + terminal-line/plane agreement, both side
half-planes, and miter extent. There is no member-endpoint fallback, no
averaging, no bridging wall, no relaxed tolerance.

- **GAP** (outside turn): fans `V→Qs→tie` + `V→tie→Qa` (primary oracle:
  tie `(40,−20,90)`, extent `√2000`, fan plan `800` / 3D
  `859.5241580617239`).
- **OVERLAP** (inside turn): clips both strips to the seam (oracle: tie
  `(20,−20,90)`, audited tile-once with an independent
  no-interior-overlap check).
- CUT/FILL surface members, Distance/Elevation/Relative analytic members,
  either side order, and the upward mirror all tie through the same
  kernel.

## 4. Target

Hybrid groups resolve exactly one target snapshot + revision (the surface
side needs it; the analytic side ignores it). The target rule derives
from the EFFECTIVE set: surface-effective needs an explicit eligible
target, all-analytic omits/ignores dormant ids. Criterion+target
override transactions are atomic one-undo entries
(`GROUP_SET/RESET_COURSE_CRITERIA` + `GROUP_EDIT_CRITERIA` carry
`targetSurfaceId?`); a rejected op mutates nothing — never a silent
first-surface pick.

## 5. Authoring

Wave C1 removes the 20H prohibition: all five kinds author as sparse
effective criteria (`validateGroupTerminationDomainCriteria` and its
`validateGroupTerminationCriteria` alias always pass for kind mixes;
per-criterion validity stays in `validateGradingCriterion`; reset removes
the record, never materializes a defaults array). Wave C2 removes the
composer domain lock (`allowedMethodsForGroupDomain` admits all five)
and shows the shared `HYBRID_CORNER_WARNING` on hybrid groups — it states
the tie requirement and never claims calculability.

## 6. Persistence

Cross-domain overrides persist (schema v2, trailing key order, reopen
`UNBUILT`). `sanitizeCadGradingGroupsDetailed` still drops invalid
orphan/duplicate/criterion records with a report; additionally a
surface-effective group with no usable target drops fail-closed. A
dormant legacy target id on an all-analytic group stays dormant.

## 7. Revision

`ggrev1:` includes the target id+rev when ANY effective member is
surface (`tgt:none` all-analytic). Traversal is canonical, so reorder is
deterministic; pre-20J homogeneous bytes are identical (frozen pins).

## 8. Resolve

Resolve derives the mode (surface/analytic/hybrid → one target+rev or
none) with no blanket rejection. Hybrid requests carry the target
snapshot into the worker path.

## 9. Worker

Worker/session semantics are unchanged: manual Calculate only,
latest-wins, stale-discard, no auto-calc. Hybrid snapshots flow through
the existing group-calculate gate untouched.

## 10. Dispatch

Per-joint dispatch in `gradingGroupCompute.ts`: S↔S and A↔A joints keep
their byte-identical kernels; S↔A/A↔S joints go through
`solveHybridCorner` with the shared target query. The group-wide
same-domain rejection is removed at compute + resolve ONLY (authoring
still passes mixes by design since C1 — the fail-closed point for a bad
mix is now the corner itself).

## 11. Root policy

Multiple seam-ray roots resolve to the deterministic nearest outward
root; when the analytic tie holds a LATER root the joint fails
`CORNER_NO_SOLUTION` / `GRADING_SURFACE_ANALYTIC_ROOT_POLICY` — the root
is never re-picked to force agreement.

## 12. Diagnostics

Named `GRADING_SURFACE_ANALYTIC_*` details on every degraded path:
`ROOT_POLICY`, `TRANSITION_REQUIRED`, `TARGET_GAP`, `LINE`, `SIDE`,
`MAX`, `MESH`, `ARC_PAIR_UNSUPPORTED`. Surfaced through the standard
`CORNER_NO_SOLUTION` / `CORNER_TARGET_GAP` / `MEMBER_NO_SOLUTION` codes
with corner index; one-curved+straight joints reuse chord linearization
(`CURVE_APPROXIMATED`); arc×arc hybrid joints are blocked
(`ARC_PAIR_UNSUPPORTED`).

## 13. GAP / OVERLAP merge

GAP fans and OVERLAP clips assemble through the existing group merge
(`gradingGroupMerge.ts`, unchanged): clipped strips tile once, the tie
is retained exactly once on the corner run, and the closed hybrid square
is mesh-identical to the all-Surface / all-Distance / mixed-analytic
controls (the surface path's corner `miterExtent` keeps its pre-existing
search-bound semantics while hybrid reports the tie distance — the only
honest difference).

## 14. Status

Result semantics are unchanged: UNBUILT / NEEDS_RECALC / CURRENT /
FAILED (+stale evidence overlay via `deriveFailedEffectiveStatus`),
explicit Calculate, late-result guards. A `Δ=−12`/`D=24`-style mismatch
reads FAILED `CORNER_NO_SOLUTION TRANSITION_REQUIRED`, stale and never
exportable.

## 15. Extract / Bake

CURRENT-only, one undo each. Extract names hybrid boundaries
`<group> - Grading Boundary` (homogeneous keeps `- Daylight`); the
boundary is hybrid-only and never offered for failed/stale groups.

## 16. Provenance

Group-bake/design-patch provenance records `targetKind: 'hybrid'` plus
canonical `terminationKinds` (surface→distance→elevation→
relative-elevation, only-effective; live target id, patch target rev;
never singular analytic values). The canonical leg reads
`hybrid:surface+distance…`. Legacy and mixed-analytic legs are
byte-identical.

## 17. DesignPatch

Closed CURRENT hybrids design-patch to the homogeneous control geometry
(flat/planar gate only, no averaging); warped interiors stay blocked. No
new interior policy.

## 18. Transform

PROJECTTRANSFORM scales `maxSearchDistance`, `curveChordTolerance`, and
Distance criteria only (×4 pin in the C1 suite); grade, target/relative
elevation, side, and Z are invariant.

## 19. UI

One-method-label authority (`summarizeGroupMethods`): `Hybrid` when
surface + ≥1 analytic kind are effective, with the exact-kind detail
`Hybrid — Surface + Distance`; Manager, Properties (`Methods` + `Domain`
rows + actual target), Toolspace, Inquiry, and CSV all read it. No
hybrid-specific command exists — the seven existing group shell keys are
pinned byte-identical. The target picker gates on surface-effective
membership; the last-Surface-removal clears the target atomically in the
same undo entry.

## 20. Restrictions (fail-closed, carried)

- Mismatched ties → `TRANSITION_REQUIRED` (no transition geometry ships
  in 20J).
- Later-root analytic match → `ROOT_POLICY`.
- Arc×arc hybrid joint → `ARC_PAIR_UNSUPPORTED` (one arc reuses chords).
- Tied-at-V (zero extent), void/thin/disconnected targets,
  member-out-of-search → fail closed with no partial mesh.
- Warped design-patch interiors blocked; analytic-only groups never
  resolve a target; extract/bake gated on CURRENT.
