# STRUCT-195.15 — Full-repository dependency graph / methodology audit

Branch: `docs/struct19515-full-repo-acceptance-audit`.
Baseline: `origin/main` exact `7bc018676c0b8111563fccac85a9ec9a5b00a800` (PR #238 merge, STRUCT-195.14).
Working tree clean; 14 pre-existing user stashes preserved untouched.
Scope: READ-ONLY audit + one zero-marginal-cost guard assertion (blocks type acyclicity in the existing 1952 suite). No production changes.

## 1. Analyzer methodology (`scripts/cadTypeImportGraph.mjs`, ~390 lines)

- **Parser:** TypeScript compiler API (`ts.createSourceFile`, latest target, no parent nodes). ScriptKind by extension. Top-level statements only.
- **Classification (`classifyClause`):**
  - `import …`: `isTypeOnly` or `import type` → `type`. Else per-binding: default/namespace → value; named elements individually type/value. All-value → `value`, all-type → `type`, mixed → **`mixed`**.
  - `export … from`: `export type` → `type`; named clause per-element; **`export *` / `export * as ns` → `value`** (runtime edge). Re-export without module specifier → not an edge.
  - `MIXED` contributes to **both** value and type adjacency maps.
- **Resolution:** relative specifiers only (`./`, `../`); bare specifiers never resolved. Probe order: exact ext (`.ts/.tsx/.mts/.cts/.js/.jsx/.mjs/.cjs`) → bundler `.js/.mjs/.cjs`→`.ts/.tsx` remap → appended ext → `index.<ext>`. Universe restricted to supplied file set (cross-scope imports become `unresolved`, excluded from nodes/edges/SCCs).
- **Path aliases:** `tsconfig.json` has no `baseUrl`/`paths`; CLI/guards pass no aliases → no alias edges in practice (only synthetic snapshot test exercises them).
- **SCC:** deterministic iterative Tarjan over sorted nodes; `findCycles` marks cyclic if `length > 1` **or self-loop**. Adjacency frozen sorted; components sorted by smallest member.
- **Pair hashing (in guard tests, not the script):** `value|mixed` edges → `` `${relPosix(from)}\n${relPosix(to)}` `` → dedup `Set` → sort → `sha256(JSON.stringify(pairs))`. Edge count kept separately with multiplicity.
- **CLI:** `node scripts/cadTypeImportGraph.mjs <root>` uses **only `argv[2]`** (second arg silently ignored), no aliases. Importable as library (`buildGraphs`, `collectTypeScriptFiles`, `findCycles`, `tarjanSCC`, `reachableFrom`).

## 2. Measurements at HEAD `7bc01867` (no aliases, matching guards)

### (A) Guard scope CAD+F2F (`src/engine/cad` + `src/engine/fieldToFinish`)

| metric | value |
|---|---|
| nodes | **483** |
| edges total | **2400** (value 1337, type 815, mixed 248) |
| value+mixed edges | **1585** |
| unique value pairs | **1567** |
| pair SHA256 | **`0bc9bae1f87e81161f250fd5852730e56b9bdd1311b02257cdecf39dd4d2fcb7`** |
| unresolved | **94** (value 73, type 21; `../id`×46, `robust-predicates`×11, `vitest`×9, `../resultIntegrity`×8, `../../types`×5) |
| **VALUE SCCs** | **0 / 0 nodes / 0 self-loops** |
| **TYPE SCCs** | **0 / 0 nodes / 0 self-loops** |

Byte-for-byte the frozen 19514 golden. Wall ~1.6 s.

### Guard `GRAPH_DIRS` scope (+ `src/cad-app/blocks`, as built by `cad_type_dependency_graph_1952.test.ts`)

**490 nodes / 2424 edges, VALUE 0, TYPE 0.**

### (B) Full `src` (`collectTypeScriptFiles('src')` + `buildGraphs`)

| metric | value |
|---|---|
| nodes | **1654** |
| edges total | **7507** (value 3758, type 3063, mixed 686) |
| value+mixed | **4444**; unique pairs **4385**; SHA `415f97f0a1a662ca6523144106bec331fef305476eb34cd316df7c70f8972448` |
| unresolved | **491** (value 399, mixed 58, type 34; `react`×421 dominant) |
| **VALUE SCCs** | **0 / 0 / 0 self-loops** |
| **TYPE SCCs** | **8 components / 41 cyclic nodes / 0 self-loops** |
| wall time | **~13.8 s** (too slow for routine agent tier → no full-src zero-SCC gate proposed) |

Full-src residual TYPE SCCs (8, **zero files under `src/engine/cad/`**, `fieldToFinish`, or `cad-app`):

1. Project-workflow hub (16): `src/appRunStateTypes.ts`, `src/appStateTypes.ts`, `src/engine/gnssMultifileProject.ts`, `src/engine/importConflictReview.ts`, `src/engine/projectFile.ts`, `src/engine/projectFile.types.ts`, `src/engine/projectWorkspace.ts`, `src/engine/projectWorkspaceTypes.ts`, `src/engine/qaWorkflow.ts`, `src/engine/qaWorkflowTypes.ts`, `src/engine/resultIntegrity.ts`, `src/hooks/projectFileAssociatedSettings.ts`, `src/hooks/projectFilePayloadBuilders.ts`, `src/hooks/useProjectFileWorkflow.ts`, `src/hooks/useProjectFileWorkflow.types.ts`, `src/hooks/useProjectWorkflowDerivedState.ts`
2. Adjustment hub (10): `src/engine/adjustTypes.ts`, `src/engine/adjustmentPreprocessing.ts`, `src/engine/adjustmentRuntime.ts`, `src/engine/adjustmentSolveTypes.ts`, `src/engine/scenarioRunModels.ts`, `src/engine/stochasticGroupDiagnostics.ts`, `src/engine/systematicPatternDiagnostics.ts`, `src/engine/systematicPatternTypes.ts`, `src/types.ts`, `src/typesAdjustmentResult.ts`
3. `src/engine/gnssBaselineAdjust.ts` ↔ `src/engine/gnssBaselineStatistics.ts`
4. `src/engine/gnssMultifileComposition.ts` ↔ `src/engine/gnssMultifileDuplicates.ts`
5. `src/engine/importUnitProvenance.ts` ↔ `src/engine/importers.ts` ↔ `src/engine/terrestrialCsvImport.ts`
6. `src/engine/numericalBackend.ts` ↔ `src/engine/sparseEquationPacking.ts` ↔ `src/engine/sparseWeightRepresentation.ts`
7. `src/engine/preanalysisPlanningShared.ts` ↔ `src/engine/preanalysisPlanningSolveAudit.ts`
8. `src/hooks/surveyCad/useSurveyCadCommandPreview.ts` ↔ `src/hooks/surveyCad/useSurveyCadCommandTypes.ts` ↔ `src/hooks/surveyCad/useSurveyCadCurveF1Session.ts` — **CAD-adjacent**: CAD command preview/type UI-session modules plus the Curve-F1 session hook. Outside the `src/engine/cad` hub scope (zero files under `src/engine/cad/`, `fieldToFinish`, or `cad-app`), but CAD-related, not unrelated. Items 1–7 are non-CAD domains.

### (C) `src/cad-app` isolated (diagnostic)

**149 nodes / 396 edges, VALUE 0, TYPE 0**, ~0.2 s. 415 unresolved are a scope artifact (cross-scope imports dropped by restricted universe), not a graph property.

### Historical cross-check (read-only `loadSourcesFromGit`, scope cad+f2f)

| ref | files/edges | VALUE SCC/nodes | TYPE SCC/nodes |
|---|---|---|---|
| `ee5b2a31` (pre-195.1) | 461 / 2333 | **5 / 20** | **5 / 58** (largest 47) |
| `4796e0ba` (195.2 BEFORE) | 462 / 2337 | **4 / 18** | **5 / 58** (largest 47) |
| `7bc01867` (HEAD) | 483 / 2400 | **0 / 0** | **0 / 0** |

`4796e0ba` row reproduces `docs/evidence/struct-1952/architecture.md` exactly. Entire scoped graph (VALUE and TYPE) acyclic at HEAD.

## 3. The two original REAL VALUE cycles are broken (direct + indirect, full `src` BFS)

| direction | result |
|---|---|
| `cadTransactionsSurfaceCommands` → `cadTransactionsSurfaceBoundaryCommands` | **true** (direct value edge retained — one-way) |
| `cadTransactionsSurfaceBoundaryCommands` → `cadTransactionsSurfaceCommands` | **false** (not even a type edge) — **broken** |
| `cadBlockUiCommands` → `cadBlockReferenceOps` | **true** (direct value edge retained — one-way) |
| `cadBlockReferenceOps` → `cadBlockUiCommands` | **false** on value graph (**true** on type graph, `import type` only) — **value cycle broken** |

Exact current wiring:

- `cadTransactionsSurfaceCommands.ts` imports `surfaceBoundaryCommandDefinitions` (value) + `commitSurface, editSurface` from `cadTransactionsSurfaceCore`.
- `cadTransactionsSurfaceBoundaryCommands.ts` imports `commitSurface, editSurface` from `cadTransactionsSurfaceCore` (was: from SurfaceCommands). Core imports `cadSurfaceTypes`, `cadTransactionsLayerCommands`, `cadTypes` — no command/boundary module → no back edge.
- `cadBlockUiCommands.ts` imports `applyBlockReferenceOp` (value) + `fail, siblingNames, type CadBlockUiCommandKey` from `cadBlockUiCommon`.
- `cadBlockReferenceOps.ts` imports `type { CadBlockUiOp, CadBlockUiResult }` from `cadBlockUiCommands` (**type-only**) + `fail, siblingNames` from `cadBlockUiCommon`.
- `cadBlockUiCommon.ts` has **zero value imports** (`import type` of `CadEntityId, CadProject` only). Former `blockFail`/`blockSiblingNames` re-export on UiCommands removed.

## 4. "135 type cycles across 176 files" — provenance: NON-COMPARABLE

- Figure appears only in `docs/evidence/struct-1951/architecture.md` (lines 13, 155, 163), `validation.md:138`, and commit `2b6616a4`. **`176 files` occurs nowhere** in repo or markdown history (`git log --all -S'176 files'` empty).
- 195.1 `validation.md` "Honest limitations": BEFORE edges "**reconstructed from the integrated diff … not from a pre-change full AST run**" — no tool ever produced 135.
- 195.3 `architecture.md:73` reconciles: *"The older '135 cycles' figure from 195.1 predates the 195.2 tool recount; the current scoped baseline is 8 type SCCs / 28 nodes."*
- Independent re-measurement of `ee5b2a31` with the actual tool: **TYPE 5 SCCs / 58 nodes** (VALUE 5/20). 135 matches neither SCC count, cyclic-node count, nor type-edge count (756/758).

**Verdict:** 135 was not an SCC count and is unreproducible from any committed artifact. Treat as superseded ad-hoc figure (plausibly lint/dependency-cruiser message count — unconfirmable). Honest before/after on consistent methodology: **TYPE 5 SCC/58 nodes (`ee5b2a31`) → 0/0 (HEAD)** in tracked scope; **VALUE 5 SCC/20 → 0/0**.

## 5. Blind spots (bounds on "zero")

- Static declarations only: dynamic `import()` (6× `await import(`, 2× `return import(`, 17× `=> import(`, 1× `React.lazy`, ~74 type-position) and `require()` (**0**) unparsed. None in audited surface/block modules → the two broken cycles unaffected.
- External packages excluded: 491 unresolved in full `src` (`react` 421, `react-dom/client`, `vitest`, `lucide-react`, `proj4`, `robust-predicates`, `delaunator`, `fflate`, `node:*`); CSS/`?raw` assets unresolved.
- Scoped runs drop cross-scope edges (94 unresolved in CAD+F2F, `../id` ×46): an outside-scope back-edge would be invisible.
- Therefore "zero" = **zero SCCs among statically analyzable, resolvable internal TS edges** — not a whole-repo runtime guarantee. Full `src` still has 8 TYPE SCCs, so whole-repo zero is false regardless.

## 6. Guard change in this phase

Scoped VALUE 0 / TYPE 0 already pinned by `cad_geometry_primitives_runtime_cycle_19514.test.ts` + pair-SHA goldens (`_1957/1958/1959/19514`). Only uncovered slice: `src/cad-app/blocks` **type** acyclicity — the 1952 suite already builds that graph, so one assertion (`findCycles(graph.nodes, graph.type)` empty) added at ~0 marginal cost. No full-src gate (13.8 s exceeds agent-tier budget per `docs/TEST_TIERS.md`; would fail today on the 8 out-of-scope TYPE SCCs).
