# Phase 12J.2 Batch B — S32 Controlled Ladder A/B/C + Precise Proof (EVIDENCE ONLY)

Batch B §§2–8, §§15–17. Branch `feat/gnss-raw-tbc-parity-closure`.
EVIDENCE ONLY: no `src/` production changes, no math/tolerance changes,
no vendor commits, no internet downloads, no UI/worker code.

Context: corpus LOCAL-ONLY `~/Downloads/webnet-gnss-12e/raw-baselines/`
(rover `01241653.06o/.06n` RINEX 3.04 1 Hz; base `p0411650_2.06o/.06n`
RINEX 2.10 30 s; SP3 `igs13793/igl13793` variants). Binary pinned by
Batch A: `/tmp/rtklib-evidence/app/consapp/rnx2rtkp/gcc/rnx2rtkp`
(ver.EX 2.5.1, commit `62d4677`, see `phase12j1-rtklib-pin.md`).
Base XYZ `-1283634.1259 -4726427.8882 4074798.0251`, H-reduction
convention (H_rov = 2.0 m, H_base = 0.0083 m, WGS84 ellipsoidal Up) per
`phase12j1-marker-arp-contract.md`. TBC B32 oracle dX/dY/dZ
(+5822.646, −5654.885, −4846.085) m, length 9453.3312 m, mark-to-mark.
Runner: `scripts/gnss/gnss12j2Ladder.ts` (174 lines); all legs run into
`os.tmpdir()`. Never combine two changes in one unexplained step —
each leg below changes exactly one variable vs the previous.

## Exact leg configurations (S32, GPS-only, dual-frequency static, FIXED)

Common: `-p 3 -f 2 -sys G -v 3.0 -ti 30 -ts 2006/06/14 17:24:30
-te 2006/06/14 18:10:30 -e -t -r <P041 XYZ>` + 4 RINEX inputs.

| Leg | Change vs previous | Full distinguishing args |
| --- | ------------------ | ------------------------ |
| A reproduction | baseline (12J.1 exact) | `-m 15`, no SP3 |
| B elevation | mask 15° → 10° only | `-m 10`, no SP3 |
| C true precise | + precise mode only | `-m 10`, `-k prec.conf`, `igs13793.sp3` input, `-x 3` trace |

`prec.conf` (one line): `pos1-sateph=precise`. Shell-wording note:
`-ts/-te` MUST be passed as two argv words each
(`2006/06/14` `17:24:30`); a single combined `"2006/06/14 17:24:30"`
string mis-parses (date token absorbed, stray `% inp file` header line).
`gnss12j1S32Depth.ts` uses the combined form — verified numerically
inert here (solution bodies byte-identical either way; corpus files span
exactly the occupation), flagged for Batch A awareness, not changed
(out of scope).

## Leg A — 12J.1 reproduction verdict: PASS (exact)

| Check | 12J.1 value | Leg A | Verdict |
| ----- | ----------- | ----- | ------- |
| Raw vector dX/dY/dZ (m) | +5822.2405 / −5656.3389 / −4844.8090 | identical to 0.1 mm | PASS |
| H-reduced vector (m) | +5822.6389 / −5654.8636 / −4846.0864 | identical | PASS |
| 3D vs TBC | 22.6 mm | 22.6 mm | PASS |
| FIX / epochs | 90/93 | 90/93 | PASS |
| Final ratio | 28.6 | 28.6 | PASS |
| Formal σ (mm) | 0.6 / 1.1 / 1.0 | 0.6 / 1.1 / 1.0 | PASS |
| ns distribution | — | {7:17, 8:5, 9:71} | record |
| Runtime | 0.08 s | ~0.09 s | record |

Second-run determinism: re-run with `-y 2` stat output is body
byte-identical (sha match); 12J.1's ×3 byte-identical pin stands.

## Leg B — elevation corrected (−m 10): deltas vs leg A

Band admission (from `-y 2` `$SAT` az/el records): at 15° mask, ZERO
records with el in [10°,15°); at 10° mask, three satellites admitted
only in the band — G03 (17 epochs, 12.7–14.9°), G07 (18 epochs,
10.0–13.0°), G21 (21 epochs, 10.6–14.8°). 39/93 epochs change ns
(ns distribution {9:76, 10:17} vs A's {7:17, 8:5, 9:71}); final epoch
7 → 9 sats (+G03, +G21); first epoch 9 → 10 sats. Epoch count
unchanged: 93/93, 0 rejected, 0 spacing deviations.

| Quantity | Leg A (15°) | Leg B (10°) | Delta B−A |
| -------- | ----------- | ----------- | --------- |
| FIX / FLOAT | 90 / 3 | 90 / 3 (same 3 float epochs) | none |
| Final ratio | 28.6 | 19.4 (min 4.4→3.9, max 28.6→23.4) | −9.2 final |
| Raw vector (m) | +5822.2405 / −5656.3389 / −4844.8090 | +5822.2410 / −5656.3414 / −4844.8065 | (+0.5, −2.5, +2.5) mm; 3D 3.6 mm |
| H-reduced 3D vs TBC | 22.6 mm | 20.0 mm | −2.6 mm |
| H-reduced length Δ vs TBC | −16.5 mm | −16.0 mm | +0.5 mm |
| Final covariance σ (mm) | 0.6/1.1/1.0 | 0.6/1.1/0.9 | sdz −0.1 mm |

## Leg C — true precise: EXECUTED with proof (not blocked)

CLI-only precise selection is IMPOSSIBLE in rnx2rtkp 2.5.1: the entire
argv parser (`app/consapp/rnx2rtkp/rnx2rtkp.c` L119–196) has no
ephemeris-mode flag — `sateph` keeps its `prcopt_default`
`EPHOPT_BRDC=0` (`src/rtkcmn.c` L208) unless a `-k` config file sets
`pos1-sateph` (`src/options.c` L50/L82: `0:brdc,1:precise,…`). This is
why 12J.1's SP3-as-input run stayed broadcast-by-dispatch. Leg C uses
`-k prec.conf` (`pos1-sateph=precise`) + `igs13793.sp3` (GPS-only use;
no GLONASS products mixed). Proof precise positions were selected:

1. Trace (`-x 3`): `satposs : … ephopt=1` ×186 epochs-calls
   (`src/ephemeris.c` L789; `ephopt` routes `satpos()` to
   `pephclk`/`peph2pos` instead of broadcast).
2. Zero `no prec ephem` / `no precise clock` failures in the C trace.
3. Falsification control: same `-k` conf WITHOUT the SP3 → 0 solution
   epochs + 2693 `no prec ephem` trace lines. The SP3 file (not the
   flag alone) drives the solution.
4. Solution body differs from broadcast leg B (sha `9af1b9da…` vs
   `4bd9ede8…`) — non-zero effect, i.e. precise orbits were consumed.
5. Trace caveat (not a gap): no `readpephs` lines exist because
   `readpreceph()` runs in `execses_b` (`src/postpos.c` L1293) BEFORE
   `execses` opens the trace file (L1058–1065) — SP3 loading is
   untraceable by construction; items 1–4 are the proof instead.

## §7 broadcast-vs-precise (all else fixed at 10°, B→C)

| Quantity | Leg B (broadcast) | Leg C (precise) | Delta C−B |
| -------- | ----------------- | --------------- | --------- |
| Raw vector (m) | +5822.2410 / −5656.3414 / −4844.8065 | +5822.2414 / −5656.3431 / −4844.8073 | (+0.4, −1.7, −0.8) mm; 3D 1.9 mm |
| H-reduced 3D vs TBC | 20.0 mm | 18.3 mm | −1.7 mm |
| H-reduced length Δ vs TBC | −16.0 mm | −14.3 mm | +1.7 mm |
| Status | FIX 90/93 | FIX 90/93 | none |
| Final ratio (max) | 19.4 (23.4) | 20.2 (25.5) | +0.8 (+2.1) |
| Final covariance | 0.0006/0.0011/0.0009, 0.0005/−0.0006/−0.0005 | identical at 0.1 mm print | 0 |
| ns distribution | {9:76, 10:17} | {9:76, 10:17} | none |

Effect is small (1.9 mm) but PROVEN non-zero — the opposite of 12J.1's
exactly-zero SP3-by-dispatch result, closing that open question.

## Staged-table rows (extend `phase12j1-staged-table.md` L1/L5 line)

| Stage | dX / dY / dZ H-reduced (m) | 3D vs TBC | Length Δ vs TBC |
| ----- | -------------------------- | --------- | --------------- |
| legacy-15° broadcast (A) | +5822.6389 / −5654.8636 / −4846.0864 | 22.6 mm | −16.5 mm |
| 10° broadcast (B) | +5822.6394 / −5654.8661 / −4846.0839 | 20.0 mm | −16.0 mm |
| 10° + true precise (C, IGS `igs13793.sp3`) | +5822.6398 / −5654.8678 / −4846.0847 | 18.3 mm | −14.3 mm |

Raw (pre-reduction) vectors: A +5822.2405/−5656.3389/−4844.8090;
B +5822.2410/−5656.3414/−4844.8065; C +5822.2414/−5656.3431/−4844.8073.
Final 3×3 (sdx,sdy,sdz,sdxy,sdyz,sdzx, m): A
0.0006/0.0011/0.0010/0.0005/−0.0007/−0.0005; B and C
0.0006/0.0011/0.0009/0.0005/−0.0006/−0.0005. Runtimes ~90/90/145 ms.

## §§15–17 records (all legs)

- §15 cadence: expected 93 (17:24:30,17:25:00,…,18:10:30); present
  93/93/93; rejected 0; first/last exact; spacing deviations 0/0/0.
- §16 dual-frequency: rover `C1C C2D L1C L2D`, base
  `L1 L2 C1 P2 P1 S1 S2` — phase present on L1+L2 at both ends,
  consumed via `-f 2`, FIX 90/93 achieved on every leg.
- §17 FIXED comparison primary throughout; float history identical on
  all legs: first 3 epochs (17:24:30–17:25:30) Q=2, ratio 0.0, then
  FIX from 17:26:00 (ratio 3.9–4.4) to final (28.6 / 19.4 / 20.2).

## Blockers for antenna legs (unchanged from 12J.1)

L2 (relative TRM60158.00-vs-TRM29659.00 PCO) and L3 (full PCV) remain
BLOCKED — no ANTEX staged locally, never downloaded (this batch is
evidence-only, no internet). The 18–23 mm remainder is where relative
PCO/PCV plus tropo/iono weighting and base-frame differences live —
not processor error.
