# Phase 12E0 — GVX intake prep report

Local-only branch `prep/phase12e-gvx`. Vendor-neutral standards prep
only: GVX 1.0 parses into the unchanged Phase 12B observation. No TBC
parity claimed, no Trimble-specific code, no WASM routing, no adjustment
math or Phase 12D statistics changes, no UI, no reference-frame
transforms, no stations marked FIXED from GVX coordinates. No vendor
assets committed (samples stay in `~/Downloads`, local-only).

## Files added / modified

Added:

- `src/engine/gnssGvxXml.ts` — zero-dep secure XML scanner (no XXE /
  entity expansion, bounded, line numbers).
- `src/engine/gnssGvxSyntax.ts` — raw GVX document + frame resolution
  (`parseGvxSyntax`).
- `src/engine/gnssGvxImport.ts` — `parseGvx` / `importGnssBaselineGvx` /
  `canonicalizeGvxDocument` (orientation, units, covariance rebuild,
  FREE-endpoint policy).
- `tests/gnssBaseline/gvxImport.test.ts` — order gate, orientation,
  version/security/covariance/frame/error policy, official-sample
  determinism (local-only, skipped in CI).
- `tests/gnssBaseline/gvxParity.test.ts` — original 3-station/3-baseline
  triangle, GVX<->BL exact parity incl. TEST-ONLY artificial-datum
  adjustment comparison.
- `scripts/gnss/gvxEvidence.ts` — manual-only evidence audit
  (`npm run gnss:gvx-evidence`); not in any test tier.
- `docs/gnss/GVX_IMPORT.md` — field map, security, policies.
- This report.

Modified: `package.json` (one script line: `gnss:gvx-evidence`),
`TODO.md` (scope entry). `README.md` untouched (no setup change).

## Sample inventory (actual files, `~/Downloads/webnet-gnss-12e/noaa/`)

| File | Bytes | Vectors | Marks | Graph components | Point frame | Orbit | Obs range |
|---|---|---|---|---|---|---|---|
| `sample_gvx.xml` | 50,235 | 18 | 20 | 2 | 126 / NAD 83(2011) @ 2010.0000 | 153 / IGS14 | 2018-03-07 11:59 → 21:08 |
| `052.jxl_1p0.gvx` | 59,817 | 18 | 21 | 3 | 126 / NAD 83(2011) @ 2010.0000 | 153 / IGS14 | 2018-02-21 12:37 → 23:29 |
| `053.jxl_1p0.gvx` | 53,091 | 15 | 21 | 6 | 126 / NAD 83(2011) @ 2010.0000 | 153 / IGS14 | 2018-02-22 12:33 → 22:23 |
| `054.jxl_1p0.gvx` | 41,998 | 13 | 15 | 2 | 126 / NAD 83(2011) @ 2010.0000 | 153 / IGS14 | 2018-02-23 12:58 → 19:36 |

All files: GVX `VERSION="1.0"`, no namespace, no `SESSION`, no repeated
endpoint pairs, single-component-per-vector full 3×3 stochastic blocks.
Components > 1 reflect marks unreferenced by any vector (isolated nodes),
not disconnected surveys — 053 has 21 marks but only 15 vectors.

## Covariance validation stats (evidence script)

All 64/64 vector blocks pass strict Cholesky with zero parser errors:

| File | σ range (m) | max \|ρ\| | worst pivot ratio | near-singular | a-priori max misclosure |
|---|---|---|---|---|---|
| sample | 2.5e-3 – 1.9e-2 | 0.921663 | 7.3e-2 | 0 | 4.9e-9 m |
| 052 | 2.7e-3 – 1.2e-2 | 0.811422 | 2.0e-1 | 0 | 5.1e-9 m |
| 053 | 1.8e-3 – 1.8e-2 | 0.838441 | 2.2e-1 | 0 | 4.7e-9 m |
| 054 | 1.9e-3 – 1.4e-2 | 0.776977 | 1.9e-1 | 0 | 4.7e-9 m |

A-priori published coordinates agree with observed vectors to ~5e-9 m
on every file (no datum inferred from this; endpoints still import FREE).

## Timing (evidence script, dev machine)

Parse wall time (cold, incl. tsx startup + file read): 054 (42 kB)
38 ms, sample (50 kB) 54 ms, 053 (53 kB) 62 ms, 052 (60 kB) 80 ms.
Warm in-process reparse of 052: 2.5–5 ms ×5 (after the F1 incremental
line-tracking fix removed the per-tag O(n) rescan). Single-pass scanner
+ single-pass canonicalization. No performance work needed.

## Parity diffs (synthetic triangle, GVX<->BL)

Canonical vectors, covariances, station coordinates: exact (`toBe`).
Adjusted coordinates, residuals, Qxx, variance factor,
weighted-residual sum, per-baseline statistics (Qvv/Cvv/redundancy/block
diagnostic), loop closures (1 loop, cycle rank 1): all zero diff
(`toBe`/`toEqual`). See `tests/gnssBaseline/gvxParity.test.ts`.

## TBC intake checklist (for the future 12E parity step — all PENDING)

1. TBC processed-baseline export (vectors + σ/ρ or covariance) — PENDING.
2. TBC adjusted-coordinate report for the same network — PENDING.
3. Control/frame metadata (reference frame, epoch, fixed stations) — PENDING.
4. TBC solution-status flag semantics (fixed/float, acceptance) — PENDING.
5. TBC covariance form mapping (σ+ρ vs full matrix) — PENDING (GVX seam ready).
6. Session/component grouping rules for multi-occupation vectors — PENDING.
7. Reference-frame/epoch tag vocabulary used by TBC exports — PENDING.
8. Official GVX schema/sample provenance log — PENDING (samples: NOAA
   `webnet-gnss-12e/noaa/`, local-only, see inventory above).
9. Vendor-asset policy ack: no TBC/Trimble binaries, installers, or
   exports committed to the repo — ACK (nothing committed).
10. Parity-diff acceptance criteria (tolerances, reference diff) — PENDING.

Doc pointers: intake contract `docs/gnss/STATIC_GNSS_BASELINE_ARCHITECTURE.md`
(§11 importer survey, §12 12E), format `docs/gnss/STATIC_GNSS_BASELINE_FORMAT.md`,
math `docs/gnss/STATIC_GNSS_BASELINE_MATH.md`, this intake
`docs/gnss/GVX_IMPORT.md`. Do not claim TBC support before items 1–10 close.

## Gates A–H

- A lint: PASS (0 errors; 2 pre-existing warnings, re-proven via stash).
- B typecheck: PASS (`tsc --noEmit` clean).
- C focused GVX tests: PASS (64/64 incl. 4 local-only sample tests).
- D `test:agent`: 3112 passed / 1 skipped / 3 failed — the 3 failures are
  the pre-existing Study calibration failures (`study_ai_unit_calibration`,
  `_v5`, `_preflight`), identical to the 12B/12C/12D baseline and
  unrelated to this change. GNSS suites: 19 files / 183 tests PASS.
- E 12A–D unchanged: `git status` shows only the files listed above.
- F parity diffs: all zero (see above).
- G perf: parse 38–80 ms/file (see above); no thresholds apply.
- H vendor/prod: TBC-specific added = NO; prod behavior changed = NO
  (new modules + tests + script + docs only; no existing file touched
  except the one-line `package.json` script addition).

Ready-for-TBC-intake: NO (prep complete; checklist items 1–10 pending —
intake can start, parity cannot be claimed).
