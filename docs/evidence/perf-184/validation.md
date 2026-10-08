# PERF-184 — shell-snapshot memo validation (memo part)

All numbers are deterministic call counts captured through the production path
by `tests/cad_shell_snapshot_memo_184.test.tsx` (jsdom, agent tier, ~1.5 s of
test time). Builder modules are wrapped with `vi.mock(... importOriginal ...)`
counters and `shellLink.publish` is wrapped on a real `createCadShellLink()`.
No wall-clock thresholds. **Baseline** = branch tip `15870a64` (pre-fix
`shellSnapshot`); **after** = this branch with the seven-field destructure.

Fixture: 1200 generated survey points on top of the spike project (1203 total)
plus one point-source surface (`surf:dense`), so every snapshot builder
receives real derived data.

## Baseline vs after — exact counts

Per logical action, counted as builder invocations / `publish` invocations:

| Action | Baseline builders | After builders | Baseline publishes | After publishes |
| --- | ---: | ---: | ---: | ---: |
| Mount (12 builders × 2 committed renders) | **24** | **12** | **2** | **1** |
| Unrelated parent root re-render | **+12** | **+0** | **+1** | **+0** |
| Unrelated internal state (drafting panel toggle) | **+12** | **+0** | **+1** | **+0** |
| Genuine selection change | +12 | +12 | +1 | +1 |
| Genuine snap-preference toggle | +12 | +12 | +1 | +1 |
| Genuine command start | +24 | +12 | +1 | +1 |
| Genuine layer/undo transaction | +24 | +12 | +1 | +1 |
| Genuine surface build (small project, CURRENT) | +12 | +12 | +1 | +1 |

Mount is 24 on baseline because the post-mount viewport `setViewBounds` reset
commits a second root render; on baseline each render re-ran the whole memo.
After the fix the second render keeps the same snapshot identity (memo
bail-out), so mount is one builder pass and one publish.

The two unrelated-render rows are the regression being fixed. After the fix the
memoized snapshot object reference is **identical** before and after both
unrelated renders (`link.getSnapshot()` identity assertion), which independently
proves the memo closure never re-executed.

## Invalidation matrix (after fix)

| Snapshot field group | Trigger | Rebuild all 12? | Publish? | Stale-value assertion |
| --- | --- | --- | --- | --- |
| selection | `actions.selectEntities([...])` | yes | yes | `selectedEntityIds`, `selectionCount`, `selectionPreview` match; last publish carries them |
| snap status | `actions.setSnapPreference('endpoint', false)` | yes | yes | `snapPreferences.endpoint === false`, `snapStatusText` changed and equals last publish |
| command text | `actions.startCommand('LINE')` + `actions.setSessionInputValue('@10,20')` | yes | yes | `activeCommandKey === 'LINE'`, `commandInputValue === '@10,20'` |
| undo/redo | `actions.runLayerCommand({key:'LAYER_SET_CURRENT'})`, `undo()`, `redo()` | yes | yes | `canUndo`/`historyDepth` track 1 → 0 → 1 |
| drawing switch | parent swaps the persisted document | yes | yes | `drawingId` and `entityCount` change to the swapped drawing |
| surface CURRENT | `actions.rebuildSurface('surf:dense')` on a 6-point project (sync fallback) | yes | yes | row status `CURRENT`, `diagnostic === null` |
| surface FAILED | `actions.rebuildSurface('surf:dense')` on the 1200-point project (sync fallback limit) | yes | yes | row status `FAILED`, diagnostic contains `sync fallback limit` |

BUILDING is a worker-transport-only transient; jsdom has no `Worker`, so the
service always takes its synchronous fallback and no BUILDING state is
observable here. BUILDING/FAILED publish semantics for built subtrees are
pinned by the existing `tests/cad_shell_snapshot_contract.test.ts` and by the
worker-tier grading/surface suites; the memo-side contract proved here is that
whatever status the builder derives flows through the memo + publish path.

## #183 no-regression

`tests/cad_pointer_perf_183.test.tsx` and `tests/cad_snap_state_dedupe_183.test.ts`
pass unchanged: idle no-snap pointer moves still commit zero root state, and
the memoized static-primitive layer is untouched.

## Commands run

- Focused: `npx vitest run tests/cad_shell_snapshot_memo_184.test.tsx` — 9/9 passed.
- #183 + shell neighbours:
  `npx vitest run tests/cad_pointer_perf_183.test.tsx
  tests/cad_snap_state_dedupe_183.test.ts
  tests/cad_shell_snapshot_contract.test.ts
  tests/cad_shell_panels.test.tsx
  tests/cad_survey_snapshot_cap_191.test.ts` — 5 files / 93 tests passed.
- Workspace neighbours: `npx vitest run tests/surveyCadWorkspace/` —
  52 files / 144 passed, 1 skipped.
- `npx tsc --noEmit` — clean (LSP diagnostics clean on both changed files).

## Risks

- The memo bails out only when every dependency is `Object.is`-stable. The
  audit above and the zero-work unrelated-render test cover all current inputs;
  a future input that is recreated each render must be destructured/select
  from or memoized at its creation site, not added wholesale.
- `shellLink.publish` still runs its deep comparator on genuine changes; the
  fix removes the *spurious* invocations, not the comparator.
