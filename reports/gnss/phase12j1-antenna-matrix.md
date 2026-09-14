# Phase 12J.1 §8 — ANTEX Matrix (EVIDENCE ONLY)

Local-corpus / /tmp-only evidence. No `src/` changes, no vendor bytes
committed, nothing downloaded (per Batch B rules, NEVER download).

## Antenna models (read from corpus RINEX headers, never committed)

| End | File | Antenna model | DELTA H/E/N (m) |
| --- | ---- | ------------- | --------------- |
| Rover SIXTWO | `01241653.06o` (RINEX 3.04) | TRM60158.00 NONE, no serial | 2.0 / 0 / 0 |
| Base P041 | `p0411650_2.06o` (RINEX 2.10) | TRM29659.00 SCIT s/n 0220321767 | 0.0083 / 0 / 0 |

## ANTEX staging check

Searched `~/Downloads/webnet-gnss-12e/` for `*.atx` / `*antex*` / `*.ANT`:
**no ANTEX (or NGS PCV) file staged — absent.** No 2006-era absolute
calibrations for TRM60158.00 / TRM29659.00 are available locally.

## Matrix legs (S32 P041→SIXTWO, broadcast)

| Leg | Meaning | Status | Vector dX/dY/dZ (m) | 3D vs TBC |
| --- | ------- | ------ | ------------------- | --------- |
| A | No PCV, no reduction (Batch A raw rerun) | DONE | +5822.2405, −5656.3389, −4844.8090 | 1.9765 m |
| B | Marker↔ARP offsets only (WGS84 ellipsoidal Up, §9 oracle) | DONE | +5822.6389, −5654.8636, −4846.0864 | 22.6 mm |
| C | + relative PCO | BLOCKED — no ANTEX staged, never downloaded | — | — |
| D | + full PCV (elevation/azimuth) | BLOCKED — no ANTEX staged, never downloaded | — | — |

Leg B correction: (−0.3984, −1.4753, +1.2774) m, |.| = 1.9917 m; remainder
(−0.0071, +0.0214, −0.0014) m = 22.6 mm, which is where the relative
PCO/PCV of legs C/D is expected to live. Length: raw 9453.2972 →
leg-B 9453.3147 vs TBC 9453.3312 (Δ −16.5 mm).

Nothing in this matrix is attributed to RTKLIB: RTKLIB ran leg A only
(`dant = 0`, pinned §4/§6); legs B–D are our staged post-processing, of
which only B is executable today.
