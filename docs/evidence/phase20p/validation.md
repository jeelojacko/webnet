# Phase 20P validation — sparse/clustered collinear transition-set decision

- Branch: `research/phase20p-sparse-collinear-transition-set-decision`, baseline `797026215364da1ea90ffa2063b7cc3d0a4be38d` (PR #164 merge).
- Scope: **STUDY ONLY. Zero `src/` changes** (`git diff --stat -- src` empty, confirmed before and after every battery item).
- Stashes: **14 intact** at start and end (no stash touched; no clean-tree stash re-runs performed).
- Status: **uncommitted** (validation worker; nothing committed, nothing pushed).
- Date: 2026-10-04. Corpus SHA: `3ee1321e5bbbfdb9314048a4a462cbc210fd6ebab0e949c3aead9f4db0f12932`.

## 1. Suite battery (exact counts)

| Suite | Files | Tests | Result |
|---|---|---|---|
| 20P `cad_grading_transition_sparse_20p` | 1 | 30 passed (30) | PASS |
| 20N: `expansion_20n` 20 + `expansion_20n_multi` 29 + `review_fixes` 25 | 3 | 74 passed (74) | PASS |
| 20N.1 (7 files): authoring 10, group 9, multi 21, panel 5, plural 5, robust 39, separation 14 | 7 | 103 passed (103) | PASS |
| 20O: `planlaw_20o` 14 + `gates_20o` 29 | 2 | 43 passed (43) | PASS |
| 20M/20M.1/20M.2: `feasibility_20m` 12 + `policy_20m1` 14 + 20m2 editor 4, mesh 5, persist 8, policy 10, product 4, robust 7, topology 8, worker 9 (55) | 10 | 81 passed (81) | PASS |
| Full `cad_grading` glob | 111 | 1655 passed (1655) | PASS |

## 2. Static checks / build / audits

| Check | Result |
|---|---|
| `npm run typecheck` | clean, exit 0 |
| `npm run lint` | 0 errors, 2 warnings (both pre-existing, unrelated: `tests/evidence/phase10m_correction_stage_audit.test.ts:253`, `tests/gnssBaseline/gnssBaselinePerformance.test.ts:55` — unused eslint-disable directives) |
| `npm run build` | clean, ~10.2 s |
| `npm run check:portable-paths` | 5749 tracked paths, 0 violations |
| `npm audit` | 0 vulnerabilities |
| `npm audit --omit=dev` | 0 vulnerabilities |

## 3. Broad regression (`npm run test:agent`)

- **929 files: 926 passed, 3 failed. 8124 tests: 8120 passed, 3 failed, 1 skipped** (~54 s).
- The ONLY failures are the known pre-existing study-desktop trio (all `(real data)`):
  1. `study-desktop/tests/study_ai_unit_calibration.test.ts` — frozen calibration-80 (real data)
  2. `study-desktop/tests/study_ai_unit_calibration_v5.test.ts` — Cal80-v5 fail-closed: cal80-v4 sourcePackageId `"nb-sit-statute-corpus-2026-08-29"` ≠ expected `"nb-sit-statute-corpus-2026-09-11"` (external corpus package-ID drift)
  3. `study-desktop/tests/study_ai_unit_preflight.test.ts` — frozen canonical run preflight (real data), `result.ok` false
- Disjoint/pre-existing status (established WITHOUT stash re-runs, stashes untouched):
  - Zero `phase20p`/`sparseTransition`/`sparse-transition`/`transition_sparse` refs in all three failing files (grep counts 0/0/0).
  - The failing tests consume gitignored external real-data corpora (`.gitignore` study-content/ai corpus entries); no phase20p file participates.
  - Zero `src/` changes on this branch (`git diff --stat -- src` empty throughout).

## 4. Corpus double-regen

- `npx tsx scripts/phase20pCorpusRegen.ts` run **twice**; both runs print `73 rows sha256=3ee1321e…`; `sha256sum corpus.json` matches `corpus.sha256` (`3ee1321e…`) before, between, and after.
- Independent corpus audit (this run): 73 rows = **52 eligible positives + 21 negatives**. All 52 positives measure `topologyPreMeshEqualsMeasured: true`, gtop2 1/1, exact revalidation null, C0 residuals 0, per-joint worker agreement all-true, order-sensitive + stable revision. All 21 negatives reject at production codes (`TOUCHING_NOT_AUTHORIZED`, `OVERLAP_REJECTED`, `WIDTH_INVALID/INFEASIBLE`, `MEMBER_REF_STALE`, `NON_COLLINEAR`, `FAMILY_MISMATCH`, `GRADE_MISMATCH`, `NON_FLAT`, `JOINT_Z_STEP`, `NON_LINE`, `CLOSED`) or documented study codes (`ORDER_REJECTED`/`MALFORMED` for order gates, `NATIVE_CORNER_OWNED` for the deflected-skip declaration).

## 5. Adversarial self-review (10 items + dispositions)

1. **Gaps treated as automatic separation** — FOUND, already disclosed (`topology-worker-provenance.md` §7.1 + dedicated test pin `gaps >= 2 members cannot overlap…`): for gaps ≥ 2 members the station-gap check is non-binding under per-joint feasibility; only touch is reachable at the feasibility corner. Kept for correctness (consecutive reduction + authoring geometryError authority), delta must not overstate rejection power. No fix.
2. **Wrong S(j)** — checked: stations cumulative everywhere (`stationsOf`, `memberL.startStation + length`); `wideGap` pins station gap 105 vs immediate member 5. No fix.
3. **Reversal reindex errors** — logic verified: joints remap `n-2-j` + canonical re-sort, widths travel with physical joints, member ids + revision endpoint pairs reversed consistently. **REAL FINDING (doc-only):** `topology-worker-provenance.md` §6 claimed "no traversal-reversal fixture … not a measured claim", contradicting the green corpus row `sparse02-distance-reversal` + `sparse-set-geometry.md` §6 + decision criterion 9. **FIXED study-side:** §6 now scopes forward-only coverage to the vitest helper and cites the corpus reversal row. No `src/` impact.
4. **Silent sorting of intents** — checked: both builders reject duplicates/out-of-order/malformed (`MALFORMED`/`ORDER_REJECTED`), never sort persisted intents; `.sort()` calls touch only derived numeric station lists and the reversal canonical re-emission. `ggrev1` order-sensitivity pinned in test + all 52 corpus rows. No fix.
5. **Skipped joints gaining transition ownership** — checked: skipped joints carry no interval, no checkpoint, no leg, no citation (`mixed2` joint 2 pinned in legs + citations). No fix.
6. **Topology expectation circularity** — checked: 1/1/1 declared from structure before any mesh; `meshSparseGroup`/`meshAndCertifySparseGroup` throw on measured≠declared; wrong-budget-2 and tied-split controls refuse. No fix.
7. **Cluster-local success masking whole-set failure** — checked: any cluster-honesty gate reject fails the whole build; one inadmissible transition (`WIDTH_INFEASIBLE`), one tampered/stale/missing/reversed leg, and one forged provenance all fail the whole set; product Extract/Bake gates close. No fix.
8. **Positional provenance drift across gaps** — checked: plans/legs built from the same canonical transition order; reversed-legs swap fails closed; citations == intent count with skipped joints uncited; roundtrip preserves ids/order/width precision. No fix.
9. **Production math copied into study self-validating** — checked: study imports production authorities directly; only study-owned arithmetic is the station set + generalized gap, cross-checked by the consecutive-reduction identity (bit-for-bit vs `checkGroupTransitionSeparation`) and the `wideGap` immediate-vs-station gap pin; study-tiled checkpoints are independently accepted by production validators. No fix.
10. **Accidental NON_COLLINEAR/trp1 widening** — checked: `admitGradingTransition` called directly, untouched; deflection still `NON_COLLINEAR`, bad widths still `WIDTH_*`; `src/` diff empty. No fix.

## 6. Guards

- `git diff --stat -- src` — **empty** (verified at start, mid-battery, and end).
- `git stash list` — **14 entries, unchanged** (no stash created, dropped, or applied).
- Pre-existing uncommitted branch work (not this worker's): `TODO.md` 20P entry, `docs/evidence/phase20o/decision.md` planlaw 12→14 count fix. This worker adds `docs/evidence/phase20p/validation.md` (this file) and the §6 doc reconciliation above — all uncommitted.
- No battery item failed beyond the known pre-existing trio (§3); nothing papered over.
