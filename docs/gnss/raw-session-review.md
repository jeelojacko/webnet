# Raw Session Review (Phase 12J.9 Track E2 evidence)

Multi-baseline raw-static sessions: intake of 2–20 RINEX observation files
(+ NAV, optional SP3/ANTEX), deterministic occupation identity,
overlap/common-window session detection, STAR/MST/manual spanning trees
(N−1 validated edges), per-edge common-window processing through a bounded
PAR=2 session worker pool, failure isolation + tree repair, session review
UI, and `webnet-raw-static-session/1` export + reopen. Evidence in
`reports/gnss/phase12j9-session-evidence.md`. This doc states policy and
workflow; the MVP processing contract stays in `raw-static-worker-mvp.md`.

## §51 Covariance policy

No verbatim mission-§51 text is checked into this repo (mission text is
external), so this section carries the standing in-repo certification
wording verbatim from `reports/gnss/phase12j8-covariance-confirmation.md`
§18 instead — it is the frozen contract this track inherits:

> Terminal result: S≈18 is the standing working scale for GPS L1/L2 1h
> medium-baseline survey weighting, evidence-only.

And the operative rule: raw formal covariance is NEVER survey weighting.
Every processed raw baseline carries `FORMAL_UNCALIBRATED`
(RTKLIB formal, `RTKLIB_FORMAL` model); calibration, if any, is applied
only downstream by operator decision, never inside raw processing. Session
export records per-edge formal covariance verbatim; any recompute goes
through the pool. Certification remains `REVIEW_ONLY_FINAL`; no certified
scope is claimed by this track.

## §52 External-covariance-path audit

Covariance that did NOT come from raw processing — TBC GVX vectors,
other-processor baselines, independently assigned weights — NEVER enters
through the raw path. It uses the EXISTING processed-GNSS import only:

- GVX 1.0 → `src/engine/gnssGvxImport.ts` → canonical Phase 12B
  observation → Static GNSS Baseline Workspace (see
  `docs/gnss/GVX_IMPORT.md`, `docs/gnss/STATIC_GNSS_WORKFLOW.md`).
- Delimited-CSV / synthetic-sample baselines → the same workspace intake.
- Independently assigned (operator) sigmas → the workspace setup model
  (metre-only, default 0), applied at RUN level after composition.

Semantics separation, enforced by construction:

- Raw-formal (`FORMAL_UNCALIBRATED`): the processor's internal estimate;
  optimistic by ~18× on 1 h medium baselines (12J.8 S=18.111). Review and
  diagnostic use only.
- Calibrated survey weighting: lives ONLY in the processed workspace
  (composition rules, control overrides, loop QC). The raw session has no
  path that writes, scales, or promotes a formal covariance into that
  workspace — there is no ingest; the session ends at review/export.

No new import route was added by this track; no existing route was
changed. A TBC-weighted vector and a raw-formal vector can never share a
covariance field without an explicit operator step in the processed
workspace, where provenance is recorded.

## Session workflow (review only)

1. Stage 2–20 RINEX obs files + NAV (+ optional SP3/ANTEX subset).
   Per-file 32 MiB cap, fail-closed.
2. Occupation identity: marker + antenna model + DEL + common window;
   duplicates detected, never double-processed.
3. Common-window detection across the session; per-edge processing
   window = intersection (AUTO) or operator interval inside it.
4. Spanning tree: STAR (default), MST, or manual — always N−1 validated
   edges; repair revalidates a replacement edge.
5. Bounded pool (PAR=2): one worker start per edge job; failures isolate
   to the edge (PARTIAL names the failed edge); cancel never launches
   queued jobs and ignores late messages.
6. Review: per-edge FIXED/FLOAT/FAILED, formal covariance, provenance
   (processor pin, file hashes, ANTEX subset hash). FLOAT diagnostic-only,
   FAILED no export — same per-edge policy as the MVP.
7. Export `webnet-raw-static-session/1` (JSON) + reopen without
   reprocessing; upload order does not affect semantic bytes
   (envelope `exportedAt` and per-baseline `processedAt` are wall-clock
   marks excluded from the comparison, never from the archive).

## ANTEX verdict (12J.10 terminal — supersedes REVIEW_ONLY above)

**ANTEX_PRODUCTION_READY_WITH_SUBSET.** Full evidence in
`reports/gnss/phase12j10-final-hardening.md` (§3): 63/63 full-vs-subset
byte-identical solution lines across 7 legs × 3 days × 4/2 windows
(TRM59800.00 / LEIAR25.R3 / LEIAR25.R4, precise SP3); orientation
closure ≤ 0.1 mm; falsification control (+5 m PCO → 124.9 mm, path
live); production subsets 540 KB–1.15 MB from the same 60 MB `igs20.atx`
(sha256 `8715268e…`); exact TYPE+RADOME matching, deterministic builds,
cache isolation, hash provenance, bounded memory, clean-clone E2E.
12J.10 also repaired the endpoint configuration (both postypes effective
by dropping the clobbering `-r`; explicit header anttype/antdel so
receiver PCV actually applies) and accepts RINEX 4 obs. The 12J.9
"bit-identical" browser note below described the unfixed lineage
(satellite-PCV-only staging); it no longer applies.

## DIRECT_INGEST

**NO.** Sessions end at review/export. No path writes raw baselines or
raw-formal covariance into any project, network, or adjustment store
(verified: Track C sources import no adjustment/store modules; session
queue tests assert the boundary).

## Phase 12J.10 terminal notes

- Panel split with zero behavior change: `GnssRawSessionPanel` (now 219
  lines) + `useRawGnssSessionProcessing` hook + `RawGnssSessionIntake` /
  `Inventory` / `GraphControls` / `Progress`. Snapshot/launch-guard/
  repair/reimport semantics preserved; see report §2.
- RINEX 4.x observation files accepted (epoch records are RINEX-3
  compatible; `>` event records skipped, fail closed on zero epochs).
- Clean-clone browser E2E: `npm run e2e:raw-session` / `e2e:raw-review`
  build + stage + run; staged glue gitignored, never committed.
- Phase 12J is COMPLETE (report §7). No covariance fitting, no direct
  ingest, no all-pairs networks, no math/R2B/free-network/tolerance
  changes were made in this track.
