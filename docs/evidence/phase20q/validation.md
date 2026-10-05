# Phase 20Q — validation record (study-core + docs, fix round 2)

- Branch: `research/phase20q-vertical-profile-transition-law`, baseline
  `4998f70c`. STUDY ONLY — `git diff --stat -- src` empty at sign-off.
- Corpus: `docs/evidence/phase20q/corpus.json`, **2622 rows**, sha256
  `26019cb911a2909f78b062fa13c9eeae7bc8e3621fdfea3b5eeec5d4043baa94`.

## 1. Corpus build, double-regen determinism, and persisted-bytes read-back

| Step | Result |
|---|---|
| `npx tsx scripts/phase20qVerticalProfileStudy.ts` | 2622 rows, sha `26019cb9…` |
| `npx tsx scripts/phase20qCorpusRegen.ts` (re-imports fixtures+laws, never reads corpus.json) | identical sha |
| `sha256sum -c corpus.sha256` after each run | `corpus.json: OK` |
| `npx tsx scripts/phase20qCorpusRegen.ts verify-persisted-bytes` | reads the WRITTEN corpus from disk; 2622/2622 scalar + 2622/2622 agreement, clean (test 20Q.18) |

Byte-identical across processes. Zero-slope reduction (`flatReductionExact`)
is `true` on **102/102** flat controls. 1-ULP step cases classify as `step`
**96/96**.

**Determinism ≠ independent oracle (disclosed):** both entry points share
`assemblePhase20qRow`/`serializePhase20qCorpus`, so byte-identity proves the
shared assembler is deterministic, not that its numbers are independently
correct. The independent checks are the persisted-bytes read-back, the
persisted-field recompute, and the real production validators (§2).

## 2. Recorded evidence totals

| Metric | Value |
|---|---|
| rows total / by law | 2622 = S1/S2/S3 666 + J1/J2/J3/J4 156 |
| families / sides | distance 874, relative-elevation 874, elevation 874; 1311/1311 |
| sloped C0 (S1) | joint/cut gaps 0 on 666/666 |
| step gtop2 refusals | 432 (J1/J3/J4 × 144) |
| J2 certifications | 156/156, source mutated |
| source-Z-aware check (B2) | S1 666/666 PASS, J1 156/156 PASS; S2/J2 sourceZ-divergent, S3/J3/J4 daylight-divergent on rewrite rows |
| **current real validator on untampered sloped S1 (M1), per family** | relative-elevation 216/216 pass; distance 12/216 pass (near-flat `1e-9` W2); elevation 0/216 — all failures exactly `GRADING_AGREEMENT_TRANSITION_OFF_LAW` |
| **per-checkpoint-source-Z validator extension** | PASS all 666 S1 + 156 J1, per family (the only missing piece for distance/elevation) |
| **extended study tile** | outerOk 666/666, outerDev=0, extensionDev=0, 8 checkpoints |
| persisted recompute (B3) | `matchVsRow=true` 2622/2622 (fields-only, no fixture reuse) |
| persisted-bytes read-back | 2622/2622 scalar + 2622/2622 agreement, clean |
| tamper probes | 5 agreement classes strict per probe — each 102 caught / 2520 inapplicable / 0 missed (510/12600/0 total; agreement gate admits only the 102 flat controls untampered); width via real `validateTransitionResultMesh` 894 caught / 1728 inapplicable / 0 missed (larger mesh pass set: rel-elevation sloped + flats) |
| real tiling (B1) | 102 admitted (bitwise vs full flat solve), 2520 rejected |
| transforms | 1e6 ≤5.78e-11, 1e8 ≤6.56e-9, Z-shift ≤2.49e-14, mirror 0 |
| S1 reversal | 0 (S2 7.1e-15; J1/J2/J3 0; J4 = step, max 20) |

## 3. Docs-only scope checks

| Gate | Result |
|---|---|
| `git diff --stat -- src` | empty (zero production/shared changes) |
| `git stash list` | 14 entries, untouched (none created/popped/dropped) |
| Changed under scope | `docs/evidence/phase20q/*.md` + `TODO.md` Phase 20Q STATUS line only |
| typecheck / lint | unaffected (no `.ts` change); run by tests worker where applicable |

## 4. Phase 20Q tests — 70/70 GREEN (3 files)

The `tests/` worker owns the Phase 20Q suites; independent rerun confirms
**70/70 green across 3 test files** (`cad_grading_transition_boundary_20q`,
`..._sloped_20q`, `..._step_20q`). Surface covered: S1/S2/S3 disposition pins,
J1–J4 step pins (per-family J4 reversal, exact J2 bridge), C0 /
zero-reduction / transform pins, corpus SHA pin, worker recompute/tamper pins,
and the review-fix pins **20Q.12–19**: B1 real tiling + vertical extension,
B2 source-Z-aware per-family PASS/FAIL + jointZ control, B3 persisted
recompute + asymmetric width tamper via the real validator, M4
expectation-before-measure, B2/B3 on step laws, **20Q.17 M1 per-family real
validator table (distance 18/204 incl. flat; rel-elev pass; elevation
flat-only) + per-checkpoint extension PASS all families**, **20Q.18
persisted-bytes read-back 2622/2622 + M2 totals (agreement strict 102/2520/0
per probe + width 894/1728/0)**, and **20Q.19
extended study tile (outerOk, outerDev=0, extensionDev=0, 8 checkpoints)**.

**Neighbor counts (carried, not rerun here):** this is a study-only docs pass;
no `src/`/`tests/` file changed, so no production-tree neighbor suite was
re-executed. Carried from the prior validated 20N.1 run: 20N.1 new 100/100,
20M.2 transition 55/55, 20N study + 20M feasibility 61/61. Marked **carried** —
not re-verified in this pass.

## 5. Not run (out of scope for a study-only docs phase)

- `npm run test:wasm` / `wasm:build` / `cpp:test` — no engine/worker/C++
  changes.
- `npm run parity:industry-reference` — no numerical/production change.
- `npm run test:evidence` / `test:full` — manual-only / literal-everything,
  not a routine gate.

## 6. Docs authored (this phase)

`forensics.md`, `sloped-source-laws.md`, `joint-step-laws.md`,
`geometry-results.md`, `topology-worker-provenance.md`, `decision.md`,
`production-delta.md`, `validation.md` (this file). All numbers from the
corpus and study scripts; no invention. `authorityViolation` is not a corpus
field (it lives only in the law oracle result) and is therefore not quoted as
corpus data.

## 7. Scope confirmations

- Zero `src/` changes; 14 stashes intact; Phase 20O
  `POLICY_REQUIRED_NONCOLLINEAR_PLAN_LAW` and Phase 20P.1 production
  unchanged.
- Verdicts are family-scoped: relative-elevation
  `GO_SLOPED_SOURCE_VERTICAL_PROFILE_S1`; distance/elevation
  `POLICY_REQUIRED_SLOPED_SOURCE_Z_LAW` pending the named per-checkpoint-source
  Z validator extension; step `NO_GO_JOINT_Z_STEP_SOURCE_DISCONTINUITY`. No
  unified sloped GO is claimed while a family is rejected by the current
  validator.
- Adversarial self-check applied: no source-geometry mutation claimed for S1;
  no hidden smoothing parameter (S3's τ is exposed, rejected); topology
  expectation declared **before** mesh (no circularity); worker numbers come
  from persisted-field recomputation + real validators, not study-truth reuse;
  the regen's byte-identity is disclosed as assembler determinism, not an
  independent oracle (the read-back adds real independence); no C1 rule
  invented (the joint tangent break is the survey's own); no cross-family
  overclaim (the family split is the current validator's, stated explicitly);
  no `NON_COLLINEAR` widening.
