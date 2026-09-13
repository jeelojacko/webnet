# Phase 12H.0 — static-GNSS multifile composition audit (EVIDENCE ONLY)

Branch `feat/static-gnss-multifile-architecture`, baseline `ae030912` (origin/main PR #46 merge).
Status: **production multi-file GNSS is NOT enabled. No math, tolerance, R2B-eligibility,
solver, worker-routing, or file-format changes.** All composition logic lives in the
test-local helper inside `tests/gnssBaseline/gnssMultifileComposition.test.ts` (9/9 pass,
~300 ms); zero `src/` production edits.

## 1. Existing project architecture: reusable vs gaps

Reusable as-is for a future multifile GNSS feature:

- Manifest model `ProjectManifestFileEntry` (`id/name/path/enabled/order`,
  `src/engine/projectWorkspaceTypes.ts:31-42`).
- Deterministic ordering `sortProjectFiles` (`projectWorkspace.ts:33-39`),
  checked-file selection `getCheckedProjectFiles` (`:137-139`),
  run-file assembly `buildProjectRunFiles` (`:246-254`) returning
  `{fileId, name, order, content}` in manifest order.
- File-boundary reset in the terrestrial parser
  (`parseInputLineProcessor.ts:101-120`: direction sets flushed, occupy/backsight/dir-set
  state cleared, parser defaults restored per `project-file-enter`).
- Accumulation seam (`parseInputCore.ts:61-66`) and per-line `sourceFile` diagnostics
  (`parseIncludes.ts:4-23`).

Gaps (GNSS-specific, none implemented):

1. GNSS workspace is single-session only (`docs/gnss/STATIC_GNSS_WORKFLOW.md`;
  session helpers in `src/engine/gnssWorkspaceSession.ts`); it is not in project
  save/load, has no manifest entry, no `enabled/order` handling.
2. No per-file GNSS parse boundary: terrestrial `project-file-enter` resets occupy/
  backsight state, but there is no equivalent "new GNSS source, keep stations, reset
  nothing solve-relevant" boundary — composition happens post-parse on canonical
  networks instead (see §2).
3. No cross-file conflict UX: terrestrial diagnostics carry `sourceFile`; GNSS has no
  composed-source error contract (sketch in §16).

## 2. Canonical source model + boundary

Composition unit is the independently-parsed canonical network
`GnssBaselineNetworkInput` (`src/engine/gnssBaselineNetworkImport.ts:76-83`:
stations + baselines + `frame :54-61` + diagnostics). Each source file (native BL text,
GVX via `src/engine/gnssGvxImport.ts`, CSV via `src/engine/gnssBaselineCsvImport.ts:194-445`)
is parsed alone through its existing importer (`canonicalizeRawNetwork :505-598`),
then merged post-parse. Nothing is concatenated at the text level: no cross-file
line interleaving, no shared parser state, no format sniffing across files.
Downstream (`runGnssBaselineAdjustment :226-572`, statistics `:189-348`, loops
`:56-240`, setup uncertainty `:217-286`) consumes the composed network unchanged.

## 3. Compatibility matrix (fail-closed)

All three frame attributes must match exactly; any mismatch blocks composition with
an error naming both sides. Unknown/empty epoch never equals a known epoch.

| dimension | same | different | missing vs present |
| --- | --- | --- | --- |
| `referenceFrame` (e.g. ITRF2020@2020.0 vs NAD83(2011)) | merge | BLOCK | BLOCK |
| `epoch` (e.g. 2020.0 vs 2010.0) | merge | BLOCK | BLOCK |
| `ellipsoid` (e.g. GRS80) | merge | BLOCK | BLOCK |

Evidenced by the `frame/epoch fail-closed` test (referenceFrame, epoch, and
unknown-epoch-vs-known rejections). No transforms, no re-epoching, no silent defaulting.

## 4. Station merge rules A-F (evidenced)

Merge key is the exact station ID string (case-sensitive; see rule F).

- **A — identical:** same ID, same coords (bit-identical), same flags → merged silently,
  no note.
- **B — rounding:** same ID, coord diff in `(0, 1e-9]` m → merged, first-seen coords kept,
  `mergeNotes` records `rounding diff accepted for '<id>' diff=<worst>`.
- **C — material conflict:** same ID, coord diff `> 1e-9` m → composition BLOCKS with
  `material station conflict '<id>'`.
- **D — fixed+free:** same ID/coords, one side FIXED → merged as FIXED with a
  `fixed+free => fixed for '<id>' from <source>` provenance note.
- **E — fixed/fixed conflict:** both FIXED with materially different coords → BLOCKS
  (same conflict error; control never silently moved).
- **F — alias IDs:** `'A'` vs `'a'` are distinct stations (no case folding, no alias table).

## 5. A-priori reconciliation (1e-9 m contract, no averaging)

First-seen coordinates win. Sub-tolerance diffs (`≤1e-9` m) are accepted and documented,
never averaged: averaging would fabricate an a-priori position present in no source
file and would break bit-reproducibility against single-file runs. Above tolerance the
merge fails closed (§4C/E). The tolerance is a fixed constant (`ROUND_TOL_M = 1e-9`),
not configurable per merge.

## 6. Control merge

| side 1 | side 2 | result |
| --- | --- | --- |
| FREE | FREE | FREE |
| FIXED | FREE (either order) | FIXED + provenance note |
| FIXED | FIXED, same coords | FIXED |
| FIXED | FIXED, conflicting coords | BLOCK |

Evidenced by the control-merge matrix test plus case D of the composition test
(control station lives with baselines in one source, remaining baselines elsewhere —
composed network identical to the whole-file parse). Control is therefore never
diluted by composition: a station fixed in any source is fixed in the composed network.

## 7. Component datum after composition

Unchanged semantics: each connected component still requires its own datum
(one fixed 3D station) at solve time via the existing preflight. Composition does not
invent datum — merging a free-only component with a fixed component adopts the fixed
control (§6); merging two free-only components yields a larger free-only component
that still fails the datum preflight exactly as a single file would. Disjoint
components from different files behave as disjoint components within one file.
No cross-component constraints are synthesized.

## 8. Baseline identity + duplicate policy + reversed handling

- Every parsed baseline is an independent logical observation: repeats are preserved
  (2× A→B in different sessions → `logicalObservations == 2`, both adjusted).
- Duplicate policy: **LEGITIMATE** (distinct sessions/IDs, e.g. reobserved vector) →
  keep both; **POSSIBLE** (same endpoints, same session, near-identical vector) →
  keep both, flag for operator review; **PROVEN** (bit-identical same-endpoint same-session
  repeat, i.e. the same record ingested twice) → keep both in the evidence helper
  (never auto-delete at the math layer); a production implementation should surface
  PROVEN duplicates as a precomposition warning with source IDs rather than silently
  dropping data.
- Reversed geometry (B→A with negated vector) is a flag candidate only: the helper
  demonstrates the detection predicate (endpoint swap + vector negation within 1e-9)
  and keeps the record. No auto-deletion, no auto-flipping — orientation changes alter
  covariance bookkeeping and must stay operator-visible.
- Session IDs survive composition end to end (`['S1','S2']` preserved).

## 9. Provenance model

Per-baseline record appended at merge time, in merge order:
`{sourceId, fileName, format, originalId, index}`. Verified: 2-file split yields
`['p1','p1','p1','p2','p2','p2']` with `format == 'native'` throughout. Station-level
provenance is via `mergeNotes` (rounding diffs, fixed+free upgrades naming the
contributing source). Provenance is append-only and survives solving, loop closure,
and reporting (loop-member → source mapping verified in §13).

## 10. Source-local warnings

Each source is parsed independently, so its diagnostics (units, datum notes, covariance
repairs/failures, CSV/ENU rotation notes) stay attached to that source file. The merge
itself only adds notes; it never suppresses, rewrites, or aggregates source warnings.
A production implementation must keep the warnings namespaced per `sourceId` so an
operator can tell which file produced which diagnostic.

## 11. Setup-uncertainty run-level scope

Setup uncertainty (`src/engine/gnssBaselineSetupUncertainty.ts`) is a network-level
stochastic model applied at solve time (`C_eff = C_raw + C_from + C_to`), not a
per-file parse attribute. Composed networks therefore take one setup-uncertainty
specification for the whole run; per-file setup sigmas are out of scope and would be
a category error (the same physical setup can span files). No change needed to the
module for composition.

## 12. Frame metadata merge (no first-file-wins)

Because §3 requires exact agreement on all three frame attributes, there is nothing
to reconcile and no file wins by position: the composed frame equals every source
frame. A production implementation must still render the agreed frame explicitly in
the precomposition summary (§15) rather than inheriting it silently, so a later
file-order change cannot alter metadata interpretation.

## 13. Cross-source loops / redundancy / control / components (evidenced)

Tree (A→B, B→C) + closing baseline (A→C) from a second source: 0 loops → 1 loop,
`solved.dof > 0`, redundancy trace `> 0`, and the loop's member set spans both
source IDs (`tree` + `close`). Cross-file closures therefore behave exactly like
same-file closures in loop detection, redundancy accumulation, and statistics —
the solver cannot distinguish composed from single-file input, which is the point.

## 14. Manifest-order invariance (numeric proof)

Two-file composition solved in both orders (`[f1,f2]` vs `[f2,f1]`): adjusted station
snapshots identical, `varianceFactor` equal to 12 decimal places, residual sets equal
as sorted snapshots. Ordering affects only baseline row order (provenance), never
numerics — least-squares normal equations commute. (Residual row order may follow
input order; canonical sorted comparison is the equality criterion.)

## 15. Enable/disable semantics (evidenced)

Dropping a source removes exactly its contribution: 4-baseline/2-file composition
minus file 2 → 2 baselines, stations `Z` and `D` gone, baseline delta exactly 2.
No stale stations, no stale control, no ghost provenance. Re-enabling restores the
full composition bit-identically (same inputs → same merge).

## 16. Synthetic split parity results

Whole-file vs 2-chunk vs 5-chunk (one baseline per file) vs control-clean splits of a
6-baseline/4-station network compose to identical canonical problems
(station + baseline snapshots equal) and identical outputs: `varianceFactor` and
`weightedResidualSum` to 12 dp, equal `dof`, equal loop counts, byte-identical text
reports, and `toEqual` on stations, residuals, and statistics. 9/9 tests pass in
~300 ms total.

## 17. Dataset A/B split evidence status: GAP DOCUMENTED, no test added

- **What exists:** Dataset A (16 stations / 91 vectors / 45 params / dof 228; SEUW pins
  2.100053/1.297104/1.988831/1.102511) and Dataset B (8 stations / 50 vectors / 21 params
  / dof 129; SEUW pin 1.965038) are exercised only as single-network intakes loaded from
  vendor-local directories (`scripts/gnss/gnssNativeArchitectureAudit.ts:805-811`:
  `~/Downloads/webnet-gnss-12e/tbc-intake/...`), reported in
  `reports/gnss/phase12f3-datasets.md` and `reports/gnss/phase12f2-datasetb.md` (numbers
  only, no vendor content).
- **Why deferred:** no canonical Dataset A/B vectors, BL exports, or GVX/CSV pairs are
  committed to the repo (`git ls-files` shows only small synthetic fixtures under
  `tests/gnssBaseline/fixtures/` — triangle/single-baseline; `manual/` is gitignored).
  Vendor files are local-only by policy and must never be committed.
- **Consequence:** per the mission evidence-only constraint (committed fixtures only,
  no `tests/evidence/` campaigns, no vendor commits), the Dataset A/B odd/even split
  test is **deferred to manual evidence**: split the vendor intake into two committed-?
  no — into two local-only chunk files, parse each through the existing importer,
  compose with the §4–§6 rules, and assert SEUW/coords match the pins above. The
  synthetic split parity in §16 covers the mechanism; the dataset split would cover
  scale (91/50 vectors) and commercial representativeness.
- No test was added for this section; total added test runtime is 0 ms (existing
  9-test file runs in ~300 ms).

## 18. R2B on composed network

No impediment by construction: R2B eligibility (`deriveGnssNativeR2BEligibility`,
`src/workers/gnssBaselineNativeR2BRoute.ts:151-241`) inspects only the final
`{stations, baselines}` problem (param/block/nnz bounds, bridge topology), never
ingest history. A composed network that passes eligibility is indistinguishable from
an equivalent single-file network at the route boundary, including provenance
(`native-sparse-selected-qxx`) and the clean-TS fallback matrix. Recommendation: admit
composed networks through the unchanged gate; do not add a composition-specific
bypass or penalty. (Not executed here — architecture assessment only, no WASM runs.)

## 19. Project serialization + portability design (not implemented)

- Persist each GNSS source as one manifest file entry (existing `id/name/path/enabled/
  order`), reusing `sortProjectFiles`/`getCheckedProjectFiles`/`buildProjectRunFiles`.
- Parse each entry independently at load; compose in memory; never persist the composed
  network (recompute deterministically, §21).
- Portability: entries reference portable content (embedded text or relative paths);
  absolute vendor paths (`~/Downloads/...`) must never be serialized — the Dataset A/B
  intake paths in §17 are the anti-pattern to exclude at the save boundary.
- `enabled=false` excludes the source from composition (§15); `order` controls merge
  order only (numerically irrelevant per §14, provenance-visible).

## 20. UI reuse recommendation

Reuse the terrestrial project-files pattern: file list with enable checkboxes +
ordering, per-file parse status, and a precomposition summary before solve:

- sources with format + baseline/station counts,
- agreed frame/epoch/ellipsoid (explicit, §12),
- control roll-up (which stations are fixed and from which source),
- conflict list (station conflicts, PROVEN/POSSIBLE duplicates) blocking solve until resolved,
- per-baseline provenance column in listings (source file + original ID).

GNSS workspace (`GnssWorkspacePanel` et al.) stays single-session; multifile becomes a
project-level workflow that feeds the existing results panel, not a workspace change.

## 21. Precomposition summary sketch (design)

```
sources: 2 (p1.dat: native, 3 BL / 4 stn; p2.dat: native, 3 BL / 4 stn)
frame: ITRF2020@2020.0 epoch 2020.0 ellipsoid GRS80 (all sources agree)
control: A FIXED (p1, p2 agree)
merge notes: none
conflicts: none — READY TO SOLVE
composed: 6 baselines, 4 stations, provenance retained per baseline
```

Conflict variant: `BLOCKED — material station conflict 'B' (p1 vs p2, diff=0.004 m);
deselect or fix a source. Both-file error shows both filenames, both coordinate
triples, and the diff — never one side alone.`

## 22. Conflict UX contract

Every blocking error names **both** files, both values, and the diff/locus:
frame/epoch/ellipsoid mismatches (both attribute strings), station conflicts (both
coordinate triples + diff in m), fixed/fixed control conflicts (both sources' control
claim). Non-blocking notes (rounding, fixed+free upgrades) list the contributing
source. No error may reference only one side of a two-file disagreement.

## 23. Performance numbers (measured, this branch)

`parse10x100=6ms merge1000=0ms total=6ms` (10 files × 100 baselines = 1000 composed;
console timing from the perf test, dev laptop). Composition is hash-map + append work,
roughly linear; parse dominates. Generous bound (< 5 s) passes with ~3 orders of
magnitude headroom. Dataset-scale (91/50 vectors) composition cost is negligible
relative to solving.

## 24. Determinism

Same enabled set + same contents → identical composed network (first-seen coords,
stable manifest order via `sortProjectFiles`, append-order provenance). Verified via
§14 reorder invariance and §16 whole-vs-splits byte-identical reports. No timestamps,
no random IDs, no hash-map iteration leaks into output (station snapshots sorted).

## 25. Free-network deferred

Composing an all-free network is mechanically fine (merge rules apply) but the result
still has no datum and fails the solve preflight. Datum strategy for free networks
(inner constraints / fixed-after-composition) is explicitly deferred — no design
proposed here beyond "same preflight as single-file".

## 26. Production recommendation: GO-MULTIFILE WITH-RESTRICTIONS

- **Verdict:** GO-MULTIFILE WITH-RESTRICTIONS (architecture sound, evidence green,
  but production work remains).
- **Rationale:** mechanism proven on synthetics (identical outputs across splits,
  fail-closed conflicts, order invariance, enable/disable cleanliness); downstream
  (solve/statistics/loops/R2B) needs no changes because it sees an ordinary canonical
  network; project-manifest reuse path is clear.
- **Restrictions before production:** (a) Dataset A/B manual split evidence at scale
  (§17); (b) implement §§9–10, 12, 15, 19–22 (provenance store, namespaced warnings,
  explicit frame render, manifest wiring, summary + conflict UX, no-absolute-path
  save gate); (c) free-network datum decision (§25); (d) PROVEN-duplicate warning
  surface (§8). None of these touch math, tolerances, or R2B eligibility.

## 27. Acceptance A-S status

| ID | criterion | status |
| --- | --- | --- |
| A | project architecture recon (reusable vs gaps) | PASS — §1 |
| B | canonical source model + boundary | PASS — §2 |
| C | compatibility matrix fail-closed | PASS — §3 + test |
| D | station merge rules A-F | PASS — §4 + test |
| E | a-priori 1e-9 m contract, no averaging | PASS — §5 + test |
| F | control merge matrix | PASS — §6 + test |
| G | component datum after composition | PASS — §7 (analysis; inherits preflight) |
| H | baseline identity + duplicate policy + reversed | PASS — §8 + test |
| I | provenance model | PASS — §9 + test |
| J | source-local warnings preserved | PASS — §10 (design; no suppression path exists) |
| K | setup-uncertainty run-level scope | PASS — §11 (no change required) |
| L | frame metadata merge, no first-file-wins | PASS — §12 + test |
| M | manifest-order invariance, numeric proof | PASS — §14 + test (12 dp + sorted equality) |
| N | enable/disable semantics | PASS — §15 + test |
| O | synthetic split parity (identical outputs) | PASS — §16 (9/9, byte-identical reports) |
| P | Dataset A/B split evidence | DEFERRED — §17 (gap documented, manual evidence specified; no vendor commit permitted) |
| Q | cross-source loops/redundancy/control/components | PASS — §13 + test |
| R | R2B on composed network | PASS — §18 (assessment; unchanged gate, no run this phase) |
| S | recommendation + serialization/portability/UI | PASS — §§19–20, 26 (WITH-RESTRICTIONS) |

18/19 PASS, 1 DEFERRED (P — blocked by vendor-local-only data policy, not by engineering).
Production multi-file GNSS NOT enabled. No math changed.
