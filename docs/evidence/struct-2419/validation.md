# STRUCT-241.9 Validation

Branch: `refactor/issue2419-volume-profile-section-type-leaves` at
`7e4d0b2f2b746d821d25e99f008e97ffac8ba26e` (exact main, ff-only, no
reset/force; 14 stashes preserved in original order; `.pi/lsp.json` and
ignored Study Desktop fixtures untouched).

## Source/AST and emit parity

- 6/6 + 10/10 leaf declarations byte-identical vs hub baseline regions
  (Worker A + Worker B diff proofs; parent independently re-verified
  post-integration: vol body in hub true, prof body in hub true, combined
  tail match true; 103-test suite pins shapes, optionality, discriminants,
  union orders, and JSDoc positions/markers).
- Hub retains grouped `import type` + `export type` of all 16; zero leftover
  original declarations (suite-pinned per name).
- `CadProject` volume/profile/section tables (all 8 names + `?` optionality),
  `CadDrawingDocument` project binding, survey persisted state
  (`CadSurveyPointEntity`, survey-table re-exports), unrelated
  surface/style contracts, and all 5 runtime value exports
  (`surfacePointGroupIds`, `isExplicitTopologyDefinition`,
  `isExplicitSurfaceDefinition`, `isNativeSurfaceDefinition`,
  `isImportedTinDefinition`) stay in the hub (suite-pinned).
- `CadEntity` 19-member order, `CadBlockChild` 6-member order + parabola
  exclusion, `CadBlockChildType` discriminant index preserved (tsc clean,
  suite-pinned).
- Leaf stripped emits: `export {};` (both). Hub emit byte-identical:
  transpileModule-stripped 680 bytes sha256
  `3744535788de61cc48666898669382da2312a59764ce06a96dc017936319d454` —
  same as the pinned-main baseline (independently recomputed before/after
  with `removeComments: true`; all 5 runtime exports present in emit).
- No value-graph edges changed; no consumer rewritten.

## Graph before/after (measured)

- CAD+F2F 497/2444 -> 499/2450; VALUE/MIXED 1585/1567 digest
  `0bc9bae1…2fcb7` unchanged; VALUE SCC 0, TYPE SCC 0.
- Full src 1669/7555 -> 1671/7561; VALUE/MIXED 4444/4385 digest
  `415f97f0…2448` unchanged; VALUE SCC 0, TYPE 7/38 unchanged.
- Per-leaf allowlists pinned with edge multiplicity (hub import + hub
  export counted separately; leaf out-edge to core primitives exactly one
  each); no leaf back-edge to hub/sibling/runtime; suite-pinned.

## Test commands and outcomes (actual, not guesses)

- New `tests/cad_volume_profile_section_type_leaves_2419.test.ts`: 103/103
  pass (19 negative in-memory mutation controls green).
- Historic STRUCT-241.2–241.8 graph guards rolled forward (counts only, plus
  2418 comment + 2413 hub line-count pin 1049 -> 859 + 19511/19512/19514
  `STRUCT_2419_ADDED_NODES=2/EDGES=6` consts; golden VALUE SHAs, edge
  fixtures, negative controls untouched): 2416/2417/2418 308/308;
  2412/2414/2415 + 2413 (after line-count roll-forward) green;
  19511/19512/19514 + 2413 150/150.
- Neighbours: 2411 + 1957 + 19510 + 1959 143/143; profile/section/volume
  engine + command payloads 117/117; volume oracles/robustness/revision/
  service/status/UI 56/56; cache/wncad/bands 28/28; persistence/drawing/
  save-reopen 8/8.
- `npx tsc --noEmit`: clean (exit 0). `npm run lint`: 0 errors
  (9 pre-existing warnings). `npm run check:portable-paths`: 6389 paths,
  0 violations. `npm run build`: clean (11.63 s).
- `npm run test:agent`: 1055 files — 1052 pass, 1 skipped, 3 failed, all
  3 the known unrelated local-only Study Desktop private real-data fixture
  failures (calibration, calibration_v5, preflight); fixtures untouched,
  nothing fixed in unrelated code. 10815 tests pass.
- Exact-head GitHub CI (5 jobs) is final authority; controller owns
  acceptance and merge.

## Reviewer

- Independent read-only reviewer (reviewer role, openai-codex/gpt-6-sol,
  `reviewer-2419`): APPROVE — complete integrated diff and new files
  reviewed against pinned main (16/16 verbatim + JSDoc, old API/union
  order, emit pins, persisted-vs-derived semantics, RAW station numerics,
  graph strictness, negative-control strength, scope hygiene, 14 stashes,
  no fixture/setting changes). No actionable findings remain.

## Risks (honest)

- Type-only move; compiler + emit + graph + 10k-test evidence show zero
  behavior change, but exact-head CI is authoritative.
- The 3 Study Desktop real-data failures are pre-existing and unrelated;
  they fail identically on clean main (ignored private fixtures).
- If the import-light decomposition had proven cyclic, the phase would have
  stopped rather than broadening scope; it did not — both leaves bind only
  to the low-level core primitive leaf with zero cycles.
