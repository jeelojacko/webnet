# STRUCT-195.7 — Validation evidence (Workstream C: tests + evidence)

## Focused suite

File: `tests/cad_annotation_cogo_type_cycle_1957.test.ts` (**27 tests**
across **10** `describe` blocks; conventions follow
`tests/cad_grading_command_types_1956.test.ts` for shape pins and
`tests/cad_type_dependency_graph_1952.test.ts` for graph guards:
hand-transcribed `Base*` baseline pins compared against BOTH old-path and
leaf exports, per-type runtime AST property shapes, type-only pins,
graph back-edge checks, negative controls run transiently then restored).

Command run by Workstream C:

```sh
node scripts/runVitest.mjs run --config vitest.agent.config.ts \
  tests/cad_annotation_cogo_type_cycle_1957.test.ts
```

Result: **27/27 pass** — no integration-blocked remainder. The two Worker
A/B leaves were already present as worktree files when Workstream C
started, and the parent landed the `cadTypes.ts` hub splice mid-session
(verified: hub lines 1/11 now import from the leaves), so the suite went
from leaf-only green to fully green with no test change. (Had the splice
still been pending, the two hub assertions — 4-node SCC split and hub
repoint — would have stayed red while all 25 leaf-side assertions passed,
mirroring the 195.6 precedent; that contingency was not needed.)

## Shape / type parity

- All **17** moved types carry exhaustive pins: `Base*`
  hand-transcriptions (from `git show 517de78:…` baseline sources) checked
  bidirectionally against BOTH old-path and leaf exports (34
  `expectTypeOf` equalities), plus direct old-vs-leaf identity for all 17,
  plus a complete runtime AST field check for all 17 (13 interfaces as
  `name[?]: type` shapes, 3 anchor unions + the tool-key union as member
  texts) — no representative-subset sampling was needed.
- Discriminant/optional/nullability probes: 5 kind literals,
  `endpoint`/`point` unions, required `fallbackX/Y` (pinned as `number`,
  not `number | undefined`), `AnchorRef`-excludes-`fixed`,
  `BROKEN_REFERENCE` reason branch, COGO `(string & {})` escape hatch
  (any string assignable both ways, `number` rejected via
  `@ts-expect-error`), report/table shapes (`string[]` / `string[][]`,
  optional-vs-required collections).
- `CadCogoResult` composition: stays exported from `cadCogoTypes.ts`, is
  NOT re-declared in the leaf (AST-pinned), and its `report` / `warnings` /
  `provenance` / `alternatives` fields equal the leaf DTOs.
- `CadProject` compatibility: leaf anchors assign into
  `CadLeaderEntity['arrowAnchor']`, `CadDimensionEntity['anchors'][*]` and
  `defPoint1/2`; leaf computations assign into
  `CadProject['cogoComputations']` (compile-time + runtime probes).

## Emit fidelity (measured, not assumed)

Via `esbuild --format=esm` on baseline (`git show 517de78:…`) vs worktree
sources (scratch copies under `/tmp`, repo untouched):

- Both leaves emit **0 bytes** (pure type-only surface).
- Old-path modules emit **byte-identical** output baseline vs worktree
  (`cadAnnotationAnchors`: 2099 bytes both; `cadCogoTypes`: 996 bytes
  both; `diff` identical) — the worker splices and re-exports erase
  completely, so no runtime bundle change.

## Every validation command + result (run by Workstream C)

| Command | Result |
|---|---|
| `node scripts/runVitest.mjs run --config vitest.agent.config.ts tests/cad_annotation_cogo_type_cycle_1957.test.ts` | **27/27 pass** (7.6 s) |
| `npx tsc --noEmit` | **exit 0**, no errors (enforces all 50+ `expectTypeOf` equalities + probes) |
| `npx eslint tests/cad_annotation_cogo_type_cycle_1957.test.ts` | **exit 0** |
| BEFORE graph (`loadSourcesFromGit('517de78…')`, cad + fieldToFinish) | 473 nodes / 2373 edges (value 1330, type 794, mixed 249) / unresolved 94 / value SCC 4·largest 7 / type SCC 7·largest 5 |
| AFTER graph (worktree, same scope) | 475 nodes / 2380 edges (value 1330, type 801, mixed 249) / unresolved 94 / value SCC 4·largest 7 same members / type SCC 6·largest 5; type churn exactly +9/−2 edges, value pair-delta empty |
| esbuild emit check (leaves + old-path modules) | leaves 0 bytes; old-path emit byte-identical vs baseline (see above) |

AFTER figures were measured with leaves + worker splices + hub splice all
landed — nothing marked PENDING, nothing fabricated. (An early worktree
read, before the parent splice landed, confirmed the leaves-present /
hub-pending intermediate; the final numbers above supersede it.)

## Negative controls (transient, restored byte-identical, sha-confirmed)

Both mutations were applied to the Workstream C test file only (no `src/`
contact, per the no-touch scope), re-run, then restored from a backup and
verified with `sha256sum` + `diff` byte-identical
(`938ab7ae…d976c62d` before, during-restore, and after):

1. Anchor property mutation: narrowed the transcribed
   `CadAnnotationLineEndpointAnchor` shape
   `"endpoint: 'start' | 'end'"` → `"endpoint: 'start'"` → suite failed
   **1 failed / 26 passed**, failing test exactly
   “matches the transcribed runtime property shapes for every anchor
   type”. Proves the AST pin catches union-member drift with no typecheck
   gate (the `Base*` transcription was untouched, so `tsc` would still pass
   — the runtime guard is what fires).
2. Graph-guard mutation: flipped the SCC assertion `.toBe(false)` →
   `.toBe(true)` → suite failed **1 failed / 26 passed**, failing test
   exactly “splits the exact 4-node TYPE SCC”. Proves the guard evaluates
   the split rather than passing vacuously.
3. Supplementary (no file contact, `node -e` in-memory only):
   reintroducing the two severed hub→old type edges into the worktree graph
   re-forms the exact 4-node SCC (`true`), confirming the committed guard
   is sensitive to the severed edges themselves.

## Honest pending items (NOT measured in this workstream)

- Neighbouring suites / `test:agent` / `build` / `check:portable-paths`:
  not run — Workstream C owns 3 files only and opens no PR; exact-head CI
  is authoritative. The change surface is types-only with byte-identical
  runtime emit (proven above), so blast radius is nil by construction.
- No Playwright run (types-only scope, nothing renderable changed).
- Commit: explicitly NOT done — the parent owns commit/PR on this branch.

## Workstream C file inventory

Owned files only — no other file touched (verified: `git status` shows no
Workstream C change outside these three; `src/` edits present are Workers
A/B + parent owned):

- `tests/cad_annotation_cogo_type_cycle_1957.test.ts` (new, 27 tests)
- `docs/evidence/struct-1957/architecture.md` (new)
- `docs/evidence/struct-1957/validation.md` (this file, new)
