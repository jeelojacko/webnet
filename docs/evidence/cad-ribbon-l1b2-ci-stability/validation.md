# CAD ribbon L1-B2 CI stability — validation

## Hypothesis (reproduced mechanism, not assumed)

`CadRibbonSplitButton.openMenu` arms the one-shot induced-scroll exemption and
schedules its disarm as an unqualified-global `requestAnimationFrame` callback
(`src/cad-app/shell/CadRibbonSplitButton.tsx:83-100`). The L1-B2 test opened the
flyout via an awaited `act` click, then dispatched the synthetic "same-frame"
strip scroll in a *separate* awaited `act`. jsdom's real rAF is a ~16 ms timer,
not an `act`-scoped callback, so under CI/event-loop load it can fire at any
`await` boundary between open and scroll, clear the exemption through the
generation guard, and turn the first strip scroll into a genuine close — the
observed `expected [data-cad-ribbon-flyout="arc"] not null but got null` at
`tests/cad_ribbon_controls.test.tsx:426`.

Deterministic proof (throwaway probe, since removed): with the REAL scheduler,
open → `await setTimeout(60ms)` → first strip scroll closes the menu. The probe
passed, i.e. crossing the frame boundary provably converts the first scroll
from exempt to genuine. No production defect: the runtime closes correctly once
the exemption is disarmed; only the test's wall-clock scheduling was
nondeterministic.

## Fix (test-only, same file)

`tests/cad_ribbon_controls.test.tsx` — no production/runtime changes:

- Local `stubRafQueue()` helper (same style as `RafCallback` + `vi.stubGlobal`
  precedent in `tests/map_view_zoom_transform.test.tsx`): queues the
  component's unqualified-global rAF callback, returns monotonic ids, restores
  via `vi.unstubAllGlobals()` in `finally`. No global fake timers, no sleeps.
- L1-B2 (name/semantics preserved): installs the stub, opens, asserts the
  disarm callback is queued-but-unrun (`toHaveLength(1)` — proof the scroll
  below is in the exemption's active frame), first strip scroll keeps the menu
  open, second closes (one-shot consumption). The queue-length assertion is
  self-proving: had the stub missed the component's rAF identity, it would fail.
- New L1-B2-expiry guard: opens with the stub, flushes the queued callback
  inside `act` (simulated frame boundary), then the FIRST strip scroll closes.
  This demonstrably fails the "same-frame" expectation once the disarm runs
  first — it proves L1-B2 tests the armed frame, not a dead window.
- L1-B (window scroll), L1-B3 (moved caret), L1-A (internal scroll) untouched:
  their close/keep-open outcomes hold with or without the exemption, so they
  still test their intended semantics.

## Results

- Baseline before fix: `tests/cad_ribbon_controls.test.tsx` 27/27 isolated
  (flake is load-dependent; not reproduced isolated, no causation claimed
  beyond the mechanism probe above).
- After fix: 28/28, including 5/5 consecutive runs under `yes`-spun CPU
  contention — all green.
- Neighbors: `cad_ribbon_custom_families`, `cad_ribbon_icon_manifest`,
  `cad_ribbon_tool_families`, `cad_ribbon_wave2` — 22/22 green.
- `npx tsc --noEmit` clean; `npm run lint` 0 errors (9 pre-existing warnings in
  unrelated files); `npm run check:portable-paths` 0 violations (6399 paths);
  `npm run build` green.
- `npm run test:agent` run 1: 10918 passed, 4 failed; run 2: 10919 passed,
  3 failed — the 3 failures are the known unrelated local-only Study Desktop
  ignored private real-data fixtures (`study_ai_unit_calibration`,
  `study_ai_unit_calibration_v5`, `study_ai_unit_preflight`), left unchanged.
  The 4th run-1 failure was a transient study-desktop real-data count nearby
  (preflight/grounding area), green on rerun. The ribbon suite passed in both
  runs. No graph/golden contracts touched.

## Remaining risks

- If React/jsdom internals ever schedule an extra global rAF inside this
  harness, the strict `toHaveLength(1)` arming assertion would fail loudly
  (fail-closed, easy to diagnose) rather than silently weaken.
- The fix pins test timing, not product timing: a future production change to
  the exemption law must update these tests deliberately.
