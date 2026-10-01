# Phase 20K.3 — Surface authority performance

Measurement only. No thresholds. Harness:
`scripts/phase20k3SurfaceAuthorityPerf.ts`
(`npx tsx scripts/phase20k3SurfaceAuthorityPerf.ts [--quick]`).

Fixtures are built once, outside every timed region. Each stage times the
actual production entry point; `ms` is the median of 5 reps (Node v26.8.1,
branch `fix/phase20k3-surface-curve-authority-certificate`, base `884b36e8`,
2026-10-01). Nothing gates CI and exactness is never relaxed for speed.

## 1. Expected-topology derivation (`deriveGradingTopologyExpectation`)

Pre-mesh declaration derived from the definition, never from the mesh.

| case | shape | components | cycles | tiedStations | ms |
|---|---|---|---|---|---|
| standalone.open | open-strip | 1 | 1 | 0 | 0.002 |
| standalone.split-3 | split-open-strips | 3 | 3 | 3 | 0.003 |
| standalone.empty-tied | empty-tied | 0 | 0 | 0 | 0.000 |
| group.closed-annulus | closed-annulus | 1 | 2 | 0 | 0.000 |
| group.open-2 | split-open-strips | 2 | 2 | 0 | 0.000 |

`countPositiveWidthStationRuns` (6 stations, stations 2–3 tied) = 2 regions in
0.001 ms. Derivation is pure arithmetic on the declaration — sub-microsecond,
independent of mesh size.

## 2. Boundary-cycle validation by mesh size

Planar fan disk, `validateGradingMeshTopology` against the declared 1-component
/ 1-cycle budget, plus `traceBoundaryCycles` on the boundary edge list.

| boundaryEdges | V | F | E | B | measured components | validate (1/1) | validateMs | traceMs |
|---|---|---|---|---|---|---|---|---|
| 16 | 17 | 16 | 32 | 16 | 1 | ok:1/1 | 0.098 | 0.012 |
| 64 | 65 | 64 | 128 | 64 | 1 | ok:1/1 | 0.338 | 0.014 |
| 256 | 257 | 256 | 512 | 256 | 1 | ok:1/1 | 2.441 | 0.056 |
| 1024 | 1025 | 1024 | 2048 | 1024 | 1 | ok:1/1 | 9.413 | 0.237 |
| 4096 | 4097 | 4096 | 8192 | 4096 | 1 | ok:1/1 | 128.7 | 1.492 |

`traceBoundaryCycles` is linear in the boundary size (≈0.36 µs/edge at 4096).
`validateGradingMeshTopology` is super-linear (4× boundary ≈ 13.7× time from
1024→4096) because the geometric pass audits non-adjacent faces. Both are
bounded post-assembly stages; the 128.7 ms at 4096 boundary edges is the
worst case recorded here.

## 3. gtop1 vs gtop2 digest + certificate construction

| mesh | digest bytes txt/bin | hashMs gtop1/gtop2 | gtop1 FNV digest | gtop2 SHA-256 | gtop1 cert | gtop2 cert | certMs gtop1/gtop2 |
|---|---|---|---|---|---|---|---|
| square.all-Surface | 6753 / 4608 | 0.081 / 0.257 | `470d161e` | `13325eaa89530a26…` | gtop1 | gtop2 | 0.962 / 0.831 |
| tied-split.arc | 519 / 360 | 0.006 / 0.023 | `5e897190` | `3fda6349a94981a0…` | gtop1 | gtop2 | 0.170 / 0.105 |

`txt` = bytes of the `toPrecision(12)` text gtop1 hashes (FNV-1a, 32-bit);
`bin` = the gtop2 payload (F64 coords ×8 + u32 indices ×4 + tied coords ×8)
hashed with SHA-256 (256-bit). gtop2 is exact per coordinate and strictly
stronger; its cost is ~2–4× the gtop1 text digest and remains sub-millisecond.

Exactness probe at projected/stress magnitude (quad at E=1e8 shifted +1e-4 m):

```
gtop1 collision=true (same FNV digest), gtop2 diverges=true
```

This is the false-accept gtop2 closes: the 12-significant-digit quantum at
1e8 is 1e-4, so gtop1 cannot see the shift; gtop2 hashes the exact Float64
bits and the digests differ.

## 4. gtop2 product revalidation

| cert | version | expected C | expected cycles | verify/exact/product ms | product gate |
|---|---|---|---|---|---|
| square.all-Surface | gtop2 | 1 | 2 | 1.026 / 1.147 / 1.105 | ok / ok / ok |
| tied-split.arc | gtop2 | 2 | 2 | 0.115 | `GRADING_TOPOLOGY_MULTI_REGION_NOT_EXPORTABLE` |

- `square.shifted(+1e-9)`: exact revalidation →
  `GRADING_TOPOLOGY_CERTIFICATE_EXACT_DIGEST` (the gtop1 false-accept above is
  closed).
- stress quad gtop2 cert: expected 1/1, payload 120 bytes; revalidate base →
  ok, revalidate shifted → `GRADING_TOPOLOGY_CERTIFICATE_EXACT_DIGEST`.

Revalidation rebuilds every digest from the presented buffers and reruns the
topology pass against the certificate's declared budget; it is O(mesh) and
~1 ms on the 128-face square.

## 5. All-Surface square Calculate + Surface source canonicalization

Real closed rounded-square group (`GROUP_CREATE`, all-Fixed/Surface,
tolerance 0.1).

| fixture | V | F | E | B | C exp/meas | cycles exp/meas | facets | calcMs |
|---|---|---|---|---|---|---|---|---|
| square | 128 | 128 | 256 | 128 | 1/1 | 2/2 | 2 | 6.523 |

- Source canonicalization: raw captured `sourceBoundaryPoints` = **89 stations
  → canonical 32 stations**, **microEdges = 0**, in 0.008 ms
  (`resolveDesignPatchRing`). The Wave C single exact linearized joint
  replaces the ULP-twin seam tips; the canonical ring has one vertex per seam
  and no plan-micro edges.
- Mesh digest bytes = 4608, digest = `18521e218439f106…` (gtop2).

## 6. Worker agreement

| check | daylight vertices | ms | result |
|---|---|---|---|
| square.all-Surface.daylight | 96 | 0.151 | ok |
| square.all-Surface.tampered (+1 m) | 96 | 0.002 | `GRADING_AGREEMENT_DAYLIGHT_Z` |
| arc.standalone.result (daylight + source) | 23 | 0.041 | ok |

Source-boundary half (real arc): captured arc endpoints = **ok**;
the deleted `start + chordDir·arcLength` reconstruction =
`GRADING_AGREEMENT_SOURCE_BOUNDARY` (overshoot 0.665339 m) in 0.001 ms.
The anchored bound accepts the genuine arc-evaluation rounding and rejects the
chord-length overshoot by orders of magnitude.

## 7. Tied split (real Surface arc)

| fixture | V | F | E | B | C exp/meas | cycles exp/meas | facets | calcMs |
|---|---|---|---|---|---|---|---|---|
| standalone.surface.arc.tied | 11 | 6 | 14 | 10 | 2/2 | 2/2 | 270 | 7.468 |

Digest bytes = 336, digest = `bb47d4772c49510b…`, `cycleSizes = [3, 7]`. The
whole-call production compute dominates; the gtop2 certificate records the
declared 2/2 budget and its product gate returns
`GRADING_TOPOLOGY_MULTI_REGION_NOT_EXPORTABLE` (§4).

## 8. Local / projected / stress coordinate agreement

`anchoredElevationAgreementTol` (shared authority) by coordinate magnitude;
2000 daylight vertices per case.

| coords | agreement bound | dz 1e-8 | dz 1e-3 | points | ms |
|---|---|---|---|---|---|
| local (0,0) | 1.000e-9 | `GRADING_AGREEMENT_DAYLIGHT_Z` | `GRADING_AGREEMENT_DAYLIGHT_Z` | 2000 | 0.394 |
| projected (5e6,5e6) | 2.232e-8 | ok | `GRADING_AGREEMENT_DAYLIGHT_Z` | 2000 | 0.415 |
| stress (1e8,1e8) | 4.273e-7 | ok | `GRADING_AGREEMENT_DAYLIGHT_Z` | 2000 | 0.289 |

Local leverageless bound = `elevationAgreementTol(0,0,[]) + AGREEMENT_FLOOR` =
1.000e-9. The plane leverage justifies 1e-8 m at projected and stress
coordinates (they pass) while a millimetre fails everywhere. Agreement is one
linear pass over the daylight polyline (~0.2 µs/vertex).

## 9. Design Patch (`resolveDesignPatch`)

| fixture | V | F | ms | result |
|---|---|---|---|---|
| all-Surface.rounded-square | 128 | 158 | 1.850 | ok |

The canonical 32-station ring ear-clips and merges into one 128-vertex /
158-triangle `design-patch` surface; sub-2 ms.

## 10. Summary

- **heap**: `heapUsed = 64.7 MB`, `rss = 175.8 MB` at end of run.
- **dominant stage**: the whole-call Calculate solve (seam / merge / source
  canonicalization / certificate are internal to it). gtop2 digest and
  certificate are the bounded post-assembly stages (sub-millisecond on the
  128-face square); gtop2 product revalidation ~1 ms; worker agreement is one
  linear pass; boundary-cycle validation is super-linear only in the boundary
  size (128.7 ms at 4096 boundary edges).
- **no thresholds**: nothing here gates CI. These numbers record the 20K.3
  cost surface so a future change has a baseline to compare against. Exactness
  (gtop2 Float64-bit digest, declared pre-mesh budgets) is never traded for
  speed.

## 11. Provenance

- `scripts/phase20k3SurfaceAuthorityPerf.ts`.
- Raw console output (same run): see the appendix below.

## Appendix — raw output

```
phase20k3 Surface authority perf (5 reps, median) — times in ms
fixtures built outside all timed regions; production entry points only

== expected-topology derivation (deriveGradingTopologyExpectation) ==
case                   shape              components  cycles  tiedStations  ms
---------------------  -----------------  ----------  ------  ------------  -----
standalone.open        open-strip         1           1       0             0.002
standalone.split-3     split-open-strips  3           3       3             0.003
standalone.empty-tied  empty-tied         0           0       0             0.000
group.closed-annulus   closed-annulus     1           2       0             0.000
group.open-2           split-open-strips  2           2       0             0.000
countPositiveWidthStationRuns: 6 stations, tied {2,3} -> regions=2 (0.001 ms)

== boundary-cycle validation (validateGradingMeshTopology + traceBoundaryCycles) ==
boundaryEdges  V     F     E     B     measured components  validate (1/1)  validateMs  traceMs
-------------  ----  ----  ----  ----  -------------------  --------------  ----------  -------
16             17    16    32    16    1                    ok:1/1          0.098       0.012
64             65    64    128   64    1                    ok:1/1          0.338       0.014
256            257   256   512   256   1                    ok:1/1          2.441       0.056
1024           1025  1024  2048  1024  1                    ok:1/1          9.413       0.237
4096           4097  4096  8192  4096  1                    ok:1/1          128.7       1.492

== gtop1 vs gtop2 digest + certificate construction ==
mesh                digest bytes txt/bin  hashMs gtop1/gtop2  gtop1 FNV digest  gtop2 SHA-256     gtop1 cert  gtop2 cert  certMs gtop1/gtop2
------------------  --------------------  ------------------  ----------------  ----------------  ----------  ----------  ------------------
square.all-Surface  6753/4608             0.081/0.257         470d161e          13325eaa89530a26  gtop1       gtop2       0.962/0.831
tied-split.arc      519/360               0.006/0.023         5e897190          3fda6349a94981a0  gtop1       gtop2       0.170/0.105
stress 1e8 + 1e-4: gtop1 collision=true (same FNV digest), gtop2 diverges=true

== gtop2 product revalidation ==
cert                version  expected C  expected cycles  verify/exact/product ms  product gate
------------------  -------  ----------  ---------------  -----------------------  --------------------------------------------
square.all-Surface  gtop2    1           2                1.026/1.147/1.105        ok / ok / ok
tied-split.arc      gtop2    2           2                0.115                    GRADING_TOPOLOGY_MULTI_REGION_NOT_EXPORTABLE
square.shifted(+1e-9): exact revalidation -> GRADING_TOPOLOGY_CERTIFICATE_EXACT_DIGEST
stress.quad gtop2 cert: expected=1/1 bytes=120
stress.quad gtop2 revalidate (base) -> ok
stress.quad gtop2 revalidate (shifted) -> GRADING_TOPOLOGY_CERTIFICATE_EXACT_DIGEST

== all-Surface square (Calculate) + source canonicalization ==
fixture  V    F    E    B    C exp/meas  cycles exp/meas  facets  calcMs
-------  ---  ---  ---  ---  ----------  ---------------  ------  ------
square   128  128  256  128  1/1         2/2              2       6.523
source canonicalization: raw=89 stations -> canonical=32 stations, microEdges=0 (0.008 ms)
mesh digest bytes=4608 digest=18521e218439f106

== worker agreement ==
check                        daylight vertices  ms     result
---------------------------  -----------------  -----  ----------------------------
square.all-Surface.daylight  96                 0.151  ok
square.all-Surface.tampered  96                 0.002  GRADING_AGREEMENT_DAYLIGHT_Z
arc.standalone.result        23                 0.041  ok
source boundary: captured arc endpoints=ok, chord×arcLength overshoot=GRADING_AGREEMENT_SOURCE_BOUNDARY (overshoot=0.665339 m, 0.001 ms)

== tied split (real Surface arc) ==
fixture                      V   F  E   B   C exp/meas  cycles exp/meas  facets  calcMs
---------------------------  --  -  --  --  ----------  ---------------  ------  ------
standalone.surface.arc.tied  11  6  14  10  2/2         2/2              270     7.468
digest bytes=336 digest=bb47d4772c49510b cycleSizes=[3,7]

== agreement bound by coordinate magnitude ==
coords               agreement bound  dz 1e-8                       dz 1e-3                       points  ms
-------------------  ---------------  ----------------------------  ----------------------------  ------  -----
local (0,0)          1.000e-9         GRADING_AGREEMENT_DAYLIGHT_Z  GRADING_AGREEMENT_DAYLIGHT_Z  2000    0.394
projected (5e6,5e6)  2.232e-8         ok                            GRADING_AGREEMENT_DAYLIGHT_Z  2000    0.415
stress (1e8,1e8)     4.273e-7         ok                            GRADING_AGREEMENT_DAYLIGHT_Z  2000    0.289
local leverageless bound = elevationAgreementTol(0,0,[]) + AGREEMENT_FLOOR = 1.000e-9

== Design Patch (resolveDesignPatch) ==
fixture                     V    F    ms     result
--------------------------  ---  ---  -----  ------
all-Surface.rounded-square  128  158  1.850  ok

heap: heapUsed=64.7 MB rss=175.8 MB
dominant stage: the whole-call Calculate solve (seam/merge/canonicalization/certificate internal to it); gtop2 digest + certificate are the bounded post-assembly stages, and agreement is one linear pass over the daylight polyline.
```
