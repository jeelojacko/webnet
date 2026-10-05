# Phase 20Q — joint Z-step laws (J1 / J2 / J3 / J4)

Study-only. Zero `src/` changes. Step matrix = 156 cases × 4 laws = 624 rows
of `docs/evidence/phase20q/corpus.json`. A step case has `jointZR - jointZL =
step ≠ 0` exactly (never epsilon-tied; 1 ULP classifies as step). All plan
geometry is collinear along +X; only joint Z is discontinuous.

## 1. The four laws

| Law | Source Z | Daylight Z | Certifies? |
|---|---|---|---|
| **J1** physical-step | keeps the step (per half, native) | from physical source | gtop2 **refused** on nonzero step (144/144) |
| **J2** linear bridge | Z linearly bridged across `[sL,sR]` | from bridged source | certifies (156/156) — **but alters source** |
| **J3** daylight-only bridge | keeps the step | bridged daylight | gtop2 **refused** (144/144) |
| **J4** step-at-joint | keeps the step | pinned to `jointZL` for the whole law | gtop2 **refused** (144/144) |

Every law certifies and tiles the continuous (step = 0) control (12/12 each).
At the 1-ULP scale, J2's half-step bridge can round back to `jointZL`; the
study therefore pins J2 by its **exact bridge formula** (`jointZL +
(jointZR-jointZL)·t`), not by trusting the rounded float.

## 2. C0 and reversal evidence

| Metric (nonzero-step max) | J1 | J2 | J3 | J4 |
|---|---|---|---|---|
| `c0JointGap` | step (2× for elevation) | 0 | step (2× for elevation) | **0** |
| `c0CutL` | 0 | 0 | 0 | 0 |
| `c0CutR` | 0 | 0 | 0 | **step (2× for elevation)** |
| reversal deviation | 0 | 0 | 0 | `|step|` (distance/rel-el) / `2×|step|` (elevation), max 20 m |
| source preserved | yes | **no** | yes | yes |

- J1/J3 fail C0 at the joint by construction: the two halves genuinely sit at
  different Z. For distance/relative-elevation the gap equals `step`; for the
  elevation family the same target is reached at different horizontal offset
  from different source Z, so the gap is `step/g` (`g = 0.5` → 2× step; max
  `20 m` at `step = 10`).
- J2 is the only law with a zero joint gap, bought by rewriting surveyed Z —
  categorically forbidden (`NON_FLAT`/`JOINT_Z_STEP` exist for this).
- J4 forces `c0JointGap = 0` by pinning the whole law to `jointZL`, but it
  ignores `jointZR`: the right cut daylight is off by `step/g` and the law is
  **asymmetric under traversal reversal**. For `distance`/
  `relative-elevation` the reversal deviation is exactly `|step|`; for
  `elevation` the absolute targets re-resolve on reversal, so it is
  `2×|step|` (ULP step → 2-ULP reversal; max `20 m` at `step = 10`). Pin
  per family. J4 is not reversal-stable.

**Source-Z-aware check (B2, per family), on rewrite rows:** J1 keeps the
physical source and **passes 156/156**; J2 fails `study-sourceZ-divergent`
(the source is bridged); J3/J4 fail `study-daylight-divergent` (daylight
bridge / fixed-Z daylight). The zero-step controls PASS for every law, so the
check is discriminating, not blanket. Persisted-field recompute (B3) matches
2622/2622 rows; the 5 agreement probe classes are **strict per probe** (each
**102 caught / 2520 inapplicable / 0 missed** — the 102 flat controls the
agreement gate admits, the other 2520 untampered-reject
`GRADING_AGREEMENT_TRANSITION_GEOMETRY`), and the width probe through the real
`validateTransitionResultMesh` (larger untampered pass set) is 894 caught /
1728 inapplicable / 0 missed. The step verdict is unchanged by the round-2
validator rescope: `NO_GO_JOINT_Z_STEP_SOURCE_DISCONTINUITY`.

## 3. The seven key joint-step questions

1. **Is a coincident-XY, distinct-Z joint representable in the source/group
   model?** Only as a vertical face/segment. The source is a single polyline;
  two points at the same plan position with different Z is a discontinuity,
   not a resolvable planar joint. Evidence: every source-preserving law
   (J1/J3/J4) is refused by gtop2; only the source-destroying law (J2)
   certifies.
2. **Does holding the step require mutating the source?** No — J1/J3/J4 keep
   it exactly. But then C0 fails (J1/J3) or the law is reversal-asymmetric
   (J4). Removing the source mutation is not the same as making it work.
3. **Does the group topology admit a stepped source boundary?** No. The strip
   mesh ties cells between source and daylight polylines; a vertical source
   discontinuity produces a degenerate/non-manifold boundary that gtop2
   refuses on **432** source-preserving nonzero-step rows (J1/J3/J4 × 144).
4. **Does the worker agree?** No. `checkGroupTransitionAgreement` rejects
   every nonzero-step intent at `GRADING_AGREEMENT_TRANSITION_GEOMETRY`
   (re-admission → `JOINT_Z_STEP`), and the production `exactXyz`
   joint-continuity gate (`gradingGroupCompute.ts`:306–308) already refuses
   the group before tiling, surfacing as code `CORNER_INVERTED` with detail
   `GRADING_GROUP_CORNER_MISMATCH`.
5. **Is C0 attainable without mutating the source?** No. J2 attains C0 only by
   bridging (mutating) the source; J4 fakes joint C0 by ignoring `jointZR` and
   pays with a right-cut gap and reversal asymmetry. No law achieves
   true C0 + source preservation + reversal stability.
6. **Is a step stable under identity transforms?** Mirror/translate are fine
   where defined, but J4's reversal deviation is `= step` (2× for elevation),
   i.e. a step is not a traversal-symmetric feature under J4. J1/J3 reverse,
   but never certify.
7. **Is a step a source discontinuity or a resolvable law choice?** It is a
   **source discontinuity**. The only certifying law is the one that destroys
   the surveyed source; every source-preserving representation is either
   non-manifold (J1/J3) or asymmetric (J4). Under the current planar-strip
   group contract, a joint Z step has no lawful representation.

## 4. Verdict input

No candidate survives: J2 is categorically forbidden (alters source), and
J1/J3/J4 are gtop2-refused on nonzero step; J4 also fails reversal. The
source-Z-aware check agrees (only J1's physical source is daylight-exact per
family; J2 bridges it, J3/J4 diverge). The step is a source discontinuity, not
a missing law parameter → `NO_GO_JOINT_Z_STEP_SOURCE_DISCONTINUITY`
(`decision.md`). A vertical-face topology would be a new model and a new
study, not a relaxation of this one.
