# Phase 20N Decision — Transition Expansion Head-to-Head

- Branch: `research/phase20n-transition-expansion-decision`, baseline `9805da77`.
- Method: study-only. Zero `src/` changes (`git diff 9805da77...HEAD -- src` empty, test-pinned).
- Inputs: `docs/evidence/phase20n/forensics.md` (production authority inventory),
  `multiple-collinear.md` (Candidate A evidence), `noncollinear-single.md`
  (Candidate B evidence), study `scripts/phase20nTransitionExpansionStudy.ts`,
  corpus `docs/evidence/phase20n/corpus.json` (116 rows: 35 A-mesh + 81 B, regen-pinned
  by `corpus.sha256` via `scripts/phase20nCorpusRegen.ts`).
- Frozen predicate: 20M.1 §9 / 20M.2 `trp1` — exactly one collinear same-family
  transition per group, linear scalar law `TRANSITION_LINEAR_V1`.

## 1. Head-to-head matrix

| Row | Candidate A: multiple collinear same-family | Candidate B: single non-collinear same-family |
| --- | --- | --- |
| needs new user input? | No. Per-joint widths already in the persisted intent shape; no new field. | **Yes. A persisted plan/frame bridge law** (versioned, like `TRANSITION_LINEAR_V1`) — no existing authority selects the interior path (§4). |
| persisted field? | No. `transitions[]` already array-typed; "at most ONE" is policy prose, not schema (forensics §3). | Yes — new plan-law kind/version + provenance per bridge. |
| law version? | Reuse `TRANSITION_LINEAR_V1`/`v1` per joint, unchanged. | New law required; nothing to version against today. |
| width contract? | Reuse: `W ≤ 2·min(LL,LR)` per joint + new strict-separation predicate `Wi/2+Wi+1/2 < gap`. | Width exists but selects nothing: the join authorities are width-independent points (C3 audit). |
| scalar law? | Reuse legislated `v(s)` per joint; midpoints exact in all families (6.0 / 1.75 / 0.75). | Scalar C0 holds (`c0Gap == 0` measured via production law on all 81 rows) — but scalar agreement does not repair the frame break. |
| station measure? | Reuse per-joint `jointStation`; classifier assigns each interior vertex once. | No measure exists for a bent interval under the single-frame construction. |
| ownership? | Deterministic: strictly-inside → joint `i`; exactly-on-bound → shared endpoint (either owner agrees); else native. Touching excluded (double-owned boundary). | Underdetermined: two study laws sharing endpoints diverge up to 7.6 m / 22.7 m². |
| C0? | Holds by construction (endpoint == native, shared refs). | Holds at scalar level on all rows — necessary, not sufficient. |
| C1? | N/A (collinear: single tangent). | **Breaks by exactly δ** (`kinkDeg == angleDeg`, 81/81 rows); foldover past perpendicular. |
| topology? | EXTEND: independent pre-mesh expectation declares the single merged positive-width strip (`deriveCandidateAPreMeshExpectation`: open + admitted + strict-separated + positive widths ⇒ 1, BEFORE mesh); production `countPositiveWidthRegions` == 1 measured AFTER tiling and asserted equal before cert; gtop2 certifies against the independent expectation (wrong-budget 2 fails, tied-split mismatch rejected — pinned). 1/1/1 is declared by the bounded candidate predicate before mesh, then independently measured/certified; it is no longer derived from observed count. | No topology can validate an unlegislated bridge; `TRANSITION_REQUIRED` stops stand. |
| gtop2? | Reuse unchanged (validates, never admits; header already count-parameterized). | Reuse unchanged — validates nothing new, selects nothing. |
| worker re-eval? | Loop today's math per joint (re-admit + pinned-evidence compare, byte-identical per joint). MEASURED: production `validateTransitionResultMesh` null per transition against actual full-mesh-owned checkpoints + production `checkGroupTransitionAgreement` ok per transition, all families/transforms. Plural worker request/handler wiring is NOT implemented/proven in production (Phase 20N.1 work). | No basis: plan normal from `pCutR−pCutL` assumes one straight tangent — false for δ≠0. |
| revision invalidation? | EXTEND with canonical joint-index order; `exactTransitionWidth` full-precision preserved. | Reuse (single intent; nothing new to order). |
| Extract? | Per-joint legs array; leg↔intent match refusal looped per joint. | Blocked: no bridge law to cite. |
| Bake? | Citation already array-typed (length-1 today) → length-N, same refusal per joint. | Blocked: same reason. |
| Design Patch? | Unchanged (open-route refusal is orthogonal; unwired gate stays unwired). | Unchanged. |
| transform? | Mirror/1e6/1e8 are geometric probes (same counts + validators); reversal is TRUE production-like traversal reversal (B1: rebuilt member order, reversed endpoint-pair ids, reindexed joints, physical widths reversed; normalized geometry matches identity under production agreement tolerances; ggrev1 legitimately rehashes). | `mirrorStable`/`reversalStable` true all 81 rows — obstruction is transform-independent. |
| reversal? | B1 true traversal reversal as above (rebuilt traversal, not a mirror probe). | Same; study laws coincide at endpoints/midpoint under reversal. |
| new epsilon? | **None.** Exact checks only; strict `<` separation; no tolerance changes. | **None introduced** — and none would help: divergence (5.6e-7 m at δ=1°) is 10^7× the agreement band, not rounding. |
| hidden default? | None: touching/overlap/malformed/infeasible all fail closed; one stale joint fails the group. | The trap: any "obvious" bridge (miter point, straight connector, width-curvature law, hidden arc, smoothstep) would be a hidden default smuggled as law. Both probes are labelled STUDY-ONLY for exactly this reason. |
| delta size-risk | Bounded EXTEND across ~9 sites; per-joint math reused byte-identical. See `production-delta.md`. | Unbounded NEW semantic authority (frame/blend/normal semantics + worker basis + topology handling). Blocked on policy. |

## 2. Verdict

**PARTIAL_GO_MULTIPLE_COLLINEAR_TRANSITIONS (Candidate A ONLY — evidence now real:**
**actual shared-member 2T/3T strip meshes, production gtop2 1/1 + null
revalidation, per-transition production validators green, full-geometry
transforms; see `multiple-collinear.md` §§A1–A5).**
**POLICY_REQUIRED_NONCOLLINEAR_PLAN_LAW (Candidate B).**

Desirability does not override evidence: B's scalar C0 is real but
insufficient, and the missing plan law has no selecting authority — shipping
B would mean inventing geometry under the guise of relaxing a gate. A ships
on reuse; B waits on a product/policy decision that names the bridge law.

## 3. Authorized: Phase 20N.1 predicate (Candidate A)

Per group, admit transitions `T_1..T_N` (N ≥ 1) iff ALL hold:

1. Each `T_i` independently satisfies the full 20M.2 `trp1` predicate
   (collinear, flat, joint-Z, side, family, grade, width bound) — evaluated
   per joint with `transitionCount: 1` at the admission authority.
2. Strict separation on the shared source line:
   `W_i/2 + W_{i+1}/2 < gap_i` (strict) for every adjacent pair, with finite
   positive widths and gaps.
3. Canonical order by joint index at authoring; out-of-order or duplicate-
   `jointId` intents fail closed (`TRANSITION_REJECTED`), never re-sorted or
   merged silently.
4. Whole-group fail-closed: one stale/rejected joint fails the group; no
   partial-transition solve.
5. Independent pre-mesh expectation declares the single merged
   positive-width strip (`positiveWidthRegions: 1` for N joints — DECLARED
   by `deriveCandidateAPreMeshExpectation` before mesh from open +
   admitted + strict-separated + positive widths); the post-tiling
   production `countPositiveWidthRegions` must equal it before gtop2
   certifies against it (mismatch fails closed); gtop2 validates as today.
6. Revision hashes the joint-index-ordered intent list at full width
   precision; provenance/bake cite per-joint legs with the existing
   leg↔intent match refusal applied per joint.

### Exclusions (fail closed, no partial credit)

- Touching (`==`): NOT authorized — shared boundary station needs a
  single-owner tie-break that does not exist.
- Overlap, malformed gaps, per-joint infeasible widths: rejected as today.
- Any non-collinear joint: rejected at `NON_COLLINEAR` as today (B stays out).
- No new epsilon, no tolerance change, no production default introduced.

## 4. Blocked: Candidate B decisive evidence

1. **Live gate pins the obstruction**: `admitGradingTransition` returns
   `NON_COLLINEAR` for every δ ∈ {1,5,15,30,45,90,135,179}° × 3 families;
   `ADMITTED` only at 0° (machine-checked pin).
2. **Single-frame construction truncates**: right cut placed on the left
   tangent, off the right member line by `W·sin(δ/2)` (up to 8 m at W=8 m — derived study model);
   real corner never patched; worker normal derived from a cut line that is
   not the member frame.
3. **Underdetermination**: probes N (nlerp) and H (heading) share endpoints
   and scalar law yet diverge materially — 5.6e-7 m at δ=1° (≈10^7× the
   coordinate band), 7.6 m / 22.7 m² at 179°, self-intersection at 90°/179°
   (distance family).
4. **No selecting authority**: miter and 20L.2 offset both yield one
   width-independent point (machine audit: `miterMatchesExactOffset=true`,
   `selectsPlanPath=false`); source geometry, `maxSearchDistance`, `W`,
   gtop2, and worker tolerances all bound or validate — none chooses a path.

A future non-collinear predicate requires at minimum: a persisted,
versioned plan/frame bridge law; interior scalar law; explicit width;
provenance; worker agreement basis; transition-specific topology handling.
That is a policy decision, hence POLICY_REQUIRED — not NO_GO, not
IMPLEMENTABLE_NOW.

## 5. Reproducibility

```
npx tsx scripts/phase20nCorpusRegen.ts   # rebuilds corpus.json (116 rows) + corpus.sha256
npx tsx scripts/phase20nTransitionExpansionStudy.ts  # candidate B appendix
(cd docs/evidence/phase20n && sha256sum -c corpus.sha256)
```

Corpus regen is deterministic: two separate processes produce byte-identical
output AND identical sha (pinned in
`tests/cad_grading_transition_expansion_20n_multi.test.ts`).
