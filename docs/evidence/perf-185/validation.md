# PERF-185 — validation (surface revision reuse + contour auto-derive)

All unit numbers are **deterministic call counts** captured through the
production path (jsdom, agent tier). Builder/engine functions are wrapped with
`vi.mock(... importOriginal ...)` counters; `SurfaceContourService.requestContours`
is stubbed so the no-`Worker` jsdom path never enters its real transport. No
wall-clock thresholds. Baseline = `5bb1a320` (pre-fix), measured in a separate
`git worktree` at that commit so the in-progress worktree was never disturbed.

Fixture (`tests/cad_surface_revision_cache_185.test.tsx`): spike project + 1200
total survey points, surface `surf:contours`, contour style. The 3-surface
variant duplicates that surface under distinct ids.

## 1. Baseline vs after — exact call counts

Counters: `compute` = `computeCadSurfaceSourceRevision`; `backfill` =
`backfillCadSurfaceStyles`; `request` = `SurfaceContourService.requestContours`;
`displayScene` = `buildCadDisplayScene`; `displayLayers` =
`buildSurfaceDisplayLayers`; `snapshot` = `buildCadSurfaceSnapshot`.

### 1 surface, 1200 pts, mount then 10 unrelated root re-renders

| Counter | BEFORE mount | BEFORE after 10 | AFTER mount | AFTER after 10 |
| --- | ---: | ---: | ---: | ---: |
| compute | 5 | 15 (**+10**) | 1 | 1 (**+0**) |
| backfill | 6 | 16 (**+10**) | 5 | 5 (**+0**) |
| request | 0 | 0 | 0 | 0 |
| displayScene | 1 | 1 (+0) | 1 | 1 (+0) |
| displayLayers | 1 | 1 (+0) | 1 | 1 (+0) |
| snapshot | 1 | 1 (+0) | 1 | 1 (+0) |

### 3 surfaces, 1200 pts, mount then 10 unrelated root re-renders

| Counter | BEFORE mount | BEFORE after 10 | AFTER mount | AFTER after 10 |
| --- | ---: | ---: | ---: | ---: |
| compute | 15 | 45 (**+30**) | 3 | 3 (**+0**) |
| backfill | 12 | 42 (**+30**) | 5 | 5 (**+0**) |
| request | 0 | 0 | 0 | 0 |

The baseline delta scales with surface count (`+3 compute / +3 backfill` per
unrelated render for 3 surfaces); after the fix the delta is exactly **0** for
both counters. The retained `displayScene`/`displayLayers`/`snapshot` are already
memoized upstream, so they were 1 at mount and unchanged in both.

The awkward AFTER mount `backfill` of 5 is the residual one-per-sweep clone plus
the snapshot's own style table; the regression metric is the **delta across
unrelated renders**, which is 0.

## 2. Hash parity

The raw revision strings recorded across every counter are identical within a
mount and across the 10 unrelated renders, and the AFTER 1-surface revision
equals the BEFORE revision (`srev1:41559786`), proving the memo is
byte-identical to the canonical engine hash. The focused tests additionally
assert:

- four UI read paths share **one** canonical computation per immutable
  project revision and the snapshot row revision equals every observed hash;
- byte parity to `computeCadSurfaceSourceRevision` for every definition family
  (native points, point-group, breakline, boundary/void, edits, broken refs,
  imported-TIN, baked explicit-TIN);
- updates on project replacement and same-id surface replacement; no change for
  style-only edits.

## 3. Focused tests (agent tier)

`npx vitest run tests/cad_surface_source_revision_memo_185.test.ts
tests/cad_surface_revision_cache_185.test.tsx
tests/cad_surface_contour_worker.test.ts
tests/cad_surface_contour_race_185.test.tsx --config vitest.agent.config.ts`

```
Test Files  4 passed (4)
Tests       23 passed (23)
```

Coverage added:

- `tests/cad_surface_source_revision_memo_185.test.ts` (8): byte parity across
  definition families; one compute per immutable revision; project replacement;
  same-id surface replacement; style-only invariance; documented in-place
  mutation boundary; `findCadSurfaceStyle` read-only vs `backfill` clone.
- `tests/cad_surface_revision_cache_185.test.tsx` (3): mount reaches all four
  consumers with exactly one canonical computation; 10 unrelated renders add
  **0** compute/backfill/request/snapshot; exactly-once derivation per missing
  eligible set after a rebuild, then 0 on unrelated renders; StrictMode
  double-effect stability (single hash, no duplicate request).
- `tests/cad_surface_contour_worker.test.ts` (+1): the service skips an
  already-current `(revision, geometry)` set ("already current", no second
  transport call) — the cache gate the auto effect relies on. The existing
  style-change-while-building test now also pins `pendingContourRequest`
  identity transitions (A → B → null) and that late A neither caches nor
  clears B.
- `tests/cad_surface_contour_race_185.test.tsx` (1, PERF-185.1 correction): a
  real-component integration test with a real `SurfaceContourService` and a
  fake transport that holds derivations open. A TIN build requests interval A;
  an interval change to B **while A is still pending** issues a second request
  (A cancelled, B live); late A is discarded (A status never CURRENT, B stays
  pending, no third request); B resolves to CURRENT; an appearance-only edit
  re-runs the sweep but is a cache hit (still 2 requests) — convergence with
  no loop or duplicate storm.

## 4. Neighbour tests

- `tests/cad_surface_contour_ui.test.ts`, `tests/cad_surface_bulk_downstream_18v.test.ts`
  → 2 files / 17 passed.

## 5. Browser (Chromium, dev server)

| Spec | Result |
| --- | --- |
| `tests-browser/cad-surface-revision-185.spec.ts` (focused 185) | **1/1 passed** (11.8 s) |
| `tests-browser/cad-pointer-perf-183.spec.ts` (#183 reuse) | **2/2 passed** |
| `tests-browser/cad-surface-18h.spec.ts` (contour reuse) | AB, CD, FGH, IJ, K passed; E failed |
| `tests-browser/cad-surface-bulk-edits-18v.spec.ts` (18V reuse) | 1/2 reached failed before batch timeout |

- The focused 185 spec asserts: exactly one `deriveContours` for the initial
  CURRENT-TIN contour style; 10 zoom/pan/selection interactions → still 1;
  interval change → exactly 1 more; undo/redo of the interval → retained-cache
  hits, 0 new worker calls; source edit → `NEEDS_REBUILD` with no stale
  promotion; rebuild → 1 more; drawing switch → no cross-drawing request; zero
  page/console errors. It also adds the `contourVersion`-dependency experiment
  as an implicit pin (the spec fails on the switch step when that dep is added).
- The PERF-185.1 race (interval change **while** A is deriving) is covered by
  `tests/cad_surface_contour_race_185.test.tsx` rather than the browser spec:
  the real worker derivation completes in milliseconds, so racing the style
  edit against it would be timing-flaky. The integration test holds the fake
  transport open to make the race deterministic. The browser spec's interval
  change (step 4) intentionally runs after the first derivation settles and
  still passes with the revision-aware gate.
- `18H-E` (select-all + MOVE ⇒ `NEEDS_REBUILD`) **fails identically on pristine
  HEAD `5bb1a320`** with the tracked PERF-185 diff reverted — a pre-existing,
  environment-related failure, not a regression. `cadSurfaceView`'s memo was
  additionally isolated by temporarily making `surfaceContentRevision` a direct
  passthrough; `18H-E` still failed, excluding the memo.
- `18V-1` / `18V-2` hit their own Playwright timeouts (300 s / 480 s) in the
  900 s batch window. They are heavy bulk-edit campaigns; this diff only removes
  work from the surface read paths and cannot slow them. The focused 185 spec
  re-exercises the same select/move/rebuild/undo/switch path with exact derive
  counts.

## 6. Build / paths / agent tier

- `npm run build` → **pass** (built in 10.01 s; only the pre-existing chunk-size
  warning).
- `npm run check:portable-paths` → **6180 tracked paths, 0 violations**.
- `npm run test:agent` → **9482 passed, 1 skipped, 3 failed**. The 3 failures
  are the pre-existing `study-desktop` real-data campaigns
  (`study_ai_unit_calibration`, `..._v5`, `study_ai_unit_preflight`); no
  `study-desktop` path is touched by this diff, and a fresh baseline worktree
  (which lacks the ignored real data) reports those same 3 tests as skipped.
  No CAD/surface/worker regression.

## 7. Scope / hygiene

- Diff is confined to `src/components/SurveyCadWorkspace.tsx`,
  `src/engine/cad/cadSurfaceStyles.ts`, `src/engine/cad/cadSurfaceView.ts`,
  `src/workers/surfaceContourService.ts` (read-only pending-request getter),
  `tests/cad_surface_contour_worker.test.ts` (+ new 185 tests, browser spec,
  evidence docs).
- `computeCadSurfaceSourceRevision` and the contour geometry revision are
  unchanged; #183 / #184 / #191 and provider correction `ba12f8e8` untouched.
- 14 git stashes intact (none popped/dropped); baseline measured via a detached
  `git worktree`, not a stash.

## 8. Correction #2 — duplicate style-ID first-match (reviewer P2)

The sweep/scene `new Map(styles.map((s) => [s.id, s]))` indexes kept the LAST
duplicate id while the prior `.find()` and the untouched `cadSurfaceView.ts`
display lookup resolve FIRST. Fix: `indexCadSurfaceStylesById` in
`cadSurfaceStyles.ts` (one backfilled clone, set-if-absent = first wins) used
by both `SurveyCadWorkspace.tsx` indexes; `surfaceById` hardened the same way
(surface ids should be unique; guard preserves the prior `.find` contract if a
duplicate ever loads). No load-time rejection/migration. Pin:
`cad_surface_source_revision_memo_185` duplicate-id test (find + index + spec +
display stroke all resolve to FIRST).
