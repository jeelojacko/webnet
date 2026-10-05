# B0 validation record

All checks below were run on `research/cad-circle-representation-decision`,
baseline `50a5c720`. Study/docs/TODO only — `src/` untouched. This is the
review-fix round record; the previous round's worktree premise is corrected in
§4.

## 1. Verified numbers

| claim | command | result |
|---|---|---|
| corpus sha256 | `cd docs/evidence/cad-circle-representation && sha256sum -c corpus.json.sha256` | `OK`; `sha256sum corpus.json` = `5cbb97b06606e8f5c1a91c5a4b7551afaf10b8f8a132034a13e6c35eed22806f` |
| study tests 29/29 (B0 baseline 28/28 + 1 CD-vs-2P regression) | `npx vitest run tests/cad_circle_study_execution.test.ts tests/cad_circle_study_robust_snap.test.ts tests/cad_circle_study_sweep_b1b2b3.test.ts` | `Test Files 3 passed (3)`, `Tests 29 passed (29)` |
| `switch (entity.type)` sites | `grep -rn "switch (entity.type)" src/ \| wc -l` | `26` |
| files with `case 'arc'` | `grep -rln "case 'arc'" src/ \| wc -l` | `33` |
| `case 'arc'` in engine | `grep -rln "case 'arc'" src/engine/cad \| wc -l` | `27` |
| fillet consumer files | `grep -rli fillet src/engine/cad --include='*.ts' \| wc -l` | `11` |
| trim / reverse / offset (engine scope) | `grep -rli {trim,reverse,offset} src/engine/cad --include='*.ts' \| wc -l` | `72 / 29 / 93` |
| no model circles | `grep -rn "model\.circles" src/` | empty |
| paper-space CIRCLE only | `grep -rn "'CIRCLE'" src/engine/cad/dxf/` | only `dxfLayoutExport.ts:220` |
| src untouched | `git diff --stat -- src` | empty |

The switch/file counts are **inventories of candidate consumers, untested —
not defect counts**. The corpus's per-file estimates for trim/reverse/offset
(63/24/61) use a narrower pattern than the engine-scope grep above; the
conclusion is unchanged. Every number quoted in the eight docs traces to one
of these commands or to a `corpus.json` field.

## 2. Source of the study values

- `corpus.json` is produced by `scripts/cadCircleCorpusRegen.ts` from
  `runSweepStudy` + `runAdapterControl` + `runModesStudy` +
  `runExecutionStudy`. It is a pure function of fixed inputs (sorted keys,
  6 dp, no timestamps). The `forensics` block carries
  `representationVerdict` / `b1FullSweepArcAssessment` /
  `aFirstClassCircleAssessment`, all verdict-aligned with `decision.md`.
- The corpus is **not** an independent oracle; byte-identity on regen proves
  determinism, not correctness. The independent checks are the kernel
  behaviors re-derived from `src/` in `forensics.md` §4–§7 and the pinned test
  suites.
- `tests/cad_circle_study_*.test.ts` import the current kernels unmodified;
  they pin B1/B2/B3 sweeps, snap semantics mapping, robustness, adapter, modes,
  and the executed review-fix findings (block expansion 0/360→0/0,
  non-uniform block scale 50→75, emitted-vs-observable snap/grip leakage,
  `arcPath`, DXF bytes).
- **Executed vs unexecuted.** Executed: block expansion, non-uniform block
  scale, entity/block snap + grip emission, `arcPathFromPrimitive`, DXF
  serialization bytes. Unexecuted (labelled as such in the docs): external DXF
  host import/normalization, command-level endpoint ops on `start==end`,
  annotation/dimension anchor association.

## 3. Commands run for this phase

```
sha256sum -c docs/evidence/cad-circle-representation/corpus.json.sha256
npx vitest run tests/cad_circle_study_execution.test.ts \
  tests/cad_circle_study_robust_snap.test.ts \
  tests/cad_circle_study_sweep_b1b2b3.test.ts
grep -rn "switch (entity.type)" src/ | wc -l
grep -rln "case 'arc'" src/ | wc -l
grep -rn "model\.circles" src/
grep -rli fillet src/engine/cad --include='*.ts' | wc -l
grep -rli {trim,reverse,offset} src/engine/cad --include='*.ts' | wc -l
git diff --stat -- src
```

## 4. Worktree state (corrected)

This phase created **new untracked files**: 5 study scripts
(`scripts/cadCircle{StudySweep,StudyAdapter,StudyModes,StudyExecution,CorpusRegen}.ts`),
3 study suites
(`tests/cad_circle_study_{execution,robust_snap,sweep_b1b2b3}.test.ts`), and
the 8 docs + `corpus.json` + `corpus.json.sha256` under
`docs/evidence/cad-circle-representation/`. No `src/` file and no
**pre-existing** `scripts/` or `tests/` file was created or modified by this
phase; the earlier round's premise that "scripts/tests were only read" is
withdrawn.

## 5. Executed in the correction pass (2026-10-05)

- Study suites 28/28 (3 files, commands in §3).
- `npm run typecheck` (`tsc --noEmit`): clean.
- `eslint` on the 5 study scripts + 3 study suites: clean (0 errors).
- `sha256sum -c corpus.json.sha256`: OK (`5cbb97b06606e8f5c1a91c5a4b7551afaf10b8f8a132034a13e6c35eed22806f…`).
- Switch/DXF/Mlightcad/legacy searches above: executed, outputs quoted.
- NOT run locally: `test:agent`, `build`, `parity:industry-reference`,
  `test:wasm` — this phase adds no `src/` and no production test, so
  production output is byte-identical; exact-head CI (#1038, recorded below)
  is the gate for those suites.
- No external DXF import: host normalization stays a recorded prediction.

## 6. Guardrails

- `git diff --stat -- src` is empty.
- Only `TODO.md` and the eight docs under
  `docs/evidence/cad-circle-representation/` are written by this phase; the
  study scripts/tests are new untracked evidence, not production code.
- Stash count remains **14**; no stash was created, applied, or dropped.
- `Circle` remains disabled.
- Verdict: `GO_FIRST_CLASS_CAD_CIRCLE_ENTITY` (correction pass
  2026-10-05; B1 full-sweep explicitly rejected).

## 7. Doc size check

Each of the eight docs is below 200 lines (see final report / `wc -l`). The
corpus `corpus.json` and its sha are preserved and cited by the docs.

## 8. B0.1 construction-semantics correction (2026-10-05)

- `fromCenterDiameter` now preserves the supplied center exactly
  (radius = diameter/2); `from2Point` is an independent midpoint/diameter
  implementation. Asymmetric regression: CD (10,20)+(40,20) → center
  (10,20) r15 vs 2P → center (25,20) r15.
- Corpus regenerated deterministically (byte-identical double regen),
  SHA `5cbb97b0…`, `sha256sum -c` OK.
- Study suites 29/29 (3 files); typecheck clean; eslint clean on touched
  files; `git diff -- src` empty; 14 stashes intact.

## 9. CI record

- CI #1038 (run 37350480353, head `cda24c5e`, pre-correction): classify
  PASS (16s), core PASS (8m31s), numerical PASS (2m26s). The correction
  pass changes only docs, study scripts/tests metadata strings, corpus
  verdict fields, and TODO — no `src/`, so production gates are
  unaffected.
- Post-correction run 37352355235 (head `0bc0c913`): classify PASS (15s),
  core PASS (9m0s), numerical PASS (2m21s). Exact-head CI green.
