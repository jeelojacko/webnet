# STRUCT-195.10 Validation

## Commits

- Baseline: `0da0708e` (PR #233 merge — post-195.9 main line)
- Branch: `refactor/issue19510-surface-revision-profile-type-pairs` (Workstreams A+B landed; Workstream C adds test + evidence only)

## Graph (scripts/cadTypeImportGraph.mjs, scope src/engine/cad + src/engine/fieldToFinish)

Measured directly with `buildGraphs` + `tarjanSCC` on the live tree
(after) and on a read-only `loadSourcesFromGit('0da0708e')` snapshot
(before):

| metric | baseline 0da0708e | after | delta |
|---|---|---|---|
| nodes | 478 | 480 | +2 leaves |
| edges | 2387 | 2392 | +5 (9 leaf-wiring type edges added, 4 hub/consumer type backedges removed) |
| VALUE SCC / nodes / largest | 4 / 18 / 7 | 4 / 18 / 7 | 0 |
| TYPE SCC / nodes / largest | 3 / 6 / 2 | 1 / 2 / 2 | −2 pairs gone |
| VALUE pairs SHA256 | `2bf1817d3978bf7a0b6e82f03008c4e10750983c293b1f7a75da60ae3fb6323f` | identical | membership byte-identical |
| VALUE edges / unique pairs | 1579 / 1561 | 1579 / 1561 | 0 |
| leaf non-type incident edges | n/a | 0 | every leaf edge is `type` |

Dissolved: `cadSurfaceRevision <-> cadSurfaces`,
`profileExtraction <-> profileSampling` (all four now TYPE singletons).
Remaining TYPE SCC: projectTransform pair only (untouched, listed in
architecture.md).

Leaf wiring detail (all `type` kind): `cadSurfaceRevision ->
cadSurfaceSourceTypes`, `cadSurfaces -> cadSurfaceSourceTypes` (import +
re-export), `cadSurfaceSourceTypes -> cadCorePrimitiveTypes`;
`profileExtraction -> profileSampleTypes` (import + re-export),
`profileSampling -> profileSampleTypes`,
`profileSampleTypes -> cadSurfaces` (grid), `profileSampleTypes ->
tin/tinTypes`. Neither leaf has any edge back to its hub or consumer,
so no TYPE cycle can reform through them.

## Fidelity / legacy exports

- Source leaf: exact 11 literals in original order (AST pin); no
  synonym/partial. `CadSurfaceSourcePoint` keeps `entityId` first, all
  fields required (AST + typecheck pins).
- Profile leaf: exact 7 event literals in original order (AST pin);
  `ProfileSample` keeps `displayStation: number | null` plus three `?`
  metadata fields; `ProfileExtractionMesh` keeps the tuple
  `Array<[number, number, number]>`, inline point shape, and two `?`
  tin fields (AST + typecheck pins).
- Consumers unchanged in shape: `CadSurfaceBuildResult`
  (reasonCodes/points), `CollectedSources`
  (points/breaklineError/boundaryError), `ProfileSegment` (samples),
  `CadSurfaceProfileResult` (segments), `ExtractSurfaceProfileInput`
  (mesh) all still reference the moved types field-by-field
  (bidirectional expectTypeOf — no weaker casts).
- Legacy `from './cadSurfaces'` / `from './profileExtraction'` type
  imports still compile via hub re-exports (bidirectional expectTypeOf
  old<->leaf).

## Tests

- NEW `tests/cad_surface_revision_profile_type_cycle_19510.test.ts`:
  41/41 (`npx vitest run` on the new file only). Covers leaf presence,
  baseline pins both directions, AST order/`?`/`| null`/tuple pins,
  consumer compatibility, hub re-exports, import-type-only purity,
  repoints, graph guard incl. exact 1/2 + projectTransform-only pin +
  value fingerprint, 2 in-memory negative controls (removed literal,
  smuggled value-import edge; on-disk sources re-pinned clean after
  each control).
- `npx tsc --noEmit`: exit 0.
- NOT run (parent owns): `npm run test:agent`, `npm run build`.
- Tier check: the new test is fast and in-process (TypeScript compiler
  API + in-memory graph over the two CAD scopes, ~2.5 s); basename has
  no stress/benchmark/soak/calibration trigger and it is absent from
  `AGENT_EXCLUDED_TESTS`, so it stays in the agent tier —
  `scripts/testTiers.ts` and `tests/AGENTS.md` required no changes.

## Limitations

- Test pins VALUE membership via pair multiset (pair-preserving rewrites
  invisible — same residual risk as 195.7/195.8/195.9 guards).
- No Playwright smoke: no CAD surface/profile runtime behavior changed
  (type-only).
- `profileSampleTypes` keeps a type-only edge to the `cadSurfaces` hub
  (for `CadSurfaceGrid`); the guard pins it `type`-only and
  cycle-free, but a future VALUE import there would need a fresh guard.
