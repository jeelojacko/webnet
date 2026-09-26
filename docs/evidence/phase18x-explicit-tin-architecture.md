# Phase 18X — Explicit-TIN / explicit-bake architecture audit

- **Branch:** `feat/cad-surface-explicit-bake`
- **Baseline:** `origin/main` = `3c3649f40a3cc5900d93c85b056bf042f3b790b1`
- **Branch tip at audit:** `3c3649f40a3cc5900d93c85b056bf042f3b790b1` (zero commits, pre-implementation)
- **Audit type:** read-only reconnaissance (scout `18x-arch-audit`, no source modified)
- **Status:** PRE-IMPLEMENTATION

## 0. Method and evidence limits

Scout toolset was read-only (`read,grep,find,ls,fffind,ffgrep,lsp_*,ask_question`), no shell/write.
Ancestry reconstructed from `.git/HEAD`, `.git/refs/**`, `.git/packed-refs`, `.git/logs/HEAD`, `TODO.md:1`.
All `file:line` valid at baseline `3c3649f4` only.

## 1. Baseline inventory

### 1.1 Refs observed

| Ref | Value | Note |
|---|---|---|
| `refs/remotes/origin/main` (loose) | `3c3649f40a3cc5900d93c85b056bf042f3b790b1` | authoritative baseline |
| `HEAD` | `ref: refs/heads/feat/cad-surface-explicit-bake` | == baseline |
| packed `origin/main` | `7b8ad218…` | STALE, overridden by loose ref |
| packed `heads/main` | `87691125…` | stale local main |
| 18W tip | `6c72cdf098951ddaf6b4ba157a29cc2d21598ce8` | PR #114 tracking |
| 18V tip | `4434c2c44188ba215490ed6179038fecb371c3cc` | PR #113 tracking |

Hygiene: tooling reading `packed-refs` directly gets wrong baseline. `git rev-parse origin/main` authoritative.

### 1.2 Engine modules in scope

- `src/engine/cad/cadTypes.ts` — `CadSurfaceDefinition`, `sourceKind`, `ImportedTinPayload`, `ImportedTinProvenance`, `isImportedTinDefinition`, vertex/edge ref contracts.
- `src/engine/cad/cadImportedTin.ts` — `validateImportedTinPayload`, `importedTinRevision`, `materializeImportedTin`.
- `src/engine/cad/cadSurfaces.ts` — `buildCadSurface`, `replaySurfaceEdits`, `deriveSurfaceStatus`.
- `src/engine/cad/cadSurfaceRevision.ts` — `collectSources`, `computeCadSurfaceSourceRevision`.
- `src/engine/cad/cadSurfaceTypes.ts` — clone/backfill/cache-clear, `SurfaceBuildRequest`, `buildSurfaceBuildRequest`.
- Edit kernel: `cadSurfaceEdits.ts`, `cadSurfaceEditMesh.ts`, `cadSurfaceEditPicking.ts`, `cadSurfaceEditAddLine.ts`, `cadSurfaceEditPointAdd.ts`, `cadSurfaceEditPointModify.ts`, `cadSurfaceEditBulk.ts`, `cadSurfaceEditTransform.ts`, `cadSurfaceEditDescribe.ts`, `cadSurfaceEditDeps.ts`, `cadEditEdgeSpatialIndex.ts`, `cadEditPointLocationIndex.ts`.
- Transactions: `cadTransactionsSurfaceCommands.ts`, `cadTransactionsSurfaceBoundaryCommands.ts`, `cadTransactionsEditCommands.ts`, `cadTransactionsEntityTransforms.ts`, `cadTransactionsLandxmlImport.ts`, `cadLandxmlCommit.ts`.
- Persistence: `cadPersistence.ts`, `cadDrawingFile.ts`.
- Transform/bounds: `cadProjectTransform.ts`, `cadProjectTransformRequest.ts`, `cadProjectTransformReport.ts`, `cadTransactionsProjectTransformCommands.ts`, `cadProjectAuthoritativeBounds.ts`.
- Workers: `cadSurfaceTypes.ts` (request), `surfaceWorkerHandler.ts`, `surfaceBuildService.ts`, `surfaceAnalysisService.ts`.
- LandXML: `landxmlSurfaceImport.ts`, `landxmlImport.ts`, `landxmlCivilSource.ts`, `landxmlCadProject.ts`, `landxmlCadSerialize.ts`, `landxmlExportSummary.ts`.
- Shell/hooks: `cadSurfaceSnapshot.ts`, `CadSurfaceManager.tsx`, `CadSurfaceDefinitionEditor.tsx`, `CadSurfaceDefinitionParts.ts`, `CadSurfaceEditTable.tsx`, `CadSurfaceSelectionSection.tsx`, `CadSurfaceInquiryPanel.tsx`, `CadToolspace.tsx`, `CadRibbon.tsx`, `cadCommandRegistry.ts`, `useSurveyCadSurfaceEditSessions.ts`, `useSurveyCadSurfacePointEditSessions.ts`, `useSurveyCadSurfaceBulkSelection.ts`, `surfacePointEditSessionUtils.ts`, `surfaceBulkSelectionUtils.ts`, `surfaceBulkEditSessionUtils.ts`, `useSurveyCadWorkspaceHistory.ts`.

### 1.3 Fixture-backed contracts

18L/18M: landxml_import_surfaces_18l, landxml_import_alignments_18l, landxml_civil_surface_18l, landxml_civil_profile_section_18l, landxml_export, landxml_export_golden, landxml_interchange, landxml_commit_production_18m, landxml_import_build_glue_18m, landxml_import_review_selection, landxml_import_undo_history_18m, landxml_production_selection_18m.
18R: cad_project_transform_18r.
18S: cad_surface_edits_18s, edit_transactions_18s, edit_persist_18s, edit_downstream_18s, edit_perf_18s.
18T: point_edits_18t, point_edits_landxml_18t, point_edits_display_18t, point_edits_downstream_18t, point_edits_perf_18t.
18U: analysis_bands_18u, analysis.
18V: bulk_edits_18v, bulk_selection_18v, bulk_persist_18v, bulk_downstream_18v, bruteforce_oracle_18v, move_index_parity_18v.
18W: boundary_edits_18w, breakline_edits_18w, definition_lifecycle_18w, definition_replay_export_18w, definition_roundtrip_undo_18w.
Baseline 18F/G: tin, domain, build_service, transactions_worker, wncad, stats_wncad, contours, contour_worker, contour_ui.
Browser: 18g, 18h, 18i, 18s, 18t, 18u, 18v, 18w specs.

## 2. Phase 18W merge ancestry (reconstructed)

Reflog tail: 18U tip `d8d6faa4` → 18V `e022d1b9` → 18V tip `4434c2c4` (PR #113) → main `8ea69d69` (= 18W creation base, post-#113 main) → 18W impl `b3113f2c` → 18W tip `6c72cdf0` (PR #114) → `3c3649f4` (new branch cut).
`TODO.md:1` corroborates `8ea69d69` = PR #113 merge.
Inference (needs `git log` to confirm): `3c3649f4` at/after 18W tip; likely PR #114 merge. Verify: `git log --oneline --graph -20 3c3649f4` + `git merge-base --is-ancestor 6c72cdf0 3c3649f4`.

## 3. Explicit-topology model today

### 3.1 Definition (`cadTypes.ts:883-908`)

`CadSurfaceDefinition`: `pointSource`, `breaklines?`, `boundaries?`, `buildOptions?`, `edits?`, `sourceKind?: 'native'|'imported-tin'` (:900), `importedTin?: ImportedTinPayload` (:901).
`ImportedTinProvenance` (:866-871): `{ format:'LandXML'; fileName; surfaceName; sourceId? }` — LandXML-by-construction.
`ImportedTinPayload` (:877-881): `{ vertices:number[]; faces:number[]; provenance }`, flat XYZ + CCW triples, metres.
`isImportedTinDefinition` (:905-908): exact equality `sourceKind==='imported-tin' && importedTin!=null`. Unknown kinds → false.
Refs (:911-919): `source:<entityId>`, `imported:<surfaceId>:<vertexIndex>`, `edit:<surfaceId>:<editId>`; `boundary:`/`steiner:` not addressable.

### 3.2 Validator/revision/materializer (`cadImportedTin.ts:31-135`)

Validate: `vertices%3==0 && >=9`, finite; `faces%3==0 && >0`; integer in-range; no degenerate; strict CCW XY area > 0. Provenance not validated.
Revision: `srev1:imported:<fnv1a(id|vertices|faces|prov|edits)>`.
Materialize: validate → points `<sid>:v<n>` → 1:1 triangles → `buildTinTopology` (all FREE, exterior -1) → grid+stats. Null on invalid, never partial. No Delaunay/hull.

### 3.3 Build/status/revision

`buildCadSurface` (`cadSurfaces.ts:240`, imported leg :244-297) → replay edits → bounds → stats → grid; invalid → `blocked` + `SURFACE_TRIANGULATION_FAILED`. Native leg :299.
`replaySurfaceEdits` single chokepoint (~:175-188), `constrained: new Map()` on import leg.
`deriveSurfaceStatus` (:505, imported :513-520): missing payload FAILED; else UNBUILT/CURRENT/NEEDS_REBUILD. Never BROKEN_REFERENCE/INSUFFICIENT_DATA.
`collectSources` (`cadSurfaceRevision.ts:97-123`): imported shortcut (dead in practice — build returns first). `computeCadSurfaceSourceRevision` (:318-322): imported branch.

## 4. sourceKind branch inventory

### 4.0 Name collisions — four distinct unions

Surface topology (`cadTypes.ts:900`, `cadSurfaceSnapshot.ts:37`); breakline source (`point-chain|entity`); point source (`point-group|points`); analysis source (`surface|volume`); F2F link/chain. Never conflate.

### 4.1 Predicate sites (7) — `isImportedTinDefinition(...)`

`cadSurfaces.ts:244` (build leg), `:513` (status), `cadSurfaceRevision.ts:98` (collectSources), `:320` (revision), `cadTransactionsSurfaceCommands.ts:81` (native-mutation guard), `cadTransactionsSurfaceBoundaryCommands.ts:104` (boundary guard), `cadProjectAuthoritativeBounds.ts:29` (bounds union). Unknown kind → silent native misclassification (worst mode).

### 4.2 Exact-equality sites (19) — `sourceKind==='imported-tin'`

`cadSurfaceTypes.ts:218` (worker point-snapshot prune), `cadProjectTransform.ts:130` (fail-closed preflight), `:286` (vertex transform), `cadProjectTransformRequest.ts:82` (tinVertices count), `cadTransactionsLandxmlImport.ts:142` (dedupe), `cadLandxmlCommit.ts:196,200` (schedule/materialize), `surfaceBuildService.ts:345` (fallback budget), `cadSurfaceSnapshot.ts:351,352` (manager text), `cadSurfaceEditSummaries.ts:115` (ref labels), `CadSurfaceDefinitionEditor.tsx:43` (imported panel), `CadToolspace.tsx:533` (tree label), `CadRibbon.tsx:191` (disable breakline/boundary), `useSurveyCadSurfacePointEditSessions.ts:93`, `useSurveyCadSurfaceBulkSelection.ts:56`, `useSurveyCadSurfaceEditSessions.ts:94,223`, `surfacePointEditSessionUtils.ts:161` (baseZ).

### 4.3 Direct `importedTin` reads bypassing predicate

`cadSurfaceTypes.ts:25-30`, `cadSurfaces.ts:245,257,514`, `cadSurfaceSnapshot.ts:353-356`, `cadSurfaceEditSummaries.ts:116`, `surfaceBuildService.ts:346`, `surfacePointEditSessionUtils.ts:162`, `cadProjectTransform.ts:131,287,301`, `cadProjectTransformRequest.ts:81-82`, `cadTransactionsLandxmlImport.ts:143,253`, `cadLandxmlCommit.ts:170`, `cadProjectAuthoritativeBounds.ts:30`.

### 4.4 Kind-agnostic ref code

`cadSurfaceEditPicking.ts:66-80` (inverse; unrecognized kind → `source:<pointId>` — silent wrong), `cadSurfaceEditMesh.ts:88-108` (resolver, fails closed), `surfaceBulkEditSessionUtils.ts:69-72` (inverse copy 2), `cadSurfaceEditSummaries.ts:76-101` (labels), `useSurveyCadSurfaceEditSessions.ts:93-98` (inverse copy 3). **Ref inverse triplicated** — any prefix change hits all three.

## 5. Subsystem audit

### 5.1 Build/replay

Invalid → blocked + empty arrays, `resolvedPointCount` from payload, `grid: buildSurfaceGrid([],[])`. Stats quirk: `resolvedPointCount` pre-replay vs `usedPointCount` post-replay — preserve exactly.

### 5.2 Worker protocol

`SurfaceBuildRequest.definition` = full clone (`cadSurfaceTypes.ts:238`, `:23-85`) → new fields ride free; worker calls same `buildCadSurface` (`surfaceWorkerHandler.ts:404-410`). Prune (`:210-218`) omits points for imported (perf). **Fallback budget** (`surfaceBuildService.ts:339-348`): imported → payload verts; native → `request.points.length`. New kind as native ⇒ `points:[]` + budget 0 ⇒ zero-point fallback → INSUFFICIENT_DATA. Most concrete failure mode.

### 5.3 Revision/cache

Revision content-derived, never persisted; `cachedRevision` cleared on load → honest UNBUILT. Changing `srev1:imported:` prefix or provenance parts flips CURRENT→NEEDS_REBUILD on open + breaks pins. Freeze prefix.

### 5.4 Refs/picking/kernel

Refs persisted in `edits[]` — grammar is persisted contract. `pickSurfaceVertex` (:193), `pickSurfaceEdge` (:206), tolerance 1% extent floor 0.5m. Synthetic blocked. `resolveEditVertex` string-keyed, no proximity. Edit-created `edit:<sid>:<editId>`. 18V filters `source|imported|added`; new prefix needs new filter+labels.

### 5.5 Manager/Toolspace/Ribbon

Snapshot `:351-357` hard-codes "Imported LandXML TIN — N vertices, M faces (file…, surface…)". Toolspace `:529-535` renders breakline/boundary counts (always 0) for imported — cosmetic. Editor `:43-51` short-circuits with "Imported surface…" — baked must not inherit "Imported". Ribbon `:191,230-231` disables breakline/boundary; mesh edits stay enabled (18S/T/V, gated CURRENT).

### 5.6 18W guard

Deny-list `NATIVE_SOURCE_MUTATION_KEYS` (14 commands, `cadTransactionsSurfaceCommands.ts:51-66,81`); returns null (silent no-op). Second guard `:BoundaryCommands:104`. **Fails open** for future commands; ribbon-only UI cover. 18X: replace with positive capability predicate.

### 5.7 LandXML

Import validates (`:96`), dedupes imported-only (`:142-143`, key `vertices#faces#surfaceName`), constructs vestigial empty `pointSource` (`:253-261`). Provenance attribution-only (revision + display). Export (`landxmlCivilSource.ts:126-172`) from runtime cache mesh, CURRENT-gated, **fully sourceKind-agnostic** — both strategies export-neutral.

### 5.8 WNCAD

Clone emits `sourceKind` then `importedTin` (`:23-31`); key order signature-sensitive (`cadPersistence.ts:226-229`, history sync). Backfill pure clone, no version. Load (`:229,377`, `cadDrawingFile.ts:283,377`) never validates payload — corrupt file fails late at build. No schema version; additive-optional = no-op; new-required = break.

### 5.9 PROJECTTRANSFORM

Preflight (`:118-146`, `:130` skip non-imported) fail-closed `CAD_PROJECT_TRANSFORM_IMPORTED_TIN_INVALID`; unrecognized kind skips ⇒ reopens 18R.1 defect. Transform (`:270-311`): clone → `transformCadSurfaceEdits` once → `transformImportedTinVertices` → rescale maxEdgeLength → invalidate (`cachedRevision:null`). Faces/provenance/Z preserved (XY similarity). Counts `:82` tinVertices imported-only. Bounds union imported XY.

### 5.10 Dependents

Contours/profiles/sections/volumes/analysis/inquiry/display/lock read final mesh + `srev1` — kind-agnostic, free for new kind if build+revision correct. Only kind-sensitive: fallback budget + snapshot pruning.

### 5.11 History/undo

`commitSurface`/`editSurface` (`:38-95`); geometry clears cache, renames keep. Mesh edits one entry/command; 18W batch collapses. LandXML import one atomic entry. Derived meshes never persisted. **Bake must snapshot post-replay mesh AND clear `edits[]`** or double-apply on first build.

## 6. Risk register

R1 silent native misclassification (7 predicate sites) — Critical. R2 skipped transform preflight (reopens 18R.1) — High. R3 zero-point fallback budget — High. R4 tinVertices 0 — Medium. R5 key-order/signature churn — Medium. R6 revision churn — Medium. R7 wording ("Imported…", `format:'LandXML'`) — Medium. R8 deny-list fails open — Medium (pre-existing). R9 ref-inverse triplication — Medium. R10 forward-compat unknown-kind — Medium. R11 bake+retained edits double-apply — High. R12 survey identity loss (document, not fix). R13 bake of <3-pt surface blocked. R14 stale packed refs — Low.
Root cause: equality predicate on 1-of-2 values; fix = semantics predicate ("carries explicit stored topology").

## 7. Strategy A vs B

**A** (`sourceKind:'explicit-tin'` + new `explicitTin` field, legacy retained): new persisted key ⇒ clone/order/signature work; 3 states at 26 sites unless predicate widened anyway; duplicated validator/revision/transform branches or resolver; permanent double surface.
**B** (generalize `importedTin` in place, widen discriminant): one payload/leg/validator/materializer/revision; predicate centralizes R1-R4; no new key (R5 neutral); freeze `srev1:imported:` prefix (R6 neutral for existing); presentation-only branches; alias `ExplicitTinPayload = ImportedTinPayload`.

Deciding evidence: behavior identical across build/revision/refs/edits/transform/bounds/status/worker/guard/persistence/export/dependents — only presentation + provenance metadata differ. All 7 predicate + correctness-critical exact-match sites are capability questions. Determinism surface smallest under B. Ref grammar persisted — keep `imported:` prefix.

## 8. Recommendation — Strategy B

1. `sourceKind?: 'native'|'imported-tin'|'explicit-tin'` (`cadTypes.ts:900`). No new field.
2. `isExplicitTopologyDefinition(def) → def?.importedTin != null && def.sourceKind!=='native'` (fail-closed into explicit leg). Keep `isImportedTinDefinition` as deprecated alias one phase, then migrate.
3. Widen 19 exact-match classification sites to predicate; presentation-only (`cadSurfaceSnapshot.ts:351-352`, `CadToolspace.tsx:533`, `CadSurfaceDefinitionEditor.tsx:43`, `CadRibbon.tsx:191`) branch on discriminant.
4. `export type ExplicitTinPayload = ImportedTinPayload`; doc comment. No persisted rename.
5. Widen provenance: `format:'LandXML'|'explicit'` (or optional `origin`). LandXML imports byte-identical revision inputs.
6. One validator/materializer/revision/build-leg/replay site.
7. Keep `imported:<sid>:<index>` refs + `<sid>:v<n>` mesh ids for baked (zero parser churn).
8. **Mission deviation requested (product decision):** mission §4 prefers `CadExplicitTinProvenance = {kind:'landxml-import'…}|{kind:'webnet-bake'…}` and §24 suggests `explicit:/baked:` refs. Audit recommends `format:'explicit'` + retained `imported:` prefix as lowest-risk equivalent achieving the same truthfulness (no `format:'LandXML'` fiction, distinct "Baked Explicit TIN" UI). If operator insists on `kind:`-discriminated provenance or new ref prefix, cost = revision-input change (R6) + triplicated-inverse churn (R9) + filter/label churn — schedule as follow-up mechanical phase, not inside bake landing.

### 8.2 Bake design constraints

Snapshot FINAL post-replay mesh; clear `edits[]` same transaction; require CURRENT; locked-layer blocked; single undo entry; `cachedRevision` cleared; exact doubles; provenance `fileName:''`; one-way survey identity; prompt pattern "Surface-only — survey data unchanged".

## 9. Migration plan

0. Gates: lint/typecheck/test:agent; `git rev-parse origin/main`==`3c3649f4`; `git merge-base --is-ancestor 6c72cdf0 3c3649f4`; pin imported-TIN revision strings pre-touch.
1. Predicate widening, zero behavior change. Convert 19 classification sites; keep 4 presentation on discriminant; no user-reachable `'explicit-tin'`. Gates: revision pins byte-identical; preflight still blocks malformed; budget == payload verts; prune intact.
2. Engine `'explicit-tin'` + provenance widen + bake transaction (CURRENT-gated, lock-blocked, single undo, cache cleared). Property test: validator accepts every `buildCadSurface`+replay mesh.
3. Presentation: new baked text variant; never change imported strings (browser spec `cad-surface-definition-editing-18w.spec.ts:592`).
4. Persistence: no schema bump; WNCAD byte-identity both kinds; forward rule "non-native + importedTin ⇒ explicit"; optional load-time validator as separate batch.
5. Verify: new bake tests + 18L/M/R/S/T/U/V/W unchanged; engine/worker ⇒ test:wasm; browser specs; docs (CURRENT_BEHAVIOR, ARCHITECTURE, TODO).

## 10. Capability matrix (baseline)

native = entity-derived; imported-tin = only explicit-stored member; explicit-tin = n/a (the 18X gap). 32-row matrix in full audit; conclusion: two behavioral classes, one implementation — generalization is lower-risk; equality predicate is the structural obstacle.

## 11. Open product decisions

1. Bake = final edited mesh + drop edits (recommended) vs baseline + keep edits. 2. Refuse on non-empty edits vs fold in. 3. Accept `importedTin` wart vs later rename. 4. `format:'explicit'` vs `origin` discriminator. 5. Fail-closed predicate as documented contract. 6. Deny→allow guard now vs follow-up. 7. Load-time validation now vs later.
