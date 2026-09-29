# Phase 20G — Grade to Relative Elevation: architecture and consumer audit

Branch: `feat/cad-grading-relative-elevation`
Baseline: `23a27721b894673715f8dad90ba8bbd116c6788c` (PR #135 merge, live
`origin/main`, fetch-verified with no drift)

Phase 20G adds **one** additive target-free grading criterion and **one**
termination family. The existing `GradingCriterion` union remains the single
persisted criterion authority: there is no `GradingCriterionV2`, no second
grading table, no separate result type, no new worker protocol, no duplicate
analytic solver, no persisted target-kind field on `CadGrading`, and no fake
target surface.

---

## 1. Criterion schema

`src/engine/cad/grading/gradingTypes.ts`:

```ts
export type GradingCriterion =
  | { kind: 'fixed';              gradeRatio: number }                                  // surface
  | { kind: 'cut-fill';           cutGradeRatio: number; fillGradeRatio: number }       // surface
  | { kind: 'distance';           gradeRatio: number; distance: number }                // analytic
  | { kind: 'elevation';          gradeRatio: number; targetElevation: number }         // analytic
  | { kind: 'relative-elevation'; gradeRatio: number; relativeElevation: number };      // analytic (20G)

export type GradingTerminationKind =
  | 'surface' | 'distance' | 'elevation' | 'relative-elevation';
```

`gradingTerminationKind` is a pass-through (`fixed`/`cut-fill` → `'surface'`,
otherwise `criterion.kind`), so `relative-elevation` is its own family, is
**target-free** (`isTargetFreeCriterion` true, `gradingCriterionRequiresSurface`
false), and uses the analytic boundary wording `Grading Limit` / `Limit`.

No `targetSurfaceId` is required or written. There is no `GradingCriterionV2`,
no `CadRelativeElevationGrading`, no second grading table, no separate result
type, and no persisted target-kind field on `CadGrading`.

---

## 2. Equations

For a source station with horizontal station `u`, plan position `P(u)`, source
elevation `Zsrc(u)`, grading-side unit normal `N`, signed grade `g`, and signed
relative elevation `Δ`:

```
d(u)         = Δ / g                     (constant along straight AND curved sources)
Q(u)         = P(u) + d · N              (grading-limit plan position)
Zlimit(u)    = Zsrc(u) + Δ               (grading-limit elevation)
identity     Zlimit(u) = Zsrc(u) + g · d
```

The limit is **vertically parallel** to the source profile: it is not globally
level unless the source is level. No target TIN query, no iterative
intersection solver, no candidate-triangle index is involved. Derived results
are never persisted — the criterion stores the signed vertical intent, never a
converted Distance.

### Validity

| rule | requirement |
|---|---|
| `g` | finite and machine-nonzero (`abs(g) >= Number.MIN_VALUE`, never a survey tolerance) |
| `Δ` | finite and machine-nonzero |
| `d = Δ/g` | finite and **strictly positive** |
| `d` | must not exceed `maxSearchDistance`; **never clamped** |

Sign compatibility: negative `Δ` with negative `g` is valid, positive `Δ` with
positive `g` is valid; opposite signs make `d <= 0` and fail closed. The same
exact machine-zero policy established for analytic Elevation criteria is used.

---

## 3. Shared analytic termination helper

New bounded pure engine module
`src/engine/cad/grading/gradingAnalyticCriterion.ts` is the single closed-form
authority for "what is the grading limit at this source elevation?":

```ts
resolveAnalyticCriterionAt(criterion, sourceZ, maxSearchDistance)
  -> { ok: true, value: { kind, gradeRatio, horizontalDistance, limitElevation } }
   | { ok: false, code: 'NO_SOLUTION' | 'MAX_DISTANCE_REACHED', detail }

constantAnalyticOffset(criterion) -> number | null   // D, or Δ/g
```

| family | `horizontalDistance` | `limitElevation` |
|---|---|---|
| `distance` | `criterion.distance` | `sourceZ + g · D` |
| `elevation` | `(targetElevation − sourceZ) / g` | `targetElevation` |
| `relative-elevation` | `relativeElevation / g` | `sourceZ + relativeElevation` |

Consumers:

- `solveAnalyticGradingChord` — `analyticOffsets` resolves **both** source
  endpoints through this helper (per-station offset stays honest on a sloping
  source). No formula lives in two places.
- `gradingGroupAnalyticCorners.analyticTerminalLine` — the corner formulation
  below.
- `constantAnalyticOffset` is exported so shell labels (Properties, course
  member rows) show a derived offset without owning a second interpretation.

The helper fails closed (`GRADING_BAD_CRITERION`) for any non-analytic
(surface) criterion.

---

## 4. Failure contract

| condition | code | detail |
|---|---|---|
| malformed / non-finite / machine-zero `g` or `Δ` | `NO_SOLUTION` | `GRADING_BAD_CRITERION` |
| wrong direction (`d <= 0`) | `NO_SOLUTION` | `GRADING_RELATIVE_ELEVATION_WRONG_DIRECTION` |
| `d > maxSearchDistance` | `MAX_DISTANCE_REACHED` | `GRADING_RELATIVE_ELEVATION_BEYOND_SEARCH` |

All existing codes and details for Surface Fixed, Surface Cut/Fill, Distance
and absolute Elevation are unchanged and no existing diagnostic was renamed.
Max-distance and corner gates were not loosened, and `d` is never clamped.

Unit-test proof (`cad_grading_relative_elevation_oracles_20g`, sections E/G/H)
plus `validateGradingCriterion` authoring rejection.

---

## 5. Absolute versus Relative Elevation

The two are different persisted methods with different geometry on a sloping
source. Independent pinned example (`oracles` §D):

Source `(0,0,100) → (100,0,102)`, `side = right`, `g = −0.5`.

| method | criterion | derived `d` | limit points |
|---|---|---|---|
| Relative Elevation | `Δ = −10` | constant `20` | `(0,−20,90)` → `(100,−20,92)` |
| absolute Elevation | `E = 90` | `20` → `24` | `(0,−20,90)` → `(100,−24,90)` |

Relative keeps a constant 20 m plan offset and a limit that rides the 2 %
source grade; absolute holds one global elevation `E` and therefore varies its
offset. Plan areas differ (2000 vs 2200 m²), the endpoints differ exactly, and
the digests differ.

User-facing label is always **`Relative Elevation`** — never plain
`Elevation`. `gradingMethodLabel`, `formatGradingCriterion`,
`gradingTargetSummary`, `courseCriterionTypeText`, the manager row Method cell
and the Properties/Toolspace rows are all exhaustive over the five kinds.

---

## 6. Standalone and group rules

- Straight source: reuses `solveAnalyticGradingChord` — both endpoints solved
  with the same constant derived `d`, `accuracy = EXACT`, two limit points, a
  real strip mesh, real plan/3D area, real min/max/mean projection distance,
  `candidateTriangleCount = 0`, `intersectionSegmentCount = 0`,
  `multipleSolutionCount = 0`, one `FIXED` region, and
  `cutSourceLength = fillSourceLength = tiedSourceLength = 0`.
  Relative Elevation is **not** classified CUT/FILL from the sign of `Δ`:
  those fields describe a source-to-target-surface relation and have no honest
  surface meaning on a target-free solve.
- Curved source: reuses the existing arc-linearization contract —
  subdivision count stays governed by `curveChordTolerance`, every chord uses
  the same criterion, derived `d` stays constant, each sample's limit
  `Z = Zsrc + Δ`, `accuracy = CURVE_APPROXIMATED`, source points remain on the
  true arc, and the limit converges toward the concentric offset `R ± d`. No
  new arc solver, no extra smoothing, no fitted spline.
- One termination family per group. Allowed homogeneous families: Surface
  (fixed and cut-fill may still mix), Distance, Elevation, Relative Elevation.
  Every cross-family combination fails closed at authoring
  (`validateGroupTerminationCriteria`) **and** at load sanitization
  (`sanitizeCadGradingGroups` → `validateGroupTermination`). The authoring
  error text names all four families truthfully.
- Sparse per-course overrides: the group default stays authoritative, an absent
  override resolves to the default, one prebuilt `Map` resolves overrides, reset
  removes the record, no materialized effective criterion is persisted, no
  hidden child gradings. `criteriaEqual` gained an explicit
  `relative-elevation` branch comparing `kind`, `gradeRatio` and
  `relativeElevation` for exact equality — no tolerance, no fallthrough.

---

## 7. Analytic corner formulation

At a group joint `V`, the terminal limit line for a `relative-elevation`
criterion is the Distance line with the derived offset:

```
d   = Δ / g
oxy = Vxy + d · N
oz  = Vz + Δ
dir = (Tx, Ty, gs)          // gs is the source course's longitudinal grade
```

This is geometrically parallel to the Distance terminal-line formulation, but
`d` is derived from the persisted vertical offset. All existing corner gates
are reused unchanged: line intersection, parallel/coincident handling, side
half-planes, Z agreement, miter extent, max search distance, GAP fan, OVERLAP
trim, and exact mesh validation.

Legitimate failures remain `CORNER_NO_SOLUTION` with the existing stable detail
codes (`GRADING_ANALYTIC_CORNER_LINE`, `..._PARALLEL`, `..._Z`, `..._SIDE`,
`..._DEGENERATE`, `..._MAX`, `..._TRIM`). Two adjacent criteria with differing
`Δ` disagree in Z at the joint and fail closed as
`CORNER_NO_SOLUTION` / `GRADING_ANALYTIC_CORNER_Z` — there is no averaging, no
bridging wall, no snapping, no boolean repair, and `zeroDelta` was not relaxed.

The existing 25/20 asymmetric Distance corner remains unchanged and still fails
closed (Phase 20F regression suite).

---

## 8. Persistence

Definitions persist; derived results never do.

```json
{ "kind": "relative-elevation", "gradeRatio": -0.5, "relativeElevation": -10 }
```

- No `targetSurfaceId` key on a newly authored Relative Elevation grading (no
  placeholder id, no target dependency).
- WNCAD save/reopen preserves the criterion exactly; reopened state is
  `UNBUILT`, never a false `CURRENT`.
- Malformed Relative Elevation definitions (`g = 0`, `Δ = 0`, non-finite
  either) are dropped fail-closed by `sanitizeCadGradings` because
  `validateGradingCriterion` owns the rule; valid definitions survive verbatim.
- Key ordering stays canonical, `schemaVersion` is unchanged (still v2), legacy
  files remain byte-compatible, and existing fixed / cut-fill / distance /
  elevation definitions reopen identically.
- Kind switches land in one undoable criteria-edit transaction; an analytic
  switch clears a live `targetSurfaceId`; switching back to Surface requires a
  real CURRENT target.
- No schema bump, no migration dialog, no result/cache/status persistence.

---

## 9. Revisions

`grev1:` / `ggrev1:` prefixes are unchanged — no `grev2` / `ggrev2`. The
criterion text for the new kind is:

```
relative-elevation:<canonicalGradingNum(gradeRatio)>/<canonicalGradingNum(relativeElevation)>
```

using the existing 1e-9 canonical number formatter. The hashes still cover
grade, relative elevation, source geometry, side, max search distance, chord
tolerance and group overrides; they do **not** hash the derived `d` as an extra
independent input, nor a dormant `targetSurfaceId` for Relative Elevation, nor
target-surface revision, result/cache/status, display labels, UI draft text or
formatting choices.

Both `criterionText` functions were extended with an additive branch only, and
the old `fixed` **fallthrough** was replaced by an explicit `fixed` branch with
a final `return 'unknown'` — previously an unknown kind would have silently
hashed as `fixed:<gradeRatio>` (which for Relative Elevation would have meant
that editing `Δ` never moved the revision). The two serializers were
deliberately **not** merged into one shared module: keeping them local
guarantees byte-identity for legacy kinds with zero refactor risk.

Legacy byte-identity is enforced by a permanent 40-key pin table in
`tests/cad_grading_relative_elevation_20g.test.ts` (`LEGACY_PINS`), captured at
baseline `23a27721` before any Phase 20G edit. All 40 keys are byte-identical.

Dormant-target invariance is a system-level guarantee provided by
`resolveGradingInputs` / `resolveGroupInputs` (they omit the target for
target-free criteria) and enforced by the group revision builder's
`surfaceFamily` gate; the functional suite proves it on the real resolve path.

---

## 10. Project transform

The project transform is an orientation-preserving XY similarity with unchanged
Z. `scaleGradingCriterion` is now explicit per kind:

| quantity | scaled? |
|---|---|
| `maxSearchDistance`, `curveChordTolerance` | yes |
| `criterion.distance` (Distance) | yes |
| `criterion.relativeElevation` | **no** (vertical, XY-invariant) |
| `gradeRatio`, `cutGradeRatio`, `fillGradeRatio`, `targetElevation`, `side`, all Z | no |

A derived horizontal distance is never persisted, so after a transform the
Relative Elevation criterion still stores the same signed `Δ` and the solver
recomputes `d = Δ/g` under the unchanged grade/Z contract. This intentionally
differs from Distance, whose persisted horizontal `D` scales with the project.

The deliberate selection-scoped `GRIDGROUND` policy is preserved:
whole-project `PROJECTTRANSFORM` transforms grading definition lengths, while
selection-scoped `GRIDGROUND` moves only selected geometry and does not rewrite
grading definitions.

---

## 11. Provenance

Grading provenance gained the additive target kind `'relative-elevation'` and
the additive field `relativeElevation: number`, applied to:

- standalone grading bake provenance (`webnet-grading-bake`)
- grading-group bake provenance (`webnet-grading-group-bake`)
- grading design-patch provenance (`webnet-grading-design-patch`)

Canonical provenance target leg: `relative-elevation:<canonical Δ>`. Relative
Elevation provenance omits `targetSurfaceId`, `targetElevation` and
`criterionDistance`.

Preserved byte-identically: legacy provenance with an absent `targetKind`
(reads as `surface`), existing surface provenance, existing distance
provenance, existing elevation provenance, and existing explicit-TIN revision
strings for old data. An old elevation provenance record is never reinterpreted
as Relative Elevation (the read-tolerant `provenanceTargetKind` still coerces
absent/unknown values to `surface`).

Design Patch: a closed flat or exactly-planar Relative Elevation group uses the
existing Design Patch workflow unchanged. Warped/non-planar source interiors
remain blocked; no averaging onto a plane, no boolean repair, no source-ring
fabrication, and no relaxed gate.

---

## 12. Worker, session and export behavior

- No new worker operation. The existing grading compute request and group
  compute request carry the criterion; the target is omitted; no fake empty
  target mesh, no TIN indexing, no candidate query.
- Source-boundary agreement remains required. Worker results remain
  session-only, latest-request-wins, with request/revision/drawing ownership
  authoritative and late stale results dropped. Definition/source edits retire
  obsolete work through the existing revision-driven
  `reconcilePendingWithProject` sweep — no method-specific pending state.
- Calculate remains explicit, never automatic, and outside undo history.
- Status uses the shared model unchanged: broken source refs →
  `BROKEN_REFERENCE`, in-flight → `BUILDING`, no result → `UNBUILT`, changed
  definition/source → `NEEDS_RECALC`, current-revision failure → `FAILED`,
  matching current result → `CURRENT`. No special Relative Elevation status and
  no fake "Relative Current" state; stale results stay non-exportable.
- Extract stays CURRENT-only, snapshots the grading limit as a Feature Line,
  uses the user-facing `Grading Limit` / `Limit` wording, is one undoable
  mutation, and blocks stale/FAILED results. Bake stays CURRENT-only,
  snapshots the grading mesh as an explicit-TIN surface, is one undoable
  mutation, recomputes nothing inside history, and requires the exact current
  revision. Internal legacy `daylight` field names were not renamed.

---

## 13. Commands

`GRADETORELATIVEELEVATION` (alias `GTRE`) is one central shell command in
`cadCommandRegistry.ts`, added to `GRADING_SHELL_KEYS`, mapped by
`gradingShellMethod`, available when a resolvable Feature Line/course exists
(no surface required), and it opens the existing Grading Manager
definition/create workflow with Relative Elevation preselected. No duplicate
creation UI, no prompt-only second implementation, no ribbon-owned selected
state, no button-specific bypass callback. Ribbon face is the compact text
label `Relative Elev.` — no new icon. The ribbon stays one compact band with
horizontal overflow and no vertical wrapping.

Alias audit: `grep -rn "GTRE"` across the repo returns only the Phase 20G plan
line in `TODO.md`; no registry key, alias array, command-search or dock usage
collides. `GTR` was deliberately **not** added.

---

## 14. Exhaustive discriminant-consumer audit

The additive union member turns every silent `else` into either a compile error
or a behavioural lie. Three independent passes were run:

1. `npx tsc --noEmit` after adding the union member — the compiler lists every
   consumer whose final branch silently assumed the old shape:
   `gradingAuthoring.ts` (`validateGradingCriterion` cut-fill fallthrough),
   `gradingGroupTermination.ts` (`FAMILY_LABEL`), `gradingRevision.ts` +
   `gradingGroupRevision.ts` (`criterionText`), `cadGradingShell.ts`
   (`formatGradingCriterion`), `cadGradingCriterionInput.ts`
   (`draftFromCriterion`), `CadGradingGroupCriteriaPanel.tsx` (`criterionKey`),
   `cadTransactionsGradingCommands.ts` / `cadTransactionsGradingGroupCommands.ts`
   (bake provenance `targetKind`), `SurveyCadWorkspace.tsx` (manager-method
   state union).
2. A read-only hand audit of every `criterion.kind`, `GradingTerminationKind`,
   `gradingTerminationKind`, `isTargetFreeCriterion`,
   `gradingCriterionRequiresSurface`, `criteriaEqual`, `criterionText`,
   `gradingShellMethod`, `courseCriterionTypeText`, `METHODS`,
   `method === 'elevation'` and "final else assumes Elevation" site in `src/`,
   `tests/`, `tests-browser/` and `scripts/`.
3. A focused grep for the new identifiers after each worker landed, to confirm
   no consumer was missed.

### Unsafe silent fallthroughs found and fixed

| # | location | before | after |
|---|---|---|---|
| 1 | `cadGradingCriterionInput.ts` `parseGradingCriterionDraft` | `relative-elevation` draft parsed to `{ kind: 'fixed' }` (the create form would have persisted a *fixed* criterion while claiming Relative Elevation) | explicit branch; exact `d > 0` gate; returns `null` on any failure |
| 2 | `cadGradingCriterionInput.ts` `summarizeGradingCriterionDraft` | final `Fixed …` | explicit relative branch with grade + Δ + derived offset |
| 3 | `cadGradingCriterionInput.ts` `gradingMethodLabel` | `'Surface'` | exhaustive `switch` → `'Relative Elevation'` |
| 4 | `cadGradingCriterionInput.ts` `gradingCriterionDraftFromCriterion` | final `else` = elevation | explicit `elevation` + `relative-elevation` branches |
| 5 | `CadGradingCriterionFields.tsx` `METHODS` + analytic slot | 3 methods; final `else` rendered the **Target elevation** input | 4 methods; three-way exhaustive slot with its own label, help text, aria-label and data attribute |
| 6 | `cadGradingShell.ts` `formatGradingCriterion` | final `Elevation ${targetElevation}` | exhaustive `switch` incl. `Relative Elevation … (offset …)` |
| 7 | `cadGradingShell.ts` `gradingTargetSummary` | final `Target: <surface name>` | explicit relative branch; never a surface name for a target-free family |
| 8 | `cadGradingShell.ts` `gradingShellMethod` / `GRADING_SHELL_KEYS` / executor / `gradingShellAvailable` | no new key | explicit `GRADETORELATIVEELEVATION` mapping, key-set membership and target-free availability |
| 9 | `cadGradingGroupCourseCriteria.ts` `courseCriterionTypeText` | final `Elevation` (a Relative Elevation row printed "Elevation") | exhaustive `switch` → `'Relative Elevation'` |
| 10 | `cadGradingGroupCourseCriteria.ts` `buildCourseMemberRows` `targetValue` | final `'—'` (Δ never shown) | explicit `-10.000 m relative` |
| 11 | `CadGradingManager.tsx` / `CadGradingGroupManager.tsx` row Method cell | `… : 'Elevation'` ternary | `gradingMethodLabel(row.method)` |
| 12 | `CadGradingGroupCriteriaPanel.tsx` `criterionKey` | switch without a relative branch (missing-return compile error) | explicit `relative-elevation:<g>:<Δ>` identity |
| 13 | `gradingRevision.ts` / `gradingGroupRevision.ts` `criterionText` | final `fixed:<gradeRatio>` (Δ edits would not move the revision) | explicit `fixed` branch + canonical `relative-elevation:g/Δ` + final `'unknown'` |
| 14 | `gradingGroupTermination.ts` `FAMILY_LABEL` + error text | three families | four families, all named |
| 15 | `gradingGroupCourseCriteria.ts` `criteriaEqual` | final `return false` (an override equal to the default was never recognised as a reset, so override counts lied) | explicit five-way comparison, exact equality |
| 16 | `gradingGroupAnalyticCorners.ts` `analyticTerminalLine` | final `return null` (every Relative Elevation joint failed the group) | explicit derived-offset branch |
| 17 | `cadProjectTransformGrading.ts` `scaleGradingCriterion` | pass-through `else` | explicit per-kind branches documenting the vertical invariant |
| 18 | `designPatchBuild.ts` `makeDesignPatchProvenance` | `analytic = distance \|\| elevation` (Relative Elevation omitted `targetKind` and was read back as `surface`) | `analytic` includes `relative-elevation`; emits `relativeElevation`; dormant target ids gated on `!analytic` |
| 19 | `cadImportedTin.ts` `provenanceTargetKind` | unknown → `'surface'` coercion | explicit four-value switch, unknown still fail-closed to `'surface'` |
| 20 | `cadImportedTin.ts` `provenanceTargetLeg` | final `surfaceId ?? ''` (revision-hash collision across families) | explicit `relative-elevation:<canonical Δ>` leg |
| 21 | `cadImportedTin.ts` `tinProvenanceRevisionPart` | no relative leg | passes `relativeElevation` through for bake/group/design-patch |
| 22 | `cadTypes.ts` | `targetKind?: 'surface' \| 'distance' \| 'elevation'` | adds `'relative-elevation'` + `relativeElevation?: number` on all three grading provenance interfaces |
| 23 | `cadTransactionsGradingCommands.ts` / `cadTransactionsGradingGroupCommands.ts` bake writers | recorded no analytic input for the new kind | additive `relativeElevation`; surface gates and bytes unchanged |
| 24 | `gradingAuthoring.ts` `validateGradingCriterion` | final block assumed cut-fill | explicit `relative-elevation` branch (`g` and `Δ` finite and machine-nonzero) + explicit `cut-fill` |
| 25 | `SurveyCadWorkspace.tsx` manager-method state | hard-coded `'surface' \| 'distance' \| 'elevation'` union | `GradingTerminationKind` from the engine |
| 26 | `CadGradingRibbonGroup.tsx` | no relative control | `GRADETORELATIVEELEVATION` + `Relative Elev.` face, no icon |
| 27 | `cadCommandRegistry.ts` | no command | `GRADETORELATIVEELEVATION` action + `GTRE` alias |

### Consumers reviewed and deliberately left unchanged (fail-closed / correct)

| location | why it is safe |
|---|---|
| `gradingGroupCompute.ts` `crossGradeAtV` | surface-only cross-grade picker; analytic groups route through `solveAnalyticCorner`. `return null` for non-cut-fill is correct. |
| `gradingGroupCompute.ts` `needsSurface` / member dispatch / cut-fill length accumulation | generic `isTargetFreeCriterion` gates; the new kind correctly takes the no-target analytic path and never fakes surface cut/fill lengths |
| `gradingResolve.ts` / `gradingGroupResolve.ts` | generic target-free branch; a dormant target id is never read for the new kind |
| `gradingPersistence.ts` / `gradingGroupPersistence.ts` | round-trip through the authoring constructor, so `validateGradingCriterion` owns the gate |
| `resolveAnalyticCriterionAt` final return | `GRADING_BAD_CRITERION` for surface criteria — fail closed |
| `cadGradingDisplay.ts` daylight/triangle/marker geometry | kind-agnostic; only a new guarded `relativeElevationDisplay` helper was added |
| `cadGradingGroupDisplay.ts` `groupGhostSeam` | explicit new branch added; `cut-fill`/`distance`/`elevation` previews deliberately unchanged so no existing geometry output moves |
| `cadGradingGroupCourseCriteria.ts` override map / `effectiveCourseForCourse` | keyed by vertex-id pair, kind-agnostic |
| `gradingStatus.ts` / `gradingGroupStatus.ts` / caches | kind-agnostic shared status model |
| `hashedNum`-style revision sources / arc params | unchanged; no Phase 20F expected value moved |

No consumer anywhere now decides Relative Elevation behaviour from a fallthrough.
An unknown or malformed kind fails closed rather than inheriting Elevation,
Distance or Surface behaviour.

---

## 15. Restrictions

Relative Elevation in Phase 20G is **one constant signed vertical offset per
criterion**. Still deferred, fail-closed, and unchanged by this phase:
transition grading, interpolation between criteria, station-varying relative
elevation, relative elevation from a second Feature Line, mixed-family grading
groups/corners, retaining walls, corridor assemblies, radial/conical grading,
slope patterns, grading criteria sets/sites, automatic grading optimization,
warped/non-planar pad projection, DEM grading, boolean repair, new TIN
intersection math, automatic recalculation, result persistence, a new worker
protocol, a new drawing schema version, selection-scoped `GRIDGROUND`
definition rewriting, a broad shell redesign, and any new icon-asset campaign.

Selection-scoped `GRIDGROUND` still does not rewrite grading definitions.
