# Phase 12J.2 Batch E §§38–42 — Finalized-Config WASM Parity + Canonical End-to-End (EVIDENCE ONLY)

Branch `feat/gnss-raw-tbc-parity-closure`. EVIDENCE ONLY: no `src/`
changes, no math/tolerance changes, no vendor commits, no downloads.
Same runner (`scripts/gnss/gnss12j2Cohort.ts`) and finalized S32 policy
as `phase12j2-cohort.md` (10° mask + TRUE precise via `-k prec.conf` +
`igs13793.sp3` + GPS-only `-f 2` FIXED, no antenna calibration).
Prebuilt WASM `/tmp/webnet-12j1-wasm/rnx2rtkp.js`
(same translation units as the pinned gcc build). All WASM files cross
through the evidence MEMFS layer (`/work/*`, copy semantics, outputs
unlinked before each run — a failed run can never return a stale
solution). All inputs are byte-identical host reads of the local corpus.

## §38 — Finalized-config CLI↔WASM parity on S32: PASS (bit-identical)

Same `-k prec.conf` through a MEMFS `/work/prec.conf` copy and the SP3
as `/work/nav2.sp3` (the `.sp3` extension is required — RTKLIB dispatches
precise-ephemeris reading by extension; a `.nav`-named SP3 is silently
not precise).

| Quantity | CLI | WASM | Δ |
| -------- | --- | ---- | - |
| Status | FIX | FIX | none |
| Raw vector dX/dY/dZ (m) | +5822.2414 / −5656.3431 / −4844.8073 | identical | 0.0 mm |
| H-reduced 3D vs TBC | 18.3 mm | 18.3 mm | 0.0 mm |
| Covariance (sdx/sdy/sdz/sdxy/sdyz/sdzx, m) | 0.0006/0.0011/0.0009/0.0005/−0.0006/−0.0005 | identical | 0 |
| Final ratio | 20.2 | 20.2 | 0 |
| Epochs (FIX/total) | 90/93 | 90/93 | none |
| Final ns | 9 | 9 | none |
| Solution-body sha256 (headers excluded) | `9af1b9da16a669aa…` | `9af1b9da16a669aa…` | EQUAL |

## §39 — SP3-WASM consumption proof: PROVEN (not by-dispatch)

1. Trace through MEMFS (`-x 3`, trace read back from `/work/`):
   `satposs … ephopt=1` ×**186** epoch-calls — the WASM estimator
   selected precise positions on every epoch, matching the CLI proof.
2. Falsification control: identical MEMFS run with `-k prec.conf` but
   the SP3 withheld → **NONE, 0 epochs** (2693-equivalent `no prec ephem`
   path; solution cannot exist without the product). The SP3 bytes drive
   the WASM solution — **fail-closed, PASS**.
3. Product identity: SP3 sha256 `064343f9…d7d7` recorded on both sides;
   sats found 9 final (ns distribution path identical — body sha equal).

## §40 — ANTEX-WASM state: WITHOUT-antenna parity PROVEN, ANTEX-WASM NOT-REQUIRED

Binding capability (source audit, no new build): the WASM module compiles
the same `rtkcmn.c` (`readantex`/`readpcv`) and `postpos.c`
(`file-satantfile`/`file-rcvantfile` via `-k`, L903–911) as the CLI —
an ANTEX file CAN cross MEMFS exactly like `prec.conf`/SP3 (no host-path
dependency by construction), and the repeated-run check below shows no
state leakage across runs on one instance (repeat body sha EQUAL →
`repeatSame=true`; outputs unlinked pre-run, caller buffers copy-in).

Requirement verdict: **ANTEX-WASM NOT-REQUIRED.** The supported path
contains no antenna calibration on either side (rover TRM60158.00 NONE
absent from IGS14/IGS20/NGS per `phase12j2-antenna.md` → PCV BLOCKED;
base P041 matches but a one-sided cal is not the TBC NGS-Absolute
pair). Both CLI and WASM run with empty sat/rcv ANTEX (`dant = 0` for
every satellite) — and §38 proves they agree bit-for-bit in exactly
that WITHOUT-antenna configuration. Stage ANTEX-over-MEMFS only when
the rover cal exists; until then it would change numbers without a
reference to compare against.

## §§41–42 — Finalized S32 end-to-end: PASS, no mystery postprocessing

Chain (existing pieces only, called as-is): RINEX+NAV+SP3 bytes → WASM
finalized solution → L1 marker-ARP reduction (existing cohort helper) →
`MARKER_TO_MARKER_ECEF` `RawGnssBaselineSolution` → §36 adapter →
`buildGnssReportFromInput` (no engine changes). Result: adjustment
**converged** (dof 0, single-baseline), marked vector
[+5822.6398, −5654.8678, −4846.0847] m = **18.3 mm vs TBC**, and
report/provenance survives (`sessionId=S32`, `solutionId=B32-FIN`,
`from=P041`, `to=SIXTWO`). Every transform is declared above; the
adapter still throws on any non-`MARKER_TO_MARKER_ECEF` reference.

Expanded provenance record (S32 finalized):

| Slot | Value |
| ---- | ----- |
| Elevation mask | 10°, requested = actual (ns 9 final, band admission per ladder leg B) |
| Frequency policy + actual signals | `-f 2` dual-frequency; rover `C1C C2D L1C L2D`, base L1+L2 phase; FIX 90/93 |
| Ephemeris requested vs actually used | precise requested (`pos1-sateph=precise`); precise USED (`ephopt=1` ×186, zero `no prec ephem`) |
| SP3 identity | `igs13793.sp3`, sha256 `064343f96ac7aab0bd8ae909b5b55f3ecac657a91ce44b62e659beb6d7d134f1` |
| Antenna policy + resolved cals | NONE staged on either side; rover TRM60158.00 NONE uncalibrated (PCV BLOCKED), base TRM29659.00 SCIT matched-but-unused; `dant = 0` |
| Interval policy + actual | `-ti 30`; 93/93 epochs, 17:24:30–18:10:30 exact, 0 rejected, 0 spacing deviations |
| FIX status | FIXED primary (90/93; first 3 epochs float, convergence) |
| Covariance semantics | RTKLIB formal 3×3 (0.6/1.1/0.9 mm), under-dispersed vs TBC aposteriori — carried as-is, TBC stays the conservative weight |
