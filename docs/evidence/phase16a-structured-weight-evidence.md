# Phase 16A structured-weight evidence (evidence only)

No production numerical behavior changes. No production weight representation
changes. No solver routing changes. All measurements come from
`tests/evidence/phase16a_weight_sparsity.test.ts`,
`tests/evidence/phase16a_structured_prototypes.test.ts`, and the shared helper
`tests/evidence/phase16aWeightEvidenceShared.ts` (registered in
`scripts/testTiers.ts` as evidence-tier). Machine artifacts (gitignored):
`artifacts/evidence/phase16a/phase16a-sparsity.json` and
`artifacts/evidence/phase16a/phase16a-prototypes.json`.

Method: synthetic networks assemble through the real production entry point
(`assembleAdjustmentEquations`) with production GPS / GNSS-baseline /
TS-correlation (rho 0.5, set and setup scopes) / constraint writers
(including correlated-XY controls via production `buildCoordinateConstraints`);
only station geometry is stubbed. Counts are cross-checked dense-P vs
`structuredWeights` on every case. Timing is 1 warm-up + 5 measured runs,
medians (scaling arms 1 + 3), with dense-ONLY assembly timed separately from
sparse-ONLY assembly (an earlier revision confounded dense assembly by timing
dense+sparse together; corrected below). Walls are machine-observational
(AMD Ryzen 7 5800X3D); shapes/counts are deterministic.

Free-network datum: there is no separate row-appender in this path — datum is
handled outside the equation assembler (session-level datum setup; GNSS
free-network gauge handling lives in `gnssBaselineAdjust.ts`), so it is out of
scope for P-structure statistics by construction, not by omission.

## 1. Real-engine anchors (committed fixtures, single solves)

| Case | route | m | n | iters | success | TS groups/equations/pairs | wall ms |
|---|---|---:|---:|---:|---|---|---:|
| chain-2d-64 | engine | 258 | 128 | 4 | true | 0/0/0 | 80.29 |
| chain-2d-128 | engine | 514 | 256 | 4 | true | 0/0/0 | 124.69 |
| gps-2d-64 | engine | 386 | 128 | 4 | true | 0/0/0 | 52.29 |
| gps-3d-64 | engine | 515 | 192 | 4 | true | 0/0/0 | 87.66 |
| gps-3d-128 | engine | 1027 | 384 | 4 | true | 0/0/0 | 310.24 |
| direction_face_balanced+tscorr | session-parse | — | — | 0 | false | 2/2/0 | 5.84 |

Notes: real fixtures carry the full observation mix, so engine m exceeds the
synthetic per-label m (e.g. chain-2d-64 solves m=258). `direction_face_balanced.dat`
is under-determined by construction (4 obs: 1 zenith, 1 dist, 2 directions) and
never solves; its 2 direction rows land in different TS groups because face-split
puts F1/F2 in separate sets (scope set), so the pair count is 0. Same-set TS
correlation at scale is covered by ts-face-64 below through the identical
production writer (rho 0.5, scope set).

## 2. Sparsity / block statistics (assembled, dense↔structured cross-checked)

| Case | m | n | nonzero(P) | density | scalar 1x1 rows | 2x2 blocks | 3x3 blocks | TS groups (sizes) | constraint rows |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|
| chain-64 | 64 | 64 | 64 | 0.0156 | 64 | 0 | 0 | 0 | 0 |
| chain-128 | 128 | 128 | 128 | 0.0078 | 128 | 0 | 0 | 0 | 0 |
| gps2d-64 | 64 | 64 | 128 | 0.0312 | 0 | 32 | 0 | 0 | 0 |
| gps2d-128 | 128 | 128 | 256 | 0.0156 | 0 | 64 | 0 | 0 | 0 |
| gnss-baseline-24 | 24 | 24 | 72 | 0.1250 | 0 | 0 | 8 | 0 | 0 |
| ts-face-64 | 64 | 136 | 512 | 0.1250 | 0 | 0 | 0 | 8 (8x8) | 0 |
| ts-dense-ineligible-32 | 32 | 68 | 256 | 0.2500 | 0 | 0 | 0 | 4 (8x8) | 0 |
| ts-setup-32 | 32 | 4 | 1024 | 1.0000 | 0 | 0 | 0 | 1 (32) | 0 |
| ts-angles-8 | 8 | 6 | 64 | 1.0000 | 0 | 0 | 0 | 1 (8) | 0 |
| gps3d-63 | 63 | 63 | 189 | 0.0476 | 0 | 0 | 21 | 0 | 0 |
| gps3d-126 | 126 | 126 | 378 | 0.0238 | 0 | 0 | 42 | 0 | 0 |
| gps3d-native-eligible-24 | 24 | 24 | 72 | 0.1250 | 0 | 0 | 8 | 0 | 0 |
| weighted-controls-80 | 80 | 64 | 80 | 0.0125 | 80 | 0 | 0 | 0 | 16 |
| correlated-controls-40 | 40 | 32 | 48 | 0.0300 | 32 | 4 | 0 | 0 | 8 |
| mixed-ts-gps-control | 33 | 42 | 65 | 0.0597 | 17 | 4 | 0 | 2 (4x4) | 1 |
| robust-final-mixed | 33 | 42 | 65 | 0.0597 | 17 | 4 | 0 | 2 (4x4) | 1 |

Every case: `structuredWeights.offValues.length` equals the dense
upper-triangle off-diagonal count, and every structured diagonal equals the
dense diagonal. New producers: GNSS baselines yield exact 3x3 blocks from
`invertGnssBaselineCovariance` (P = C^-1); correlated-XY controls yield exact
2x2 blocks (four corrXY pairs, production constraint builder); setup scope
merges a station into one complete TS graph (density exactly 1 — the
dense-ineligible extreme); angle observations correlate like directions under
the same writer. Robust rescaling with production grouping keys preserves
structure exactly (65 = 65 nonzero). Structural law: set-scope TS density
scales as ~groupSize^2/m; 3x3 families as 3/m.

## 3. Dense-P memory (theoretical 8m^2 + measured heap delta)

| m | theoretical 8m^2 (MB) | measured heap delta (MB) |
|---:|---:|---:|
| 250 | 0.4768 | 1.4560 |
| 500 | 1.9073 | 5.7821 |
| 1000 | 7.6294 | 7.1051 |
| 2000 | 30.5176 | -125.5310 |

The theoretical column is the reliable one (exact 8 bytes/entry). Heap deltas
are single-probe `process.memoryUsage` diffs around alloc+fill and carry GC
noise (the m=2000 negative value is a GC artifact, reported as-is).

## 4. Timing medians in ms (1 warm-up + 5 measured; dense-ONLY vs sparse-ONLY)

| Case | m | alloc zeros(m,m) | dense assembly | sparse assembly (omitDenseP) | dense accumulate | proto accumulate | structured→dense convert | vTPv dense | vTPv structured | robust rescale |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| chain-128 | 128 | 0.0407 | 0.2975 | 0.2436 | 0.1061 | 0.1977 | 0.0575 | 0.0122 | 0.0073 | 0.0141 |
| gps2d-128 | 128 | 0.0295 | 0.2017 | 0.1897 | 0.2299 | 0.1072 | 0.0528 | 0.0249 | 0.0092 | 0.0136 |
| gnss-baseline-24 | 24 | 0.0022 | 0.0489 | 0.0755 | 0.0080 | 0.0176 | 0.0053 | 0.0013 | 0.0026 | 0.0007 |
| ts-face-64 | 64 | 0.0085 | 0.2403 | 0.3707 | 0.0998 | 0.1686 | 0.0183 | 0.0076 | 0.0163 | 0.0026 |
| ts-setup-32 | 32 | 0.0029 | 0.0627 | 0.5245 | 0.0207 | 0.0328 | 0.0096 | 0.0032 | 0.0035 | 0.0010 |
| gps3d-126 | 126 | 0.0266 | 0.1233 | 0.2208 | 0.0904 | 0.0633 | 0.0561 | 0.0246 | 0.0019 | 0.0087 |
| mixed | 33 | 0.0029 | 0.0407 | 0.0496 | 0.0161 | 0.0156 | 0.0074 | 0.0014 | 0.0005 | 0.0021 |

Corrected reading (supersedes the "~2x sparse assembly win" claim, which was
confounded by timing dense+sparse together): at small m, sparse-ONLY assembly
is comparable or SLOWER than dense-ONLY (map-based builder inserts + finalize
sort cost more than direct matrix writes; ts-setup-32 is 8x slower at 0.52 vs
0.063 ms because the TS writer inserts ~500 pairs). The sparse route wins only
by avoiding the m×m allocation, which dominates at larger m (see §7: sparse
assembly 18.1 vs dense 37.4 ms at m=2000). Proto accumulate vs dense accumulate
is noise-dominated at sub-ms scale (same order, within 2x either way); the
meaningful accumulation comparison is the m=2000 scaling arm. Structured vTPv
is at parity or faster (no m^2 probing).

## 5. Structured prototype parity (shared protoAccumulate vs dense baseline)

Prototype: scalar `N += w_i a_i'a_i`, block `N += w_ij (a_i'a_j + a_j'a_i)`
per canonical triplet, `b` analogously, v'Pv from triplets, plus
`iterateNonzeroColumn` verified against every dense P column on all base cases
(exact match). Residual mode is labeled per row: `solve` = real LS residuals
(m>n), `l-proxy` = L-as-residual vector where underdetermined.

| Case | m/n | mode | N maxAbs | N maxRel | rhs maxRel | vTPv maxRel | SEUW maxRel | bit-identical N/rhs |
|---|---:|---|---|---:|---:|---:|---|---|
| scalar-terrestrial | 32/32 | l-proxy | 0 | 0 | 0 | 0 | — (dof 0) | yes/yes |
| gps-2d | 32/32 | l-proxy | 0 | 0 | 0 | 1.39e-15 | — (dof 0) | yes/yes |
| gps-3d | 24/24 | l-proxy | 0 | 0 | 0 | 6.83e-16 | — (dof 0) | yes/yes |
| gnss-baseline | 12/12 | l-proxy | 0 | 0 | 3.73e-17 | 2.41e-16 | — (dof 0) | yes/yes |
| ts-correlation | 32/68 | l-proxy | 1.05e-08 | 5.89e-15 | 1.89e-15 | 9.71e-16 | — (dof<0) | no/no (~1e-15) |
| ts-setup | 8/2 | solve | 1.86e-09 | 4.19e-16 | 9.61e-16 | 1.14e-16 | 1.71e-16 | no/no (~1e-16) |
| ts-angles | 8/6 | solve | 7.28e-12 | 6.64e-17 | 2.19e-15 | 6.40e-16 | 6.40e-16 | no/no (~1e-17) |
| correlated-controls | 20/16 | solve | 0 | 0 | 0 | 0 | 0 | yes/yes |
| weighted-controls | 40/32 | solve | 0 | 0 | 0 | 0 | 0 | yes/yes |
| mixed | 33/42 | l-proxy | 6.82e-13 | 2.08e-18 | 5.15e-17 | 0 | — (dof<0) | no/no (~1e-18) |
| ts-fixed-od | 32/4 | solve | 1.05e-08 | 5.89e-15 | 1.89e-15 | 0 | 0 | no/no (~1e-15) |
| mixed-od | 56/26 | solve | 0 | 0 | 5.15e-17 | 0 | 0 | yes/no (~1e-17) |
| mixed+robust | 33/42 | l-proxy | 2.73e-12 | 1.09e-17 | 4.75e-16 | 0 | — (dof<0) | no/no (~1e-17) |
| weighted-controls+robust | 40/32 | solve | 0 | 0 | 0 | 0 | 0 | yes/yes |
| mixed-od+robust | 56/26 | solve | 2.73e-12 | 1.09e-17 | 4.75e-16 | 0 | 0 | no/no (~1e-17) |

SEUW/chi-square: chi-square equals vTPv on both paths; SEUW matches (0 to
1.71e-16) on all six overdetermined rows with genuine solve residuals. All
N/rhs/vTPv diffs are at or below 5.89e-15 relative.

Production structured robust path (reviewer item d): `captureRobustWeightBaseFromStructured`
+ `applyRobustWeightFactorsToStructured` driven by the production
`robustCorrelationRowGroups` keys, cross-checked against the dense robust path
with identical Huber factors:

| Case | base diagonal maxAbs | base pairs match | rescaled maxAbs | rescaled maxRel |
|---|---|---|---|---|
| mixed+structured-robust | 0 | true | 0 | 0 |
| ts-correlation+structured-robust | 0 | true | 0 | 0 |
| weighted-controls+structured-robust | 0 | true | 0 | 0 |
| mixed-od+structured-robust | 0 | true | 0 | 0 |

Bit-identical end to end: same base, same pairs, same rescaled matrix.

Accumulation order notes: the dense baseline
(`accumulateNormalEquationsFromSparseRows`) processes each row's diagonal
weight first, then off-diagonal pairs in (row, col>row) probe order, adding
both `(left,right)` and `(right,left)` normal entries per pair. The prototype
adds the scalar pass first, then per-triplet `a_i'a_j` outer products. The two
orders sum identical terms in different sequence, so correlated cases differ by
a few ulps (bit-identical where no off-diagonals exist). A canonical
structured accumulator must fix one order (e.g. group-major: all pairs of a
block before moving on) to be reproducible independent of probe order.

## 6. Structured storage bytes (TypedArray estimates: 8m diag + 16 Triplet bytes vs 8m^2)

| Case | m | off-diag pairs | dense 8m^2 (B) | structured (B) | ratio |
|---|---:|---:|---:|---:|---:|
| chain-64 | 64 | 0 | 32768 | 512 | 0.0156 |
| chain-128 | 128 | 0 | 131072 | 1024 | 0.0078 |
| gps2d-64 | 64 | 32 | 32768 | 1024 | 0.0312 |
| gps2d-128 | 128 | 64 | 131072 | 2048 | 0.0156 |
| gnss-baseline-24 | 24 | 24 | 4608 | 576 | 0.1250 |
| ts-face-64 | 64 | 224 | 32768 | 4096 | 0.1250 |
| ts-dense-ineligible-32 | 32 | 112 | 8192 | 2048 | 0.2500 |
| ts-setup-32 | 32 | 496 | 8192 | 8192 | 1.0000 |
| ts-angles-8 | 8 | 28 | 512 | 512 | 1.0000 |
| gps3d-63 | 63 | 63 | 31752 | 1512 | 0.0476 |
| gps3d-126 | 126 | 126 | 127008 | 3024 | 0.0238 |
| gps3d-native-eligible-24 | 24 | 24 | 4608 | 576 | 0.1250 |
| weighted-controls-80 | 80 | 0 | 51200 | 640 | 0.0125 |
| correlated-controls-40 | 40 | 4 | 12800 | 384 | 0.0300 |
| mixed-ts-gps-control | 33 | 16 | 8712 | 520 | 0.0597 |

Structured storage is 1–25% of dense except setup-scope cases, where the
complete TS graph makes structured storage equal dense (ratio 1.0) — the storage
breakeven is exactly the density-1 boundary. Scalar-only: 1/m.

## 7. Large-m stress + scaling (chain family, synthetic, 1 warm-up + 3 measured)

| Case | m | n | dense assembly ms | sparse assembly ms | accumulate ms | assembly heap MB | theoretical P MB |
|---|---:|---:|---:|---:|---:|---:|---:|
| chain-scale-250 | 250 | 250 | 0.5110 | 0.3413 | 0.2764 | 3.3739 | 0.4768 |
| chain-scale-500 | 500 | 500 | 1.5737 | 1.1120 | 0.9939 | -1.1175 | 1.9073 |
| chain-scale-1000 | 1000 | 1000 | 8.5260 | 3.7377 | 4.3117 | -187.8610 | 7.6294 |
| chain-scale-2000 | 2000 | 2000 | 37.4363 | 18.1314 | 21.6699 | 186.7319 | 30.5176 |

m>=2000 stress completes with no failure. Corrected scaling reading: sparse
assembly wins increasingly with m (saving the zeros + symmetry writes, which
grow superlinearly: dense 0.5→37.4 ms vs sparse 0.34→18.1 ms), while per-row
writer cost favors dense at small m (§4). Accumulation (21.7 ms at m=2000,
dominated by the O(m^2) P-probe loop in `matrixSparse.ts`) is the remaining
quadratic term a triplet-iterating accumulator would remove. Heap column
carries GC noise (reported as-is); the theoretical column is the reference.

## 8. Architecture reading

- P is diagonal + small GPS/GNSS blocks + TS subblocks on every measured
  geometry; the structured form (diagonal + canonical triplets) already exists
  and round-trips exactly (`structuredWeightsToDense` parity is asserted, not
  assumed). The production structured robust path is bit-identical to the
  dense robust path (§5).
- The accumulation hot spot is the O(m^2) probe loop, not the flops: a
  structured accumulator that iterates triplets instead of probing P removes
  the quadratic term for scalar/GPS geometries (TS groups pay per-pair work
  proportional to their true fill, ~groupSize^2; setup scope is genuinely
  dense and no representation can avoid that work).
- omitDenseP proves the writers never need the dense matrix: structured output
  is identical with no m×m allocation. Assembly-time savings come from
  skipping the allocation, not from faster per-row writes.
- No production change is proposed or required by this evidence.

## 9. Explicitly out of scope (with rationale)

- Qvv / redundancy / standardized-residual consumers: they consume solved
  quantities (Qxx, B rows), not P assembly; P representation changes do not
  alter their inputs (verified architecture, not re-measured here).
- Packed-upper transfer / recovery (`structuredWeightsToPackedUpper`, Qxx
  recovery): transfer shape is already structured and covered by existing
  sparse-route tests; re-timing it would measure the WASM bridge, not weights.
- Free-network datum gauge handling: separate assembler path
  (`gnssBaselineAdjust.ts` + session datum), no P-structure impact in this
  route (§1 note).
- Absolute runtime comparisons across machines: all walls are
  machine-observational medians for ordering claims only.
