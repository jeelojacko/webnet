# Phase 20Q.1 — Source-Z authority: per-station physical Z

## The shared authority

One function owns physical source Z on a straight member, shared by the
engine tiler and the worker validator (no duplicated formula):

```
transitionSourceZAt({ startZ, endZ, length }, station)
  guards: startZ/endZ/length/station finite, length > 0  → else NaN (fail closed)
  flat (startZ === endZ)                                  → startZ          (bitwise)
  station === 0                                           → startZ
  station === length                                      → endZ
  otherwise                                               → startZ + (endZ - startZ) * (station / length)
```

Located in `src/engine/cad/grading/gradingTransitionPolicy.ts`. It is exact
at exact endpoints, and reduces bitwise to the old frozen Z on flat members
(the flat parity guarantee). Non-finite input yields `NaN`, so callers fail
closed (`GRADING_AGREEMENT_TRANSITION_MESH: non-finite cut source Z`).

## Per-station-Z tiling

`planTransitionJoint` (`gradingGroupTransitionTile.ts`) tiles the interval
`[-W/2, +W/2]` around the joint:

- `Z = mL.endZ` — the joint daylight is computed at the exact joint Z.
- `cutLStation = Lj - W/2`, `cutLZ = transitionSourceZAt(leftMember, cutLStation)`.
- `cutRStation = W/2`, `cutRZ = transitionSourceZAt(rightMember, cutRStation)`.
- Outer native sub-solves use the **member's own** `startZ`/`endZ`:
  `{ startZ: mL.startZ, endZ: cutLZ }` on the left and
  `{ startZ: cutRZ, endZ: mR.endZ }` on the right (previously both frozen to `Z`).
- Shared object refs (`pCutL/qCutL`, `pCutR/qCutR`) keep the C0 join exact:
  the interior never moves the source, only the daylight.

Pinned by `cad_grading_transition_mesh_20m2.test.ts` ("20Q.1 S1:
joint-continuous sloped pair admits and tiles end to end"), which asserts the
verbatim checkpoint arrays, e.g. a `10 → 11` left member with a flat `11`
right member yields source checkpoints `[-4,0,10.8, 0,0,11, 4,0,11]` and
daylight `[-4,5,13.3, 0,6,14, 4,7,14.5]`.

## Family formulas (daylight, at scalar v and source Z)

`transitionDaylightAt` (tiling) and the worker validator agree on the
family mapping:

| Family | plan offset `d` | daylight Z |
|--------|-----------------|------------|
| `distance` | `d = v` | `z = Z(s) + g·d` |
| `relative-elevation` | `d = v / g` | `z = Z(s) + v` |
| `elevation` | `d = (v - Z(s)) / g` | `z = v` (fixed target plane) |

`Z(s)` is the checkpoint's own source Z. `validateTransitionResultMesh`
computes the interior expected offset exactly this way (elevation uses
`(expectedV - source.z)/g`, distance expected Z uses `source.z + g·expectedV`),
and `checkNativeBoundary` resolves each boundary criterion at that
checkpoint's own `srcZ` rather than a frozen `jointZ`.

## Evidence

- `tests/cad_grading_transition_sloped_20q1.test.ts` — daylight formulas use
  per-station source Z, never a frozen jointZ (distance/rel-elev/elevation).
- `tests/cad_grading_transition_sloped_20q1.test.ts` — `plans CURRENT,
  joint-Z continuous` (V.z stays exactly `jointZ`; tie matches the V1 scalar).
- `tests/cad_grading_transition_robust_20q1.test.ts` — real solve + worker +
  gtop2 across the slope sweep, XY 1e6/1e8, Z shift +1e6, mirror, reversal.

## What this is not

- **Cross-joint interpolation**: left half reads the left member, right half
  the right member — never a blended/interpolated Z across the joint.
- **A new tolerance**: existing coordinate/elevation agreement authorities
  are reused unchanged.
- **C1**: the join is C0 by shared refs; no tangent smoothing is claimed.
