# Phase 20P.1 — Validation

- Branch: `feat/phase20p1-sparse-collinear-transitions`, baseline main
  `f786f76ba21818d863dc39a6c35f70697968c70e` (PR #165 merge).
- Implementation diff (`git diff --stat -- src/`, 7 files):
  `gradingTransitionPolicy.ts`, `gradingTopologyExpectation.ts`,
  `gradingGroupTransitionPlural.ts`, `gradingTransitionAuthoring.ts`,
  `surfaceGradingService.ts`, `surfaceGradingCompute.ts`,
  `CadGradingGroupTransitionPanel.tsx`.
- 14 stashes intact throughout (never popped/dropped/applied/cleared).

## Static checks / build / audits

| Command | Result |
| --- | --- |
| `npm run typecheck` (`tsc --noEmit`) | clean, exit 0 |
| `npm run lint` (`eslint .`) | 0 errors, 2 pre-existing warnings |
| `npm run build` | clean, 9.85 s |
| `npm run check:portable-paths` | 5761 tracked paths, 0 violations |
| `npm audit` | 0 vulnerabilities |
| `npm audit --omit=dev` | 0 vulnerabilities |

The two lint warnings are pre-existing and unrelated
(`tests/evidence/phase10m_correction_stage_audit.test.ts:253`,
`tests/gnssBaseline/gnssBaselinePerformance.test.ts:55` — unused
eslint-disable directives).

## Focused suites

| Suite | Result |
| --- | --- |
| 20P.1 production `cad_grading_transition_sparse_20p1` (new, 44) | 44/44 PASS |
| 20P study `cad_grading_transition_sparse_20p` (30; 2 controls relabeled `20P.1 LANDED`) | 30/30 PASS |
| 20N.1 (8 files: group/multi/robust/separation/plural/panel/authoring/review_fixes) | 137/137 PASS |
| 20N study (expansion 20 + multi 29) | 49/49 PASS |
| 20O study (planlaw 14 + gates 29) | 43/43 PASS |
| 20M feasibility + 20M.1 policy | 26/26 PASS |
| 20M.2 (8 transition suites) | 55/55 PASS |
| Full `tests/cad_grading*` glob | 112 files / 1708 tests PASS |
| `test:wasm` | 12 files / 74 tests PASS |
| `parity:industry-reference` | 25/25 PASS |

## Broad regression (`npm run test:agent`)

930 files: 927 passed, 3 failed. 8177 tests: 8173 passed, 3 failed,
1 skipped. The ONLY failures are the known pre-existing study-desktop
real-data trio (`study_ai_unit_calibration`, `study_ai_unit_calibration_v5`,
`study_ai_unit_preflight`) — disjoint by construction (zero
`phase20p`/`sparseTransition`/`sparse-transition`/`transition_sparse` refs
in all three files; they consume gitignored external real-data corpora;
established without touching stashes).

## Browser QA

`tests-browser/cad-grading-transition-20p1.spec.ts` 10/10 green, 0
page/console errors (11 flows: sparse CURRENT, edit-keeps-neighbor,
mixed cluster, clear-one, save/reload, Extract/Bake gating+citations,
exact-touch / too-wide / overlap refusal, bent joint NON_COLLINEAR,
no auto-insert, malformed-order fail-closed). Evidence: 11 PNGs +
`geometry.json` under `docs/evidence/phase20p1/`. Full record:
`browser-qa.md`. Note: one service-side stations-hoist edit (one pass
shared across intents, behavior-identical addition order) landed after
the QA run; focused service/worker suites re-verified green after it.

## Adversarial review (14 challenges, orchestrator self-review)

Codex `reviewer` was unavailable (usage limit, two attempts 60 s apart).
The orchestrator reviewed the exact diff against all 14 challenges
directly. Result: 13/14 clean as implemented; ONE real finding —
`planSingleTransitionIntent` recomputed the full stations array per
intent (O(T·M) repeated prefix sums, challenge 13). Fixed by hoisting
one `computeJointStations` pass into `planGroupTransitionRequest` and
threading it through an optional param (behavior-identical addition
order); typecheck clean, focused suites 58/58 green after the fix.
No hidden sort/repair, no immediate-member gap left, no order drift,
no consecutive/singular/no-transition drift, no tiler mismatch, no
skipped-joint artifacts, no shared-member assumption left, no topology
circularity, no provenance drift, no reversal error, no trp1 /
NON_COLLINEAR / tolerance change, no schema migration, no Candidate B
expansion. Verdict: APPROVE (self-reviewed; external review pending
via PR).
