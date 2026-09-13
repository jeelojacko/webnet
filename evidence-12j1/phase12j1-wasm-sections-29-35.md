# Phase 12J.1 Batch E — WASM §§29-35 (EVIDENCE ONLY)

RTKLIB static-relative GPS L1/L2 in WebAssembly, gated on the S32 oracle
(P041 base + 01241653 rover, FIX 90/93, ratio 28.6). Reproducible via
`npx tsx scripts/gnss/gnss12j1WasmStatic.ts [--json]` (rebuilds the module
from `/tmp/rtklib-evidence` at runtime; corpus read from
`~/Downloads/webnet-gnss-12e/raw-baselines/`, never committed).

## §29 — Minimal Emscripten build: PASS (full subset, one step)

- RTKLIB pin: rtklibexplorer @ `62d4677`, `rnx2rtkp ver.EX 2.5.1` (Batch A record).
- emcc: `6.0.9-git (4e4223852a0835923411059a3929907d7df1232e)`.
- Translation units: the complete native `rnx2rtkp` object set (23 files:
  `rnx2rtkp rtkcmn trace rinex rtkpos postpos solution lambda geoid sbas
  preceph pntpos ephemeris options ppp ppp_ar rtcm rtcm2 rtcm3 rtcm3e ionex
  tides sofa`). No incremental staging was needed — one `emcc` invocation
  compiles the whole solution core, so coverage is the full static-relative
  path (RINEX parse + ephemeris + rtkpos + LAMBDA + covariance), not a subset.
- Defines identical to native: `-DTRACE -DENAGLO -DENAQZS -DENAGAL -DENACMP
  -DENAIRN -DNFREQ=4 -DNEXOBS=3`. Codegen `-O2` (native uses `-O3`).
- No networking, no pthreads (single-threaded; none proven needed).
- Link flags: `MODULARIZE EXPORT_NAME=Rnx2rtkp ALLOW_MEMORY_GROWTH
  INITIAL_MEMORY=128MB ENVIRONMENT=node FORCE_FILESYSTEM
  EXPORTED_RUNTIME_METHODS=[callMain,FS,TTY] INVOKE_RUN=0`.
- **Proven need, not tuning:** default 64 KiB stack traps inside
  `readrnx`/`rtkpos` (`memory access out of bounds`, silent stdout loss);
  `-s STACK_SIZE=8MB` fixes it with nothing else changed. Parse-only harness
  then returned `readrnx -> 1` before the full build was attempted.
- Artifacts (rebuilt to `os.tmpdir()`, never committed): `rnx2rtkp.wasm`
  700,957 B + `rnx2rtkp.js` glue 64,163 B.

## §30 — In-memory FS adapter

Fixed names under `/work` (`rover.obs`, `base.obs`, `nav0/nav1.nav`,
`out.pos`); no host paths, no traversal (callers pass buffers, never paths).
`writeFile` copies buffers into MEMFS, `readFile` copies the `.pos` text out
— caller memory is never retained. Outputs are unlinked before every run, so
a failed run cannot return a stale solution. MEMFS persists across `callMain`
invocations on one instance (verified: interleaved occupation produced its
own 2126-line output, then S32 re-ran bit-identical — §33).

## §31 — JS API (evidence-only, `makeProcessor` in the script)

`processStaticBaseline({roverObs, baseObs, nav, baseXyz, extraArgs?}) →
{status, deltaX, deltaY, deltaZ, covariance[6], ratio, satellites, epochs,
diagnostics{posLines, sha256, processMs, rawPos}}`.
No RTKLIB structs leak: the boundary input is `Uint8Array`s, the output is
parsed `.pos` text (final Q=1 line; falls back to last line). S32 returns
`FIX`, Δ = (+5822.2405, −5656.3389, −4844.8090) m, cov
(0.0006, 0.0011, 0.0010, 0.0005, −0.0007, −0.0005), ratio 28.6, 7 sats,
93 epochs — the oracle vector exactly.

## §32 — CLI↔WASM exactness (HARD gate): PASS with bounded ULP caveat

Identical input bytes + identical options. 105/105 lines (12 header +
93 data); only the `% inp file` paths differ by construction (host vs MEMFS).

| Check | Result |
|---|---|
| Epoch count / Q flags / nsats | 93/93 identical, all Q/nsats identical |
| Rover XYZ per epoch | bit-identical all 93 epochs |
| Final epoch (FIX, ratio 28.6, 6 cov terms) | character-identical |
| Differing data lines | 2/93: `17:26:30` cov `0.0018`→`0.0017`; `17:29:30` ratio `8.2`→`8.1` |

Strict bound (never relaxed): |Δpos| = 0.0 mm every epoch; |Δcov| ≤ 1e-4 m
(one display ULP); |Δratio| ≤ 0.1 (one display ULP). Both diffs are stable
across 6 WASM runs and the CLI is 3× byte-identical with itself (Batch A),
so they are systematic wasm-libm vs glibc-libm 1-ULP divergences surfacing
only at display-rounding boundaries — not noise, not state.

## §33 — Repeat determinism: PASS

Same instance ×3, fresh instance ×2 (script: ×3 + ×1), S32→other→S32
interleave: all SHA-256 `4210ef65…` identical. No state leak.

## §34+§35 — Memory + performance

- Module: 700,957 B wasm + 64,163 B glue; 128 MB initial linear memory
  (reservation; ALLOW_MEMORY_GROWTH), 8 MB stack.
- Node RSS +7 MB across instantiate; init (import+instantiate) 9–19 ms.
- S32 process: WASM 196–223 ms vs CLI 88–89 ms (≈2.3×). No growth over
  repeats (223 → 198 → 197 ms, then flat). CLI RSS ≈ 10 MB (Batch A).
- Bottom line: ~0.2 s per static baseline in WASM — acceptable for an
  evidence path; no optimization pursued (evidence-only, YAGNI).
