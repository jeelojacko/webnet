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
source rep), P0 conjunction at corner assembly before any join solve,
plus the Task-F/H tie gate per corner before any exact route:
same required plan `d`, production analytic acceptance, tie in the same
search neighborhood as the built join (locality-only, NOT agreement),
single-valued member laws AT THE JOIN (zeroDelta exact), and the enforced
FLAT-ONLY predicate (each member startZ===endZ exactly; sloped corners fail
closed with REJECT_SLOPED_SOURCE from 1e-13 to gross). ROUTE LAW: EXACT only
on actually-built + audited strips (strip-fail revokes to whole-chain
CHORD_FALLBACK); MEMBER LAW += exact joint continuity incoming.endZ===
outgoing.startZ (production-exactXyz mirror, REJECT_SOURCE_JOINT_STEP).
Admitted combos: exactly the 5 fixtures' shape-classes × 3 proven families;
diagnostics carry `reasonCode` per rejection; fallback is always the chord
path (fail-closed, never nearest-pick). `maxSearchDistance` reuse: both
extent gates read the persisted revision-authoritative value with
transform-scaling; no second constant. Chord-daylight interaction: P0 corners are exactly the corners the chord path
also owns (UNIQUE local), so routing a fallen-back chain to chord stays
inside owned geometry — but fallback daylight continuity is NOT proven by
this study (no fallback geometry built; corpus records
CONTINUITY_UNPROVEN). Snapshot/revision/persistence/transform/UI: persist
admit+reason per corner (revision-keyed); transforms co-scale d/ms;
UI shows admitted-vs-fallback badge only (no branch picker — B0 forbids
the choice existing).

## Task B group routing (STUDY, generator `scripts/phase20l1GroupBuild.ts`, R0 whole-chain all-or-fallback)

Routing granularity: WHOLE_CHAIN_ALL_OR_FALLBACK. Local P0 candidacy per
corner (existing predicate) + final route decision at the whole connected
chain/group unit. EXACT_OFFSET iff every required corner is a
LOCAL_P0_CANDIDATE sharing one proven `d` (closed groups additionally
line-only: LINE_ONLY_EXACT_CONTROL; a closed group containing any arc
routes CHORD_FALLBACK as CURVED_CLOSED_SUPPORT). Otherwise every corner is
INACTIVE_DUE_TO_GROUP_FALLBACK, every member CHORD_FALLBACK (production
member-standalone chord path, label only), no exact strip. Proved: 2-member
open strips (line→arc, arc→line × Distance/RelEl/Flat-Elev, 6/6 clean
single-component meshes); 3-member all-exact (one Roff=55 circle serves both
joins, both on it to 1e-9, single component, area-exact); line-only closed
square exact whole-group both orientations (source + daylight rings simple);
same-`d` cross-family continuity (D/RelEl/Flat-Elev share join bit-wise).
Mixed chains (either order) show local=1 BUT active=0, route CHORD_FALLBACK,
no strip: the study builds no fallback geometry and claims no fallback
continuity. Curved closed stadium admits 0/8 corners either side (2-branch
B0 at every curved corner) → honest whole-group chord fallback; line-line
8/8 vs curved 0/8 split pinned. arc×arc NO_GO never weakened. R1
(fixed-point partial-exact runs with mixed strips) and R2 (contiguous exact
runs with proven boundary transitions) NOT adopted — both need an invented
exact↔chord splice no existing authority provides. Verdict: PARTIAL_GO
SUSTAINED at whole-chain routing granularity — narrower than member-level
claims, and honest for it.

## Task D XYZ-gate wiring (STUDY, same generator — hook replaced by `xyzRunTieOk`)

Exact-run predicate, two levels (§15 contract): MEMBER LAW — each corner
passes the plan-P0 predicate (UNIQUE + in-span + branch-consistent + E1
extent + candidacy audit) AND the production XYZ tie (`xyzRunTieOk`:
same required plan `d` + single-valued daylight Z through
`solveAnalyticCorner`; ordered 8-gate contract, Z_TIE_OK path). ROUTE
UNIT — the whole connected chain/group routes EXACT_OFFSET iff every
required corner passes MEMBER LAW sharing one proven `d` (closed groups
additionally line-only); any failing corner is INACTIVE (plan reason, or
the tie reason: REJECT_XYZ_TIE_MISMATCH same-d/diff-Z, or the
analytic-corner reject) and the whole unit falls back. Fallback semantics:
a rejected unit takes the untouched production member-standalone chord path
(label only — no fallback geometry built, continuity unproven/unspliced).
Closed scope: a closed group containing any arc routes CHORD_FALLBACK
(CURVED_CLOSED_SUPPORT); curved-closed exactness is claimed nowhere.
Coverage: local 15/186 rows, arc Roff 6/186 rows; complete open curved
chains qualifying with XYZ ties: A 6/6 + B 3/3 + H 1/1 mixed-same-Z (incl.
sloped-source ties B/C in the XYZ corpus); curved closed 0; whole-fallback
mixed chains 3 (C + D plan-gated, G XYZ-gated with local=2/active=0,
daylight 5 vs 10). Verdict re-run: PARTIAL_GO SUSTAINED — every claimed
exact chain (12/12) is XYZ-tied at every corner + topology-clean
(single-component, daylight-continuous, no interior overlap); any future
claimed-exact chain failing either level reverts the verdict to
POLICY_REQUIRED.

## Task F tie-at-join fix (STUDY — reviewer REQUEST CHANGES, 2 majors, fixed here)

FINDING 1: the Task-D gate evaluated Z at the production tangent-line tie
T, not the admitted offset join J — and the two constructions differ by
0.2277 m on every arc corner, so tie-Z agreement held BY CONSTRUCTION while
the member laws at the built node disagreed (sloped fixture B corner 0:
join (−4.772255751, 5) vs tie (−5, 5); laws at the join 5.238612788 vs 5.25).
Fixed gate (ordered 10-gate contract): (9) the certifying tie must lie in
the search neighborhood of the built join (`|T−J|` within the reused E1
band — coincidence is NOT required and not claimed); (10) tie-at-join law:
both member daylight-Z laws single-valued AT THE JOIN within production
zeroDelta (exact, justified: flat laws are plan-constant with gs=0, so the
tie-join distance cannot inject Z ambiguity there; sloped laws vary along
plan, so the check must be at the built node). New reasons
REJECT_TIE_JOIN_XY_MISMATCH / REJECT_JOIN_Z_MISMATCH. Deltas: XYZ B/C/E flip
ADMIT→REJECT (all REJECT_JOIN_Z_MISMATCH, 11 mm); A/D stay Z_TIE_OK;
F/G/H rejections unchanged in reason; group-corpus routing UNCHANGED (all
chains flat — join laws agree bitwise at 5, joinZ == tieZ == 5 on all 12
exact chains). The Task-D "sloped-source ties B/C" admission claim above
is STRUCK — sloped exactness is claimed nowhere. (Task H below supersedes
the step-9 E1-band framing and the B/C/E JOIN_Z reasons: predicate flatness
first, search-neighborhood restated.)

FINDING 2: the Task-D strip wrote every daylight vertex `z = d`, so the
audit verified flat-Z strips, not sloped laws. Fixed construction: every
daylight vertex resolves through its member's production limit law
(`resolveAnalyticCriterionAt` at the member source Z), corner nodes carry
the verified single agreed join Z checked consistent with both incident
member limits (fail closed), source vertices carry the member source Z.
On the flat corpus this coincides with `z = d` bitwise (test-pinned: all
daylight 587.69/763.32/700-area strips keep aggregates, all daylight
vertices 5, all sources 0) — the preferred option (real XYZ strips), not
narrowing, because the fixed gate already bars every sloped chain from
EXACT and every remaining strip is law-derived.

Narrowed coverage: local 15/186 rows, arc Roff 6/186 rows; qualifying open
curved chains are FLAT ONLY — A 6/6 + B 3/3 homogeneous flat + H 1/1 flat
mixed-same-Z (12/12 exact chains join-tied + topology-clean); sloped B/C/E
and diff-Z G/F route whole-chain CHORD_FALLBACK (fallback total 5: C + D
plan-gated, G XYZ-gated, F2 ×2 curved-closed); curved closed 0. Verdict re-run: PARTIAL_GO
SUSTAINED NARROWED to flat homogeneous + flat mixed-same-Z — nothing curved
and sloped survives, and nothing is forced: had no curved chain survived
the fixed gate the verdict would be POLICY_REQUIRED. 20L.2 production
contract inherits the fixed gate verbatim: MEMBER LAW = plan-P0 AND join-Z
agreement at the built node (zeroDelta exact); the analytic tie is
structural compatibility + provenance, never the certified point.

## Task H flat-only enforcement + T−J policy restatement (STUDY — reviewer REQUEST CHANGES, 2 majors, fixed here)

FINDING 1: flat-only scope was prose, not predicate — the Task-F gate let
sloped Distance/RelEl through and accepted near-flat Z diffs within
zeroDelta (reviewer repro: fixture-B variant with slopes scaled 1e-13,
incoming 2e-13→0 / outgoing 0→3.927e-13, returned ok:true Z_TIE_OK;
reproduced before fixing). Fixed as gate code (step 11, ahead of every
admission): each member startZ===endZ exactly (===, no tolerance) — any
slope from 1e-13 to gross rejects REJECT_SLOPED_SOURCE identically, before
any zeroDelta leniency can admit it; join-law measurements stay reported as
provenance. Deltas: XYZ B/C/E move REJECT_JOIN_Z_MISMATCH→REJECT_SLOPED_SOURCE
(same 11 mm zIn/zOut provenance, same inactive outcome); A/D/F/G/H and all
group-corpus routing UNCHANGED (every member of every fixture/chain is
exactly flat — confirmed, zero outcome delta from flatness alone). The 1e-13
variant now rejects (pinned test). Group strip single-Z-per-member matches
the enforced predicate by construction (one Z per member ⇒ startZ===endZ),
and decision.md:182-190 "flat-only" is hereby predicate-enforced (gate
code + regression test), not asserted.

FINDING 2: the step-9 `|T−J|` check was mislabeled as E1 agreement —
`extentJVWithin(|T−J|, ms)` at ms=100 accepts 99 m separations, which is
search-locality, not numerical agreement (the ~7.1e-13 band only guards ULP
flips at the bound). Restated honestly (no outcome change — no fixture is
near the bound): a separate structural search-neighborhood condition — the
certifying tie must lie within the same search neighborhood that admits the
join, justified because both points derive from the same corner's P0
candidacy under one maxSearchDistance. It certifies ONLY locality; it does
NOT certify numerical agreement, coincidence, or which point is built (the
built node is always the admitted join J; 0.2277 m separation on arc
corners is structural and openly recorded as tieJoinDist). Reason renamed
REJECT_TIE_JOIN_XY_MISMATCH → REJECT_TIE_OUTSIDE_SEARCH (REJECT_ prefix kept;
no corpus fixture hits it — diagnostic/pass-through only). Strict agreement
is deliberately NOT imposed: it would kill the 12 flat arc admissions whose
separation is constructional, not erroneous.

Coverage + verdict unchanged from Task F (flat-only, now enforced): local
15/186, arc Roff 6/186, 12/12 exact chains flat join-tied + topology-clean.
Verdict: PARTIAL_GO SUSTAINED, flat-only ENFORCED — no evidence forces a
downgrade (every claimed-exact chain passes the enforced predicate). 20L.2
contract inherits the enforced gate verbatim (gate locations §20L.2
amended): MEMBER LAW = plan-P0 AND join-Z at the built node AND exact
member flatness (===); T−J neighborhood as locality-only.

## Task J source-joint continuity + strip-fail fallback (STUDY — reviewer REQUEST CHANGES, 2 majors, fixed here)

FINDING 1: the gate passed incoming.endZ to BOTH terminal-line laws
(phase20l1XyzTies.ts:280-285) — the outgoing member's actual Z was ignored,
so a flat 0-vs-2 step returned ok:true Z_TIE_OK with zIn=zOut=5 while the
true Distance limits are 5 and 7 (reproduced before fixing). Fixed: each
member's law evaluates at its OWN joint elevation (incoming at endZ,
outgoing at startZ), and source-joint continuity incoming.endZ===
outgoing.startZ (exact ===, no tolerance) is a predicate condition — a
0-vs-2 step is a genuine source discontinuity, not an exact joint, and fails
closed REJECT_SOURCE_JOINT_STEP with the true per-member limits (5 vs 7)
in provenance, before any Z_TIE_OK. Production citation: exactXyz
(gradingGroupCompute.ts:137-138) requires endX===startX && endY===startY &&
endZ===startZ exactly, failing closed GRADING_GROUP_CORNER_MISMATCH
(:279-280) — the study MIRRORS it (same === semantics on the Z leg; the XY
legs coincide by chain construction, so the study enforces the free
variable), not strengthens it. Deltas: new XYZ fixture I (DIST 0-vs-2 step:
corner 0 STEP with 5-vs-7 provenance, corner 1 tied at 7-but-inactive) and
new group chain I-source-step-0-vs-2 (local=2, active=[],
CHAIN_FALLBACK_SOURCE_JOINT_STEP, no strip); all other outcomes unchanged
(per-member vz is identical wherever joints were already continuous).

FINDING 2: the route was set EXACT before construction and kept on strip
failure. Fixed as defense-in-depth revocation: strip ok:false forces
whole-chain CHORD_FALLBACK + activeExactCorners=[] + all members CHORD +
ROUTE_REVOKED_STRIP_FAIL with the underlying strip detail — EXACT_OFFSET is
reported only for actually-built + audited strips. The 0-vs-2 chain never
reaches construction (gate rejects first), so no corpus chain exercises the
revocation path; it is pinned by invariant sweep (any failed strip MUST
ride fallback with zero active corners) + adversarial construction tests
(poisoned corner Z → corner-z-mismatch; stepped limits unsatisfiable).

Coverage + verdict: 12/12 exact chains unchanged (all flat, all
joint-continuous); fallback total 6 (C + D plan-gated, G XYZ-gated, I
joint-stepped, F2 ×2 curved-closed). PARTIAL_GO HOLDS — narrowed scope
unchanged (flat homogeneous + flat mixed-same-Z); no evidence forces a
downgrade (every claimed-exact chain passes both new predicates). 20L.2
contract inherits both: MEMBER LAW += exact joint continuity (===,
production-exactXyz mirror); ROUTE LAW += strip-fail revocation (EXACT only
on built + audited strips).
