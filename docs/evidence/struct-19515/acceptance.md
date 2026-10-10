# STRUCT-195.15 — Issue #195 acceptance matrix + type-hub inventory + controller recommendation

Issue #195: `[structure] engine/cad type hub: 135 type-level cycles + 2 real value cycles`. State **OPEN**, labels `structure` + `severity/high`. This PR says **Refs #195** (never Closes/Fixes). Controller decides closure.

## 1. Acceptance matrix (issue body → post-merge proof at `7bc01867`)

| # | Issue item (verbatim intent) | Verdict | Proof |
|---|---|---|---|
| A | 195.1 merged (PR #225): two runtime value-import cycles eliminated via shared leaves, CI passing | **DONE** | `src/engine/cad/cadTransactionsSurfaceCore.ts` + `src/cad-app/blocks/cadBlockUiCommon.ts`; `tests/cad_surface_value_cycle_1951.test.ts`, `tests/cad_block_value_cycle_1951.test.ts`; merge `4796e0ba` |
| B | Type architecture unresolved: "135 type-level cycles" + 1,650-line CadCommand union need remeasurement + phased decomposition (#195.2+) | **DONE (remeasure/decompose); literal 135 not reproduced** | Tool `scripts/cadTypeImportGraph.mjs` (195.2); 13 phases #195.2–#195.14; tracked TYPE **0/0**; literal 135 = NON-COMPARABLE (see architecture-audit §4; tool baseline was 5 TYPE SCC/58 nodes) |
| C | Summary: `cadTypes.ts` (1,940) + `cadTransactions.types.ts` (2,023), "135 type-level cycles across 176 files" + 2 value cycles | **PARTIAL** | Hubs now **1923 / 1354** lines; value+type SCC **0/0** tracked scope; transactions hub −33%, `cadTypes.ts` 1940→1923 marginal |
| D | `cadTransactions.types.ts` CadCommand union lines 348→1990 (~1,640 lines inline payloads) | **PARTIAL** | Union now `344–1320` = **977 lines**; 8 domain families extracted (surface 34, volume 9, profile 11, section 17+1, grading 6, grading-group 13, parcel 7, + pre-existing curve-F1 7); **140 inline object payloads + 7 inline intersections remain** |
| E | Value cycle 1: `cadTransactionsSurfaceCommands` ↔ `cadTransactionsSurfaceBoundaryCommands` | **DONE** | 195.1 PR #225; one-way value edge retained, reverse **false** incl. full-`src` BFS |
| F | Value cycle 2: `cadBlockUiCommands` ↔ `cadBlockReferenceOps` | **DONE** | 195.1 PR #225; reverse now **type-only**, value **false** incl. full-`src` BFS |
| G | Core type loop `cadTypes ↔ linkedSync ↔ cadGeneration ↔ cadTransactions.types ↔ cadParcelSharedEdit ↔ cadUndoRedo ↔ cadTransactions` | **DONE** | 9-node transaction/F2F SCC dissolved 195.4 (PR #228, `7127c5f4`); 4-node annotation/COGO hub dissolved 195.7 (PR #231, `5fcffc46`); tracked-scope TYPE 0 confirms no trace in cad hub (whole-`src` residuals touch zero cad-hub files; one CAD-adjacent UI-session SCC, see §5) |
| H | Rec: move CadCommand union into per-domain files; keep union as re-export | **PARTIAL** | 8 per-domain leaves wired (`cadTransactions.types.ts:29–41,71–80`); union still defined once in hub with 147 inline key-bearing members — not re-export-only |
| I | Rec: split `cadTypes.ts` by entity family | **PARTIAL** | Only foundational leaves (core primitives, surface-source, surface-edit-reason, profile-sample, annotation-anchor/COGO-record); entities (22) + styles (16) still inline; grading never lived in `cadTypes.ts` |
| J | Rec: break the 2 value cycles | **DONE** | Both broken 195.1; tracked VALUE 4 SCC/18 → **0/0** via 195.11–195.14 (PRs #235 `c132c428`, #236 `92bd3101`, #237 `c7987ebc`, #238 `7bc01867`) |

**Net:** every *graph* criterion met (0/0 tracked). Both file-cohesion recommendations partially executed.

## 2. Hub inventory (read-only, `wc -l` + AST counts)

### `cadTypes.ts` — 1923 lines, 144 exported decls (102 interfaces, 37 aliases, 5 consts)

| family | span | size |
|---|---|---|
| imports + primitive re-exports | 1–54 | 54 |
| styles / symbols / point groups & labels (16 `*Style`) | 55–244 | ~190 |
| entities (22 `*Entity`) | 245–781 | ~537 |
| `CadEntity` union | 782–813 | ~32 |
| project / metadata / drawing docs | 814–999 | ~186 |
| parcel layout / grip / snap / spike | 1000–1162 | ~163 |
| surface sources / provenance / definition (5 provenance kinds) | 1163–1468 | ~306 |
| surface edits (`CadSurfaceEdit` union) | 1469–1611 | ~143 |
| surface core / contour / style / volume (30 decls) | 1612–1779 | ~168 |
| profile (4 decls) | 1780–1840 | ~61 |
| section (6 decls) | 1841–1923 | ~83 |

### `cadTransactions.types.ts` — 1354 lines

| region | span | size |
|---|---|---|
| imports + `GridGroundDirection` | 1–81 | 81 |
| `CadCommandKey` | 82–335 | **254 lines, 248 literals, 241 unique** (7 pre-existing `BLOCK_*` dupes) |
| `CadCommandPhase` / `CadCommandState` | 336–343 | 8 |
| **`CadCommand` union** | **344–1320** | **977 lines, 168 members** = 140 inline objects + 7 inline intersections + 21 leaf refs |
| transaction / snapshot / result / definition | 1321–1354 | 34 |

Inline residents dominated by SURVEY (16), LAYER (14), BLOCK (9), PARCEL splits (7), ANALYSIS (8), ALIGNMENT (6), feature-line `FL*`/`FEATURELINE` (~10). `LANDXML_IMPORT` intentionally inline (~980, pinned by 195.5). **`CadCommandKey` byte-identical vs 195.2 baseline `4796e0ba` and pre-195.1 `ee5b2a31`** — no public command surface drift.

### Extracted type-only leaves (18 #195 leaves, ≈1492 lines; all zero runtime values, legacy re-exports preserved; 416 `cadTypes` + 73 `cadTransactions.types` importers unchanged)

| leaf | lines | payloads |
|---|---|---|
| `cadCorePrimitiveTypes.ts` | 57 | 9 |
| `fieldToFinishLinkTypes.ts` | 61 | 3 |
| `cadSelectionTypes.ts` | 5 | 1 |
| `cadCogoRecordTypes.ts` | 95 | 8 |
| `annotation/cadAnnotationAnchorTypes.ts` | 76 | 9 |
| `cadTransactionsSurfaceCommandTypes.ts` | 295 | 34 |
| `cadTransactionsVolumeCommandTypes.ts` | 70 | 9 |
| `cadTransactionsParcelCommandTypes.ts` | 74 | 8 |
| `fieldToFinishGenerationTypes.ts` | 75 | 4 |
| `cadTransactionsProfileCommandTypes.ts` | 121 | 11 + patch |
| `cadTransactionsSectionCommandTypes.ts` | 155 | 17 + delete cmd |
| `cadTransactionsGradingCommandTypes.ts` | 72 | 6 |
| `cadTransactionsGradingGroupCommandTypes.ts` | 138 | 13 |
| `cadExportItemTypes.ts` | 35 | 2 |
| `cadSurfaceEditReasonTypes.ts` | 26 | 1 (17-member union) |
| `dxf/dxfPointTypes.ts` | 18 | 2 |
| `cadSurfaceSourceTypes.ts` | 33 | 2 |
| `profiles/profileSampleTypes.ts` | 41 | 3 |

## 3. Assessment

- **Cycles: substantially satisfied, effectively complete in tracked scope.** 0/0 VALUE+TYPE at HEAD, 14 rolling guard suites, `CadCommandKey` frozen since pre-#195.
- **Union/file-split recs: partial but now cohesion-only.** SCCs already 0 — further extraction cannot change the graph.
- Small-safe follow-ons if controller wants the recs fully executed: SURVEY family (16 members, ~113 lines) → `cadTransactionsSurveyCommandTypes.ts`; LAYER (14, ~78) → `…LayerCommandTypes.ts`; BLOCK (9, ~56) → `…BlockCommandTypes.ts`; then entity family (245–781, ~537) → `cadEntityTypes.ts`; surfaces family (1163–1779, ~617) → `cadSurfaceContractTypes.ts`.

## 4. Ranked follow-on roadmap (separate issues, each: leaf + hub splice + `tests/cad_*_*.test.ts` + golden roll-forward, VALUE/TYPE 0, key byte-identical)

| phase | deliverable | acceptance |
|---|---|---|
| STRUCT-195.16 (optional) | SURVEY payload leaf | hub ≤ ~1240 lines; union ≤ ~865 |
| STRUCT-195.17 | LAYER payload leaf | hub ≤ ~1180 lines |
| STRUCT-195.18 | BLOCK payload leaf | hub ≤ ~1130 lines |
| STRUCT-195.19 (aesthetic) | `cadEntityTypes.ts` | `cadTypes.ts` ≤ ~1390; 416 importers typecheck |
| STRUCT-195.20 (aesthetic) | `cadSurfaceContractTypes.ts` | `cadTypes.ts` ≤ ~1310 |
| Whole-src TYPE hygiene (separate issues) | 7 non-CAD residual SCCs (project-workflow, adjustment, GNSS, importers, numerical, preanalysis) with per-domain owners + 1 CAD-adjacent surveyCad UI-session SCC (`useSurveyCadCommandPreview` ↔ `useSurveyCadCommandTypes` ↔ `useSurveyCadCurveF1Session`) | per-domain SCC 0 with owner sign-off; CAD-adjacent session SCC broken or explicitly accepted |

## 5. CONTROLLER RECOMMENDATION (unequivocal): **#195 ready to CLOSE**

The defect #195 names is the **engine/cad type hub** — its graphs are clean: VALUE **0/0**, TYPE **0/0** over `src/engine/cad` + `src/engine/fieldToFinish` (483 nodes/2400 edges, SHA `0bc9bae1…`), both named value cycles one-way-broken (full-`src` BFS confirmed), core type loop dissolved, `CadCommandKey` byte-identical to pre-#195, all 14 phases merged with 5/5 exact-head CI.

**Weighed caveats (do not block closure):** literal "135" non-comparable (honest baseline: 5/58 → 0/0); whole-`src` TYPE still 8 SCC/41 nodes — 7 in non-CAD domains plus **1 CAD-adjacent surveyCad UI-session SCC** (command preview/types + Curve-F1 session hook), all with zero files under `src/engine/cad/` — follow-on separate issues, not this hub; H/I cohesion recs partial but graph-irrelevant. The engine/cad hub defect #195 names is resolved; the CAD-adjacent session SCC is the one residual a CAD-surface reading of #195 could still claim, and the controller should either scope it as follow-on work or explicitly accept it when closing. Pi does not close #195; controller decides after independent PR review.
