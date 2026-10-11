# STRUCT-241.15 Validation — planar-transform + geometry-edit command payload leaves

## Scope

Type-only extraction of 13 inline `CadCommand` members into two leaves +
hub splice. Refs #241 ONLY. No runtime behavior change; no consumer
migration; no SCC change.

## New focused suite (73/73 pass)

`tests/cad_planar_transform_geometry_edit_command_type_leaves_24115.test.ts`
(73 tests, all green):

- Leaf presence + 6 planar / 7 geometry-edit keys in order, no duplicates;
  ordered 10-branch nested EDIT_ENTITY `edit` discriminant; no Phase
  header; splice-region comment-freedom with positive alias/coordinate
  controls (SURVEYTABLE_EDIT..SHEET_ADD region carries both splice refs
  plus inline HELMERT2D/GRIDGROUND/PROJECTTRANSFORM, zero `//`/`/*`).
- Both-direction `expectTypeOf` for all 13 old public `CadCommand`
  variants vs new leaf variants, plus independent hand-transcribed `Base*`
  shapes (incl. FILLET segment optionality, EDIT_ENTITY 10-kind union
  with `point-z: number | null`, MIRROR/ALIGN2D point shapes, GRIP_EDIT
  `CadGripHandleKind` + optional `vertexIndex`); whole-leaf union
  equivalence; AST property-order pins; empty-JSDoc pins (13/13);
  required/optional/literal/`keyof` pins; `never` probes; full-field
  samples through the hub round trip.
- Hub splice order: planar between SURVEYTABLE_EDIT and HELMERT2D;
  geometry-edit between PROJECTTRANSFORM and SHEET_ADD; top-level
  61 (19 inline / 35 refs / 7 intersections); flattened 168 with anchors
  (SURVEYTABLE_EDIT @53, planar @54-59, HELMERT2D/GRIDGROUND/
  PROJECTTRANSFORM @60-62, geometry-edit @63-69, SHEET_ADD @70);
  no moved key left inline (19 inline sets); hub-text probes
  (`key: 'MIRROR'`/`'ALIGN2D'`/`'FILLET'`/`'EDIT_ENTITY'`/`'GRIP_EDIT'`/
  `'INTERSECT_POINT'`, `eraseSource`, `scaleToFit`, `targetSegmentId`,
  `gripKind`, `firstLabel` all gone); HELMERT2D/GRIDGROUND/
  PROJECTTRANSFORM inline shapes + `GridGroundDirection` verbatim;
  only `CadEntityAppearance`/`CadGripHandleKind` retired from the
  `./cadTypes` import (`CadEntityId`/`CadLayerId`/barrel kept).
- `CadCommandKey` raw SHA `4ff8cd4a…eca1502`, ordered-list SHA
  `b2121894e…7df2e21e`, 248/241/7 shape, planar/geometry key runs in
  position; `CadTransaction`/`CadCommandDefinition` surfaces unchanged.
- Type-only allowlists (planar: zero imports; geometry-edit: exactly the
  3 allow-listed type modules/bindings); marker-only emits (hub SHA
  `2e29cd9a…c8d05` unchanged).
- CAD+F2F graph 511/2483, VALUE/TYPE SCC 0/0, VALUE/MIXED digest
  unchanged; allow-listed incident TYPE edges; barrel kept; no back-edge
  to hub or 9 command executors. Full-src graph 1683/7594, VALUE SCC 0,
  TYPE 7/38, full digest unchanged.
- 31 in-memory negative controls (MOVE/COPY/ROTATE/SCALE/MIRROR/ALIGN2D
  requiredness/type/shape; EXTEND/FILLET/PASTE/TRIM/INTERSECT_POINT
  optionality/ids/labels; EDIT_ENTITY nullability/branch removal+reorder/
  layerId/patch/vertices; GRIP_EDIT gripKind/vertexIndex; dropped/swapped
  hub splices; leaf reorder; synthetic TYPE back-edge; synthetic VALUE
  import) — each asserts `mutated != original` first, then asserts the
  positive pin FAILS; worktree-clean proof. No disk writes.

## Rolled-forward guards (all green, measured deltas only)

- Flatten/count (61/19/35 + 168 + re-inline arithmetic):
  2411, 2412, 24111, 24112, 24113, 24114.
- Graph totals (511/2483 scoped, 1683/7594 full):
  2415, 2413, 2416, 2417, 2414, 24110, 2418, 2419.
- Fan-in allowlists: 2417 (geometry-edit inbound to `cadGripSnapTypes`,
  first ordered), 2413 (geometry-edit inbound to
  `cadEntityFoundationTypes`, survey-table..hub position; allowlist
  fourteen -> fifteen).
- 195.x cumulative node/edge constants (+2 nodes / +5 edges):
  19512 parcel, 19511 project-transform, 19514 geometry (VALUE
  fingerprints unchanged — type-only proof).
- Old reference bodies, negative controls, SCC guards, VALUE/MIXED
  digests preserved; no exemptions.

## Static gates

- `npx tsc --noEmit` clean (exit 0); `npm run lint` 0 errors
  (9 pre-existing warnings, none in 24115 files);
  `npm run check:portable-paths` 0 violations (6420 paths).
- `npm run build`: green (12.16 s).
- Focused runtime neighbours (transform/geometry-edit commands):
  `cad_transform_commands_18q`, `cad_transform_apply_18q`,
  `cad_blocks_mirror_18q`, `cad_helmert_gridground_commands_18q`,
  `cad_project_transform_commands_18r` — 53/53 pass.
- `npm run test:agent` (parent gate): **11254 passed | 1 skipped |
  3 failed / 11258** — the 3 failures are the known-unrelated ignored
  private Study Desktop real-data fixtures (`study_ai_unit_calibration`,
  `study_ai_unit_calibration_v5`, `study_ai_unit_preflight`), same trio
  as prior phases; no new failures; private fixtures untouched.

## Review

- Independent read-only reviewer on exact integrated final diff (incl.
  negative controls): APPROVE (round-1 one test-only low-severity
  finding remediated same-phase; round-2 FRESH re-review APPROVE on
  final head, no findings).
- Stash preservation: 14/14, order intact; worktree contains only the
  24115 scope (hub + 2 leaves + 1 new + 20 rolled-forward tests + TODO +
  2 evidence docs + 2 narrow 24114 evidence doc corrections).

## Risks (honest)

- Graph pins are version-sensitive by design: any concurrent main-side CAD
  type change requires re-measurement (fail-closed, not silent).
- The geometry-edit leaf's three `import type` edges rely on continued
  type-only usage; the 24115 suite pins `hasOnlyTypeImports` + empty
  runtime specifiers, and hub pins assert no hub->core/foundation/grip
  edge (those aliases arrive via the leaf + barrel).
- Flatten/count pins across 2411/2412/24111/24112/24113/24114 now
  reference both new aliases; future extractions must roll them forward
  the same narrow way. Exact-head CI (classify/static/numerical/tests/
  build-smoke) is the controller merge gate.
