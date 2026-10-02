# Phase 20L.1 Task 5 — policy decision (STUDY)

## Verdict: PARTIAL_GO (bounded P0 only)

Every admitted term is explicit with no hidden constant: criterion-derived
`d` resolved through the production analytic authority (classes A /
B-flat), exact `Roff>0` (`===0`/`<0` reject, no epsilon), UNIQUE single
on-body branch (B0), `d <= maxSearchDistance` exact + `|J-V|` within
`maxSearchDistance` plus the existing agreement band (E1; §Task C), C0 no
extension, arc×arc excluded, plus an independently computed
corner-candidacy audit per admitted row (mesh topology honestly N/A).
Admitted set (15 rows = 5 fixtures × DISTANCE/REL_EL/ELEV_FLAT):
`LL_LEFT_TURN_LEFT`, `LL_RIGHT_TURN_RIGHT`, `LL_SHALLOW_1DEG_LEFT`,
`LA_CW_OVERLAP`, `AL_CW_OVERLAP`. Everything else fail-closed with a named
reason code. 20L's POLICY_REQUIRED is discharged for P0; P1/P2/P3 stay
rejected, so full GO is not claimed. Transition-less surface↔analytic
joints remain deferred (the primary TIN-surface workflow stays on
chord-offset daylight).

## Task-7 reviewer fix round (REQUEST CHANGES → closed, verdict sustained)

1. Topology self-certification → independent `auditCornerCandidacy` (own
geometry, never admission booleans) + claim narrowed to
corner-classifier candidacy with mesh N/A recorded per row.
2. Scale invariance → criterion-derived `d` co-scaled with geometry;
classification AND normalized join geometry agree (≤2e-9) across origin
1e6/1e8, rotation, scale ×1e3 up/down, mirror, chain reversal; production
criterion-scaling truth (`D` scales, `Δ/E/g/Z` invariant) pinned separately.
3. Executable predicate → `phase20l1EffectiveCriterion.ts` drives every
corpus `d` from a resolved source + effective criterion pair (flat/sloped
exact boundary, invalid/degenerate sources, `Roff===0`/`<0` boundaries,
mixed-effective groups). Same 15 admits — P0 + PARTIAL_GO sustained.

## Task-9 fix round 2 (2 findings → closed, verdict sustained)

1. (MAJOR, real bug) Unequal member flats falsely proved: elevation `d`
was resolved at the first member's `startZ` only (flats 0 vs 2 → false
`{proven:true,d:5}` for true distances 5 vs 3). Fixed: each member
resolved at its own elevation, SAME EXACT `d` (`===`) required, else
`ELEVATION_MEMBER_MISMATCH` → `REJECT_CIRCULARITY_MISMATCH`
(distance/rel-el agree by construction — no source term). Regression
tests: reviewer repro rejects, same-flat admits, sloped still
slope-rejects, distance ignores member Z. Corpus regen: admit delta
15→15 (zero — corpus families assign uniform Z, so no ELEV_FLAT admit
rested on single-member resolution; the gate is pinned by tests).
2. (MINOR, wording) Audit scope honest everywhere: independent validation
of *reported* candidates, NOT proof of exactly-one-intersection
(completeness rests on B0). Same 15 admits — P0 + PARTIAL_GO sustained.

## Task C — extent-boundary unification (closed, verdict sustained)

The admission predicate and `auditCornerCandidacy` had two `|J-V|`
semantics: exact `distV <= ms` vs agreement-aware `distV <= ms + tol`.
Resolved as E1 (rejected E0): the two now call one shared study helper
`extentJVWithin` built on the existing 20J1 `seamParameterAgreementTol` —
the same band the classifier's `local` field already applied. The
criterion-derived `d <= ms` gate stays exact production
(`resolveAnalyticCriterionAt`); the |J-V| rule never redefines it.
Rationale: a 90° corner's analytic extent `d·√2` is exactly reachable, so
E0 makes the boundary frame-dependent — 1 ULP below the computed extent E0
rejects while the audit accepts. Boundary suite pins E0/E1 at 1 ULP and
holds E1 `UNIQUE` + `CANDIDACY_OK` across origin 1e6/1e8, rotation, and
scale up/down. Corpus regen: byte-identical ×2, rows digest unchanged
(`dd961f52f2ba9d9a`), admit delta 15→15 (zero). Same 15 admits — P0 +
PARTIAL_GO sustained.

## Permissive rejections (each adds policy without coverage)

P1 (+B1 nearest/continuity pick): rejected — 2 admissible branches exist,
selectors DISAGREE, tangency discontinuous. P2 (+bounded extension):
rejected — would admit 8 NONLOCAL GAP joins, needs a new length constant.
P3 (+sampled-constant surface): rejected — sampling is not authority (2
flat-surface rows excluded despite looking constant).

## 20L.2 contract proposal (production wiring, only under this verdict)

Gate locations: `provenConstantPlanOffset` at member resolve (criterion +
source rep), P0 conjunction at corner assembly before any join solve.
Admitted combos: exactly the 5 fixtures' shape-classes × 3 proven families;
diagnostics carry `reasonCode` per rejection; fallback is always the chord
path (fail-closed, never nearest-pick). `maxSearchDistance` reuse: both
extent gates read the persisted revision-authoritative value with
transform-scaling; no second constant. Chord-daylight interaction: P0 admits
only corners the chord path also owns (UNIQUE local), so fallback geometry
is continuous. Snapshot/revision/persistence/transform/UI: persist
admit+reason per corner (revision-keyed); transforms co-scale d/ms;
UI shows admitted-vs-fallback badge only (no branch picker — B0 forbids
the choice existing).

## Task B group/member buildability (STUDY, generator `scripts/phase20l1GroupBuild.ts`)

Routing granularity: MEMBER_FALLBACK_CORNER_REASONS. A curved member
incident to any rejected corner routes chord fallback (production's
existing member-standalone path); exact ties only at ADMIT_P0 corners; an
exact run needs contiguous P0 corners sharing one proven `d`; whole-group
exact iff every corner P0 + single `d`. Proved: 2-member open strips
(line→arc, arc→line × Distance/RelEl/Flat-Elev, 6/6 clean single-component
meshes); 3-member all-exact (one Roff=55 circle serves both joins, both
on it to 1e-9, single component, area-exact); line-only closed square
exact whole-group both orientations (source + daylight rings simple);
same-`d` cross-family continuity (D/RelEl/Flat-Elev share join bit-wise).
Mixed chains (either order) carry exact@P0 + chord@rejection with NO
transition geometry — the curved member falls back whole. Curved closed
stadium admits 0/8 corners either side (2-branch B0 at every curved
corner) → honest whole-group chord fallback; line-line 8/8 vs curved 0/8
split pinned. arc×arc NO_GO never weakened. Verdict: PARTIAL_GO SUSTAINED
at member/corner routing granularity — buildability is proved where the
predicate admits, fallback is truthful where it rejects.
