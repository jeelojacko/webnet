# Phase 12J.10 — Final Raw-GNSS Hardening

Branch: `feat/gnss-raw-final-hardening` → PR #63 (no auto-merge).
Baseline: origin/main 58d7cbed (PR #62 merge).

Frozen (untouched): REVIEW_ONLY_FINAL covariance, RTKLIB_FORMAL /
UNCALIBRATED / FORMAL_UNCALIBRATED wording, DIRECT_INGEST NO,
SPANNING_TREE_SUFFICIENT_INITIAL, GNSS adjustment math, R2B,
free-network math, numerical tolerances, stochastic models.

## 0. PR #62 CI closure (Part A, proven)

Live CI on b9baa605/e0271b49 failed identically and only on the
branch-new `tests/gnssRaw/gnssRawSessionPanel.test.tsx > stages fixtures
into inventory with a deterministic STAR tree`
(`AssertionError: expected '' to contain 'SYNB'`, 1 failed / 3515 passed /
34 skipped both runs). The file does not exist on baseline 374aff42, so
this was a BRANCH_REGRESSION (async-intake timing in a new test), not the
reported Study Desktop state — CI logs show zero Study Desktop failures.
Fix 39376114 (2-line `waitForText`) → run 34893566186 classify/core/
numerical all PASS → merged as 58d7cbed (merge-push CI also green).
No CI policy change, no unrelated code touched.

Local `test:agent` on this branch: 3560 pass + the same 3 Study Desktop
files failing (`study_ai_unit_calibration`, `..._v5`, `..._preflight`).
Proven BASELINE_IDENTICAL_FAILURE + environmental: all 3 fail identically
on pristine origin/main 58d7cbed given the same checkout-local ignored
run state (`study-content/ai/runs/ai-map-2026-*/`, gitignored), and SKIP
on a clean worktree (which is why CI stays green). Branch diff on
`study-desktop/` is empty. No action taken per policy.

## 1. Production bugs found and fixed (code)

### 1a. `-r` voided the ANTEX postype (12J.9 line was dead bytes)
`rnx2rtkp` loads `-k` in a first argv pass and applies `-r` in a second
pass that resets `refpos=rovpos=XYZ`. Every production ANTEX invocation
passed `-r`, so `ant2-postype=rinexhead` never took effect (the 12J.9
native proof omitted `-r`). All pre-12J.10 "exact subset ANTEX" evidence
(incl. 12J.7/12J.8 matrices) ran with XYZ anchoring. Fix: ANTEX jobs omit
`-r`; both antenna positions come from RINEX headers. Legacy non-ANTEX
args byte-identical.

### 1b. Receiver PCV never applied (default anttype is "")
RTKLIB defaults `ant*-anttype` to `""`, which matches no ANTEX entry, so
12J.9 production applied satellite PCV only. Fix: explicit header-derived
`ant1/ant2-anttype` + `antdel` per endpoint. Explicit (not `*`) keeps
`antpos` from re-adding header DELTA to the fixed base, so reported
vectors stay first-order unbiased under either agency header convention
(ROB headers carry ARP-ish approx + DELTA; BKG carries marker + DELTA).
Hard tests assert both postypes, both anttypes, both antdelus, `-r`
absent with ANTEX / present without.

### 1c. Real-data impact (bisected on TGRN-WARE-130-h12, FIXED throughout)
- Anchor convention (marker `-r` vs header ARP): 518.1 mm (exact
  marker-minus-ARP; reporting-consistent, not a vector error once the
  const matches the anchor).
- Receiver PCV on/off at fixed anchor: 461.4 mm — a different (wrong)
  integer fix at ratio 15.6 without PCV vs 19.9 with PCV.
- Production SUB vector == independent 12J.8 vector to 0.2 mm
  (12J.8: marker anchor + explicit receiver PCV). The corrected lineage
  selects the right fix; the old lineage fixed ~1 m off here.
- Satellite PCV alone: 0.2 mm on this leg.

### 1d. RINEX 4 intake
Belgian corpus is RINEX 4.01; product rejected it (epoch branch + version
gate). RINEX 4 keeps RINEX 3 `>` epoch records: parser + preflight now
accept `4.x`, skip RINEX 4 `>` event records (fail closed on zero
epochs). Fixtures `r4base/r4rover.24o` via generator; tests green.

## 2. Panel split (§§2-4, zero behavior)

`GnssRawSessionPanel.tsx` 664 → 219 lines + `useRawGnssSessionProcessing`
hook (305: snapshot/launch guard/repair/reimport/ANTEX staging) +
`RawGnssSessionIntake` (121) + `RawGnssSessionInventory` (58) +
`RawGnssSessionGraphControls` (115) + `RawGnssSessionProgress` (124).
Identical testids/classes/markup; TOCTOU ownership preserved (snapshot
still the only source assembly/repair read). Guards: full gnssRaw suite
green unchanged (incl. 21→27 panel tests), new ANTEX-remove ownership
regression, 5 isolation rows for new files, scale render 2/4/10/20,
browser E2E 5/5 post-split, real-WASM tier green.

## 3. ANTEX matrix (§§5-15, local Belgian corpus, precise SP3)

Lineage mirrors production exactly (conf: `pos1-sateph=precise`,
rcv/sat antfile, ant1+ant2 rinexhead, explicit anttype/antdel, no `-r`).
Subsets built by the PRODUCTION builder (`gnss12j10Subset.ts`):
60 MB source → 540 KB–1.15 MB subsets, 116 GPS blocks, caps respected
(source < 100 MiB, subset < 4 MiB, obs/nav/sp3 ≤ 32 MiB per-file).

- Full-vs-subset: **63/63 pairs byte-identical solution lines**
  (7 legs × 3 days × 4/2 windows; TRM59800.00 / LEIAR25.R3 / LEIAR25.R4).
- Superset SESS4 == leg subset: 3/3 identical (extra entries harmless).
- Orientation A→B/B→A: vector-sum closure 0.000/0.100/0.100 mm, both
  FIXED, endpoint configs swap correctly.
- Falsification (evidence-only MUT, LEIAR25.R3 PCO UP +5 m, unmistakable
  label, never production): dv 124.9 mm FIXED→FIXED — calibration path
  is live, not just staged.
- No-ANTEX legacy control: ~980 mm (518 anchor-convention + 461
  wrong-fix, §1c); small/nonzero physical PCV effect is NOT claimed —
  the falsification test is the liveness proof.
- Satellite coverage: all 10 in-window GPS PRNs have subset blocks; no
  silent missing-satellite fallback (RTKLIB validity dates not gated by
  design; selection is identity-exact).
- Determinism: permuted serials → byte-identical subset (unit + real
  S1 == S1-rev); same source/set/date → identical hash regardless of
  upload/station/graph order (builder sorts; output follows source).
- Cache isolation: A→B→A gives A1 === A2, B distinct (unit); production
  sessions share one cached subset across 8 sessions (cache size 1).
- Browser/WASM processing proof: existing Chromium test Q (ANTEX source
  → subset → resolved entries → real processing → COMPLETE → hashes in
  provenance) re-verified post-split; node-WASM sessions below.
- Objective exclusions (NODATA, never failures): WERB DOY137 partial
  file (13:24–19:40 only) and WERB DOY130 17–20 h gap; empty windows fail
  loudly (`no position in rinex header`, rc path) → PARTIAL naming the
  edge. A wrong per-leg subset map (TIT2-VOER→S2, missing base serial)
  demonstrated RTKLIB's silent asymmetric degradation (160 mm, still
  FIXED); corrected to S4 → identical. Production is immune by
  construction (union build + fail-closed on missing serial).
- Ambiguity ratio is not emitted in `.pos` output, so parity uses
  FIX/FLOAT + epochs + sats + sd6 + vectors instead (documented gap).

## 4. Clean-clone E2E (§§18-19)

`scripts/gnss/stageRtklibE2E.mjs` (byte-checked, fail-closed) +
`e2e:raw-session` / `e2e:raw-review` one-command scripts; staged glue
gitignored. Proof: fresh stage + 5/5 Chromium session tests green with
no manual copies.

## 5. Belgian session matrix (§§20-23, exact production node-WASM path)

12 STAR sessions (3 days × 4 windows, WARE hub; EIJS substitutes WERB in
gap windows): **12/12 COMPLETE, 36/36 edges solved (34 FIXED, 2 FLOAT),
0 failed**. Native edge pre-matrix agrees.
MST (Kruskal verified against production builder): 3/3 windows, identical
deterministic graphs, all FIXED. MANUAL chains (3 sessions, orientation
honored): all FIXED + export/reopen. Six-station 130-h12 (5-edge STAR,
mixed TRM/R3/R4 incl. 59 km TIT2): 5/5 FIXED, PAR=2 queue, dependency
metadata valid. Every session: export deterministic under reorder,
reopen fidelity true, ANTEX + ephemeris provenance recorded.
Repair (§24) and cancel-then-clean (§25) covered by Chromium M/O tests
(replacement provenance `replaces X`, no stale COMPLETE) + pool
cancel/reset/requeue/dropEdge unit tests; rerun determinism via reset.

## 6. Resources (§29), isolation (§30), covariance (§31)

PAR=1/2/4 on 13 native jobs: 7 s / 4 s / 2 s. Default stays PAR=2
(faster under load without memory pressure; no OOM in 135 native + 20
WASM runs; per-job MEMFS ≤ 32 MiB, subset ≤ 4 MiB). Full-day files over
32 MiB exceed the frozen intake cap → evidence stages honest window
slices (headers kept, slice bytes hashed); cap unchanged. Project
isolation: browser tests assert the active project unchanged; no ingest
handler exists (isolation tests + SESSION_UI list cover all new files).
Exports carry RTKLIB_FORMAL / UNCALIBRATED / FORMAL_UNCALIBRATED (12
each in real session JSON); zero `accuracy|survey accuracy|network
precision` wording.

## 7. Verdicts and gates (§§33-34, acceptance A-Z all PASS)

- ANTEX: **ANTEX_PRODUCTION_READY_WITH_SUBSET** (all §33 clauses true).
- Raw session product: **GO-RAW-SESSION-REVIEW-PRODUCTION**.
- Phase 12J: **COMPLETE**. No 12J.11 (no covariance fitting, no direct
  ingest without fundamentally new stochastic evidence).

Capability matrix (§35): raw static RINEX (2/3/4.x obs) GPS L1/L2,
single baseline, multi-station STAR/MST/MANUAL spanning-tree sessions,
broadcast + explicit SP3, deterministic production ANTEX subsets,
review/export, formal covariance display, session/baseline JSON.
Frozen out: calibrated survey covariance, direct adjustment ingest,
all-pairs networks, FLOAT-as-diagnostic-only, PPP, RTK/kinematic,
proprietary T01/DAT, multi-GNSS production, R2B/free-network/tolerance
changes (none made).

## 8. Artifacts (local-only unless committed)

Committed: `scripts/gnss/gnss12j10{Subset,AntexMatrix,Analyze,SessionProof,Slice}.*`,
`stageRtklibE2E.mjs`, report (this file). Local evidence corpus
`~/Downloads/webnet-gnss-medium/belgian-12j8/work12j10/` (out/*.pos,
subsets incl. hashes, `analysis.json`, `sessions/*.json`,
`session-proof.json`, `times.tsv`) — never committed.
Perf: PAR1/2/4 7/4/2 s (13 jobs). Peak extra RSS: not instrumented;
bounded by construction, no pressure observed.
