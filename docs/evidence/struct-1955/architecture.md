# STRUCT-195.5 — profile + section command-payload type leaves

Branch: `refactor/issue1955-profile-section-command-type-leaves`
Baseline: `origin/main` `7127c5f4430c1483a4cf1279085aed3e887a1f8f` (195.4 merge on main)
Refs #195 — issue #195 stays **OPEN** (never `Closes`/`Fixes`).
Scope: parent-owned hub splice + two new leaves (not modified here);
this worker owns only `tests/cad_profile_section_command_types_1955.test.ts`
and these `docs/evidence/struct-1955/{architecture,validation}.md` files.

## What moved

Two new type-only leaves own the payload members extracted verbatim from
the `CadCommand` union in `src/engine/cad/cadTransactions.types.ts`.
The hub diff is import-block plus union-member splicing only;
`CadCommandKey` is unchanged and union order is preserved.

`src/engine/cad/cadTransactionsProfileCommandTypes.ts` (new,
**121 lines**) exports `CadProfileCommandPayload` with the 11 profile
variants in exact union order — create/rebuild/delete, view
create/update/delete, style create/duplicate/rename/update/delete —
plus the shared `CadProfileViewUpdatePatch` interface.

`src/engine/cad/cadTransactionsSectionCommandTypes.ts` (new,
**155 lines**) exports `CadSectionCommandPayload` with the 17
pre-LANDXML sample-line/section variants in exact union order
(`SAMPLE_GROUP_CREATE` through `SECTION_VIEW_UPDATE`) plus the separate
`CadSectionViewDeleteCommand` interface. `SECTION_VIEW_DELETE` is split
out because it sits AFTER the inline `LANDXML_IMPORT` variant in the
hub union: the hub joins this leaf's union, then the inline LANDXML
payload, then the single delete payload in that original position.

Hub `CadCommand` union order is now: … `CadSurfaceCommandPayload` |
`CadVolumeCommandPayload` | `CadProfileCommandPayload` |
`CadSectionCommandPayload` | inline `LANDXML_IMPORT` |
`CadSectionViewDeleteCommand` | `BLOCK_CREATE` | … (pinned literally by
the new suite, including adjacency: each member immediately follows the
previous one). The hub additionally re-exports
`CadProfileViewUpdatePatch` from the profile leaf:
`export type { CadProfileViewUpdatePatch } from './cadTransactionsProfileCommandTypes'`.

## LANDXML guard

The LANDXML payload stays inline in the hub and is intentionally not
represented in either leaf. Both leaves assert the absence of
`LANDXML_IMPORT` from their key sets, and the hub order guard pins
`LANDXML_IMPORT` immediately between `CadSectionCommandPayload` and
`CadSectionViewDeleteCommand`, so a future move of the LANDXML payload
into a leaf (or out of position) fails the suite instead of drifting
silently.

## BEFORE/AFTER graphs (measured, `scripts/cadTypeImportGraph.mjs`)

Scope `src/engine/cad/**` + `src/engine/fieldToFinish/**` (same tool and
scope family as 195.2–195.4). BEFORE = `origin/main` `7127c5f4`
(parent-measured); AFTER = working tree (worker re-measured: nodes 471,
edges 2367, unresolved 94, type SCC 7/19 largest 5 — all match):

| Metric | BEFORE (7127c5f4) | AFTER (working tree) |
| --- | --- | --- |
| Nodes | 469 | 471 |
| Edges (value + type + mixed) | 2360 | 2367 |
| VALUE edges (incl. mixed) | 1579 | 1579 (delta 0) |
| TYPE edges (incl. mixed) | 1030 | 1037 (+7) |
| VALUE cyclic components / nodes (largest) | 4 / 18 (7) | 4 / 18 (7) |
| TYPE cyclic components / nodes (largest) | 7 / 19 (5) | 7 / 19 (5) |

The +7 type edges are the expected leaf wiring (hub → profile leaf,
hub → section leaf including the patch re-export, leaves → their
`cadCorePrimitiveTypes` / `cadTypes` / `cadProfileTypes` /
`cadSectionTypes` type dependencies). Value edges are byte-identical in
count (0 added / 0 removed): both leaves are type-only, so the runtime
graph is untouched.

Type SCC membership BEFORE and AFTER (unchanged — verified in the AFTER
measurement; BEFORE membership per parent):

- export-scene 5 (`cadAnalysisExportScene` / `cadExportScene` /
  `cadGradingExportScene` / `cadGradingGroupExportScene` /
  `cadSheetScene`)
- cogo/types 4 (`cadAnnotationAnchors` / `cadCogoTypes` /
  `cadProjectLookup` / `cadTypes`)
- `cadProjectTransform` / `cadProjectTransformRequest` (2)
- `cadSurfaceEditMesh` / `cadSurfaceEdits` (2)
- `cadSurfaceRevision` / `cadSurfaces` (2)
- `dxfBlockExport` / `dxfExportModel` (2)
- `profileExtraction` / `profileSampling` (2)

Stated honestly: this phase produces **no SCC reduction**. Unlike 195.4
— where the hub imported generation/parcel types from cycle members, so
extraction dissolved the 9-node transaction/F2F type SCC — the
profile/section payloads were inline union members, not a cycle: there
was no type back-edge through them to sever. The leaves are type-graph
singletons by construction (type-only out-edges, zero in-edges from
outside the hub), and the suite pins "no edge of any kind from either
leaf back to the hub" so they can never join a future SCC unnoticed.

## Limitations

- Scope-restricted resolution drops cross-scope edges (94 unresolved);
  a back-edge from outside the scope would be invisible here.
- Classification is syntactic over static `import`/`export` declarations.
- No `test:agent`, build, browser QA, or CI is run or claimed here — parent
  integration owns those; exact-head CI is authoritative.

## Roadmap

- #195 remainder: grading payloads get the same leaf treatment, keeping
  union order and `CadCommandKey` stable.
- The `cadTypes` 4-node annotation/cogo hub and the 5-node export-scene
  SCC stay open (both pre-date this phase and are untouched by it).
- Keep `scripts/cadTypeImportGraph.mjs` as the regression entry point;
  the value graph must stay identical to this AFTER measurement.
