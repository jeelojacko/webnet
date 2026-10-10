# STRUCT-195.13 — Break COGO arc/polyline runtime import cycle: architecture

## Root cause

The VALUE graph over `src/engine/cad` + `src/engine/fieldToFinish` held a
five-module COGO arc/polyline runtime cycle:

- `src/engine/cad/cadCogoMath.ts` value `export *` from
  `cadCogoEntityIntersections`;
- `cadCogoEntityIntersections.ts` VALUE-imports `resolveCadPolylineCourses`
  from `cadPolylineCourses`;
- `cadPolylineCourses.ts` VALUE-imports `cadParcelArcGeometry` and
  `cadPolylineGeometry`;
- `cadPolylineGeometry.ts` VALUE-imports `cadParcelArcGeometry`;
- `cadParcelArcGeometry.ts` VALUE-imported `{ buildCadInverseSummary,
  formatCadBearing }` from the broad `./cadCogoMath` facade — closing the
  five-node cycle, although neither function is defined in `cadCogoMath`.

## Fix (one import specifier)

`src/engine/cad/cadParcelArcGeometry.ts` line 24:

```diff
-import { buildCadInverseSummary, formatCadBearing } from './cadCogoMath';
+import { buildCadInverseSummary, formatCadBearing } from './cadCogoSummaries';
```

Why this cuts the cycle: `src/engine/cad/cadCogoSummaries.ts` (~10.8k) is the
verified direct owner of both implementations, and its only import is geometry
math from `./cadGeometry` — no value edge to `cadCogoMath`, parcelArc,
polylineCourses, polylineGeometry, or EntityIntersections. `cadCogoMath.ts`
keeps its `export * from './cadCogoSummaries'`, so every historical consumer
path still resolves to the SAME runtime function objects (identity-pinned in
tests). No function body, export, tolerance, bulge convention, rounding, or
validation logic changed anywhere; the five sibling modules are byte-identical.

## Graph delta (exact, pre vs post)

Scope `src/engine/cad` + `src/engine/fieldToFinish`, guard canonicalization
(repo-relative POSIX `${from}\n${to}`, sorted unique, `JSON.stringify`,
sha256):

- Baseline at exact `origin/main` `92bd3101`: nodes 482 / edges 2400 /
  value|mixed 1584 / unique pairs 1566 / SHA
  `0feb1dc83004ac635b001471ff5c7e68cc0eb7de82f3c9a38483ead342f33df5` /
  VALUE 2 SCC-12 nodes / TYPE 0.
- Final: counts ALL unchanged; SHA
  `76838237ec49987ae9c64b11b97a3d72537b2fda2b806b1bcf73a4a22e1300f0`;
  exactly 1 REMOVED VALUE edge
  `src/engine/cad/cadParcelArcGeometry.ts -> src/engine/cad/cadCogoMath.ts`
  and 1 ADDED VALUE edge `... -> src/engine/cad/cadCogoSummaries.ts`, same
  declaration kind and multiplicity; no other edge changed in the full
  2400-edge multiset.
- VALUE 2 SCC/12 -> 1 SCC/7: the five arc/polyline modules are all singletons
  in both graphs; the sole remaining SCC is the untouched seven-node
  `cadGeometry` group (`cadGeometry`, `cadGeometryArcBuilders`,
  `cadGeometryArcPrimitives`, `cadGeometryCurveCore`,
  `cadGeometryCurveIntersections`, `cadGeometryCurves`,
  `cadGeometryTangentCurve`). TYPE stays 0.

## Test map

- NEW `tests/cad_cogo_arc_summaries_runtime_cycle_19513.test.ts` (25 tests):
  helper identity + frozen export surface + type parity; TS-AST exclusive
  specifier proof; three-order cold-load safety; one-edge multiset delta +
  SCC/singleton shape + in-memory revert negative control; fixed numeric
  oracles (inverse/bearing boundaries, bulge/sweep/tangents/midpoints,
  degenerates, polyline courses + widths, intersections, no mutation).
- ROLLED guards: 1954 SCC pin; 1957/1958/1959/19510 golden SHA forward
  (counts 1566/1584 preserved); 19511 cumulative allowlist gains one
  independent `ARC_19513_*` removed+added entry (19511 trio + 19512 parcel sets
  untouched); 19512 keeps its frozen 41-edge parcel slice byte-identical and
  rolls only the global tally to 1/7 with 19513 provenance.
- `tests/cad_project_transform_runtime_delta_19511.guard.ts` (48k frozen
  fixture): untouched.

## Remaining work (out of scope)

One VALUE SCC survives: the seven-member `cadGeometry*` curve/arcs group —
the final geometry runtime cycle for a later #195 phase. Issue #195 stays OPEN.
