# Phase 12J.2 Batch C — Antenna Calibration §§9–14 + §29 Audit (EVIDENCE ONLY)

S32 = P041 (TRM29659.00 SCIT) → SIXTWO (TRM60158.00 NONE). TBC B32 reference:
d = (+5822.646, −5654.885, −4846.085) m, mark-to-mark, NGS Absolute.
No `src/` changes, no math/tolerance changes, no vendor bytes committed,
no UI/worker code. All ANTEX bytes live in `/tmp` only.

## §§9–10 — ANTEX source / version / hash (evidence copies in /tmp ONLY)

Two authoritative IGS files were checked. Neither was written into the repo.

| File | Provenance | Size (bytes) | sha256 | Version / date |
| --- | --- | --- | --- | --- |
| `/tmp/rtklib-evidence/data/ant/igs14.atx` | Ships with pinned RTKLIB tree 62d4677 (pre-existing in /tmp, no download) | 18422911 | `d59a419776e68af938af52f4c6f1a09467784cb3d1f530d4415f4b7f1f685d9e` | ANTEX 1.4, receiver blocks dated 29-JAN-17, 708 TYPE/SERIAL records |
| `/tmp/igs20.atx` | Downloaded `https://files.igs.org/pub/station/general/igs20.atx` (http 200, server content-length 60295761) | 60295761 | `8715268e17e09e5447f4949d67cbd067e7f0f33d48dd698aafe14f5cffb26de2` | IGS20 release (GPS week 2220), receiver updates noted through week 2354 |

Caveat: the hosted igs20 copy ends at the C06 satellite block with no
`END OF ANTEX FILE` footer (satellite tail truncated at source). The
receiver section — the only part this batch needs — is verified complete:
916 `START OF ANTENNA` / 916 `END OF ANTENNA`, every opened block closed.

## §11 — Name-match verdict per antenna

Lookup key = RINEX `ANT # / TYPE` string verbatim (`TYPE + radome`;
radome `NONE` = no radome, serial numbers are unit-specific and play no
role — ANTEX entries are type calibrations).

| End | RINEX string | igs14.atx | igs20.atx | `ngs_abs.pcv` (bundled) | Verdict |
| --- | --- | --- | --- | --- | --- |
| Base P041 | `TRM29659.00 SCIT` | EXACT MATCH L93786 (`TYPE / SERIAL NO`) | EXACT MATCH L326784 | present (NGS 05/06/10) | ✅ MATCH — no mapping needed |
| Rover SIXTWO | `TRM60158.00 NONE` | absent (`grep -c 60158` = 0) | absent (`grep -c 60158` = 0; TRM inventory jumps 59900 → next, no 60xxx) | absent | ❌ MISSING |

No RINEX-vs-ANTEX naming translation is required: IGS ANTEX keys use the
same `TRMxxxxx.xx + radome` convention as the RINEX headers (proven by the
exact base-station match). The rover antenna has no IGS absolute
calibration in either the 2017 or the current file.

**§§12–13 leg C/D verdict: full-PCV parity BLOCKED with proof** (accepted
outcome). No leg-D numbers were run; none are faked below.

## §§12–13 — Marker→H/E/N→ARP→PCO→PCV→observation→marker-to-marker audit

Traced against `phase12j1-marker-arp-contract.md` + pinned source:

1. **H/E/N single-use ✅.** RINEX `DELTA H/E/N` is parsed to `sta->del`
   (`rinex.c readrnxh`) but never enters the DD estimator; the S32 run had
   `dant = 0` for every satellite (`rtkpos.c resd()` L1068 via `antmodel()`,
   `antdel` all-zero, `pcvr` empty). The 12J.1 L1 reduction applies H exactly
   once per endpoint along local ellipsoidal Up, outside RTKLIB. No path
   applies it twice.
2. **PCO/PCV belongs in the observation model ✅.** `antmodel()` adjusts
   each range per-satellite per-epoch from az/el (`rtkpos.c` L1068). PCV is
   direction-dependent, so no post-solve XYZ shift can substitute for it —
   legs C/D must be executed as estimator reruns with ANTEX staged, never as
   vector arithmetic on leg-B output.
3. **Double-application risk of the ~2 m H once receiver PCO is enabled:
   NONE, provided the staging rule is followed.** ANTEX PCO is the
   ARP→mean-phase-center segment (antenna-fixed, cm-level, per-frequency);
   H is the marker→ARP segment (field setup, 2.0 m / 0.0083 m). Disjoint
   segments, no overlap. Staging rule for the future unblocked leg D: set
   `anttype` + `file-rcvantfile` via `-k` conf, leave `antdel` zero (do NOT
   copy RINEX H into `ant1/2-antdelu` — that path adds delta inside
   `antmodel` and WOULD double-count against L1), rerun, then apply the L1
   H-reduction (numerically unchanged — it is geometry-only) exactly once.

## Leg D — BLOCKED proof + exact CLI/conf mechanism (no fake numbers)

- **Blocked reason:** rover `TRM60158.00 NONE` has no record in igs14.atx or
  igs20.atx (§11 table). A receiver-PCV rerun with only the base calibrated
  would be a half-calibrated leg, not leg D — refused.
- **Mechanism correction:** the brief's "`-x antefile`" is wrong for this
  tool. In `rnx2rtkp.c` L187, `-x` sets trace level. Receiver ANTEX is
  staged via `-k conf` keys `file-rcvantfile=<path>` (+ `file-satantfile`
  for satellite PCV) and `ant1-anttype` / `ant2-anttype`
  (`options.c` L168–191), loaded by `postpos.c` `openses()` via `readpcv()`;
  the type string is resolved per-epoch by `searchpcv()` (type+radome+time).
  `anttype "*" ` falls back to RINEX-header del — not our path.
- **Unblock protocol (frozen, for when a rover record exists):** S32 leg D,
  broadcast + 10° mask (Batch B convention isolates the antenna effect —
  TBC mask is 10°, and broadcast removes the orbit variable; state both),
  first PCO-only then PCO+PCV, report vector/covariance/ratio deltas vs the
  no-antenna leg. Never tune to match TBC.

## §14 — H/E/N sign-control oracle ✅ PASS

Independently recomputed in WGS84 (ellipsoidal Up per endpoint, no repo
code): subtrahend `(H_rov·Up_rov − H_base·Up_base)` with H_rov = 2.0 m,
H_base = 0.0083 m:

- computed: (−398.4, −1475.3, +1277.4) mm, |.| = 1.9917 m
- reference (`phase12j1-rtklib-wasm-proof.md:63-68`): (−398.4, −1475.3, +1277.4) mm
- component agreement to 0.1 mm; sign consistent with the contract
  `Δ_mark = Δ_raw − (H_rov·Up_rov − H_base·Up_base)` (rover marker sits
  2 m below its phase point along Up; the correction subtracts the
  rover-Up-dominated term).

## §29 — Satellite-PCV / phase-wind-up audit

| Question | RTKLIB S32 path (`rtkpos.c`, relative/DD) | TBC (per frozen config) | Classification |
| --- | --- | --- | --- |
| Receiver PCO/PCV | OFF in matched config (`dant = 0`, proven §12); stageable via `file-rcvantfile` | NGS Absolute, model "Automatic", per-antenna record identity unknown | BLOCKED leg, open record identity |
| Satellite PCO/PCV | NOT modeled — zero `satantoff`/`antmodel_s`/`satpcv` references in `rtkpos.c`; satellite ANTEX (`file-satantfile`) feeds only the PPP path (`ppp.c` L1012) | no evidence in TBC settings | OPEN model difference, no staging required for S32 path |
| Phase wind-up | NOT modeled in `rtkpos.c`; `model_phw()` exists only in `ppp.c` (L295+, applied L429/L1014) | no evidence in TBC settings | OPEN model difference |

Receiver vs satellite calibration are separated: TBC's "NGS Absolute"
covers the receiver ends; nothing in evidence says TBC applies satellite
PCV or wind-up on this baseline, and the RTKLIB S32 path models neither.
In short-baseline DD both largely cancel (satellite PCO cancels; wind-up
mostly cancels), so expected contribution is mm-level on 9.4 km — an open
model difference, not a blocker. Open question recorded: which record
TBC's "Automatic" resolved for `TRM60158.00` given its absence from IGS
ANTEX (possibly an NGS ANTCAL individual calibration) — NGS-side lookup
not attempted, no further downloads made.
