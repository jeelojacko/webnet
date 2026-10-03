# Phase 20L.1 Task 5 — offset-radius policy architecture (STUDY)

Follows PR #146; 20L verdict was POLICY_REQUIRED. Zero `src/` changes.
Generator `scripts/phase20l1PolicyCorpus.ts` → `docs/evidence/phase20l1/policy-corpus.json`
(186 rows = 31 joins × 6 criterion families, deterministic, byte-identical ×2).

## 1. P0 admitted predicate (executable)

```
ADMIT_P0(f, fam, ms) :=
  resolveCornerEffective(criterion, members+Z, side, ms).proven  # d from the
      # production resolveAnalyticCriterionAt (DISTANCE | REL_EL | ELEV_FLAT-only;
      # Task-7 module phase20l1EffectiveCriterion.ts, study-only, wired nowhere)
      # Task-9 fix: EACH member resolved at its own elevation, SAME EXACT d
      # (===) required — elevation on differing member flats (5 vs 3) is
      # NOT_PROVEN ELEVATION_MEMBER_MISMATCH, never first-member-only
  && !arcPair(f)                       # arc×arc stays NO_GO_TERMINAL_CHORD_ARC_PAIR
  && joinClass == OFFSET_JOIN_UNIQUE   # classifier verdict, unmodified
  && admissibleCount == 1 && onBody    # B0 fail-closed: ≥2 branches reject
  && exact Roff>0 on every arc member   # ===0 collapse, <0 inverted (predicate gate)
  && d <= ms EXACT                       # criterion-derived d; production comparison (§2)
  && extentJVWithin(|J-V|, ms, scale)    # E1, one shared helper for admission + audit (§2b)
  && C0                                # UNIQUE is on-body ⇒ no extension taken
  && auditCornerCandidacy(f, d, ms).pass  # validation of reported candidates
      # (own geometry, never admission booleans; cannot detect omitted
      # branches — completeness rests on B0); mesh N/A (corner classifier)
```

`d` is criterion-derived, never a fixed label: DISTANCE resolves `D=5`,
REL_EL `Δ/g=5/1`, ELEV_FLAT `(E−z0)/g=(5−0)/1` (flat `z0=0` study-assigned;
plan fixtures carry no Z). ELEV_SLOPED (`z 0→10`), SURF_FIXED, SURF_CUTFILL
resolve to `d=null` with `REJECT_CIRCULARITY_*`; elevation on differing
member flats resolves per-member distances that disagree (`5` vs `3`) and
fails `ELEVATION_MEMBER_MISMATCH` → `REJECT_CIRCULARITY_MISMATCH` (Task-9
Finding 1; distance/rel-el `d` has no source term so members agree by
construction). Mixed-effective groups must
pre-resolve to one `d` (`resolveMixedEffective`: every leg proven, all `d`
identical) or fail `MIXED_EFFECTIVE` / `SURFACE_TARGET`.

Variable-distance (ELEV_SLOPED, SURF_FIXED, SURF_CUTFILL) never reaches the
join: `d=null`, reason `REJECT_CIRCULARITY_*`. AMBIGUOUS multi-branch joins
reject with `REJECT_AMBIGUITY_B0`; NONLOCAL/COLLAPSE/NONE/WRONG_SIDE with
`REJECT_NON_UNIQUE`; arc pairs with `REJECT_ARC_PAIR_NO_GO` (21 rows);
RADIUS-boundary rows (collapse/inversion fixtures in proven families) with
`REJECT_ROFF` (6 rows); over-search criteria with `REJECT_INVALID_CRITERION`.

## 1b. Corner-candidacy audit (Task-7 reviewer fix, Finding 1)

The old `topologyPass` re-read admission fields. It is replaced by
`auditCornerCandidacy` (corpus script, exported for tests): own u-params,
own on-curve residuals against freshly built offset curves, own branch-sign
rule, turn from the production `classifyCorner`, Roff via the predicate's
radial-sign path (independent of the `roffClass` display lookup), and
extent on the recomputed `|J−V|` via the same shared `extentJVWithin`
helper the admission predicate uses (single derivation; §2b). Admission
requires exactly one passing
candidate. Scope honesty (Task-9 Finding 2): the audit independently
validates the *reported* candidates — it loops over the classifier's
candidate set, so it cannot detect an omitted branch and is NOT a proof
of exactly-one-intersection; branch-completeness still rests on B0
fail-closed. Mesh-level topology (area, components, boundary cycles,
self-cross, pinch, seams) is N/A with recorded reason: the admitted terms
are corner joins, not facets — the claim is corner-classifier candidacy,
never a "validated join". Tests recompute the audit live per admitted row
and pin `distV` agreement ≤1e-6.

## 2. Extent conflict resolution (evidence, not compromise)

Scout: gate offset distances at join (`d_in,d_out <= maxSearch`, production
truth). Extent worker: gate `|J-V| <= maxSearch` (study convention).
Measured corner factor on the admitted set: `|J-V|/d = 1.00004–1.41421`
(5.00019/5 shallow, 6.912/5 arc-overlap, 7.071/5 square) — so `|J-V| >= d`
always; the `|J-V|` gate is strictly conservative over the `d` gate.
Adopted rule: require **BOTH** (strictly narrower than either alone, no new
constant — both reuse `maxSearchDistance`). Effect at `ms=6, d=5`: the `d`
gate alone admits 5/5 UNIQUE fixtures; BOTH admits 1/5 (only the shallow
corner, `|J-V|=5.00019`); the square (`7.071`) and arc-overlap (`6.912`)
corners reject with `REJECT_EXTENT_JV`. `miterExtent` stays a comparison
probe, never a routing authority (non-authoritative per scout).

### 2b. Task C — `|J-V|` boundary unification (E1)

Task C found two semantics for one policy: admission compared `distV <= ms`
exactly, while `auditCornerCandidacy` (and the classifier's own `local`
field) compared `distV <= ms + seamParameterAgreementTol(distV, ms, ms,
worldScale)`. Resolved as **E1**: the `|J-V|` gate is
`extentJVWithin(distV, ms, worldScale)` in
`phase20l1EffectiveCriterion.ts` — one shared study helper, called by BOTH
the admission predicate and the audit. It reuses the existing 20J1
quantity-correct agreement authority (`AGREEMENT_OPS ·
max(EPS·scale, coordinateQuantum(worldScale))`); no magic epsilon. The
criterion-derived `d <= maxSearchDistance` gate stays an exact production
comparison (`resolveAnalyticCriterionAt`) and is never relaxed by the E1
rule.

Why E1, not E0 (exact): a 90° line→line join has analytic extent `d·√2`,
so the physical boundary `|J-V| == ms` is reachable exactly. Exact
floating-point comparison makes that boundary frame-dependent — one
representable step below the computed extent, E0 rejects while the
independent audit (already E1) accepts, i.e. admission and its own
validation contradict each other. Boundary fixtures
(`cad_grading_offset_radius_policy_extent_boundary_20l1.test.ts`) pin the
E0/E1 split at exactly one ULP and hold the E1 verdict invariant across
origin 1e6/1e8, rotation 0.9 rad, and scale ×1e3/×1e-3
(`classification == OFFSET_JOIN_UNIQUE`, audit `CANDIDACY_OK`; both
`extentJVWithin` and the audit accept at 1 ULP below the bound, reject
outside the band). Corpus impact: regenerated twice byte-identical; rows
digest unchanged (`dd961f52f2ba9d9a`); admit delta 0 (15→15) — the current
admits were already local under E1, so only the payload `extentRule`
string changed.

## 3. The other three choices

- **Ambiguity B0 FAIL-CLOSED** (adopted): `AA_CCW_CCW_OVERLAP` and
  `SYN_LA_CROSS_2INSPAN` carry 2 on-body admissible branches; nearest-vs-first
  DISAGREE; tangency count discontinuous. B1 rejected → **P1 ≡ P0**.
- **Extension C0 NO-EXTENSION** (adopted): 8 NONLOCAL GAP fixtures + 5 GAP
  synthetics stay rejected; C1 bounded extension rejected (adds policy
  without coverage — no admitted case needs it).
- **Circularity analytic law** (adopted): Distance/RelEl class A always;
  Elevation B iff `startZ===endZ` exactly; Surface D never from source rep.
  Proven-constant 15/30 of the 20L variable matrix; the 2 sampled-constant
  surface rows stay excluded (sampling is not authority). Since Task 7 the
  law is executable study code (`phase20l1EffectiveCriterion.ts` over the
  production resolver): flat/sloped exact boundary (1-ULP slope rejects),
  invalid/degenerate sources, `Roff===0` collapse and `Roff<0` inversion
  boundaries, and mixed-effective groups are all pinned by tests — `d`
  always comes from a resolved pair, never a label.

## 4. Variants

P1 = P0+B1 ≡ P0 (B1 rejected, zero delta). P2 = P0+bounded extension:
rejected (would admit 8 NONLOCAL GAP joins with no coverage need and a new
length constant). P3 (permissive: sampled-constant surface + nearest-branch
+ extension): rejected whole — each relaxation adds policy without a proved
authority. `net: LOCAL plan candidacy 15/186 rows (5 shape-classes × 3 proven
families, incl. 6 arc-bearing) — per-corner candidacy only, NOT route
admission (route needs the full ACTIVE-ROUTE gate: XYZ tie + flatness +
joint continuity + single shared d + topology-clean strip).`

## 5. Invariance design (Task-7 reviewer fix, Finding 2)

The old scale check reused unscaled `d`. Now every scale transform co-scales
the effective criterion with the geometry (DISTANCE `D×k` via the production
`scaleGradingCriterion`, `ms×k`) and compares classification AND the join
point in normalized coordinates (÷k; rotation unrotated, translation
subtracted, mirror unfolded, chain-reversal compared directly). Seven
transforms per admitted fixture: origin 1e6 / 1e8, rotation 0.9 rad,
scale ×1e3 up + ×1e-3 down, mirror-Y (side-flipped), chain order-reversal
(travel-flipped + side-flipped: same physical corner, UNIQUE preserved).
Honest scope note: geometric co-scaling tests classifier math. Under a real
production XY transform only the distance-family `D` scales
(`scaleGradingCriterion`: `Δ/E/g/Z` invariant), so a production-scaled
rel-el corner re-resolves with a changed `d/R` — pinned separately by test,
no admit-stability claimed there.

## 6. Group routing (Tasks B+D+F+H study, R0 whole-chain all-or-fallback, flat-only predicate enforced)

Production routes at two granularities (`gradingGroupCompute.ts`): members
solve standalone (chord path, always available), corners patch/trim
per joint. The study reconciles claim with code at the WIDEST unit (R0):
local P0 candidacy per corner (existing predicate, §1) AND a production XYZ
tie per corner (`xyzRunTieOk`, §15: same required plan `d` + production
analytic acceptance + tie in the same search neighborhood as the built join
(structural locality, NOT numerical agreement) + single-valued daylight-Z
laws AT THE JOIN within production zeroDelta (the tie-at-join law) +
FLAT-ONLY predicate enforced in gate code: each member startZ===endZ
exactly (===, no tolerance) — sloped members reject REJECT_SLOPED_SOURCE
identically from 1e-13 to gross + source-joint continuity enforced in gate code: incoming.endZ===outgoing.startZ exactly (mirrors production exactXyz, gradingGroupCompute.ts:137-138, same === on the Z leg; XY legs coincide by chain construction — a 0-vs-2 step rejects REJECT_SOURCE_JOINT_STEP with true per-member limits 5 vs 7 in provenance)) + a final route decision over the whole
connected chain/group. The gate certifies the ADMITTED JOIN (the built
node), never the analytic tie: offset-intersection vs terminal-miter differ
structurally (0.2277 m on every arc corner), and the T−J condition certifies
ONLY that both points share one search neighborhood — never agreement or
which point is built. Sloped B/C/E corners are INACTIVE by predicate (11 mm
join-law disagreement kept as provenance). EXACT_OFFSET
iff every required corner is a LOCAL_P0_CANDIDATE and join-tied (Z_TIE_OK
path) sharing one proven `d` (closed groups additionally line-only:
LINE_ONLY_EXACT_CONTROL; a closed group containing any arc routes
CHORD_FALLBACK as CURVED_CLOSED_SUPPORT). Otherwise every corner is
INACTIVE_DUE_TO_GROUP_FALLBACK, every member CHORD_FALLBACK (production
member-standalone chord path, label only — the study builds no fallback
geometry and claims no fallback continuity), no exact strip. A failed strip construction revokes the route (defense in depth): strip ok:false forces whole-chain CHORD_FALLBACK with zero active corners and a ROUTE_REVOKED_STRIP_FAIL cause — EXACT_OFFSET is reported only for actually-built + audited strips. A mixed chain
with one local candidate (C/D, local=1) therefore shows active=0: local
candidacy activates nothing alone; a same-d/diff-Z chain (G, local=2,
daylight 5 vs 10) shows active=0 via the XYZ gate
(CHAIN_FALLBACK_XYZ_TIE_MISMATCH), while the flat same-d/same-Z mirror (H,
daylight 5 vs 5) routes EXACT through the wired gate. R1 (fixed-point
partial-exact runs with mixed strips) and R2 (contiguous exact runs with
proven boundary transitions) are NOT adopted — both need an invented
exact↔chord splice no existing authority provides. Exact strip meshes are
study-only AND law-derived: every daylight vertex resolves through its
member's production limit law (`resolveAnalyticCriterionAt` at the member
source Z — never the `z = d` assumption), corner nodes carry the verified
single agreed join Z checked consistent with both incident member limits
(fail closed otherwise), source vertices carry the member source Z; audited
by `auditMesh` + ring simplicity + area agreement. On the flat corpus this
coincides with `z = d` bitwise (pinned by test: all daylight vertices 5,
all sources 0) — the construction, not the values, is what changed.
Sloped exactness is claimed nowhere: no sloped chain routes EXACT. Each
chain records localP0Count, activeExactCorners, per-member representation
(EXACT_OFFSET/CHORD_FALLBACK, uniform under R0), route unit + decision,
strip presence, fallback ref, topology, continuity, route reason; each corner
records the decided tie (`xyzTie` reason code, `tieOk`, laws-at-join
`zIn`/`zOut`, agreed `joinZ`, analytic-tie `tieZ` + `tieJoinDist` provenance).
Artifact: `docs/evidence/phase20l1/group-corpus.json` (18 chains: 12 exact
strips + 6 whole-chain fallbacks, regenerated twice byte-identical); tests pin
gates, ties, continuity, topology, and the curved-vs-line-line split.
