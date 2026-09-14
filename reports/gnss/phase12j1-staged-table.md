# Phase 12J.1 §13 — S32 Staged Table L0–L5 (EVIDENCE ONLY)

S32 = P041→SIXTWO, 2006-06-14 17:24:30–18:10:30 GPS. TBC B32 reference:
d = (+5822.646, −5654.885, −4846.085), length 9453.3312 m, mark-to-mark,
NGS Absolute. Local-corpus / /tmp-only evidence; no `src/` changes.

| Stage | Meaning | dX / dY / dZ (m) | 3D vs TBC | Length (m) | Length Δ vs TBC |
| ----- | ------- | ---------------- | --------- | ---------- | --------------- |
| L0 raw | RTKLIB broadcast FIX 90/93, ratio 28.6, `dant = 0` | +5822.2405 / −5656.3389 / −4844.8090 | 1.9765 m | 9453.2972 | −34.0 mm |
| L1 marker-ARP | L0 − (H_rov·Up_rov − H_base·Up_base), WGS84 ellipsoidal (§9 oracle PASS) | +5822.6389 / −5654.8636 / −4846.0864 | 22.6 mm | 9453.3147 | −16.5 mm |
| L2 PCO | + relative TRM60158.00-vs-TRM29659.00 PCO | BLOCKED — no ANTEX staged locally, never downloaded | — | — | — |
| L3 PCV | + full elevation/azimuth PCV | BLOCKED — no ANTEX staged locally, never downloaded | — | — | — |
| L4 frame | Broadcast-frame → project-frame endpoint transform | NOT EXECUTED — adapter path is evidence-only design (§11/§17); math proven by §12 oracle, no numeric leg run | — | — | — |
| L5 orbit | Broadcast vs SP3 `igl13793.sp3` (IGb00) | identical to 0.1 mm (§19) | ≈ L1 | ≈ L1 | ≈ L1 |

Per-stage deltas: L0→L1 moves (−0.3984, −1.4753, +1.2774)-equivalent
1.9917 m correction, closing 1.9765 m → 22.6 mm. L1→L2/L3 unexecuted: the
22.6 mm remainder (−0.0071, +0.0214, −0.0014) is where relative PCO/PCV
plus tropo/iono weighting and base-frame differences live — it is NOT
processor error. Final 3D delta after all executable stages: **22.6 mm**.
