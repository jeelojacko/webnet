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
  && d <= ms && |J-V| <= ms            # BOTH extent gates (§2)
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
extent on the recomputed `|J−V|`. Admission requires exactly one passing
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
authority. `net: P0 admits 15/186 rows (5 fixtures × 3 proven families).`

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
