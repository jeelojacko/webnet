# Phase 12J.2 — SP3 Product Identity (§8 SP3)

EVIDENCE ONLY. Corpus is LOCAL-ONLY at
`~/Downloads/webnet-gnss-12e/raw-baselines/` (never commit).
S32 window: 2006-06-14 17:24:30–18:10:30 GPS.

Resolves 12J.1 ambiguity: the depth script used `igs13793.sp3` while
frame/staged reports cited `igl13793.sp3`. Only one of these can feed a
GPS-only S32 ladder rung.

## Identity log (sha256sum, local corpus)

| filename | sha256 | size (bytes) | time span (first → last epoch) | header agency/product | SV coverage |
|---|---|---|---|---|---|
| igs13793.sp3 | 064343f96ac7aab0bd8ae909b5b55f3ecac657a91ce44b62e659beb6d7d134f1 | 229922 | 2006-06-14 00:00:00 → 23:45:00 UTC (96 epochs @ 15 min) | `#cP … ORBIT IGb00 HLM IGS` | 29 GPS (G01–G30 minus G12/G31 per `+` lines; `PGxx` records) |
| igl13793.sp3 | b122b19ee2fdc181e846cfcdd72e37f96af9f4d6d1824aa734bc840ed814a4ff | 98114 | 2006-06-14 00:00:00 → 23:45:00 UTC (96 epochs @ 15 min) | `#bP … ORBIT IGb00 HLM IGS` | 16 GLONASS (R01–R24 subset; `PRxx` records, zero GPS) |

Split variants are byte-identical to the merged files (same sha256):
`igs13793_0/1/2.sp3` = same hash as `igs13793.sp3`;
`igl13793_0/1/2.sp3` = same hash as `igl13793.sp3`. No separate
provenance — treat as copies, not independent products.

## S32 window coverage

- `igs13793.sp3`: window 17:24:30–18:10:30 is fully bracketed by 15-min
  epochs 17:15 / 17:30 / 17:45 / 18:00 / 18:15. COVERED.
- `igl13793.sp3`: contains no GPS orbits at all. NOT USABLE for a
  GPS-only S32 solution regardless of time span.

## Recommendation

The ladder MUST use **`igs13793.sp3`**
(sha256 `064343f9…d7d134f1`, 229922 bytes, IGS combined GPS final,
29 SVs, S32 window fully covered).

Reasoning: S32 is a GPS-only baseline; `igl13793.sp3` is the IGS
GLONASS product (16 R-SVs, `#bP` header, zero `PGxx` records) and
contributes nothing to it. Do not mix GLONASS products into S32;
GLONASS handling belongs to a separate later rung, if at all.

## Blockers for the ladder

None from SP3 identity. Open items live in
`reports/gnss/phase12j2-tbc-config.md` (RTKLIB mapping column all OPEN)
and the known TBC unknowns: fix-validation criteria, actual ephemeris
selection ("Automatic"), actual processing interval ("Automatic"), and
whether any GLONASS entered the S32 fix.
