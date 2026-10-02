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

## Task B routing reconciliation (R0 whole-chain all-or-fallback, Tasks D/F/H/J gates wired + enforced)

`docs/evidence/phase20l1/group-corpus.json` (18 chains, regenerated twice
byte-identical, SHA-256 `9f0da07302048ef50485e234920e456fa61cd9c217898e433cebfea8163d1ed2`):
route decided at the whole-chain/group unit — EXACT_OFFSET iff every required
corner is LOCAL_P0_CANDIDATE AND production-join-tied (Z_TIE_OK: same plan d
+ analytic acceptance + tie in the same search neighborhood as the built join
(locality-only, NOT agreement) + single-valued laws AT THE JOIN within
zeroDelta + enforced exact member flatness) sharing one proven `d` (closed
groups line-only); else CHORD_FALLBACK with active=0 even when local>0
(mixed C/D plan-gated: local=1, active=[], no strip; mixed G
XYZ-gated: local=2, active=[], both corners REJECT_XYZ_TIE_MISMATCH with
join laws 5 vs 10, routeReason CHAIN_FALLBACK_XYZ_TIE_MISMATCH). Mixed H
(flat same-d/same-Z, join laws 5 vs 5, joinZ == tieZ == 5) routes EXACT
through the wired gate with a clean strip. Tie-at-join + flatness deltas
(Tasks F/H): XYZ B/C/E are REJECT_SLOPED_SOURCE by enforced predicate — B
corner 0 keeps 11 mm provenance (join (−4.772255751, 5) vs tie (−5, 5),
|T−J| = 0.227744249; join laws 5.238612788 vs 5.25); the 1e-13-slope B
variant rejects identically (was ok:true pre-fix, pinned test); A/D stay
Z_TIE_OK (flat laws plan-constant, joinZ == zIn == zOut == 5 on all 12 exact
chains); F/G/H rejection reasons unchanged. Task-J deltas: each member law
now evaluates at its OWN joint elevation (was: incoming.endZ for both) +
source-joint continuity enforced (incoming.endZ===outgoing.startZ,
production-exactXyz mirror) — new fixture I (DIST 0-vs-2: corner 0
REJECT_SOURCE_JOINT_STEP with true limits 5 vs 7, corner 1 tied at
7-but-inactive) and new chain I-source-step-0-vs-2 (local=2, active=[],
CHAIN_FALLBACK_SOURCE_JOINT_STEP, no strip); every previously continuous
joint resolves identically (zero outcome delta elsewhere). Route revocation
(defense in depth): strip ok:false forces whole-chain CHORD_FALLBACK + zero
active corners + ROUTE_REVOKED_STRIP_FAIL cause — EXACT only on built +
audited strips (no corpus chain triggers it; pinned by invariant sweep +
adversarial tests). Group-corpus routing otherwise UNCHANGED.
Strips are law-derived: every daylight vertex resolves through its member's
production limit law, corner nodes carry the agreed join Z checked against
both incident limits, sources carry member Z — on the flat corpus bitwise
the old values (all daylight 5, all sources 0; areas 587.69 / 763.32 / 700
unchanged). Fallback daylight is a label (production member-standalone
chord path); the study builds no fallback geometry and claims no fallback
continuity (CONTINUITY_UNPROVEN). Closed scope: F1 square EXACT both
orientations (LINE_ONLY_EXACT_CONTROL); F2 stadium CHORD_FALLBACK both sides
(CURVED_CLOSED_SUPPORT). Every corner records the decided tie (`xyzTie`
reason code, `tieOk`, laws-at-join `zIn`/`zOut`, agreed `joinZ`, analytic
`tieZ` + `tieJoinDist`); no PENDING hook remains. Exact tally: 12/18 chains
EXACT — all FLAT (A 6 two-member + B 3 three-member + H 1 mixed-same-Z + F1 2
closed line-only = 12 clean law-derived strips); fallback 6/18 (C + D
plan-gated, G XYZ-gated, I joint-stepped, F2 ×2 curved-closed). Sloped
exactness claimed nowhere — now predicate-enforced, not asserted. Stepped
sources rejected by predicate (joint continuity, exactXyz mirror). Policy-corpus regen ×2
identical (SHA-256 `62d2463d1810156cc3fb560d43fcb35f8e900fe3c4ab5390e46213553107b744`,
rows digest `dd961f52f2ba9d9a`, E1/B0/C0/equal-d untouched); xyz-corpus regen ×2
identical (SHA-256 `f1808eed0fee9f689a9947a91cd6eb895c88c426488b92c38d60c8667c5ed6c8`,
rows digest `99ae89dd356cadcf`; gate logic fixed per Tasks F/H/J above).
