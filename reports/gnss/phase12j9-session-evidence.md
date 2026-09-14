# Phase 12J.9 Track E2 — Session Evidence: smoke + perf + ANTEX (EVIDENCE ONLY)

Branch `feat/gnss-raw-session-review`. No `src/` changes, no ingest, no
math/adjustment changes. Corpus, `out/`, `work*` dirs, `/tmp` runs, and
`~/Downloads` data are local-only, never committed. Committed: this report,
`scripts/gnss/gnss12j9SessionPerf.mjs`, `docs/gnss/raw-session-review.md`,
short pointers in `docs/gnss/raw-static-worker-mvp.md` +
`docs/CURRENT_BEHAVIOR.md`.

## 1. ANTEX full-vs-subset parity — PASS (covered legs), verdict REVIEW_ONLY

- Attempt: `curl --max-time 25 https://files.igs.org/pub/station/general/igs20.atx`
  → HTTP 200, 60,295,761 bytes, 11 s. No FTP fallback needed. Stored
  local-only at `~/Downloads/webnet-gnss-medium/belgian-12j8/igs20.atx`,
  sha256 `8715268e17e09e5447f4949d67cbd067e7f0f33d48dd698aafe14f5cffb26de2`
  — the SAME upstream file (hash + size) as the 12J.8 §17 stage-2c check.
- `node scripts/gnss/gnss12j9AntexParity.mjs`: subset-of-full hashes equal
  subset-of-subset for all three production combos —
  TRM59800.00 `b639d1ad…`, LEIAR25.R3 `39e7010d…`, LEIAR25.R4 `bc1d0cd2…`.
- Processing parity (frozen 12J.8 flags, DOY126 h00 precise, exact subset
  vs full `igs20.atx` staged via `-k file-rcvantfile/file-satantfile`):
  TGRN-WARE → `.pos` byte-identical (`ca258b5c…`, 121 epochs);
  WERB-WARE → byte-identical (`dae927ee…`, 121 epochs).
- **Verdict: ANTEX_REVIEW_ONLY** (12J.8 wording preserved). Parity passes
  on every covered leg, but coverage is still narrow — one common window,
  precise-only, two combos at processing level — so no certification is
  claimed. Mission-§51 acceptance F stays GAP on coverage.

## 2. Belgian smoke (§44) — 3/3 FIXED, deterministic

- Window: DOY126 (2026-05-06) h00–h01, proven common to WARE/TGRN/VOER/WERB
  (all FIXED in the 12J.8 matrix). Default 4-station STAR tree, WARE base:
  TGRN-WARE, VOER-WARE, WERB-WARE (3 jobs), frozen 12J.8 flags
  (`-p 3 -f 2 -m 10 -sys G -e -t + -k conf`, SP3 precise, exact ANTEX
  subset, `-r` base marker ECEF after `-k`), native `rnx2rtkp` CLI,
  local-only `/tmp/12j9smoke`.
- Statuses (12J.8 `gnss12j8Parse.py` rule: FIXED = any Q=1 epoch):

| Leg (1 h, prec) | rc | epochs | Q=1 (fix) | Q=2 (float) | status |
|---|---|---|---|---|---|
| TGRN-WARE 18.7 km | 0 | 121 | 114 | 7 | FIXED |
| VOER-WARE 33.7 km | 0 | 121 | 50 | 71 | FIXED |
| WERB-WARE 45.9 km | 0 | 121 | 73 | 48 | FIXED |

- Determinism: TGRN-WARE rerun → `.pos` sha256 identical (`ca258b5c…`).
- Runtime/memory (native CLI, per 1 h leg): wall ~0.6 s, max RSS ~23.8 MB
  (`/usr/bin/time -v`: 0.54 user + 0.02 sys, 23752 kB). PAR=2 for 3 jobs ≈
  2 wall batches. Browser-WASM timings will differ; tracked separately.

## 3. Perf (§46) — synthetic sessions, node-side harness only

- Harness: `scripts/gnss/gnss12j9SessionPerf.mjs` (new, this track).
  Self-contained N-station synthetic RINEX 2.10 + broadcast NAV following
  the `tests/fixtures/gnssRaw/generate.mjs` pattern (same circular-orbit
  ephemeris + transmit-time range model + noise; single-point checks land
  on the true position). STAR tree → N−1 real `rnx2rtkp` jobs through a
  PAR-limited pool mirroring the `RawSessionPool` discipline (max PAR
  concurrent spawns; 1 spawn = 1 worker start). All legs rc=0, 13/13
  epochs, Q=2 FLOAT — the same solution class the committed fixture pair
  yields via CLI on a 6.5-min window, so the harness exercises the real
  processing path, not a stub. Harness bug found and fixed during the run:
  a misaligned `# / TYPES OF OBSERV` header parsed as empty types
  (Q=4/ns=0); rewritten to the exact fixture field format, verified.
- PAR=2 scaling (jobs = starts = N−1, maxLive ≤ PAR holds everywhere):

| N | PAR | jobs | starts | maxLive | wallMs | meanJobMs | fixedLegs | rc |
|---|---|---|---|---|---|---|---|---|
| 3 | 2 | 2 | 2 | 2 | 9 | 8 | 0 | 0×2 |
| 5 | 2 | 4 | 4 | 2 | 14 | 7 | 0 | 0×4 |
| 10 | 2 | 9 | 9 | 2 | 31 | 6 | 0 | 0×9 |
| 20 | 2 | 19 | 19 | 2 | 62 | 6 | 0 | 0×19 |

- PAR comparison at N=5 (4 jobs): PAR=1 wall 25 ms → PAR=2 14 ms
  (1.8×) → PAR=4 9 ms (2.8×). Pool bound respected (maxLive 1/2/4).
- Spawn overhead probe (`rnx2rtkp` no-arg startup): ~2 ms native. WASM
  init overhead in the browser is NOT measured here — native spawn is the
  analogue only; browser-side init remains a separate measurement.
- Honest limits: synthetic windows are tiny (13×30 s), so absolute ms are
  startup-dominated and are NOT browser throughput claims. What transfers:
  job count N−1, starts N−1, maxLive ≤ PAR, wall ≈ ⌈jobs/PAR⌉ × unit cost.
  Real-leg unit cost ≈ 0.6 s native per 1 h Belgian leg (§2); a 20-station
  PAR=2 session of such legs ≈ 10 serial batches ≈ ~6 s native.

## 4. Production decisions (§53/§54 input — recommend, parent decides)

- Recommend: keep PAR=2 default (measured scaling near-linear to PAR=4 on
  small jobs; PAR=2 bounds memory ≈ 2× single-job RSS ≈ 48 MB native).
- Recommend: keep ANTEX_REVIEW_ONLY + `CALIBRATION_UNAVAILABLE`
  status-only; do NOT certify broader ANTEX coverage on two legs.
- Recommend: keep DIRECT_INGEST NO; external covariance (TBC GVX,
  other-processor, operator-assigned) stays on the existing processed-GNSS
  import — see `docs/gnss/raw-session-review.md` §52.
- Recommend: browser WASM session timing + WASM-init measurement as the
  next evidence step before any throughput claim.
- §54 field dump: ANTEX=REVIEW_ONLY (parity PASS 2/2 processing legs,
  3/3 subset-hash combos; full sha256 `8715268e…`, subset `c0eb7a8b…`);
  SMOKE={window:DOY126-h00, tree:STAR/WARE, jobs:3, fixed:3, determinism:IDENTICAL};
  PERF_SYNTH={par2_walls_ms:{3:9,5:14,10:31,20:62}, par5_wall_ms:{1:25,2:14,4:9},
  spawnProbeMs:2, allRc0:true, class:FLOAT};
  SESSION_GRAPH=SPANNING_TREE_SUFFICIENT_INITIAL (12J.8 carry);
  DIRECT_INGEST=NO; CERTIFICATION=REVIEW_ONLY_FINAL (unchanged).
