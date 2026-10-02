# Phase 20L.1 Task 5 — policy validation (STUDY)

Corpus `docs/evidence/phase20l1/policy-corpus.json`: 186 rows, 15 ADMIT_P0,
rows digest `dd961f52f2ba9d9a` (unchanged by Task C), file SHA-256
`62d2463d1810156cc3fb560d43fcb35f8e900fe3c4ab5390e46213553107b744`
(Task C; byte-identical across two generations). Baseline before Task C:
`f885d898292b939c4fb278b17563a9504ca993040d2ce8ee77c59ecc0787672b`,
admit delta 15→15 (zero). Reason histogram: SURFACE 62 /
NON_UNIQUE 33 / SLOPED 31 / ARC_PAIR 21 / AMBIGUITY_B0 18 / ADMIT_P0 15 /
ROFF 6 (RADIUS-boundary collapse/inversion rows now carry their own code
instead of hiding in NON_UNIQUE).

## Coverage matrix (source × criterion × corner → verdict)

| source | criterion | GAP (outside) | OVERLAP (inside) |
|---|---|---|---|
| line–line | DISTANCE/REL_EL/ELEV_FLAT | REJECT (NONLOCAL; 90° + hairpin + span-mismatch) | ADMIT (square L/R + shallow-1°; parallel-tangent NONE) |
| line–line | ELEV_SLOPED/SURF_* | REJECT_CIRCULARITY | REJECT_CIRCULARITY |
| line–arc / arc–line | proven 3 | REJECT (NONLOCAL or AMBIGUOUS) | ADMIT iff CW-overlap (R+d branch unique); CCW-overlap AMBIGUOUS |
| line–arc / arc–line | unproven 3 | REJECT_CIRCULARITY | REJECT_CIRCULARITY |
| arc–arc | any | REJECT_ARC_PAIR_NO_GO (reference only) | REJECT_ARC_PAIR_NO_GO |

Collapse/inversion (`LA_CCW_LEFT_COLLAPSE/INVERSION`), tangent-contact,
clear-miss, wrong-side/fold stress fixtures reject in every family.

## MaxSearch ladder (DISTANCE, UNIQUE-candidate fixtures)

`ms=4`: all `REJECT_INVALID_CRITERION` (`d=5>4`: the production resolve
fails closed before any join is attempted). `ms=5`: all REJECT (sub-local:
the classifier itself drops UNIQUE below the bound). `ms=7`: shallow +
arc-overlaps ADMIT, squares REJECT (sub-local at `|J−V|=7.07>7`, via the
classifier, not the JV extent gate). `ms=100`: all 5 ADMIT. Monotone in
`ms`; no flip-flop.

## Corner-candidacy audit (per admitted row; Task-7 Finding 1 fix, Task-9 Finding 2 scope)

Each admitted row carries a candidacy audit computed with own arithmetic
(on-curve / on-body / branch-sign / turn / Roff / extent checks, never the
admission booleans): join point finite XY, recomputed `|J−V|` agrees with
the reported `distV` (tests pin ≤1e-6 live per row), offset radii finite
with exact `Roff>0`, turn GAP/OVERLAP from the production `classifyCorner`,
single passing candidate (no duplicates/branches), `cornerCandidacyPass=true`
with `CANDIDACY_OK` on all 15. Scope honesty: this is independent validation
of the *reported* candidates — the audit loops over the classifier's
candidate set, so it cannot detect an omitted branch and is NOT a proof of
exactly-one-intersection; branch-completeness rests on B0 fail-closed.
Rejected rows never carry a vacuous pass.
Mesh-level checks (area, components, boundary cycles, self-cross, pinch,
seams) are N/A with recorded reason — admitted terms are corner joins, not
facets; the claim is corner-classifier candidacy, never a "validated join".
Closed groups: none admitted (arc×arc NO_GO) — recorded truthfully.

## Transform invariance (admitted P0 fixtures, classification + normalized geometry)

Seven transforms per admitted fixture, each comparing the classifier verdict
AND the join point in normalized coordinates: origin 1e6 / 1e8, rotation
0.9 rad, uniform scale ×1e3 up and ×1e-3 down (criterion-derived `d` and
`ms` co-scaled via the production `scaleGradingCriterion`), mirror-Y
(side-flipped), chain order-reversal (travel+side flipped). All 5×7 cells
agree with normalized join error ≤2e-9 (threshold 1e-6). Order-reversal is
a true chain reversal (same physical corner), not a member swap.
Production-scope note: geometric co-scaling tests classifier math; under a
real XY project transform only distance-family `D` scales (rel-el `Δ`,
elevation `E`, `g`, `Z` invariant per `scaleGradingCriterion`) — pinned by a
separate test, no admit-stability claimed there. Task-3 order-reversal
results (B1 classification invariant; identity still fails → B0) stand.

## Determinism + 20L stability

Policy corpus regenerated twice, byte-identical. 20L corpora untouched:
this task adds one generator + one JSON; `JOIN_FIXTURES` (31) and all 20L
classifications unmodified (pinned in test).

## Task C — extent-boundary unification (E1)

The `|J-V|` extent gate is now a single shared study helper,
`extentJVWithin(distV, ms, worldScale)` in `phase20l1EffectiveCriterion.ts`,
called by BOTH the admission predicate and `auditCornerCandidacy` (the
classifier's `local` field already used the same band). It reuses the
existing 20J1 `seamParameterAgreementTol`; the criterion-derived `d <= ms`
gate stays exact production and is never relaxed. See architecture §2b for
the E0/E1 rationale.

Boundary evidence (`cad_grading_offset_radius_policy_extent_boundary_20l1.test.ts`):
a 90° line→line join has analytic extent `d·√2 == 7.0710678118654755`,
exactly the classifier's computed `distV`. At that bound, at 1 ULP above,
and inside the agreement band → `extentJVWithin` true and the audit
`CANDIDACY_OK`. At 1 ULP below the bound the exact E0 comparison rejects
while E1 and the independent audit accept (the contradiction Task C
removes). Outside the band (`ms = distV − 2·tol`) both reject with
`AUDIT_NO_PASSER`. The same 1-ULP-below verdict (`OFFSET_JOIN_UNIQUE` +
`CANDIDACY_OK`) is invariant across origin 1e6 / 1e8, rotation 0.9 rad,
scale ×1e3 / ×1e-3. Criterion gate pinned separately: `d == ms` proves,
`ms = nextafter(d, 0)` fails `INVALID_CRITERION`, `nextafter(d, ∞)` proves.

Coverage split (honest): the 15 admits are 6 arc-bearing rows with a real
finite positive `Roff` (`LA_CW_OVERLAP`, `AL_CW_OVERLAP` × 3 proven families)
+ 9 line-line control rows (kept, no `Roff`). Reason histogram re-pinned;
all 31 fixture classifications re-pinned (zero drift vs the
`f885d898`/15-admit baseline).
