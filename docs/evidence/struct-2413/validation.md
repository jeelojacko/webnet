# STRUCT-241.3 Validation

Baseline origin/main EXACT `fa71437e82b87907016f20968c48308964c6c698`.
Branch `refactor/issue2413-cad-foundation-survey-presentation-types`.
Related to #241 (non-closing; #241 stays OPEN, #195/#240 stay CLOSED).

## Source region and ownership

- Moved hub region: `cadTypes.ts` old lines 55-243 (189 lines, sha
  `fc22065f1bc9395a3333e81d37e22a14239776d2d9a3d8e24c8534996ed73e07`).
- Worker A: `cadEntityFoundationTypes.ts` (8 types, 101 lines).
- Worker B: `cadSurveyPresentationTypes.ts` (9 types, 138 lines).
- Parent: hub splice (1923 -> 1780 lines), focused suite
  `tests/cad_entity_style_presentation_type_leaves_2413.test.ts` (65 tests),
  three guard roll-forwards, TODO/docs/evidence.
- Verbatim check pre-edit: 17/17 declarations exact-string match hub-vs-leaf.

## API compatibility

- All 17 keep exact public export names, modifiers, generics, property order,
  optionality, and comments (AST shape pins vs hand-transcribed EXPECTED).
- Hub `export type` re-exports cover all 17; no original declaration remains
  in the hub; `CadSurveyPointEntity` first, still extends `CadBaseEntity`,
  keeps `pointStyleId?`/`pointStyleOverrideId?`; `CadLineEntity`,
  `CadEntity` union, `CadProject`, `CadSurface`, and all 5 runtime exports
  (`surfacePointGroupIds`, `isExplicitTopologyDefinition`,
  `isExplicitSurfaceDefinition`, `isNativeSurfaceDefinition`,
  `isImportedTinDefinition`) pinned present.
- Facade-vs-leaf `expectTypeOf` equality both directions for all 17.

## Emit parity

- Hub stripped emit (ts transpile, removeComments): 680 bytes, sha
  `3744535788de61cc48666898669382da2312a59764ce06a96dc017936319d454` —
  identical before/after.
- Both leaves emit `export {};` (no runtime values; no VALUE/MIXED edges).

## Graph

- CAD+F2F: 488 nodes / 2412 edges, VALUE SCC 0/0, TYPE SCC 0/0, VALUE digest
  1585/1567/`0bc9bae1…fcb7` unchanged; 6 allowlisted TYPE edges (2 hub->leaf
  pairs + 2 leaf->core), leaves singleton, no back-edges.
- Full src: 1660 nodes / 7522 edges, VALUE SCC 0, TYPE 7/38 unchanged, VALUE
  digest 4444/4385/`415f97f0…2448` unchanged.
- Prior guards rolled forward narrowly (2412 counts; 19511/19512/19514
  +2/+6 constants); no baseline weakened.

## Tests

- New suite: 65/65 (shapes, order, facade, equality x34, unaffected,
  type-only/emit, graphs incl. 120 s full-src, 7 negative controls).
- Neighbours: 2411 + 2412 + 19511 + 19512 + 19514 + 19513-others 226/226;
  style/point/appearance/wncad 95/95.
- `npx tsc --noEmit` clean; eslint clean (8 files); `npm run build` 11.6 s
  clean; `check:portable-paths` 6360 paths 0 violations.
- `npm run test:agent`: PENDING (parent runs pre-PR).
- Known local-only: 3 Study Desktop private ignored real-fixture tests fail
  unrelated (fixtures preserved, reported honestly).

## Reviewer

- Independent read-only review (openai-codex/gpt-6-sol) on exact diff: APPROVE
  (round 1: one MINOR doc-number finding 7520->7522, fixed same-phase with
  re-review; round 2: APPROVE, no new findings).
