# Phase 20L.1 Task 3 — ambiguity / branch policy (STUDY)

**Verdict: B0 — FAIL-CLOSED.** Any corner with ≥2 admissible local branches, a
coincident/within-noise count, or an unresolved contact stays unsupported.
B1 signed-continuity is *invariant* but **not unique** (two body-internal
branches exist inside production scope) and **not continuous** across
tangency, so it is rejected. Consequently **P1 ≡ P0** (B1 adds nothing).

Scope: study only, **zero `src/` changes**. Generator
`scripts/phase20l1AmbiguityStudy.ts` (all numbers below are its deterministic
output); evidence strings only, no production enum touched.

## B1 stated formally

Orient each terminal's offset curve with the chain travel direction. For an
intersection `J`, its signed along-travel parameters relative to `V` are
`(uIn, uOut)`. `J` is **admissible** iff it lies on both member bodies
(`inSpan`, `phase20lOffsetJoinCore.ts:397`) **and** its branch sign matches the
corner: GAP ⇒ `uIn ≥ 0 ∧ uOut ≤ 0`, OVERLAP ⇒ `uIn ≤ 0 ∧ uOut ≥ 0`
(`branchConsistent`, `:415`). B1 claims the join iff exactly **one** admissible
candidate exists. No nearest-`|J−V|`, no array/root order, no new epsilon.

The classifier already computes this (`joined`, `:603`) but short-circuits on
`localCands.length >= 2` (`:642`), so it labels 12 fixtures AMBIGUOUS. B1 is the
proposal to replace that short-circuit with "unique admissible ⇒ join".

## Why B1 fails

1. **Two admissible branches inside production scope.** `SYN_LA_CROSS_2INSPAN`
   (line→arc left, incoming body 300 m, outgoing **180°** arc) has both offset
   intersections on both bodies: `admissible = 2`. So does the arc→arc
   reference `AA_CCW_CCW_OVERLAP`. B1 cannot name one.
2. **No signed-continuity derivation picks between them.** The two
   direction-independent candidates — *first crossing in forward traversal*
   (B1's own reading) and *nearest to `V`* (the true trimmed offset-envelope
   branch, a nearest-point heuristic, explicitly forbidden) — select
   **different physical points** (`DISAGREE=true`) in exactly those cases:
   `SYN` nearest `(−5.279,5)` vs first `(−94.721,5)`; `AA_CCW_CCW_OVERLAP`
   nearest `(−5.315,5.315)` vs first `(−44.685,44.685)`. Signed continuity
   alone does not determine the geometrically correct trim; the correct trim is
   a nearest/inside-envelope property.
3. **Branch count is discontinuous at tangency.** `R = 2d`: `R=9.999999` → 0
   intersections (`OFFSET_JOIN_NONE`, `disc=−1e−5`); `R=10` → unresolved,
   `disc=0` inside the conditioning band (`:629`); `R=10.000001` → 2 local
   joins (`disc=+1e−5`). A selector must jump at tangency, or introduce a new
   epsilon to straddle it — forbidden. Fails "continuous under small
   non-degenerate perturbations / no selection across degeneracy".
4. **Count-unknowable degeneracies.** `LA_TANGENT_CONTACT` and
   `AA_COINCIDENT_SAME_CENTER` (`:623`) have no countable branch; no signed
   rule may fabricate one.

## Per-fixture evidence (12 AMBIGUOUS + synthetics)

`int/local/cons/inSpan` = geometric intersections / local / branch-consistent /
on both bodies. B1 outcome is the study-only label.

| fixture | class | int/loc/cons/inSpan | adm | B1 outcome |
|---|---|---|---|---|
| `LA_CCW_OVERLAP` | AMBIGUOUS | 2/2/2/**1** | 1 | CONTINUOUS (`J=(−5.279,5)`) |
| `AL_CCW_OVERLAP` | AMBIGUOUS | 2/2/2/**1** | 1 | CONTINUOUS |
| `AA_UNEQUAL_OVERLAP` | AMBIGUOUS | 2/2/2/**1** | 1 | CONTINUOUS |
| `LA_CW_GAP` | AMBIGUOUS | 2/2/2/**0** | 0 | EXTENSION (needs body extension) |
| `AL_CW_GAP` | AMBIGUOUS | 2/2/2/**0** | 0 | EXTENSION |
| `AA_CCW_CCW_GAP` | AMBIGUOUS | 2/2/**1**/0 | 0 | EXTENSION |
| `AA_CW_CW_GAP` | AMBIGUOUS | 2/2/2/**0** | 0 | EXTENSION |
| `AA_CCW_CW_GAP` | AMBIGUOUS | 2/2/**1**/0 | 0 | EXTENSION |
| `AA_UNEQUAL_GAP` | AMBIGUOUS | 2/2/**1**/0 | 0 | EXTENSION |
| `AA_CCW_CCW_OVERLAP` | AMBIGUOUS | 2/2/2/**2** | **2** | **AMBIGUOUS (fails)** |
| `LA_TANGENT_CONTACT` | AMBIGUOUS | 0/0/0/0 | 0 | UNRESOLVED |
| `AA_COINCIDENT_SAME_CENTER` | AMBIGUOUS | 0/0/0/0 | 0 | UNRESOLVED |
| `SYN_LA_CROSS_2INSPAN` | AMBIGUOUS | 2/2/2/**2** | **2** | **AMBIGUOUS (fails)** |
| `SYN_LA_NEAR_TANGENT_R9.999999` | NONE | 0/0/0/0 | 0 | NONE |
| `SYN_LA_NEAR_TANGENT_R10` | AMBIGUOUS | 0/0/0/0 | 0 | UNRESOLVED |
| `SYN_LA_NEAR_TANGENT_R10.000001` | AMBIGUOUS | 2/2/2/**2** | **2** | **AMBIGUOUS (fails)** |

Finding: of the 12 AMBIGUOUS fixtures, 9 resolve to a unique-on-body branch
or pure extension, 2 are count-unknowable degeneracies, and exactly 1
(`AA_CCW_CCW_OVERLAP`) has ≥2 admissible on-body branches; the synthetic case
extends that failure into production scope (line→arc).

## Invariance results

On both failing cases, `admissible` count and the selected world point are
preserved under rotation `0.9 rad`, translation `(123.4, −56.7)`, uniform
scale `×1000`, and member-order reversal (all four stay `AMBIGUOUS`, adm=2,
same nearest and same first point). B1's *classification* is therefore
invariant; it is **identity and continuity** that fail. Translation/rotation
are exact (local V-frame, `:575`); scaling and reversal are study-local
(`scaleInput`/`reverseInput`, generator). No new epsilon governs any physical
class.

## P-variant implication

`P1 = P0 + B1` **iff B1 passes**. B1 fails (items 1–4), so adopting it would
either auto-pick a branch across degeneracy or pick the geometrically wrong
branch. Therefore **P1 collapses to P0**: the conservative subset
(`OFFSET_SAMPLED_CONSTANT_DISTANCE`, `Roff > 0`, `OFFSET_JOIN_UNIQUE` only)
stands, and every multi-branch/degenerate join remains fail-closed. Any future
P1 needs a *proved* disambiguation authority, not a signed heuristic.

## Study-only vocabulary (no production enum)

`OFFSET_POLICY_JOIN_CONTINUOUS` (unique admissible), `OFFSET_POLICY_JOIN_AMBIGUOUS`
(≥2 admissible → fail-closed), `OFFSET_POLICY_JOIN_EXTENSION` (branches exist
off-body), `OFFSET_POLICY_JOIN_UNRESOLVED` (count unknowable:
coincident/within-noise), `OFFSET_POLICY_JOIN_NONE`. Defined in the generator
only; production retains `OFFSET_JOIN_*` (`phase20lOffsetJoinCore.ts:104`).

**Cite:** `scripts/phase20l1AmbiguityStudy.ts`; classifier
`phase20lOffsetJoinCore.ts:397,415,603,642`; fixtures
`phase20lOffsetRadiusVariants.ts:269,274,295,301`. `git diff -- src` empty.
