# Phase 20O — validation record (docs phase 2 + full validation)

- Branch: `research/phase20o-noncollinear-transition-plan-law`, baseline `d093faf8`.
- Scope discipline: STUDY ONLY — `git diff --stat -- src` empty at sign-off (§8).
- Corpus: `docs/evidence/phase20o/corpus.json`, 736 rows (720 grid + 16
  adversarial), sha256 `9685974d4194bd1cb2d4aaadd91a4d1a4a3bd3125603ee42e08b45353d7422c0`.

## 1. Phase 20O study tests (this phase, run by author)

| Suite | Result |
|---|---|
| `tests/cad_grading_transition_planlaw_20o.test.ts` (14 tests: trp1 gate pins, scalar C0 + midpoint, endpoint C0, material divergence, mid-interval kink, interior inversion, endpoint-tangent attribution, exact-0 routing, antiparallel boundary, adversarial table, width bounds, determinism+SHA, identities, no-src-change guard) | 14/14 pass |
| `tests/cad_grading_transition_gates_20o.test.ts` (29 tests: exact gate + signed zeros, authoring mirror, group diagnostic, adversarial table, topology negative controls, worker-basis gap) | 29/29 pass |
| Combined run | 2 files, 43/43 pass |

## 2. Corpus regen determinism (run by author, twice + sha256 compare)

| Run | Output |
|---|---|
| `npx tsx scripts/phase20oCorpusRegen.ts` (1st) | 736 rows, sha256 `9685974d…37422c0` |
| `sha256sum corpus.json` vs `corpus.sha256` | match (`sha256sum -c` format) |
| `npx tsx scripts/phase20oCorpusRegen.ts` (2nd) | 736 rows, identical sha — byte-identical across processes |

## 3. Prior-phase suites (re-run by author, all green)

| Suite | Result |
|---|---|
| 20N study: `cad_grading_transition_expansion_20n` | 20/20 pass |
| 20N study: `cad_grading_transition_expansion_20n_multi` | 29/29 pass |
| 20M study: `cad_grading_transition_feasibility_20m` | 12/12 pass |
| 20M.1 study: `cad_grading_transition_policy_20m1` | 14/14 pass |
| 20M.2 production (8 suites: policy/mesh/product/persist/topology/worker/robust/editor) | 55/55 pass |
| 20N.1 production (7 files: group/multi/plural/authoring/robust/separation/panel) | 103/103 pass |
| Full `tests/cad_grading*` | 110 files, 1623/1623 pass |

## 4. Static / build / hygiene gates (run by author)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean, exit 0 |
| `npx eslint` on study scripts + 20O tests (md files have no eslint config — N/A) | 0 errors, exit 0 |
| `npm run build` | clean, 10.15 s (chunk-size warning only, pre-existing) |
| `npm run check:portable-paths` | 5736 tracked paths, 0 violations |
| `npm audit` / `npm audit --omit=dev` | 0 vulnerabilities / 0 vulnerabilities |

## 5. `npm run test:agent` (run by author)

- 925 files pass, 8088 tests pass, 1 skipped; **3 failed** — all three in
  `study-desktop/tests/` real-data calibration:
  `study_ai_unit_calibration.test.ts`, `study_ai_unit_calibration_v5.test.ts`,
  `study_ai_unit_preflight.test.ts`.
- Pre-existing proof (no stash touched, stash count 14 before and after):
  (a) the identical trio is recorded in TODO as stash-proven on a clean tree
  across 20N.1 waves E/J/L/N, with the v5 failure citing external corpus
  package-ID drift; (b) none of the three failing files references
  `phase20o`/`20o` (grep exit 1 — disjoint); they consume gitignored local
  real-data corpus; (c) this branch carries zero `src/` changes (§8), so no
  production or shared-test path the trio depends on was modified. No
  re-run on a stash-clean tree was needed.

## 6. Not run (out of scope for a study-only phase)

- `npm run test:wasm` / `wasm:build` / `cpp:test` — no engine/worker/C++
  changes. `npm run parity:industry-reference` — no numerical/production
  change. `npm run test:evidence` / `test:full` — manual-only / literal-
  everything, not a routine gate per repo policy.

## 7. Docs authored (this phase)

`forensics.md`, `candidate-laws.md` (phase 1, pre-existing in tree);
`geometry-results.md`, `topology-worker-provenance.md`, `decision.md`
(verdict POLICY_REQUIRED_NONCOLLINEAR_PLAN_LAW), `production-delta.md`,
`validation.md` (this file). All numbers from corpus/tests; no invention —
the corpus carries no daylight-area field, so §1 of `geometry-results.md`
reports same-station separation and cites 20N areas as context only.

## 8. Scope confirmations

- Independent review fix round (orchestrator self-review; Codex reviewer
  rate-limited, user-authorized fallback): 8 findings — `reverseJoint`
  deflection sign, interior-only `normalFlip`, new `midKinkDeg` metric,
  C1-attribution corrections (endpoint residuals mix blend slope with
  deflection), Hermite-90° inversion + 0.42→0.53 + 0.83→0.66 number fixes,
  scalar-midpoint pin, native-overlap non-metering disclosure. Corpus
  regenerated twice byte-identical under the new SHA above; 20O tests
  re-run green (14/14 + 29/29).

- `git diff --stat -- src` → empty (zero production changes).
- `git stash list` → 14 entries, untouched (no stash created, popped, or dropped).
- Changed under scope: `docs/evidence/phase20o/*` (5 new docs this phase),
  `TODO.md` Phase 20O entry only. Pre-existing untracked study files
  (scripts/test .ts) unmodified by this phase.
