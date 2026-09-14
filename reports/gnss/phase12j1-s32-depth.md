# Phase 12J.1 — S32 processing depth §§14-17 (EVIDENCE ONLY)

Re-verification of the S32 golden leg (P041 → SIXTWO, 2006-06-14
17:24:30–18:10:30 GPS) under explicitly controlled options, rerun
2026-09-14 on branch `feat/gnss-raw-rtklib-wasm-proof` with the pinned
`rnx2rtkp` binary (rtklibexplorer/RTKLIB source `62d4677`, v2.5.1) reused
in place — no rebuild, no `make clean`, no vendor bytes committed.
Reproducible via `npx tsx scripts/gnss/gnss12j1S32Depth.ts` (fail-closed
SKIP when the local corpus or binary is absent; solutions run into
`os.tmpdir()`, never the repo).

Canonical command (broadcast leg; SP3 leg appends `igs13793.sp3`):

`rnx2rtkp -p 3 -f 2 -m 15 -sys G -v 3.0 -ti 30 -ts 2006/06/14 17:24:30
-te 2006/06/14 18:10:30 -e -t -o OUT -r -1283634.1259 -4726427.8882
4074798.0251 01241653.06o p0411650_2.06o 01241653.06n p0411650_2.06n`

## §14 — Broadcast-vs-precise: IDENTICAL (0.0 mm), by construction

| Leg | SHA-256 of solution body (headers excluded) | Verdict |
| --- | --- | --- |
| Broadcast NAV | `body` hash A | — |
| + `igs13793.sp3` | `body` hash A (same) | byte-identical, 0.0 mm |

Only the `%` comment header differs (it echoes the extra input path);
all 93 solution lines are byte-identical. Magnitude of the
broadcast↔precise difference under these options: **exactly zero**.

Why (RTKLIB data path, pinned source `/tmp/rtklib-evidence`):

- `src/postpos.c` `readobsnav()` loads the SP3 file into `nav` via
  `readsp3()` (and precise clocks via `readrnxc()`), so the SP3 bytes are
  read — but nothing selects them.
- `src/ephemeris.c` `satpos()` dispatches purely on `prcopt.sateph`:
  `EPHOPT_BRDC` → `ephpos()` (broadcast); `EPHOPT_PREC` → `peph2pos()`
  (Neville-polynomial interpolation, `src/preceph.c`) with broadcast
  fallback only if precise lookup fails.
- `src/rtkcmn.c` `prcopt_default()` freezes `sateph = 0`
  (`EPHOPT_BRDC`, `src/rtklib.h:443-444`), and `rnx2rtkp.c` exposes **no**
  CLI flag for it — only a `-k` config (`pos1-sateph=precise`) could flip
  it. Neither S32 leg sets it.

So both legs solve from broadcast ephemeris; the SP3 leg is
broadcast-identical by option dispatch, not by orbit physics. A TRUE
precise leg (sateph=precise) is still open work — and is the leg that
would test the §14 short-baseline DD-cancellation claim.

## §15 — Time/decimation: exact 30 s grid, 93/93 epochs, 0 rejected

| Item | Measured |
| --- | --- |
| Expected grid | 17:24:30, 17:25:00, …, 18:10:30 (93 epochs) |
| Present in `.pos` | 93 |
| Rejected (missing) | 0 |
| Spacing deviations from 30 s | 0 |
| First / last epoch | 17:24:30.000 / 18:10:30.000 |

FIX/FLOAT from `.pos` Q column (`Q=1:fix,2:float` per the file header):
**FIX 90, FLOAT 3** — the 3 floats are the first three epochs
(17:24:30, 17:25:00, 17:25:30; filter convergence), every epoch from
17:26:00 on is FIX.

RTKLIB behavior (pinned source): `src/rtkcmn.c` `screent()` keeps an
observation epoch iff `fmod(gpst+DTTOL, tint) <= 2*DTTOL` inside
`[ts, te]` — a strict 30 s comb, no interpolation of observations to the
grid. `src/rinex.c` `readrnxt()` applies it per-epoch at load, and
`src/postpos.c` `readobsnav()` additionally widens the **base** window by
±60 s so base data brackets the rover span for differencing. The rover is
1 Hz and the base 30 s; output epochs are the rover grid decimated to
30 s — i.e. epoch pairing here is decimation, not interpolation.

## §16 — Signal contract

Exact GPS obs codes inventoried from the RINEX headers (parsed, not
assumed):

| File | Codes |
| --- | --- |
| Rover `01241653.06o` (3.04, `SYS / # / OBS TYPES`) | C1C C2D L1C L2D |
| Base `p0411650_2.06o` (2.10, `# / TYPES OF OBSERV`) | L1 L2 C1 P2 P1 S1 S2 |

RTKLIB mapping (pinned source):

- Modern codes pass through `src/rtkcmn.c` `obs2code()` (string
  `"1C"`,`"2D"`… → `CODE_L1C`, `CODE_L2D`, … per the RINEX 3.04 table),
  with `code2obs()` the inverse and `code2freq_GPS()` mapping band
  digit → L1/L2 frequency + index.
- RINEX 2 codes are normalized first by `src/rinex.c` `convcode()`
  (v2.10 path): `C1`→`C1C`, `P1`→`C1W`, `P2`→`C2W`, `L1/L2` keep band
  with the default-code fill from `defcodes`. So the base pair
  effectively enters as C1C/C1W-phase-L1 + C2W-phase-L2 against the
  rover's C1C/C2D-phase-L1/L2 — L1/L2 double differences close on both.
- `S1/S2` (SNR) are not ranging signals and play no role in the
  solution; they ride along as signal-strength metadata.
- Code priority/substitution: `src/rtkcmn.c` `setcodepri()` /
  `getcodepri()` rank multiple codes per band (defaults in `codepris`);
  with `-f 2` only one code per band exists on each side here, so no
  substitution fires on S32. Multi-code rovers would resolve via that
  priority table — unexercised by this leg.

## §17 — Ambiguity result (parsed from `.pos`, no reduction to "Fixed")

| Item | Measured |
| --- | --- |
| Epochs total / used | 93 / 93 (0 rejected) |
| FIX / FLOAT | 90 / 3 (96.8% FIX) |
| FIX ratio: min / median / max | 4.4 / 22.3 / 28.6 |
| Ratios below 3.0 threshold | 0 (min FIX ratio 4.4 clears `-v 3.0`) |
| Final epoch (18:10:30) | Q=1, ns=7, ratio **28.6** |
| Satellites used (ns distribution) | 9 sats × 71 epochs, 8 × 5, 7 × 17 |
| Reference satellite | NOT serialized in `.pos` — fail-closed: unreported (ns is the only per-epoch satellite proxy; refsat identity would need trace-level output) |
| # ambiguities | NOT serialized in `.pos` — fail-closed: unreported as a parsed count (dual-frequency DD implies 2×(ns−1) per epoch structurally, but that is inference, not a parse) |

Narrative the numbers support: the filter floats the first three epochs
(convergence + ambiguity initialization), then holds FIX continuously for
90 epochs with ratios 4.4–28.6 — a clean continuous-AR hold (default
`modear=continuous`), not a marginal fix. The closing epochs run on
7 sats yet the final ratio is the run maximum (28.6), so geometry, not
count, carries the fix.
