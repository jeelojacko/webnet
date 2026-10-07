# CAD Draw Phase L1 — validation

Validation for the Worker-B integration (session/registry/ribbon/workspace,
bridge seam, tests, browser spec). Engine math and icons are Worker A/C.

## 1. Scope validated

- All 16 `LINE_*` command keys reachable from the shell registry, the idle
  autocomplete, the ribbon, and `shellStarters`.
- Session start, prompt/help, point picks, preview, typed submit, invalid-input
  no-mutation, backstep, and Escape-cancel.
- Creates via ONE `LINE_CREATE_BATCH` undo entry; extension via ONE `GRIP_EDIT`
  preserving id/layer/metadata/labels.
- `GRID_NE` / `LATLONG` fail closed without a drawing CRS and succeed with one.
- The source-bridge `coordinateContext` threading seam (adopt-once, no-clobber,
  fail-closed), not "copy the source CRS onto any drawing".

## 2. Focused unit suites

| Suite | Tests |
|---|---|
| `tests/cad_line_l1_parsers.test.ts` (Worker A) | 13 tests: engine parsers incl. strict whole-request point-range rejection (invalid/empty tokens, cap, safe-integer guards) + signed distances |
| `tests/cad_line_l1_construction.test.ts` (Worker A) | directional/endpoint math + the retained perpendicular-foot helper |
| `tests/cad_line_l1_on_source.test.ts` (Worker A) | 21 tests: corrected TANGENT/PERP on-source engine — line finite-segment membership/residual with the production pick tolerance (far-pick rejection, custom tolerance), short-line floor consistency (1e-7 far-endpoint resolves, at/below-floor rejects), arc/circle radial projection + finite sweep, source tangent/normal frames and sign law, signed ray endpoint, two-ray click tie |
| `tests/cad_line_l1_coordinate_context.test.ts` (Worker A) | CRS fail-closed + success + no mutation |
| `tests/cad_line_l1_survey.test.ts` (Worker A) | station/offset + side shots |
| `tests/cad_line_l1_entity.test.ts` (Worker A) | from-end/extension edits |
| `tests/cad_line_l1_batch.test.ts` (Worker A) | batch builder + chain draft |
| `tests/cad_line_l1_sessions.test.ts` (Worker B) | 48 tests: keys/registry/autocomplete, per-key starter/prompt/help/availability/preview, typed submit, point-object pick verification, numeric/CAD/tp id preservation + unique free labels, invalid no-mutation, backstep (incl. ANGLE/DEFLECTION reference rewind), and the corrected TANGENT/PERP three-phase source→on-source→signed-ray law (line/arc/circle, sign law, endpoint click, tie, off-sweep, no mutation, one undo) |
| `tests/cad_app_bridge.test.ts` | 19 tests incl. the CRS lifecycle pins (blank-drawing adopt, same-CRS no-clobber, different-CRS deprovenance, null-CRS deprovenance, no-context fail-closed) |
| `tests/cad_ribbon_tool_families.test.ts` | 17-live line family + keys |
| `tests/cad_ribbon_controls.test.tsx` | planned-row + sticky laws |
| `tests/cad_ribbon_icon_manifest.test.tsx` | 17 icons + activation |

Combined focused run: **12 files, 164/164** (`npx vitest run --config
vitest.agent.config.ts tests/cad_line_l1_*.test.ts tests/cad_app_bridge.test.ts
tests/cad_ribbon_tool_families.test.ts tests/cad_ribbon_controls.test.tsx
tests/cad_ribbon_icon_manifest.test.tsx`).

Affected neighbours (controller + plain LINE dock/PLINE-C1/circles-B2/shapes):
**12 files, 134/134** (adds `tests/cad_app_controller.test.tsx`), plus a 7-file
**122/122** neighbour sweep. No CAD suite fails.

## 3. Full agent tier

`npm run test:agent`: the pre-existing `study-desktop/tests/study_ai_unit_*`
real-data calibration corpus failures (sourcePackageId drift) remain unrelated
to CAD Draw L1 and untouched by this phase. No CAD suite fails.

## 4. Browser QA

`npx playwright test cad-draw-line-l1 --config=playwright.prod.config.ts`:
**6/6 passed, zero page/console/unhandled errors** (production build,
headless Chromium). See `browser-qa.md` and `geometry.json`.

## 5. Contract pins

- NE axis asymmetry (`Northing,Easting`, x=east, y=north) pinned in the unit and
  browser suites.
- Extension count unchanged, id/labels preserved, one undo.
- GRID_NE/LATLONG refusal with zero entity and zero undo; success after import.
- Typed `LINE_*` does not change the sticky ribbon variant.
- Degenerate segments reject atomically (no partial entity).
- Point-range endpoints must be safe integers and expansion is capped at 4096
  points total, checked before allocation (no hang).
- `LINE_POINT_OBJECT` rejects a non-survey-point pick (with matching label) and
  resolves a verified pick by the source entity's station id.
- Numeric station ids are preserved as labels; free endpoints get unique
  sequential `L<n>` labels per segment (no `From L1 / To L1`).

## 6. Correction pass (5 fresh-reviewer findings)

| # | Finding | Resolution |
|---|---|---|
| 1 | CRS id treated as proof drawing XY is grid XY | Import adopts a source CRS only into a blank new drawing; never clobbers an existing context; non-blank/no-context stays fail-closed. Browser fixture now imports genuinely grid-consistent UTM 20N station geometry and uses matching N/E. Docs: `coordinate-context.md`. |
| 2 | Point-range expansion DoS/hang | `parseCadLinePointRange` rejects unsafe integers and caps total expansion at `CAD_LINE_POINT_RANGE_MAX_POINTS` (4096) before allocating. |
| 3 | Point Object doesn't verify picked object | `LINE_POINT_OBJECT` requires the pick's source entity to be a `survey-point` before resolving; otherwise an explicit refusal with no state change. |
| 4 | Numeric labels lost + duplicate free-vertex labels | Numeric station ids are real labels (only empty/auto `x,y`/`CAD`/`tp` placeholders are replaced); free-endpoint ordinals use captured-point count so a segment is `L1`→`L2`, not `L1`→`L1`. |
| 5 | Icon provenance stale | `icon-sources.md` now describes the live integrated state (all 17 rows live with keys + icons). |

## 7. Correction pass (round-2 reviewer findings)

| # | Finding | Resolution |
|---|---|---|
| 1 | Re-import mixed incompatible coordinates under an authoritative CRS | One law in `resolveImportedCoordinateContext`: a same-CRS refresh keeps the established context verbatim; a different-CRS OR null-CRS refresh **deprovenances** (`coordinateContext` removed) so GRID_NE/LATLONG fail closed on replaced/mixed geometry. Pinned by new bridge tests. Docs: `coordinate-context.md`. |
| 2 | Backstep left reference state ahead of the draft | `backstepCadLineL1Session` now rewinds ANGLE/DEFLECTION reference state to the restored draft (last segment = next reference; empty draft clears it). Pinned by new session tests (angle continue, deflection continue, backstep-to-empty prompt). Docs: `interaction-laws.md`. |
| 3 | Ambiguous tangent pick silently chose `right` | A body pick collinear (normalized to the degenerate floor) with the from point and the center is refused as ambiguous (typed and picked paths), no geometry, session stays active. The degenerate pick test now asserts refusal and a one-sided positive test was added. PERP is unique/single-ray, so no refusal. Docs: `interaction-laws.md`. |
| 4 | Verified survey-point ids matching `CAD<n>`/`tp<n>` were renamed | Label provenance (`CommandPoint.labelIsStationId`) now decides: resolved/snapped survey-point ids bypass `L<n>` rewriting entirely, regardless of label text. `CAD1`/`tp2` survive verbatim from point-object picks and typed lists; free points still get sequential `L<n>`. Pinned by new session tests. Docs: `interaction-laws.md`. |

## 8. Idle autocomplete ranking law (L1 follow-up)

The 17 new `LINE*` registry rows crowded the `L` query's limit-8 idle
suggestions, pushing `PLINE` (a legacy short result) out. `autocompleteShellCommands`
now ranks deterministically: matches are grouped into specificity tiers (exact
key / exact alias / key prefix / alias prefix / fuzzy substring), each tier is
ordered shortest key first, then the tiers are interleaved round-robin so no
single long key family can monopolize the bound. An empty token keeps plain
registry order; the dock's `SUGGESTION_LIMIT` (8) and scrollable list are
unchanged. Pinned by `tests/cad_shell_registry.test.ts` (`L` surfaces
`LINE` + `PLINE` deterministically; `LINE_` surfaces the variant keys).

## 9. SIDE_SHOT fixed-origin backstep fix

The generic `U` intercept ran for `LINE_SIDE_SHOT` before its typed handler,
rewinding `lineAnchor` to the previous shot endpoint (or null). `U` is now
routed to `handleSideShotTyped` for `SIDE_SHOT`, which removes only the newest
uncommitted shot and preserves the fixed occupy + reference direction, so
post-`U` shots still originate at the same point (and a `U`-to-empty draft keeps
the occupy). Commit stays one atomic `LINE_CREATE_BATCH` undo entry. Pinned by
an extended `tests/cad_line_l1_sessions.test.ts` side-shot test. Docs:
`interaction-laws.md` (chain-backstep and SIDE_SHOT bullets).

## 10. Correction pass L1 semantics (source-point-on-object)

The original `LINE_TANGENT_POINT` (external point → tangency-on-arc) and
`LINE_PERP_POINT` (external point → perpendicular-foot-on-line) were wrong. Both
are now **source-point-on-object → ray**:

| # | Change | Evidence |
|---|---|---|
| 1 | Corrected TANGENT/PERP: phase A source body (line/arc/circle), phase B exact start projected **ON** the source (finite segment / finite sweep / residual tolerance), phase C signed distance or endpoint click over the two source-frame rays (tangent for TANGENT, normal/outward radial for PERP). Positive = forward/LEFT/outward, negative = reverse. Compares by sign, ties fail closed. One `CadLineEntity` start-on-source, source unchanged, one `LINE_CREATE_BATCH` undo. | `tests/cad_line_l1_on_source.test.ts` (18), `tests/cad_line_l1_sessions.test.ts` corrected block, browser flow F |
| 2 | Retired the obsolete external-point `resolveCadLineTangentFromPoint` (deleted) and stopped using `resolveCadLinePerpendicularFoot` in `LINE_PERP_POINT` (helper retained for unrelated intersection features). | `src/engine/cad/cadLineConstruction.ts`, `useSurveyCadLineL1Submit.ts` |
| 3 | `parseCadLinePointRange` now fails the WHOLE request on any non-integer or empty token (`1-3,foo,7`, `1A,2`, `1-3.5`, `--`, `1-,2`, `1,,2`) instead of silently discarding it; whitespace tolerance, asc/desc ranges, the safe-integer guard, and the 4096 cap are preserved. | `tests/cad_line_l1_parsers.test.ts`, session no-mutation test |
| 4 | Prompts/help/hints expose the corrected phase text and sign law; preview draws the constrained source ray toward the cursor; Escape cancels at every phase. | `interaction-laws.md`, browser flow G |
| 5 | Neighbour contracts unchanged: `LINE_FROM_END`, `LINE_EXTENSION`, the other 14 L1 variants, `PERP_INTX`/intersection features, and the Circle B2 tangent solvers. | focused L1 + bridge + ribbon suites (161/161), browser A–G (7/7) |

Browser QA after the correction: `npx playwright test cad-draw-line-l1
--config=playwright.prod.config.ts` → **7/7 passed, zero page/console/unhandled
errors**. Geometry evidence pins a tangent start on the source, a tangent exactly
perpendicular to the circle radius, and a perpendicular exactly normal to the
line source (`geometry.json`).

## 11. Correction pass (round-1 reviewer findings)

| # | Finding | Resolution |
|---|---|---|
| 1 (P1) | On-source residual tolerance was a source-length/radius fraction (5%), so a 30 m pick off a 1 km line was silently accepted as on-source. | Replaced the fraction with the **existing production CAD pick tolerance** (`surfaceEditPickTolerance`, the same `1% of drawing extent, floor 0.5 m` law used by snapping/body picks; not a new fraction). The engine helper now takes `residualTolerance` as a parameter (fallback `surfaceEditPickTolerance(null)`), and the session layer passes `surfaceEditPickTolerance(project.bounds)`, so engine math stays screen-free. Arc/circle use the same absolute law. Pinned by `tests/cad_line_l1_on_source.test.ts` (far-pick rejection, explicit-tolerance accept/reject). |
| 2 (P2) | A valid 1e-7 source line's far-endpoint pick was sent to the start because the shared `cadProjectPointOntoInfiniteLine` collapses at squared length ≤ 1e-12 (length ≤ 1e-6), coarser than the 1e-9 creation floor. | Scoped a floor-safe segment projection inside `cadLineOnSourceResolvers` (safe for every source above the unchanged 1e-9 creation floor, so `lengthSquared > 1e-18`), avoiding any shared-helper behavior change across its many callers. Pinned by 1e-7 far-endpoint/mid resolution and at/below-floor rejection tests. |

After this pass: focused L1 **8 files, 115/115**; combined **12 files, 164/164**;
browser A–G **7/7** zero errors.
