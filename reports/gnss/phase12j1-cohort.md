# Phase 12J.1 Batch C2 — First Parity Cohort §§24-27 (EVIDENCE ONLY)

Local-corpus / /tmp-only evidence on branch
`feat/gnss-raw-rtklib-wasm-proof`. No `src/`/`tests/` changes, no vendor
bytes committed. Reproducible via
`npx tsx scripts/gnss/gnss12j1Cohort.ts` (fail-closed SKIP when the local
corpus `~/Downloads/webnet-gnss-12e/raw-baselines/` or the pinned
`rnx2rtkp` binary from `/tmp/rtklib-evidence`, commit `62d4677`, is
absent; solutions run into `os.tmpdir()`).

Canonical command per leg (GPS-only; `-sys G`, exact TBC window):

`rnx2rtkp -p 3 -f 2 -m 15 -v 3.0 -ti 30 -sys G -ts <TBC-START> -te
<TBC-STOP> -e -t -o OUT -r -1283634.1259 -4726427.8882 4074798.0251
<rover.06o> p0411650.06o <rover.06n> p0411650.06n`

Vectors compared MARKER-TO-MARKER (canonical convention): raw RTKLIB
vector (last-FIX `.pos` XYZ minus the `-r` base point) reduced by the
L1 marker-ARP correction `H_rov·Up_rov − H_base·Up_base`
(H_rov = 2.0 m all rovers, H_base = 0.0083 m), then differenced against
the TBC mark-to-mark DX/DY/DZ.

## 12J.0 open issue — RESOLVED: no P041 session split

The four `p0411650[_0/_1/_2].06o` variants are **body-identical**
(identical md5 over post-`END OF HEADER` bytes; the single differing
byte range is the `PGM / RUN BY / DATE` download-timestamp comment).
One session, one file: every leg below uses the canonical
`p0411650.06o` (30 s, 14:00–20:00 GPS, covers all windows).

## §24 — Parity cohort: 5/5 attempted, 5 FIXED, 0 float-only, 0 failed

| Leg | TBC sol | Station | TBC window (GPS) | Dur | FIX/total | Ratio med/max | |Δvec| L1-corr | Δlen | RTKLIB σx/σy/σz | TBC σx/σy/σz | tr | Run |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S38 | B38 | HANNA | 14:57:30–15:31:00 | 33:30 | 65/68 | 9.6/13.2 | **29.0 mm** | +0.5 mm | 0.6/1.2/1.0 mm | 3.3/6.9/5.4 mm | 0.03 | 72 ms |
| S40 | B40 | HANNA | 15:49:30–16:21:00 | 31:30 | 61/64 | 11.2/29.4 | **22.1 mm** | −5.8 mm | 0.8/1.5/0.9 mm | 3.6/6.1/4.9 mm | 0.05 | 69 ms |
| S39 | B39 | 5 | 16:38:00–17:11:00 | 33:00 | 64/67 | 21.3/33.7 | **21.6 mm** | −11.8 mm | 0.7/1.2/1.0 mm | 4.8/8.6/7.2 mm | 0.02 | 67 ms |
| S32 | B32 | SIXTWO | 17:24:30–18:10:30 | 46:00 | 90/93 | 22.3/28.6 | **22.6 mm** | −16.5 mm | 0.6/1.1/1.0 mm | 5.0/18.6/15.1 mm | 0.00 | 91 ms |
| S31 | B31 | 5 | 18:26:00–19:01:00 | 35:00 | 67/71 | 10.1/13.4 | **23.0 mm** | −13.3 mm | 1.2/1.8/2.3 mm | 4.3/8.6/5.5 mm | 0.08 | 64 ms |

Max |Δvec| after L1 correction **29.0 mm** (S38), median **22.6 mm**.
Every leg: TBC solution type Fixed, RTKLIB holds FIX ≥95% of epochs
(only the first 3–4 convergence epochs float). S32 reproduces the
established golden values exactly (90/93, 22.3/28.6, 22.6 mm).

Covariance finding (one-liner): on all five legs the RTKLIB formal
sigmas are ~4–17× tighter than the TBC aposteriori sigmas (worst leg σy 16.9×; trace ratio
0.00–0.08) with the same elongation axis family — RTKLIB
under-disperses relative to TBC, so TBC covariances stay the
conservative weighting choice; no leg justifies shrinking the
stochastic model toward the RTKLIB formals.

## §25 — `*a` verdict: ALTERNATE/DECIMATED, no independent semantics

Same base, same window, main vs `*a` rover; last-FIX vector distance:

- S39 window: `01241652.06o` vs `01241652a.06o` → **0.0 mm**
- S36 window (18:16:30–19:00:00): `89911654.06o` vs `89911654a.06o` → **0.0 mm**

The `*a` files are 30 s GPS-only decimations (67/43 epochs on the 30 s
comb) that reproduce the 1 Hz mains bit-for-bit through the same
decimation grid. `*a` stays secondary: never a primary occupation,
never an independent baseline.

## §26 — Rover↔rover: 2/2 processed GPS-only

Base point = the designated-base file's header APPROX XYZ (not a
surveyed marker — vectors reported as processed, no TBC reference):

| Pair | Base → Rover | Window (GPS) | FIX/total | Ratio max | Run |
| --- | --- | --- | --- | --- | --- |
| RR1 | 80341650 (5) → 89911650 (fsi) | 15:00:00–15:30:00 | 60/63 | 66.0 | ~70 ms |
| RR2 | 15151658 (fsi) → 89911653 (3) | 17:24:00–18:10:00 | 90/93 | 48.1 | ~90 ms |

Both legs fix cleanly on overlapping 1 Hz RINEX 3.04 pairs with plain
GPS-only options — rover↔rover processing needs no new machinery.

## §27 — GLONASS verdict: MEASURED NO-OP, not MVP-required

Same two pairs with `-sys GR` plus the `.06g` navs: RR1 FIX 60/63
rMax 66.0, RR2 FIX 90/93 rMax 48.1 — **solution bodies bit-identical
to the GPS-only runs** (0 diff lines, identical ns distributions).
Control: `-sys R` (GLONASS-only) on the RR1 window yields **0/0
epochs** — no R satellite ever enters the solution. Prime suspect in
the local corpus: each `.06g` holds only 12 records written with
RINEX2-style `R n` satellite IDs inside a 3.04 wrapper, so the reader
plausibly drops every GLONASS ephemeris (unconfirmed — needs a trace
run, not a guess). ISB estimation and the GLONASS AR policy
(`glomodear`) are therefore **unexercised**, and no covariance change
exists to report. GPS+GLONASS stays NOT required for MVP; GPS-only is
the certified path. Revisit only with conformant GLONASS nav.

## §28 (partial) — CLI determinism: PASS

Machine-readable outputs = `.pos` solution bodies (headers excluded),
SHA-256 hashed: S32 ×3 runs identical, S39 rerun identical, S31 rerun
identical (4/4 SAME). Runtimes 64–91 ms per leg — reruns are cheap.
