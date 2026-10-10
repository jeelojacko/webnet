# STRUCT-195.12 — Break parcel-diagnostics runtime import cycle: architecture

## Baseline

- `origin/main` exact `c132c428eaae066b37cd3bedafe6f4604cb04172` (PR #235 merge, STRUCT-195.11).
- Scope `src/engine/cad` + `src/engine/fieldToFinish` via `scripts/cadTypeImportGraph.mjs`
  (canonicalization: repo-relative POSIX `from\nto` value pairs, dedup, `JSON.stringify` → SHA256):
  nodes **481**, edges **2393**, value|mixed **1580**, unique value pairs **1562**,
  pair SHA `3d7284dbb0d33d8ba7afaad3dc2c0a7136945e98910ac026eebd03c0fbdc835e`,
  VALUE **3 SCC / 16 nodes** (geometry 7 + arc/polyline 5 + parcel 4), TYPE **0**.

## Target cycle (4-node runtime SCC, all edges verified in source)

- `cadCogoParcelGeometry.ts` (291-byte `export *` facade): `A -> B` value
  (`export *` Diagnostics), `A -> C` value (`export *` SourceDraft).
- `cadCogoParcelDiagnostics.ts` (B): `B -> A` mixed (broad facade import of
  closure/overlap/primitives/types), `B -> D` value (`export *` Linework).
- `cadCogoParcelGeometrySourceDraft.ts` (C): `C -> B` value (helper import).
- `cadCogoParcelLineworkDiagnostics.ts` (D): `D -> A` value (facade import).

## Change

- **NEW** `src/engine/cad/cadCogoParcelLineworkTopology.ts`: owns
  `buildParcelLineCandidate` + `buildParcelNodeMap`, moved byte-for-byte
  (bodies, order, label/pointKey quantization, incident arrays) with the
  `CadParcelLineCandidate` (now exported for the typed consumer) /
  `CadParcelNode` shapes. Imports only `parcelPointKey` (value) from
  `cadCogoParcelGeometryPrimitives`, `type CadWorldPoint` from `cadGeometry`,
  `type CadEntityId/CadLineEntity` from `cadTypes`. No facade/Diagnostics/
  SourceDraft/Linework edge.
- `cadCogoParcelLineworkDiagnostics.ts`: helpers replaced by import +
  `export { buildParcelLineCandidate, buildParcelNodeMap }` (old paths keep
  identity); `cadBuildParcelSourceDraft` imported directly from SourceDraft.
  `cadBuildParcelLineworkDiagnostics` body + public diagnostic types unchanged.
- `cadCogoParcelGeometrySourceDraft.ts`: one-line helper-import repoint
  Diagnostics → topology. `ReturnType<typeof …>` shapes identical, body unchanged.
- `cadCogoParcelDiagnostics.ts`: single import-hunk repoint from broad facade
  to `cadCogoParcelGeometrySummaries`, `cadCogoParcelGeometryOverlap`,
  `cadCogoParcelGeometryPrimitives`, `cadCogoParcelGeometryTypes`. All bodies
  byte-for-byte; `export *` Linework preserved.
- Facade `cadCogoParcelGeometry.ts`: export-star list/order **unchanged**.

## Resulting DAG

`A -> B -> D -> C -> topology`, plus direct leaf edges
(B → summaries/overlap/primitives/types; topology → primitives).
Nothing points back to the facade or Diagnostics from the cluster.

## Final graph (independently remeasured)

- Nodes **482** (+1 topology), edges **2400** (+8 − net −4/+11), value|mixed
  **1584**, unique pairs **1566**, pair SHA
  `0feb1dc83004ac635b001471ff5c7e68cc0eb7de82f3c9a38483ead342f33df5`.
- VALUE **2 SCC / 12 nodes** (geometry 7 + arc/polyline 5, both untouched),
  TYPE **0**. All four old parcel modules + topology are singletons in both graphs.

## Full authorized edge delta (multiset, kind|from|to)

Removed (4):

- `mixed|…/cadCogoParcelDiagnostics.ts|…/cadCogoParcelGeometry.ts`
- `value|…/cadCogoParcelGeometrySourceDraft.ts|…/cadCogoParcelDiagnostics.ts`
- `value|…/cadCogoParcelLineworkDiagnostics.ts|…/cadCogoParcelGeometry.ts`
- `mixed|…/cadCogoParcelLineworkDiagnostics.ts|…/cadGeometry.ts`
  (mixed→value split: `CadWorldPoint` type use left with the moved helpers)

Added (11):

- `value|Diagnostics|…/cadCogoParcelGeometryOverlap.ts`
- `value|Diagnostics|…/cadCogoParcelGeometryPrimitives.ts`
- `value|Diagnostics|…/cadCogoParcelGeometrySummaries.ts`
- `type|Diagnostics|…/cadCogoParcelGeometryTypes.ts`
- `value|SourceDraft|…/cadCogoParcelLineworkTopology.ts`
- `value|Linework|…/cadCogoParcelGeometrySourceDraft.ts`
- `mixed|Linework|…/cadCogoParcelLineworkTopology.ts` (value helpers + type import)
- `value|Linework|…/cadGeometry.ts`
- `value|Topology|…/cadCogoParcelGeometryPrimitives.ts`
- `type|Topology|…/cadGeometry.ts`
- `type|Topology|…/cadTypes.ts`

Every tuple touches only the five parcel modules or their direct leaf targets.
No other edge in the 2400-edge graph changed.

## Historical guards

- `tests/cad_project_transform_runtime_delta_19511.guard.ts` (48 kB, SHA
  `78a71ca4`): **untouched, never relabeled**.
- `tests/cad_project_transform_runtime_cycle_19511.test.ts`: cumulative
  accounting — original trio-relocation proof kept on the non-parcel remainder,
  new `PARCEL_19512_REMOVED/ADDED` proof for the parcel remainder, counts
  `480+2` nodes / `2392+8` edges, SCC `2/12`.
- Global goldens in 1957/1958/1959/19510 rolled `1562/1580/3d7284db…` →
  `1566/1584/0feb1dc8…`; 1954 SCC pin `3/16` → `2/12`. All payload/type/
  negative-control/per-target assertions intact.
