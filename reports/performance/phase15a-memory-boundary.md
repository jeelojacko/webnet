# Phase 15A post-QC covariance memory + native/WASM boundary evidence

Evidence only — no production routing, math, tolerance, or contract changes.
Methodology: `tests/evidence/phase15a_memory_boundary.test.ts` (evidence tier,
manual-only). Single genuine 3D case (gps-3d-64, 192 params / 515 equations /
66 stations); 1 warm-up + 3 measured runs per arm. Walls are
machine-observational (Ryzen 5800X3D class, node 26); byte counts are exact
formulas. Rerun the test to regenerate
`artifacts/evidence/phase15a/phase15a-memory-boundary.json` (gitignored).

## 1. Peak-memory table (8 bytes/element; number[][] payload + headers extra)

Measured shape at n=192 (E/n redundancy 2.68, S/n density 0.34); other rows
analytic at fixed redundancy/density. Heap delta around one TS solve at
n=192: ~29–49 MB single-sample (GC-noisy, order-of-magnitude only).

| n (params) | basis | E | S | N (MB) | Qxx final (MB) | 2nd stats Qxx (MB) | capture deep-copies (MB) | Array.from verifier (MB) | dense B E·n (MB) | dense P E·E (MB) | external shifts E·S·3 (MB) | relPrec rows | relPrec retained (KB) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 64 | analytic | 172 | 22 | 0.031 | 0.031 | 0.031 | 0.069 | 0.031 | 0.084 | 0.226 | 0.087 | 231 | 9.0 |
| 128 | analytic | 343 | 44 | 0.125 | 0.125 | 0.125 | 0.263 | 0.125 | 0.335 | 0.898 | 0.345 | 946 | 36.9 |
| 192 | measured | 515 | 66 | 0.281 | 0.281 | 0.281 | 0.581 | 0.281 | 0.754 | 2.024 | 0.778 | 2145 | 83.8 |
| 256 | analytic | 687 | 88 | 0.500 | 0.500 | 0.500 | 1.025 | 0.500 | 1.342 | 3.601 | 1.384 | 3828 | 149.5 |
| 384 | analytic | 1030 | 132 | 1.125 | 1.125 | 1.125 | 2.288 | 1.125 | 3.018 | 8.094 | 3.112 | 8646 | 337.7 |

Duplicated-Qxx census (all transient except the retained final Qxx):
capture deep-copies = packed design (rowOffsets/columns/values) + packed
weights + all-entry queryRows/Columns + covariance Float64Array (solver capture
site, `Int32Array.from`/`Float64Array.from`); verifier `Array.from(covariance)`;
`reconstructDenseQxx` number[][] scratch; probe `copyMatrix` normal+Qxx
(test-only, when enabled).

Transience: N scratch, 2nd statistics Qxx (without 10E reuse), capture copies,
verifier copy, rebuild scratch, dense B, dense P, per-row external shift
vectors are transient. Retained in result JSON: final Qxx pipeline output,
relativePrecision rows, station/relative covariance blocks.

Dominant terms: dense P (E²) and external shifts / dense B above n≈256; Qxx
copies stay ≤ ~2.3 MB at 384 params.

## 2. Native/WASM boundary split (gps-3d-64, 192 params, medians)

| Quantity | ms (median) |
|---|---|
| TS full-solve wall | 46.33 |
| native-route full-solve wall | 46.11 |
| per-call wrapper wall (JS→WASM→JS) | 1.85 |
| native phase sum (asm/equ/an/fac/sol) | 0.67 |
| boundary + serialization + copy-out attribution (wrapper − phases) | 1.13 |
| Float64Array.from copy-out (36,864 elems) | 0.09 |
| Array.from verifier conversion | 0.76 |
| nested-loop number[][] rebuild | 0.08 |
| copyMatrix duplicate | 1.38 |

No faster/slower verdict beyond the numbers: at 192 params the two full-solve
walls are indistinguishable (46.1 vs 46.3 ms); the boundary attribution is
order-of-magnitude ~1 ms per native covariance call, and duplicate JS-side
conversions cost ~2.1 ms combined (Array.from + copyMatrix) at this size,
scaling O(n²).

## 3. Instrumentation added

None in `src/`. Existing boundaries were sufficient:
`NativeFullQxxVerificationTiming` (captureCopy/finiteScanConvert/oracleBuild/
queryBuild/oracleProbe/nativeIndex/C1/C2/C3 + nativeBytesCopied/
packedBytesCopied) and `detailedSolveProfiler` (TS assembly/accumulate/invert),
plus a harness-side wrapper tap in the test. No public settings added.
Gating proof: TS solve with vs without `detailedSolveProfiler` is
numerically identical (maxDiff 0); native-route vs TS result maxDiff 0.
Disabled path pays a single branch per stage; enabling changes no numerics.

## 4. Candidate-route classification (no implementation)

Speedups marked MEASURED use §§1–2 or cited prior evidence; else UNKNOWN.

| Route | Expected speedup | Numerical risk | Compatibility risk | Complexity | Memory tradeoff |
|---|---|---|---|---|---|
| A reuse already-produced full Qxx | MEASURED (prior 10C: ~88 ms stats Qxx inversion at 384 params; 10E already production) | low (same matrix) | low | done | −2nd Qxx (1.1 MB @384) |
| B station-diagonal-only blocks | UNKNOWN | HIGH (changes precision model) | high (report contract) | medium | −off-diagonal retention |
| C cache Qxx·a_i | UNKNOWN | none (reorder only) | low | medium | +B-sized cache (3 MB @384) |
| D batch reliability influence | UNKNOWN (external path already batched; no per-obs re-solve) | low | low | low | none |
| E retain native Qxx across postprocessing | MEASURED small (~0.85 ms Array.from+rebuild @192, O(n²)) | none | low | medium (lifetime/ownership) | +native-side retention |
| F avoid duplicate JS/native conversions | MEASURED small (~2.1 ms/solve @192: Array.from 0.76 + copyMatrix 1.38, O(n²)) | none | low | low–medium | −1–2 transient Qxx copies |
| G defer expensive covariance outputs | MEASURED memory (up to ~3.1 MB transient + S² rows @384); time UNKNOWN | none if request-gated | medium (output contract) | low | −deferred outputs when unrequested |

## 5. Validation

`git diff --stat`: 2 files (new evidence test + 1-line tier registration);
zero `src/` changes. Lint 0 errors, typecheck clean, evidence test 1/1 pass
(see worker report for SHAs).
