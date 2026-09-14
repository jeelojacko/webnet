# Phase 12J.2 — TBC Project-Settings Config Freeze (§1)

EVIDENCE ONLY. No production-code, tolerance, or math changes.
Source for all observed values below: **Phase 12J.2 mission TBC
project-settings evidence (operator screenshots/report); no TBC
screenshots are committed in repo.**

S32 oracle (fixed reference): P041→SIXTWO B32/S32, 2006-06-14
17:24:30–18:10:30 GPS, TBC dX/dY/dZ (+5822.646, −5654.885, −4846.085) m.
12J.1 RTKLIB marker-to-marker discrepancy ~22.6 mm 3D (15° mask + broadcast).

## Antennas (observed)

- Base (P041): TRM29659.00 SCIT
- Rover (SIXTWO): TRM60158.00 NONE

## Settings manifest

| TBC_SETTING | observed value | source | known processing effect | unknown processing effect | RTKLIB mapping |
|---|---|---|---|---|---|
| Solution type | Fixed | TBC project-settings evidence (see header) | Attempts integer ambiguity fixing | Fix/validation criteria (ratio test? min sats? thresholds?) | OPEN — unresolved |
| Frequency | All frequencies | TBC project-settings evidence (see header) | Uses all available frequencies in solution | Which freqs actually weighted per-sat/per-epoch | OPEN — unresolved |
| Processing interval | Automatic | TBC project-settings evidence (see header) | TBC picks decimation internally | Chosen interval for this baseline | OPEN — unresolved |
| Trajectory | Fixed and float | TBC project-settings evidence (see header) | Outputs both fixed and float trajectories | Acceptance logic between the two | OPEN — unresolved |
| Antenna model | Automatic | TBC project-settings evidence (see header) | Applies selected ANTEX/NGS calibration | Which calibration record resolved for each antenna | OPEN — unresolved |
| Ephemeris | Automatic | TBC project-settings evidence (see header) | TBC selects ephemeris source automatically | Broadcast vs precise actually used on S32 | OPEN — unresolved |
| Elevation mask | 10.0° | TBC project-settings evidence (see header) | Excludes satellites below 10° | Elevation weighting function, if any | OPEN — unresolved |
| GPS satellites | all enabled | TBC project-settings evidence (see header) | All GPS SVs eligible | Per-SV exclusions during S32 window | OPEN — unresolved |
| GLONASS satellites | all enabled | TBC project-settings evidence (see header) | All GLONASS SVs eligible | Whether any GLONASS entered S32 fix | OPEN — unresolved |
| S32 report solution | Fixed / dual-frequency / Precise / NGS Absolute / 30 s | TBC project-settings evidence (see header) | Declares fixed dual-freq solution with precise orbits, absolute antenna models, 30 s sampling | Exact precise product + ANTEX file identity | OPEN — unresolved |
| Quality FLAG/FAIL horizontal | 0.020 m + 1 ppm / 0.050 m + 1 ppm | TBC project-settings evidence (see header) | QC flag/fail display thresholds only | No effect on solution values assumed — unconfirmed | OPEN — unresolved |
| Quality FLAG/FAIL vertical | 0.050 m + 1 ppm / 0.100 m + 1 ppm | TBC project-settings evidence (see header) | QC flag/fail display thresholds only | No effect on solution values assumed — unconfirmed | OPEN — unresolved |
| Default standard error horizontal | 0.005 m + 1.0 ppm | TBC project-settings evidence (see header) | A-priori SE display value | Whether it seeds stochastic model | OPEN — unresolved |
| Default standard error vertical | 0.010 m + 2.0 ppm | TBC project-settings evidence (see header) | A-priori SE display value | Whether it seeds stochastic model | OPEN — unresolved |
| Centering error | 0.000 (default) | TBC project-settings evidence (see header) | No added centering variance | — | OPEN — unresolved |
| Antenna-height error | 0.000 (default) | TBC project-settings evidence (see header) | No added height variance | — | OPEN — unresolved |
| Coordinate system | Molodensky XYZ 0 / GRS80 / GEOID03 / Colorado North LCC | TBC project-settings evidence (see header) | Display/projection only; XYZ vector unaffected | Datum realization handling for XYZ output | OPEN — unresolved |

## Rule

Do NOT paraphrase rows above into RTKLIB settings. The RTKLIB mapping
column stays OPEN until each item is closed by a dedicated ladder rung
with its own evidence.
