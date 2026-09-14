# Phase 12J.1 §10 — P041 Base-Coordinate Sensitivity (EVIDENCE ONLY)

Local-corpus / /tmp-only evidence. Reuses the pinned `rnx2rtkp` binary
(commit 62d4677, /tmp only — no rebuild, no `make clean`). S32 command as
in the pin record, varying only `-r`. No `src/` changes, no vendor bytes
committed. `.pos` outputs in /tmp only.

Nominal base `-r -1283634.1259 -4726427.8882 4074798.0251` (header approx):
rover final FIX (−1277811.8854, −4732084.2271, 4069953.2161), ratio 28.6,
FIX 90/93, σ 0.6/1.1/1.0 mm, d = (+5822.2405, −5656.3389, −4844.8090).

| Variant | Base shift (m) | Rover final FIX XYZ (m) | Vector Δd vs nominal (mm) | Length Δ (mm) | AR / ratio / σ |
| ------- | -------------- | ----------------------- | ------------------------- | ------------- | -------------- |
| +1 m X | (+1, 0, 0) | (−1277810.8854, −4732084.2274, 4069953.2162) | (0.0, −0.3, +0.1), 0.3 | 0.0 | FIX 90/93, 28.5, same |
| +1 m Y | (0, +1, 0) | (−1277811.8853, −4732083.2271, 4069953.2158) | (+0.1, 0.0, −0.3), 0.3 | 0.0 | FIX 90/93, 28.9, same |
| +1 m Z | (0, 0, +1) | (−1277811.8855, −4732084.2270, 4069954.2161) | (−0.1, +0.1, 0.0), 0.1 | 0.0 | FIX 90/93, 28.7, same |
| Datasheet | (+0.6479, −1.3058, +0.0599), 1.4589 m | (−1277811.2377, −4732085.5330, 4069953.2764) | (−0.2, −0.1, +0.4), 0.5 | 0.0 | FIX 90/93, 28.2, same |

Datasheet base: `p041.ds` NAD83(CORS) epoch 2002.00 ARP
(−1283633.478, −4726429.194, 4074798.085).

## Verdict: cancellation PROVEN numerically

The rover tracks the base shift ~1:1 (e.g. datasheet leg: rover moves
+0.6477/−1.3059/+0.0603 vs base +0.6479/−1.3058/+0.0599), so the DD vector
is base-invariant to ≤0.5 mm under a 1.4589 m absolute shift. AR status,
epoch counts, and formal covariance are untouched. The header-vs-datasheet
offset is therefore absolute-frame only (§16) — it cannot explain any part
of the ~23 mm mark-to-mark remainder, and TBC's fixed P041 choice is not
needed for vector parity (only for absolute-frame legs).
