# STRUCT-241.10 Architecture — CAD surface definition + model/style leaves

Base: `68ff937cfa2d8c5c3b18bce1ed23b3a60880f2be` (origin/main, PR #251 merge).
Branch: `refactor/issue24110-surface-model-style-type-leaves`.
Refs #241 ONLY (no Closes/Fixes; #241 stays OPEN; #195/#240 stay CLOSED).

## Scope

Eleven existing public declarations moved verbatim out of
`src/engine/cad/cadTypes.ts` (858 -> 756 lines) into two import-light
acyclic type-only leaves. No formatting/renaming/semantics changes; no new
runtime code; no consumer import rewrites.

### A. `src/engine/cad/cadSurfaceDefinitionTypes.ts` (64 lines, 6 contracts)

Source order preserved:

1. `CadSurfacePointSource` — point-group (legacy `pointGroupId` vs canonical
   `pointGroupIds`, added order) vs explicit `points` union.
2. `CadSurfaceBreaklineSource` — `point-chain` vs `entity` discriminant.
3. `CadSurfaceBreakline` — `standard`-only, optional name.
4. `CadSurfaceBoundary` — `outer` | `void` + source entity ref.
5. `CadSurfaceBuildOptions` — optional `maxEdgeLength`; Phase 20A
   `breaklineChordTolerance` (finite positive, absent/invalid reads as
   0.001 m; joins source revision; never touches TIN numerics).
6. `CadSurfaceDefinition` — required `pointSource`; optional
   `breaklines`/`boundaries`/`buildOptions`; Phase 18S ordered `edits`
   stack; Phase 18L/18X `sourceKind` (`native` | `imported-tin` |
   `explicit-tin`) + `importedTin`, in exact key order.

Import-type only: `CadEntityId` from `./cadCorePrimitiveTypes`,
`CadSurfaceEdit` from `./cadSurfaceEditTypes`, `ImportedTinPayload` from
`./cadTinProvenanceTypes`. No cadTypes/barrel/transaction/runtime imports.

### B. `src/engine/cad/cadSurfaceModelStyleTypes.ts` (84 lines, 5 contracts)

Source order preserved:

1. `CadSurfaceStatus` — 7 literals incl. `BROKEN_REFERENCE`,
   `INSUFFICIENT_DATA`.
2. `CadSurfacePurpose` — 5 literals incl. `design-patch`;
   operator-authored, never inferred (excluded from geometry revision).
3. `CadSurface` — `definition` link, `purpose?`, `styleId?`,
   `cachedRevision?: string | null`, `layerId?: CadLayerId`,
   `buildDiagnostic?`, in exact order.
4. `CadContourAppearance` — optional color/lineweight/opacity (0..1).
5. `CadSurfaceStyle` — display-only: color/opacity, seed extras,
   `majorContourEvery` + contour-base/elevation intervals, two contour
   kinds, `labelMajorOnly`/`showContourLabels`/spacing/precision.

Import-type only: `CadSurfaceDefinition` from
`./cadSurfaceDefinitionTypes`, `CadLayerId` from
`./cadCorePrimitiveTypes`. The B->A edge is ONE WAY; the definition leaf
never imports the model leaf (pinned by leaf edge allowlists + a throwing
A->B control).

## Hub splice

`cadTypes.ts` drops the 11 bodies + their own JSDoc/section comments and
gains one grouped `import type` + one grouped `export type` re-export per
leaf (alphabetical, matching 241.9 style). All 11 historic public names and
all hub-local references (`CadProject.surfaces`/`surfaceStyles`,
`Pick<CadSurfaceDefinition, ...>` in the runtime predicates) resolve via
the imports; no consumer import was rewritten.

The five interleaved runtime value exports stay in the hub in original
order with byte-identical bodies and their own JSDoc:
`surfacePointGroupIds`, `isExplicitTopologyDefinition`,
`isExplicitSurfaceDefinition` (alias identity),
`isNativeSurfaceDefinition` (fail-closed native), `isImportedTinDefinition`
(deprecated alias identity). Transpiled hub emit (removeComments:true,
trimmed) is byte-identical to baseline: 680 chars, sha256
`37445357...454`. Both leaves emit inert `export {};`.

## Graph delta (measured, not guessed)

- CAD+FieldToFinish: 499/2450 -> 501/2459 (+2 nodes, +9 type edges).
- Full src: 1671/7561 -> 1673/7570 (+2/+9; every 241.10 edge resolves
  inside `src`).
- VALUE/MIXED edges, unique pairs, and both historical digests unchanged
  (`0bc9bae1...`, `415f97f0...`); VALUE SCC 0, TYPE SCC 0 scoped;
  full-src TYPE stays 7 SCC / 38 nodes.
- Per-leaf allowlist: definition leaf 3 out-edges (core primitives,
  surface-edit, TIN provenance) + hub import + hub export; model leaf
  one-way B->A + core out-edge + hub import + hub export; no retired hub
  edge; no value/mixed edge incident to either leaf; no back-edge to the
  hub, sibling (A->B), barrels, transactions, or runtime modules.

## Guard roll-forwards (genuinely impacted only)

- 2412/2414/2415/2416/2417 counts -> 501/2459 and 1673/7570.
- 2418 counts + provenance/edit `to === leaf` allowlists (new incoming
  definition-leaf edge) + `CadSurfaceDefinition` field pin (now sourced
  from the definition leaf) + unrelated-contracts pin inverted to
  facade pins.
- 2419 counts + unrelated-contracts pin inverted to facade pins.
- 2413 counts + hub split-lines 859 -> 757 + `CadSurface` string pin
  repointed at the model-leaf facade.
- 19511/19512/19514 cumulative `STRUCT_24110_ADDED_NODES = 2` /
  `STRUCT_24110_ADDED_EDGES = 9`.
- Historical golden digests, SCC pins, negative controls, and
  value-graph fixtures untouched.

## Risks

- `CadProject` JSON key order unchanged (no field touched).
- `surfacePointGroupIds` legacy `pointGroupId` fallback preserved
  verbatim (shape + mutation controls pin both members).
- No SCC/geometry/DXF/LandXML/TIN-numerics/style-rendering change
  possible: type-only leaves, identical emit, identical digests.
