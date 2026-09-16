# Phase 15D native Qxx boundary/verification efficiency — benchmark record

Baseline: origin/main `aeea52a3` (PR #80 merge), WASM md5
`df94d377b3a569448c779e9a7e26fe22`, node 26.8.1, Ryzen 7 5800X3D.
Production cap `NATIVE_FULL_QXX_MAX_PARAMS = 768`.
Method: real WASM, 2 warm-ups, median-of-5, before via `git stash` /
after unstashed on identical inputs. Committed Phase 15C medians
(S192/C 155.8 ms, S384/C 585.0 ms) are different inputs, not comparable.

Change: T6 captured-covariance copy removed (by-reference capture) +
T7 verifier `Array.from` removed (direct `Float64Array` scan).
T10 scaled-copy fusion skipped (not provably bitwise-identical).
C1/C2/C3, tolerances, coverage, finalizer, fallback, cohort unchanged.

| config | session before | session after | verify before | verify after | native copied | retained native |
|---|---|---|---|---|---|---|
| S192 OFF (1 sys) | 52.5 ms | 51.6 ms | 8.6 ms | 8.2 ms | 0.59 MB → 0 | −50% (0.59→0.29 MB) |
| S192 AUTO-3 (4 sys) | 172.5 ms | 167.8 ms | 34.8 ms | 29.5 ms | 2.36 MB → 0 | −50% (2.36→1.18 MB) |
| S384 OFF (1 sys) | 157.4 ms | 150.7 ms | 29.8 ms | 30.8 ms | 2.36 MB → 0 | −50% (2.36→1.18 MB) |
| S384 AUTO-3 (4 sys) | 588.8 ms | 588.0 ms | 120.9 ms | 108.6 ms | 9.44 MB → 0 | −50% (9.44→4.72 MB) |

S384 AUTO-3 split after: C1 0.92 / C2 28.12 / C3 10.94 ms;
finiteScan 15.25→3.32 ms, copy 1.07→0.38 ms.
Verify −10.2% (S384-3) / −15.2% (S192-3); session −0.1…−4%
(no regression); retained native memory −50%; bytes copied → 0.

Verdict: GO (memory-copy elimination + modest verify win, bit-identical
verification strength; copies were never dominant — oracle/probe/C2 are).
Independent review: APPROVE-WITH-NITS (non-blocking).
