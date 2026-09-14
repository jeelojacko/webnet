# Phase 12J.1 — RTKLIB WASM Proof §§36-44 (EVIDENCE ONLY)

Branch `feat/gnss-raw-rtklib-wasm-proof`. Local-corpus / /tmp-only evidence.
No `src/` / `tests/` / `TODO.md` / existing-file touches; no vendor data
committed (hashes + numbers only). Downstream + closeout batch: canonical
adapter (§36), frame rule (§37), provenance (§38), end-to-end (§39), network
experiment (§40), MVP table + readiness (§§41-42), acceptance A–S (§43).

Prior context: canonical MARKER-TO-MARKER convention
(`phase12j1-canonical-convention.md`), covariance audit (§§18-23,
`phase12j1-covariance-audit.md`), frame contract (§11,
`phase12j1-frame-contract.md`), WASM static API §§29-35
(`scripts/gnss/gnss12j1WasmStatic.ts`), 5/5-fixed cohort
(`phase12j1-cohort.md`, 21–29 mm after L1).

## §36 — Canonical adapter: `scripts/gnss/gnss12j1CanonicalAdapter.ts`

`adaptRawBaselineToObservation(raw, id)`: input must already carry
`reference === 'MARKER_TO_MARKER_ECEF'` (L1 reduction declared upstream);
anything else throws, never guesses. Full 3x3 carried; SPD gating reuses
the production validator read-only. Self-check 12/12 pass:

| # | Check | Result |
| --- | --- | --- |
| 1–3 | S32 vector / full 3x3 / provenance carried | ok |
| 4–7 | throw on `PHASE_CENTER_TO_CMD_POINT`, `ARP_TO_ARP`, `''`, `marker-to-marker` | ok ×4 |
| 8 | same-frame passthrough | ok |
| 9 | frame mismatch without transform throws | ok |
| 10–12 | explicit-transform vector/covariance/frame map (J=2I ⇒ d→2d, C→4C) | ok ×3 |

## §37 — Frame-aligned adapter rule (demonstrated, production deferred)

`adaptWithFrameCheck(raw, id, targetFrame, evidenceTransform?)`: source≠target
with no explicit transform ⇒ throw (proven: broadcast-WGS84-class →
`NAD83(2011)` throws). With an explicit Jacobian, `d_t = J·d_s`,
`C_t = J·C_s·J^T` endpoint-wise per the §12 oracle. **Production transform
stays deferred**: no Helmert between WGS84(G1150)-class/IGb00 and the project
frame is estimated or staged; any future production path must supply a
calibrated, versioned transform through this explicit slot — never relabel.

## §38 — S32 provenance record (`scripts/gnss/gnss12j1Provenance.ts`)

| Field | Value |
| --- | --- |
| Processor | demo5 RTKLIB, rtklibexplorer/RTKLIB @ `62d4677`, v2.5.1 (read-only `/tmp/rtklib-evidence`) |
| Runtimes | native gcc CLI (`/tmp/s32_run1.pos`) vs WASM `processStaticBaseline` (same TUs, emcc; CLI↔WASM \|Δpos\|=0) |
| Inputs (SHA-256) | `01241653.06o` fc20f5ff…06677aa (1879288 B); `p0411650_2.06o` e60ee2a1…079 (777412 B); `01241653.06n` 5050ebf5…f67a (13120 B); `p0411650_2.06n` 655e431f…4693 (229839 B) |
| Options hash | `467ddcc0…a4ca7251` over `-p 3 -f 2 -m 15 -sys G -v 3.0 -ti 30 -ts/-te 2006/06/14 17:24:30–18:10:30 -e -t -r <base>` |
| Window / interval | 2006-06-14 17:24:30–18:10:30 GPS, 30 s, static-relative forward-only, dual-frequency, 15° mask, ratio gate 3.0 |
| Constellations / signals | GPS-only; rover 3.04 C1C/C2D/L1C/L2D; base 2.10 L1/L2/C1/P2/P1/S1/S2; GLONASS measured no-op (§27) |
| Antennas | rover TRM60158.00 NONE H=2.0 m; base TRM29659.00 SCIT H=0.0083 m; NO PCV applied (no ANTEX) |
| Reference / frame | MARKER_TO_MARKER_ECEF after L1 reduction; WGS84(G1150)-class broadcast, epoch 2006-06-14 (never NAD83) |
| Solution | FIXED, ratio 28.6, 7 sats, 90/93 epochs; covariance = conditional filter covariance (optimistic by construction, §18) |
| Quality / weighting | ACCEPTED_FIXED; TBC B32 aposteriori stays the conservative weighting choice |

## §39 — End-to-end S32 (`scripts/gnss/gnss12j1EndToEnd.ts`) — PASS

RINEX bytes → prebuilt WASM → L1 → §36 adapter → `buildGnssReportFromInput`
(existing entry, as-is, no engine changes):

| Stage | Measured |
| --- | --- |
| WASM | FIX, ratio 28.6, 7 sats, 93 epochs, ~250 ms (golden match) |
| L1 correction (mm) | (−398.4, −1475.3, +1277.4) — reproduces the §6 value to 0.1 mm |
| Marked Δ (m) | (5822.6389, −5654.8636, −4846.0864), **22.6 mm** from TBC B32 |
| Adjustment | converged, dof=0, residuals ~3e-10 m |
| Report | `sessionId S32 / solutionId B32-RAW / P041→SIXTWO` survives |
| Adjusted SIXTWO (m) | (−1277811.4870, −4732082.7518, 4069951.9387) |

CLI↔WASM note (§32 rerun): 105=105 lines; only 2 header lines differ
(path echo); max numeric diff 0.1 on one convergence-epoch ratio display
digit (8.2 vs 8.1); **all XYZ/σ fields exact, \|Δpos\|=0**. Determinism:
same-instance ×3, post-interleave, fresh-instance all identical SHA.

## §40 — Network experiment (`scripts/gnss/gnss12j1NetworkExperiment.ts`)

4-leg redundant nets (HANNA×2 + FIVE×2), same apriori, existing engine:

| | Net A: processed vectors, TBC weights | Net B: TBC subset |
| --- | --- | --- |
| Residual norms (mm) | 6.8 / 6.9 / 11.2 / 6.3 | 2.0 / 2.7 / 9.2 / 6.3 |
| SEUW (vf) | **1.083** (1.173) | **0.568** (0.323) |
| dof / iters | 6 / 2 | 6 / 2 |

Coord A−B: HANNA **25.3 mm**, FIVE **20.6 mm** — network impact ≈ leg-level
\|Δvec\| (21–29 mm). No parity expectation was set (stochastic parity open,
§22); the 3.6× variance-factor inflation says the 21–29 mm vector residuals
exceed TBC-weighted expectations, as expected pre-calibration.

- **F1**: 5-net with native RTKLIB formals fails the existing fail-closed Qvv
  PSD gate (`λmin=−8.75e-21`, S32 leg) — optimistic formals are numerically
  toxic downstream, not just optimistic.
- **F2**: 5-net with TBC covariances trips the same gate on S32
  (`λmin≈−9e-20` ≈ few ULPs of C entries ~1e-4 vs `τ≈7e-28`) — engine-gate
  numerics note for stochastic-parity work, not a data rejection. S32 stays
  covered single-baseline (§39 + TBC probe, both solve).

## §§41-42 — MVP support table + readiness decision

| Capability | Status | Evidence |
| --- | --- | --- |
| GPS L1/L2 static-relative FIX, deterministic | SUPPORTED | 5/5 fixed, CLI↔WASM exact, determinism 3/3 |
| RINEX→WASM→L1→adapter→adjust→report chain | SUPPORTED | §39 PASS, no engine changes |
| Mark-to-mark adapter + frame-mismatch refusal | SUPPORTED | §36 12/12, §37 throws proven |
| Provenance capture (hashes/options/quality) | SUPPORTED | §38 record |
| RTKLIB formal covariances as weights | NOT SUPPORTED | F1 fail-closed; 4–17× optimistic (§21) |
| Production frame transform | DEFERRED | §37 explicit-slot only |
| Antenna PCO/PCV (NGS Absolute) | OPEN (~23 mm remainder) | §6; no ANTEX staged |
| GLONASS / precise-ephemeris legs | NOT REQUIRED / NOT PROVEN | §27 no-op; §14 broadcast-identical by dispatch |
| 5-baseline redundant net incl. S32 | BLOCKED (engine gate, F2) | 4-nets solve; S32 single-baseline solves |

**Decision: WITH-RESTRICTIONS** (raw-worker MVP may proceed only under all of):
1. GPS-only, short-baseline DD, TBC windows/options verbatim; 2. TBC-grade
(conservative) weighting only — never RTKLIB formals; 3. §36 adapter mandatory
(explicit MARKER_TO_MARKER_ECEF, mismatch throws); 4. broadcast-frame labeling,
no NAD83 inheritance, transform via explicit slot only; 5. human staged review
before any production ingestion; 6. S32-class legs single or 4-net only until
the F2 gate-numerics review lands. Lifting any restriction needs its named
evidence (stochastic parity, calibrated Helmert, ANTEX leg) — not argument.

## §43 — Acceptance A–S

| ID | Item (§) | Verdict | Evidence pointer |
| --- | --- | --- | --- |
| A | Adapter carries S32 vector+cov+provenance (§36) | PASS | §36 checks 1–3 |
| B | Wrong reference throws, never guesses (§36) | PASS | §36 checks 4–7 (×4 cases) |
| C | Same-frame passthrough (§37) | PASS | §36 check 8 |
| D | Mismatch without transform throws (§37) | PASS | §36 check 9 |
| E | Explicit-transform math J·d, J·C·Jᵀ (§37) | PASS | §36 checks 10–12 |
| F | Production transform deferred, documented (§37) | PASS | §37 section above |
| G | Provenance record complete (§38) | PASS | §38 table |
| H | Input SHAs from corpus inventory (§38) | PASS | §38 SHA rows |
| I | WASM reproduces S32 golden (§39) | PASS | §39: 28.6/7/93 |
| J | L1 correction reproduces §6 (§39) | PASS | §39: 0.1 mm |
| K | 22.6 mm vs TBC (§39) | PASS | §39 marked Δ |
| L | Existing adjustment as-is, converges (§39) | PASS | §39 dof=0, ~0 residual |
| M | Report/provenance survives (§39) | PASS | §39 S32/B32-RAW entry |
| N | 4-nets solve both sides, dof=6 (§40) | PASS | §40 table |
| O | Coord diffs consistent w/ leg level (§40) | PASS | 25.3/20.6 mm vs 21–29 mm |
| P | F1 native formals fail closed (§40) | PASS | F1 gate message |
| Q | F2 S32 5-net gate recorded (§40) | PASS | F2 gate message |
| R | MVP table + readiness decision (§§41-42) | PASS | WITH-RESTRICTIONS + 6 restrictions |
| S | Report committed, no vendor data, pushed (§§43-44) | PASS | this file on branch HEAD |
