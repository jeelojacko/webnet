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
| `tests/cad_line_l1_parsers.test.ts` (Worker A) | 12 tests: engine parsers incl. point-range cap + safe-integer guards |
| `tests/cad_line_l1_construction.test.ts` (Worker A) | directional/endpoint math |
| `tests/cad_line_l1_coordinate_context.test.ts` (Worker A) | CRS fail-closed + success + no mutation |
| `tests/cad_line_l1_survey.test.ts` (Worker A) | station/offset + side shots |
| `tests/cad_line_l1_entity.test.ts` (Worker A) | from-end/extension edits |
| `tests/cad_line_l1_batch.test.ts` (Worker A) | batch builder + chain draft |
| `tests/cad_line_l1_sessions.test.ts` (Worker B) | 38 tests: keys/registry/autocomplete, per-key starter/prompt/help/availability/preview, typed submit, point-object pick verification, numeric/CAD/tp id preservation + unique free labels, invalid no-mutation, backstep (incl. ANGLE/DEFLECTION reference rewind and tangent-ambiguity refusal) |
| `tests/cad_app_bridge.test.ts` | 19 tests incl. the CRS lifecycle pins (blank-drawing adopt, same-CRS no-clobber, different-CRS deprovenance, null-CRS deprovenance, no-context fail-closed) |
| `tests/cad_ribbon_tool_families.test.ts` | 17-live line family + keys |
| `tests/cad_ribbon_controls.test.tsx` | planned-row + sticky laws |
| `tests/cad_ribbon_icon_manifest.test.tsx` | 17 icons + activation |

Combined focused run: **11 files, 135/135** (`npx vitest run --config
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
