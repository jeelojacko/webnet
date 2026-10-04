# Phase 20O decision — non-collinear transition plan/frame law

- Branch: `research/phase20o-noncollinear-transition-plan-law`, baseline `d093faf8` (PR #163 merge).
- Method: study-only. Zero `src/` changes (`git diff --stat -- src` empty, test-pinned).
- Inputs: `forensics.md` (production authority inventory), `candidate-laws.md`
  (three legislated-form laws), `geometry-results.md` (evidence grid),
  `topology-worker-provenance.md` (certificate/worker/provenance study),
  study `scripts/phase20oNoncollinearPlanLawStudy.ts`, corpus
  `docs/evidence/phase20o/corpus.json` (736 rows, sha256 `9685974d…`),
  `tests/cad_grading_transition_planlaw_20o.test.ts` (12),
  `tests/cad_grading_transition_gates_20o.test.ts` (29).
- Prior verdict context: `docs/evidence/phase20n/decision.md` (PARTIAL_GO
  Candidate A only; POLICY_REQUIRED Candidate B) and
  `docs/evidence/phase20n/noncollinear-single.md` (two-probe obstruction).

## Verdict (exactly one, bounded)

**POLICY_REQUIRED_NONCOLLINEAR_PLAN_LAW.** Do NOT force GO: no candidate
commands a geometric majority, and four policy/design inputs have no
authority behind them (§2). Production stays fail-closed at `NON_COLLINEAR`.

## 1. GO gate: all 10 criteria, checked one by one

GO would require `GO_WITH_EXPLICIT_PLAN_LAW_<NAME>` with every criterion met.
Criteria G6, G9, G10 pass; G1–G5, G7, G8 fail. One failure is enough to
refuse GO; seven fail.

| # | Criterion | Result | Evidence |
|---|---|---|---|
| G1 | Unique law selection: exactly one candidate selected by a geometric authority, not by taste | FAIL | Three explicit laws sharing endpoints + scalar law diverge 0.53 m at 0.1° (any Hermite-vs-frame pair), 5.5 cm at 45° (heading−nlerp), 7–9 m at 179° (geometry-results §1, §8). No authority selects (forensics §10). |
| G2 | Principled Hermite magnitude derivation (from member lengths, grades, or offsets) | FAIL | `m0=m1=W/2` stated, non-principled; halving moves the path 0.19 m (comfortable) to 2.50 m (near-bound). No derivation exists. |
| G3 | C1 acceptance rule: an authority states the admitted tangent-jump budget | FAIL | Frame laws kink ≈δ mid-interval ([0.63δ, 1.82δ] grid-wide ≤45°, pinned [0.5δ, 2δ]); Hermite is smooth (<0.09δ, pinned <0.2δ) only via the arbitrary G2 magnitude. Endpoint residuals mix blend slope (~14° base) with deflection and cannot serve as the budget. No budget exists to accept or reject either. |
| G4 | Near-180 branch authority: who owns the turn direction at \|δ\|→180° | FAIL | Shortest-turn wrap (heading), blend singularity (nlerp), and the 1e-9 antiparallel boundary are study stipulations. No production authority picks a branch; exactly ±180° has no unique turn. |
| G5 | Worker agreement/result basis for non-collinear plans | FAIL | Pinned: agreement rejects at `GRADING_AGREEMENT_TRANSITION_GEOMETRY`, result mesh rejects law-correct bridges at `GRADING_AGREEMENT_TRANSITION_OFF_LAW` (single chord-normal basis). No per-side/bridge basis exists. |
| G6 | Transition-specific topology handling defined | PASS | gtop2 + `countPositiveWidthRegions` + 1/1/1 expectation validate any declared law unchanged (both-law-valid control). Reusable as-is. |
| G7 | Provenance / revision / citation / UI authoring surface for a plan law | FAIL | No plan-law kind/version/params, endpoint-frame evidence, law-aware revision hash, per-bridge citations, or UI field exists (8-item delta in topology-worker-provenance §3). |
| G8 | Bounded admission predicate beyond exact-0 | FAIL | Only `NON_COLLINEAR` (exact-zero conjunct) exists. No width/angle/family-bounded predicate is specified, and none can be before G1–G4 resolve. |
| G9 | Determinism + transform stability at production tolerances | PASS | C0 exact everywhere; mirror exact (0), reversal ≤5.4e-15, translation FP-level; corpus double-build byte-identical with SHA pin. |
| G10 | No hidden default, no new epsilon | PASS | Study introduces no epsilon and legislates nothing; the shared agreement band is a comparison floor only. (Legislating any one law now, without G1–G4, would violate this.) |

## 2. Exact unresolved policy/design inputs

1. **Law selection** among materially divergent candidates (G1) — heading vs
   nlerp vs Hermite (or a fourth law) with geometric rationale.
2. **Hermite magnitude derivation** (G2) — principled rule or rejection of
   Hermite-class laws.
3. **C1 acceptance** (G3) — admitted tangent-jump budget, if any.
4. **Near-180 branch authority** (G4) — turn-direction owner and the exact
   admissible angle domain, if bounded.

## 3. What GO would have required (not met)

`GO_WITH_EXPLICIT_PLAN_LAW_<NAME>` plus the exact bounded domain — stated
only with geometric rationale for any angle bound (e.g. a derivation showing
candidate agreement, or a principled C1/branch rule, inside the bound and
its necessity outside it). No such rationale exists: the candidates diverge
at the smallest gridded deflection (0.1°), so no angle bound is geometrically
defensible from this evidence. Hence POLICY_REQUIRED, not GO, not NO_GO:
a future policy decision can still legislate a law; this phase does not.
