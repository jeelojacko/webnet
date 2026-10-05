# Phase 20Q.1 — Policy: singular sloped predicate + cardinality gate

## Singular sloped predicate (as shipped)

Admit exactly one `trp1` / `TRANSITION_LINEAR_V1` transition per open group
iff **all** of the 20M.2 gates hold unchanged, with the single relaxation:

1. **Exact collinearity** (`cross === 0 && dot > 0`) — unchanged.
2. **Joint continuity**: if either incident member is non-flat, then
   `left.endZ === right.startZ === input.jointZ` and all four member Zs are
   finite; otherwise the pre-20Q.1 both-flat rule holds. Any other non-flat
   input rejects `NON_FLAT` (before `JOINT_Z_STEP`).
3. **Exact joint Z step**: `left.endZ === right.startZ === input.jointZ`
   (`JOINT_Z_STEP`) — untouched; a 1-ULP step rejects, a 1-ULP slope admits.
4. Family / grade / side / width / native-criterion / open-group gates —
   unchanged from 20M.2 (`GRADE_MISMATCH`, `SIDE_MISMATCH`,
   `WIDTH_INFEASIBLE`, `FAMILY_MISMATCH`, `NATIVE_CRITERION`, …).

So a sloped pair is admissible at **any** finite nonzero slope as long as the
joint stays exactly continuous; the slope itself is never bounded or
quantified.

## The SLOPED_CARDINALITY gate

There is one central authority (the task's "SLOPED_CARDINALITY" gate):

```
checkSlopedPluralUnstudied(intentCount, transitionedJointFlat[])
  → null when intentCount ≤ 1, or every transitioned joint is exactly flat
  → 'SLOPED_PLURAL_UNSTUDIED: plural transition sets on NON_FLAT joints are unstudied (singular sloped only)'
```

It never sorts, never inspects law/family, and never substitutes a faked
per-joint `transitionCount` — per-joint `trp1` admission still owns content.
It is wired at **four** sites, so no path can admit a sloped plural set:

| Site | File | Reject surface |
|------|------|----------------|
| engine plural tiler | `gradingGroupTransitionPlural.ts` | `TRANSITION_REJECTED` / `GRADING_AGREEMENT_TRANSITION_NON_FLAT` |
| service request assembly | `surfaceGradingService.ts` | `TRANSITION_REJECTED` / `…NON_FLAT` |
| worker plans agreement | `surfaceGradingCompute.ts` | `GRADING_AGREEMENT_TRANSITION_GEOMETRY` |
| authoring eligibility | `gradingTransitionAuthoring.ts` | ineligible reason ("singular sloped only") |

> Naming note: the literal constant is `checkSlopedPluralUnstudied` returning
> `SLOPED_PLURAL_UNSTUDIED`; there is no symbol named `SLOPED_CARDINALITY` in
> the tree. The predicate is the cardinality gate over singular-vs-plural.

## Unchanged exclusions (still fail closed)

- Joint-step (`JOINT_Z_STEP`, study verdict `NO_GO_JOINT_Z_STEP_SOURCE_DISCONTINUITY`).
- Non-collinear / bent joints.
- Arc members (`NON_LINE`) and closed groups (`CLOSED` → group `TRANSITION_REJECTED`,
  detail `GRADING_AGREEMENT_TRANSITION_CLOSED`).
- Surface/fixed criteria and mixed-family (`FAMILY_MISMATCH`).
- Width `> 2·min` and non-finite Z/width.
- Stale / malformed / endpoint-evidence-mismatched intents.
- Plural sets with any non-flat joint (the gate above); duplicate/out-of-order/
  malformed joint ids (`CARDINALITY`).

## Scoping boundary: elevation member-plane gate

Elevation at ±15% / ±50% slope still fails at the **pre-existing
member-plane** gate (`MEMBER_NO_SOLUTION`), before any transition tiling:
the fixed-plane member solve rejects a source whose Z trend runs away from
the target plane. This is deliberately **not** relaxed here — admission owns
the sloped transition scope, the member solver owns plane feasibility.
Pinned by the robust suite (`cad_grading_transition_robust_20q1.test.ts`,
rows `p15`/`m15`/`p50`/`m50` with `family === 'elevation'`).

## What this is not

- **20Q study**: study-side per-station-Z validator extension was a study
  probe; the shipped rule is the production predicate + gate above.
- **A new law/tolerance/schema/default**: none introduced.
- **Partial plural**: a sloped plural set is never partially applied.
