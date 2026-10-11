# STRUCT-241.15 Architecture — planar-transform + geometry-edit command payload leaves

## Baseline

- Pinned main: `e3d44c75ccd63393e0dd1050f198bc8c854198ac` (STRUCT-241.14
  PR #257 merge, fetched + verified before branching; local `main`
  fast-forwarded, clean).
- Branch: `refactor/issue24115-planar-transform-geometry-edit-command-types`.
- Pre-change hub: 660 lines; post-splice hub: 567 lines (-93 net).
- 14 pre-existing user stashes untouched (count + order preserved); ignored
  Study Desktop private fixtures untouched; `.pi/lsp.json` untouched.
- Refs #241 ONLY (never Closes/Fixes; #241 stays OPEN; #195/#240 CLOSED).
  No SCC correction, no runtime behavior change.

## What moved (type-only, 13 inline members -> 2 alias refs)

Two DISJOINT contiguous groups inside the `CadCommand` union:

- NEW `src/engine/cad/cadTransactionsPlanarTransformCommandTypes.ts`
  (63 lines): `CadPlanarTransformCommandPayload` = 6 variants, verbatim in
  original order: MOVE, COPY, ROTATE, SCALE, MIRROR, ALIGN2D. Sits
  immediately after SURVEYTABLE_EDIT, immediately before HELMERT2D. Zero
  imports (members use only `number`/`boolean`/inline `{x;y}` shapes).
  Does NOT include the coordinate/Helmert/grid/project transform commands.
- NEW `src/engine/cad/cadTransactionsGeometryEditCommandTypes.ts`
  (93 lines): `CadGeometryEditCommandPayload` = 7 variants, verbatim in
  original order: EXTEND, FILLET, PASTE, TRIM, INTERSECT_POINT,
  EDIT_ENTITY, GRIP_EDIT. Sits immediately after PROJECTTRANSFORM,
  immediately before SHEET_ADD. Only dependencies (all `import type`):
  `CadEntityId` + `CadLayerId` from `./cadCorePrimitiveTypes` (zero-import
  type leaf), `CadEntityAppearance` from `./cadEntityFoundationTypes`
  (type-only leaf), `CadGripHandleKind` from `./cadGripSnapTypes`
  (type-only leaf). No barrel, hub, sibling-leaf, or runtime import.
- Hub splice (`cadTransactions.types.ts`, 660 -> 567 lines): two direct
  `import type` declarations for the leaf aliases; six MOVE..ALIGN2D
  inline branches replaced by `| CadPlanarTransformCommandPayload` at the
  MOVE position; seven EXTEND..GRIP_EDIT inline branches replaced by
  `| CadGeometryEditCommandPayload` at the EXTEND position. Removed ONLY
  the now-unused `CadEntityAppearance` and `CadGripHandleKind` specifiers
  from the `./cadTypes` barrel import (`CadEntityId`/`CadLayerId` stay —
  used elsewhere); every other live import and the barrel import retained.
- Untouched neighbors: SURVEYTABLE_EDIT before the planar splice;
  HELMERT2D, GRIDGROUND, PROJECTTRANSFORM stay EXACTLY inline (with
  `GridGroundDirection` in the hub — not extracted: Helmert/grid/project
  depend on a hub-local alias + external runtime-adjacent types);
  SHEET_ADD and all later sheet/viewport/title-block members unchanged;
  TRAVERSE/BATCH_COGO, primitive/basic-curve/feature-line/parcel/
  annotation/analysis/grading F1 aliases, and all compound table
  intersections untouched, in exact original relative order.
  `CadCommandKey` raw bytes / 248 literals / 241 unique / 7 BLOCK repeats
  identical (raw SHA `4ff8cd4a…eca1502`). No consumer migration.
  No SCC reduction claimed.

## Parity proof (parent-verified pre-splice)

- Worker byte-parity: planar hub lines 417-452 vs leaf member set —
  byte-identical per-member SHA256 (whole-block SHA `df43712b…0998f2db`);
  geometry hub lines 469-529 vs leaf region — 61-line `diff` IDENTICAL.
  Key literals, field names/order, requiredness, nullability
  (`point-z: number | null`), the ordered nested 10-branch `edit`
  discriminant (entity-name, point-x, point-y, point-z, line-end,
  arc-radius, polyline-vertex, polyline-vertices, entity-layer,
  entity-appearance), inline point shapes, and whitespace all verbatim.
  No member JSDoc existed on any of the 13 hub members; none invented.
  No Phase header existed above either run; none invented.
- Effective `CadCommand`: still 168 flattened members in exact original
  order (SURVEYTABLE_EDIT @53, planar @54-59, HELMERT2D/GRIDGROUND/
  PROJECTTRANSFORM @60-62, geometry-edit @63-69, SHEET_ADD @70; older
  anchors ERASE @2, TRAVERSE @16, BATCH_COGO @17 unchanged). All 13 moved
  branches are single-keyed (plain one-literal `Extract` selectors).
  Top-level: 72 (32 inline / 33 refs / 7 inter) -> 61 (19 inline / 35 refs
  / 7 inter) = -13 inline +2 refs.
- Emitted JS (transpileModule ESNext, removeComments:true): hub + both
  leaves all inert `export {};` (hub SHA `2e29cd9a…c8d05` identical to
  pinned baseline). No runtime JS beyond the inert marker.

## Graph delta (measured live, type-only)

- Scoped CAD+F2F: 509/2478 -> 511/2483 (+2 nodes, +5 type edges: 2 hub
  leaf imports + 3 geometry-edit out-edges + 0 planar out-edges − 0
  retired edges; hub keeps its `./cadTypes` barrel edge and never imports
  the core/foundation/grip leaves directly). VALUE SCC 0, TYPE SCC 0.
  VALUE/MIXED 1585 / 1567 digest
  `0bc9bae1f87e81161f250fd5852730e56b9bdd1311b02257cdecf39dd4d2fcb7`
  unchanged.
- Full src: 1681/7589 -> 1683/7594 (same +2/+5, all edges resolve in
  `src`). VALUE SCC 0, TYPE 7 SCC / 38 nodes unchanged. VALUE/MIXED
  4444/4385 digest
  `415f97f0a1a662ca6523144106bec331fef305476eb34cd316df7c70f8972448`
  unchanged.
- 2417 suite pins the new inbound edge into `cadGripSnapTypes` from the
  geometry-edit leaf (first ordered; barrel pair kept; type-only, zero
  value edges); 2413 suite pins the new inbound edge into
  `cadEntityFoundationTypes` (between survey-table and hub in
  source-path order).

## Workers / review

- Worker A (planar leaf) + Worker B (geometry-edit leaf): parallel,
  disjoint, landed verbatim; parent verified byte-parity before splicing.
- Parent owned hub splice, focused 73-test suite, 20-file narrow guard
  roll-forward (6 flatten/count + 8 graph-only + 3 195.x cumulative +
  2413/2417 fan-in), validation, docs, PR.
- Independent read-only reviewer: APPROVE (round-1 found one test-only
  low-severity finding — vacuous worktree-clean guard — remediated
  same-phase with collection-time pristine capture; round-2 FRESH
  re-review APPROVE on final head, no findings).
